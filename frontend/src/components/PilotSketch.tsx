import { useId, useMemo } from 'react';
import type { LngLat, PilotResponse, RiskClass } from '../api/types';
import { fitProjection } from '../lib/geo';
import { terrainContours } from '../lib/terrain';

export interface SketchRoute {
  id: string;
  coordinates: LngLat[];
  role: 'selected' | 'alternate' | 'blocked';
}

export interface SketchMarker {
  id: string;
  point: LngLat;
  label: string;
}

interface PilotSketchProps {
  pilot: PilotResponse;
  /** Risk class per segment. Omit for a neutral, monochrome network. */
  classes?: Map<string, RiskClass>;
  closed?: Set<string>;
  routes?: SketchRoute[];
  /** When non-empty, other roads recede so these read first. */
  focusSegments?: Set<string>;
  focusDrains?: Set<string>;
  reportPoints?: LngLat[];
  endpoints?: SketchMarker[];
  showDrains?: boolean;
  tone?: 'light' | 'dark';
  width?: number;
  height?: number;
  padding?: number;
  title: string;
  hoveredSegment?: string | null;
  onHoverSegment?: (id: string | null) => void;
  className?: string;
}

/**
 * Static SVG drawing of the pilot network. Used for the landing preview and
 * as the fallback when the interactive map cannot start. Every colour comes
 * from tokens; unknown roads are dashed and closures hatched, so colour is
 * never the only signal.
 */
export function PilotSketch({
  pilot,
  classes,
  closed,
  routes = [],
  focusSegments,
  focusDrains,
  reportPoints = [],
  endpoints = [],
  showDrains = true,
  tone = 'light',
  width = 640,
  height = 440,
  padding = 36,
  title,
  hoveredSegment,
  onHoverSegment,
  className = '',
}: PilotSketchProps) {
  const uid = useId().replace(/:/g, '');
  const projection = useMemo(() => fitProjection(pilot.bounds, width, height, padding), [pilot, width, height, padding]);
  const contours = useMemo(() => terrainContours(pilot), [pilot]);

  const path = (coords: LngLat[]) =>
    coords
      .map((c, i) => {
        const [x, y] = projection.project(c);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join('');

  const focusing = Boolean(focusSegments && focusSegments.size > 0);
  const [fx0, fy0] = projection.project([pilot.bounds[0], pilot.bounds[3]]);
  const [fx1, fy1] = projection.project([pilot.bounds[2], pilot.bounds[1]]);

  return (
    <svg
      className={`sketch sketch--${tone} ${className}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-labelledby={`${uid}-title`}
      preserveAspectRatio="xMidYMid meet"
    >
      <title id={`${uid}-title`}>{title}</title>
      <defs>
        <pattern id={`${uid}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" className="sketch__hatch-bg" />
          <rect width="2.5" height="6" className="sketch__hatch-line" />
        </pattern>
        <clipPath id={`${uid}-clip`}>
          <rect width={width} height={height} />
        </clipPath>
      </defs>

      <g clipPath={`url(#${uid}-clip)`}>
        <g className="sketch__contours" aria-hidden="true">
          {contours.map((c, i) =>
            c.lines.map((line, j) => (
              <path
                key={`${c.level}-${j}`}
                d={path(line)}
                className={`sketch__contour${i === contours.length - 1 ? ' sketch__contour--inner' : ''}`}
              />
            )),
          )}
        </g>

        <rect
          className="sketch__frame"
          x={fx0 - 14}
          y={fy0 - 14}
          width={fx1 - fx0 + 28}
          height={fy1 - fy0 + 28}
          rx="6"
          aria-hidden="true"
        />

        <g className="sketch__routes" aria-hidden="true">
          {routes
            .filter((r) => r.role !== 'blocked')
            .sort((a, b) => Number(a.role === 'selected') - Number(b.role === 'selected'))
            .map((r) => (
              <path key={r.id} d={path(r.coordinates)} className={`sketch__route sketch__route--${r.role}`} />
            ))}
        </g>

        <g className="sketch__roads">
          {pilot.segments.features.map((f) => {
            const cls = classes?.get(f.id);
            const isClosed = closed?.has(f.id);
            const focused = focusing && focusSegments!.has(f.id);
            const muted = focusing && !focused;
            const d = path(f.geometry.coordinates);
            return (
              <g
                key={f.id}
                className={`sketch__road${cls ? ` sketch__road--${cls}` : ''}${isClosed ? ' sketch__road--closed' : ''}${muted ? ' is-muted' : ''}${focused ? ' is-focus' : ''}${hoveredSegment === f.id ? ' is-hovered' : ''}`}
              >
                <path d={d} className="sketch__road-halo" />
                <path d={d} className="sketch__road-line" style={isClosed ? { stroke: `url(#${uid}-hatch)` } : undefined} />
                {onHoverSegment && (
                  <path
                    d={d}
                    className="sketch__road-hit"
                    onPointerEnter={() => onHoverSegment(f.id)}
                    onPointerLeave={() => onHoverSegment(null)}
                  />
                )}
              </g>
            );
          })}
        </g>

        {reportPoints.map((p, i) => {
          const [x, y] = projection.project(p);
          return <circle key={i} cx={x} cy={y} r="5.5" className="sketch__report" aria-hidden="true" />;
        })}

        {showDrains &&
          pilot.drains.features.map((d) => {
            const [x, y] = projection.project(d.geometry.coordinates);
            const muted = focusDrains && focusDrains.size > 0 && !focusDrains.has(d.id);
            return (
              <g key={d.id} className={`sketch__drain${muted ? ' is-muted' : ''}`} transform={`translate(${x} ${y})`} aria-hidden="true">
                <rect x="-19" y="-10" width="38" height="20" rx="4" />
                <text y="4" textAnchor="middle">
                  {d.id}
                </text>
              </g>
            );
          })}

        {endpoints.map((m) => {
          const [x, y] = projection.project(m.point);
          return (
            <g key={m.id} className="sketch__endpoint" transform={`translate(${x} ${y})`} aria-hidden="true">
              <circle r="11" />
              <text y="4" textAnchor="middle">
                {m.label}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
