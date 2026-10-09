import { ListOrdered, Map as MapIcon, ShieldAlert, UserCheck, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ConsoleBrief } from '../components/ConsoleBrief';
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
 * Responder console (Design-System.md §5). Desktop: ranked queue, map,
 * detail/simulation drawer. Below 1024 px: Queue, Map and Action tabs docked
 * at the bottom of the screen, within thumb reach.
 */
export function ResponderView() {
  const { selectedSegmentId, selectSegment, reports, refreshReports, api } = useAppState();
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

  const openSimulation = () => {
    setDrawerTab('simulate');
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
        className="tabs--underline"
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
        className="tabs--underline"
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
        {!detail && <ConsoleBrief onOpenReport={openReport} onOpenSegment={openSegment} onOpenSimulation={openSimulation} />}
      </TabPanel>
      <TabPanel idPrefix="drawer" id="simulate" active={drawerTab === 'simulate'}>
        <InterventionPanel />
      </TabPanel>
    </div>
  );

  const consoleBar = (
    <div className="console-bar">
      <p className="console-bar__title">Responder console</p>
      <span className="operator-chip">
        <UserCheck aria-hidden="true" size={16} />
        {api.kind === 'mock' ? 'Demo operator (mock session)' : 'Responder view (read-only reports)'}
      </span>
      <p className="console-bar__note">
        <ShieldAlert aria-hidden="true" size={16} /> Advisory only: nothing is closed, sent or dispatched.
      </p>
    </div>
  );

  if (desktop) {
    return (
      <div className="responder">
        {consoleBar}
        <div className="responder-layout">
          <aside className="responder-col responder-col--queue" aria-label="Queue">
            {queue}
          </aside>
          <div className="responder-col responder-col--map">
            <MapView legendOpen={false} showSimulation />
          </div>
          <aside className="responder-col responder-col--drawer" aria-label="Details and action">
            {drawer}
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="responder">
      {consoleBar}
      <div className="responder-mobile">
        <Tabs
          idPrefix="responder"
          label="Responder sections"
          className="tabs--dock"
          tabs={[
            { id: 'queue', label: <DockLabel icon={<ListOrdered aria-hidden="true" size={20} />} text="Queue" /> },
            { id: 'map', label: <DockLabel icon={<MapIcon aria-hidden="true" size={20} />} text="Map" /> },
            { id: 'action', label: <DockLabel icon={<Wrench aria-hidden="true" size={20} />} text="Action" /> },
          ]}
          active={mobileTab}
          onChange={setMobileTab}
        />
        <TabPanel idPrefix="responder" id="queue" active={mobileTab === 'queue'} className="responder-mobile__panel">
          {queue}
        </TabPanel>
        <TabPanel idPrefix="responder" id="map" active={mobileTab === 'map'} className="responder-mobile__panel responder-mobile__panel--map">
          <MapView legendOpen={false} showSimulation />
        </TabPanel>
        <TabPanel idPrefix="responder" id="action" active={mobileTab === 'action'} className="responder-mobile__panel">
          {drawer}
        </TabPanel>
      </div>
    </div>
  );
}

function DockLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <>
      {icon}
      <span>{text}</span>
    </>
  );
}
