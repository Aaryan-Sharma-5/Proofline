import { useCallback, useRef, useState } from "react";

import { ApiError, fetchStatus, newStreamId, runSample, runUpload } from "../lib/api";
import type { DemoVerifyResponse, RunPhase } from "../lib/types";
import { useVerificationEvents } from "./useVerificationEvents";

export const SAMPLES = {
  clear: "01_baseline_clean.pdf",
  review: "03_changed_beneficiary.pdf",
} as const;

export interface RunFailure {
  message: string;
  code?: string;
}

export function useVerification() {
  const events = useVerificationEvents();
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [result, setResult] = useState<DemoVerifyResponse | null>(null);
  const [failure, setFailure] = useState<RunFailure | null>(null);
  const [label, setLabel] = useState<string | null>(null);

  // Guards against a second run starting while one is in flight.
  const runningRef = useRef(false);

  const start = useCallback(
    async (
      trigger: (streamId: string) => Promise<DemoVerifyResponse>,
      displayLabel: string,
    ) => {
      if (runningRef.current) return;
      runningRef.current = true;

      setPhase("running");
      setResult(null);
      setFailure(null);
      setLabel(displayLabel);
      events.reset();

      const streamId = newStreamId();

      // Subscribe before triggering, so the early payment stages are not missed
      events.open(streamId);
      await new Promise((resolve) => setTimeout(resolve, 150));

      try {
        const payload = await trigger(streamId);
        setResult(payload);
        setPhase("complete");

        // Authoritative state, rather than inferring it from the replay.
        const status = await fetchStatus(streamId);
        if (status?.verification_id && payload.verification) {
          payload.verification.verification_id ??= status.verification_id;
        }
      } catch (error) {
        const apiError = error instanceof ApiError ? error : null;
        setFailure({
          message:
            apiError?.message ?? "Could not reach the verification service.",
          ...(apiError?.code ? { code: apiError.code } : {}),
        });
        setPhase("failed");
      } finally {
        events.finish();
        runningRef.current = false;
      }
    },
    [events],
  );

  const verifySample = useCallback(
    (which: keyof typeof SAMPLES) => {
      const sample = SAMPLES[which];
      return start((streamId) => runSample(sample, streamId), sample);
    },
    [start],
  );

  const verifyUpload = useCallback(
    (file: File) => start((streamId) => runUpload(file, streamId), file.name),
    [start],
  );

  /** Returns the workspace to its pre-run state. Never cancels an in-flight run. */
  const reset = useCallback(() => {
    if (runningRef.current) return;
    setPhase("idle");
    setResult(null);
    setFailure(null);
    setLabel(null);
    events.reset();
  }, [events]);

  return {
    phase,
    result,
    failure,
    label,
    events,
    verifySample,
    verifyUpload,
    reset,
    busy: phase === "running",
  };
}
