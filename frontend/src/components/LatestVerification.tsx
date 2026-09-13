import { useEffect, useState } from "react";

import { fetchHistory } from "../lib/api";
import { describeEvidence, levelLabel } from "../lib/evidence";
import type { VerificationListItem } from "../lib/types";
import { Panel } from "./Panel";

/** Relative age, so the block reads as "latest" rather than as a raw log line. */
function formatAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function LatestVerification() {
  const [row, setRow] = useState<VerificationListItem | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The list is ordered newest first by the service, so one row is the latest.
    fetchHistory(1)
      .then((payload) => {
        if (!cancelled) setRow(payload.verifications[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A history outage must not put an error banner on the primary action screen.
  if (failed) return null;

  const evidence = row?.evidence_codes ?? [];
  const primary = evidence[0];
  const meta = primary ? describeEvidence(primary) : null;

  return (
    <Panel
      title="Latest verification"
      id="latest-verification"
      aside={
        row ? (
          <a
            href="/history"
            className="whitespace-nowrap text-[0.78rem] font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
          >
            View verification log →
          </a>
        ) : null
      }
    >
      {row === null ? (
        <p className="text-[0.86rem] text-muted">
          No verifications yet. Verify one of the samples to create the first.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-[auto_minmax(0,14rem)_minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="mb-1.5 text-[0.66rem] uppercase tracking-[0.07em] text-faint">
              Decision
            </div>
            <span
              className={[
                "inline-block rounded-sm border px-2 py-0.5 font-mono text-[0.71rem] font-semibold",
                row.decision === "CLEAR"
                  ? "border-clear-border bg-clear-bg text-clear"
                  : "border-review-border bg-review-bg text-review",
              ].join(" ")}
            >
              {row.decision}
            </span>
          </div>

          <div className="min-w-0">
            <div className="mb-1.5 text-[0.66rem] uppercase tracking-[0.07em] text-faint">
              Verification
            </div>
            <div className="break-all font-mono text-[0.78rem]">
              {row.verification_id}
            </div>
          </div>

          <div className="min-w-0">
            <div className="mb-1.5 text-[0.66rem] uppercase tracking-[0.07em] text-faint">
              Evidence
            </div>
            {primary ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {/* Evidence codes are single tokens: wrapping them mid-word
                    makes them unreadable, so they shrink instead. */}
                <span className="font-mono text-[0.74rem] leading-snug">{primary}</span>
                {meta ? (
                  <span className="whitespace-nowrap rounded-sm border border-line-strong px-1.5 font-mono text-[0.63rem] text-faint">
                    {levelLabel(meta.level)}
                  </span>
                ) : null}
                {evidence.length > 1 ? (
                  <span className="text-[0.76rem] text-muted">
                    +{evidence.length - 1} more
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="text-[0.78rem] text-muted">None recorded</div>
            )}
          </div>

          <div className="min-w-0">
            <div className="mb-1.5 text-[0.66rem] uppercase tracking-[0.07em] text-faint">
              Recorded
            </div>
            <div className="whitespace-nowrap font-mono text-[0.78rem]">
              {formatAge(row.created_at)}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
