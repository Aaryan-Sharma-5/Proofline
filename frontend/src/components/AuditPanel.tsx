import { Field } from "./Panel";

export interface AuditFacts {
  verificationId?: string | null;
  documentHash?: string | null;
  decision?: string | null;
  evidenceCodes?: string[];
  timestamp?: string | null;
  serviceVersion?: string | null;
}

/**
 * Verification proof.
 *
 * Split deliberately into what is auditable now and what is not implemented,
 * so the absence of HCS reads as a precise product boundary rather than an
 * empty placeholder. No record is ever synthesised: fields the backend did not
 * return are shown as unavailable (CLAUDE.md Sections 13 and 14).
 */
export function AuditPanel({ facts }: { facts: AuditFacts }) {
  const known = [
    { label: "Verification ID", value: facts.verificationId, mono: true },
    { label: "Document hash", value: facts.documentHash, mono: true },
    { label: "Decision", value: facts.decision, mono: true },
    { label: "Recorded", value: facts.timestamp, mono: true },
    { label: "Service version", value: facts.serviceVersion, mono: true },
  ].filter((entry) => Boolean(entry.value));

  const codes = facts.evidenceCodes ?? [];

  return (
    <div id="audit">
      {known.length > 0 || codes.length > 0 ? (
        <>
          <h4 className="mb-3.5 font-mono text-[0.64rem] uppercase tracking-[0.09em] text-faint">
            Auditable now
          </h4>
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            {known.map((entry) => (
              <Field
                key={entry.label}
                label={entry.label}
                value={entry.value as string}
                className={entry.label === "Document hash" ? "sm:col-span-2" : ""}
              />
            ))}
            <Field
              label="Evidence codes"
              value={
                codes.length > 0 ? (
                  codes.join(", ")
                ) : (
                  <span className="font-sans text-[0.83rem] text-muted">
                    None recorded
                  </span>
                )
              }
              className="sm:col-span-2 lg:col-span-3"
            />
          </div>
        </>
      ) : (
        <p className="text-[0.86rem] text-muted">
          No verification record was produced for this run, so there is nothing
          to audit.
        </p>
      )}

      <div className="mt-6 border-t border-line pt-5">
        <h4 className="mb-2.5 font-mono text-[0.64rem] uppercase tracking-[0.09em] text-faint">
          HCS audit trail
        </h4>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="rounded-sm border border-line-strong bg-panel-2 px-2 py-0.5 font-mono text-[0.67rem] uppercase tracking-[0.07em] text-faint">
            Not enabled
          </span>
          <span className="max-w-[36rem] text-[0.83rem] leading-relaxed text-muted">
            Publishing verification records to a Hedera Consensus Service topic
            is not enabled in this deployment. The fields above are the
            auditable record for this verification.
          </span>
        </div>
      </div>
    </div>
  );
}
