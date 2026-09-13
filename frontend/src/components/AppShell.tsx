import type { ReactNode } from "react";

import {
  facilitatorLabel,
  formatNetwork,
  useServiceStatus,
} from "../hooks/useServiceStatus";
import { NAV_ITEMS, isCurrent } from "../lib/routes";

/**
 * The application shell: one header, one navigation, one footer, shared by every
 * in-app surface. Before this, each page carried its own header and its own
 * idea of where "back" went, which is what made the product read as a set of
 * pages rather than one system.
 */
export function AppShell({ path, children }: { path: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <ShellHeader path={path} />

      <main className="mx-auto w-full max-w-[1240px] flex-1 px-5 pb-20 pt-9 sm:px-8">
        {children}
      </main>

      <ShellFooter />
    </div>
  );
}

function ShellHeader({ path }: { path: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/92 backdrop-blur-[2px]">
      {/* Wraps rather than overflowing: at 375px the brand, three nav items and
          the environment badge cannot share one line. */}
      <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 sm:px-8">
        <a
          href="/"
          className="flex shrink-0 items-center gap-2.5 text-[0.86rem] font-semibold tracking-[0.14em] text-ink"
        >
          <span aria-hidden="true" className="h-3.5 w-0.75 bg-ink" />
          PROOFLINE
        </a>

        <nav aria-label="Primary" className="flex min-w-0 items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const current = isCurrent(item.href, path);
            return (
              <a
                key={item.href}
                href={item.href}
                {...(current ? { "aria-current": "page" as const } : {})}
                className={[
                  "rounded-[5px] px-2.5 py-1.5 text-[0.82rem] transition-colors",
                  current
                    ? "bg-panel text-ink shadow-[inset_0_0_0_1px_var(--color-line)]"
                    : "text-muted hover:bg-panel/70 hover:text-ink",
                ].join(" ")}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        <div className="ml-auto min-w-0 shrink">
          <EnvironmentIndicator />
        </div>
      </div>
    </header>
  );
}

/**
 * Reports what the service says about itself. "Checking" and "unreachable" are
 * distinct from "online": a gateway that cannot be reached must not render as
 * healthy (CLAUDE.md Section 22).
 */
function EnvironmentIndicator() {
  const { phase, health } = useServiceStatus();

  const network = formatNetwork(health?.network) || "Hedera testnet";

  const dot =
    phase === "online"
      ? "bg-clear"
      : phase === "unreachable"
        ? "bg-fault"
        : "bg-line-strong";

  const title =
    phase === "online"
      ? `Gateway online · settlement via ${facilitatorLabel(health?.facilitator)}`
      : phase === "unreachable"
        ? "The gateway did not respond to a health check"
        : "Checking gateway health";

  return (
    <span
      title={title}
      className="flex min-w-0 items-center gap-1.5 rounded-[5px] border border-line px-1.5 py-1 font-mono text-[0.66rem] uppercase tracking-[0.06em] text-faint sm:gap-2 sm:px-2 sm:tracking-[0.08em]"
    >
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${dot}`} />
      {/* The dot alone carries state on the narrowest screens; the label is
          restored as soon as there is room for it. */}
      <span className="hidden truncate min-[400px]:inline sm:hidden">
        {phase === "unreachable" ? "Offline" : "Testnet"}
      </span>
      <span className="hidden truncate sm:inline">
        {phase === "unreachable" ? "Gateway unreachable" : network}
      </span>
      <span className="sr-only">
        {phase === "unreachable"
          ? "Gateway unreachable"
          : phase === "checking"
            ? "Checking gateway health"
            : `Gateway online, ${network}`}
      </span>
    </span>
  );
}

function ShellFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-6 text-[0.78rem] sm:px-8">
        <span className="text-faint">
          Deterministic, evidence-backed verification decisions.
        </span>
        <a href="/" className="text-muted underline underline-offset-2 hover:text-ink">
          About
        </a>
        <a href="/docs" className="text-muted underline underline-offset-2 hover:text-ink">
          API documentation
        </a>
        <a
          href="https://github.com/Aaryan-Sharma-5/Proofline"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted underline underline-offset-2 hover:text-ink"
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}
