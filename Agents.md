# Varuna — Agents and implementation rules

**Version:** 1.0 · 8 October 2026

This file specifies both the AI actors inside Varuna and the rules for coding agents working in this repository. The product's numerical risk, routing score, and intervention effect are deterministic services. The AI actors interpret observations and explain computed results; they do not invent measurements or take operational action.

## 1. Product agent map

| Actor | MVP status | Input | Output | Permission |
| --- | --- | --- | --- | --- |
| Observation Agent | P0 | Report image, user note, timestamp, pilot context | Bounded visual observations and uncertainty | Read image; propose evidence only |
| Response Narrator | P1, with P0 template fallback | Risk and intervention results already computed | Short explanation citing input values | Read computed facts only |
| Risk Engine | P0 deterministic service | Weather, terrain, drainage, accepted reports | Risk snapshot with provenance | Calculate only |
| Route Evaluator | P0 deterministic service | Route candidates, risk snapshot, closures | Exposure comparison | Calculate only |
| Intervention Engine | P0 deterministic service | Two drain candidates, baseline snapshot, selected route, assumptions | Ranked before/after comparisons | Simulate only |

The UI should never imply that an AI agent has authority to close a road, send an alert, or dispatch a team. Only the authenticated responder can accept evidence or mark a closure, and the MVP does not initiate emergency operations.

## 2. Observation Agent

**Trigger:** New report image has uploaded successfully.  
**Runtime:** Server-side Bedrock Converse call to a vision-capable model.  
**Goal:** Extract what is *visible* in the image for human review.

Required response schema:

```json
{
  "visible_water": "none|possible|clear|uncertain",
  "drain_state": "blocked|clear|not_visible|uncertain",
  "visible_hazards": ["debris"],
  "access_concern": "none|possible|clear|uncertain",
  "confidence": 0.0,
  "evidence_summary": "One short sentence limited to visible facts",
  "needs_human_review": true
}
```

Allowed hazard values are `debris`, `open_manhole`, `stranded_vehicle`, `person_in_water`, and `other`. The adapter validates all fields, truncates free text, and rejects unknown values. `confidence` is the model's own indicator, not calibrated probability. The agent cannot emit a centimetre depth, predicted flood extent, passability certification, or emergency instruction. If a visual cue is not clear, it uses `uncertain` or `not_visible`.

**System instruction intent:** “Describe only visible conditions. Distinguish observation from inference. Never infer exact water depth, location, time, or safety from pixels alone. Return only the defined JSON.” The server supplies the location and time separately as user metadata; the model must not overwrite them.

**Flow:** validate file → store privately → call model → schema check → show result as `Pending review` → responder accepts/rejects → accepted evidence can enter the risk engine. On model timeout or invalid JSON, set `Needs manual review`; the reporting flow remains usable.

## 3. Response Narrator

**Status:** Optional enhancement after the end-to-end P0 flow works. A fixed template covers the MVP. The narrator receives only structured risk results, source timestamps, and intervention assumptions. It may explain which inputs changed and which route metric moved; it may not calculate fresh numbers or add unsupported claims.

Example permitted output: “Clearing modelled Drain D-01 ranks above D-02 because it lowers exposure on the selected route. Three connected segments move out of High in this simulation. The result depends on the pilot drainage assumption.”

Reject narration that says a road “will be safe,” that a drain action “will stop flooding,” or that people have been saved. If the generated text fails a factual consistency check against the structured response, display the template.

## 4. Deterministic tool contracts

All agents receive only bounded, read-only tool results. The key contracts are:

| Tool | Request | Response | Invariant |
| --- | --- | --- | --- |
| `get_segment_context` | `segmentId`, `snapshotId` | Segment features, sources, timestamps | No raw reporter identity |
| `get_route_comparison` | `comparisonId` | Candidate times, exposure, unknown share | No new route generation by AI |
| `get_intervention_result` | `runId` | Before/after metrics and assumptions | Baseline immutable |

Tool outputs and uploaded notes are untrusted data. They cannot change system instructions, invoke tools, modify code, or request credentials. The agent's output must be accepted by the server's schema and policy checks before it is shown.

## 5. Evaluation fixtures

Keep a tiny local fixture set with consented or licensed images and a source record:

1. Clear visible standing water: output should identify visible water without a precise depth.
2. Dry street: output should not invent flooding.
3. Ambiguous reflection or dark pavement: output should be uncertain.
4. Blocked drain visible: output should identify blockage only if the drain is actually visible.
5. Image with a person or plate: public display derivative should avoid exposing identity.

For each fixture, review the JSON validity, observation accuracy, unsupported statements, and fallback behavior. A handful of cases cannot calibrate the model; report the evaluation as a smoke test.

## 6. Coding agent instructions for this repository

Before implementing a feature, read the four specifications: [Product Requirements Document.md](Product%20Requirements%20Document.md), [Architecture.md](Architecture.md), [Design-System.md](Design-System.md), and this file. Treat the PRD as scope authority, Architecture as data/service contract, and Design-System as UI authority. If they disagree, update the affected documents with a recorded decision before implementing the divergent behavior.

- Work within the hackathon clock. Keep commits attributable to work completed during the event, and credit external data, libraries, and AI coding tools in the final writeup.
- Build the vertical slice first: scenario → risk snapshot → route comparison → comparison of two interventions → UI. Add image interpretation once the deterministic path works.
- Keep risk math, route exposure, and intervention rules in pure functions with fixture tests. Do not hide domain decisions inside a prompt.
- Preserve provenance and the distinction between `Unknown`, `Low`, `Scenario`, and `Live` in API responses and UI copy.
- Never put secrets in source, screenshots, logs, fixtures, or demo video. Use environment variables and least-privilege IAM.
- Before changing a numerical weight, class boundary, data source, or agent output schema, update Architecture and the corresponding tests. Before changing a user flow or claim, update the PRD and the design copy.
- Use synthetic data only with a visible scenario label. Do not present fixture results as live flood prediction.
- Prefer a working end-to-end feature to several disconnected panels. The judged artifact is the deployed app and the recorded three-minute story.

## 7. Definition of done for agent-related work

An agent feature is done when its input and output schema are validated, a failure path is visible, the user can inspect its evidence, and a test fixture catches at least one unsupported inference. No AI output directly mutates confirmed closures, dispatch state, or the intervention baseline.
