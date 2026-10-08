# Backend contract

The JSON schemas define the wire shape for `Segment` and `Report`. [`types.ts`](types.ts) defines the response types for TypeScript consumers. Coordinates are `[longitude, latitude]` in WGS84. Scores are ordinal 0–1 indicators, not water depth or flood probability. `null` means missing data; it must never be interpreted as zero.

## Read endpoints

| Request | Response |
| --- | --- |
| `GET /v1/pilot` | Pilot metadata, synthetic flag, segments, drains, default route query |
| `GET /v1/snapshots/current?mode=Scenario` | Versioned risk snapshot; `Live` returns 503 in fixture mode |
| `POST /v1/routes/compare` | `snapshotId`, `originNodeId`, `destinationNodeId`, `travelMode` → candidate paths and recommendation |
| `POST /v1/interventions/compare` | Same route fields plus `selectedRouteId` → two ranked simulated actions |

`Closed` is a road status separate from the numeric risk class. `Pending Review` belongs to a report and cannot influence risk until accepted. `Simulated` belongs to an intervention result and never overwrites the baseline snapshot. Scenario data is always labelled `Scenario` and has a synthetic provenance string.

## Integration sequence

1. Call `GET /v1/pilot`. It returns `segments` (each with a two-point `geometry` array), `drains`, `routeQuery`, `bundleVersion`, and `synthetic: true`.
2. Call `GET /v1/snapshots/current?mode=Scenario`. It returns `id`, `mode`, `computedAt`, `weather`, and a risk entry for each `segmentId`. Match those IDs to pilot segments. A risk entry has `class`, `roadStatus`, `score`, `coverage`, `features`, `missingFeatures`, `evidenceIds`, and `isClosed`.
3. Compare routes with the current snapshot ID:

   ```json
   {"snapshotId":"<current snapshot id>","originNodeId":"N-2-0","destinationNodeId":"N-2-4","travelMode":"Pedestrian"}
   ```

   The response includes `fastestRouteId`, `recommendedRouteId`, `reason`, and `candidates`. A candidate includes `segmentIds`, `travelMinutes`, `exposure`, `unknownShare`, `highestClass`, and `blocked`. A null route ID means no route was found.
4. Compare interventions using the same query plus the selected route:

   ```json
   {"snapshotId":"<current snapshot id>","originNodeId":"N-2-0","destinationNodeId":"N-2-4","travelMode":"Pedestrian","selectedRouteId":"R1","drainIds":["D-01","D-02"]}
   ```

   The response contains two ranked `results`, each with `simulated: true`, a before/after exposure, affected segment classes, and the drainage assumption. Render the baseline separately.

If the snapshot changes after review or closure, the previous ID returns `409 stale_snapshot`; refresh before route or intervention calls. `Live` returns `503 mode_unavailable` in fixture mode. All error bodies use `error.code`, `error.message`, `error.retryable`, and `error.requestId`.

## Local-only report and closure endpoints

The local server supports `POST /v1/reports` with the [report schema](report.schema.json), `GET /v1/reports`, `PATCH /v1/reports/{id}/review`, and `PATCH /v1/segments/{id}/closure`. New reports must start `Pending Review`; only `Accepted` reports can influence risk. Review, list, and closure calls require `Authorization: Bearer <VARUNA_OPERATOR_TOKEN>`. These changes live in process memory and reset when the server stops. `POST /v1/reports/upload-url` returns 501 because the fixture has no image storage.

The first local implementation uses in-memory report and closure state. Those writes are not durable and are disabled in the deployed infrastructure until an authenticated persistent adapter is added. The deterministic read slice is ready for frontend integration through these endpoints.
