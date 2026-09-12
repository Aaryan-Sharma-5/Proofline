import { useEffect, useRef } from "react";

import { AgentTimeline } from "../components/AgentTimeline";
import { LatestVerification } from "../components/LatestVerification";
import { Block, Panel } from "../components/Panel";
import { ResultPanel } from "../components/ResultPanel";
import { useVerification } from "../hooks/useVerification";

const BUTTON =
  "rounded-[6px] border px-4 py-2.5 text-[0.845rem] font-medium transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-45";

const SECONDARY_BUTTON =
  `${BUTTON} border-line-strong bg-panel text-ink hover:bg-panel-2 hover:border-[#B7B3A8]`;

const PRIMARY_BUTTON =
  `${BUTTON} border-ink bg-ink text-white hover:bg-[#2E2F33]`;

export function Home() {
  const { phase, result, failure, label, events, verifySample, verifyUpload, busy } = useVerification();

  const fileRef = useRef<HTMLInputElement>(null);
  const autoRan = useRef(false);

  // Deep link from the landing CTAs. Runs the same sample path the buttons do.
  useEffect(() => {
    if (autoRan.current) return;
    const requested = new URLSearchParams(window.location.search).get("sample");
    if (requested !== "clear" && requested !== "review") return;

    autoRan.current = true;
    // Drop the query so a reload does not silently spend another payment.
    window.history.replaceState(null, "", "/app");
    void verifySample(requested);
  }, [verifySample]);

  return (
    <>
      <header>
        <div className="mb-1.5 flex items-baseline gap-3">
          <h1 className="text-[1.375rem] font-semibold tracking-[-0.01em]">Proofline</h1>
          <span className="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[0.68rem] text-faint">
            Hedera testnet
          </span>
        </div>
        <p className="text-[0.94rem] text-muted">Document integrity verification for AP agents</p>
        <p className="mt-2 max-w-[35rem] text-[0.81rem] leading-relaxed text-faint">
          Each run performs a real Hedera testnet payment through a server-side reference agent. No wallet needed.
        </p>
      </header>

      <div className="mt-9 flex flex-wrap items-center gap-2.5">
        <button
          id="btn-clear"
          disabled={busy}
          onClick={() => void verifySample("clear")}
          className={SECONDARY_BUTTON}
        >
          Try CLEAR sample
        </button>
        <button
          id="btn-review"
          disabled={busy}
          onClick={() => void verifySample("review")}
          className={SECONDARY_BUTTON}
        >
          Try REVIEW sample
        </button>

        <label htmlFor="file" className={`${PRIMARY_BUTTON} cursor-pointer`}>
          Upload your own
        </label>
        <input
          ref={fileRef}
          id="file"
          type="file"
          accept=".pdf,application/pdf"
          disabled={busy}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void verifyUpload(file);
            // Allows re-selecting the same file for a second run.
            if (fileRef.current) fileRef.current.value = "";
          }}
        />
        {label && phase !== "idle" ? (
          <span className="text-[0.85rem] text-muted">{label}</span>
        ) : null}
      </div>

      {/* Idle only: once a run starts, its own timeline and result are the subject. */}
      {phase === "idle" ? <LatestVerification /> : null}

      {phase !== "idle" ? (
        <AgentTimeline
          seen={events.seen}
          current={events.current}
          finished={events.finished}
        />
      ) : null}

      {phase === "complete" && result ? <ResultPanel result={result} /> : null}

      {phase === "failed" && failure ? (
        <Panel title="Verification complete" id="panel-result">
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
            <span
              id="decision"
              className="rounded-lg bg-fault-bg px-2.5 py-0.5 text-[1.3rem] font-semibold text-fault"
            >
              UNAVAILABLE
            </span>
            <span id="decision-note" className="max-w-[34rem] text-[0.87rem] text-muted">
              {failure.message}
            </span>
          </div>

          <Block title="Evidence">
            <ul id="evidence" className="m-0 list-none p-0">
              <li className="text-[0.89rem] text-muted">No verdict was produced.</li>
            </ul>
          </Block>

          <Block title="Agent action">
            {/* No verdict means no permission to pay. */}
            <div id="agent" className="font-mono text-[0.84rem] text-review">
              Payment halted, no verdict to act on
            </div>
          </Block>

          <Block title="Onchain proof">
            <div id="proof" className="text-[0.87rem] italic text-muted">
              No settled payment was reported for this run.
            </div>
          </Block>
        </Panel>
      ) : null}
    </>
  );
}
