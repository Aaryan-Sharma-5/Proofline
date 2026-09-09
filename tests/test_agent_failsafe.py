"""The agent's fail-closed rule.

Only an explicit CLEAR releases a downstream payment. A missing, malformed or
unrecognised verdict, and a transport failure, must all halt: the agent must
never treat "I could not read the answer" as permission to pay.

The decision logic lives in TypeScript (x402-gate/src/agent-action.ts), so these
drive it through Node rather than reimplementing it in Python. Reimplementing it
would test a copy, not the thing that runs.
"""

from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess
import tempfile

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
GATE = REPO_ROOT / "x402-gate"

pytestmark = pytest.mark.skipif(
    shutil.which("npx") is None or not (GATE / "node_modules").exists(),
    reason="requires the x402-gate Node dependencies (npm install in x402-gate/)",
)


def run_agent_decision(verdict: dict, ledger_preload: str | None = None) -> dict:
    """Runs decideAndAct against a verdict and returns the outcome.

    Written to a temp file inside x402-gate rather than passed to `tsx --eval`,
    because --eval cannot resolve the relative import of the module under test.
    """
    script = f"""
import {{ decideAndAct, ReleaseLedger }} from "./src/agent-action.js";
const ledger = new ReleaseLedger();
const preload = {json.dumps(ledger_preload)};
if (preload) ledger.recordRelease(preload, "earlier.pdf");
const outcome = decideAndAct({json.dumps(verdict)} as never, "sample.pdf", ledger);
console.log(JSON.stringify(outcome));
"""
    handle, name = tempfile.mkstemp(suffix=".ts", prefix="agent_probe_", dir=GATE)
    probe = pathlib.Path(name)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as fh:
            fh.write(script)
        proc = subprocess.run(
            ["npx", "tsx", probe.name],
            cwd=GATE,
            capture_output=True,
            text=True,
            shell=True,
        )
    finally:
        probe.unlink(missing_ok=True)

    assert proc.returncode == 0, proc.stderr
    lines = [line for line in proc.stdout.strip().splitlines() if line.startswith("{")]
    assert lines, f"no JSON output.\nstdout: {proc.stdout}\nstderr: {proc.stderr}"
    return json.loads(lines[-1])


def test_clear_releases_payment():
    outcome = run_agent_decision({"decision": "CLEAR", "evidence_codes": []})
    assert outcome["action"] == "PROCEED"
    assert outcome["downstreamPaymentReleased"] is True


def test_review_halts_payment():
    outcome = run_agent_decision(
        {"decision": "REVIEW", "evidence_codes": ["AMOUNT_MISMATCH"]}
    )
    assert outcome["action"] == "HALT"
    assert outcome["downstreamPaymentReleased"] is False


@pytest.mark.parametrize(
    "verdict",
    [
        {},
        {"decision": None},
        {"decision": "APPROVED"},
        {"decision": ""},
        {"decision": "clear"},  # wrong case is not a CLEAR
        {"decision": 200},
        {"decision": {"nested": "CLEAR"}},
        {"evidence_codes": ["AMOUNT_MISMATCH"]},
    ],
)
def test_unrecognised_decisions_all_halt(verdict):
    outcome = run_agent_decision(verdict)
    assert outcome["action"] == "HALT", verdict
    assert outcome["downstreamPaymentReleased"] is False, verdict


def test_unknown_evidence_code_still_halts_on_review():
    outcome = run_agent_decision(
        {"decision": "REVIEW", "evidence_codes": ["SOME_FUTURE_CODE"]}
    )
    assert outcome["action"] == "HALT"
    # Reported verbatim rather than glossed with a guess.
    assert any("SOME_FUTURE_CODE" in line for line in outcome["lines"])


def test_clear_with_sub_threshold_evidence_still_proceeds():
    outcome = run_agent_decision(
        {"decision": "CLEAR", "evidence_codes": ["PDF_ID_REVISION_MISMATCH"]}
    )
    assert outcome["action"] == "PROCEED"
    # The evidence is carried forward rather than dropped silently.
    assert any("PDF_ID_REVISION_MISMATCH" in line for line in outcome["lines"])


def test_second_clear_of_same_document_skips_duplicate_release():
    """Idempotency, keyed on document_hash.

    No payment is needed to prove this: the ledger is the agent's own state, and
    the rule under test is 'do not release twice for one document'.
    """
    document_hash = "sha256:57b800e4410c1413408200c07d989384981a15e0d4e796d685389"
    verdict = {
        "decision": "CLEAR",
        "evidence_codes": [],
        "document_hash": document_hash,
    }

    first = run_agent_decision(verdict)
    assert first["action"] == "PROCEED"
    assert first["downstreamPaymentReleased"] is True

    # Same document, ledger already carries its key.
    second = run_agent_decision(verdict, ledger_preload=document_hash)
    assert second["action"] == "SKIP"
    assert second["downstreamPaymentReleased"] is False


def test_different_documents_each_release():
    a = run_agent_decision(
        {"decision": "CLEAR", "evidence_codes": [], "document_hash": "sha256:aaa"},
        ledger_preload="sha256:bbb",
    )
    assert a["action"] == "PROCEED"
