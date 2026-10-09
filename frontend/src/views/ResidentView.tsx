import { Camera, MousePointerClick, PanelLeftClose, PanelLeftOpen, Route as RouteIcon, TextSearch } from 'lucide-react';
import { useRef, useState } from 'react';
import { MapView } from '../components/MapView';
import { ReportForm } from '../components/ReportForm';
import { RouteComparisonPanel } from '../components/RouteComparison';
import { RouteSearch } from '../components/RouteSearch';
import { SegmentCard } from '../components/SegmentCard';
import { DESKTOP_QUERY, TABLET_QUERY, useMediaQuery, usePrefersReducedMotion } from '../lib/hooks';
import { useAppState } from '../state/AppState';

/**
 * Resident view (Design-System.md §5). Panel order: route search →
 * recommended comparison → segment detail → report action. Mode and data
 * time sit in the status strip above. Everything is usable without the map.
 */
export function ResidentView() {
  const { selectedSegmentId, selectSegment, pilot } = useAppState();
  const tablet = useMediaQuery(TABLET_QUERY);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const reducedMotion = usePrefersReducedMotion();
  const [panelOpen, setPanelOpen] = useState(true);
  const routesRef = useRef<HTMLElement>(null);
  const roadRef = useRef<HTMLElement>(null);
  const reportHeading = useRef<HTMLHeadingElement>(null);
  const collapsible = tablet && !desktop;
  const showPanel = !collapsible || panelOpen;

  const jumpTo = (target: HTMLElement | null) => {
    if (!target) return;
    target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    const heading = target.matches('h2') ? target : target.querySelector<HTMLElement>('h2');
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  };

  return (
    <div className={`resident-layout${showPanel ? '' : ' resident-layout--collapsed'}`}>
      {showPanel && (
        <aside className="resident-panel" aria-label="Routes and reports">
          {!tablet && (
            <nav className="sheet-nav" aria-label="Panel sections">
              <button type="button" onClick={() => jumpTo(routesRef.current)}>
                <RouteIcon aria-hidden="true" size={16} /> Routes
              </button>
              <button type="button" onClick={() => jumpTo(roadRef.current)}>
                <TextSearch aria-hidden="true" size={16} /> Road
              </button>
              <button type="button" onClick={() => jumpTo(reportHeading.current)}>
                <Camera aria-hidden="true" size={16} /> Report
              </button>
            </nav>
          )}
          <section className="panel-block" ref={routesRef} aria-label="Route search and comparison">
            <RouteSearch />
            <RouteComparisonPanel />
          </section>
          <section className="panel-block" ref={roadRef} aria-label="Road detail">
            {selectedSegmentId ? (
              <SegmentCard segmentId={selectedSegmentId} onReport={() => jumpTo(reportHeading.current)} onClose={() => selectSegment(null)} />
            ) : (
              <>
                <h2 className="visually-hidden">Road detail</h2>
                <p className="panel-hint">
                  <MousePointerClick aria-hidden="true" size={18} />
                  <span>Select a road on the map, or open a route's flagged segments, to see the evidence behind its estimate.</span>
                </p>
              </>
            )}
          </section>
          <section className="panel-block">
            <ReportForm headingRef={reportHeading} />
          </section>
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
        <MapView onOpenSelection={tablet ? undefined : () => jumpTo(roadRef.current)} />
      </div>
    </div>
  );
}
