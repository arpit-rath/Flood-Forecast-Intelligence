"""Compare two bounded drainage assumptions without mutating the baseline."""

from __future__ import annotations

from typing import Any, Iterable

from .models import Report, Segment, unit_interval
from .risk import score_segments
from .routing import route_exposure


def compare_interventions(
    segments: Iterable[Segment], reports: Iterable[Report], weather: dict[str, Any],
    baseline: dict[str, Any], route_comparison: dict[str, Any],
    drains: Iterable[dict[str, Any]], selected_route_id: str,
) -> dict[str, Any]:
    original = tuple(segments)
    by_id = {segment.id: segment for segment in original}
    route = next((item for item in route_comparison["candidates"] if item["id"] == selected_route_id), None)
    if route is None:
        raise ValueError("selected route does not exist")
    if route_comparison["snapshotId"] != baseline["id"]:
        raise ValueError("route and baseline snapshots differ")
    drain_list = tuple(drains)
    if len(drain_list) != 2 or len({item["id"] for item in drain_list}) != 2:
        raise ValueError("exactly two distinct drains are required")
    baseline_risks = {item["segmentId"]: item for item in baseline["segments"]}
    before_route = route_exposure(route["segmentIds"], by_id, baseline_risks)
    results = []
    for drain in drain_list:
        affected = set(drain["affectedSegmentIds"])
        if not affected or not affected <= by_id.keys():
            raise ValueError("drain must reference known segments")
        reduction = unit_interval(drain["drainageReduction"], "drainageReduction")
        changed = tuple(
            segment.with_drainage(max(0.0, segment.drainage_vulnerability - reduction))
            if segment.id in affected and segment.drainage_vulnerability is not None else segment
            for segment in original
        )
        simulated = score_segments(
            changed, weather, reports, valid_at=baseline["computedAt"],
            closed_segment_ids=[key for key, value in baseline_risks.items() if value["isClosed"]],
            bundle_version=baseline["bundleVersion"],
        )
        simulated_risks = {item["segmentId"]: item for item in simulated["segments"]}
        after_route = route_exposure(route["segmentIds"], by_id, simulated_risks)
        before_exposure, after_exposure = before_route["exposure"], after_route["exposure"]
        reduction_in_exposure = 0.0 if before_exposure is None or after_exposure is None else max(0.0, before_exposure - after_exposure)
        moved_out_of_high = sum(
            baseline_risks[key]["class"] == "High" and simulated_risks[key]["class"] != "High"
            for key in affected
        )
        results.append({
            "id": f"{baseline['id']}:{drain['id']}", "drainId": drain["id"],
            "label": drain["label"], "simulated": True, "mode": baseline["mode"],
            "affectedSegmentIds": sorted(affected),
            "assumptions": {"drainageReduction": reduction, "source": "Synthetic fixture; not a physical flood model"},
            "routeExposureBefore": before_exposure,
            "routeExposureAfter": after_exposure,
            "routeExposureReduction": round(reduction_in_exposure, 6),
            "segmentsMovedOutOfHigh": moved_out_of_high,
            "segments": [
                {"segmentId": key, "before": baseline_risks[key]["class"],
                 "after": simulated_risks[key]["class"],
                 "scoreBefore": baseline_risks[key]["score"], "scoreAfter": simulated_risks[key]["score"]}
                for key in sorted(affected)
            ],
        })
    results.sort(key=lambda item: (-item["routeExposureReduction"], -item["segmentsMovedOutOfHigh"], item["drainId"]))
    for rank, result in enumerate(results, start=1):
        result["rank"] = rank
    return {
        "baselineSnapshotId": baseline["id"], "selectedRouteId": selected_route_id,
        "simulated": True, "mode": baseline["mode"],
        "hasEstimatedBenefit": any(item["routeExposureReduction"] > 0 or item["segmentsMovedOutOfHigh"] > 0 for item in results),
        "rankingRule": "Selected-route exposure reduction, then count of segments leaving High, then drain ID",
        "results": results,
    }
