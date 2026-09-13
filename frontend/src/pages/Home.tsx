import { useEffect, useRef } from "react";

import { AgentTimeline } from "../components/AgentTimeline";
import { Button } from "../components/Button";
import { LatestVerification } from "../components/LatestVerification";
import { Field, Panel } from "../components/Panel";
import { ResultPanel } from "../components/ResultPanel";
import { UploadZone } from "../components/UploadZone";
import { WorkflowStepper } from "../components/WorkflowStepper";
import {
  facilitatorLabel,
  formatNetwork,
  useServiceStatus,
} from "../hooks/useServiceStatus";
import { useVerification } from "../hooks/useVerification";
import {
  decidedAtFromEvents,
  feeFromEvents,
  furthestStageSeen,
  paymentStatusFromEvents,
} from "../hooks/useVerificationEvents";

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
  const paymentStatus = paymentStatusFromEvents(events.seen, events.finished);
  const decidedAt = decidedAtFromEvents(events.seen);
  const furthest = furthestStageSeen(events.seen);

  return (
    <>
      <header className="border-b border-line pb-6">
        <h1 className="text-[1.35rem] font-semibold tracking-[-0.012em]">
          Verify a document
        </h1>
        <p className="mt-2 max-w-[42rem] text-[0.92rem] leading-relaxed text-muted">
          Pay per verification. Receive evidence-backed integrity checks before
          an agent proceeds.
        </p>

        <div className="mt-5">
          <WorkflowStepper
            phase={phase}
            furthestSeen={furthest}
            current={events.current}
            finished={events.finished}
            failed={phase === "failed"}
            // The stages the server actually reported, so a step that never ran
            // cannot render as complete once the stream ends.
            reached={new Set(events.seen.keys())}
          />
        </div>
      </header>

      <div className="mt-7 grid grid-cols-1 items-start gap-6 min-[900px]:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
        {/* Left rail: the request context. What goes in. */}
        <div className="min-[900px]:sticky min-[900px]:top-20">
          <Panel title="Document" className="mt-0">
            <UploadZone
              onSubmit={(file) => void verifyUpload(file)}
              disabled={busy}
              running={busy}
              settled={phase === "complete" || phase === "failed"}
            />

            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="font-mono text-[0.64rem] uppercase tracking-[0.08em] text-faint">
                or try a sample
              </span>
              <span className="h-px flex-1 bg-line" />
            </div>

            <div className="flex flex-col gap-2.5">
              <Button
                id="btn-clear"
                disabled={busy}
                onClick={() => void verifySample("clear")}
                className="w-full"
              >
                Verify CLEAR sample
              </Button>
              <Button
                id="btn-review"
                disabled={busy}
                onClick={() => void verifySample("review")}
                className="w-full"
              >
                Verify REVIEW sample
              </Button>
              <p className="text-[0.75rem] leading-relaxed text-faint">
                Two bundled invoices: a clean baseline, and one requesting a
                payout account this vendor has not used before.
              </p>
            </div>

            <p className="mt-5 border-t border-line pt-3.5 text-[0.75rem] leading-relaxed text-faint">
              Documents are analysed and deleted. Only the decision, its
              evidence, and a content hash are retained.
            </p>
          </Panel>

          {/* Each value is reported by the gateway's own /health. Rendered only
              when it actually answered, so an outage shows nothing rather than
              a stale or assumed configuration. */}
          {health ? (
            <Panel title="Service">
              <div className="grid grid-cols-1 gap-y-4">
                <Field
                  label="Network"
                  value={formatNetwork(health.network)}
                  mono={false}
                />
                <Field
                  label="Payment facilitator"
                  value={facilitatorLabel(health.facilitator)}
                  breakAnywhere={false}
                />
                <Field label="Payments to" value={health.payTo} />
              </div>
            </Panel>
          ) : null}

          {phase !== "idle" && !busy ? (
            <div className="mt-4 rounded-[10px] border border-line bg-panel-2/70 px-4 py-3">
              <Button tone="secondary" onClick={reset} className="w-full">
                Verify another document
              </Button>
              <p className="mt-2.5 text-center text-[0.74rem] leading-relaxed text-faint">
                Clears this result. The record stays in history.
              </p>
            </div>
          ) : null}
        </div>

        {/* Right: what came out. Decision, evidence, agent, payment, proof. */}
        <div className="min-w-0">
          {phase === "idle" ? <IdleState /> : null}

          {phase === "complete" && result ? (
            <ResultPanel
              result={result}
              fee={fee}
              health={health}
              paymentStatus={paymentStatus}
              decidedAt={decidedAt}
            />
          ) : null}

          {phase === "failed" && failure ? (
            <FailurePanel message={failure.message} code={failure.code} />
          ) : null}

          {/* Lowest in the reading order: the raw lifecycle. While a run is in
              flight it is the only thing to show, so it leads then. */}
          {phase !== "idle" ? (
            <AgentTimeline
              seen={events.seen}
              current={events.current}
              finished={events.finished}
              subject={label}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Pre-run: how the product works, and what it most recently decided. */
function IdleState() {
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
              d: "CLEAR releases the invoice payment; REVIEW halts it for human review.",
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
    </>
  );
}

/**
 * A run that never produced a decision. The backend's own error class is shown
 * rather than a generic message, and the outcome is labelled a non-outcome
 * rather than an accusation about the document.
 */
function FailurePanel({ message, code }: { message: string; code?: string }) {
  const isPaymentFailure = code === "PAYMENT_REQUIRED";

  return (
    <>
      <Panel title="Verification decision" id="panel-result" connectsDown>
        <div className="state-enter flex flex-wrap items-start gap-x-6 gap-y-4">
          <span
            id="decision"
            className="rounded-[7px] border border-fault-border bg-fault-bg px-4 py-2 font-mono text-[1.45rem] font-bold leading-none tracking-[0.03em] text-fault sm:text-[1.75rem]"
          >
            NO VERDICT
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[0.76rem] font-semibold uppercase tracking-[0.08em] text-fault">
              → Consuming agent has no decision to act on
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

      <Panel title="What happened" connected connectsDown>
        <ul id="evidence" className="m-0 list-none p-0">
          <li>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <span className="code font-mono text-[0.84rem] font-semibold">
                {code ?? "SERVICE_UNAVAILABLE"}
              </span>
              {/* Not an evidence level: no forensic check produced this. */}
              <span className="level whitespace-nowrap rounded-sm border border-line-strong px-1.5 py-0.5 font-mono text-[0.64rem] tracking-[0.05em] text-faint">
                SERVICE ERROR · NOT A FINDING
              </span>
            </div>
            <div className="explain mt-1.5 max-w-[44rem] text-[0.86rem] leading-relaxed text-muted">
              {isPaymentFailure
                ? "The verification payment did not complete, so analysis never started. This is a payment failure, not a document failure."
                : "Reported by the verification service. No forensic evidence was produced, because no analysis completed."}
            </div>
          </li>
        </ul>
      </Panel>

      <Panel title="Consuming agent" connected connectsDown>
        {/* No decision means no permission to pay. */}
        <div id="agent">
          <div className="font-mono text-[0.84rem] text-review">
            Invoice payment halted, no decision to act on
          </div>
          <p className="mt-2 max-w-[40rem] text-[0.83rem] leading-relaxed text-muted">
            The agent fails closed: it releases an invoice payment only on an
            explicit CLEAR.
          </p>
        </div>
      </Panel>

      <Panel title="Verification payment" connected>
        <div id="proof" className="text-[0.86rem] text-muted">
          No verification payment was settled for this run.
        </div>
      </Panel>
    </>
  );
}
