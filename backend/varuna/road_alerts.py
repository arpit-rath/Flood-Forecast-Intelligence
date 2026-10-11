"""Source-backed road alerts for the limited OSM preview.

Normalization and candidate matching never change the synthetic Scenario service.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
from threading import RLock
from typing import Any, Callable, Protocol
from urllib.parse import urlsplit, urlunsplit

from .models import point
from .real_roads import RoadSnapshot


FRESH_HOURS = 24
SOURCE_POINT_METERS = 25.0
LANDMARK_METERS = 60.0
LANDMARK_ROAD_CONTEXT_METERS = 120.0
POINT_AMBIGUITY_METERS = 5.0
SOURCE_NAME = "Delhi Traffic Police"
SOURCE_HOME = "https://traffic.delhipolice.gov.in/en"
SOURCE_HOSTS = {"traffic.delhipolice.gov.in", "trafficupdates.delhipolice.gov.in"}
FLOOD_TERMS = re.compile(r"\b(flood(?:ing|ed)?|waterlogg(?:ed|ing)?|inundat(?:ed|ion))\b", re.I)


class AlertConflict(Exception):
    pass


def _url(value: Any, *, official: bool = False) -> str:
    if not isinstance(value, str) or len(value) > 500:
        raise ValueError("a bounded HTTPS source URL is required")
    parsed = urlsplit(value.strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("source URLs must be HTTPS without credentials or fragments")
    if official and parsed.hostname not in SOURCE_HOSTS:
        raise ValueError("canonical source URL must be an official Delhi Traffic Police page")
    return urlunsplit((parsed.scheme, parsed.netloc.lower(), parsed.path or "/", parsed.query, ""))


def _text(value: Any, field: str, maximum: int, *, required: bool = False) -> str | None:
    if value is None and not required:
        return None
    if not isinstance(value, str) or len(value.strip()) > maximum or (required and not value.strip()):
        raise ValueError(f"{field} must be {'nonempty and ' if required else ''}at most {maximum} characters")
    return value.strip() or None


def _instant(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except ValueError:
        return None


def _published(value: Any) -> tuple[str | None, str]:
    if value is None or value == "":
        return None, "missing"
    parsed = _instant(value)
    if parsed:
        return parsed.isoformat().replace("+00:00", "Z"), "datetime"
    if isinstance(value, str):
        for pattern in ("%Y-%m-%d", "%d-%b-%Y"):
            try:
                return datetime.strptime(value, pattern).date().isoformat(), "date"
            except ValueError:
                pass
    return None, "invalid"


def _validity(value: Any, *, until: bool) -> tuple[str | None, bool]:
    if value is None or value == "":
        return None, True
    parsed = _instant(value)
    if parsed:
        return parsed.isoformat().replace("+00:00", "Z"), True
    if isinstance(value, str):
        try:
            day = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            if until:
                day += timedelta(days=1)
            return day.isoformat().replace("+00:00", "Z"), True
        except ValueError:
            pass
    return None, False


def _normal(value: str) -> str:
    return " ".join(re.findall(r"[\w]+", value.casefold()))


@dataclass(frozen=True)
class RoadAlert:
    id: str
    sourceName: str
    canonicalSourceUrl: str
    advisoryUrl: str | None
    sourceIdentifier: str | None
    sourceType: str
    publishedAtText: str | None
    publishedAt: str | None
    publishedPrecision: str
    retrievedAt: str
    originalHeadline: str
    originalText: str
    statedCause: str | None
    affectedLocation: str | None
    validFromText: str | None
    validFrom: str | None
    validUntilText: str | None
    validUntil: str | None
    validityParseable: bool
    sourceAvailability: str
    sourceError: str | None
    locationHints: dict[str, Any]
    candidateRoads: list[dict[str, Any]]
    matchAmbiguity: str
    resolutionState: str


class RoadAlertSource(Protocol):
    def normalize(self, document: dict[str, Any], snapshot: RoadSnapshot) -> RoadAlert: ...


class RoadAlertRepository(Protocol):
    def import_alert(self, alert: RoadAlert) -> tuple[dict[str, Any], bool]: ...
    def put_ingested(self, item: dict[str, Any]) -> bool: ...
    def list(self) -> list[dict[str, Any]]: ...
    def get(self, alert_id: str) -> dict[str, Any] | None: ...
    def review(self, alert_id: str, expected_state: str, decision: dict[str, Any]) -> dict[str, Any]: ...
    def get_metadata(self, key: str) -> dict[str, Any] | None: ...
    def put_metadata(self, key: str, value: dict[str, Any]) -> None: ...


class RoadCandidateMatcher:
    """Deterministic proposals from a pinned OSM snapshot and reviewed local context.

    No retrieval or geocoding occurs here. Lower-priority evidence never overrides
    an ambiguous higher-priority match. No result modifies road condition.
    """

    def __init__(self, snapshot: RoadSnapshot, context: dict[str, Any] | None = None) -> None:
        self.snapshot = snapshot
        if context is None:
            root = Path(__file__).resolve().parents[2]
            path = root / "data/real_roads/alert-context.json"
            if not path.is_file():
                path = root / "frontend/src/data/alert-context.json"
            context = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {
                "version": "0", "geometryVersion": snapshot.version, "aliases": [], "landmarks": []}
        self.context = context
        if not isinstance(context, dict) or not isinstance(context.get("version"), str):
            raise ValueError("reviewed context needs a version")
        for kind in ("aliases", "landmarks"):
            if not isinstance(context.get(kind), list):
                raise ValueError(f"reviewed context {kind} must be a list")
            for entry in context[kind]:
                if not isinstance(entry, dict) or any(not isinstance(entry.get(field), str) or not entry[field]
                        for field in ("name", "source", "sourceUrl", "retrievedAt", "reviewedAt", "confidence")):
                    raise ValueError("every context entry needs a sourced review trail")
                _url(entry["sourceUrl"])
                if not _instant(entry["retrievedAt"]) or not _instant(entry["reviewedAt"]):
                    raise ValueError("context retrieval and review times must be UTC instants")
                if kind == "aliases" and entry.get("roadId") not in snapshot.roads:
                    raise ValueError("reviewed alias refers to a missing OSM way")
                if kind == "landmarks":
                    lon, lat = point(entry.get("point"))
                    west, south, east, north = snapshot.data["metadata"]["queryBbox"]
                    if not west <= lon <= east or not south <= lat <= north:
                        raise ValueError("reviewed landmark is outside the covered extract")
                    if not isinstance(entry.get("locality"), str) or not entry["locality"]:
                        raise ValueError("reviewed landmark needs a locality")

    def _candidate(self, road: dict[str, Any], method: str, evidence: list[str],
                   source: str, source_url: str, confidence: str, distance: float | None = None,
                   margin: float | None = None, landmark: str | None = None) -> dict[str, Any]:
        name = road.get("properties", {}).get("name")
        label = name if isinstance(name, str) and name.strip() else (
            f"Unnamed road near {landmark}" if landmark else f"Unnamed road · {road['id']}")
        return {"roadId": road["id"], "displayLabel": label, "method": method,
                "matchedEvidence": evidence, "distanceMeters": round(distance, 1) if distance is not None else None,
                "confidenceCategory": confidence, "ambiguityMarginMeters": round(margin, 1) if margin is not None else None,
                "sourceContext": {"source": source, "sourceUrl": source_url},
                "snapshotGeometryVersion": self.snapshot.version,
                "reason": method.replace("_", " "), "confidence": {"high": 0.85, "moderate": 0.65, "low": 0.4}[confidence]}

    def _result(self, proposals: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str]:
        unique = {candidate["roadId"]: candidate for candidate in proposals}
        candidates = [unique[key] for key in sorted(unique)]
        return candidates, ("matched_candidate" if len(candidates) == 1 else "ambiguous" if candidates else "unlocated")

    def _nearby(self, location: tuple[float, float], limit: float, method: str,
                evidence: list[str], source: str, source_url: str, confidence: str,
                landmark: str | None = None) -> list[dict[str, Any]]:
        west, south, east, north = self.snapshot.data["metadata"]["queryBbox"]
        ranked = sorted(((distance, road) for road in self.snapshot.roads.values()
                         for distance, snapped in [self.snapshot._distance(location, road)]
                         if west <= snapped[0] <= east and south <= snapped[1] <= north),
                        key=lambda item: (item[0], item[1]["id"]))
        within = [(distance, road) for distance, road in ranked if distance <= limit]
        if method == "source_coordinate" and within:
            # A point proposes the nearest way only when the second way is
            # separated by at least the reviewed geometry ambiguity threshold.
            if len(ranked) < 2 or ranked[1][0] - ranked[0][0] >= POINT_AMBIGUITY_METERS:
                within = within[:1]
            else:
                within = within[:2]
        return [self._candidate(road, method, evidence, source, source_url, confidence,
                                distance, (ranked[1][0] - ranked[0][0]) if len(ranked) > 1 else None, landmark)
                for distance, road in within]

    def candidates(self, hints: dict[str, Any], affected: str | None, headline: str = "",
                   original: str = "", source_url: str = "", published_at: str | None = None,
                   retrieved_at: str | None = None, stated_cause: str | None = None) -> tuple[list[dict[str, Any]], str]:
        def finish(proposals: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str]:
            for candidate in proposals:
                candidate["sourceContext"].update({"alertSourceUrl": source_url or None,
                                                   "publishedAt": published_at,
                                                   "retrievedAt": retrieved_at,
                                                   "statedCause": stated_cause})
            return self._result(proposals)

        if self.context.get("geometryVersion") != self.snapshot.version or (
                hints.get("geometryVersion") and hints["geometryVersion"] != self.snapshot.version):
            return [], "stale_snapshot"
        coordinate = hints.get("coordinates")
        if hints.get("invalidSourceLocation"):
            return [], "invalid_source_location"
        if coordinate is not None:
            lon, lat = coordinate
            west, south, east, north = self.snapshot.data["metadata"]["queryBbox"]
            if not west <= lon <= east or not south <= lat <= north:
                return [], "outside_coverage"

        wording = _normal(" ".join(filter(None, (affected, headline, original))))
        names = {_normal(value) for value in hints.get("roadNames", [])}
        refs = {_normal(value) for value in hints.get("roadReferences", [])}
        # Names supplied as an explicit intersection describe context, not
        # necessarily the road affected by the alert.
        intersection_names = {_normal(value) for value in hints.get("intersection", [])}
        def mentioned(value: str) -> bool:
            normalized = _normal(value)
            return bool(normalized and (normalized in names or (
                normalized not in intersection_names and len(normalized) >= 6
                and f" {normalized} " in f" {wording} ")))

        exact = []
        for road in self.snapshot.roads.values():
            properties = road.get("properties", {})
            name, ref = properties.get("name"), properties.get("ref")
            if isinstance(name, str) and mentioned(name):
                exact.append(self._candidate(road, "exact_osm_name", [name], "OpenStreetMap snapshot",
                                             self.snapshot.data["metadata"]["sourceUrl"], "high"))
            elif isinstance(ref, str) and _normal(ref) in refs:
                exact.append(self._candidate(road, "exact_osm_reference", [ref], "OpenStreetMap snapshot",
                                             self.snapshot.data["metadata"]["sourceUrl"], "high"))
        if exact:
            return finish(exact)

        aliases = []
        for entry in self.context["aliases"]:
            if mentioned(entry["name"]):
                aliases.append(self._candidate(self.snapshot.roads[entry["roadId"]], "reviewed_alias", [entry["name"]],
                                               entry["source"], entry["sourceUrl"],
                                               "moderate" if entry["confidence"] == "reviewed" else "low"))
        if aliases:
            return finish(aliases)

        intersection = hints.get("intersection") or []
        if len(intersection) == 2:
            ways = [[road for road in self.snapshot.roads.values()
                     if _normal(road.get("properties", {}).get("name") or "") == _normal(name)]
                    for name in intersection]
            shared = set()
            for first in ways[0]:
                for second in ways[1]:
                    if first["id"] == second["id"]:
                        continue
                    nodes = {tuple(node) for node in first["geometry"]["coordinates"]} & {
                        tuple(node) for node in second["geometry"]["coordinates"]}
                    shared.update(nodes)
            if shared:
                unnamed = [road for road in self.snapshot.roads.values() if not road.get("properties", {}).get("name")
                           and any(tuple(node) in shared for node in road["geometry"]["coordinates"])]
                selected = unnamed or {road["id"]: road for group in ways for road in group}.values()
                return finish([self._candidate(road, "named_intersection", intersection,
                                               "OpenStreetMap snapshot", self.snapshot.data["metadata"]["sourceUrl"], "moderate")
                               for road in selected])

        contextual_landmarks = []
        proximity_landmarks = []
        mentioned_landmarks = {_normal(value) for value in hints.get("landmarks", [])}
        localities = {_normal(value) for value in hints.get("localities", [])}
        near_road_names = {_normal(value): value for value in hints.get("nearRoadNames", [])}
        for entry in self.context["landmarks"]:
            landmark_name = _normal(entry["name"])
            if landmark_name not in mentioned_landmarks and not (
                    len(landmark_name) >= 6 and f" {landmark_name} " in f" {wording} "):
                continue
            locality = _normal(entry["locality"])
            locality_match = locality in localities or bool(locality and f" {locality} " in f" {wording} ")
            near_road = next((given for normalized, given in near_road_names.items()
                              if any(_normal(road.get("properties", {}).get("name") or "") == normalized
                                     and self.snapshot._distance(point(entry["point"]), road)[0] <= LANDMARK_ROAD_CONTEXT_METERS
                                     for road in self.snapshot.roads.values())), None)
            contextual = locality_match or near_road is not None
            method = "landmark_locality" if locality_match else "landmark_road_context" if near_road else "nearby_landmark_geometry"
            target = contextual_landmarks if contextual else proximity_landmarks
            confidence = "moderate" if contextual and entry["confidence"] == "reviewed_precise_point" else "low"
            target.extend(self._nearby(point(entry["point"]), LANDMARK_METERS, method,
                                       [entry["name"], *([entry["locality"]] if locality_match else []),
                                        *([near_road] if near_road else [])],
                                       entry["source"], entry["sourceUrl"],
                                       confidence, entry.get("displayName", entry["name"])))
        if contextual_landmarks:
            return finish(contextual_landmarks)

        if coordinate is not None:
            nearby = self._nearby(tuple(coordinate), SOURCE_POINT_METERS, "source_coordinate",
                                  [f"{coordinate[0]}, {coordinate[1]}"], "Source-linked coordinate",
                                  hints["coordinateSourceUrl"], "moderate")
            if nearby:
                return finish(nearby)
        if proximity_landmarks:
            return finish(proximity_landmarks)
        return [], "unlocated"


class DelhiTrafficPoliceAdapter:
    def normalize(self, document: dict[str, Any], snapshot: RoadSnapshot) -> RoadAlert:
        if not isinstance(document, dict):
            raise ValueError("source document must be an object")
        canonical = _url(document.get("canonicalSourceUrl"), official=True)
        linked = _url(document["advisoryUrl"]) if document.get("advisoryUrl") else None
        identifier = _text(document.get("sourceIdentifier"), "sourceIdentifier", 160)
        if not linked and not identifier:
            raise ValueError("source identifier or linked advisory URL is required for deduplication")
        source_type = document.get("sourceType")
        if source_type not in ("traffic_alert", "traffic_advisory"):
            raise ValueError("sourceType must be traffic_alert or traffic_advisory")
        retrieved = _instant(document.get("retrievedAt"))
        if not retrieved or retrieved > datetime.now(timezone.utc) + timedelta(minutes=1):
            raise ValueError("retrievedAt must be a valid, nonfuture UTC timestamp")
        published_text = _text(document.get("publishedAtText"), "publishedAtText", 100)
        published, precision = _published(published_text)
        valid_from_text = _text(document.get("validFromText"), "validFromText", 100)
        valid_until_text = _text(document.get("validUntilText"), "validUntilText", 100)
        valid_from, from_valid = _validity(valid_from_text, until=False)
        valid_until, until_valid = _validity(valid_until_text, until=True)
        headline = _text(document.get("originalHeadline"), "originalHeadline", 200, required=True)
        original = _text(document.get("originalText"), "originalText", 2000, required=True)
        cause = _text(document.get("statedCause"), "statedCause", 160)
        affected = _text(document.get("affectedLocation"), "affectedLocation", 200)
        availability = document.get("sourceAvailability")
        if availability not in ("available", "unavailable", "error"):
            raise ValueError("sourceAvailability must be available, unavailable or error")
        source_error = _text(document.get("sourceError"), "sourceError", 300)
        hints = document.get("locationHints") or {}
        if not isinstance(hints, dict):
            raise ValueError("locationHints must be an object")
        cleaned: dict[str, Any] = {}
        for field in ("roadNames", "roadReferences", "nearRoadNames", "landmarks", "localities", "intersection"):
            values = hints.get(field, [])
            if not isinstance(values, list) or len(values) > 8 or any(not isinstance(value, str) or not 0 < len(value.strip()) <= 120 for value in values):
                raise ValueError(f"{field} must contain at most eight bounded names")
            cleaned[field] = [value.strip() for value in values]
        if len(cleaned["intersection"]) not in (0, 2):
            raise ValueError("intersection must name exactly two roads")
        if hints.get("geometryVersion") is not None:
            cleaned["geometryVersion"] = _text(hints["geometryVersion"], "geometryVersion", 100, required=True)
        if hints.get("coordinates") is not None:
            coordinate_source = _url(hints.get("coordinateSourceUrl"))
            if coordinate_source not in (canonical, linked):
                raise ValueError("coordinates require the canonical or linked source URL")
            cleaned["coordinateSourceUrl"] = coordinate_source
            try:
                cleaned["coordinates"] = list(point(hints["coordinates"]))
            except ValueError:
                cleaned["invalidSourceLocation"] = True
        candidates, resolution = RoadCandidateMatcher(snapshot).candidates(
            cleaned, affected, headline, original, linked or canonical, published,
            retrieved.isoformat().replace("+00:00", "Z"), cause)
        ambiguity = {"matched_candidate": "unique_candidate", "ambiguous": "multiple_candidates"}.get(resolution, "unlocated")
        key = linked or identifier
        alert_id = "RA-" + sha256(f"{SOURCE_NAME}\n{key}".encode()).hexdigest()[:32]
        return RoadAlert(alert_id, SOURCE_NAME, canonical, linked, identifier, source_type,
                         published_text, published, precision, retrieved.isoformat().replace("+00:00", "Z"),
                         headline, original, cause, affected, valid_from_text, valid_from,
                         valid_until_text, valid_until, from_valid and until_valid, availability,
                         source_error, cleaned, candidates, ambiguity, resolution)


class MemoryRoadAlertStore:
    def __init__(self) -> None:
        self.items: dict[str, dict[str, Any]] = {}
        self.metadata: dict[str, dict[str, Any]] = {}
        self.lock = RLock()

    def import_alert(self, alert: RoadAlert) -> tuple[dict[str, Any], bool]:
        incoming = {**asdict(alert), "reviewState": "Imported", "reviewHistory": [], "matchedRoadId": None}
        with self.lock:
            existing = self.items.get(alert.id)
            if existing:
                if {key: existing[key] for key in asdict(alert)} != asdict(alert):
                    raise AlertConflict("source identifier already has different content; review an explicit update")
                return dict(existing), False
            self.items[alert.id] = incoming
            return dict(incoming), True

    def list(self) -> list[dict[str, Any]]:
        with self.lock:
            return [dict(item) for item in self.items.values()]

    def put_ingested(self, item: dict[str, Any]) -> bool:
        with self.lock:
            if item["id"] in self.items:
                return False
            self.items[item["id"]] = dict(item)
            return True

    def get_metadata(self, key: str) -> dict[str, Any] | None:
        with self.lock:
            value = self.metadata.get(key)
            return dict(value) if value else None

    def put_metadata(self, key: str, value: dict[str, Any]) -> None:
        with self.lock:
            self.metadata[key] = dict(value)

    def get(self, alert_id: str) -> dict[str, Any] | None:
        with self.lock:
            item = self.items.get(alert_id)
            return dict(item) if item else None

    def review(self, alert_id: str, expected_state: str, decision: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            item = self.items.get(alert_id)
            if not item:
                raise KeyError(alert_id)
            if item["reviewState"] != expected_state:
                raise AlertConflict("alert review state changed; reload before deciding")
            updated = {**item, "reviewState": decision["state"],
                       "matchedRoadId": decision.get("roadId", item["matchedRoadId"]),
                       "reviewHistory": [*item["reviewHistory"], decision]}
            self.items[alert_id] = updated
            return dict(updated)


class RoadAlertWorkflow:
    def __init__(self, snapshot: RoadSnapshot, store: RoadAlertRepository,
                 source: RoadAlertSource | None = None, clock: Callable[[], datetime] | None = None) -> None:
        self.snapshot, self.store = snapshot, store
        self.source = source or DelhiTrafficPoliceAdapter()
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    def import_document(self, document: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        alert = self.source.normalize(document, self.snapshot)
        item, created = self.store.import_alert(alert)
        return self.private(item), created

    def ingest_document(self, document: dict[str, Any], content_hash: str,
                        parser_version: str, fetched_at: str) -> tuple[dict[str, Any], bool]:
        """Insert one immutable source revision; manual import semantics stay unchanged."""
        if not re.fullmatch(r"[0-9a-f]{64}", content_hash):
            raise ValueError("content hash must be SHA-256 hex")
        alert = self.source.normalize(document, self.snapshot)
        revision_id = "RA-" + sha256(f"{alert.canonicalSourceUrl}\n{content_hash}".encode()).hexdigest()[:32]
        item = {**asdict(alert), "id": revision_id, "reviewState": "Imported", "reviewHistory": [],
                "matchedRoadId": None, "contentSha256": content_hash,
                "parserVersion": parser_version, "fetchedAt": fetched_at,
                "sourceAlertIdentifier": document.get("sourceIdentifier")}
        created = self.store.put_ingested(item)
        return self.private(self.store.get(revision_id)), created

    def source_status(self) -> dict[str, Any] | None:
        status = self.store.get_metadata("source-status")
        if not status:
            return None
        return {key: status.get(key) for key in ("state", "lastCheckedAt", "lastSuccessfulAt", "message")}

    def freshness(self, item: dict[str, Any]) -> str:
        now = self.clock()
        if item["sourceAvailability"] != "available":
            return "Unavailable"
        if item["publishedPrecision"] != "datetime" or not item["validityParseable"]:
            return "Unverified time"
        published = _instant(item["publishedAt"])
        retrieved = _instant(item["retrievedAt"])
        if not published or not retrieved or published > now or retrieved > now:
            return "Unverified time"
        if now - published > timedelta(hours=FRESH_HOURS) or now - retrieved > timedelta(hours=FRESH_HOURS):
            return "Expired"
        if item["validFrom"] and now < _instant(item["validFrom"]):
            return "Not yet valid"
        if item["validUntil"] and now >= _instant(item["validUntil"]):
            return "Expired"
        return "Current"

    def state(self, item: dict[str, Any]) -> str:
        freshness = self.freshness(item)
        if freshness == "Expired":
            return "Expired"
        if freshness != "Current" and item["reviewState"] == "Confirmed Flood Blockage":
            return "Reported / Unverified"
        return "Reported / Unverified" if item["reviewState"] == "Imported" else item["reviewState"]

    def public(self, item: dict[str, Any]) -> dict[str, Any]:
        state = self.state(item)
        latest = item["reviewHistory"][-1] if item["reviewHistory"] else None
        proposal = None
        if (item["reviewState"] == "Imported" and self.freshness(item) == "Current"
                and item["resolutionState"] == "matched_candidate" and len(item["candidateRoads"]) == 1):
            candidate = item["candidateRoads"][0]
            method = candidate["method"]
            if method == "source_coordinate":
                explanation = f"Source-linked point is {candidate['distanceMeters']} m from the mapped way; geometry is not a condition report"
            elif method in ("landmark_locality", "landmark_road_context", "nearby_landmark_geometry"):
                explanation = f"Reviewed landmark context: {', '.join(candidate['matchedEvidence'])}; mapped way is {candidate['distanceMeters']} m from its published point"
            else:
                explanation = f"{candidate['reason']}: {', '.join(candidate['matchedEvidence'])}"
            # Public summary deliberately omits road ID, internal evidence,
            # reviewer identity and the source-document text.
            proposal = {"displayLabel": candidate["displayLabel"], "method": candidate["method"],
                        "confidenceCategory": candidate["confidenceCategory"],
                        "explanation": explanation}
        return {"id": item["id"], "sourceName": item["sourceName"],
                "canonicalSourceUrl": item["canonicalSourceUrl"], "advisoryUrl": item["advisoryUrl"],
                "sourceType": item["sourceType"], "publishedAtText": item["publishedAtText"],
                "publishedAt": item["publishedAt"], "publishedPrecision": item["publishedPrecision"],
                "retrievedAt": item["retrievedAt"], "originalHeadline": item["originalHeadline"],
                "statedCause": item["statedCause"],
                "affectedLocation": item["affectedLocation"], "validFromText": item["validFromText"],
                "validUntilText": item["validUntilText"], "sourceAvailability": item["sourceAvailability"],
                "freshness": self.freshness(item), "state": state,
                "resolutionState": item["resolutionState"], "proposal": proposal,
                "matchedRoadId": item["matchedRoadId"] if state in ("Confirmed Flood Blockage", "Cleared") else None,
                "reviewedAt": latest["reviewedAt"] if latest and state in ("Confirmed Flood Blockage", "Cleared") else None}

    def private(self, item: dict[str, Any]) -> dict[str, Any]:
        return {**self.public(item), **item, "freshness": self.freshness(item), "state": self.state(item)}

    def public_list(self) -> list[dict[str, Any]]:
        return sorted((self.public(item) for item in self.store.list()), key=lambda item: item["retrievedAt"], reverse=True)

    def private_list(self) -> list[dict[str, Any]]:
        return sorted((self.private(item) for item in self.store.list()), key=lambda item: item["retrievedAt"], reverse=True)

    def detail(self, alert_id: str) -> dict[str, Any]:
        item = self.store.get(alert_id)
        if not item:
            raise KeyError(alert_id)
        return self.private(item)

    def review(self, alert_id: str, body: dict[str, Any], reviewer: str) -> dict[str, Any]:
        if not isinstance(body, dict):
            raise ValueError("review body must be an object")
        item = self.store.get(alert_id)
        if not item:
            raise KeyError(alert_id)
        decision = body.get("decision")
        if decision not in ("confirm_flood_blockage", "clear", "reject"):
            raise ValueError("decision must be confirm_flood_blockage, clear or reject")
        reason = _text(body.get("reason"), "review reason", 500, required=True)
        if len(reason) < 10:
            raise ValueError("review reason must have at least 10 characters")
        if decision == "confirm_flood_blockage":
            if item["reviewState"] != "Imported" or self.freshness(item) != "Current":
                raise AlertConflict("only a current unreviewed source alert can establish a blockage")
            if item["resolutionState"] in ("stale_snapshot", "outside_coverage", "invalid_source_location"):
                raise AlertConflict("source location or road snapshot must be re-reviewed before confirmation")
            if (not item["statedCause"] or not FLOOD_TERMS.search(item["statedCause"])
                    or not FLOOD_TERMS.search(item["originalHeadline"] + " " + item["originalText"])):
                raise ValueError("source does not state a flood-related cause")
            reference = body.get("road")
            if not isinstance(reference, dict) or reference.get("roadId") not in {candidate["roadId"] for candidate in item["candidateRoads"]}:
                raise ValueError("reviewed road must be an existing source-match candidate")
            road_id, _ = self.snapshot.match(reference)
            state = "Confirmed Flood Blockage"
        elif decision == "clear":
            if item["reviewState"] != "Confirmed Flood Blockage":
                raise AlertConflict("only a confirmed blockage can be cleared")
            road_id, state = item["matchedRoadId"], "Cleared"
        else:
            if item["reviewState"] != "Imported":
                raise AlertConflict("only an unreviewed alert can be rejected")
            road_id, state = None, "Rejected"
        reviewed_at = self.clock().isoformat().replace("+00:00", "Z")
        updated = self.store.review(alert_id, item["reviewState"], {"decision": decision, "state": state,
                                    "roadId": road_id, "reviewerSub": reviewer, "reviewedAt": reviewed_at,
                                    "reason": reason})
        return self.private(updated)

    def route_eligible(self, road_id: str) -> bool:
        if road_id not in self.snapshot.roads:
            raise ValueError("road is outside the limited OSM coverage")
        return not any(item["matchedRoadId"] == road_id and self.state(item) == "Confirmed Flood Blockage"
                       for item in self.store.list())
