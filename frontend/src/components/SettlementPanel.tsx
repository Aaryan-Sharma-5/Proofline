import { formatNetwork, facilitatorLabel } from "../hooks/useServiceStatus";
import { hashscanUrl } from "../lib/api";
import type { PaymentInfo, ServiceHealth } from "../lib/types";
import { Field } from "./Panel";

/**
 * The verification fee, which is the payment Proofline itself charges.
 *
 * Kept deliberately distinct from the downstream invoice payment the agent is
 * deciding about (CLAUDE.md Section 12): the word "payment" alone is ambiguous
 * between the two, and conflating them misrepresents what settled onchain.
 */
export function SettlementPanel({
  payment,
  verificationId,
  fee,
  health,
  rejected,
}: {
  payment: PaymentInfo | null;
  verificationId: string | null;
  /** Price in HBAR as the server reported it in the 402 challenge. */
  fee: string | null;
  health: ServiceHealth | null;
  rejected: boolean;
}) {
  if (!payment?.transaction) {
    return (
      <div id="proof" className="text-[0.86rem] italic text-muted">
        {rejected
          ? "No settled fee was reported: the analysis failed before settlement."
          : "No settled fee was reported for this run."}
      </div>
    );
  }

  const network = formatNetwork(payment.network) || formatNetwork(health?.network);
  const facilitator = facilitatorLabel(health?.facilitator);

  return (
    <div id="proof">
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        {/* Rendered only when the server actually reported a price. */}
        {fee ? (
          <Field
            label="Verification fee"
            value={<span className="text-[0.95rem] font-semibold">{fee} HBAR</span>}
          />
        ) : null}
        {network ? <Field label="Network" value={network} mono={false} /> : null}
        {facilitator ? (
          <Field label="Settlement" value={facilitator} breakAnywhere={false} />
        ) : null}
        {payment.payer ? <Field label="Paid by" value={payment.payer} /> : null}
        {verificationId ? (
          <Field label="Verification" value={verificationId} />
        ) : null}
        <Field
          label="Transaction"
          value={payment.transaction}
          className="sm:col-span-2 lg:col-span-1"
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4">
        <a
          className="hashscan font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
          href={payment.hashscan || hashscanUrl(payment.transaction)}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on HashScan →
        </a>
        <span className="text-[0.78rem] text-faint">
          This is the fee paid to Proofline for the verification, not the invoice
          payment the agent is deciding about.
        </span>
      </div>
    </div>
  );
}
