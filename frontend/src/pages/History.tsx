import { useEffect, useMemo, useRef, useState } from "react";

import { Button, LinkButton } from "../components/Button";
import { Panel } from "../components/Panel";
import { VerificationArtifact } from "../components/VerificationArtifact";
import { fetchHistory, fetchVerification } from "../lib/api";
import { describeEvidence } from "../lib/evidence";
import type { Decision, VerificationDetail, VerificationListItem } from "../lib/types";

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

const TH =
  "px-3 py-2.5 text-left text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-faint";

type DecisionFilter = "ALL" | Decision;
type LoadState = "loading" | "ready" | "error";

export function History() {
  const [rows, setRows] = useState<VerificationListItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [reloadKey, setReloadKey] = useState(0);

  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<VerificationDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);

  const [query, setQuery] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("ALL");
  const [evidenceFilter, setEvidenceFilter] = useState<string>("ALL");

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    fetchHistory(50)
      .then((payload) => {
        if (cancelled) return;
        setRows(payload.verifications);
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Filter options are derived from the rows actually returned, so the list can
  // never offer a filter that matches nothing in this dataset.
  const evidenceOptions = useMemo(() => {
    const codes = new Set<string>();
    for (const row of rows) for (const code of row.evidence_codes) codes.add(code);
    return Array.from(codes).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (decisionFilter !== "ALL" && row.decision !== decisionFilter) return false;
      if (
        evidenceFilter !== "ALL" &&
        !row.evidence_codes.includes(evidenceFilter as never)
      )
        return false;
      if (!needle) return true;
      return (
        row.verification_id.toLowerCase().includes(needle) ||
        row.evidence_codes.some((code) => code.toLowerCase().includes(needle))
      );
    });
  }, [rows, query, decisionFilter, evidenceFilter]);

  const filtersActive =
    query.trim() !== "" || decisionFilter !== "ALL" || evidenceFilter !== "ALL";

  function clearFilters() {
    setQuery("");
    setDecisionFilter("ALL");
    setEvidenceFilter("ALL");
  }

  async function open(id: string) {
    setSelected(id);
    setDetail(null);
    setDetailError(null);
    try {
      setDetail(await fetchVerification(id));
    } catch {
      setDetailError("Could not load this verification.");
    }
  }

  // The detail renders below a long list, so selecting a row would otherwise
  // update a region the reader cannot see. Honors reduced-motion.
  useEffect(() => {
    if (!selected) return;
    detailRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  }, [selected]);

  return (
    <>
      <header className="border-b border-line pb-6">
        <h1 className="text-[1.35rem] font-semibold tracking-[-0.012em]">
          Verification log
        </h1>
        {/* Scoped to the verification record deliberately: the separate vendor
            history the beneficiary check reads does hold vendor/account
            references, so an unqualified "nothing is stored" would be false. */}
        <p className="mt-2 max-w-[44rem] text-[0.92rem] leading-relaxed text-muted">
          Every verification this service has performed, newest first. On a
          verification record, vendor names, beneficiary accounts and extracted
          document fields are never stored. The vendor history used by the
          beneficiary check is held separately and is not exposed here.
        </p>
      </header>

      {loadState === "loading" ? (
        <Panel title="Verifications">
          <p className="py-8 text-center text-[0.86rem] text-muted">
            Loading verification log…
          </p>
        </Panel>
      ) : null}

      {loadState === "error" ? (
        <Panel title="Verifications">
          <EmptyState
            title="Proofline gateway is unavailable"
            body="The verification log could not be loaded. The verifier itself is unaffected."
            actions={
              <>
                <Button tone="primary" onClick={() => setReloadKey((k) => k + 1)}>
                  Retry
                </Button>
                <LinkButton href="/app">Verify a document</LinkButton>
              </>
            }
          />
        </Panel>
      ) : null}

      {loadState === "ready" && rows.length === 0 ? (
        <Panel title="Verifications">
          <EmptyState
            title="No verifications yet"
            body="Every completed verification is recorded here with its decision and evidence."
            actions={<LinkButton href="/app" tone="primary">Verify a document</LinkButton>}
          />
        </Panel>
      ) : null}

      {loadState === "ready" && rows.length > 0 ? (
        <Panel
          title="Verifications"
          aside={
            <span className="font-mono text-[0.68rem] text-faint">
              {filtered.length} of {rows.length}
            </span>
          }
        >
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 sm:max-w-[19rem]">
              <label
                htmlFor="history-search"
                className="mb-1.5 block text-[0.66rem] uppercase tracking-[0.07em] text-faint"
              >
                Search
              </label>
              <input
                id="history-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Verification ID or evidence code"
                className="w-full rounded-[6px] border border-line-strong bg-panel px-3 py-2 text-[0.83rem] text-ink placeholder:text-faint/80"
              />
            </div>

            <div>
              <label
                htmlFor="history-decision"
                className="mb-1.5 block text-[0.66rem] uppercase tracking-[0.07em] text-faint"
              >
                Decision
              </label>
              <select
                id="history-decision"
                value={decisionFilter}
                onChange={(event) =>
                  setDecisionFilter(event.target.value as DecisionFilter)
                }
                className="rounded-[6px] border border-line-strong bg-panel px-3 py-2 text-[0.83rem] text-ink"
              >
                <option value="ALL">All</option>
                <option value="CLEAR">CLEAR</option>
                <option value="REVIEW">REVIEW</option>
              </select>
            </div>

            {evidenceOptions.length > 0 ? (
              <div className="min-w-0">
                <label
                  htmlFor="history-evidence"
                  className="mb-1.5 block text-[0.66rem] uppercase tracking-[0.07em] text-faint"
                >
                  Evidence
                </label>
                <select
                  id="history-evidence"
                  value={evidenceFilter}
                  onChange={(event) => setEvidenceFilter(event.target.value)}
                  className="max-w-[16rem] rounded-[6px] border border-line-strong bg-panel px-3 py-2 font-mono text-[0.78rem] text-ink"
                >
                  <option value="ALL">All</option>
                  {evidenceOptions.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {filtersActive ? (
              <Button tone="quiet" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="No verifications match these filters"
              body="Every stored verification is still here; the current search and filters exclude them all."
              actions={<Button onClick={clearFilters}>Clear filters</Button>}
            />
          ) : (
            <>
              {/* Mobile: a table of five columns cannot fit 375px without
                  forcing the page to scroll sideways, so narrow screens get a
                  list built for them rather than a shrunken table. */}
              <ul className="m-0 list-none p-0 sm:hidden">
                {filtered.map((row) => (
                  <li key={row.verification_id}>
                    <button
                      type="button"
                      onClick={() => void open(row.verification_id)}
                      {...(selected === row.verification_id
                        ? { "aria-current": "true" as const }
                        : {})}
                      className="w-full border-b border-line px-1 py-3.5 text-left transition-colors duration-150 hover:bg-panel-2 aria-current:bg-panel-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <DecisionChip decision={row.decision} />
                        <span className="text-[0.75rem] text-faint">
                          {formatWhen(row.created_at)}
                        </span>
                      </div>
                      <div className="mt-2 break-all font-mono text-[0.74rem] text-muted">
                        {row.verification_id}
                      </div>
                      <div className="mt-1.5">
                        {row.evidence_codes.length === 0 ? (
                          <span className="text-[0.76rem] text-faint">
                            No evidence recorded
                          </span>
                        ) : (
                          row.evidence_codes.map((code) => (
                            <span
                              key={code}
                              className="block break-all font-mono text-[0.73rem] text-ink"
                            >
                              {code}
                            </span>
                          ))
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="hidden overflow-x-auto sm:block">
              <table className="w-full border-collapse">
                <caption className="sr-only">
                  Verifications, newest first. Select a row to view the full
                  verification.
                </caption>
                <thead>
                  <tr className="border-b border-line">
                    <th className={TH} scope="col">
                      Decision
                    </th>
                    <th className={TH} scope="col">
                      Verification
                    </th>
                    <th className={TH} scope="col">
                      Evidence
                    </th>
                    <th className={TH} scope="col">
                      Recorded
                    </th>
                    <th className={`${TH} text-right`} scope="col">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.verification_id}
                      tabIndex={0}
                      aria-selected={selected === row.verification_id}
                      onClick={() => void open(row.verification_id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void open(row.verification_id);
                        }
                      }}
                      className="cursor-pointer border-b border-line transition-colors duration-150 hover:bg-panel-2 aria-selected:bg-panel-2 aria-selected:shadow-[inset_2px_0_0_var(--color-ink)]"
                    >
                      <td className="p-3 align-top">
                        <DecisionChip decision={row.decision} />
                      </td>
                      <td className="break-all p-3 align-top font-mono text-[0.77rem]">
                        {row.verification_id}
                      </td>
                      <td className="p-3 align-top">
                        {row.evidence_codes.length === 0 ? (
                          <span className="text-[0.78rem] text-faint">none</span>
                        ) : (
                          row.evidence_codes.map((code) => (
                            <span
                              key={code}
                              className="block font-mono text-[0.75rem] text-muted"
                              title={describeEvidence(code)?.short ?? ""}
                            >
                              {code}
                            </span>
                          ))
                        )}
                      </td>
                      <td className="whitespace-nowrap p-3 align-top text-[0.8rem] text-muted">
                        {formatWhen(row.created_at)}
                      </td>
                      <td className="whitespace-nowrap p-3 text-right align-top">
                        <span
                          aria-hidden="true"
                          className="text-[0.78rem] font-medium text-muted"
                        >
                          View →
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </Panel>
      ) : null}

      {selected ? (
        <section
          ref={detailRef}
          className="mt-9 scroll-mt-20 border-t border-line pt-7"
          aria-live="polite"
        >
          <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint">
              Verification detail
            </h2>
            <Button tone="quiet" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>

          {detailError ? (
            <Panel title="Verification detail">
              <EmptyState
                title="Could not load this verification"
                body="The record may have been removed, or the gateway is unavailable."
                actions={
                  <Button tone="primary" onClick={() => void open(selected)}>
                    Retry
                  </Button>
                }
              />
            </Panel>
          ) : detail ? (
            <VerificationArtifact detail={detail} />
          ) : (
            <Panel title="Verification detail">
              <p className="py-6 text-center text-[0.86rem] text-muted">
                Loading verification…
              </p>
            </Panel>
          )}
        </section>
      ) : null}
    </>
  );
}

function DecisionChip({ decision }: { decision: Decision }) {
  return (
    <span
      className={[
        "inline-block rounded-sm border px-2 py-0.5 font-mono text-[0.71rem] font-semibold",
        decision === "CLEAR"
          ? "border-clear-border bg-clear-bg text-clear"
          : "border-review-border bg-review-bg text-review",
      ].join(" ")}
    >
      {decision}
    </span>
  );
}

/** Every empty state says why it is empty and what to do next. */
function EmptyState({
  title,
  body,
  actions,
}: {
  title: string;
  body: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="py-8 text-center">
      <p className="text-[0.95rem] font-medium text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-[30rem] text-[0.86rem] leading-relaxed text-muted">
        {body}
      </p>
      {actions ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
