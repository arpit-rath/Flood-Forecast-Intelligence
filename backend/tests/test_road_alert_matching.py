"""Deterministic Phase 2 candidate matching; test-only synthetic geometry is not product data."""

import copy
import unittest
from datetime import datetime, timedelta, timezone

from backend.varuna.api import dispatch
from backend.varuna.real_roads import RoadSnapshot
from backend.varuna.road_alerts import (
    DelhiTrafficPoliceAdapter, MemoryRoadAlertStore, RoadAlertWorkflow,
    RoadCandidateMatcher, SOURCE_HOME,
)
from backend.varuna.service import VarunaService


class CandidateMatchingTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = RoadSnapshot()
        self.matcher = RoadCandidateMatcher(self.snapshot)
        self.named = [road for road in self.snapshot.roads.values() if road["properties"].get("name")]
        self.unnamed = [road for road in self.snapshot.roads.values() if not road["properties"].get("name")]
        self.assertEqual((len(self.snapshot.roads), len(self.unnamed)), (84, 82))
        self.now = datetime.now(timezone.utc)

    def document(self, **changes):
        return {"canonicalSourceUrl": SOURCE_HOME,
                "advisoryUrl": "https://example.org/phase-2-test",
                "sourceType": "traffic_alert", "publishedAtText": (self.now - timedelta(minutes=10)).isoformat(),
                "retrievedAt": self.now.isoformat(), "originalHeadline": "Waterlogging report",
                "originalText": "Source text reports waterlogging; road matching is not confirmation.",
                "statedCause": "waterlogging", "affectedLocation": None,
                "sourceAvailability": "available", "locationHints": {}, **changes}

    def context_entry(self, name, **changes):
        return {"name": name, "source": "Test-only reviewed context fixture", "sourceUrl": "https://example.test/context",
                "retrievedAt": "2026-10-11T10:00:00Z", "reviewedAt": "2026-10-11T10:01:00Z",
                "confidence": "test_only", **changes}

    def test_exact_osm_name_and_reference(self):
        name = self.named[0]["properties"]["name"]
        candidates, state = self.matcher.candidates({}, name, "", "", SOURCE_HOME)
        self.assertEqual(state, "matched_candidate")
        self.assertEqual(candidates[0]["method"], "exact_osm_name")
        self.assertEqual(candidates[0]["displayLabel"], name)
        self.assertEqual(candidates[0]["snapshotGeometryVersion"], self.snapshot.version)
        # A numbered reference exists only in this isolated test copy, not in product OSM data.
        target = self.unnamed[0]
        target["properties"]["ref"] = "TEST-42"
        candidates, state = self.matcher.candidates({"roadReferences": ["TEST-42"]}, None)
        self.assertEqual((state, candidates[0]["roadId"], candidates[0]["method"]),
                         ("matched_candidate", target["id"], "exact_osm_reference"))
        self.assertEqual(candidates[0]["displayLabel"], f"Unnamed road · {target['id']}")

    def test_reviewed_alias_and_rejection_of_unsourced_context(self):
        target = self.unnamed[1]
        alias = self.context_entry("TEST-ONLY LOCAL ALIAS", roadId=target["id"])
        context = {"version": "fixture-1", "geometryVersion": self.snapshot.version,
                   "aliases": [alias], "landmarks": []}
        matcher = RoadCandidateMatcher(self.snapshot, context)
        candidates, state = matcher.candidates({"roadNames": [alias["name"]]}, None)
        self.assertEqual((state, candidates[0]["roadId"], candidates[0]["method"]),
                         ("matched_candidate", target["id"], "reviewed_alias"))
        self.assertEqual(candidates[0]["sourceContext"]["sourceUrl"], alias["sourceUrl"])
        context["aliases"] = [{**alias, "sourceUrl": ""}]
        with self.assertRaises(ValueError):
            RoadCandidateMatcher(self.snapshot, context)

    def test_unique_intersection_unnamed_connector(self):
        first, second = self.named
        pivot = [77.122, 28.754]
        first["geometry"]["coordinates"] = [[77.121, 28.754], pivot]
        second["geometry"]["coordinates"] = [pivot, [77.123, 28.754]]
        connector = self.unnamed[2]
        connector["geometry"]["coordinates"] = [pivot, [77.122, 28.755]]
        candidates, state = self.matcher.candidates({"intersection": [first["properties"]["name"],
                                                       second["properties"]["name"]]}, None,
                                                     "Waterlogging at an intersection",
                                                     f"At {first['properties']['name']} and {second['properties']['name']}")
        self.assertEqual((state, [candidate["roadId"] for candidate in candidates]),
                         ("matched_candidate", [connector["id"]]))
        self.assertEqual(candidates[0]["method"], "named_intersection")

    def test_landmark_locality_unique_and_multiple_geometry_candidates(self):
        hints = {"landmarks": ["Delhi Technological University"], "localities": ["Shahbad Daulatpur"]}
        candidates, state = self.matcher.candidates(hints, None)
        self.assertEqual((state, len(candidates)), ("matched_candidate", 1))
        self.assertEqual(candidates[0]["method"], "landmark_locality")
        self.assertIn("Unnamed road near Delhi Technological University campus boundary", candidates[0]["displayLabel"])
        self.assertLessEqual(candidates[0]["distanceMeters"], 60)
        candidates, state = self.matcher.candidates({"landmarks": ["Delhi Technological University"]}, None)
        self.assertEqual((state, candidates[0]["method"]), ("matched_candidate", "nearby_landmark_geometry"))
        candidates, state = self.matcher.candidates({"landmarks": ["Delhi Technological University"],
                                                     "nearRoadNames": ["Western Yamuna Canal Link Road"]}, None)
        self.assertEqual((state, candidates[0]["method"]), ("matched_candidate", "landmark_road_context"))
        extra = self.context_entry("Delhi Technological University", locality="Shahbad Daulatpur",
                                   displayName="Delhi Technological University campus boundary (published corner 5)",
                                   point=[77.11540833333333, 28.747380555555555])
        context = copy.deepcopy(self.matcher.context)
        context["landmarks"].append(extra)
        candidates, state = RoadCandidateMatcher(self.snapshot, context).candidates(hints, None)
        self.assertEqual(state, "ambiguous")
        self.assertGreaterEqual(len(candidates), 2)

    def test_ambiguous_name_no_location_outside_invalid_and_stale(self):
        duplicate = copy.deepcopy(self.named[0])
        duplicate["id"] = "osm:way/999999999999"
        self.snapshot.roads[duplicate["id"]] = duplicate
        candidates, state = self.matcher.candidates({"roadNames": [duplicate["properties"]["name"]]}, None)
        self.assertEqual((state, len(candidates)), ("ambiguous", 2))
        self.assertEqual(self.matcher.candidates({}, "Unspecified place")[1], "unlocated")
        self.assertEqual(self.matcher.candidates({"coordinates": [77.2, 28.75]}, None)[1], "outside_coverage")
        self.assertEqual(self.matcher.candidates({"invalidSourceLocation": True}, None)[1], "invalid_source_location")
        self.assertEqual(self.matcher.candidates({"geometryVersion": "sha256:stale"}, None)[1], "stale_snapshot")
        stale_context = {**self.matcher.context, "geometryVersion": "sha256:stale"}
        self.assertEqual(RoadCandidateMatcher(self.snapshot, stale_context).candidates({}, None)[1], "stale_snapshot")

    def test_source_point_nearest_way_and_close_runner_up(self):
        point_on_way = [77.11866111111111, 28.752630555555555]
        candidates, state = self.matcher.candidates({"coordinates": point_on_way,
                                                      "coordinateSourceUrl": SOURCE_HOME}, None)
        self.assertEqual(state, "unlocated")  # Published campus boundary is 48 m from the nearest way, beyond 25 m.
        west, south, east, north = self.snapshot.data["metadata"]["queryBbox"]
        road = next(road for road in self.unnamed if any(
            west <= node[0] <= east and south <= node[1] <= north for node in road["geometry"]["coordinates"]))
        coordinate = next(node for node in road["geometry"]["coordinates"] if
                          west <= node[0] <= east and south <= node[1] <= north)
        candidates, state = self.matcher.candidates({"coordinates": coordinate,
                                                      "coordinateSourceUrl": SOURCE_HOME}, None)
        self.assertIn(state, ("matched_candidate", "ambiguous"))
        self.assertTrue(candidates)
        self.assertTrue(all(candidate["method"] == "source_coordinate" and
                            candidate["distanceMeters"] <= 25 for candidate in candidates))
        # Test-only overlapping way makes the same source point ambiguous.
        duplicate = copy.deepcopy(road)
        duplicate["id"] = "osm:way/999999999998"
        self.snapshot.roads[duplicate["id"]] = duplicate
        candidates, state = self.matcher.candidates({"coordinates": coordinate,
                                                      "coordinateSourceUrl": SOURCE_HOME}, None)
        self.assertEqual(state, "ambiguous")
        self.assertEqual(len(candidates), 2)

    def test_api_state_privacy_and_review_boundary(self):
        workflow = RoadAlertWorkflow(self.snapshot, MemoryRoadAlertStore())
        service = VarunaService()
        responder = {"sub": "responder-1", "token_use": "access", "cognito:groups": ["varuna-responder"]}
        resident = {"sub": "resident-1", "token_use": "access", "cognito:groups": []}
        baseline = dispatch(service, "GET", "/v1/snapshots/current").body
        doc = self.document(locationHints={"landmarks": ["Delhi Technological University"],
                                            "localities": ["Shahbad Daulatpur"]})
        imported = dispatch(service, "POST", "/v2/road-alerts/import", body=doc,
                            operator_claims=responder, road_alerts=workflow)
        self.assertEqual(imported.status, 201)
        road_id = imported.body["candidateRoads"][0]["roadId"]
        self.assertTrue(workflow.route_eligible(road_id))
        self.assertEqual(imported.body["state"], "Reported / Unverified")
        self.assertEqual(imported.body["resolutionState"], "matched_candidate")
        context = imported.body["candidateRoads"][0]["sourceContext"]
        self.assertEqual(context["alertSourceUrl"], doc["advisoryUrl"])
        self.assertEqual(context["statedCause"], "waterlogging")
        self.assertIsNotNone(context["publishedAt"])
        self.assertIsNotNone(context["retrievedAt"])
        for claims in (None, resident, responder):
            public = dispatch(service, "GET", "/v2/road-alerts", operator_claims=claims, road_alerts=workflow)
            self.assertEqual(public.status, 200)
            item = public.body["alerts"][0]
            self.assertIn("Unnamed road near", item["proposal"]["displayLabel"])
            self.assertIsNone(item["matchedRoadId"])
            for field in ("candidateRoads", "originalText", "locationHints", "reviewHistory", "sourceError", "reviewerSub"):
                self.assertNotIn(field, item)
            self.assertNotIn("roadId", item["proposal"])
        self.assertEqual(dispatch(service, "GET", "/v2/road-alerts/review", operator_claims=resident,
                                  road_alerts=workflow).status, 403)
        self.assertEqual(dispatch(service, "GET", "/v1/snapshots/current").body, baseline)
        self.assertTrue(workflow.route_eligible(road_id))
        # An imported proposal cannot be confirmed with an arbitrary point or stale version.
        denied = dispatch(service, "PATCH", f"/v2/road-alerts/{imported.body['id']}/review",
                          body={"decision": "confirm_flood_blockage", "reason": "Check mapped road match",
                                "road": {"roadId": road_id, "geometryVersion": "stale", "point": [77.11866, 28.75263]}},
                          operator_claims=responder, road_alerts=workflow)
        self.assertEqual(denied.status, 409)
        self.assertTrue(workflow.route_eligible(road_id))

    def test_adapter_invalid_point_retained_as_unverified(self):
        alert = DelhiTrafficPoliceAdapter().normalize(self.document(
            locationHints={"coordinates": [999, 28.75], "coordinateSourceUrl": SOURCE_HOME}), self.snapshot)
        self.assertEqual(alert.resolutionState, "invalid_source_location")
        self.assertEqual(alert.candidateRoads, [])
        self.assertEqual(DelhiTrafficPoliceAdapter().normalize(self.document(
            locationHints={"coordinates": [77.2, 28.75], "coordinateSourceUrl": SOURCE_HOME}),
            self.snapshot).resolutionState, "outside_coverage")

    def test_representative_fixture_resolution_counts(self):
        named = self.named[0]["properties"]["name"]
        duplicate = copy.deepcopy(self.named[0])
        duplicate["id"] = "osm:way/999999999997"  # test-only ambiguity fixture
        cases = [
            self.matcher.candidates({"roadNames": [self.named[1]["properties"]["name"]]}, None)[1],
            self.matcher.candidates({"landmarks": ["Delhi Technological University"],
                                     "localities": ["Shahbad Daulatpur"]}, None)[1],
        ]
        self.snapshot.roads[duplicate["id"]] = duplicate
        cases.extend((self.matcher.candidates({"roadNames": [named]}, None)[1],
                      self.matcher.candidates({}, "Unspecified place")[1]))
        self.assertEqual({state: cases.count(state) for state in set(cases)},
                         {"matched_candidate": 2, "ambiguous": 1, "unlocated": 1})


if __name__ == "__main__":
    unittest.main()
