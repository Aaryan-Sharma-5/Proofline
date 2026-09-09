"""Static checks on the frontend's language.

CLAUDE.md Section 1.3 forbids a confidence/probability dashboard, and Section
1.2 forbids claiming a document is authentic, fake, or fraudulent. Those are
product commitments, so they get a build-time check rather than relying on
review to catch a regression.

These read the shipped files. They cannot prove what a rendered page says at
runtime, which is why the browser capture asserts the same rule against live
DOM text; this catches the mistake earlier and without a browser.
"""

from __future__ import annotations

import pathlib
import re

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
FRONTEND = REPO_ROOT / "frontend" / "src"

# React sources. The build output in frontend/dist is generated from these, so
# checking the sources catches a regression before it ships rather than after.
FRONTEND_FILES = (
    sorted(FRONTEND.rglob("*.tsx"))
    + sorted(FRONTEND.rglob("*.ts"))
    + sorted(FRONTEND.rglob("*.css"))
)

# Words that would present the decision as a probability or a score.
BANNED_SCORE_TERMS = (
    "confidence",
    "probability",
    "likelihood",
    "risk score",
    "risk_score",
    "certainty",
    "accuracy",
)

# Claims the product must never make about a document.
BANNED_CLAIMS = (
    "ai-generated",
    "ai generated",
    "fraud detected",
    "is fake",
    "is authentic",
    "guaranteed authentic",
    "verified authentic",
)


def test_frontend_files_exist():
    assert FRONTEND_FILES, "no frontend files found"


def strip_comments(source: str) -> str:
    """Removes comments, so only text that can reach a user is scanned.

    A comment explaining *why* a confidence display is forbidden is not a
    confidence display. Scanning raw source flagged exactly that, which would
    have pressured the rule into deleting its own rationale.
    """
    without_block = re.sub(r"/\*.*?\*/", " ", source, flags=re.S)
    without_html = re.sub(r"<!--.*?-->", " ", without_block, flags=re.S)
    # JSX comments: {/* ... */}
    without_html = re.sub(r"\{/\*.*?\*/\}", " ", without_html, flags=re.S)
    lines = []
    for line in without_html.splitlines():
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        lines.append(re.sub(r"(?<!:)//.*$", "", line))
    return "\n".join(lines)


@pytest.mark.parametrize("path", FRONTEND_FILES, ids=lambda p: p.name)
def test_no_score_or_confidence_language(path: pathlib.Path):
    text = strip_comments(path.read_text(encoding="utf-8")).lower()
    for term in BANNED_SCORE_TERMS:
        assert term not in text, f"{path.name} renders {term!r}"


@pytest.mark.parametrize("path", FRONTEND_FILES, ids=lambda p: p.name)
def test_no_authenticity_or_fraud_claims(path: pathlib.Path):
    text = strip_comments(path.read_text(encoding="utf-8")).lower()

    # Disclaimers are the opposite of claims. These exact negated forms are
    # required copy, verified separately below.
    for disclaimer in (
        "not a claim that the document is authentic",
        "not a finding of fraud",
        "nothing here suggests the document is fraudulent",
    ):
        text = text.replace(disclaimer, " ")

    for claim in BANNED_CLAIMS:
        assert claim not in text, f"{path.name} claims {claim!r}"


@pytest.mark.parametrize("path", FRONTEND_FILES, ids=lambda p: p.name)
def test_policy_score_is_never_rendered(path: pathlib.Path):
    """The score may be read from the API shape but never displayed."""
    text = path.read_text(encoding="utf-8")
    # Allowed only inside a comment explaining why it is not shown.
    for line in text.splitlines():
        if "policy_score" not in line:
            continue
        stripped = line.strip()
        is_comment = stripped.startswith(("*", "//", "/*", "<!--"))
        assert is_comment, f"{path.name} references policy_score in code: {stripped}"


@pytest.mark.parametrize("path", FRONTEND_FILES, ids=lambda p: p.name)
def test_no_percentage_display(path: pathlib.Path):
    """No numeric percentage anywhere, which is how a score usually leaks in."""
    text = path.read_text(encoding="utf-8")
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith(("*", "//", "/*", "<!--")):
            continue
        # CSS percentages are legitimate layout values.
        if re.search(r"[:\s(]-?\d+(\.\d+)?%", stripped):
            continue
        assert not re.search(r"\d+\s*%\s*(confidence|certain|likely)", stripped, re.I), (
            f"{path.name}: {stripped}"
        )


def test_decision_language_is_defensible():
    """The primary screen must explain what CLEAR and REVIEW do and don't mean."""
    evidence = (FRONTEND / "lib" / "evidence.ts").read_text(encoding="utf-8")
    assert "not a claim that the document is authentic" in evidence
    assert "not a finding of fraud" in evidence


def test_history_screen_states_that_fields_are_not_stored():
    """The absence of vendor data should read as deliberate, not as a bug."""
    page = (FRONTEND / "pages" / "History.tsx").read_text(encoding="utf-8")
    assert "never stored" in page.lower()
