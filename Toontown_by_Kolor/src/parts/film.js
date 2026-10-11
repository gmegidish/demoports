// Part 5, 0x103808: the black-and-white Mickey film on a bending grid over a tunnel, then over a plasma
// (docs/disassembly/B_film.md).
//
// The film is a 256x1280 picture ([0x15c9ac]): five 256x256 frames. Frame 0 is the plasma's picture; frames 1..4
// are the film, each dissolved into the next through a mask picture ([0x16dee8]) while the song is at the
// positions after the part's first. The grid (mesh.js) is drawn with the shaded filler 0x106d1a: its shade comes
// from the grid's depth, the shade table at 0x14c6a4 turns texel and shade into a colour.
//
// Three loops: the tunnel while the grid flies away (the song's first three positions), the tunnel while it comes
// back (two more), the plasma until the part's last position. The tunnel and its table are 0x102e40's
// (buildTunnelTable, at load).
import { POSITION, ROW, RETRACES, copyToScreen, setPalette, waitRetrace } from '../machine.js';
import { buildMesh, drawMesh, fillSineTables, projectMesh, scaleMesh, waveMesh } from './mesh.js';
import { SHADED_106D1A } from './triangles.js';

/** @typedef {import('../machine.js').Machine} Machine */

/** 0x102e40's block: the tunnel's angle/distance words, its shade bytes, the texture and two wave tables. */
const TUNNEL_TABLE = 0x16f700;
const TUNNEL_TABLE_BYTES = 0x3f000;
const TUNNEL_SHADES = 0x1f400;
const TUNNEL_TEXTURE = 0x2ee00;
const TUNNEL_WAVE_U = 0x3ee00;
const TUNNEL_WAVE_V = 0x3ef00;
const SCREEN_PIXELS = 0xfa00;
const SCREEN_WIDTH = 320;
const SCREEN_HEIGHT = 200;
const PICTURE_BYTES = 0x10000;

/** The film picture, its palette, the dissolve mask, the buffer the parts draw into. */
const FILM = 0x15c9ac;
const FILM_PALETTE = 0x15c9b0;
const MASK = 0x16dee8;
const BACK_BUFFER = 0x12bd80;
/** 0x1037d2 fades this palette (bss, black) up to FILM_PALETTE. */
const FADE_PALETTE = 0x16f400;
/** The plasma's counters (globals, cleared at the start). */
const PLASMA_ANGLE = 0x16e0a0;
const PLASMA_PHASE = 0x16e0a4;

const INITIAL_DEPTH = 0x174;
const FAR_DEPTH = 0x4b0;
const NEAR_DEPTH = 0x1c4;
const SHADE_SCALE = 0x4b4b;
const SHADE_BASE = 0x9c;
/** 0x103920: the grid is scaled by 1.45 (float 0x3fb9999a). */
const MESH_SCALE = 1.45;
/** The row of a position after which the grid moves away (A) or back (B): position << 8 | 0x30. */
const MOVE_ROW = 0x30;
/** At rows above this the dissolve starts over. */
const DISSOLVE_RESTART_ROW = 0x3e;
/** The palette fades in during the first rows of the first position. */
const FADE_ROWS = 0x20;

/**
 * 0x102e40, at load: per pixel (x - 160, y - 100) the angle byte trunc(atan2(y, x) * 255 / pi) (the angle stored
 * as a float) and the distance byte trunc(sin(d / 6666) * 255 + d / 140), d = x^2 + y^2; then per pixel the
 * shade byte trunc(255 - d / 140). On the centre column the angle is the mean of its two neighbours' and the
 * distance byte the mean of its neighbours' bytes.
 * @param {Machine} m
 */
export function buildTunnelTable(m) {
  const table = m.malloc(TUNNEL_TABLE_BYTES);
  m.set32(TUNNEL_TABLE, table);
  let at = table;
  for (let row = 0; row < SCREEN_HEIGHT; row++) {
    const y = row - 100;
    for (let column = 0; column < SCREEN_WIDTH; column++) {
      const x = column - 160;
      const angle = x === 0
        ? Math.fround((Math.atan2(y, 1) + Math.atan2(y, -1)) * 0.5)
        : Math.fround(Math.atan2(y, x));
      m.mem[at++] = Math.trunc((angle * 255) / Math.PI) & 0xff;
      const d = x * x + y * y;
      m.mem[at++] = Math.trunc(Math.sin(d / 6666) * 255 + d / 140) & 0xff;
    }
    const line = table + row * SCREEN_WIDTH * 2;
    m.mem[line + 0x141] = (m.mem[line + 0x13f] + m.mem[line + 0x143]) >> 1;
  }
  for (let y = -100; y < 100; y++) {
    for (let x = -160; x < 160; x++) {
      m.mem[at++] = Math.trunc(255 - (x * x + y * y) / 140) & 0xff;
    }
  }
}

/** The two 256-byte tables the tunnel adds to its angle and distance: trunc(sin(i * pi / 255) * 100). */
function fillTunnelWaves(m, table, uStart, vStart) {
  for (let i = 0; i < 0x100; i++) {
    m.mem[table + TUNNEL_WAVE_U + i] = Math.trunc(Math.sin(((uStart + i) * Math.PI) / 255) * 100) & 0xff;
    m.mem[table + TUNNEL_WAVE_V + i] = Math.trunc(Math.sin(((vStart + i) * Math.PI) / 255) * 100) & 0xff;
  }
}

/**
 * 0x103b33: the tunnel, upside down (the table is read backwards). Each pixel pair takes its shade byte from the
 * first one; the last two pixels of the buffer are not written.
 */
function drawTunnel(m, dest, table) {
  const mem = m.mem;
  const texture = table + TUNNEL_TEXTURE;
  const waveU = table + TUNNEL_WAVE_U;
  const waveV = table + TUNNEL_WAVE_V;
  let out = dest;
  for (let c = SCREEN_PIXELS - 2; c !== 0; c -= 2) {
    const shade = mem[table + TUNNEL_SHADES + c];
    const du = mem[waveU + shade];
    const dv = mem[waveV + shade];
    for (const word of [table + c * 2, table + c * 2 - 2]) {
      mem[out++] = mem[texture + (((mem[word + 1] + dv) & 0xff) << 8) + ((mem[word] + du) & 0xff)];
    }
  }
}

/** 0x1037a6: copies the pixels of `from` to `to` where the mask is at most `threshold`. */
function dissolve(m, to, from, mask, threshold) {
  for (let i = 0; i < PICTURE_BYTES; i++) {
    if (m.mem[mask + i] <= threshold) {
      m.mem[to + i] = m.mem[from + i];
    }
  }
}

/**
 * The original fades once per rendered frame, so the fade's speed depends on the machine. The port renders every
 * retrace but fades at the reference recording's pace: 361 pictures in 1769 retraces.
 */
const RETRACES_PER_FADE = 1769 / 361;

/** 0x1037d2: `steps` times, every component of FADE_PALETTE below FILM_PALETTE's goes up by one. */
function fadeIn(m, steps) {
  for (let step = 0; step < steps; step++) {
    for (let i = 0; i < 0x300; i++) {
      if (m.mem[FADE_PALETTE + i] < m.mem[FILM_PALETTE + i]) {
        m.mem[FADE_PALETTE + i]++;
      }
    }
  }
}

/** 0x100bb1 with its fill value 0. */
function clearScreen(m) {
  for (let i = 0; i < SCREEN_PIXELS; i++) {
    m.vga.write(i, 0);
  }
}

/** 0x103a6a: the plasma's byte table, trunc(sin(i * pi / 128) * 30). */
function plasmaTable() {
  const table = new Uint8Array(0x100);
  for (let i = 0; i < 0x100; i++) {
    table[i] = Math.trunc(Math.sin(i * Math.PI * 0.0078125) * 30) & 0xff;
  }
  return table;
}

/** 0x10448f: the plasma from frame 0 of the film. `wobble` is [esp+0x12c]. */
function drawPlasma(m, dest, picture, table, wobble) {
  const mem = m.mem;
  const phase = m.s32(PLASMA_PHASE);
  let out = dest;
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    let e = wobble - y;
    for (let x = 0; x < SCREEN_WIDTH; x++, e++) {
      const b2 = table[(y - phase + table[x & 0xff]) & 0xff];
      const b4 = table[(table[(phase + x) & 0xff] - (b2 + phase + x)) & 0xff];
      const b6 = table[(phase + y - table[e & 0xff]) & 0xff];
      mem[out++] = mem[picture + b6 + b4 * 0xff];
    }
  }
}

/**
 * The part's state: the stack variables of 0x103808 that live across loops.
 * wobble [esp+0x110], tick [0x114], waveU [0x11c], waveV [0x120], rowPhase [0x124], dissolveStep [0x144],
 * texture [0x140], depth ebp. `sinceFade`: retraces since the last fade step (port only, RETRACES_PER_FADE).
 */
function createState(m) {
  return {
    wobble: 0,
    tick: 0,
    waveU: 0,
    waveV: 10,
    rowPhase: 0,
    dissolveStep: 0,
    texture: 0,
    depth: INITIAL_DEPTH,
    lastRetraces: m.u32(RETRACES),
    sinceFade: 0,
  };
}

/** 0x103c34: the grid's depth wave and shades. */
function waveFilm(m, state) {
  waveMesh(m, {
    start: state.wobble,
    columnStep: 4,
    rowStart: state.rowPhase + state.wobble,
    rowStep: 5,
    depth: state.depth,
    shadeOf: (dz) => Math.trunc(Math.imul(-dz, SHADE_SCALE) / 0x10000) + SHADE_BASE,
  });
}

/** 0x103edb: the horizontal wobble from the tick. */
function stepWobble(state) {
  state.tick &= 0xff;
  state.wobble = Math.trunc(Math.sin(state.tick * Math.PI * 0.0078125) * 112);
}

/** The retraces since the last call (0x103e0f). */
function retracesPassed(m, state) {
  const now = m.u32(RETRACES);
  const passed = now - state.lastRetraces;
  state.lastRetraces = now;
  return passed;
}

/** One frame's tunnel, into the back buffer. */
function renderTunnel(m, state) {
  const table = m.u32(TUNNEL_TABLE);
  projectMesh(m, 0);
  fillTunnelWaves(m, table, state.waveU, state.waveV);
  drawTunnel(m, m.u32(BACK_BUFFER), table);
  if (m.u32(ROW) > DISSOLVE_RESTART_ROW) {
    state.dissolveStep = 0;
  }
}

/**
 * The film's frame for the song's position (0x103ba6, 0x1040db): at the first position + k, frame k, dissolved
 * into frame k + 1 when k is in `dissolves`; at the first position itself (first loop only) frame 1 as it is.
 */
function selectFrame(m, state, firstPosition, dissolves, isFirstShown) {
  const film = m.u32(FILM);
  const k = m.u32(POSITION) - firstPosition;
  if (k === 0 && isFirstShown) {
    state.texture = film + PICTURE_BYTES;
  } else if (dissolves.includes(k)) {
    state.texture = film + k * PICTURE_BYTES;
    dissolve(m, state.texture, film + (k + 1) * PICTURE_BYTES, m.u32(MASK), state.dissolveStep);
  }
}

/** @param {Machine} m */
export function* mickeyFilm(m, lastPosition) {
  m.set32(PLASMA_ANGLE, 0);
  m.set32(PLASMA_PHASE, 0);
  clearScreen(m);
  m.mem.fill(0, m.u32(BACK_BUFFER), m.u32(BACK_BUFFER) + SCREEN_PIXELS);
  setPalette(m, FILM_PALETTE);
  buildMesh(m);
  scaleMesh(m, MESH_SCALE);
  const state = createState(m);
  m.readPlayStatus();
  const table = m.u32(TUNNEL_TABLE);
  const film = m.u32(FILM);
  m.mem.copyWithin(table + TUNNEL_TEXTURE, film, film + PICTURE_BYTES);
  fillSineTables(m, 170);
  m.readPlayStatus();
  const first = m.u32(POSITION);
  // 0x103a04: a copy of film frame 1, until the song moves on
  state.texture = m.malloc(PICTURE_BYTES);
  m.mem.copyWithin(state.texture, film + PICTURE_BYTES, film + 2 * PICTURE_BYTES);
  const back = m.u32(BACK_BUFFER);

  // 0x103a6a: the grid flies away
  do {
    renderTunnel(m, state);
    selectFrame(m, state, first, [1, 2], true);
    waveFilm(m, state);
    drawMesh(m, SHADED_106D1A, back, state.texture);
    yield* waitRetrace(m);
    if (m.u32(POSITION) === first && m.u32(ROW) < FADE_ROWS) {
      setPalette(m, FADE_PALETTE);
    }
    copyToScreen(m, back);
    m.readPlayStatus();
    const passed = retracesPassed(m, state);
    const songRow = (m.u32(POSITION) << 8) + m.u32(ROW);
    for (let i = 1; i <= passed; i++) {
      state.tick++;
      state.waveU += 2;
      state.waveV += 3;
      state.rowPhase++;
      state.dissolveStep++;
      if (songRow >= (first << 8) + MOVE_ROW && state.depth < FAR_DEPTH) {
        state.depth += 2;
      }
    }
    stepWobble(state);
    state.sinceFade += passed;
    if (m.u32(POSITION) === first && state.sinceFade >= RETRACES_PER_FADE) {
      state.sinceFade -= RETRACES_PER_FADE;
      fadeIn(m, Math.trunc(state.dissolveStep / 3));
    }
  } while (first + 2 >= m.u32(POSITION));

  // 0x103f9f: the grid comes back
  do {
    renderTunnel(m, state);
    selectFrame(m, state, first, [2, 3], false);
    drawMesh(m, SHADED_106D1A, back, state.texture);
    yield* waitRetrace(m);
    copyToScreen(m, back);
    waveFilm(m, state);
    m.readPlayStatus();
    const passed = retracesPassed(m, state);
    const songRow = (m.u32(POSITION) << 8) + m.u32(ROW);
    for (let i = 1; i <= passed; i++) {
      state.tick++;
      state.dissolveStep++;
      state.waveU += 2;
      state.waveV += 3;
      state.rowPhase++;
      if (songRow >= (first << 8) + MOVE_ROW && state.depth > NEAR_DEPTH) {
        state.depth -= 3;
      }
    }
    stepWobble(state);
  } while (first + 4 > m.u32(POSITION));

  // 0x104428: the plasma, the grid rising
  const table30 = plasmaTable();
  /** [esp+0x12c]: not set before the first plasma frame (stack garbage in the original). */
  let plasmaWobble = 0;
  let rise = 0;
  do {
    projectMesh(m, rise);
    drawPlasma(m, back, film, table30, plasmaWobble);
    drawMesh(m, SHADED_106D1A, back, state.texture);
    yield* waitRetrace(m);
    copyToScreen(m, back);
    waveFilm(m, state);
    m.readPlayStatus();
    const passed = retracesPassed(m, state);
    for (let i = 1; i <= passed; i++) {
      state.tick++;
      state.waveU += 2;
      m.set32(PLASMA_ANGLE, m.s32(PLASMA_ANGLE) + 1);
      m.set32(PLASMA_PHASE, m.s32(PLASMA_PHASE) + 1);
      state.waveV += 3;
      state.rowPhase++;
      rise--;
    }
    stepWobble(state);
    m.set32(PLASMA_ANGLE, m.s32(PLASMA_ANGLE) % 360);
    plasmaWobble = Math.trunc(Math.cos((m.s32(PLASMA_ANGLE) * Math.PI) / 180) * 128 + 128);
  } while (lastPosition > m.u32(POSITION));

  // 0x10489c: every colour white
  yield* waitRetrace(m);
  m.vga.out8(0x3c8, 0);
  for (let i = 0; i < 0x300; i++) {
    m.vga.out8(0x3c9, 0x3f);
  }
  return false;
}

