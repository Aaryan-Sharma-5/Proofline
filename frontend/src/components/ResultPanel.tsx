import { DECISION_NOTE, NO_VERDICT_NOTE } from "../lib/evidence";
import type { DemoVerifyResponse, ServiceHealth } from "../lib/types";
import { AgentPanel } from "./AgentPanel";
import { AuditPanel } from "./AuditPanel";
import { EvidenceList } from "./EvidenceList";
import { Panel } from "./Panel";
import { SettlementPanel, type PaymentStatus } from "./SettlementPanel";

const DECISION_STYLES = {
  CLEAR: "text-clear bg-clear-bg border-clear-border",
  REVIEW: "text-review bg-review-bg border-review-border",
  FAULT: "text-fault bg-fault-bg border-fault-border",
} as const;

/**
 * What each decision *requires*, not what was observed to happen.
 *
 * Kept identical in meaning to the history view's wording
 * (VerificationArtifact), so a verification does not read as one thing live and
 * another once persisted. What the agent actually did is reported separately in
 * the Consuming agent panel, which is the only place that claim belongs.
 */
const DECISION_CONSEQUENCE = {
  CLEAR: "Consuming agent may proceed",
  REVIEW: "Consuming agent must halt the invoice payment",
  FAULT: "Consuming agent has no decision to act on",
} as const;

interface Props {
  result: DemoVerifyResponse;
  /** Fee in HBAR as reported by the 402 challenge, null if not observed. */
  fee: string | null;
  health: ServiceHealth | null;
  paymentStatus: PaymentStatus;
  /** When the decision event arrived, for the metadata strip. */
  decidedAt: string | null;
}

export function ResultPanel({
  result,
  fee,
  health,
  paymentStatus,
  decidedAt,
}: Props) {
  const verification = result.verification ?? {};
  const rejected = Boolean(!verification.decision && verification.error);
  const codes = verification.evidence_codes ?? [];

  const tone: keyof typeof DECISION_STYLES = rejected
    ? "FAULT"
    : verification.decision
      ? verification.decision
      : "FAULT";

  const label = rejected ? "NO VERDICT" : (verification.decision ?? "ERROR");
  const note = rejected
    ? NO_VERDICT_NOTE
    : verification.decision
      ? DECISION_NOTE[verification.decision]
      : "The verification did not complete.";

  return (
    <>
      {/* 1. Decision, visually dominant: it is the product of the whole flow. */}
      <Panel title="Verification decision" id="panel-result" connectsDown>
        {/* Revealed when the real decision arrives, not while waiting for one. */}
        <div className="state-enter flex flex-wrap items-start gap-x-6 gap-y-4">
          <span
            id="decision"
            className={[
              "rounded-[7px] border px-4 py-2 font-mono text-[1.45rem] font-bold leading-none tracking-[0.03em] sm:text-[1.75rem]",
              DECISION_STYLES[tone],
            ].join(" ")}
          >
            {label}
          </span>

          <div className="min-w-0 flex-1">
            <div
              className={[
                "font-mono text-[0.76rem] font-semibold uppercase tracking-[0.08em]",
                tone === "CLEAR"
                  ? "text-clear"
                  : tone === "REVIEW"
                    ? "text-review"
                    : "text-fault",
              ].join(" ")}
            >
              → {DECISION_CONSEQUENCE[tone]}
            </div>
            <p
              id="decision-note"
              className="mt-2 max-w-[38rem] text-[0.85rem] leading-relaxed text-muted"
            >
              {note}
            </p>
          </div>
        </div>

        {verification.extraction_method === "llm_assisted" ? (
          <p className="mt-4 rounded-[6px] border border-line bg-panel-2 px-3 py-2.5 text-[0.8rem] leading-relaxed text-muted">
            <span className="font-medium text-ink">AI-assisted extraction used.</span>{" "}
            Some required fields could not be read directly from the document, so a
            model recovered them. Recovered values were validated and passed into
            the same deterministic checks used for every other verification — the
            model did not produce this decision.
          </p>
        ) : null}

        <MetadataStrip
          verificationId={verification.verification_id ?? null}
          decidedAt={decidedAt}
          serviceVersion={verification.service_version ?? null}
        />
      </Panel>

      {/* 2. Why this decision. */}
      <Panel
        title="Evidence"
        connected
        connectsDown
        aside={
          <span className="font-mono text-[0.68rem] text-faint">
            {rejected
              ? "1 finding"
              : `${codes.length} ${codes.length === 1 ? "finding" : "findings"}`}
          </span>
        }
      >
        {rejected ? (
          <ul id="evidence" className="m-0 list-none p-0">
            <li>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <span className="code font-mono text-[0.84rem] font-semibold">
                  {verification.error}
                </span>
                {/* Deliberately not an evidence level: this is a service error class, and labelling it LEVEL anything would imply a forensic finding that was never produced. */}
                <span className="level whitespace-nowrap rounded-sm border border-line-strong px-1.5 py-0.5 font-mono text-[0.64rem] tracking-[0.05em] text-faint">
                  SERVICE ERROR · NOT A FINDING
                </span>
              </div>
              <div className="mt-1.5 text-[0.82rem] font-medium text-ink">
                The document could not be analysed
              </div>
              <div className="explain mt-1 max-w-[44rem] text-[0.86rem] leading-relaxed text-muted">
                {verification.message
                  ? `Reported by the verification service: ${verification.message}.`
                  : "Reported by the verification service."}{" "}
                No forensic checks ran, so no evidence was produced either for or
                against this document.
              </div>
            </li>
          </ul>
        ) : (
          <EvidenceList codes={codes} />
        )}
      </Panel>

      {/* 3. Operational consequence. */}
      <Panel title="Consuming agent" connected connectsDown>
        <AgentPanel agent={result.agent} reasons={rejected ? [] : codes} />
      </Panel>

      {/* 4. What was actually paid for the verification itself. */}
      <Panel title="Verification payment" connected connectsDown>
        <SettlementPanel
          payment={result.payment}
          fee={fee}
          health={health}
          status={paymentStatus}
          rejected={rejected}
        />
      </Panel>

      {/* 5. Technical audit material, lowest priority in the reading order. */}
      <Panel title="Verification proof" connected>
        <AuditPanel
          facts={{
            verificationId: verification.verification_id ?? null,
            documentHash: verification.document_hash ?? null,
            decision: rejected ? null : (verification.decision ?? null),
            evidenceCodes: rejected ? [] : codes,
            timestamp: decidedAt,
            serviceVersion: verification.service_version ?? null,
          }}
        />
      </Panel>
    </>
  );
}

/** Compact technical identity for the decision, only where values exist. */
function MetadataStrip({
  verificationId,
  decidedAt,
  serviceVersion,
}: {
  verificationId: string | null;
  decidedAt: string | null;
  serviceVersion: string | null;
}) {
  const entries = [
    { label: "Verification", value: verificationId },
    { label: "Recorded", value: decidedAt },
    { label: "Service", value: serviceVersion },
  ].filter((entry) => Boolean(entry.value));

  if (entries.length === 0) return null;

  return (
    <dl className="mt-5 flex flex-wrap gap-x-7 gap-y-2 border-t border-line pt-4">
      {entries.map((entry) => (
        <div key={entry.label} className="flex min-w-0 items-baseline gap-2">
          <dt className="text-[0.64rem] uppercase tracking-[0.07em] text-faint">
            {entry.label}
          </dt>
          <dd className="m-0 wrap-break-word break-all font-mono text-[0.76rem] text-muted">
            {entry.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
