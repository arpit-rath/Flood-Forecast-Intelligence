# Varuna — Design System

**Version:** 1.0 · 8 October 2026  
**Interface direction:** Calm civic utility, legible during a stressful weather event

## 1. Design principles

1. **Make the next decision obvious.** A resident sees route status and the reason; a responder sees the highest-priority segments and the evidence.
2. **Show uncertainty in the main view.** Unknown data, stale forecasts, and simulated output have visible labels.
3. **Keep the map accountable.** Every coloured road has a text status, timestamp, and source details in its card and list equivalent.
4. **Use restrained urgency.** Red is for High risk or confirmed closure, not decoration. Motion does not imply live monitoring.
5. **Design for a phone first.** The route and report flows must be usable with one hand and intermittent connectivity.

## 2. Visual language

Varuna uses an off-white canvas, deep ink text, teal actions, and a small set of hazard colours. Maps stay quiet so road overlays remain readable. Typography uses **Inter** for UI with system-sans fallback; **IBM Plex Mono** is limited to timestamps, coordinates, and numeric metrics. No map colour carries meaning alone.

| Role | Hex | Use |
| --- | --- | --- |
| Ink | `#142B33` | Primary text, dark controls |
| Canvas | `#F5F8F8` | App background |
| Surface | `#FFFFFF` | Cards and sheets |
| Border | `#D4E0E1` | Separators, form boundaries |
| Muted text | `#526A72` | Supporting copy |
| Teal | `#0B7378` | Primary action, active control |
| Teal dark | `#07575C` | Hover and focused emphasis |
| Low | `#177B5A` | Low risk, with “Low” label |
| Watch | `#A9630B` | Watch, with “Watch” label |
| High | `#B33A32` | High risk, with “High” label |
| Unknown | `#697B82` | Missing or unassessed data, dashed line |

Use status tints as backgrounds (`#E5F4ED`, `#FFF1D8`, `#FDE9E6`, `#E9EFF0`) with dark status text. Check the final text/background combinations for WCAG AA contrast during implementation.

## 3. Token architecture

Use three layers: primitive values → semantic intent → component values. Components should reference tokens, so map and panel themes can change together. Initial CSS contract:

```css
:root {
  /* Primitive */
  --v-ink-900: #142B33;
  --v-teal-600: #0B7378;
  --v-teal-700: #07575C;
  --v-gray-50: #F5F8F8;
  --v-gray-200: #D4E0E1;
  --v-white: #FFFFFF;
  --v-space-1: 4px;
  --v-space-2: 8px;
  --v-space-3: 12px;
  --v-space-4: 16px;
  --v-space-6: 24px;
  --v-space-8: 32px;
  --v-radius-sm: 8px;
  --v-radius-md: 12px;
  --v-radius-lg: 20px;

  /* Semantic */
  --v-bg: var(--v-gray-50);
  --v-surface: var(--v-white);
  --v-text: var(--v-ink-900);
  --v-action: var(--v-teal-600);
  --v-action-hover: var(--v-teal-700);
  --v-divider: var(--v-gray-200);

  /* Component */
  --v-button-primary-bg: var(--v-action);
  --v-button-primary-text: var(--v-white);
  --v-card-bg: var(--v-surface);
  --v-card-border: var(--v-divider);
  --v-input-border: var(--v-divider);
}
```

The first implementation may use a single `tokens.css`; keep the layer sections explicit. Do not scatter hard-coded colours in React components. Map status colours should be exported from the same semantic token source for the map style configuration.

## 4. Type, spacing, and surfaces

| Token | Desktop | Mobile | Purpose |
| --- | --- | --- | --- |
| Display | 32/40 px, 700 | 26/34 px, 700 | Page title or major scenario result |
| Heading | 22/30 px, 650 | 20/28 px, 650 | Panel heading |
| Body | 16/24 px, 400 | 16/24 px, 400 | Primary reading and actions |
| Detail | 14/20 px, 400 | 14/20 px, 400 | Metadata and helper text |
| Metric | 20/28 px, 650 | 18/26 px, 650 | Minutes, segment counts, exposure |

Use a 4 px spacing base; common gaps are 8, 12, 16, 24, and 32 px. The content area is capped at 1440 px. Cards use 12 px radius and a 1 px border; use shadow only for floating map sheets. Buttons and inputs are at least 44 px high, and map controls have 44 × 44 px touch targets.

## Current photo-report labels

In HTTP mode, show a labelled sign-in/create-account action in Resident and Responder while Cognito public sign-up is enabled; switch to sign-in-only wording when it is disabled. Local development uses labelled account/password fields and deployed mode opens Cognito managed login. Explain that a new account can submit a pilot report but cannot open the private responder queue. Never ask users to paste a JWT. Show `Pending review` immediately after upload, `No automated observation` in the review card, and the responder's manual visible-water decision separately from mock fixture analysis. Show the private photo only to a responder with access; render no public map photo. An accepted manual observation is explicitly a replay in the synthetic DTU-area Scenario, never Live or Delhi-wide. Submission errors keep the file/note for retry and appear beside the field or as an alert. The Delhi Hybrid overview remains basemap-only regardless of report state.

### Real-road preview labels

In the feature preview, make Standard street map the default and Hybrid the labelled satellite option. The persistent coverage note must say the imported OSM roads are limited to a DTU-area extract and the rest of Delhi is unassessed. Use a dashed neutral line and a text/icon `Unknown` state for roads without current, reviewed evidence. Show `Unreviewed report` separately from `Responder-confirmed blockage` and `Responder-cleared report`; neither a pending report nor satellite imagery changes Unknown into a confirmed condition. A cleared report includes its observation time and does not mean safe. Show source, observation time, review decision and evidence expiry in either map style. Keep real-road submission visibly unavailable whenever the versioned `/v2` snapshot/evidence API or sign-in is unavailable; an enabled action must submit only a server-validated OSM way and point, never a synthetic ID. Present file/point validation errors next to the form and announce submission/review results. Keep OSM/ODbL and basemap attribution visible or one accessible control away. The real preview contains no Scenario weather strip, route recommendation, drain action, or synthetic report marker.

Local source alerts use a separate, text-first panel in the real-road preview. Show source link, publication and retrieval times, stated cause and affected wording, freshness, and a persistent **Reported / Unverified** label for uncertain candidates. A unique proposal may show an OSM-derived or contextual unnamed-road label, confidence category and reason; ambiguous results must say **Ambiguous match — responder selection required**. Never style a candidate as a blockage or an official road name. Use an icon plus text, not hazard colour alone. Do not draw candidate road lines as blocked or expose reviewer identity/reason publicly. A responder's confirmation is a separately labelled state with a visible decision time; only confirmed flood blockage may affect the local route-eligibility check. Show unavailable, invalid and stale source-location states explicitly, and retain on-ground-instructions precedence. Preserve the existing 44 px controls, focus rings, OSM attribution and mobile single-column layout.

For the Phase 3 public alert feed, show a **degraded** source-health message when labelled detail parsing fails; retain the clean listing title and explicitly say the body could not be verified. Public alert cards receive no road IDs or review timestamps, even for reviewed outcomes, so they cannot colour a specific map way. The responder-only review queue may show decision time and candidate road IDs. The separate reviewed real-road evidence feed remains the map's condition source; otherwise roads stay **Unknown**.

## 5. Layouts

### Resident view

On desktop, the map fills the main area and a 360–400 px left panel holds origin/destination, route choices, and evidence. On mobile, the map occupies the top 45–55% of the screen and a draggable or fixed bottom sheet holds the current task. The primary action remains visible above the phone's safe area.

The default order is: mode and data time → route search → recommended comparison → segment detail → report action. A person can use the list and cards without interacting with the map.

### Responder view

On desktop, use a three-part layout: ranked segment list (300 px), map (flexible), and detail/simulation drawer (360–420 px). On mobile, make these tabs: **Queue**, **Map**, **Action**. The Action view compares two modelled drain options, shows why one ranks first, and keeps the baseline and selected simulation visible side by side or in clearly labelled stacked cards.

### Breakpoints

- `< 640 px`: one column, bottom sheet, no hover-dependent controls.
- `640–1023 px`: map plus collapsible side panel.
- `≥ 1024 px`: full responder workspace.

## 6. Components and states

| Component | Required content | Important states |
| --- | --- | --- |
| Mode banner | “Scenario” or “Live weather”, valid time, source | Loading, stale, provider unavailable |
| Segment line | Risk class; dashed for unknown; distinct closure pattern | Selected, hovered, stale evidence |
| Segment card | Name/ID, class, confidence, feature breakdown, reports, time | Empty evidence, unknown, loading |
| Route option | Time, exposure, flagged segments, unknown share, recommendation reason | Selected, unavailable, blocked |
| Report form | Photo, location, note, consent for public derivative | Uploading, analysis pending, failed, accepted, rejected |
| Intervention panel | Two drain options, rank reason, assumptions, baseline, selected before/after, affected segments | Ready, calculating, no estimated benefit, error, result |
| Status badge | Text plus icon/pattern | Low, Watch, High, Unknown, Closed |

**Button variants:** primary (one per panel), secondary, quiet, and destructive. Primary button default/hover/pressed/disabled/loading states must be visually distinct. Show a 2 px visible keyboard focus ring. Loading actions keep their label and announce progress; disabling requires an explanation when the cause is missing data.

**Map styling:** Low = solid green; Watch = solid amber; High = solid red with thicker stroke; Unknown = dashed grey; confirmed closure = dark crosshatch or repeated barrier symbol. Selected segment adds a high-contrast outline. The route lines use blue/teal with a patterned alternate, avoiding confusion with hazard colours. Include a persistent legend and a text list equivalent.

## 7. Copy and trust language

Use direct, qualified wording:

| Use | Avoid |
| --- | --- |
| “Lower estimated exposure · +4 min” | “Safe route” |
| “High risk estimate · 2 recent reports” | “This road will flood” |
| “Scenario: 20 mm/h rainfall” | “Live” for replayed data |
| “Drain clearance may lower risk on 3 segments” | “Flooding solved” |
| “Unknown: no recent evidence for this road” | A green road with missing data |

Show the source and time near each decision, not buried in a tooltip. Explain an AI finding as “Photo analysis suggests standing water; awaiting review.” Include an accessible “How this is estimated” link from risk and simulation cards.

## 8. Accessibility and motion

- Target WCAG 2.2 AA: 4.5:1 contrast for normal text, 3:1 for large text and essential UI boundaries.
- Full keyboard route through map alternatives, list, report form, review controls, and simulation; visible focus.
- All status changes use text and an icon/pattern as well as colour. Do not rely on map-only information.
- Use `aria-live="polite"` for completed recalculations; announce errors with useful next steps.
- Animate the scenario timeline only when the user starts it; support `prefers-reduced-motion` and a static step control. Motion should show cause and effect, never suggest live data when scenario mode is active.
- Make offline/provider failures readable and recoverable. Do not hide old data; label it stale.

## 9. Handoff checklist

The UI is ready for review when the two core flows in the PRD can be completed at 360 px and 1280 px; every map state has a text equivalent; Low and Unknown are never confused; Scenario and Live remain obvious in screenshots; the intervention assumption is visible; keyboard focus and contrast have been checked.

See [Product Requirements Document.md](Product%20Requirements%20Document.md), [Architecture.md](Architecture.md), and [Agents.md](Agents.md).
