// The morphing line figures (Peci): 0d2e:0010 and its code overlay 'mutamcde' (called with a function number in ah).
// docs/disassembly/G3_plasma_morph_chess.md, section 3. The overlay's behaviour is ported, not interpreted; its
// variables and tables stay in the overlay's memory block.
//
// An 11x11 grid of points (x, y fixed, z morphing between height fields) is rotated about three axes, projected and
// drawn as lines into one plane of the back page (planes change every other frame; the colour select register, also
// every other frame, makes the newest plane white and the 3 older ones grey: a motion trail). Pages at 4000h and
// 8000h are flipped every frame. 16-colour mode 0299:01cc, set by the main script.
//
// Outside the black box the recording shows the plasma 0cf9's picture as bitplanes: DOSBox draws 16-colour modes
// from a copy of video memory that 256-colour writes (the cyclic plasma, the main script's clear) never update
// (vga.js, egaView). On a real VGA it would be black.
import { linear, waitTick } from '../machine.js';
import { setP54S } from '../library.js';
import { drawLine } from './morphingLinesDraw.js';

const CALLER = linear(0x0d2e, 0);
const OVERLAY_POINTER = CALLER + 0x04;
const ELAPSED = CALLER + 0x0e;
const DURATION = 0x4b0;

// ---- the overlay's variables and tables (offsets in the overlay) ----
const PALETTE = 0x1be2;
const PALETTE_COLOURS = 0x40;
const MAP_MASK = 0x1cd4;
const READ_MAP = 0x1cd5;
const PLANE_TOGGLE = 0x1cd6;
const COLOUR_SELECT = 0x1ce7;
const COLOUR_SELECT_DELAY = 0x1ce8;
const SHOWN_PAGE = 0x1a68;
const FRAME_COUNT = 0x1ff2;
/** The immediate of `sub cx, 800h` at 1f56: the viewer distance. */
const DISTANCE = 0x1f58;
const MORPH_STEPS_LEFT = 0x128a;
const HOLD_LEFT = 0x128c;
const SOURCE_FIELD = 0x128e;
const ANGLE_FLAG = 0x1290;
const ANGLE_1 = 0x1292;
const ANGLE_2 = 0x1294;
const ANGLE_3 = 0x1296;
const SCREEN_POINTS = 0x1298;
const SINE = 0x24;
const COSINE = 0x124;
const GRID_X = 0x824;
const GRID_Y = 0x916;
const GRID_Z = 0xa08;
const FIELD_BYTES = 0xf2;
const FIRST_FIELD = 0xafa;
const FIELD_END = 0x1198;
const POINTS = 0x79;
const GRID_SIDE = 11;
const MORPH_STEPS = 0x32;
const HOLD_STEPS = 0x64;
const ANGLE_MASK = 0x3fe;
const ZOOM_IN_FRAMES = 0x70;
const ZOOM_OUT_FROM = 0x3e8;
const DISTANCE_STEP = 0x10;
const PROJECTION_SCALE = 0x100;
const CENTRE_X = 0xa0;
const CENTRE_Y = 0x64;

const PAGE_A = 0x4000;
const PAGE_B = 0x8000;
const BOX_START = 0x261;
const BOX_ROWS = 0xad;
const BOX_BYTES = 22;
const ROW_BYTES = 40;

const SEQUENCER_INDEX = 0x3c4;
const GRAPHICS_INDEX = 0x3ce;
const CRTC_INDEX = 0x3d4;
const ATTRIBUTE_PORT = 0x3c0;
const INPUT_STATUS = 0x3da;
const COLOUR_SELECT_INDEX = 0x34;
const WORD = 0xffff;

const signed16 = (v) => ((v & WORD) << 16) >> 16;

/**
 * @typedef {object} OverlayState
 * @property {number} base linear address of the overlay
 * @property {number} page the es register: the page drawn next (video memory offset)
 */

/** (a * b) >> 15 as 1e4d does it: imul, then rcl ah / rcl dx takes product bits 15..30. */
function fixedMultiply(a, b) {
  return signed16(Math.imul(signed16(a), signed16(b)) >> 15);
}

/** AH=0 (1fd7): DAC 0..63, P54S on, es = a400h. */
function overlayInit(m, state) {
  m.vga.dacLoad(0, m.mem, state.base + PALETTE, PALETTE_COLOURS * 3);
  setP54S(m.vga);
  state.page = PAGE_A;
}

/** AH=1 (1d2b): colour select, changed every second call. */
function overlayShow(m, state) {
  const mem = m.mem;
  const base = state.base;
  mem[base + COLOUR_SELECT_DELAY] = (mem[base + COLOUR_SELECT_DELAY] - 1) & 0xff;
  if (mem[base + COLOUR_SELECT_DELAY] === 0) {
    mem[base + COLOUR_SELECT] = (mem[base + COLOUR_SELECT] + 1) & 3;
    mem[base + COLOUR_SELECT_DELAY] = 2;
  }
  m.vga.out8(ATTRIBUTE_PORT, COLOUR_SELECT_INDEX);
  m.vga.out8(ATTRIBUTE_PORT, mem[base + COLOUR_SELECT]);
}

/**
 * The retrace IRQ 0731:007a polls 3dah, which resets the attribute controller's flip-flop to "index"; 1cb6 relies
 * on it (after 1cc0 the flip-flop expects data). machine.js does not model that read, so it is done here, where the
 * IRQ has run: right after the wait.
 */
function readInputStatusLikeTheTimerIrq(m) {
  m.vga.in8(INPUT_STATUS);
}

/** 1ce9: every second call, the next plane for drawing (map mask) and reading (read map). */
function selectPlane(m, base) {
  const mem = m.mem;
  mem[base + PLANE_TOGGLE] ^= 0xff;
  if (mem[base + PLANE_TOGGLE] === 0) {
    return;
  }
  m.vga.out16(SEQUENCER_INDEX, (mem[base + MAP_MASK] << 8) | 2);
  m.vga.out16(GRAPHICS_INDEX, (mem[base + READ_MAP] << 8) | 4);
  mem[base + MAP_MASK] = (mem[base + MAP_MASK] << 1) & 0xff;
  mem[base + READ_MAP] = (mem[base + READ_MAP] + 1) & 0xff;
  if (mem[base + MAP_MASK] >= 0x10) {
    mem[base + MAP_MASK] = 1;
    mem[base + READ_MAP] = 0;
  }
}

/** 1d8a: 50 steps of interpolation from one height field to the next, then 100 steps of hold. */
function morph(m, base) {
  const stepsLeft = m.u16(base + MORPH_STEPS_LEFT);
  if (stepsLeft !== 0) {
    m.set16(base + MORPH_STEPS_LEFT, stepsLeft - 1);
    const t = MORPH_STEPS - (stepsLeft - 1);
    const source = base + m.u16(base + SOURCE_FIELD);
    for (let i = 0; i < POINTS; i++) {
      const from = m.s16(source + 2 * i);
      const delta = signed16(m.s16(source + FIELD_BYTES + 2 * i) - from);
      const z = from + Math.trunc((delta * t) / MORPH_STEPS);
      m.set16(base + GRID_Z + 2 * i, z & WORD);
    }
    return;
  }
  const hold = (m.u16(base + HOLD_LEFT) - 1) & WORD;
  m.set16(base + HOLD_LEFT, hold);
  if (hold !== 0) {
    return;
  }
  m.set16(base + HOLD_LEFT, HOLD_STEPS);
  m.set16(base + MORPH_STEPS_LEFT, MORPH_STEPS);
  let field = m.u16(base + SOURCE_FIELD) + FIELD_BYTES;
  if (field === FIELD_END) {
    field = FIRST_FIELD;
  }
  m.set16(base + SOURCE_FIELD, field);
}

/** 1df7: turns the angles, rotates the 121 points about three axes and projects them to (sx, sy) at 1298. */
function rotateAndProject(m, base) {
  m.set16(base + ANGLE_3, m.u16(base + ANGLE_3) - 2);
  m.set16(base + ANGLE_1, m.u16(base + ANGLE_1) - 4);
  m.set16(base + ANGLE_2, m.u16(base + ANGLE_2) + 4);
  if (m.u16(base + ANGLE_2) > ANGLE_MASK) {
    m.set16(base + ANGLE_FLAG, m.u16(base + ANGLE_FLAG) ^ WORD);
  }
  for (const angle of [ANGLE_1, ANGLE_2, ANGLE_3]) {
    m.set16(base + angle, m.u16(base + angle) & ANGLE_MASK);
  }
  const sin = (angle) => m.s16(base + SINE + m.u16(base + angle));
  const cos = (angle) => m.s16(base + COSINE + m.u16(base + angle));
  const sin1 = sin(ANGLE_1);
  const cos1 = cos(ANGLE_1);
  const sin2 = sin(ANGLE_2);
  const cos2 = cos(ANGLE_2);
  const sin3 = sin(ANGLE_3);
  const cos3 = cos(ANGLE_3);
  const distance = m.u16(base + DISTANCE);
  for (let i = 0; i < POINTS; i++) {
    const x = m.s16(base + GRID_X + 2 * i);
    const y = m.s16(base + GRID_Y + 2 * i);
    const z = m.s16(base + GRID_Z + 2 * i);
    const y1 = signed16(fixedMultiply(y, cos1) - fixedMultiply(z, sin1));
    const z1 = signed16(fixedMultiply(y, sin1) + fixedMultiply(z, cos1));
    const x2 = signed16(fixedMultiply(x, cos2) - fixedMultiply(z1, sin2));
    const z2 = signed16(fixedMultiply(x, sin2) + fixedMultiply(z1, cos2));
    const x3 = signed16(fixedMultiply(x2, cos3) - fixedMultiply(y1, sin3));
    const y3 = signed16(fixedMultiply(x2, sin3) + fixedMultiply(y1, cos3));
    const divisor = signed16(z2 - distance);
    const sx = Math.trunc((x3 * PROJECTION_SCALE) / divisor) + CENTRE_X;
    const sy = Math.trunc((y3 * PROJECTION_SCALE) / divisor) + CENTRE_Y;
    m.set16(base + SCREEN_POINTS + 4 * i, sx & WORD);
    m.set16(base + SCREEN_POINTS + 4 * i + 2, sy & WORD);
  }
}

/** 1f89: the grid: 11 rows of 10 segments, then 10 rows of 11 segments down. */
function drawGrid(m, state) {
  const plotter = { vga: m.vga, mem: m.mem, overlay: state.base, page: state.page };
  const point = (i) => [m.u16(state.base + SCREEN_POINTS + 4 * i), m.u16(state.base + SCREEN_POINTS + 4 * i + 2)];
  for (let row = 0; row < GRID_SIDE; row++) {
    for (let column = 0; column < GRID_SIDE - 1; column++) {
      const [x1, y1] = point(row * GRID_SIDE + column);
      const [x2, y2] = point(row * GRID_SIDE + column + 1);
      drawLine(plotter, x1, y1, x2, y2);
    }
  }
  for (let row = 0; row < GRID_SIDE - 1; row++) {
    for (let column = 0; column < GRID_SIDE; column++) {
      const [x1, y1] = point(row * GRID_SIDE + column);
      const [x2, y2] = point((row + 1) * GRID_SIDE + column);
      drawLine(plotter, x1, y1, x2, y2);
    }
  }
}

/** 1d52: shows the page just drawn; the other one is drawn next. */
function flipPages(m, state) {
  const base = state.base;
  let shown;
  if (m.u16(base + SHOWN_PAGE) === PAGE_B) {
    state.page = PAGE_B;
    shown = PAGE_A;
  } else {
    state.page = PAGE_A;
    shown = PAGE_B;
  }
  m.set16(base + SHOWN_PAGE, shown);
  m.vga.out16(CRTC_INDEX, (shown & 0xff00) | 0x0c);
  m.vga.out16(CRTC_INDEX, ((shown & 0xff) << 8) | 0x0d);
}

/** AH=2 (1ff4): plane, `frames` animation steps, clear the box, draw, flip. */
function overlayFrame(m, state, frames) {
  const base = state.base;
  selectPlane(m, base);
  for (let i = 0; i < frames; i++) {
    const count = (m.u16(base + FRAME_COUNT) + 1) & WORD;
    m.set16(base + FRAME_COUNT, count);
    if (count <= ZOOM_IN_FRAMES) {
      m.set16(base + DISTANCE, m.u16(base + DISTANCE) - DISTANCE_STEP);
    }
    if (count >= ZOOM_OUT_FROM) {
      m.set16(base + DISTANCE, m.u16(base + DISTANCE) + DISTANCE_STEP);
    }
    morph(m, base);
    rotateAndProject(m, base);
  }
  for (let row = 0; row < BOX_ROWS; row++) {
    for (let k = 0; k < BOX_BYTES; k++) {
      m.vga.write((state.page + BOX_START + row * ROW_BYTES + k) & WORD, 0);
    }
  }
  drawGrid(m, state);
  flipPages(m, state);
}

/** 0d2e:0010. */
export function* morphingLines(m) {
  const state = { base: linear(m.u16(OVERLAY_POINTER), 0), page: 0 };
  overlayInit(m, state);
  yield* waitTick(m);
  overlayInit(m, state);
  let remaining = DURATION;
  do {
    overlayFrame(m, state, m.u16(ELAPSED));
    yield* waitTick(m);
    readInputStatusLikeTheTimerIrq(m);
    m.set16(ELAPSED, m.frameCounter); // 08d8:157e
    overlayShow(m, state);
    remaining = signed16(remaining - m.u16(ELAPSED));
  } while (remaining > 0);
}
