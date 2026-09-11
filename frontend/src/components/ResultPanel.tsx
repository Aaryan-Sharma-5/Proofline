import { hashscanUrl } from "../lib/api";
import {
  DECISION_NOTE,
  NO_VERDICT_NOTE,
  describeEvidence,
  levelLabel,
} from "../lib/evidence";
import type { AgentOutcome, DemoVerifyResponse, PaymentInfo } from "../lib/types";
import { Block, Panel } from "./Panel";

const DECISION_STYLES = {
  CLEAR: "text-clear bg-clear-bg",
  REVIEW: "text-review bg-review-bg",
  FAULT: "text-fault bg-fault-bg",
} as const;

export function ResultPanel({ result }: { result: DemoVerifyResponse }) {
  const verification = result.verification ?? {};
  const rejected = Boolean(!verification.decision && verification.error);

  return (
    <Panel title="Verification complete" id="panel-result">
      {rejected ? (
        <DecisionRow
          label="NO VERDICT"
          tone="FAULT"
          note={NO_VERDICT_NOTE}
          small
        />
      ) : verification.decision ? (
        <DecisionRow
          label={verification.decision}
          tone={verification.decision}
          note={DECISION_NOTE[verification.decision]}
        />
      ) : (
        <DecisionRow
          label="ERROR"
          tone="FAULT"
          note="The verification did not complete."
          small
        />
      )}

      <Block title="Evidence">
        {rejected ? (
          <ul id="evidence" className="m-0 list-none p-0">
            <li className="py-2">
              <span className="code font-mono text-[0.82rem] font-semibold">
                {verification.error}
              </span>
              <div className="explain mt-0.5 text-[0.89rem] text-muted">
                {verification.message
                  ? `Reported by the verification service: ${verification.message}.`
                  : "Reported by the verification service."}
              </div>
            </li>
          </ul>
        ) : (
          <EvidenceList codes={verification.evidence_codes ?? []} />
        )}
      </Block>

      <Block title="Agent action">
        <div id="agent">
          <AgentAction agent={result.agent} />
        </div>
      </Block>

      <Block title="Onchain proof">
        <OnchainProof
          payment={result.payment}
          verificationId={verification.verification_id ?? null}
          rejected={rejected}
        />
      </Block>
    </Panel>
  );
}

function DecisionRow({
  label,
  tone,
  note,
  small = false,
}: {
  label: string;
  tone: keyof typeof DECISION_STYLES;
  note: string;
  small?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
      <span
        id="decision"
        className={[
          "rounded-lg px-2.5 py-0.5 font-semibold tracking-[-0.02em]",
          small ? "text-[1.3rem]" : "text-[1.85rem]",
          DECISION_STYLES[tone],
        ].join(" ")}
      >
        {label}
      </span>
      <span
        id="decision-note"
        className="max-w-[34rem] text-[0.87rem] text-muted"
      >
        {note}
      </span>
    </div>
  );
}

function EvidenceList({ codes }: { codes: string[] }) {
  if (codes.length === 0) {
    return (
      <ul id="evidence" className="m-0 list-none p-0">
        <li className="text-[0.89rem] text-muted">
          No anomalies were recorded by the configured checks.
        </li>
      </ul>
    );
  }

  return (
    <ul id="evidence" className="m-0 list-none p-0">
      {codes.map((code) => {
        const meta = describeEvidence(code);
        return (
          <li key={code} className="border-t border-line py-2 first:border-t-0">
            <div>
              <span className="code font-mono text-[0.82rem] font-semibold">{code}</span>
              {meta ? (
                <span className="level ml-2 rounded border border-line px-1.5 align-[0.08em] font-mono text-[0.68rem] text-muted">
                  {levelLabel(meta.level)}
                </span>
              ) : null}
            </div>
            <div className="explain mt-0.5 text-[0.89rem] text-muted">
              {meta ? meta.text : "Reported by the verification service."}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function AgentAction({ agent }: { agent: AgentOutcome | null }) {
  if (!agent) {
    return (
      <div className="text-[0.87rem] italic text-muted">
        No agent action was recorded.
      </div>
    );
  }

  const headline =
    agent.action === "PROCEED"
      ? "Payment released"
      : agent.action === "SKIP"
        ? "Duplicate release suppressed"
        : "Payment halted, escalated for review";

  return (
    <>
      <div
        className={[
          "font-mono text-[0.84rem]",
          agent.downstreamPaymentReleased ? "text-clear" : "text-review",
        ].join(" ")}
      >
        {headline}
      </div>
      {agent.lines.slice(1).map((line, index) => (
        <div key={index} className="mt-1.5 text-[0.84rem] text-muted">
          {line.replace(/^\s*->\s*/, "")}
        </div>
      ))}
    </>
  );
}

function OnchainProof({
  payment,
  verificationId,
  rejected,
}: {
  payment: PaymentInfo | null;
  verificationId: string | null;
  rejected: boolean;
}) {
  if (!payment?.transaction) {
    return (
      <div id="proof" className="text-[0.87rem] italic text-muted">
        {rejected
          ? "No settled payment was reported: the analysis failed before settlement."
          : "No settled payment was reported for this run."}
      </div>
    );
  }

  return (
    <div id="proof" className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
      <Field label="Amount" value="0.02 HBAR" />
      {payment.payer ? <Field label="Payer" value={payment.payer} /> : null}
      <Field label="Transaction" value={payment.transaction} />
      <a
        className="hashscan font-medium underline underline-offset-2"
        href={payment.hashscan || hashscanUrl(payment.transaction)}
        target="_blank"
        rel="noopener noreferrer"
      >
        View on HashScan →
      </a>
      {verificationId ? <Field label="Verification" value={verificationId} /> : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[0.72rem] uppercase tracking-[0.07em] text-muted">
        {label}
      </div>
      <div className="break-all font-mono text-[0.8rem]">{value}</div>
    </div>
  );
}
