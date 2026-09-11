import { STAGE_SEQUENCE } from "../hooks/useVerificationEvents";
import type { Stage, VerificationEvent } from "../lib/types";
import { Panel } from "./Panel";

interface Props {
  seen: Map<Stage, VerificationEvent>;
  current: Stage | null;
  finished: boolean;
}

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

export function AgentTimeline({ seen, current, finished }: Props) {
  return (
    <Panel title="Verification">
      <ol className="timeline m-0 list-none p-0">
        {STAGE_SEQUENCE.map(({ stage, label }) => {
          const event = seen.get(stage);
          const isActive = !finished && stage === current && !event;
          const skipped = !event && !isActive && finished;

          const detail = event ? describeDetail(stage, event.detail) : "";

          return (
            <li
              key={stage}
              // State markers are semantic hooks the capture suite asserts against, alongside the visual utilities.
              className={[
                event ? "done" : isActive ? "active" : skipped ? "skipped" : "pending",
                "grid grid-cols-[1.1rem_1fr_auto] items-baseline gap-x-3 py-1.5",
                event ? "text-ink" : "text-muted",
                skipped ? "opacity-45" : "",
              ].join(" ")}
            >
              <span
                className={[
                  "size-2 justify-self-center self-center rounded-full",
                  event
                    ? "bg-clear"
                    : isActive
                      ? "stage-pulse bg-review"
                      : "bg-line",
                ].join(" ")}
              />
              <span>
                <span className="stage-name font-mono text-[0.82rem]">{label}</span>
                {detail ? (
                  <span className="stage-detail mt-0.5 block break-all text-[0.8rem] text-muted">
                    {detail}
                  </span>
                ) : null}
              </span>
              <span className="stage-time font-mono text-[0.74rem] text-muted">
                {event ? formatClock(event.ts) : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
