import { useCallback, useEffect, useRef, useState } from "react";

import type { Stage, VerificationEvent } from "../lib/types";

export const STAGE_SEQUENCE: { stage: Stage; label: string }[] = [
  { stage: "RECEIVED", label: "Request received" },
  { stage: "PAYMENT_REQUIRED", label: "Payment required (402)" },
  { stage: "PAYING", label: "Payment authorized" },
  { stage: "ANALYZING", label: "Analyzing document" },
  { stage: "DECISION", label: "Decision reached" },
  { stage: "PAID", label: "Verification payment settled" },
  { stage: "AGENT_ACTION", label: "Agent acted" },
];

/**
 * Reported only when the bounded extraction fallback actually ran, so it is not
 * part of the fixed sequence above: on a normal verification it never arrives,
 * and rendering it as a skipped step would imply something failed to happen.
 */
export const CONDITIONAL_STAGES: Stage[] = ["AI_EXTRACTION"];

const SUBSCRIBED_STAGES: Stage[] = [
  ...STAGE_SEQUENCE.map((entry) => entry.stage),
  ...CONDITIONAL_STAGES,
  "AUDIT",
  "ERROR",
];

export interface UseVerificationEvents {
  seen: Map<Stage, VerificationEvent>;
  current: Stage | null;
  finished: boolean;
  open: (streamId: string) => void;
  finish: () => void;
  reset: () => void;
}

/**
 * The verification fee as the server stated it in the 402 challenge.
 *
 * Read from the event rather than hardcoded in the client: the price is server
 * configuration (PRICE_VERIFY), so a literal here would duplicate it and drift
 * silently when it changes.
 */
export function feeFromEvents(seen: Map<Stage, VerificationEvent>): string | null {
  const price = seen.get("PAYMENT_REQUIRED")?.detail?.price;
  if (typeof price === "string" && price.trim()) return price.trim();
  if (typeof price === "number") return String(price);
  return null;
}

/** The furthest stage actually confirmed by the server so far, in stage order. */
export function furthestStageSeen(seen: Map<Stage, VerificationEvent>): Stage | null {
  let furthest: Stage | null = null;
  for (const { stage } of STAGE_SEQUENCE) {
    if (seen.has(stage)) furthest = stage;
  }
  return furthest;
}

/**
 * Payment state read from the stages the server actually reported. x402's
 * authorize/capture split means PAID legitimately arrives after DECISION, so
 * this reads the events rather than assuming an order.
 */
export function paymentStatusFromEvents(
  seen: Map<Stage, VerificationEvent>,
  finished: boolean,
): "REQUIRED" | "PAYING" | "PAID" | "NOT_SETTLED" {
  if (seen.has("PAID")) return "PAID";
  if (seen.has("PAYING")) return finished ? "NOT_SETTLED" : "PAYING";
  if (seen.has("PAYMENT_REQUIRED")) return finished ? "NOT_SETTLED" : "REQUIRED";
  return "NOT_SETTLED";
}

/** Server timestamp of the decision event, the moment the verdict existed. */
export function decidedAtFromEvents(
  seen: Map<Stage, VerificationEvent>,
): string | null {
  const ts = seen.get("DECISION")?.ts;
  if (!ts) return null;
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? ts : date.toLocaleString();
}

export function useVerificationEvents(): UseVerificationEvents {
  const [seen, setSeen] = useState<Map<Stage, VerificationEvent>>(new Map());
  const [current, setCurrent] = useState<Stage | null>(null);
  const [finished, setFinished] = useState(false);

  const sourceRef = useRef<EventSource | null>(null);
  const finishedRef = useRef(false);

  const closeSource = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  // Never leave a stream open behind an unmounted component.
  useEffect(() => closeSource, [closeSource]);

  const reset = useCallback(() => {
    closeSource();
    finishedRef.current = false;
    setSeen(new Map());
    setCurrent("RECEIVED");
    setFinished(false);
  }, [closeSource]);

  const finish = useCallback(() => {
    finishedRef.current = true;
    setFinished(true);
    closeSource();
  }, [closeSource]);

  const open = useCallback(
    (streamId: string) => {
      closeSource();
      const source = new EventSource(`/verification/${streamId}/events`);
      sourceRef.current = source;

      for (const stage of SUBSCRIBED_STAGES) {
        source.addEventListener(stage, (message) => {
          let parsed: VerificationEvent;
          try {
            parsed = JSON.parse((message as MessageEvent<string>).data);
          } catch {
            return;
          }

          setSeen((previous) => {
            const next = new Map(previous);
            next.set(stage, parsed);
            return next;
          });

          // Advance the marker to the next stage the server has not reported.
          // A conditional stage is not in the sequence, so it leaves the marker
          // where it is rather than sending it back to the first step.
          const index = STAGE_SEQUENCE.findIndex((e) => e.stage === stage);
          if (index !== -1) {
            setCurrent(STAGE_SEQUENCE[index + 1]?.stage ?? null);
          }
        });
      }

      source.addEventListener("done", () => {
        finishedRef.current = true;
        setFinished(true);
        closeSource();
      });

      source.onerror = () => {
        // EventSource reconnects on its own
        if (finishedRef.current) closeSource();
      };
    },
    [closeSource],
  );

  return { seen, current, finished, open, finish, reset };
}
