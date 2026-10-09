// The Picture-of-Motorcycle (J.O.E) and the "Surprise!" pattern behind the next effects, 08d8:396c and 08d8:3041
// with 2ecd/2e92/2ea9 (docs/disassembly/G6_greets_tunnel_city.md, sections 3.1 and 3.5). While the motorcycle
// (resource bg2, planes 1..3 of page 7) is on screen, the vector engine renders 16 frames of a tilted plane of
// "Surprise!" logos into planes 0 and 1 of the eight pages.
import { waitTick } from '../machine.js';
import { setDacBlack, setEgaPlanar, setDac, setP54S, fadePalette } from '../library.js';
import * as engine from '../engine3d.js';
import { SEGMENT_08D8, PALETTE_BLACK, PALETTE_WORK, PAGE_BYTES } from './surprisePages.js';

/** 08d8 resource names and pointers (396c). */
const CITYDATA_NAME = SEGMENT_08D8 + 0x36e7;
export const CITYDATA = SEGMENT_08D8 + 0x36ef;
const CITYDAT2_NAME = SEGMENT_08D8 + 0x36f1;
export const CITYDAT2 = SEGMENT_08D8 + 0x36f9;
const CITYDAT3_NAME = SEGMENT_08D8 + 0x36fb;
export const CITYDAT3 = SEGMENT_08D8 + 0x3703;
const BG2_NAME = SEGMENT_08D8 + 0x3705;
const BG2 = SEGMENT_08D8 + 0x370d;
/** 08d8:370f: 150 words, row * 40 (the contour plot's row table). */
export const ROW_TABLE = SEGMENT_08D8 + 0x370f;
const ROW_TABLE_ROWS = 0x96;
const ROW_BYTES = 0x28;

/** 08d8:3438: the motorcycle's 16 colours (pairs: plane 0 does not show). */
const PALETTE_MOTORCYCLE = SEGMENT_08D8 + 0x3438;
/** 08d8:2ea5 word: the map mask (out 3c4) of the pattern fill; 2ea7 byte: patterns rendered. */
const PATTERN_MAP_MASK = SEGMENT_08D8 + 0x2ea5;
const PATTERN_COUNT = SEGMENT_08D8 + 0x2ea7;
/** The object: the "Surprise!" lettering, 100 vertices, one face (segment 03bf). */
const PATTERN_OBJECT_SEGMENT = 0x03bf;
const PATTERN_VERTICES = PATTERN_OBJECT_SEGMENT * 16 + 0x0c;
const PATTERN_VERTEX_COUNT = 0x64;
/** 08d8:2ed8..2fe9: 23 moves of the object, each followed by a render; then 2fec's move back. */
const PATTERN_MOVES = [[-900, 800], [900, 0], [900, 0], [200, -200], [-900, 0], [-900, 0], [200, -200], [900, 0],
  [900, 0], [200, -200], [-900, 0], [-900, 0], [-900, 0], [200, -200], [900, 0], [900, 0], [200, -200], [-900, 0],
  [-900, 0], [-900, 0], [200, -200], [900, 0], [900, 0]];
const PATTERN_MOVE_BACK = [-300, 400];
/** 08d8:301f: the diagonal scroll per rendered page, 12 or 13. */
const PATTERN_SCROLL = 0x0c;
const PAGE_SEGMENT_STEP = 0x01f4;
const PAGES_PER_PLANE = 8;
const PATTERN_PAGES_UNDER_MOTORCYCLE = 0x0f;

const PAGE_7 = 0xdac0;
const FADE_STEPS = 0x46;
const SCREEN_RIGHT = 0x13f;
const SCREEN_BOTTOM = 0xc7;
const SEQUENCER_INDEX = 0x3c4;
/**
 * Retraces renderPattern(15) takes on the reference machine (CPU bound) between the end of the fade-in and the
 * start of the fade-out: frames 20650..20678 of the recording (29; about 10 in the 200000-cycle capture).
 */
const PATTERN_RENDER_RETRACES = 27;
/** The same for the 16th render, renderPattern(1), after the fade-out: frames 20749..20750 are black. */
const LAST_PATTERN_RENDER_RETRACES = 1;

/** 008e:04b3 by name pointer. */
function load(m, nameAddress, pointerAddress) {
  m.loadResource(nameAddress, pointerAddress);
}

/** 08d8:396c: loads citydata, bg2, citydat2, citydat3 and builds the row table. */
export function loadCityResources(m) {
  load(m, CITYDATA_NAME, CITYDATA);
  load(m, BG2_NAME, BG2);
  load(m, CITYDAT2_NAME, CITYDAT2);
  load(m, CITYDAT3_NAME, CITYDAT3);
  for (let i = 0; i < ROW_TABLE_ROWS; i++) {
    m.set16(ROW_TABLE + i * 2, i * ROW_BYTES);
  }
}

/** 08d8:39b1: frees citydata, citydat2, citydat3; its 4th free (`mov si, 3705h` for di) frees [3703] again. */
export function freeCityResources(m) {
  m.freeFrom(CITYDATA);
  m.freeFrom(CITYDAT2);
  m.freeFrom(CITYDAT3);
  m.free(m.u16(CITYDAT3));
}

/** 08d8:2e92: moves the pattern object's 100 vertices by (dx, dy). */
function movePattern(m, dx, dy) {
  for (let i = 0; i < PATTERN_VERTEX_COUNT; i++) {
    const at = PATTERN_VERTICES + i * 6;
    m.set16(at, m.u16(at) + dx);
    m.set16(at + 2, m.u16(at + 2) + dy);
  }
}

/** 08d8:2ea9: the next page of the pattern; after 8, plane 1 from page 0 again. */
function nextPatternPage(m) {
  const count = (m.mem[PATTERN_COUNT] + 1) & 0xff;
  m.mem[PATTERN_COUNT] = count;
  const fillSegment = engine.ENGINE_SEGMENT_BASE + engine.ENGINE.FILL_SEGMENT;
  if (count === PAGES_PER_PLANE) {
    m.set16(PATTERN_MAP_MASK, 0x0202);
    m.set16(fillSegment, 0xa000);
    return;
  }
  m.set16(fillSegment, m.u16(fillSegment) + PAGE_SEGMENT_STEP);
}

/** 08d8:2ecd: `pages` renders of the pattern, each into the next page / plane, scrolled diagonally. */
function renderPattern(m, pages) {
  const base = engine.ENGINE_SEGMENT_BASE;
  for (let page = 0; page < pages; page++) {
    m.mem[base + engine.ENGINE.FILL_ENABLE] = 0;
    for (const [dx, dy] of PATTERN_MOVES) {
      movePattern(m, dx, dy);
      engine.drawObject(m, PATTERN_OBJECT_SEGMENT);
    }
    movePattern(m, PATTERN_MOVE_BACK[0], PATTERN_MOVE_BACK[1]);
    m.vga.out16(SEQUENCER_INDEX, m.u16(PATTERN_MAP_MASK));
    m.set16(base + engine.ENGINE.PLANE_MIN_X, 0);
    m.set16(base + engine.ENGINE.PLANE_MAX_X, SCREEN_RIGHT);
    m.set16(base + engine.ENGINE.PLANE_MIN_Y, 0);
    m.set16(base + engine.ENGINE.PLANE_MAX_Y, SCREEN_BOTTOM);
    engine.fill(m);
    nextPatternPage(m);
    const scroll = PATTERN_SCROLL + (m.mem[PATTERN_COUNT] & 1);
    movePattern(m, scroll, -scroll);
  }
}

/** 08d8:3041: the motorcycle fades in and out while the pattern pages are rendered. */
export function* motorcycle(m) {
  const vga = m.vga;
  const base = engine.ENGINE_SEGMENT_BASE;
  m.set16(base + engine.ENGINE.ANGLE_A95, 0);
  m.set16(base + engine.ENGINE.ANGLE_A97, 0x514);
  m.set16(base + engine.ENGINE.ANGLE_A99, 0x578);
  m.set16(base + engine.ENGINE.DISTANCE, 0x4b0);
  m.set16(base + engine.ENGINE.FILL_SEGMENT, 0xa000);
  setDacBlack(vga);
  setEgaPlanar(vga);
  vga.out16(SEQUENCER_INDEX, 0x0f02);
  for (let offset = 0; offset < 0xfa00; offset++) {
    vga.write(offset, 0);
  }
  yield* waitTick(m);
  setDac(m, 0, 0x10, PALETTE_BLACK);
  engine.setStartAddress(m, PAGE_7);
  let source = m.u16(BG2) * 16;
  for (let planeMask = 0x02; planeMask <= 0x08; planeMask <<= 1) {
    vga.out16(SEQUENCER_INDEX, (planeMask << 8) | 0x02);
    for (let i = 0; i < PAGE_BYTES; i++) {
      vga.write(PAGE_7 + i, m.mem[source++]);
    }
  }
  yield; // 0731:0158 waits for the retrace start
  m.setTimer('bios');
  yield* fadePalette(m, {
    colours: 0x10, from: PALETTE_BLACK, to: PALETTE_MOTORCYCLE, work: PALETTE_WORK, steps: FADE_STEPS, first: 0,
    isTickingMusic: true,
  });
  yield; // 0731:013c
  m.setTimer('retrace');
  m.set16(PATTERN_MAP_MASK, 0x0102);
  renderPattern(m, PATTERN_PAGES_UNDER_MOTORCYCLE);
  for (let i = 0; i < PATTERN_RENDER_RETRACES; i++) {
    yield;
  }
  setP54S(vga);
  yield; // 0731:0158
  m.setTimer('bios');
  yield* fadePalette(m, {
    colours: 0x10, from: PALETTE_MOTORCYCLE, to: PALETTE_BLACK, work: PALETTE_WORK, steps: FADE_STEPS, first: 0,
    isTickingMusic: true,
  });
  yield; // 0731:013c
  m.setTimer('retrace');
  engine.setStartAddress(m, 0);
  vga.out16(SEQUENCER_INDEX, 0x0e02);
  for (let i = 0; i < PAGE_BYTES; i++) {
    vga.write(PAGE_7 + i, 0);
  }
  renderPattern(m, 1);
  for (let i = 0; i < LAST_PATTERN_RENDER_RETRACES; i++) {
    yield;
  }
  m.mem[base + engine.ENGINE.FILL_ENABLE] = 1;
  m.set16(base + engine.ENGINE.FILL_SEGMENT, 0xa000);
}
