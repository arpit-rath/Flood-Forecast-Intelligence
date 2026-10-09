import { useEffect, useRef, useState, type CSSProperties } from 'react';

/*
 * Decorative rain for the landing hero. Each layer is a tile of hairlines
 * used as a CSS mask over a token colour, so no colour is hard-coded here.
 * Layers fall one tile height per cycle at different speeds (seamless loop,
 * transform-only animation). It carries no data and does not depict current
 * weather; the hero states the data mode next to it. Reduced motion shows the
 * same strokes standing still (see landing.css).
 */

interface LayerSpec {
  seed: number;
  width: number;
  height: number;
  count: number;
  length: [number, number];
  alpha: [number, number];
  strokeWidth: number;
  duration: number;
  opacity: number;
}

const LAYERS: LayerSpec[] = [
  // far: short, faint, slow
  { seed: 11, width: 170, height: 260, count: 8, length: [16, 40], alpha: [0.35, 0.7], strokeWidth: 1, duration: 3.4, opacity: 0.16 },
  // middle
  { seed: 23, width: 250, height: 360, count: 7, length: [30, 76], alpha: [0.45, 0.85], strokeWidth: 1, duration: 2.2, opacity: 0.22 },
  // near: long, brighter, fast
  { seed: 37, width: 380, height: 520, count: 5, length: [70, 140], alpha: [0.5, 1], strokeWidth: 1.25, duration: 1.5, opacity: 0.26 },
];

function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** SVG tile of vertical strokes; strokes crossing the bottom edge wrap to the top so the tile repeats cleanly. */
function tileMask({ seed, width, height, count, length, alpha, strokeWidth }: LayerSpec): string {
  const rand = random(seed);
  const strokes: string[] = [];
  for (let i = 0; i < count; i++) {
    // Spread strokes across columns, jittered, so the tile has no clumps.
    const x = ((i + 0.15 + rand() * 0.7) / count) * width;
    const y = rand() * height;
    const len = length[0] + rand() * (length[1] - length[0]);
    const a = (alpha[0] + rand() * (alpha[1] - alpha[0])).toFixed(2);
    for (const offset of y + len > height ? [0, -height] : [0]) {
      strokes.push(
        `<line x1='${x.toFixed(1)}' y1='${(y + offset).toFixed(1)}' x2='${x.toFixed(1)}' y2='${(y + offset + len).toFixed(1)}' stroke='black' stroke-opacity='${a}' stroke-width='${strokeWidth}' stroke-linecap='round'/>`,
      );
    }
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'>${strokes.join('')}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const LAYER_STYLES: CSSProperties[] = LAYERS.map((layer, i) => {
  const mask = tileMask(layer);
  return {
    WebkitMaskImage: mask,
    maskImage: mask,
    '--tile-w': `${layer.width}px`,
    '--tile-h': `${layer.height}px`,
    '--rain-duration': `${layer.duration}s`,
    // Negative delays start each layer mid-cycle so they never align.
    '--rain-delay': `${(-layer.duration * (0.2 + i * 0.27)).toFixed(2)}s`,
    '--rain-opacity': String(layer.opacity),
  } as CSSProperties;
});

export function RainField() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  // Pause while the hero is scrolled out of view.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="hero__rain" aria-hidden="true" data-paused={visible ? undefined : 'true'}>
      <div className="hero__rain-tilt">
        {LAYER_STYLES.map((style, i) => (
          <span key={i} className="rain-layer" style={style} />
        ))}
      </div>
    </div>
  );
}
