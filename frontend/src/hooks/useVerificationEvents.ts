import { useCallback, useEffect, useRef, useState } from "react";

import type { Stage, VerificationEvent } from "../lib/types";

export const STAGE_SEQUENCE: { stage: Stage; label: string }[] = [
  { stage: "RECEIVED", label: "Request received" },
  { stage: "PAYMENT_REQUIRED", label: "Payment required (402)" },
  { stage: "PAYING", label: "Payment authorized" },
  { stage: "ANALYZING", label: "Analyzing document" },
  { stage: "DECISION", label: "Decision reached" },
  { stage: "PAID", label: "Verification fee settled" },
  { stage: "AGENT_ACTION", label: "Agent acted" },
];

const SUBSCRIBED_STAGES: Stage[] = [
  ...STAGE_SEQUENCE.map((entry) => entry.stage),
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
          const index = STAGE_SEQUENCE.findIndex((e) => e.stage === stage);
          setCurrent(STAGE_SEQUENCE[index + 1]?.stage ?? null);
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
