import { STAGE_SEQUENCE } from "../hooks/useVerificationEvents";
import type { Stage, VerificationEvent } from "../lib/types";
import { Panel } from "./Panel";

interface Props {
  seen: Map<Stage, VerificationEvent>;
  current: Stage | null;
  finished: boolean;
  /** Document label for this run, so the timeline has a subject. */
  subject?: string | null;
}

/** Phase grouping, so seven stages read as four things happening. */
const STAGE_GROUP: Record<string, string> = {
  RECEIVED: "Request",
  PAYMENT_REQUIRED: "Payment",
  PAYING: "Payment",
  ANALYZING: "Analysis",
  DECISION: "Decision",
  PAID: "Settlement",
  AGENT_ACTION: "Agent",
};

// Small, safe per-stage detail. Never extracted document fields
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
  const done = STAGE_SEQUENCE.filter((entry) => seen.has(entry.stage)).length;

  return (
    <Panel
      title="Verification"
      aside={
        <span className="font-mono text-[0.68rem] text-faint">
          {finished ? `${done}/${STAGE_SEQUENCE.length} complete` : "live"}
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
        {STAGE_SEQUENCE.map(({ stage, label }, index) => {
          const event = seen.get(stage);
          const isActive = !finished && stage === current && !event;
          const skipped = !event && !isActive && finished;
          const isReview = event ? isReviewStage(stage, event.detail) : false;

          const detail = event ? describeDetail(stage, event.detail) : "";
          const group = STAGE_GROUP[stage] ?? "";
          const isLast = index === STAGE_SEQUENCE.length - 1;

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
                  {group ? (
                    <span className="font-mono text-[0.62rem] uppercase tracking-[0.07em] text-faint/80">
                      {group}
                    </span>
                  ) : null}
                  {skipped ? (
                    <span className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-faint">
                      did not happen
                    </span>
                  ) : null}
                </span>
                {detail ? (
                  <span
                    className={[
                      "stage-detail mt-1 block wrap-break-word break-all font-mono text-[0.76rem]",
                      isReview ? "text-review" : "text-muted",
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
