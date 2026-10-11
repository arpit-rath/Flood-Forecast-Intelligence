"""Small local HTTP adapter using the same dispatch function as Lambda."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from email.parser import BytesParser
from email.policy import default
from hmac import compare_digest
import json
import os
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import RLock
from urllib.parse import parse_qs, urlsplit

from .api import dispatch
from .reporting import MAX_BYTES, MemoryMedia, MemoryReportStore, PhotoMissing, ReportWorkflow
from .real_roads import MemoryRealRoadStore, RealRoadWorkflow, RoadSnapshot
from .road_alerts import MemoryRoadAlertStore, RoadAlertWorkflow
from .service import VarunaService


class Handler(BaseHTTPRequestHandler):
    service = VarunaService()
    operator_token = os.environ.get("VARUNA_OPERATOR_TOKEN")
    reporting: ReportWorkflow | None = None
    real_roads: RealRoadWorkflow | None = None
    road_alerts: RoadAlertWorkflow | None = None
    local_users: dict[str, dict] = {}
    sessions: dict[str, tuple[dict, datetime]] = {}
    sessions_lock = RLock()

    def log_request(self, code: int | str = "-", size: int | str = "-") -> None:
        # Photo capability URLs must not leak into local access logs.
        self.log_message('"%s %s" %s %s', self.command, urlsplit(self.path).path, code, size)

    def _binary(self, status: int, data: bytes, content_type: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "http://localhost:5173")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type,authorization")
        self.end_headers()
        self.wfile.write(data)

    def _handle(self) -> None:
        location = urlsplit(self.path)
        if self.command == "POST" and location.path == "/v1/auth/local-session":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 4096:
                    raise ValueError("invalid sign-in request")
                body = json.loads(self.rfile.read(length))
                username, password = body.get("username"), body.get("password")
                user = self.local_users.get(username) if isinstance(username, str) else None
                if not user or not isinstance(password, str) or not compare_digest(password, user["password"]):
                    self._binary(401, b'{"error":{"code":"invalid_login","message":"Check your demo account and password.","retryable":false,"requestId":"local"}}')
                    return
                token = secrets.token_urlsafe(32)
                expiry = datetime.now(timezone.utc) + timedelta(minutes=30)
                claims = {"sub": user["sub"], "token_use": "access", "cognito:groups": user.get("groups", [])}
                with self.sessions_lock:
                    self.sessions[token] = (claims, expiry)
                self._binary(200, json.dumps({"accessToken": token, "expiresAt": expiry.isoformat(), "displayName": username, "roles": user.get("groups", [])}).encode())
            except (ValueError, TypeError, KeyError, json.JSONDecodeError):
                self._binary(400, b'{"error":{"code":"invalid_request","message":"Invalid sign-in request.","retryable":false,"requestId":"local"}}')
            return
        v2_upload = location.path.startswith("/v2/uploads/")
        if (self.real_roads if v2_upload else self.reporting) and self.command == "POST" and (v2_upload or location.path.startswith("/v1/uploads/")):
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_BYTES + 65536:
                    self._binary(413, b'{"error":"photo exceeds 8 MB"}')
                    return
                key = ("uploads/real-road/" + location.path.removeprefix("/v2/uploads/")
                       if v2_upload else "uploads/" + location.path.rsplit("/", 1)[-1])
                content_type = self.headers.get("Content-Type", "")
                if not content_type.startswith("multipart/form-data;"):
                    raise ValueError("multipart form upload is required")
                message = BytesParser(policy=default).parsebytes(f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode() + self.rfile.read(length))
                fields: dict[str, str] = {}
                files = []
                for part in message.iter_parts():
                    if part.get_content_disposition() != "form-data":
                        raise ValueError("invalid upload form")
                    name = part.get_param("name", header="content-disposition")
                    if name == "file":
                        files.append(part.get_payload(decode=True))
                    elif isinstance(name, str):
                        fields[name] = (part.get_payload(decode=True) or b"").decode("utf-8")
                if len(files) != 1 or len(files[0]) > MAX_BYTES:
                    self._binary(413, b'{"error":"photo must be between 1 byte and 8 MB"}')
                    return
                (self.real_roads if v2_upload else self.reporting).media.put_upload(key, files[0], fields.get("Content-Type", ""), fields)
                self._binary(204, b"")
            except ValueError as exc:
                self._binary(400, json.dumps({"error": str(exc)}).encode())
            return
        v2_photo = location.path.startswith("/v2/private-photo/")
        if (self.real_roads if v2_photo else self.reporting) and self.command == "GET" and (v2_photo or location.path.startswith("/v1/private-photo/")):
            try:
                key = ("review/real-road/" if v2_photo else "review/") + location.path.rsplit("/", 1)[-1]
                token = parse_qs(location.query).get("token", [""])[-1]
                self._binary(200, (self.real_roads if v2_photo else self.reporting).media.private_photo(key, token), "image/jpeg")
            except (PermissionError, PhotoMissing):
                self._binary(403, b'{}')
            return
        body: object = {}
        if self.command in ("POST", "PATCH"):
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 0 or length > 1_000_000:
                    raise ValueError("body exceeds local limit")
                body = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                body = []
        token = self.headers.get("Authorization", "").removeprefix("Bearer ")
        with self.sessions_lock:
            session = self.sessions.get(token)
            claims = session[0] if session and session[1] > datetime.now(timezone.utc) else None
            if session and claims is None:
                self.sessions.pop(token, None)
        result = dispatch(
            self.service, self.command, location.path,
            query={key: values[-1] for key, values in parse_qs(location.query).items()},
            body=body, headers=dict(self.headers), allow_local_mutations=True,
            operator_token=self.operator_token,
            operator_claims=claims,
            reporting=self.reporting,
            real_roads=self.real_roads,
            road_alerts=self.road_alerts,
        )
        payload = json.dumps(result.body, allow_nan=False).encode("utf-8")
        self.send_response(result.status)
        for key, value in result.headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_GET = do_POST = do_PATCH = do_PUT = do_OPTIONS = _handle


def main() -> None:
    parser = argparse.ArgumentParser(description="Varuna fixture API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        parser.error("local demo auth may only bind to loopback")
    Handler.service = VarunaService()
    Handler.local_users = json.loads(os.environ.get("VARUNA_LOCAL_USERS_JSON", "{}"))
    Handler.sessions = {}
    Handler.reporting = ReportWorkflow(Handler.service, MemoryReportStore(), MemoryMedia(f"http://{args.host}:{args.port}"))
    Handler.real_roads = RealRoadWorkflow(RoadSnapshot(), MemoryRealRoadStore(), MemoryMedia(f"http://{args.host}:{args.port}"),
                                          anonymous_enabled=os.environ.get("VARUNA_ANONYMOUS_REPORTING_ENABLED") == "true",
                                          anonymous_daily_limit=int(os.environ.get("VARUNA_ANONYMOUS_DAILY_LIMIT", "20")))
    Handler.road_alerts = RoadAlertWorkflow(Handler.real_roads.snapshot, MemoryRoadAlertStore())
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Synthetic fixture API at http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
