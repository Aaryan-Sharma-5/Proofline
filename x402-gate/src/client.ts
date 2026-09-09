import { readFileSync } from "node:fs";

import "./env.js";
import { resolveCredentials, resolvePayTo, type Credentials } from "./credentials.js";
import { buildPayingClient, fetchWithPayment, hashscanUrl } from "./pay.js";
import type { InspectedHederaTransaction } from "@x402/hedera";

const GATEWAY = process.env.GATEWAY_URL?.trim() ?? "http://127.0.0.1:4021";
const NETWORK = process.env.X402_NETWORK?.trim() ?? "hedera:testnet";

let credentials: Credentials;
try {
  credentials = resolveCredentials();
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}

const [command, filePath] = process.argv.slice(2);
const paying = buildPayingClient(
  credentials.accountId,
  credentials.privateKey,
  NETWORK,
);

console.log(`facilitator : ${process.env.FACILITATOR_URL ?? "(gateway default)"}`);
console.log(`gateway     : ${GATEWAY}`);
console.log(`payer       : ${credentials.accountId} (key from ${credentials.keySource})`);
console.log(`payee       : ${resolvePayTo() ?? "(unset)"}\n`);

if (command === "ping") {
  const result = await fetchWithPayment(paying, `${GATEWAY}/ping`);
  report(result);
} else if (command === "verify") {
  if (!filePath) {
    console.error("usage: tsx src/client.ts verify <path-to-pdf>");
    process.exit(2);
  }
  const result = await fetchWithPayment(paying, `${GATEWAY}/verify`, {
    method: "POST",
    headers: { "content-type": "application/pdf" },
    body: readFileSync(filePath),
  });
  report(result);
} else {
  console.error("usage: tsx src/client.ts <ping|verify> [file]");
  process.exit(2);
}

function report(result: {
  unpaidStatus: number;
  challenge: unknown;
  paidStatus: number;
  body: unknown;
  transaction?: string;
  signedTransfer?: InspectedHederaTransaction;
}) {
  console.log(`--- unpaid attempt: HTTP ${result.unpaidStatus} ---`);
  console.log(JSON.stringify(result.challenge, null, 2));
  console.log(`\n--- paid attempt: HTTP ${result.paidStatus} ---`);
  console.log(JSON.stringify(result.body, null, 2));
  if (result.transaction) {
    console.log(`\ntransaction : ${result.transaction}`);
    console.log(`hashscan    : ${hashscanUrl(result.transaction, NETWORK)}`);
  }
}
