import type { AgentOutcome } from "../lib/types";

const ACTION_COPY = {
  PROCEED: {
    status: "Proceeding",
    next: "Release the invoice payment",
    tone: "clear" as const,
  },
  HALT: {
    status: "Halted",
    next: "Escalate for human review",
    tone: "review" as const,
  },
  SKIP: {
    status: "Skipped",
    next: "No action; this document was already released",
    tone: "review" as const,
  },
};

/**
 * What the consuming agent did with the verification.
 *
 * Every field comes from the agent's own reported outcome. The reference agent
 * has no capabilities beyond deciding and recording a simulated release, so
 * nothing here implies a queue, an assignee, or an approval workflow that does
 * not exist. Its account and key material are never surfaced.
 */
export function AgentPanel({
  agent,
  reasons,
}: {
  agent: AgentOutcome | null;
  reasons: string[];
}) {
  if (!agent) {
    return (
      <div id="agent" className="text-[0.86rem] text-muted">
        No consuming-agent action was recorded for this run.
      </div>
    );
  }

  const copy = ACTION_COPY[agent.action];
  const toneText = copy.tone === "clear" ? "text-clear" : "text-review";

  // Detail lines the agent itself produced, minus its headline.
  const detail = agent.lines.slice(1).map((line) => line.replace(/^\s*->\s*/, ""));

  return (
    <div id="agent">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line pb-4">
        <span className="text-[0.86rem] font-medium text-ink">Reference AP agent</span>
        <span
          className={[
            "rounded-sm border px-2 py-0.5 font-mono text-[0.71rem] font-semibold tracking-[0.04em]",
            copy.tone === "clear"
              ? "border-clear-border bg-clear-bg text-clear"
              : "border-review-border bg-review-bg text-review",
          ].join(" ")}
        >
          {agent.action}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
        <dt className="text-[0.66rem] uppercase tracking-[0.07em] text-faint">Status</dt>
        <dd className={`m-0 font-mono text-[0.84rem] font-medium ${toneText}`}>
          {copy.status}
        </dd>

        {reasons.length > 0 ? (
          <>
            <dt className="text-[0.66rem] uppercase tracking-[0.07em] text-faint">
              Reason
            </dt>
            <dd className="m-0">
              {reasons.map((code) => (
                <div key={code} className="wrap-break-word break-all font-mono text-[0.8rem]">
                  {code}
                </div>
              ))}
            </dd>
          </>
        ) : null}

        <dt className="text-[0.66rem] uppercase tracking-[0.07em] text-faint">
          Next action
        </dt>
        <dd className="m-0 text-[0.86rem] text-ink">{copy.next}</dd>

        <dt className="text-[0.66rem] uppercase tracking-[0.07em] text-faint">
          Invoice payment
        </dt>
        <dd className={`m-0 font-mono text-[0.82rem] ${toneText}`}>
          {agent.downstreamPaymentReleased ? "RELEASED" : "NOT RELEASED"}
        </dd>
      </dl>

      {detail.length > 0 ? (
        <ul className="mt-4 list-none space-y-1.5 border-t border-line p-0 pt-4">
          {detail.map((line, index) => (
            <li key={index} className="text-[0.82rem] leading-relaxed text-muted">
              {line}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-4 border-t border-line pt-3.5 text-[0.76rem] leading-relaxed text-faint">
        The agent's execution metadata is not persisted by Proofline: whether an
        invoice payment actually ran belongs to the consuming system's own
        ledger, not to the verification record.
      </p>
    </div>
  );
}
