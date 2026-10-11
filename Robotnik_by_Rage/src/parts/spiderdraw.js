// The spider part's own drawing (intro part 0, docs/disassembly/P0_spider.md): the blend table
// 0x209a0, the floor light / blood stamps 0x317f8 / 0x31934, and the two per-polygon routines only
// this part installs: the floor marker 0x3274c (records where the light points on screen) and the
// light cone 0x31d14. The cave 0x38440, the shadow 0x3315c / 0x328a0 and the light / plane
// recorders 0x32714 / 0x32788 are the engine's (src/engine/routines). Like the original's globals,
// the marker ([0x10631c..]) and the light ([0x106310..]) keep their values from frame to frame, and
// the routines run in the engine's sort order.

import { imul } from '../engine/fixed.js';
import { V, VERTEX_INTS, S, rasterTemplate, packedChannel, packedIndex, sortSlotsByY } from '../engine/index.js';
import { shadowGlobals } from '../engine/routines/r328a0.js';

const WIDTH = 320;
const TABLE_ROWS = 128;
const NEUTRAL_ROW = 64;
const SPIDER_COLOURS = 128;
const CAVE_TOP = 254;
const BLOOD = 255;

/**
 * 0x209a0: rows 0..127 of the 64 KB table 0xfd0a0 (rows 128..255 are left as they are: 0 in the
 * bss). Row 64 is the identity, rows above brighten, rows below darken; row 0 turns every cave
 * colour (128..254) black and leaves the spider's colours (0..127) and the blood (255) alone.
 */
export function buildBlendTable(table) {
  for (let s = 0; s < TABLE_ROWS; s++) {
    for (let c = 0; c < SPIDER_COLOURS; c++) {
      const v = c + s - NEUTRAL_ROW;
      table[s * 256 + c] = s === 0 ? c : s <= NEUTRAL_ROW ? Math.max(v, 0) : Math.min(v, SPIDER_COLOURS - 1);
    }
    for (let c = SPIDER_COLOURS; c < BLOOD; c++) {
      table[s * 256 + c] = s <= NEUTRAL_ROW ? Math.max(c - 2 * (NEUTRAL_ROW - s), SPIDER_COLOURS) : Math.min(c + (s - NEUTRAL_ROW), CAVE_TOP);
    }
    table[s * 256 + BLOOD] = BLOOD;
  }
}

// --- floor stamps ------------------------------------------------------------------------------

const STAMP_SIZE = 64;
const STAMP_HALF = 32;
const MAP_SIZE = 256;
const BLOOD_TEXEL = 0xff;
/** [0x84c78] / [0x84c7c]: no stamp on the floor yet. */
export const NO_STAMP = -1000;

/** Calls `visit(mapIndex, stampIndex)` for the 64x64 window centred on (x, y), clipped to the map. */
function forEachStampTexel(x, y, visit) {
  for (let r = 0; r < STAMP_SIZE; r++) {
    const row = y - STAMP_HALF + r;
    if (row < 0 || row >= MAP_SIZE) {
      continue;
    }
    for (let c = 0; c < STAMP_SIZE; c++) {
      const column = x - STAMP_HALF + c;
      if (column >= 0 && column < MAP_SIZE) {
        visit(row * MAP_SIZE + column, r * STAMP_SIZE + c);
      }
    }
  }
}

/** 0x317f8 LightStamp: take the last spot off the floor map, add the star at (x, y) (byte wrap). */
export function stampLight(stamp, star, map, x, y) {
  if (stamp.x !== NO_STAMP) {
    forEachStampTexel(stamp.x, stamp.y, (at, from) => {
      map[at] -= star[from];
    });
  }
  forEachStampTexel(x, y, (at, from) => {
    map[at] += star[from];
  });
  stamp.x = x;
  stamp.y = y;
}

/** 0x31934 BloodStamp: the splat's 0xff texels become colour 255 on the floor map. */
export function stampBlood(blood, map, x, y) {
  forEachStampTexel(x, y, (at, from) => {
    if (blood[from] === BLOOD_TEXEL) {
      map[at] = BLOOD_TEXEL;
    }
  });
}

// --- what the routines record -------------------------------------------------------------------

/** 0x3274c: remember where the floor marker is on screen ([0x10631c] x, [0x106320] y, [0x106324] z). */
export function recordMarker(polygon, context) {
  const at = polygon.slots[S.VERTEX] * VERTEX_INTS;
  const v = context.vertices;
  context.marker[0] = v[at + V.SX];
  context.marker[1] = v[at + V.SY];
  context.marker[2] = v[at + V.Z];
}

// --- 0x31d14 light cone --------------------------------------------------------------------------

/** The cone's corners: the light's direction to the marker turned by ±25 degrees (cos 928/1024, sin 432/1024). */
const CONE_COS = 928;
const CONE_SIN = 432;
const CONE_UV_NEAR = 0x200;
const CONE_UV_FAR = 0x3f00;
const NO_DRAW_SHIFT = 1;

/** 0x4fd3b / 0x4fd6b: from xl up to xr-1 (long edge left) or from xr down to xl+1, shading the screen. */
function shadeSpan(target, table, texture, y, xLong, xShort, isLongLeft, values, dx) {
  const row = y * WIDTH;
  let uv = values[0];
  if (isLongLeft) {
    let xl = xLong;
    let xr = xShort;
    if (!(xl < WIDTH && xr > 0)) {
      return;
    }
    if (xl < 0) {
      uv = (uv - imul(xl, dx[0])) | 0;
      xl = 0;
    }
    xr = Math.min(xr, WIDTH - 1);
    for (let x = xl; x < xr; x++) {
      target[row + x] = table[(texture[packedIndex(uv)] << 8) | target[row + x]];
      uv = (uv + dx[0]) | 0;
    }
    return;
  }
  let xr = xLong;
  let xl = xShort;
  if (!(xl < WIDTH && xr > 0)) {
    return;
  }
  if (xr > WIDTH - 1) {
    uv = (uv + imul(WIDTH - 1 - xr, dx[0])) | 0;
    xr = WIDTH - 1;
  }
  xl = Math.max(xl, 0);
  for (let x = xr; x > xl; x--) {
    target[row + x] = table[(texture[packedIndex(uv)] << 8) | target[row + x]];
    uv = (uv - dx[0]) | 0;
  }
}

/**
 * 0x31d14 LightCone: a triangle from the light towards the marker, sp_ray as a brightness map through
 * the blend table ([0x10631c] = context.marker); then the light point is remembered like 0x32714.
 */
export function drawLightCone(polygon, context) {
  const at = polygon.slots[S.VERTEX] * VERTEX_INTS;
  const v = context.vertices;
  const z = v[at + V.Z];
  if ((polygon.material.depthShift ?? 0) !== NO_DRAW_SHIFT && z > 0) {
    const ax = v[at + V.SX];
    const ay = v[at + V.SY];
    const dx = context.marker[0] - ax;
    const dy = context.marker[1] - ay;
    const xs = [ax, ax + ((imul(CONE_COS, dx) - imul(CONE_SIN, dy)) >> 10), ax + ((imul(CONE_COS, dx) + imul(CONE_SIN, dy)) >> 10)];
    const ys = [ay, ay + ((imul(CONE_SIN, dx) + imul(CONE_COS, dy)) >> 10), ay + ((imul(CONE_COS, dy) - imul(CONE_SIN, dx)) >> 10)];
    const us = [CONE_UV_NEAR, CONE_UV_FAR, CONE_UV_NEAR];
    const vs = [CONE_UV_NEAR, CONE_UV_NEAR, CONE_UV_FAR];
    const order = sortSlotsByY(ys[0], ys[1], ys[2]);
    const triangle = { order, xs: order.map((k) => xs[k]), ys: order.map((k) => ys[k]) };
    const [t, m, b] = order;
    const { target, colourTable } = context;
    const texture = polygon.material.texture;
    rasterTemplate(triangle, [packedChannel(us[t], vs[t], us[m], vs[m], us[b], vs[b])],
      (y, xLong, xShort, isLongLeft, values, gradient) =>
        shadeSpan(target, colourTable, texture, y, xLong, xShort, isLongLeft, values, gradient));
  }
  shadowGlobals.light = [v[at + V.X], v[at + V.Y], z];
}

