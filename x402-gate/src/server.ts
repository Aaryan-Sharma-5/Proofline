import { fileURLToPath } from "node:url";

import express from "express";
import type { Response } from "express";

import {
  ANALYSIS_SERVICE_URL,
  FACILITATOR_URL,
  MAX_UPLOAD_BYTES,
  NETWORK,
  PAY_TO,
  PORT,
  PRICE_PING,
  PRICE_VERIFY,
  AGENT_SERVICE_URL,
  SERVICE_VERSION,
} from "./config.js";
import { buildDocsPage, buildOpenApiDocument } from "./api-docs.js";
import * as events from "./events.js";
import { createX402Middleware, type PaidRequest } from "./x402-middleware.js";

const app = express();

const FRONTEND_DIR = fileURLToPath(new URL("../../frontend/dist", import.meta.url));
app.use(
  express.static(FRONTEND_DIR, {
    index: "index.html",
    extensions: false,
    setHeaders: (res, filePath) => {
      if (/[.-][A-Za-z0-9_-]{8,}\.(js|css|woff2?)$/.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }),
);

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    network: NETWORK,
    facilitator: FACILITATOR_URL,
    payTo: PAY_TO,
  });
});

async function pingHandler(req: PaidRequest, res: Response): Promise<void> {
  res.json({
    message: "pong",
    paid: true,
    network: req.x402?.network ?? NETWORK,
  });
}

async function verifyHandler(req: PaidRequest, res: Response): Promise<void> {
  const contentType = req.get("content-type") ?? "application/octet-stream";
  const body = req.body as Buffer;

  if (!Buffer.isBuffer(body) || body.length === 0) {
    res.status(400).json({
      error: "INVALID_DOCUMENT",
      message: "Request body is empty.",
    });
    return;
  }

  if (body.length > MAX_UPLOAD_BYTES) {
    res.status(413).json({
      error: "INVALID_DOCUMENT",
      message: `Document exceeds ${MAX_UPLOAD_BYTES} bytes.`,
    });
    return;
  }

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(`${ANALYSIS_SERVICE_URL}/analyze`, {
      method: "POST",
      headers: { "content-type": contentType },
      body: new Uint8Array(body),
    });
  } catch (error) {
    console.error("[gateway] analysis service unreachable:", (error as Error).message);
    res.status(503).json({
      error: "SERVICE_UNAVAILABLE",
      message: "Analysis service is unavailable.",
    });
    return;
  }

  const payload = await upstream.json().catch(() => null);
  if (payload === null) {
    res.status(502).json({
      error: "ANALYSIS_FAILED",
      message: "Analysis service returned an unreadable response.",
    });
    return;
  }

  // Emit the real decision. Read from the engine's response, never recomputed here
  const correlationId = events.sanitizeCorrelationId(
    req.get("X-PROOFLINE-STREAM"),
  );
  if (correlationId && upstream.ok) {
    const verdict = payload as Record<string, unknown>;
    if (typeof verdict.verification_id === "string") {
      events.bindVerificationId(correlationId, verdict.verification_id);
    }
    events.emit(correlationId, "DECISION", {
      decision: verdict.decision,
      evidence_codes: verdict.evidence_codes,
      policy_score: verdict.policy_score,
      verification_id: verdict.verification_id ?? null,
    });
  }

  // Passed through verbatim.
  res.status(upstream.status).json(payload);
}

app.get("/openapi.json", (_req, res) => {
  res.json(
    buildOpenApiDocument({
      network: NETWORK,
      facilitator: FACILITATOR_URL,
      pricePing: PRICE_PING,
      priceVerify: PRICE_VERIFY,
      serviceVersion: SERVICE_VERSION,
    }),
  );
});

app.get("/docs", (_req, res) => {
  res.type("html").send(buildDocsPage());
});

app.post("/demo/verify", express.json({ limit: "20mb" }), async (req, res) => {
  const correlationId = events.sanitizeCorrelationId(
    (req.body as { stream_id?: unknown })?.stream_id,
  );

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(`${AGENT_SERVICE_URL}/demo/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(req.body ?? {}),
        ...(correlationId ? { stream_id: correlationId } : {}),
      }),
    });
  } catch (error) {
    console.error("[gateway] reference agent unreachable:", (error as Error).message);
    res.status(503).json({
      error: "SERVICE_UNAVAILABLE",
      message: "The reference agent is unavailable.",
    });
    return;
  }

  const payload = await upstream.json().catch(() => null);
  if (payload === null) {
    res.status(502).json({
      error: "SERVICE_UNAVAILABLE",
      message: "The reference agent returned an unreadable response.",
    });
    return;
  }

  if (correlationId) {
    const agent = (payload as { agent?: Record<string, unknown> }).agent;
    if (agent) {
      events.emit(correlationId, "AGENT_ACTION", {
        action: agent.action,
        downstream_payment_released: agent.downstreamPaymentReleased,
      });
    } else {
      events.emit(correlationId, "ERROR", { stage: "AGENT_ACTION" });
    }
    events.complete(correlationId);
  }

  res.status(upstream.status).json(payload);
});

app.get("/verification/:id/events", (req, res) => {
  const id = events.sanitizeCorrelationId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "INVALID_REQUEST" });
    return;
  }
  const lastEventId = Number(
    req.get("Last-Event-ID") ?? (req.query.lastEventId as string) ?? 0,
  );
  events.subscribe(id, res, lastEventId);
});

app.get("/verification/:id/status", (req, res) => {
  const id = events.sanitizeCorrelationId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "INVALID_REQUEST" });
    return;
  }
  const snapshot = events.status(id);
  if (!snapshot) {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }
  res.json(snapshot);
});

async function proxyHistory(path: string, res: Response): Promise<void> {
  let upstream: globalThis.Response;
  try {
    upstream = await fetch(`${ANALYSIS_SERVICE_URL}${path}`);
  } catch (error) {
    console.error("[gateway] history unavailable:", (error as Error).message);
    res.status(503).json({
      error: "SERVICE_UNAVAILABLE",
      message: "Verification history is unavailable.",
    });
    return;
  }
  const payload = await upstream.json().catch(() => null);
  if (payload === null) {
    res.status(502).json({ error: "SERVICE_UNAVAILABLE" });
    return;
  }
  res.status(upstream.status).json(payload);
}

app.get("/verification", async (req, res) => {
  const limit = Number(req.query.limit ?? 25);
  const safe = Number.isFinite(limit) ? Math.trunc(limit) : 25;
  await proxyHistory(`/verification?limit=${safe}`, res);
});

app.get("/verification/:id", async (req, res) => {
  // Only the id shape this service issues; nothing else is forwarded upstream.
  if (!/^vf_[A-Za-z0-9]{1,64}$/.test(req.params.id)) {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }
  await proxyHistory(`/verification/${req.params.id}`, res);
});

const { middleware } = await createX402Middleware([
  { path: "/ping", method: "GET", price: PRICE_PING, handler: pingHandler },
  {
    path: "/verify",
    method: "POST",
    price: PRICE_VERIFY,
    handler: verifyHandler,
  },
]);

// Raw body for /verify so the document reaches FastAPI byte-identical.
app.use("/verify", express.raw({ type: "*/*", limit: MAX_UPLOAD_BYTES }));
app.use(middleware);

const SPA_ROUTES = ["/", "/history", "/history.html"];

app.get(SPA_ROUTES, (req, res, next) => {
  if (!req.accepts("html")) return next();
  res.sendFile("index.html", { root: FRONTEND_DIR });
});

app.use((_req, res) => {
  res.status(404).json({ error: "NOT_FOUND" });
});

app.listen(PORT, () => {
  console.log(`[gateway] listening on :${PORT}`);
  console.log(`[gateway] network      ${NETWORK}`);
  console.log(`[gateway] facilitator  ${FACILITATOR_URL}`);
  console.log(`[gateway] payTo        ${PAY_TO}`);
  console.log(`[gateway] analysis     ${ANALYSIS_SERVICE_URL} (internal only)`);
  console.log(`[gateway] agent        ${AGENT_SERVICE_URL} (internal only)`);
  console.log(`[gateway] docs         /docs, /openapi.json (read-only)`);
});
