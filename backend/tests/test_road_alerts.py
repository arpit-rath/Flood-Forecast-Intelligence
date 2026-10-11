"""Phase 1 source-alert provenance, safety and access boundaries."""

import unittest
from datetime import datetime, timedelta, timezone

from backend.varuna.api import dispatch
from backend.varuna.road_alerts import MemoryRoadAlertStore, RoadAlertWorkflow, SOURCE_HOME
from backend.varuna.real_roads import RoadSnapshot
from backend.varuna.service import VarunaService


class RoadAlertTests(unittest.TestCase):
    def setUp(self):
        self.service = VarunaService()
        self.snapshot = RoadSnapshot()
        self.workflow = RoadAlertWorkflow(self.snapshot, MemoryRoadAlertStore())
        self.resident = {"sub": "resident-1", "token_use": "access", "cognito:groups": []}
        self.responder = {"sub": "responder-1", "token_use": "access", "cognito:groups": ["varuna-responder"]}
        self.now = datetime.now(timezone.utc)

    def call(self, method, path, body=None, claims=None, workflow=True):
        return dispatch(self.service, method, path, body=body, operator_claims=claims,
                        road_alerts=self.workflow if workflow else None)

    def source(self, **overrides):
        base = {"canonicalSourceUrl": SOURCE_HOME,
                "advisoryUrl": "https://www.facebook.com/dtp/posts/test-advisory-123",
                "sourceType": "traffic_alert", "publishedAtText": (self.now - timedelta(minutes=10)).isoformat(),
                "retrievedAt": self.now.isoformat(), "originalHeadline": "Waterlogging reported",
                "originalText": "Waterlogging reported on a road; on-ground instructions take precedence.",
                "statedCause": "waterlogging", "affectedLocation": "a Delhi road",
                "sourceAvailability": "available", "locationHints": {}}
        return {**base, **overrides}

    def reference(self):
        for road in self.snapshot.roads.values():
            coordinates = road["geometry"]["coordinates"]
            for first, second in zip(coordinates, coordinates[1:]):
                point = [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2]
                ref = {"roadId": road["id"], "geometryVersion": self.snapshot.version, "point": point}
                try:
                    self.snapshot.match(ref)
                    return ref
                except ValueError:
                    continue
        self.fail("no uniquely matchable way")

    def test_provenance_idempotency_public_allowlist_and_v1_isolation(self):
        baseline = self.call("GET", "/v1/snapshots/current").body
        document = self.source(sourceIdentifier="advisory-123", validUntilText=(self.now + timedelta(hours=1)).isoformat(),
                               sourceError="responder-only trace")
        first = self.call("POST", "/v2/road-alerts/import", document, self.responder)
        self.assertEqual(first.status, 201)
        self.assertEqual(first.body["originalText"], document["originalText"])
        self.assertEqual(first.body["sourceError"], "responder-only trace")
        self.assertEqual(first.body["state"], "Reported / Unverified")
        self.assertEqual(self.call("POST", "/v2/road-alerts/import", document, self.responder).status, 200)
        self.assertEqual(self.call("POST", "/v2/road-alerts/import", {**document, "originalText": "changed"}, self.responder).status, 409)
        for claims in (None, self.resident, self.responder):
            public = self.call("GET", "/v2/road-alerts", claims=claims)
            self.assertEqual(public.status, 200)
            item = public.body["alerts"][0]
            self.assertEqual(item["canonicalSourceUrl"], SOURCE_HOME)
            self.assertEqual(item["publishedAtText"], document["publishedAtText"])
            self.assertEqual(datetime.fromisoformat(item["retrievedAt"].replace("Z", "+00:00")), datetime.fromisoformat(document["retrievedAt"]))
            for private in ("originalText", "sourceError", "reviewerSub", "reviewHistory", "candidateRoads", "locationHints", "reason", "sourceIdentifier"):
                self.assertNotIn(private, item)
        self.assertEqual(self.call("GET", "/v1/snapshots/current").body, baseline)

    def test_authentication_and_local_only_gate(self):
        document = self.source()
        for claims in (None, self.resident, {**self.responder, "token_use": "id"}):
            self.assertEqual(self.call("POST", "/v2/road-alerts/import", document, claims).status, 403)
            self.assertEqual(self.call("GET", "/v2/road-alerts/review", claims=claims).status, 403)
            self.assertEqual(self.call("GET", "/v2/road-alerts/RA-" + "a" * 32, claims=claims).status, 403)
            self.assertEqual(self.call("PATCH", "/v2/road-alerts/RA-" + "a" * 32 + "/review", {}, claims).status, 403)
        self.assertEqual(self.call("POST", "/v2/road-alerts/import", document, self.responder, False).status, 503)
        self.assertEqual(self.call("GET", "/v2/road-alerts", workflow=False).status, 503)

    def test_unverified_time_unavailable_expiry_and_nonflood(self):
        for i, changes in enumerate((
            {"publishedAtText": None}, {"publishedAtText": "nonsense"},
            {"publishedAtText": (self.now - timedelta(days=2)).isoformat()},
            {"sourceAvailability": "unavailable"},
            {"sourceAvailability": "error"},
            {"validUntilText": (self.now - timedelta(minutes=1)).isoformat()},
        )):
            result = self.call("POST", "/v2/road-alerts/import", self.source(advisoryUrl=f"https://example.org/{i}", **changes), self.responder)
            self.assertEqual(result.status, 201)
            self.assertNotEqual(result.body["freshness"], "Current")
            self.assertIn(result.body["state"], ("Reported / Unverified", "Expired"))
        ref = self.reference()
        document = self.source(advisoryUrl="https://example.org/nonflood", statedCause="construction",
                               locationHints={"coordinates": ref["point"], "coordinateSourceUrl": SOURCE_HOME})
        imported = self.call("POST", "/v2/road-alerts/import", document, self.responder).body
        denied = self.call("PATCH", f"/v2/road-alerts/{imported['id']}/review",
                           {"decision": "confirm_flood_blockage", "reason": "Verified source and segment", "road": ref}, self.responder)
        self.assertEqual(denied.status, 400)
        self.assertTrue(self.workflow.route_eligible(ref["roadId"]))

    def test_candidates_confirmation_and_clear(self):
        ref = self.reference()
        document = self.source(locationHints={"coordinates": ref["point"], "coordinateSourceUrl": SOURCE_HOME})
        imported = self.call("POST", "/v2/road-alerts/import", document, self.responder)
        self.assertEqual(imported.status, 201)
        self.assertIn(ref["roadId"], [candidate["roadId"] for candidate in imported.body["candidateRoads"]])
        self.assertTrue(self.workflow.route_eligible(ref["roadId"]))
        path = f"/v2/road-alerts/{imported.body['id']}/review"
        body = {"decision": "confirm_flood_blockage", "reason": "Flood-related closure verified against source", "road": ref}
        self.assertEqual(self.call("PATCH", path, body, self.resident).status, 403)
        self.assertEqual(self.call("PATCH", path, {**body, "road": {**ref, "geometryVersion": "stale"}}, self.responder).status, 409)
        confirmed = self.call("PATCH", path, body, self.responder)
        self.assertEqual(confirmed.status, 200)
        self.assertEqual(confirmed.body["state"], "Confirmed Flood Blockage")
        self.assertEqual(confirmed.body["reviewHistory"][0]["reviewerSub"], "responder-1")
        self.assertFalse(self.workflow.route_eligible(ref["roadId"]))
        self.assertEqual(self.call("GET", "/v1/snapshots/current").status, 200)
        other = next(road for road in self.snapshot.roads if road != ref["roadId"])
        self.assertTrue(self.workflow.route_eligible(other))
        public = self.call("GET", "/v2/road-alerts").body["alerts"][0]
        self.assertEqual(public["matchedRoadId"], ref["roadId"])
        self.assertNotIn("reviewHistory", public)
        cleared = self.call("PATCH", path, {"decision": "clear", "reason": "Responder verified clearance on ground"}, self.responder)
        self.assertEqual(cleared.body["state"], "Cleared")
        self.assertTrue(self.workflow.route_eligible(ref["roadId"]))
        self.assertEqual(self.call("PATCH", path, body, self.responder).status, 409)

    def test_independent_confirmations_and_expiry_do_not_leave_stale_exclusions(self):
        ref = self.reference()
        review = {"decision": "confirm_flood_blockage", "reason": "Flood-related closure verified against source", "road": ref}
        ids = []
        for index in range(2):
            doc = self.source(advisoryUrl=f"https://example.org/flood-{index}",
                              locationHints={"coordinates": ref["point"], "coordinateSourceUrl": SOURCE_HOME})
            imported = self.call("POST", "/v2/road-alerts/import", doc, self.responder).body
            ids.append(imported["id"])
            self.assertEqual(self.call("PATCH", f"/v2/road-alerts/{imported['id']}/review", review, self.responder).status, 200)
        self.assertFalse(self.workflow.route_eligible(ref["roadId"]))
        self.call("PATCH", f"/v2/road-alerts/{ids[0]}/review",
                  {"decision": "clear", "reason": "First source closure was cleared"}, self.responder)
        self.assertFalse(self.workflow.route_eligible(ref["roadId"]))
        self.workflow.clock = lambda: self.now + timedelta(hours=25)
        self.assertTrue(self.workflow.route_eligible(ref["roadId"]))
        public = self.call("GET", "/v2/road-alerts").body["alerts"]
        self.assertTrue(all(item["state"] == "Expired" for item in public))
        self.assertTrue(all(item["matchedRoadId"] is None for item in public))

    def test_confirmation_cannot_invent_flood_cause_or_overrule_unavailable_source(self):
        ref = self.reference()
        hints = {"coordinates": ref["point"], "coordinateSourceUrl": SOURCE_HOME}
        for index, change in enumerate((
            {"sourceAvailability": "unavailable"},
            {"originalHeadline": "Construction diversion", "originalText": "Construction traffic diversion only.", "statedCause": "waterlogging"},
        )):
            imported = self.call("POST", "/v2/road-alerts/import", self.source(
                advisoryUrl=f"https://example.org/unsafe-{index}", locationHints=hints, **change), self.responder).body
            result = self.call("PATCH", f"/v2/road-alerts/{imported['id']}/review",
                               {"decision": "confirm_flood_blockage", "reason": "Verified closure against source", "road": ref}, self.responder)
            self.assertIn(result.status, (400, 409))
        self.assertTrue(self.workflow.route_eligible(ref["roadId"]))

    def test_name_ambiguity_and_outside_coverage(self):
        named = next(road for road in self.snapshot.roads.values() if road["properties"].get("name"))
        duplicate = {**named, "id": "osm:way/999999999999"}
        self.snapshot.roads[duplicate["id"]] = duplicate
        document = self.source(locationHints={"roadNames": [named["properties"]["name"]]})
        imported = self.call("POST", "/v2/road-alerts/import", document, self.responder).body
        self.assertEqual(imported["matchAmbiguity"], "multiple_candidates")
        self.assertEqual(imported["state"], "Reported / Unverified")
        self.assertIsNone(self.call("GET", "/v2/road-alerts").body["alerts"][0]["matchedRoadId"])
        outside = self.call("POST", "/v2/road-alerts/import", self.source(advisoryUrl="https://example.org/outside",
                            locationHints={"roadNames": ["Not in this extract"]}), self.responder).body
        self.assertEqual(outside["matchAmbiguity"], "unlocated")
        self.assertEqual(outside["candidateRoads"], [])


if __name__ == "__main__":
    unittest.main()
