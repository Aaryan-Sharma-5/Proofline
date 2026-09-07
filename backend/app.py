from __future__ import annotations

import ipaddress
import os
import pathlib
import tempfile

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

import db
from proofline_engine import (
    DEFAULT_VENDOR_HISTORY,
    SERVICE_VERSION,
    InvalidDocument,
    VendorHistory,
    verify_document,
)

MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", 10 * 1024 * 1024))

app = FastAPI(
    title="Proofline internal analysis service",
    description=(
        "Internal only. Not publicly routable. The x402 gateway is the sole public origin."
    ),
    version=SERVICE_VERSION,
)

# Loaded once at import. Read-only during a request, so repeated verifications of the same document return the same answer.
_history = VendorHistory.load(DEFAULT_VENDOR_HISTORY)

# Ensure the schema exists before the first request.
db.init_db()


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service_version": SERVICE_VERSION}


@app.post("/analyze")
async def analyze(request: Request) -> JSONResponse:
    """Analyse one document and return the engine's verdict unchanged."""
    body = await request.body()

    if not body:
        return JSONResponse(
            status_code=400,
            content={"error": "INVALID_DOCUMENT", "message": "Empty request body."},
        )

    if len(body) > MAX_UPLOAD_BYTES:
        return JSONResponse(
            status_code=413,
            content={
                "error": "INVALID_DOCUMENT",
                "message": f"Document exceeds {MAX_UPLOAD_BYTES} bytes.",
            },
        )

    # Written to a temp file because the engine reads from a path, then removed unconditionally. The document is never persisted.
    handle, temp_name = tempfile.mkstemp(suffix=".pdf", prefix="proofline_")
    temp_path = pathlib.Path(temp_name)
    try:
        with os.fdopen(handle, "wb") as fh:
            fh.write(body)

        result = verify_document(temp_path, _history)

        payload = result.to_dict()

        # Persist the verification
        try:
            verification_id = db.record_verification(
                document_hash=result.document_hash,
                decision=result.decision,
                policy_score=result.policy_score,
                evidence_codes=result.evidence_codes,
                service_version=result.service_version,
            )
            payload["verification_id"] = verification_id
        except Exception as exc:  # noqa: BLE001
            # A storage failure must not change or suppress a forensic verdict.
            print(f"[analysis] persistence failed: {type(exc).__name__}: {exc}")
            payload["verification_id"] = None
            payload["persisted"] = False

        return JSONResponse(status_code=200, content=payload)

    except InvalidDocument as exc:
        return JSONResponse(
            status_code=400,
            content={"error": "INVALID_DOCUMENT", "message": str(exc)},
        )
    except Exception as exc:  # noqa: BLE001
        # Controlled error class
        print(f"[analysis] unexpected failure: {type(exc).__name__}: {exc}")
        return JSONResponse(
            status_code=500,
            content={"error": "ANALYSIS_FAILED", "message": "Analysis failed."},
        )
    finally:
        temp_path.unlink(missing_ok=True)

# Fields safe to publish
PUBLIC_LIST_FIELDS = (
    "verification_id",
    "decision",
    "evidence_codes",
    "created_at",
    "payment_tx_id",
)

PUBLIC_DETAIL_FIELDS = PUBLIC_LIST_FIELDS + (
    "document_hash",
    "service_version",
    "hcs_message_id",
)

MAX_HISTORY_LIMIT = 100


def _project(record: dict, fields: tuple[str, ...]) -> dict:
    return {name: record.get(name) for name in fields}


@app.get("/verification")
async def verification_list(limit: int = 25) -> JSONResponse:
    """Privacy-safe verification history."""
    bounded = max(1, min(int(limit), MAX_HISTORY_LIMIT))
    try:
        records = db.list_verifications(limit=bounded)
    except Exception as exc:  # noqa: BLE001
        print(f"[history] list failed: {type(exc).__name__}: {exc}")
        return JSONResponse(
            status_code=503,
            content={"error": "SERVICE_UNAVAILABLE", "message": "History unavailable."},
        )

    return JSONResponse(
        status_code=200,
        content={
            "verifications": [_project(r, PUBLIC_LIST_FIELDS) for r in records],
            "count": len(records),
        },
    )


@app.get("/verification/{verification_id}")
async def verification_detail(verification_id: str) -> JSONResponse:
    """Masked detail for one verification. Returns only stored, non-sensitive fields. Raw documents are transient and are never returned through this API"""
    try:
        record = db.get_verification(verification_id)
    except Exception as exc:  # noqa: BLE001
        print(f"[history] detail failed: {type(exc).__name__}: {exc}")
        return JSONResponse(
            status_code=503,
            content={"error": "SERVICE_UNAVAILABLE", "message": "History unavailable."},
        )

    if record is None:
        return JSONResponse(
            status_code=404,
            content={"error": "NOT_FOUND", "message": "No such verification."},
        )

    return JSONResponse(status_code=200, content=_project(record, PUBLIC_DETAIL_FIELDS))


def _assert_loopback(host: str) -> None:
    """Refuse to expose the analysis service publicly by accident."""
    if os.environ.get("PROOFLINE_ALLOW_PUBLIC_BIND") == "1":
        return
    try:
        if ipaddress.ip_address(host).is_loopback:
            return
    except ValueError:
        if host == "localhost":
            return
    raise SystemExit(
        f"Refusing to bind the internal analysis service to {host}. It must not have public ingress. Set PROOFLINE_ALLOW_PUBLIC_BIND=1 only when the network is isolated by other means."
    )


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("ANALYSIS_HOST", "127.0.0.1")
    port = int(os.environ.get("ANALYSIS_PORT", "8099"))
    _assert_loopback(host)
    uvicorn.run(app, host=host, port=port, log_level="info")
