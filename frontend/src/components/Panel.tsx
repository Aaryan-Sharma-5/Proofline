import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  id?: string;
  children: ReactNode;
  connected?: boolean;
  connectsDown?: boolean;
  /** Right-aligned content in the title row: counts, links, small controls. */
  aside?: ReactNode;
  /** Numeric marker, used to make an ordered chain of panels readable. */
  step?: string;
  className?: string;
}

export function Panel({
  title,
  id,
  children,
  connected = false,
  connectsDown = false,
  aside,
  step,
  className = "",
}: PanelProps) {
  return (
    <section
      id={id}
      className={[
        "border border-line bg-panel",
        connected ? "mt-0 rounded-t-none border-t-0" : "mt-5 rounded-t-[10px]",
        connectsDown ? "rounded-b-none" : "rounded-b-[10px]",
        className,
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line px-5 py-3 sm:px-6">
        <h2 className="flex items-center gap-2.5 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint">
          {step ? (
            <span className="font-mono text-[0.62rem] text-faint/80" aria-hidden="true">
              {step}
            </span>
          ) : null}
          {title}
        </h2>
        {aside ? <div className="ml-auto flex items-center gap-3">{aside}</div> : null}
      </div>

      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}

/** A labelled sub-section inside a panel. */
export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-6 border-t border-line pt-5 first:mt-0 first:border-t-0 first:pt-0">
      <h3 className="mb-2.5 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint">
        {title}
      </h3>
      {children}
    </div>
  );
}

/** Label-over-value, the unit the technical readouts are built from. */
export function Field({
  label,
  value,
  mono = true,
  /**
   * Identifiers (hashes, transaction ids) must break anywhere to fit a narrow
   * column. Hostnames must not: "blocky402.\ncom" reads as a broken value
   * rather than a wrapped one.
   */
  breakAnywhere = true,
  className = "",
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  breakAnywhere?: boolean;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mb-1.5 text-[0.66rem] uppercase tracking-[0.07em] text-faint">
        {label}
      </div>
      <div
        className={[
          "wrap-break-word",
          breakAnywhere ? "break-all" : "",
          mono ? "font-mono text-[0.79rem]" : "text-[0.86rem]",
        ].join(" ")}
      >
        {value}
      </div>
    </div>
  );
}
