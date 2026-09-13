export type Decision = "CLEAR" | "REVIEW";

export type EvidenceCode =
  | "AMOUNT_MISMATCH"
  | "BENEFICIARY_ACCOUNT_NEVER_SEEN"
  | "PDF_ID_REVISION_MISMATCH"
  | "IMAGE_COMPRESSION_INCONSISTENCY"
  | "EXTRACTION_INCOMPLETE";

export type EvidenceLevel = "A" | "B" | "C" | "safeguard";

export type ErrorCode =
  | "PAYMENT_REQUIRED"
  | "INVALID_DOCUMENT"
  | "EXTRACTION_INCOMPLETE"
  | "ANALYSIS_FAILED"
  | "SERVICE_UNAVAILABLE"
  | "NOT_FOUND";

export interface Verification {
  verification_id?: string | null;
  document_hash?: string;
  decision?: Decision;
  evidence_codes?: EvidenceCode[];
  service_version?: string;
  extraction_method?: ExtractionMethod;
  error?: ErrorCode;
  message?: string;
}

export interface PaymentInfo {
  transaction: string;
  network: string;
  hashscan: string;
  payer?: string;
}

export type AgentActionKind = "PROCEED" | "HALT" | "SKIP";

export interface AgentOutcome {
  action: AgentActionKind;
  downstreamPaymentReleased: boolean;
  lines: string[];
}

export interface DemoVerifyResponse {
  sample: string;
  verification: Verification;
  payment: PaymentInfo | null;
  agent: AgentOutcome | null;
  stages?: { stage: string; detail?: string }[];
}

export type Stage =
  | "RECEIVED"
  | "PAYMENT_REQUIRED"
  | "PAYING"
  | "ANALYZING"
  | "AI_EXTRACTION"
  | "DECISION"
  | "PAID"
  | "AGENT_ACTION"
  | "AUDIT"
  | "ERROR";

/**
 * How the document's required fields were read. Reported by the analysis
 * service for transparency; it is not evidence and takes no part in the
 * decision, which is produced by the same deterministic checks either way.
 */
export type ExtractionMethod = "deterministic" | "llm_assisted" | "incomplete";

export interface VerificationEvent {
  seq: number;
  stage: Stage;
  ts: string;
  verification_id?: string;
  detail?: Record<string, unknown>;
}

export interface VerificationStatus {
  verification_id: string | null;
  status: Stage;
  completed: boolean;
  event_count: number;
}

export interface VerificationListItem {
  verification_id: string;
  decision: Decision;
  evidence_codes: EvidenceCode[];
  created_at: string;
  payment_tx_id: string | null;
}

export interface VerificationListResponse {
  verifications: VerificationListItem[];
  count: number;
}

export interface VerificationDetail extends VerificationListItem {
  document_hash: string;
  service_version: string;
  hcs_message_id: string | null;
}

export type RunPhase = "idle" | "running" | "complete" | "failed";

/**
 * The gateway's own /health response. Every field is reported by the service;
 * none is inferred client-side.
 */
export interface ServiceHealth {
  status: string;
  network: string;
  facilitator: string;
  payTo: string;
}
