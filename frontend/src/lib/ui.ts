/**
 * Shared UI vocabulary that is not itself a component.
 *
 * Kept out of the component files so each of those exports components only,
 * which is what React Fast Refresh requires to reload them reliably.
 */

export type ButtonTone = "primary" | "secondary" | "quiet";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-[6px] border px-4 py-2.5 " +
  "text-[0.845rem] font-medium transition-colors duration-150 " +
  "disabled:cursor-not-allowed disabled:opacity-45";

const TONES: Record<ButtonTone, string> = {
  primary: "border-ink bg-ink text-white hover:bg-[#2E2F33]",
  secondary:
    "border-line-strong bg-panel text-ink hover:bg-panel-2 hover:border-[#B7B3A8]",
  quiet: "border-transparent bg-transparent text-muted hover:bg-panel-2 hover:text-ink",
};

/** One button vocabulary for the whole application (CLAUDE.md Section 17). */
export function buttonClass(tone: ButtonTone = "secondary", extra = ""): string {
  return [BASE, TONES[tone], extra].filter(Boolean).join(" ");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
