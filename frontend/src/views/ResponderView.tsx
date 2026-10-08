import { useEffect, useRef, useState } from 'react';
import { InterventionPanel } from '../components/InterventionPanel';
import { MapView } from '../components/MapView';
import { ReportQueue, ReportReviewCard } from '../components/ReportReview';
import { SegmentCard } from '../components/SegmentCard';
import { SegmentQueue } from '../components/SegmentQueue';
import { TabPanel, Tabs } from '../components/Tabs';
import { DESKTOP_QUERY, useMediaQuery } from '../lib/hooks';
import { useAppState } from '../state/AppState';

type Detail = { kind: 'segment'; id: string } | { kind: 'report'; id: string } | null;

/**
 * Responder console (Design-System.md §5). Desktop: ranked queue (300 px),
 * map, detail/simulation drawer. Below 1024 px: Queue, Map and Action tabs.
 */
export function ResponderView() {
  const { selectedSegmentId, selectSegment, reports, refreshReports } = useAppState();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [mobileTab, setMobileTab] = useState('queue');
  const [queueTab, setQueueTab] = useState('reports');
  const [drawerTab, setDrawerTab] = useState('detail');
  const [detail, setDetail] = useState<Detail>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Map selection opens the segment in the drawer.
  useEffect(() => {
    if (selectedSegmentId) setDetail((d) => (d?.kind === 'segment' && d.id === selectedSegmentId ? d : { kind: 'segment', id: selectedSegmentId }));
  }, [selectedSegmentId]);

  // Keep analysis states fresh while anything is still being analysed.
  const analysing = 'data' in reports && reports.data?.some((r) => r.reviewStatus === 'analysis_pending');
  useEffect(() => {
    if (!analysing) return;
    const timer = window.setInterval(() => void refreshReports(), 2000);
    return () => window.clearInterval(timer);
  }, [analysing, refreshReports]);

  const focusDrawer = () => {
    window.setTimeout(() => {
      const heading = drawerRef.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden]) h2');
      if (!heading) return;
      heading.setAttribute('tabindex', '-1');
      heading.focus();
    }, 0);
  };

  const openSegment = (id: string) => {
    selectSegment(id);
    setDetail({ kind: 'segment', id });
    setDrawerTab('detail');
    if (!desktop) setMobileTab('action');
    focusDrawer();
  };

  const openReport = (id: string) => {
    setDetail({ kind: 'report', id });
    setDrawerTab('detail');
    if (!desktop) setMobileTab('action');
    focusDrawer();
  };

  const awaiting =
    'data' in reports && reports.data
      ? reports.data.filter((r) => ['pending_review', 'needs_manual_review', 'analysis_pending'].includes(r.reviewStatus)).length
      : 0;

  const queue = (
    <div className="responder-queue">
      <Tabs
        idPrefix="queue"
        label="Queue"
        tabs={[
          { id: 'reports', label: `Reports (${awaiting})` },
          { id: 'segments', label: 'Segments' },
        ]}
        active={queueTab}
        onChange={setQueueTab}
      />
      <TabPanel idPrefix="queue" id="reports" active={queueTab === 'reports'}>
        <ReportQueue onOpen={openReport} activeId={detail?.kind === 'report' ? detail.id : null} />
      </TabPanel>
      <TabPanel idPrefix="queue" id="segments" active={queueTab === 'segments'}>
        <SegmentQueue onOpen={openSegment} />
      </TabPanel>
    </div>
  );

  const drawer = (
    <div className="responder-drawer" ref={drawerRef}>
      <Tabs
        idPrefix="drawer"
        label="Details and action"
        tabs={[
          { id: 'detail', label: 'Selected' },
          { id: 'simulate', label: 'Drain action' },
        ]}
        active={drawerTab}
        onChange={setDrawerTab}
      />
      <TabPanel idPrefix="drawer" id="detail" active={drawerTab === 'detail'}>
        {detail?.kind === 'segment' && (
          <SegmentCard
            segmentId={detail.id}
            onClose={() => {
              setDetail(null);
              selectSegment(null);
            }}
          />
        )}
        {detail?.kind === 'report' && <ReportReviewCard reportId={detail.id} onClose={() => setDetail(null)} />}
        {!detail && <p className="detail panel-hint">Select a report or road segment from the queue or the map.</p>}
      </TabPanel>
      <TabPanel idPrefix="drawer" id="simulate" active={drawerTab === 'simulate'}>
        <InterventionPanel />
      </TabPanel>
    </div>
  );

  if (desktop) {
    return (
      <div className="responder-layout">
        <aside className="responder-col responder-col--queue" aria-label="Queue">
          {queue}
        </aside>
        <div className="responder-col responder-col--map">
          <MapView legendOpen={false} />
        </div>
        <aside className="responder-col responder-col--drawer" aria-label="Details and action">
          {drawer}
        </aside>
      </div>
    );
  }

  return (
    <div className="responder-mobile">
      <Tabs
        idPrefix="responder"
        label="Responder sections"
        className="tabs--primary"
        tabs={[
          { id: 'queue', label: 'Queue' },
          { id: 'map', label: 'Map' },
          { id: 'action', label: 'Action' },
        ]}
        active={mobileTab}
        onChange={setMobileTab}
      />
      <TabPanel idPrefix="responder" id="queue" active={mobileTab === 'queue'} className="responder-mobile__panel">
        {queue}
      </TabPanel>
      <TabPanel idPrefix="responder" id="map" active={mobileTab === 'map'} className="responder-mobile__panel responder-mobile__panel--map">
        <MapView legendOpen={false} />
      </TabPanel>
      <TabPanel idPrefix="responder" id="action" active={mobileTab === 'action'} className="responder-mobile__panel">
        {drawer}
      </TabPanel>
    </div>
  );
}
