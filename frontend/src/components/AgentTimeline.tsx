import { CONDITIONAL_STAGES, STAGE_SEQUENCE } from "../hooks/useVerificationEvents";
import type { Stage, VerificationEvent } from "../lib/types";
import { Panel } from "./Panel";

/**
 * The stages to render for this run: the fixed sequence, plus any conditional
 * stage the server actually reported, inserted where it happened. A conditional
 * stage that did not occur is absent entirely rather than shown as skipped —
 * "AI extraction did not happen" is not a fact about a normal verification.
 */
function stagesToRender(
  seen: Map<Stage, VerificationEvent>,
): { stage: Stage; label: string }[] {
  const occurred = CONDITIONAL_STAGES.filter((stage) => seen.has(stage));
  if (occurred.length === 0) return STAGE_SEQUENCE;

  const rows = [...STAGE_SEQUENCE];
  if (seen.has("AI_EXTRACTION")) {
    const after = rows.findIndex((entry) => entry.stage === "ANALYZING");
    rows.splice(after + 1, 0, {
      stage: "AI_EXTRACTION",
      label: "AI-assisted extraction",
    });
  }
  return rows;
}

interface Props {
  seen: Map<Stage, VerificationEvent>;
  current: Stage | null;
  finished: boolean;
  /** Document label for this run, so the timeline has a subject. */
  subject?: string | null;
}

/**
 * A plain-language reading of each stage. The raw stage code stays visible
 * alongside it, so the timeline is legible without hiding the protocol.
 */
function interpret(stage: Stage, detail?: Record<string, unknown>): string {
  const read = (key: string): string => {
    const value = detail?.[key];
    return typeof value === "string" || typeof value === "number"
      ? String(value)
      : "";
  };

  switch (stage) {
    case "RECEIVED":
      return "Verification request received.";
    case "PAYMENT_REQUIRED":
      return "Verification payment required before analysis.";
    case "PAYING":
      return "Consuming agent authorized the payment.";
    case "ANALYZING":
      return "Document forensic checks are running.";
    case "AI_EXTRACTION":
      return "Some required fields could not be read directly, so AI-assisted extraction recovered them. The decision below comes from the same deterministic checks either way.";
    case "DECISION": {
      const decision = read("decision");
      return decision
        ? `Proofline returned ${decision}.`
        : "Proofline returned a decision.";
    }
    case "PAID":
      return "Verification payment confirmed on Hedera.";
    case "AGENT_ACTION": {
      const action = read("action");
      if (action === "PROCEED") return "Consuming agent released the invoice payment.";
      if (action === "HALT") return "Consuming agent halted processing.";
      if (action === "SKIP")
        return "Consuming agent suppressed a duplicate release.";
      return "Consuming agent acted on the decision.";
    }
    default:
      return "";
  }
}

// Small, safe per-stage technical detail. Never extracted document fields.
function describeDetail(stage: Stage, detail?: Record<string, unknown>): string {
  if (!detail) return "";
  const read = (key: string): string => {
    const value = detail[key];
    return typeof value === "string" || typeof value === "number"
      ? String(value)
      : "";
  };

  switch (stage) {
    case "RECEIVED":
      return read("route");
    case "PAYMENT_REQUIRED":
      return detail.price ? `${String(detail.price)} HBAR` : "";
    case "PAID":
      return read("transaction");
    case "DECISION":
      return read("decision");
    case "AGENT_ACTION":
      return read("action");
    default:
      return "";
  }
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return (
    date.toLocaleTimeString([], { hour12: false }) +
    "." +
    String(date.getMilliseconds()).padStart(3, "0")
  );
}

function isReviewStage(stage: Stage, detail?: Record<string, unknown>): boolean {
  if (!detail) return false;
  if (stage === "DECISION") return detail.decision === "REVIEW";
  if (stage === "AGENT_ACTION") return detail.action === "HALT";
  return false;
}

export function AgentTimeline({ seen, current, finished, subject }: Props) {
  const rows = stagesToRender(seen);
  const done = rows.filter((entry) => seen.has(entry.stage)).length;

  return (
    <Panel
      title="Event timeline"
      aside={
        <span className="font-mono text-[0.68rem] text-faint">
          {finished ? `${done}/${rows.length} events` : "live"}
        </span>
      }
    >
      {subject ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line pb-3.5">
          <span className="text-[0.66rem] uppercase tracking-[0.07em] text-faint">
            Document
          </span>
          <span className="wrap-break-word break-all font-mono text-[0.8rem] text-ink">
            {subject}
          </span>
        </div>
      ) : null}

      <ol className="timeline m-0 list-none p-0">
        {rows.map(({ stage, label }, index) => {
          const event = seen.get(stage);
          const isActive = !finished && stage === current && !event;
          const skipped = !event && !isActive && finished;
          const isReview = event ? isReviewStage(stage, event.detail) : false;

          const detail = event ? describeDetail(stage, event.detail) : "";
          const reading = event ? interpret(stage, event.detail) : "";
          const isLast = index === rows.length - 1;

          return (
            <li
              key={stage}
              // State markers are semantic hooks the capture suite asserts against, alongside the visual utilities.
              className={[
                event ? "done" : isActive ? "active" : skipped ? "skipped" : "pending",
                "grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-3.5 py-2.5",
                event ? "text-ink" : "text-faint",
                skipped ? "opacity-45" : "",
              ].join(" ")}
            >
              {/* Rail: the connector makes the sequence read as one process. */}
              <span className="relative flex h-full justify-center pt-[0.3rem]">
                <span
                  className={[
                    "size-1.5 shrink-0 rounded-full",
                    event
                      ? isReview
                        ? "bg-review"
                        : "bg-clear"
                      : isActive
                        ? "stage-pulse bg-review"
                        : "bg-line-strong",
                  ].join(" ")}
                />
                {!isLast ? (
                  <span
                    aria-hidden="true"
                    className={[
                      "absolute top-[0.85rem] bottom-[-0.65rem] w-px",
                      event ? "bg-line-strong" : "bg-line",
                    ].join(" ")}
                  />
                ) : null}
              </span>

              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="stage-name text-[0.83rem] font-medium">{label}</span>
                  <span className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-faint/85">
                    {stage}
                  </span>
                  {skipped ? (
                    <span className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-faint">
                      did not happen
                    </span>
                  ) : null}
                </span>

                {reading ? (
                  <span className="mt-1 block text-[0.81rem] leading-relaxed text-muted">
                    {reading}
                  </span>
                ) : null}

                {detail ? (
                  <span
                    className={[
                      "stage-detail mt-1 block wrap-break-word break-all font-mono text-[0.75rem]",
                      isReview ? "text-review" : "text-faint",
                    ].join(" ")}
                  >
                    {detail}
                  </span>
                ) : null}
              </span>

              <span className="stage-time whitespace-nowrap pt-[0.1rem] font-mono text-[0.72rem] text-faint">
                {event ? formatClock(event.ts) : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
