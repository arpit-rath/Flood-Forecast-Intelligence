import { ChevronRight, FlaskConical, X } from 'lucide-react';
import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type GeoJSONSourceSpecification,
  type IControl,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PilotResponse, RiskClass } from '../api/types';
import { RISK_LABEL } from '../lib/copy';
import { labelOffset, roadLabels, segmentMidpoint } from '../lib/geo';
import { readToken, usePrefersReducedMotion } from '../lib/hooks';
import { terrainContours } from '../lib/terrain';
import { useAppState } from '../state/AppState';
import { MapLegend } from './MapLegend';
import { PilotSketch } from './PilotSketch';
import { StatusBadge } from './StatusBadge';

// MapLibre locates its worker relative to its own module, which breaks once
// Vite bundles it; serve the self-contained worker file as an asset instead.
setWorkerUrl(maplibreWorkerUrl);

const SEGMENT_LAYERS = ['segments-known', 'segments-unknown', 'segments-closed'];

/** Road labels appear once a block is wide enough on screen to hold one. */
const LABEL_MAX_METRES_PER_PIXEL = 1.6;

function hatchImage(color: string) {
  const size = 16;
  const data = new Uint8ClampedArray(size * size * 4);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const onStripe = (x + y) % 8 < 3 || (x - y + size) % 8 < 3;
      const i = (y * size + x) * 4;
      data[i] = onStripe ? r : 255;
      data[i + 1] = onStripe ? g : 255;
      data[i + 2] = onStripe ? b : 255;
      data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

function baseStyle(): StyleSpecification | string {
  const styleUrl = import.meta.env.VITE_BASEMAP_STYLE_URL as string | undefined;
  if (styleUrl) return styleUrl;
  // Quiet, offline-safe default: the fixture grid is illustrative, so it is
  // not drawn over real street tiles where it would look like surveyed data.
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': readToken('--v-map-bg', '#EDF2F0') } }],
  };
}

function framePadding(width: number) {
  return width < 640
    ? { top: 48, bottom: 56, left: 20, right: 64 }
    : { top: 64, bottom: 72, left: 48, right: 80 };
}

/** "Fit pilot area" button, grouped with the zoom controls. */
class FitControl implements IControl {
  private container?: HTMLDivElement;
  private readonly onFit: () => void;
  constructor(onFit: () => void) {
    this.onFit = onFit;
  }
  onAdd() {
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group map-recenter';
    const button = document.createElement('button');
    button.type = 'button';
    button.title = 'Fit pilot area';
    button.setAttribute('aria-label', 'Fit pilot area');
    button.innerHTML =
      '<span class="maplibregl-ctrl-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg></span>';
    button.addEventListener('click', this.onFit);
    container.appendChild(button);
    this.container = container;
    return container;
  }
  onRemove() {
    this.container?.remove();
  }
}

function forceStaticMap(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('map') === 'static';
  } catch {
    return false;
  }
}

export function MapView({
  className = '',
  legendOpen,
  onOpenSelection,
}: {
  className?: string;
  legendOpen?: boolean;
  /** When set, selecting a road shows a peek card with a link to its details. */
  onOpenSelection?: () => void;
}) {
  const {
    pilot,
    riskById,
    snapshot,
    selectedSegmentId,
    selectSegment,
    segmentsById,
    currentRoutes,
    selectedRouteId,
    routeQuery,
    simulationPreview,
    intervention,
    reports,
  } = useAppState();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const placeMarkers = useRef(new Map<string, HTMLElement>());
  const [loaded, setLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [labelsOn, setLabelsOn] = useState(false);
  const [staticMap, setStaticMap] = useState(forceStaticMap);
  const reducedMotion = usePrefersReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  const selectRef = useRef(selectSegment);
  useEffect(() => {
    selectRef.current = selectSegment;
    reducedMotionRef.current = reducedMotion;
  }, [selectSegment, reducedMotion]);

  const pilotData = pilot.status === 'ready' ? pilot.data : null;

  const simulatedClasses = useMemo(() => {
    if (!simulationPreview || intervention.status !== 'ready') return null;
    if (intervention.data.comparisonId !== simulationPreview.comparisonId) return null;
    const option = intervention.data.options.find((o) => o.drainId === simulationPreview.drainId);
    if (!option) return null;
    return new Map<string, RiskClass>(option.segmentChanges.map((c) => [c.segmentId, c.afterClass]));
  }, [simulationPreview, intervention]);

  const classes = useMemo(() => {
    const map = new Map<string, RiskClass>();
    if (!pilotData) return map;
    const hasSnapshot = snapshot.status === 'ready';
    for (const f of pilotData.segments.features) {
      const risk = riskById.get(f.id);
      map.set(f.id, simulatedClasses?.get(f.id) ?? (hasSnapshot && risk ? risk.class : 'unknown'));
    }
    return map;
  }, [pilotData, riskById, snapshot.status, simulatedClasses]);

  const closed = useMemo(
    () => new Set([...riskById.values()].filter((r) => r.closure?.status === 'confirmed').map((r) => r.segmentId)),
    [riskById],
  );

  // Create the map once pilot geometry is available.
  useEffect(() => {
    if (!pilotData || !containerRef.current || mapRef.current || staticMap) return;
    let map: MapLibreMap;
    const container = containerRef.current;
    try {
      map = new MapLibreMap({
        container,
        style: baseStyle(),
        bounds: pilotData.bounds,
        fitBoundsOptions: { padding: framePadding(container.clientWidth) },
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        maxZoom: 19,
      });
    } catch {
      // No WebGL (or a blocked context): fall back on the next tick.
      window.setTimeout(() => {
        setMapError('The interactive map could not start on this device. A static sketch is shown; the lists and cards hold the same information.');
        setStaticMap(true);
      }, 0);
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();

    const fit = (animate: boolean) =>
      map.fitBounds(pilotData.bounds, {
        padding: framePadding(container.clientWidth),
        animate: animate && !reducedMotionRef.current,
        duration: 600,
      });

    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new FitControl(() => fit(true)), 'top-right');
    map.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: pilotData.sources.map((s) => s.name).join(' · '),
      }),
      'bottom-right',
    );

    const updateLabels = () => {
      const lat = map.getCenter().lat;
      const metresPerPixel = (78271.517 * Math.cos((lat * Math.PI) / 180)) / 2 ** map.getZoom();
      setLabelsOn(metresPerPixel <= LABEL_MAX_METRES_PER_PIXEL);
    };
    map.on('zoomend', updateLabels);

    map.on('load', () => {
      const tokens = {
        low: readToken('--v-status-low', '#177B5A'),
        watch: readToken('--v-status-watch', '#A9630B'),
        high: readToken('--v-status-high', '#B33A32'),
        unknown: readToken('--v-status-unknown', '#697B82'),
        closed: readToken('--v-status-closed', '#142B33'),
        ink: readToken('--v-text', '#142B33'),
        surface: readToken('--v-surface', '#FFFFFF'),
        paper: readToken('--v-map-bg', '#EDF2F0'),
        contour: readToken('--v-map-contour', '#5E7B83'),
        frame: readToken('--v-map-frame', '#8FA5AA'),
        routeRec: readToken('--v-route-recommended', '#0B7378'),
        routeAlt: readToken('--v-route-alternate', '#2F5FA8'),
        changed: readToken('--v-teal-300', '#6FC0BA'),
      };
      map.addImage('closure-hatch', hatchImage(tokens.closed));
      map.addSource('terrain', { type: 'geojson', data: contourCollection(pilotData) });
      map.addSource('frame', { type: 'geojson', data: frameFeature(pilotData) });
      map.addSource('segments', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('reports', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      map.addLayer({
        id: 'terrain-contours',
        type: 'line',
        source: 'terrain',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': tokens.contour,
          'line-width': ['case', ['==', ['get', 'inner'], true], 1.4, 1],
          'line-opacity': ['case', ['==', ['get', 'inner'], true], 0.5, 0.28],
        },
      });
      map.addLayer({
        id: 'pilot-frame',
        type: 'line',
        source: 'frame',
        paint: { 'line-color': tokens.frame, 'line-width': 1, 'line-dasharray': [2, 3] },
      });
      map.addLayer({
        id: 'segments-changed',
        type: 'line',
        source: 'segments',
        filter: ['==', ['get', 'changed'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': tokens.changed, 'line-width': 22, 'line-opacity': 0, 'line-blur': 4 },
      });
      map.addLayer({
        id: 'routes-selected-glow',
        type: 'line',
        source: 'routes',
        filter: ['==', ['get', 'selected'], true],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': tokens.routeRec, 'line-width': 18, 'line-opacity': 0.14, 'line-offset': -10, 'line-blur': 2 },
      });
      map.addLayer({
        id: 'segments-selected-casing',
        type: 'line',
        source: 'segments',
        filter: ['==', ['get', 'selected'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': tokens.ink, 'line-width': 15 },
      });
      map.addLayer({
        id: 'segments-halo',
        type: 'line',
        source: 'segments',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': tokens.surface, 'line-width': ['case', ['==', ['get', 'selected'], true], 10, 8] },
      });
      map.addLayer({
        id: 'segments-known',
        type: 'line',
        source: 'segments',
        filter: ['all', ['!=', ['get', 'cls'], 'unknown'], ['!=', ['get', 'closed'], true]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'cls'], 'low', tokens.low, 'watch', tokens.watch, 'high', tokens.high, tokens.unknown],
          'line-width': ['match', ['get', 'cls'], 'high', 7, 5],
        },
      });
      map.addLayer({
        id: 'segments-unknown',
        type: 'line',
        source: 'segments',
        filter: ['all', ['==', ['get', 'cls'], 'unknown'], ['!=', ['get', 'closed'], true]],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': tokens.unknown, 'line-width': 4, 'line-dasharray': [1.5, 1.2] },
      });
      map.addLayer({
        id: 'segments-closed',
        type: 'line',
        source: 'segments',
        filter: ['==', ['get', 'closed'], true],
        paint: { 'line-pattern': 'closure-hatch', 'line-width': 8 },
      });
      map.addLayer({
        id: 'routes-selected-casing',
        type: 'line',
        source: 'routes',
        filter: ['==', ['get', 'selected'], true],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': tokens.surface, 'line-width': 10, 'line-offset': -10 },
      });
      map.addLayer({
        id: 'routes-alternate',
        type: 'line',
        source: 'routes',
        filter: ['==', ['get', 'selected'], false],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': tokens.routeAlt, 'line-width': 3.5, 'line-offset': -10, 'line-dasharray': [2, 1.5] },
      });
      map.addLayer({
        id: 'routes-selected',
        type: 'line',
        source: 'routes',
        filter: ['==', ['get', 'selected'], true],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': tokens.routeRec, 'line-width': 6, 'line-offset': -10 },
      });
      map.addLayer({
        id: 'reports',
        type: 'circle',
        source: 'reports',
        paint: {
          'circle-radius': 6,
          'circle-color': tokens.surface,
          'circle-stroke-color': tokens.ink,
          'circle-stroke-width': 2.5,
        },
      });

      for (const layer of SEGMENT_LAYERS) {
        map.on('click', layer, (e) => {
          const id = e.features?.[0]?.properties?.id;
          if (typeof id === 'string') selectRef.current(id);
        });
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
      }

      for (const label of roadLabels(pilotData)) {
        const el = document.createElement('div');
        el.className = 'map-road-label';
        el.textContent = label.name;
        el.setAttribute('aria-hidden', 'true');
        new Marker({ element: el, rotation: label.angle, rotationAlignment: 'viewport', offset: labelOffset(label.angle) })
          .setLngLat(label.point)
          .addTo(map);
      }

      for (const place of pilotData.places) {
        const el = document.createElement('div');
        el.className = 'map-place-marker';
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = '<span class="map-place-marker__dot"></span><span class="map-place-marker__label"></span>';
        el.querySelector('.map-place-marker__label')!.textContent = place.label;
        placeMarkers.current.set(place.id, el);
        new Marker({ element: el, anchor: 'left', offset: [-6, 0] }).setLngLat(place.point).addTo(map);
      }

      for (const drain of pilotData.drains.features) {
        const el = document.createElement('div');
        el.className = 'map-drain-marker';
        el.textContent = drain.id;
        el.setAttribute('aria-hidden', 'true');
        new Marker({ element: el }).setLngLat(drain.geometry.coordinates).addTo(map);
      }
      // Compact attribution starts expanded; keep it to its (i) button so it
      // does not sit under the legend. It stays one click away.
      container.parentElement
        ?.querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show')
        ?.classList.remove('maplibregl-compact-show');
      updateLabels();
      setLoaded(true);
    });

    // Hidden tab panels and late layout start at the wrong size: resize and
    // keep the pilot framed until the user pans or zooms themselves.
    let userMoved = false;
    const markMoved = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) userMoved = true;
    };
    map.on('dragstart', markMoved);
    map.on('zoomstart', markMoved);
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            if (container.clientWidth === 0 || container.clientHeight === 0) return;
            map.resize();
            if (!userMoved) fit(false);
            updateLabels();
          })
        : null;
    observer?.observe(container);

    map.on('error', (e) => {
      // Basemap tile failures should not hide the risk overlay; a style that
      // never loads falls back to the static sketch.
      if (!map.isStyleLoaded()) {
        setMapError(`Map style failed to load (${e.error?.message ?? 'unknown error'}). A static sketch is shown instead.`);
        setStaticMap(true);
      }
    });

    const markers = placeMarkers.current;
    return () => {
      observer?.disconnect();
      map.remove();
      mapRef.current = null;
      markers.clear();
      setLoaded(false);
    };
  }, [pilotData, staticMap]);

  // Segment colours and states; a one-off highlight marks roads whose class
  // just changed (after a review or when a simulation is shown).
  const previousClasses = useRef<Map<string, RiskClass> | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !pilotData) return;
    const prev = previousClasses.current;
    const changed = new Set<string>();
    if (prev) for (const [id, cls] of classes) if (prev.get(id) !== cls) changed.add(id);
    previousClasses.current = classes;

    (map.getSource('segments') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: pilotData.segments.features.map((f) => ({
        type: 'Feature',
        id: f.id,
        geometry: f.geometry,
        properties: {
          id: f.id,
          cls: classes.get(f.id) ?? 'unknown',
          closed: closed.has(f.id),
          selected: f.id === selectedSegmentId,
          changed: changed.has(f.id),
        },
      })),
    });

    if (changed.size === 0 || changed.size > 20 || reducedMotionRef.current) return;
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 1600);
      if (!map.getLayer('segments-changed')) return;
      map.setPaintProperty('segments-changed', 'line-opacity', 0.75 * (1 - t) * (1 - t));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      if (map.getLayer('segments-changed')) map.setPaintProperty('segments-changed', 'line-opacity', 0);
    };
  }, [loaded, pilotData, classes, closed, selectedSegmentId]);

  // Bring a road selected from a list into view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !pilotData || !selectedSegmentId) return;
    const point = segmentMidpoint(pilotData, selectedSegmentId);
    if (!point || map.getBounds().contains(point)) return;
    map.easeTo({ center: point, duration: reducedMotionRef.current ? 0 : 600 });
  }, [loaded, pilotData, selectedSegmentId]);

  // Route candidates.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource('routes') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: (currentRoutes?.candidates ?? []).map((c) => ({
        type: 'Feature',
        id: c.id,
        geometry: c.geometry,
        properties: { id: c.id, selected: c.id === selectedRouteId },
      })),
    });
  }, [loaded, currentRoutes, selectedRouteId]);

  // Route endpoints: A and B on the chosen places.
  useEffect(() => {
    if (!loaded) return;
    for (const [id, el] of placeMarkers.current) {
      const role = routeQuery?.originPlaceId === id ? 'A' : routeQuery?.destinationPlaceId === id ? 'B' : null;
      el.classList.toggle('map-place-marker--endpoint', Boolean(role));
      el.querySelector('.map-place-marker__dot')!.textContent = role ?? '';
    }
  }, [loaded, routeQuery]);

  // Report locations (no reporter identity is ever on the map).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const list = reports.status === 'ready' ? reports.data : [];
    (map.getSource('reports') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: list
        .filter((r) => r.reviewStatus !== 'rejected')
        .map((r) => ({ type: 'Feature', id: r.id, geometry: { type: 'Point', coordinates: r.point }, properties: { id: r.id } })),
    });
  }, [loaded, reports]);

  const noRiskData = snapshot.status === 'error';
  const selected = selectedSegmentId ? segmentsById.get(selectedSegmentId) : undefined;

  return (
    <div className={`map-shell${labelsOn ? ' map-shell--labels' : ''} ${className}`}>
      <div
        ref={containerRef}
        className="map-canvas"
        role="region"
        aria-label="Pilot map"
        aria-describedby="map-description"
        hidden={staticMap}
      />
      <p id="map-description" className="visually-hidden">
        Visual map of pilot road segments coloured by risk class. Every map state is also listed in text in the panels.
      </p>
      {staticMap && pilotData && (
        <div className="map-fallback">
          <PilotSketch
            pilot={pilotData}
            classes={classes}
            closed={closed}
            routes={(currentRoutes?.candidates ?? []).map((c) => ({
              id: c.id,
              coordinates: c.geometry.coordinates,
              role: c.blocked ? 'blocked' : c.id === selectedRouteId ? 'selected' : 'alternate',
            }))}
            focusSegments={selectedSegmentId ? new Set([selectedSegmentId]) : undefined}
            title="Static sketch of pilot roads coloured by estimated risk class"
          />
        </div>
      )}
      <div className="map-chrome">
        {pilotData?.geometryNote && <p className="map-chip">Illustrative fixture geometry</p>}
        {staticMap && <p className="map-chip map-chip--warning">Static sketch · interactive map unavailable</p>}
        {simulatedClasses && (
          <p className="map-chip map-chip--simulated" role="status">
            <FlaskConical aria-hidden="true" size={14} /> Simulated: clear {simulationPreview?.drainId} · not current conditions
          </p>
        )}
        {noRiskData && (
          <p className="map-chip map-chip--warning" role="status">
            No current risk data · roads shown as Unknown
          </p>
        )}
      </div>
      {mapError && <p className="map-error">{mapError}</p>}
      {onOpenSelection && selected && (
        <div className="map-peek" role="group" aria-label="Selected road">
          <div className="map-peek__text">
            <span className="map-peek__name">{selected.name}</span>
            <span className="map-peek__meta">
              <StatusBadge status={classes.get(selected.id) ?? 'unknown'} size="sm" />
              {closed.has(selected.id) && <StatusBadge status="closed" size="sm" />}
              {simulatedClasses?.has(selected.id) && <span className="detail">simulated</span>}
            </span>
          </div>
          <button type="button" className="btn btn--primary btn--sm" onClick={onOpenSelection}>
            Details <ChevronRight aria-hidden="true" size={16} />
          </button>
          <button type="button" className="icon-button" onClick={() => selectSegment(null)} aria-label="Clear road selection">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
      )}
      <MapLegend defaultOpen={legendOpen} hasTerrain={Boolean(pilotData && pilotData.segments.features.some((f) => f.properties.terrainPrior !== null))} />
      <span className="visually-hidden" aria-live="polite">
        {selected ? `Selected ${selected.name}: ${RISK_LABEL[classes.get(selected.id) ?? 'unknown']}.` : ''}
      </span>
    </div>
  );
}

function contourCollection(pilot: PilotResponse): GeoJSONSourceSpecification['data'] {
  const levels = terrainContours(pilot);
  return {
    type: 'FeatureCollection',
    features: levels.flatMap((c, i) =>
      c.lines.map((line) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: line },
        properties: { level: c.level, inner: i === levels.length - 1 },
      })),
    ),
  };
}

function frameFeature(pilot: PilotResponse): GeoJSONSourceSpecification['data'] {
  const [w, s, e, n] = pilot.bounds;
  const dx = (e - w) * 0.04;
  const dy = (n - s) * 0.05;
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [w - dx, s - dy],
        [e + dx, s - dy],
        [e + dx, n + dy],
        [w - dx, n + dy],
        [w - dx, s - dy],
      ],
    },
    properties: {},
  };
}
