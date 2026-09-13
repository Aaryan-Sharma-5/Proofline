import { formatNetwork, facilitatorLabel } from "../hooks/useServiceStatus";
import { hashscanUrl } from "../lib/api";
import type { PaymentInfo, ServiceHealth } from "../lib/types";
import { Field } from "./Panel";

export type PaymentStatus = "REQUIRED" | "PAYING" | "PAID" | "NOT_SETTLED";

const STATUS_COPY: Record<PaymentStatus, { label: string; note: string }> = {
  REQUIRED: {
    label: "Required",
    note: "The endpoint returned a 402 challenge. Analysis is gated until this is settled.",
  },
  PAYING: {
    label: "Paying",
    note: "The consuming agent has authorized payment and settlement is in progress.",
  },
  PAID: {
    label: "Paid",
    note: "Settled on Hedera. This is the fee paid to Proofline for the verification, not the invoice payment the agent is deciding about.",
  },
  NOT_SETTLED: {
    label: "Not settled",
    note: "No payment was settled for this run.",
  },
};

/**
 * The x402 verification payment: the fee Proofline charges to perform the
 * check.
 *
 * Deliberately never called "settlement" or "invoice payment" on its own, since
 * both are ambiguous against the downstream invoice payment the consuming agent
 * is deciding about.
 */
export function SettlementPanel({
  payment,
  fee,
  health,
  status,
  rejected,
}: {
  payment: PaymentInfo | null;
  /** Price in HBAR as the server stated it in the 402 challenge. */
  fee: string | null;
  health: ServiceHealth | null;
  status: PaymentStatus;
  rejected: boolean;
}) {
  const copy = STATUS_COPY[status];
  const network = formatNetwork(payment?.network) || formatNetwork(health?.network);
  const facilitator = facilitatorLabel(health?.facilitator);

  return (
    <div id="proof">
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className={[
            "rounded-sm border px-2 py-0.5 font-mono text-[0.71rem] font-semibold tracking-[0.04em]",
            status === "PAID"
              ? "border-clear-border bg-clear-bg text-clear"
              : status === "NOT_SETTLED"
                ? "border-line-strong bg-panel-2 text-faint"
                : "border-review-border bg-review-bg text-review",
          ].join(" ")}
        >
          {copy.label.toUpperCase()}
        </span>
        <span className="max-w-[34rem] text-[0.81rem] leading-relaxed text-muted">
          {rejected && status === "NOT_SETTLED"
            ? "No payment was settled: the analysis failed before settlement."
            : copy.note}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        {/* Rendered only when the server actually stated a price. */}
        {fee ? (
          <Field
            label="Amount"
            value={<span className="text-[0.95rem] font-semibold">{fee} HBAR</span>}
          />
        ) : null}
        {network ? <Field label="Network" value={network} mono={false} /> : null}
        <Field label="Protocol" value="x402" />
        {facilitator ? (
          <Field label="Facilitator" value={facilitator} breakAnywhere={false} />
        ) : null}
        {payment?.payer ? <Field label="Paid by" value={payment.payer} /> : null}
        {payment?.transaction ? (
          <Field
            label="Transaction"
            value={payment.transaction}
            className="sm:col-span-2 lg:col-span-1"
          />
        ) : (
          <Field
            label="Transaction"
            value={
              <span className="font-sans text-[0.83rem] text-muted">
                Not available for this run
              </span>
            }
            mono={false}
            className="sm:col-span-2 lg:col-span-1"
          />
        )}
      </div>

      {payment?.transaction ? (
        <div className="mt-5 border-t border-line pt-4">
          <a
            className="hashscan font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
            href={payment.hashscan || hashscanUrl(payment.transaction)}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on HashScan →
          </a>
        </div>
      ) : null}
    </div>
  );
}
