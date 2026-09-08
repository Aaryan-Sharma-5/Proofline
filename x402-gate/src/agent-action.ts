export const DECISION_CLEAR = "CLEAR";
export const DECISION_REVIEW = "REVIEW";

const EVIDENCE_EXPLANATIONS: Record<string, string> = {
  AMOUNT_MISMATCH:
    "the stated total does not equal the sum of the line items on the invoice",
  BENEFICIARY_ACCOUNT_NEVER_SEEN:
    "this vendor has been paid before, but never to this account",
  PDF_ID_REVISION_MISMATCH:
    "the document's current revision differs from its original identifier",
  IMAGE_COMPRESSION_INCONSISTENCY:
    "the page is a lossily recompressed raster, which is expected of a scan and is corroborating only",
  EXTRACTION_INCOMPLETE:
    "one or more required fields could not be read reliably, so the semantic checks could not be evaluated",
};

export type Verdict = {
  decision?: unknown;
  evidence_codes?: unknown;
  document_hash?: unknown;
};

export class ReleaseLedger {
  private readonly released = new Map<string, string>();

  previousRelease(documentHash: string): string | undefined {
    return this.released.get(documentHash);
  }

  recordRelease(documentHash: string, invoiceRef: string): void {
    this.released.set(documentHash, invoiceRef);
  }
}

export type AgentAction = {
  action: "PROCEED" | "HALT" | "SKIP";
  lines: string[];
  downstreamPaymentReleased: boolean;
};

function explain(code: string): string {
  return EVIDENCE_EXPLANATIONS[code] ?? "no description available for this code";
}

function shortHash(documentHash: string): string {
  const digest = documentHash.replace(/^sha256:/, "");
  return `sha256:${digest.slice(0, 12)}...`;
}

export function decideAndAct(
  verdict: Verdict,
  invoiceRef: string,
  ledger?: ReleaseLedger,
): AgentAction {
  const decision =
    typeof verdict.decision === "string" ? verdict.decision : undefined;
  const codes = Array.isArray(verdict.evidence_codes)
    ? verdict.evidence_codes.filter((c): c is string => typeof c === "string")
    : [];
  const documentHash =
    typeof verdict.document_hash === "string" ? verdict.document_hash : undefined;

  if (decision === DECISION_CLEAR) {
    // A repeat verification of the same document must not release the payment again 
    if (ledger && documentHash) {
      const earlier = ledger.previousRelease(documentHash);
      if (earlier !== undefined) {
        return {
          action: "SKIP",
          downstreamPaymentReleased: false,
          lines: [
            "Verification passed, but this document has already been paid.",
            `  -> idempotency key ${shortHash(documentHash)} already released as ${earlier}`,
            `  -> skipping duplicate payment for ${invoiceRef}`,
          ],
        };
      }
      ledger.recordRelease(documentHash, invoiceRef);
    }

    return {
      action: "PROCEED",
      downstreamPaymentReleased: true,
      lines: [
        "Verification passed, proceeding with downstream payment.",
        `  -> releasing supplier payment for ${invoiceRef} [simulated]`,
        ...(documentHash
          ? [`  -> idempotency key recorded: ${shortHash(documentHash)}`]
          : []),
        ...(codes.length > 0
          ? [
              `  note: non-material evidence recorded and carried forward: ${codes.join(", ")}`,
            ]
          : []),
      ],
    };
  }

  if (decision === DECISION_REVIEW) {
    return {
      action: "HALT",
      downstreamPaymentReleased: false,
      lines: [
        "Payment halted, escalating for human review.",
        ...codes.map((code) => `  -> escalating: ${code}, ${explain(code)}`),
        `  -> downstream payment for ${invoiceRef} NOT released`,
      ],
    };
  }

  // Neither CLEAR nor REVIEW. Fail closed.
  return {
    action: "HALT",
    downstreamPaymentReleased: false,
    lines: [
      "Payment halted, escalating for human review.",
      `  -> escalating: unrecognised decision ${JSON.stringify(verdict.decision)}, ` +
        "the agent will not release a payment on a verdict it cannot read",
      `  -> downstream payment for ${invoiceRef} NOT released`,
    ],
  };
}
