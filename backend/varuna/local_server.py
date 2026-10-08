"""Small local HTTP adapter using the same dispatch function as Lambda."""

from __future__ import annotations

import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from .api import dispatch
from .service import VarunaService


class Handler(BaseHTTPRequestHandler):
    service = VarunaService()
    operator_token = os.environ.get("VARUNA_OPERATOR_TOKEN")

    def _handle(self) -> None:
        location = urlsplit(self.path)
        body: object = {}
        if self.command in ("POST", "PATCH"):
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 0 or length > 1_000_000:
                    raise ValueError("body exceeds local limit")
                body = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                body = []
        result = dispatch(
            self.service, self.command, location.path,
            query={key: values[-1] for key, values in parse_qs(location.query).items()},
            body=body, headers=dict(self.headers), allow_local_mutations=True,
            operator_token=self.operator_token,
        )
        payload = json.dumps(result.body, allow_nan=False).encode("utf-8")
        self.send_response(result.status)
        for key, value in result.headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_GET = do_POST = do_PATCH = do_OPTIONS = _handle


def main() -> None:
    parser = argparse.ArgumentParser(description="Varuna fixture API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Synthetic fixture API at http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
