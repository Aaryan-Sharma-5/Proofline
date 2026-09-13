import { useEffect, useState } from "react";

import { fetchHealth } from "../lib/api";
import type { ServiceHealth } from "../lib/types";

export type StatusPhase = "checking" | "online" | "unreachable";

export interface ServiceStatus {
  phase: StatusPhase;
  health: ServiceHealth | null;
}

/**
 * Reads the gateway's own /health. Every field rendered from this is a value the
 * service actually reports; nothing here is derived or assumed. An unreachable
 * gateway is reported as unreachable rather than optimistically shown as online.
 */
export function useServiceStatus(): ServiceStatus {
  const [phase, setPhase] = useState<StatusPhase>("checking");
  const [health, setHealth] = useState<ServiceHealth | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchHealth()
      .then((payload) => {
        if (cancelled) return;
        setHealth(payload);
        setPhase("online");
      })
      .catch(() => {
        if (cancelled) return;
        setHealth(null);
        setPhase("unreachable");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { phase, health };
}

/** "hedera:testnet" reads as machinery; the UI says "Hedera testnet". */
export function formatNetwork(network: string | undefined): string {
  if (!network) return "";
  const [chain, name] = network.split(":");
  if (!name) return network;
  return `${chain.charAt(0).toUpperCase()}${chain.slice(1)} ${name}`;
}

/** Host only: the full facilitator URL is noise in a status line. */
export function facilitatorLabel(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
