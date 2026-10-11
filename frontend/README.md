# Varuna frontend

React + TypeScript + Vite interface for the Varuna pilot: a landing page, the resident route view and the responder console. MapLibre GL renders the map. The UI follows [Design-System.md](../Design-System.md) and consumes the API described in [Architecture.md](../Architecture.md) §7.

## Run

```sh
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check and production build into frontend/dist
npm run lint       # oxlint
npm run test:unit  # API adapter, terrain contour and label unit checks
npm run fixtures   # regenerate mock fixture JSON
npm run test:e2e   # Playwright: landing and both core flows at 360 px and 1280 px
```

`test:e2e` uses the locally installed Microsoft Edge (`PW_CHANNEL=chrome` for Chrome) and starts the dev server itself. In mock mode it covers landing, resident/responder fixture flows, navigation and accessibility at 360 px and 1280 px. With `VITE_USE_MOCKS=false`, it starts the local Python API and tests Scenario/routing/interventions plus private photo submission and human review. Live remains unavailable. If another checkout already serves port 5173, stop it for HTTP-mode tests; the local API allows only `http://localhost:5173`. Automated map tests do not make real tile requests.

Views: `#/` (landing), `#/resident` and `#/responder`. Add `?map=static` before the hash (for example `/?map=static#/resident`) to see the static SVG fallback that replaces the interactive map when WebGL or the map style is unavailable.

## Configuration

Copy `.env.example` to `.env.local`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_USE_MOCKS` | `true` | `false` calls the API at `VITE_API_BASE_URL`; anything else uses local fixtures |
| `VITE_API_BASE_URL` | empty | Deployed API base URL (API Gateway) |
| `VITE_DELHI_HYBRID_STYLE_URL` | empty | Public Amazon Location Service Hybrid style descriptor URL for the Delhi-only overview |
| `VITE_COGNITO_DOMAIN` | empty | HTTPS Cognito managed-login origin for deployed sign-in |
| `VITE_COGNITO_CLIENT_ID` | empty | Public browser app-client ID, never a client secret |
| `VITE_COGNITO_REDIRECT_URI` | current site root | Exact Cognito allowed callback URL, without a fragment |
| `VITE_PUBLIC_SIGNUP_ENABLED` | `true` | Public UI wording only; set `false` and rebuild when Cognito self-sign-up is disabled |
| `VITE_LOCAL_AUTH` | `false` | Enable loopback-only demo sign-in when using the local Python API |

The Map coverage switch in the resident and responder workspaces separates two views. **Pilot scenario** keeps the neutral-background synthetic DTU-area grid and all risk, route, report and drain features. **Delhi satellite overview** displays only the Amazon Location Hybrid basemap, with no pilot overlays or citywide flood assessment. The Scenario/Live weather strip and pilot decision cards are absent from the Delhi view. Its persistent label says “Delhi basemap · flood risk not assessed outside the pilot.” Imagery is geographic context, not current flood evidence. The Delhi view does not extend the pilot's analysis area or imply citywide forecasting.

For Hybrid imagery, create an Amazon Location API key in the intended region, restrict it to **map-reading/rendering actions and the required map resource only**, and allow only approved website referrers (development and deployed domains). Then set the following in your ignored `frontend/.env.local` before starting Vite:

```text
VITE_DELHI_HYBRID_STYLE_URL=https://maps.geo.<region>.amazonaws.com/v2/styles/Hybrid/descriptor?key=<restricted-map-key>
```

This URL and key are public in the browser bundle and network requests, so a Location API key is **not** an AWS credential or a secret storage mechanism. Never commit a real key or `.env.local`; never grant Places, Routes, or write actions to this key. The frontend accepts only an HTTPS `maps.geo.<region>.amazonaws.com` Hybrid descriptor URL. With no key, an invalid URL, blocked tiles, or no WebGL, Delhi shows an explicit **basemap unavailable** state and a way back to the fully working pilot; it never renders the synthetic grid over Delhi streets. The former `VITE_BASEMAP_STYLE_URL` is intentionally no longer applied to the pilot, which always uses a neutral background.

Reference: [Amazon Location map styles](https://docs.aws.amazon.com/location/latest/developerguide/map-styles.html), [display a map](https://docs.aws.amazon.com/location/latest/developerguide/how-to-display-a-map.html), and [API-key restrictions](https://docs.aws.amazon.com/location/latest/APIReference/API_geoapikeys_ApiKeyRestrictions.html).

The browser never holds AWS credentials or Bedrock access. In deployed HTTP mode, Resident and Responder use Cognito managed login with authorization-code/PKCE. The managed login offers “Create an account” while temporary hackathon self-sign-up is enabled; the site uses the same sign-in action for both flows. After the event, disable Cognito self-sign-up, set `VITE_PUBLIC_SIGNUP_ENABLED=false` and rebuild/release the frontend so it advertises sign-in only; this flag does not enforce account policy. The access token is kept only in page memory, sent on protected report requests, and cleared on sign-out or expiry; refreshing the page requires signing in again. A new account has resident-level submission access, not review access. Any signed-in user can submit a Pending Review report; only administrator-assigned `varuna-responder` members can list, view, accept or reject private reports. The backend, not the browser's displayed role, enforces this. Do not put a Cognito client secret in frontend configuration.

For the connected `feature/delhi-hybrid-overview` Amplify preview, configure **branch-only** environment-variable overrides, not app-wide changes. The exact origin, Cognito callback URL (including its trailing slash), and required values are in [the deployment checklist](../infra/README.md#main-and-delhi-preview-cors). Keep `main` unchanged. The preview must use the existing deployed `ApiBaseUrl` output with `VITE_USE_MOCKS=false` and `VITE_LOCAL_AUTH=false`; never substitute the local fixture URL in a deployed build.

## Local API mode

For loopback development, configure throwaway users in `VARUNA_LOCAL_USERS_JSON`, then start `python -m backend.varuna.local_server`. Start the frontend with `VITE_USE_MOCKS=false`, `VITE_LOCAL_AUTH=true`, and `VITE_API_BASE_URL=http://127.0.0.1:8000` (or set these in ignored `frontend/.env.local`). Use the sign-in form in Resident or Responder; do not paste a JWT. The local-only endpoint returns a 30-minute opaque session, never Cognito credentials. It is absent from Lambda and the server refuses non-loopback binding. If no URL is supplied in HTTP mode, the client defaults to that local address; it never silently falls back to mock data. Local reports, sessions and photos reset on restart.

PowerShell example for the API terminal (use throwaway local-only passwords and never commit them):

```powershell
$env:VARUNA_LOCAL_USERS_JSON = '{"resident":{"password":"change-resident-password","sub":"local-resident","groups":[]},"responder":{"password":"change-responder-password","sub":"local-responder","groups":["varuna-responder"]}}'
python -m backend.varuna.local_server
```

The HTTP adapter follows [`contracts/types.ts`](../contracts/types.ts) and [`contracts/README.md`](../contracts/README.md). It maps the backend's two default pilot nodes to the route controls and translates wire states for display. Risk scores, route exposures, and drain rankings come only from the backend. The displayed drain points are illustrative positions derived from affected segments because the fixture wire contract has no drain coordinates.

Resident and Responder can submit a JPEG/PNG/WebP photo (up to 8 MB) for a synthetic pilot road after sign-in. Upload uses signed multipart POST; S3 enforces the 8-MB bound and the backend checks size, type and decoding again. A new report is `Pending Review`, with no AI analysis or risk effect. A responder views the private, metadata-stripped photo and manually chooses visible water before accepting or rejecting. Acceptance replays evidence at the historical Scenario timestamp and refreshes the risk/route comparison; it does **not** describe current Delhi conditions. Pilot upload metadata and review photos expire after seven days; expired records are hidden while background deletion catches up. In deployed mode, S3 and DynamoDB are durable, but this code is not deployed by local tests. `Live` is unavailable. Post-intervention route advice remains unavailable; no mock result is borrowed.

## Mock mode

`src/api/mock/mockApi.ts` serves JSON from `src/api/mock/fixtures/`. It does not score risk or rank routes in the browser. The fixtures are generated by `scripts/build-fixtures.mjs`, which reproduces the Architecture §4–6 pilot heuristic only so the mock numbers agree with each other. Replace them with engine-exported fixtures when they are available.

Mock behaviour, all labelled in the UI:

- Geometry is an illustrative grid near DTU, not surveyed road geometry.
- Scenario mode works. Live mode returns `LIVE_WEATHER_UNAVAILABLE`, so live data is never shown as current.
- Photo analysis returns a fixed fixture observation after about 2.5 s, labelled "fixture response, not a model call". A file name containing `fail` simulates a model timeout (`Needs manual review`).
- Accepting a report on `S-H23` (Central Avenue · block 4) switches to the recalculated snapshot. Reports elsewhere are accepted with a note that the fixture has no recalculated snapshot for them.
- Routes exist for West Gate ↔ East Gate (walk and drive). Other pairs return the explicit "route comparison unavailable" state.

Demo story with fixtures: the baseline shows Central Avenue as the fastest default. Accepting `RPT-0001` raises Central Avenue · block 4 to High, and Hostel Road becomes the lower-exposure recommendation (+4 min). In the responder console, comparing the drains ranks D-01 first; its simulation would restore Central Avenue as the default route.

## Structure

```
src/
  api/          contract types, HTTP client, mock client + fixtures
  components/   map, status strip, sketch, cards, forms, panels
  lib/          formatting, copy, hooks, geometry, terrain contours
  state/        AppState provider (data loading, selection, review, simulation)
  styles/       tokens.css (primitive → semantic → component), base, layout,
                components, map, landing
  views/        LandingView, ResidentView, ResponderView
scripts/        fixture authoring
```

## Visual system

- **Tokens.** `styles/tokens.css` keeps three explicit layers. Components and the MapLibre style read the same custom properties; no colours are hard-coded in React.
- **Type.** Inter for interface text, IBM Plex Mono for times and metrics, and Newsreader (display serif) for page and decision headlines only.
- **Colour.** Ink and paper carry the page, teal is the only action colour, and violet marks Scenario mode and simulated output. Low, Watch, High, Unknown and Closed colours appear only where they describe a road, always with text and a pattern (solid, thick, dashed, crosshatch).
- **Map context.** Contour lines show the terrain low-point prior, smoothed from the per-segment values in the pilot bundle. They are context only: not surveyed elevation, not a flood extent, and not used in any score. The legend says so. The "Illustrative fixture geometry" chip stays on the map.
- **Motion.** Interface motion follows a user action: hero text settles on load, preview steps cross-fade, the map eases to a road chosen from a list, and roads whose class just changed (after a review or when a simulation is shown) get a one-off highlight. The only loop is the decorative rain in the landing hero: three masked layers of hairlines that fall at different speeds, animate `transform` only, pause when the hero is off screen, and sit behind all content. It is not tied to any data, and the Scenario label sits beside it. Nothing on the map or in the workspaces loops or pulses, so nothing suggests live monitoring. `prefers-reduced-motion` stops all of it (the rain stands still), and every element is visible without animation.
- **Width.** Landing rows span the viewport up to 1920 px inside fluid gutters (`--v-gutter`), while text blocks keep their own measure. The workspaces are not capped: side panels have bounded widths and the map takes the rest. This replaces the 1440 px content cap in Design-System.md §4.
- **Simulation scope.** A drain simulation preview colours the map in the responder console only; the resident map always shows the current estimate.

## Contract status

The following list is a historical integration checklist. Report detail and the private `imageUrl` are now implemented; the HTTP adapter also represents `analysis.provider: none` truthfully. The remaining route-place and confidence items are view-model adaptations for the fixture wire API.

`src/api/types.ts` defines view models for both the mock and real modes; `src/api/wireAdapter.ts` translates the real responses from the published contract. Fields the fixture backend does not supply are not represented as backend results. Further backend decisions are still needed for:

- `GET /v1/reports/{id}` for polling analysis status (Architecture §7 says the UI polls but lists no endpoint).
- Named pilot places for route search, or a decision to expose node IDs to users.
- A `lowConfidence` flag with reasons, so the UI does not re-derive the coverage rule.
- `analysis.provider` (`bedrock` | `fixture`) so fixture output is never shown as a model result.
- Report `imageUrl` for the metadata-stripped review derivative.

## Accessibility

- Every map state has a text equivalent (segment queue, route cards, segment card, landing preview lists), and colour is never the only signal.
- Inputs have visible labels. Focus rings are 2 px, with an inverse ring on dark surfaces. Touch targets are at least 44 px. Tabs follow the WAI-ARIA pattern; the mobile responder tabs are docked at the bottom of the screen.
- Recalculations are announced through a polite live region; errors state the next step.
- `prefers-reduced-motion` is respected (see Motion above).
- Input borders use `#7A8F95` (3.4:1) instead of the divider colour (1.35:1) to meet WCAG 1.4.11.
- `e2e/a11y.spec.ts` runs axe-core (WCAG 2.x A/AA) on each view at both widths.

## Credits

MapLibre GL JS (BSD-3-Clause), React (MIT), Lucide icons (ISC), Inter, IBM Plex Mono and Newsreader via Fontsource (OFL).
