import type { Response } from "express";
import { randomUUID } from "node:crypto";

export const STAGES = [
  "RECEIVED",
  "PAYMENT_REQUIRED",
  "PAYING",
  "PAID",
  "ANALYZING",
  "DECISION",
  "AGENT_ACTION",
  "AUDIT",
] as const;

export type Stage = (typeof STAGES)[number];

export type VerificationEvent = {
  seq: number;
  stage: Stage | "ERROR";
  ts: string;
  verification_id?: string;
  detail?: Record<string, unknown>;
};

const COMPLETED_TTL_MS = 15 * 60 * 1000;
const MAX_STREAMS = 500;
const KEEPALIVE_MS = 15_000;

type Subscriber = { res: Response; keepalive: NodeJS.Timeout };

class Stream {
  readonly events: VerificationEvent[] = [];
  readonly subscribers = new Set<Subscriber>();
  verificationId?: string;
  status: Stage | "ERROR" = "RECEIVED";
  completed = false;
  completedAt?: number;
  readonly createdAt = Date.now();

  private seq = 0;

  nextSeq(): number {
    return ++this.seq;
  }
}

const streams = new Map<string, Stream>();

function evictIfNeeded(): void {
  const now = Date.now();

  for (const [id, stream] of streams) {
    if (
      stream.completed &&
      stream.completedAt !== undefined &&
      now - stream.completedAt > COMPLETED_TTL_MS &&
      stream.subscribers.size === 0
    ) {
      streams.delete(id);
    }
  }

  while (streams.size > MAX_STREAMS) {
    // Oldest first. Map preserves insertion order.
    const oldest = streams.keys().next();
    if (oldest.done) break;
    const stream = streams.get(oldest.value);
    for (const subscriber of stream?.subscribers ?? []) {
      clearInterval(subscriber.keepalive);
      subscriber.res.end();
    }
    streams.delete(oldest.value);
  }
}

export function newCorrelationId(): string {
  return `vs_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/** Accepts a caller-supplied id, rejecting anything unsuitable as a key. */
export function sanitizeCorrelationId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(value)) return null;
  return value;
}

function ensureStream(correlationId: string): Stream {
  let stream = streams.get(correlationId);
  if (!stream) {
    stream = new Stream();
    streams.set(correlationId, stream);
    evictIfNeeded();
  }
  return stream;
}

/** Called by a subscriber that may arrive before the producer. */
export function openStream(correlationId: string): Stream {
  return ensureStream(correlationId);
}

function writeEvent(res: Response, event: VerificationEvent): void {
  // SSE frame. The id: field lets a reconnecting client resume via Last-Event-ID; the blank line terminates the frame.
  res.write(`id: ${event.seq}\n`);
  res.write(`event: ${event.stage}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function emit(
  correlationId: string,
  stage: Stage | "ERROR",
  detail?: Record<string, unknown>,
): void {
  const stream = ensureStream(correlationId);

  const event: VerificationEvent = {
    seq: stream.nextSeq(),
    stage,
    ts: new Date().toISOString(),
    ...(stream.verificationId ? { verification_id: stream.verificationId } : {}),
    ...(detail ? { detail } : {}),
  };

  stream.events.push(event);
  stream.status = stage;

  for (const subscriber of stream.subscribers) {
    try {
      writeEvent(subscriber.res, event);
    } catch {
    }
  }
}

export function emitOnce(
  correlationId: string,
  stage: Stage | "ERROR",
  detail?: Record<string, unknown>,
): void {
  const stream = ensureStream(correlationId);
  if (stream.events.some((event) => event.stage === stage)) return;
  emit(correlationId, stage, detail);
}

export function bindVerificationId(
  correlationId: string,
  verificationId: string,
): void {
  ensureStream(correlationId).verificationId = verificationId;
}

export function complete(correlationId: string): void {
  const stream = streams.get(correlationId);
  if (!stream) return;

  stream.completed = true;
  stream.completedAt = Date.now();

  for (const subscriber of stream.subscribers) {
    clearInterval(subscriber.keepalive);
    try {
      subscriber.res.write("event: done\ndata: {}\n\n");
      subscriber.res.end();
    } catch {
      /* already gone */
    }
  }
  stream.subscribers.clear();
}

export function status(key: string): Record<string, unknown> | null {
  const stream = findStream(key);
  if (!stream) return null;
  return {
    verification_id: stream.verificationId ?? null,
    status: stream.status,
    completed: stream.completed,
    event_count: stream.events.length,
  };
}

export function findStream(key: string): Stream | undefined {
  const direct = streams.get(key);
  if (direct) return direct;
  for (const stream of streams.values()) {
    if (stream.verificationId === key) return stream;
  }
  return undefined;
}

export function subscribe(
  correlationId: string,
  res: Response,
  lastEventId?: number,
): void {
  const stream = ensureStream(correlationId);

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.write("retry: 3000\n\n");
  res.flushHeaders();

  res.socket?.setNoDelay(true);
  res.socket?.setTimeout(0);
  res.setTimeout?.(0);

  // Replay anything the subscriber missed, so a client that connects a moment late still sees RECEIVED rather than starting mid-flow.
  const from = Number.isFinite(lastEventId) ? (lastEventId as number) : 0;
  for (const event of stream.events) {
    if (event.seq > from) writeEvent(res, event);
  }

  if (stream.completed) {
    res.write("event: done\ndata: {}\n\n");
    res.end();
    return;
  }

  const keepalive = setInterval(() => {
    try {
      res.write(`: keepalive ${Date.now()}\n\n`);
    } catch {
    }
  }, KEEPALIVE_MS);

  const subscriber: Subscriber = { res, keepalive };
  stream.subscribers.add(subscriber);

  res.on("close", () => {
    clearInterval(keepalive);
    stream.subscribers.delete(subscriber);
  });
}
