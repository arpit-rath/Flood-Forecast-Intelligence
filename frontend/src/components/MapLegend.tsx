import { TABLET_QUERY, useMediaQuery } from '../lib/hooks';

const ITEMS: { key: string; label: string; detail: string }[] = [
  { key: 'low', label: 'Low', detail: 'solid green' },
  { key: 'watch', label: 'Watch', detail: 'solid amber' },
  { key: 'high', label: 'High', detail: 'thicker solid red' },
  { key: 'unknown', label: 'Unknown', detail: 'dashed grey, missing data' },
  { key: 'closed', label: 'Closed', detail: 'crosshatch, operator-confirmed' },
  { key: 'route-selected', label: 'Selected route', detail: 'solid teal' },
  { key: 'route-alternate', label: 'Other route', detail: 'dashed blue' },
  { key: 'drain', label: 'Modelled drain', detail: 'D-01, D-02 labels' },
  { key: 'report', label: 'Photo report', detail: 'ringed dot' },
];

export function MapLegend({ defaultOpen }: { defaultOpen?: boolean }) {
  const wide = useMediaQuery(TABLET_QUERY);
  return (
    <details className="map-legend" open={defaultOpen ?? wide}>
      <summary>Legend</summary>
      <ul>
        {ITEMS.map((item) => (
          <li key={item.key}>
            <span className={`legend-swatch legend-swatch--${item.key}`} aria-hidden="true" />
            <span>
              <strong>{item.label}</strong> <span className="legend-detail">{item.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
