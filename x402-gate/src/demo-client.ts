import "./env.js";

const GATEWAY = process.env.GATEWAY_URL?.trim() ?? "http://127.0.0.1:4021";
const sample = process.argv[2] ?? "01_baseline_clean.pdf";

console.log(`gateway : ${GATEWAY}`);
console.log(`sample  : ${sample}`);
console.log("(this process holds no key and signs nothing)\n");

const started = Date.now();
const response = await fetch(`${GATEWAY}/demo/verify`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ sample }),
});

const body = (await response.json()) as Record<string, any>;
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(`HTTP ${response.status}  (${elapsed}s)\n`);

if (!response.ok) {
  console.log(JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log("stages");
for (const stage of body.stages ?? []) {
  console.log(`  ${stage.stage}${stage.detail ? `  ${stage.detail}` : ""}`);
}

const verification = body.verification ?? {};
console.log("\nverification");
console.log(`  verification_id  ${verification.verification_id ?? "(not persisted)"}`);
console.log(`  document_hash    ${verification.document_hash}`);
console.log(`  decision         ${verification.decision}`);
console.log(`  evidence_codes   ${JSON.stringify(verification.evidence_codes ?? [])}`);
console.log(`  policy_score     ${verification.policy_score}`);

if (body.payment) {
  console.log("\npayment");
  console.log(`  payer            ${body.payment.payer}`);
  console.log(`  transaction      ${body.payment.transaction}`);
  console.log(`  hashscan         ${body.payment.hashscan}`);
} else {
  console.log("\npayment           (none reported)");
}

console.log("\nagent action");
console.log(`  ${body.agent?.action}`);
for (const line of body.agent?.lines ?? []) console.log(`    ${line}`);

// The judge's browser must never receive key material
const serialized = JSON.stringify(body);
const leaked = [
  process.env.AGENT_PRIVATE_KEY,
  process.env.HEDERA_PRIVATE_KEY,
  process.env.HEX_ENCODED_PRIVATE_KEY,
]
  .filter((v): v is string => Boolean(v && v.length > 8 && !v.endsWith("...")))
  .some((secret) => serialized.includes(secret));

console.log(
  `\nresponse contains private key material: ${leaked ? "YES, THIS IS A BUG" : "no"}`,
);
if (leaked) process.exit(1);
