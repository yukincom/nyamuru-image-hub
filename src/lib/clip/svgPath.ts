import type { ClipExportLine } from './layerData.ts';

export interface SvgPointTransform {
  (x: number, y: number): [number, number];
}

export interface SvgPolyline {
  points: Array<[number, number, number]>;
  closed: boolean;
}

const KAPPA = 0.5522847498307936;

function distToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function appendCubic(
  points: Array<[number, number, number]>,
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
  tolerance = 10.0,
  depth = 0,
): void {
  if (points.length >= 65535) return;
  if (depth >= 2 || Math.max(distToSegment(b, a, d), distToSegment(c, a, d)) <= tolerance) {
    points.push([d[0], d[1], 1]);
    return;
  }
  const mid = (p: [number, number], q: [number, number]): [number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const ab = mid(a, b), bc = mid(b, c), cd = mid(c, d), abc = mid(ab, bc), bcd = mid(bc, cd), m = mid(abc, bcd);
  appendCubic(points, a, ab, abc, m, tolerance, depth + 1);
  appendCubic(points, m, bcd, cd, d, tolerance, depth + 1);
}

function appendQuadratic(
  points: Array<[number, number, number]>,
  a: [number, number],
  q: [number, number],
  d: [number, number],
): void {
  const c1: [number, number] = [a[0] + (2 / 3) * (q[0] - a[0]), a[1] + (2 / 3) * (q[1] - a[1])];
  const c2: [number, number] = [d[0] + (2 / 3) * (q[0] - d[0]), d[1] + (2 / 3) * (q[1] - d[1])];
  appendCubic(points, a, c1, c2, d);
}

function arcToCubics(
  x1: number, y1: number,
  rxIn: number, ryIn: number,
  angleDeg: number,
  largeArc: boolean, sweep: boolean,
  x2: number, y2: number,
): Array<[number, number, number, number, number, number]> {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn), ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
  const phi = (angleDeg * Math.PI) / 180, cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
  const dx2 = (x1 - x2) / 2, dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2, y1p = -sinPhi * dx2 + cosPhi * dy2;
  const rx2 = rx * rx, ry2 = ry * ry, x1p2 = x1p * x1p, y1p2 = y1p * y1p;
  const lambda = x1p2 / rx2 + y1p2 / ry2;
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s; ry *= s;
  }
  const rxSq = rx * rx, rySq = ry * ry;
  const num = Math.max(0, rxSq * rySq - rxSq * y1p2 - rySq * x1p2);
  const den = rxSq * y1p2 + rySq * x1p2;
  const factor = den === 0 ? 0 : Math.sqrt(num / den) * (largeArc === sweep ? -1 : 1);
  const cxp = factor * (rx * y1p / ry), cyp = factor * (-ry * x1p / rx);
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
  const vecAngle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy, len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const ratio = len ? Math.max(-1, Math.min(1, dot / len)) : 1;
    return (ux * vy - uy * vx < 0 ? -1 : 1) * Math.acos(ratio);
  };
  const theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = vecAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  const segments = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / segments, t = (4 / 3) * Math.tan(delta / 4);
  const out: Array<[number, number, number, number, number, number]> = [];
  for (let i = 0; i < segments; i++) {
    const a1 = theta1 + i * delta, a2 = a1 + delta;
    const cos1 = Math.cos(a1), sin1 = Math.sin(a1), cos2 = Math.cos(a2), sin2 = Math.sin(a2);
    const p1x = cos1 - t * sin1, p1y = sin1 + t * cos1;
    const p2x = cos2 + t * sin2, p2y = sin2 - t * cos2;
    const mapPt = (px: number, py: number): [number, number] => [
      cx + cosPhi * rx * px - sinPhi * ry * py,
      cy + sinPhi * rx * px + cosPhi * ry * py,
    ];
    const [c1x, c1y] = mapPt(p1x, p1y);
    const [c2x, c2y] = mapPt(p2x, p2y);
    const [ex, ey] = mapPt(cos2, sin2);
    out.push([c1x, c1y, c2x, c2y, ex, ey]);
  }
  return out;
}

const TOKEN_RE = /([a-zA-Z])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;

/** Parse an SVG path `d` string into subdivided polylines in output pixel coordinates. */
export function svgPathToPolylines(d: string, transform: SvgPointTransform): SvgPolyline[] {
  const tokens: Array<string | number> = [];
  for (const match of d.matchAll(TOKEN_RE)) {
    tokens.push(match[1] ? match[1] : Number(match[2]));
  }
  const result: SvgPolyline[] = [];
  let index = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0, lastCp: [number, number] | null = null, lastCmd = '';
  let current: Array<[number, number, number]> = [];
  const nextNum = (): number => (typeof tokens[index] === 'number' ? tokens[index++] as number : 0);
  const nextFlag = (): boolean => nextNum() !== 0;
  const finish = (closed: boolean) => {
    if (current.length >= 2) result.push({ points: current, closed });
    current = [];
  };
  const startAt = (x: number, y: number) => {
    finish(false);
    cx = x; cy = y; sx = x; sy = y;
    const [px, py] = transform(cx, cy);
    current = [[px, py, 1]];
  };
  const lineTo = (x: number, y: number) => {
    cx = x; cy = y;
    const [px, py] = transform(cx, cy);
    current.push([px, py, 1]);
  };

  while (index < tokens.length) {
    if (typeof tokens[index] === 'string') cmd = tokens[index++] as string;
    else if (!cmd) { index++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const op = cmd.toUpperCase();
    if (op === 'Z') {
      cx = sx; cy = sy;
      finish(true);
      lastCp = null; lastCmd = op; cmd = '';
      continue;
    }
    if (op === 'M') {
      const nx = nextNum() + (rel ? cx : 0), ny = nextNum() + (rel ? cy : 0);
      startAt(nx, ny);
      lastCp = null; lastCmd = op;
      cmd = rel ? 'l' : 'L';
      continue;
    }
    if (op === 'L') {
      lineTo(nextNum() + (rel ? cx : 0), nextNum() + (rel ? cy : 0));
      lastCp = null; lastCmd = op;
    } else if (op === 'H') {
      lineTo(nextNum() + (rel ? cx : 0), cy);
      lastCp = null; lastCmd = op;
    } else if (op === 'V') {
      lineTo(cx, nextNum() + (rel ? cy : 0));
      lastCp = null; lastCmd = op;
    } else if (op === 'C') {
      const x1 = nextNum() + (rel ? cx : 0), y1 = nextNum() + (rel ? cy : 0);
      const x2 = nextNum() + (rel ? cx : 0), y2 = nextNum() + (rel ? cy : 0);
      const x = nextNum() + (rel ? cx : 0), y = nextNum() + (rel ? cy : 0);
      appendCubic(current, transform(cx, cy), transform(x1, y1), transform(x2, y2), transform(x, y));
      cx = x; cy = y; lastCp = [x2, y2]; lastCmd = op;
    } else if (op === 'S') {
      const x1 = (lastCmd === 'C' || lastCmd === 'S') && lastCp ? 2 * cx - lastCp[0] : cx;
      const y1 = (lastCmd === 'C' || lastCmd === 'S') && lastCp ? 2 * cy - lastCp[1] : cy;
      const x2 = nextNum() + (rel ? cx : 0), y2 = nextNum() + (rel ? cy : 0);
      const x = nextNum() + (rel ? cx : 0), y = nextNum() + (rel ? cy : 0);
      appendCubic(current, transform(cx, cy), transform(x1, y1), transform(x2, y2), transform(x, y));
      cx = x; cy = y; lastCp = [x2, y2]; lastCmd = op;
    } else if (op === 'Q') {
      const qx = nextNum() + (rel ? cx : 0), qy = nextNum() + (rel ? cy : 0);
      const x = nextNum() + (rel ? cx : 0), y = nextNum() + (rel ? cy : 0);
      appendQuadratic(current, transform(cx, cy), transform(qx, qy), transform(x, y));
      cx = x; cy = y; lastCp = [qx, qy]; lastCmd = op;
    } else if (op === 'T') {
      const qx: number = (lastCmd === 'Q' || lastCmd === 'T') && lastCp ? 2 * cx - lastCp[0] : cx;
      const qy: number = (lastCmd === 'Q' || lastCmd === 'T') && lastCp ? 2 * cy - lastCp[1] : cy;
      const x = nextNum() + (rel ? cx : 0), y = nextNum() + (rel ? cy : 0);
      appendQuadratic(current, transform(cx, cy), transform(qx, qy), transform(x, y));
      cx = x; cy = y; lastCp = [qx, qy]; lastCmd = op;
    } else if (op === 'A') {
      const rx = nextNum(), ry = nextNum(), rot = nextNum();
      const large = nextFlag(), sweep = nextFlag();
      const x = nextNum() + (rel ? cx : 0), y = nextNum() + (rel ? cy : 0);
      for (const [c1x, c1y, c2x, c2y, ex, ey] of arcToCubics(cx, cy, rx, ry, rot, large, sweep, x, y)) {
        appendCubic(current, transform(cx, cy), transform(c1x, c1y), transform(c2x, c2y), transform(ex, ey));
        cx = ex; cy = ey;
      }
      cx = x; cy = y; lastCp = null; lastCmd = op;
    } else {
      index++;
    }
  }
  finish(false);
  return result;
}

/** Convert an ellipse in source coordinates into a closed subdivided polyline. */
export function svgEllipseToPolyline(
  cx: number, cy: number, rx: number, ry: number,
  transform: SvgPointTransform,
): SvgPolyline {
  const ox = rx * KAPPA, oy = ry * KAPPA;
  const p0 = transform(cx, cy - ry);
  const points: Array<[number, number, number]> = [[p0[0], p0[1], 1]];
  appendCubic(points, p0, transform(cx + ox, cy - ry), transform(cx + rx, cy - oy), transform(cx + rx, cy));
  appendCubic(points, transform(cx + rx, cy), transform(cx + rx, cy + oy), transform(cx + ox, cy + ry), transform(cx, cy + ry));
  appendCubic(points, transform(cx, cy + ry), transform(cx - ox, cy + ry), transform(cx - rx, cy + oy), transform(cx - rx, cy));
  appendCubic(points, transform(cx - rx, cy), transform(cx - rx, cy - oy), transform(cx - ox, cy - ry), p0);
  points.pop();
  return { points, closed: true };
}

/** Convert a rectangle (optionally rounded) into a closed polyline. */
export function svgRectToPolyline(
  x: number, y: number, w: number, h: number, rx: number,
  transform: SvgPointTransform,
): SvgPolyline {
  const r = Math.max(0, Math.min(rx, w / 2, h / 2));
  if (r <= 0.01) {
    const corners: Array<[number, number]> = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    return { points: corners.map(([px, py]) => [...transform(px, py), 1]), closed: true };
  }
  const d = [
    `M ${x + r} ${y}`,
    `L ${x + w - r} ${y}`,
    `A ${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `L ${x + w} ${y + h - r}`,
    `A ${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `L ${x + r} ${y + h}`,
    `A ${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `L ${x} ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join(' ');
  return svgPathToPolylines(d, transform)[0];
}

function pointInPolygon(x: number, y: number, poly: ReadonlyArray<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/** Remove segments whose midpoint falls inside any seam mask polygon (joined bubbles). */
export function clipPolylinesByMasks(
  polylines: readonly SvgPolyline[],
  masks: ReadonlyArray<ReadonlyArray<[number, number]>>,
): SvgPolyline[] {
  if (!masks.length) return [...polylines];
  const out: SvgPolyline[] = [];
  for (const poly of polylines) {
    const n = poly.points.length;
    if (n < 2) continue;
    const edgeCount = poly.closed ? n : n - 1;
    let run: Array<[number, number, number]> = [];
    let allKept = true;
    for (let i = 0; i < edgeCount; i++) {
      const a = poly.points[i], b = poly.points[(i + 1) % n];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const hidden = masks.some(mask => pointInPolygon(mx, my, mask));
      if (hidden) {
        allKept = false;
        if (run.length >= 2) out.push({ points: run, closed: false });
        run = [];
      } else {
        if (!run.length) run.push(a);
        run.push(b);
      }
    }
    if (allKept && poly.closed) out.push(poly);
    else if (run.length >= 2) out.push({ points: run, closed: false });
  }
  return out;
}

export function polylinesToClipLines(
  polylines: readonly SvgPolyline[],
  widthPx: number,
  color: [number, number, number] = [17, 17, 17],
): ClipExportLine[] {
  return polylines
    .filter(poly => poly.points.length >= 2)
    .map(poly => ({ points: poly.points, closed: poly.closed, widthPx, color }));
}
