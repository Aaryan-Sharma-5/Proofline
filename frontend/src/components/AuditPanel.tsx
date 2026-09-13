/**
 * Audit status.
 *
 * The HCS audit trail is not implemented (CLAUDE.md Section 14 marks it P1, and
 * no code publishes to a topic). This panel therefore reports its absence
 * plainly rather than showing a placeholder link or an invented record
 * (Section 13). When publishing exists, `messageId` carries the real value and
 * this renders the record instead.
 */
export function AuditPanel({ messageId }: { messageId?: string | null }) {
  if (!messageId) {
    return (
      <div id="audit" className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="rounded-sm border border-line-strong px-2 py-0.5 font-mono text-[0.68rem] uppercase tracking-[0.07em] text-faint">
          Not available
        </span>
        <span className="text-[0.83rem] text-muted">
          The HCS audit record is not implemented yet. The settled transaction
          above is the onchain proof for this run.
        </span>
      </div>
    );
  }

  return (
    <div id="audit" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="wrap-break-word break-all font-mono text-[0.8rem]">
        {messageId}
      </span>
    </div>
  );
}
