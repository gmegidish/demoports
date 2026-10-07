// The graphics unit, first half (segment 186a:0000-1d02): trig tables, pixels, lines, rectangles,
// palette effects. Notes: docs/disassembly/L1_gfx_a.md.
import { f32, int16, roundHalfEven, PAGE_SIZE } from './machine.js';

const TRIG_MIN_DEGREES = -360;
const TRIG_MAX_DEGREES = 720;

/** 186a:0078: float32 sin/cos for -360..720 degrees, int16 round(x*128) for 0..720. */
function buildTrigTables() {
  const count = TRIG_MAX_DEGREES - TRIG_MIN_DEGREES + 1;
  const sinF = new Float32Array(count);
  const cosF = new Float32Array(count);
  for (let i = TRIG_MIN_DEGREES; i <= TRIG_MAX_DEGREES; i++) {
    const a = (i * Math.PI) / 180;
    sinF[i - TRIG_MIN_DEGREES] = Math.sin(a);
    cosF[i - TRIG_MIN_DEGREES] = Math.cos(a);
  }
  const sinI = new Int16Array(TRIG_MAX_DEGREES + 1);
  const cosI = new Int16Array(TRIG_MAX_DEGREES + 1);
  for (let i = 0; i <= TRIG_MAX_DEGREES; i++) {
    sinI[i] = roundHalfEven(Math.sin((i * Math.PI) / 180) * 128);
    cosI[i] = roundHalfEven(Math.cos((i * Math.PI) / 180) * 128);
  }
  return { sinF, cosF, sinI, cosI };
}

const TRIG = buildTrigTables();

/** DS:8578 + 2*i */
export function sinTableInt(degrees) {
  return TRIG.sinI[degrees];
}

/** DS:8b1a + 2*i */
export function cosTableInt(degrees) {
  return TRIG.cosI[degrees];
}

function rowOffset(m, y) {
  return Math.imul(y, m.width);
}

/** 186a:1634, clipped; the 16-bit offset wraps. */
export function putPixel(m, x, y, color) {
  const c = m.clip;
  if (x < c.left || x > c.right || y < c.top || y > c.bottom) {
    return;
  }
  m.active[(x + rowOffset(m, y)) & 0xffff] = color;
}

/** 186a:166c, not clipped. */
export function getPixel(m, x, y) {
  return m.active[(rowOffset(m, y) + x) & 0xffff];
}

/** 186a:033d: clip a horizontal run, returns [x, len] or null. */
export function clipRun(m, x, len) {
  const c = m.clip;
  let visible = true;
  if (x < c.left) {
    if (x + len < c.left) {
      visible = false;
    }
    len -= c.left - x;
    x = c.left;
  }
  if (x > c.right) {
    visible = false;
  } else if (x + len > c.right) {
    len = c.right - x + 1;
  }
  return visible ? [x, len] : null;
}

/** 186a:1689, the default span: solid colour, uses the row table. */
export function solidSpan(m, y, x, len, color) {
  const c = m.clip;
  if (y < c.top || y > c.bottom) {
    return;
  }
  const run = clipRun(m, x, len);
  if (!run || run[1] < 1) {
    return;
  }
  const base = rowOffset(m, y) + run[0];
  for (let i = 0; i < run[1]; i++) {
    m.active[(base + i) & 0xffff] = color;
  }
}

/** 186a:1732, with the quirk that the bottom clip row is never reached by a line crossing it. */
function vlineClipped(m, x, y, len, color) {
  const c = m.clip;
  if (x < c.left || x > c.right) {
    return;
  }
  if (y < c.top) {
    if (y + len <= c.top) {
      return;
    }
    len = y + len - c.top;
    y = c.top;
  }
  if (y > c.bottom) {
    return;
  }
  if (y + len > c.bottom) {
    len = c.bottom - y;
  }
  let p = rowOffset(m, y) + x;
  for (let i = 0; i < len; i++) {
    m.active[p & 0xffff] = color;
    p += m.width;
  }
}

/** 186a:176d */
function lineNoClip(m, x1, y1, x2, y2, color) {
  const h = Math.abs(y1 - y2) + 1;
  const w = Math.abs(x1 - x2) + 1;
  if (h === 1) {
    solidSpan(m, y1, x1, w, color);
    return;
  }
  if (w === 1) {
    vlineClipped(m, x1, Math.min(y1, y2), h, color);
    return;
  }
  const start = rowOffset(m, y1) + x1;
  if (w > h) {
    const frac = Math.trunc(((y2 - y1 + 1) * 65536) / w) & 0xffff;
    const dx = x1 < x2 ? 1 : -1;
    let p = start;
    let acc = 0;
    for (let k = 0; k < w; k++) {
      m.active[p & 0xffff] = color;
      p += dx;
      acc += frac;
      if (acc > 0xffff) {
        acc &= 0xffff;
        p += m.width;
      }
    }
  } else {
    const step = Math.trunc(((x2 - x1 + 1) * 65536) / h);
    let pos = 0;
    for (let k = 0; k < h; k++) {
      m.active[(start + k * m.width + (pos >> 16)) & 0xffff] = color;
      pos = (pos + step) | 0;
    }
  }
}

// ---- x87 extended precision (64-bit mantissa, round to nearest even), for the clip of 185f ----

const MANTISSA_BITS = 64n;

function bitLength(v) {
  return v === 0n ? 0n : BigInt(v.toString(2).length);
}

/** num/den * 2^exp rounded to a 64-bit mantissa: { m, e } with value m * 2^e. den > 0. */
function extended(num, den, exp) {
  if (num === 0n) {
    return { m: 0n, e: 0n };
  }
  const sign = num < 0n ? -1n : 1n;
  const a = num < 0n ? -num : num;
  let shift = MANTISSA_BITS - (bitLength(a) - bitLength(den));
  let n = shift >= 0n ? a << shift : a;
  let d = shift >= 0n ? den : den << -shift;
  if (n / d >= 1n << MANTISSA_BITS) {
    shift -= 1n;
    d <<= 1n;
  }
  if (n / d < 1n << (MANTISSA_BITS - 1n)) {
    shift += 1n;
    n <<= 1n;
  }
  let q = n / d;
  const twiceRemainder = (n - q * d) * 2n;
  if (twiceRemainder > d || (twiceRemainder === d && (q & 1n) === 1n)) {
    q += 1n;
  }
  if (q === 1n << MANTISSA_BITS) {
    q >>= 1n;
    shift -= 1n;
  }
  return { m: sign * q, e: exp - shift };
}

/** fistp: an extended value rounded to an integer, ties to even. */
function fistp({ m, e }) {
  if (e >= 0n) {
    return Number(m << e);
  }
  const d = 1n << -e;
  const a = m < 0n ? -m : m;
  let q = a / d;
  const twiceRemainder = (a - q * d) * 2n;
  if (twiceRemainder > d || (twiceRemainder === d && (q & 1n) === 1n)) {
    q += 1n;
  }
  return Number(m < 0n ? -q : q);
}

function extendedRatio(num, den) {
  return den < 0 ? extended(BigInt(-num), BigInt(-den), 0n) : extended(BigInt(num), BigInt(den), 0n);
}

/** fild k; fmul slope; fistp */
function timesSlope(k, slope) {
  return fistp(extended(BigInt(k) * slope.m, 1n, slope.e));
}

/** fild k; fdiv slope; fistp */
function overSlope(k, slope) {
  const den = slope.m < 0n ? -slope.m : slope.m;
  return fistp(extended(BigInt(slope.m < 0n ? -k : k), den, -slope.e));
}

/** 186a:185f, clipped against the clip rectangle with the FPU (extended precision, round to nearest even). */
export function line(m, x1, y1, x2, y2, color) {
  const c = m.clip;
  if (x1 !== x2) {
    if (x1 > x2) {
      [x1, y1, x2, y2] = [x2, y2, x1, y1];
    }
    if (y2 - y1 !== 0) {
      const slope = extendedRatio(y2 - y1, x2 - x1);
      if (x1 < c.left) {
        if (x2 < c.left) {
          return;
        }
        y1 = int16(y1 + timesSlope(c.left - x1, slope));
        x1 = c.left;
      }
      if (x2 > c.right) {
        if (x1 > c.right) {
          return;
        }
        y2 = int16(y2 + timesSlope(c.right - x2, slope));
        x2 = c.right;
      }
      if (y1 > y2) {
        [x1, y1, x2, y2] = [x2, y2, x1, y1];
      }
      if (y1 < c.top) {
        if (y2 < c.top) {
          return;
        }
        x1 = int16(x1 + overSlope(c.top - y1, slope));
        y1 = c.top;
      }
      if (y2 > c.bottom) {
        if (y1 > c.bottom) {
          return;
        }
        x2 = int16(x2 + overSlope(c.bottom - y2, slope));
        y2 = c.bottom;
      }
    }
  }
  lineNoClip(m, x1, y1, x2, y2, color);
}

/** 186a:1995 */
export function hline(m, x1, x2, y, color) {
  if (x1 > x2) {
    [x1, x2] = [x2, x1];
  }
  solidSpan(m, y, x1, x2 - x1 + 1, color);
}

/** 186a:19bf, through the span hook (DS:911a). */
export function fillRect(m, x1, y1, x2, y2, color, span = solidSpan) {
  const rows = Math.abs(y2 - y1) + 1;
  const w = Math.abs(x2 - x1) + 1;
  if (x1 > x2) {
    [x1, y1, x2, y2] = [x2, y2, x1, y1];
  }
  const dy = y1 < y2 ? 1 : -1;
  let y = y1;
  for (let i = 0; i < rows; i++) {
    span(m, y, x1, w, color);
    y += dy;
  }
}

/** 186a:1a2a: a 4x4 rounded blob. */
export function drawDot(m, x, y, color) {
  hline(m, x + 1, x + 2, y, color);
  hline(m, x, x + 3, y + 1, (color + 1) & 0xff);
  hline(m, x, x + 3, y + 2, (color + 1) & 0xff);
  hline(m, x + 1, x + 2, y + 3, color);
  putPixel(m, x + 1, y + 1, (color + 2) & 0xff);
}

// ---- palette ----

/** 186a:062a: a linear ramp from colour a to b. */
export function gradient(m, a, b, r1, g1, b1, r2, g2, b2) {
  const n = b - a;
  const sr = f32((r2 - r1) / n);
  const sg = f32((g2 - g1) / n);
  const sb = f32((b2 - b1) / n);
  for (let i = a; i <= b; i++) {
    const t = i - a;
    m.setColor(i, int16(r1 + roundHalfEven(t * sr)), int16(g1 + roundHalfEven(t * sg)), int16(b1 + roundHalfEven(t * sb)));
  }
}

/** 186a:0729: entry i moves to i+shift, wrapping inside first..last. */
export function rotatePalette(m, first, last, shift) {
  const next = m.palette.slice();
  for (let i = first; i <= last; i++) {
    let j = i + shift;
    if (j < first) {
      j = last - (first - j) + 1;
    }
    if (j > last) {
      j = j - last + first - 1;
    }
    next[j * 3] = m.palette[i * 3];
    next[j * 3 + 1] = m.palette[i * 3 + 1];
    next[j * 3 + 2] = m.palette[i * 3 + 2];
  }
  m.setPalette(next);
}

/** 186a:07cf: cumulative, on the shadow palette. */
export function addPalette(m, first, last, dr, dg, db) {
  for (let i = first; i <= last; i++) {
    m.setColor(i, int16(m.palette[i * 3] + dr), int16(m.palette[i * 3 + 1] + dg), int16(m.palette[i * 3 + 2] + db));
  }
}

/** 186a:0836: a base palette plus an offset. */
export function setPaletteOffset(m, base, first, last, dr, dg, db) {
  for (let i = first; i <= last; i++) {
    m.setColor(i, int16(base[i * 3] + dr), int16(base[i * 3 + 1] + dg), int16(base[i * 3 + 2] + db));
  }
}

/**
 * 186a:08bc: busy-waits `duration` ticks, moving first..last by d*steps*elapsed/duration.
 * The port re-evaluates once per tick, which is all the screen can show.
 */
export function* timedFade(m, first, last, dr, dg, db, steps, duration) {
  const base = m.palette.slice();
  const t0 = m.ticks;
  for (;;) {
    const elapsed = m.ticks - t0;
    const offsetOf = (d) => int16(roundHalfEven(Math.imul(Math.imul(d, elapsed), steps) / duration));
    setPaletteOffset(m, base, first, last, offsetOf(dr), offsetOf(dg), offsetOf(db));
    if (elapsed >= duration) {
      break;
    }
    yield m.tickTime(m.ticks + 1);
  }
  setPaletteOffset(m, base, first, last, int16(dr * steps), int16(dg * steps), int16(db * steps));
}

/** 186a:09ff: the shadow palette (stored while locked) faded in from black over `duration` ticks. */
export function* fadeInFromBlack(m, duration) {
  addPalette(m, 0, 255, -64, -64, -64);
  m.unlockPalette();
  yield* timedFade(m, 0, 255, 1, 1, 1, 64, duration);
}

/** 186a:0a32 / 0ca0: a palette fade in a fixed number of steps, one per call. */
export class StepFade {
  constructor(m, first, last, target, steps) {
    this.m = m;
    this.first = first;
    this.last = last;
    this.steps = steps;
    this.current = new Float64Array(768);
    this.delta = new Float64Array(768);
    for (let i = first * 3; i < (last + 1) * 3; i++) {
      this.delta[i] = (target[i] - m.palette[i]) / steps;
      this.current[i] = m.palette[i];
    }
  }

  /** Returns true when there is nothing left to do. */
  step() {
    if (this.steps === 0) {
      return true;
    }
    const next = this.m.palette.slice();
    for (let i = this.first * 3; i < (this.last + 1) * 3; i++) {
      this.current[i] += this.delta[i];
      next[i] = roundHalfEven(this.current[i]);
    }
    this.m.setPalette(next);
    this.steps--;
    return false;
  }
}

// ---- whole-page effects ----

/** 186a:14f3: dst = max(src, dst). */
export function maxBlend(src, dst) {
  for (let i = 0; i < PAGE_SIZE; i++) {
    if (src[i] > dst[i]) {
      dst[i] = src[i];
    }
  }
}

/** 186a:1522: moves the indices lo..hi of a page by `shift`, and the palette with them. */
export function remapRange(m, pageNumber, lo, hi, shift) {
  const p = m.getPage(pageNumber);
  for (let i = 0; i < PAGE_SIZE; i++) {
    if (lo <= p[i] && p[i] <= hi) {
      p[i] = (p[i] + shift) & 0xff;
    }
  }
  rotatePalette(m, lo, hi + shift, shift);
}

/** 186a:13ea: a 320-stride picture packed in place to stride w. */
export function repackPage(m, pageNumber, w, rows) {
  const p = m.getPage(pageNumber);
  for (let r = 0; r < rows; r++) {
    p.copyWithin(r * w, r * 320, r * 320 + w);
  }
}

/** 179b:0000: both bytes of every non-zero word darkened by v, saturating at 0. */
export function darkenActivePage(m, v) {
  const p = m.active;
  for (let i = 0; i < PAGE_SIZE; i += 2) {
    if (p[i] !== 0 || p[i + 1] !== 0) {
      p[i] = Math.max(p[i] - v, 0);
      p[i + 1] = Math.max(p[i + 1] - v, 0);
    }
  }
}
