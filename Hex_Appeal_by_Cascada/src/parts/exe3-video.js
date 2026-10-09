// exe3's video routines: dots, page clears, the logo, the polygon filler and the palette fades
// (docs/disassembly/H3_ifs_morphs.md). The screen is 320x400 unchained: pixel (x, y) of a page is plane x & 3,
// byte page + y*80 + (x >> 2); page 0 is segment a000, page 1 segment a7d0 (offset 0x7d00).
/** @typedef {import('../machine.js').Machine} Machine */
/** @typedef {import('../vga.js').Vga} Vga */
import {
  PICTURE_DATA, PALETTE, LOGO_PICTURE, PLOT_X, PLOT_Y, PLOT_SEGMENT, PLOT_COLOUR, PAGE_FLAG, DOT_LIST_PAGE0,
  DOT_LIST_PAGE1, DOT_LIST_INDEX, POLYGON, ROW_STRIDE, LEFT_EDGES, RIGHT_EDGES, POLYGON_EDGES_LEFT, POLYGON_COLOUR,
  POLYGON_MIN_X, POLYGON_MAX_X, POLYGON_MIN_Y, POLYGON_MAX_Y, IS_EDGE_DOWN, LEFT_MASKS, RIGHT_MASKS, POLYGON_PAGE,
  FIRE_FADE, BLUES_FADE, FIRE_FADE_STEP, LOGO_FADE_STEPS, LOGO_FADE_DELAY, BLUES_FADE_STEP, LOGO_STATE, IS_IFS_ON,
  s16,
} from './exe3-memory.js';

const VGA_WINDOW = 0xa0000;
const VGA_WINDOW_SIZE = 0x10000;
export const PAGE0_SEGMENT = 0xa000;
export const PAGE1_SEGMENT = 0xa7d0;
export const PAGE1_OFFSET = 0x7d00;
const SEQUENCER_INDEX = 0x3c4;
const SEQUENCER_DATA = 0x3c5;
const GRAPHICS_INDEX = 0x3ce;
const DAC_WRITE_INDEX = 0x3c8;
const DAC_DATA = 0x3c9;
const MAP_MASK_ALL_PLANES = 0x0f02;
const PAGE_WORDS = 0x3e80;
const SCREEN_WIDTH = 320;
const SCREEN_HEIGHT = 400;
const MAX_EDGE_ROWS = 400;

/**
 * A CPU byte write at segment:offset; only the a000..afff window reaches the VGA (graphics memory map 1).
 * @param {Vga} vga
 */
function writeVideo(vga, segment, offset, value) {
  const window = segment * 16 + (offset & 0xffff) - VGA_WINDOW;
  if (window < 0 || window >= VGA_WINDOW_SIZE) {
    return;
  }
  vga.write(window, value);
}

/** 0000:1068 plot: a dot at ([f2e], [f30]) on segment [f32] in the colour at cs:1093. Returns di. */
export function plot(m) {
  const x = m.u16(PLOT_X);
  const y = m.u16(PLOT_Y);
  const di = ((x >>> 2) + ((y << 4) & 0xffff) + ((y << 6) & 0xffff)) & 0xffff;
  m.vga.out16(SEQUENCER_INDEX, 0x02 | ((1 << (x & 3)) << 8));
  writeVideo(m.vga, m.u16(PLOT_SEGMENT), di, m.u8(PLOT_COLOUR));
  return di;
}

/** The tail of every dot loop: di goes to this page's dot list (A for page 0, B for page 1). */
export function rememberDot(m, di) {
  const index = m.u16(DOT_LIST_INDEX);
  const list = m.u8(PAGE_FLAG) === 1 ? DOT_LIST_PAGE1 : DOT_LIST_PAGE0;
  m.set16(list + index, di);
  m.set16(DOT_LIST_INDEX, (index + 2) & 0xffff);
}

/** 0000:0deb / 0e11 / 0e37 / 0e5d / 0e83 / 0ea9 erase_dots: clears the 4-pixel group of each listed dot. */
export function eraseDots(m, isPage1, count) {
  const list = isPage1 ? DOT_LIST_PAGE1 : DOT_LIST_PAGE0;
  const segment = isPage1 ? PAGE1_SEGMENT : PAGE0_SEGMENT;
  m.vga.out16(SEQUENCER_INDEX, MAP_MASK_ALL_PLANES);
  for (let i = 0; i < count; i++) {
    writeVideo(m.vga, segment, m.u16(list + i * 2), 0);
  }
}

/** 0000:10c5 clear_page0 / 10dd clear_page1: 0x3e80 words of 0 in all four planes. */
export function clearPage(m, segment) {
  m.vga.out16(SEQUENCER_INDEX, MAP_MASK_ALL_PLANES);
  for (let di = 0; di < PAGE_WORDS * 2; di++) {
    writeVideo(m.vga, segment, di, 0);
  }
}

/** 0000:1206 draw_logo: the 320-wide linear picture at 083c:031b into both pages, plane by plane. */
export function drawLogo(m) {
  const LOGO_START = 8;
  const LOGO_END = 0x21c0;
  for (const segment of [PAGE0_SEGMENT, PAGE1_SEGMENT]) {
    for (let plane = 0; plane < 4; plane++) {
      m.vga.out16(SEQUENCER_INDEX, 0x02 | ((1 << plane) << 8));
      let si = LOGO_PICTURE + plane;
      for (let di = LOGO_START; di < LOGO_END; di++) {
        writeVideo(m.vga, segment, di, m.mem[si]);
        si += 4;
      }
    }
  }
}

// ---- fill_polygon 0000:1335 ----

function clampX(v) {
  if (v < 0) {
    return 0;
  }
  return v >= SCREEN_WIDTH ? SCREEN_WIDTH - 1 : v;
}

function clampY(v) {
  if (v < 0) {
    return 0;
  }
  return v >= SCREEN_HEIGHT ? SCREEN_HEIGHT - 1 : v;
}

/** 1383..1c3e: one edge into the LEFT (going up) or RIGHT (going down) table, 16.16 steps from the smaller x. */
function walkEdge(m, xa, ya, xb, yb) {
  if (ya === yb) {
    if (xa > xb) {
      [xa, xb] = [xb, xa];
    }
    m.set16(LEFT_EDGES + ya * 2, xa);
    m.set16(RIGHT_EDGES + ya * 2, xb);
    return;
  }
  let table = RIGHT_EDGES;
  m.set16(IS_EDGE_DOWN, 1);
  if (ya > yb) {
    table = LEFT_EDGES;
    m.set16(IS_EDGE_DOWN, 0);
  }
  if (xa > xb) {
    [xa, xb] = [xb, xa];
    [ya, yb] = [yb, ya];
  }
  let di = table + ya * 2;
  let rows = (yb - ya) & 0xffff;
  let direction = 2;
  if (rows & 0x8000) {
    rows = -s16(rows);
    direction = -2;
  }
  rows += 1;
  const length = ((xb - xa) & 0xffff) + 1;
  const step = Math.floor(length / rows);
  const fraction = Math.floor(((length % rows) * 0x10000) / rows);
  let x = xa;
  let partial = 0;
  if (m.u16(IS_EDGE_DOWN) & 1) {
    partial += fraction;
    x = (x + step + (partial >>> 16)) & 0xffff;
    partial &= 0xffff;
  }
  // The unrolled stepper is entered at 0x146e + 5 * (400 - rows): `rows` stores.
  const stores = Math.min(rows, MAX_EDGE_ROWS);
  for (let k = 0; k < stores; k++) {
    m.set16(di, x);
    di += direction;
    partial += fraction;
    x = (x + step + (partial >>> 16)) & 0xffff;
    partial &= 0xffff;
  }
}

/** 1c51..83c5: the spans of rows [1bcc]..[1bce], right end exclusive, on page offset [f34]. */
function fillSpans(m) {
  const vga = m.vga;
  const colour = m.u8(POLYGON_COLOUR);
  const firstRow = m.u16(POLYGON_MIN_Y);
  const rows = ((m.u16(POLYGON_MAX_Y) - firstRow) & 0xffff) + 1;
  vga.out16(GRAPHICS_INDEX, 0xff08);
  vga.out16(GRAPHICS_INDEX, 0x4005);
  vga.out8(SEQUENCER_INDEX, 2);
  let rowAddress = (firstRow * 80 + m.u16(POLYGON_PAGE)) & 0xffff;
  const stride = m.u16(ROW_STRIDE);
  for (let y = firstRow; y < firstRow + Math.min(rows, MAX_EDGE_ROWS); y++) {
    const left = m.u16(LEFT_EDGES + y * 2);
    const right = m.u16(RIGHT_EDGES + y * 2);
    let mask = m.mem[LEFT_MASKS + left];
    let di = left >>> 2;
    const lastByte = right >>> 2;
    if (di >= lastByte) {
      vga.out8(SEQUENCER_DATA, mask & m.mem[RIGHT_MASKS + right]);
      writeVideo(vga, PAGE0_SEGMENT, di + rowAddress, colour);
    } else {
      const middle = lastByte - di - 1;
      di = (di + rowAddress) & 0xffff;
      vga.out8(SEQUENCER_DATA, mask);
      writeVideo(vga, PAGE0_SEGMENT, di, colour);
      di++;
      vga.out8(SEQUENCER_DATA, 0x0f);
      for (let i = 0; i < middle; i++) {
        writeVideo(vga, PAGE0_SEGMENT, di, colour);
        di++;
      }
      mask = m.mem[RIGHT_MASKS + right];
      vga.out8(SEQUENCER_DATA, mask);
      writeVideo(vga, PAGE0_SEGMENT, di, colour);
    }
    rowAddress = (rowAddress + stride) & 0xffff;
  }
}

/** 0000:1335 fill_polygon: the polygon at [1184] (byte count, byte colour, int16 points), clamped to the screen. */
export function fillPolygon(m) {
  m.set16(POLYGON_EDGES_LEFT, m.u16(POLYGON));
  m.set8(POLYGON_EDGES_LEFT, (m.u8(POLYGON_EDGES_LEFT) - 1) & 0xff);
  const firstPoint = POLYGON + 2;
  const x0 = clampX(m.s16(firstPoint));
  const y0 = clampY(m.s16(firstPoint + 2));
  m.set16(POLYGON_MIN_X, x0);
  m.set16(POLYGON_MAX_X, x0);
  m.set16(POLYGON_MIN_Y, y0);
  m.set16(POLYGON_MAX_Y, y0);
  let current = firstPoint;
  let next = firstPoint + 4;
  for (;;) {
    const xa = clampX(m.s16(current));
    const ya = clampY(m.s16(current + 2));
    const xb = clampX(m.s16(next));
    const yb = clampY(m.s16(next + 2));
    if (m.u16(POLYGON_MIN_Y) > yb) {
      m.set16(POLYGON_MIN_Y, yb);
    }
    if (m.u16(POLYGON_MAX_Y) < yb) {
      m.set16(POLYGON_MAX_Y, yb);
    }
    if (m.u16(POLYGON_MIN_X) > xb) {
      m.set16(POLYGON_MIN_X, xb);
    }
    if (m.u16(POLYGON_MAX_X) < xb) {
      m.set16(POLYGON_MAX_X, xb);
    }
    walkEdge(m, xa, ya, xb, yb);
    current = next;
    next += 4;
    const left = (m.u8(POLYGON_EDGES_LEFT) - 1) & 0xff;
    m.set8(POLYGON_EDGES_LEFT, left);
    if (left === 0) {
      next = firstPoint;
    }
    if (left & 0x80) {
      break;
    }
  }
  fillSpans(m);
}

// ---- palette ----

/** 0000:10f5 set_palette: DAC 0.. from 083c:0007, 0x2ff bytes (colour 255's blue is not written). */
export function setPalette(m) {
  m.vga.dacLoad(0, m.mem, PALETTE, 0x2ff);
}

/** The fade-in scheme of 1110 / 1169: output the buffer, then step each byte +1 toward its target. */
function fadeTowardTarget(m, firstColour, buffer, target, count) {
  m.vga.dacLoad(firstColour, m.mem, buffer, count);
  for (let i = 0; i < count; i++) {
    const next = (m.mem[buffer + i] + 1) & 0xff;
    if (next <= m.mem[target + i]) {
      m.mem[buffer + i] = next;
    }
  }
}

/** 0000:1110 fade_in_fire: DAC 0x21..0x36 up from black; the 56th call starts the IFS phase instead. */
export function fadeInFire(m) {
  const FIRE_STEPS_END = 0x38;
  const step = (m.u8(FIRE_FADE_STEP) + 1) & 0xff;
  m.set8(FIRE_FADE_STEP, step);
  if (step === FIRE_STEPS_END) {
    m.set8(FIRE_FADE_STEP, step - 1);
    m.set8(LOGO_STATE, 2);
    m.set8(IS_IFS_ON, 1);
    return;
  }
  fadeTowardTarget(m, 0x21, FIRE_FADE, PICTURE_DATA + 0x6a, 0x42);
}

/** 0000:1169 fade_in_blues: DAC 0x40..0x5f toward palette colours 0x3f.. (one colour lower), 163 steps. */
export function fadeInBlues(m) {
  const BLUES_STEPS_END = 0xa4;
  const step = (m.u8(BLUES_FADE_STEP) + 1) & 0xff;
  m.set8(BLUES_FADE_STEP, step);
  if (step === BLUES_STEPS_END) {
    m.set8(BLUES_FADE_STEP, step - 1);
    return;
  }
  fadeTowardTarget(m, 0x40, BLUES_FADE, PICTURE_DATA + 0xc4, 0x60);
}

/** 0000:11b8 fade_out_logo (from the callback): every 3rd call, colours 0..55 of the palette data step down. */
export function fadeOutLogo(m) {
  const DELAY = 3;
  const MAX_STEPS = 0xfa;
  const LOGO_PALETTE_BYTES = 0xa8;
  const delay = (m.u8(LOGO_FADE_DELAY) + 1) & 0xff;
  m.set8(LOGO_FADE_DELAY, delay);
  if (delay !== DELAY) {
    return;
  }
  m.set8(LOGO_FADE_DELAY, delay - DELAY);
  if (m.u8(LOGO_FADE_STEPS) === MAX_STEPS) {
    return;
  }
  m.set8(LOGO_FADE_STEPS, m.u8(LOGO_FADE_STEPS) + 1);
  for (let i = 0; i < LOGO_PALETTE_BYTES; i++) {
    if (m.mem[PALETTE + i] !== 0) {
      m.mem[PALETTE + i] -= 1;
    }
  }
  m.vga.dacLoad(0, m.mem, PALETTE, LOGO_PALETTE_BYTES);
}
