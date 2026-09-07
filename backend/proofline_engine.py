"""Proofline forensic engine, Deterministic document-integrity analysis. Given a PDF and Proofline's own record of previously observed vendor/account pairs, this produces a CLEAR or REVIEW decision backed by named evidence codes."""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import io
import json
import pathlib
import re
import statistics
import sys
from dataclasses import dataclass, field
from enum import Enum

import numpy as np
import pymupdf
import pytesseract
from PIL import Image

SERVICE_VERSION = "proofline-engine/0.1.0-milestone1"

HERE = pathlib.Path(__file__).resolve().parent
DEFAULT_VENDOR_HISTORY = HERE / "vendor_history.json"
DEFAULT_DOC_DIR = HERE / "test_docs"

# Evidence model
class EvidenceLevel(str, Enum):
    """The hierarchy from CLAUDE.md Section 8, made explicit in the code."""

    SEMANTIC = "A"
    STRUCTURAL = "B"
    CORROBORATING = "C"
    SAFEGUARD = "SAFEGUARD"


AMOUNT_MISMATCH = "AMOUNT_MISMATCH"
BENEFICIARY_ACCOUNT_NEVER_SEEN = "BENEFICIARY_ACCOUNT_NEVER_SEEN"
PDF_ID_REVISION_MISMATCH = "PDF_ID_REVISION_MISMATCH"
IMAGE_COMPRESSION_INCONSISTENCY = "IMAGE_COMPRESSION_INCONSISTENCY"
EXTRACTION_INCOMPLETE = "EXTRACTION_INCOMPLETE"

EVIDENCE_LEVELS = {
    AMOUNT_MISMATCH: EvidenceLevel.SEMANTIC,
    BENEFICIARY_ACCOUNT_NEVER_SEEN: EvidenceLevel.SEMANTIC,
    PDF_ID_REVISION_MISMATCH: EvidenceLevel.STRUCTURAL,
    IMAGE_COMPRESSION_INCONSISTENCY: EvidenceLevel.CORROBORATING,
    EXTRACTION_INCOMPLETE: EvidenceLevel.SAFEGUARD,
}


@dataclass(frozen=True)
class Evidence:
    code: str
    level: EvidenceLevel
    summary: str
    detail: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "level": self.level.value,
            "summary": self.summary,
            "detail": self.detail,
        }

# Deterministic policy
POLICY_WEIGHTS = {
    AMOUNT_MISMATCH: 60,
    BENEFICIARY_ACCOUNT_NEVER_SEEN: 60,
    PDF_ID_REVISION_MISMATCH: 30,
    IMAGE_COMPRESSION_INCONSISTENCY: 10,
}

REVIEW_THRESHOLD = 40

_CORROBORATING_MAX = sum(
    weight
    for code, weight in POLICY_WEIGHTS.items()
    if EVIDENCE_LEVELS[code] is EvidenceLevel.CORROBORATING
)
assert _CORROBORATING_MAX < REVIEW_THRESHOLD, (
    "Level C weights must not be able to reach the review threshold on their own"
)

# A structural/provenance signal must not escalate on its own either
_STRUCTURAL_MAX = sum(
    weight
    for code, weight in POLICY_WEIGHTS.items()
    if EVIDENCE_LEVELS[code] is EvidenceLevel.STRUCTURAL
)
assert _STRUCTURAL_MAX < REVIEW_THRESHOLD, (
    "Level B weights must not be able to reach the review threshold on their own"
)
assert _STRUCTURAL_MAX + _CORROBORATING_MAX >= REVIEW_THRESHOLD, (
    "Level B plus corroborating evidence must be able to reach the threshold"
)

DECISION_CLEAR = "CLEAR"
DECISION_REVIEW = "REVIEW"

# Extraction
MIN_TEXT_LAYER_CHARS = 50

OCR_RENDER_DPI = 300
OCR_MIN_WORD_CONFIDENCE = 40.0

SOURCE_TEXT_LAYER = "embedded_text_layer"
SOURCE_OCR = "ocr"

REQUIRED_FIELDS = (
    "vendor",
    "invoice_number",
    "invoice_date",
    "beneficiary_account",
    "stated_total",
    "line_items",
)


@dataclass(frozen=True)
class LineItem:
    description: str
    quantity: int
    unit_price: float
    amount: float

    def to_dict(self) -> dict:
        return dataclasses.asdict(self)


@dataclass
class Extraction:
    text_source: str
    lines: list[str]
    vendor: str | None = None
    invoice_number: str | None = None
    invoice_date: str | None = None
    beneficiary_account: str | None = None
    stated_total: float | None = None
    line_items: list[LineItem] = field(default_factory=list)
    ocr_mean_confidence: float | None = None

    def missing_fields(self) -> list[str]:
        missing = []
        for name in REQUIRED_FIELDS:
            value = getattr(self, name)
            if value is None or (isinstance(value, list) and not value):
                missing.append(name)
        return missing

    @property
    def complete(self) -> bool:
        return not self.missing_fields()

    def to_dict(self) -> dict:
        return {
            "text_source": self.text_source,
            "ocr_mean_confidence": self.ocr_mean_confidence,
            "vendor": self.vendor,
            "invoice_number": self.invoice_number,
            "invoice_date": self.invoice_date,
            "beneficiary_account": self.beneficiary_account,
            "stated_total": self.stated_total,
            "line_items": [item.to_dict() for item in self.line_items],
            "missing_fields": self.missing_fields(),
        }


@dataclass(frozen=True)
class _Word:
    """One recognised word with enough geometry to rebuild a visual row."""
    x0: float
    y_top: float
    y_bottom: float
    text: str


def _group_words_into_lines(words: list[_Word]) -> list[str]:
    """Rebuild visual rows from positioned words"""
    if not words:
        return []

    heights = [w.y_bottom - w.y_top for w in words if w.y_bottom > w.y_top]
    tolerance = 0.6 * statistics.median(heights) if heights else 1.0

    rows: list[list[_Word]] = []
    row_centers: list[float] = []
    for word in sorted(words, key=lambda w: ((w.y_top + w.y_bottom) / 2, w.x0)):
        center = (word.y_top + word.y_bottom) / 2
        if rows and abs(center - row_centers[-1]) <= tolerance:
            rows[-1].append(word)
        else:
            rows.append([word])
            row_centers.append(center)

    lines = []
    for row in rows:
        text = " ".join(w.text for w in sorted(row, key=lambda w: w.x0)).strip()
        if text:
            lines.append(text)
    return lines


def _words_from_text_layer(page: pymupdf.Page) -> list[_Word]:
    return [
        _Word(x0=w[0], y_top=w[1], y_bottom=w[3], text=w[4])
        for w in page.get_text("words")
        if w[4].strip()
    ]


def _words_from_ocr(page: pymupdf.Page) -> tuple[list[_Word], float | None]:
    """Render the page and read it with tesseract"""
    pixmap = page.get_pixmap(dpi=OCR_RENDER_DPI)
    image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)

    words: list[_Word] = []
    confidences: list[float] = []
    for i, text in enumerate(data["text"]):
        if not text.strip():
            continue
        try:
            confidence = float(data["conf"][i])
        except (TypeError, ValueError):
            continue
        if confidence < OCR_MIN_WORD_CONFIDENCE:
            continue
        confidences.append(confidence)
        top = float(data["top"][i])
        words.append(
            _Word(
                x0=float(data["left"][i]),
                y_top=top,
                y_bottom=top + float(data["height"][i]),
                text=text,
            )
        )

    mean_confidence = round(sum(confidences) / len(confidences), 2) if confidences else None
    return words, mean_confidence


_AMOUNT = r"\d[\d,]*\.\d{2}"
_LINE_ITEM_RE = re.compile(
    rf"^(?P<description>\S.*?)\s+(?P<quantity>\d{{1,5}})\s+"
    rf"(?P<unit_price>{_AMOUNT})\s+(?P<amount>{_AMOUNT})$"
)
_TOTAL_RE = re.compile(rf"TOTAL\s+DUE\s*:?\s*({_AMOUNT})", re.IGNORECASE)
_INVOICE_NUMBER_RE = re.compile(
    r"Invoice\s+Number\s*:?\s*([A-Za-z0-9][A-Za-z0-9\-/]{3,})", re.IGNORECASE
)
_INVOICE_DATE_RE = re.compile(
    r"Invoice\s+Date\s*:?\s*(\d{4}-\d{2}-\d{2})", re.IGNORECASE
)
_ACCOUNT_RE = re.compile(
    r"Remit\s+To\s+Account\s*:?\s*([0-9][0-9\- ]{6,}[0-9])", re.IGNORECASE
)


def _parse_amount(text: str) -> float:
    return float(text.replace(",", "").replace(" ", ""))


def _first_match(lines: list[str], pattern: re.Pattern[str]) -> str | None:
    for line in lines:
        match = pattern.search(line)
        if match:
            return match.group(1).strip()
    return None


def _parse_vendor(lines: list[str]) -> str | None:
    """Take the vendor from the letterhead, the first text line on the page"""
    for line in lines:
        candidate = re.sub(r"\bINVOICE\b", "", line, flags=re.IGNORECASE).strip()
        candidate = re.sub(r"\s{2,}", " ", candidate)
        if len(candidate) >= 3:
            return candidate
    return None


def _parse_line_items(lines: list[str]) -> list[LineItem]:
    items = []
    for line in lines:
        match = _LINE_ITEM_RE.match(line.strip())
        if not match:
            continue
        items.append(
            LineItem(
                description=match.group("description").strip(),
                quantity=int(match.group("quantity")),
                unit_price=_parse_amount(match.group("unit_price")),
                amount=_parse_amount(match.group("amount")),
            )
        )
    return items


def extract(document: pymupdf.Document) -> Extraction:
    """Read the structured fields the semantic checks need"""
    words: list[_Word] = []
    page_confidences: list[float] = []
    page_offset = 0.0

    embedded_chars = sum(
        len("".join(page.get_text().split())) for page in document
    )
    source = SOURCE_TEXT_LAYER if embedded_chars >= MIN_TEXT_LAYER_CHARS else SOURCE_OCR

    for page in document:
        if source == SOURCE_TEXT_LAYER:
            page_words = _words_from_text_layer(page)
            page_height = page.rect.height
        else:
            page_words, page_confidence = _words_from_ocr(page)
            page_height = page.rect.height * OCR_RENDER_DPI / 72.0
            if page_confidence is not None:
                page_confidences.append(page_confidence)

        # Offset each page so rows from different pages never merge into one.
        words.extend(
            dataclasses.replace(
                w, y_top=w.y_top + page_offset, y_bottom=w.y_bottom + page_offset
            )
            for w in page_words
        )
        page_offset += page_height * 2

    mean_confidence = (
        round(sum(page_confidences) / len(page_confidences), 2)
        if page_confidences
        else None
    )
    lines = _group_words_into_lines(words)

    stated_total_text = _first_match(lines, _TOTAL_RE)
    account = _first_match(lines, _ACCOUNT_RE)

    return Extraction(
        text_source=source,
        lines=lines,
        vendor=_parse_vendor(lines),
        invoice_number=_first_match(lines, _INVOICE_NUMBER_RE),
        invoice_date=_first_match(lines, _INVOICE_DATE_RE),
        beneficiary_account=account.strip() if account else None,
        stated_total=_parse_amount(stated_total_text) if stated_total_text else None,
        line_items=_parse_line_items(lines),
        ocr_mean_confidence=mean_confidence,
    )

# Vendor history, Proofline's own prior observations
def normalize_vendor_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def normalize_account(reference: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", reference.upper())


class VendorHistory:
    """Previously observed vendor/account pairs"""

    def __init__(self, vendors: dict[str, dict]) -> None:
        self._vendors = vendors

    @classmethod
    def load(cls, path: pathlib.Path) -> "VendorHistory":
        if not path.exists():
            return cls({})
        raw = json.loads(path.read_text(encoding="utf-8"))
        vendors = {}
        for entry in raw.get("vendors", []):
            key = entry.get("vendor_key") or normalize_vendor_key(
                entry.get("vendor_name", "")
            )
            vendors[key] = {
                "vendor_name": entry.get("vendor_name", ""),
                "accounts": sorted(
                    normalize_account(a["account_reference"])
                    for a in entry.get("accounts", [])
                ),
            }
        return cls(vendors)

    def known_accounts(self, vendor_name: str) -> list[str] | None:
        """Accounts seen before for this vendor, or None if the vendor is unknown."""
        entry = self._vendors.get(normalize_vendor_key(vendor_name))
        return list(entry["accounts"]) if entry else None

# Level A, direct semantic inconsistencies
AMOUNT_TOLERANCE = 0.01

def check_amount_mismatch(extraction: Extraction) -> Evidence | None:
    """Compare the stated total against the sum of the extracted line items."""
    if extraction.stated_total is None or not extraction.line_items:
        return None

    line_item_sum = round(sum(item.amount for item in extraction.line_items), 2)
    difference = round(extraction.stated_total - line_item_sum, 2)
    if abs(difference) <= AMOUNT_TOLERANCE:
        return None

    return Evidence(
        code=AMOUNT_MISMATCH,
        level=EvidenceLevel.SEMANTIC,
        summary=(
            "The stated total does not equal the sum of the extracted line items."
        ),
        detail={
            "stated_total": extraction.stated_total,
            "line_item_sum": line_item_sum,
            "difference": difference,
            "line_item_count": len(extraction.line_items),
        },
    )


def check_beneficiary_history(
    extraction: Extraction, history: VendorHistory
) -> Evidence | None:
    """Compare the requested payout account against prior observations"""
    if not extraction.vendor or not extraction.beneficiary_account:
        return None

    known = history.known_accounts(extraction.vendor)
    if not known:
        return None

    current = normalize_account(extraction.beneficiary_account)
    if current in known:
        return None

    return Evidence(
        code=BENEFICIARY_ACCOUNT_NEVER_SEEN,
        level=EvidenceLevel.SEMANTIC,
        summary=(
            "This vendor has a previously observed payout account, and the current document requests a different one."
        ),
        detail={
            "vendor": extraction.vendor,
            "requested_account": extraction.beneficiary_account,
            "previously_observed_account_count": len(known),
        },
    )

# Level B, document structure and provenance
_TRAILER_ID_RE = re.compile(
    rb"/ID\s*\[\s*<([0-9A-Fa-f]*)>\s*<([0-9A-Fa-f]*)>\s*\]", re.S
)


def read_trailer_id(pdf_bytes: bytes) -> tuple[str, str] | None:
    matches = _TRAILER_ID_RE.findall(pdf_bytes)
    if not matches:
        return None
    first, second = matches[-1]
    return first.decode("ascii").lower(), second.decode("ascii").lower()


def check_pdf_trailer_id(pdf_bytes: bytes) -> Evidence | None:
    """Compare the two entries of the PDF trailer `/ID` array.
    That is the whole claim. It is not proof of when or how a document was created, it does not identify an editing application, and it is not evidence of intent. Producers vary in how they maintain this field, and a mismatch is a routine result of any tool rewriting a file for an entirely ordinary reason."""
    identifiers = read_trailer_id(pdf_bytes)
    if identifiers is None:
        return None

    first, second = identifiers
    if first == second:
        return None

    return Evidence(
        code=PDF_ID_REVISION_MISMATCH,
        level=EvidenceLevel.STRUCTURAL,
        summary=(
            "The trailer /ID entries differ, indicating that the current revision differs from its original identifier. This does not establish how or when the document was produced."
        ),
        detail={
            "original_id": first,
            "current_id": second,
        },
    )

# Level C, corroborating image evidence
# 10.0 sits just below quality 90. Above that the compression is near-lossless and not worth remarking on.
QUANTIZATION_MEAN_THRESHOLD = 10.0

# Pixels at or above this luminance are treated as blank paper. An error-level measurement over a page that is ~98% saturated white is dominated by regions that carry no information, so the residual is reported over content pixels only.
CONTENT_LUMINANCE_CEILING = 245
ELA_REFERENCE_QUALITY = 95


def _error_level_residual(image: Image.Image) -> float | None:
    """Mean error-level residual over the content pixels of the page"""
    grey = np.asarray(image.convert("L"), dtype=np.float64)
    content = grey < CONTENT_LUMINANCE_CEILING
    if not content.any():
        return None

    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", quality=ELA_REFERENCE_QUALITY)
    reencoded = np.asarray(
        Image.open(io.BytesIO(buffer.getvalue())).convert("L"), dtype=np.float64
    )
    if reencoded.shape != grey.shape:
        return None

    return round(float(np.abs(grey - reencoded)[content].mean()), 4)


def check_image_compression(document: pymupdf.Document) -> Evidence | None:
    """Report lossy compression characteristics of the largest embedded page raster"""
    candidates = []
    for page in document:
        for image_ref in page.get_images(full=True):
            try:
                candidates.append(document.extract_image(image_ref[0]))
            except Exception:
                continue

    if not candidates:
        return None

    raster = max(candidates, key=lambda info: info["width"] * info["height"])
    if raster["ext"].lower() not in {"jpeg", "jpg"}:
        return None

    try:
        image = Image.open(io.BytesIO(raster["image"]))
        tables = getattr(image, "quantization", None)
        if not tables:
            return None
        luminance = np.asarray(tables[0], dtype=np.float64)
        quantization_mean = round(float(luminance.mean()), 3)
        residual = _error_level_residual(image)
    except Exception:
        return None

    if quantization_mean < QUANTIZATION_MEAN_THRESHOLD:
        return None

    return Evidence(
        code=IMAGE_COMPRESSION_INCONSISTENCY,
        level=EvidenceLevel.CORROBORATING,
        summary=(
            "The page is a lossily compressed raster whose quantization level shows that image detail was discarded. Corroborating only: this is expected of any legitimately scanned or re-exported document and never escalates on its own."
        ),
        detail={
            "encoding": raster["ext"],
            "width": raster["width"],
            "height": raster["height"],
            "quantization_mean": quantization_mean,
            "quantization_threshold": QUANTIZATION_MEAN_THRESHOLD,
            "error_level_residual": residual,
        },
    )

# Policy evaluation
def evaluate_policy(evidence: list[Evidence]) -> tuple[str, int]:
    """Turn evidence into a decision. Deterministic, no exceptions to the rules"""
    score = sum(POLICY_WEIGHTS.get(item.code, 0) for item in evidence)

    if any(item.code == EXTRACTION_INCOMPLETE for item in evidence):
        return DECISION_REVIEW, score

    material = [
        item for item in evidence if item.level is not EvidenceLevel.CORROBORATING
    ]
    if not material:
        return DECISION_CLEAR, score

    return (DECISION_REVIEW if score >= REVIEW_THRESHOLD else DECISION_CLEAR), score

# Verification entry point
_LEVEL_ORDER = {
    EvidenceLevel.SAFEGUARD: 0,
    EvidenceLevel.SEMANTIC: 1,
    EvidenceLevel.STRUCTURAL: 2,
    EvidenceLevel.CORROBORATING: 3,
}


@dataclass
class VerificationResult:
    document_hash: str
    decision: str
    evidence_codes: list[str]
    evidence: list[Evidence]
    extraction: Extraction
    policy_score: int
    service_version: str

    def to_dict(self, include_extraction: bool = True) -> dict:
        payload = {
            "document_hash": self.document_hash,
            "decision": self.decision,
            "evidence_codes": self.evidence_codes,
            "evidence": [item.to_dict() for item in self.evidence],
            # Internal policy mechanism. Not a confidence value or a probability.
            "policy_score": self.policy_score,
            "service_version": self.service_version,
        }
        if include_extraction:
            payload["extraction"] = self.extraction.to_dict()
        return payload


class InvalidDocument(Exception):
    """The input could not be opened as a PDF at all."""


def verify_document(
    path: pathlib.Path, history: VendorHistory
) -> VerificationResult:
    pdf_bytes = path.read_bytes()
    document_hash = "sha256:" + hashlib.sha256(pdf_bytes).hexdigest()

    try:
        document = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise InvalidDocument(str(exc)) from exc

    try:
        extraction = extract(document)

        evidence: list[Evidence] = []

        missing = extraction.missing_fields()
        if missing:
            evidence.append(
                Evidence(
                    code=EXTRACTION_INCOMPLETE,
                    level=EvidenceLevel.SAFEGUARD,
                    summary=(
                        "One or more required fields could not be read reliably, so the semantic checks that depend on them could not be evaluated."
                    ),
                    detail={
                        "missing_fields": missing,
                        "text_source": extraction.text_source,
                        "ocr_mean_confidence": extraction.ocr_mean_confidence,
                    },
                )
            )

        # Level A. Each check returns None when its inputs are unavailable, so a partial extraction degrades into the safeguard above rather than into a quietly clean result.
        for check in (check_amount_mismatch,):
            found = check(extraction)
            if found:
                evidence.append(found)
        found = check_beneficiary_history(extraction, history)
        if found:
            evidence.append(found)

        # Level B and C do not depend on extraction succeeding.
        found = check_pdf_trailer_id(pdf_bytes)
        if found:
            evidence.append(found)
        found = check_image_compression(document)
        if found:
            evidence.append(found)
    finally:
        document.close()

    evidence.sort(key=lambda item: (_LEVEL_ORDER[item.level], item.code))
    decision, policy_score = evaluate_policy(evidence)

    return VerificationResult(
        document_hash=document_hash,
        decision=decision,
        evidence_codes=[item.code for item in evidence],
        evidence=evidence,
        extraction=extraction,
        policy_score=policy_score,
        service_version=SERVICE_VERSION,
    )

# Command line interface
def _format_report(path: pathlib.Path, result: VerificationResult) -> str:
    lines = [
        f"{path.name}",
        f"  document hash    {result.document_hash[:23]}...",
        f"  text source      {result.extraction.text_source}"
        + (
            f" (mean word confidence {result.extraction.ocr_mean_confidence})"
            if result.extraction.ocr_mean_confidence is not None
            else ""
        ),
    ]

    extraction = result.extraction
    line_item_sum = round(sum(i.amount for i in extraction.line_items), 2)
    lines.append(
        f"  extracted        vendor={extraction.vendor!r} "
        f"invoice={extraction.invoice_number!r} date={extraction.invoice_date!r}"
    )
    lines.append(
        f"                   account={extraction.beneficiary_account!r} "
        f"stated_total={extraction.stated_total} "
        f"line_items={len(extraction.line_items)} (sum={line_item_sum})"
    )
    if extraction.missing_fields():
        lines.append(f"                   MISSING: {extraction.missing_fields()}")

    lines.append(f"  DECISION         {result.decision}")
    if result.evidence:
        lines.append("  evidence")
        for item in result.evidence:
            lines.append(f"    [{item.level.value}] {item.code}")
            lines.append(f"          {item.summary}")
            for key, value in item.detail.items():
                lines.append(f"          - {key}: {value}")
    else:
        lines.append("  evidence         (none)")
    lines.append(
        f"  policy score     {result.policy_score} "
        f"(internal policy mechanism, not a confidence or probability)"
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run the Proofline forensic engine over one or more PDFs."
    )
    parser.add_argument("paths", nargs="*", type=pathlib.Path)
    parser.add_argument(
        "--vendor-history", type=pathlib.Path, default=DEFAULT_VENDOR_HISTORY
    )
    parser.add_argument("--json", action="store_true", help="emit JSON results")
    parser.add_argument(
        "--repeat",
        type=int,
        default=1,
        metavar="N",
        help="run each document N times and confirm the results are identical",
    )
    args = parser.parse_args(argv)

    paths = args.paths or sorted(DEFAULT_DOC_DIR.glob("*.pdf"))
    if not paths:
        parser.error("no documents given and none found in test_docs/")

    history = VendorHistory.load(args.vendor_history)
    exit_code = 0
    payloads = []

    for path in paths:
        try:
            results = [verify_document(path, history) for _ in range(max(1, args.repeat))]
        except InvalidDocument as exc:
            print(f"{path.name}\n  INVALID_DOCUMENT  {exc}\n")
            exit_code = 1
            continue

        result = results[0]
        if args.json:
            payloads.append({"document": path.name, **result.to_dict()})
        else:
            print(_format_report(path, result))

        if args.repeat > 1:
            serialized = {
                json.dumps(r.to_dict(), sort_keys=True, default=str) for r in results
            }
            identical = len(serialized) == 1
            if not args.json:
                print(
                    f"  reproducibility  {args.repeat} runs, "
                    f"{'identical output' if identical else 'OUTPUT DIFFERED'}"
                )
            if not identical:
                exit_code = 1
        if not args.json:
            print()

    if args.json:
        print(json.dumps(payloads, indent=2, default=str))

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
