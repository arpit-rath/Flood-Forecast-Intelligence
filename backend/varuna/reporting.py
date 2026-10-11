"""Private photo intake and manual responder review for the Scenario pilot."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from hmac import compare_digest
from io import BytesIO
import json
import os
import re
import secrets
from threading import RLock
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError

from .models import Report, distance_meters, point, utc_time
from .service import VarunaService


MAX_BYTES = 8 * 1024 * 1024
RETENTION_DAYS = 7
MAX_PIXELS = 20_000_000
MIME_FORMAT = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class ReportConflict(Exception):
    pass


class PhotoMissing(Exception):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _active(item: dict[str, Any]) -> bool:
    # TTL is asynchronous. Never expose or score an expired record while it awaits deletion.
    expiry = item.get("expiresAtEpoch")
    if expiry is None and item.get("source") == "resident_upload":
        # Pre-retention uploads have no TTL and need explicit administrator cleanup.
        return False
    return expiry is None or int(expiry) > int(datetime.now(timezone.utc).timestamp())


def _digest(key: Any) -> str:
    if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", key):
        raise ValueError("idempotencyKey must be 16-100 URL-safe characters")
    return sha256(key.encode("utf-8")).hexdigest()


def _upload_key(digest: str) -> str:
    return f"uploads/{digest}"


def _report_id(digest: str) -> str:
    return f"R-{digest[:32]}"


def _photo_key(digest: str, clean: bytes) -> str:
    # Immutable content-specific key prevents a conflicting concurrent submit
    # from replacing the photo referenced by the winning metadata write.
    return f"review/{digest}-{sha256(clean).hexdigest()[:24]}.jpg"


def sanitize_photo(raw: bytes, content_type: str) -> bytes:
    """Decode and re-encode a bounded image; the review copy has no EXIF."""
    if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_BYTES:
        raise ValueError("photo must be between 1 byte and 8 MB")
    if content_type not in MIME_FORMAT:
        raise ValueError("photo must be JPEG, PNG or WebP")
    try:
        with Image.open(BytesIO(raw)) as image:
            if image.format != MIME_FORMAT[content_type] or image.width * image.height > MAX_PIXELS:
                raise ValueError("photo format or dimensions do not match the upload")
            image.load()
            clean = ImageOps.exif_transpose(image).convert("RGB")
            output = BytesIO()
            clean.save(output, format="JPEG", quality=85, optimize=True)
            result = output.getvalue()
            if len(result) > MAX_BYTES:
                raise ValueError("re-encoded review photo exceeds 8 MB")
            return result
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("photo could not be decoded") from exc


class MemoryReportStore:
    def __init__(self) -> None:
        self.items: dict[str, dict[str, Any]] = {}
        self.lock = RLock()

    def list(self) -> list[dict[str, Any]]:
        with self.lock:
            return [dict(item) for item in self.items.values() if _active(item)]

    def get(self, report_id: str) -> dict[str, Any] | None:
        with self.lock:
            item = self.items.get(report_id)
            return dict(item) if item and _active(item) else None

    def create(self, payload: dict[str, Any], fingerprint: str) -> dict[str, Any]:
        with self.lock:
            existing = self.items.get(payload["id"])
            if existing:
                if not compare_digest(existing["requestFingerprint"], fingerprint):
                    raise ReportConflict("idempotency key was used for another report")
                return dict(existing)
            item = {**payload, "requestFingerprint": fingerprint}
            self.items[item["id"]] = item
            return dict(item)

    def review(self, report_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            existing = self.items.get(report_id)
            if not existing or not _active(existing):
                raise KeyError(report_id)
            if existing["reviewStatus"] != "Pending Review":
                if existing["reviewStatus"] == payload["reviewStatus"] and existing.get("manualVisibleWater") == payload.get("manualVisibleWater"):
                    return dict(existing)
                raise ReportConflict("report has already been reviewed")
            item = {**payload, "requestFingerprint": existing["requestFingerprint"]}
            self.items[report_id] = item
            return dict(item)


class DynamoReportStore:
    def __init__(self, table_name: str) -> None:
        import boto3
        self.table = boto3.resource("dynamodb").Table(table_name)

    def list(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        args: dict[str, Any] = {"ConsistentRead": True, "Limit": 100}
        while True:
            page = self.table.scan(**args)
            items.extend(payload for item in page.get("Items", []) if _active(payload := json.loads(item["payload"])))
            if len(items) > 1000:
                raise RuntimeError("report listing exceeds configured limit")
            if "LastEvaluatedKey" not in page:
                return items
            args["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    def get(self, report_id: str) -> dict[str, Any] | None:
        item = self.table.get_item(Key={"id": report_id}, ConsistentRead=True).get("Item")
        payload = json.loads(item["payload"]) if item else None
        return payload if payload and _active(payload) else None

    def create(self, payload: dict[str, Any], fingerprint: str) -> dict[str, Any]:
        item = {**payload, "requestFingerprint": fingerprint}
        try:
            self.table.put_item(
                Item={"id": item["id"], "reviewStatus": item["reviewStatus"], "expiresAtEpoch": item["expiresAtEpoch"], "payload": json.dumps(item)},
                ConditionExpression="attribute_not_exists(id)",
            )
            return item
        except Exception as exc:
            if not _conditional_failure(exc):
                raise
            existing = self.get(item["id"])
            if existing and compare_digest(existing["requestFingerprint"], fingerprint):
                return existing
            raise ReportConflict("idempotency key was used for another report") from exc

    def review(self, report_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        existing = self.get(report_id)
        if not existing:
            raise KeyError(report_id)
        if existing["reviewStatus"] != "Pending Review":
            if existing["reviewStatus"] == payload["reviewStatus"] and existing.get("manualVisibleWater") == payload.get("manualVisibleWater"):
                return existing
            raise ReportConflict("report has already been reviewed")
        item = {**payload, "requestFingerprint": existing["requestFingerprint"]}
        try:
            self.table.update_item(
                Key={"id": report_id},
                UpdateExpression="SET reviewStatus = :new, payload = :payload",
                ConditionExpression="reviewStatus = :pending AND expiresAtEpoch > :now",
                ExpressionAttributeValues={":new": item["reviewStatus"], ":payload": json.dumps(item), ":pending": "Pending Review", ":now": int(datetime.now(timezone.utc).timestamp())},
            )
            return item
        except Exception as exc:
            if not _conditional_failure(exc):
                raise
            current = self.get(report_id)
            if current and current["reviewStatus"] == item["reviewStatus"] and current.get("manualVisibleWater") == item.get("manualVisibleWater"):
                return current
            raise ReportConflict("report has already been reviewed") from exc


def _conditional_failure(exc: Exception) -> bool:
    return getattr(exc, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException"


class MemoryMedia:
    def __init__(self, base_url: str = "http://127.0.0.1:8000") -> None:
        self.base_url = base_url.rstrip("/")
        self.uploads: dict[str, tuple[bytes, str]] = {}
        self.review_images: dict[str, bytes] = {}
        self.tickets: dict[str, tuple[str, int, datetime, str]] = {}
        self.capabilities: dict[str, tuple[str, datetime]] = {}

    def prepare(self, key: str, content_type: str, size: int) -> dict[str, Any]:
        token = secrets.token_urlsafe(32)
        self.tickets[key] = (content_type, size, datetime.now(timezone.utc) + timedelta(minutes=5), token)
        path = f"/v2/uploads/{key.removeprefix('uploads/real-road/')}" if key.startswith("uploads/real-road/") else f"/v1/uploads/{key.removeprefix('uploads/')}"
        return {"url": f"{self.base_url}{path}", "fields": {"key": key, "Content-Type": content_type, "upload-token": token}}

    def put_upload(self, key: str, raw: bytes, content_type: str, fields: dict[str, str]) -> None:
        ticket = self.tickets.get(key)
        if (ticket is None or ticket[:2] != (content_type, len(raw)) or ticket[2] < datetime.now(timezone.utc)
                or len(raw) > MAX_BYTES or fields.get("key") != key or fields.get("Content-Type") != content_type
                or not compare_digest(fields.get("upload-token", ""), ticket[3])):
            raise ValueError("upload does not match the issued URL")
        self.uploads[key] = (raw, content_type)

    def read(self, key: str) -> tuple[bytes, str]:
        if key not in self.uploads:
            raise PhotoMissing("upload was not found")
        return self.uploads[key]

    def save_review(self, key: str, clean: bytes) -> None:
        self.review_images[key] = clean

    def delete_upload(self, key: str) -> None:
        self.uploads.pop(key, None)

    def photo_url(self, key: str) -> str:
        token = secrets.token_urlsafe(32)
        self.capabilities[token] = (key, datetime.now(timezone.utc) + timedelta(seconds=60))
        path = f"/v2/private-photo/{key.removeprefix('review/real-road/')}" if key.startswith("review/real-road/") else f"/v1/private-photo/{key.removeprefix('review/')}"
        return f"{self.base_url}{path}?token={token}"

    def private_photo(self, key: str, token: str) -> bytes:
        capability = self.capabilities.get(token)
        if not capability or not compare_digest(capability[0], key) or capability[1] < datetime.now(timezone.utc):
            raise PermissionError("photo access is unavailable")
        try:
            return self.review_images[key]
        except KeyError as exc:
            raise PhotoMissing("photo was not found") from exc


class S3Media:
    def __init__(self, bucket: str) -> None:
        import boto3
        from botocore.config import Config

        region = os.environ["AWS_REGION"]
        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            region_name=region,
            endpoint_url=f"https://s3.{region}.amazonaws.com",
            config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
        )

    def prepare(self, key: str, content_type: str, size: int) -> dict[str, Any]:
        return self.client.generate_presigned_post(
            Bucket=self.bucket, Key=key,
            Fields={"Content-Type": content_type, "x-amz-server-side-encryption": "AES256"},
            Conditions=[{"Content-Type": content_type}, {"x-amz-server-side-encryption": "AES256"}, ["content-length-range", 1, MAX_BYTES]],
            ExpiresIn=300,
        )

    def read(self, key: str) -> tuple[bytes, str]:
        try:
            obj = self.client.get_object(Bucket=self.bucket, Key=key)
        except Exception as exc:
            if getattr(exc, "response", {}).get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                raise PhotoMissing("upload was not found") from exc
            raise
        if obj["ContentLength"] > MAX_BYTES:
            raise ValueError("photo exceeds 8 MB")
        return obj["Body"].read(MAX_BYTES + 1), obj["ContentType"]

    def save_review(self, key: str, clean: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=clean, ContentType="image/jpeg", ServerSideEncryption="AES256")

    def delete_upload(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def photo_url(self, key: str) -> str:
        return self.client.generate_presigned_url("get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=60)


class ReportWorkflow:
    def __init__(self, service: VarunaService, store: Any, media: Any) -> None:
        self.service = service
        self.store = store
        self.media = media

    def sync(self) -> None:
        self.service.sync_uploaded_reports([Report.from_dict(item) for item in self.store.list()])

    def prepare_upload(self, body: dict[str, Any], owner_sub: str) -> dict[str, Any]:
        digest = sha256(f"{owner_sub}:{_digest(body.get('idempotencyKey'))}".encode()).hexdigest()
        content_type, size = body.get("contentType"), body.get("sizeBytes")
        if content_type not in MIME_FORMAT or isinstance(size, bool) or not isinstance(size, int) or not 0 < size <= MAX_BYTES:
            raise ValueError("photo must be JPEG, PNG or WebP and no larger than 8 MB")
        key = _upload_key(digest)
        upload = self.media.prepare(key, content_type, size)
        return {
            "uploadUrl": upload["url"], "uploadFields": upload["fields"], "imageKey": key,
            "expiresAt": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat().replace("+00:00", "Z"),
            "maxBytes": MAX_BYTES,
        }

    def create(self, body: dict[str, Any], owner_sub: str) -> dict[str, Any]:
        digest = sha256(f"{owner_sub}:{_digest(body.get('idempotencyKey'))}".encode()).hexdigest()
        upload_key = _upload_key(digest)
        if body.get("imageKey") != upload_key:
            raise ValueError("imageKey does not match this submission")
        segment_id = body.get("segmentId")
        segment = next((item for item in self.service.fixture.segments if item.id == segment_id), None)
        if segment is None:
            raise ValueError("report segment is outside the pilot")
        coordinates = point(body.get("point"))
        midpoint = tuple((a + b) / 2 for a, b in zip(*segment.geometry))
        if distance_meters(coordinates, midpoint) > 100:
            raise ValueError("report point must be near the selected pilot road")
        note = body.get("note", "")
        if not isinstance(note, str) or len(note) > 280:
            raise ValueError("note must be 280 characters or fewer")
        captured = body.get("capturedAt")
        if captured is not None and utc_time(captured) > datetime.now(timezone.utc):
            raise ValueError("capturedAt cannot be in the future")
        consent = body.get("consentPublicDerivative", False)
        if not isinstance(consent, bool):
            raise ValueError("consentPublicDerivative must be boolean")
        fingerprint = sha256(json.dumps(
            {"imageKey": upload_key, "segmentId": segment_id, "point": coordinates, "note": note.strip(), "capturedAt": captured, "consent": consent},
            sort_keys=True,
        ).encode()).hexdigest()
        existing = self.store.get(_report_id(digest))
        if existing:
            if compare_digest(existing["requestFingerprint"], fingerprint):
                return self.view(existing)
            raise ReportConflict("idempotency key was used for another report")
        raw, content_type = self.media.read(upload_key)
        clean = sanitize_photo(raw, content_type)
        review_key = _photo_key(digest, clean)
        self.media.save_review(review_key, clean)
        report = Report(
            id=_report_id(digest), segment_id=segment_id, point=coordinates, created_at=_now(),
            captured_at=captured, image_key=review_key, review_status="Pending Review",
            observations={}, model_confidence=None, source="resident_upload",
        )
        expiry = datetime.now(timezone.utc) + timedelta(days=RETENTION_DAYS)
        item = {**report.as_dict(), "note": note.strip(), "consentPublicDerivative": consent, "review": None,
                "ownerSub": owner_sub, "expiresAt": expiry.isoformat().replace("+00:00", "Z"), "expiresAtEpoch": int(expiry.timestamp())}
        saved = self.store.create(item, fingerprint)
        self.media.delete_upload(upload_key)
        self.sync()
        return self.view(saved)

    def list(self) -> list[dict[str, Any]]:
        self.sync()
        uploaded = [self.view(item) for item in self.store.list()]
        fixture = [self.view(report.as_dict()) for report in self.service.fixture.reports]
        return sorted(uploaded + fixture, key=lambda item: item["createdAt"], reverse=True)

    def get(self, report_id: str, *, with_photo: bool = False) -> dict[str, Any]:
        item = self.store.get(report_id)
        if item is None:
            fixture = next((report for report in self.service.fixture.reports if report.id == report_id), None)
            if fixture is None:
                raise KeyError(report_id)
            item = fixture.as_dict()
        return self.view(item, with_photo=with_photo)

    def review(self, report_id: str, body: dict[str, Any], reviewer: str) -> dict[str, Any]:
        item = self.store.get(report_id)
        if item is None:
            raise KeyError(report_id)
        decision = body.get("decision")
        if decision not in ("accept", "reject"):
            raise ValueError("decision must be accept or reject")
        manual = body.get("manualVisibleWater") if decision == "accept" else None
        if decision == "accept" and manual not in ("none", "possible", "clear", "uncertain"):
            raise ValueError("acceptance requires a manual visible-water decision")
        if item["reviewStatus"] != "Pending Review":
            if item["reviewStatus"] == ("Accepted" if decision == "accept" else "Rejected") and item.get("manualVisibleWater") == manual:
                self.sync()
                return {"report": self.view(item), "snapshotId": self.service.snapshot()["id"] if decision == "accept" else None}
            raise ReportConflict("report has already been reviewed")
        report = Report.from_dict(item)
        updated = replace(
            report, review_status="Accepted" if decision == "accept" else "Rejected",
            manual_visible_water=manual,
            scenario_valid_at=self.service.fixture.metadata["validAt"] if decision == "accept" else None,
        )
        payload = {**item, **updated.as_dict(), "review": {"decision": decision, "reviewedAt": _now(), "reviewer": reviewer}}
        saved = self.store.review(report_id, payload)
        self.sync()
        return {
            "report": self.view(saved),
            "snapshotId": self.service.snapshot()["id"] if decision == "accept" else None,
            "note": "Manual observation replayed in the synthetic Scenario; not live evidence." if decision == "accept" else "Rejected report does not enter the score.",
        }

    def view(self, item: dict[str, Any], *, with_photo: bool = False) -> dict[str, Any]:
        fixture = item.get("source") != "resident_upload"
        return {
            **{key: value for key, value in item.items() if key not in ("requestFingerprint", "consentPublicDerivative", "ownerSub", "expiresAtEpoch")},
            "imageUrl": self.media.photo_url(item["imageKey"]) if with_photo and not fixture else None,
            "analysis": {"status": "complete" if fixture and item.get("observations") else "not_configured", "provider": "fixture" if fixture else "none", "model": None, "completedAt": None, "failureReason": None},
        }
