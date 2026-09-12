import type { NextFunction, Request, Response } from "express";

import {
  DEMO_MAX_CONCURRENT,
  DEMO_RATE_LIMIT_PER_MINUTE,
} from "./config.js";

const WINDOW_MS = 60_000;

const hits = new Map<string, number[]>();
let inFlight = 0;

/** Trust the proxy's first hop only; the rest of XFF is caller-controlled. */
function clientKey(req: Request): string {
  const forwarded = req.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.ip ?? "unknown";
}

function withinRateLimit(key: string, now: number): boolean {
  const recent = (hits.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= DEMO_RATE_LIMIT_PER_MINUTE) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

/** Bounded cleanup so a long-lived process does not accumulate keys. */
function evictStale(now: number): void {
  for (const [key, times] of hits) {
    if (times.every((at) => now - at >= WINDOW_MS)) hits.delete(key);
  }
}

export function demoLimits(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  evictStale(now);

  if (!withinRateLimit(clientKey(req), now)) {
    res.status(429).json({
      error: "RATE_LIMITED",
      message: `Too many demo verifications. Each one performs a real Hedera testnet payment, so this endpoint allows ${DEMO_RATE_LIMIT_PER_MINUTE} per minute. Try again shortly.`,
    });
    return;
  }

  if (inFlight >= DEMO_MAX_CONCURRENT) {
    res.status(503).json({
      error: "SERVICE_UNAVAILABLE",
      message:
        "Another verification is already running. Please wait for it to finish and try again.",
    });
    return;
  }

  inFlight += 1;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    inFlight -= 1;
  };
  res.on("finish", release);
  res.on("close", release);

  next();
}
