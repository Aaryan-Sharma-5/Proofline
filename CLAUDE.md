## Proofline

Authoritative engineering context for Claude Code. This is the single document needed to understand the current product, architecture, infrastructure, technology, security model, API boundaries, testing model, and development rules.

**Document roles.** `CLAUDE.md` is the engineering contract and current system context. `README.md` is the public product and developer documentation. `DEPLOYMENT.md` is an operational runbook (procedural commands), not a second architecture contract. When these disagree, CLAUDE.md wins on architecture.

**When documentation and implementation disagree, the implementation wins.** Verify against source before acting on any statement here.

State vocabulary used throughout, kept strictly distinct:

- **Required** — a design rule that must hold.
- **Current / verified** — true now, confirmed against the repository or a live probe.
- **Not implemented** — deliberately absent.

**Normativity rule.** Sections describing architecture and contracts are normative unless marked otherwise. Current implementation facts appear only in sections explicitly marked current/verified (§22), or where the repository itself is the source of truth — pinned versions (§6), the schema (§13), the route list (§15), and environment variables (§18). A statement in a normative section describes what must hold, not merely what happens to be true today.

---

## 1. Mission

**Agents pay for evidence before they pay with money.**

Proofline is machine-payable document-integrity verification for autonomous AP and financial agents.

```
Agent → x402 payment (HBAR) → deterministic verification → named evidence → CLEAR / REVIEW → downstream payment action authorized or halted
```

Proofline does not operate a supplier-payment rail. The reference agent's downstream action is **simulated** and marked as such in its own output. What is real is the decision path: a verification result determines whether that action is authorized or halted.

---

## 2. Product Model

An AP agent processes an invoice without human review. That removes the person who would have noticed the bank account changed. Proofline is the specialist step the agent calls before a consequential financial action.

**Proofline is:** specialist verification infrastructure; machine-payable; evidence-backed; deterministic in decisioning.

**Proofline is not:** an ERP; an AP platform; a universal fraud detector; a financial institution; a downstream supplier-payment rail; an autonomous financial decision-maker.

### Decision semantics

| Verdict | Meaning |
|---|---|
| `CLEAR` | No material anomaly detected by the configured checks. Not a claim of authenticity. |
| `REVIEW` | Escalate for human attention. Not a finding of fraud. |

Neither verdict is proof of fraud or authenticity. Required language: describe observable evidence — alteration, inconsistency, provenance anomaly, extraction uncertainty, beneficiary-history mismatch. Never `AI-generated`, `fraud detected`, `authentic`, or `fake`.

---

## 3. Core Invariants

The most important section. These are enforceable rules, not preferences.

### Decision invariants

1. The verdict is deterministic. Same document, same answer.
2. **No LLM participates in the forensic decision path.** An LLM may explain a decision after it is produced, and may help *read* a document before one exists (§10a); it may never produce or influence one. The boundary is extraction, and it is enforced structurally: the fallback's response schema has no property that could carry a decision, an evidence code or a score, and the validator drops every key it does not recognise.
3. No confidence/probability dashboard. The internal policy score is implementation machinery, never surfaced as confidence, probability, or fraud likelihood.
4. Every `REVIEW` carries named evidence codes.
5. Extraction failure can never become `CLEAR`. Missing or unreliable required fields produce `EXTRACTION_INCOMPLETE` and force `REVIEW`.
6. Corroborating image/compression evidence can never trigger `REVIEW` alone, under any configuration.
7. Structural/provenance evidence cannot trigger `REVIEW` alone either. It requires at least one other signal.

### Payment invariants

8. `/verify` is x402 protected.
9. Payment **authorization** occurs before expensive analysis runs.
10. Payment **settlement** is captured after successful verification. A failed analysis must not take the caller's money.
11. x402 is load-bearing, not decorative. `/demo/verify` must remain orchestration over a real `/verify` call, never a bypass.

### Security invariants

12. The gateway is the only public origin.
13. The FastAPI analysis service must never have public ingress.
14. Reference-agent credentials remain server-side. Never in a browser, a log, or a frontend bundle.
15. Raw documents are transient: analyzed, then deleted. Never persisted.
16. Controlled error classes only. No stack traces or filesystem paths to callers.

### Product integrity invariants

17. Never fabricate transaction ids, HCS records, agent state, payment state, or evidence.
18. Unavailable information must be represented as unavailable — never as a placeholder, a plausible-looking value, or a stage still "pending" once its stream has ended.
19. Curated public samples are acceptable; the real analysis path must execute for every one. Never hardcode a sample filename to a verdict.

---

## 4. System Architecture

```
                          INTERNET  (PUBLIC)
                               │
                               ▼
                    ┌──────────────────────┐
                    │  Caddy — TLS         │   PUBLIC
                    │  Let's Encrypt       │
                    └──────────┬───────────┘
                               │ 127.0.0.1:4021
                    ┌──────────▼────────────────────────┐
                    │  GATEWAY  (sole public origin)    │   PUBLIC
                    │  Express + TypeScript             │
                    │   ├── React static bundle         │
                    │   ├── public API + OpenAPI        │
                    │   ├── x402 payment gate           │
                    │   └── SSE event bus (in-memory)   │
                    └───┬────────────────────────┬──────┘
                        │ loopback               │ internal network
          ┌─────────────▼──────────┐   ┌─────────▼────────────────┐
          │  REFERENCE AGENT :4022 │   │  ANALYSIS :8099          │
          │  SERVER-SIDE ONLY      │   │  INTERNAL ONLY           │
          │  holds funded key      │   │  FastAPI                 │
          │  pays real HBAR        │   │   └── forensic engine    │
          │  simulates downstream  │   │        (no x402 concept) │
          └─────────────┬──────────┘   └─────────┬────────────────┘
                        │                        │
                        │ outbound HTTPS to      ▼
                        │ GATEWAY_PUBLIC_URL  ┌──────────────────┐
                        └─────/verify────────▶│ SQLite /data     │
                                              │ persistent volume│
                                              └──────────────────┘
```

**Public ingress rule (required).** The gateway is the sole public backend origin, so no caller can bypass payment by reaching `/analyze` directly.

**The reference agent calls the gateway's public URL outbound**, not an internal shortcut. That is what makes the hosted judge flow exercise the same path an external developer's agent would.

---

## 5. Service Boundaries

### Frontend

**Owns:** UI, upload UX, verification state presentation, SSE consumption, history, evidence presentation, agent-action presentation, payment/audit links.

**Does not:** compute verdicts, hold credentials, decide payment, implement forensic thresholds, fabricate any state.

### Gateway (`x402-gate/`)

**Owns:** public ingress, 402 payment requirements, payment verification, settlement, protected routing, SSE transport, static frontend hosting, the public OpenAPI schema.

**Does not:** parse or modify forensic evidence, decide `CLEAR`/`REVIEW`, expose secrets. It passes the verdict through unchanged.

### Analysis service (`backend/`)

**Owns:** input validation, extraction orchestration, the forensic engine, deterministic policy evaluation, persistence.

**Must remain independent of x402.** No payment concept exists in `backend/`. This is why the reference agent lives in `x402-gate/` rather than `backend/` - it is a payment participant, not an analysis component.

### Reference agent (`x402-gate/src/reference-agent.ts`)

**Owns:** 402 consumption, payment, retry, decision-to-action translation, idempotency state.

**Downstream payment is simulated.** It models the integration point a real AP system would connect to its own payment run.

---

## 6. Technology Stack

Versions are current pins read from the manifests. Verify before changing.

| Layer | Technology | Role |
|---|---|---|
| Frontend | React 19, TypeScript 6, Vite 8, Tailwind 4, ESLint 9 | SPA, built to `frontend/dist`, served by the gateway |
| Gateway | Node.js 22, Express 4.21.2, tsx 4.19.2, TypeScript 5.7.3 | Public origin, routing, SSE |
| Payment | `@x402/core` 2.25.0, `@x402/hedera` 2.25.0 (brings `@hiero-ledger/sdk`) | 402 challenge, verification, settlement |
| Facilitator | Blocky402 (`api.testnet.blocky402.com`) | Settlement backend; configurable |
| Analysis | Python 3.13 (container) / 3.14 (dev), FastAPI 0.115.6, Uvicorn 0.34.0 | Internal analysis service |
| Forensics | PyMuPDF 1.28.2, pikepdf 10.13.0, Pillow 12.3.0, NumPy 2.4.0, pytesseract 0.3.13 + `tesseract-ocr` binary | Extraction, provenance, image analysis |
| Corpus | ReportLab 4.4.10 | Generates the validation corpus |
| Storage | SQLite | Verification records, vendor-history mirror |
| Runtime | Docker, Docker Compose, Caddy | Containers, TLS |
| Testing | pytest, Playwright 1.49 | Backend suite, browser capture |

**Required before changing x402/Hedera dependencies:** verify the current package API against the installed package and current official documentation. These packages move quickly; do not code from memory of this document or of a previous session. Check the installed version, the real import paths, and that the facilitator endpoints are unchanged.

---

## 7. Request / Verification Lifecycle

**The x402 handshake is two HTTP requests but one logical verification.** Every verification-level concern must be keyed to the logical verification, not the HTTP request.

1. Agent requests `POST /verify` with document bytes, no payment header.
2. Gateway returns `402` with machine-readable payment requirements.
3. Agent constructs and signs a Hedera payment payload.
4. Agent retries the identical request carrying the payment header.
5. Facilitator verifies the payment — this is **authorization**.
6. Only now does the gateway forward raw bytes to the internal `/analyze`.
7. The engine produces a decision and evidence; the row is persisted.
8. The gateway captures **settlement**, producing a real transaction id.
9. The verdict is returned to the caller, passed through unchanged.
10. On the hosted path, the reference agent translates the verdict into an action.

**Authorization gates analysis. Settlement follows successful verification.**
Never reorder events to make a prettier diagram. Settlement occurs only when the
handler produced a successful result; a 4xx/5xx from analysis skips settlement.

---

## 8. x402 + Hedera Architecture

| Property | Value |
|---|---|
| Protocol | x402 version 2, `exact` scheme |
| Network | `hedera:testnet` (CAIP-2 style, lowercase) |
| Asset | `0.0.0` — native HBAR, amounts in tinybars |
| Price | `PRICE_VERIFY` 0.02 HBAR, `PRICE_PING` 0.01 HBAR |
| Facilitator | Blocky402; `FACILITATOR_URL` is configurable |
| Mechanism | Directly signed `TransferTransaction`, not a contract call |

A 402 response carries `scheme`, `network`, `amount`, `asset`, `payTo`, `maxTimeoutSeconds`, and `extra.feePayer` - the facilitator's fee-paying account, which is why the resource server never needs to hold gas.

**Why this is load-bearing.** The agent is paying for access to a specialist compute/verification resource, at the moment of need, with no prior commercial relationship. Remove the payment and it is an unfunded API.

**Facilitator policy.** Local development may use the official public facilitator (`https://x402.org/facilitator`). **Bounty validation must use Blocky402.** A run against the official facilitator alone is not proof of qualification. The two are distinguishable by their own `feePayer` accounts.

### Hedera terminology (required in code, comments, UI copy, docs)

- A public, proof-of-stake distributed ledger using hashgraph consensus. **Not a blockchain.**
- Prefer `@hiero-ledger` over `@hashgraph` for new imports; verify against current docs.
- "HBAR" uppercase singular; "tinybars" lowercase plural.
- Network names lowercase: "Hedera testnet", not "Hedera Testnet".

---

## 9. Reference Agent

Flow: request → `402` → parse requirements → sign HBAR payment → retry → receive result → act.

| Verdict | Action | Downstream |
|---|---|---|
| `CLEAR` | `PROCEED` | Simulated downstream action authorized |
| `CLEAR`, hash already seen | `SKIP` | Not authorized twice |
| `REVIEW` | `HALT` | Not authorized; escalates with named codes |
| Unknown / null / malformed / transport failure | `HALT` | Fail closed |

**Required behaviours:**

- **Fail closed.** Only an explicit `CLEAR` authorizes. An unrecognized decision, a missing field, an injected value, a null, or a payment/transport failure all halt. A verdict it cannot read is never a verdict to act on.
- **402 assertion.** If the unpaid attempt returns anything other than `402`, the agent refuses to present the run as a paid verification and errors. A broken gate must never masquerade as a successful one.
- **Credentials server-side only.** Startup logs print the variable *name*, never the value. `reference-agent.ts` refuses to bind to a non-loopback host unless explicitly overridden.
- **Idempotency ledger** keyed on `document_hash`, process-local. See §13.
- **Outbound to `GATEWAY_PUBLIC_URL`.** Sample filenames are resolved to a basename inside a fixed corpus directory; a client-supplied filename is used only as a display label.

**The agent does not transfer supplier funds.** Its downstream action is a simulation of the integration point a real AP system would own.

---

## 10. Forensic Engine

`backend/proofline_engine.py`. Deterministic; reproducibility is directly checkable with `--repeat N`, which re-runs a document and asserts identical serialized output.

```
Document
   ├── Extraction ──── text layer, OCR fallback
   │     └── vendor, invoice number, date, beneficiary account,
   │         stated total, line items
   └── Integrity analysis
         ├── Semantic consistency      (Level A)
         ├── Structural / provenance   (Level B)
         └── Image corroboration       (Level C)
                    ↓
              Evidence objects
                    ↓
            Deterministic policy
                    ↓
              CLEAR / REVIEW
```

**Extraction.** Prefers the embedded text layer; falls back to OCR (Tesseract at 300 DPI) when the text layer is below a minimum character count, with a minimum word-confidence floor. Every required field missing or unreliable produces `EXTRACTION_INCOMPLETE`. Semantic checks return nothing rather than a passing result when their inputs are unavailable, so partial extraction degrades into the safeguard rather than into a quietly clean verdict.

Field patterns live in `backend/extraction_patterns.py`, separated so each is unit-testable without a PDF. Extraction is **label-anchored**: a value is accepted only where an explicit label introduces it. Breadth comes from recognising more labels, never from loosening what counts as a value — there is deliberately no "largest number on the page" heuristic, because a missing field escalates safely while a silently wrong financial field produces a confident decision about numbers nobody wrote. Dates normalize to ISO 8601 and reject impossible calendar days; amounts reject negatives and implausible magnitudes; a label whose value sits on an adjacent line is resolved within a small fixed window, with same-line matches always winning first.

**Semantic checks (Level A).** `AMOUNT_MISMATCH` compares the stated total against the sum of line items. `BENEFICIARY_ACCOUNT_NEVER_SEEN` compares the extracted account against vendor history.

**Structural/provenance (Level B).** PDF trailer `/ID` comparison. Interpret precisely: *differing `/ID` entries indicate that the current revision differs from its original identifier.* Do not describe this as definitive proof of edit history for every PDF producer. A second tool touching a file after creation — signing, annotation, an email attachment pipeline — is common and benign, which is why this level cannot escalate alone.

**Image corroboration (Level C).** The implemented signal is **embedded JPEG quantization-table inspection**, which correlates directly with re-compression history. Raw ELA/error-level residual was measured and found not to discriminate on real invoice pages (too little texture for pixel-level residual analysis); the residual is reported as contextual detail only and must never be thresholded. Do not reintroduce ELA as a decision signal.

Level B and C do not depend on extraction succeeding.

---

## 10a. Bounded LLM Extraction Fallback

`backend/llm_extraction.py`. **AI helps read the document. Deterministic evidence decides what the evidence means.**

The fallback is a reader of last resort for a handful of named fields, invoked only when deterministic extraction could not recover them. It exists because a legitimate invoice with an unusual layout would otherwise escalate to `REVIEW` for no reason connected to its integrity.

**Ordering (required).**

```
document → deterministic extraction
         → complete?  → NO model call, ever
         → incomplete → bounded fallback, missing fields only
         → normalized fields
         → the same deterministic forensic checks
         → the same CLEAR / REVIEW / EXTRACTION_INCOMPLETE policy
```

A clean document makes no network call. That is a behavioural requirement with a test per corpus document, not an optimisation.

**The boundary.** `llm_extraction.py` does not import `AMOUNT_MISMATCH`, `CLEAR`, `REVIEW`, `policy_score`, or the evidence hierarchy, and must not. Its single entry point returns field values or `{}`. It has no channel through which a verdict could travel.

**Reconciliation rule (required).** A recovered value is accepted **only where the deterministic extractor produced nothing at all**. There is no precedence contest, no confidence comparison, no merge. Where the two could disagree the deterministic value wins by construction, because the model's value is never consulted. Enforced at the point of assignment, not trusted upstream.

**Line items are never model-supplied.** `AMOUNT_MISMATCH` compares a total the document *states* against items the document *itemises*. If the fallback could supply both, the check could be satisfied by two numbers from the same source. `_LLM_FIELD_MAP` deliberately omits `line_items`; do not add it.

**`AMOUNT_MISMATCH` requires both operands from the same extractor (required).** A model-recovered total is not comparable with deterministically-parsed line items: a gross total against net line items differs by exactly the tax, so the check would manufacture a `REVIEW` out of a units mismatch rather than a fact about the document. This was observed on a real Factur-X invoice (net 845.00 + 19% VAT = gross 1005.55, line items summing to the net). When `provenance["stated_total"]` is not `deterministic`, the check declines to run and the document simply carries no Level A amount evidence — the same position it would be in had the total been unreadable. Never "fix" this by reconciling tax; the engine does not extract a tax treatment and must not infer one.

**Language coverage belongs to the fallback, not to the patterns.** The deterministic path recognises English labels and month names only. Per-language tables of labels, month names and conventions are an open-ended list that is never finished, and every entry is another chance to mis-read a financial field. Non-English invoices route to the fallback, whose output is validated back through the same normalizers. The one thing handled deterministically is *number format* — `1.005,55` and `1,005.55` both parse, because that is a locale-independent structural rule (a mandatory two-digit minor unit makes the last separator the decimal point) rather than a language vocabulary.

**Untrusted input.** Model output is third-party data. Every field is schema-checked, type-checked, range-checked and normalized through the *same* normalizers the deterministic path uses, so a recovered value cannot take a shape a directly-read value could not. Unrecognised keys are dropped — that is what makes an injected `decision`, `evidence_codes` or `policy_score` inert.

**Every failure converges.** Not configured, disabled, timeout, HTTP error, invalid JSON, schema violation, implausible value: all return `{}`. A fallback failure can never fail the verification lifecycle, and can never produce more fields than it started with.

**`extraction_method`** (`deterministic` / `llm_assisted` / `incomplete`) is informational. It is not in `POLICY_WEIGHTS`, not in `EVIDENCE_LEVELS`, not consulted by `evaluate_policy`, and not evidence. It is safe for public display and is reported through `/analyze`.

**Configuration.** Off by default; requires both `LLM_EXTRACTION_ENABLED=1` and `LLM_API_KEY`. A key alone does not enable it. Missing credentials must never break startup or the deterministic path. Provider: Groq, `openai/gpt-oss-20b`, strict JSON-schema constrained decoding, via stdlib `urllib` — no new dependency.

**Determinism.** Only the deterministic path carries the same-document-same-answer guarantee. Never claim the fallback path is deterministic. Reproducibility tests must exercise the deterministic path, which is why the corpus never triggers the fallback.

---

## 11. Evidence and Decision Model

| Level | Code | Can trigger `REVIEW` alone? |
|---|---|---|
| **A** Semantic | `AMOUNT_MISMATCH` | Yes |
| **A** Semantic | `BENEFICIARY_ACCOUNT_NEVER_SEEN` | Yes |
| **B** Structural/provenance | `PDF_ID_REVISION_MISMATCH` | **No** |
| **C** Corroborating image | `IMAGE_COMPRESSION_INCONSISTENCY` | **Never**, under any configuration |
| **Safeguard** | `EXTRACTION_INCOMPLETE` | Forces `REVIEW` immediately |

The hierarchy is explicit in code (`EvidenceLevel`, `EVIDENCE_LEVELS`) and enforced by module-level assertions that fail at import if the weights are ever retuned into an unsafe shape: corroborating weight alone must stay below the review threshold, structural weight alone must stay below it, and structural plus corroborating together must be able to reach it.

Evidence codes must stay distinct per level. Do not collapse a Level B code and a combined-trigger code into one undifferentiated code.

**Policy evaluation.** An `EXTRACTION_INCOMPLETE` short-circuits to `REVIEW`. If no non-corroborating evidence exists, the result is `CLEAR`. Otherwise the weighted sum is compared against the review threshold.

**Policy score.** Internal implementation machinery only. It is persisted (see §13) but excluded from the public API projection and absent from the frontend type model. It must never be surfaced as confidence, probability, or fraud likelihood. Enforced by automated scan, not by convention alone (§20).

---

## 12. Event / SSE Architecture

Stages: `RECEIVED`, `PAYMENT_REQUIRED`, `PAYING`, `PAID`, `ANALYZING`,
`DECISION`, `AGENT_ACTION`, `AUDIT`, plus `ERROR`, and the conditional
`AI_EXTRACTION`.

**`AI_EXTRACTION` is conditional, not sequential.** It is emitted only when the analysis service reports `extraction_method: "llm_assisted"` — the gateway reports what the engine said and never infers that a model ran. Because it does not occur on a normal verification, it is absent from `STAGE_SEQUENCE` and is inserted into the rendered timeline only when observed; rendering it as a skipped step would assert that something failed to happen. Never fake it to decorate a deterministic run.

**Ordering is not a contract.** `PAID` legitimately arrives *after* `DECISION`: x402's authorize/capture split means the facilitator verifies payment before analysis is gated, but a real transaction id exists only after settlement. Emitting `PAID` earlier would put a transaction id on the timeline before one existed. If observed ordering ever conflicts with an illustration, investigate which is honest before reordering.

**Once-per-verification-id rule (required).** Verification-level stages must be deduplicated by verification id, because the x402 handshake is multiple HTTP requests for one logical verification. A `!paymentHeader`-style request-shape heuristic will double-fire across the retry. Use the explicit once-guard.

**Path difference.** The developer path (`/verify`) correctly ends after `PAID` with no `AGENT_ACTION` — Proofline has no agent on that path; a third party's own system owns that decision. Only `/demo/verify` emits `AGENT_ACTION`.

**Storage.** Events live in gateway memory with a TTL (15 minutes after completion) and bounded eviction (max streams). They are transient timeline bookkeeping, not verification facts; the permanent record is the database row. This is correct for a single gateway instance. More than one instance requires a shared bus - decide that deliberately, do not discover it during a demo.

**Correlation ids** are sanitized against a strict character/length pattern before use.

**Proxy traps (required for the `/events` route).** Default proxy behaviour silently breaks SSE: buffering and idle timeouts make a stream hang with no error. The gateway must disable response buffering, flush headers immediately on connection, disable compression on that response, and keep the connection open with keepalives. Verify with a real streaming test — a successful initial connection proves nothing, since buffering failures appear only after the first chunk. Confirm with more than one method: absence of `Content-Length` on a genuinely streaming response, plus independent timestamped observation of chunk arrival.

**Multipart trap.** Never have the gateway parse a multipart body into fields and reconstruct a new request. Stream the raw body through preserving the original `Content-Type` (including boundary) and headers unchanged.

A verification-status object (`/verification/{id}/status`) exposes current state directly, so the frontend need not replay every event to reconstruct it.

---

## 13. Persistence and Data Model

SQLite. `DATABASE_URL` must point at a persistent volume.

### `verification`

| Column | Notes |
|---|---|
| `id` | `vf_` + hex |
| `document_hash` | `sha256:...` |
| `decision` | `CLEAR` / `REVIEW` |
| `policy_score` | Stored, never served publicly |
| `evidence_codes` | **All** evidence, not only what crossed the threshold |
| `created_at` | ISO 8601 UTC |
| `service_version` | |
| `payment_tx_id` | **Currently always `NULL`** — see §22 |
| `hcs_message_id` | **Currently always `NULL`** — HCS not implemented |

Indexed on `document_hash` and `created_at`.

**Evidence completeness is required.** Sub-threshold signals on a `CLEAR` result must remain durable and visible in the masked audit view. Thresholds are a policy choice that may move, and a pattern of near-misses for one vendor is a different picture from one isolated instance. This is a persistence requirement, not a decision-logic change; it must never silently tighten the threshold.

**Storage failure must never suppress a forensic result.** If the write fails, `/analyze` still returns the real decision and evidence with `verification_id: null` and `persisted: false`. Persistence is bookkeeping around the product, not a precondition for it.

### Vendor history — two stores, one authority

- **`backend/vendor_history.json` is the runtime authority.** The engine loads it once at import into a read-only `VendorHistory` object used for `BENEFICIARY_ACCOUNT_NEVER_SEEN`.
- **The `vendor_history` SQLite table is a mirror**, populated out-of-band by `seed_db.py` from that JSON, with normalized account references.

Columns: `vendor_key`, `account_reference`, `first_seen_at`, `last_seen_at`, `verification_id`, primary-keyed on (`vendor_key`, `account_reference`).

Vendor history represents Proofline's own previous observations. It is not a ledger-wide or external risk system.

**Promotion is manual and out-of-band by design — deliberately not built.** No API surface reachable by a `/verify` caller may promote an account. If a request path could, it becomes a direct attack surface: small legitimate-looking calls could whitelist a fraudulent account before the real attempt. A real product needs a separately-authenticated approval action with a different credential than whatever calls `/verify`. State the limitation; do not build the workflow now.

### Idempotency ownership

`/verify` is a deterministic read with no side effect and is safe to call repeatedly. The real double-processing risk is on the agent's side — instructing a downstream payment action twice for the same invoice.

**The reference agent owns idempotency**, keyed on `document_hash`, and the ledger is **process-local and never written to `proofline.db`**, even though the database is available. Proofline's database records what was decided about a document; whether a downstream action was executed belongs to the consuming AP system's own record. Storing it here would misrepresent what Proofline knows.

Current limitation: the ledger does not survive an agent restart. Accepted and flagged, not a gap to close here.

---

## 14. Privacy Model

- Raw documents are transient: written to a temp file, analyzed, deleted unconditionally. Never persisted, never returned through any history API.
- Raw OCR text is not persisted.
- **Verification records contain no vendor name, no beneficiary account, and no extracted fields.** Masking is total by omission rather than by filtering.
- Public field selection is an **allowlist**, so a column added later is not exposed by default.
- `policy_score` is stored but never served.
- **Vendor/account history is a separate internal store** (§13). It is never joined into a verification record and never exposed through the history API. Do not claim "no vendor/account data is stored anywhere" - that is false.
- No secrets in frontend assets. No agent private key in a browser, ever.

Public list projection: `verification_id`, `decision`, `evidence_codes`, `created_at`, `payment_tx_id`. Detail adds `document_hash`, `service_version`, `hcs_message_id`.

---

## 15. API Contract

Public surface, served by the gateway.

| Route | Payment | Purpose / semantics |
|---|---|---|
| `POST /verify` | **x402 protected** | Developer path. Unpaid → 402. Raw body streamed to `/analyze` byte-identical. Sponsor-critical resource. |
| `POST /demo/verify` | Server-funded, metered | Hosted judge path. Triggers the reference agent, which makes its own real paid outbound call to `/verify`. Accepts a bundled sample name or uploaded bytes. |
| `GET /ping` | **x402 protected** | Minimal paid resource for handshake testing. |
| `GET /verification` | none | Privacy-safe history list, bounded limit. |
| `GET /verification/{id}` | none | Masked detail. Id shape is validated before proxying upstream. |
| `GET /verification/{id}/events` | none | SSE lifecycle stream, resumable via `Last-Event-ID`. |
| `GET /verification/{id}/status` | none | Current status snapshot. |
| `GET /health` | none | Liveness plus network, facilitator, payee. |
| `GET /docs`, `GET /openapi.json` | none | Public API documentation. |

SPA routes served as HTML: `/`, `/app`, `/history`, `/history.html`.

**`/analyze` is internal and must never become public.** It has no gateway route.

**The public OpenAPI schema is authored separately in the gateway** — an allowlist by construction, not a denylist by exclusion. A new internal endpoint added later is simply not in the public schema unless someone deliberately adds it. Never proxy or filter the internal FastAPI schema. Verify adversarially: the schema JSON must not mention `/analyze`, and path-traversal or method-substitution attempts (`//analyze`, `/verify/../analyze`, wrong verbs) must all fail.

The schema currently documents four API operations (`/verify`, `/demo/verify`, `/ping`, `/health`). The verification/history routes above are served by the gateway but are deliberately not part of that schema; being absent from it is never evidence that a route does not exist.

**Error classes:** `PAYMENT_REQUIRED` (as 402), `INVALID_DOCUMENT`, `EXTRACTION_INCOMPLETE`, `ANALYSIS_FAILED`, `SERVICE_UNAVAILABLE`, `RATE_LIMITED`, `NOT_FOUND`. A JSON error handler maps 413/400 to `INVALID_DOCUMENT` and everything else to `SERVICE_UNAVAILABLE`, logging full detail server-side only. Never return a framework HTML error page.

---

## 16. Frontend Architecture

React + Vite + TypeScript + Tailwind, strict TypeScript, built to `frontend/dist` and served by the gateway at the same public origin. Routing is a pathname switch in `App.tsx`; no router library.

| Route | Page | Responsibility |
|---|---|---|
| `/` | `Landing` | Product explanation; owns its own header/footer. Deep-links `/app?sample=...`. |
| `/app` | `Home` | The verifier: samples, upload, live timeline, result. |
| `/history` | `History` | Privacy-safe verification history. |
| `/docs` | — | Served by the gateway, not React. A plain link. |

**Hooks:** `useVerification` (lifecycle), `useVerificationEvents` (SSE), `useServiceStatus` (reads `/health`; an unreachable gateway is reported as unreachable, never optimistically shown as online).

**Lib:** `api.ts` (network), `types.ts` (typed contracts), `evidence.ts` (per-code copy and level labels), `routes.ts`, `ui.ts`.

**UX invariants (required):**

- The frontend never computes a verdict and never holds a private key.
- It talks to the gateway, never directly to FastAPI.
- No fake progress timers. Every stage comes from a real server event.
- A stage the stream reports as not-yet-reached must render as "did not happen", never as "pending", once the stream has ended.
- Surface the backend's real error class (e.g. `INVALID_DOCUMENT`), never a generic message that discards it. A malformed document resolves to a clearly labelled `NO VERDICT` — explicitly not `ERROR`, with a note that it implies nothing about fraud.
- No score/confidence/probability display anywhere.
- Unavailable data is labelled unavailable, never synthesized. Fields with no real backing (document filename, agent action from history, verification fee) must not be invented into a view.
- Mobile correctness and accessibility (heading order, visible focus on every tab stop, reduced-motion safety, no horizontal overflow) are product quality requirements, not polish.

**The typed API contract does product work.** `policy_score` and every vendor/beneficiary field are deliberately absent from the frontend type model, so a component cannot render a confidence figure or leak a beneficiary account — the shape does not exist to render.

**Load-bearing selectors.** `capture.ts` asserts against these; restyling must preserve them: `#btn-clear`, `#btn-review`, `#file`, `#panel-result`, `#decision`, `#decision-note`, `#evidence`, `#agent`, `#proof`, `ol.timeline`, `.stage-name`, `.stage-time`, `.code`, `.level`, `.explain`, `a.hashscan`, and the timeline state markers `done` / `pending`.

---

## 17. Infrastructure and Deployment

### Current production topology

```
Internet :443
   │
   ▼
Caddy  — TLS termination, Let's Encrypt, reverse_proxy → 127.0.0.1:4021
   │
   ▼
gateway container :4021        ← the only published port
   ├── serves frontend/dist    (/, /app, /history)
   ├── /verify, /demo/verify, /docs, /openapi.json, /verification[...]
   └── reference agent 127.0.0.1:4022  (same network namespace, holds the key)
   │
   │  internal bridge network, no published port
   ▼
analysis container :8099       ← FastAPI + forensic engine
   └── /data/proofline.db      named volume `proofline-data`
```

### Network rules (required)

- Only the gateway publishes a port.
- **`analysis` has no `ports:` entry. That absence is the isolation control. Do not add one.** It is resolvable only as `analysis:8099` on the internal bridge.
- Never expose 8099 or 4022 publicly.
- The host firewall/security group opens only 80/443.

### Container model

**`backend/Dockerfile`** — `python:3.13-slim`; installs the `tesseract-ocr` OS binary (`pytesseract` shells out to it; pip alone is insufficient); generates the corpus; exposes 8099; health check against `/health`.

**`x402-gate/Dockerfile`** — three stages: (1) Vite build of the frontend, (2) corpus generation, (3) `node:22-slim` runtime. Runs both the reference agent and the gateway, agent first so the gateway never proxies to a dead socket.

**Corpus generation is required in the image.** `backend/test_docs/` is gitignored and generated. Without it the CLEAR/REVIEW judge buttons return 400 on a fresh deploy.

**Vendor history must be seeded on a fresh volume** (`docker compose exec analysis python backend/seed_db.py`), or the REVIEW sample cannot produce `BENEFICIARY_ACCOUNT_NEVER_SEEN`.

### Container bind-address note

Under compose, `analysis` sets `PROOFLINE_ALLOW_PUBLIC_BIND=1` and binds `0.0.0.0`. A sibling container cannot reach a service bound to another container's loopback, so the code's loopback guard cannot be honoured there. **This is not a relaxation of the ingress rule** — enforcement moves from the bind address to Docker networking (no `ports:` entry, internal-only bridge). If anyone adds a `ports:` entry to `analysis`, the guard no longer protects them.

### Persistent storage

Named volume `proofline-data` mounted at `/data`; `DATABASE_URL=/data/proofline.db`. The default location beside the code is ephemeral in a container and must not be used in deployment.

### Deployment artifacts

**There is exactly one deployment target: AWS EC2 running Docker Compose behind Caddy.** Do not add a second deployment shape to the tree; two shapes invite editing the wrong one and leave the unused one to rot into a false description of production.

| Artifact | Role |
|---|---|
| `docker-compose.yml` | Production runtime shape: gateway (published) + analysis (internal) |
| `deploy/ec2/Caddyfile` | TLS termination and reverse proxy to the gateway |
| `deploy/ec2/cloud-init.yaml` | Instance bootstrap: Docker Engine and Caddy |

The host is a plain Ubuntu VM with an attached volume for the SQLite data. The EC2 security group opens only 80/443, which is the outer half of the isolation control; the inner half is that `analysis` has no `ports:` entry, so nothing routes to it from outside the Docker bridge.

**Platform constraint to preserve if the target is ever reconsidered:** the three processes rely on the gateway reaching the reference agent over loopback in a shared network namespace, and on a single writer for the SQLite volume. A platform that spreads process groups across separate hosts breaks both, and would require a supervisor as PID 1 inside one image plus a deliberate decision about the volume. Evaluate that before, not after, changing platform.

---

## 18. Environment and Configuration

Never commit real values. `.env` is gitignored; `.env.example` holds placeholders only.

| Variable | Required | Purpose | Exposure |
|---|---|---|---|
| `GATEWAY_PUBLIC_URL` | **yes (deploy)** | Real external origin the reference agent calls | Server |
| `HEDERA_PAY_TO_ACCOUNT_ID` | **yes** | Account receiving verification fees | Server |
| `AGENT_ACCOUNT_ID` | **yes** | Reference agent's funded account | Server |
| `AGENT_PRIVATE_KEY` | **yes** | **SECRET.** Reference agent signing key | **Server-side only** |
| `HEDERA_ACCOUNT_ID` | dev only | Developer client scripts | Server |
| `HEDERA_PRIVATE_KEY` | dev only | **SECRET.** Developer client signing key | **Server-side only** |
| `FACILITATOR_URL` | no | Default Blocky402 testnet | Server |
| `X402_NETWORK` | no | `hedera:testnet` | Server |
| `PRICE_VERIFY` / `PRICE_PING` | no | `0.02` / `0.01` HBAR | Server |
| `PORT` | no | Gateway port, default 4021 | Server |
| `PUBLIC_PORT` | no | Host port published by compose | Server |
| `ANALYSIS_SERVICE_URL` / `ANALYSIS_HOST` / `ANALYSIS_PORT` | no | Internal analysis address | Server |
| `AGENT_SERVICE_URL` / `AGENT_HOST` / `AGENT_PORT` | no | Internal agent address | Server |
| `DATABASE_URL` | no | Must be on a persistent volume | Server |
| `MAX_UPLOAD_BYTES` | no | Default 10 MB | Server |
| `SERVICE_VERSION` | no | Reported in results | Server |
| `DEMO_RATE_LIMIT_PER_MINUTE` / `DEMO_MAX_CONCURRENT` / `DEMO_TIMEOUT_MS` | no | `/demo/verify` abuse controls | Server |
| `PROOFLINE_ALLOW_PUBLIC_BIND` | no | Container-only bind override (§17) | Server |
| `PROOFLINE_LIVE` | no | Opt in to live-payment tests | Server |
| `LLM_EXTRACTION_ENABLED` | no | Enables the extraction fallback (§10a). Default off | Server |
| `LLM_API_KEY` | no | **SECRET.** Provider key. Absence disables the fallback | **Server-side only** |
| `LLM_MODEL` / `LLM_API_URL` | no | Provider overrides; default Groq `openai/gpt-oss-20b` | Server |
| `LLM_TIMEOUT_SECONDS` | no | Default 8. On timeout the document falls through to `EXTRACTION_INCOMPLETE` | Server |

**No variable is browser-safe.** Nothing in this table may reach a frontend bundle.

**The `LLM_*` variables belong to the `analysis` service**, not the gateway: the engine runs there, and the gateway has no concept of extraction. In compose they are set on `analysis`. Setting them on the gateway does nothing.

### `GATEWAY_PUBLIC_URL` is environment-scoped, and wrong in either direction

This variable decides **which gateway the reference agent actually pays and verifies against**. It is not cosmetic: it selects the environment under test.

```text
LOCAL       GATEWAY_PUBLIC_URL=http://127.0.0.1:4021
            (or whatever local gateway owns the port)

PRODUCTION  GATEWAY_PUBLIC_URL=https://proofline.duckdns.org
            the real public HTTPS origin
```

**Never run local capture/demo flows against the production `GATEWAY_PUBLIC_URL` unless the test explicitly intends to exercise production.** Both misconfigurations are silent:

- **Loopback left in production.** The reference agent stops exercising the network path an external agent would, and "the hosted judge flow proves the public endpoint works" becomes false with nothing visibly breaking.
- **Production URL left in local development.** The agent's `/verify` call - and the `x-proofline-stream` header with it — goes to the *deployed* gateway. The early stages (`RECEIVED` … `PAID`) are then emitted into that server's memory, never the local one, so the local SSE stream legitimately receives only `DECISION` and `AGENT_ACTION`. The local UI correctly renders the unreported stages as "did not happen".

**This second case actually happened, and it reads exactly like a frontend bug.** It is not one. The timeline was truthfully reporting that its own gateway never saw those stages, because the verification really did happen somewhere else. Before concluding the UI is broken, check the environment.

### Pre-flight check before any local capture or demo run

This is automated. From `x402-gate/`:

```bash
npm run preflight     # check only
npm run capture       # preflight, then the capture suite only if it passes
```

`src/preflight.ts` verifies `GATEWAY_PUBLIC_URL` matches the intended environment (`PROOFLINE_ENV=local` by default, `production` to invert the rule), and that the gateway, reference agent and analysis service are all answering. It exits non-zero on failure, so `npm run capture` will not spend real HBAR against the wrong environment.

Two things it cannot check, so confirm them by hand when results look strange:

1. **Which process owns port 4021.** A container from an earlier session can still hold it and serve a *stale bundle*, so a rebuild appears to change nothing while `/health` answers 200 perfectly. Check listeners, not just that something responds. This has happened.
2. **That the running services are the ones you just built.** The pre-flight confirms a service is *up*, never that it is *current*.

---

## 19. Security Model

### Network
- Gateway is the sole public origin.
- FastAPI has no public ingress; `_assert_loopback` refuses a public bind unless explicitly overridden for an isolated container network.
- The reference agent binds loopback only and refuses otherwise.

### Secrets
- Injected via environment/secret management; never committed, never in a frontend bundle, never logged. Startup prints variable names, not values.
- `.env` gitignored; `.dockerignore` keeps `.env` out of build contexts.

### Input
- Validate content type and size at both the gateway and the analysis service.
- Never execute uploaded content; never pass document content to a shell.
- Temporary files deleted unconditionally after analysis.
- Sample filenames resolved to a basename inside a fixed corpus directory.
- Correlation ids sanitized; verification ids shape-validated before proxying.

### Payment
- Analysis runs only after payment authorization.
- Settlement only after a successful handler result.
- Never fabricate payment state. A facilitator outage is an infrastructure failure, never a forensic outcome.
- **Proofline does not perform the downstream supplier payment.**

### Application
- Fail-closed agent.
- Controlled error classes; no stack traces or absolute paths to callers.
- Rate limiting on the server-funded demo path, metered *before* any spend so rejected calls are counted.
- Privacy-safe history via allowlist projection.
- Public OpenAPI is an explicit allowlist.

### Document privacy
- Transient only; deleted after analysis; never returned through history APIs.

**Proofline is a hackathon project on testnet. It is not audited.** Never claim tamper-proof or fraud-proof. It reports evidence and escalates uncertainty.

---

## 20. Testing and Validation

Run from the repository root unless noted.

| Category | Command | Covers |
|---|---|---|
| Backend suite | `pytest` | All below, offline |
| Live payment | `PROOFLINE_LIVE=1 pytest` | Real testnet payments; skipped by default |
| Frontend | `cd frontend && npm run typecheck && npm run lint && npm run build` | Types, lint, production build |
| Gateway types | `cd x402-gate && npm run typecheck` | |
| Browser capture | `cd x402-gate && GATEWAY_URL=http://127.0.0.1:4021/app npx tsx src/capture.ts` | Four real paid paths |
| Accessibility probe | `cd x402-gate && npx tsx src/a11y-probe.ts` | Reports headings, focus, reduced motion |

**Unit:** each forensic signal, extraction completeness, beneficiary history, policy evaluation, deterministic repeatability, every added label variant and its negative cases.

**Extraction fallback (§10a):** the suite runs offline against a stubbed provider. Covered: disabled by default; a key alone does not enable it; no provider call for any corpus document; recovery of a genuinely missing field; a recovered account feeding `BENEFICIARY_ACCOUNT_NEVER_SEEN`; still-incomplete when recovery fails; every provider failure mode; and the injection boundary — an attempted `decision`, `evidence_codes` or `policy_score` in the response must be inert, and a deterministic field must never be overwritten.

**Integration:** 402 challenge, facilitator verification and settlement, payment-gate enforcement, persistence, reference-agent CLEAR and REVIEW paths, agent fail-safe behaviour.

**Frontend/regression:** rendered output must never contain `policy_score`, `confidence`, `probability`, or a bare `N%`. A malformed upload must resolve to a clear non-outcome, must not hang, and must not discard the backend's real error class.

**Privacy:** a non-sample document's vendor, address, account, invoice number, line items and amounts must be absent from list responses, detail responses, and the rendered DOM.

**End-to-end:** CLEAR sample, REVIEW sample, naturally messy document, unsupported/unreadable document.

### Testing rules

- **The payment gate must be tested in both directions.** Unpaid attempts produce a delta of zero persisted rows, *and* a paid control moves the counter by exactly one. The negative case alone would pass against a counter that is simply stuck.
- **Never weaken a test to make it pass.** If a check flags legitimate content (e.g. a scan flagging `ocr_mean_confidence`, or a comment explaining *why* confidence displays are forbidden), fix the check's precision — do not relax the rule it guards.
- **Never modify `capture.ts` to hide a regression.** It is the regression oracle for the primary screen. Its entry point is `/app`, not `/`; a run against the bare root lands on the landing page and fails to find `#btn-clear`, which is a configuration error, not a product regression.
- The capture suite needs all three services running (analysis, gateway, and the reference agent on 4022 — a separate process that is easy to forget; its absence produces `SERVICE_UNAVAILABLE` on `/demo/verify`).
- **Do not describe a measurement tool as an assertion.** `a11y-probe.ts` reports heading order, focus rings, and reduced-motion opacity; it does not pass/fail.

---

## 21. Operational Constraints

Non-obvious things that break the system.

1. **x402 package APIs move quickly.** Verify current imports and behaviour against the installed package before changing payment code.
2. **`/verify` is the sponsor-critical resource.** `/demo/verify` must remain orchestration over a real outbound call to it — never an internal bypass.
3. **`GATEWAY_PUBLIC_URL` must be the real public origin** in any hosted deployment (§18).
4. **FastAPI must never become publicly routable.** Do not add a `ports:` entry to `analysis`.
5. **SSE must not be buffered or compressed** by any proxy in front of the gateway.
6. **Multipart uploads must be streamed through, not reconstructed** from a parsed representation.
7. **Reference-agent credentials stay server-side.** The agent shares the gateway container deliberately, because it refuses any non-loopback bind.
8. **`payment_tx_id` may be absent** from persisted rows; render an em dash, never an invented link.
9. **HCS is not implemented.** Never present an HCS record.
10. **Vendor history is not public** and cannot be promoted through any request path.
11. **Idempotency state belongs to the consuming agent**, not to `proofline.db`.
12. **The corpus is generated, not committed.** Fresh environments must build it, and fresh volumes must be seeded.
13. **Blocky402 is the bounty facilitator.** The official facilitator is development only.
14. **Single gateway instance.** SSE state is in-memory; multiple instances need a shared bus.

---

## 22. Current Verified State

### Implemented

- Deterministic forensic engine with five evidence codes across the A/B/C + safeguard hierarchy, OCR fallback, and reproducibility checking.
- x402 payment gate on `@x402/core` / `@x402/hedera` 2.25.0, `exact` scheme, `hedera:testnet`, settling through Blocky402.
- Internal FastAPI analysis service with a loopback bind guard.
- Server-side reference agent with fail-closed decisioning and a process-local idempotency ledger.
- SQLite persistence for verification records, plus an out-of-band vendor-history seed.
- SSE lifecycle stream with once-per-verification-id deduplication, TTL-bounded in-memory storage, and a status endpoint.
- React frontend: landing, verifier, history; live timeline, evidence presentation, agent action, audit panel.
- Public OpenAPI authored as a gateway-side allowlist.
- Demo-path rate limiting, concurrency cap, and timeout.
- Docker Compose deployment behind Caddy with a persistent named volume.
- pytest suite plus a Playwright capture suite covering four real paid paths.

### Verified

Confirmed against the repository or a live probe of the production origin:

- `POST /verify` on the production origin returns `402` with an x402 v2 `exact` challenge on `hedera:testnet` for 0.02 HBAR, carrying the facilitator's `feePayer`.
- `/health` reports `hedera:testnet` and the Blocky402 testnet facilitator.
- `/`, `/app`, `/history`, `/docs`, `/openapi.json`, `/verification` all respond 200 over HTTPS via Caddy with a Let's Encrypt certificate.
- The public OpenAPI schema currently documents four gateway API operations: `/verify`, `/demo/verify`, `/ping`, and `/health`. The gateway also serves the privacy-safe verification/history routes separately, outside that schema. The schema does not mention `/analyze` anywhere.
- The five-document corpus reproduces: baseline `CLEAR`; altered total `REVIEW` via `AMOUNT_MISMATCH`; changed beneficiary `REVIEW` via `BENEFICIARY_ACCOUNT_NEVER_SEEN`; re-saved `CLEAR` while carrying `PDF_ID_REVISION_MISMATCH`; rasterized copy `CLEAR` while carrying `IMAGE_COMPRESSION_INCONSISTENCY`. The last two confirm Level B and C corroborating-only behaviour.
- `pytest` passes with the live-payment tests skipped by default for want of credentials.
- Live history responses expose only the allowlisted public fields.

### Intentionally not implemented

- **HCS audit trail.** Schema columns and a UI "Not enabled" panel exist; no publishing code. Never present an HCS record.
- **`payment_tx_id` persistence.** The analysis service never sees settlement data and the gateway does not pass the settled transaction id inward. Every persisted row has `NULL`. Populating it requires a deliberate decision about crossing that boundary.
- **Vendor-history promotion workflow.** Manual and out-of-band by design.
- **Durable agent idempotency.** Process-local by design.
- **Chainlink / other sponsors.** Out of scope.

### Current deployment

| Property | Value |
|---|---|
| Production URL | `https://proofline.duckdns.org` |
| TLS | Caddy, Let's Encrypt |
| Runtime | Docker Compose — gateway (public) + analysis (internal) |
| Public origin | Gateway only |
| Network | Hedera testnet |
| Facilitator | Blocky402 testnet |

**The deployment is live.** The production origin above serves over HTTPS, `POST /verify` returns a real x402 challenge, and `/health` reports the Blocky402 testnet facilitator. `DEPLOYMENT.md` is the runbook for reproducing this shape; it is deliberately written as procedure rather than status, so read deployment state from this section, not from that document.

---

## 23. Development Workflow

### Before editing

1. Inspect the relevant code — never act on this document's memory alone.
2. Identify which contract the change touches (frontend / gateway / analysis / infrastructure).
3. Confirm the change preserves the boundaries in §3 and §5.

### After editing

1. Typecheck, 2. lint, 3. tests, 4. production build, 5. the relevant capture or validation run, 6. inspect an actual screenshot for any UI change, 7. confirm no protected contract changed.

**Look at real screenshots for UI work.** Layout defects at mobile widths have repeatedly survived a passing suite; a green capture run is not evidence that the layout is correct.

### For x402 / Hedera changes

Verify the current package API and official documentation. Run real testnet validation when the change touches payment. Never rely solely on memory.

### For deployment changes

Validate locally first, then verify public/private topology, health, the x402 flow, persistence across restart, secret isolation, and the public HTTPS origin. Prove isolation positively — a refused connection plus a *successful* control on the same interface, so "refused" cannot be explained by a blanket firewall.

### Evidence standard

Show real output, not a description of expected output. A check that reads zero may be reading a stale log or a process that failed to bind; cross-check against known prior activity before accepting a pass.

---

## 24. Definition of Done

**Verification changes:** payment gate intact; forensic engine and decision semantics intact; no fabricated state; tests pass.

**Frontend changes:** accessibility (heading order, focus, reduced motion) intact; mobile correct with no horizontal overflow; no score/confidence/probability leak; screenshot reviewed; load-bearing selectors preserved; capture suite green.

**Infrastructure changes:** gateway remains sole public ingress; analysis remains unroutable; persistence intact across restart; secrets isolated; `GATEWAY_PUBLIC_URL` correct; health and a real payment flow verified.

**Deployment:** real Blocky402 settlement confirmed independently on the mirror node, not merely echoed by our own gateway; public verifier reachable; all four capture paths pass; database survives restart; internal services isolated.

---

## 25. Things Claude Code Must Not Do

- Add sponsors for prize stacking; make Chainlink load-bearing; reintroduce The Graph without a new verified product requirement.
- Replace deterministic decisioning with an LLM.
- Let the extraction fallback (§10a) reach the decision: produce or influence a verdict, emit an evidence code or score, overwrite a field the deterministic extractor already read, supply `line_items`, or run at all for a document that extracted cleanly.
- Claim the LLM-assisted extraction path is deterministic, or present `extraction_method` as evidence, a confidence, or a quality rating.
- Claim ELA proves AI generation, or that provenance anomalies prove fraud.
- Expose private keys or any secret.
- Fabricate UI state, payment state, transaction ids, HCS records, or evidence.
- Create a fake demo mode or hardcode demo verdicts.
- Expose FastAPI publicly, or add a `ports:` entry to `analysis`.
- Persist raw uploaded documents or raw OCR text.
- Build a confidence-score dashboard.
- Change a backend contract solely to simplify a frontend change.
- Weaken a test, or modify `capture.ts`, to make a failure go away.
- Expand scope before the x402-to-verdict path works.
- Create a generic AI chatbot, marketplace, tokenomics layer, NFT layer, or an unrelated product.

---

## 26. Repository Structure

```
frontend/                      React 19 + Vite 8 + TypeScript 6 + Tailwind 4
  src/App.tsx                  pathname switch: / landing, /app, /history
  src/pages/                   Landing, Home (verifier), History
  src/components/              AgentPanel, AgentTimeline, AppShell, AuditPanel, Button, EvidenceList, LatestVerification, Panel, ProductFlow, ResultPanel, SettlementPanel, UploadZone, VerificationArtifact, WorkflowStepper
  src/hooks/                   useVerification, useVerificationEvents, useServiceStatus
  src/lib/                     api, types, evidence, routes, ui
  src/styles/index.css         Tailwind theme tokens
  dist/                        build output (gitignored), served by the gateway

x402-gate/                     Express gateway — sole public origin
  src/server.ts                routes, static hosting, SPA fallback, errors
  src/x402-middleware.ts       402 / verify / settle
  src/reference-agent.ts       hosted judge agent; holds AGENT_PRIVATE_KEY
  src/agent-action.ts          fail-closed decisioning, idempotency ledger
  src/events.ts                SSE bus, TTL-bounded
  src/api-docs.ts              gateway-authored public OpenAPI (allowlist)
  src/demo-limits.ts           rate limit, concurrency, timeout
  src/pay.ts, credentials.ts, config.ts, env.ts
  src/capture.ts               browser regression oracle (Playwright)
  src/a11y-probe.ts            accessibility measurements
  src/client.ts, run-corpus.ts, demo-client.ts, stream-demo.ts,
  src/watch-events.ts, ux-shots.ts, hierarchy-probe.ts, focus-probe.ts
  Dockerfile                   3 stages: frontend build, corpus, runtime

backend/                       Python analysis service — internal only
  app.py                       FastAPI, loopback guard, /analyze, history
  proofline_engine.py          extraction, evidence, policy, CLI
  extraction_patterns.py       label-anchored patterns and normalizers
  llm_extraction.py            bounded extraction fallback (§10a); no decision concept
  db.py                        SQLite persistence
  seed_db.py                   out-of-band vendor-history seed
  make_test_docs.py            five-document corpus generator
  vendor_history.json          runtime authority for beneficiary checks
  requirements.txt
  test_docs/                   generated corpus (gitignored)
  Dockerfile                   includes the tesseract-ocr binary

tests/                         pytest
  test_forensics.py            engine signals, extraction, policy
  test_extraction_patterns.py  label variants, normalization, negative cases
  test_llm_extraction.py       fallback gating, validation, injection boundary
  test_agent_failsafe.py       fail-closed decisioning, idempotency
  test_history_privacy.py      allowlist projection, leakage probes
  test_frontend_language.py    score/confidence/probability scan
  test_payment_gate_live.py    real testnet payments (opt-in)

deploy/ec2/                    CURRENT PRODUCTION INFRASTRUCTURE
  Caddyfile                    TLS termination, reverse proxy to the gateway
  cloud-init.yaml              instance bootstrap (Docker + Caddy)

docker-compose.yml             CURRENT PRODUCTION RUNTIME SHAPE
.env.example                   placeholders only
pytest.ini
README.md                      public product documentation
DEPLOYMENT.md                  operational runbook
CLAUDE.md                      this document
```

---

## 27. AI-Assisted Development

AI coding assistants are development-time tools only. They are never runtime dependencies, and nothing in the deployed path calls out to one.

- Never expose private keys, `.env` contents, credentials, or production secrets to an assistant — in a prompt, a pasted log, or a shared file.
- Never commit secrets, regardless of which tool suggested the change.
- An assistant may inspect and modify source, tests, fixtures, documentation, and synthetic demo data.
- AI-generated code is reviewed, executed, and validated against this document before being trusted. An assistant proposing something is not the same as it being correct.

Final submission materials must disclose AI assistance as required by the event rules.
