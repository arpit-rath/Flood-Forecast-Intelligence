import { CircleCheck, CircleHelp, Clock3, MapPin, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RealRoadEvidence, RealRoadId } from '../../../contracts/types';
import { BrandMark } from '../components/AppHeader';
import type { SignedInUser } from '../auth/cognito';
import { delhiStyleUrls } from '../lib/delhiStyle';
import { roadLabel, roads, roadCondition, type RoadSnapshot } from './model';
import { realRoadApi } from './api';
import { RealRoadReporting } from './RealRoadReporting';
import { RoadAlerts } from './RoadAlerts';
import { RealRoadMap, type CameraPosition, type StreetStyle } from './RealRoadMap';
import { RoadStatus } from './RoadStatus';
import './realroads.css';

const styleUrls = delhiStyleUrls(import.meta.env.VITE_DELHI_STANDARD_STYLE_URL, import.meta.env.VITE_DELHI_HYBRID_STYLE_URL);
const httpMode = import.meta.env.VITE_USE_MOCKS === 'false';

function viewFromHash(): 'resident' | 'responder' {
  return window.location.hash.startsWith('#/responder') ? 'responder' : 'resident';
}

function formatTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not recorded';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value)) + ' IST';
}

export function RealRoadApp() {
  const [view, setView] = useState(viewFromHash);
  const [style, setStyle] = useState<StreetStyle>('Standard');
  const [selectedRoadId, setSelectedRoadId] = useState<RealRoadId | null>(null);
  const [search, setSearch] = useState('');
  const [camera, setCamera] = useState<CameraPosition | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [roadSnapshot, setRoadSnapshot] = useState<RoadSnapshot>(roads);
  const [realRoadEvidence, setRealRoadEvidence] = useState<RealRoadEvidence[]>([]);
  const [apiReady, setApiReady] = useState(false);
  const [apiMessage, setApiMessage] = useState('Real-road reporting is read-only until /v2 is available.');
  const [selectedPoint, setSelectedPoint] = useState<[number, number] | null>(null);
  const [lastEvidenceFetch, setLastEvidenceFetch] = useState<Date | null>(null);
  const [signedInUser, setSignedInUser] = useState<SignedInUser | null>(null);

  useEffect(() => {
    if (!httpMode) return;
    let active = true;
    void Promise.all([realRoadApi.roads(), realRoadApi.evidence()]).then(([snapshot, result]) => {
      if (!active) return;
      if (!snapshot?.metadata?.geometryVersion || !Array.isArray(snapshot.features) || snapshot.features.length === 0 || !Array.isArray(result?.evidence)) throw new Error('Versioned road snapshot or evidence feed is unavailable.');
      setRoadSnapshot(snapshot);
      setRealRoadEvidence(result.evidence);
      setLastEvidenceFetch(new Date());
      setApiReady(true);
      setApiMessage('Versioned real-road reporting available for this limited OSM extract.');
    }).catch(() => { if (active) { setApiReady(false); setApiMessage('Real-road /v2 API unavailable. The mapped roads below are read-only and remain Unknown without reviewed evidence.'); } });
    return () => { active = false; };
  }, []);

  const refreshEvidence = useCallback(async () => {
    if (!apiReady) return;
    try {
      const result = await realRoadApi.evidence();
      if (!Array.isArray(result?.evidence)) throw new Error('Real-road evidence response is invalid.');
      setRealRoadEvidence(result.evidence);
      setLastEvidenceFetch(new Date());
      setNow(new Date());
    } catch (cause) {
      setRealRoadEvidence([]);
      setApiReady(false);
      setApiMessage('Real-road evidence feed unavailable. Showing Unknown instead of stale conditions; reload to retry.');
      throw cause;
    }
  }, [apiReady]);

  useEffect(() => {
    if (!apiReady) return;
    const timer = window.setInterval(() => { void refreshEvidence().catch(() => undefined); }, 60_000);
    return () => window.clearInterval(timer);
  }, [apiReady, refreshEvidence]);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => { window.removeEventListener('hashchange', onHash); window.clearInterval(timer); };
  }, []);
  useEffect(() => { document.title = `Delhi roads · Varuna ${view}`; }, [view]);

  const selectedRoad = roadSnapshot.features.find((road) => road.id === selectedRoadId) ?? null;
  const matches = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return roadSnapshot.features.filter((road) => !query || roadLabel(road).toLocaleLowerCase().includes(query) || road.id.includes(query));
  }, [search, roadSnapshot]);

  return (
    <div className="app real-preview">
      <a className="skip-link" href="#real-preview-main" onClick={(event) => {
        event.preventDefault();
        document.getElementById('real-preview-main')?.focus();
      }}>Skip to main content</a>
      <header className="app-header real-preview__header">
        <a className="brand" href="#/" aria-label="Varuna home"><BrandMark /><span className="brand__name">Varuna</span></a>
        <span className="app-header__pilot">Delhi real-road preview · not live flood monitoring</span>
        <nav aria-label="Views" className="view-nav">
          <a href="#/resident" aria-current={view === 'resident' ? 'page' : undefined}>Resident</a>
          <a href="#/responder" aria-current={view === 'responder' ? 'page' : undefined}>Responder</a>
        </nav>
      </header>
      <main id="real-preview-main" className="real-preview__main" tabIndex={-1}>
        <div className="real-preview__coverage" role="status">
          <MapPin aria-hidden="true" size={18} />
          <span>Delhi street map · OSM road overlay limited to a DTU-area extract ({roadSnapshot.features.length} ways). Roads elsewhere are unassessed; no Delhi-wide flood risk is available.</span>
        </div>
        <div className="real-preview__style-switch" role="group" aria-label="Map style">
          <span>Basemap</span>
          <button type="button" aria-pressed={style === 'Standard'} onClick={() => setStyle('Standard')}>Standard streets</button>
          <button type="button" aria-pressed={style === 'Hybrid'} onClick={() => setStyle('Hybrid')}>Hybrid satellite</button>
        </div>
        <div className="real-preview__workspace">
          <aside className="real-preview__panel" aria-label={`${view === 'resident' ? 'Resident' : 'Responder'} road information`}>
            <p className="eyebrow">{view === 'resident' ? 'Resident road view' : 'Responder road view'} · limited coverage</p>
            <h1>Real roads, unknown conditions.</h1>
            <p className="real-preview__intro">This map shows geographically located streets, not a flood forecast. The grey dashed overlay marks only roads in the OSM extract. A basemap street without an overlay is also unassessed.</p>
            <p className="real-preview__summary"><CircleHelp aria-hidden="true" size={18} /> {roadSnapshot.features.length} mapped ways · Unknown unless current responder-reviewed evidence says otherwise</p>
            <p className="detail" role="status">{apiMessage}</p>
            {lastEvidenceFetch && apiReady && <p className="detail">Evidence feed checked {formatTime(lastEvidenceFetch.toISOString())}. It refreshes every minute; an unavailable feed returns roads to Unknown.</p>}
            <label className="real-preview__search" htmlFor="road-search">Find a mapped road
              <input id="road-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or OSM way ID" />
            </label>
            <p className="detail">{matches.length} of {roadSnapshot.features.length} mapped ways shown. Select a road from this list or the map.</p>
            <ul className="real-preview__road-list" aria-label="Mapped roads">
              {matches.map((road) => (
                <li key={road.id}>
                  <button type="button" aria-pressed={selectedRoadId === road.id} onClick={() => { setSelectedRoadId(road.id); setSelectedPoint(null); }}>
                    {roadCondition(road.id, realRoadEvidence, now).kind === 'confirmed_blockage' ? <ShieldAlert aria-hidden="true" size={17} /> : roadCondition(road.id, realRoadEvidence, now).pending.length ? <Clock3 aria-hidden="true" size={17} /> : roadCondition(road.id, realRoadEvidence, now).latestReviewed?.reviewState === 'Cleared' ? <CircleCheck aria-hidden="true" size={17} /> : <CircleHelp aria-hidden="true" size={17} />}
                    <span>{roadLabel(road)}<small>{road.id} · {roadCondition(road.id, realRoadEvidence, now).kind === 'confirmed_blockage' ? 'Responder-confirmed blockage' : roadCondition(road.id, realRoadEvidence, now).pending.length ? 'Unknown · Pending Review' : roadCondition(road.id, realRoadEvidence, now).latestReviewed?.reviewState === 'Cleared' ? 'Unknown · responder-cleared report' : 'Unknown'}</small></span>
                  </button>
                </li>
              ))}
            </ul>
            {matches.length === 0 && <p className="detail">No road in this limited extract matches that search. This does not mean the road is assessed or clear.</p>}
            <section className="real-preview__detail" aria-label="Selected road">
              <h2>{selectedRoad ? roadLabel(selectedRoad) : 'Select a mapped road'}</h2>
              {selectedRoad ? (
                <>
                  <RoadStatus road={selectedRoad} evidence={realRoadEvidence} now={now} />
                  <p className="detail">Map geometry: <a href={`https://www.openstreetmap.org/way/${selectedRoad.id.split('/')[1]}`} target="_blank" rel="noopener noreferrer">{selectedRoad.id} on OpenStreetMap</a> ({selectedRoad.properties.highway}).</p>
                  <p className="detail">OSM way last edited {formatTime(selectedRoad.properties.osmEditedAt)}; extract retrieved {formatTime(roadSnapshot.metadata.retrievedAt)}. These are map-data times, not flood observation times.</p>
                </>
              ) : <p className="detail">All roads are Unknown until a current observation is reviewed. Satellite imagery cannot confirm a blockage.</p>}
            </section>
            <RealRoadReporting available={apiReady} roadId={selectedRoadId} point={selectedPoint} roads={roadSnapshot} view={view} onChanged={refreshEvidence} onSessionChange={setSignedInUser} />
            <RoadAlerts user={signedInUser} view={view} selectedRoadId={selectedRoadId} selectedPoint={selectedPoint} geometryVersion={roadSnapshot.metadata.geometryVersion} onSelectCandidate={(id) => { setSelectedRoadId(id); setSelectedPoint(null); }} />
            <details className="real-preview__sources">
              <summary>Source, licence and coverage</summary>
              <p>{roadSnapshot.metadata.coverageNote}</p>
              <p><a href={roadSnapshot.metadata.licenceUrl} target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors (ODbL 1.0)</a>. Static extract retrieved {formatTime(roadSnapshot.metadata.retrievedAt)}. Roads are not automatically refreshed.</p>
              {roadSnapshot.metadata.geometryVersion && <p>Road geometry version: {roadSnapshot.metadata.geometryVersion}.</p>}
              <p>Amazon Location supplies the Standard and Hybrid basemaps. Imagery and mapped streets are geographic context, not current flood evidence.</p>
            </details>
          </aside>
          <div className="real-preview__map-column">
            <RealRoadMap style={style} urls={styleUrls} selectedRoadId={selectedRoadId} evidence={realRoadEvidence} roads={roadSnapshot} now={now} onSelect={(id, location) => { setSelectedRoadId(id); setSelectedPoint(location); }} onCameraChange={setCamera} />
            <p className="real-preview__camera">{camera ? `Map center ${camera.latitude.toFixed(4)}°N, ${camera.longitude.toFixed(4)}°E · zoom ${camera.zoom.toFixed(1)}` : 'Map camera unavailable until the basemap loads.'} Style changes keep the same camera, road selection and real-road markers.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
