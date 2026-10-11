import { AttributionControl, Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef, useState } from 'react';
import { DELHI_SCOPE_LABEL } from '../components/MapScopeSwitch';
import { delhiHybridStyleUrl } from '../lib/delhiStyle';

setWorkerUrl(maplibreWorkerUrl);

// Delhi NCT context only. No risk, route, report, drain, or pilot GeoJSON is added here.
const DELHI_BOUNDS: [[number, number], [number, number]] = [[76.84, 28.40], [77.38, 28.89]];
const styleUrl = delhiHybridStyleUrl(import.meta.env.VITE_DELHI_HYBRID_STYLE_URL);
const staticMapRequested = new URLSearchParams(window.location.search).get('map') === 'static';

export function DelhiOverview({ onReturnToPilot }: { onReturnToPilot: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>(styleUrl && !staticMapRequested ? 'loading' : 'unavailable');

  useEffect(() => {
    if (!styleUrl || !containerRef.current || staticMapRequested) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: containerRef.current,
        style: styleUrl,
        bounds: DELHI_BOUNDS,
        fitBoundsOptions: { padding: 24 },
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        maxZoom: 19,
      });
    } catch {
      const failureTimer = window.setTimeout(() => setState('unavailable'), 0);
      return () => window.clearTimeout(failureTimer);
    }
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new AttributionControl({ compact: false, customAttribution: 'Amazon Location Service' }), 'bottom-right');
    map.on('load', () => setState('ready'));
    map.on('error', () => setState('unavailable'));
    const timer = window.setTimeout(() => setState((current) => current === 'loading' ? 'unavailable' : current), 15000);
    return () => {
      window.clearTimeout(timer);
      map.remove();
    };
  }, []);

  return (
    <section className="delhi-overview" aria-label="Delhi satellite overview">
      <div ref={containerRef} className="delhi-overview__map" role="region" aria-label="Pannable and zoomable Delhi Hybrid basemap" hidden={state === 'unavailable'} />
      <p className="delhi-overview__coverage">{DELHI_SCOPE_LABEL}</p>
      {state === 'ready' && <p className="delhi-overview__context">Satellite imagery and labels provide geographic context only, not current flood evidence.</p>}
      {state === 'loading' && <p className="delhi-overview__notice" role="status">Loading Delhi Hybrid basemap…</p>}
      {state === 'unavailable' && (
        <div className="delhi-overview__notice delhi-overview__notice--error" role="alert">
          <h2>Delhi basemap unavailable</h2>
          <p>Imagery could not load or is not configured. Flood risk here is unassessed; no low-risk status is implied.</p>
          <p>For development, configure the restricted Amazon Location Hybrid style URL, or continue with the synthetic pilot.</p>
          <button type="button" className="btn btn--secondary" onClick={onReturnToPilot}>Open pilot scenario</button>
        </div>
      )}
    </section>
  );
}
