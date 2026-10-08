# Backend contract

The JSON schemas define the wire shape for `Segment` and `Report`. Coordinates are `[longitude, latitude]` in WGS84. Scores are ordinal 0–1 indicators, not water depth or flood probability. `null` means missing data; it must never be interpreted as zero.

## Read endpoints

| Request | Response |
| --- | --- |
| `GET /v1/pilot` | Pilot metadata, synthetic flag, segments, drains, default route query |
| `GET /v1/snapshots/current?mode=Scenario` | Versioned risk snapshot; `Live` returns 503 in fixture mode |
| `POST /v1/routes/compare` | `snapshotId`, `originNodeId`, `destinationNodeId`, `travelMode` → candidate paths and recommendation |
| `POST /v1/interventions/compare` | Same route fields plus `selectedRouteId` → two ranked simulated actions |

`Closed` is a road status separate from the numeric risk class. `Pending Review` belongs to a report and cannot influence risk until accepted. `Simulated` belongs to an intervention result and never overwrites the baseline snapshot. Scenario data is always labelled `Scenario` and has a synthetic provenance string.

The first local implementation uses in-memory report and closure state. Those writes are not durable and are disabled in the deployed infrastructure until an authenticated persistent adapter is added. The deterministic read slice is ready for frontend integration through these endpoints.
