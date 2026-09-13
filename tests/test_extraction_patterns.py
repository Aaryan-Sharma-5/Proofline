"""Deterministic extraction: label variants, normalization, layout splits.

Every pattern added for broader invoice coverage gets a case here, including the
ones that must NOT match. The negative cases matter more than the positive ones:
the risk in widening extraction is not that a field is missed — a miss produces
EXTRACTION_INCOMPLETE and escalates — but that a pattern silently captures the
wrong value and produces a confident decision about numbers nobody wrote.
"""

from __future__ import annotations

import pytest

from extraction_patterns import (
    ACCOUNT_LABEL_ONLY,
    ACCOUNT_PATTERNS,
    ACCOUNT_VALUE_ONLY,
    DATE_LABEL_ONLY,
    DATE_PATTERNS,
    DATE_VALUE_ONLY,
    INVOICE_NUMBER_LABEL_ONLY,
    INVOICE_NUMBER_PATTERNS,
    INVOICE_NUMBER_VALUE_ONLY,
    TOTAL_LABEL_ONLY,
    TOTAL_PATTERNS,
    TOTAL_VALUE_ONLY,
    find_labelled_value,
    normalize_account_value,
    normalize_currency,
    normalize_date,
    parse_amount,
)


# Helpers mirroring how the engine calls into these patterns.
def total_of(lines: list[str]) -> tuple[float | None, str | None]:
    match = find_labelled_value(lines, TOTAL_PATTERNS, TOTAL_LABEL_ONLY, TOTAL_VALUE_ONLY)
    if not match:
        return None, None
    groups = match.groupdict()
    return (
        parse_amount(match.group("value")),
        normalize_currency(groups.get("currency"), groups.get("symbol")),
    )


def account_of(lines: list[str]) -> str | None:
    match = find_labelled_value(
        lines, ACCOUNT_PATTERNS, ACCOUNT_LABEL_ONLY, ACCOUNT_VALUE_ONLY
    )
    return normalize_account_value(match.group("value")) if match else None


def date_of(lines: list[str]) -> str | None:
    match = find_labelled_value(lines, DATE_PATTERNS, DATE_LABEL_ONLY, DATE_VALUE_ONLY)
    return normalize_date(match.group("value")) if match else None


def number_of(lines: list[str]) -> str | None:
    match = find_labelled_value(
        lines, INVOICE_NUMBER_PATTERNS, INVOICE_NUMBER_LABEL_ONLY,
        INVOICE_NUMBER_VALUE_ONLY,
    )
    return match.group("value") if match else None


# ---------------------------------------------------------------------------
# Totals
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "line,expected",
    [
        ("TOTAL DUE 5,250.00", 5250.00),          # the original corpus form
        ("Total Due: 5,250.00", 5250.00),
        ("Total: 5,250.00", 5250.00),
        ("Amount Due: 5,250.00", 5250.00),
        ("TOTAL DUE GBP 5,250.00", 5250.00),
        ("Balance Due: $1,200.00", 1200.00),
        ("Total Payable EUR 900.00", 900.00),
        ("GRAND TOTAL 12.50", 12.50),
        ("Total Amount: 1 234.56", 1234.56),      # space as thousands separator
    ],
)
def test_total_label_variants(line, expected):
    amount, _ = total_of([line])
    assert amount == expected


@pytest.mark.parametrize(
    "line,code",
    [
        ("TOTAL DUE GBP 5,250.00", "GBP"),
        ("Total Due: $1,200.00", "USD"),
        ("Total Payable EUR 900.00", "EUR"),
        ("Total Due: £99.00", "GBP"),
        ("TOTAL DUE 5,250.00", None),  # no currency written, none invented
    ],
)
def test_currency_is_read_not_assumed(line, code):
    _, currency = total_of([line])
    assert currency == code


def test_specific_total_label_beats_generic_one():
    """A document with a subtotal and a final total must yield the final total."""
    amount, _ = total_of(["Total: 100.00", "Total Due: 5,250.00"])
    assert amount == 5250.00


def test_total_split_across_lines():
    """Right-aligned layouts put the label and the amount on separate rows."""
    amount, _ = total_of(["TOTAL DUE", "5,250.00"])
    assert amount == 5250.00


@pytest.mark.parametrize(
    "lines",
    [
        ["Total Due:"],                            # label with no value anywhere
        ["Total Due:", "", "", "", "5,250.00"],    # value beyond the window
        ["Total items shipped 4"],                 # no monetary value
        ["Subtotal before tax"],
    ],
)
def test_total_absent_rather_than_guessed(lines):
    amount, _ = total_of(lines)
    assert amount is None


def test_bare_number_on_the_page_is_not_a_total():
    """Without a label there is no total. This is the whole safety property."""
    amount, _ = total_of(["Northwind Logistics Ltd", "5,250.00", "Payment Terms"])
    assert amount is None


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("5,250.00", 5250.00),
        ("1 234.56", 1234.56),
        ("0.01", 0.01),
        ("-50.00", None),        # negative is not an invoice total
        ("abc", None),
        ("", None),
        ("99999999999999.00", None),  # implausible magnitude
    ],
)
def test_parse_amount_rejects_rather_than_coerces(raw, expected):
    assert parse_amount(raw) == expected


# ---------------------------------------------------------------------------
# Beneficiary account
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "line,expected",
    [
        ("Remit To Account: 4471-0092-8815", "4471-0092-8815"),  # corpus form
        ("Account Number: 4471-0092-8815", "4471-0092-8815"),
        ("Account No: 4471-0092-8815", "4471-0092-8815"),
        ("Account: 4471 0092 8815", "4471 0092 8815"),
        ("Bank Account: 447100928815", "447100928815"),
        ("IBAN: GB29NWBK60161331926819", "GB29NWBK60161331926819"),
    ],
)
def test_account_label_variants(line, expected):
    assert account_of([line]) == expected


def test_account_split_across_lines():
    assert account_of(["Account Number:", "4471-0092-8815"]) == "4471-0092-8815"


@pytest.mark.parametrize(
    "line",
    [
        "Account: please contact accounts payable",  # prose after the label
        "Account Number: 12",                        # too short to be an account
        "Accounting period: Q3",
    ],
)
def test_account_rejects_non_account_values(line):
    assert account_of([line]) is None


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("4471-0092-8815", "4471-0092-8815"),
        ("GB29NWBK60161331926819", "GB29NWBK60161331926819"),
        ("4471-0092-8815.", "4471-0092-8815"),  # trailing punctuation stripped
        ("12345", None),                        # below the digit floor
        ("not an account at all", None),
    ],
)
def test_normalize_account_value(raw, expected):
    assert normalize_account_value(raw) == expected


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "line,expected",
    [
        ("Invoice Date: 2026-08-21", "2026-08-21"),  # corpus form
        ("Date: 2026-09-04", "2026-09-04"),
        ("Invoice Date: 04 September 2026", "2026-09-04"),
        ("Invoice Date: 4th Sept 2026", "2026-09-04"),
        ("Issue Date: September 4, 2026", "2026-09-04"),
        ("Date of Issue: 04/09/2026", "2026-09-04"),
        ("Issued: 04-09-2026", "2026-09-04"),
    ],
)
def test_date_label_variants_normalize_to_iso(line, expected):
    assert date_of([line]) == expected


def test_date_split_across_lines():
    assert date_of(["Invoice Date:", "2026-09-04"]) == "2026-09-04"


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("2026-09-04", "2026-09-04"),
        ("04/09/2026", "2026-09-04"),   # day-first by default
        ("13/09/2026", "2026-09-13"),   # first > 12 forces the same reading
        ("09/13/2026", "2026-09-13"),   # second > 12 forces month-first
        ("31/02/2026", None),           # impossible calendar day
        # Second component above 12 cannot be a month, so this is month-first:
        # month 04, day 13. Both readings are real conventions; what the parser
        # refuses is an impossible date, not an unfamiliar ordering.
        ("04/13/2026", "2026-04-13"),
        ("13/13/2026", None),           # impossible under either ordering
        ("2026-13-01", None),
        ("1899-01-01", None),           # outside the plausible year range
        ("not a date", None),
        ("", None),
    ],
)
def test_normalize_date(raw, expected):
    assert normalize_date(raw) == expected


# ---------------------------------------------------------------------------
# Invoice number
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "line,expected",
    [
        ("Invoice Number: INV-2026-0413", "INV-2026-0413"),  # corpus form
        ("Invoice No: INV-2026-0413", "INV-2026-0413"),
        ("Invoice #: INV-2026-0413", "INV-2026-0413"),
        ("Reference: 90210-A", "90210-A"),
    ],
)
def test_invoice_number_variants(line, expected):
    assert number_of([line]) == expected


def test_invoice_number_requires_a_digit():
    """Without this the pattern swallows the next word when the number is absent."""
    assert number_of(["Invoice Number: PENDING"]) is None


def test_invoice_number_bare_hash_on_following_line():
    """A bare 'INVOICE' label followed by '# 36258' on the next line (seen on
    real-world receipt-style invoices), not 'INVOICE #12345' on one line."""
    assert number_of(["INVOICE", "# 36258"]) == "36258"


def test_invoice_number_bare_hash_without_digit_does_not_match():
    assert number_of(["INVOICE", "# PENDING"]) is None


# ---------------------------------------------------------------------------
# Adjacent-line resolution is bounded
# ---------------------------------------------------------------------------


def test_same_line_value_wins_over_a_nearby_one():
    """A label carrying its own value must never be resolved against another row."""
    amount, _ = total_of(["Total Due: 5,250.00", "9,999.00"])
    assert amount == 5250.00


def test_adjacent_resolution_does_not_reach_across_the_page():
    lines = ["Account Number:"] + [f"filler {i}" for i in range(5)] + ["4471-0092-8815"]
    assert account_of(lines) is None
