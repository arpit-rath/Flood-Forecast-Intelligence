import { ChevronDown } from 'lucide-react';

interface Item {
  key: string;
  label: string;
  detail: string;
}

const RISK: Item[] = [
  { key: 'low', label: 'Low', detail: 'solid green' },
  { key: 'watch', label: 'Watch', detail: 'solid amber' },
  { key: 'high', label: 'High', detail: 'thicker solid red' },
  { key: 'unknown', label: 'Unknown', detail: 'dashed grey, missing data' },
  { key: 'closed', label: 'Closed', detail: 'crosshatch, operator-confirmed' },
];

const ROUTES: Item[] = [
  { key: 'route-selected', label: 'Selected route', detail: 'solid teal' },
  { key: 'route-alternate', label: 'Other route', detail: 'dashed blue' },
];

const MARKERS: Item[] = [
  { key: 'drain', label: 'Modelled drain', detail: 'D-01, D-02 labels' },
  { key: 'report', label: 'Photo report', detail: 'ringed dot' },
];

function Group({ title, items }: { title: string; items: Item[] }) {
  return (
    <div className="map-legend__group">
      <p className="map-legend__group-title">{title}</p>
      <ul>
        {items.map((item) => (
          <li key={item.key}>
            <span className={`legend-swatch legend-swatch--${item.key}`} aria-hidden="true" />
            <span>
              <strong>{item.label}</strong> <span className="legend-detail">{item.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Compact, expandable map key. Collapsed it still previews the five road states. */
export function MapLegend({ defaultOpen = false, hasTerrain = true }: { defaultOpen?: boolean; hasTerrain?: boolean }) {
  return (
    <details className="map-legend" open={defaultOpen}>
      <summary>
        Legend
        <span className="map-legend__mini" aria-hidden="true">
          {RISK.map((item) => (
            <span key={item.key} className={`legend-swatch legend-swatch--${item.key}`} />
          ))}
        </span>
        <ChevronDown className="map-legend__chevron" aria-hidden="true" size={16} />
      </summary>
      <div className="map-legend__body">
        <Group title="Road risk estimate" items={RISK} />
        <Group title="Routes" items={ROUTES} />
        <Group title="Markers" items={MARKERS} />
        {hasTerrain && (
          <Group
            title="Context"
            items={[{ key: 'contour', label: 'Terrain prior contours', detail: 'smoothed fixture values, not surveyed elevation' }]}
          />
        )}
      </div>
    </details>
  );
}
