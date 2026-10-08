import { FlaskConical } from 'lucide-react';
import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RiskClass } from '../api/types';
import { readToken } from '../lib/hooks';
import { useAppState } from '../state/AppState';
import { MapLegend } from './MapLegend';

// MapLibre locates its worker relative to its own module, which breaks once
// Vite bundles it; serve the self-contained worker file as an asset instead.
setWorkerUrl(maplibreWorkerUrl);

const SEGMENT_LAYERS = ['segments-known', 'segments-unknown', 'segments-closed'];

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
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': readToken('--v-surface-muted', '#ECF1F2') } }],
  };
}

export function MapView({ className = '', legendOpen }: { className?: string; legendOpen?: boolean }) {
  const {
    pilot,
    riskById,
    snapshot,
    selectedSegmentId,
    selectSegment,
    currentRoutes,
    selectedRouteId,
    simulationPreview,
    intervention,
    reports,
  } = useAppState();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const selectRef = useRef(selectSegment);
  useEffect(() => {
    selectRef.current = selectSegment;
  }, [selectSegment]);

  const pilotData = pilot.status === 'ready' ? pilot.data : null;

  const simulatedClasses = useMemo(() => {
    if (!simulationPreview || intervention.status !== 'ready') return null;
    if (intervention.data.comparisonId !== simulationPreview.comparisonId) return null;
    const option = intervention.data.options.find((o) => o.drainId === simulationPreview.drainId);
    if (!option) return null;
    return new Map<string, RiskClass>(option.segmentChanges.map((c) => [c.segmentId, c.afterClass]));
  }, [simulationPreview, intervention]);

  // Create the map once pilot geometry is available.
  useEffect(() => {
    if (!pilotData || !containerRef.current || mapRef.current) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: containerRef.current,
        style: baseStyle(),
        bounds: pilotData.bounds,
        fitBoundsOptions: { padding: 24 },
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
      });
    } catch {
      setMapError('The map could not start on this device. Use the list and cards; they contain the same information.');
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: pilotData.sources.map((s) => s.name).join(' · '),
      }),
      'bottom-right',
    );

    map.on('load', () => {
      const tokens = {
        low: readToken('--v-status-low', '#177B5A'),
        watch: readToken('--v-status-watch', '#A9630B'),
        high: readToken('--v-status-high', '#B33A32'),
        unknown: readToken('--v-status-unknown', '#697B82'),
        closed: readToken('--v-status-closed', '#142B33'),
        ink: readToken('--v-text', '#142B33'),
        surface: readToken('--v-surface', '#FFFFFF'),
        routeRec: readToken('--v-route-recommended', '#0B7378'),
        routeAlt: readToken('--v-route-alternate', '#2F5FA8'),
      };
      map.addImage('closure-hatch', hatchImage(tokens.closed));
      map.addSource('segments', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('reports', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      map.addLayer({
        id: 'segments-selected-casing',
        type: 'line',
        source: 'segments',
        filter: ['==', ['get', 'selected'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': tokens.ink, 'line-width': 14 },
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
        paint: { 'line-color': tokens.surface, 'line-width': 9, 'line-offset': -10 },
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
        paint: { 'line-color': tokens.routeRec, 'line-width': 5, 'line-offset': -10 },
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

      for (const drain of pilotData.drains.features) {
        const el = document.createElement('div');
        el.className = 'map-drain-marker';
        el.textContent = drain.id;
        el.setAttribute('aria-hidden', 'true');
        new Marker({ element: el }).setLngLat(drain.geometry.coordinates).addTo(map);
      }
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
    const container = containerRef.current;
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            if (container.clientWidth === 0 || container.clientHeight === 0) return;
            map.resize();
            if (!userMoved) map.fitBounds(pilotData.bounds, { padding: 24, animate: false });
          })
        : null;
    observer?.observe(container);

    map.on('error', (e) => {
      // Basemap tile failures should not hide the risk overlay.
      if (!map.isStyleLoaded()) setMapError(`Map style failed to load: ${e.error?.message ?? 'unknown error'}`);
    });

    return () => {
      observer?.disconnect();
      map.remove();
      mapRef.current = null;
      setLoaded(false);
    };
  }, [pilotData]);

  // Segment colours and states.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !pilotData) return;
    const hasSnapshot = snapshot.status === 'ready';
    (map.getSource('segments') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: pilotData.segments.features.map((f) => {
        const risk = riskById.get(f.id);
        const simulated = simulatedClasses?.get(f.id);
        return {
          type: 'Feature',
          id: f.id,
          geometry: f.geometry,
          properties: {
            id: f.id,
            cls: simulated ?? (hasSnapshot && risk ? risk.class : 'unknown'),
            closed: Boolean(risk?.closure && risk.closure.status === 'confirmed'),
            selected: f.id === selectedSegmentId,
          },
        };
      }),
    });
  }, [loaded, pilotData, riskById, snapshot.status, selectedSegmentId, simulatedClasses]);

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

  return (
    <div className={`map-shell ${className}`}>
      <div
        ref={containerRef}
        className="map-canvas"
        role="region"
        aria-label="Pilot map"
        aria-describedby="map-description"
      />
      <p id="map-description" className="visually-hidden">
        Visual map of pilot road segments coloured by risk class. Every map state is also listed in text in the panels.
      </p>
      {pilotData?.geometryNote && <p className="map-chip map-chip--note">Illustrative fixture geometry</p>}
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
      {mapError && <p className="map-error">{mapError}</p>}
      <MapLegend defaultOpen={legendOpen} />
    </div>
  );
}
