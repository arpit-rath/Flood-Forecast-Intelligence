import { ArrowRight, Ban, Camera, CircleDashed, CloudRain, FlaskConical, Route as RouteIcon, ShieldOff, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { LngLat, PilotResponse, Report, RiskClass, RouteComparison } from '../api/types';
import { PilotSketch, type SketchMarker, type SketchRoute } from '../components/PilotSketch';
import { RainField } from '../components/RainField';
import { ReviewBadge, SimulatedTag, StatusBadge } from '../components/StatusBadge';
import { TabPanel, Tabs } from '../components/Tabs';
import { RISK_LABEL, observationHeadline } from '../lib/copy';
import { DESKTOP_QUERY, useMediaQuery } from '../lib/hooks';
import { formatExposure, formatExtraMinutes, formatMinutes, formatScore, formatTimeIST, pluralize } from '../lib/format';
import { outcomeSummary } from '../lib/routeCopy';
import { useAppState } from '../state/AppState';

type Step = 'observe' | 'routes' | 'respond';

const STEPS: { id: Step; index: string; label: string }[] = [
  { id: 'observe', index: '01', label: 'Observation' },
  { id: 'routes', index: '02', label: 'Route comparison' },
  { id: 'respond', index: '03', label: 'Response choice' },
];

/**
 * Landing page (#/). Explains Varuna in one screen, then walks through the
 * observation → route comparison → response choice story using the same API
 * data the workspaces use. Nothing here changes state or runs a simulation.
 */
export function LandingView() {
  const { pilot, snapshot, currentRoutes, api, mode } = useAppState();
  const pilotData = pilot.status === 'ready' ? pilot.data : null;
  const weather = snapshot.status === 'ready' ? snapshot.data.weather : null;

  const heroRoutes = useMemo(() => sketchRoutes(currentRoutes), [currentRoutes]);

  return (
    <div className="landing">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__inner">
          <div className="hero__copy">
            <p className="eyebrow eyebrow--inverse">DTU pilot · decision-support prototype</p>
            <h1 id="hero-title" className="hero__title">
              See where rain may interrupt a journey, <em>and which response may reduce that risk.</em>
            </h1>
            <p className="hero__lede">
              Varuna estimates risk on each road segment of one neighbourhood from rainfall, coarse terrain and reviewed
              street photos. It compares route alternatives and two modelled drain-clearance actions, and shows the time,
              source and gaps behind every estimate.
            </p>
            <div className="hero__actions">
              <a className="btn btn--inverse btn--lg" href="#/resident">
                <RouteIcon aria-hidden="true" size={20} /> Explore routes
              </a>
              <a className="btn btn--ghost-inverse btn--lg" href="#/responder">
                Open responder console <ArrowRight aria-hidden="true" size={20} />
              </a>
            </div>
            <p className="hero__plate">
              <ModePill mode={weather?.mode ?? mode} />
              <span>
                {snapshot.status === 'error'
                  ? `${mode === 'live' ? 'Live weather' : 'Scenario data'} unavailable`
                  : !weather
                    ? 'Loading data…'
                    : weather.mode === 'scenario'
                      ? `${weather.scenarioLabel ?? `${weather.precipitationMmH} mm/h rainfall`} · synthetic replay, not live`
                      : `${weather.provider} forecast`}
              </span>
              {weather && (
                <span className="mono">
                  {weather.mode === 'live' ? 'forecast' : 'rain'} valid{' '}
                  <time dateTime={weather.validAt}>{formatTimeIST(weather.validAt)}</time>
                </span>
              )}
              <span>{api.kind === 'mock' ? 'Local fixtures (no AWS calls)' : weather?.mode === 'live' ? weather.provider : 'Synthetic Scenario API'}</span>
            </p>
          </div>

          {/* Rain lives in the visual column so it never falls behind the copy. */}
          <div className="hero__visual">
            <RainField />
            <figure className="hero__figure">
              {pilotData ? (
                <PilotSketch
                  pilot={pilotData}
                  tone="dark"
                  routes={heroRoutes}
                  width={680}
                  height={470}
                  padding={26}
                  title={`Sketch of the ${pilotData.name} road network with terrain context`}
                />
              ) : (
                <div className="hero__figure-placeholder" />
              )}
              <figcaption>
                {pilotData ? (
                  <>
                    <span>{pilotData.name}</span>
                    <span>{pluralize(pilotData.segments.features.length, 'road segment')}</span>
                    <span>illustrative geometry</span>
                  </>
                ) : (
                  'Loading pilot network…'
                )}
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className="landing-section intro" aria-labelledby="intro-title">
        <div className="landing-section__inner intro__grid">
          <div>
            <p className="eyebrow">What Varuna does</p>
            <h2 id="intro-title" className="section-title">
              One neighbourhood. Three questions asked during heavy rain.
            </h2>
          </div>
          <ol className="question-list">
            <li>
              <span className="question-list__index mono">01</span>
              <h3>Which roads may be affected?</h3>
              <p>
                Each road segment gets a Low, Watch, High or Unknown estimate from rainfall, a terrain low-point prior,
                drainage vulnerability and accepted photo reports.
              </p>
              <span className="badge-row" aria-label="Risk classes">
                {(['low', 'watch', 'high', 'unknown'] as RiskClass[]).map((c) => (
                  <StatusBadge key={c} status={c} size="sm" />
                ))}
                <StatusBadge status="closed" size="sm" />
              </span>
            </li>
            <li>
              <span className="question-list__index mono">02</span>
              <h3>Which route has lower estimated exposure?</h3>
              <p>
                Candidates are compared on travel time and length-weighted exposure. Confirmed closures are excluded, and
                the extra minutes are always shown.
              </p>
            </li>
            <li>
              <span className="question-list__index mono">03</span>
              <h3>Which response may help most?</h3>
              <p>
                A responder compares clearing one of two modelled drains against the same baseline. Results are labelled
                simulated and stay advisory.
              </p>
            </li>
          </ol>
        </div>
      </section>

      <section className="landing-section story" aria-labelledby="story-title">
        <div className="landing-section__inner">
          <div className="story__head">
            <p className="eyebrow">Interactive preview · Scenario data</p>
            <h2 id="story-title" className="section-title">
              From one observation to a response choice
            </h2>
            <p className="story__lede">
              Step through the pilot scenario. The map, routes and drains below come from the same data as the resident
              and responder views; nothing is recalculated here.
            </p>
          </div>
          {pilotData ? <Story pilot={pilotData} /> : <p className="detail">Loading the pilot network…</p>}
        </div>
      </section>

      <section className="landing-section principles" aria-labelledby="principles-title">
        <div className="landing-section__inner">
          <p className="eyebrow">Built to show uncertainty</p>
          <h2 id="principles-title" className="section-title">
            What Varuna will not pretend to know
          </h2>
          <ul className="principle-grid">
            <li className="principle">
              <CircleDashed aria-hidden="true" size={22} />
              <h3>Unknown is not Low</h3>
              <p>Roads without enough data stay Unknown and dashed. Missing inputs are left out, never counted as zero.</p>
              <span className="badge-row">
                <StatusBadge status="unknown" size="sm" />
                <span className="detail">is never shown as</span>
                <StatusBadge status="low" size="sm" />
              </span>
            </li>
            <li className="principle">
              <ShieldOff aria-hidden="true" size={22} />
              <h3>Lower exposure, never “safe”</h3>
              <p>
                A recommended route has lower estimated exposure. It is not a safety certification, and unobserved roads may
                still be impassable.
              </p>
            </li>
            <li className="principle">
              <Camera aria-hidden="true" size={22} />
              <h3>Photos wait for review</h3>
              <p>
                Image analysis describes what is visible, with no water depth. A responder accepts a report before it can
                change route advice.
              </p>
              <span className="badge-row">
                <ReviewBadge status="pending_review" />
              </span>
            </li>
            <li className="principle">
              <FlaskConical aria-hidden="true" size={22} />
              <h3>Simulations stay labelled</h3>
              <p>
                Drain-clearance results are directional estimates against an unchanged baseline. Nothing is closed, sent or
                dispatched.
              </p>
              <span className="badge-row">
                <SimulatedTag />
              </span>
            </li>
          </ul>
        </div>
      </section>

      <section className="landing-section doors" aria-labelledby="doors-title">
        <div className="landing-section__inner">
          <h2 id="doors-title" className="visually-hidden">
            Choose a view
          </h2>
          <div className="door-grid">
            <article className="door">
              <p className="eyebrow">For residents and students</p>
              <h3 className="door__title">Check a route before you travel</h3>
              <p>Compare the fastest route with a lower-exposure alternative, read the evidence for any road, and send a photo.</p>
              <a className="btn btn--primary btn--lg" href="#/resident">
                <RouteIcon aria-hidden="true" size={20} /> Explore routes
              </a>
            </article>
            <article className="door door--console">
              <p className="eyebrow eyebrow--inverse">For campus and local responders</p>
              <h3 className="door__title">Review evidence and compare a response</h3>
              <p>Work a ranked queue of roads and reports, accept or reject photo evidence, and compare two drain actions.</p>
              <a className="btn btn--inverse btn--lg" href="#/responder">
                <Wrench aria-hidden="true" size={20} /> Open responder console
              </a>
            </article>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-section__inner landing-footer__grid">
          <div>
            <p className="landing-footer__brand">Varuna</p>
            <p className="detail">
              Decision-support prototype for one pilot area. It does not close roads, send alerts or dispatch help. In an
              emergency, call 112.
            </p>
          </div>
          {pilotData && (
            <div>
              <p className="section-label">Data sources and limits</p>
              <ul className="source-list">
                {pilotData.sources.map((s) => (
                  <li key={s.id} className="detail">
                    <strong>{s.name}</strong> ({s.licence}){s.note ? `: ${s.note}` : ''}
                  </li>
                ))}
              </ul>
              <p className="detail">
                Map data <time className="mono" dateTime={pilotData.mapUpdatedAt}>{formatTimeIST(pilotData.mapUpdatedAt)}</time>
                {pilotData.geometryNote ? ` · ${pilotData.geometryNote}` : ''}
              </p>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}

function ModePill({ mode }: { mode: 'scenario' | 'live' }) {
  return mode === 'live' ? (
    <span className="mode-pill mode-pill--live">
      <CloudRain aria-hidden="true" size={14} /> Live weather
    </span>
  ) : (
    <span className="mode-pill mode-pill--scenario">
      <FlaskConical aria-hidden="true" size={14} /> Scenario
    </span>
  );
}

function sketchRoutes(routes: RouteComparison | null, selectedId?: string | null): SketchRoute[] {
  if (!routes) return [];
  const selected = selectedId ?? routes.recommendedCandidateId ?? routes.fastestCandidateId;
  return routes.candidates.map((c) => ({
    id: c.id,
    coordinates: c.geometry.coordinates,
    role: c.blocked ? 'blocked' : c.id === selected ? 'selected' : 'alternate',
  }));
}

function pickReport(list: Report[]): Report | null {
  return (
    list.find((r) => r.reviewStatus === 'pending_review' && r.observations) ??
    list.find((r) => ['pending_review', 'needs_manual_review', 'analysis_pending'].includes(r.reviewStatus)) ??
    list.find((r) => r.reviewStatus === 'accepted') ??
    null
  );
}

function Story({ pilot }: { pilot: PilotResponse }) {
  const { snapshot, riskById, currentRoutes, routes, reports, segmentsById, routeQuery, mode } = useAppState();
  const [step, setStep] = useState<Step>('observe');
  const [hovered, setHovered] = useState<string | null>(null);
  // Wider drawing on desktop so a large preview stays a sensible height.
  const desktop = useMediaQuery(DESKTOP_QUERY);

  const classes = useMemo(() => {
    const map = new Map<string, RiskClass>();
    for (const f of pilot.segments.features) {
      // Without a current snapshot every road is Unknown, never Low.
      map.set(f.id, snapshot.status === 'ready' ? (riskById.get(f.id)?.class ?? 'unknown') : 'unknown');
    }
    return map;
  }, [pilot, riskById, snapshot.status]);

  const closed = useMemo(
    () => new Set([...riskById.values()].filter((r) => r.closure?.status === 'confirmed').map((r) => r.segmentId)),
    [riskById],
  );

  const reportList = reports.status === 'ready' ? reports.data : [];
  const report = pickReport(reportList);

  const drainSegments = useMemo(() => new Set(pilot.drains.features.flatMap((d) => d.properties.affectedSegmentIds)), [pilot]);
  const drainIds = useMemo(() => new Set(pilot.drains.features.map((d) => d.id)), [pilot]);

  const endpoints: SketchMarker[] = [];
  if (routeQuery) {
    const origin = pilot.places.find((p) => p.id === routeQuery.originPlaceId);
    const destination = pilot.places.find((p) => p.id === routeQuery.destinationPlaceId);
    if (origin) endpoints.push({ id: 'a', point: origin.point, label: 'A' });
    if (destination) endpoints.push({ id: 'b', point: destination.point, label: 'B' });
  }

  let focusSegments: Set<string> | undefined;
  let focusDrains: Set<string> | undefined;
  let reportPoints: LngLat[] = [];
  let routesShown: SketchRoute[] = [];
  if (step === 'observe' && report) {
    focusSegments = new Set([report.segmentId]);
    reportPoints = [report.point];
  } else if (step === 'routes') {
    routesShown = sketchRoutes(currentRoutes);
  } else if (step === 'respond') {
    focusSegments = drainSegments;
    focusDrains = drainIds;
  }

  const hoveredRisk = hovered ? riskById.get(hovered) : undefined;
  const hoveredName = hovered ? (segmentsById.get(hovered)?.name ?? hovered) : null;

  return (
    <div className="story__body">
      <div className="story__steps">
        <Tabs
          idPrefix="story"
          label="Preview steps"
          className="story-tabs"
          tabs={STEPS.map((s) => ({
            id: s.id,
            label: (
              <>
                <span className="story-tabs__index mono" aria-hidden="true">
                  {s.index}
                </span>
                <span>{s.label}</span>
              </>
            ),
          }))}
          active={step}
          onChange={(id) => setStep(id as Step)}
        />

        <TabPanel idPrefix="story" id="observe" active={step === 'observe'} className="story-panel">
          <h3 className="story-panel__title">A street photo arrives</h3>
          <p>
            A resident photographs a road. Photo analysis returns structured observations, never a water depth, and the
            report changes nothing until a responder accepts it.
          </p>
          {report ? (
            <div className="evidence-chip">
              <div className="evidence-chip__row">
                <ReviewBadge status={report.reviewStatus} />
                <span className="mono detail">
                  {report.id} · <time dateTime={report.createdAt}>{formatTimeIST(report.createdAt)}</time>
                </span>
              </div>
              <p className="evidence-chip__name">{segmentsById.get(report.segmentId)?.name ?? report.segmentId}</p>
              <p className="detail">
                {report.observations
                  ? `${observationHeadline(report.observations.visible_water)}${report.reviewStatus === 'pending_review' ? '; awaiting review' : ''}.`
                  : 'No automated observation; a responder reviews the photo directly.'}{' '}
                Current estimate:{' '}
                {RISK_LABEL[riskById.get(report.segmentId)?.class ?? 'unknown']}
                {riskById.get(report.segmentId) ? ` (${formatScore(riskById.get(report.segmentId)?.score)})` : ''}.
              </p>
            </div>
          ) : (
            <p className="callout callout--muted">
              {reports.status === 'error'
                ? 'Photo reports are unavailable from this data source, so none is shown here.'
                : 'No photo report is waiting for review in this scenario.'}
            </p>
          )}
          <a className="text-link" href="#/responder">
            Review reports in the responder console <ArrowRight aria-hidden="true" size={16} />
          </a>
        </TabPanel>

        <TabPanel idPrefix="story" id="routes" active={step === 'routes'} className="story-panel">
          <h3 className="story-panel__title">
            {currentRoutes ? outcomeSummary(currentRoutes).title : 'Two routes, compared'}
          </h3>
          <p>
            The fastest route is compared with alternatives on travel time and estimated exposure. A lower-exposure route is
            recommended only when it clearly improves on the fastest.
          </p>
          {currentRoutes ? (
            <ul className="mini-routes">
              {currentRoutes.candidates.map((c) => {
                const fastest = currentRoutes.candidates.find((x) => x.id === currentRoutes.fastestCandidateId);
                return (
                  <li key={c.id} className={c.blocked ? 'is-blocked' : undefined}>
                    <span className="mini-routes__label">
                      {c.label}
                      {c.id === currentRoutes.recommendedCandidateId && (
                        <span className="detail">
                          {' '}
                          · {currentRoutes.outcome === 'fastest_default' ? 'default' : 'recommended'}
                        </span>
                      )}
                    </span>
                    <span className="mini-routes__metrics">
                      {c.blocked ? (
                        <span className="badge badge--closed badge--sm">
                          <Ban aria-hidden="true" size={14} /> Blocked
                        </span>
                      ) : (
                        <>
                          <span className="mono">{formatMinutes(c.travelMinutes)}</span>
                          <span className="detail">
                            {c.isFastest || !fastest ? 'fastest' : formatExtraMinutes(c.travelMinutes - fastest.travelMinutes)}
                          </span>
                          <span className="mono">{formatExposure(c.exposure)}</span>
                          <StatusBadge status={c.maxClass} size="sm" />
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="callout callout--muted">
              {routes.status === 'error' ? 'Route comparison is unavailable right now; no route is invented.' : 'Comparing routes…'}
            </p>
          )}
          <a className="text-link" href="#/resident">
            Compare routes yourself <ArrowRight aria-hidden="true" size={16} />
          </a>
        </TabPanel>

        <TabPanel idPrefix="story" id="respond" active={step === 'respond'} className="story-panel">
          <h3 className="story-panel__title">Two drains, one baseline</h3>
          <p>
            The console estimates clearing each modelled drain against the same baseline and ranks the two by reduction in
            exposure on a selected route, then by segments leaving High. It is advisory: nothing is dispatched.
          </p>
          <ul className="mini-drains">
            {pilot.drains.features.map((d) => (
              <li key={d.id}>
                <span className="drain-chip mono">{d.id}</span>
                <span>
                  <strong>{d.properties.label}</strong>
                  <span className="detail">
                    {' '}
                    · affects {pluralize(d.properties.affectedSegmentIds.length, 'segment')}
                    {d.properties.illustrative ? ' · illustrative location' : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <a className="text-link" href="#/responder">
            Compare both actions in the console <ArrowRight aria-hidden="true" size={16} />
          </a>
        </TabPanel>
      </div>

      <figure className="story__map">
        <PilotSketch
          pilot={pilot}
          classes={classes}
          closed={closed}
          routes={routesShown}
          focusSegments={focusSegments}
          focusDrains={focusDrains}
          reportPoints={reportPoints}
          endpoints={step === 'routes' ? endpoints : []}
          width={desktop ? 780 : 640}
          height={460}
          title="Pilot roads coloured by estimated risk class"
          hoveredSegment={hovered}
          onHoverSegment={setHovered}
        />
        <figcaption className="story__caption">
          <span className="story__hover" aria-hidden="true">
            {hoveredName
              ? `${hoveredName} · ${RISK_LABEL[hoveredRisk?.class ?? 'unknown']}${hoveredRisk ? ` · score ${formatScore(hoveredRisk.score)}` : ''}${closed.has(hovered!) ? ' · closed' : ''}`
              : 'Point at a road to read its estimate.'}
          </span>
          <span className="story__provenance">
            <ModePill mode={snapshot.status === 'ready' ? snapshot.data.mode : mode} />
            {snapshot.status === 'ready' ? (
              <span className="mono">
                risk calculated <time dateTime={snapshot.data.computedAt}>{formatTimeIST(snapshot.data.computedAt)}</time>
              </span>
            ) : (
              <span>No current risk data; roads shown as Unknown</span>
            )}
            <span>Illustrative geometry · contours show the terrain prior, not surveyed elevation</span>
          </span>
          <SketchKey />
        </figcaption>
      </figure>
    </div>
  );
}

function SketchKey() {
  return (
    <ul className="sketch-key" aria-label="Key">
      {(['low', 'watch', 'high', 'unknown', 'closed'] as const).map((k) => (
        <li key={k}>
          <span className={`legend-swatch legend-swatch--${k}`} aria-hidden="true" />
          {k === 'closed' ? 'Closed' : RISK_LABEL[k]}
        </li>
      ))}
      <li>
        <span className="legend-swatch legend-swatch--route-halo" aria-hidden="true" />
        Route shown
      </li>
      <li>
        <span className="legend-swatch legend-swatch--drain" aria-hidden="true" />
        Modelled drain
      </li>
    </ul>
  );
}
