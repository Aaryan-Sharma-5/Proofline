import { readFileSync } from "node:fs";
import { basename, join, normalize, resolve, sep } from "node:path";

import express from "express";

import "./env.js";
import { decideAndAct, ReleaseLedger, type AgentAction } from "./agent-action.js";
import { resolveAgentCredentials } from "./credentials.js";
import { buildPayingClient, fetchWithPayment, hashscanUrl } from "./pay.js";

const NETWORK = process.env.X402_NETWORK?.trim() ?? "hedera:testnet";

const GATEWAY_PUBLIC_URL =
  process.env.GATEWAY_PUBLIC_URL?.trim() ??
  process.env.GATEWAY_URL?.trim() ??
  "http://127.0.0.1:4021";

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES?.trim() ?? "10485760");

const AGENT_PORT = Number(process.env.AGENT_PORT?.trim() ?? "4022");
const AGENT_HOST = process.env.AGENT_HOST?.trim() ?? "127.0.0.1";

/** Bundled sample documents a judge may run without uploading anything. */
const CORPUS_DIR = resolve(
  process.env.CORPUS_DIR?.trim() ?? join("..", "backend", "test_docs"),
);

const credentials = resolveAgentCredentials();
const paying = buildPayingClient(
  credentials.accountId,
  credentials.privateKey,
  NETWORK,
);

// Survives across requests, so a judge pressing the same button twice sees the duplicate release suppressed rather than paying a supplier twice.
const ledger = new ReleaseLedger();

function resolveSample(sample: string): string | null {
  if (!sample || sample.includes("\0")) return null;
  const candidate = resolve(CORPUS_DIR, basename(normalize(sample)));
  if (!candidate.startsWith(CORPUS_DIR + sep)) return null;
  if (!candidate.toLowerCase().endsWith(".pdf")) return null;
  return candidate;
}

type StageEvent = { stage: string; detail?: string };

const app = express();
// Base64 inflates by ~33%, so the JSON limit must exceed MAX_UPLOAD_BYTES.
app.use(express.json({ limit: "20mb" }));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    role: "reference-agent",
    agentAccount: credentials.accountId,
    gateway: GATEWAY_PUBLIC_URL,
    network: NETWORK,
  });
});

app.post("/demo/verify", async (req, res) => {
  const body = req.body as {
    sample?: unknown;
    stream_id?: unknown;
    document_base64?: unknown;
    filename?: unknown;
  };
  const streamId = String(body?.stream_id ?? "") || undefined;

  let bytes: Buffer;
  let label: string;

  if (typeof body?.document_base64 === "string" && body.document_base64) {
    // Uploaded document.
    try {
      bytes = Buffer.from(body.document_base64, "base64");
    } catch {
      res.status(400).json({
        error: "INVALID_DOCUMENT",
        message: "Uploaded document could not be decoded.",
      });
      return;
    }

    if (bytes.length === 0) {
      res.status(400).json({
        error: "INVALID_DOCUMENT",
        message: "Uploaded document is empty.",
      });
      return;
    }
    if (bytes.length > MAX_UPLOAD_BYTES) {
      res.status(413).json({
        error: "INVALID_DOCUMENT",
        message: `Document exceeds ${MAX_UPLOAD_BYTES} bytes.`,
      });
      return;
    }

    // Only the display name is derived from the client-supplied filename, and it is stripped to a basename so it can never be used as a path.
    label = basename(String(body.filename ?? "uploaded document")).slice(0, 120);
  } else {
    const path = resolveSample(String(body?.sample ?? ""));
    if (!path) {
      res.status(400).json({
        error: "INVALID_DOCUMENT",
        message: "Unknown sample document.",
      });
      return;
    }
    try {
      bytes = readFileSync(path);
    } catch {
      res.status(404).json({
        error: "INVALID_DOCUMENT",
        message: "Sample document is not available.",
      });
      return;
    }
    label = basename(path);
  }

  const stages: StageEvent[] = [{ stage: "RECEIVED", detail: label }];

  try {
    stages.push({ stage: "PAYMENT_REQUIRED" });
    stages.push({ stage: "PAYING" });

    // The outbound call. Same helper, same public URL, same 402 handshake the developer-path script uses.
    const result = await fetchWithPayment(paying, `${GATEWAY_PUBLIC_URL}/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/pdf",
        // Propagate the stream so RECEIVED/PAYMENT_REQUIRED/PAID/DECISION all
        // land on the same timeline the browser is already watching.
        ...(streamId
          ? { "x-proofline-stream": streamId, "x-proofline-demo": "1" }
          : {}),
      },
      body: new Uint8Array(bytes),
    });

    if (result.unpaidStatus !== 402) {
      // The resource answered without demanding payment. Refuse to present that as a paid verification.
      stages.push({
        stage: "ERROR",
        detail: `expected 402, got ${result.unpaidStatus}`,
      });
      res.status(502).json({
        error: "SERVICE_UNAVAILABLE",
        message: "The verification endpoint did not require payment.",
        stages,
      });
      return;
    }

    if (result.transaction) {
      stages.push({ stage: "PAID", detail: result.transaction });
    }
    stages.push({ stage: "ANALYZING" });

    const verdict = (result.body ?? {}) as Record<string, unknown>;
    stages.push({ stage: "DECISION", detail: String(verdict.decision) });

    const outcome: AgentAction = decideAndAct(verdict, label, ledger);
    stages.push({ stage: "AGENT_ACTION", detail: outcome.action });

    res.json({
      sample: label,
      // Forensic result, passed through exactly as received. The agent reads the decision; it never edits evidence or scores.
      verification: verdict,
      payment: result.transaction
        ? {
            transaction: result.transaction,
            network: NETWORK,
            hashscan: hashscanUrl(result.transaction, NETWORK),
            // Which account paid is public; how it signs is not.
            payer: credentials.accountId,
          }
        : null,
      agent: {
        action: outcome.action,
        downstreamPaymentReleased: outcome.downstreamPaymentReleased,
        lines: outcome.lines,
      },
      stages,
    });
  } catch (error) {
    // Never leak an internal message that might carry a key or a path.
    console.error("[agent] demo verify failed:", (error as Error).message);
    stages.push({ stage: "ERROR" });
    res.status(502).json({
      error: "SERVICE_UNAVAILABLE",
      message: "The reference agent could not complete the verification.",
      stages,
    });
  }
});

/** Refuse to start with public ingress, the same rule the analysis service follows. */
function assertLoopback(host: string): void {
  if (process.env.PROOFLINE_ALLOW_PUBLIC_BIND === "1") return;
  if (host === "127.0.0.1" || host === "::1" || host === "localhost") return;
  console.error(
    `Refusing to bind the reference agent to ${host}. It holds a funded private ` +
      `key and must not have public ingress (CLAUDE.md Sections 4 and 10). The ` +
      `gateway reaches it internally.`,
  );
  process.exit(1);
}

assertLoopback(AGENT_HOST);

app.listen(AGENT_PORT, AGENT_HOST, () => {
  console.log(`[agent] listening on ${AGENT_HOST}:${AGENT_PORT} (internal only)`);
  console.log(`[agent] account   ${credentials.accountId}`);
  console.log(`[agent] key from  ${credentials.keySource}`);
  console.log(`[agent] gateway   ${GATEWAY_PUBLIC_URL} (outbound, public URL)`);
  console.log(`[agent] samples   ${CORPUS_DIR}`);
});
