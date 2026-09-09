"""Shared fixtures.

The corpus is generated rather than committed (it is gitignored), so the suite
builds it once per session if it is missing. That keeps the tests runnable from
a fresh clone without shipping binary fixtures.
"""

from __future__ import annotations

import pathlib
import subprocess
import sys

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
BACKEND = REPO_ROOT / "backend"
CORPUS = BACKEND / "test_docs"

# Make the backend importable without installing it as a package.
sys.path.insert(0, str(BACKEND))

CORPUS_FILES = (
    "01_baseline_clean.pdf",
    "02_altered_total.pdf",
    "03_changed_beneficiary.pdf",
    "04_resaved_different_tool.pdf",
    "05_rasterized_jpeg_copy.pdf",
)


@pytest.fixture(scope="session", autouse=True)
def corpus() -> pathlib.Path:
    """Ensures the five-document corpus exists, generating it if needed."""
    missing = [name for name in CORPUS_FILES if not (CORPUS / name).exists()]
    if missing:
        subprocess.run(
            [sys.executable, str(BACKEND / "make_test_docs.py")],
            cwd=BACKEND,
            check=True,
            capture_output=True,
        )
    for name in CORPUS_FILES:
        assert (CORPUS / name).exists(), f"corpus document missing: {name}"
    return CORPUS


@pytest.fixture(scope="session")
def history():
    """The vendor-history store the corpus is evaluated against."""
    from proofline_engine import DEFAULT_VENDOR_HISTORY, VendorHistory

    return VendorHistory.load(DEFAULT_VENDOR_HISTORY)


@pytest.fixture
def doc(corpus):
    """Resolves a corpus document by name."""

    def _doc(name: str) -> pathlib.Path:
        path = corpus / name
        assert path.exists(), f"missing corpus document {name}"
        return path

    return _doc
