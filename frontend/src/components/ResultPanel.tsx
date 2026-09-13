import {
  DECISION_NOTE,
  NO_VERDICT_NOTE,
  describeEvidence,
  levelLabel,
} from "../lib/evidence";
import type { DemoVerifyResponse, ServiceHealth } from "../lib/types";
import { AgentPanel } from "./AgentPanel";
import { AuditPanel } from "./AuditPanel";
import { Panel } from "./Panel";
import { SettlementPanel } from "./SettlementPanel";

const DECISION_STYLES = {
  CLEAR: "text-clear bg-clear-bg border-clear-border",
  REVIEW: "text-review bg-review-bg border-review-border",
  FAULT: "text-fault bg-fault-bg border-fault-border",
} as const;

/** The consequence of each decision, stated as the agent's actual constraint. */
const DECISION_CONSEQUENCE = {
  CLEAR: "Agent may proceed",
  REVIEW: "Agent halted payment",
  FAULT: "Agent has no verdict to act on",
} as const;

interface Props {
  result: DemoVerifyResponse;
  /** Fee in HBAR as reported by the 402 challenge, null if not observed. */
  fee: string | null;
  health: ServiceHealth | null;
}

export function ResultPanel({ result, fee, health }: Props) {
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
      {/* Decision first and largest: it is the product of the whole flow. */}
      <Panel title="Decision" id="panel-result" step="01" connectsDown>
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
                tone === "CLEAR" ? "text-clear" : tone === "REVIEW" ? "text-review" : "text-fault",
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
      </Panel>

      <Panel
        title="Evidence"
        step="02"
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
              <span className="code font-mono text-[0.82rem] font-semibold">
                {verification.error}
              </span>
              <div className="explain mt-1 text-[0.87rem] leading-relaxed text-muted">
                {verification.message
                  ? `Reported by the verification service: ${verification.message}.`
                  : "Reported by the verification service."}
              </div>
            </li>
          </ul>
        ) : (
          <EvidenceList codes={codes} />
        )}
      </Panel>

      <Panel title="Agent action" step="03" connected connectsDown>
        <AgentPanel agent={result.agent} reasons={rejected ? [] : codes} />
      </Panel>

      <Panel title="Verification fee" step="04" connected connectsDown>
        <SettlementPanel
          payment={result.payment}
          verificationId={verification.verification_id ?? null}
          fee={fee}
          health={health}
          rejected={rejected}
        />
      </Panel>

      <Panel title="Audit record" step="05" connected>
        <AuditPanel />
      </Panel>
    </>
  );
}

function EvidenceList({ codes }: { codes: string[] }) {
  if (codes.length === 0) {
    return (
      <ul id="evidence" className="m-0 list-none p-0">
        <li className="text-[0.87rem] text-muted">
          No anomalies were recorded by the configured checks.
        </li>
      </ul>
    );
  }

  return (
    <ul id="evidence" className="m-0 list-none p-0">
      {codes.map((code) => {
        const meta = describeEvidence(code);
        const isCorroborating = meta?.level === "B" || meta?.level === "C";

        return (
          <li
            key={code}
            className="border-t border-line py-4 first:border-t-0 first:pt-0 last:pb-0"
          >
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <span className="code font-mono text-[0.84rem] font-semibold">{code}</span>
              {meta ? (
                <span className="level whitespace-nowrap rounded-sm border border-line-strong px-1.5 py-0.5 font-mono text-[0.64rem] tracking-[0.05em] text-faint">
                  {levelLabel(meta.level)}
                </span>
              ) : null}
            </div>

            {meta ? (
              <div className="mt-1.5 text-[0.82rem] font-medium text-ink">
                {meta.short}
              </div>
            ) : null}

            <div className="explain mt-1 max-w-[44rem] text-[0.86rem] leading-relaxed text-muted">
              {meta ? meta.text : "Reported by the verification service."}
            </div>

            {isCorroborating ? (
              <div className="mt-2 font-mono text-[0.68rem] uppercase tracking-[0.06em] text-faint">
                Corroborating only · cannot escalate alone
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
