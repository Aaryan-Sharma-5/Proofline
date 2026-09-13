/**
 * Pre-flight check for local capture/demo runs.
 *
 * Each check here corresponds to a misconfiguration that has actually produced
 * a false diagnosis in this project (CLAUDE.md Section 18):
 *
 *   1. GATEWAY_PUBLIC_URL pointing at production while testing locally, so the
 *      reference agent pays a different gateway and the local SSE stream never
 *      receives the early stages. Looks exactly like a broken frontend.
 *   2. A stale container still holding port 4021, so a rebuilt bundle is never
 *      actually served and code changes appear to do nothing.
 *   3. The reference agent not running, which surfaces only as
 *      SERVICE_UNAVAILABLE on /demo/verify.
 *
 * Exits non-zero if anything looks wrong, so it can gate a capture run.
 */

import "./env.js";

const GATEWAY = process.env.GATEWAY_URL?.trim() ?? "http://127.0.0.1:4021";
const EXPECTED_ENV = (process.env.PROOFLINE_ENV?.trim() ?? "local").toLowerCase();

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fatal: boolean;
}

const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string, fatal = true): void {
  checks.push({ name, ok, detail, fatal });
}

async function probe(url: string, timeoutMs = 6000): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const isLoopback = (value: string): boolean =>
  /^https?:\/\/(127\.0\.0\.1|localhost|\[?::1\]?)(:\d+)?/i.test(value);

// 1. Which gateway will the reference agent actually call?
const publicUrl = process.env.GATEWAY_PUBLIC_URL?.trim() ?? "";
if (!publicUrl) {
  record("GATEWAY_PUBLIC_URL", false, "not set");
} else if (EXPECTED_ENV === "local") {
  record(
    "GATEWAY_PUBLIC_URL",
    isLoopback(publicUrl),
    isLoopback(publicUrl)
      ? publicUrl
      : `${publicUrl} — a local run would pay and stream against THIS origin, ` +
        `not the local gateway. Set it to the local gateway, or set ` +
        `PROOFLINE_ENV=production if that is genuinely intended.`,
  );
} else {
  record(
    "GATEWAY_PUBLIC_URL",
    !isLoopback(publicUrl),
    isLoopback(publicUrl)
      ? `${publicUrl} — loopback is invalid for a production run.`
      : publicUrl,
  );
}

// 2. Is the gateway answering, and is it the build we expect to be serving?
const health = await probe(`${GATEWAY.replace(/\/app\/?$/, "")}/health`);
if (!health?.ok) {
  record("gateway /health", false, `no healthy response from ${GATEWAY}`);
} else {
  const body = (await health.json().catch(() => null)) as {
    facilitator?: string;
    network?: string;
  } | null;
  record(
    "gateway /health",
    true,
    `${body?.network ?? "?"} via ${body?.facilitator ?? "?"}`,
  );
}

// 3. The reference agent is a separate process and is easy to forget.
const agentUrl = process.env.AGENT_SERVICE_URL?.trim() ?? "http://127.0.0.1:4022";
const agent = await probe(`${agentUrl}/health`);
record(
  "reference agent",
  Boolean(agent?.ok),
  agent?.ok ? agentUrl : `${agentUrl} unreachable — /demo/verify will fail`,
);

// 4. The analysis service, behind the gateway.
const analysisUrl =
  process.env.ANALYSIS_SERVICE_URL?.trim() ?? "http://127.0.0.1:8099";
const analysis = await probe(`${analysisUrl}/health`);
record(
  "analysis service",
  Boolean(analysis?.ok),
  analysis?.ok ? analysisUrl : `${analysisUrl} unreachable`,
);

// Report.
console.log(`\npre-flight (${EXPECTED_ENV})\n`);
let failed = 0;
for (const check of checks) {
  if (!check.ok && check.fatal) failed += 1;
  console.log(
    `  ${check.ok ? "ok  " : "FAIL"}  ${check.name.padEnd(20)}  ${check.detail}`,
  );
}

if (failed > 0) {
  console.log(`\n${failed} check(s) failed. Fix before running a capture.\n`);
  process.exit(1);
}
console.log("\nall checks passed\n");
