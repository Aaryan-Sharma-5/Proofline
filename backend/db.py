"""Persistence for Proofline..

What is stored and what is not
------------------------------
Raw uploaded documents are never persisted, and neither is raw OCR text (Section 12, and Section 1.10: documents are transient). What is kept is the verification metadata: the decision, the evidence that produced it, and a content hash of the document so the same artifact can be recognised again without retaining it.

Evidence completeness
---------------------
`Verification.evidence_codes` stores *every* evidence code the engine generated, including sub-threshold codes on a `CLEAR` result. A document that comes back CLEAR while carrying, say, `PDF_ID_REVISION_MISMATCH` records that code. Persisting only the evidence that crossed the decision threshold would silently discard observations the engine actually made, and would make the stored history disagree with the API response for the same verification.

Vendor history is read-mostly
-----------------------------
`VendorHistory` is Proofline's own record of previously observed vendor/account pairs. It is not a ledger-wide or external risk system (Section 12). Nothing in the request path writes to it: promotion of a new account to "known" is a manual, out-of-band action, so this module exposes seeding and reading but no request-time write. See `seed_vendor_history`.
"""

from __future__ import annotations

import json
import os
import pathlib
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

# Default to a local file. Running on a persistent volume is a deployment concern, configured through DATABASE_URL rather than hardcoded here.
DEFAULT_DATABASE_PATH = pathlib.Path(__file__).resolve().parent / "proofline.db"


def _resolve_database_path() -> pathlib.Path:
    """Reads DATABASE_URL, accepting either a bare path or a sqlite:// URL."""
    raw = os.environ.get("DATABASE_URL", "").strip()
    if not raw:
        return DEFAULT_DATABASE_PATH

    for prefix in ("sqlite:///", "sqlite://", "file:"):
        if raw.startswith(prefix):
            raw = raw[len(prefix) :]
            break
    return pathlib.Path(raw).expanduser().resolve()


DATABASE_PATH = _resolve_database_path()


SCHEMA = """
CREATE TABLE IF NOT EXISTS verification (
    id              TEXT PRIMARY KEY,
    document_hash   TEXT NOT NULL,
    decision        TEXT NOT NULL,
    policy_score    INTEGER NOT NULL,
    evidence_codes  TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    service_version TEXT NOT NULL,
    payment_tx_id   TEXT,
    hcs_message_id  TEXT
);

CREATE INDEX IF NOT EXISTS idx_verification_document_hash
    ON verification (document_hash);
CREATE INDEX IF NOT EXISTS idx_verification_created_at
    ON verification (created_at);

CREATE TABLE IF NOT EXISTS vendor_history (
    vendor_key        TEXT NOT NULL,
    account_reference TEXT NOT NULL,
    first_seen_at     TEXT NOT NULL,
    last_seen_at      TEXT NOT NULL,
    verification_id   TEXT,
    PRIMARY KEY (vendor_key, account_reference)
);
"""


def connect(path: pathlib.Path | None = None) -> sqlite3.Connection:
    """Opens a connection with the settings this application needs."""
    target = path or DATABASE_PATH
    target.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(target, isolation_level=None)
    connection.row_factory = sqlite3.Row
    # Write-ahead logging keeps a reader from blocking the writer, which matters once the API and any read-only query run at the same time.
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def init_db(path: pathlib.Path | None = None) -> None:
    """Creates the tables if they are absent. Safe to call repeatedly."""
    with connect(path) as connection:
        connection.executescript(SCHEMA)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_verification_id() -> str:
    """Verification ids are prefixed so they are recognisable in logs and URLs."""
    return f"vf_{uuid.uuid4().hex[:24]}"


def record_verification(
    *,
    document_hash: str,
    decision: str,
    policy_score: int,
    evidence_codes: Iterable[str],
    service_version: str,
    payment_tx_id: str | None = None,
    hcs_message_id: str | None = None,
    connection: sqlite3.Connection | None = None,
) -> str:
    """Writes one Verification row and returns its id"""
    verification_id = new_verification_id()
    row = (
        verification_id,
        document_hash,
        decision,
        int(policy_score),
        json.dumps(list(evidence_codes)),
        _utc_now(),
        service_version,
        payment_tx_id,
        hcs_message_id,
    )

    owned = connection is None
    conn = connection or connect()
    try:
        conn.execute(
            """
            INSERT INTO verification (
                id, document_hash, decision, policy_score, evidence_codes, created_at, service_version, payment_tx_id, hcs_message_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            row,
        )
    finally:
        if owned:
            conn.close()

    return verification_id


def get_verification(
    verification_id: str, connection: sqlite3.Connection | None = None
) -> dict[str, Any] | None:
    owned = connection is None
    conn = connection or connect()
    try:
        cursor = conn.execute(
            "SELECT * FROM verification WHERE id = ?", (verification_id,)
        )
        row = cursor.fetchone()
    finally:
        if owned:
            conn.close()
    return _verification_to_dict(row) if row else None


def list_verifications(
    limit: int = 50, connection: sqlite3.Connection | None = None
) -> list[dict[str, Any]]:
    owned = connection is None
    conn = connection or connect()
    try:
        cursor = conn.execute(
            "SELECT * FROM verification ORDER BY created_at DESC, rowid DESC LIMIT ?",
            (limit,),
        )
        rows = cursor.fetchall()
    finally:
        if owned:
            conn.close()
    return [_verification_to_dict(row) for row in rows]


def _verification_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "verification_id": row["id"],
        "document_hash": row["document_hash"],
        "decision": row["decision"],
        "policy_score": row["policy_score"],
        "evidence_codes": json.loads(row["evidence_codes"]),
        "created_at": row["created_at"],
        "service_version": row["service_version"],
        "payment_tx_id": row["payment_tx_id"],
        "hcs_message_id": row["hcs_message_id"],
    }


# Vendor history
# Read and seed only. There is deliberately no function here that adds an account from the request path: an unfamiliar payout account is exactly the condition BENEFICIARY_ACCOUNT_NEVER_SEEN exists to catch, so letting a verification register its own account would teach the system to accept the thing it is meant to flag. Promotion is manual and out-of-band.
def seed_vendor_history(
    vendor_key: str,
    account_reference: str,
    *,
    first_seen_at: str | None = None,
    last_seen_at: str | None = None,
    verification_id: str | None = None,
    connection: sqlite3.Connection | None = None,
) -> None:
    """Records a known vendor/account pair. Called out-of-band, never by the API."""
    now = _utc_now()
    owned = connection is None
    conn = connection or connect()
    try:
        conn.execute(
            """
            INSERT INTO vendor_history (
                vendor_key, account_reference, first_seen_at, last_seen_at, verification_id
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (vendor_key, account_reference) DO UPDATE SET
                last_seen_at = excluded.last_seen_at
            """,
            (
                vendor_key,
                account_reference,
                first_seen_at or now,
                last_seen_at or now,
                verification_id,
            ),
        )
    finally:
        if owned:
            conn.close()


def known_accounts(
    vendor_key: str, connection: sqlite3.Connection | None = None
) -> list[str]:
    owned = connection is None
    conn = connection or connect()
    try:
        cursor = conn.execute(
            "SELECT account_reference FROM vendor_history WHERE vendor_key = ?"
            " ORDER BY account_reference",
            (vendor_key,),
        )
        return [row["account_reference"] for row in cursor.fetchall()]
    finally:
        if owned:
            conn.close()


def list_vendor_history(
    connection: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    owned = connection is None
    conn = connection or connect()
    try:
        cursor = conn.execute(
            "SELECT * FROM vendor_history ORDER BY vendor_key, account_reference"
        )
        return [dict(row) for row in cursor.fetchall()]
    finally:
        if owned:
            conn.close()
