const STEPS = [
  { label: "Document", note: "Invoice arrives" },
  { label: "Agent", note: "Needs assurance" },
  { label: "x402", note: "Pays for the check" },
  { label: "Proofline", note: "Analyses" },
  { label: "Evidence", note: "Named findings" },
] as const;

/**
 * Oversized numerals and hairline rules carry the sequence; no icon set.
 * Five linear steps, then the branch, which is the part that matters.
 */
export function ProductFlow() {
  return (
    <div>
      <ol className="m-0 grid list-none grid-cols-1 gap-0 p-0 sm:grid-cols-2 lg:grid-cols-5">
        {STEPS.map((step, index) => (
          <li
            key={step.label}
            className={[
              // Mobile: number in a fixed gutter beside the text, so the
              // sequence scans vertically. Desktop: stacked columns.
              "relative grid grid-cols-[2.75rem_1fr] items-baseline gap-x-4 border-line py-5",
              "border-t sm:py-6 lg:block lg:border-t-0 lg:border-l lg:py-0 lg:pl-6",
              index === 0 ? "lg:border-l-0 lg:pl-0" : "",
            ].join(" ")}
          >
            <span
              aria-hidden="true"
              className="font-mono text-[1.75rem] font-normal leading-none tracking-[-0.03em] text-line-strong lg:block lg:text-[2rem] lg:font-light"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0">
              <span className="block text-[1rem] font-semibold leading-snug tracking-[-0.005em] text-ink lg:mt-4 lg:text-[0.95rem] lg:font-medium lg:tracking-normal">
                {step.label}
              </span>
              <span className="mt-1 block text-[0.8rem] leading-snug text-faint lg:mt-1.5">
                {step.note}
              </span>
            </span>
          </li>
        ))}
      </ol>

      <Branch />
    </div>
  );
}

/**
 * The terminal relationship: the decision determines what the agent does.
 * Two outcomes, semantically coloured, never decorative.
 */
function Branch() {
  return (
    <div className="mt-10 border-t border-line-strong pt-8">
      <p className="font-mono text-[0.64rem] uppercase tracking-[0.12em] text-faint">
        06 — Decision determines the action
      </p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Outcome
          decision="CLEAR"
          action="PROCEED"
          note="No material anomaly detected. The agent releases the payment."
          tone="clear"
        />
        <Outcome
          decision="REVIEW"
          action="HALT"
          note="A finding needs human attention. The agent holds the payment."
          tone="review"
        />
      </div>
    </div>
  );
}

function Outcome({
  decision,
  action,
  note,
  tone,
}: {
  decision: string;
  action: string;
  note: string;
  tone: "clear" | "review";
}) {
  const accent = tone === "clear" ? "text-clear" : "text-review";
  const frame =
    tone === "clear"
      ? "border-clear-border bg-clear-bg/50"
      : "border-review-border bg-review-bg/50";

  return (
    <div className={`rounded-[10px] border px-5 py-5 ${frame}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`font-mono text-[1.05rem] font-bold tracking-[0.04em] ${accent}`}>
          {decision}
        </span>
        <span aria-hidden="true" className={`font-mono text-[0.95rem] ${accent}`}>
          →
        </span>
        <span className={`font-mono text-[1.05rem] font-bold tracking-[0.04em] ${accent}`}>
          {action}
        </span>
      </div>
      <p className="mt-2.5 text-[0.82rem] leading-relaxed text-muted">{note}</p>
    </div>
  );
}
