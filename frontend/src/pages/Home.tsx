import { useRef } from "react";

import { AgentTimeline } from "../components/AgentTimeline";
import { Block, Panel } from "../components/Panel";
import { ResultPanel } from "../components/ResultPanel";
import { useVerification } from "../hooks/useVerification";

const BUTTON =
  "rounded-[7px] border px-4 py-2.5 font-medium transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-45";

export function Home() {
  const { phase, result, failure, label, events, verifySample, verifyUpload, busy } = useVerification();

  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <header>
        <h1 className="mb-1 text-2xl font-bold tracking-[-0.015em]">Proofline</h1>
        <p className="text-muted">Document integrity verification for AP agents</p>
        <p className="mt-2 text-[0.82rem] text-muted">
          Each run performs a real Hedera testnet payment through a server-side reference agent. No wallet needed.
        </p>
      </header>

      <div className="mt-8 flex flex-wrap items-center gap-2.5">
        <button
          id="btn-clear"
          disabled={busy}
          onClick={() => void verifySample("clear")}
          className={`${BUTTON} border-accent bg-accent text-bg hover:opacity-90`}
        >
          Try CLEAR sample
        </button>
        <button
          id="btn-review"
          disabled={busy}
          onClick={() => void verifySample("review")}
          className={`${BUTTON} border-accent bg-accent text-bg hover:opacity-90`}
        >
          Try REVIEW sample
        </button>

        <label
          htmlFor="file"
          className={`${BUTTON} cursor-pointer border-line bg-panel hover:border-muted`}
        >
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
