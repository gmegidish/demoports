// Part 9 (0x1087bc, runs to song position 0x24): the spiky star object (the 3D engine, src/engine3d.js) over a
// bending textured tunnel (docs/disassembly/D1_engine3d.md).
//
// Each frame: the tunnel (0x10832c) into the back buffer [0x12bd80], the star's position and angles, the star
// (0x10b055, z-buffered over the tunnel), then the copy to the screen. The animation steps by the retraces that
// passed, except the tunnel's bend: 0x10871d records the bend once per rendered frame into two 16-entry
// histories, one per ring, so the shape depends on how often the original rendered (see the notes).
import { POSITION, RETRACES, copyToScreen, setPalette, waitRetrace } from '../machine.js';
import { FILLER_107B7B, fillTriangle } from '../raster3d.js';
import {
  sub_10900c, sub_1090b2, sub_109097, sub_10af2c, sub_10b055, sub_10b21a, sub_10b278, sub_10b2ce, sub_10b356,
} from '../engine3d.js';

/** @typedef {import('../machine.js').Machine} Machine */

const BACK_BUFFER = 0x12bd80;
const PALETTE = 0x15ccb0;
/** The tunnel's texture (a 256 x 256 picture), also the star's. */
const TEXTURE = 0x15cfb0;
/** The star in TOONTOWN.DAT, scaled by 0.75. */
const STAR_OFFSET = 0xab89c;
const STAR_SCALE = 0.75;
const DRAW_MODE = 10;
const SHADE_SCALE = 0xff;
const Z_CLEAR = 0x7d00;
const LIGHT_Z = -11;
/** The bend histories (two malloc(0x40), static initializer 0x107b5c) and the bend's phase (a double). */
const BEND_X = 0x1706f8;
const BEND_Y = 0x1706fc;
const BEND_PHASE = 0x1706f0;
const BEND_ENTRIES = 16;
/** The texture's scroll (dwords; the low bytes are used) and their steps per retrace at 0x128514 / 0x128518. */
const SCROLL_U = 0x1706e8;
const SCROLL_V = 0x1706ec;
const SCROLL_U_STEP = 0x128514;
const SCROLL_V_STEP = 0x128518;
/** Doubles: 250, 1/16, 5, 25, pi, 478, 40, 50, 180, 682, 0.07; a float32: pi / 8. */
const RADIUS = 0x1275a8;
const RADIUS_SCALE = 0x1275b0;
const BEND_DIVISOR = 0x1275bc;
const BEND_AMPLITUDE = 0x1275c4;
const PI = 0x1275cc;
const DEPTH_SWING = 0x1275d4;
const Y_SWING = 0x1275dc;
const X_SWING = 0x1275e4;
const HALF_TURN = 0x1275ec;
const DEPTH = 0x1275f4;
const BEND_STEP = 0x1275fc;
const SEGMENT_ANGLE = 0x1275b8;
const RINGS = 16;
const SEGMENTS = 16;
const CENTRE_X = 0xa0;
const CENTRE_Y = 0x64;
const SHADE_PER_RING = 12;
const TEXELS_PER_STEP = 0x40;
const FULL_TURN = 360;
const VERTEX_SIZE = 0x18;

/** fistp to a word: round to nearest, ties to even. */
function roundToEven(value) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction !== 0.5) {
    return Math.round(value);
  }
  return floor % 2 === 0 ? floor : floor + 1;
}

/** 0x107b5c (a static initializer, run before main): the two bend histories. */
function allocateBendHistories(m) {
  if (m.u32(BEND_X) === 0) {
    m.set32(BEND_X, m.malloc(BEND_ENTRIES * 4));
    m.set32(BEND_Y, m.malloc(BEND_ENTRIES * 4));
  }
}

/**
 * 0x10871d: the tunnel's bend for the current phase into the last entry of each history, then both histories
 * move one entry down (the last entry stays).
 */
export function recordTunnelBend(m) {
  const phase = m.f64(BEND_PHASE);
  const amplitude = m.f64(BEND_AMPLITUDE);
  const divisor = m.f64(BEND_DIVISOR);
  const last = (BEND_ENTRIES - 1) * 4;
  m.set32(m.u32(BEND_X) + last, Math.trunc((Math.sin(phase) + Math.cos(phase) / divisor) * amplitude));
  m.set32(m.u32(BEND_Y) + last, Math.trunc((Math.cos(phase) + Math.sin(phase) / divisor) * amplitude));
  for (let at = 0; at < last; at += 4) {
    m.set32(m.u32(BEND_X) + at, m.s32(m.u32(BEND_X) + at + 4));
    m.set32(m.u32(BEND_Y) + at, m.s32(m.u32(BEND_Y) + at + 4));
  }
}

/** Writes a 24-byte vertex (x, y, shade, u, v) for 0x107b7b. */
function setVertex(m, at, x, y, shade, u, v) {
  m.set32(at, x);
  m.set32(at + 4, y);
  m.set32(at + 0xc, shade);
  m.set32(at + 0x10, u);
  m.set32(at + 0x14, v);
}

/**
 * 0x10832c: the tunnel. Ring k (1..15) is a 16-gon of radius 250 * k / 16 centred on (160, 100) moved by bend
 * history entry k; each segment between rings k - 1 and k is two triangles (0x107b7b), textured with u from the
 * segment and v from the ring, scrolled by `scrollU`, `scrollV` (bytes), shaded 12 * ring.
 * The x87 detail kept: the angles are j * pi / 8 (float32 constant) and stored as float32, but two cosines take
 * the unrounded product.
 * @param {Machine} m
 * @param {number} vertices 4 scratch vertices (the original's stack frame)
 */
export function drawTunnel(m, scrollU, scrollV, vertices) {
  const radius = m.f64(RADIUS);
  const radiusScale = m.f64(RADIUS_SCALE);
  const segmentAngle = m.f32(SEGMENT_ANGLE);
  const bendX = (ring) => m.s32(m.u32(BEND_X) + ring * 4);
  const bendY = (ring) => m.s32(m.u32(BEND_Y) + ring * 4);
  const offset = (trig, ring) => roundToEven(trig * radius * ring * radiusScale);
  const dst = m.u32(BACK_BUFFER);
  const texture = m.u32(TEXTURE);
  const [v0, v1, v2, v3] = [0, 1, 2, 3].map((i) => vertices + i * VERTEX_SIZE);
  for (let ring = 1; ring < RINGS; ring++) {
    for (let segment = 1; segment <= SEGMENTS; segment++) {
      const angle = segment * segmentAngle;
      const angleF = Math.fround(angle);
      const next = (segment + 1) * segmentAngle;
      const nextF = Math.fround(next);
      const outerShade = SHADE_PER_RING * ring + SHADE_PER_RING;
      const innerShade = SHADE_PER_RING * ring;
      const u = segment * TEXELS_PER_STEP + scrollU;
      const uNext = (segment + 1) * TEXELS_PER_STEP + scrollU;
      const v = ring * TEXELS_PER_STEP + scrollV;
      const vInner = (ring - 1) * TEXELS_PER_STEP + scrollV;
      setVertex(m, v0, bendX(ring) + CENTRE_X + offset(Math.cos(angle), ring),
        bendY(ring) + CENTRE_Y + offset(Math.sin(angleF), ring), outerShade, u, v);
      setVertex(m, v1, bendX(ring) + CENTRE_X + offset(Math.cos(next), ring),
        bendY(ring) + CENTRE_Y + offset(Math.sin(nextF), ring), outerShade, uNext, v);
      setVertex(m, v2, bendX(ring - 1) + CENTRE_X + offset(Math.cos(nextF), ring - 1),
        bendY(ring - 1) + CENTRE_Y + offset(Math.sin(nextF), ring - 1), innerShade, uNext, vInner);
      setVertex(m, v3, bendX(ring - 1) + CENTRE_X + offset(Math.cos(angleF), ring - 1),
        bendY(ring - 1) + CENTRE_Y + offset(Math.sin(angleF), ring - 1), innerShade, u, vInner);
      fillTriangle(m, FILLER_107B7B, v0, v1, v2, dst, texture);
      fillTriangle(m, FILLER_107B7B, v0, v2, v3, dst, texture);
    }
  }
}

/**
 * The part's counters: `swing` ([esp+0x20], +4 per retrace, mod 360 per frame), `spin` (ebp, +2, mod 360) and
 * `wobble` ([esp+0x1c], +1).
 * `sinceBend`: retraces since the last recorded bend (port only).
 * @typedef {{ swing: number, spin: number, wobble: number, sinceBend: number, vertices: number }} StarState
 */

/** 0x1087e2..0x108866: palette, bend histories, the star loaded and set up. Returns the part's state. */
export function startStar(m) {
  setPalette(m, PALETTE);
  allocateBendHistories(m);
  for (let i = 0; i < BEND_ENTRIES; i++) {
    recordTunnelBend(m);
  }
  sub_10900c(m, 1);
  sub_1090b2(m, 0, STAR_OFFSET);
  sub_109097(m, 0, 0);
  sub_10b2ce(m, 0, STAR_SCALE);
  sub_10b356(m, Z_CLEAR);
  sub_10af2c(m, 0, DRAW_MODE, SHADE_SCALE, 0, m.u32(TEXTURE), 0);
  sub_10b278(m, 0, 0, LIGHT_Z);
  return { swing: 0, spin: 0, wobble: 0, sinceBend: 0, vertices: m.malloc(4 * VERTEX_SIZE) };
}

/** 0x10887f..0x108953: one frame into the back buffer. */
export function renderStar(m, state) {
  drawTunnel(m, m.u8(SCROLL_U), m.u8(SCROLL_V), state.vertices);
  const degrees = m.f64(PI) / m.f64(HALF_TURN);
  const z = Math.trunc(Math.cos(state.swing * degrees) * m.f64(DEPTH_SWING) + m.f64(DEPTH));
  const y = Math.trunc(Math.cos(((state.wobble * 5) % FULL_TURN) * degrees) * m.f64(Y_SWING));
  const x = Math.trunc(Math.sin(((state.wobble * 3) % FULL_TURN) * degrees) * m.f64(X_SWING));
  sub_10b21a(m, 0, x, y, z, state.spin, (state.spin + 90) % FULL_TURN, state.spin);
  sub_10b055(m, m.u32(BACK_BUFFER));
}

/**
 * The original records one bend per rendered frame, so the tunnel's shape depends on the machine's speed. The port
 * renders every retrace but records bends at the reference recording's pace: 299 pictures in 1412 retraces.
 */
const RETRACES_PER_BEND = 1412 / 299;

/**
 * 0x108987..0x1089ff: steps the animation by `retraces`, then records the tunnel's bend (at the recording's pace,
 * see RETRACES_PER_BEND; `recordEveryFrame` gives the original's per-frame recording, for the tools).
 */
export function advanceStar(m, state, retraces, recordEveryFrame = false) {
  for (let i = 0; i < retraces; i++) {
    m.setF64(BEND_PHASE, m.f64(BEND_PHASE) + m.f64(BEND_STEP));
    m.set32(SCROLL_U, m.s32(SCROLL_U) + m.s32(SCROLL_U_STEP));
    m.set32(SCROLL_V, m.s32(SCROLL_V) + m.s32(SCROLL_V_STEP));
    state.spin += 2;
    state.swing += 4;
    state.wobble++;
  }
  state.spin %= FULL_TURN;
  state.swing %= FULL_TURN;
  state.sinceBend += retraces;
  if (recordEveryFrame || state.sinceBend >= RETRACES_PER_BEND) {
    state.sinceBend = recordEveryFrame ? 0 : state.sinceBend - RETRACES_PER_BEND;
    recordTunnelBend(m);
  }
}

/**
 * 0x1087bc. (Its malloc(64000) buffer, cleared and never used, is left out; the frees at the end too.)
 * @param {Machine} m
 */
export function* starTunnel(m, lastPosition) {
  const state = startStar(m);
  let last = m.u32(RETRACES);
  m.readPlayStatus();
  for (;;) {
    renderStar(m, state);
    m.readPlayStatus();
    yield* waitRetrace(m);
    copyToScreen(m, m.u32(BACK_BUFFER));
    const now = m.u32(RETRACES);
    advanceStar(m, state, now - last);
    last = now;
    if (lastPosition <= m.u32(POSITION)) {
      return false;
    }
  }
}
