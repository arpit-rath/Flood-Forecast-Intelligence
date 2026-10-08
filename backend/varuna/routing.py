"""Fixture path generation and exposure-based route comparison."""

from __future__ import annotations

from collections import defaultdict
from heapq import heappop, heappush
from typing import Any, Iterable

from .models import Segment


SPEED_METERS_PER_MINUTE = {"Pedestrian": 80.0, "Scooter": 220.0, "Car": 350.0}


def candidate_paths(
    segments: Iterable[Segment], origin: str, destination: str,
    travel_mode: str, *, max_candidates: int = 12,
) -> list[dict[str, Any]]:
    """Enumerate the fastest simple paths on the small fixture graph."""
    if travel_mode not in SPEED_METERS_PER_MINUTE:
        raise ValueError("unsupported travel mode")
    ordered = tuple(segments)
    adjacency: dict[str, list[tuple[str, Segment]]] = defaultdict(list)
    for segment in ordered:
        adjacency[segment.from_node].append((segment.to_node, segment))
        adjacency[segment.to_node].append((segment.from_node, segment))
    if origin not in adjacency or destination not in adjacency:
        raise ValueError("origin or destination is outside the pilot graph")
    if origin == destination:
        raise ValueError("origin and destination must differ")
    for entries in adjacency.values():
        entries.sort(key=lambda item: item[1].id)
    speed = SPEED_METERS_PER_MINUTE[travel_mode]
    queue: list[tuple[float, tuple[str, ...], str, tuple[str, ...]]] = []
    heappush(queue, (0.0, (), origin, (origin,)))
    complete = []
    while queue and len(complete) < max_candidates:
        minutes, path, node, visited = heappop(queue)
        if node == destination:
            complete.append({"segmentIds": list(path), "travelMinutes": round(minutes, 6)})
            continue
        for next_node, segment in adjacency[node]:
            if next_node in visited:
                continue
            heappush(queue, (
                minutes + segment.length_m / speed,
                path + (segment.id,), next_node, visited + (next_node,),
            ))
    return complete


def route_exposure(
    segment_ids: Iterable[str], segments_by_id: dict[str, Segment],
    risks_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Score a path by assessed distance and expose its unknown share."""
    distance = assessed = weighted = 0.0
    classes: set[str] = set()
    blocked = False
    for segment_id in segment_ids:
        if segment_id not in segments_by_id:
            raise ValueError(f"unknown route segment: {segment_id}")
        segment = segments_by_id[segment_id]
        risk = risks_by_id[segment_id]
        distance += segment.length_m
        blocked = blocked or risk["isClosed"]
        if risk["score"] is not None:
            assessed += segment.length_m
            weighted += segment.length_m * risk["score"]
            classes.add(risk["class"])
    unknown_share = (distance - assessed) / distance if distance else 1.0
    return {
        "exposure": None if assessed == 0 else round(weighted / assessed, 6),
        "unknownShare": round(unknown_share, 6),
        "blocked": blocked,
        "highestClass": "High" if "High" in classes else "Watch" if "Watch" in classes else "Low" if classes else "Unknown",
        "distanceM": round(distance, 3),
    }


def compare_routes(
    segments: Iterable[Segment], snapshot: dict[str, Any], origin: str,
    destination: str, travel_mode: str, *, max_candidates: int = 12,
) -> dict[str, Any]:
    ordered = tuple(segments)
    by_id = {segment.id: segment for segment in ordered}
    risks = {risk["segmentId"]: risk for risk in snapshot["segments"]}
    paths = candidate_paths(ordered, origin, destination, travel_mode, max_candidates=max_candidates)
    candidates = []
    for index, path in enumerate(paths, start=1):
        candidate = {"id": f"R{index}", **path, **route_exposure(path["segmentIds"], by_id, risks)}
        candidate["provenance"] = "Synthetic fixture graph"
        candidates.append(candidate)
    viable = [candidate for candidate in candidates if not candidate["blocked"]]
    fastest = min(viable, key=lambda item: (item["travelMinutes"], item["id"])) if viable else None
    assessed = [candidate for candidate in viable if candidate["exposure"] is not None and candidate["unknownShare"] <= 0.2]
    lowest = min(assessed, key=lambda item: (item["exposure"], item["travelMinutes"], item["id"])) if assessed else None
    recommended = fastest
    reason = "No available route" if fastest is None else "Fastest route retained; no meaningful lower-exposure alternative"
    if fastest and lowest and fastest["exposure"] is not None and fastest["exposure"] - lowest["exposure"] >= 0.10:
        recommended = lowest
        reason = "Lower estimated exposure; compare the additional travel time"
    elif fastest and fastest["unknownShare"] > 0.2:
        reason = "Route has substantial unassessed distance; no lower-exposure claim"
    return {
        "snapshotId": snapshot["id"], "mode": snapshot["mode"],
        "originNodeId": origin, "destinationNodeId": destination, "travelMode": travel_mode,
        "fastestRouteId": fastest["id"] if fastest else None,
        "recommendedRouteId": recommended["id"] if recommended else None,
        "reason": reason, "candidates": candidates,
        "provenance": "Synthetic fixture graph",
    }
