// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Hakoniwa
// Adapted from Efude efude-stroke/src/builder.rs, ca3e3a414d603663723bed8c6ef8db6f89deab1f.
// Time sanitisation and weighted stabilisation only; see THIRD_PARTY_NOTICES.txt.
import type { PaintPoint } from '../types.ts';

/** A bounded, time-based window; zero leaves the artist's irregular line intact. */
export class PaintSmoother {
  private samples: PaintPoint[] = [];
  private lastTime?: number;
  private clock = 0;
  private level: number;
  constructor(level: number) { this.level=level; }
  push(point: PaintPoint): PaintPoint {
    const gap = this.lastTime === undefined ? 0 : point.time - this.lastTime;
    this.clock += this.lastTime === undefined ? 0 : gap > 0 && gap <= 250 ? gap : gap > 250 && gap < 10000 ? 250 : 4;
    this.lastTime = point.time;
    const latest = { ...point, time: this.clock };
    this.samples.push(latest);
    if (this.samples.length > 96) this.samples.shift();
    const window = Math.max(0, Math.min(15, this.level)) * 8;
    if (!window) return latest;
    let x = 0, y = 0, pressure = 0, weight = 0;
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const sample = this.samples[i], age = latest.time - sample.time;
      if (age > window) break;
      const w = 1 - age / (window + 1);
      x += sample.x * w; y += sample.y * w; pressure += sample.pressure * w; weight += w;
    }
    return { x: x / weight, y: y / weight, pressure: pressure / weight, time: latest.time };
  }
}

export function pressureRadius(size: number, pressure: number): number {
  return size * (0.15 + 0.85 * Math.max(0, Math.min(1, pressure))) / 2;
}
