import { useEffect, useState } from "react";

import { fetchHistory, fetchVerification, hashscanUrl } from "../lib/api";
import { describeEvidence } from "../lib/evidence";
import type { VerificationDetail, VerificationListItem } from "../lib/types";

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

const TH =
  "px-3 py-2.5 text-left text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint border-b border-line";

export function History() {
  const [rows, setRows] = useState<VerificationListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<VerificationDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

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
      <header>
        <h1 className="mb-1 text-[1.375rem] font-semibold tracking-[-0.01em]">
          Verification history
        </h1>
        <p className="text-[0.94rem] text-muted">Previous verifications performed by this service</p>
      </header>

      <nav className="mt-6 flex gap-4 text-[0.87rem]">
        <a href="/" className="text-muted hover:text-ink">
          Verify a document
        </a>
        <a
          href="/history"
          aria-current="page"
          className="border-b border-ink pb-0.5 text-ink"
        >
          History
        </a>
        <a href="/docs" className="text-muted hover:text-ink">
          API documentation
        </a>
      </nav>

      <p className="mt-6 rounded-[10px] border border-line bg-panel-2 px-4 py-3 text-[0.84rem] leading-relaxed text-muted">
        These records contain no vendor names, beneficiary accounts, or extracted document fields; those are never stored. Uploaded documents are analysed and deleted; only the decision, its evidence, and a content hash are retained.
      </p>

      {error ? <p className="py-8 text-center text-muted">{error}</p> : null}

      {rows && rows.length === 0 ? (
        <p className="py-8 text-center text-muted">No verifications recorded yet.</p>
      ) : null}

      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="mt-5 w-full border-collapse">
            <thead>
              <tr>
                <th className={TH}>Verification</th>
                <th className={TH}>Decision</th>
                <th className={TH}>Evidence</th>
                <th className={TH}>Payment</th>
                <th className={TH}>When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
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
                  className="cursor-pointer hover:bg-panel-2 aria-selected:bg-panel-2"
                >
                  <td className="break-all border-b border-line p-3 align-top font-mono text-[0.78rem]">
                    {row.verification_id}
                  </td>
                  <td className="border-b border-line p-3 align-top">
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
                  </td>
                  <td className="border-b border-line p-3 align-top font-mono text-[0.76rem] text-muted">
                    {row.evidence_codes.length === 0 ? (
                      <span>none</span>
                    ) : (
                      row.evidence_codes.map((code) => (
                        <span
                          key={code}
                          className="block"
                          title={describeEvidence(code)?.short ?? ""}
                        >
                          {code}
                        </span>
                      ))
                    )}
                  </td>
                  <td className="border-b border-line p-3 align-top">
                    {row.payment_tx_id ? (
                      <a
                        href={hashscanUrl(row.payment_tx_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="break-all font-mono text-[0.78rem] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
                      >
                        {row.payment_tx_id}
                      </a>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap border-b border-line p-3 align-top text-[0.82rem] text-muted">
                    {formatWhen(row.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {selected ? (
        <section
          id="detail"
          className="mt-6 rounded-[10px] border border-line bg-panel px-6 py-5"
        >
          <h2 className="mb-4 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint">
            Record detail (masked)
          </h2>

          {detailError ? (
            <p className="text-muted">{detailError}</p>
          ) : detail ? (
            <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2">
              <Term>Verification</Term>
              <Def>{detail.verification_id}</Def>

              <Term>Decision</Term>
              <Def>{detail.decision}</Def>

              <Term>Evidence</Term>
              <Def>
                {detail.evidence_codes.length === 0
                  ? "none recorded"
                  : detail.evidence_codes.map((code) => (
                      <div key={code}>
                        <div>{code}</div>
                        <div className="font-sans text-[0.82rem] text-muted">
                          {describeEvidence(code)?.short ??
                            "Reported by the verification service"}
                        </div>
                      </div>
                    ))}
              </Def>

              <Term>Document hash</Term>
              <Def>{detail.document_hash}</Def>

              <Term>Payment</Term>
              <Def>
                {detail.payment_tx_id ? (
                  <a
                    href={hashscanUrl(detail.payment_tx_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
                  >
                    {detail.payment_tx_id} — view on HashScan →
                  </a>
                ) : (
                  "not recorded on this row"
                )}
              </Def>

              <Term>Recorded</Term>
              <Def>{formatWhen(detail.created_at)}</Def>

              <Term>Service version</Term>
              <Def>{detail.service_version}</Def>

              <Term>Audit record</Term>
              <Def>{detail.hcs_message_id ?? "not published"}</Def>

              <Term>Vendor / beneficiary</Term>
              <Def>not stored; these fields are never retained</Def>
            </dl>
          ) : (
            <p className="text-muted">Loading…</p>
          )}
        </section>
      ) : null}
    </>
  );
}

function Term({ children }: { children: React.ReactNode }) {
  return <dt className="text-[0.78rem] text-muted">{children}</dt>;
}

function Def({ children }: { children: React.ReactNode }) {
  return <dd className="m-0 break-all font-mono text-[0.8rem]">{children}</dd>;
}
