import { hashscanUrl } from "../lib/api";
import { DECISION_NOTE } from "../lib/evidence";
import type { VerificationDetail } from "../lib/types";
import { AuditPanel } from "./AuditPanel";
import { EvidenceList } from "./EvidenceList";
import { Field, Panel } from "./Panel";

const DECISION_STYLES = {
  CLEAR: "text-clear bg-clear-bg border-clear-border",
  REVIEW: "text-review bg-review-bg border-review-border",
} as const;

/**
 * What each decision *requires*, not what was observed to happen. A stored
 * record does not carry what the consuming agent actually did, so any past
 * tense here would be a claim this view cannot support.
 *
 * Worded identically to the live result (ResultPanel), so a verification does
 * not read as one thing live and another once persisted.
 */
const DECISION_CONSEQUENCE = {
  CLEAR: "Consuming agent may proceed",
  REVIEW: "Consuming agent must halt the invoice payment",
} as const;

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * A stored verification rendered in the same language as a live result, so
 * history reads as the same artifact rather than a second implementation.
 *
 * Everything a live run knows but a stored row does not — the consuming agent's
 * action, the payment transaction — is stated as unavailable rather than
 * omitted silently, since the reason is a real product boundary.
 */
export function VerificationArtifact({ detail }: { detail: VerificationDetail }) {
  return (
    <>
      <Panel title="Verification decision" id="detail" connectsDown>
        <div className="state-enter flex flex-wrap items-start gap-x-6 gap-y-4">
          <span
            className={[
              "rounded-[7px] border px-4 py-2 font-mono text-[1.3rem] font-bold leading-none tracking-[0.03em] sm:text-[1.55rem]",
              DECISION_STYLES[detail.decision],
            ].join(" ")}
          >
            {detail.decision}
          </span>
          <div className="min-w-0 flex-1">
            <div
              className={[
                "font-mono text-[0.74rem] font-semibold uppercase tracking-[0.08em]",
                detail.decision === "CLEAR" ? "text-clear" : "text-review",
              ].join(" ")}
            >
              → {DECISION_CONSEQUENCE[detail.decision]}
            </div>
            <p className="mt-2 max-w-[38rem] text-[0.85rem] leading-relaxed text-muted">
              {DECISION_NOTE[detail.decision]}
            </p>
          </div>
        </div>

        <dl className="mt-5 flex flex-wrap gap-x-7 gap-y-2 border-t border-line pt-4">
          <MetaItem label="Verification" value={detail.verification_id} />
          <MetaItem label="Recorded" value={formatWhen(detail.created_at)} />
          <MetaItem label="Service" value={detail.service_version} />
        </dl>
      </Panel>

      <Panel
        title="Evidence"
        connected
        connectsDown
        aside={
          <span className="font-mono text-[0.68rem] text-faint">
            {detail.evidence_codes.length}{" "}
            {detail.evidence_codes.length === 1 ? "finding" : "findings"}
          </span>
        }
      >
        <EvidenceList codes={detail.evidence_codes} />
      </Panel>

      <Panel title="Consuming agent" connected connectsDown>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="rounded-sm border border-line-strong bg-panel-2 px-2 py-0.5 font-mono text-[0.67rem] uppercase tracking-[0.07em] text-faint">
            Not persisted
          </span>
          <span className="max-w-[38rem] text-[0.83rem] leading-relaxed text-muted">
            What the consuming agent did with this decision is owned by that
            agent's own system, not by the verification record.
          </span>
        </div>
      </Panel>

      <Panel title="Verification payment" connected connectsDown>
        {detail.payment_tx_id ? (
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            <Field label="Transaction" value={detail.payment_tx_id} />
            <div className="self-end">
              <a
                href={hashscanUrl(detail.payment_tx_id)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
              >
                View on HashScan →
              </a>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="rounded-sm border border-line-strong bg-panel-2 px-2 py-0.5 font-mono text-[0.67rem] uppercase tracking-[0.07em] text-faint">
              Not persisted
            </span>
            <span className="max-w-[38rem] text-[0.83rem] leading-relaxed text-muted">
              The analysis service never receives the settled transaction id, so
              it is not stored on the verification record.
            </span>
          </div>
        )}
      </Panel>

      <Panel title="Verification proof" connected>
        <AuditPanel
          facts={{
            verificationId: detail.verification_id,
            documentHash: detail.document_hash,
            decision: detail.decision,
            evidenceCodes: detail.evidence_codes,
            timestamp: formatWhen(detail.created_at),
            serviceVersion: detail.service_version,
          }}
        />
      </Panel>
    </>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="text-[0.64rem] uppercase tracking-[0.07em] text-faint">{label}</dt>
      <dd className="m-0 wrap-break-word break-all font-mono text-[0.76rem] text-muted">
        {value}
      </dd>
    </div>
  );
}
