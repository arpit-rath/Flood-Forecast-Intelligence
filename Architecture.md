# Varuna — Architecture

**Version:** 1.0 · 8 October 2026  
**Scope:** One pilot area, 30–50 road segments, two user views

## 1. System shape

```mermaid
flowchart LR
  U[Resident and responder UI<br/>React + MapLibre] -->|HTTPS| API[API Gateway]
  API --> L[Python Lambda API]
  L --> D[(DynamoDB<br/>reports and scenarios)]
  L --> S[(Private S3<br/>images and pilot bundle)]
  L --> B[Amazon Bedrock<br/>image interpretation]
  L --> R[Amazon Location Service<br/>route alternatives]
  L --> W[Open-Meteo<br/>rain forecast]
  L --> E[Deterministic risk and<br/>intervention engine]
  E --> D
  H[Amplify Hosting] --> U
```

**Deployment choice:** React + TypeScript + Vite frontend on AWS Amplify Hosting; Python API on API Gateway + Lambda; private S3 for report media and versioned pilot files; DynamoDB for mutable reports/scenarios; Amazon Bedrock for image interpretation; Amazon Location Service for candidate routes. The risk and simulation logic lives in ordinary Python and remains runnable locally from fixed fixtures.

The AWS account, selected region, Bedrock model access, and Location Service availability must be checked at setup. If a service is unavailable, retain the documented interface and use a labelled local fixture for the demo; do not imply that fixture output came from a live AWS call. A deployed API plus S3 provides genuine AWS use even if a model is temporarily unavailable.

## 2. Source data and preparation

| Input | Initial source | Use | Known limit |
| --- | --- | --- | --- |
| Road lines and junctions | OpenStreetMap extract, manually checked around DTU | Pilot graph and snap targets | Missing or wrong pedestrian connections |
| Terrain | Copernicus GLO-30 where available, otherwise GLO-90 | Coarse relative low-point prior | Surface model at 30/90 m; does not resolve road drainage |
| Rain | Open-Meteo hourly precipitation forecast | Live rainfall context | Forecast is spatially coarse and uncertain |
| Demo rain | Versioned JSON scenario | Reproducible judging flow | Synthetic; clearly marked in UI |
| Drain | Two manually placed scenario nodes, checked against the pilot map | Intervention candidates | Illustrative choke points, not a verified drainage network |
| Photo report | User-uploaded image and chosen location | Local visible-hazard evidence | Can be stale, inaccurate, or mislocated |

The pilot bundle is a versioned GeoJSON/JSON package in S3: `segments.geojson`, `nodes.geojson`, `drains.geojson`, `terrain.json`, `scenario.json`, and `manifest.json` with source URLs, licences, preparation date, and checksums. Use one immutable bundle version per demo run.

## 3. Domain model

| Entity | Required fields |
| --- | --- |
| `Segment` | `id`, `geometry`, `fromNode`, `toNode`, `lengthM`, `terrainPrior?`, `drainageVulnerability?`, `source`, `bundleVersion` |
| `Report` | `id`, `segmentId`, `point`, `createdAt`, `capturedAt?`, `imageKey`, `reviewStatus`, `observations`, `modelConfidence?`, `source` |
| `WeatherSnapshot` | `mode: live|scenario`, `precipitationMmH`, `validAt`, `fetchedAt`, `provider`, `scenarioId?` |
| `RiskSnapshot` | `segmentId`, `score?`, `class`, `coverage`, `features`, `evidenceIds`, `computedAt`, `modelVersion` |
| `RouteCandidate` | `id`, `geometry`, `travelMinutes`, `segmentIds`, `exposure`, `blocked`, `provenance` |
| `InterventionRun` | `id`, `drainId`, `baselineSnapshotId`, `affectedSegmentIds`, `before`, `after`, `assumptions`, `createdAt` |
| `Closure` | `segmentId`, `status`, `reason`, `setBy`, `setAt`, `expiresAt?` |

`null` or absent inputs must remain unknown. Zero means an observed or curated zero, never “data unavailable.” All public API times use ISO 8601 UTC; the UI formats them for India Standard Time. Geometry uses WGS84 longitude/latitude, and distance calculations use a projected or geodesic method rather than raw degree subtraction.

## 4. Risk engine (pilot heuristic v1)

The score is an **ordinal risk indicator**, not an estimated water depth or flood probability. Normalize each available feature to 0–1:

- `R`: rainfall intensity against pilot scenario thresholds.
- `T`: relative terrain susceptibility among pilot segments, with low points scoring higher.
- `D`: curated drainage vulnerability, including the known blocked drain.
- `O`: accepted, recent observation evidence on the segment. A one-hop connected neighbour can receive attenuated context only if it is also lower lying; never auto-copy a report across the graph.

Base weights: `R 0.35`, `T 0.25`, `D 0.20`, `O 0.20`. Compute `score = sum(weight × feature) / sum(weights of available features)`. Also calculate `coverage = sum(weights of available features)` and publish the feature values. This normalization prevents an absent report from becoming an artificial zero. Weather and at least one local context feature (`T` or `D`) are required for a numeric score. Otherwise return `Unknown`.

Initial display bands: Low `< 0.35`, Watch `0.35–<0.60`, High `≥ 0.60`. These are product thresholds for comparison, to be fixed in versioned configuration and tested on scenarios. Show `Low confidence` when coverage is below 0.80 or the weather/report is stale. A confirmed closure is a separate operator state and overrides route eligibility regardless of score.

An accepted report changes `O` only on its snapped segment and, where the rule above applies, a single neighbour. Rejected and pending reports do not enter the public score. Every recalculation produces an immutable `RiskSnapshot` referenced by route and intervention results.

## 5. Route selection

1. Request available alternative route geometries and travel times from Amazon Location Service for the selected mode.
2. Intersect each geometry with pilot road segments using a small buffered corridor. Record unmatched route length; a candidate with substantial unmatched length is `unassessed`.
3. Exclude candidates crossing an operator-confirmed closed segment. Do not turn a high heuristic score into a hard closure.
4. For each remaining candidate, calculate `exposure = Σ(segment distance on route × segment score) / total assessed route distance`. Also surface the maximum segment class and the share of route length with unknown risk.
5. Select the lower-exposure candidate only if it meaningfully improves on the fastest route; use a configurable threshold (initially ≥ 0.10 lower exposure) and show its additional minutes. Otherwise present the fastest as the default with an exposure note.

Do not return “safe” if every candidate is high, unknown, or blocked. Show the comparison and “No lower-exposure route found.” If Location Service returns no viable alternatives, the user gets an explicit unavailable state. The pilot graph can supply a labelled, deterministic replay route for the demo, but it is not represented as a live provider route.

## 6. Intervention simulation

The P0 action is **clear a modelled blocked drain**. Each of two scenario nodes has an explicitly curated set of affected segments. The simulator reduces `D` on those segments by a configured amount (initial pilot assumption: `−0.5`, floored at zero), recalculates scores, and re-scores the same route candidates. It leaves rain, terrain, and observation evidence untouched.

Run both candidates against the same baseline. Rank first by reduction in exposure on the user's selected route, then by the number of segments moving out of High, then by stable drain ID. Return a before/after table of segment classes, exposure, and affected route count. If neither has an estimated benefit, say so. Do not write either simulated result over baseline data. Store assumptions with each run so the demo can explain what changed. This is a comparative “what if” estimate; it cannot predict how quickly real water would clear.

## Current report adapter boundary

The current report slice stores uploads privately in S3 and metadata in DynamoDB when deployed; local mode uses in-memory equivalents. Cognito managed login uses authorization-code/PKCE with temporary public self-sign-up for the hackathon. New accounts have resident-level access; only an administrator adds users to `varuna-responder`. `POST /v1/reports/upload-url` and `POST /v1/reports` require a validated access token; any signed-in user may submit. The server derives upload/report ownership from token `sub`, never a browser user ID. A signed S3 multipart POST enforces the 8 MB content-length range; the backend separately validates type, size, and decoded JPEG/PNG/WebP pixels (20 MP maximum), then strips metadata from the private review JPEG. `GET /v1/reports`, `GET /v1/reports/{id}`, and review require `varuna-responder`; only detail issues a 60-second private photo URL. API Gateway validates JWT signature/issuer/audience/expiry plus `openid` scope; Lambda checks access-token use, subject and group. Creation is idempotent. Pending Review has no model observation. Acceptance requires a manual visible-water choice; it enters `O` as a labelled historical Scenario replay, not Live evidence. Pilot upload metadata and review photos have seven-day retention; expired metadata is hidden and removed from risk before DynamoDB TTL cleanup. The deployed adapter does not invoke Bedrock, persist closures, or recompute post-intervention route advice. The diagram and later Bedrock/ScenarioRuns/Closures sections remain target architecture, not deployed claims.

### Real-map preview boundary

The feature preview mounts a separate React/MapLibre experience and does not load the pilot graph, Scenario snapshot, route candidates, interventions, or `/v1` reports. Its default Amazon Location Standard map and optional Hybrid map share one camera and one OSM GeoJSON overlay. The checked-in road snapshot is a one-time, manually exported OSM API extract; its WGS84 way IDs and geometry are never treated as the synthetic `H-*` pilot graph. The new `/v2/roads` handler returns that exact snapshot with a SHA-256 geometry version. A report may propose a way and point, but the server checks the version, coverage box, nearest way (within 12 m), and at least 5 m separation from the next nearest way before snapping the point. This conservative matching rejects junctions and parallel-road ambiguity rather than guessing. The separate `/v2/real-road-reports` workflow reuses the Cognito authorizer and private-photo store with `uploads/real-road/` and `review/real-road/` keys, but writes to a new table so real reports cannot enter synthetic `/v1` risk. The public evidence feed includes only current, reviewed Confirmed Blockage or Cleared outcomes and a strict non-private field allowlist; Pending Review is visible only in the responder-authorized queue and never changes a road's Unknown condition. Only responder-authorized detail issues a 60-second photo capability. Review is manual and current evidence expires after 24 hours; metadata and sanitized review photos expire after seven days. The browser remains read-only if the `/v2` API is unavailable. The existing `/v1` routes, handler, and Scenario behavior are unchanged; the new table, policy, routes, and Lambda package are proposed code only until separately deployed.

### Local road-alert boundary (Phase 1 source review + Phase 2 candidate resolver)

`RoadAlertSource` normalizes manually curated source documents without fetching the internet. The Delhi Traffic Police adapter fixes source identity, validates HTTPS provenance, retains raw source wording, and derives a stable source/link deduplication key. The provider-neutral resolver uses the exact OSM snapshot version and a small, explicitly sourced and reviewed local context file. It checks exact name/reference, reviewed alias, shared-node intersection, landmark plus locality, source-linked point within 25 m, then sourced landmark point within 60 m; a source point with under 5 m separation from the next way is ambiguous. Higher-priority ambiguous evidence is never overridden by a lower tier. Each candidate carries method, evidence, distance/margin when geographic, confidence category, source URL, contextual label and geometry version. The result is one of `matched_candidate`, `ambiguous`, `unlocated`, `outside_coverage`, `stale_snapshot`, or `invalid_source_location`. An unnamed way never acquires an official name from context. The local in-memory alert store and `/v2/road-alerts` routes are wired only by the loopback Python server. Lambda receives no alert workflow and responds unavailable; no SAM, persistence, Cognito or API Gateway changes are part of these local phases. Public responses contain a bounded unique proposal label/method/confidence only while current and unreviewed; no candidate ID, full source text, reviewer identity/reason, resident photo details or private source error. Responder-only import/list/detail/review uses the existing local session claims. Candidate matching never changes condition, Scenario risk or route eligibility. A deterministic internal eligibility helper excludes only a uniquely validated, current, responder-confirmed flood blockage; clearing returns Unknown. No real-road route recommendation is produced. Future geocoder/feed integration requires source permissions, rate limits, provenance, retention and a separate persistence/deployment review.

Named-road context in `nearRoadNames` is separate from direct `roadNames`: it is accepted only when the named OSM way lies within 120 m of the reviewed landmark point. The candidate way still must lie within 60 m of that landmark. Cause and source times inform provenance/freshness and confirmation eligibility, not road geometry.

### Phase 3: isolated official-source ingestion (proposed, not deployed)

An isolated scheduled Lambda calls the official Delhi Traffic Police robots policy, then one alerts listing request and at most ten new/changed same-origin HTML detail requests, sequentially. It uses a descriptive Varuna User-Agent, ten-second HTTP timeout, 512 KiB response bound, conditional ETag/Last-Modified requests, no redirects and no automatic retries. A successful robots policy is obeyed; a non-429 4xx is recorded as `robots_unavailable` and leaves the strict source allowlist unchanged. Applicable Disallow, 429 (with persisted Retry-After), 5xx/network failure, malformed successful policy or uncertain evaluation fails closed. Layout drift retains prior records with degraded/unavailable source health until operational expiry. The 30-minute EventBridge rule is `DISABLED` by default and has no retry attempts. The source adapter stores immutable URL-plus-raw-hash source revisions and parser-versioned projections. A changed page or parser cannot silently inherit a prior responder decision. Phase 2 matching runs on the pinned OSM snapshot and packaged reviewed context. Automatic import never writes real-road or pilot report tables, and never changes road condition, Scenario risk or route eligibility. Only existing authenticated responder review with a server-validated way/point can open the local route-eligibility gate.

The separate encrypted, on-demand `VarunaRoadAlerts` table stores alert records and source/check metadata as JSON payloads. Its 30-day TTL is also enforced in application reads before DynamoDB's asynchronous cleanup; `Retain` protects against accidental stack deletion, and seven-day PITR is explicitly enabled (paid). The API Lambda has read/write permissions for review and manual import; the ingestion Lambda has only GetItem/PutItem on this table. API Gateway adds four JWT-protected responder routes; Lambda also verifies group membership. Public output uses a fixed alert allowlist plus a fixed source-health allowlist. No private resident report, reviewer identity, candidate road ID or internal score crosses the public boundary. This is a proposed stack change requiring a reviewed changeset and official-site access/robots check; no deployment or live ingestion is claimed.

Parser v2 uses only the listing alert-teaser `h2` link as headline and labelled Drupal fields inside a `node-news-alert` detail article for body, dates and reference link. Cause and location come only from explicit source wording. Missing or contaminated detail fields produce a listing-headline-only, unavailable projection and `degraded` source health. Date plus local clock wording is preserved without inventing a timezone. A parser-version change forces an unconditional bounded detail refetch even after a 304 listing response. A new immutable projection ID includes the parser version; `sourceRevisionId` continues to identify canonical URL plus raw-content SHA-256. Older projections remain in the private audit until TTL, while only the active projection per official detail URL appears publicly. No review decision transfers to the new projection; any still-current prior confirmation continues to constrain the internal route gate. The public alert feed omits matched road IDs and review times entirely, so only the separate reviewed real-road evidence feed can colour an individual map road.

## 7. API surface

| Method and path | Purpose |
| --- | --- |
| `GET /v1/pilot` | Pilot geometry, sources, version, and map metadata |
| `GET /v1/snapshots/current?mode=` | Weather and risk snapshot for live or scenario mode |
| `POST /v1/reports/upload-url` | Short-lived presigned S3 upload URL |
| `POST /v1/reports` | Report metadata and image key; starts interpretation |
| `PATCH /v1/reports/{id}/review` | Authorized accept/reject action |
| `PATCH /v1/segments/{id}/closure` | Authorized set/clear of a confirmed closure, with audit metadata |
| `POST /v1/routes/compare` | Origin, destination, travel mode, snapshot ID → alternatives |
| `POST /v1/interventions/compare` | Two drain IDs + baseline snapshot ID + selected route → ranked before/after comparison |

Validate input geometry inside pilot bounds, file type and size, enum values, and report timestamps. Return structured errors (`code`, `message`, `retryable`, `requestId`). Long-running image interpretation may return a pending report and complete asynchronously; the UI polls its status. Use idempotency keys on report creation and simulation requests.

## 8. AWS, security, and operations

- **Identity:** Public demo can read pilot and scenario data. Report review and intervention authoring require an operator identity. Use a simple authenticated operator account; never put AWS credentials or Bedrock access in the browser.
- **S3:** Private media bucket, short-lived presigned upload URLs, encryption at rest, object lifecycle for demo media. Strip EXIF GPS from displayed derivatives.
- **DynamoDB:** `Reports` keyed by report ID with a segment/time index; `ScenarioRuns` keyed by run ID; `Closures` keyed by segment ID with an audit trail. TTL may remove demo reports after the event, with a retained fixture for replay.
- **Lambda:** One API handler or a small group of handlers, bounded timeouts, request IDs, structured logs, and environment variables for table/bucket/model IDs.
- **Bedrock:** Invoke a vision-capable model using Converse; validate its JSON against a schema and reject invalid or unsafe output. Check model access and pricing in the chosen region during setup.
- **Cost:** Set an AWS budget alarm before running the demo; limit image dimensions, API rate, and model calls; cache unchanged risk snapshots.
- **Reliability:** Weather provider failure returns the last timestamped snapshot or offers scenario mode. Model failure leaves the report pending/manual review. Routing failure presents the map and an unavailable message; it does not invent a route.

## 9. Verification before submission

- Unit tests: score normalization, missing-data behavior, report acceptance, one-hop rule, closure exclusion, intervention isolation.
- Fixture integration test: identical scenario inputs produce identical segment rankings and route exposures.
- API smoke test: upload → interpretation → review → updated snapshot → route comparison → intervention comparison.
- Visual check: phone and desktop, keyboard navigation, legend, timestamps, unknown state, scenario label.
- AWS proof: record one real backend request, S3 object, and Bedrock response for the demo, with no keys or private identifiers visible.

## 10. Sources

- [Amazon Bedrock Converse image input](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html)
- [Amazon Location Service route alternatives](https://docs.aws.amazon.com/location/latest/developerguide/calculate-routes-alternate.html)
- [Copernicus DEM on AWS](https://registry.opendata.aws/copernicus-dem/)
- [Open-Meteo Forecast API](https://open-meteo.com/en/docs)
- [Product Requirements Document.md](Product%20Requirements%20Document.md), [Agents.md](Agents.md), [Design-System.md](Design-System.md)
