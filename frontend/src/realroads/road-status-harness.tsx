// Browser-only fixture. Vite's production entry remains index.html.
import { createRoot } from 'react-dom/client';
import type { RealRoadEvidence } from '../../../contracts/types';
import { roads } from './model';
import { RoadStatus } from './RoadStatus';
import '../styles/tokens.css';
import '../styles/base.css';
import './realroads.css';

const now = new Date('2026-10-11T12:00:00Z');
const road = roads.features[0];
const makeEvidence = (reviewState: RealRoadEvidence['reviewState'], source: RealRoadEvidence['source'] = 'resident_photo'): RealRoadEvidence => ({
  id: `fixture-${reviewState}`,
  roadId: road.id,
  point: road.geometry.coordinates[0],
  reviewState,
  observedAt: '2026-10-11T11:00:00Z',
  reviewedAt: reviewState === 'Pending Review' ? null : '2026-10-11T11:15:00Z',
  expiresAt: '2026-10-12T11:00:00Z',
  source,
});

const examples: Array<[string, RealRoadEvidence[]]> = [
  ['pending', [makeEvidence('Pending Review')]],
  ['confirmed', [makeEvidence('Confirmed Blockage', 'responder_field_check')]],
  ['cleared', [makeEvidence('Cleared', 'responder_field_check')]],
  ['rejected', [makeEvidence('Rejected')]],
  ['expired', [{ ...makeEvidence('Confirmed Blockage'), expiresAt: '2026-10-11T11:30:00Z' }]],
];

createRoot(document.getElementById('root')!).render(
  <div style={{ maxWidth: 400, padding: 16 }}>
    <h1>Road status fixtures</h1>
    {examples.map(([name, evidence]) => (
      <section key={name} aria-label={`${name} evidence`} style={{ border: '1px solid #aaa', marginBottom: 12, padding: 12 }}>
        <h2>{name}</h2><RoadStatus road={road} evidence={evidence} now={now} />
      </section>
    ))}
  </div>,
);
