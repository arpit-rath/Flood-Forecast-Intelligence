"""Bounded, fail-closed retrieval of official Delhi Traffic Police HTML alerts.

No source text or proposed match is evidence of a road condition. Only the
separate responder review workflow can confirm a current flood blockage.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from hashlib import sha256
from html.parser import HTMLParser
import json
import os
import re
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from urllib.robotparser import RobotFileParser

from .real_roads import RoadSnapshot
from .road_alerts import RoadAlertWorkflow


LISTING_URL = "https://traffic.delhipolice.gov.in/en/news-alertadvisory/alerts"
ROBOTS_URL = "https://traffic.delhipolice.gov.in/robots.txt"
USER_AGENT = "VarunaRoadAlerts/1.0 (+https://github.com/arpit-rath; bounded public-alert research)"
PARSER_VERSION = "dtp-html-v1"
MAX_DETAILS = 10
MAX_LISTING_LINKS = 100
MAX_BYTES = 512 * 1024
RETENTION_DAYS = 30


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("UTC timestamp required")
    return parsed.astimezone(timezone.utc)


def _retry_after(value: str | None, now: datetime) -> str:
    """Honor a valid HTTP Retry-After; otherwise defer at least one schedule interval."""
    until = now + timedelta(minutes=30)
    if value:
        try:
            if value.isdecimal():
                until = now + timedelta(seconds=int(value))
            else:
                parsed = parsedate_to_datetime(value)
                if parsed.tzinfo is None:
                    raise ValueError("Retry-After date needs a timezone")
                until = parsed.astimezone(timezone.utc)
        except (OverflowError, TypeError, ValueError):
            pass
    return max(until, now + timedelta(seconds=1)).isoformat().replace("+00:00", "Z")


def canonical_detail(href: str) -> str | None:
    if not isinstance(href, str) or len(href) > 500:
        return None
    parsed = urlsplit(urljoin(LISTING_URL, href))
    if (parsed.scheme, parsed.hostname, parsed.port, parsed.username, parsed.password) != (
            "https", "traffic.delhipolice.gov.in", None, None, None):
        return None
    if not parsed.path.startswith("/en/") or parsed.path == urlsplit(LISTING_URL).path or parsed.query:
        return None
    if re.match(r"^/en/(?:admin|user|login|logout|register|system)(?:/|$)", parsed.path, re.I):
        return None
    if parsed.path.lower().endswith((".pdf", ".doc", ".docx", ".xml", ".json", ".zip")):
        return None
    path = quote(unquote(parsed.path), safe="/-._~")
    return urlunsplit(("https", parsed.hostname, path, "", ""))


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request: Request, fp: Any, code: int, msg: str,
                         headers: Any, newurl: str) -> None:
        raise URLError("redirect refused")


def http_get(url: str, conditional: dict[str, str] | None = None) -> tuple[int, bytes, dict[str, str]]:
    """One request, ten seconds, bounded HTML bytes, no redirect or retry."""
    if url != ROBOTS_URL and url != LISTING_URL and canonical_detail(url) != url:
        raise ValueError("source request is not an allowed same-origin page")
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html, text/plain;q=0.8"}
    for field in ("If-None-Match", "If-Modified-Since"):
        if conditional and conditional.get(field):
            headers[field] = conditional[field]
    try:
        with build_opener(_NoRedirect()).open(Request(url, headers=headers), timeout=10) as response:
            content_type = response.headers.get("Content-Type", "").lower()
            if url == ROBOTS_URL:
                if "text/plain" not in content_type:
                    raise ValueError("successful robots response was not plain text")
            elif "text/html" not in content_type:
                raise ValueError("official source did not return HTML")
            body = response.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise ValueError("official source document exceeds fetch limit")
            return response.status, body, {key.lower(): value for key, value in response.headers.items()}
    except HTTPError as error:
        if error.code == 304:
            return 304, b"", {key.lower(): value for key, value in error.headers.items()}
        if url == ROBOTS_URL and 400 <= error.code <= 599:
            return error.code, b"", {key.lower(): value for key, value in error.headers.items()}
        raise


class RobotsRateLimited(ValueError):
    pass


def _parse_robots(body: bytes) -> RobotFileParser:
    """Reject uncertain successful policies before delegating rule matching."""
    content = body.decode("utf-8")
    if "\x00" in content:
        raise ValueError("malformed robots policy")
    saw_group = False
    for raw_line in content.splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        if ":" not in line:
            raise ValueError("malformed robots policy")
        name, value = (part.strip() for part in line.split(":", 1))
        name = name.casefold()
        if name == "user-agent":
            if not re.fullmatch(r"\*|[A-Za-z_-]+", value):
                raise ValueError("malformed robots user-agent")
            saw_group = True
        elif name in ("allow", "disallow"):
            if not saw_group or (value and not value.startswith("/")):
                raise ValueError("malformed robots rule")
            if "*" in value or "$" in value:
                raise ValueError("robots pattern unsupported; policy evaluation uncertain")
        elif not re.fullmatch(r"[A-Za-z_-]+", name):
            raise ValueError("malformed robots directive")
    if content.strip() and not saw_group:
        raise ValueError("robots policy has no usable group")
    parser = RobotFileParser()
    parser.parse(content.splitlines())
    return parser


class _Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, dict[str, str]]] = []
        self.headline: list[str] = []
        self.body: list[str] = []
        self.main: list[str] = []
        self.listing_links: list[tuple[str, str]] = []
        self.external_links: list[str] = []
        self.published: str | None = None
        self.end: str | None = None
        self._anchor: tuple[str, list[str], bool] | None = None
        self._blocked_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        properties = {key: value or "" for key, value in attrs}
        self.stack.append((tag, properties))
        if tag in ("script", "style", "nav", "footer"):
            self._blocked_depth += 1
        if tag == "a" and not self._blocked_depth:
            in_h2 = any(element == "h2" for element, _ in self.stack)
            self._anchor = (properties.get("href", ""), [], in_h2)
        if tag == "time" and not self._blocked_depth:
            value = properties.get("datetime")
            if value:
                if "end" in properties.get("class", "").lower():
                    self.end = value[:100]
                elif self.published is None:
                    self.published = value[:100]

    def handle_data(self, data: str) -> None:
        if self._blocked_depth or not data.strip():
            return
        if any(tag == "h1" for tag, _ in self.stack):
            self.headline.append(data.strip())
        if any(tag == "article" or "field--name-body" in attrs.get("class", "")
               for tag, attrs in self.stack):
            self.body.append(data.strip())
        if any(tag == "main" for tag, _ in self.stack):
            self.main.append(data.strip())
        if self._anchor:
            self._anchor[1].append(data.strip())

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._anchor:
            href, words, in_h2 = self._anchor
            label = " ".join(words).strip()
            if in_h2 and label:
                self.listing_links.append((href, label))
            elif href.startswith("https://") and urlsplit(href).hostname != "traffic.delhipolice.gov.in":
                self.external_links.append(href)
            self._anchor = None
        if tag in ("script", "style", "nav", "footer") and self._blocked_depth:
            self._blocked_depth -= 1
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break


def parse_listing(body: bytes) -> list[tuple[str, str]]:
    page = _Page()
    page.feed(body.decode("utf-8", errors="replace"))
    found: dict[str, str] = {}
    for href, headline in page.listing_links:
        url = canonical_detail(href)
        if url and len(headline) <= 200:
            found.setdefault(url, headline)
    if not found:
        raise ValueError("official listing structure has no usable alert detail links")
    return list(found.items())[:MAX_LISTING_LINKS]


def parse_detail(url: str, body: bytes, fallback_headline: str, fetched_at: str) -> dict[str, Any]:
    page = _Page()
    page.feed(body.decode("utf-8", errors="replace"))
    headline = " ".join(page.headline).strip() or fallback_headline
    text = " ".join(page.body).strip()
    if not text or len(text) < 15 or not headline:
        raise ValueError("official detail structure has no usable alert text")
    text = " ".join(text.split())[:2000]
    cause_match = re.search(r"\b(waterlogging|flooding|inundation|sewer work|construction|congestion|road work)\b", text, re.I)
    return {"canonicalSourceUrl": url, "sourceIdentifier": urlsplit(url).path[-160:],
            "sourceType": "traffic_alert", "publishedAtText": page.published,
            "retrievedAt": fetched_at, "originalHeadline": headline[:200], "originalText": text,
            "statedCause": cause_match.group(0) if cause_match else None,
            "affectedLocation": None, "validUntilText": page.end,
            "advisoryUrl": page.external_links[0] if page.external_links else None,
            "sourceAvailability": "available", "locationHints": {}}


class DynamoRoadAlertStore:
    """Dedicated table; JSON payload avoids DynamoDB float coercion of candidates."""

    def __init__(self, table_name: str, table: Any = None, clock: Callable[[], datetime] | None = None) -> None:
        if not table_name and table is None:
            raise ValueError("road-alert table is required")
        if table is None:
            import boto3
            table = boto3.resource("dynamodb").Table(table_name)
        self.table = table
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    def _expiry(self) -> int:
        return int((self.clock() + timedelta(days=RETENTION_DAYS)).timestamp())

    @staticmethod
    def _conflict(error: Exception) -> bool:
        return getattr(error, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException"

    def _put(self, key: str, kind: str, value: dict[str, Any]) -> bool:
        try:
            self.table.put_item(Item={"id": key, "kind": kind, "payload": json.dumps(value),
                                      "expiresAtEpoch": self._expiry()},
                                ConditionExpression="attribute_not_exists(id)")
            return True
        except Exception as error:
            if self._conflict(error):
                return False
            raise

    def _get(self, key: str) -> dict[str, Any] | None:
        response = self.table.get_item(Key={"id": key}, ConsistentRead=True)
        item = response.get("Item")
        if not item or int(item.get("expiresAtEpoch", 0)) <= int(self.clock().timestamp()):
            return None
        return json.loads(item["payload"])

    def import_alert(self, alert: Any) -> tuple[dict[str, Any], bool]:
        from dataclasses import asdict
        from .road_alerts import AlertConflict
        fields = asdict(alert)
        item = {**fields, "reviewState": "Imported", "reviewHistory": [], "matchedRoadId": None}
        created = self._put(alert.id, "alert", item)
        if created:
            return item, True
        existing = self.get(alert.id)
        if existing and {key: existing[key] for key in fields} == fields:
            return existing, False
        raise AlertConflict("source identifier already has different content; review an explicit update")

    def put_ingested(self, item: dict[str, Any]) -> bool:
        return self._put(item["id"], "alert", item)

    def list(self) -> list[dict[str, Any]]:
        from boto3.dynamodb.conditions import Attr
        items: list[dict[str, Any]] = []
        options: dict[str, Any] = {"FilterExpression": Attr("kind").eq("alert"),
                                  "ProjectionExpression": "id,payload,expiresAtEpoch"}
        while True:
            page = self.table.scan(**options)
            for item in page.get("Items", []):
                if int(item.get("expiresAtEpoch", 0)) > int(self.clock().timestamp()):
                    items.append(json.loads(item["payload"]))
            if "LastEvaluatedKey" not in page:
                return items
            options["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    def get(self, alert_id: str) -> dict[str, Any] | None:
        return self._get(alert_id)

    def review(self, alert_id: str, expected_state: str, decision: dict[str, Any]) -> dict[str, Any]:
        from .road_alerts import AlertConflict
        item = self.get(alert_id)
        if item is None:
            raise KeyError(alert_id)
        if item["reviewState"] != expected_state:
            raise AlertConflict("alert review state changed; reload before deciding")
        updated = {**item, "reviewState": decision["state"],
                   "matchedRoadId": decision.get("roadId", item["matchedRoadId"]),
                   "reviewHistory": [*item["reviewHistory"], decision]}
        try:
            self.table.update_item(Key={"id": alert_id},
                UpdateExpression="SET payload = :payload, reviewState = :new",
                ConditionExpression="attribute_exists(id) AND (attribute_not_exists(reviewState) OR reviewState = :old) AND expiresAtEpoch > :now",
                ExpressionAttributeValues={":payload": json.dumps(updated), ":new": decision["state"],
                                           ":old": expected_state, ":now": int(self.clock().timestamp())})
        except Exception as error:
            if self._conflict(error):
                raise AlertConflict("alert review state changed; reload before deciding") from error
            raise
        return updated

    def get_metadata(self, key: str) -> dict[str, Any] | None:
        return self._get("META#" + key)

    def put_metadata(self, key: str, value: dict[str, Any]) -> None:
        expiry = self._expiry()
        if key == "robots-retry-after" and isinstance(value.get("until"), str):
            expiry = max(expiry, int(_utc(value["until"]).timestamp()) + 86400)
        self.table.put_item(Item={"id": "META#" + key, "kind": "metadata",
                                  "payload": json.dumps(value), "expiresAtEpoch": expiry})


class DelhiTrafficPoliceIngestor:
    def __init__(self, workflow: RoadAlertWorkflow,
                 fetch: Callable[[str, dict[str, str] | None], tuple[int, bytes, dict[str, str]]] = http_get,
                 clock: Callable[[], str] = utc_now) -> None:
        self.workflow, self.store, self.fetch, self.clock = workflow, workflow.store, fetch, clock

    def _request(self, url: str, prior: dict[str, Any] | None = None) -> tuple[int, bytes, dict[str, str]]:
        conditional = {}
        if prior:
            if prior.get("etag"):
                conditional["If-None-Match"] = prior["etag"]
            if prior.get("lastModified"):
                conditional["If-Modified-Since"] = prior["lastModified"]
        return self.fetch(url, conditional)

    def _robots_policy(self, now: datetime) -> tuple[RobotFileParser | None, bool]:
        status, body, headers = self._request(ROBOTS_URL)
        if status == 429:
            retry_at = _retry_after(headers.get("retry-after"), now)
            self.store.put_metadata("robots-retry-after", {"until": retry_at})
            raise RobotsRateLimited("robots request rate-limited")
        if 400 <= status <= 499:
            # RFC 9309 2.3.1.3: unavailable policy. This does not expand the
            # hardcoded listing/detail host and path allowlist.
            return None, True
        if status != 200:
            raise ValueError("official source robots policy is unreachable")
        parser = _parse_robots(body)
        if not parser.can_fetch(USER_AGENT, LISTING_URL):
            raise ValueError("official source robots policy disallows listing retrieval")
        return parser, False

    def run(self) -> dict[str, Any]:
        now = self.clock()
        prior_status = self.store.get_metadata("source-status") or {}
        result: dict[str, Any] = {"state": "unavailable", "lastCheckedAt": now,
                                  "lastSuccessfulAt": prior_status.get("lastSuccessfulAt"),
                                  "message": "Official source unavailable; previous records retained.",
                                  "warning": None}
        imported = 0
        checked = 0
        failed_details = 0
        try:
            now_utc = _utc(now)
            retry_meta = self.store.get_metadata("robots-retry-after") or {}
            if retry_meta.get("until") and now_utc < _utc(retry_meta["until"]):
                raise RobotsRateLimited("robots request remains rate-limited")
            robots, robots_unavailable = self._robots_policy(now_utc)
            if robots_unavailable:
                result["warning"] = "robots_unavailable"
            listing_meta = self.store.get_metadata("listing") or {}
            status, body, headers = self._request(LISTING_URL, listing_meta)
            if status == 304:
                links = listing_meta.get("links")
                if not isinstance(links, list) or not links:
                    raise ValueError("listing cache missing after conditional response")
            elif status == 200:
                links = parse_listing(body)
            else:
                raise ValueError("listing returned a non-success status")
            if status in (200, 304):
                if robots and any(not robots.can_fetch(USER_AGENT, url) for url, _ in links):
                    raise ValueError("official source robots policy disallows a detail path")
                for url, headline in links:
                    if checked >= MAX_DETAILS:
                        break
                    # A new link or changed listing headline is eligible for a
                    # detail fetch. Unchanged links are not polled repeatedly.
                    key = "detail#" + sha256(url.encode()).hexdigest()
                    prior = self.store.get_metadata(key) or {}
                    listing_hash = sha256(headline.encode()).hexdigest()
                    if prior.get("listingHash") == listing_hash:
                        continue
                    checked += 1
                    try:
                        detail_status, detail_body, detail_headers = self._request(url, prior)
                        if detail_status == 304:
                            self.store.put_metadata(key, {**prior, "listingHash": listing_hash})
                            continue
                        if detail_status != 200:
                            raise ValueError("detail returned a non-success status")
                        document = parse_detail(url, detail_body, headline, now)
                        content_hash = sha256(detail_body).hexdigest()
                        _, created = self.workflow.ingest_document(document, content_hash, PARSER_VERSION, now)
                        imported += int(created)
                        self.store.put_metadata(key, {"listingHash": listing_hash,
                            "etag": detail_headers.get("etag"), "lastModified": detail_headers.get("last-modified"),
                            "contentSha256": content_hash})
                    except (HTTPError, URLError, TimeoutError, OSError, UnicodeError, ValueError):
                        # Do not discard prior alerts or advance the failed detail cursor.
                        failed_details += 1
                        continue
                if status == 200:
                    self.store.put_metadata("listing", {"etag": headers.get("etag"),
                        "lastModified": headers.get("last-modified"), "links": links})
                result.update(state="current", lastSuccessfulAt=now,
                              message="Official listing checked; alert text remains unverified road evidence."
                              if status == 200 else "Official listing unchanged; previous records retained.")
                if failed_details:
                    result.update(state="stale", lastSuccessfulAt=prior_status.get("lastSuccessfulAt"),
                                  message="Some official details could not be checked; previous records retained.")
        except RobotsRateLimited:
            result["message"] = "Robots request rate-limited; retrieval deferred until Retry-After."
        except (HTTPError, URLError, TimeoutError, OSError, UnicodeError, ValueError):
            pass
        if result["warning"] == "robots_unavailable":
            result["message"] = "robots_unavailable: " + result["message"]
        result["message"] = result["message"][:160]
        self.store.put_metadata("source-status", result)
        return {**result, "detailPagesChecked": checked, "detailFailures": failed_details,
                "newRevisions": imported}


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Scheduled or manual invocation; no API Gateway/request body input is trusted."""
    table = os.environ["VARUNA_ROAD_ALERTS_TABLE"]
    workflow = RoadAlertWorkflow(RoadSnapshot(), DynamoRoadAlertStore(table))
    return DelhiTrafficPoliceIngestor(workflow).run()
