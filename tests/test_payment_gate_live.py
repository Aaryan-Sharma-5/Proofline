"""The payment gate, against real running services.

These are the tests that cannot be made meaningful without a real payment, so
they are not faked. They are skipped unless the stack is actually up and
`PROOFLINE_LIVE=1` is set, and the skip reason says exactly what is missing.

Run them with:

    # in three terminals, from the repo root
    python backend/app.py
    cd x402-gate && npm run agent
    cd x402-gate && FACILITATOR_URL=https://api.testnet.blocky402.com npm start

    PROOFLINE_LIVE=1 pytest tests/test_payment_gate_live.py -v

The access-log invariant below is the one that matters most: it is the
structural guarantee that analysis never runs unpaid (CLAUDE.md Section 1.6),
and it is asserted by counting real rows, not by trusting a 402 status code.
"""

from __future__ import annotations

import os
import pathlib
import sqlite3
import time

import pytest

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
DATABASE = REPO_ROOT / "backend" / "proofline.db"

GATEWAY = os.environ.get("GATEWAY_URL", "http://127.0.0.1:4021")
ANALYSIS = os.environ.get("ANALYSIS_SERVICE_URL", "http://127.0.0.1:8099")

LIVE = os.environ.get("PROOFLINE_LIVE") == "1"


def _stack_is_up() -> bool:
    if httpx is None:
        return False
    try:
        return httpx.get(f"{GATEWAY}/health", timeout=3).status_code == 200
    except Exception:
        return False


pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        not LIVE,
        reason="live payment tests: set PROOFLINE_LIVE=1 and run the stack "
        "(these perform real Hedera testnet payments)",
    ),
    pytest.mark.skipif(
        LIVE and not _stack_is_up(),
        reason=f"gateway not reachable at {GATEWAY}",
    ),
]


def verification_row_count() -> int:
    if not DATABASE.exists():
        return 0
    connection = sqlite3.connect(DATABASE)
    try:
        return connection.execute("SELECT COUNT(*) FROM verification").fetchone()[0]
    finally:
        connection.close()


@pytest.fixture
def corpus_bytes(doc):
    return doc("01_baseline_clean.pdf").read_bytes()


def test_unpaid_verify_is_rejected(corpus_bytes):
    response = httpx.post(
        f"{GATEWAY}/verify",
        content=corpus_bytes,
        headers={"content-type": "application/pdf"},
        timeout=60,
    )
    assert response.status_code == 402
    assert response.headers.get("payment-required")


def test_unpaid_requests_never_reach_analyze(corpus_bytes):
    """The access-log invariant, measured by persisted rows.

    Every successful analysis writes exactly one Verification row, so the row
    count is a reliable proxy for "did analysis run". Unpaid attempts must not
    move it.
    """
    before = verification_row_count()

    for _ in range(3):
        response = httpx.post(
            f"{GATEWAY}/verify",
            content=corpus_bytes,
            headers={"content-type": "application/pdf"},
            timeout=60,
        )
        assert response.status_code == 402

    time.sleep(1)
    assert verification_row_count() == before, (
        "an unpaid request reached the analysis service"
    )


def test_analyze_is_not_routable_through_the_gateway(corpus_bytes):
    """No public path to the internal service, including traversal attempts."""
    for path in (
        "/analyze",
        "/analyze/",
        "//analyze",
        "/verify/../analyze",
        "/docs/../analyze",
    ):
        response = httpx.post(
            f"{GATEWAY}{path}",
            content=corpus_bytes,
            headers={"content-type": "application/pdf"},
            timeout=30,
        )
        assert response.status_code == 404, path


def test_public_schema_does_not_advertise_analyze():
    body = httpx.get(f"{GATEWAY}/openapi.json", timeout=30).text
    assert "/analyze" not in body


def test_history_endpoints_are_reachable_through_the_gateway():
    listing = httpx.get(f"{GATEWAY}/verification", timeout=30)
    assert listing.status_code == 200
    assert "policy_score" not in listing.text


@pytest.mark.slow
def test_demo_verify_performs_a_real_payment_and_acts():
    """Full hosted-judge path: real settlement, real verdict, real action."""
    before = verification_row_count()

    response = httpx.post(
        f"{GATEWAY}/demo/verify",
        json={"sample": "03_changed_beneficiary.pdf"},
        timeout=180,
    )
    assert response.status_code == 200
    payload = response.json()

    assert payload["verification"]["decision"] == "REVIEW"
    assert "BENEFICIARY_ACCOUNT_NEVER_SEEN" in payload["verification"]["evidence_codes"]

    # A real settled transaction, not a fabricated one.
    assert payload["payment"]["transaction"]
    assert payload["payment"]["hashscan"].startswith("https://hashscan.io/")

    # The verdict changed what happened next.
    assert payload["agent"]["action"] == "HALT"
    assert payload["agent"]["downstreamPaymentReleased"] is False

    assert verification_row_count() == before + 1
