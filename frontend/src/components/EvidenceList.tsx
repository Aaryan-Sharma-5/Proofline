import { useState } from "react";

import { describeEvidence, levelLabel } from "../lib/evidence";

/**
 * Evidence is the product's core differentiator, so each finding gets a code, a
 * short human title, a plain-language explanation, and its relevance class.
 *
 * The level shown is the one the project's own evidence hierarchy defines
 * (CLAUDE.md Section 8); it is a fixed property of the code, not a severity
 * score returned per-run by the API, and it is labelled accordingly.
 */
export function EvidenceList({ codes }: { codes: string[] }) {
  if (codes.length === 0) {
    return (
      <ul id="evidence" className="m-0 list-none p-0">
        <li className="text-[0.87rem] text-muted">
          No anomalies were recorded by the configured checks.
        </li>
      </ul>
    );
  }

  return (
    <ul id="evidence" className="m-0 list-none p-0">
      {codes.map((code) => (
        <EvidenceRow key={code} code={code} />
      ))}
    </ul>
  );
}

function EvidenceRow({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const meta = describeEvidence(code);
  const isCorroborating = meta?.level === "B" || meta?.level === "C";

  return (
    <li className="border-t border-line py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="code font-mono text-[0.84rem] font-semibold">{code}</span>
        {meta ? (
          <span className="level whitespace-nowrap rounded-sm border border-line-strong px-1.5 py-0.5 font-mono text-[0.64rem] tracking-[0.05em] text-faint">
            {levelLabel(meta.level)}
          </span>
        ) : null}
      </div>

      {meta ? (
        <div className="mt-1.5 text-[0.82rem] font-medium text-ink">{meta.short}</div>
      ) : null}

      <div className="explain mt-1 max-w-[44rem] text-[0.86rem] leading-relaxed text-muted">
        {meta ? meta.text : "Reported by the verification service."}
      </div>

      {meta ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-[4px] border border-line-strong bg-panel-2 px-2 py-1 text-[0.75rem] font-medium text-muted transition-colors duration-150 hover:border-ink hover:text-ink"
          >
            <span aria-hidden="true" className="font-mono text-[0.66rem]">
              {open ? "−" : "+"}
            </span>
            {open ? "Hide basis" : "Why this matters"}
          </button>

          {open ? (
            <div className="mt-3 border-l-2 border-line-strong pl-4 text-[0.82rem] leading-relaxed text-muted">
              <p className="m-0">
                {isCorroborating
                  ? "This finding corroborates other evidence but cannot escalate a verification on its own. A second tool touching a document after creation, or a legitimate rescan, produces this routinely."
                  : "This is a direct inconsistency in the document's own content. A finding at this level can escalate a verification on its own."}
              </p>
              <p className="m-0 mt-2 font-mono text-[0.72rem] text-faint">
                Basis: {LEVEL_BASIS[meta.level]}
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

/** Where each class of finding comes from, per the engine's own check groups. */
const LEVEL_BASIS: Record<string, string> = {
  A: "semantic comparison of extracted document fields",
  B: "PDF structural and provenance inspection",
  C: "page raster compression characteristics",
  safeguard: "extraction completeness check",
};
