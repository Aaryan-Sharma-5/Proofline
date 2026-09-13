/**
 * Route model for the application shell.
 *
 * Navigation is deliberately restricted to surfaces that genuinely exist
 * (CLAUDE.md Section 4: no fake pages to populate a nav). `/docs` is served by
 * the gateway rather than React, so it is a plain link rather than a route.
 */

export type AppRoute = "/app" | "/history";

export interface NavItem {
  href: string;
  label: string;
  /** True when the gateway serves it, so the SPA must do a full navigation. */
  external?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/app", label: "Verify" },
  { href: "/history", label: "History" },
  { href: "/docs", label: "API", external: true },
];

export function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

/** Whether a nav item is the surface currently being shown. */
export function isCurrent(href: string, path: string): boolean {
  if (href === "/history") return path === "/history" || path === "/history.html";
  return href === path;
}
