"""Generate the Milestone 1 forensic validation corpus.

Five PDFs are produced from scratch (no external source files). Each is made by a
genuinely different production mechanism, so the corpus exercises different parts
of the engine rather than five variations of a single trick:

  01_baseline_clean.pdf          reportlab, generated fresh, internally consistent
  02_altered_total.pdf           raw byte patch of 01's uncompressed content stream
  03_changed_beneficiary.pdf     reportlab, regenerated with a different payout account
  04_resaved_different_tool.pdf  01 opened and rewritten by qpdf (via pikepdf)
  05_rasterized_jpeg_copy.pdf    01 rendered to pixels, JPEG-compressed, re-wrapped by PyMuPDF

Document 05 contains no tampering at all. It is the false-positive control: a
legitimate scanned-style copy that must not be escalated on image evidence alone.

This script also seeds `vendor_history.json`, which stands in for Proofline's own
record of previously observed vendor/account relationships (CLAUDE.md Section 12).
It is application-level memory, not an external or ledger-wide reference source.

Everything here is deterministic: reportlab runs in invariant mode, timestamps are
fixed constants, and no randomness is used. Regenerating the corpus produces
byte-identical PDFs.
"""

from __future__ import annotations

import hashlib
import io
import json
import pathlib
import re
import sys
from dataclasses import dataclass

import pymupdf
import pikepdf
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

HERE = pathlib.Path(__file__).resolve().parent
DOC_DIR = HERE / "test_docs"
VENDOR_HISTORY_PATH = HERE / "vendor_history.json"

PAGE_W, PAGE_H = A4

# ---------------------------------------------------------------------------
# Invoice content
# ---------------------------------------------------------------------------

VENDOR_NAME = "Northwind Logistics Ltd"
VENDOR_ADDRESS = [
    "Unit 7, Dockside Business Park",
    "Felixstowe IP11 3TR, United Kingdom",
    "VAT GB 418 2277 09",
]

INVOICE_NUMBER = "INV-2026-0413"
INVOICE_DATE = "2026-08-21"

# The account this vendor has been paid on before. Seeded into vendor_history.json.
KNOWN_ACCOUNT = "4471-0092-8815"

# An account with no prior observation for this vendor, used by document 03.
UNSEEN_ACCOUNT = "8820-5517-3094"

BILL_TO = [
    "Meridian Foods Group",
    "Accounts Payable",
    "12 Carrington Way, Leeds LS1 4DY",
]


@dataclass(frozen=True)
class LineItem:
    description: str
    quantity: int
    unit_price: float

    @property
    def amount(self) -> float:
        return round(self.quantity * self.unit_price, 2)


LINE_ITEMS = (
    LineItem("Freight forwarding, Rotterdam to Felixstowe", 3, 1250.00),
    LineItem("Customs clearance and documentation", 1, 480.00),
    LineItem("Bonded warehouse storage (14 days)", 14, 45.00),
    LineItem("Palletisation and shrink wrap", 12, 32.50),
)

TRUE_TOTAL = round(sum(item.amount for item in LINE_ITEMS), 2)  # 5250.00

# Document 02 restates the total as this value. It must format to the same number
# of bytes as the true total so the content stream can be patched in place without
# invalidating any cross-reference offset.
ALTERED_TOTAL = 4250.00


def money(value: float) -> str:
    """Format an amount the way the invoice renders it: 1234.5 -> '1,234.50'."""
    return f"{value:,.2f}"


# ---------------------------------------------------------------------------
# 01 - baseline, drawn from scratch with reportlab
# ---------------------------------------------------------------------------


def draw_invoice(path: pathlib.Path, *, account: str, stated_total: float) -> None:
    """Render one invoice page.

    `pageCompression=0` keeps the content stream as plain bytes, which is what
    makes the surgical patch in document 02 possible. `invariant=1` fixes
    reportlab's timestamps and document identifier so output is reproducible.
    """
    c = canvas.Canvas(str(path), pagesize=A4, pageCompression=0, invariant=1)
    c.setTitle(f"Invoice {INVOICE_NUMBER}")
    c.setAuthor(VENDOR_NAME)

    y = PAGE_H - 60

    # Letterhead. The vendor name is the first text line on the page, which is
    # where the extractor looks for it when no explicit supplier label is present.
    c.setFont("Helvetica-Bold", 16)
    c.drawString(56, y, VENDOR_NAME)
    y -= 18
    c.setFont("Helvetica", 9)
    for line in VENDOR_ADDRESS:
        c.drawString(56, y, line)
        y -= 12

    c.setFont("Helvetica-Bold", 20)
    c.drawRightString(PAGE_W - 56, PAGE_H - 60, "INVOICE")

    y -= 22
    c.setFont("Helvetica", 10)
    c.drawString(56, y, f"Invoice Number: {INVOICE_NUMBER}")
    y -= 14
    c.drawString(56, y, f"Invoice Date: {INVOICE_DATE}")
    y -= 26

    c.setFont("Helvetica-Bold", 10)
    c.drawString(56, y, "Bill To")
    y -= 14
    c.setFont("Helvetica", 9)
    for line in BILL_TO:
        c.drawString(56, y, line)
        y -= 12

    y -= 20

    # Line item table.
    col_desc = 56
    col_qty = 350
    col_unit = 430
    col_amount = PAGE_W - 56

    c.setFont("Helvetica-Bold", 9)
    c.drawString(col_desc, y, "Description")
    c.drawRightString(col_qty, y, "Qty")
    c.drawRightString(col_unit, y, "Unit Price")
    c.drawRightString(col_amount, y, "Amount")
    y -= 6
    c.setLineWidth(0.6)
    c.line(col_desc, y, col_amount, y)
    y -= 16

    c.setFont("Helvetica", 9)
    for item in LINE_ITEMS:
        c.drawString(col_desc, y, item.description)
        c.drawRightString(col_qty, y, str(item.quantity))
        c.drawRightString(col_unit, y, money(item.unit_price))
        c.drawRightString(col_amount, y, money(item.amount))
        y -= 16

    y -= 4
    c.line(col_desc, y, col_amount, y)
    y -= 20

    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(col_unit, y, "TOTAL DUE")
    c.drawRightString(col_amount, y, money(stated_total))

    y -= 40
    c.setFont("Helvetica", 9)
    c.drawString(col_desc, y, f"Remit To Account: {account}")
    y -= 12
    c.drawString(col_desc, y, "Payment Terms: Net 30")

    c.showPage()
    c.save()


# ---------------------------------------------------------------------------
# 02 - altered total, patched directly in the byte stream
# ---------------------------------------------------------------------------


def patch_stated_total(source: pathlib.Path, target: pathlib.Path) -> None:
    """Restate the total by editing the drawn string in place.

    This models a document that was altered after the fact without being rewritten
    by a PDF tool. The replacement is the same byte length as the original, so
    every cross-reference offset and the trailer (including `/ID`) stay untouched.
    The result carries a semantic inconsistency and no structural trace, which is
    the point: Level A and Level B evidence are independent of one another.
    """
    raw = source.read_bytes()
    old = money(TRUE_TOTAL).encode("ascii")
    new = money(ALTERED_TOTAL).encode("ascii")

    if len(old) != len(new):
        raise SystemExit(
            f"altered total must format to the same byte length as the true total "
            f"({old!r} vs {new!r})"
        )
    count = raw.count(old)
    if count != 1:
        raise SystemExit(
            f"expected the stated total {old!r} to appear exactly once in "
            f"{source.name}, found {count}"
        )

    target.write_bytes(raw.replace(old, new))

    # The patch is only meaningful if the file still parses and the trailer /ID
    # survived unchanged. Verify rather than assume.
    if trailer_id_hexes(target) != trailer_id_hexes(source):
        raise SystemExit("byte patch unexpectedly disturbed the trailer /ID")
    with pymupdf.open(target) as doc:
        if money(ALTERED_TOTAL) not in doc[0].get_text():
            raise SystemExit("patched total is not present in the rendered text")


# ---------------------------------------------------------------------------
# 04 - rewritten by a different tool
# ---------------------------------------------------------------------------


def resave_with_other_tool(source: pathlib.Path, target: pathlib.Path) -> None:
    """Open the baseline and write it out again through qpdf, via pikepdf.

    This is a real structural round-trip, not a cosmetic edit: object numbering,
    stream layout and the cross-reference table are all regenerated by a different
    writer than the one that created the file. qpdf follows the PDF convention of
    keeping the original first `/ID` entry and issuing a new second entry, so the
    pair ends up mismatched without any intervention here.
    """
    with pikepdf.open(source) as pdf:
        # Without this qpdf issues a random second /ID on every run, which would
        # make the corpus non-reproducible. Deterministic mode derives it from the
        # file contents instead; the first entry is still carried over unchanged,
        # so the mismatch this document exists to demonstrate is unaffected.
        pdf.save(target, deterministic_id=True)

    before, after = trailer_id_hexes(source), trailer_id_hexes(target)
    if not (before and after) or before[0] != after[0] or after[0] == after[1]:
        raise SystemExit(
            f"expected a preserved first /ID and a changed second /ID, got "
            f"{before} -> {after}"
        )


# ---------------------------------------------------------------------------
# 05 - rasterized and JPEG recompressed, no tampering
# ---------------------------------------------------------------------------


def rasterize_to_jpeg_pdf(source: pathlib.Path, target: pathlib.Path) -> None:
    """Render the baseline to pixels, compress as JPEG, and wrap it in a new PDF.

    This is what a legitimate print-and-scan or emailed-photocopy round trip looks
    like: the text layer is gone, so the engine has to fall back to OCR, and the
    page raster genuinely carries lossy compression artefacts. Nothing about the
    invoice content is changed.
    """
    with pymupdf.open(source) as src:
        page = src[0]
        rect = page.rect
        pixmap = page.get_pixmap(dpi=300)
        image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=72, optimize=False, progressive=False)
    jpeg_bytes = buffer.getvalue()

    out = pymupdf.open()
    new_page = out.new_page(width=rect.width, height=rect.height)
    new_page.insert_image(new_page.rect, stream=jpeg_bytes)
    out.save(target)
    out.close()

    # PyMuPDF writes a *mismatched* trailer /ID even for a file it has just
    # created from nothing, which is not what the PDF convention implies for a
    # brand new artifact. Left alone it would make this control document look
    # like a revision of some earlier original purely because of the writer that
    # produced it. A conforming scanner emitting a fresh document writes both
    # entries identically, so that is what is written here. The corpus is meant
    # to isolate the OCR and image-corroboration path in this document, not to
    # re-test a quirk of one library's writer.
    #
    # This is worth recording rather than hiding: it is a concrete example of why
    # CLAUDE.md Section 6 refuses to treat an /ID mismatch as proof of document
    # history for every producer.
    set_self_consistent_trailer_id(target)

    with pymupdf.open(target) as doc:
        if doc[0].get_text().strip():
            raise SystemExit("rasterized copy unexpectedly retained a text layer")
        if not doc[0].get_images(full=True):
            raise SystemExit("rasterized copy contains no embedded raster image")

    ids = trailer_id_hexes(target)
    if ids is None or ids[0] != ids[1]:
        raise SystemExit(f"rasterized copy should carry a self-consistent /ID, got {ids}")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_ID_RE = re.compile(rb"/ID\s*\[\s*<([0-9A-Fa-f]*)>\s*<([0-9A-Fa-f]*)>\s*\]", re.S)


def trailer_id_hexes(path: pathlib.Path) -> tuple[str, str] | None:
    """Return the last trailer `/ID` pair as lowercase hex, or None if absent."""
    matches = _ID_RE.findall(path.read_bytes())
    if not matches:
        return None
    first, second = matches[-1]
    return first.decode("ascii").lower(), second.decode("ascii").lower()


def set_self_consistent_trailer_id(path: pathlib.Path) -> None:
    """Rewrite the trailer `/ID` in place as a matching, content-derived pair.

    Both entries are replaced with an MD5 digest of the file with the identifier
    region blanked out, which is what a conforming producer emitting a brand new
    document does: two identical entries, derived from the content. Every hex
    string involved is 32 characters, so no byte offset moves and the
    cross-reference table stays valid.
    """
    raw = bytearray(path.read_bytes())
    matches = list(_ID_RE.finditer(bytes(raw)))
    if not matches:
        raise SystemExit(f"{path.name} has no trailer /ID to normalize")
    match = matches[-1]

    spans = (match.span(1), match.span(2))
    if any(end - start != 32 for start, end in spans):
        raise SystemExit(f"{path.name} has an unexpected /ID width; refusing to patch")

    for start, end in spans:
        raw[start:end] = b"0" * 32
    digest = hashlib.md5(bytes(raw)).hexdigest().encode("ascii")
    for start, end in spans:
        raw[start:end] = digest

    path.write_bytes(bytes(raw))


def seed_vendor_history() -> None:
    """Write the prior-observation store the corpus is evaluated against.

    One vendor, one previously observed payout account. Timestamps are fixed so
    the file is reproducible.
    """
    history = {
        "_note": (
            "Proofline's own record of previously observed vendor/account pairs. "
            "Application-level memory only; not an external or ledger-wide source."
        ),
        "vendors": [
            {
                "vendor_key": "northwindlogisticsltd",
                "vendor_name": VENDOR_NAME,
                "accounts": [
                    {
                        "account_reference": KNOWN_ACCOUNT,
                        "first_seen_at": "2026-02-11T09:14:00Z",
                        "last_seen_at": "2026-07-30T16:02:00Z",
                    }
                ],
            }
        ],
    }
    VENDOR_HISTORY_PATH.write_text(
        json.dumps(history, indent=2) + "\n", encoding="utf-8"
    )


def main() -> int:
    DOC_DIR.mkdir(parents=True, exist_ok=True)

    baseline = DOC_DIR / "01_baseline_clean.pdf"
    altered = DOC_DIR / "02_altered_total.pdf"
    beneficiary = DOC_DIR / "03_changed_beneficiary.pdf"
    resaved = DOC_DIR / "04_resaved_different_tool.pdf"
    rasterized = DOC_DIR / "05_rasterized_jpeg_copy.pdf"

    draw_invoice(baseline, account=KNOWN_ACCOUNT, stated_total=TRUE_TOTAL)
    patch_stated_total(baseline, altered)
    draw_invoice(beneficiary, account=UNSEEN_ACCOUNT, stated_total=TRUE_TOTAL)
    resave_with_other_tool(baseline, resaved)
    rasterize_to_jpeg_pdf(baseline, rasterized)

    seed_vendor_history()

    print(f"line item sum: {money(TRUE_TOTAL)}")
    print(f"vendor history: {VENDOR_HISTORY_PATH.relative_to(HERE)}")
    print()
    for path in (baseline, altered, beneficiary, resaved, rasterized):
        ids = trailer_id_hexes(path)
        if ids is None:
            id_note = "no /ID in trailer"
        else:
            state = "equal" if ids[0] == ids[1] else "differ"
            id_note = f"/ID {ids[0][:8]}../{ids[1][:8]}.. ({state})"
        print(f"  {path.name:<32} {path.stat().st_size:>7} bytes  {id_note}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
