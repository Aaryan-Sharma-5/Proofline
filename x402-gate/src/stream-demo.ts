import { readFileSync } from "node:fs";
import { join } from "node:path";

import "./env.js";
import { resolveCredentials } from "./credentials.js";
import { newCorrelationId } from "./events.js";
import { buildPayingClient, fetchWithPayment } from "./pay.js";

const GATEWAY = process.env.GATEWAY_URL?.trim() ?? "http://127.0.0.1:4021";
const NETWORK = process.env.X402_NETWORK?.trim() ?? "hedera:testnet";
const CORPUS_DIR =
  process.env.CORPUS_DIR?.trim() ?? join("..", "backend", "test_docs");

const args = process.argv.slice(2);
const sample = args.find((a) => !a.startsWith("--")) ?? "03_changed_beneficiary.pdf";
const mode = args.includes("--developer") ? "developer" : "demo";

const streamId = newCorrelationId();
const started = Date.now();
const stamp = () => `+${((Date.now() - started) / 1000).toFixed(3)}s`;

console.log(`gateway   : ${GATEWAY}`);
console.log(`sample    : ${sample}`);
console.log(`mode      : ${mode}`);
console.log(`stream id : ${streamId}\n`);

// ---------------------------------------------------------------------------
// 1. Subscribe first.
// ---------------------------------------------------------------------------

const response = await fetch(`${GATEWAY}/verification/${streamId}/events`, {
  headers: { accept: "text/event-stream" },
});

console.log(`${stamp()}  SUBSCRIBED  HTTP ${response.status}`);
console.log(
  `${stamp()}  headers     content-type=${response.headers.get("content-type")} ` +
    `cache-control=${response.headers.get("cache-control")} ` +
    `x-accel-buffering=${response.headers.get("x-accel-buffering")} ` +
    `content-length=${response.headers.get("content-length") ?? "absent"} ` +
    `content-encoding=${response.headers.get("content-encoding") ?? "none"}`,
);

if (!response.body) {
  console.error("no response body");
  process.exit(1);
}

const arrivals: { at: number; event: string }[] = [];
let chunkCount = 0;

const readerDone = (async () => {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    chunkCount += 1;
    buffer += decoder.decode(value, { stream: true });

    let split: number;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);

      let eventName = "message";
      let data = "";
      let comment = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith(":")) comment = line.slice(1).trim();
        else if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }

      if (comment && !data) {
        console.log(`${stamp()}  ·           ${comment}`);
        continue;
      }
      if (!data) continue;

      let parsed: Record<string, any> = {};
      try {
        parsed = JSON.parse(data);
      } catch {
        /* raw */
      }

      arrivals.push({ at: Date.now() - started, event: eventName });
      const detail = parsed.detail ? JSON.stringify(parsed.detail) : "";
      console.log(`${stamp()}  ${eventName.padEnd(16)}${detail}`.trimEnd());

      if (eventName === "done") return;
    }
  }
})();

// Give the subscription a moment to be fully established before triggering.
await new Promise((r) => setTimeout(r, 250));

// ---------------------------------------------------------------------------
// 2. Trigger the real verification.
// ---------------------------------------------------------------------------

console.log(`${stamp()}  --- triggering ${mode} run ---`);

const runner = (async () => {
  if (mode === "demo") {
    const res = await fetch(`${GATEWAY}/demo/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sample, stream_id: streamId }),
    });
    const body = (await res.json()) as Record<string, any>;
    return { status: res.status, body };
  }

  const credentials = resolveCredentials();
  const paying = buildPayingClient(
    credentials.accountId,
    credentials.privateKey,
    NETWORK,
  );
  const result = await fetchWithPayment(paying, `${GATEWAY}/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/pdf",
      "x-proofline-stream": streamId,
    },
    body: new Uint8Array(readFileSync(join(CORPUS_DIR, sample))),
  });
  return { status: result.paidStatus, body: result.body as Record<string, any> };
})();

const outcome = await runner;
console.log(`${stamp()}  --- run returned HTTP ${outcome.status} ---`);

// Let any trailing events land.
await Promise.race([readerDone, new Promise((r) => setTimeout(r, 5000))]);

// ---------------------------------------------------------------------------
// 3. Verdict on incremental delivery.
// ---------------------------------------------------------------------------

console.log("");
const verification = outcome.body?.verification ?? outcome.body ?? {};
console.log(`decision        ${verification.decision}`);
console.log(`evidence_codes  ${JSON.stringify(verification.evidence_codes ?? [])}`);
console.log(`verification_id ${verification.verification_id ?? "(none)"}`);

const statusRes = await fetch(`${GATEWAY}/verification/${streamId}/status`);
console.log(`status object   ${JSON.stringify(await statusRes.json())}`);

console.log("");
if (arrivals.length > 1) {
  const first = arrivals[0]!;
  const last = arrivals[arrivals.length - 1]!;
  const spread = (last.at - first.at) / 1000;
  console.log(
    `events: ${arrivals.length}, network chunks: ${chunkCount}, ` +
      `first ${first.event} at +${(first.at / 1000).toFixed(3)}s, ` +
      `last ${last.event} at +${(last.at / 1000).toFixed(3)}s, spread ${spread.toFixed(3)}s`,
  );

  // Distinct arrival times are the actual proof. If the gateway buffered, every
  // event would carry the same offset regardless of when it was emitted.
  const distinct = new Set(arrivals.map((a) => Math.round(a.at / 100))).size;
  if (spread > 0.5 && distinct > 2) {
    console.log(
      `VERDICT: incremental delivery confirmed (${distinct} distinct arrival ` +
        `windows across ${spread.toFixed(2)}s).`,
    );
  } else {
    console.log(
      "VERDICT: BUFFERED OR TOO FAST TO TELL. Events did not arrive spread " +
        "across the run.",
    );
    process.exitCode = 1;
  }
} else {
  console.log("VERDICT: no events observed.");
  process.exitCode = 1;
}
