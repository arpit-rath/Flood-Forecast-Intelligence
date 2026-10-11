# Varuna: Verified Flood and Road Intelligence for Delhi

Flood reports, congestion advisories, road-blockage observations, and response decisions often arrive through separate channels. Varuna is a decision-support prototype that brings source-backed road information into one place for Delhi residents and authorized responders. People can submit observations; responders verify them before they can change a road condition. **Unknown** is not known to be clear, and **Reported / Unverified** is not a confirmed blockage or a safety instruction.

[Open the hosted Varuna app](https://main.d9r54jpiln4dg.amplifyapp.com/). This URL is a site entry point, **not proof that every feature or the scheduled ingestion is deployed**. Follow on-ground traffic instructions, signs, and responders.

## Two deliberately separate experiences

| Experience | What it does | What it does not claim |
| --- | --- | --- |
| **Delhi real-road preview (`/v2`)** | Amazon Location **Standard** street map, with **Hybrid** satellite option; a fixed, attributed **84-way DTU-area OpenStreetMap extract**; private photo reporting and responder review; source-backed traffic-alert proposals. | The rest of Delhi is basemap context, not monitored road coverage. No Delhi-wide flood risk, real-road route recommendation, or condition inferred from satellite imagery. The preview is read-only if its `/v2` API is unavailable. |
| **Synthetic pilot (`/v1` Scenario)** | A reproducible 40-segment illustrative DTU-area grid, rainfall/risk snapshot, route-exposure comparison, private photo review, and comparison of two **Simulated** drain-clearance actions. | Not surveyed road geometry, Live weather, measured flood depth, or a guarantee that a route is passable. Pilot reports never appear on OSM roads. |

The real-road preview is the default in this source tree (`VITE_REAL_ROADS_PREVIEW=true`). Set it to `false` and rebuild to use the legacy synthetic interface. The `/v1` Scenario API remains available independently. A report starts **Pending Review** and cannot change condition or risk before a responder decision. A real-road clearance returns a way to **Unknown**, not “safe.”

## Main capabilities

- A pannable Delhi MapLibre view using Amazon Location Standard and Hybrid styles. Style changes retain camera position, selection, and eligible reviewed markers; missing map configuration or failed tiles show an explicit unavailable state.
- A versioned, server-validated OSM road snapshot. The 84 ways are a limited extract around DTU, not a complete city road network. Public real-road evidence contains only current, reviewed outcomes; pending, rejected, and expired reports are not public markers.
- Authenticated resident JPEG/PNG/WebP photo submissions (up to 8 MB) with **Pending Review** confirmation. Only `varuna-responder` members can list reports, open private review photos, and confirm a blockage, clear it, or reject it. Real-road observations expire from current evidence after 24 hours.
- A bounded Delhi Traffic Police HTML-alert adapter for the [official alerts listing](https://traffic.delhipolice.gov.in/en/news-alertadvisory/alerts) and same-origin detail pages only. It preserves source links, publication/end wording when stated, stated cause/location when present, fetched time, content hash, and parser version. The public feed shows provenance, last check, freshness/source health, and a bounded human-readable road-match proposal; private candidate IDs and reviewer data stay private. Imported alerts begin **Reported / Unverified**. A proposed match alone never blocks a road or changes route eligibility.
- A **30-minute EventBridge ingestion schedule defined but disabled by default**. Enable it only after a reviewed stack update, one manually inspected ingestion, source-policy/parser checks, privacy checks, and a separate approval. Source failures retain previous records with stale, degraded, or unavailable health rather than presenting them as current.
- A deterministic `/v1` risk, route-exposure, and two-drain intervention engine for the synthetic Scenario. Accepted pilot photo evidence affects only that labelled replay. There is no automatic AI image analysis in HTTP mode.

For real-road alerts, only a current, flood-related **responder-confirmed** blockage with a uniquely server-validated way and point can affect the internal route-eligibility gate. This is **not** a public real-road routing service. An ambiguous, unlocated, stale, or outside-coverage proposal remains unverified. Source timestamps and OSM edit timestamps are not interchangeable with current on-road observations.

## Architecture

The React/TypeScript frontend is built with Vite and MapLibre and hosted through **AWS Amplify Hosting**. **Amazon Location Service** supplies Standard/Hybrid basemap rendering. The Python API is packaged with **AWS SAM** into **AWS Lambda** behind **Amazon API Gateway**. **Amazon Cognito** managed login supplies access JWTs; **IAM** limits Lambda access to private **Amazon S3** photos and separate **Amazon DynamoDB** stores for pilot reports, real-road reports, and official-source alerts. An isolated ingestion Lambda is wired to an **Amazon EventBridge** 30-minute rule, disabled by default. **AWS CloudFormation** manages the SAM stack; the **AWS CLI** is used for reviewed deployment and manual verification. **Amazon CloudWatch** is the monitoring/alerting surface operators must configure and watch; this repository does not prove those alarms are active.

The template describes intended resources, but a local build or the presence of code does not deploy them. Cognito user-pool setup, Amplify branch settings, Location API key restrictions, budgets, and monitoring require operator configuration. Bedrock vision analysis, Live weather, a citywide road-condition feed, and real-road route recommendations are **not implemented as live capabilities**.

## Repository guide

| Path | Contents |
| --- | --- |
| [`frontend/`](frontend/README.md) | React views, MapLibre maps, API adapters, mock fixtures, unit and Playwright tests |
| [`backend/`](backend/varuna/) | Python Scenario engine, local API, real-road reporting, alert resolver and ingestion adapter; `backend/tests/` |
| [`contracts/`](contracts/README.md) | `/v1` and `/v2` wire contracts, TypeScript types and JSON schemas |
| [`infra/`](infra/README.md) | SAM template, explicit Lambda packaging script, deployment and privacy runbook |
| [`data/`](data/fixture/README.md) | Synthetic Scenario fixture; packaged real-road snapshot/context are sourced from `frontend/src/data/` |
| Root specifications | [Product requirements](Product%20Requirements%20Document.md), [architecture](Architecture.md), [agents](Agents.md), [design system](Design-System.md) |

The OSM snapshot's source, ODbL licence, retrieval date, limited bounding box, and deliberate refresh procedure are documented in [`frontend/src/data/README.md`](frontend/src/data/README.md). Never silently attach a report to a refreshed way; a new geometry version requires validation and a migration or expiry decision.

## Run locally

Use Python 3.12 and a current Node.js/npm installation. From the repository root, install the backend dependencies and start the loopback-only API in one terminal:

```powershell
python -m pip install -r requirements.txt
$env:VARUNA_LOCAL_USERS_JSON = '{"resident":{"password":"replace-for-local-demo","sub":"local-resident","groups":[]},"responder":{"password":"replace-for-local-demo","sub":"local-responder","groups":["varuna-responder"]}}'
python -m backend.varuna.local_server
```

These are throwaway **local-only** credentials; do not reuse real passwords or commit them. The API listens on `http://127.0.0.1:8000`, allows only loopback binding, and keeps local reports, photos, and sessions in memory. It does **not** run the official-site ingestion automatically.

In another terminal:

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

Edit the ignored `frontend/.env.local` for the desired mode. Vite serves `http://localhost:5173` by default.

| Local setting | Fixture/mock preview | Local API preview |
| --- | --- | --- |
| `VITE_REAL_ROADS_PREVIEW` | `true` for limited real-road UI; `false` for the synthetic pilot | Same choice |
| `VITE_USE_MOCKS` | `true` | `false` |
| `VITE_API_BASE_URL` | not required | `http://127.0.0.1:8000` |
| `VITE_LOCAL_AUTH` | `false` | `true` |

Mock mode is explicitly fixture-backed and has **no live alert API**. HTTP mode never silently falls back to mocks: an unavailable backend or `/v2` capability stays unavailable. For the legacy synthetic flow, set `VITE_REAL_ROADS_PREVIEW=false`; `Live` weather and post-intervention route advice remain unavailable. The default real-road preview is read-only until its `/v2` endpoints respond with the versioned snapshot.

Map styles are optional for no-key development. A usable Delhi basemap needs `VITE_DELHI_HYBRID_STYLE_URL=https://maps.geo.<region>.amazonaws.com/v2/styles/Hybrid/descriptor?key=<restricted-public-map-key>`; `VITE_DELHI_STANDARD_STYLE_URL` may supply a separate Standard descriptor, otherwise the frontend derives it from Hybrid. Without a usable URL or WebGL, the app explicitly reports a basemap failure and retains the sourced road list. The key is **browser-public**: restrict it to map-rendering actions and approved website referrers, never AWS credentials or Places/Routes/write permissions. Do not commit `.env.local` or a real key.

### Checks

From the repository root:

```powershell
python -m unittest discover -s backend/tests -q
Push-Location frontend
npm run typecheck
npm run lint
npm run test:unit
npm run build
npm run test:e2e
Pop-Location
python infra/package_lambda.py
sam validate --template-file infra/template.yaml --lint --region ap-south-1
sam build --template-file infra/template.yaml
```

Playwright uses installed Edge by default and covers 360, 1280, and 1920 px; set `PW_CHANNEL=chrome` for Chrome. Its config starts the Vite server and, when `VITE_USE_MOCKS=false`, a throwaway local API. Run the legacy suite with `VITE_REAL_ROADS_PREVIEW=false` in mock and HTTP modes; run `e2e/real-roads.spec.ts`, `e2e/road-alerts.spec.ts`, and `e2e/real-road-api.spec.ts` with `VITE_REAL_ROADS_PREVIEW=true` as appropriate. The map tests intercept test-only style requests and should not make real tile requests. Ensure an unrelated checkout is not already using ports 5173 or 8000. See [frontend test instructions](frontend/README.md) and [SAM packaging checks](infra/README.md); inspect both built Lambda artifacts for frontend files, tests, Git files, credentials, or Windows binaries before deployment.

## Deployment and configuration boundaries

The [infrastructure runbook](infra/README.md) is the source of truth for exact SAM packaging, change-set review, and the two-stage ingestion gate. The repository records this API base URL: `https://u5o73tqvd8.execute-api.ap-south-1.amazonaws.com`. Verify it against the live stack's `ApiBaseUrl` output before configuring a new build; the live stack was **not** inspected for this README.

| Browser site | Origin for API Gateway and private S3 CORS (**no** trailing slash) | Cognito callback **and sign-out** URL (**with** trailing slash) |
| --- | --- | --- |
| Main hosted app | `https://main.d9r54jpiln4dg.amplifyapp.com` | `https://main.d9r54jpiln4dg.amplifyapp.com/` |
| Feature preview | `https://feature-delhi-hybrid-overview.d9r54jpiln4dg.amplifyapp.com` | `https://feature-delhi-hybrid-overview.d9r54jpiln4dg.amplifyapp.com/` |

For **both** Amplify builds, use the verified `ApiBaseUrl` as `VITE_API_BASE_URL`, `VITE_USE_MOCKS=false`, `VITE_LOCAL_AUTH=false`, the existing Cognito managed-login HTTPS origin as `VITE_COGNITO_DOMAIN`, the existing **public** app-client ID as `VITE_COGNITO_CLIENT_ID`, and the site's exact callback as `VITE_COGNITO_REDIRECT_URI`. Set `VITE_PUBLIC_SIGNUP_ENABLED` to match Cognito's actual temporary self-sign-up setting; this is UI wording, not access control. Keep the main branch's existing app-wide settings unchanged unless an explicit cutover is approved. Apply feature-preview values as **branch-only Amplify overrides**, including `VITE_REAL_ROADS_PREVIEW=true`; use `false` and rebuild for the synthetic UI rollback. Main's build-time preview flag must likewise be checked against the intended rollout—merging code does not establish what the hosted site currently serves. Restrict the Amazon Location Standard/Hybrid key to map-reading and each approved referrer. Vite embeds these values at build time.

The SAM template requires the exact `AllowedOrigin` (main) and `AllowedPreviewOrigin` (preview) parameters above, plus the existing `CognitoJwtIssuer` and `CognitoJwtAudience` values; no wildcard CORS. Cognito resources are configured separately, not created by SAM. Review a **CloudFormation changeset before any deployment**, checking retained encrypted DynamoDB tables, private S3/CORS, JWT-protected routes, Lambda/IAM changes, paid alert-table PITR, and the EventBridge state. `RoadAlertScheduleState` defaults to `DISABLED`. Do not infer whether the existing deployed rule is enabled from this default: inspect the live stack/rule as an authorized operator. Keep it disabled through the first reviewed update, manually invoke and inspect one bounded ingestion, verify source health, redaction, costs, and `/v1` regression, then consider a **second reviewed** update to `ENABLED`. The exact operator commands and rollback sequence are in [`infra/README.md`](infra/README.md#phase-3-official-delhi-traffic-police-alerts-proposed-not-deployed). Nothing in this README requires a deployment.

## Security, privacy, and operational limits

- API Gateway validates Cognito access JWTs on protected routes; Lambda checks token use, subject, and `varuna-responder` group for private lists, photos, and review decisions. Newly self-registered users have resident-level submission access only. The browser uses managed login with authorization-code/PKCE and holds the access token only in page memory.
- Photos remain in a private, encrypted S3 bucket. A presigned multipart POST constrains the key, MIME type, and **1-byte to 8-MB** size at S3; the server also checks type, size, image decoding, and a 20-megapixel cap. It re-encodes a private JPEG review copy without image metadata. A responder-only detail request returns a **60-second** photo URL; that URL is a bearer capability and must not be shared or logged.
- Raw uploads expire after one day; sanitized review images and report metadata after seven days. The app filters expired records before asynchronous S3 lifecycle/DynamoDB TTL cleanup. Real-road condition evidence expires after 24 hours; alert-table records use 30-day TTL. Retained resources require an authorized cleanup decision after the pilot.
- API Gateway throttling is shared/best-effort, not a spending cap. The real-road upload-form endpoint has a per-user cap of ten requests per UTC day; `/v1` has no per-user quota, and reusable signed forms or multiple accounts remain abuse risks. Configure a low AWS Budget, CloudWatch monitoring/alarms, and a staffed abuse response before public uploads or scheduled ingestion. Review public sign-up and responder-group membership after the event.
- Public alert/evidence JSON uses explicit allowlists. Never expose credentials, private reviewer fields, candidate road IDs, private photo URLs, or reporter identities publicly. Source text and uploaded notes are untrusted input; only human-reviewed, server-validated evidence can alter a real-road condition.

## Data and safety limits

The 84-way OSM extract is static, DTU-area, and incomplete; [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) are credited under ODbL. The official Delhi Traffic Police site is the only source for the bounded automatic alert adapter, but a published advisory is still **Reported / Unverified** in Varuna until reviewed. Missing or degraded source fields are not inferred. Satellite imagery and OSM geometry do not establish current flooding or blockage. **Unknown does not mean Low**, and a cleared observation does not certify a road as safe.

Varuna does **not** provide guaranteed safe routes, Delhi-wide Live flood monitoring, precise flood depths, emergency dispatch, automated road closures, or an official government partnership. The synthetic `/v1` route comparison is an illustrative, ordinal exposure calculation—not real-time travel advice. Follow on-ground traffic instructions, barricades, signs, and emergency services over this prototype.
