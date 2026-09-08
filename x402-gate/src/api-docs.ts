const PRICE_NOTE =
  "Priced in native HBAR (asset 0.0.0), denominated in tinybars. 1 HBAR = 100,000,000 tinybars.";

export function buildOpenApiDocument(options: {
  network: string;
  facilitator: string;
  pricePing: string;
  priceVerify: string;
  serviceVersion: string;
}): Record<string, unknown> {
  const { network, facilitator, pricePing, priceVerify, serviceVersion } = options;

  return {
    openapi: "3.1.0",
    info: {
      title: "Proofline",
      version: serviceVersion,
      summary: "Machine-payable document-integrity verification for AP agents.",
      description:
        "Proofline returns a deterministic CLEAR or REVIEW decision backed by named evidence codes, so an automated financial workflow can decide whether to proceed with or halt a downstream payment.\n\nCLEAR means no material anomaly was detected by the configured checks. It is not a claim that a document is authentic. REVIEW means something needs human attention. It is not a finding of fraud.\n\nPaid endpoints follow the x402 protocol (version 2, `exact` scheme) on `${network}, settled through a facilitator. ${PRICE_NOTE}`",
    },
    servers: [{ url: "/", description: "Proofline gateway, the sole public origin" }],
    tags: [
      { name: "verification", description: "Paid document verification." },
      { name: "demo", description: "Hosted judge flow." },
      { name: "service", description: "Service metadata." },
    ],
    paths: {
      "/verify": {
        post: {
          tags: ["verification"],
          summary: "Verify a document (x402 protected)",
          description:
            "Developer path. An unpaid request returns 402 with payment `requirements; pay and retry to receive the verdict. Costs ${priceVerify} HBAR.\n\n` Send the document as a raw request body with its own content type. The document is analysed and deleted; it is never stored.",
          requestBody: {
            required: true,
            content: {
              "application/pdf": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          responses: {
            "200": {
              description: "Verification result.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Verification" },
                },
              },
            },
            "402": {
              description:
                "Payment required. The `PAYMENT-REQUIRED` header carries the base64-encoded x402 challenge.",
            },
            "400": { description: "The document could not be read." },
            "413": { description: "The document is too large." },
          },
        },
      },
      "/demo/verify": {
        post: {
          tags: ["demo"],
          summary: "Trigger the server-side reference agent",
          description:
            "Hosted judge path. Runs a server-side reference AP agent that makes its own outbound request to this same `/verify` endpoint, pays a real testnet payment, and acts on the verdict.\n\nThis is a trigger, not a shortcut: the payment is real and the same x402 handshake applies. The judge's browser never holds a key.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["sample"],
                  properties: {
                    sample: {
                      type: "string",
                      description: "Bundled sample document filename.",
                      examples: ["01_baseline_clean.pdf"],
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Verdict, real payment details, and the agent's action.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/DemoResult" },
                },
              },
            },
            "400": { description: "Unknown sample document." },
            "502": { description: "The reference agent could not complete the run." },
          },
        },
      },
      "/ping": {
        get: {
          tags: ["service"],
          summary: "Minimal x402-protected resource",
          description:
            `A trivial paid endpoint for exercising the payment loop. Costs ${pricePing} HBAR.`,
          responses: {
            "200": { description: "Paid successfully." },
            "402": { description: "Payment required." },
          },
        },
      },
      "/health": {
        get: {
          tags: ["service"],
          summary: "Liveness and configuration",
          responses: { "200": { description: "Service is up." } },
        },
      },
    },
    components: {
      schemas: {
        Verification: {
          type: "object",
          properties: {
            verification_id: { type: ["string", "null"], examples: ["vf_4d4b0af8..."] },
            document_hash: { type: "string", examples: ["sha256:57b800e4..."] },
            decision: {
              type: "string",
              enum: ["CLEAR", "REVIEW"],
              description:
                "CLEAR: no material anomaly detected by the configured checks. " +
                "REVIEW: escalate for human attention.",
            },
            evidence_codes: {
              type: "array",
              items: { $ref: "#/components/schemas/EvidenceCode" },
              description:
                "Every code the engine produced, including sub-threshold codes on a CLEAR result.",
            },
            policy_score: {
              type: "integer",
              description:
                "Internal policy mechanism used to reach the decision. Not a confidence value, not a probability, and not a risk rating.",
            },
            service_version: { type: "string" },
          },
        },
        EvidenceCode: {
          type: "string",
          enum: [
            "AMOUNT_MISMATCH",
            "BENEFICIARY_ACCOUNT_NEVER_SEEN",
            "PDF_ID_REVISION_MISMATCH",
            "IMAGE_COMPRESSION_INCONSISTENCY",
            "EXTRACTION_INCOMPLETE",
          ],
          description:
            "Level A (semantic): AMOUNT_MISMATCH, BENEFICIARY_ACCOUNT_NEVER_SEEN. " +
            "Level B (structural/provenance): PDF_ID_REVISION_MISMATCH; a differing " +
            "trailer /ID indicates the current revision differs from its original " +
            "identifier, and nothing more. Level C (corroborating): " +
            "IMAGE_COMPRESSION_INCONSISTENCY; never escalates on its own. " +
            "Safeguard: EXTRACTION_INCOMPLETE forces REVIEW.",
        },
        DemoResult: {
          type: "object",
          properties: {
            sample: { type: "string" },
            verification: { $ref: "#/components/schemas/Verification" },
            payment: {
              type: ["object", "null"],
              properties: {
                transaction: { type: "string" },
                network: { type: "string", examples: [network] },
                hashscan: { type: "string", format: "uri" },
                payer: { type: "string" },
              },
            },
            agent: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["PROCEED", "HALT", "SKIP"] },
                downstreamPaymentReleased: { type: "boolean" },
                lines: { type: "array", items: { type: "string" } },
              },
            },
            stages: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
    "x-x402": {
      protocolVersion: 2,
      scheme: "exact",
      network,
      facilitator,
      asset: "0.0.0",
      assetNote: PRICE_NOTE,
    },
  };
}

/** Minimal self-contained docs page. No external assets, so nothing to fetch. */
export function buildDocsPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Proofline API</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif;
         margin: 0; padding: 2.5rem 1.5rem; max-width: 52rem; margin-inline: auto; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  .sub { opacity: .7; margin-bottom: 2rem; }
  h2 { font-size: 1.05rem; margin: 2rem 0 .5rem; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .87em; }
  pre { padding: .85rem 1rem; overflow-x: auto; border-radius: 8px;
        background: rgba(127,127,127,.12); }
  .route { display: flex; gap: .6rem; align-items: baseline; margin-top: 1.4rem; }
  .m { font-weight: 600; font-size: .78rem; letter-spacing: .04em;
       padding: .12rem .45rem; border-radius: 4px; background: rgba(127,127,127,.2); }
  .note { border-left: 3px solid rgba(127,127,127,.4); padding-left: .9rem; opacity: .85; }
  a { color: inherit; }
</style>
</head>
<body>
<h1>Proofline API</h1>
<div class="sub">Machine-payable document-integrity verification for AP agents.</div>

<p>Machine-readable schema: <a href="/openapi.json"><code>/openapi.json</code></a></p>

<p class="note">
  <strong>CLEAR</strong> means no material anomaly was detected by the configured
  checks. It is not a claim that a document is authentic.
  <strong>REVIEW</strong> means something needs human attention. It is not a
  finding of fraud.
</p>

<h2>Paid endpoints</h2>
<p>Payment uses x402 (version 2, <code>exact</code> scheme) on Hedera, priced in
native HBAR. An unpaid request returns <code>402</code> with a
<code>PAYMENT-REQUIRED</code> header carrying the challenge; sign it, retry, and
the response is released.</p>

<div class="route"><span class="m">POST</span><code>/verify</code></div>
<p>Developer path. Send the document as a raw body. The document is analysed and
deleted; it is never stored.</p>
<pre>curl -X POST http://&lt;gateway&gt;/verify \\
  -H 'content-type: application/pdf' \\
  --data-binary @invoice.pdf</pre>

<div class="route"><span class="m">POST</span><code>/demo/verify</code></div>
<p>Hosted judge path. Triggers a server-side reference agent that makes its own
outbound request to <code>/verify</code>, pays a real testnet payment, and acts on
the verdict. A trigger, not a shortcut: the payment is real.</p>
<pre>curl -X POST http://&lt;gateway&gt;/demo/verify \\
  -H 'content-type: application/json' \\
  -d '{"sample":"01_baseline_clean.pdf"}'</pre>

<div class="route"><span class="m">GET</span><code>/ping</code></div>
<p>Trivial paid resource for exercising the payment loop.</p>

<h2>Unpaid endpoints</h2>
<div class="route"><span class="m">GET</span><code>/health</code></div>
<div class="route"><span class="m">GET</span><code>/openapi.json</code></div>

<h2>Evidence codes</h2>
<p><strong>Level A, semantic:</strong> <code>AMOUNT_MISMATCH</code>,
<code>BENEFICIARY_ACCOUNT_NEVER_SEEN</code>.<br>
<strong>Level B, structural:</strong> <code>PDF_ID_REVISION_MISMATCH</code>, a
differing trailer <code>/ID</code> indicates the current revision differs from its
original identifier, and nothing more.<br>
<strong>Level C, corroborating:</strong>
<code>IMAGE_COMPRESSION_INCONSISTENCY</code>, never escalates on its own.<br>
<strong>Safeguard:</strong> <code>EXTRACTION_INCOMPLETE</code> forces REVIEW.</p>

<p class="note"><code>policy_score</code> is an internal mechanism used to reach the
decision. It is not a confidence value, a probability, or a risk rating.</p>
</body>
</html>`;
}
