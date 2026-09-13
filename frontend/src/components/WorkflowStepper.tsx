import type { RunPhase } from "../lib/types";
import type { Stage } from "../lib/types";

/**
 * A user-facing summary of where a verification has got to — not a claim that
 * the service emits exactly five events.
 *
 * The backend reports more stages than this (PAYMENT_REQUIRED and PAYING both
 * fold into "Payment"; DECISION and PAID both fold into "Decision", since x402
 * settles after the decision gate). The complete, uncollapsed stream is shown
 * separately in the event timeline with its raw stage codes. Each step's state
 * is derived from stages the server actually reported: never a timer, never
 * assumed.
 */
const STEPS = [
  { n: "01", label: "Document" },
  { n: "02", label: "Payment" },
  { n: "03", label: "Analysis" },
  { n: "04", label: "Decision" },
  { n: "05", label: "Action" },
] as const;

type StepState = "done" | "active" | "pending" | "skipped";

/** Maps the stage most recently reported by the server to a step index (0-4). */
function stepIndexForStage(stage: Stage | null): number {
  switch (stage) {
    case "RECEIVED":
      return 0;
    case "PAYMENT_REQUIRED":
    case "PAYING":
      return 1;
    case "ANALYZING":
      return 2;
    case "DECISION":
    case "PAID":
      return 3;
    case "AGENT_ACTION":
    case "AUDIT":
      return 4;
    default:
      return -1;
  }
}

interface Props {
  phase: RunPhase;
  furthestSeen: Stage | null;
  current: Stage | null;
  finished: boolean;
  failed: boolean;
  reached?: Set<Stage>;
}

export function WorkflowStepper({
  phase,
  furthestSeen,
  current,
  finished,
  failed,
  reached,
}: Props) {
  if (phase === "idle") {
    // Before any document is chosen, only step 1 is meaningfully "next".
    return (
      <ol className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Verification progress summary">
        {STEPS.map((step, index) => (
          <StepMarker key={step.n} step={step} state={index === 0 ? "active" : "pending"} />
        ))}
      </ol>
    );
  }

  const seenIndex = stepIndexForStage(furthestSeen);
  const currentIndex = stepIndexForStage(current);
  // Whichever is further along is the true progress marker.
  const activeIndex = finished ? STEPS.length : Math.max(seenIndex, currentIndex, 0);

  // Which steps the server genuinely reported. Absent a stage set (nothing to check against), fall back to position, which is what this did before.
  const confirmed = (index: number): boolean => {
    if (!reached) return index < activeIndex;
    for (const stage of reached) {
      if (stepIndexForStage(stage) === index) return true;
    }
    return false;
  };

  return (
    <ol className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Verification progress summary">
      {STEPS.map((step, index) => {
        let state: StepState = "pending";
        if (confirmed(index)) state = "done";
        else if (index === activeIndex && !finished) state = "active";
        // An ended stream cannot leave a step "pending": it either happened or it did not
        else if (finished) state = "skipped";

        return (
          <StepMarker
            key={step.n}
            step={step}
            state={state}
            failed={failed && index === activeIndex}
          />
        );
      })}
    </ol>
  );
}

function StepMarker({
  step,
  state,
  failed = false,
}: {
  step: { n: string; label: string };
  state: StepState;
  failed?: boolean;
}) {
  return (
    <li
      className="flex items-center gap-2"
      aria-current={state === "active" ? "step" : undefined}
    >
      <span
        aria-hidden="true"
        className={[
          "flex size-4.5 shrink-0 items-center justify-center rounded-full border font-mono text-[0.58rem] leading-none",
          failed
            ? "border-fault bg-fault-bg text-fault"
            : state === "done"
              ? "border-ink bg-ink text-white"
              : state === "active"
                ? "border-ink text-ink"
                : state === "skipped"
                  ? "border-dashed border-line-strong text-faint"
                  : "border-line-strong text-faint",
        ].join(" ")}
      >
        {/* A dash, never a tick: this step did not run. */}
        {failed ? step.n.replace(/^0/, "") : state === "done" ? "✓" : state === "skipped" ? "–" : step.n.replace(/^0/, "")}
      </span>
      <span
        className={[
          "font-mono text-[0.68rem] uppercase tracking-[0.07em]",
          failed
            ? "text-fault"
            : state === "pending"
              ? "text-faint"
              : state === "skipped"
                ? "text-faint line-through decoration-line-strong"
                : "text-ink",
        ].join(" ")}
      >
        {step.label}
        <span className="sr-only">
          {" "}
          {failed
            ? "(failed)"
            : state === "done"
              ? "(complete)"
              : state === "active"
                ? "(in progress)"
                : state === "skipped"
                  ? "(did not happen)"
                  : "(not started)"}
        </span>
      </span>
    </li>
  );
}
