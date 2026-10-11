import { CircleHelp, MapPin } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { RealRoadEvidence, RealRoadId } from '../../../contracts/types';
import { BrandMark } from '../components/AppHeader';
import { delhiStyleUrls } from '../lib/delhiStyle';
import { roadLabel, roads } from './model';
import { RealRoadMap, type CameraPosition, type StreetStyle } from './RealRoadMap';
import { RoadStatus } from './RoadStatus';
import './realroads.css';

const styleUrls = delhiStyleUrls(import.meta.env.VITE_DELHI_STANDARD_STYLE_URL, import.meta.env.VITE_DELHI_HYBRID_STYLE_URL);
// No real-road report endpoint exists yet. Never import /v1 pilot reports here.
const realRoadEvidence: RealRoadEvidence[] = [];

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

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => { window.removeEventListener('hashchange', onHash); window.clearInterval(timer); };
  }, []);
  useEffect(() => { document.title = `Delhi roads · Varuna ${view}`; }, [view]);

  const selectedRoad = roads.features.find((road) => road.id === selectedRoadId) ?? null;
  const matches = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return roads.features.filter((road) => !query || roadLabel(road).toLocaleLowerCase().includes(query));
  }, [search]);

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
          <span>Delhi street map · OSM road overlay limited to a DTU-area extract ({roads.features.length} ways). Roads elsewhere are unassessed; no Delhi-wide flood risk is available.</span>
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
            <p className="real-preview__summary"><CircleHelp aria-hidden="true" size={18} /> {roads.features.length} mapped ways · all Unknown without current reviewed evidence</p>
            <label className="real-preview__search" htmlFor="road-search">Find a mapped road
              <input id="road-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or OSM way ID" />
            </label>
            <p className="detail">{matches.length} of {roads.features.length} mapped ways shown. Select a road from this list or the map.</p>
            <ul className="real-preview__road-list" aria-label="Mapped roads">
              {matches.map((road) => (
                <li key={road.id}>
                  <button type="button" aria-pressed={selectedRoadId === road.id} onClick={() => setSelectedRoadId(road.id)}>
                    <CircleHelp aria-hidden="true" size={17} />
                    <span>{roadLabel(road)}<small>{road.id} · Unknown</small></span>
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
                  <p className="detail">OSM way last edited {formatTime(selectedRoad.properties.osmEditedAt)}; extract retrieved {formatTime(roads.metadata.retrievedAt)}. These are map-data times, not flood observation times.</p>
                </>
              ) : <p className="detail">All roads are Unknown until a current observation is reviewed. Satellite imagery cannot confirm a blockage.</p>}
              <button type="button" className="btn btn--secondary" disabled aria-describedby="real-report-reason">Submit a real-road photo (unavailable)</button>
              <p id="real-report-reason" className="detail">Real-road reporting is paused until server-side matching to a versioned OSM way is ready. Pilot Scenario photos cannot be attached to these streets.</p>
            </section>
            {view === 'responder' && (
              <section className="real-preview__review" aria-label="Real-road review">
                <h2>Real-road review unavailable</h2>
                <p>No real-road report or responder review endpoint is deployed. The existing private pilot queue remains protected in the legacy Scenario API and is never overlaid here.</p>
              </section>
            )}
            <details className="real-preview__sources">
              <summary>Source, licence and coverage</summary>
              <p>{roads.metadata.coverageNote}</p>
              <p><a href={roads.metadata.licenceUrl} target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors (ODbL 1.0)</a>. Static extract retrieved {formatTime(roads.metadata.retrievedAt)}. Roads are not automatically refreshed.</p>
              <p>Amazon Location supplies the Standard and Hybrid basemaps. Imagery and mapped streets are geographic context, not current flood evidence.</p>
            </details>
          </aside>
          <div className="real-preview__map-column">
            <RealRoadMap style={style} urls={styleUrls} selectedRoadId={selectedRoadId} evidence={realRoadEvidence} now={now} onSelect={setSelectedRoadId} onCameraChange={setCamera} />
            <p className="real-preview__camera">{camera ? `Map center ${camera.latitude.toFixed(4)}°N, ${camera.longitude.toFixed(4)}°E · zoom ${camera.zoom.toFixed(1)}` : 'Map camera unavailable until the basemap loads.'} Style changes keep the same camera, road selection and real-road markers.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
