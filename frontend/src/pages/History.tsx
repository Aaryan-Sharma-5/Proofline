import { useEffect, useMemo, useState } from "react";

import { Button, LinkButton } from "../components/Button";
import { Field, Panel } from "../components/Panel";
import { fetchHistory, fetchVerification, hashscanUrl } from "../lib/api";
import { describeEvidence, levelLabel } from "../lib/evidence";
import type { Decision, VerificationDetail, VerificationListItem } from "../lib/types";

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

const TH =
  "px-3 py-2.5 text-left text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-faint";

type DecisionFilter = "ALL" | Decision;

export function History() {
  const [rows, setRows] = useState<VerificationListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<VerificationDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("ALL");
  const [evidenceFilter, setEvidenceFilter] = useState<string>("ALL");

  useEffect(() => {
    let cancelled = false;
    fetchHistory(50)
      .then((payload) => {
        if (!cancelled) setRows(payload.verifications);
      })
      .catch(() => {
        if (!cancelled) setError("Verification history is unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter options are derived from the rows actually returned, so the list can
  // never offer a filter that matches nothing in this dataset.
  const evidenceOptions = useMemo(() => {
    const codes = new Set<string>();
    for (const row of rows ?? []) for (const code of row.evidence_codes) codes.add(code);
    return Array.from(codes).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (decisionFilter !== "ALL" && row.decision !== decisionFilter) return false;
      if (evidenceFilter !== "ALL" && !row.evidence_codes.includes(evidenceFilter as never))
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
      setDetailError("Could not load this record.");
    }
  }

  return (
    <>
      <header className="border-b border-line pb-7">
        <h1 className="text-[1.5rem] font-semibold tracking-[-0.015em]">
          Verification history
        </h1>
        <p className="mt-2 max-w-[44rem] text-[0.94rem] leading-relaxed text-muted">
          Previous verifications performed by this service. These records contain
          no vendor names, beneficiary accounts, or extracted document fields;
          those are never stored.
        </p>
      </header>

      {error ? (
        <Panel title="History">
          <EmptyState
            title="History is unavailable"
            body="The verification history service did not respond. The verifier itself is unaffected."
            actions={<LinkButton href="/app">Open the verifier</LinkButton>}
          />
        </Panel>
      ) : null}

      {rows && rows.length === 0 ? (
        <Panel title="History">
          <EmptyState
            title="No verifications recorded yet"
            body="Every completed run is recorded here with its decision and evidence. Run a sample to create the first."
            actions={
              <>
                <LinkButton href="/app?sample=clear">Try CLEAR sample</LinkButton>
                <LinkButton href="/app?sample=review">Try REVIEW sample</LinkButton>
              </>
            }
          />
        </Panel>
      ) : null}

      {rows && rows.length > 0 ? (
        <Panel
          title="Records"
          aside={
            <span className="font-mono text-[0.68rem] text-faint">
              {filtered?.length ?? 0} of {rows.length}
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
                placeholder="Verification id or evidence code"
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
                Clear
              </Button>
            ) : null}
          </div>

          {filtered && filtered.length === 0 ? (
            <EmptyState
              title="No records match these filters"
              body="Every stored verification is still here; the current search and filters simply exclude them all."
              actions={<Button onClick={clearFilters}>Clear filters</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <caption className="sr-only">
                  Verification records, newest first. Select a row for masked detail.
                </caption>
                <thead>
                  <tr className="border-b border-line">
                    <th className={TH} scope="col">
                      Verification
                    </th>
                    <th className={TH} scope="col">
                      Decision
                    </th>
                    <th className={TH} scope="col">
                      Evidence
                    </th>
                    <th className={TH} scope="col">
                      Fee settlement
                    </th>
                    <th className={TH} scope="col">
                      Recorded
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(filtered ?? []).map((row) => (
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
                      <td className="break-all p-3 align-top font-mono text-[0.77rem]">
                        {row.verification_id}
                      </td>
                      <td className="p-3 align-top">
                        <DecisionChip decision={row.decision} />
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
                      <td className="p-3 align-top">
                        {row.payment_tx_id ? (
                          <a
                            href={hashscanUrl(row.payment_tx_id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="break-all font-mono text-[0.76rem] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
                          >
                            {row.payment_tx_id}
                          </a>
                        ) : (
                          <span
                            className="text-faint"
                            title="The analysis service does not receive the settled transaction id, so this column is not populated."
                          >
                            —
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap p-3 align-top text-[0.8rem] text-muted">
                        {formatWhen(row.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : null}

      {selected ? (
        <Panel
          title="Record detail (masked)"
          id="detail"
          aside={
            <Button tone="quiet" onClick={() => setSelected(null)}>
              Close
            </Button>
          }
        >
          {detailError ? (
            <EmptyState
              title="Could not load this record"
              body="The record may have been removed, or the history service is unavailable."
              actions={
                <Button onClick={() => void open(selected)}>Try again</Button>
              }
            />
          ) : detail ? (
            <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Verification" value={detail.verification_id} />
              <Field
                label="Decision"
                value={<DecisionChip decision={detail.decision} />}
                mono={false}
              />
              <Field label="Recorded" value={formatWhen(detail.created_at)} mono={false} />
              <Field label="Document hash" value={detail.document_hash} className="sm:col-span-2" />
              <Field label="Service version" value={detail.service_version} />

              <div className="min-w-0 sm:col-span-2 lg:col-span-3">
                <div className="mb-1.5 text-[0.66rem] uppercase tracking-[0.07em] text-faint">
                  Evidence
                </div>
                {detail.evidence_codes.length === 0 ? (
                  <div className="text-[0.85rem] text-muted">None recorded.</div>
                ) : (
                  <ul className="m-0 list-none space-y-3 p-0">
                    {detail.evidence_codes.map((code) => {
                      const meta = describeEvidence(code);
                      return (
                        <li key={code}>
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                            <span className="font-mono text-[0.8rem] font-semibold">
                              {code}
                            </span>
                            {meta ? (
                              <span className="whitespace-nowrap rounded-sm border border-line-strong px-1.5 py-0.5 font-mono text-[0.63rem] text-faint">
                                {levelLabel(meta.level)}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-[0.84rem] text-muted">
                            {meta?.short ?? "Reported by the verification service"}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="min-w-0 sm:col-span-2 lg:col-span-3">
                <div className="mb-1.5 text-[0.66rem] uppercase tracking-[0.07em] text-faint">
                  Fee settlement
                </div>
                {detail.payment_tx_id ? (
                  <a
                    href={hashscanUrl(detail.payment_tx_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all font-mono text-[0.79rem] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
                  >
                    {detail.payment_tx_id} — view on HashScan →
                  </a>
                ) : (
                  <div className="text-[0.84rem] text-muted">
                    Not recorded on this row. The analysis service never receives
                    the settled transaction id, so it cannot be stored here.
                  </div>
                )}
              </div>

              <Field
                label="Audit record"
                value={detail.hcs_message_id ?? "Not published; HCS is not implemented yet."}
                mono={Boolean(detail.hcs_message_id)}
                className="sm:col-span-2 lg:col-span-3"
              />

              <Field
                label="Vendor / beneficiary"
                value="Not stored. These fields are never retained."
                mono={false}
                className="sm:col-span-2 lg:col-span-3"
              />
            </div>
          ) : (
            <p className="text-[0.86rem] text-muted">Loading record…</p>
          )}
        </Panel>
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

/** Every empty state says why it is empty and what to do next (Section 15). */
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
