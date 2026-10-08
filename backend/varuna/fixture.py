"""Load one explicitly synthetic, deterministic demonstration scenario."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .models import Report, Segment, distance_meters


DEFAULT_FIXTURE = Path(__file__).resolve().parents[2] / "data" / "fixture" / "scenario.json"


@dataclass(frozen=True)
class Fixture:
    metadata: dict[str, Any]
    segments: tuple[Segment, ...]
    reports: tuple[Report, ...]
    drains: tuple[dict[str, Any], ...]
    weather: dict[str, Any]
    route_query: dict[str, str]


def load_fixture(path: Path = DEFAULT_FIXTURE) -> Fixture:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("mode") != "Scenario" or raw["weather"].get("mode") != "Scenario":
        raise ValueError("fixture must be explicitly labelled Scenario")
    grid = raw["grid"]
    rows, columns = grid["rows"], grid["columns"]
    if not 2 <= rows <= 20 or not 2 <= columns <= 20:
        raise ValueError("fixture grid dimensions are invalid")
    terrain = grid["terrainSusceptibility"]
    if len(terrain) != rows or any(len(row) != columns for row in terrain):
        raise ValueError("terrain grid does not match dimensions")
    southwest = grid["southWest"]
    nodes = {
        f"N-{r}-{c}": (
            southwest[0] + c * grid["stepLongitude"],
            southwest[1] + r * grid["stepLatitude"],
        )
        for r in range(rows) for c in range(columns)
    }
    segments: list[Segment] = []
    for r in range(rows):
        for c in range(columns):
            for direction, end_r, end_c in (("H", r, c + 1), ("V", r + 1, c)):
                if end_r >= rows or end_c >= columns:
                    continue
                segment_id = f"{direction}-{r}-{c}"
                start_node, end_node = f"N-{r}-{c}", f"N-{end_r}-{end_c}"
                geometry = [list(nodes[start_node]), list(nodes[end_node])]
                segments.append(Segment.from_dict({
                    "id": segment_id, "geometry": geometry, "fromNode": start_node, "toNode": end_node,
                    "lengthM": distance_meters(nodes[start_node], nodes[end_node]),
                    "terrainPrior": (terrain[r][c] + terrain[end_r][end_c]) / 2,
                    "drainageVulnerability": raw["drainageOverrides"].get(
                        segment_id, raw["defaultDrainageVulnerability"]),
                    "source": "Synthetic fixture", "bundleVersion": raw["bundleVersion"],
                }))
    ids = {segment.id for segment in segments}
    drains = tuple(raw["drains"])
    for drain in drains:
        if not set(drain["affectedSegmentIds"]) <= ids:
            raise ValueError("drain references an unknown segment")
    reports = tuple(Report.from_dict(item) for item in raw["reports"])
    if any(report.segment_id not in ids for report in reports):
        raise ValueError("report references an unknown segment")
    query = raw["routeQuery"]
    if query["originNodeId"] not in nodes or query["destinationNodeId"] not in nodes:
        raise ValueError("route query references an unknown node")
    return Fixture(
        metadata={key: raw[key] for key in ("id", "bundleVersion", "mode", "label", "source", "validAt")},
        segments=tuple(segments), reports=reports, drains=drains,
        weather=raw["weather"], route_query=query,
    )
