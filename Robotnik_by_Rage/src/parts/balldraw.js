// Part 7's per-frame drawing: the textured ball, the light rays, the glow feedback and the composite
// onto the background. Ports 0x11fd9, 0x1fb50, 0x1f868, 0x1fa88, 0x1f560, the inline ray and
// feedback loops of 0x20480, and 0x11e4c.
//
// Everything draws into the 64 KB block at 0xe4d40 ("frame"), pixel (x, y) at FRAME_ORIGIN + y*320 + x,
// with no clipping: coordinates are linear offsets, so x outside 0..319 wraps into the neighbouring
// row, as in the original. The glow block [0xdc6f8] has the same layout.

export const WIDTH = 320;
/** Two guard rows above pixel (0,0) of the 0xe4d40 block. */
export const FRAME_ORIGIN = 0x280;
export const BLOCK_BYTES = 0x10000;
/** Room for strokes that wrap past the end of the block. */
const BLOCK_SPARE = 4 * WIDTH;
/** feedback and composite cover rows 0..198 (0xf8c0 bytes). */
const GLOW_BYTES = 0xf8c0;
/** The ball is a 256x200 window of the view map from row 28 (ty = -100), drawn at x = 32. */
const BALL_LEFT = 32;
const BALL_WIDTH = 256;
const BALL_ROWS = 200;
const VIEW_FIRST_ROW = 28;
/** A ray's 4-pixel brush: +5 at the ends, +9 in the middle (T1[k] and T1[k + 4]). */
const BRUSH_MIDDLE = 4;
/** rayOut stops at x 0 / 318 and rows 0 / 198 (f < 0xc700). */
const RAY_RIGHT = 318;
const RAY_BOTTOM_FIXED = 0xc700;
const RAY_LAST_ROW = 199;

export function createBlock() {
  return new Uint8Array(BLOCK_BYTES + BLOCK_SPARE);
}

/**
 * 0x1fffc's tables: T1 brightens a stroke pixel by 5 (by 9 at index + 4), T2 decays the glow by
 * 2/3, T3 averages the 5-tap blur. All saturate at 63.
 */
export function buildGlowTables() {
  const brighten = new Uint8Array(256 + BRUSH_MIDDLE);
  const decay = new Uint8Array(256);
  const average = new Uint8Array(512);
  for (let k = 0; k < 256; k++) {
    brighten[k] = Math.min(k + 5, 63);
    decay[k] = Math.min(Math.trunc((2 * k) / 3), 63);
  }
  brighten.set(decay.subarray(0, BRUSH_MIDDLE), 256);
  for (let k = 0; k < 512; k++) {
    average[k] = Math.min(Math.trunc(k / 5), 63);
  }
  return { brighten, decay, average };
}

/** C/x86 signed division, truncating toward zero. */
export function idiv(a, b) {
  return Math.trunc(a / b);
}

/** Vertical brush at pixel offset o: rows -1 and +2 get +5, rows 0 and +1 get +9. */
function plotVertical(frame, t1, o) {
  const at = FRAME_ORIGIN + o;
  frame[at - WIDTH] = t1[frame[at - WIDTH]];
  frame[at] = t1[frame[at] + BRUSH_MIDDLE];
  frame[at + WIDTH] = t1[frame[at + WIDTH] + BRUSH_MIDDLE];
  frame[at + 2 * WIDTH] = t1[frame[at + 2 * WIDTH]];
}

/** Horizontal brush, built as a dword from the pixels one to the left: shifted one pixel right. */
function plotHorizontal(frame, t1, o) {
  const at = FRAME_ORIGIN + o;
  const a = frame[at - 1];
  const b = frame[at];
  const c = frame[at + 1];
  const d = frame[at + 2];
  frame[at] = t1[a];
  frame[at + 1] = t1[b + BRUSH_MIDDLE];
  frame[at + 2] = t1[c + BRUSH_MIDDLE];
  frame[at + 3] = t1[d];
}

/** 0x1f868 thickSeg: the brush from (x0,y0) up to but not including (x1,y1). */
function thickSegment(frame, t1, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx === 0 && dy === 0) {
    return;
  }
  if (Math.abs(dx) > Math.abs(dy)) {
    const slope = idiv(dy << 8, Math.abs(dx));
    const step = Math.sign(dx);
    for (let x = x0, f = y0 << 8; x !== x1; x += step, f += slope) {
      plotVertical(frame, t1, (f >> 8) * WIDTH + x);
    }
  } else {
    const slope = idiv(dx << 8, Math.abs(dy));
    const step = Math.sign(dy);
    for (let y = y0, f = x0 << 8; y !== y1; y += step, f += slope) {
      plotHorizontal(frame, t1, y * WIDTH + (f >> 8));
    }
  }
}

/**
 * 0x1fa88 thinSeg: one +5 pixel per step. The loops are do-while with unsigned compares, so the
 * start pixel is always drawn and the end pixel never.
 */
function thinSegment(frame, t1, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx === 0 && dy === 0) {
    return;
  }
  const plot = (o) => {
    frame[FRAME_ORIGIN + o] = t1[frame[FRAME_ORIGIN + o]];
  };
  if (Math.abs(dx) > Math.abs(dy)) {
    const slope = idiv(dy << 8, Math.abs(dx));
    const step = dx > 0 ? 1 : -1;
    let f = y0 << 8;
    let x = x0;
    do {
      plot((f >>> 8) * WIDTH + x);
      f += slope;
      x += step;
    } while (step > 0 ? (x >>> 0) < (x1 >>> 0) : (x >>> 0) > (x1 >>> 0));
  } else {
    const slope = idiv(dx << 8, Math.abs(dy));
    const step = dy > 0 ? WIDTH : -WIDTH;
    const end = y1 * WIDTH;
    let f = x0 << 8;
    let o = y0 * WIDTH;
    do {
      plot(o + (f >>> 8));
      f += slope;
      o += step;
    } while (step > 0 ? (o >>> 0) < (end >>> 0) : (o >>> 0) > (end >>> 0));
  }
}

/** 0x1f560 rayOut: the brush from (x,y) away from the centre to the edge of the screen. */
function rayOut(frame, t1, x, y, cx, cy) {
  const dx = x - cx;
  const dy = y - cy;
  if (dx === 0 && dy === 0) {
    return;
  }
  if (Math.abs(dy) < Math.abs(dx)) {
    const slope = idiv(dy << 8, Math.abs(dx));
    const step = dx > 0 ? 1 : -1;
    const isInside = dx > 0
      ? (dy > 0 ? (px, f) => px < RAY_RIGHT && f < RAY_BOTTOM_FIXED : (px, f) => px < RAY_RIGHT && f >= 0)
      : (dy > 0 ? (px, f) => px > 0 && f < RAY_BOTTOM_FIXED : (px, f) => px > 0 && f > 0);
    for (let px = x, f = y << 8; isInside(px, f); px += step, f += slope) {
      plotVertical(frame, t1, (f >> 8) * WIDTH + px);
    }
  } else {
    const slope = idiv(dx << 8, Math.abs(dy));
    let f = x << 8;
    if (dy > 0) {
      for (let row = y; row < RAY_LAST_ROW; row++, f += slope) {
        plotHorizontal(frame, t1, row * WIDTH + (f >> 8));
      }
    } else {
      for (let row = y; row > 0; row--, f += slope) {
        plotHorizontal(frame, t1, row * WIDTH + (f >> 8));
      }
    }
  }
}

/** Two turn-map lookups: the texel offset (v << 8 | u) of view-map entry `m` spun by (rotU, rotV). */
function turnedTexel(maps, m, rotU, rotV) {
  const { view, turn } = maps;
  const i = (view[2 * m + 1] << 8) | ((view[2 * m] + rotU) & 0xff);
  const j = (turn[2 * i + 1] << 8) | ((turn[2 * i] + rotV) & 0xff);
  return turn[2 * j] | (turn[2 * j + 1] << 8);
}

/**
 * 0x11fd9 drawBall: the 256x200 ball window at x 32 plus `offset` (= yo*320 + xo). Texels 0 and 1
 * (the holes) leave the frame as it is.
 */
export function drawBall(frame, maps, texture, rotU, rotV, offset) {
  const { view } = maps;
  let d = FRAME_ORIGIN + BALL_LEFT + offset;
  let m = VIEW_FIRST_ROW * BALL_WIDTH;
  for (let r = 0; r < BALL_ROWS; r++, d += WIDTH - BALL_WIDTH) {
    for (let c = 0; c < BALL_WIDTH; c++, m++, d++) {
      if (view[2 * m] === 0) {
        continue;
      }
      const p = texture[turnedTexel(maps, m, rotU, rotV)];
      if (p > 1) {
        frame[d] = p;
      }
    }
  }
}

/** The sphere point (sx, sy) a ray starts from: its {u, v} looked up in the projected table. */
function rayOrigin(spherePoints, ray) {
  const k = ((ray.v & 0xff) << 8) | (ray.u & 0xff);
  return [spherePoints[2 * k], spherePoints[2 * k + 1]];
}

/**
 * 0x1fb50 raysInner(0, 0, rotU, rotV, xo, yo): each ray from the centre to its sphere point. A ray
 * whose point lies in a hole of the turned texture (an eye, the mouth) is lit: the thick brush, and
 * it goes on outwards (raysOuter). The others get the thin line. Points on the back are skipped.
 * The second lookup is a plain 16-bit add, so v may carry (the turn map has a spare row for it).
 */
export function drawRaysInner(state, rotU, rotV, xo, yo) {
  const { frame, glow, maps, texture, spherePoints, rays, centre } = state;
  const { view, turn } = maps;
  for (let k = 0; k < state.rayCount; k++) {
    const ray = rays[k];
    const [sx, sy] = rayOrigin(spherePoints, ray);
    if (sy <= 0) {
      ray.isLit = false;
      continue;
    }
    const m = ((sx - BALL_LEFT) & 0xff) | ((sy << 8) + (VIEW_FIRST_ROW << 8));
    const i = (view[2 * m + 1] << 8) | ((view[2 * m] + rotU) & 0xff);
    const w = turn[2 * i] | (turn[2 * i + 1] << 8);
    const j = w + (rotV & 0xff);
    ray.isLit = texture[turn[2 * j] | (turn[2 * j + 1] << 8)] === 0;
    if (ray.isLit) {
      thickSegment(frame, glow.brighten, centre.x, centre.y, sx + xo, sy + yo);
    } else {
      thinSegment(frame, glow.brighten, centre.x, centre.y, sx + xo, sy + yo);
    }
  }
}

/** Inline in 0x20480 (0x206a7): the lit rays continue from their sphere point to the screen edge. */
export function drawRaysOuter(state, xo, yo) {
  const { frame, glow, spherePoints, rays, centre } = state;
  for (let k = 0; k < state.rayCount; k++) {
    const ray = rays[k];
    if (ray.isLit) {
      const [sx, sy] = rayOrigin(spherePoints, ray);
      rayOut(frame, glow.brighten, sx + xo, sy + yo, centre.x, centre.y);
    }
  }
}

/**
 * Inline in 0x20480 (0x20522): the glow block takes in the frame, decayed by 2/3, and the frame is
 * cleared; rows 0..198 only (row 199 of the frame is never cleared, of the glow never written).
 */
export function feedBack(frame, glowBlock, decay) {
  for (let o = FRAME_ORIGIN; o < FRAME_ORIGIN + GLOW_BYTES; o++) {
    glowBlock[o] = decay[(frame[o] + glowBlock[o]) & 0xff];
    frame[o] = 0;
  }
}

/** 0x11e4c composite: rows 0..198 of dst = 5-tap blur of the glow / 5 + background. */
export function composite(dst, dstOffset, glowBlock, background, average) {
  for (let i = 0; i < GLOW_BYTES; i++) {
    const o = FRAME_ORIGIN + i;
    const sum = glowBlock[o] + glowBlock[o - WIDTH] + glowBlock[o - 1] + glowBlock[o + 1] + glowBlock[o + WIDTH];
    dst[dstOffset + i] = average[sum] + background[i];
  }
}
