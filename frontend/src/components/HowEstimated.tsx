import { Info, X } from 'lucide-react';
import { useRef } from 'react';
import { useAppState } from '../state/AppState';

/** Accessible "How this is estimated" explanation (Design-System.md §7). */
export function HowEstimatedButton({ topic = 'risk' }: { topic?: 'risk' | 'routes' | 'simulation' }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { snapshot } = useAppState();
  const thresholds = snapshot.status === 'ready' ? snapshot.data.thresholds : { watch: 0.35, high: 0.6, lowConfidenceCoverage: 0.8 };
  const modelVersion = snapshot.status === 'ready' ? snapshot.data.modelVersion : 'pilot heuristic';

  const open = () => {
    const dialog = ref.current;
    if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
    else dialog?.setAttribute('open', '');
  };
  const close = () => {
    const dialog = ref.current;
    if (dialog && typeof dialog.close === 'function') dialog.close();
    else dialog?.removeAttribute('open');
  };

  return (
    <>
      <button type="button" className="link-button" onClick={open}>
        <Info aria-hidden="true" size={16} /> How this is estimated
      </button>
      <dialog ref={ref} className="dialog" aria-labelledby={`how-${topic}-title`}>
        <div className="dialog__header">
          <h2 id={`how-${topic}-title`}>How this is estimated</h2>
          <button type="button" className="icon-button" onClick={close} aria-label="Close">
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        <div className="dialog__body">
          <h3>Road risk</h3>
          <p>
            Each road segment gets an ordinal risk indicator from rainfall, a terrain low-point prior, curated drainage
            vulnerability, and accepted photo reports. It is not a water depth or a flood probability. Missing inputs are
            left out rather than counted as zero, and the share of inputs present is shown as coverage.
          </p>
          <p>
            Classes use pilot settings ({modelVersion}): Low below {thresholds.watch.toFixed(2)}, Watch from{' '}
            {thresholds.watch.toFixed(2)}, High from {thresholds.high.toFixed(2)}. Unknown means there is not enough data;
            it is not the same as Low. Coverage below {Math.round(thresholds.lowConfidenceCoverage * 100)}% is marked low
            confidence.
          </p>
          <h3>Routes</h3>
          <p>
            Exposure is the length-weighted average risk along the assessed part of a route. A lower-exposure route is
            recommended only when it clearly improves on the fastest one. Roads with a confirmed closure are excluded. A
            lower estimated exposure is not a safety guarantee; unobserved roads may still be impassable.
          </p>
          <h3>Drain clearance simulation</h3>
          <p>
            Clearing a modelled drain lowers the drainage input on its listed segments only. Rainfall, terrain and
            observations stay at baseline, and the baseline is never overwritten. The two actions are ranked by the
            reduction in exposure on the selected route, then by segments leaving High. This is a comparative what-if
            estimate, not a physical flood simulation or a time to recovery.
          </p>
          <h3>Limits</h3>
          <p>
            Terrain comes from a 30 m surface model that cannot see kerbs, drains or underpasses. Rain forecasts are coarse
            and may miss a local cloudburst. Photo reports can be stale or mislocated, so a responder reviews them before
            they affect route advice. Varuna does not close roads, send alerts or dispatch teams.
          </p>
        </div>
      </dialog>
    </>
  );
}
