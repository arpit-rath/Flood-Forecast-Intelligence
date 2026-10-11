"""Private photo intake and human-review Scenario replay tests."""

import json
import os
import secrets
import unittest
from io import BytesIO
from unittest.mock import Mock, patch

from PIL import Image

from backend.varuna.api import dispatch
from backend.varuna import api as api_module
from backend.varuna.reporting import MAX_BYTES, DynamoReportStore, MemoryMedia, MemoryReportStore, ReportWorkflow, S3Media, sanitize_photo
from backend.varuna.service import VarunaService


def photo() -> bytes:
    stream = BytesIO()
    image = Image.new("RGB", (4, 4), (20, 40, 60))
    exif = Image.Exif()
    exif[271] = "private camera"
    image.save(stream, format="JPEG", exif=exif)
    return stream.getvalue()


class ReportWorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = VarunaService()
        self.media = MemoryMedia()
        self.workflow = ReportWorkflow(self.service, MemoryReportStore(), self.media)
        self.token = "local-test-operator"
        segment = self.service.fixture.segments[0]
        self.segment_id = segment.id
        a, b = segment.geometry
        self.midpoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        self.key = "reporting-test-key-0001"

    def call(self, method: str, path: str, body=None, authorized=False, anonymous=False, sub="resident-a"):
        return dispatch(
            self.service, method, path, body=body,
            operator_claims=None if anonymous else {"sub": sub, "token_use": "access", "cognito:groups": ["varuna-responder"] if authorized else []},
            reporting=self.workflow,
        )

    def submit(self, key: str | None = None, sub: str = "resident-a"):
        key = key or self.key
        raw = photo()
        ticket = self.call("POST", "/v1/reports/upload-url", {
            "idempotencyKey": key, "contentType": "image/jpeg", "sizeBytes": len(raw),
        }, sub=sub)
        self.assertEqual(ticket.status, 200)
        self.media.put_upload(ticket.body["imageKey"], raw, "image/jpeg", ticket.body["uploadFields"])
        body = {
            "idempotencyKey": key, "imageKey": ticket.body["imageKey"],
            "segmentId": self.segment_id, "point": self.midpoint,
            "note": "Standing water?", "capturedAt": None, "consentPublicDerivative": False,
        }
        return self.call("POST", "/v1/reports", body, sub=sub), body

    def test_invalid_files_and_outside_pilot_are_rejected(self):
        for content_type, size in (("image/gif", 2), ("image/jpeg", 0), ("image/jpeg", MAX_BYTES + 1)):
            result = self.call("POST", "/v1/reports/upload-url", {
                "idempotencyKey": self.key, "contentType": content_type, "sizeBytes": size,
            })
            self.assertEqual(result.status, 400)
        with self.assertRaises(ValueError):
            sanitize_photo(b"not an image", "image/jpeg")
        raw = photo()
        ticket = self.workflow.prepare_upload({"idempotencyKey": self.key, "contentType": "image/jpeg", "sizeBytes": len(raw)}, "resident-a")
        with self.assertRaises(ValueError):
            self.media.put_upload(ticket["imageKey"], raw, "image/png", ticket["uploadFields"])
        self.media.put_upload(ticket["imageKey"], raw, "image/jpeg", ticket["uploadFields"])
        result = self.call("POST", "/v1/reports", {
            "idempotencyKey": self.key, "imageKey": ticket["imageKey"],
            "segmentId": self.segment_id, "point": [77, 28], "note": "", "capturedAt": None,
        })
        self.assertEqual(result.status, 400)

    def test_pending_duplicate_private_access_and_accepted_scenario_effect(self):
        baseline = self.call("GET", "/v1/snapshots/current").body
        created, body = self.submit()
        self.assertEqual(created.status, 201)
        self.assertEqual(created.body["reviewStatus"], "Pending Review")
        self.assertEqual(created.body["analysis"]["provider"], "none")
        self.assertIsNone(created.body["imageUrl"])
        self.assertEqual(self.call("GET", "/v1/snapshots/current").body["id"], baseline["id"])
        report_id = created.body["id"]
        self.assertEqual(self.call("GET", "/v1/reports").status, 403)
        self.assertEqual(self.call("GET", f"/v1/reports/{report_id}").status, 403)
        self.assertEqual(self.call("PATCH", f"/v1/reports/{report_id}/review", {"decision": "accept", "manualVisibleWater": "clear"}).status, 403)
        self.assertEqual(self.call("POST", "/v1/reports", body).body["id"], report_id)
        self.assertEqual(self.call("POST", "/v1/reports", {**body, "note": "different"}).status, 409)
        detail = self.call("GET", f"/v1/reports/{report_id}", authorized=True)
        self.assertIn("token=", detail.body["imageUrl"])
        key = detail.body["imageKey"]
        self.assertGreater(len(self.media.private_photo(key, detail.body["imageUrl"].split("token=")[1])), 0)
        with self.assertRaises(PermissionError):
            self.media.private_photo(key, "")
        with Image.open(BytesIO(self.media.review_images[key])) as clean:
            self.assertFalse(clean.getexif())
        accepted = self.call("PATCH", f"/v1/reports/{report_id}/review", {"decision": "accept", "manualVisibleWater": "clear"}, True)
        self.assertEqual(accepted.status, 200)
        self.assertEqual(accepted.body["report"]["reviewStatus"], "Accepted")
        self.assertEqual(accepted.body["report"]["scenarioValidAt"], self.service.fixture.metadata["validAt"])
        after = self.call("GET", "/v1/snapshots/current").body
        self.assertNotEqual(after["id"], baseline["id"])
        self.assertIn(report_id, next(item for item in after["segments"] if item["segmentId"] == self.segment_id)["evidenceIds"])
        self.assertEqual(self.call("PATCH", f"/v1/reports/{report_id}/review", {"decision": "reject"}, True).status, 409)
        self.assertEqual(self.call("PATCH", f"/v1/reports/{report_id}/review", {"decision": "accept", "manualVisibleWater": "clear"}, True).status, 200)

    def test_rejection_does_not_change_risk_and_claims_require_responder_group(self):
        baseline = self.call("GET", "/v1/snapshots/current").body["id"]
        created, _ = self.submit("another-report-key-0002")
        report_id = created.body["id"]
        self.assertEqual(self.call("PATCH", f"/v1/reports/{report_id}/review", {"decision": "accept"}, True).status, 400)
        rejected = self.call("PATCH", f"/v1/reports/{report_id}/review", {"decision": "reject"}, True)
        self.assertEqual(rejected.status, 200)
        self.assertEqual(self.call("GET", "/v1/snapshots/current").body["id"], baseline)
        for claims in ({"sub": "r", "token_use": "id", "cognito:groups": "[varuna-responder]"}, {"sub": "r", "token_use": "access", "cognito:groups": "[other]"}):
            response = dispatch(self.service, "GET", "/v1/reports", reporting=self.workflow, operator_claims=claims)
            self.assertEqual(response.status, 403)
        response = dispatch(self.service, "GET", "/v1/reports", reporting=self.workflow, operator_claims={"sub": "r", "token_use": "access", "cognito:groups": "[varuna-responder]"})
        self.assertEqual(response.status, 200)

    def test_submission_requires_access_claims_and_binds_owner_server_side(self):
        request = {"idempotencyKey": self.key, "contentType": "image/jpeg", "sizeBytes": len(photo())}
        self.assertEqual(self.call("POST", "/v1/reports/upload-url", request, anonymous=True).status, 403)
        self.assertEqual(self.call("POST", "/v1/reports", {"idempotencyKey": self.key}, anonymous=True).status, 403)
        forged_id_token = dispatch(self.service, "POST", "/v1/reports/upload-url", body=request, reporting=self.workflow,
                                   operator_claims={"sub": "resident-a", "token_use": "id"})
        self.assertEqual(forged_id_token.status, 403)
        owner_ticket = self.call("POST", "/v1/reports/upload-url", request).body
        other_ticket = self.call("POST", "/v1/reports/upload-url", request, sub="resident-b").body
        self.assertNotEqual(owner_ticket["imageKey"], other_ticket["imageKey"])
        self.assertEqual(self.call("POST", "/v1/reports", {"idempotencyKey": self.key, "imageKey": owner_ticket["imageKey"]}, sub="resident-b").status, 400)
        self.assertEqual(self.call("GET", "/v1/reports", sub="resident-b").status, 403)
        created, body = self.submit("owner-bound-report-0004")
        self.assertEqual(self.workflow.store.items[created.body["id"]]["ownerSub"], "resident-a")
        self.assertEqual(self.call("POST", "/v1/reports", {**body, "ownerSub": "resident-b"}).body["id"], created.body["id"])
        self.assertEqual(self.workflow.store.items[created.body["id"]]["ownerSub"], "resident-a")

    def test_new_account_has_submission_only_and_accepted_evidence_is_scenario_only(self):
        baseline = self.call("GET", "/v1/snapshots/current").body
        self.assertEqual(baseline["mode"], "Scenario")
        created, _ = self.submit("self-registered-resident-0005", sub="new-self-registered-user")
        self.assertEqual(created.status, 201)
        self.assertEqual(created.body["reviewStatus"], "Pending Review")
        report_id = created.body["id"]
        self.assertEqual(self.call("GET", "/v1/snapshots/current").body["id"], baseline["id"])
        for path in ("/v1/reports", f"/v1/reports/{report_id}"):
            self.assertEqual(self.call("GET", path, sub="new-self-registered-user").status, 403)
        for decision in ("accept", "reject"):
            self.assertEqual(self.call("PATCH", f"/v1/reports/{report_id}/review", {"decision": decision, "manualVisibleWater": "clear"}, sub="new-self-registered-user").status, 403)
        self.assertEqual(self.call("GET", "/v1/reports", authorized=True).status, 200)
        accepted = self.call("PATCH", f"/v1/reports/{report_id}/review", {"decision": "accept", "manualVisibleWater": "clear"}, authorized=True)
        self.assertEqual(accepted.status, 200)
        scenario = self.call("GET", "/v1/snapshots/current").body
        self.assertEqual(scenario["mode"], "Scenario")
        self.assertNotEqual(scenario["id"], baseline["id"])
        live = dispatch(self.service, "GET", "/v1/snapshots/current", query={"mode": "Live"}, reporting=self.workflow)
        self.assertEqual(live.status, 503)

    def test_presigned_post_policy_and_oversized_upload_attempt(self):
        request = {"idempotencyKey": self.key, "contentType": "image/jpeg", "sizeBytes": len(photo())}
        ticket = self.call("POST", "/v1/reports/upload-url", request).body
        self.assertIn("uploadFields", ticket)
        self.assertEqual(ticket["uploadFields"]["key"], ticket["imageKey"])
        with self.assertRaises(ValueError):
            self.media.put_upload(ticket["imageKey"], b"x" * (MAX_BYTES + 1), "image/jpeg", ticket["uploadFields"])
        with self.assertRaises(ValueError):
            self.media.put_upload(ticket["imageKey"], photo(), "image/jpeg", {**ticket["uploadFields"], "upload-token": "other"})
        fake = Mock()
        fake.generate_presigned_post.return_value = {"url": "https://example.invalid", "fields": {"key": "uploads/k"}}
        media = object.__new__(S3Media)
        media.bucket, media.client = "private", fake
        media.prepare("uploads/k", "image/jpeg", 100)
        params = fake.generate_presigned_post.call_args.kwargs
        self.assertIn(["content-length-range", 1, MAX_BYTES], params["Conditions"])
        self.assertEqual(params["Fields"]["Content-Type"], "image/jpeg")

    def test_s3_upload_url_uses_lambda_region_and_signature_v4(self):
        with patch.dict(os.environ, {
            "AWS_REGION": "ap-south-1",
            "AWS_DEFAULT_REGION": "us-east-1",
            "AWS_ACCESS_KEY_ID": secrets.token_hex(12),
            "AWS_SECRET_ACCESS_KEY": secrets.token_hex(32),
            "AWS_EC2_METADATA_DISABLED": "true",
        }):
            upload = S3Media("varuna-regional-upload-test").prepare(
                "uploads/example.jpg", "image/jpeg", 1024,
            )

        self.assertEqual(
            upload["url"],
            "https://varuna-regional-upload-test.s3.ap-south-1.amazonaws.com/",
        )
        self.assertNotIn("s3.amazonaws.com", upload["url"])
        self.assertEqual(upload["fields"]["x-amz-algorithm"], "AWS4-HMAC-SHA256")
        self.assertIn("/ap-south-1/s3/aws4_request", upload["fields"]["x-amz-credential"])
        self.assertEqual(upload["fields"]["x-amz-server-side-encryption"], "AES256")

    def test_expired_metadata_is_hidden_before_ttl_cleanup_and_removed_from_risk(self):
        baseline = self.call("GET", "/v1/snapshots/current").body["id"]
        created, _ = self.submit("expiry-report-key-0003")
        report_id = created.body["id"]
        self.call("PATCH", f"/v1/reports/{report_id}/review", {"decision": "accept", "manualVisibleWater": "clear"}, True)
        self.assertNotEqual(self.call("GET", "/v1/snapshots/current").body["id"], baseline)
        self.workflow.store.items[report_id]["expiresAtEpoch"] = 1
        self.assertEqual(self.call("GET", f"/v1/reports/{report_id}", authorized=True).status, 404)
        listed = self.call("GET", "/v1/reports", authorized=True).body["reports"]
        self.assertNotIn(report_id, [item["id"] for item in listed])
        self.assertEqual(self.call("GET", "/v1/snapshots/current").body["id"], baseline)

    def test_dynamo_reads_filter_expired_records_before_background_ttl(self):
        table = Mock()
        table.scan.return_value = {"Items": [
            {"payload": json.dumps({"id": "expired", "expiresAtEpoch": 1})},
            {"payload": json.dumps({"id": "legacy", "source": "resident_upload"})},
            {"payload": json.dumps({"id": "active", "expiresAtEpoch": 4_000_000_000})},
        ]}
        table.get_item.return_value = {"Item": {"payload": json.dumps({"id": "expired", "expiresAtEpoch": 1})}}
        store = object.__new__(DynamoReportStore)
        store.table = table
        self.assertEqual([item["id"] for item in store.list()], ["active"])
        self.assertIsNone(store.get("expired"))

    def test_lambda_uses_gateway_claims_for_protected_reports(self):
        event = {
            "rawPath": "/v1/reports",
            "requestContext": {"http": {"method": "GET"}, "authorizer": {"jwt": {"claims": {"sub": "r", "token_use": "access", "cognito:groups": "[varuna-responder]"}}}},
        }
        with patch.object(api_module, "_LAMBDA_SERVICE", self.service), patch.object(api_module, "_LAMBDA_REPORTING", self.workflow):
            allowed = api_module.lambda_handler(event, None)
            self.assertEqual(allowed["statusCode"], 200)
            self.assertIn("reports", json.loads(allowed["body"]))
            event["requestContext"]["authorizer"]["jwt"]["claims"]["token_use"] = "id"
            self.assertEqual(api_module.lambda_handler(event, None)["statusCode"], 403)


if __name__ == "__main__":
    unittest.main()
