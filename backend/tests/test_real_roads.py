"""Limited OSM reporting boundaries, authorization and Scenario regression."""

import unittest
from datetime import datetime, timedelta, timezone
from io import BytesIO
from unittest.mock import Mock, patch

from PIL import Image

from backend.varuna.api import dispatch
from backend.varuna import api as api_module
from backend.varuna.real_roads import MAX_UPLOADS_PER_DAY, DynamoRealRoadStore, MemoryRealRoadStore, RealRoadWorkflow, RoadSnapshot, UploadLimit
from backend.varuna.reporting import MAX_BYTES, MemoryMedia, ReportConflict
from backend.varuna.service import VarunaService


def photo() -> bytes:
    stream = BytesIO()
    Image.new("RGB", (4, 4), (10, 20, 30)).save(stream, format="JPEG")
    return stream.getvalue()


class RealRoadTests(unittest.TestCase):
    def setUp(self):
        self.service = VarunaService()
        self.snapshot = RoadSnapshot()
        self.media = MemoryMedia()
        self.store = MemoryRealRoadStore()
        self.workflow = RealRoadWorkflow(self.snapshot, self.store, self.media)
        self.resident = {"sub": "resident-a", "token_use": "access", "cognito:groups": []}
        self.responder = {"sub": "responder-a", "token_use": "access", "cognito:groups": ["varuna-responder"]}
        self.reference = self._unambiguous_reference()

    def _unambiguous_reference(self):
        for feature in self.snapshot.roads.values():
            coords = feature["geometry"]["coordinates"]
            for a, b in zip(coords, coords[1:]):
                candidate = {"roadId": feature["id"], "geometryVersion": self.snapshot.version,
                             "point": [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]}
                try:
                    self.snapshot.match(candidate)
                    return candidate
                except ValueError:
                    continue
        self.fail("snapshot has no unambiguous point")

    def call(self, method, path, body=None, claims=None):
        return dispatch(self.service, method, path, body=body, operator_claims=claims, real_roads=self.workflow)

    def submit(self, key="real-road-report-key-0001", claims=None):
        claims = claims or self.resident
        raw = photo()
        ticket = self.call("POST", "/v2/real-road-reports/upload-url", {
            "idempotencyKey": key, "contentType": "image/jpeg", "sizeBytes": len(raw)}, claims).body
        self.media.put_upload(ticket["imageKey"], raw, "image/jpeg", ticket["uploadFields"])
        body = {"idempotencyKey": key, "imageKey": ticket["imageKey"], "road": self.reference,
                "capturedAt": None, "note": "Observed road condition"}
        return self.call("POST", "/v2/real-road-reports", body, claims), body

    def test_snapshot_version_and_match_reject_stale_ambiguous_outside(self):
        public = self.call("GET", "/v2/roads")
        self.assertEqual(public.status, 200)
        self.assertEqual(public.body["metadata"]["geometryVersion"], self.snapshot.version)
        self.assertEqual(self.snapshot.match(self.reference)[0], self.reference["roadId"])
        with self.assertRaises(ReportConflict):
            self.snapshot.match({**self.reference, "geometryVersion": "sha256:stale"})
        for reference in ({**self.reference, "roadId": "osm:way/999999999999"},
                          {**self.reference, "point": [77.0, 28.5]}):
            with self.assertRaises(ValueError):
                self.snapshot.match(reference)
        shared = {}
        for road in self.snapshot.roads.values():
            for coordinate in road["geometry"]["coordinates"]:
                key = tuple(coordinate)
                if key in shared and shared[key] != road["id"]:
                    ambiguous = {**self.reference, "roadId": road["id"], "point": coordinate}
                    if self.snapshot.data["metadata"]["queryBbox"][0] <= coordinate[0] <= self.snapshot.data["metadata"]["queryBbox"][2]:
                        with self.assertRaises(ValueError):
                            self.snapshot.match(ambiguous)
                        return
                shared[key] = road["id"]
        self.fail("snapshot has no shared road junction to check ambiguity")

    def test_auth_private_photo_pending_review_and_v1_risk_isolation(self):
        baseline = self.call("GET", "/v1/snapshots/current").body
        upload = {"idempotencyKey": "real-road-report-key-0001", "contentType": "image/jpeg", "sizeBytes": len(photo())}
        self.assertEqual(self.call("POST", "/v2/real-road-reports/upload-url", upload).status, 403)
        self.assertEqual(self.call("POST", "/v2/real-road-reports", {}).status, 403)
        self.assertEqual(self.call("POST", "/v2/real-road-reports/upload-url", upload, {**self.resident, "token_use": "id"}).status, 403)
        created, body = self.submit()
        self.assertEqual(created.status, 201)
        self.assertEqual(created.body["reviewStatus"], "Pending Review")
        self.assertEqual(set(created.body), {"id", "reviewStatus"})
        report_id = created.body["id"]
        self.assertNotIn("photoUrl", created.body)
        self.assertNotIn("ownerSub", created.body)
        self.assertEqual(self.store.get(report_id)["ownerSub"], "resident-a")
        self.assertEqual(self.call("POST", "/v2/real-road-reports", body, self.resident).body["id"], report_id)
        self.assertEqual(self.call("POST", "/v2/real-road-reports", {**body, "note": "changed"}, self.resident).status, 409)
        self.assertEqual(self.call("POST", "/v2/real-road-reports", body, {**self.resident, "sub": "other-user"}).status, 400)
        for claims in (None, self.resident):
            self.assertEqual(self.call("GET", "/v2/real-road-reports", claims=claims).status, 403)
            self.assertEqual(self.call("GET", f"/v2/real-road-reports/{report_id}", claims=claims).status, 403)
            self.assertEqual(self.call("PATCH", f"/v2/real-road-reports/{report_id}/review", {"decision": "confirm_blockage"}, claims).status, 403)
        for claims in (None, self.resident, self.responder):
            public = self.call("GET", "/v2/real-road-evidence", claims=claims)
            self.assertEqual(public.status, 200)
            self.assertEqual(public.body["evidence"], [])
        self.assertEqual(self.call("GET", "/v1/snapshots/current").body, baseline)
        queue = self.call("GET", "/v2/real-road-reports", claims=self.responder)
        self.assertEqual(queue.status, 200)
        self.assertEqual(queue.body["reports"][0]["reviewStatus"], "Pending Review")
        detail = self.call("GET", f"/v2/real-road-reports/{report_id}", claims=self.responder)
        self.assertEqual(detail.status, 200)
        self.assertIn("/v2/private-photo/", detail.body["photoUrl"])
        private_key = detail.body["imageKey"]
        with self.assertRaises(PermissionError):
            self.media.private_photo(private_key, "")
        self.assertGreater(len(self.media.private_photo(private_key, detail.body["photoUrl"].split("token=")[1])), 0)
        confirmed = self.call("PATCH", f"/v2/real-road-reports/{report_id}/review", {"decision": "confirm_blockage"}, self.responder)
        self.assertEqual(confirmed.body["reviewStatus"], "Confirmed Blockage")
        repeated = self.call("POST", "/v2/real-road-reports", body, self.resident)
        self.assertEqual(repeated.body, {"id": report_id, "reviewStatus": "Confirmed Blockage"})
        self.assertNotIn("review", repeated.body)
        expected_fields = {"roadId", "point", "reviewState", "observedAt", "reviewedAt", "reviewDecision", "expiresAt", "source"}
        for claims in (None, self.resident, self.responder):
            public = self.call("GET", "/v2/real-road-evidence", claims=claims)
            self.assertEqual(public.status, 200)
            evidence = public.body["evidence"]
            self.assertEqual(len(evidence), 1)
            self.assertEqual(set(evidence[0]), expected_fields)
            self.assertEqual(evidence[0]["reviewDecision"], "confirm_blockage")
            self.assertEqual(evidence[0]["roadId"], self.reference["roadId"])
        self.assertEqual(self.call("GET", "/v1/snapshots/current").body, baseline)
        self.assertEqual(self.call("PATCH", f"/v2/real-road-reports/{report_id}/review", {"decision": "clear"}, self.responder).status, 409)

    def test_clear_reject_expiry_and_abuse_controls(self):
        for decision, status in (("clear", "Cleared"), ("reject", "Rejected")):
            created, _ = self.submit(f"real-road-{decision}-key-0001")
            report_id = created.body["id"]
            reviewed = self.call("PATCH", f"/v2/real-road-reports/{report_id}/review", {"decision": decision}, self.responder)
            self.assertEqual(reviewed.body["reviewStatus"], status)
        public = self.call("GET", "/v2/real-road-evidence").body["evidence"]
        self.assertEqual([item["reviewState"] for item in public], ["Cleared"])
        self.assertEqual(self.call("POST", "/v2/real-road-reports/upload-url", {"idempotencyKey": "oversized-upload-key-0001", "contentType": "image/jpeg", "sizeBytes": MAX_BYTES + 1}, self.resident).status, 400)
        issued = self.call("POST", "/v2/real-road-reports/upload-url", {"idempotencyKey": "bounded-upload-key-0001", "contentType": "image/jpeg", "sizeBytes": 100}, self.resident).body
        with self.assertRaises(ValueError):
            self.media.put_upload(issued["imageKey"], b"x" * (MAX_BYTES + 1), "image/jpeg", issued["uploadFields"])
        for index in range(MAX_UPLOADS_PER_DAY - 3):
            result = self.call("POST", "/v2/real-road-reports/upload-url", {"idempotencyKey": f"quota-key-{index:016d}", "contentType": "image/jpeg", "sizeBytes": 100}, self.resident)
            self.assertEqual(result.status, 200)
        self.assertEqual(self.call("POST", "/v2/real-road-reports/upload-url", {"idempotencyKey": "quota-final-key-0001", "contentType": "image/jpeg", "sizeBytes": 100}, self.resident).status, 429)
        cleared_id = next(item["id"] for item in self.store.list() if item["reviewStatus"] == "Cleared")
        self.store.items[cleared_id]["evidenceExpiresAt"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        self.assertEqual(self.call("GET", "/v2/real-road-evidence").body["evidence"], [])
        self.store.items[cleared_id]["expiresAtEpoch"] = 1
        self.assertEqual(self.call("GET", f"/v2/real-road-reports/{cleared_id}", claims=self.responder).status, 404)
        self.assertNotIn(cleared_id, [report["id"] for report in self.call("GET", "/v2/real-road-reports", claims=self.responder).body["reports"]])

    def test_invalid_photo_and_api_level_stale_reference(self):
        key = "invalid-photo-key-0001"
        ticket = self.call("POST", "/v2/real-road-reports/upload-url", {
            "idempotencyKey": key, "contentType": "image/jpeg", "sizeBytes": len(b"not an image")}, self.resident).body
        self.media.put_upload(ticket["imageKey"], b"not an image", "image/jpeg", ticket["uploadFields"])
        body = {"idempotencyKey": key, "imageKey": ticket["imageKey"], "road": self.reference, "capturedAt": None}
        self.assertEqual(self.call("POST", "/v2/real-road-reports", body, self.resident).status, 400)
        self.assertEqual(self.call("POST", "/v2/real-road-reports", {**body, "road": {**self.reference, "geometryVersion": "sha256:stale"}}, self.resident).status, 409)
        self.assertEqual(self.call("POST", "/v2/real-road-reports", {**body, "road": {**self.reference, "point": [77.0, 28.5]}}, self.resident).status, 400)

    def test_dynamo_quota_is_atomic_and_skips_counter_items_in_review_scan(self):
        table = Mock()
        table.scan.return_value = {"Items": [{"id": "Q#quota-marker"}, {"id": "RR-active", "payload": '{"id":"RR-active","expiresAtEpoch":4000000000}'}]}
        store = object.__new__(DynamoRealRoadStore)
        store.table = table
        store.consume_upload("resident-a")
        request = table.update_item.call_args.kwargs
        self.assertIn("#count < :limit", request["ConditionExpression"])
        self.assertEqual(request["ExpressionAttributeValues"][":limit"], MAX_UPLOADS_PER_DAY)
        self.assertEqual([item["id"] for item in store.list()], ["RR-active"])
        failure = Exception("quota")
        failure.response = {"Error": {"Code": "ConditionalCheckFailedException"}}
        table.update_item.side_effect = failure
        with self.assertRaises(UploadLimit):
            store.consume_upload("resident-a")

    def test_lambda_v2_review_requires_gateway_access_claims(self):
        event = {"rawPath": "/v2/real-road-reports", "requestContext": {"http": {"method": "GET"},
                 "authorizer": {"jwt": {"claims": self.responder}}}}
        with patch.object(api_module, "_LAMBDA_REAL_ROADS", self.workflow):
            self.assertEqual(api_module.lambda_handler(event, None)["statusCode"], 200)
            event["requestContext"]["authorizer"]["jwt"]["claims"] = self.resident
            self.assertEqual(api_module.lambda_handler(event, None)["statusCode"], 403)
            event["requestContext"]["authorizer"]["jwt"]["claims"] = {**self.responder, "token_use": "id"}
            self.assertEqual(api_module.lambda_handler(event, None)["statusCode"], 403)


if __name__ == "__main__":
    unittest.main()
