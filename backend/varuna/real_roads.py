"""Versioned, limited-coverage OSM photo evidence; independent of Scenario risk."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from hashlib import sha256
from hmac import compare_digest
import json
from math import cos, radians, sqrt
from pathlib import Path
import re
import secrets
from threading import RLock
from typing import Any

from .models import point, utc_time
from .reporting import (
    MAX_BYTES, MIME_FORMAT, DynamoReportStore, MemoryReportStore, PhotoMissing,
    ReportConflict, _active, _conditional_failure, _digest, _now, sanitize_photo,
)

MATCH_METERS = 12.0
AMBIGUITY_METERS = 5.0
EVIDENCE_HOURS = 24
MAX_UPLOADS_PER_DAY = 10
REPORT_DAYS = 7
ANONYMOUS_TOKEN_MINUTES = 5


class UploadLimit(Exception):
    pass


class SubmissionUnavailable(Exception):
    pass


class MemoryRealRoadStore(MemoryReportStore):
    def __init__(self) -> None:
        super().__init__()
        self.grants: dict[tuple[str, str], int] = {}
        self.anonymous_grants: dict[str, int] = {}
        self.pending_uploads: dict[str, dict[str, Any]] = {}

    def consume_upload(self, owner: str) -> None:
        day = datetime.now(timezone.utc).date().isoformat()
        with self.lock:
            key = (owner, day)
            if self.grants.get(key, 0) >= MAX_UPLOADS_PER_DAY:
                raise UploadLimit("daily upload-request limit reached")
            self.grants[key] = self.grants.get(key, 0) + 1

    def reserve_anonymous(self, token_hash: str, binding: dict[str, Any], limit: int, expiry: int) -> None:
        day = datetime.now(timezone.utc).date().isoformat()
        with self.lock:
            if self.anonymous_grants.get(day, 0) >= limit:
                raise UploadLimit("anonymous daily upload-request limit reached")
            self.anonymous_grants[day] = self.anonymous_grants.get(day, 0) + 1
            self.pending_uploads[token_hash] = {"status": "pending", "expiresAtEpoch": expiry, **binding}

    def get_pending(self, token_hash: str) -> dict[str, Any] | None:
        with self.lock:
            item = self.pending_uploads.get(token_hash)
            return dict(item) if item and item["expiresAtEpoch"] > int(datetime.now(timezone.utc).timestamp()) else None

    def commit_anonymous(self, token_hash: str, report: dict[str, Any], fingerprint: str) -> dict[str, Any]:
        with self.lock:
            pending = self.get_pending(token_hash)
            if not pending:
                raise SubmissionUnavailable("submission expired or unavailable; request a new upload")
            if pending["status"] == "consumed":
                existing = self.get(report["id"])
                if existing and compare_digest(pending.get("fingerprint", ""), fingerprint):
                    return existing
                raise SubmissionUnavailable("submission token has already been used")
            if report["id"] in self.items:
                raise SubmissionUnavailable("submission token has already been used")
            saved = {**report, "requestFingerprint": fingerprint}
            self.items[report["id"]] = saved
            self.pending_uploads[token_hash] = {**pending, "status": "consumed", "fingerprint": fingerprint}
            return dict(saved)


class DynamoRealRoadStore(DynamoReportStore):
    """Resource-backed table/client calls accept native Python AttributeValues."""

    def list(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        args: dict[str, Any] = {"ConsistentRead": True, "Limit": 100}
        while True:
            page = self.table.scan(**args)
            items.extend(payload for item in page.get("Items", []) if item.get("id", "").startswith("RR-")
                         and "payload" in item and _active(payload := json.loads(item["payload"])))
            if len(items) > 1000:
                raise RuntimeError("real-road report listing exceeds configured limit")
            if "LastEvaluatedKey" not in page:
                return items
            args["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    def consume_upload(self, owner: str) -> None:
        now = datetime.now(timezone.utc)
        tomorrow = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), timezone.utc)
        key = "Q#" + sha256(owner.encode()).hexdigest() + "#" + now.date().isoformat()
        try:
            self.table.update_item(
                Key={"id": key},
                UpdateExpression="SET expiresAtEpoch = :expiry ADD #count :one",
                ConditionExpression="attribute_not_exists(#count) OR #count < :limit",
                ExpressionAttributeNames={"#count": "uploadCount"},
                ExpressionAttributeValues={":one": 1, ":limit": MAX_UPLOADS_PER_DAY, ":expiry": int(tomorrow.timestamp())},
            )
        except Exception as exc:
            if _conditional_failure(exc):
                raise UploadLimit("daily upload-request limit reached") from exc
            raise

    def reserve_anonymous(self, token_hash: str, binding: dict[str, Any], limit: int, expiry: int) -> None:
        now = datetime.now(timezone.utc)
        tomorrow = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), timezone.utc)
        quota_id = "AQ#" + now.date().isoformat()
        pending = {"id": "P#" + token_hash, "status": "pending", "expiresAtEpoch": expiry, "payload": json.dumps(binding)}
        try:
            self.table.meta.client.transact_write_items(TransactItems=[
                {"Update": {"TableName": self.table.name, "Key": {"id": quota_id},
                            "UpdateExpression": "SET expiresAtEpoch = :expiry ADD #count :one",
                            "ConditionExpression": "attribute_not_exists(#count) OR #count < :limit",
                            "ExpressionAttributeNames": {"#count": "uploadCount"},
                            "ExpressionAttributeValues": {":expiry": int(tomorrow.timestamp()) + 86400,
                                                          ":one": 1, ":limit": limit}}},
                {"Put": {"TableName": self.table.name, "Item": pending,
                         "ConditionExpression": "attribute_not_exists(id)"}},
            ])
        except Exception as exc:
            if getattr(exc, "response", {}).get("Error", {}).get("Code") == "TransactionCanceledException":
                raise UploadLimit("anonymous daily upload-request limit reached") from exc
            raise

    def get_pending(self, token_hash: str) -> dict[str, Any] | None:
        item = self.table.get_item(Key={"id": "P#" + token_hash}, ConsistentRead=True).get("Item")
        if not item or int(item.get("expiresAtEpoch", 0)) <= int(datetime.now(timezone.utc).timestamp()):
            return None
        return {**json.loads(item["payload"]), "status": item["status"], "expiresAtEpoch": int(item["expiresAtEpoch"])}

    def commit_anonymous(self, token_hash: str, report: dict[str, Any], fingerprint: str) -> dict[str, Any]:
        pending = self.get_pending(token_hash)
        if not pending:
            raise SubmissionUnavailable("submission expired or unavailable; request a new upload")
        if pending["status"] == "consumed":
            existing = self.get(report["id"])
            if existing and compare_digest(pending.get("fingerprint", ""), fingerprint):
                return existing
            raise SubmissionUnavailable("submission token has already been used")
        item = {**report, "requestFingerprint": fingerprint}
        try:
            self.table.meta.client.transact_write_items(TransactItems=[
                {"Update": {"TableName": self.table.name, "Key": {"id": "P#" + token_hash},
                            "UpdateExpression": "SET #status = :consumed, payload = :payload",
                            "ConditionExpression": "#status = :pending AND expiresAtEpoch > :now",
                            "ExpressionAttributeNames": {"#status": "status"},
                            "ExpressionAttributeValues": {":consumed": "consumed", ":pending": "pending",
                                                          ":payload": json.dumps({key: value for key, value in pending.items() if key not in ("status", "expiresAtEpoch")} | {"fingerprint": fingerprint}),
                                                          ":now": int(datetime.now(timezone.utc).timestamp())}}},
                {"Put": {"TableName": self.table.name,
                         "Item": {"id": item["id"], "reviewStatus": item["reviewStatus"],
                                  "expiresAtEpoch": item["expiresAtEpoch"], "payload": json.dumps(item)},
                         "ConditionExpression": "attribute_not_exists(id)"}},
            ])
            return item
        except Exception as exc:
            if getattr(exc, "response", {}).get("Error", {}).get("Code") != "TransactionCanceledException":
                raise
            current = self.get_pending(token_hash)
            existing = self.get(report["id"])
            if current and existing and current["status"] == "consumed" and compare_digest(current.get("fingerprint", ""), fingerprint):
                return existing
            raise SubmissionUnavailable("submission token has already been used") from exc


class RoadSnapshot:
    def __init__(self, path: Path | None = None) -> None:
        root = Path(__file__).resolve().parents[2]
        source = path or (root / "data/real_roads/delhi-roads.json")
        if path is None and not source.is_file():
            source = root / "frontend/src/data/delhi-roads.json"
        raw = source.read_bytes()
        data = json.loads(raw)
        if data.get("type") != "FeatureCollection" or not data.get("features"):
            raise ValueError("real-road snapshot is invalid")
        self.version = "sha256:" + sha256(raw).hexdigest()
        self.data = data
        self.roads = {feature["id"]: feature for feature in data["features"]}
        if len(self.roads) != len(data["features"]):
            raise ValueError("duplicate OSM way in snapshot")

    def public(self) -> dict[str, Any]:
        return {**self.data, "metadata": {**self.data["metadata"], "geometryVersion": self.version,
                "matchToleranceMeters": MATCH_METERS, "ambiguityMarginMeters": AMBIGUITY_METERS}}

    def match(self, reference: Any) -> tuple[str, list[float]]:
        if not isinstance(reference, dict):
            raise ValueError("road reference is required")
        road_id, version = reference.get("roadId"), reference.get("geometryVersion")
        if not isinstance(version, str) or not compare_digest(version, self.version):
            raise ReportConflict("road snapshot is stale; reload the mapped roads")
        if not isinstance(road_id, str) or not re.fullmatch(r"osm:way/[1-9][0-9]*", road_id) or road_id not in self.roads:
            raise ValueError("selected OSM way is outside this limited coverage")
        lon, lat = point(reference.get("point"))
        west, south, east, north = self.data["metadata"]["queryBbox"]
        if not west <= lon <= east or not south <= lat <= north:
            raise ValueError("selected point is outside the limited coverage")
        candidates = sorted(((self._distance((lon, lat), feature), feature["id"])
                             for feature in self.roads.values()), key=lambda candidate: (candidate[0][0], candidate[1]))
        distance, snapped = candidates[0][0]
        closest_id = candidates[0][1]
        if distance > MATCH_METERS or road_id != closest_id:
            raise ValueError("selected point does not uniquely match the chosen OSM way")
        if len(candidates) > 1 and candidates[1][0][0] - distance < AMBIGUITY_METERS:
            raise ValueError("road match is ambiguous near another OSM way; choose a different point")
        if not west <= snapped[0] <= east or not south <= snapped[1] <= north:
            raise ValueError("matched OSM point is outside the limited coverage")
        return road_id, snapped

    @staticmethod
    def _distance(location: tuple[float, float], road: dict[str, Any]) -> tuple[float, list[float]]:
        lon, lat = location
        scale_x = 111_320 * cos(radians(lat))
        scale_y = 111_320
        best = (float("inf"), [0.0, 0.0])
        coordinates = road["geometry"]["coordinates"]
        for a, b in zip(coordinates, coordinates[1:]):
            ax, ay = (a[0] - lon) * scale_x, (a[1] - lat) * scale_y
            bx, by = (b[0] - lon) * scale_x, (b[1] - lat) * scale_y
            dx, dy = bx - ax, by - ay
            fraction = max(0.0, min(1.0, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) if dx or dy else 0.0
            px, py = ax + fraction * dx, ay + fraction * dy
            distance = sqrt(px * px + py * py)
            if distance < best[0]:
                best = (distance, [a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1])])
        return best


class RealRoadWorkflow:
    def __init__(self, snapshot: RoadSnapshot, store: Any, media: Any, *, anonymous_enabled: bool = False,
                 anonymous_daily_limit: int = 20) -> None:
        self.snapshot, self.store, self.media = snapshot, store, media
        self.anonymous_enabled = anonymous_enabled
        if not 1 <= anonymous_daily_limit <= 100:
            raise ValueError("anonymous daily limit must be 1-100")
        self.anonymous_daily_limit = anonymous_daily_limit

    @staticmethod
    def _digest(owner: str, key: Any) -> str:
        return sha256(f"real-road:{owner}:{_digest(key)}".encode()).hexdigest()

    def prepare_upload(self, body: dict[str, Any], owner: str) -> dict[str, Any]:
        digest = self._digest(owner, body.get("idempotencyKey"))
        mime, size = body.get("contentType"), body.get("sizeBytes")
        if mime not in MIME_FORMAT or isinstance(size, bool) or not isinstance(size, int) or not 0 < size <= MAX_BYTES:
            raise ValueError("photo must be JPEG, PNG or WebP and no larger than 8 MB")
        self.store.consume_upload(owner)
        key = f"uploads/real-road/{digest}"
        upload = self.media.prepare(key, mime, size)
        return {"uploadUrl": upload["url"], "uploadFields": upload["fields"], "imageKey": key,
                "expiresAt": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat().replace("+00:00", "Z"), "maxBytes": MAX_BYTES}

    def prepare_anonymous_upload(self, body: dict[str, Any]) -> dict[str, Any]:
        if not self.anonymous_enabled:
            raise SubmissionUnavailable("anonymous reporting is unavailable")
        road = body.get("road")
        road_id, snapped = self.snapshot.match(road)
        mime, size = body.get("contentType"), body.get("sizeBytes")
        if mime not in MIME_FORMAT or isinstance(size, bool) or not isinstance(size, int) or not 0 < size <= MAX_BYTES:
            raise ValueError("photo must be JPEG, PNG or WebP and no larger than 8 MB")
        token = secrets.token_urlsafe(32)
        token_hash = sha256(token.encode()).hexdigest()
        key = f"uploads/real-road/anonymous/{token_hash}"
        expires = datetime.now(timezone.utc) + timedelta(minutes=ANONYMOUS_TOKEN_MINUTES)
        upload = self.media.prepare(key, mime, size)
        self.store.reserve_anonymous(token_hash, {"road": road, "roadId": road_id, "snapped": snapped,
                                                  "contentType": mime, "sizeBytes": size, "imageKey": key},
                                     self.anonymous_daily_limit, int(expires.timestamp()))
        return {"uploadUrl": upload["url"], "uploadFields": upload["fields"], "submissionToken": token,
                "expiresAt": expires.isoformat().replace("+00:00", "Z"), "maxBytes": MAX_BYTES}

    def create_anonymous(self, body: dict[str, Any]) -> dict[str, str]:
        if not self.anonymous_enabled:
            raise SubmissionUnavailable("anonymous reporting is unavailable")
        token = body.get("submissionToken")
        if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{32,100}", token):
            raise SubmissionUnavailable("submission expired or unavailable; request a new upload")
        token_hash = sha256(token.encode()).hexdigest()
        pending = self.store.get_pending(token_hash)
        if not pending:
            raise SubmissionUnavailable("submission expired or unavailable; request a new upload")
        if body.get("road") != pending["road"] or body.get("imageKey") != pending["imageKey"]:
            raise SubmissionUnavailable("upload and road selection do not match the submission token")
        road_id, snapped = self.snapshot.match(body.get("road"))
        if road_id != pending["roadId"] or snapped != pending["snapped"]:
            raise SubmissionUnavailable("road snapshot changed; request a new upload")
        note = body.get("note", "")
        if not isinstance(note, str) or len(note) > 280:
            raise ValueError("note must be 280 characters or fewer")
        captured = body.get("capturedAt")
        now = datetime.now(timezone.utc)
        if captured is not None:
            observed = utc_time(captured)
            if observed > now or observed < now - timedelta(hours=EVIDENCE_HOURS):
                raise ValueError("observation must be within the last 24 hours")
        else:
            observed = now
        fingerprint = sha256(json.dumps({"road": pending["road"], "imageKey": pending["imageKey"],
                                         "note": note.strip(), "capturedAt": captured}, sort_keys=True).encode()).hexdigest()
        report_id = "RR-" + token_hash[:32]
        if pending["status"] == "consumed":
            existing = self.store.get(report_id)
            if existing and compare_digest(pending.get("fingerprint", ""), fingerprint):
                return {"id": report_id, "reviewStatus": "Pending Review"}
            raise SubmissionUnavailable("submission token has already been used")
        raw, mime = self.media.read(pending["imageKey"])
        if mime != pending["contentType"] or len(raw) != pending["sizeBytes"]:
            raise SubmissionUnavailable("uploaded photo does not match the submission request")
        clean = sanitize_photo(raw, mime)
        photo_key = f"review/real-road/{token_hash}-{sha256(clean).hexdigest()[:24]}.jpg"
        self.media.save_review(photo_key, clean)
        retention = now + timedelta(days=REPORT_DAYS)
        item = {"id": report_id, "roadId": road_id, "geometryVersion": self.snapshot.version, "point": snapped,
                "reviewStatus": "Pending Review", "source": "resident_photo", "observedAt": observed.isoformat().replace("+00:00", "Z"),
                "createdAt": _now(), "reviewedAt": None, "review": None,
                "evidenceExpiresAt": min(observed + timedelta(hours=EVIDENCE_HOURS), retention).isoformat().replace("+00:00", "Z"),
                "expiresAt": retention.isoformat().replace("+00:00", "Z"), "expiresAtEpoch": int(retention.timestamp()),
                "imageKey": photo_key, "note": note.strip()}
        saved = self.store.commit_anonymous(token_hash, item, fingerprint)
        self.media.delete_upload(pending["imageKey"])
        return {"id": saved["id"], "reviewStatus": "Pending Review"}

    def create(self, body: dict[str, Any], owner: str) -> dict[str, Any]:
        digest = self._digest(owner, body.get("idempotencyKey"))
        upload_key = f"uploads/real-road/{digest}"
        if body.get("imageKey") != upload_key:
            raise ValueError("imageKey does not match this signed-in user")
        road_id, snapped = self.snapshot.match(body.get("road"))
        note = body.get("note", "")
        if not isinstance(note, str) or len(note) > 280:
            raise ValueError("note must be 280 characters or fewer")
        captured = body.get("capturedAt")
        now = datetime.now(timezone.utc)
        if captured is not None:
            observed = utc_time(captured)
            if observed > now or observed < now - timedelta(hours=EVIDENCE_HOURS):
                raise ValueError("observation must be within the last 24 hours")
        else:
            observed = now
        report_id = "RR-" + digest[:32]
        fingerprint = sha256(json.dumps({"roadId": road_id, "point": snapped, "version": self.snapshot.version,
                                          "imageKey": upload_key, "note": note.strip(), "capturedAt": captured}, sort_keys=True).encode()).hexdigest()
        existing = self.store.get(report_id)
        if existing:
            if compare_digest(existing["requestFingerprint"], fingerprint):
                return self.submission_receipt(existing)
            raise ReportConflict("idempotency key was used for another report")
        raw, mime = self.media.read(upload_key)
        clean = sanitize_photo(raw, mime)
        photo_key = f"review/real-road/{digest}-{sha256(clean).hexdigest()[:24]}.jpg"
        self.media.save_review(photo_key, clean)
        retention = now + timedelta(days=REPORT_DAYS)
        evidence_expiry = min(observed + timedelta(hours=EVIDENCE_HOURS), retention)
        item = {"id": report_id, "roadId": road_id, "geometryVersion": self.snapshot.version, "point": snapped,
                "reviewStatus": "Pending Review", "source": "resident_photo", "observedAt": observed.isoformat().replace("+00:00", "Z"),
                "createdAt": _now(), "reviewedAt": None, "review": None, "evidenceExpiresAt": evidence_expiry.isoformat().replace("+00:00", "Z"),
                "expiresAt": retention.isoformat().replace("+00:00", "Z"), "expiresAtEpoch": int(retention.timestamp()),
                "ownerSub": owner, "imageKey": photo_key, "note": note.strip()}
        saved = self.store.create(item, fingerprint)
        self.media.delete_upload(upload_key)
        return self.submission_receipt(saved)

    @staticmethod
    def submission_receipt(item: dict[str, Any]) -> dict[str, str]:
        # Residents can confirm their own submission without receiving private
        # report details or reviewer identity on an idempotent retry.
        return {"id": item["id"], "reviewStatus": item["reviewStatus"]}

    def view(self, item: dict[str, Any], with_photo: bool = False) -> dict[str, Any]:
        # Private URL is added only after a responder-authorized detail request.
        return {key: value for key, value in item.items() if key not in ("ownerSub", "requestFingerprint", "expiresAtEpoch") and (with_photo or key != "imageKey")}

    def detail(self, report_id: str) -> dict[str, Any]:
        item = self.store.get(report_id)
        if not item:
            raise KeyError(report_id)
        return {**self.view(item, with_photo=True), "photoUrl": self.media.photo_url(item["imageKey"])}

    def list(self) -> list[dict[str, Any]]:
        return sorted((self.view(item) for item in self.store.list()), key=lambda item: item["createdAt"], reverse=True)

    def public_evidence(self) -> list[dict[str, Any]]:
        now = datetime.now(timezone.utc)
        evidence = []
        for item in self.store.list():
            if item["roadId"] not in self.snapshot.roads or datetime.fromisoformat(item["evidenceExpiresAt"].replace("Z", "+00:00")) <= now:
                continue
            state = item["reviewStatus"]
            decision = (item.get("review") or {}).get("decision")
            if (state, decision) not in (("Confirmed Blockage", "confirm_blockage"), ("Cleared", "clear")):
                continue
            reviewed_at = item.get("reviewedAt")
            if not reviewed_at or not item.get("point"):
                continue
            reviewed = datetime.fromisoformat(reviewed_at.replace("Z", "+00:00"))
            observed = datetime.fromisoformat(item["observedAt"].replace("Z", "+00:00"))
            if not observed <= reviewed <= now:
                continue
            # Explicit public allowlist excludes pending IDs and all private fields.
            evidence.append({"roadId": item["roadId"], "point": item["point"],
                             "reviewState": state, "observedAt": item["observedAt"], "reviewedAt": reviewed_at,
                             "reviewDecision": decision, "expiresAt": item["evidenceExpiresAt"],
                             "source": item["source"]})
        return sorted(evidence, key=lambda item: item["observedAt"], reverse=True)

    def review(self, report_id: str, body: dict[str, Any], reviewer: str) -> dict[str, Any]:
        item = self.store.get(report_id)
        if not item:
            raise KeyError(report_id)
        decision = body.get("decision")
        if decision not in ("confirm_blockage", "clear", "reject"):
            raise ValueError("decision must be confirm_blockage, clear, or reject")
        if item["reviewStatus"] != "Pending Review":
            if (item.get("review") or {}).get("decision") == decision:
                return self.view(item)
            raise ReportConflict("report has already been reviewed")
        if decision != "reject" and datetime.fromisoformat(item["evidenceExpiresAt"].replace("Z", "+00:00")) <= datetime.now(timezone.utc):
            raise ReportConflict("observation expired; it cannot establish a current condition")
        state = {"confirm_blockage": "Confirmed Blockage", "clear": "Cleared", "reject": "Rejected"}[decision]
        reviewed = _now()
        saved = self.store.review(report_id, {**item, "reviewStatus": state, "reviewedAt": reviewed,
                                               "review": {"decision": decision, "reviewedAt": reviewed, "reviewer": reviewer}})
        return self.view(saved)
