"""Anonymous v2 intake is bounded, private, and independent of Scenario."""

import json
import re
import unittest
import boto3
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from unittest.mock import Mock, patch

from PIL import Image

from backend.varuna import api as api_module
from backend.varuna.api import dispatch
from backend.varuna.real_roads import DynamoRealRoadStore, MemoryRealRoadStore, RealRoadWorkflow, RoadSnapshot
from backend.varuna.reporting import MAX_BYTES, MemoryMedia
from backend.varuna.service import VarunaService


def photo() -> bytes:
    output = BytesIO()
    Image.new("RGB", (4, 4), (10, 20, 30)).save(output, format="PNG")
    return output.getvalue()


class AnonymousRealRoadTests(unittest.TestCase):
    def setUp(self):
        self.service = VarunaService()
        self.snapshot = RoadSnapshot()
        self.media = MemoryMedia()
        self.store = MemoryRealRoadStore()
        self.workflow = RealRoadWorkflow(self.snapshot, self.store, self.media, anonymous_enabled=True, anonymous_daily_limit=3)
        self.responder = {"sub": "operator", "token_use": "access", "cognito:groups": ["varuna-responder"]}
        self.reference = self.unambiguous_reference()

    def unambiguous_reference(self):
        for feature in self.snapshot.roads.values():
            coordinates = feature["geometry"]["coordinates"]
            for a, b in zip(coordinates, coordinates[1:]):
                candidate = {"roadId": feature["id"], "geometryVersion": self.snapshot.version,
                             "point": [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]}
                try:
                    self.snapshot.match(candidate)
                    return candidate
                except ValueError:
                    pass
        self.fail("no unique OSM reference in fixture")

    def call(self, method, path, body=None, claims=None):
        return dispatch(self.service, method, path, body=body, operator_claims=claims, real_roads=self.workflow)

    def ticket(self, road=None, raw=None, mime="image/png"):
        raw = photo() if raw is None else raw
        return self.call("POST", "/v2/public/real-road-reports/upload-url", {
            "road": self.reference if road is None else road, "contentType": mime, "sizeBytes": len(raw)}), raw

    def draft(self, ticket, note="A road observation"):
        return {"submissionToken": ticket["submissionToken"], "imageKey": ticket["uploadFields"]["key"],
                "road": self.reference, "capturedAt": None, "note": note}

    def submit(self):
        ticket_response, raw = self.ticket()
        self.assertEqual(ticket_response.status, 200)
        ticket = ticket_response.body
        self.media.put_upload(ticket["uploadFields"]["key"], raw, "image/png", ticket["uploadFields"])
        draft = self.draft(ticket)
        return self.call("POST", "/v2/public/real-road-reports", draft), draft, ticket

    def test_default_kill_switch_and_public_upload_is_no_jwt(self):
        disabled = RealRoadWorkflow(self.snapshot, MemoryRealRoadStore(), MemoryMedia())
        self.assertFalse(disabled.anonymous_enabled)
        response = dispatch(self.service, "POST", "/v2/public/real-road-reports/upload-url", body={"road": self.reference}, real_roads=disabled)
        self.assertEqual(response.status, 503)
        self.assertEqual(dispatch(self.service, "POST", "/v2/public/real-road-reports", body={}, real_roads=disabled).status, 503)
        ticket, _ = self.ticket()
        self.assertEqual(ticket.status, 200)
        self.assertEqual(set(ticket.body), {"uploadUrl", "uploadFields", "submissionToken", "expiresAt", "maxBytes"})
        self.assertTrue(ticket.body["uploadFields"]["key"].startswith("uploads/real-road/anonymous/"))
        self.assertNotIn("imageKey", ticket.body)
        self.assertNotIn("bucket", ticket.body)
        self.assertLessEqual((datetime.fromisoformat(ticket.body["expiresAt"].replace("Z", "+00:00")) - datetime.now(timezone.utc)).total_seconds(), 300)

    def test_sam_public_routes_throttled_and_private_routes_keep_jwt(self):
        template = (Path(__file__).resolve().parents[2] / "infra/template.yaml").read_text(encoding="utf-8")
        events = template.split("      Events:\n", 1)[1].split("\n  VarunaRoadAlertIngest:", 1)[0]
        blocks = dict(re.findall(r"(?ms)^        (\w+):\n(.*?)(?=^        \w+:\n|\Z)", events))
        upload = blocks["PublicRealRoadUploadRequest"]
        create = blocks["PublicRealRoadCreate"]
        for block, path, burst, rate in (
            (upload, "/v2/public/real-road-reports/upload-url", 1, 0.2),
            (create, "/v2/public/real-road-reports", 2, 0.5),
        ):
            self.assertIn("Path: " + path + "\n", block)
            self.assertIn("Method: POST", block)
            self.assertNotIn("Auth:", block)
            self.assertIn(f"ThrottlingBurstLimit: {burst}", block)
            self.assertIn(f"ThrottlingRateLimit: {rate}", block)
        for name in ("ProtectedUploadRequest", "ProtectedReportCreate", "ProtectedReportList",
                     "ProtectedReportDetail", "ProtectedReportReview", "ProtectedRealRoadUploadRequest",
                     "ProtectedRealRoadCreate", "ProtectedRealRoadList",
                     "ProtectedRealRoadDetail", "ProtectedRealRoadReview", "ProtectedRoadAlertQueue",
                     "ProtectedRoadAlertDetail", "ProtectedRoadAlertReview"):
            self.assertIn("Authorizer: CognitoAccessJwt", blocks[name], name)
        self.assertRegex(template, r"AnonymousRealRoadReportingEnabled:\s+Type: String\s+Default: 'false'")
        self.assertIn("State: !Ref RoadAlertScheduleState", template)

    def test_pending_receipt_private_review_and_scenario_isolation(self):
        baseline = self.call("GET", "/v1/snapshots/current").body
        created, draft, _ = self.submit()
        self.assertEqual(created.status, 201)
        self.assertEqual(set(created.body), {"id", "reviewStatus"})
        self.assertEqual(created.body["reviewStatus"], "Pending Review")
        for field in ("imageKey", "uploadFields", "uploadUrl", "photoUrl", "ownerSub", "reviewerSub", "note",
                      "candidateRoadIds", "tokenHash", "submissionToken", "uploadCount"):
            self.assertNotIn(field, created.body)
        report_id = created.body["id"]
        self.assertNotIn("ownerSub", self.store.get(report_id))
        retry = self.call("POST", "/v2/public/real-road-reports", draft)
        self.assertEqual(retry.body, created.body)
        self.assertEqual(len(self.store.items), 1)
        self.assertEqual(self.call("GET", "/v2/real-road-evidence").body["evidence"], [])
        self.assertEqual(self.call("GET", "/v1/snapshots/current").body, baseline)
        for claims in (None, {"sub": "resident", "token_use": "access", "cognito:groups": []},
                       {"sub": "operator", "token_use": "id", "cognito:groups": ["varuna-responder"]},
                       {"token_use": "access", "cognito:groups": ["varuna-responder"]}):
            self.assertEqual(self.call("GET", "/v2/real-road-reports", claims=claims).status, 403)
            self.assertEqual(self.call("GET", f"/v2/real-road-reports/{report_id}", claims=claims).status, 403)
            self.assertEqual(self.call("PATCH", f"/v2/real-road-reports/{report_id}/review", {"decision": "confirm_blockage"}, claims).status, 403)
        detail = self.call("GET", f"/v2/real-road-reports/{report_id}", claims=self.responder)
        self.assertEqual(detail.status, 200)
        self.assertIn("photoUrl", detail.body)
        signed_photo = urlparse(detail.body["photoUrl"])
        photo_key = "review/real-road/" + signed_photo.path.rsplit("/", 1)[-1]
        capability = parse_qs(signed_photo.query)["token"][0]
        with self.assertRaises(PermissionError):
            self.media.private_photo(photo_key, "invalid")
        self.assertTrue(self.media.private_photo(photo_key, capability).startswith(b"\xff\xd8"))
        reviewed = self.call("PATCH", f"/v2/real-road-reports/{report_id}/review", {"decision": "confirm_blockage"}, self.responder)
        self.assertEqual(reviewed.body["reviewStatus"], "Confirmed Blockage")
        self.assertEqual(self.call("POST", "/v2/public/real-road-reports", draft).body, created.body)
        public = self.call("GET", "/v2/real-road-evidence").body["evidence"]
        self.assertEqual(public[0]["roadId"], self.reference["roadId"])
        for field in ("note", "id", "imageKey", "photoUrl", "ownerSub", "reviewerSub", "candidateRoadIds",
                      "tokenHash", "submissionToken", "uploadCount"):
            self.assertNotIn(field, public[0])
        self.assertEqual(self.call("GET", "/v1/snapshots/current").body, baseline)

    def test_invalid_or_changed_token_and_object_binding(self):
        ticket_response, raw = self.ticket()
        ticket = ticket_response.body
        draft = self.draft(ticket)
        self.assertEqual(self.call("POST", "/v2/public/real-road-reports", {**draft, "submissionToken": None}).status, 409)
        self.assertEqual(self.call("POST", "/v2/public/real-road-reports", {**draft, "submissionToken": "x" * 43}).status, 409)
        self.assertEqual(self.call("POST", "/v2/public/real-road-reports", {**draft, "imageKey": "uploads/real-road/anonymous/other"}).status, 409)
        self.assertEqual(self.call("POST", "/v2/public/real-road-reports", {**draft, "road": {**self.reference, "point": [77.0, 28.0]}}).status, 409)
        self.assertEqual(self.call("POST", "/v2/public/real-road-reports", {**draft, "road": {**self.reference, "geometryVersion": "sha256:stale"}}).status, 409)
        self.media.put_upload(ticket["uploadFields"]["key"], raw, "image/png", ticket["uploadFields"])
        created = self.call("POST", "/v2/public/real-road-reports", draft)
        self.assertEqual(created.status, 201)
        self.assertEqual(self.call("POST", "/v2/public/real-road-reports", {**draft, "note": "changed"}).status, 409)
        token_hash = next(iter(self.store.pending_uploads))
        self.store.pending_uploads[token_hash]["expiresAtEpoch"] = 1
        self.assertEqual(self.call("POST", "/v2/public/real-road-reports", draft).status, 409)

    def test_match_file_size_type_and_global_quota_fail_closed(self):
        bad = [
            {"road": {**self.reference, "roadId": "osm:way/99999999999"}, "contentType": "image/png", "sizeBytes": 4},
            {"road": {**self.reference, "geometryVersion": "sha256:stale"}, "contentType": "image/png", "sizeBytes": 4},
            {"road": {**self.reference, "point": [77.0, 28.0]}, "contentType": "image/png", "sizeBytes": 4},
            {"road": self.reference, "contentType": "image/gif", "sizeBytes": 4},
            {"road": self.reference, "contentType": "image/png", "sizeBytes": MAX_BYTES + 1},
        ]
        for body in bad:
            self.assertIn(self.call("POST", "/v2/public/real-road-reports/upload-url", body).status, (400, 409))
        shared = {}
        for road in self.snapshot.roads.values():
            for coordinate in road["geometry"]["coordinates"]:
                point = tuple(coordinate)
                if point in shared and shared[point] != road["id"]:
                    ambiguous = {**self.reference, "roadId": road["id"], "point": coordinate}
                    self.assertEqual(self.call("POST", "/v2/public/real-road-reports/upload-url", {
                        "road": ambiguous, "contentType": "image/png", "sizeBytes": 4}).status, 400)
                    break
                shared[point] = road["id"]
            else:
                continue
            break
        else:
            self.fail("snapshot has no ambiguous junction")
        self.assertEqual(self.store.anonymous_grants, {})
        for _ in range(3):
            self.assertEqual(self.ticket()[0].status, 200)
        self.assertEqual(self.ticket()[0].status, 429)
        self.assertEqual(self.call("GET", "/v2/real-road-evidence").body["evidence"], [])

    def test_invalid_image_and_mismatched_actual_upload_do_not_consume_token(self):
        ticket_response, raw = self.ticket(raw=b"not an image")
        ticket = ticket_response.body
        key = ticket["uploadFields"]["key"]
        self.media.put_upload(key, raw, "image/png", ticket["uploadFields"])
        draft = self.draft(ticket)
        self.assertEqual(self.call("POST", "/v2/public/real-road-reports", draft).status, 400)
        self.assertEqual(next(iter(self.store.pending_uploads.values()))["status"], "pending")
        self.media.uploads[key] = (photo(), "image/png")
        self.assertEqual(self.call("POST", "/v2/public/real-road-reports", draft).status, 409)
        second_ticket, valid_raw = self.ticket()
        self.media.uploads[second_ticket.body["uploadFields"]["key"]] = (valid_raw, "image/jpeg")
        self.assertEqual(self.call("POST", "/v2/public/real-road-reports", self.draft(second_ticket.body)).status, 409)
        third_ticket, valid_raw = self.ticket()
        self.media.put_upload(third_ticket.body["uploadFields"]["key"], valid_raw, "image/png", third_ticket.body["uploadFields"])
        with patch("backend.varuna.reporting.MAX_PIXELS", 10):
            self.assertEqual(self.call("POST", "/v2/public/real-road-reports", self.draft(third_ticket.body)).status, 400)

    def test_lambda_public_routes_and_dynamo_private_scan(self):
        event = {"rawPath": "/v2/public/real-road-reports/upload-url", "requestContext": {"http": {"method": "POST"}},
                 "body": '{"road":{},"contentType":"image/png","sizeBytes":1}'}
        with patch.object(api_module, "_LAMBDA_REAL_ROADS", self.workflow):
            self.assertNotEqual(api_module.lambda_handler(event, None)["statusCode"], 403)
        table = Mock()
        table.scan.return_value = {"Items": [
            {"id": "P#token", "payload": '{"roadId":"osm:way/1"}'},
            {"id": "AQ#day"},
            {"id": "RR-active", "payload": '{"id":"RR-active","expiresAtEpoch":4000000000}'},
        ]}
        store = object.__new__(DynamoRealRoadStore)
        store.table = table
        self.assertEqual([item["id"] for item in store.list()], ["RR-active"])

    def test_dynamo_quota_and_pending_commit_are_atomic(self):
        table = Mock()
        table.name = "test-real-road-reports"
        store = object.__new__(DynamoRealRoadStore)
        store.table = table
        binding = {"road": self.reference, "imageKey": "uploads/real-road/anonymous/hash"}
        expiry = int((datetime.now(timezone.utc) + timedelta(minutes=5)).timestamp())
        store.reserve_anonymous("hash", binding, 3, expiry)
        reservation = table.meta.client.transact_write_items.call_args.kwargs["TransactItems"]
        self.assertEqual(len(reservation), 2)
        self.assertEqual(reservation[0]["Update"]["ExpressionAttributeValues"][":limit"], 3)
        self.assertEqual(reservation[0]["Update"]["ExpressionAttributeValues"][":one"], 1)
        self.assertEqual(reservation[1]["Put"]["Item"]["id"], "P#hash")
        table.get_item.return_value = {"Item": {"id": "P#hash", "status": "pending",
                                                "expiresAtEpoch": expiry, "payload": json.dumps(binding)}}
        report = {"id": "RR-test", "reviewStatus": "Pending Review", "expiresAtEpoch": expiry}
        store.commit_anonymous("hash", report, "fingerprint")
        commit = table.meta.client.transact_write_items.call_args.kwargs["TransactItems"]
        self.assertEqual(len(commit), 2)
        self.assertIn("expiresAtEpoch > :now", commit[0]["Update"]["ConditionExpression"])
        self.assertEqual(commit[0]["Update"]["ExpressionAttributeValues"][":now"], int(datetime.now(timezone.utc).timestamp()))
        self.assertEqual(commit[1]["Put"]["Item"]["id"], "RR-test")

    def test_dynamo_transactions_serialize_numeric_operands_at_resource_boundary(self):
        fixed = datetime(2026, 10, 12, 12, 0, tzinfo=timezone.utc)

        class FixedDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return fixed if tz else fixed.replace(tzinfo=None)

        # Inert credentials and a loopback endpoint avoid the real credential
        # chain. Intercept the endpoint only after boto3 has transformed and
        # botocore has validated/serialized the request; no network is used.
        resource = boto3.resource("dynamodb", region_name="ap-south-1", endpoint_url="http://127.0.0.1:9",
                                  aws_access_key_id="test", aws_secret_access_key="test")
        table = resource.Table("test-real-road-reports")
        store = object.__new__(DynamoRealRoadStore)
        store.table = table
        binding = {"road": self.reference, "imageKey": "uploads/real-road/anonymous/hash"}
        expiry = int((fixed + timedelta(minutes=5)).timestamp())
        quota_expiry = int(datetime(2026, 10, 14, tzinfo=timezone.utc).timestamp())
        pending = {"id": "P#hash", "status": "pending", "expiresAtEpoch": expiry, "payload": json.dumps(binding)}
        report = {"id": "RR-test", "reviewStatus": "Pending Review", "expiresAtEpoch": expiry}
        item = {**report, "requestFingerprint": "fingerprint"}
        wire_calls = []

        def intercept_endpoint(operation, request):
            if operation.name == "TransactWriteItems":
                wire_calls.append(json.loads(request["body"]))
                return Mock(status_code=200), {}
            if operation.name == "GetItem":
                return Mock(status_code=200), {"Item": {
                    "id": {"S": pending["id"]}, "status": {"S": "pending"},
                    "expiresAtEpoch": {"N": str(expiry)}, "payload": {"S": pending["payload"]}}}
            self.fail(f"unexpected DynamoDB operation: {operation.name}")

        with patch.object(table.meta.client._endpoint, "make_request", side_effect=intercept_endpoint) as transport, \
                patch("backend.varuna.real_roads.datetime", FixedDatetime):
            store.reserve_anonymous("hash", binding, 3, expiry)
            self.assertEqual(store.commit_anonymous("hash", report, "fingerprint"), item)
            self.assertEqual(transport.call_count, 3)
        self.assertEqual(len(wire_calls), 2)
        reservation, commit = (call["TransactItems"] for call in wire_calls)
        self.assertEqual(reservation[0]["Update"]["Key"], {"id": {"S": "AQ#2026-10-12"}})
        self.assertEqual(reservation[0]["Update"]["ExpressionAttributeValues"],
                         {":expiry": {"N": str(quota_expiry)}, ":one": {"N": "1"}, ":limit": {"N": "3"}})
        self.assertEqual(reservation[1]["Put"]["Item"],
                         {"id": {"S": pending["id"]}, "status": {"S": "pending"},
                          "expiresAtEpoch": {"N": str(expiry)}, "payload": {"S": pending["payload"]}})
        self.assertEqual(commit[0]["Update"]["Key"], {"id": {"S": pending["id"]}})
        self.assertEqual(commit[0]["Update"]["ExpressionAttributeValues"],
                         {":consumed": {"S": "consumed"}, ":pending": {"S": "pending"},
                          ":payload": {"S": json.dumps({**binding, "fingerprint": "fingerprint"})},
                          ":now": {"N": str(int(fixed.timestamp()))}})
        self.assertEqual(commit[1]["Put"]["Item"],
                         {"id": {"S": report["id"]}, "reviewStatus": {"S": "Pending Review"},
                          "expiresAtEpoch": {"N": str(expiry)}, "payload": {"S": json.dumps(item)}})


if __name__ == "__main__":
    unittest.main()
