"""Transparent, deterministic ordinal road-risk scoring."""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from hashlib import sha256
import json
from typing import Any, Iterable

from .models import Report, Segment, WEATHER_MODES, unit_interval, utc_time


WEIGHTS = {"R": 0.35, "T": 0.25, "D": 0.20, "O": 0.20}
REPORT_MAX_AGE = timedelta(hours=2)
VERSION = "pilot-heuristic-v1"


def class_for(score: float | None) -> str:
    if score is None:
        return "Unknown"
    if score < 0.35:
        return "Low"
    if score < 0.60:
        return "Watch"
    return "High"


def _report_signal(report: Report) -> float | None:
    water = report.observations.get("visible_water")
    base = {"none": 0.0, "possible": 0.5, "clear": 0.9}.get(water)
    if base is None:
        return None
    return base * (report.model_confidence if report.model_confidence is not None else 1.0)


def _observations(
    segments: tuple[Segment, ...], reports: Iterable[Report], valid_at: str,
) -> tuple[dict[str, float], dict[str, list[str]]]:
    now = utc_time(valid_at)
    by_id = {segment.id: segment for segment in segments}
    at_node: dict[str, list[Segment]] = defaultdict(list)
    for segment in segments:
        at_node[segment.from_node].append(segment)
        at_node[segment.to_node].append(segment)
    signals: dict[str, float] = {}
    evidence: dict[str, list[str]] = defaultdict(list)
    for report in reports:
        if report.review_status != "Accepted" or report.segment_id not in by_id:
            continue
        captured = utc_time(report.captured_at or report.created_at)
        if captured > now or now - captured > REPORT_MAX_AGE:
            continue
        strength = _report_signal(report)
        if strength is None:
            continue
        target = by_id[report.segment_id]
        if strength > signals.get(target.id, -1):
            signals[target.id] = strength
        evidence[target.id].append(report.id)
        for node in (target.from_node, target.to_node):
            for neighbour in at_node[node]:
                if neighbour.id == target.id:
                    continue
                # Higher susceptibility means lower relative terrain in this pilot model.
                if (target.terrain_prior is None or neighbour.terrain_prior is None
                        or neighbour.terrain_prior <= target.terrain_prior):
                    continue
                attenuated = strength * 0.5
                if attenuated > signals.get(neighbour.id, -1):
                    signals[neighbour.id] = attenuated
                evidence[neighbour.id].append(report.id)
    return signals, evidence


def score_segments(
    segments: Iterable[Segment], weather: dict[str, Any] | None,
    reports: Iterable[Report] = (), *, valid_at: str,
    closed_segment_ids: Iterable[str] = (), bundle_version: str = "unknown",
) -> dict[str, Any]:
    """Return a reproducible snapshot; missing signals never become zero."""
    ordered = tuple(sorted(segments, key=lambda item: item.id))
    closed = set(closed_segment_ids)
    observation, evidence = _observations(ordered, reports, valid_at)
    rainfall: float | None = None
    mode = "Scenario"
    weather_stale = False
    if weather is not None:
        mode = weather.get("mode")
        if mode not in WEATHER_MODES:
            raise ValueError("weather mode must be Scenario or Live")
        if weather.get("validAt"):
            weather_stale = abs(utc_time(valid_at) - utc_time(weather["validAt"])) > REPORT_MAX_AGE
        amount = weather.get("precipitationMmH")
        if amount is not None:
            if isinstance(amount, bool) or not isinstance(amount, (int, float)) or amount < 0:
                raise ValueError("precipitationMmH must be nonnegative")
            rainfall = min(float(amount) / 30.0, 1.0)
    results = []
    for segment in ordered:
        features = {
            "R": rainfall, "T": segment.terrain_prior,
            "D": segment.drainage_vulnerability, "O": observation.get(segment.id),
        }
        for name, value in features.items():
            if value is not None:
                unit_interval(value, name)
        coverage = sum(weight for name, weight in WEIGHTS.items() if features[name] is not None)
        enough_context = rainfall is not None and (
            segment.terrain_prior is not None or segment.drainage_vulnerability is not None)
        score = None
        if enough_context:
            score = sum(WEIGHTS[name] * value for name, value in features.items() if value is not None) / coverage
        results.append({
            "segmentId": segment.id,
            "score": None if score is None else round(score, 6),
            "class": class_for(score),
            "coverage": round(coverage, 6),
            "confidence": "Low" if coverage < 0.80 or weather_stale else "Standard",
            "features": features,
            "missingFeatures": [name for name, value in features.items() if value is None],
            "evidenceIds": sorted(set(evidence.get(segment.id, []))),
            "isClosed": segment.id in closed,
            "roadStatus": "Closed" if segment.id in closed else class_for(score),
            "computedAt": valid_at,
            "modelVersion": VERSION,
        })
    digest = sha256(json.dumps(results, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:12]
    return {
        "id": f"{bundle_version}:{mode}:{valid_at}:{digest}", "bundleVersion": bundle_version,
        "mode": mode, "computedAt": valid_at, "modelVersion": VERSION,
        "weather": weather, "segments": results,
    }
