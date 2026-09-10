import type { EvidenceCode, EvidenceLevel } from "./types";

export interface EvidenceMeta {
  level: EvidenceLevel;
  text: string;
  short: string;
}

export const EVIDENCE: Record<EvidenceCode, EvidenceMeta> = {
  AMOUNT_MISMATCH: {
    level: "A",
    text: "The stated total does not equal the sum of the invoice's own line items.",
    short: "Stated total disagrees with the line items",
  },
  BENEFICIARY_ACCOUNT_NEVER_SEEN: {
    level: "A",
    text: "This vendor has a previously observed payout account, and this document requests a different one.",
    short: "Payout account not previously observed for this vendor",
  },
  PDF_ID_REVISION_MISMATCH: {
    level: "B",
    text: "The document's current revision differs from its original identifier. This does not establish how or when it was produced — ordinary tools cause this too.",
    short: "Revision differs from the original identifier",
  },
  IMAGE_COMPRESSION_INCONSISTENCY: {
    level: "C",
    text: "The page is a lossily recompressed raster. Corroborating only: this is expected of any legitimate scan and never escalates on its own.",
    short: "Lossily recompressed page raster (corroborating only)",
  },
  EXTRACTION_INCOMPLETE: {
    level: "safeguard",
    text: "Required fields could not be read reliably, so the semantic checks could not be evaluated. Escalated rather than assumed clean.",
    short: "Required fields could not be read reliably",
  },
};

/** An unrecognised code is reported as-is rather than glossed with a guess. */
export function describeEvidence(code: string): EvidenceMeta | null {
  return (EVIDENCE as Record<string, EvidenceMeta>)[code] ?? null;
}

export function levelLabel(level: EvidenceLevel): string {
  return level === "safeguard" ? "safeguard" : `level ${level}`;
}

/** Copy that qualifies each decision, so neither reads as more than it is. */
export const DECISION_NOTE = {
  CLEAR:
    "No material anomaly was detected by the configured checks. This is not a claim that the document is authentic.",
  REVIEW:
    "One or more findings need human attention. This is not a finding of fraud.",
} as const;

export const NO_VERDICT_NOTE =
  "The document could not be read, so no decision was produced. Nothing here suggests the document is fraudulent, only that it could not be analysed.";
