"""Validated domain records shared by the fixture engine and API."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
from math import asin, cos, radians, sin, sqrt
from typing import Any


RISK_CLASSES = ("Low", "Watch", "High", "Unknown")
REPORT_STATES = ("Pending Review", "Accepted", "Rejected", "Needs Manual Review")
WEATHER_MODES = ("Scenario", "Live")


def utc_time(value: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError("timestamp must be an ISO 8601 string")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include a timezone")
    return parsed.astimezone(timezone.utc)


def unit_interval(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number")
    number = float(value)
    if not 0 <= number <= 1:
        raise ValueError(f"{name} must be between 0 and 1")
    return number


def point(value: Any) -> tuple[float, float]:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError("point must be [longitude, latitude]")
    lon, lat = value
    if any(isinstance(item, bool) or not isinstance(item, (int, float)) for item in (lon, lat)):
        raise ValueError("point coordinates must be numeric")
    if not -180 <= lon <= 180 or not -90 <= lat <= 90:
        raise ValueError("point is outside WGS84 bounds")
    return float(lon), float(lat)


def distance_meters(start: tuple[float, float], end: tuple[float, float]) -> float:
    """Great-circle distance; never subtract WGS84 degrees as metres."""
    lon1, lat1 = map(radians, start)
    lon2, lat2 = map(radians, end)
    a = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 6371000 * 2 * asin(sqrt(a))


@dataclass(frozen=True)
class Segment:
    id: str
    geometry: tuple[tuple[float, float], tuple[float, float]]
    from_node: str
    to_node: str
    length_m: float
    terrain_prior: float | None
    drainage_vulnerability: float | None
    source: str
    bundle_version: str

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "Segment":
        if not isinstance(raw, dict):
            raise ValueError("segment must be an object")
        geometry = raw.get("geometry")
        if not isinstance(geometry, list) or len(geometry) != 2:
            raise ValueError("segment geometry must have two points")
        coords = point(geometry[0]), point(geometry[1])
        length = raw.get("lengthM")
        if isinstance(length, bool) or not isinstance(length, (int, float)) or length <= 0:
            raise ValueError("segment lengthM must be positive")
        required = ("id", "fromNode", "toNode", "source", "bundleVersion")
        if any(not isinstance(raw.get(key), str) or not raw[key] for key in required):
            raise ValueError("segment string fields are required")
        if raw["fromNode"] == raw["toNode"]:
            raise ValueError("segment endpoints must differ")
        terrain = raw.get("terrainPrior")
        drainage = raw.get("drainageVulnerability")
        return cls(
            id=raw["id"], geometry=coords, from_node=raw["fromNode"], to_node=raw["toNode"],
            length_m=float(length),
            terrain_prior=None if terrain is None else unit_interval(terrain, "terrainPrior"),
            drainage_vulnerability=None if drainage is None else unit_interval(drainage, "drainageVulnerability"),
            source=raw["source"], bundle_version=raw["bundleVersion"],
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "geometry": [list(p) for p in self.geometry], "fromNode": self.from_node,
            "toNode": self.to_node, "lengthM": self.length_m, "terrainPrior": self.terrain_prior,
            "drainageVulnerability": self.drainage_vulnerability, "source": self.source,
            "bundleVersion": self.bundle_version,
        }

    def with_drainage(self, value: float) -> "Segment":
        return replace(self, drainage_vulnerability=unit_interval(value, "drainageVulnerability"))


@dataclass(frozen=True)
class Report:
    id: str
    segment_id: str
    point: tuple[float, float]
    created_at: str
    captured_at: str | None
    image_key: str
    review_status: str
    observations: dict[str, Any]
    model_confidence: float | None
    source: str

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "Report":
        if not isinstance(raw, dict):
            raise ValueError("report must be an object")
        for key in ("id", "segmentId", "createdAt", "imageKey", "reviewStatus", "source"):
            if not isinstance(raw.get(key), str) or not raw[key]:
                raise ValueError(f"report {key} is required")
        if raw["reviewStatus"] not in REPORT_STATES:
            raise ValueError("invalid report reviewStatus")
        utc_time(raw["createdAt"])
        if raw.get("capturedAt") is not None:
            utc_time(raw["capturedAt"])
        observations = raw.get("observations")
        if not isinstance(observations, dict):
            raise ValueError("report observations must be an object")
        confidence = raw.get("modelConfidence")
        if confidence is not None:
            confidence = unit_interval(confidence, "modelConfidence")
        return cls(
            id=raw["id"], segment_id=raw["segmentId"], point=point(raw.get("point")),
            created_at=raw["createdAt"], captured_at=raw.get("capturedAt"), image_key=raw["imageKey"],
            review_status=raw["reviewStatus"], observations=observations,
            model_confidence=confidence, source=raw["source"],
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "segmentId": self.segment_id, "point": list(self.point),
            "createdAt": self.created_at, "capturedAt": self.captured_at, "imageKey": self.image_key,
            "reviewStatus": self.review_status, "observations": self.observations,
            "modelConfidence": self.model_confidence, "source": self.source,
        }
