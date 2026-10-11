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

   The response includes `fastestRouteId`, `recommendedRouteId`, `reason`, and `candidates`. A candidate includes `geometry` (WGS84 GeoJSON `LineString`), `segmentIds`, `travelMinutes`, `exposure`, `unknownShare`, `highestClass`, and `blocked`. A null route ID means no route was found. When no meaningful lower-exposure alternative exists, `reason` says so; the fastest route is not a safety claim.
4. Compare interventions using the same query plus the selected route:

   ```json
   {"snapshotId":"<current snapshot id>","originNodeId":"N-2-0","destinationNodeId":"N-2-4","travelMode":"Pedestrian","selectedRouteId":"R1","drainIds":["D-01","D-02"]}
   ```

   The response contains two ranked `results`, each with `simulated: true`, a before/after exposure, affected segment classes, and the drainage assumption. Render the baseline separately.

If the snapshot changes after review or closure, the previous ID returns `409 stale_snapshot`; refresh before route or intervention calls. `Live` returns `503 mode_unavailable` in fixture mode. All error bodies use `error.code`, `error.message`, `error.retryable`, and `error.requestId`.

## Photo reports and local-only closures

Both `POST /v1/reports/upload-url` and `POST /v1/reports` require a Cognito access token from a signed-in account, including a newly self-registered resident account during the temporary hackathon sign-up period (the local adapter uses a loopback-only demo session). The first takes `{idempotencyKey, contentType, sizeBytes}` and returns `{uploadUrl, uploadFields, imageKey, expiresAt, maxBytes}`. POST a multipart form to `uploadUrl`, appending every returned field followed by the `file` field; do not set the multipart Content-Type header yourself. S3's signed policy enforces a 1-byte to 8-MB content-length range, exact key and MIME type. Then create the report with that image key and idempotency key, pilot segment/point, optional note and capture time. The authenticated subject is bound server-side to both steps; browser-supplied user IDs are ignored. Supported types are JPEG, PNG and WebP, up to 8 MB/20 megapixels; the backend also checks size and decodes/re-encodes a private JPEG review copy without EXIF. New reports are always `Pending Review`, have `analysis.provider: none`, and do not affect risk.

`GET /v1/reports` returns metadata without photo URLs. `GET /v1/reports/{id}` returns a 60-second private photo URL. `PATCH /v1/reports/{id}/review` takes `{decision: "accept" | "reject", manualVisibleWater?: "none" | "possible" | "clear" | "uncertain"}`; acceptance requires the manual value. Only `varuna-responder` members can list, view, accept, or reject reports. API Gateway validates the access token's signature, issuer, audience, expiry and `openid` scope; Lambda checks `token_use=access`, subject and group. Repeated identical submission/review is idempotent; conflicting reuse returns 409. Local report storage is in process memory; AWS mode uses S3/DynamoDB. Uploaded metadata has a seven-day `expiresAt`; expired records are excluded from list/detail/risk before asynchronous DynamoDB TTL deletion. Synthetic fixture examples do not expire.

Acceptance replays the manual observation at the fixture `validAt` for the **synthetic Scenario** only. `scenarioValidAt` is separate from actual `createdAt`/`capturedAt`; this is not evidence of current Delhi conditions. Only Accepted evidence may change `O`, route exposure and a subsequent simulated comparison. The snapshot and route contracts are otherwise unchanged. There is no AI image analysis in HTTP mode and no public photo derivative.

`PATCH /v1/segments/{id}/closure` remains local-only and memory-backed; deployed closure persistence is not part of this slice.
