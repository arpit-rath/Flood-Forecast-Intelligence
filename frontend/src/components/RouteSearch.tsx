import { Car, Footprints } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { TravelMode } from '../api/types';
import { TRAVEL_MODE_LABEL } from '../lib/copy';
import { useAppState } from '../state/AppState';

export function RouteSearch() {
  const { pilot, routeQuery, compareRoutes, routes, snapshot } = useAppState();
  const places = pilot.status === 'ready' ? pilot.data.places : [];
  const modes = pilot.status === 'ready' ? pilot.data.travelModes : (['pedestrian'] as TravelMode[]);
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [travelMode, setTravelMode] = useState<TravelMode>('pedestrian');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!routeQuery) return;
    setOrigin(routeQuery.originPlaceId);
    setDestination(routeQuery.destinationPlaceId);
    setTravelMode(routeQuery.travelMode);
  }, [routeQuery]);

  const noSnapshot = snapshot.status !== 'ready';
  const loading = routes.status === 'loading';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!origin || !destination) return setError('Choose a start and a destination.');
    if (origin === destination) return setError('Start and destination must be different places.');
    setError(null);
    compareRoutes({ originPlaceId: origin, destinationPlaceId: destination, travelMode });
  };

  return (
    <form className="route-search" onSubmit={submit} aria-labelledby="route-search-title" noValidate>
      <h2 id="route-search-title" className="panel-heading">
        Compare routes
      </h2>
      <div className="field-row">
        <div className="field">
          <label htmlFor="route-origin">From</label>
          <select id="route-origin" value={origin} onChange={(e) => setOrigin(e.target.value)}>
            <option value="">Choose start</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="route-destination">To</label>
          <select id="route-destination" value={destination} onChange={(e) => setDestination(e.target.value)}>
            <option value="">Choose destination</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset className="segmented">
        <legend>Travel mode</legend>
        {modes.map((m) => (
          <label key={m} className="segmented__option">
            <input type="radio" name="travel-mode" value={m} checked={travelMode === m} onChange={() => setTravelMode(m)} />
            <span>
              {m === 'pedestrian' ? <Footprints aria-hidden="true" size={18} /> : <Car aria-hidden="true" size={18} />}
              {TRAVEL_MODE_LABEL[m]}
            </span>
          </label>
        ))}
      </fieldset>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="btn btn--primary btn--block"
        aria-disabled={noSnapshot || loading}
        aria-describedby={noSnapshot ? 'route-search-disabled' : undefined}
        onClick={(e) => {
          if (noSnapshot || loading) e.preventDefault();
        }}
      >
        {loading ? 'Comparing routes…' : 'Compare routes'}
      </button>
      {noSnapshot && (
        <p id="route-search-disabled" className="detail">
          Route comparison needs a current risk estimate. Switch to Scenario or retry live weather.
        </p>
      )}
    </form>
  );
}
