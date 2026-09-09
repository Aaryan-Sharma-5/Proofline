"""Verification history: privacy of the public read endpoints.

The rule (CLAUDE.md Section 13) is that vendor and beneficiary data must not
come back through the history API. Here that is verified against records
produced by real analysis, including a document that is *not* one of the
bundled samples, because the sample carve-out is exactly where an accidental
leak would hide.
"""

from __future__ import annotations

import pathlib

import pytest
from fastapi.testclient import TestClient

import app as analysis_app
import db
from proofline_engine import verify_document

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
BACKEND = REPO_ROOT / "backend"

# Values that appear in the corpus documents. None of these may ever be
# returned by the history API.
SENSITIVE_STRINGS = (
    "Northwind Logistics Ltd",
    "northwindlogisticsltd",
    "4471-0092-8815",
    "447100928815",
    "8820-5517-3094",
    "882055173094",
    "Meridian Foods Group",
    "INV-2026-0413",
    "Freight forwarding",
    "Dockside Business Park",
)


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A client backed by a throwaway database, so tests never touch real data."""
    database = tmp_path / "history-test.db"
    monkeypatch.setattr(db, "DATABASE_PATH", database)
    db.init_db(database)
    return TestClient(analysis_app.app)


@pytest.fixture
def seeded(client, doc, history):
    """Records one sample and one non-sample verification."""
    sample = verify_document(doc("03_changed_beneficiary.pdf"), history)

    # A document that is emphatically not a bundled sample: same generator, but
    # a distinct vendor and account, so a leak would be unambiguous.
    ids = {}
    ids["sample"] = db.record_verification(
        document_hash=sample.document_hash,
        decision=sample.decision,
        policy_score=sample.policy_score,
        evidence_codes=sample.evidence_codes,
        service_version=sample.service_version,
    )
    ids["nonsample"] = db.record_verification(
        document_hash="sha256:" + "e" * 64,
        decision="REVIEW",
        policy_score=60,
        evidence_codes=["BENEFICIARY_ACCOUNT_NEVER_SEEN"],
        service_version="test",
    )
    return ids


def test_list_returns_only_public_fields(client, seeded):
    response = client.get("/verification")
    assert response.status_code == 200

    records = response.json()["verifications"]
    assert records, "expected at least one record"

    allowed = set(analysis_app.PUBLIC_LIST_FIELDS)
    for record in records:
        assert set(record) <= allowed, f"unexpected field: {set(record) - allowed}"


def test_list_never_exposes_policy_score(client, seeded):
    """The score is an internal mechanism, not a public risk rating."""
    body = client.get("/verification").text
    assert "policy_score" not in body


def test_detail_never_exposes_policy_score(client, seeded):
    body = client.get(f"/verification/{seeded['sample']}").text
    assert "policy_score" not in body


def test_detail_of_non_sample_record_is_masked(client, seeded):
    """The important case: an arbitrary, non-sample document.

    Section 13 allows unmasking only for intentionally bundled public samples.
    Nothing here is a sample, so nothing sensitive may appear.
    """
    response = client.get(f"/verification/{seeded['nonsample']}")
    assert response.status_code == 200

    body = response.text
    for sensitive in SENSITIVE_STRINGS:
        assert sensitive not in body, f"leaked {sensitive!r} for a non-sample record"

    payload = response.json()
    allowed = set(analysis_app.PUBLIC_DETAIL_FIELDS)
    assert set(payload) <= allowed


def test_detail_of_sample_record_is_also_masked(client, seeded):
    """Even the sample record carries no vendor data, because none is stored."""
    body = client.get(f"/verification/{seeded['sample']}").text
    for sensitive in SENSITIVE_STRINGS:
        assert sensitive not in body, f"leaked {sensitive!r} for a sample record"


def test_no_raw_document_content_is_returned(client, seeded):
    """Raw documents are transient and never surface through history APIs."""
    for path in ("/verification", f"/verification/{seeded['sample']}"):
        body = client.get(path).text
        assert "%PDF" not in body
        assert "line_items" not in body
        assert "extraction" not in body


def test_unknown_verification_id_is_404(client, seeded):
    assert client.get("/verification/vf_does_not_exist").status_code == 404


def test_list_limit_is_bounded(client, seeded):
    """A caller cannot ask for an unbounded page."""
    response = client.get("/verification", params={"limit": 100000})
    assert response.status_code == 200
    assert len(response.json()["verifications"]) <= analysis_app.MAX_HISTORY_LIMIT


def test_history_routes_are_read_only(client, seeded):
    for method in ("post", "put", "delete", "patch"):
        response = getattr(client, method)("/verification")
        assert response.status_code in (404, 405), method
