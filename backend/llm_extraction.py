"""Bounded LLM fallback for invoice field recovery.

What this module is
-------------------
A *reader of last resort* for a handful of named fields, used only when the
deterministic extractor could not recover them. It exists because real invoices
carry layouts the label patterns do not cover, and a document Proofline cannot
read escalates to REVIEW — which is safe, but is not useful to a caller whose
document was perfectly legitimate and merely unusual.

What this module is not
-----------------------
It has no concept of a decision. `AMOUNT_MISMATCH`, `CLEAR`, `REVIEW`,
`policy_score` and the evidence hierarchy are not imported here and are not
representable in anything this module returns. The single exported entry point
returns field values or nothing. A model that tried to emit a verdict, an
evidence code or a score has no channel to put it in: the response schema has no
such property, and `validate_payload` drops every key it does not recognise.

Trust model
-----------
Model output is untrusted input from a third-party service, handled the way any
untrusted input is. Every field is schema-checked, type-checked, range-checked
and normalized through the *same* normalizers the deterministic path uses, so a
recovered value cannot take a shape a deterministic value could not. Anything
that fails validation is discarded field by field; a malformed response
contributes nothing and leaves the document incomplete, which escalates.

Privacy
-------
Only a bounded slice of already-extracted document text is sent, and only when
the fallback is enabled and configured. Raw OCR text is not persisted here or
anywhere else, and the text sent is never returned through a public API.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass

from extraction_patterns import (
    MAX_REASONABLE_AMOUNT,
    normalize_account_value,
    normalize_currency,
    normalize_date,
    parse_amount,
)

# Configuration. Every value is environment-driven and the feature is off unless
# a key is present, so a fresh clone with no credentials runs the deterministic
# path exactly as before.
DEFAULT_MODEL = "openai/gpt-oss-20b"
DEFAULT_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_TIMEOUT_SECONDS = 8.0

# Upper bound on how much document text is sent. An invoice page is far smaller
# than this; the cap exists so a pathological document cannot turn one
# verification into a very large request.
MAX_CONTEXT_CHARS = 6000
MAX_CONTEXT_LINES = 120

EXTRACTOR_DETERMINISTIC = "deterministic"
EXTRACTOR_LLM = "llm"

METHOD_DETERMINISTIC = "deterministic"
METHOD_LLM_ASSISTED = "llm_assisted"
METHOD_INCOMPLETE = "incomplete"

# The fields the fallback may return. This tuple is the whole surface: a key
# outside it is dropped in validation, so the model cannot introduce a new field
# name into the extraction record.
RECOVERABLE_FIELDS = (
    "vendor_name",
    "invoice_number",
    "invoice_date",
    "total_amount",
    "currency",
    "beneficiary_account",
)

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "vendor_name": {"type": ["string", "null"]},
        "invoice_number": {"type": ["string", "null"]},
        "invoice_date": {"type": ["string", "null"]},
        "total_amount": {"type": ["number", "null"]},
        "currency": {"type": ["string", "null"]},
        "beneficiary_account": {"type": ["string", "null"]},
    },
    "required": list(RECOVERABLE_FIELDS),
    "additionalProperties": False,
}

SYSTEM_PROMPT = (
    "You transcribe fields from invoice text. You are a reader, not a judge.\n"
    "Return only values that appear literally in the supplied text. If a field "
    "is not present, return null for it. Never infer, compute, convert or "
    "estimate a value, and never carry a value over from a different field.\n"
    "\n"
    "Invoices may be in any language (English, German, French, Spanish, "
    "Italian, Dutch, Portuguese and others). Read the document in whatever "
    "language it is written in and identify fields by meaning, not by matching "
    "an English label.\n"
    "\n"
    "Transcribe values exactly as printed, with two exceptions that are "
    "mechanical conversions rather than interpretation:\n"
    "  - invoice_date: report the date the document states, converted to "
    "ISO 8601 (YYYY-MM-DD). '5. August 2020' becomes 2020-08-05. Convert only "
    "the format; never adjust, infer or complete a date.\n"
    "  - total_amount: report as a JSON number. '1.005,55' becomes 1005.55.\n"
    "Do not translate a vendor name, and do not alter an account reference.\n"
    "\n"
    "Where an invoice states several totals, return the amount actually "
    "payable (the gross or final total), not a net or pre-tax subtotal. Note "
    "that this may legitimately differ from the sum of the line items when tax "
    "is applied; report what the document says and do not reconcile them.\n"
    "\n"
    "Do not assess the document. Do not comment on whether it is genuine, "
    "altered or suspicious. Only transcribe."
)

# Bounds that make a recovered value implausible enough to reject outright.
MAX_STRING_LENGTH = 200
MAX_VENDOR_LENGTH = 120


@dataclass(frozen=True)
class FieldProvenance:
    """Which extractor produced one field, retained internally.

    Not part of any public API projection. It exists so the extraction method
    can be reported honestly and so a reviewer can tell a read value from a
    recovered one.
    """

    value: object
    extractor: str
    source: str

    def to_dict(self) -> dict:
        return {"value": self.value, "extractor": self.extractor, "source": self.source}


class LLMUnavailable(Exception):
    """The fallback could not run. Never surfaced to a caller as a verdict."""


def is_configured() -> bool:
    """True when a provider key is present. Absence is normal, not an error."""
    return bool(os.environ.get("LLM_API_KEY", "").strip())


def is_enabled() -> bool:
    """The fallback runs only when explicitly enabled *and* configured.

    Two independent switches, because "we have a key in the environment" and
    "this deployment wants model-assisted extraction" are different decisions.
    Default is off.
    """
    flag = os.environ.get("LLM_EXTRACTION_ENABLED", "").strip().lower()
    return flag in {"1", "true", "yes"} and is_configured()


def build_context(lines: list[str]) -> str:
    """The bounded document slice sent to the provider.

    Only text the engine had already extracted. Truncated by both line count and
    character count so the request size is bounded regardless of document shape.
    """
    selected = [line.strip() for line in lines[:MAX_CONTEXT_LINES] if line.strip()]
    context = "\n".join(selected)
    return context[:MAX_CONTEXT_CHARS]


def _coerce_string(raw: object, *, max_length: int) -> str | None:
    """Accept a plausible short string, reject everything else.

    An unconstrained or suspiciously long string is discarded rather than
    truncated: a value that long is not a field this extractor recognises, and
    silently trimming it would turn a misread into a plausible-looking one.
    """
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text or len(text) > max_length:
        return None
    # A model that emitted a refusal, an explanation or a null-ish placeholder
    # rather than a value must not have that prose stored as a field.
    if text.lower() in {"null", "none", "n/a", "na", "unknown", "not found", "-"}:
        return None
    if "\n" in text:
        return None
    return text


def _bounded_amount(value: float) -> float | None:
    """Apply the plausibility bounds to an already-numeric amount.

    The same range rules `parse_amount` enforces, without its rendered-text
    grammar, which does not apply to a value that arrived as a JSON number.
    """
    if value != value or value in (float("inf"), float("-inf")):
        return None
    if value < 0 or value > MAX_REASONABLE_AMOUNT:
        return None
    return round(value, 2)


def validate_payload(payload: object) -> dict[str, object]:
    """Validate and normalize a model response into recognised fields only.

    Field-by-field: one bad value never discards the good ones, and no value is
    accepted unless it passes the same normalizer the deterministic path uses.
    Unknown keys are dropped, which is what prevents an injected `decision`,
    `evidence_codes` or `policy_score` from travelling any further than this
    function's local scope.
    """
    if not isinstance(payload, dict):
        return {}

    clean: dict[str, object] = {}

    vendor = _coerce_string(payload.get("vendor_name"), max_length=MAX_VENDOR_LENGTH)
    if vendor:
        clean["vendor_name"] = vendor

    number = _coerce_string(payload.get("invoice_number"), max_length=64)
    # An invoice number with no digit is almost certainly a misread label.
    if number and any(ch.isdigit() for ch in number):
        clean["invoice_number"] = number

    date_raw = _coerce_string(payload.get("invoice_date"), max_length=64)
    if date_raw:
        normalized = normalize_date(date_raw)
        if normalized:
            clean["invoice_date"] = normalized

    total = payload.get("total_amount")
    if isinstance(total, bool):
        # bool is an int subclass; a boolean is never a monetary amount.
        total = None
    if isinstance(total, (int, float)):
        # Already a number, so the rendered-text grammar does not apply: a JSON
        # 5250.0 has one decimal digit and is perfectly valid. Only the range
        # and plausibility bounds are enforced here.
        amount = _bounded_amount(float(total))
        if amount is not None:
            clean["total_amount"] = amount
    elif isinstance(total, str):
        # A string goes through the same grammar as document text, so a model
        # echoing "1.005,55" is read exactly as the deterministic path would.
        amount = parse_amount(total.replace("$", "").replace("£", "").replace("€", ""))
        if amount is not None:
            clean["total_amount"] = amount

    currency = _coerce_string(payload.get("currency"), max_length=8)
    if currency:
        code = normalize_currency(currency, currency)
        if code:
            clean["currency"] = code

    account = _coerce_string(payload.get("beneficiary_account"), max_length=MAX_STRING_LENGTH)
    if account:
        normalized_account = normalize_account_value(account)
        if normalized_account:
            clean["beneficiary_account"] = normalized_account

    return clean


def _request(context: str, missing: list[str], timeout: float) -> dict:
    """One HTTP call to the configured provider. Raises LLMUnavailable on any fault."""
    api_key = os.environ.get("LLM_API_KEY", "").strip()
    if not api_key:
        raise LLMUnavailable("no API key configured")

    endpoint = os.environ.get("LLM_API_URL", "").strip() or DEFAULT_ENDPOINT
    model = os.environ.get("LLM_MODEL", "").strip() or DEFAULT_MODEL

    user_prompt = (
        "Transcribe these fields from the invoice text below: "
        + ", ".join(missing)
        + ".\nReturn null for any field not literally present.\n\n"
        "--- INVOICE TEXT ---\n"
        + context
        + "\n--- END INVOICE TEXT ---"
    )

    body = json.dumps(
        {
            "model": model,
            "temperature": 0,
            "max_completion_tokens": 800,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "invoice_fields",
                    "strict": True,
                    "schema": RESPONSE_SCHEMA,
                },
            },
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        endpoint,
        data=body,
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        # The provider's body may echo request content; keep it out of the log.
        raise LLMUnavailable(f"provider returned HTTP {exc.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise LLMUnavailable(f"provider unreachable: {type(exc).__name__}") from None

    try:
        envelope = json.loads(raw)
        content = envelope["choices"][0]["message"]["content"]
    except (json.JSONDecodeError, KeyError, IndexError, TypeError):
        raise LLMUnavailable("provider response was not in the expected shape") from None

    try:
        parsed = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        raise LLMUnavailable("provider did not return valid JSON") from None

    if not isinstance(parsed, dict):
        raise LLMUnavailable("provider returned a non-object payload")
    return parsed


def recover_fields(
    context: str, missing: list[str], *, timeout: float | None = None
) -> dict[str, object]:
    """Attempt to recover the named fields. Returns {} on any failure.

    Every failure mode — not configured, disabled, timeout, HTTP error, invalid
    JSON, schema violation, implausible value — converges on the same empty
    result. The caller therefore has one code path for "the fallback added
    nothing", and no failure can produce anything other than fewer fields than
    it started with.
    """
    if not missing or not context.strip():
        return {}
    if not is_enabled():
        return {}

    if timeout is None:
        try:
            timeout = float(
                os.environ.get("LLM_TIMEOUT_SECONDS", "").strip()
                or DEFAULT_TIMEOUT_SECONDS
            )
        except ValueError:
            timeout = DEFAULT_TIMEOUT_SECONDS

    try:
        payload = _request(context, missing, timeout)
    except LLMUnavailable as exc:
        print(f"[extraction] LLM fallback unavailable: {exc}")
        return {}
    except Exception as exc:  # noqa: BLE001
        # A fallback must never be able to fail the verification lifecycle.
        print(f"[extraction] LLM fallback failed: {type(exc).__name__}")
        return {}

    validated = validate_payload(payload)
    # Only the fields that were actually missing may be filled. A model that
    # returned a value for a field the deterministic pass already read has no
    # way to overwrite it: the key is dropped here, before reconciliation.
    return {name: value for name, value in validated.items() if name in set(missing)}
