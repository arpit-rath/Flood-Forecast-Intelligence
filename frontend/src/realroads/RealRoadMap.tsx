import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef, useState } from 'react';
import type { RealRoadEvidence, RealRoadId } from '../../../contracts/types';
import { readToken, usePrefersReducedMotion } from '../lib/hooks';
import { roadMidpoint, type RoadSnapshot } from './model';
import { reportOverlay, roadOverlay } from './overlay';

setWorkerUrl(maplibreWorkerUrl);

export type StreetStyle = 'Standard' | 'Hybrid';
export type CameraPosition = { longitude: number; latitude: number; zoom: number };

const DELHI_BOUNDS: [[number, number], [number, number]] = [[76.84, 28.40], [77.38, 28.89]];
const staticMapRequested = new URLSearchParams(window.location.search).get('map') === 'static';

export function RealRoadMap({
  style,
  urls,
  selectedRoadId,
  evidence,
  roads,
  now,
  onSelect,
  onCameraChange,
}: {
  style: StreetStyle;
  urls: Record<StreetStyle, string> | null;
  selectedRoadId: RealRoadId | null;
  evidence: RealRoadEvidence[];
  roads: RoadSnapshot;
  now: Date;
  onSelect: (id: RealRoadId, point: [number, number]) => void;
  onCameraChange: (camera: CameraPosition) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const styleRef = useRef<StreetStyle>('Standard');
  const pendingCamera = useRef<{ center: [number, number]; zoom: number; bearing: number; pitch: number } | null>(null);
  const inputs = useRef({ selectedRoadId, evidence, roads, now, onSelect, onCameraChange });
  const timeoutRef = useRef<number | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>(urls && !staticMapRequested ? 'loading' : 'unavailable');
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    inputs.current = { selectedRoadId, evidence, roads, now, onSelect, onCameraChange };
  }, [selectedRoadId, evidence, roads, now, onSelect, onCameraChange]);

  useEffect(() => {
    if (!urls || !containerRef.current || staticMapRequested) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: containerRef.current,
        style: urls.Standard,
        bounds: DELHI_BOUNDS,
        fitBoundsOptions: { padding: 24 },
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        maxZoom: 19,
      });
    } catch {
      const timer = window.setTimeout(() => setState('unavailable'), 0);
      return () => window.clearTimeout(timer);
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new AttributionControl({
      compact: false,
      customAttribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors (ODbL)</a>',
    }), 'bottom-right');

    const emitCamera = () => {
      const center = map.getCenter();
      inputs.current.onCameraChange({ longitude: center.lng, latitude: center.lat, zoom: map.getZoom() });
    };
    const installOverlay = () => {
      if (pendingCamera.current) {
        map.jumpTo(pendingCamera.current);
        pendingCamera.current = null;
      }
      if (!map.getSource('real-roads')) map.addSource('real-roads', { type: 'geojson', data: roadOverlay(inputs.current.selectedRoadId, inputs.current.evidence, inputs.current.now, inputs.current.roads) });
      if (!map.getSource('real-road-reports')) map.addSource('real-road-reports', { type: 'geojson', data: reportOverlay(inputs.current.evidence, inputs.current.now, inputs.current.roads) });
      const unknown = readToken('--v-status-unknown', '#697B82');
      const blocked = readToken('--v-status-high', '#B33A32');
      const selected = readToken('--v-action', '#0B7378');
      const surface = readToken('--v-surface', '#FFFFFF');
      if (!map.getLayer('real-roads-unknown')) map.addLayer({
        id: 'real-roads-unknown', type: 'line', source: 'real-roads',
        filter: ['==', ['get', 'condition'], 'unknown'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': unknown, 'line-width': 3, 'line-opacity': 0.9, 'line-dasharray': [2, 2] },
      });
      if (!map.getLayer('real-roads-blocked')) map.addLayer({
        id: 'real-roads-blocked', type: 'line', source: 'real-roads',
        filter: ['==', ['get', 'condition'], 'confirmed_blockage'],
        paint: { 'line-color': blocked, 'line-width': 6 },
      });
      if (!map.getLayer('real-roads-selection-halo')) map.addLayer({
        id: 'real-roads-selection-halo', type: 'line', source: 'real-roads',
        filter: ['==', ['get', 'selected'], true],
        paint: { 'line-color': surface, 'line-width': 11 },
      });
      if (!map.getLayer('real-roads-selection')) map.addLayer({
        id: 'real-roads-selection', type: 'line', source: 'real-roads',
        filter: ['==', ['get', 'selected'], true],
        paint: { 'line-color': selected, 'line-width': 5 },
      });
      if (!map.getLayer('real-roads-hit')) map.addLayer({
        id: 'real-roads-hit', type: 'line', source: 'real-roads',
        paint: { 'line-color': unknown, 'line-width': 20, 'line-opacity': 0 },
      });
      if (!map.getLayer('real-road-report-markers')) map.addLayer({
        id: 'real-road-report-markers', type: 'circle', source: 'real-road-reports',
        paint: {
          'circle-radius': 7,
          'circle-color': ['match', ['get', 'state'], 'Confirmed Blockage', blocked, 'Cleared', selected, unknown],
          'circle-stroke-color': surface,
          'circle-stroke-width': 3,
        },
      });
      (map.getSource('real-roads') as GeoJSONSource).setData(roadOverlay(inputs.current.selectedRoadId, inputs.current.evidence, inputs.current.now, inputs.current.roads));
      (map.getSource('real-road-reports') as GeoJSONSource).setData(reportOverlay(inputs.current.evidence, inputs.current.now, inputs.current.roads));
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      map.resize();
      emitCamera();
      setState('ready');
    };
    map.on('style.load', installOverlay);
    map.on('moveend', emitCamera);
    map.on('click', 'real-roads-hit', (event) => {
      const id = event.features?.[0]?.properties?.roadId;
      if (typeof id === 'string' && /^osm:way\/\d+$/.test(id)) inputs.current.onSelect(id as RealRoadId, [event.lngLat.lng, event.lngLat.lat]);
    });
    map.on('mouseenter', 'real-roads-hit', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'real-roads-hit', () => { map.getCanvas().style.cursor = ''; });
    map.on('error', () => setState('unavailable'));
    timeoutRef.current = window.setTimeout(() => setState((current) => current === 'loading' ? 'unavailable' : current), 15000);
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, [urls]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !urls || styleRef.current === style) return;
    styleRef.current = style;
    const center = map.getCenter();
    pendingCamera.current = { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
    setState('loading');
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setState((current) => current === 'loading' ? 'unavailable' : current), 15000);
    map.setStyle(urls[style]);
  }, [style, urls]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource('real-roads')) return;
    (map.getSource('real-roads') as GeoJSONSource).setData(roadOverlay(selectedRoadId, evidence, now, roads));
    (map.getSource('real-road-reports') as GeoJSONSource).setData(reportOverlay(evidence, now, roads));
    const selectedRoad = roads.features.find((road) => road.id === selectedRoadId);
    if (selectedRoad && !map.getBounds().contains(roadMidpoint(selectedRoad))) {
      map.easeTo({ center: roadMidpoint(selectedRoad), zoom: Math.max(map.getZoom(), 15), duration: reducedMotion ? 0 : 500 });
    }
  }, [selectedRoadId, evidence, roads, now, reducedMotion]);

  const fitCoveredRoads = () => {
    const map = mapRef.current;
    if (!map || state !== 'ready') return;
    const [west, south, east, north] = roads.metadata.queryBbox;
    map.fitBounds([[west, south], [east, north]], { padding: 36, duration: reducedMotion ? 0 : 500 });
  };

  return (
    <section className="real-map" aria-label="Delhi road map">
      <div ref={containerRef} className="real-map__canvas" role="region" aria-label={`Pannable Delhi ${style === 'Standard' ? 'street' : 'satellite'} basemap`} hidden={state === 'unavailable'} />
      <div className="real-map__controls">
        <button type="button" className="btn btn--secondary btn--sm" onClick={fitCoveredRoads} disabled={state !== 'ready'}>Zoom to mapped roads</button>
      </div>
      {state === 'loading' && <p className="real-map__notice" role="status">Loading Delhi {style} basemap...</p>}
      {state === 'unavailable' && (
        <div className="real-map__notice real-map__notice--error" role="alert">
          <h2>Delhi basemap unavailable</h2>
          <p>The {style} map could not load or is not configured. Roads here remain Unknown; a blank map is not evidence of low risk.</p>
          <p>Configure a restricted Amazon Location map key for Standard and Hybrid, then reload. The sourced road list remains available below.</p>
          <a href={roads.metadata.licenceUrl} target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors (ODbL)</a>
        </div>
      )}
    </section>
  );
}
