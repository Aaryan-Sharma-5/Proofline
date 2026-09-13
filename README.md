# Proofline

> **Agents pay for evidence before they pay with money.** Machine-payable document-integrity verification for autonomous AP and financial agents.

**ETHGlobal Online 2026 · Security · Hedera - AI & Agentic Payments**

**[Live Demo](https://proofline.duckdns.org)** · **[Verifier](https://proofline.duckdns.org/app)** · **[API Docs](https://proofline.duckdns.org/docs)**

```
                Invoice
                   │
          402 Payment Required
                   │
               0.02 HBAR
                   │
         Forensic verification
                   │
            CLEAR  /  REVIEW
                   │
        Agent PROCEED  /  HALT
```

---

## What is Proofline?

An autonomous accounts-payable agent reads an invoice and decides whether to proceed with paying it. Proofline is the specialist step it calls in between.

The agent submits a document and gets back `402 Payment Required`. It pays 0.02 HBAR over the x402 protocol, and receives a deterministic `CLEAR` or `REVIEW` decision backed by named evidence codes. It then proceeds with, or halts, its downstream payment action.

**Proofline is not an AP platform. Proofline is not the financial agent.** It is the verification service the agent calls before a consequential financial action - one question, answered with evidence, when asked.

The payment gate is structural, not decorative. Analysis runs only after payment has been verified, so the compute a caller buys is genuinely gated by the payment they made.

---

## Live Demo

**[proofline.duckdns.org/app](https://proofline.duckdns.org/app)** - no wallet, no extension, no signup.

A server-side reference agent holds the funded testnet account and pays on your behalf. The payment is still real and settles on Hedera testnet.

1. Open the [verifier](https://proofline.duckdns.org/app).
2. Click **Try CLEAR sample** - watch a clean invoice pass.
3. Click **Try REVIEW sample** - watch an anomaly halt the payment.
4. Follow the live timeline: 402 issued → payment authorized → analyzing → decision → settled.
5. Read the evidence codes and their plain-language meaning.
6. See the agent's action: proceeded, halted, or skipped as a duplicate.
7. Open the HashScan link to the real settlement on Hedera testnet.

Or upload your own PDF. [History](https://proofline.duckdns.org/history) shows the privacy-safe record of every verification.

---

## The Moment

A judge clicks **Try REVIEW sample**. On screen, in a single verification run:

```
RECEIVED           invoice submitted
PAYMENT_REQUIRED   402 — the resource refuses to work for free
PAYING             agent signs and sends 0.02 HBAR
ANALYZING          document enters the forensic pipeline
DECISION           REVIEW · BENEFICIARY_ACCOUNT_NEVER_SEEN
PAID               settled on Hedera — real transaction id
AGENT_ACTION       HALT · downstream payment action NOT authorized
```

The agent was about to proceed with the downstream payment action for this invoice. It bought a fact for two cents, learned that this vendor has been paid before but never to this account, and stopped.

**Software buying a fact, then changing its mind about money.**

---

## The Problem

An AP agent can now process an invoice end to end without a human ever seeing it. That removes the person who used to notice that the bank account changed.

The dangerous question is not "can the agent read the document?" Extraction handles that well. It is:

> Should the agent trust this document enough to continue a financial workflow?

A manipulated or mishandled document can cause an agent to approve the wrong amount, pay an account the vendor has never used, act twice on a reprocessed copy, or continue confidently when extraction actually failed. The last one is the quiet killer: a check that could not run must never look like a check that passed.

So the problem is narrower than "detect fraud with AI":

> How does an autonomous agent obtain a machine-readable, evidence-backed integrity check before taking a consequential financial action?

Proofline does not claim universal fraud detection. It reports specific, named, observable anomalies — and refuses to return a clean verdict when it could not actually look.

---

## Why Hedera + x402

x402 revives HTTP's unused `402 Payment Required` status code as a real protocol: a server answers an unpaid request with machine-readable payment terms; the client pays, retries, and receives the resource. Hedera settles it.

| Property | Implementation |
|---|---|
| Protocol | x402 v2, `exact` scheme |
| Network | Hedera testnet |
| Asset | Native HBAR |
| Verification price | 0.02 HBAR |
| Facilitator | Blocky402 |

What makes this load-bearing rather than ornamental: an agent that has never seen Proofline before can discover the price, pay it, and get an answer in a single HTTP exchange. No subscription, no API key provisioning, no human approving a bill.

A 0.02 HBAR charge is a sane unit of trade — a per-call price that would be absurd to invoice, collect, and reconcile through conventional billing. The primitive is not "pay with crypto"; it is that a specialist capability can be purchased programmatically, at the moment of need, by software with no prior commercial relationship to the seller.

Confirm the live gate yourself:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'content-type: application/pdf' --data-binary 'x' \
  https://proofline.duckdns.org/verify        # → 402
```

---

## How It Works

**01 · Submit.** The agent POSTs document bytes to `/verify` on the public gateway.

**02 · 402.** No payment header, so the gateway returns `402` with machine-readable terms. Nothing has been analyzed; nothing spent.

**03 · Pay.** The agent signs a Hedera transfer for the stated amount and retries the identical request carrying the payment payload. The facilitator verifies it.

**04 · Verify.** Only now do the bytes reach the internal analysis service. The document is written to a temp file, analyzed, and deleted unconditionally.

**05 · Decide.** Deterministic checks produce evidence; a fixed policy turns evidence into `CLEAR` or `REVIEW`.

**06 · Act.** `CLEAR` → the agent authorizes the downstream payment action. `REVIEW` → it halts that action and escalates, naming the evidence.

**Payment authorization gates access to analysis. Settlement is captured after successful verification.** That is why `PAID` appears on the timeline after `DECISION` — the facilitator verifies payment before analysis is allowed to run, but a real transaction id only exists once settlement completes. A failed analysis does not take the caller's money.

Neither verdict is a fraud finding. `CLEAR` means no material anomaly was detected by the configured checks. `REVIEW` means a human should look.

---

## Verification Engine

Deterministic Python. Same document, same answer, every time — reproducibility is directly checkable with `--repeat N`, which re-runs a document and asserts the serialized output is identical.

**No LLM participates in the decision.** No model call exists anywhere in the decision path. The engine is rules over extracted values, and those rules are the only thing that produces a verdict. A model may help *read* a difficult document — see [AI-assisted extraction](#ai-assisted-extraction) — but it never decides what the reading means.

### Named evidence, ranked

| Level | Evidence code | Meaning |
|---|---|---|
| **A** Semantic | `AMOUNT_MISMATCH` | Stated total ≠ sum of line items |
| **A** Semantic | `BENEFICIARY_ACCOUNT_NEVER_SEEN` | Known vendor, account never observed before |
| **B** Provenance | `PDF_ID_REVISION_MISMATCH` | Current revision differs from original identifier |
| **C** Corroborating | `IMAGE_COMPRESSION_INCONSISTENCY` | Lossily recompressed raster page |
| **Safeguard** | `EXTRACTION_INCOMPLETE` | A required field could not be read reliably |

The hierarchy is enforced in code, not left to convention. **Level A can escalate to `REVIEW` alone. Level B cannot. Level C never can, under any configuration.** A second tool touching a PDF after creation — signing, annotation, an email attachment pipeline — is common and benign; a rule that flags it alone trains an AP team to ignore `REVIEW` entirely. So provenance corroborates, it does not accuse.

### Fail-closed extraction

If a required field (vendor, invoice number, date, beneficiary account, stated total, line items) cannot be read reliably, the engine emits `EXTRACTION_INCOMPLETE` and returns `REVIEW`. The semantic checks that depend on those fields return nothing rather than a passing result. Documents with no text layer fall back to OCR.

Extraction is label-anchored: a value is accepted only where an explicit label introduces it. Common variants are supported — `Total Due` / `Total` / `Amount Due` / `Balance Due`, `Account Number` / `Account` / `IBAN` / `Remit To Account`, `Invoice Date` / `Date` / `Issue Date` — with dates normalized to ISO 8601 and amounts and currencies normalized safely. Both number conventions parse (`1,234.56` and `1.234,56`), decided structurally rather than by locale guessing. A label whose value is rendered on an adjacent line, as right-aligned layouts produce, is resolved within a small fixed window. What is deliberately absent is any "largest number on the page is probably the total" heuristic: a missing field escalates safely, whereas a silently wrong financial field would produce a confident decision about numbers nobody wrote.

Labels and month names are recognised in English only. Non-English invoices are handled by the fallback below rather than by growing a per-language rule table — that list is never finished, and every entry is another chance to mis-read a financial field.

### AI-assisted extraction

AI-assisted extraction is used only when deterministic extraction cannot recover required invoice fields. **The model does not determine the security verdict.** Recovered fields are validated and passed into the same deterministic forensic policy used for non-AI requests.

The boundary, precisely:

| | Deterministic engine | Extraction fallback |
|---|---|---|
| Reads fields from the document | yes | only those the engine could not read |
| Produces evidence codes | yes | never |
| Produces the policy score | yes | never |
| Produces `CLEAR` / `REVIEW` | yes | never |
| Can overwrite a field already read | — | never |

Its main practical use is **non-English invoices**: German, French, Spanish and other layouts that the English label patterns cannot read. The model identifies fields by meaning rather than by matching an English label, and returns them for validation.

Model output is treated as untrusted input from a third-party service. Every returned value is schema-checked, type-checked, range-checked and normalized through the same normalizers the deterministic path uses, so a recovered value cannot take a shape a directly-read value could not. Unrecognised keys are dropped, which is what makes an injected `decision`, `evidence_codes` or `policy_score` inert — the response schema has no such property and the validator discards it. Line items are never model-supplied, because `AMOUNT_MISMATCH` must compare a total the document states against items the document itemises, not two numbers from the same source.

For the same reason, `AMOUNT_MISMATCH` declines to run when the total came from the model and the line items did not: a gross total against net line items differs by exactly the tax, and reporting that as a discrepancy would describe how the document was read rather than anything about the document.

Every failure mode converges on the same result: not configured, disabled, timed out, HTTP error, malformed JSON, schema violation or implausible value all contribute nothing, leaving the document incomplete and escalating to `REVIEW`. A successful recovery can never authorize a downstream payment on its own; it only restores the inputs the deterministic checks need.

The feature is **off by default** and requires two switches (`LLM_EXTRACTION_ENABLED=1` and an `LLM_API_KEY`). With neither set — the default for a fresh clone — the deterministic path runs exactly as it always has. When the fallback does run, the UI says so plainly and the event timeline carries an `AI_EXTRACTION` stage; on a deterministic verification that stage never appears and is never synthesized.

Provider: Groq (`openai/gpt-oss-20b`), chosen for low latency and a free tier, using strict JSON-schema constrained decoding. Configurable via `LLM_MODEL` / `LLM_API_URL`.

### No confidence score

An internal policy score exists as a weight-sum mechanism. It is not a confidence value, not a probability, and not a fraud likelihood. It is excluded from the public API and absent from the frontend's type model entirely, so no component can render it by accident — enforced by an automated scan for `policy_score`, `confidence`, `probability`, and bare `N%` patterns on every test run and every browser capture.

---

## The Agent

Proofline ships a reference AP agent so the payment story has an actual consumer rather than a `curl` command standing in for one. It behaves exactly as a third-party integrator's agent would.

1. **Makes a real outbound HTTPS request** to the gateway's public `/verify` URL — the same network path any external developer's agent takes.
2. **Receives `402`**, parses the requirements, signs a Hedera transfer, and retries with the payment header.
3. **Asserts the challenge actually happened.** If the unpaid attempt returns anything other than `402`, the agent refuses to present the run as a paid verification and errors out. It will not let a broken gate masquerade as a successful one.
4. **Reads the verdict and acts.**

The decision logic **fails closed**. Only an explicit `CLEAR` authorizes the downstream payment action; `REVIEW`, an unknown evidence code, a missing decision field, an injected value, a null, or a transport failure all produce `HALT`. This is tested adversarially rather than assumed.

The agent also keeps an **idempotency ledger keyed on the document hash**. Re-verifying an already-authorized document returns `SKIP` — a genuine second verification occurs, but the downstream payment action is not authorized twice.

Proofline does not operate a supplier-payment rail, and the reference agent does not move supplier funds. The downstream action is simulated and marked as such in the agent's own output. What is real is the decision path: a verification result determines whether that action is authorized or halted, which is exactly the integration point a production AP system would wire to its own payment run.

That ledger is deliberately process-local and never written to Proofline's database. Whether a payment was executed is the AP system's system of record, not the verification service's; storing it here would misrepresent what Proofline knows.

The hosted judge flow uses this same agent. `/demo/verify` is a trigger, not a shortcut: it causes the agent to make a real paid call to the same public `/verify` a developer would hit. The agent's key is server-side only — never sent to a browser, never logged, never bundled into frontend assets.

---

## Architecture

```
                        Browser / external agent
                                   │  HTTPS
                    ┌──────────────▼───────────────┐
                    │  GATEWAY — sole public origin │
                    │  ├── x402 / Hedera gate       │
                    │  ├── SSE event stream         │
                    │  └── React bundle + API docs  │
                    └───┬───────────────────────┬───┘
                        │ internal              │ internal
         ┌──────────────▼─────────┐   ┌─────────▼──────────────┐
         │ Reference agent         │   │ Analysis service       │
         │ server-side key         │   │ FastAPI — no public    │
         │ pays real HBAR          │   │ ingress                │
         │ acts on verdict         │   │   └── forensic engine  │
         └──────────────┬──────────┘   └─────────┬──────────────┘
                        │ outbound to public /verify         │
                        └────────────────────────────────────┤
                                                   ┌─────────▼──────┐
                                                   │ SQLite volume  │
                                                   └────────────────┘
```

- **Gateway is the sole public origin.** The analysis service and the agent bind to loopback and refuse to start on a public interface.
- **The forensic engine knows nothing about x402.** No payment concept exists in the analysis service. The gateway passes the verdict through unchanged and never edits evidence.
- **Agent credentials are server-side only.** The browser never signs anything.
- **Raw documents are never persisted.** Temp file, analyze, unconditional delete.

The stored **verification record** holds the verification id, document hash, decision, evidence codes, timestamp, and service version — **no vendor name, no beneficiary account, no extracted fields**. The public history is private by omission rather than by filtering. All evidence is persisted, including sub-threshold signals on `CLEAR` results, because thresholds are a policy choice that may move.

Vendor/account history is a **separate store**, isolated to the verification engine: Proofline's own memory of previously observed vendor/account pairs, which is what `BENEFICIARY_ACCOUNT_NEVER_SEEN` is checked against. It is never joined into a verification record and never reaches the history API. No request-path code can write to it either: if `/verify` could whitelist an account, an attacker could make small legitimate-looking calls to get a fraudulent account trusted before the real attempt.

---

## Demo Scenarios

Reproduced directly from the engine, not described from memory:

| Scenario | Result | Evidence | Agent |
|---|---|---|---|
| Clean document | `CLEAR` | — | PROCEED |
| Altered amount | `REVIEW` | `AMOUNT_MISMATCH` | HALT |
| Changed beneficiary | `REVIEW` | `BENEFICIARY_ACCOUNT_NEVER_SEEN` | HALT |
| Reprocessed PDF | `CLEAR` | `PDF_ID_REVISION_MISMATCH` | PROCEED |
| Rasterized JPEG copy | `CLEAR` | `IMAGE_COMPRESSION_INCONSISTENCY` | PROCEED |
| Malformed input | `NO VERDICT` | `INVALID_DOCUMENT` | HALT |
| Repeat of a cleared document | `CLEAR` | — | SKIP (already authorized) |

Rows 4 and 5 are the interesting ones. Both carry **real evidence** that is persisted and displayed, and both correctly decide `CLEAR` — that is the Level B/C hierarchy working, not a check failing to fire.

Malformed input resolves to a clearly labelled `NO VERDICT` (explicitly not `ERROR`, since it implies nothing about the document), surfacing the real backend error class rather than a generic message. Stages the stream never reached render as "did not happen", not as still-pending.

---

## Security Model

| Property | How it holds |
|---|---|
| Payment before analysis | Handler runs only after facilitator verification; tested in both directions |
| No public analysis ingress | Loopback bind guard refuses to start on a public interface |
| Server-side credentials | Agent key never leaves the server; logs print the variable name, not the value |
| No raw document retention | Temp file deleted unconditionally after analysis |
| Fail-closed extraction | Missing fields force `REVIEW`; a skipped check never reads as a passing check |
| Fail-closed agent | Only an explicit `CLEAR` authorizes the downstream payment action; anything unrecognized halts |
| Upload validation | Type and size checked at both the gateway and the analysis service |
| Controlled errors | `INVALID_DOCUMENT`, `ANALYSIS_FAILED`, `SERVICE_UNAVAILABLE`, `RATE_LIMITED` — never stack traces |
| Rate limiting | The server-funded demo path is metered per IP and concurrently |
| Privacy-safe history | Allowlisted projection; verification records contain no vendor or beneficiary fields, and vendor/account history is isolated to the verification engine |

Proofline is not audited or fraud-proof. It reports evidence and escalates uncertainty.

---

## Auditability

Every verification produces a durable record:

| Field | Example |
|---|---|
| Verification ID | `vf_9e0e6bdeb1a7498583cecbd3` |
| Document hash | `sha256:…` — proves which bytes were verified, without retaining them |
| Decision | `REVIEW` |
| Evidence codes | `["BENEFICIARY_ACCOUNT_NEVER_SEEN"]` |
| Timestamp | ISO 8601 UTC |
| Service version | `0.1.0` |

Settlement is independently auditable on the Hedera mirror node via the HashScan link shown for each run — not merely echoed back by our own gateway.

**HCS is not implemented.** Publishing verification records to a Hedera Consensus Service topic is not built in this repository. The UI states this explicitly rather than showing an empty placeholder, and no example HCS record appears anywhere, because there is no real one to show.

---

## ETHGlobal Judging Criteria

| Criterion | Proofline |
|---|---|
| **Technicality** | A real x402/Hedera payment gate settling through Blocky402; a deterministic forensic engine with a ranked evidence hierarchy and fail-closed extraction; a consuming agent with fail-closed decisioning and hash-keyed idempotency; live SSE lifecycle streaming; and an ingress boundary the internal service refuses to violate. |
| **Originality** | Machine-payable document-integrity verification as an agent primitive — not a paywalled API, but a verification service an agent purchases at a decision point, where the payment gates the compute instead of billing it afterward. |
| **Practicality** | Deployed and usable now at a public HTTPS URL with real settlement on Hedera testnet, persistent history, rate limiting, and controlled error classes. A judge needs no wallet; a developer can point their own x402 client at `/verify` today. |
| **Usability** | The verifier exposes a clear sequence from document submission to decision, with evidence and agent action presented in the same hierarchy, and every evidence code carrying a plain-language reading. The timeline is driven by real server events, so what is shown is what actually happened. |
| **WOW Factor** | The agent hits `402`, autonomously pays 0.02 HBAR, receives `BENEFICIARY_ACCOUNT_NEVER_SEEN`, and halts the downstream payment action it was about to authorize — with a HashScan link to the settlement that bought the evidence. |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript 6, Vite 8, Tailwind 4 |
| Gateway | Node.js, Express 4.21, `@x402/core` + `@x402/hedera` 2.25.0 |
| Analysis | Python 3.14, FastAPI, PyMuPDF, pikepdf, Pillow, NumPy, Tesseract (OCR) |
| Persistence | SQLite on a mounted volume |
| Deployment | Docker Compose behind Caddy (automatic HTTPS) |
| Testing | pytest, Playwright capture suite |

---

## API Surface

Public endpoints, served by the gateway. The schema at [`/openapi.json`](https://proofline.duckdns.org/openapi.json) is authored separately in the gateway as an allowlist — not a filtered copy of the internal schema — so the internal `/analyze` route has no public presence at all.

| Method | Path | Description |
|---|---|---|
| `POST` | `/verify` | **x402 protected.** Developer path. Unpaid → `402`. Pay and retry for the verdict. 0.02 HBAR |
| `POST` | `/demo/verify` | Hosted judge path. Triggers the reference agent, which makes its own real paid call to `/verify` |
| `GET` | `/ping` | **x402 protected.** Minimal paid resource for testing the handshake. 0.01 HBAR |
| `GET` | `/verification` | Privacy-safe history list |
| `GET` | `/verification/{id}` | Masked detail for one verification |
| `GET` | `/verification/{id}/events` | SSE lifecycle stream |
| `GET` | `/verification/{id}/status` | Current status snapshot |
| `GET` | `/health` | Liveness and configuration |
| `GET` | `/docs`, `/openapi.json` | API documentation |

---

## Deployment

Live at **[https://proofline.duckdns.org](https://proofline.duckdns.org)**.

```
Internet :443 → Caddy (TLS) → gateway ─┬→ analysis  (internal, no ingress)
                                        └→ agent     (internal, no ingress)
                                              └→ SQLite on a named volume
```

Only the gateway is routable. `GATEWAY_PUBLIC_URL` is set to the real external origin, so the reference agent's outbound call genuinely traverses the same public path a third-party agent would. Secrets are injected as environment variables and never baked into images. Health: [`/health`](https://proofline.duckdns.org/health).

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full deployment guide.

---

## Testing

```bash
pytest        # 160 passed, 6 skipped
```

The 6 skips are live-payment tests, skipped by default with an explicit reason; they perform real Hedera testnet payments and run with `PROOFLINE_LIVE=1` against a running stack. The payment portion is not faked to make them pass without credentials.

Coverage spans each forensic signal, extraction completeness, beneficiary history, policy evaluation, deterministic repeatability, agent fail-safe behaviour, history privacy, and the payment gate in both directions — unpaid attempts must produce zero new records, *and* a paid control must move the counter by exactly one.

| Gate | Command |
|---|---|
| Backend suite | `pytest` |
| Frontend types, lint, build | `cd frontend && npm run typecheck && npm run lint && npm run build` |
| Gateway types | `cd x402-gate && npm run typecheck` |
| Browser capture suite | `cd x402-gate && GATEWAY_URL=http://127.0.0.1:4021/app npx tsx src/capture.ts` |
| Accessibility probe | `cd x402-gate && npx tsx src/a11y-probe.ts` |

The capture suite is the regression oracle for the primary screen: it drives four paths — CLEAR sample, REVIEW sample, valid upload, malformed upload — against the built production bundle with **real Hedera testnet payments**, asserting on element ids and timeline state markers, and scanning rendered output for score/confidence leakage. The accessibility probe reports heading order, visible focus on every tab stop, and reduced-motion behaviour. Responsive layout is validated at mobile and desktop viewports.

---

## Local Development

### Prerequisites

- Node.js 20+, Python 3.12+
- **Tesseract OCR** on `PATH` — `pytesseract` shells out to it; pip alone does not provide it
- Two funded [Hedera testnet](https://portal.hedera.com/) accounts — payer and payee must be distinct

### Setup

```bash
git clone https://github.com/Aaryan-Sharma-5/Proofline.git && cd Proofline
cp .env.example .env          # then fill it in

python -m venv .venv && .venv/Scripts/activate      # Windows
pip install -r backend/requirements.txt
python backend/make_test_docs.py                     # generate the corpus
python backend/seed_db.py                            # seed vendor history

cd x402-gate && npm install && cd ..
cd frontend  && npm install && npm run build && cd ..
```

### Secrets

`.env` is gitignored; `.env.example` carries placeholders only. Never commit real values.

| Variable | Notes |
|---|---|
| `HEDERA_PAY_TO_ACCOUNT_ID` | Account that receives payment |
| `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` | Developer-path client. **Server-side only** |
| `AGENT_ACCOUNT_ID` / `AGENT_PRIVATE_KEY` | Reference agent. **Server-side only, never in a browser** |
| `FACILITATOR_URL` | Blocky402 for bounty validation; `x402.org/facilitator` for local dev |
| `GATEWAY_PUBLIC_URL` | Must be the real external origin in production |
| `PRICE_VERIFY`, `DATABASE_URL`, `MAX_UPLOAD_BYTES`, `DEMO_*` | Optional; see `.env.example` |

### Run

```bash
python backend/app.py               # analysis  127.0.0.1:8099
cd x402-gate && npm run agent       # agent     127.0.0.1:4022
cd x402-gate && npm start           # gateway   127.0.0.1:4021  ← only public origin
```

Open `http://127.0.0.1:4021/app`. Forgetting the agent process is the most common local mistake and produces `SERVICE_UNAVAILABLE` on the judge buttons. Or run the whole stack with `docker compose up --build`.

---

## Current Limitations

- **Testnet only.** Real payments, test HBAR.
- **HCS audit trail is not implemented.**
- **`payment_tx_id` is not persisted.** The analysis service never sees settlement data. The live transaction is shown during a run and on HashScan; the stored column is empty, and history shows an em dash rather than inventing a link.
- **The checks are specific rules, not universal fraud detection.** A manipulation none of them touch produces `CLEAR`, which means "no material anomaly detected by the configured checks" and nothing stronger.
- **Vendor history is Proofline's own memory**, seeded out-of-band — not an external or ledger-wide risk source. Promotion is manual by design.
- **The agent's idempotency ledger is process-local** and does not survive a restart. That state belongs in the consuming AP system's durable store.
- **Single gateway instance.** SSE streams live in gateway memory; multiple instances would need a shared bus.
- **History filtering is client-side** over the returned window.
- **Extraction is tuned to supported invoice layouts.** Coverage is broader than the bundled corpus — common label variants, date formats and split label/value layouts are handled — but arbitrary real-world invoices will still hit `EXTRACTION_INCOMPLETE` more often than a production extractor would. That is the conservative failure, but it is still a failure. The AI-assisted fallback widens coverage when enabled; it does not make coverage complete.
- **The AI extraction fallback is not deterministic** and is not claimed to be. Only the deterministic path carries the same-document-same-answer guarantee, which is why the fallback cannot reach the decision, cannot overwrite a directly-read field, and is off by default. A document recovered by the model is judged by the same deterministic policy, but the recovery step itself may vary between runs.
- **The fallback has not been exercised against a live provider in this repository.** Its behaviour is covered by tests against a stubbed provider, including every failure and injection path; validating the real network call requires supplying an `LLM_API_KEY`.

---

## Repository

```
frontend/            React + Vite + TypeScript + Tailwind
  src/pages/         Landing (/), Home (/app — the verifier), History (/history)
  src/hooks/         useVerification, useVerificationEvents (SSE)

x402-gate/           Express gateway — the sole public origin
  src/server.ts              routes, static hosting, error handling
  src/x402-middleware.ts     402 / verify / settle
  src/reference-agent.ts     hosted judge agent; holds the funded key
  src/agent-action.ts        fail-closed decisioning, idempotency ledger
  src/events.ts              SSE bus
  src/capture.ts             browser regression oracle

backend/             Python analysis service — internal only
  app.py                     FastAPI, loopback bind guard
  proofline_engine.py        forensic engine, evidence hierarchy, policy
  db.py                      SQLite persistence
  make_test_docs.py          validation corpus generator

tests/               pytest — forensics, agent fail-safe, privacy, payment gate
```

[CLAUDE.md](CLAUDE.md) is the engineering contract: architecture constraints, product principles, and the phase-by-phase verification record behind every claim here.

---

## License

MIT — see [LICENSE](LICENSE).

## AI-Assisted Development

Built with AI assistance (Claude) for architecture and implementation, disclosed as required by ETHGlobal rules. All generated code was reviewed, executed, and validated against the constraints in [CLAUDE.md](CLAUDE.md). AI tooling is development-time only — nothing in the deployed runtime calls out to a coding assistant, and no LLM participates in a forensic decision.
