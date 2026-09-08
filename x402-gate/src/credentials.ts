const PLACEHOLDERS = new Set(["302e0201...", "0.0.xxxxxxx", ""]);

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || PLACEHOLDERS.has(trimmed) || trimmed.endsWith("...")) {
    return null;
  }
  return trimmed;
}

export type Credentials = {
  accountId: string;
  privateKey: string;
  keySource: string;
};

export function resolveCredentials(): Credentials {
  const accountId = clean(process.env.HEDERA_ACCOUNT_ID);

  const der = clean(process.env.HEDERA_PRIVATE_KEY);
  const hex = clean(process.env.HEX_ENCODED_PRIVATE_KEY);
  const privateKey = der ?? hex;
  const keySource = der
    ? "HEDERA_PRIVATE_KEY"
    : hex
      ? "HEX_ENCODED_PRIVATE_KEY"
      : "(none)";

  if (!accountId || !privateKey) {
    const missing = [
      !accountId ? "HEDERA_ACCOUNT_ID" : null,
      !privateKey ? "HEDERA_PRIVATE_KEY or HEX_ENCODED_PRIVATE_KEY" : null,
    ]
      .filter(Boolean)
      .join(" and ");
    throw new Error(
      `Missing ${missing} in .env. Supply a funded Hedera testnet account from https://portal.hedera.com/ (a value still set to the .env.example placeholder counts as missing).`,
    );
  }

  return { accountId, privateKey, keySource };
}


export function resolvePayTo(): string | null {
  return clean(process.env.HEDERA_PAY_TO_ACCOUNT_ID);
}

export function resolveAgentCredentials(): Credentials {
  const accountId = clean(process.env.AGENT_ACCOUNT_ID);
  const privateKey = clean(process.env.AGENT_PRIVATE_KEY);

  if (accountId && privateKey) {
    return { accountId, privateKey, keySource: "AGENT_PRIVATE_KEY" };
  }

  const fallback = resolveCredentials();
  return {
    ...fallback,
    keySource: `${fallback.keySource} (FALLBACK: AGENT_ACCOUNT_ID/AGENT_PRIVATE_KEY not set)`,
  };
}
