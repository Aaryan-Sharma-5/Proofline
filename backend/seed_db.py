from __future__ import annotations

import json
import pathlib
import sys

import db
from proofline_engine import normalize_account, normalize_vendor_key

HERE = pathlib.Path(__file__).resolve().parent
VENDOR_HISTORY_JSON = HERE / "vendor_history.json"


def main() -> int:
    db.init_db()
    print(f"database : {db.DATABASE_PATH}")

    if not VENDOR_HISTORY_JSON.exists():
        print(
            f"missing {VENDOR_HISTORY_JSON.name}; generate the corpus first with "
            f"make_test_docs.py"
        )
        return 1

    raw = json.loads(VENDOR_HISTORY_JSON.read_text(encoding="utf-8"))

    seeded = 0
    with db.connect() as connection:
        for vendor in raw.get("vendors", []):
            vendor_key = vendor.get("vendor_key") or normalize_vendor_key(
                vendor.get("vendor_name", "")
            )
            for account in vendor.get("accounts", []):
                # Store the normalized account reference so lookups match the engine's own comparison, which strips punctuation and case.
                reference = normalize_account(account["account_reference"])
                db.seed_vendor_history(
                    vendor_key,
                    reference,
                    first_seen_at=account.get("first_seen_at"),
                    last_seen_at=account.get("last_seen_at"),
                    connection=connection,
                )
                seeded += 1
                print(
                    f"seeded   : {vendor_key} / {reference} "
                    f"(from {account['account_reference']})"
                )

    print(f"\n{seeded} vendor/account pair(s) seeded.")
    for row in db.list_vendor_history():
        print(f"  {row}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
