import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useRef, useState } from 'react';
import { MapView } from '../components/MapView';
import { ReportForm } from '../components/ReportForm';
import { RouteComparisonPanel } from '../components/RouteComparison';
import { RouteSearch } from '../components/RouteSearch';
import { SegmentCard } from '../components/SegmentCard';
import { DESKTOP_QUERY, TABLET_QUERY, useMediaQuery } from '../lib/hooks';
import { useAppState } from '../state/AppState';

/**
 * Resident view (Design-System.md §5). Panel order: route search →
 * recommended comparison → segment detail → report action. Mode and data
 * time sit in the app header above. Everything is usable without the map.
 */
export function ResidentView() {
  const { selectedSegmentId, selectSegment, pilot } = useAppState();
  const tablet = useMediaQuery(TABLET_QUERY);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [panelOpen, setPanelOpen] = useState(true);
  const reportHeading = useRef<HTMLHeadingElement>(null);
  const collapsible = tablet && !desktop;
  const showPanel = !collapsible || panelOpen;

  const goToReport = () => {
    reportHeading.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    reportHeading.current?.focus({ preventScroll: true });
  };

  return (
    <div className={`resident-layout${showPanel ? '' : ' resident-layout--collapsed'}`}>
      {showPanel && (
        <aside className="resident-panel" aria-label="Routes and reports">
          <RouteSearch />
          <RouteComparisonPanel />
          {selectedSegmentId && (
            <SegmentCard segmentId={selectedSegmentId} onReport={goToReport} onClose={() => selectSegment(null)} />
          )}
          {!selectedSegmentId && (
            <p className="detail panel-hint">Select a road on the map or in a route's flagged segments to see its evidence.</p>
          )}
          <ReportForm headingRef={reportHeading} />
          {pilot.status === 'ready' && (
            <details className="sources">
              <summary>Data sources and limits</summary>
              {pilot.data.geometryNote && <p className="detail">{pilot.data.geometryNote}</p>}
              <ul>
                {pilot.data.sources.map((s) => (
                  <li key={s.id} className="detail">
                    <strong>{s.name}</strong> ({s.licence}){s.note ? `: ${s.note}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </aside>
      )}
      <div className="resident-map">
        {collapsible && (
          <button
            type="button"
            className="btn btn--secondary btn--sm panel-toggle"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((v) => !v)}
          >
            {panelOpen ? <PanelLeftClose aria-hidden="true" size={18} /> : <PanelLeftOpen aria-hidden="true" size={18} />}
            {panelOpen ? 'Hide panel' : 'Show panel'}
          </button>
        )}
        <MapView />
      </div>
    </div>
  );
}
