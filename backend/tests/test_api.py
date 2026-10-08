from __future__ import annotations

import json
import unittest

from backend.varuna.api import dispatch, lambda_handler
from backend.varuna.service import VarunaService


class ApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = VarunaService()

    def test_http_contract_runs_the_complete_fixture_slice(self) -> None:
        pilot = dispatch(self.service, "GET", "/v1/pilot")
        self.assertEqual(200, pilot.status)
        self.assertEqual(40, len(pilot.body["segments"]))
        self.assertTrue(pilot.body["synthetic"])
        snapshot = dispatch(self.service, "GET", "/v1/snapshots/current", query={"mode": "Scenario"})
        self.assertEqual(200, snapshot.status)
        query = pilot.body["routeQuery"]
        route_body = {**query, "snapshotId": snapshot.body["id"]}
        routes = dispatch(self.service, "POST", "/v1/routes/compare", body=route_body)
        self.assertEqual(200, routes.status)
        self.assertEqual("Scenario", routes.body["mode"])
        self.assertTrue(routes.body["candidates"])
        actions = dispatch(self.service, "POST", "/v1/interventions/compare", body={
            **route_body, "selectedRouteId": routes.body["fastestRouteId"],
            "drainIds": ["D-01", "D-02"],
        })
        self.assertEqual(200, actions.status)
        self.assertEqual(["D-01", "D-02"], [item["drainId"] for item in actions.body["results"]])
        self.assertTrue(actions.body["simulated"])
        self.assertEqual(snapshot.body, self.service.snapshot())

    def test_live_mode_is_never_mislabelled_as_fixture(self) -> None:
        response = dispatch(self.service, "GET", "/v1/snapshots/current", query={"mode": "Live"})
        self.assertEqual(503, response.status)
        self.assertEqual("mode_unavailable", response.body["error"]["code"])
        bad = dispatch(self.service, "GET", "/v1/snapshots/current", query={"mode": "live-ish"})
        self.assertEqual(400, bad.status)

    def test_bad_body_and_wrong_drain_set_are_rejected(self) -> None:
        malformed = dispatch(self.service, "POST", "/v1/routes/compare", body=[])
        self.assertEqual(400, malformed.status)
        self.assertEqual("invalid_body", malformed.body["error"]["code"])
        bad_drains = dispatch(self.service, "POST", "/v1/interventions/compare", body={"drainIds": ["D-01", "D-01"]})
        self.assertEqual(400, bad_drains.status)

    def test_review_requires_operator_and_changes_snapshot_only_after_acceptance(self) -> None:
        before = self.service.snapshot()["id"]
        path = "/v1/reports/fixture-report-pending/review"
        forbidden = dispatch(self.service, "PATCH", path, body={"reviewStatus": "Accepted"},
                             allow_local_mutations=True, operator_token="test-token")
        self.assertEqual(403, forbidden.status)
        self.assertEqual(before, self.service.snapshot()["id"])
        accepted = dispatch(self.service, "PATCH", path, body={"reviewStatus": "Accepted"},
                            headers={"Authorization": "Bearer test-token"},
                            allow_local_mutations=True, operator_token="test-token")
        self.assertEqual(200, accepted.status)
        self.assertEqual("Accepted", accepted.body["reviewStatus"])
        self.assertNotEqual(before, self.service.snapshot()["id"])

    def test_deployed_handler_is_read_only_and_returns_api_gateway_shape(self) -> None:
        event = {"version": "2.0", "rawPath": "/v1/snapshots/current",
                 "requestContext": {"requestId": "test-request", "http": {"method": "GET"}},
                 "queryStringParameters": {"mode": "Scenario"}}
        response = lambda_handler(event, None)
        self.assertEqual(200, response["statusCode"])
        self.assertEqual("Scenario", json.loads(response["body"])["mode"])
        event["rawPath"] = "/v1/reports"
        event["requestContext"]["http"]["method"] = "POST"
        event["body"] = json.dumps({"anything": "value"})
        write = lambda_handler(event, None)
        self.assertEqual(501, write["statusCode"])
        self.assertEqual("not_implemented", json.loads(write["body"])["error"]["code"])

    def test_invalid_json_is_a_client_error(self) -> None:
        event = {"version": "2.0", "rawPath": "/v1/routes/compare",
                 "requestContext": {"requestId": "test-request", "http": {"method": "POST"}},
                 "body": "{not-json"}
        response = lambda_handler(event, None)
        self.assertEqual(400, response["statusCode"])


if __name__ == "__main__":
    unittest.main()
