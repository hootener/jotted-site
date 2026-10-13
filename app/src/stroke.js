// Pure stroke geometry: input smoothing and outline generation.
// Points are [x, y, pressure] in world units.

export const PEN_SIZES = { small: 2.5, medium: 4, large: 6.5, highlight: 18 };
export const HIGHLIGHT_ALPHA = 0.45;

/** Outline options for a stroke: highlighters are uniform width with no taper. */
export function outlineOptions(stroke) {
  return stroke.kind === 'highlight' ? { size: stroke.size, thinning: 0, taper: false } : { size: stroke.size };
}

/**
 * Streamline smoother. Each incoming raw point is pulled part of the way
 * toward the previous smoothed point, which removes stylus jitter while
 * keeping the pen responsive. Points closer than `minDist` are dropped.
 */
export function createSmoother({ streamline = 0.45, minDist = 0.25 } = {}) {
  let prev = null;
  return {
    /** Feed a raw point; returns the smoothed point to append, or null. */
    push([x, y, p]) {
      if (!prev) {
        prev = [x, y, p];
        return prev.slice();
      }
      const k = 1 - streamline;
      const nx = prev[0] + (x - prev[0]) * k;
      const ny = prev[1] + (y - prev[1]) * k;
      const np = prev[2] + (p - prev[2]) * k;
      if (Math.hypot(nx - prev[0], ny - prev[1]) < minDist) {
        prev[2] = np;
        return null;
      }
      prev = [nx, ny, np];
      return prev.slice();
    },
    /** Pen lifted: converge on the final raw point so the stroke isn't cut short. */
    finish([x, y, p]) {
      if (!prev) return [[x, y, p]];
      const out = [];
      for (let i = 0; i < 4; i++) {
        const pt = this.push([x, y, p]);
        if (pt) out.push(pt);
      }
      if (Math.hypot(x - prev[0], y - prev[1]) > minDist) {
        prev = [x, y, prev[2]];
        out.push(prev.slice());
      }
      return out;
    },
  };
}

/**
 * Pressure for devices that don't report it (mouse, finger). Faster motion
 * gives a thinner line, like a real pen. `speed` is screen px per ms.
 */
export function simulatePressure(prevP, speed) {
  const target = 0.3 + 0.5 * (1 - Math.min(1, speed / 1.5));
  return prevP + (target - prevP) * 0.25;
}

function radiusFor(p, size, thinning) {
  const r = (size / 2) * (1 + thinning * (2 * p - 1));
  return Math.max(0.2, r);
}

function arcPoints(cx, cy, r, from, to, steps = 8) {
  const pts = [];
  for (let i = 1; i < steps; i++) {
    const a = from + ((to - from) * i) / steps;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

function circle(cx, cy, r) {
  return arcPoints(cx, cy, r, 0, Math.PI * 2, 24);
}

/**
 * Build a closed outline polygon for a stroke. Returns an array of [x, y].
 * The outline follows the left edge forward, rounds the end cap, follows
 * the right edge back, and rounds the start cap.
 */
export function strokeOutline(points, { size = 4, thinning = 0.6, taper = true } = {}) {
  const pts = dedupe(points);
  if (pts.length === 0) return [];
  if (pts.length === 1) {
    const [x, y, p] = pts[0];
    return circle(x, y, radiusFor(p ?? 0.5, size, thinning));
  }

  const n = pts.length;
  // Cumulative length, used for end taper.
  const dist = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    dist[i] = dist[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  const total = dist[n - 1];
  const taperLen = taper && total > size * 4 ? size * 1.5 : 0;

  const left = [];
  const right = [];
  const tangents = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    tangents.push([tx, ty]);

    let r = radiusFor(pts[i][2] ?? 0.5, size, thinning);
    if (taperLen > 0) {
      const fromEnd = total - dist[i];
      if (fromEnd < taperLen) r *= 0.15 + 0.85 * smoothstep(fromEnd / taperLen);
    }
    const nx = -ty;
    const ny = tx;
    left.push([pts[i][0] + nx * r, pts[i][1] + ny * r, r]);
    right.push([pts[i][0] - nx * r, pts[i][1] - ny * r, r]);
  }

  const out = [];
  for (const l of left) out.push([l[0], l[1]]);

  // End cap: from left edge, through the forward tangent, to the right edge.
  {
    const [tx, ty] = tangents[n - 1];
    const normalAngle = Math.atan2(tx, -ty); // angle of (-ty, tx)
    const r = left[n - 1][2];
    out.push(...arcPoints(pts[n - 1][0], pts[n - 1][1], r, normalAngle, normalAngle - Math.PI));
  }

  for (let i = n - 1; i >= 0; i--) out.push([right[i][0], right[i][1]]);

  // Start cap: from right edge, through the backward tangent, to the left edge.
  {
    const [tx, ty] = tangents[0];
    const normalAngle = Math.atan2(tx, -ty);
    const r = left[0][2];
    out.push(...arcPoints(pts[0][0], pts[0][1], r, normalAngle + Math.PI, normalAngle));
  }

  return out;
}

export function strokeBounds(stroke) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of stroke.points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const pad = stroke.size;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function dedupe(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) continue;
    out.push(p);
  }
  return out;
}

function smoothstep(t) {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}

/** True if (x, y) lies within `tolerance` of the stroke's inked path. */
export function hitTestStroke(stroke, x, y, tolerance = 0) {
  const pts = stroke.points;
  const reach = stroke.size / 2 + tolerance;
  if (pts.length === 0) return false;
  if (pts.length === 1) return Math.hypot(pts[0][0] - x, pts[0][1] - y) <= reach;
  for (let i = 1; i < pts.length; i++) {
    if (distToSegment(x, y, pts[i - 1], pts[i]) <= reach) return true;
  }
  return false;
}

function distToSegment(px, py, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - a[0]) * dx + (py - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t));
}

/** SVG path data for an outline polygon, smoothed with midpoint quadratics. */
export function outlineToPathData(outline, digits = 2) {
  const n = outline.length;
  if (n < 3) return '';
  const f = (v) => Number(v.toFixed(digits));
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let m = mid(outline[0], outline[1]);
  let d = `M${f(m[0])} ${f(m[1])}`;
  for (let i = 1; i <= n; i++) {
    const a = outline[i % n];
    const b = outline[(i + 1) % n];
    m = mid(a, b);
    d += `Q${f(a[0])} ${f(a[1])} ${f(m[0])} ${f(m[1])}`;
  }
  return d + 'Z';
}
