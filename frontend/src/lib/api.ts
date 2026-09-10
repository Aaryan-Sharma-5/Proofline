import type {
  DemoVerifyResponse,
  VerificationDetail,
  VerificationListResponse,
  VerificationStatus,
} from "./types";

/** Correlation id for the live event stream, generated before the request. */
export function newStreamId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return (
    "vs_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  );
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  // Declared as fields rather than constructor parameter properties: the latter emit runtime code, which `erasableSyntaxOnly` disallows.
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function runSample(
  sample: string,
  streamId: string,
): Promise<DemoVerifyResponse> {
  return postDemo({ sample, stream_id: streamId });
}

/** Same path, for a document the visitor supplies. */
export async function runUpload(
  file: File,
  streamId: string,
): Promise<DemoVerifyResponse> {
  const documentBase64 = await fileToBase64(file);
  return postDemo({
    document_base64: documentBase64,
    filename: file.name,
    stream_id: streamId,
  });
}

async function postDemo(body: Record<string, unknown>): Promise<DemoVerifyResponse> {
  const response = await fetch("/demo/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await readJson<DemoVerifyResponse & { error?: string; message?: string }>(
    response,
  );

  if (!response.ok) {
    throw new ApiError(
      payload?.message ?? `The service returned HTTP ${response.status}.`,
      response.status,
      payload?.error,
    );
  }
  if (!payload) {
    throw new ApiError("The service returned an unreadable response.", response.status);
  }
  return payload;
}

/** Authoritative current state, rather than replaying the event history. */
export async function fetchStatus(
  streamId: string,
): Promise<VerificationStatus | null> {
  try {
    const response = await fetch(`/verification/${streamId}/status`);
    if (!response.ok) return null;
    return await readJson<VerificationStatus>(response);
  } catch {
    return null;
  }
}

export async function fetchHistory(limit = 50): Promise<VerificationListResponse> {
  const response = await fetch(`/verification?limit=${limit}`);
  if (!response.ok) {
    throw new ApiError("Verification history is unavailable.", response.status);
  }
  const payload = await readJson<VerificationListResponse>(response);
  if (!payload) throw new ApiError("Unreadable history response.", response.status);
  return payload;
}

export async function fetchVerification(id: string): Promise<VerificationDetail> {
  const response = await fetch(`/verification/${encodeURIComponent(id)}`);
  if (!response.ok) {
    throw new ApiError(
      response.status === 404
        ? "No such verification."
        : "Could not load this record.",
      response.status,
    );
  }
  const payload = await readJson<VerificationDetail>(response);
  if (!payload) throw new ApiError("Unreadable record.", response.status);
  return payload;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const CHUNK = 0x8000;
  let binary = "";
  for (let offset = 0; offset < buffer.length; offset += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

export function hashscanUrl(transaction: string): string {
  return `https://hashscan.io/testnet/transaction/${transaction}`;
}
