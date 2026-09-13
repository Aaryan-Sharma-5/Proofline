import { useEffect, useRef } from "react";

import { AgentTimeline } from "../components/AgentTimeline";
import { Button } from "../components/Button";
import { LatestVerification } from "../components/LatestVerification";
import { Field, Panel } from "../components/Panel";
import { ResultPanel } from "../components/ResultPanel";
import { UploadZone } from "../components/UploadZone";
import {
  facilitatorLabel,
  formatNetwork,
  useServiceStatus,
} from "../hooks/useServiceStatus";
import { useVerification } from "../hooks/useVerification";
import { feeFromEvents } from "../hooks/useVerificationEvents";
import type { ServiceHealth } from "../lib/types";

export function Home() {
  const {
    phase,
    result,
    failure,
    label,
    events,
    verifySample,
    verifyUpload,
    busy,
    reset,
  } = useVerification();

  const { health } = useServiceStatus();
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

  const fee = feeFromEvents(events.seen);

  return (
    <>
      <header className="border-b border-line pb-7">
        <h1 className="text-[1.5rem] font-semibold tracking-[-0.015em]">
          Verification workspace
        </h1>
        <p className="mt-2 max-w-[44rem] text-[0.94rem] leading-relaxed text-muted">
          Submit a financial document for a deterministic, evidence-backed
          integrity decision. Each run performs a real Hedera testnet payment
          through a server-side reference agent, so no wallet is needed.
        </p>
      </header>

      {/* Two columns from 900px up: the capture viewport and a small laptop both
          sit below Tailwind's lg, where a single column wastes the width. */}
      <div className="mt-7 grid grid-cols-1 items-start gap-6 min-[900px]:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
        {/* Left rail: the request context. What goes in. */}
        <div className="min-[900px]:sticky min-[900px]:top-20">
          <Panel title="Submit a document" className="mt-0">
            <div className="flex flex-col gap-2.5">
              <Button
                id="btn-clear"
                disabled={busy}
                onClick={() => void verifySample("clear")}
                className="w-full"
              >
                Try CLEAR sample
              </Button>
              <Button
                id="btn-review"
                disabled={busy}
                onClick={() => void verifySample("review")}
                className="w-full"
              >
                Try REVIEW sample
              </Button>
              <p className="text-[0.75rem] leading-relaxed text-faint">
                Two bundled invoices: a clean baseline, and one requesting a
                payout account this vendor has not used before.
              </p>
            </div>

            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="font-mono text-[0.64rem] uppercase tracking-[0.08em] text-faint">
                or
              </span>
              <span className="h-px flex-1 bg-line" />
            </div>

            <UploadZone onSubmit={(file) => void verifyUpload(file)} disabled={busy} />

            <p className="mt-4 border-t border-line pt-3.5 text-[0.76rem] leading-relaxed text-faint">
              Documents are analysed and deleted. Only the decision, its
              evidence, and a content hash are retained.
            </p>
          </Panel>

          {phase !== "idle" && !busy ? (
            <div className="mt-4 rounded-[10px] border border-line bg-panel-2/70 px-4 py-3">
              <Button tone="secondary" onClick={reset} className="w-full">
                Start a new verification
              </Button>
              <p className="mt-2.5 text-center text-[0.74rem] leading-relaxed text-faint">
                Clears this result. The record stays in history.
              </p>
            </div>
          ) : null}
        </div>

        {/* Right: what came out. Decision, evidence, agent, settlement. */}
        <div className="min-w-0">
          {phase === "idle" ? <IdleState health={health} /> : null}

          {phase !== "idle" ? (
            <AgentTimeline
              seen={events.seen}
              current={events.current}
              finished={events.finished}
              subject={label}
            />
          ) : null}

          {phase === "complete" && result ? (
            <ResultPanel result={result} fee={fee} health={health} />
          ) : null}

          {phase === "failed" && failure ? (
            <FailurePanel message={failure.message} code={failure.code} />
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Pre-run: what the service is, how it is configured, and what it last did. */
function IdleState({ health }: { health: ServiceHealth | null }) {
  return (
    <>
      <Panel title="How a verification runs" className="mt-0">
        <ol className="m-0 grid list-none grid-cols-1 gap-x-6 gap-y-4 p-0 sm:grid-cols-2">
          {[
            {
              n: "01",
              t: "Payment is required",
              d: "The endpoint answers with a 402 challenge before any analysis runs.",
            },
            {
              n: "02",
              t: "The agent pays",
              d: "A server-side reference agent settles the fee in HBAR through x402.",
            },
            {
              n: "03",
              t: "The document is analysed",
              d: "Extraction, then semantic, provenance and image checks produce named evidence.",
            },
            {
              n: "04",
              t: "The agent acts",
              d: "CLEAR releases the downstream payment; REVIEW halts it for human review.",
            },
          ].map((step) => (
            <li key={step.n} className="border-t border-line pt-3">
              <div className="flex items-baseline gap-2.5">
                <span className="font-mono text-[0.66rem] text-faint">{step.n}</span>
                <span className="text-[0.86rem] font-medium text-ink">{step.t}</span>
              </div>
              <p className="mt-1.5 text-[0.82rem] leading-relaxed text-muted">{step.d}</p>
            </li>
          ))}
        </ol>
      </Panel>

      <LatestVerification />

      {/* Each value is reported by the gateway's own /health. Rendered only
          when it actually answered, so an outage shows nothing rather than a
          stale or assumed configuration. */}
      {health ? (
        <Panel title="Service configuration">
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
            <Field label="Network" value={formatNetwork(health.network)} mono={false} />
            <Field
              label="Settlement facilitator"
              value={facilitatorLabel(health.facilitator)}
              breakAnywhere={false}
            />
            <Field label="Verification fee paid to" value={health.payTo} />
          </div>
        </Panel>
      ) : null}
    </>
  );
}

/**
 * A run that never produced a verdict. The backend's own error class is shown
 * rather than a generic message, and the outcome is labelled a non-outcome
 * rather than an accusation about the document (CLAUDE.md Section 16).
 */
function FailurePanel({ message, code }: { message: string; code?: string }) {
  return (
    <>
      <Panel title="Decision" id="panel-result" step="01" connectsDown>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
          <span
            id="decision"
            className="rounded-[7px] border border-fault-border bg-fault-bg px-4 py-2 font-mono text-[1.45rem] font-bold leading-none tracking-[0.03em] text-fault sm:text-[1.75rem]"
          >
            NO VERDICT
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[0.76rem] font-semibold uppercase tracking-[0.08em] text-fault">
              → Agent has no verdict to act on
            </div>
            <p
              id="decision-note"
              className="mt-2 max-w-[38rem] text-[0.85rem] leading-relaxed text-muted"
            >
              {message} This implies nothing about the document's legitimacy,
              only that the verification could not be completed.
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="Evidence" step="02" connected connectsDown>
        <ul id="evidence" className="m-0 list-none p-0">
          <li>
            <span className="code font-mono text-[0.82rem] font-semibold">
              {code ?? "SERVICE_UNAVAILABLE"}
            </span>
            <div className="explain mt-1 text-[0.87rem] leading-relaxed text-muted">
              Reported by the verification service. No forensic evidence was
              produced, because no analysis completed.
            </div>
          </li>
        </ul>
      </Panel>

      <Panel title="Agent action" step="03" connected connectsDown>
        {/* No verdict means no permission to pay. */}
        <div id="agent">
          <div className="font-mono text-[0.84rem] text-review">
            Payment halted, no verdict to act on
          </div>
          <p className="mt-2 text-[0.83rem] text-muted">
            The agent fails closed: it releases a downstream payment only on an
            explicit CLEAR.
          </p>
        </div>
      </Panel>

      <Panel title="Verification fee" step="04" connected>
        <div id="proof" className="text-[0.86rem] italic text-muted">
          No settled fee was reported for this run.
        </div>
      </Panel>
    </>
  );
}
