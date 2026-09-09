import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import "./env.js";
import { decideAndAct, ReleaseLedger } from "./agent-action.js";
import { resolveCredentials, type Credentials } from "./credentials.js";
import { buildPayingClient, fetchWithPayment, hashscanUrl } from "./pay.js";

const GATEWAY = process.env.GATEWAY_URL?.trim() ?? "http://127.0.0.1:4021";
const NETWORK = process.env.X402_NETWORK?.trim() ?? "hedera:testnet";
const CORPUS_DIR =
  process.env.CORPUS_DIR?.trim() ?? join("..", "backend", "test_docs");

let credentials: Credentials;
try {
  credentials = resolveCredentials();
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}

const paying = buildPayingClient(
  credentials.accountId,
  credentials.privateKey,
  NETWORK,
);

const documents = readdirSync(CORPUS_DIR)
  .filter((name) => name.endsWith(".pdf"))
  .sort();

if (documents.length === 0) {
  console.error(
    `No PDFs in ${CORPUS_DIR}. Generate them with: python backend/make_test_docs.py`,
  );
  process.exit(2);
}

console.log(`facilitator : ${process.env.FACILITATOR_URL ?? "(gateway default)"}`);
console.log(`gateway     : ${GATEWAY}`);
console.log(`documents   : ${documents.length}\n`);

// One ledger for the whole run, so a repeat of the same document is recognised across iterations.
const ledger = new ReleaseLedger();

let failures = 0;
let skipped = 0;
let proceeded = 0;
let halted = 0;

for (const name of documents) {
  const bytes = readFileSync(join(CORPUS_DIR, name));
  console.log("=".repeat(72));
  console.log(name);

  let result;
  try {
    result = await fetchWithPayment(paying, `${GATEWAY}/verify`, {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: bytes,
    });
  } catch (error) {
    // A payment or transport failure is not a verdict. The agent has no evidence either way, so it must not release the downstream payment.
    console.log(`  FAILED              ${(error as Error).message}`);
    console.log("  agent action        HALT");
    console.log(
      "    Payment halted, escalating for human review.",
    );
    console.log(
      "      -> escalating: no verdict was obtained, the verification did not complete",
    );
    failures += 1;
    halted += 1;
    continue;
  }

  console.log(`  unpaid attempt      HTTP ${result.unpaidStatus}`);
  if (result.unpaidStatus !== 402) {
    console.log("  UNPAID REQUEST NOT REJECTED, payment is bypassable");
    failures += 1;
  }

  console.log(`  paid attempt        HTTP ${result.paidStatus}`);
  if (result.transaction) {
    console.log(`  transaction         ${result.transaction}`);
    console.log(`  hashscan            ${hashscanUrl(result.transaction, NETWORK)}`);
  }

  const body = (result.body ?? {}) as Record<string, unknown>;
  console.log(`  decision            ${body.decision}`);
  console.log(`  evidence            ${JSON.stringify(body.evidence_codes ?? [])}`);
  console.log(`  policy score        ${body.policy_score}`);
  console.log(`  verification id     ${body.verification_id ?? "(not persisted)"}`);

  // The verdict now drives what happens next.
  const outcome = decideAndAct(body, name, ledger);
  console.log(`  agent action        ${outcome.action}`);
  for (const line of outcome.lines) {
    console.log(`    ${line}`);
  }
  if (outcome.downstreamPaymentReleased) proceeded += 1;
  else if (outcome.action === "SKIP") skipped += 1;
  else halted += 1;

  console.log();
}

const repeatTarget = documents.find((name) => name.startsWith("01_"));
if (repeatTarget) {
  console.log("=".repeat(72));
  console.log(`${repeatTarget}  [second verification of the same document]`);

  const bytes = readFileSync(join(CORPUS_DIR, repeatTarget));
  try {
    const again = await fetchWithPayment(paying, `${GATEWAY}/verify`, {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: bytes,
    });

    const body = (again.body ?? {}) as Record<string, unknown>;
    console.log(`  paid attempt        HTTP ${again.paidStatus}`);
    if (again.transaction) {
      console.log(`  transaction         ${again.transaction}`);
    }
    console.log(`  decision            ${body.decision}`);
    console.log(`  verification id     ${body.verification_id ?? "(not persisted)"}`);
    console.log(
      "  (a new verification row is expected: the service really was used again)",
    );

    const outcome = decideAndAct(body, repeatTarget, ledger);
    console.log(`  agent action        ${outcome.action}`);
    for (const line of outcome.lines) console.log(`    ${line}`);

    if (outcome.downstreamPaymentReleased) {
      console.log("  DUPLICATE RELEASE, the idempotency key did not hold");
      failures += 1;
    } else {
      skipped += 1;
    }
  } catch (error) {
    console.log(`  FAILED              ${(error as Error).message}`);
    failures += 1;
  }
  console.log();
}

console.log("=".repeat(72));
console.log(
  `agent released ${proceeded} downstream payment(s), halted ${halted}, ` +
    `skipped ${skipped} duplicate(s).`,
);
if (failures > 0) {
  console.log(`${failures} failure(s).`);
  process.exit(1);
}
console.log(
  "All documents completed the unpaid-rejected -> paid -> verdict -> action path.",
);
