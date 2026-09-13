import { useCallback, useRef, useState } from "react";

import { formatBytes } from "../lib/ui";
import { Button } from "./Button";

const MAX_BYTES = 10 * 1024 * 1024;

export interface UploadRejection {
  code: "UNSUPPORTED_TYPE" | "TOO_LARGE" | "EMPTY";
  title: string;
  message: string;
}

/**
 * Client-side pre-checks. These are a courtesy so an obviously-unusable file is
 * refused before it costs a real payment; they are NOT the security boundary.
 * The gateway and the analysis service validate independently.
 */
function screen(file: File): UploadRejection | null {
  if (file.size === 0) {
    return {
      code: "EMPTY",
      title: "File is empty",
      message: "The selected file contains no data.",
    };
  }
  if (file.size > MAX_BYTES) {
    return {
      code: "TOO_LARGE",
      title: "File is too large",
      message: `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_BYTES)}.`,
    };
  }
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    return {
      code: "UNSUPPORTED_TYPE",
      title: "Unsupported file type",
      message: "Proofline accepts PDF documents only.",
    };
  }
  return null;
}

interface Props {
  onSubmit: (file: File) => void;
  disabled: boolean;
  /** True while a verification is actually in flight. */
  running?: boolean;
}

/**
 * The document intake surface. A real drop target with an explicit
 * selected-file state, so submitting a document is a deliberate action rather
 * than a file dialog that immediately spends a payment.
 */
export function UploadZone({ onSubmit, disabled, running = false }: Props) {
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
          "rounded-[8px] border px-5 py-6 transition-colors duration-150",
          file ? "border-solid border-line-strong bg-panel" : "border-dashed",
          dragging ? "border-ink bg-panel-2" : file ? "" : "border-line-strong bg-panel-2/60",
          disabled && !running ? "opacity-55" : "",
        ].join(" ")}
      >
        {file ? (
          <div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
              <dt className="text-[0.64rem] uppercase tracking-[0.07em] text-faint">
                File
              </dt>
              <dd className="m-0 wrap-break-word break-all font-mono text-[0.81rem] text-ink">
                {file.name}
              </dd>

              <dt className="text-[0.64rem] uppercase tracking-[0.07em] text-faint">
                Type
              </dt>
              <dd className="m-0 font-mono text-[0.78rem] text-muted">
                {file.type || "application/pdf"}
              </dd>

              <dt className="text-[0.64rem] uppercase tracking-[0.07em] text-faint">
                Size
              </dt>
              <dd className="m-0 font-mono text-[0.78rem] text-muted">
                {formatBytes(file.size)}
              </dd>

              <dt className="text-[0.64rem] uppercase tracking-[0.07em] text-faint">
                Status
              </dt>
              <dd className="m-0 font-mono text-[0.78rem]">
                {running ? (
                  <span className="text-review">Verification in progress</span>
                ) : (
                  <span className="text-clear">Ready to verify</span>
                )}
              </dd>
            </dl>

            {!running ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button tone="primary" disabled={disabled} onClick={() => onSubmit(file)}>
                  Verify document
                </Button>
                <Button tone="quiet" disabled={disabled} onClick={clear}>
                  Remove
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="text-center">
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
                browse
              </label>
              .
            </p>
            <p className="mt-2 font-mono text-[0.7rem] uppercase tracking-[0.06em] text-faint">
              PDF only · up to {formatBytes(MAX_BYTES)}
            </p>
          </div>
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
        <div
          role="status"
          className="mt-2.5 rounded-[6px] border border-review-border bg-review-bg px-3.5 py-3"
        >
          <div className="text-[0.82rem] font-medium text-review">{rejection.title}</div>
          <p className="mt-1 text-[0.81rem] leading-relaxed text-muted">
            {rejection.message}{" "}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-[3px] font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
            >
              Choose another file
            </button>
          </p>
        </div>
      ) : null}
    </div>
  );
}
