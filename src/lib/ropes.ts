export const ROPE = {
  segments: 16,
  gravity: 0.55,
  damping: 0.978,
  iterations: 5,
  slack: 1.12,
};

export type RopePt = { x: number; y: number; px: number; py: number };
export type Rope = { pts: RopePt[]; rest: number };

export function ropePathFromPts(pts: RopePt[]): string {
  if (!pts.length) return "";
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
  }
  return d;
}

export function ensureRope(
  ropes: Map<string, Rope>,
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rebuild = false
): Rope {
  const n = ROPE.segments;
  const dist = Math.hypot(x2 - x1, y2 - y1) || 1;
  let rope = ropes.get(id);
  if (rebuild || !rope || rope.pts.length !== n + 1) {
    const pts: RopePt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x1 + (x2 - x1) * t;
      const y =
        y1 + (y2 - y1) * t + Math.sin(Math.PI * t) * Math.min(48, dist * 0.18);
      pts.push({ x, y, px: x, py: y });
    }
    rope = { pts, rest: (dist * ROPE.slack) / n };
    ropes.set(id, rope);
  }
  return rope;
}

export function stepRope(
  rope: Rope,
  x1: number,
  y1: number,
  x2: number,
  y2: number
) {
  const pts = rope.pts;
  const last = pts.length - 1;
  const dist = Math.hypot(x2 - x1, y2 - y1) || 1;
  rope.rest = (dist * ROPE.slack) / last;

  for (let i = 1; i < last; i++) {
    const p = pts[i];
    const vx = (p.x - p.px) * ROPE.damping;
    const vy = (p.y - p.py) * ROPE.damping;
    p.px = p.x;
    p.py = p.y;
    p.x += vx;
    p.y += vy + ROPE.gravity;
  }

  for (let it = 0; it < ROPE.iterations; it++) {
    pts[0].x = x1;
    pts[0].y = y1;
    pts[last].x = x2;
    pts[last].y = y2;

    for (let i = 0; i < last; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const diff = ((d - rope.rest) / d) * 0.5;
      const ox = dx * diff;
      const oy = dy * diff;
      if (i === 0) {
        b.x -= ox * 2;
        b.y -= oy * 2;
      } else if (i === last - 1) {
        a.x += ox * 2;
        a.y += oy * 2;
      } else {
        a.x += ox;
        a.y += oy;
        b.x -= ox;
        b.y -= oy;
      }
    }

    pts[0].x = x1;
    pts[0].y = y1;
    pts[0].px = x1;
    pts[0].py = y1;
    pts[last].x = x2;
    pts[last].y = y2;
    pts[last].px = x2;
    pts[last].py = y2;
  }
}
