"""Saved synthetic HTML only: no test connects to the official website."""

import unittest
from datetime import datetime, timezone
from hashlib import sha256
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from backend.varuna.api import dispatch
from backend.varuna.real_roads import RoadSnapshot
from backend.varuna.road_alerts import MemoryRoadAlertStore, RoadAlertWorkflow
from backend.varuna.service import VarunaService
from backend.varuna.traffic_ingest import (
    DelhiTrafficPoliceIngestor, DynamoRoadAlertStore, LISTING_URL, MAX_DETAILS, ROBOTS_URL,
    _NoRedirect, canonical_detail, http_get, parse_detail, parse_listing,
)


NOW = "2026-10-11T12:00:00Z"
DETAIL = b'''<html><main><article><h1>Waterlogging reported near Delhi Technological University</h1>
<time datetime="2026-10-11T11:30:00Z">Today</time>
<div class="field--name-body"><p>Waterlogging reported near Delhi Technological University.
Follow on-ground instructions.</p><a href="https://example.org/reference">External reference</a></div>
</article></main></html>'''


def listing(items):
    return ("<html><main>" + "".join(f'<h2><a href="/en/alert-{i}">{title}</a></h2>'
                                      for i, title in items) + "</main></html>").encode()


class FakeFetch:
    def __init__(self, links=None, details=None):
        self.links = links or [(1, "Waterlogging reported near Delhi Technological University")]
        self.details = details or {}
        self.calls = []
        self.fail_listing = False
        self.robots_status = 200
        self.robots_headers = {}
        self.fail_robots = False
        self.robots = b"User-agent: *\nAllow: /en/news-alertadvisory/alerts\nAllow: /en/alert-\n"

    def __call__(self, url, conditional):
        self.calls.append((url, dict(conditional or {})))
        if url == ROBOTS_URL:
            if self.fail_robots:
                raise TimeoutError("synthetic robots network timeout")
            return self.robots_status, self.robots, self.robots_headers
        if url == LISTING_URL:
            if self.fail_listing:
                raise TimeoutError("synthetic source timeout")
            if conditional and conditional.get("If-None-Match") == '"listing-v1"' and not self.details.get("force_listing"):
                return 304, b"", {}
            return 200, listing(self.links), {"etag": '"listing-v1"', "last-modified": "Sun, 11 Oct 2026 11:00:00 GMT"}
        if url.endswith("/en/alert-1"):
            return 200, self.details.get("one", DETAIL), {"etag": '"detail-v1"'}
        return 200, self.details.get("other", DETAIL), {}


class TrafficIngestTests(unittest.TestCase):
    def setUp(self):
        self.store = MemoryRoadAlertStore()
        self.workflow = RoadAlertWorkflow(RoadSnapshot(), self.store,
                                          clock=lambda: datetime(2026, 10, 11, 12, tzinfo=timezone.utc))
        self.fetch = FakeFetch()
        self.now = NOW
        self.ingestor = DelhiTrafficPoliceIngestor(self.workflow, self.fetch, clock=lambda: self.now)

    def test_listing_detail_canonical_and_source_fields(self):
        url, title = parse_listing(listing([(1, "Waterlogging on a named road")]))[0]
        self.assertEqual(url, "https://traffic.delhipolice.gov.in/en/alert-1")
        self.assertEqual(title, "Waterlogging on a named road")
        self.assertIsNone(canonical_detail("https://example.org/en/alert-1"))
        self.assertIsNone(canonical_detail("http://traffic.delhipolice.gov.in/en/alert-1"))
        self.assertIsNone(canonical_detail("https://traffic.delhipolice.gov.in:443/en/alert-1"))
        self.assertIsNone(canonical_detail("/en/alert.pdf"))
        self.assertIsNone(canonical_detail("/en/admin/alerts"))
        self.assertEqual(canonical_detail("/en/⚠️alert"), "https://traffic.delhipolice.gov.in/en/%E2%9A%A0%EF%B8%8Falert")
        self.assertEqual(canonical_detail("/en/alert-1#fragment"), url)
        document = parse_detail(url, DETAIL, title, NOW)
        self.assertEqual(document["sourceIdentifier"], "/en/alert-1")
        self.assertEqual(document["publishedAtText"], "2026-10-11T11:30:00Z")
        self.assertEqual(document["statedCause"], "Waterlogging")
        self.assertEqual(document["advisoryUrl"], "https://example.org/reference")
        self.assertIn("Follow on-ground", document["originalText"])
        self.assertEqual(sha256(DETAIL).hexdigest(), sha256(DETAIL).hexdigest())

    def test_transport_timeout_user_agent_conditional_and_no_redirect(self):
        class Response:
            status = 200
            headers = {"Content-Type": "text/html", "ETag": '"v1"'}

            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, size): return b"<html>saved</html>"

        class Opener:
            def open(self, request, timeout):
                self.request, self.timeout = request, timeout
                return Response()

        opener = Opener()
        with patch("backend.varuna.traffic_ingest.build_opener", return_value=opener):
            status, body, _ = http_get(LISTING_URL, {"If-None-Match": '"v1"'})
        self.assertEqual(status, 200)
        self.assertEqual(body, b"<html>saved</html>")
        self.assertEqual(opener.timeout, 10)
        self.assertIn("Varuna", opener.request.get_header("User-agent"))
        self.assertEqual(opener.request.get_header("If-none-match"), '"v1"')
        with self.assertRaises(URLError):
            _NoRedirect().redirect_request(opener.request, None, 307, "redirect", {}, "https://example.org/")

        class ErrorOpener:
            def open(self, request, timeout):
                raise HTTPError(ROBOTS_URL, 403, "Forbidden", {"Content-Type": "text/html"}, None)

        with patch("backend.varuna.traffic_ingest.build_opener", return_value=ErrorOpener()):
            self.assertEqual(http_get(ROBOTS_URL)[0], 403)

    def test_malformed_pages_and_timeout_retain_previous(self):
        with self.assertRaises(ValueError):
            parse_listing(b"<html><main><p>No usable alerts</p></main></html>")
        with self.assertRaises(ValueError):
            parse_detail("https://traffic.delhipolice.gov.in/en/a", b"<html></html>", "", NOW)
        self.assertEqual(self.ingestor.run()["newRevisions"], 1)
        self.fetch.fail_listing = True
        result = self.ingestor.run()
        self.assertEqual(result["state"], "unavailable")
        self.assertEqual(result["lastSuccessfulAt"], NOW)
        self.assertEqual(len(self.store.list()), 1)
        self.assertEqual(self.workflow.source_status()["state"], "unavailable")

    def test_repeated_event_conditional_get_and_versioned_revision(self):
        first = self.ingestor.run()
        self.assertEqual(first["newRevisions"], 1)
        self.assertEqual(self.ingestor.run()["newRevisions"], 0)
        self.assertEqual(len(self.store.list()), 1)
        self.assertEqual(self.fetch.calls[-1][1]["If-None-Match"], '"listing-v1"')
        self.assertEqual(self.fetch.calls[-1][1]["If-Modified-Since"], "Sun, 11 Oct 2026 11:00:00 GMT")
        self.fetch.details["force_listing"] = True
        self.fetch.links = [(1, "Updated waterlogging alert near Delhi Technological University")]
        self.fetch.details["one"] = DETAIL.replace(b"Follow on-ground", b"Updated: follow on-ground")
        updated = self.ingestor.run()
        self.assertEqual(updated["newRevisions"], 1)
        self.assertEqual(len(self.store.list()), 2)
        ids = {item["id"] for item in self.store.list()}
        self.assertEqual(len(ids), 2)
        self.assertEqual({item["contentSha256"] for item in self.store.list()},
                         {sha256(DETAIL).hexdigest(), sha256(self.fetch.details["one"]).hexdigest()})
        self.assertTrue(all(item["reviewState"] == "Imported" for item in self.store.list()))

    def test_at_most_ten_details_and_no_cross_origin_fetch(self):
        self.fetch.links = [(i, f"Alert {i}") for i in range(20)]
        result = self.ingestor.run()
        self.assertEqual(result["detailPagesChecked"], MAX_DETAILS)
        self.assertEqual(sum(url not in (ROBOTS_URL, LISTING_URL) for url, _ in self.fetch.calls), MAX_DETAILS)
        self.assertTrue(all(url.startswith("https://traffic.delhipolice.gov.in/") for url, _ in self.fetch.calls))

    def test_robots_disallow_fails_closed(self):
        self.fetch.robots = b"User-agent: VarunaRoadAlerts\nDisallow: /en/\n"
        result = self.ingestor.run()
        self.assertEqual(result["state"], "unavailable")
        self.assertEqual(self.fetch.calls, [(ROBOTS_URL, {})])

    def test_403_robots_unavailable_allows_only_bounded_official_pages(self):
        self.fetch.robots_status = 403
        first = self.ingestor.run()
        self.assertEqual(first["state"], "current")
        self.assertEqual(first["warning"], "robots_unavailable")
        self.assertIn("robots_unavailable", self.workflow.source_status()["message"])
        public_status = dispatch(VarunaService(), "GET", "/v2/road-alerts", road_alerts=self.workflow).body["sourceStatus"]
        self.assertIn("robots_unavailable", public_status["message"])
        self.assertNotIn("warning", public_status)
        self.assertEqual(first["detailPagesChecked"], 1)
        self.assertEqual(first["newRevisions"], 1)
        self.assertEqual([url for url, _ in self.fetch.calls],
                         [ROBOTS_URL, LISTING_URL, "https://traffic.delhipolice.gov.in/en/alert-1"])
        second = self.ingestor.run()
        self.assertEqual(second["warning"], "robots_unavailable")
        self.assertEqual(second["newRevisions"], 0)
        self.assertEqual(len(self.store.list()), 1)
        self.assertEqual([url for url, _ in self.fetch.calls[-2:]], [ROBOTS_URL, LISTING_URL])

    def test_explicit_detail_disallow_stops_before_detail_fetch(self):
        self.fetch.links = [(1, "Allowed alert"), (2, "Disallowed alert")]
        self.fetch.robots = b"User-agent: *\nDisallow: /en/alert-2\n"
        result = self.ingestor.run()
        self.assertEqual(result["state"], "unavailable")
        self.assertEqual(self.fetch.calls, [(ROBOTS_URL, {}), (LISTING_URL, {})])
        self.assertEqual(self.store.list(), [])

    def test_429_respects_retry_after_across_scheduled_runs(self):
        self.fetch.robots_status = 429
        self.fetch.robots_headers = {"retry-after": "3600"}
        first = self.ingestor.run()
        self.assertEqual(first["state"], "unavailable")
        self.assertEqual(self.store.get_metadata("robots-retry-after")["until"], "2026-10-11T13:00:00Z")
        self.now = "2026-10-11T12:30:00Z"
        second = self.ingestor.run()
        self.assertEqual(second["state"], "unavailable")
        self.assertEqual(self.fetch.calls, [(ROBOTS_URL, {})])
        self.now = "2026-10-11T13:00:00Z"
        self.fetch.robots_status = 403
        self.assertEqual(self.ingestor.run()["newRevisions"], 1)

    def test_robots_5xx_network_or_malformed_success_stops_before_listing(self):
        for status, body, network in ((500, b"", False), (503, b"", False),
                                       (200, b"not robots syntax", False),
                                       (200, b"User-agent: *\nDisallow: /en/*", False),
                                       (200, b"", True)):
            with self.subTest(status=status, body=body, network=network):
                self.fetch.calls.clear()
                self.fetch.robots_status = status
                self.fetch.robots = body
                self.fetch.fail_robots = network
                result = self.ingestor.run()
                self.assertEqual(result["state"], "unavailable")
                self.assertEqual(self.fetch.calls, [(ROBOTS_URL, {})])
                self.assertEqual(self.store.list(), [])

    def test_detail_failure_stale_and_public_redaction_auth_and_v1(self):
        self.fetch.details["one"] = b"<html>layout changed</html>"
        self.assertEqual(self.ingestor.run()["state"], "stale")
        self.assertEqual(self.store.list(), [])
        self.fetch.details["one"] = DETAIL
        self.assertEqual(self.ingestor.run()["newRevisions"], 1)
        service = VarunaService()
        baseline = dispatch(service, "GET", "/v1/snapshots/current").body
        resident = {"sub": "resident", "token_use": "access", "cognito:groups": []}
        responder = {"sub": "responder", "token_use": "access", "cognito:groups": ["varuna-responder"]}
        for claims in (None, resident, responder):
            response = dispatch(service, "GET", "/v2/road-alerts", operator_claims=claims, road_alerts=self.workflow)
            self.assertEqual(response.status, 200)
            public = response.body["alerts"][0]
            self.assertEqual(public["state"], "Reported / Unverified")
            self.assertIsNone(public["matchedRoadId"])
            for private in ("candidateRoads", "sourceAlertIdentifier", "reviewHistory", "reviewerSub", "originalText", "sourceError", "contentSha256"):
                self.assertNotIn(private, public)
            self.assertIn("sourceStatus", response.body)
        self.assertEqual(dispatch(service, "GET", "/v2/road-alerts/review", operator_claims=resident,
                                  road_alerts=self.workflow).status, 403)
        self.assertEqual(dispatch(service, "GET", "/v2/road-alerts/review", operator_claims=responder,
                                  road_alerts=self.workflow).status, 200)
        self.assertEqual(dispatch(service, "GET", "/v1/snapshots/current").body, baseline)

    def test_end_date_and_ambiguous_or_unlocated_match(self):
        url = "https://traffic.delhipolice.gov.in/en/alert-1"
        ended = DETAIL.replace(b'<time datetime="2026-10-11T11:30:00Z">',
                               b'<time class="end" datetime="2026-10-11T10:00:00Z"></time><time datetime="2026-10-11T11:30:00Z">')
        doc = parse_detail(url, ended, "Alert", NOW)
        doc["originalHeadline"] = "Traffic alert at an unspecified road"
        doc["originalText"] = "Traffic disruption reported; location not specified."
        self.assertEqual(doc["validUntilText"], "2026-10-11T10:00:00Z")
        self.workflow.ingest_document(doc, sha256(ended).hexdigest(), "test-v1", NOW)
        self.assertEqual(self.workflow.public_list()[0]["freshness"], "Expired")
        self.assertEqual(self.workflow.public_list()[0]["resolutionState"], "unlocated")
        named = next(road for road in self.workflow.snapshot.roads.values() if road["properties"].get("name"))
        duplicate = {**named, "id": "osm:way/999999999999"}
        self.workflow.snapshot.roads[duplicate["id"]] = duplicate
        ambiguous = {**doc, "canonicalSourceUrl": "https://traffic.delhipolice.gov.in/en/alert-2",
                     "sourceIdentifier": "/en/alert-2", "originalHeadline": named["properties"]["name"],
                     "validUntilText": None}
        item, _ = self.workflow.ingest_document(ambiguous, sha256(b"ambiguity").hexdigest(), "test-v1", NOW)
        self.assertEqual(item["resolutionState"], "ambiguous")
        self.assertEqual(item["state"], "Reported / Unverified")
        self.assertIsNone(self.workflow.public(item)["matchedRoadId"])

    def test_dynamo_repository_contract_with_no_aws_calls(self):
        class ConditionalFailure(Exception):
            response = {"Error": {"Code": "ConditionalCheckFailedException"}}

        class FakeTable:
            def __init__(self): self.items = {}

            def put_item(self, Item, ConditionExpression=None):
                if ConditionExpression and Item["id"] in self.items:
                    raise ConditionalFailure()
                self.items[Item["id"]] = Item

            def get_item(self, Key, **_):
                return {"Item": self.items[Key["id"]]} if Key["id"] in self.items else {}

            def scan(self, **_):
                return {"Items": [item for item in self.items.values() if item["kind"] == "alert"]}

        table = FakeTable()
        store = DynamoRoadAlertStore("test-table", table=table,
            clock=lambda: datetime(2026, 10, 11, 12, tzinfo=timezone.utc))
        workflow = RoadAlertWorkflow(RoadSnapshot(), store,
            clock=lambda: datetime(2026, 10, 11, 12, tzinfo=timezone.utc))
        document = parse_detail("https://traffic.delhipolice.gov.in/en/alert-1", DETAIL, "fixture", NOW)
        first, created = workflow.ingest_document(document, sha256(DETAIL).hexdigest(), "test-v1", NOW)
        self.assertTrue(created)
        self.assertEqual(workflow.ingest_document(document, sha256(DETAIL).hexdigest(), "test-v1", NOW)[1], False)
        self.assertEqual(len(store.list()), 1)
        self.assertEqual(store.get(first["id"])["contentSha256"], sha256(DETAIL).hexdigest())
        store.put_metadata("source-status", {"state": "current", "lastCheckedAt": NOW,
                                              "lastSuccessfulAt": NOW, "message": "Checked"})
        self.assertEqual(workflow.source_status()["state"], "current")
        self.assertEqual(len(store.list()), 1)
        store.put_metadata("robots-retry-after", {"until": "2026-12-11T12:00:00Z"})
        self.assertGreater(table.items["META#robots-retry-after"]["expiresAtEpoch"],
                           int(datetime(2026, 12, 11, 12, tzinfo=timezone.utc).timestamp()))
        table.items[first["id"]]["expiresAtEpoch"] = 1
        self.assertIsNone(store.get(first["id"]))
        self.assertEqual(store.list(), [])


if __name__ == "__main__":
    unittest.main()
