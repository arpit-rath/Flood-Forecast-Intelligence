export type MapScope = 'pilot' | 'delhi';

export const PILOT_SCOPE_LABEL = 'Synthetic DTU-area scenario · illustrative geometry · not live';
export const DELHI_SCOPE_LABEL = 'Delhi basemap · flood risk not assessed outside the pilot';

export function MapScopeSwitch({ scope, onChange }: { scope: MapScope; onChange: (scope: MapScope) => void }) {
  return (
    <section className="map-scope" aria-label="Map coverage">
      <div className="map-scope__switch" role="group" aria-label="Map view">
        <button type="button" aria-pressed={scope === 'pilot'} onClick={() => onChange('pilot')}>
          Pilot scenario
        </button>
        <button type="button" aria-pressed={scope === 'delhi'} onClick={() => onChange('delhi')}>
          Delhi satellite overview
        </button>
      </div>
      <p className="map-scope__label" role="status">
        {scope === 'pilot' ? PILOT_SCOPE_LABEL : DELHI_SCOPE_LABEL}
      </p>
    </section>
  );
}
