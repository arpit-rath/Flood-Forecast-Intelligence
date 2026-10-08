"""Application-level orchestration for the deterministic fixture slice."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from .fixture import Fixture, load_fixture
from .interventions import compare_interventions
from .models import Report
from .risk import score_segments
from .routing import compare_routes


class ModeUnavailableError(Exception):
    """A requested data source is not configured or is unavailable."""


class SnapshotConflictError(Exception):
    """A client tried to act on a superseded risk snapshot."""


class VarunaService:
    def __init__(self, fixture: Fixture | None = None) -> None:
        self.fixture = fixture or load_fixture()
        self.reports: dict[str, Report] = {report.id: report for report in self.fixture.reports}
        self.closed_segment_ids: set[str] = set()

    def pilot(self) -> dict[str, Any]:
        return {
            **self.fixture.metadata,
            "segments": [segment.as_dict() for segment in self.fixture.segments],
            "drains": list(self.fixture.drains),
            "routeQuery": self.fixture.route_query,
            "synthetic": True,
        }

    def snapshot(self, mode: str = "Scenario") -> dict[str, Any]:
        if mode != "Scenario":
            raise ModeUnavailableError("Live weather is not configured in fixture mode")
        return score_segments(
            self.fixture.segments, self.fixture.weather, self.reports.values(),
            valid_at=self.fixture.metadata["validAt"],
            closed_segment_ids=self.closed_segment_ids,
            bundle_version=self.fixture.metadata["bundleVersion"],
        )

    def routes(
        self, origin_node_id: str, destination_node_id: str, travel_mode: str,
        snapshot_id: str,
    ) -> dict[str, Any]:
        snapshot = self.snapshot()
        if snapshot_id != snapshot["id"]:
            raise SnapshotConflictError("risk snapshot has changed; refresh before comparing routes")
        return compare_routes(
            self.fixture.segments, snapshot, origin_node_id, destination_node_id, travel_mode,
        )

    def interventions(
        self, origin_node_id: str, destination_node_id: str, travel_mode: str,
        snapshot_id: str, selected_route_id: str,
    ) -> dict[str, Any]:
        snapshot = self.snapshot()
        if snapshot_id != snapshot["id"]:
            raise SnapshotConflictError("risk snapshot has changed; refresh before simulating")
        comparison = self.routes(origin_node_id, destination_node_id, travel_mode, snapshot_id)
        return compare_interventions(
            self.fixture.segments, self.reports.values(), self.fixture.weather,
            snapshot, comparison, self.fixture.drains, selected_route_id,
        )

    def set_report_status(self, report_id: str, status: str) -> Report:
        if status not in ("Accepted", "Rejected"):
            raise ValueError("review status must be Accepted or Rejected")
        if report_id not in self.reports:
            raise KeyError(report_id)
        updated = replace(self.reports[report_id], review_status=status)
        self.reports[report_id] = updated
        return updated

    def add_pending_report(self, report: Report) -> Report:
        if report.review_status != "Pending Review":
            raise ValueError("new reports must begin Pending Review")
        if report.segment_id not in {segment.id for segment in self.fixture.segments}:
            raise ValueError("report segment is outside the pilot")
        if report.id in self.reports:
            raise ValueError("report ID already exists")
        self.reports[report.id] = report
        return report

    def set_closure(self, segment_id: str, closed: bool) -> None:
        if segment_id not in {segment.id for segment in self.fixture.segments}:
            raise ValueError("closure segment is outside the pilot")
        if closed:
            self.closed_segment_ids.add(segment_id)
        else:
            self.closed_segment_ids.discard(segment_id)

    def run_fixture(self) -> dict[str, Any]:
        snapshot = self.snapshot()
        query = self.fixture.route_query
        routes = self.routes(
            query["originNodeId"], query["destinationNodeId"], query["travelMode"], snapshot["id"],
        )
        selected = routes["fastestRouteId"]
        if selected is None:
            raise RuntimeError("fixture has no route")
        interventions = self.interventions(
            query["originNodeId"], query["destinationNodeId"], query["travelMode"],
            snapshot["id"], selected,
        )
        return {
            "fixture": self.fixture.metadata, "snapshot": snapshot,
            "routes": routes, "interventions": interventions,
        }
