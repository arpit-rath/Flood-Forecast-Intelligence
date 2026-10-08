from __future__ import annotations

import copy
import unittest
from dataclasses import replace

from backend.varuna.fixture import load_fixture
from backend.varuna.interventions import compare_interventions
from backend.varuna.models import Report, Segment
from backend.varuna.risk import score_segments
from backend.varuna.routing import compare_routes, route_exposure
from backend.varuna.service import SnapshotConflictError, VarunaService


class DomainTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = load_fixture()
        self.service = VarunaService(self.fixture)

    def test_fixture_is_connected_and_has_forty_segments(self) -> None:
        segments = self.fixture.segments
        self.assertEqual(40, len(segments))
        graph: dict[str, set[str]] = {}
        for segment in segments:
            graph.setdefault(segment.from_node, set()).add(segment.to_node)
            graph.setdefault(segment.to_node, set()).add(segment.from_node)
        visited, pending = set(), [self.fixture.route_query["originNodeId"]]
        while pending:
            node = pending.pop()
            if node not in visited:
                visited.add(node)
                pending.extend(graph[node] - visited)
        self.assertEqual(set(graph), visited)

    def test_complete_scenario_is_repeatable_and_ranks_two_drains(self) -> None:
        first = self.service.run_fixture()
        self.assertEqual(first, self.service.run_fixture())
        self.assertEqual(first, VarunaService().run_fixture())
        self.assertEqual("Scenario", first["snapshot"]["mode"])
        self.assertNotEqual(first["routes"]["fastestRouteId"], first["routes"]["recommendedRouteId"])
        results = first["interventions"]["results"]
        self.assertEqual(["D-01", "D-02"], [item["drainId"] for item in results])
        self.assertTrue(all(item["simulated"] for item in results))
        self.assertGreater(results[0]["routeExposureReduction"], results[1]["routeExposureReduction"])

    def test_missing_weather_or_local_context_is_unknown(self) -> None:
        one = self.fixture.segments[0]
        unknown_weather = score_segments((one,), None, valid_at=self.fixture.metadata["validAt"])
        self.assertEqual("Unknown", unknown_weather["segments"][0]["class"])
        no_context = replace(one, terrain_prior=None, drainage_vulnerability=None)
        unknown_context = score_segments((no_context,), self.fixture.weather, valid_at=self.fixture.metadata["validAt"])
        self.assertEqual("Unknown", unknown_context["segments"][0]["class"])
        self.assertEqual(["T", "D", "O"], unknown_context["segments"][0]["missingFeatures"])

    def test_missing_observation_is_not_zero_and_observed_zero_is_available(self) -> None:
        one = replace(self.fixture.segments[0], terrain_prior=0.0, drainage_vulnerability=0.0)
        snapshot = score_segments((one,), self.fixture.weather, valid_at=self.fixture.metadata["validAt"])
        risk = snapshot["segments"][0]
        self.assertEqual(0.8, risk["coverage"])
        self.assertEqual(0.0, risk["features"]["T"])
        self.assertIsNone(risk["features"]["O"])

    def test_stale_weather_reduces_confidence_without_inventing_freshness(self) -> None:
        old_weather = {**self.fixture.weather, "validAt": "2026-10-08T09:00:00Z"}
        snapshot = score_segments(self.fixture.segments, old_weather,
                                  valid_at=self.fixture.metadata["validAt"])
        self.assertTrue(snapshot["weatherStale"])
        self.assertEqual("Low", snapshot["segments"][0]["confidence"])

    def test_expired_accepted_report_does_not_affect_current_score(self) -> None:
        accepted = self.fixture.reports[0]
        expired = replace(accepted, captured_at="2026-10-08T08:00:00Z")
        with_expired = score_segments(self.fixture.segments, self.fixture.weather, (expired,),
                                      valid_at=self.fixture.metadata["validAt"])
        without_report = score_segments(self.fixture.segments, self.fixture.weather, (),
                                        valid_at=self.fixture.metadata["validAt"])
        stale_risk = next(item for item in with_expired["segments"] if item["segmentId"] == expired.segment_id)
        baseline_risk = next(item for item in without_report["segments"] if item["segmentId"] == expired.segment_id)
        self.assertEqual(baseline_risk["score"], stale_risk["score"])
        self.assertEqual(baseline_risk["features"], stale_risk["features"])
        self.assertEqual([], stale_risk["evidenceIds"])
        self.assertEqual("Low", stale_risk["confidence"])

    def test_report_reaches_only_one_lower_lying_neighbour(self) -> None:
        base = self.fixture.segments[0]
        target = replace(base, id="target", from_node="A", to_node="B", terrain_prior=0.1)
        first = replace(base, id="first", from_node="A", to_node="C", terrain_prior=0.9)
        second = replace(base, id="second", from_node="B", to_node="D", terrain_prior=0.7)
        report = replace(self.fixture.reports[0], segment_id="target",
                         captured_at=self.fixture.metadata["validAt"])
        snapshot = score_segments((target, first, second), self.fixture.weather, (report,),
                                  valid_at=self.fixture.metadata["validAt"])
        risks = {item["segmentId"]: item for item in snapshot["segments"]}
        self.assertEqual([report.id], risks["target"]["evidenceIds"])
        self.assertEqual([report.id], risks["first"]["evidenceIds"])
        self.assertEqual([], risks["second"]["evidenceIds"])
        self.assertEqual(risks["target"]["features"]["O"] * 0.5,
                         risks["first"]["features"]["O"])

    def test_unassessed_routes_make_no_lower_exposure_claim(self) -> None:
        snapshot = score_segments(self.fixture.segments, None,
                                  valid_at=self.fixture.metadata["validAt"])
        query = self.fixture.route_query
        routes = compare_routes(self.fixture.segments, snapshot, query["originNodeId"],
                                query["destinationNodeId"], query["travelMode"])
        self.assertIn("No lower-exposure route found", routes["reason"])
        self.assertTrue(all(item["exposure"] is None for item in routes["candidates"]))

    def test_pending_report_does_not_change_risk_until_accepted(self) -> None:
        baseline = self.service.snapshot()
        without_pending = VarunaService(self.fixture)
        del without_pending.reports["fixture-report-pending"]
        self.assertEqual(baseline, without_pending.snapshot())
        self.service.set_report_status("fixture-report-pending", "Accepted")
        after = self.service.snapshot()
        self.assertNotEqual(baseline["id"], after["id"])
        before_risk = next(item for item in baseline["segments"] if item["segmentId"] == "H-1-1")
        after_risk = next(item for item in after["segments"] if item["segmentId"] == "H-1-1")
        self.assertGreater(after_risk["score"], before_risk["score"])

    def test_closed_is_distinct_from_high_and_excluded_from_routes(self) -> None:
        self.service.set_closure("H-2-1", True)
        snapshot = self.service.snapshot()
        closed = next(item for item in snapshot["segments"] if item["segmentId"] == "H-2-1")
        self.assertEqual("Closed", closed["roadStatus"])
        self.assertIn(closed["class"], ("Low", "Watch", "High", "Unknown"))
        q = self.fixture.route_query
        routes = self.service.routes(q["originNodeId"], q["destinationNodeId"], q["travelMode"], snapshot["id"])
        self.assertTrue(routes["candidates"])
        self.assertTrue(all("H-2-1" not in item["segmentIds"] for item in routes["candidates"]))
        recommended = next(item for item in routes["candidates"] if item["id"] == routes["recommendedRouteId"])
        self.assertFalse(recommended["blocked"])

    def test_stale_snapshot_is_rejected(self) -> None:
        old_id = self.service.snapshot()["id"]
        self.service.set_closure("H-2-1", True)
        q = self.fixture.route_query
        with self.assertRaises(SnapshotConflictError):
            self.service.routes(q["originNodeId"], q["destinationNodeId"], q["travelMode"], old_id)

    def test_closing_all_departure_edges_returns_no_route(self) -> None:
        self.service.set_closure("H-2-0", True)
        self.service.set_closure("V-1-0", True)
        self.service.set_closure("V-2-0", True)
        snapshot = self.service.snapshot()
        q = self.fixture.route_query
        comparison = self.service.routes(q["originNodeId"], q["destinationNodeId"], q["travelMode"], snapshot["id"])
        self.assertEqual([], comparison["candidates"])
        self.assertIsNone(comparison["recommendedRouteId"])

    def test_exposure_uses_assessed_distance_and_reports_unknown_share(self) -> None:
        a, b = self.fixture.segments[:2]
        a = replace(a, length_m=100)
        b = replace(b, length_m=300)
        by_id = {a.id: a, b.id: b}
        risks = {a.id: {"score": 0.2, "class": "Low", "isClosed": False},
                 b.id: {"score": 0.8, "class": "High", "isClosed": False}}
        self.assertAlmostEqual(0.65, route_exposure((a.id, b.id), by_id, risks)["exposure"])
        risks[b.id] = {"score": None, "class": "Unknown", "isClosed": False}
        partial = route_exposure((a.id, b.id), by_id, risks)
        self.assertEqual(0.2, partial["exposure"])
        self.assertEqual(0.75, partial["unknownShare"])

    def test_interventions_leave_baseline_and_segments_unchanged(self) -> None:
        snapshot = self.service.snapshot()
        original = copy.deepcopy(snapshot)
        original_segments = self.fixture.segments
        q = self.fixture.route_query
        routes = self.service.routes(q["originNodeId"], q["destinationNodeId"], q["travelMode"], snapshot["id"])
        compare_interventions(original_segments, self.fixture.reports, self.fixture.weather, snapshot,
                              routes, self.fixture.drains, routes["fastestRouteId"])
        self.assertEqual(original, snapshot)
        self.assertEqual(original_segments, self.fixture.segments)

    def test_model_rejects_invalid_report_status_and_segment_coordinates(self) -> None:
        report = self.fixture.reports[0].as_dict()
        report["reviewStatus"] = "Closed"
        with self.assertRaises(ValueError):
            Report.from_dict(report)
        report = self.fixture.reports[0].as_dict()
        report["observations"] = {**report["observations"], "estimated_depth_cm": 35}
        with self.assertRaises(ValueError):
            Report.from_dict(report)
        segment = self.fixture.segments[0].as_dict()
        segment["geometry"][0] = [200, 28]
        with self.assertRaises(ValueError):
            Segment.from_dict(segment)

    def test_report_rejects_invalid_time_order_and_point_outside_pilot(self) -> None:
        report = self.fixture.reports[1].as_dict()
        report["capturedAt"] = "2026-10-08T11:41:00Z"
        with self.assertRaisesRegex(ValueError, "capturedAt"):
            Report.from_dict(report)
        outside = replace(self.fixture.reports[1], id="outside", point=(0.0, 0.0))
        with self.assertRaisesRegex(ValueError, "pilot bounds"):
            self.service.add_pending_report(outside)
        self.assertNotIn("outside", self.service.reports)


if __name__ == "__main__":
    unittest.main()
