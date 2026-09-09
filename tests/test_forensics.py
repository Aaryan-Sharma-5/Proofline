"""Forensic engine: evidence codes, policy thresholds, determinism.

These lock in behaviour that was verified by hand across Milestones 1 and 3,
including the two findings that changed the design: Level B no longer escalates
alone, and Level C never escalates at all.
"""

from __future__ import annotations

import io
import json
import subprocess
import sys

import pytest

from proofline_engine import (
    AMOUNT_MISMATCH,
    BENEFICIARY_ACCOUNT_NEVER_SEEN,
    DECISION_CLEAR,
    DECISION_REVIEW,
    EXTRACTION_INCOMPLETE,
    IMAGE_COMPRESSION_INCONSISTENCY,
    PDF_ID_REVISION_MISMATCH,
    POLICY_WEIGHTS,
    REVIEW_THRESHOLD,
    Evidence,
    EvidenceLevel,
    evaluate_policy,
    verify_document,
)


# ---------------------------------------------------------------------------
# Individual evidence codes, one per corpus document
# ---------------------------------------------------------------------------


def test_baseline_is_clear_with_no_evidence(doc, history):
    result = verify_document(doc("01_baseline_clean.pdf"), history)
    assert result.decision == DECISION_CLEAR
    assert result.evidence_codes == []
    assert result.policy_score == 0


def test_altered_total_raises_amount_mismatch(doc, history):
    result = verify_document(doc("02_altered_total.pdf"), history)
    assert result.decision == DECISION_REVIEW
    assert result.evidence_codes == [AMOUNT_MISMATCH]

    detail = next(e for e in result.evidence if e.code == AMOUNT_MISMATCH).detail
    # The engine reports the observed discrepancy, not a verdict about intent.
    assert detail["stated_total"] != detail["line_item_sum"]


def test_changed_beneficiary_raises_history_anomaly(doc, history):
    result = verify_document(doc("03_changed_beneficiary.pdf"), history)
    assert result.decision == DECISION_REVIEW
    assert result.evidence_codes == [BENEFICIARY_ACCOUNT_NEVER_SEEN]


def test_amount_and_beneficiary_are_independent(doc, history):
    """The byte-patched document must not also trip the structural check.

    Document 02 is patched in place so the trailer /ID is untouched. If it ever
    starts reporting PDF_ID_REVISION_MISMATCH, the corpus has stopped isolating
    Level A from Level B and the other tests here mean less.
    """
    result = verify_document(doc("02_altered_total.pdf"), history)
    assert PDF_ID_REVISION_MISMATCH not in result.evidence_codes


# ---------------------------------------------------------------------------
# Level thresholds: the corpus's specific combinations
# ---------------------------------------------------------------------------


def test_level_b_alone_does_not_escalate(doc, history):
    """A tool round-trip is evidence, but not enough on its own.

    This is the Milestone 3 finding: an untampered PDF re-saved by another tool
    is common and benign, so Level B needs a second signal.
    """
    result = verify_document(doc("04_resaved_different_tool.pdf"), history)
    assert result.evidence_codes == [PDF_ID_REVISION_MISMATCH]
    assert result.decision == DECISION_CLEAR
    assert result.policy_score < REVIEW_THRESHOLD


def test_level_c_alone_does_not_escalate(doc, history):
    """Corroborating image evidence never escalates by itself (Section 1.4)."""
    result = verify_document(doc("05_rasterized_jpeg_copy.pdf"), history)
    assert result.evidence_codes == [IMAGE_COMPRESSION_INCONSISTENCY]
    assert result.decision == DECISION_CLEAR
    assert result.policy_score < REVIEW_THRESHOLD


def test_level_b_plus_c_reaches_threshold():
    """Two sub-threshold signals together do escalate."""
    evidence = [
        Evidence(PDF_ID_REVISION_MISMATCH, EvidenceLevel.STRUCTURAL, "structural"),
        Evidence(
            IMAGE_COMPRESSION_INCONSISTENCY, EvidenceLevel.CORROBORATING, "image"
        ),
    ]
    decision, score = evaluate_policy(evidence)
    assert score >= REVIEW_THRESHOLD
    assert decision == DECISION_REVIEW


def test_corroborating_evidence_can_never_escalate_alone():
    """Structural guarantee, not just the current weights.

    Even if every Level C code fired at once, the total must stay below the
    review threshold.
    """
    corroborating = [
        code
        for code, weight in POLICY_WEIGHTS.items()
        if weight and code == IMAGE_COMPRESSION_INCONSISTENCY
    ]
    evidence = [
        Evidence(code, EvidenceLevel.CORROBORATING, "image") for code in corroborating
    ]
    decision, score = evaluate_policy(evidence)
    assert score < REVIEW_THRESHOLD
    assert decision == DECISION_CLEAR


def test_level_a_escalates_alone():
    for code in (AMOUNT_MISMATCH, BENEFICIARY_ACCOUNT_NEVER_SEEN):
        decision, score = evaluate_policy(
            [Evidence(code, EvidenceLevel.SEMANTIC, "semantic")]
        )
        assert decision == DECISION_REVIEW, code
        assert score >= REVIEW_THRESHOLD, code


# ---------------------------------------------------------------------------
# Extraction safeguard (Section 1.5)
# ---------------------------------------------------------------------------


def _blank_pdf(path):
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(str(path), invariant=1)
    c.showPage()
    c.save()
    return path


def _partial_pdf(path):
    """Has a vendor, number, date and total, but no line items or account."""
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(str(path), invariant=1, pageCompression=0)
    c.setFont("Helvetica", 11)
    c.drawString(56, 780, "Northwind Logistics Ltd")
    c.drawString(56, 740, "Invoice Number: INV-2026-0413")
    c.drawString(56, 720, "Invoice Date: 2026-08-21")
    c.drawString(56, 680, "TOTAL DUE 5,250.00")
    c.showPage()
    c.save()
    return path


def test_blank_document_is_extraction_incomplete(tmp_path, history):
    result = verify_document(_blank_pdf(tmp_path / "blank.pdf"), history)
    assert EXTRACTION_INCOMPLETE in result.evidence_codes
    assert result.decision == DECISION_REVIEW


def test_partial_document_is_extraction_incomplete(tmp_path, history):
    result = verify_document(_partial_pdf(tmp_path / "partial.pdf"), history)
    assert EXTRACTION_INCOMPLETE in result.evidence_codes
    assert result.decision == DECISION_REVIEW
    missing = result.extraction.missing_fields()
    assert "line_items" in missing and "beneficiary_account" in missing


def test_extraction_failure_never_becomes_clear_via_low_score(tmp_path, history):
    """A low score must not substitute for successful extraction.

    The blank document scores zero, which is well under the review threshold,
    and must still come back REVIEW.
    """
    result = verify_document(_blank_pdf(tmp_path / "blank2.pdf"), history)
    assert result.policy_score < REVIEW_THRESHOLD
    assert result.decision == DECISION_REVIEW


def test_extraction_incomplete_forces_review_regardless_of_weights():
    decision, _ = evaluate_policy(
        [Evidence(EXTRACTION_INCOMPLETE, EvidenceLevel.SAFEGUARD, "safeguard")]
    )
    assert decision == DECISION_REVIEW


# ---------------------------------------------------------------------------
# Determinism (Section 19)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name",
    [
        "01_baseline_clean.pdf",
        "02_altered_total.pdf",
        "03_changed_beneficiary.pdf",
        "04_resaved_different_tool.pdf",
        "05_rasterized_jpeg_copy.pdf",
    ],
)
def test_repeated_runs_are_identical_in_process(doc, history, name):
    runs = [verify_document(doc(name), history).to_dict() for _ in range(3)]
    serialized = {json.dumps(r, sort_keys=True, default=str) for r in runs}
    assert len(serialized) == 1, f"{name} produced varying output"


def test_repeated_runs_are_identical_across_processes(corpus):
    """Catches nondeterminism that a single process would hide.

    Hash randomisation and dict ordering differ per interpreter start, so this
    runs the CLI twice in separate processes and compares byte for byte.
    """
    backend = corpus.parent
    outputs = []
    for _ in range(2):
        proc = subprocess.run(
            [sys.executable, "proofline_engine.py", "--json"],
            cwd=backend,
            capture_output=True,
            text=True,
            check=True,
        )
        outputs.append(proc.stdout)
    assert outputs[0] == outputs[1]


def test_engine_does_not_mutate_vendor_history(doc, history):
    """Verifying an unknown account must not teach the store to accept it."""
    before = history.known_accounts("Northwind Logistics Ltd")
    verify_document(doc("03_changed_beneficiary.pdf"), history)
    after = history.known_accounts("Northwind Logistics Ltd")
    assert before == after


# ---------------------------------------------------------------------------
# Output shape
# ---------------------------------------------------------------------------


def test_result_reports_every_code_including_sub_threshold(doc, history):
    """A CLEAR decision still carries the evidence that did not escalate."""
    result = verify_document(doc("04_resaved_different_tool.pdf"), history)
    assert result.decision == DECISION_CLEAR
    assert result.evidence_codes  # not empty
    assert result.to_dict()["evidence_codes"] == result.evidence_codes


def test_result_never_labels_score_as_confidence(doc, history):
    """The decision must not be presented as a probability.

    `ocr_mean_confidence` is deliberately allowed: it is tesseract's character
    recognition quality for the extraction step, not a confidence in the
    verdict. The rule is about how the *decision* is characterised.
    """
    payload = verify_document(doc("02_altered_total.pdf"), history).to_dict()
    keys = set()

    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                keys.add(key)
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)

    banned = {"confidence", "probability", "risk_score", "likelihood", "certainty"}
    assert not (keys & banned), f"engine output exposes {keys & banned}"

    # The score is present for persistence but must not be renamed into a claim.
    assert "policy_score" in keys
    assert payload["policy_score"] == 60
