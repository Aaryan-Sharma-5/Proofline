import "./env.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

export const FACILITATOR_URL = optional(
  "FACILITATOR_URL",
  "https://x402.org/facilitator",
);

export const NETWORK = optional("X402_NETWORK", "hedera:testnet");

export const PAY_TO = required("HEDERA_PAY_TO_ACCOUNT_ID");

export const PRICE_PING = optional("PRICE_PING", "0.01");
export const PRICE_VERIFY = optional("PRICE_VERIFY", "0.02");
export const PORT = Number(optional("PORT", "4021"));

export const ANALYSIS_SERVICE_URL = optional(
  "ANALYSIS_SERVICE_URL",
  "http://127.0.0.1:8099",
);

export const MAX_UPLOAD_BYTES = Number(optional("MAX_UPLOAD_BYTES", "10485760"));

export const AGENT_SERVICE_URL = optional(
  "AGENT_SERVICE_URL",
  "http://127.0.0.1:4022",
);

export const SERVICE_VERSION = optional("SERVICE_VERSION", "0.1.0")

export const DEMO_RATE_LIMIT_PER_MINUTE = Number(
  optional("DEMO_RATE_LIMIT_PER_MINUTE", "12"),
);
export const DEMO_MAX_CONCURRENT = Number(optional("DEMO_MAX_CONCURRENT", "2"));
export const DEMO_TIMEOUT_MS = Number(optional("DEMO_TIMEOUT_MS", "120000"));
