
import type { NextFunction, Request, Response } from "express";
import { x402ResourceServer } from "@x402/core/server";
import { HTTPFacilitatorClient, x402HTTPResourceServer } from "@x402/core/http";
import type { HTTPAdapter, HTTPRequestContext } from "@x402/core/http";
import { ExactHederaScheme } from "@x402/hedera/exact/server";

import { FACILITATOR_URL, NETWORK, PAY_TO } from "./config.js";
import * as events from "./events.js";

const HBAR_ASSET = "0.0.0";

const TINYBARS_PER_HBAR = 100_000_000n;

export function hbarToTinybars(hbar: string): string {
  const trimmed = hbar.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid HBAR amount: ${hbar}`);
  }
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > 8) {
    throw new Error(`HBAR amount ${hbar} has more precision than one tinybar.`);
  }
  const padded = fraction.padEnd(8, "0");
  return (BigInt(whole) * TINYBARS_PER_HBAR + BigInt(padded || "0")).toString();
}

/** Adapts an Express request to the transport-agnostic shape core expects. */
function expressAdapter(req: Request): HTTPAdapter {
  return {
    getHeader: (name: string) => {
      const value = req.headers[name.toLowerCase()];
      return Array.isArray(value) ? value[0] : value;
    },
    getMethod: () => req.method,
    getPath: () => req.path,
    getUrl: () =>
      `${req.protocol}://${req.get("host") ?? "localhost"}${req.originalUrl}`,
    getAcceptHeader: () => req.get("accept") ?? "",
    getUserAgent: () => req.get("user-agent") ?? "",
    getQueryParams: () => req.query as Record<string, string | string[]>,
    getQueryParam: (name: string) =>
      (req.query as Record<string, string | string[]>)[name],
    getBody: () => req.body,
  };
}

/** Settlement details attached to a request that actually paid. */
export type PaymentContext = {
  transaction: string;
  network: string;
  payer?: string;
};

export type PaidRequest = Request & { x402?: PaymentContext };

/** A protected handler. Awaited by the middleware, so it may be slow. */
export type ProtectedHandler = (
  req: PaidRequest,
  res: Response,
) => Promise<void> | void;

export type RouteSpec = {
  path: string;
  method: "GET" | "POST";
  /** Price in HBAR as a decimal string, e.g. "0.02". */
  price: string;
  /** Runs only after payment has been verified. */
  handler: ProtectedHandler;
};

export async function createX402Middleware(routes: RouteSpec[]) {
  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

  const resourceServer = new x402ResourceServer(facilitator);
  resourceServer.register(NETWORK as never, new ExactHederaScheme());

  const routesConfig: Record<string, unknown> = {};
  const handlers = new Map<string, ProtectedHandler>();
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    routesConfig[key] = {
      accepts: [
        {
          scheme: "exact",
          network: NETWORK,
          payTo: PAY_TO,
          price: {
            asset: HBAR_ASSET,
            amount: hbarToTinybars(route.price),
          },
          maxTimeoutSeconds: 120,
        },
      ],
    };
    handlers.set(key, route.handler);
  }

  const httpServer = new x402HTTPResourceServer(
    resourceServer,
    routesConfig as never,
  );
  await httpServer.initialize();

  const middleware = async (req: Request, res: Response, next: NextFunction) => {
    const adapter = expressAdapter(req);
    const paymentHeader = adapter.getHeader("X-PAYMENT");

    const correlationId = events.sanitizeCorrelationId(
      adapter.getHeader("X-PROOFLINE-STREAM"),
    );
    if (correlationId) {
      res.setHeader("X-Proofline-Stream", correlationId);
    }
    const isDemoDriven = adapter.getHeader("X-PROOFLINE-DEMO") === "1";

    const context: HTTPRequestContext = {
      adapter,
      path: req.path,
      method: req.method,
      ...(paymentHeader ? { paymentHeader } : {}),
    };

    let result;
    try {
      result = await httpServer.processHTTPRequest(context);
    } catch (error) {
      // A facilitator outage is an infrastructure failure, never a forensic
      // outcome (CLAUDE.md Section 18).
      console.error("[x402] facilitator error:", (error as Error).message);
      res
        .status(503)
        .json({ error: "SERVICE_UNAVAILABLE", message: "Facilitator unavailable." });
      return;
    }

    if (result.type === "no-payment-required") {
      next();
      return;
    }

    const routeKey = `${req.method} ${req.path}`;
    const handler = handlers.get(routeKey);
    const route = routes.find((r) => `${r.method} ${r.path}` === routeKey);
    if (!handler) {
      next();
      return;
    }

    if (correlationId && !paymentHeader) {
      events.emitOnce(correlationId, "RECEIVED", { route: routeKey });
    }

    if (result.type === "payment-error") {
      const { status, headers, body } = result.response;
      for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
      // A 402 is the challenge being issued, not a failure. Anything else here is a real payment error.
      if (correlationId) {
        if (status === 402) {
          events.emitOnce(correlationId, "PAYMENT_REQUIRED", { price: route?.price });
        } else {
          events.emit(correlationId, "ERROR", { status });
        }
      }
      res.status(status).json(body);
      return;
    }

    if (correlationId) events.emit(correlationId, "PAYING");

    const originalJson = res.json.bind(res);
    const originalStatus = res.status.bind(res);
    let capturedBody: unknown;
    let capturedStatus = 200;
    let captured = false;

    res.status = ((code: number) => {
      capturedStatus = code;
      return res;
    }) as typeof res.status;

    res.json = ((body: unknown) => {
      capturedBody = body;
      captured = true;
      return res;
    }) as typeof res.json;

    try {
      if (correlationId) events.emit(correlationId, "ANALYZING");
      await handler(req as PaidRequest, res);

      if (!captured) {
        // The handler never produced a JSON body. Do not settle a payment for a request that yielded nothing.
        res.status = originalStatus;
        res.json = originalJson;
        originalStatus(500).json({
          error: "ANALYSIS_FAILED",
          message: "Protected handler produced no result.",
        });
        return;
      }

      // Only settle when the handler actually succeeded. A failed analysis must not take the caller's money.
      if (capturedStatus >= 400) {
        res.status = originalStatus;
        res.json = originalJson;
        originalStatus(capturedStatus).json(capturedBody);
        return;
      }

      const settlement = await httpServer.processSettlement(
        result.paymentPayload,
        result.paymentRequirements,
        result.declaredExtensions,
      );

      res.status = originalStatus;
      res.json = originalJson;

      if (!settlement.success) {
        console.error("[x402] settlement failed:", settlement.errorReason);
        originalStatus(502).json({
          error: "SERVICE_UNAVAILABLE",
          message: "Payment settlement failed.",
          reason: settlement.errorReason,
        });
        return;
      }

      for (const [key, value] of Object.entries(settlement.headers)) {
        res.setHeader(key, value);
      }
      (req as PaidRequest).x402 = {
        transaction: settlement.transaction,
        network: settlement.network,
        ...(settlement.payer ? { payer: settlement.payer } : {}),
      };

      // Settled on the ledger. The transaction id is public information.
      if (correlationId) {
        events.emit(correlationId, "PAID", {
          transaction: settlement.transaction,
          network: settlement.network,
        });
      }

      // On the developer path there is no agent stage after this, so the stream ends here. The demo path completes its own stream after AGENT_ACTION.
      if (correlationId && !isDemoDriven) {
        events.complete(correlationId);
      }

      // The handler's body is passed through byte for byte. The gateway adds payment metadata alongside it and never edits the forensic result.
      originalStatus(capturedStatus).json(capturedBody);
    } catch (error) {
      res.status = originalStatus;
      res.json = originalJson;
      console.error("[x402] error:", (error as Error).message);
      originalStatus(502).json({
        error: "SERVICE_UNAVAILABLE",
        message: "Payment settlement failed.",
      });
    }
  };

  return { middleware, httpServer };
}
