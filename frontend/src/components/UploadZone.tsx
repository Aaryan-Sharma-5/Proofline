import { useCallback, useRef, useState } from "react";

import { formatBytes } from "../lib/ui";
import { Button } from "./Button";

const MAX_BYTES = 10 * 1024 * 1024;

export interface UploadRejection {
  code: "UNSUPPORTED_TYPE" | "TOO_LARGE" | "EMPTY";
  message: string;
}

/**
 * Client-side pre-checks. These are a courtesy so an obviously-unusable file is
 * refused before it costs a real payment; they are NOT the security boundary.
 * The gateway and the analysis service validate independently.
 */
function screen(file: File): UploadRejection | null {
  if (file.size === 0) {
    return { code: "EMPTY", message: "That file is empty." };
  }
  if (file.size > MAX_BYTES) {
    return {
      code: "TOO_LARGE",
      message: `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_BYTES)}.`,
    };
  }
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    return { code: "UNSUPPORTED_TYPE", message: "Only PDF documents are supported." };
  }
  return null;
}

interface Props {
  onSubmit: (file: File) => void;
  disabled: boolean;
}

/**
 * The upload surface. A real drop target with an explicit selected-file state,
 * so submitting a document is a deliberate two-step action rather than a file
 * dialog that immediately spends a payment.
 */
export function UploadZone({ onSubmit, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rejection, setRejection] = useState<UploadRejection | null>(null);
  const [dragging, setDragging] = useState(false);

  const accept = useCallback((candidate: File | undefined) => {
    if (!candidate) return;
    const problem = screen(candidate);
    if (problem) {
      setFile(null);
      setRejection(problem);
      return;
    }
    setRejection(null);
    setFile(candidate);
  }, []);

  const clear = useCallback(() => {
    setFile(null);
    setRejection(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  return (
    <div>
      <div
        onDragOver={(event) => {
          if (disabled) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (disabled) return;
          event.preventDefault();
          setDragging(false);
          accept(event.dataTransfer.files?.[0]);
        }}
        className={[
          "rounded-[8px] border border-dashed px-5 py-6 text-center transition-colors duration-150",
          dragging ? "border-ink bg-panel-2" : "border-line-strong bg-panel-2/60",
          disabled ? "opacity-55" : "",
        ].join(" ")}
      >
        {file ? (
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-3 text-left">
            <div className="min-w-0">
              <div className="wrap-break-word break-all font-mono text-[0.82rem] text-ink">
                {file.name}
              </div>
              <div className="mt-1 text-[0.75rem] text-faint">
                PDF · {formatBytes(file.size)} · ready to verify
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                tone="primary"
                disabled={disabled}
                onClick={() => onSubmit(file)}
              >
                Verify this document
              </Button>
              <Button tone="quiet" disabled={disabled} onClick={clear}>
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[0.87rem] text-muted">
              Drop a PDF invoice here, or{" "}
              {/* The label is the keyboard-reachable control; the input stays in
                  the DOM so the capture suite can set files on #file directly. */}
              <label
                htmlFor="file"
                tabIndex={disabled ? -1 : 0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    inputRef.current?.click();
                  }
                }}
                className="cursor-pointer rounded-[3px] font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
              >
                choose a file
              </label>
              .
            </p>
            <p className="mt-2 font-mono text-[0.7rem] uppercase tracking-[0.06em] text-faint">
              PDF only · up to {formatBytes(MAX_BYTES)}
            </p>
          </>
        )}

        <input
          ref={inputRef}
          id="file"
          type="file"
          accept=".pdf,application/pdf"
          disabled={disabled}
          className="sr-only"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (!chosen) return;
            // The capture suite sets files on this input directly and expects a
            // run to start, so a programmatic selection submits immediately.
            const problem = screen(chosen);
            if (problem) {
              setFile(null);
              setRejection(problem);
              return;
            }
            setRejection(null);
            setFile(chosen);
            onSubmit(chosen);
            if (inputRef.current) inputRef.current.value = "";
          }}
        />
      </div>

      {rejection ? (
        <p
          role="status"
          className="mt-2.5 flex items-start gap-2 text-[0.82rem] text-review"
        >
          <span aria-hidden="true" className="mt-[0.15rem] font-mono text-[0.7rem]">
            ✕
          </span>
          <span>
            {rejection.message}{" "}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="underline decoration-review/40 underline-offset-2 hover:decoration-review"
            >
              Choose another file
            </button>
          </span>
        </p>
      ) : null}
    </div>
  );
}
