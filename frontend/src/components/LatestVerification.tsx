import { useEffect, useState } from "react";

import { fetchHistory } from "../lib/api";
import { describeEvidence, levelLabel } from "../lib/evidence";
import type { VerificationListItem } from "../lib/types";

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
    <section
      id="latest-verification"
      aria-labelledby="latest-verification-heading"
      className="mt-8 rounded-[10px] border border-line bg-panel px-6 py-5"
    >
      <h2
        id="latest-verification-heading"
        className="mb-4 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint"
      >
        Latest verification
      </h2>

      {row === null ? (
        <p className="text-[0.87rem] text-muted">
          No verifications recorded yet. Run one of the samples above to create the first.
        </p>
      ) : (
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
          <div className="min-w-0">
            <div className="mb-1.5 text-[0.68rem] uppercase tracking-[0.06em] text-faint">
              Decision
            </div>
            <span
              className={[
                "inline-block rounded-sm border px-2 py-0.5 font-mono text-[0.72rem] font-semibold",
                row.decision === "CLEAR"
                  ? "border-clear-border bg-clear-bg text-clear"
                  : "border-review-border bg-review-bg text-review",
              ].join(" ")}
            >
              {row.decision}
            </span>
          </div>

          <div className="min-w-0">
            <div className="mb-1.5 text-[0.68rem] uppercase tracking-[0.06em] text-faint">
              Verification
            </div>
            <div className="break-all font-mono text-[0.8rem]">{row.verification_id}</div>
          </div>

          <div className="min-w-0">
            <div className="mb-1.5 text-[0.68rem] uppercase tracking-[0.06em] text-faint">
              Evidence
            </div>
            {primary ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="break-all font-mono text-[0.8rem]">{primary}</span>
                {meta ? (
                  <span className="whitespace-nowrap rounded border border-line-strong px-1.5 font-mono text-[0.66rem] text-faint">
                    {levelLabel(meta.level)}
                  </span>
                ) : null}
                {evidence.length > 1 ? (
                  <span className="text-[0.78rem] text-muted">
                    +{evidence.length - 1} more
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="text-[0.8rem] text-muted">None recorded</div>
            )}
          </div>

          <div className="min-w-0">
            <div className="mb-1.5 text-[0.68rem] uppercase tracking-[0.06em] text-faint">
              Recorded
            </div>
            <div className="whitespace-nowrap font-mono text-[0.8rem]">
              {formatAge(row.created_at)}
            </div>
          </div>

          {/* Full-row below the fields until there is width to pull it inline. */}
          <div className="w-full sm:ml-auto sm:w-auto sm:self-end">
            <a
              href="/history"
              className="whitespace-nowrap text-[0.82rem] font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
            >
              View verification history →
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
