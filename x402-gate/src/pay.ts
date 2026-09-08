import { x402HTTPClient } from "@x402/core/http";
import { x402Client } from "@x402/core/client";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import {
  PrivateKey,
  createClientHederaSigner,
  inspectHederaTransaction,
  type InspectedHederaTransaction,
} from "@x402/hedera";

export type PaidResult = {
  unpaidStatus: number;
  challenge: unknown;
  paidStatus: number;
  body: unknown;
  transaction?: string;
  signedTransfer?: InspectedHederaTransaction;
};

export type PayingClient = {
  http: x402HTTPClient;
  client: x402Client;
};

export function buildPayingClient(
  accountId: string,
  privateKey: string,
  network: string,
): PayingClient {
  const key = privateKey.startsWith("0x")
    ? PrivateKey.fromStringECDSA(privateKey)
    : PrivateKey.fromString(privateKey);

  const signer = createClientHederaSigner(accountId, key, { network });
  const client = new x402Client();
  client.register(network as never, new ExactHederaScheme(signer) as never);

  client.setSpendControls({ allowedAssets: true } as never);

  return { http: new x402HTTPClient(client), client };
}

export async function fetchWithPayment(
  { http, client }: PayingClient,
  url: string,
  init: RequestInit = {},
): Promise<PaidResult> {
  const first = await fetch(url, init);
  const challenge = await first.json().catch(() => null);

  if (first.status !== 402) {
    return {
      unpaidStatus: first.status,
      challenge,
      paidStatus: first.status,
      body: challenge,
    };
  }

  // Decode the challenge, then build the payment for it. This is where the Hedera TransferTransaction is constructed and partially signed.
  const paymentRequired = http.getPaymentRequiredResponse(
    (name) => first.headers.get(name),
    challenge,
  );

  const payload = await client.createPaymentPayload(paymentRequired);
  const paymentHeaders = http.encodePaymentSignatureHeader(payload);

  let signedTransfer: InspectedHederaTransaction | undefined;
  try {
    const encoded = (payload.payload as { transaction?: string })?.transaction;
    if (encoded) signedTransfer = inspectHederaTransaction(encoded);
  } catch {
  }

  const retry = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), ...paymentHeaders },
  });

  const body = await retry.json().catch(() => null);

  let transaction: string | undefined;
  try {
    const settle = http.getPaymentSettleResponse((name) =>
      retry.headers.get(name),
    );
    if (settle?.transaction) transaction = settle.transaction;
  } catch {
  }

  return {
    unpaidStatus: first.status,
    challenge,
    paidStatus: retry.status,
    body,
    ...(transaction ? { transaction } : {}),
    ...(signedTransfer ? { signedTransfer } : {}),
  };
}

export function hashscanUrl(transaction: string, network: string): string {
  const net = network.endsWith("mainnet") ? "mainnet" : "testnet";
  return `https://hashscan.io/${net}/transaction/${transaction}`;
}
