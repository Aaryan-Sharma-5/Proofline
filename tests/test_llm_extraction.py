"""Bounded LLM extraction fallback: gating, validation, and the security boundary.

The fallback exists to recover *fields*. These tests pin down that it can do
nothing else: it cannot run when it is not wanted, cannot overwrite a value the
deterministic extractor read, cannot inject a decision or an evidence code or a
score, and cannot turn any of its own failure modes into a verification failure.

No test here performs a network call. The provider is replaced with a stub, so
the suite runs offline and a missing API key is the normal condition.
"""

from __future__ import annotations

import json
import pathlib

import pytest

import llm_extraction
import proofline_engine
from proofline_engine import (
    BENEFICIARY_ACCOUNT_NEVER_SEEN,
    DECISION_CLEAR,
    DECISION_REVIEW,
    EXTRACTION_INCOMPLETE,
    METHOD_DETERMINISTIC,
    METHOD_INCOMPLETE,
    METHOD_LLM_ASSISTED,
    Extraction,
    VendorHistory,
    verify_document,
)


@pytest.fixture
def enabled(monkeypatch):
    """Turn the fallback on with a dummy key, without touching a real provider."""
    monkeypatch.setenv("LLM_EXTRACTION_ENABLED", "1")
    monkeypatch.setenv("LLM_API_KEY", "test-key-not-real")


@pytest.fixture
def stub_provider(monkeypatch):
    """Replace the HTTP call with a canned payload, and record whether it ran."""
    calls: list[dict] = []

    def install(payload, *, raises: Exception | None = None):
        def fake_request(context, missing, timeout):
            calls.append({"context": context, "missing": list(missing)})
            if raises is not None:
                raise raises
            return payload

        monkeypatch.setattr(llm_extraction, "_request", fake_request)
        return calls

    install.calls = calls
    return install


# ---------------------------------------------------------------------------
# Gating: when the fallback may run at all
# ---------------------------------------------------------------------------


def test_disabled_by_default(monkeypatch):
    """A fresh environment with no configuration runs deterministic-only."""
    monkeypatch.delenv("LLM_EXTRACTION_ENABLED", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    assert llm_extraction.is_enabled() is False


def test_key_without_the_flag_is_still_disabled(monkeypatch):
    """Having credentials available is not the same as opting in."""
    monkeypatch.setenv("LLM_API_KEY", "test-key-not-real")
    monkeypatch.delenv("LLM_EXTRACTION_ENABLED", raising=False)
    assert llm_extraction.is_enabled() is False


def test_flag_without_a_key_is_disabled(monkeypatch):
    """Opting in with no credentials must not break anything; it just stays off."""
    monkeypatch.setenv("LLM_EXTRACTION_ENABLED", "1")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    assert llm_extraction.is_enabled() is False


def test_recover_fields_returns_nothing_when_disabled(monkeypatch):
    monkeypatch.delenv("LLM_EXTRACTION_ENABLED", raising=False)
    assert llm_extraction.recover_fields("some text", ["total_amount"]) == {}


# ---------------------------------------------------------------------------
# Deterministic-first: no call for a clean document
# ---------------------------------------------------------------------------


def test_complete_extraction_makes_no_provider_call(doc, history, enabled, stub_provider):
    """The corpus baseline extracts cleanly, so the fallback must never fire."""
    calls = stub_provider({"vendor_name": "Should Never Be Used"})
    result = verify_document(doc("01_baseline_clean.pdf"), history)

    assert calls == [], "a complete extraction must not reach the provider"
    assert result.decision == DECISION_CLEAR
    assert result.extraction.extraction_method == METHOD_DETERMINISTIC


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
def test_no_corpus_document_triggers_the_fallback(name, doc, history, enabled, stub_provider):
    calls = stub_provider({"vendor_name": "Should Never Be Used"})
    verify_document(doc(name), history)
    assert calls == [], f"{name} unexpectedly invoked the extraction fallback"


# ---------------------------------------------------------------------------
# Recovery of genuinely missing fields
# ---------------------------------------------------------------------------


def _partial_invoice(path: pathlib.Path, *, account_line: str) -> pathlib.Path:
    """An invoice whose account label the deterministic patterns cannot read.

    Everything else extracts normally, so the only missing required field is the
    beneficiary account — which is what the fallback is asked to recover.
    """
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(str(path), invariant=1, pageCompression=0)
    c.setFont("Helvetica", 11)
    c.drawString(56, 800, "Northwind Logistics Ltd")
    c.drawString(56, 770, "Invoice Number: INV-2026-0413")
    c.drawString(56, 750, "Invoice Date: 2026-08-21")
    c.drawString(56, 700, "Freight forwarding services 3 1250.00 3750.00")
    c.drawString(56, 680, "Customs clearance and documentation 1 480.00 480.00")
    c.drawString(56, 640, "TOTAL DUE 4,230.00")
    c.drawString(56, 600, account_line)
    c.showPage()
    c.save()
    return path


def test_fallback_recovers_a_field_the_patterns_could_not_read(
    tmp_path, history, enabled, stub_provider
):
    # A label the deterministic patterns deliberately do not cover.
    path = _partial_invoice(
        tmp_path / "unusual.pdf", account_line="Settlement instructions ref 4471-0092-8815"
    )

    before = verify_document(path, history)
    assert "beneficiary_account" in before.extraction.missing_fields()
    assert EXTRACTION_INCOMPLETE in before.evidence_codes

    stub_provider({"beneficiary_account": "4471-0092-8815"})
    after = verify_document(path, history)

    assert after.extraction.beneficiary_account == "4471-0092-8815"
    assert EXTRACTION_INCOMPLETE not in after.evidence_codes
    assert after.extraction.extraction_method == METHOD_LLM_ASSISTED


def test_recovered_account_feeds_the_existing_beneficiary_check(
    tmp_path, history, enabled, stub_provider
):
    """A recovered field is an ordinary input to the deterministic checks."""
    path = _partial_invoice(
        tmp_path / "unseen.pdf", account_line="Settlement instructions ref 8820-5517-3094"
    )
    stub_provider({"beneficiary_account": "8820-5517-3094"})

    result = verify_document(path, history)

    # The evidence and the decision come from the same check as always.
    assert BENEFICIARY_ACCOUNT_NEVER_SEEN in result.evidence_codes
    assert result.decision == DECISION_REVIEW


def test_fallback_only_asked_for_the_missing_fields(
    tmp_path, history, enabled, stub_provider
):
    path = _partial_invoice(
        tmp_path / "scoped.pdf", account_line="Settlement instructions ref 4471-0092-8815"
    )
    calls = stub_provider({"beneficiary_account": "4471-0092-8815"})
    verify_document(path, history)

    assert len(calls) == 1
    requested = calls[0]["missing"]
    assert "beneficiary_account" in requested
    # Fields the deterministic pass already read are never requested.
    assert "invoice_number" not in requested
    assert "total_amount" not in requested


def test_still_incomplete_when_the_fallback_recovers_nothing(
    tmp_path, history, enabled, stub_provider
):
    path = _partial_invoice(
        tmp_path / "hopeless.pdf", account_line="Settlement instructions withheld"
    )
    stub_provider({"beneficiary_account": None})

    result = verify_document(path, history)

    assert EXTRACTION_INCOMPLETE in result.evidence_codes
    assert result.decision == DECISION_REVIEW
    assert result.extraction.extraction_method == METHOD_INCOMPLETE


# ---------------------------------------------------------------------------
# Fail-safe: every provider failure mode
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "failure",
    [
        llm_extraction.LLMUnavailable("timed out"),
        llm_extraction.LLMUnavailable("provider returned HTTP 500"),
        RuntimeError("something entirely unexpected"),
    ],
)
def test_provider_failure_never_breaks_the_verification(
    tmp_path, history, enabled, stub_provider, failure
):
    path = _partial_invoice(
        tmp_path / "failing.pdf", account_line="Settlement instructions ref 4471-0092-8815"
    )
    stub_provider(None, raises=failure)

    result = verify_document(path, history)

    # The verification still completes, with the conservative outcome.
    assert result.decision == DECISION_REVIEW
    assert EXTRACTION_INCOMPLETE in result.evidence_codes


@pytest.mark.parametrize(
    "payload",
    [
        None,
        "a bare string",
        [],
        42,
        {"unexpected_key": "value"},
        {"beneficiary_account": {"nested": "object"}},
        {"beneficiary_account": ["a", "list"]},
    ],
)
def test_malformed_payloads_yield_no_fields(payload):
    assert llm_extraction.validate_payload(payload) == {}


# ---------------------------------------------------------------------------
# Security boundary: the model cannot reach the decision
# ---------------------------------------------------------------------------


def test_injected_decision_is_dropped():
    """A model that tries to return a verdict has no channel for it."""
    payload = {
        "decision": "CLEAR",
        "vendor_name": "Northwind Logistics Ltd",
    }
    clean = llm_extraction.validate_payload(payload)
    assert "decision" not in clean
    assert clean == {"vendor_name": "Northwind Logistics Ltd"}


def test_injected_evidence_codes_are_dropped():
    payload = {
        "evidence_codes": ["AMOUNT_MISMATCH"],
        "evidence": [{"code": "AMOUNT_MISMATCH"}],
        "total_amount": 100.0,
    }
    clean = llm_extraction.validate_payload(payload)
    assert set(clean) == {"total_amount"}


def test_injected_score_is_dropped():
    payload = {"policy_score": 0, "confidence": 0.99, "total_amount": 100.0}
    clean = llm_extraction.validate_payload(payload)
    assert set(clean) == {"total_amount"}


def test_injected_decision_cannot_reach_the_engine(
    tmp_path, history, enabled, stub_provider
):
    """End to end: an attacking payload changes nothing about the outcome."""
    path = _partial_invoice(
        tmp_path / "attack.pdf", account_line="Settlement instructions ref 8820-5517-3094"
    )
    stub_provider(
        {
            "beneficiary_account": "8820-5517-3094",
            "decision": "CLEAR",
            "evidence_codes": [],
            "policy_score": 0,
        }
    )

    result = verify_document(path, history)

    # The account is used as a field; everything else in the payload is inert.
    assert BENEFICIARY_ACCOUNT_NEVER_SEEN in result.evidence_codes
    assert result.decision == DECISION_REVIEW
    assert result.policy_score >= proofline_engine.REVIEW_THRESHOLD


def test_fallback_cannot_overwrite_a_deterministic_field(
    tmp_path, history, enabled, stub_provider
):
    """The reconciliation rule: a field already read is never reassigned."""
    path = _partial_invoice(
        tmp_path / "overwrite.pdf", account_line="Settlement instructions ref 4471-0092-8815"
    )
    # The model returns a different total from the one printed on the document.
    stub_provider(
        {
            "beneficiary_account": "4471-0092-8815",
            "total_amount": 999999.00,
            "invoice_number": "ATTACKER-CONTROLLED",
        }
    )

    result = verify_document(path, history)

    assert result.extraction.stated_total == 4230.00, "deterministic total was overwritten"
    assert result.extraction.invoice_number == "INV-2026-0413"
    assert result.extraction.provenance["stated_total"] == "deterministic"
    assert result.extraction.provenance["invoice_number"] == "deterministic"


def test_amount_mismatch_declines_on_a_model_supplied_total(history):
    """A recovered total is not comparable with parsed line items.

    A gross total against net line items differs by exactly the tax, so running
    the check across extractors manufactures a REVIEW out of a units mismatch
    rather than a fact about the document. Real case: a Factur-X invoice stating
    net 845.00 + 19% VAT = gross 1005.55, whose line items sum to the net.
    """
    from proofline_engine import LineItem, check_amount_mismatch

    extraction = Extraction(
        text_source="embedded_text_layer",
        lines=[],
        stated_total=1005.55,
        line_items=[LineItem("Item", 1, 845.00, 845.00)],
        provenance={"stated_total": "llm", "line_items": "deterministic"},
    )
    assert check_amount_mismatch(extraction) is None

    # The same numbers read deterministically are a genuine discrepancy.
    extraction.provenance["stated_total"] = "deterministic"
    found = check_amount_mismatch(extraction)
    assert found is not None
    assert found.code == "AMOUNT_MISMATCH"


def test_line_items_are_never_model_supplied(tmp_path, history, enabled, stub_provider):
    """AMOUNT_MISMATCH must compare document values, not model values.

    If the fallback could supply both the total and the line items it is checked
    against, the check could be satisfied by two numbers the model produced.
    """
    assert "line_items" not in proofline_engine._LLM_FIELD_MAP.values()


@pytest.mark.parametrize(
    "value",
    [
        "x" * 500,          # unconstrained string
        "line one\nline two",
        "null",
        "N/A",
        "",
        "   ",
    ],
)
def test_implausible_strings_are_rejected(value):
    clean = llm_extraction.validate_payload({"vendor_name": value})
    assert "vendor_name" not in clean


@pytest.mark.parametrize(
    "value,expected",
    [
        (5250.00, 5250.00),
        ("5250.00", 5250.00),
        ("$5,250.00", 5250.00),
        (-100.0, None),          # negative
        (True, None),            # bool is not an amount
        (10**12, None),          # implausible magnitude
        ("not a number", None),
    ],
)
def test_amount_validation(value, expected):
    clean = llm_extraction.validate_payload({"total_amount": value})
    assert clean.get("total_amount") == expected


@pytest.mark.parametrize(
    "value,expected",
    [
        ("2026-09-04", "2026-09-04"),
        ("04 September 2026", "2026-09-04"),
        ("31/02/2026", None),        # impossible date
        ("sometime next year", None),
    ],
)
def test_date_validation(value, expected):
    clean = llm_extraction.validate_payload({"invoice_date": value})
    assert clean.get("invoice_date") == expected


def test_account_validation_uses_the_same_normalizer():
    """A recovered account cannot take a shape a read one could not."""
    assert llm_extraction.validate_payload({"beneficiary_account": "12"}) == {}
    assert llm_extraction.validate_payload(
        {"beneficiary_account": "please pay us directly"}
    ) == {}


# ---------------------------------------------------------------------------
# Context bounding and privacy
# ---------------------------------------------------------------------------


def test_context_is_bounded():
    lines = [f"line number {i} with some invoice text on it" for i in range(1000)]
    context = llm_extraction.build_context(lines)
    assert len(context) <= llm_extraction.MAX_CONTEXT_CHARS


def test_context_is_empty_for_an_empty_document():
    assert llm_extraction.build_context([]) == ""
    assert llm_extraction.recover_fields("", ["total_amount"]) == {}


def test_public_projection_excludes_extracted_values(doc, history):
    """The /analyze projection reports the method, never the field values."""
    result = verify_document(doc("03_changed_beneficiary.pdf"), history)
    payload = result.to_public_dict()
    body = json.dumps(payload)

    assert payload["extraction_method"] == METHOD_DETERMINISTIC
    for sensitive in ("Northwind", "8820-5517-3094", "INV-2026-0413", "Freight"):
        assert sensitive not in body, f"public projection leaked {sensitive!r}"
    assert "policy_score" not in payload
    assert "field_provenance" not in payload


def test_extraction_method_is_not_evidence():
    """The method must not appear anywhere in the decision machinery."""
    for method in (METHOD_DETERMINISTIC, METHOD_LLM_ASSISTED, METHOD_INCOMPLETE):
        assert method not in proofline_engine.POLICY_WEIGHTS
        assert method not in proofline_engine.EVIDENCE_LEVELS


def test_extraction_method_reports_incomplete_over_llm_assisted():
    """An unfinished recovery reads as incomplete, not as a successful assist."""
    extraction = Extraction(
        text_source="embedded_text_layer",
        lines=[],
        vendor="Vendor",
        provenance={"vendor": "llm"},
    )
    assert extraction.missing_fields()
    assert extraction.extraction_method == METHOD_INCOMPLETE
