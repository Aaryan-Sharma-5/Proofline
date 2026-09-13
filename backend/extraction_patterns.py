"""Deterministic field patterns and normalizers for invoice extraction.

Separated from `proofline_engine` so each pattern is unit-testable without a PDF,
and so the boundary is obvious: nothing here decides anything. These functions
read text and return normalized values or `None`. Evidence codes, policy weights
and decisions live in the engine and are not importable from this module.

Design rule
-----------
Every pattern here is *label-anchored*. A value is only accepted when an
explicit label introduces it. There is no "find the biggest number on the page
and call it the total" fallback, because a silently wrong financial field is
worse than a missing one: a missing field produces EXTRACTION_INCOMPLETE and
escalates, while a wrong one could produce a confident CLEAR against the wrong
numbers. Breadth comes from recognising more *labels*, never from loosening what
counts as a value.
"""

from __future__ import annotations

import calendar
import re

# Amount and currency
# A monetary value as invoices actually render it. Requiring the two-decimal
# minor unit is what keeps this from matching quantities, dates and reference
# numbers.
#
# Two conventions are accepted, because both appear on real invoices:
#
#   Anglo       1,234.56   grouping ",", decimal "."
#   European    1.234,56   grouping ".", decimal ","
#
# The two are genuinely ambiguous for a value like `1.234`, which is why the
# two-decimal minor unit is mandatory: it makes the *last* separator the decimal
# point by construction, so the reading never depends on guessing a locale.
_AMOUNT_BODY = (
    r"\d{1,3}(?:[, ]\d{3})*\.\d{2}"   # 1,234.56 / 1 234.56
    r"|\d{1,3}(?:[. ]\d{3})*,\d{2}"   # 1.234,56 / 1 234,56
    r"|\d+\.\d{2}"                    # 1234.56
    r"|\d+,\d{2}"                     # 1234,56
)

# Currency written as a code (GBP) or a symbol. Captured so it can be reported,
# never used to convert or compare across currencies.
_CURRENCY_CODES = ("GBP", "USD", "EUR", "AUD", "CAD", "CHF", "JPY", "NZD", "SEK", "INR")
_SYMBOL_TO_CODE = {"£": "GBP", "$": "USD", "€": "EUR", "¥": "JPY"}

_CURRENCY_PREFIX = (
    r"(?:(?P<currency>" + "|".join(_CURRENCY_CODES) + r")|(?P<symbol>[£$€¥]))?\s*"
)

# Public alias: the engine reuses this grammar for line-item tables, so a
# line item and a labelled total can never disagree about number format.
AMOUNT_BODY = _AMOUNT_BODY

MAX_REASONABLE_AMOUNT = 1_000_000_000.0


def parse_amount(text: str) -> float | None:
    """Parse a rendered money string into a float, or None if it is not one.

    Handles both the Anglo (`1,234.56`) and European (`1.234,56`) conventions.
    The decimal separator is identified structurally rather than by guessing a
    locale: it is whichever of `.` or `,` appears *last* and is followed by
    exactly two digits. `1.005,55` is therefore 1005.55, and so is `1,005.55`.

    Rejects rather than guesses. A value whose separators fit neither
    convention, or that is negative or implausibly large, comes back as None so
    the caller records a missing field instead of an invented one.
    """
    if text is None:
        return None
    # Strip every kind of space used as a group separator, including NBSP.
    cleaned = re.sub(r"[\s  ]", "", text.strip())
    if not cleaned:
        return None

    last_dot = cleaned.rfind(".")
    last_comma = cleaned.rfind(",")

    if last_dot == -1 and last_comma == -1:
        normalized = cleaned
    else:
        # The later separator is the decimal point; the other kind groups
        # thousands. The mandatory two-digit minor unit is what makes this
        # structural rather than a locale guess.
        if last_comma > last_dot:
            decimal_at, group_char = last_comma, "."
        else:
            decimal_at, group_char = last_dot, ","
        integer_part = cleaned[:decimal_at].replace(group_char, "")
        fraction_part = cleaned[decimal_at + 1 :]
        if not fraction_part.isdigit() or len(fraction_part) != 2:
            return None
        if not integer_part.isdigit():
            return None
        normalized = f"{integer_part}.{fraction_part}"

    try:
        value = float(normalized)
    except ValueError:
        return None
    if value < 0 or value > MAX_REASONABLE_AMOUNT:
        return None
    return round(value, 2)


def normalize_currency(code: str | None, symbol: str | None) -> str | None:
    """Return an ISO-4217-style code, or None when no currency was written."""
    if code:
        upper = code.strip().upper()
        return upper if upper in _CURRENCY_CODES else None
    if symbol:
        return _SYMBOL_TO_CODE.get(symbol.strip())
    return None


# Dates
_MONTHS = {name.lower(): index for index, name in enumerate(calendar.month_name) if name}
_MONTHS.update(
    {name.lower(): index for index, name in enumerate(calendar.month_abbr) if name}
)
# "Sept" is written on real invoices but is not one of calendar's abbreviations,
# which stop at "Sep". Added explicitly rather than by prefix-matching month
# names, because a prefix rule would also accept "Ma" for March or May.
_MONTHS["sept"] = 9

# Only English month names are recognised here, deliberately. Non-English
# invoices are the LLM fallback's job (§10a): maintaining a per-language table
# of month names, label spellings and number conventions is an open-ended list
# that is never finished, and every entry is a chance to mis-read a financial
# field. The deterministic path stays narrow and certain; breadth across
# languages comes from the fallback, whose output is validated back through
# these same normalizers before anything uses it.

_ISO_DATE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")
# "04 September 2026" and "4 Sept 2026", with an optional ordinal suffix.
_LONG_DATE = re.compile(
    r"^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\,?\s+(\d{4})$", re.IGNORECASE
)
# "September 04, 2026"
_LONG_DATE_MONTH_FIRST = re.compile(
    r"^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\,?\s+(\d{4})$", re.IGNORECASE
)
# "04/09/2026" or "04-09-2026". Ambiguous by nature; see normalize_date.
_NUMERIC_DATE = re.compile(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$")

MIN_YEAR = 1990
MAX_YEAR = 2100


def _build_iso(year: int, month: int, day: int) -> str | None:
    """Assemble an ISO date, rejecting anything that is not a real calendar day."""
    if not (MIN_YEAR <= year <= MAX_YEAR):
        return None
    if not (1 <= month <= 12):
        return None
    if not (1 <= day <= calendar.monthrange(year, month)[1]):
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def normalize_date(raw: str) -> str | None:
    """Normalize a written date to ISO 8601 (YYYY-MM-DD), or None.

    Purely numeric dates are read day-first (`04/09/2026` is 4 September), which
    is the dominant convention outside the US, unless the second component is
    above 12 and forces a month-first reading. A genuinely ambiguous value such
    as `05/06/2026` is therefore *interpreted*, not rejected: the date is a
    required field whose absence would escalate the entire document, and it is
    not on its own a decision input — no evidence code compares dates. What is
    rejected is an impossible date (month 13, 31 February), which indicates a
    misread rather than a convention difference.
    """
    if not raw:
        return None
    text = raw.strip().rstrip(".,")

    match = _ISO_DATE.match(text)
    if match:
        year, month, day = (int(g) for g in match.groups())
        return _build_iso(year, month, day)

    match = _LONG_DATE.match(text)
    if match:
        day_s, month_s, year_s = match.groups()
        month = _MONTHS.get(month_s.lower().rstrip("."))
        if month is None:
            return None
        return _build_iso(int(year_s), month, int(day_s))

    match = _LONG_DATE_MONTH_FIRST.match(text)
    if match:
        month_s, day_s, year_s = match.groups()
        month = _MONTHS.get(month_s.lower().rstrip("."))
        if month is None:
            return None
        return _build_iso(int(year_s), month, int(day_s))

    match = _NUMERIC_DATE.match(text)
    if match:
        first, second, year = (int(g) for g in match.groups())
        # Day-first by default. When the first component is above 12 it cannot be
        # a month, so the reading is forced and agrees with the default anyway;
        # when the *second* is above 12 the document must be month-first, so the
        # components are swapped.
        if second > 12:
            return _build_iso(year, first, second)
        return _build_iso(year, second, first)

    return None


# Account references
# Digit groups (4471-0092-8815, 4471 0092 8815, 447100928815) and IBANs. Both
# require enough length to be an account rather than an incidental number.
_ACCOUNT_VALUE = r"(?:[A-Z]{2}\d{2}[A-Z0-9 ]{10,32}|\d[\d\- ]{6,32}\d)"

MIN_ACCOUNT_DIGITS = 8


def normalize_account_value(raw: str) -> str | None:
    """Validate a captured account reference and strip trailing punctuation.

    The stored form keeps the document's own separators, because the engine
    normalizes separately for comparison and the raw form is what a human would
    check against a bank record.
    """
    if not raw:
        return None
    text = raw.strip().rstrip(".,;:")
    compact = re.sub(r"[^A-Za-z0-9]", "", text)
    if len(compact) < MIN_ACCOUNT_DIGITS:
        return None
    # An IBAN starts with two letters and two check digits; anything else must be
    # all digits. This rejects prose that happened to follow an "Account" label.
    if re.fullmatch(r"[A-Za-z]{2}\d{2}[A-Za-z0-9]+", compact):
        return text
    if compact.isdigit():
        return text
    return None


# Label-anchored field patterns
# Each entry is (pattern, group name). A label may appear with or without a
# colon, in any case, and the value may be absent from the same line, in which
# case the caller falls back to the adjacent-line resolver below.

def _labelled(label: str, value: str) -> re.Pattern[str]:
    """A label followed by a value on the same line."""
    return re.compile(rf"{label}\s*[:#]?\s*{value}", re.IGNORECASE)


def _label_only(label: str) -> re.Pattern[str]:
    """A label that ends its line, with the value rendered elsewhere."""
    return re.compile(rf"^{label}\s*[:#]?\s*$", re.IGNORECASE)


# Total. Ordered most specific first so "Total Due" is preferred over a bare
# "Total" when a document carries both (a subtotal line plus a final total).
#
# English labels only. Non-English invoices route to the LLM fallback rather
# than growing this list per language — see the note on _MONTHS above.
_TOTAL_LABELS = (
    r"TOTAL\s+DUE",
    r"AMOUNT\s+DUE",
    r"BALANCE\s+DUE",
    r"TOTAL\s+PAYABLE",
    r"GRAND\s+TOTAL",
    r"TOTAL\s+AMOUNT",
    r"TOTAL",
)

TOTAL_PATTERNS = tuple(
    _labelled(label, _CURRENCY_PREFIX + rf"(?P<value>{_AMOUNT_BODY})")
    for label in _TOTAL_LABELS
)
TOTAL_LABEL_ONLY = tuple(_label_only(label) for label in _TOTAL_LABELS)

# A value line that is nothing but an amount, used when the label stood alone.
TOTAL_VALUE_ONLY = re.compile(
    rf"^{_CURRENCY_PREFIX}(?P<value>{_AMOUNT_BODY})$", re.IGNORECASE
)

# Beneficiary account.
_ACCOUNT_LABELS = (
    r"REMIT\s+TO\s+ACCOUNT",
    r"ACCOUNT\s+NUMBER",
    r"ACCOUNT\s+NO",
    r"BANK\s+ACCOUNT",
    r"IBAN",
    r"ACCOUNT",
)

ACCOUNT_PATTERNS = tuple(
    _labelled(label, rf"(?P<value>{_ACCOUNT_VALUE})") for label in _ACCOUNT_LABELS
)
ACCOUNT_LABEL_ONLY = tuple(_label_only(label) for label in _ACCOUNT_LABELS)
ACCOUNT_VALUE_ONLY = re.compile(rf"^(?P<value>{_ACCOUNT_VALUE})$")

# Invoice number. The value must contain a digit, which keeps the pattern from
# swallowing a following word when the number is missing.
_INVOICE_NUMBER_VALUE = r"(?P<value>[A-Za-z0-9][A-Za-z0-9\-/_.]*\d[A-Za-z0-9\-/_.]*)"
_INVOICE_NUMBER_LABELS = (
    r"INVOICE\s+NUMBER",
    r"INVOICE\s+NO",
    r"INVOICE\s+#",
    r"INVOICE",
    r"BILL\s+NUMBER",
    r"REFERENCE",
)

INVOICE_NUMBER_PATTERNS = tuple(
    _labelled(label, _INVOICE_NUMBER_VALUE) for label in _INVOICE_NUMBER_LABELS
)
INVOICE_NUMBER_LABEL_ONLY = tuple(_label_only(label) for label in _INVOICE_NUMBER_LABELS)
# A bare label ("INVOICE") may be followed by "#12345" on the next line rather
# than a label that already says "#" itself, so the value-only form accepts an
# optional leading "#" that the same-line patterns above already consume as
# part of their own label text.
INVOICE_NUMBER_VALUE_ONLY = re.compile(rf"^#?\s*{_INVOICE_NUMBER_VALUE}$")

# Invoice date. The value is captured loosely and then validated by
# normalize_date, so an unparseable capture becomes a missing field.
_DATE_VALUE = r"(?P<value>\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})"
_DATE_LABELS = (
    r"INVOICE\s+DATE",
    r"ISSUE\s+DATE",
    r"DATE\s+OF\s+ISSUE",
    r"ISSUED",
    r"DATE",
)

DATE_PATTERNS = tuple(_labelled(label, _DATE_VALUE) for label in _DATE_LABELS)
DATE_LABEL_ONLY = tuple(_label_only(label) for label in _DATE_LABELS)
DATE_VALUE_ONLY = re.compile(rf"^{_DATE_VALUE}$")

# Adjacent-line resolution
# How many following lines may be inspected when a label ends its own line.
# Deliberately small: a right-aligned table puts the value on the next visual
# row, but scanning further turns a miss into a wrong answer from an unrelated
# part of the page.
ADJACENT_LINE_WINDOW = 2


def find_labelled_value(
    lines: list[str],
    patterns: tuple[re.Pattern[str], ...],
    label_only: tuple[re.Pattern[str], ...],
    value_only: re.Pattern[str],
) -> re.Match[str] | None:
    """Find a label-anchored value, allowing the value to sit on a nearby line.

    Same-line matches win outright: every pattern is tried against every line
    before any adjacent-line resolution is attempted. Only when no label carried
    its own value is the split-layout case considered, and then only within
    ADJACENT_LINE_WINDOW lines of a label that stood alone.
    """
    for pattern in patterns:
        for line in lines:
            match = pattern.search(line)
            if match and match.groupdict().get("value"):
                return match

    for pattern in label_only:
        for index, line in enumerate(lines):
            if not pattern.match(line.strip()):
                continue
            for offset in range(1, ADJACENT_LINE_WINDOW + 1):
                if index + offset >= len(lines):
                    break
                candidate = value_only.match(lines[index + offset].strip())
                if candidate:
                    return candidate
    return None
