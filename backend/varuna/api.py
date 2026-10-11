"""One HTTP contract for the local server and API Gateway Lambda."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

from .models import Report
from .reporting import DynamoReportStore, PhotoMissing, ReportConflict, ReportWorkflow, S3Media
from .service import ModeUnavailableError, SnapshotConflictError, VarunaService


@dataclass(frozen=True)
class ApiResponse:
    status: int
    body: dict[str, Any]
    headers: dict[str, str]


def _required_string(body: dict[str, Any], key: str) -> str:
    value = body.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{key} is required")
    return value


def _authorized(headers: dict[str, str], operator_token: str | None, claims: dict[str, Any] | None = None) -> bool:
    if claims:
        groups = claims.get("cognito:groups", "")
        if isinstance(groups, str):
            groups = groups.strip("[]").replace('"', '').split(",")
        return _authenticated(claims) and "varuna-responder" in [str(group).strip() for group in groups]
    if not operator_token:
        return False
    from hmac import compare_digest

    return compare_digest(headers.get("authorization", ""), f"Bearer {operator_token}")


def _authenticated(claims: dict[str, Any] | None) -> bool:
    # In Lambda, API Gateway validates signature, issuer, audience, expiry and
    # route scope before placing claims here. The local adapter uses opaque sessions.
    return bool(claims and claims.get("token_use") == "access" and isinstance(claims.get("sub"), str) and claims["sub"])


def dispatch(
    service: VarunaService, method: str, path: str, *,
    query: dict[str, str] | None = None, body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None, request_id: str = "local",
    allow_local_mutations: bool = False, operator_token: str | None = None,
    operator_claims: dict[str, Any] | None = None, reporting: ReportWorkflow | None = None,
    cors_origin: str = "http://localhost:5173",
    cors_preview_origin: str | None = None,
) -> ApiResponse:
    """Handle one request; deployed report operations use durable storage and JWT claims."""
    query = query or {}
    body = {} if body is None else body
    headers = {key.lower(): value for key, value in (headers or {}).items()}
    response_headers = {
        "content-type": "application/json; charset=utf-8",
        "vary": "Origin",
    }
    request_origin = headers.get("origin")
    if request_origin and request_origin in (cors_origin, cors_preview_origin):
        response_headers.update({
            "access-control-allow-origin": request_origin,
            "access-control-allow-methods": "GET,POST,PATCH,PUT,OPTIONS",
            "access-control-allow-headers": "content-type,authorization",
        })

    def respond(status: int, payload: dict[str, Any]) -> ApiResponse:
        return ApiResponse(status, payload, response_headers)

    def error(status: int, code: str, message: str, retryable: bool = False) -> ApiResponse:
        return respond(status, {"error": {"code": code, "message": message, "retryable": retryable, "requestId": request_id}})

    if method == "OPTIONS":
        return respond(200, {})
    if not isinstance(body, dict):
        return error(400, "invalid_body", "JSON body must be an object")
    try:
        if reporting and (
            (method == "GET" and path == "/v1/snapshots/current")
            or (method == "POST" and path in ("/v1/routes/compare", "/v1/interventions/compare"))
        ):
            reporting.sync()
        if method == "GET" and path == "/health":
            return respond(200, {"status": "ok", "mode": "fixture", "synthetic": True})
        if method == "GET" and path == "/v1/pilot":
            return respond(200, service.pilot())
        if method == "GET" and path == "/v1/snapshots/current":
            mode = query.get("mode", "Scenario")
            if mode not in ("Scenario", "Live"):
                raise ValueError("mode must be Scenario or Live")
            return respond(200, service.snapshot(mode))
        if method == "GET" and path == "/v1/reports":
            if not (_authorized(headers, None, operator_claims) if reporting else _authorized(headers, operator_token, operator_claims)):
                return error(403, "forbidden", "operator access is required")
            if reporting:
                return respond(200, {"reports": reporting.list()})
            if not allow_local_mutations:
                return error(501, "not_implemented", "Report storage is not configured")
            return respond(200, {"reports": [item.as_dict() for item in sorted(service.reports.values(), key=lambda report: report.id)]})
        if method == "GET" and path.startswith("/v1/reports/") and path.count("/") == 3:
            if not _authorized(headers, None, operator_claims):
                return error(403, "forbidden", "operator access is required")
            if not reporting:
                return error(501, "not_implemented", "Report storage is not configured")
            return respond(200, reporting.get(path.rsplit("/", 1)[-1], with_photo=True))
        if method == "POST" and path == "/v1/routes/compare":
            return respond(200, service.routes(
                _required_string(body, "originNodeId"), _required_string(body, "destinationNodeId"),
                _required_string(body, "travelMode"), _required_string(body, "snapshotId"),
            ))
        if method == "POST" and path == "/v1/interventions/compare":
            requested_drains = body.get("drainIds")
            available = {item["id"] for item in service.fixture.drains}
            if not isinstance(requested_drains, list) or len(requested_drains) != 2 or set(requested_drains) != available:
                raise ValueError("drainIds must name the two pilot drains")
            return respond(200, service.interventions(
                _required_string(body, "originNodeId"), _required_string(body, "destinationNodeId"),
                _required_string(body, "travelMode"), _required_string(body, "snapshotId"),
                _required_string(body, "selectedRouteId"),
            ))
        if path == "/v1/reports/upload-url" and method == "POST":
            if not _authenticated(operator_claims):
                return error(403, "forbidden", "sign-in is required to submit a report")
            if reporting:
                return respond(200, reporting.prepare_upload(body, operator_claims["sub"]))
            return error(501, "not_implemented", "Fixture mode has no media upload service")
        if method == "POST" and path == "/v1/reports":
            if not _authenticated(operator_claims):
                return error(403, "forbidden", "sign-in is required to submit a report")
            if reporting:
                return respond(201, reporting.create(body, operator_claims["sub"]))
            if not allow_local_mutations:
                return error(501, "not_implemented", "Report persistence is not configured")
            report = service.add_pending_report(Report.from_dict(body))
            return respond(201, report.as_dict())
        if method == "PATCH" and path.startswith("/v1/reports/") and path.endswith("/review"):
            if not (_authorized(headers, None, operator_claims) if reporting else _authorized(headers, operator_token, operator_claims)):
                return error(403, "forbidden", "operator access is required")
            report_id = path[len("/v1/reports/"):-len("/review")].strip("/")
            if not report_id or "/" in report_id:
                raise ValueError("invalid report ID")
            if reporting:
                return respond(200, reporting.review(report_id, body, str((operator_claims or {}).get("sub") or "Local responder")))
            if not allow_local_mutations:
                return error(501, "not_implemented", "Report storage is not configured")
            report = service.set_report_status(report_id, _required_string(body, "reviewStatus"))
            return respond(200, report.as_dict())
        if method == "PATCH" and path.startswith("/v1/segments/") and path.endswith("/closure"):
            if not allow_local_mutations or not _authorized(headers, operator_token, operator_claims):
                return error(403, "forbidden", "operator access is required")
            segment_id = path[len("/v1/segments/"):-len("/closure")].strip("/")
            if not segment_id or "/" in segment_id or not isinstance(body.get("closed"), bool):
                raise ValueError("segment ID and boolean closed are required")
            service.set_closure(segment_id, body["closed"])
            return respond(200, {"segmentId": segment_id, "closed": body["closed"], "snapshotId": service.snapshot()["id"]})
        return error(404, "not_found", "endpoint not found")
    except ModeUnavailableError as exc:
        return error(503, "mode_unavailable", str(exc), True)
    except SnapshotConflictError as exc:
        return error(409, "stale_snapshot", str(exc), True)
    except ReportConflict as exc:
        return error(409, "report_conflict", str(exc))
    except PhotoMissing as exc:
        return error(404, "photo_missing", str(exc))
    except KeyError:
        return error(404, "not_found", "resource not found")
    except ValueError as exc:
        return error(400, "invalid_request", str(exc))


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """AWS HTTP API v2 entry point; protected routes require validated JWT claims."""
    request = event.get("requestContext") or {}
    http = request.get("http") or {}
    method = http.get("method", event.get("httpMethod", "GET"))
    path = event.get("rawPath", event.get("path", "/"))
    raw_body = event.get("body") or "{}"
    try:
        parsed_body = json.loads(raw_body)
    except (json.JSONDecodeError, TypeError):
        parsed_body = []
    response = dispatch(
        _LAMBDA_SERVICE, method, path,
        query=event.get("queryStringParameters") or {},
        body=parsed_body, headers=event.get("headers") or {},
        request_id=request.get("requestId", "unknown"),
        allow_local_mutations=False,
        operator_claims=((request.get("authorizer") or {}).get("jwt") or {}).get("claims"),
        reporting=_LAMBDA_REPORTING,
        cors_origin=os.environ.get("VARUNA_CORS_ORIGIN", ""),
        cors_preview_origin=os.environ.get("VARUNA_CORS_PREVIEW_ORIGIN"),
    )
    return {
        "statusCode": response.status, "headers": response.headers,
        "body": json.dumps(response.body, separators=(",", ":"), allow_nan=False),
    }


_LAMBDA_SERVICE = VarunaService()
_LAMBDA_REPORTING = (
    ReportWorkflow(_LAMBDA_SERVICE, DynamoReportStore(os.environ["VARUNA_REPORTS_TABLE"]), S3Media(os.environ["VARUNA_MEDIA_BUCKET"]))
    if os.environ.get("VARUNA_REPORTS_TABLE") and os.environ.get("VARUNA_MEDIA_BUCKET") else None
)
