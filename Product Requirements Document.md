# Varuna — Product Requirements Document

**Version:** 1.0 · 8 October 2026  
**Track:** Heat and Water · Environmental Hacks 2026  
**Status:** Build specification for the hackathon MVP

## 1. Product decision

Varuna is a small-area operational digital twin for flood risk and response. It combines rainfall, coarse terrain context, a curated road network, and recent street-level observations to rank potentially affected road segments. It compares route alternatives and ranks the *estimated* effect of clearing one of two modelled drainage choke points. The signature interaction is one observation changing both a route recommendation and an intervention ranking.

The pilot is **Delhi Technological University (DTU) and its immediate approach roads**, subject to a quick check that the mapped road geometry and elevation tiles are usable. A 30–50 segment area is sufficient. The site is a demo pilot, not a claim of deployment by DTU or a municipality.

**Product promise:** “See where rain may interrupt a journey, and which response may reduce that risk.”

## 2. Problem and users

During intense rain, an affected road is often visible to nearby people before it is reflected in route planning or a response queue. Reports, rainfall, maps, and response decisions live in separate places. Varuna connects them for one neighbourhood.

| User | Job | Decision Varuna supports |
| --- | --- | --- |
| Resident or student | Check a route and share a local observation | Take a lower-exposure route or avoid travel |
| Campus or local responder | Review possible trouble spots | Inspect a location and compare a proposed action |
| Demo judge | Understand the working system in under three minutes | See input, computation, output, and AWS involvement |

Varuna is a **decision support prototype**. A “lower exposure” route is not a safety certification. No automatic road closure, emergency dispatch, or public warning is sent by the MVP.

## 3. Outcomes and measures

The MVP succeeds when a judge can use one coherent scenario to see:

1. A rainfall scenario changes the risk of mapped road segments.
2. A geolocated photo observation is interpreted, reviewed, and added as evidence.
3. At least two candidate routes are compared with travel time, risk exposure, and the reason for the recommendation.
4. An operator tests one drain-clearance action and sees the estimated before/after change.
5. The demo clearly shows an AWS service doing real work.

**Build targets, not validated impact claims:** first map under 3 seconds on a normal connection; risk recalculation under 5 seconds for the pilot graph; route comparison under 8 seconds when its provider responds; one complete scenario replay without manual database edits. Measure these locally and report actual results.

## 4. MVP scope and priority

| ID | Priority | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| FR-01 | P0 | Pilot map with 30–50 connected road segments and a clearly visible data timestamp | User can select any segment and see its current risk, evidence, and data quality |
| FR-02 | P0 | Switch between **Scenario** and **Live weather** modes | Scenario is always labelled; live mode displays provider and forecast time; unavailable live data does not appear as current |
| FR-03 | P0 | Submit a location, photo, and short optional note | Report is stored with provenance; user sees pending/accepted/rejected state |
| FR-04 | P0 | AI extracts visible water/hazards from a report image | Structured output includes observations and uncertainty; no precise centimetre depth is asserted from one image |
| FR-05 | P0 | Deterministic road risk scoring | Same inputs produce same score; selected segment explains contributing signals and missing data |
| FR-06 | P0 | Compare candidate routes between two pilot points | Show travel time and exposure; confirmed closures are excluded; if no lower-exposure route exists, say so |
| FR-07 | P0 | Compare clearing either of two modelled drainage choke points | Rank the two actions by a stated metric; show affected segments and route change; label estimates and keep baseline intact |
| FR-08 | P0 | Mobile resident view and desktop responder view | Core tasks work at 360 px mobile width and at 1280 px desktop width |
| FR-09 | P1 | AI explanation of the intervention result | Explanation cites the supplied scores and never invents an effect |
| FR-10 | P1 | Shareable scenario link | Opening the link restores the same inputs and timestamp |

The minimum public demo can use a prebuilt, reproducible rainfall scenario. Live mode is valuable when available, but a forecast provider outage must not break the recorded story.

## 5. Core flows

### Resident

1. Open the pilot map and see mode, weather timestamp, and risk legend.
2. Enter origin, destination, and travel mode.
3. Compare the fastest candidate with the lower-exposure candidate. Each result lists flagged segments and extra travel time.
4. Open a segment card to see the evidence behind its risk. Optionally add a photo report.

### Responder

1. Open a ranked list of segments, with filters for recent reports and low-confidence results.
2. Inspect a report image, AI observations, and its original timestamp. Accept or reject its contribution to the risk model.
3. Compare two modelled drain-clearance actions and inspect the higher-ranked option.
4. Compare baseline and scenario side by side. The proposed action is advisory only.

### Judge demo (target: 2 minutes 40 seconds)

| Time | What is shown |
| --- | --- |
| 0:00–0:25 | The local problem, pilot area, rainfall scenario, and initial road status |
| 0:25–0:55 | Photo report enters; Bedrock returns structured visual observations; responder accepts it |
| 0:55–1:35 | A road risk changes; two routes are compared and the extra travel time is visible |
| 1:35–2:10 | Two drain actions are compared; the selected simulation changes the ranked road list and route exposure |
| 2:10–2:40 | Show the AWS data flow, explain uncertainty, and state what the prototype has demonstrated |

## 6. Product rules

- **Risk classes:** Low, Watch, High, and Unknown. Unknown is distinct from Low. The scoring bands are pilot settings, not measured flood-depth thresholds.
- **Evidence:** A photo can mark visible standing water, blocked drainage, debris, or “unclear.” The model also returns confidence and rationale. A responder must accept it before it changes public route advice.
- **Freshness:** The interface shows weather, report, and map timestamps separately. Observations expire from the active score after a configured period unless reconfirmed; they remain in history.
- **Routes:** The app recommends the lowest-exposure candidate among returned alternatives. It cannot guarantee that unobserved roads are passable.
- **Simulation:** Drain clearance changes a bounded drainage-vulnerability input on connected pilot segments. The app ranks two candidates by reduction in exposure on the selected route, then by number of segments moving out of High. It shows a directional estimate, not a physical flood simulation or promised time to recovery.
- **Provenance:** Every visible risk result exposes its input sources, score version, missing fields, and last calculation time.

## 7. Data and safety boundaries

Public road geometry may come from OpenStreetMap with attribution. Copernicus DEM can supply broad terrain context, but its 30/90 m surface model cannot resolve a kerb, drain, or underpass water depth. Rainfall forecasts are uncertain and may not resolve a short local cloudburst. Reports can be mistagged or misleading. These limitations must be visible in the interface and final demo.

Store only what the demo needs. Strip image metadata before public display; keep raw uploads private; allow report removal by an administrator. Do not display reporter identity on the public map. Never phrase a route as “safe”; use “lower estimated exposure.”

## 8. Out of scope

- Citywide forecasting or calibrated hydrodynamic modelling
- Precise water depth or time-to-flood predictions
- Automatic emergency alerts, dispatch, or road closures
- Crowdsourced reports changing route advice without review
- Population or lives-saved estimates without defensible data
- Native mobile applications, sensor hardware, and payment systems

## 9. Delivery plan and gates

| Gate | Deliverable | Done when |
| --- | --- | --- |
| G1 — data | Pilot graph, two modelled drain nodes, rainfall scenario, terrain metadata | Segments connect, scenario can be replayed, sources recorded; illustrative nodes are labelled |
| G2 — engine | Deterministic scoring and intervention comparison | Same fixture yields same segment and route results |
| G3 — evidence | Upload, Bedrock interpretation, review state | A reviewed report changes only the intended nearby segment(s) |
| G4 — product | Resident route view and responder console | Both complete the core flow on desktop and mobile |
| G5 — submission | Deployed demo, public repository, video, writeup | Signed-out reviewer can open the app and video; AWS use is visible |

Build work, including project code, should be committed during the 8–11 October 2026 event window. The official rules require a public repository, a YouTube video under three minutes, and a short writeup. The demo must show actual AWS use. Teams can have one to four members; each member registers separately and needs an AWS Builder Center profile. Resolve student verification according to the official rules, especially if seeking the interview opportunity. Check the event page for the submission form's exact closing time before scheduling the final upload.

## 10. References and linked specifications

- [Hackathon brief](https://www.wemakedevs.org/aws/env) and [rules](https://www.wemakedevs.org/aws/rules)
- [Architecture.md](Architecture.md) — data flow, services, risk and route algorithms
- [Agents.md](Agents.md) — bounded AI behavior and implementation rules
- [Design-System.md](Design-System.md) — interface and component specification
- [Copernicus DEM on AWS](https://registry.opendata.aws/copernicus-dem/)
