import { ArrowRight, Camera, CircleHelp, ExternalLink, Map, ShieldCheck, TrafficCone } from 'lucide-react';

/** Public entry point for the limited real-road preview. No Scenario data is mounted here. */
export function RealRoadLanding() {
  return (
    <div className="road-landing">
      <section className="road-landing__hero" aria-labelledby="road-landing-title">
        <div className="road-landing__hero-inner">
          <div className="road-landing__hero-copy">
            <p className="eyebrow eyebrow--inverse">Varuna · Delhi road intelligence</p>
            <h1 id="road-landing-title">Know what is reported. <em>Know what is not yet known.</em></h1>
            <p className="road-landing__lede">Explore a Delhi street map and a limited, attributed road extract near DTU. When reporting is available, share a private road photo anonymously; a responder must review evidence before any public road condition changes.</p>
            <a className="btn btn--inverse btn--lg road-landing__cta" href="#/resident">Open Delhi road map <ArrowRight aria-hidden="true" size={20} /></a>
            <p className="road-landing__hero-note"><CircleHelp aria-hidden="true" size={18} /> Unknown does not mean Low or Clear. This is not Delhi-wide live flood monitoring.</p>
          </div>
          <aside className="road-landing__coverage-card" aria-label="Coverage at a glance">
            <div className="road-landing__coverage-top"><Map aria-hidden="true" size={22} /><span>Coverage at a glance</span></div>
            <p className="road-landing__coverage-number">84 <span>OSM ways</span></p>
            <p>Fixed road extract near Delhi Technological University. Streets elsewhere on the basemap are unassessed.</p>
            <div className="road-landing__coverage-status"><CircleHelp aria-hidden="true" size={20} /><span><strong>Unknown by default</strong><small>No road is treated as clear or blocked without current, reviewed evidence.</small></span></div>
          </aside>
        </div>
      </section>

      <section className="landing-section road-landing__workflow" aria-labelledby="road-workflow-title">
        <div className="landing-section__inner">
          <p className="eyebrow">How it works</p>
          <h2 id="road-workflow-title" className="section-title">From a street view to reviewed evidence.</h2>
          <ol className="road-landing__steps">
            <li><span className="road-landing__step-number">01</span><Map aria-hidden="true" size={24} /><h3>Explore the map</h3><p>Switch between Amazon Location Standard streets and Hybrid satellite views. Only the overlaid DTU-area roads are in this extract.</p></li>
            <li><span className="road-landing__step-number">02</span><Camera aria-hidden="true" size={24} /><h3>Report privately</h3><p>When intake is enabled, select a covered road and location, then anonymously submit a private photo. Your submission begins as Pending Review.</p></li>
            <li><span className="road-landing__step-number">03</span><ShieldCheck aria-hidden="true" size={24} /><h3>Wait for verification</h3><p>A responder reviews the evidence before any public road condition changes. An unreviewed report cannot establish a blockage.</p></li>
            <li><span className="road-landing__step-number">04</span><TrafficCone aria-hidden="true" size={24} /><h3>Read source context</h3><p>Official Delhi Traffic Police alerts retain their source and publication details. Imported alerts remain Reported / Unverified until reviewed.</p></li>
          </ol>
        </div>
      </section>

      <section className="landing-section road-landing__limits" aria-labelledby="road-limits-title">
        <div className="landing-section__inner road-landing__limits-grid">
          <div><p className="eyebrow">Coverage and caution</p><h2 id="road-limits-title" className="section-title">A map is context, not a safety verdict.</h2></div>
          <div className="road-landing__limits-copy">
            <p>Only 84 OpenStreetMap ways near DTU are covered. Other Delhi roads are unassessed. Unknown is not Low or Clear, and satellite imagery alone cannot prove flooding or a blockage.</p>
            <p>Varuna does not provide Delhi-wide live flood monitoring or guaranteed route advice. Follow police directions, barricades, emergency services and conditions on the ground.</p>
            <p className="road-landing__sources">Road geometry: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors (ODbL 1.0) <ExternalLink aria-hidden="true" size={15} /></a>. Basemaps: Amazon Location Service. Traffic alerts: <a href="https://traffic.delhipolice.gov.in/en/news-alertadvisory/alerts" target="_blank" rel="noopener noreferrer">Delhi Traffic Police <ExternalLink aria-hidden="true" size={15} /></a>. Source links and dates appear with available alerts.</p>
          </div>
        </div>
      </section>
      <footer className="road-landing__footer"><div className="landing-section__inner">Varuna · Road conditions change. Follow on-ground traffic instructions.</div></footer>
    </div>
  );
}
