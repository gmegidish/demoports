// The frame-animated objects ("morphs") and the unchained 320x400 RGB-scanline output.
// Notes: C1 §8, C2_gfx.md (RLE, RGB delta video, plane writers, scrollers), C5 (0x28999, 0x28623).
//
// A MORPH item in DEMO.AVI / DEMO.FLI: dword frameCount; dword keyframeOffset; dword deltaOffset[frameCount]
// (offsets relative to the item). Every payload is nibble-RLE (0x1c34d). Frame 0 = keyframe - delta 0, frame n =
// frame n-1 - delta n, bytewise mod 256. Everything works on the flat memory, at the original addresses, so the
// RLE overshoots, the stale upscaler rows and the out-of-table reads behave as in the original.
import { drawText, TEXT_POINTER, TEXT_COLOUR_BASE } from './text.js';
import { workBuffer, backBuffer } from './helpers.js';

/** imm32 of the `cmp [0x1c349], imm` at 0x1c3dc: how many bytes 0x1c34d decodes (it may overshoot). */
export const RLE_LIMIT = 0x1c3e2;
const RLE_COUNT = 0x1c349;

/** 0x28623's parameters: rows of the 78-wide source (0x30, or 0x21 for the RGB objects), shift, added value. */
export const UPSCALE_ROWS = 0x2861f;
export const UPSCALE_SHIFT = 0x20602;
export const UPSCALE_ADD = 0x2060c;
const UPSCALE_WIDTH = 0x4e;
const SHIFTED_STRIDE = 0x50;
const SHIFTED_BUFFER = 0x246a8;
/** The horizontal pass starts one row and one column before the shifted copy. */
const SHIFTED_READ_START = 0x24657;
const HORIZONTAL_BUFFER = 0x20697;
/** 0x1c602: LERP4[a*256 + b*4 + k], built at start-up (0x286ce). */
export const LERP4 = 0x1c602;
const ROW = 320;
const UPSCALE_FILL_DWORDS = 0x640;
const UPSCALE_FILL = 0xc0;

/** The morph state: item of the single object (or the red one), requested / last decoded / next frame. */
export const MORPH_ITEM = 0x2897c;
export const MORPH_GREEN_ITEM = 0x1ad2d;
export const MORPH_BLUE_ITEM = 0x1ad31;
const FRAME_REQUESTED = 0x28980;
const FRAME_DECODED = 0x28985;
const FRAME_NEXT = 0x28989;
/** Pointers to the decoded frames (R, G, B; the single object uses the first) and the delta buffer. */
export const OBJECT_BUFFERS = [0x28b88, 0x28b8c, 0x28b90];
const DELTA_BUFFER = 0x28b94;
const RGB_FRAME_BYTES = 0xa0e;
const RGB_ROWS = 0x21;
const ANIMATION_FRAME_BYTES = 0xea0;

/** Mode-X output: page offset (0x7fd0 / 0x02d0), line of the R/G/B triplet, value added (palette ramp). */
const PAGE_OFFSET = 0x1ad24;
const PAGE_FLIP = 0x7d00;
const LINE_SELECT = 0x1ad28;
const PALETTE_ADD = 0x1ad2c;
const COMPONENT_ROWS = 0x84;
const BYTES_PER_LINE = 0x50;
/** After each 80-byte line, 0x1ad47 skips the other two lines of the triplet. */
const TRIPLET_SKIP = 0xa0;
const COMPONENT_LINE_SELECT = [0, 0x50, 0xa0];
const COMPONENT_PALETTE_ADD = [0, 0x40, 0x80];

/** Scroller text: string offset, plane offset of the text block, bytes per plane. */
export const SCROLLER_POSITION = 0x1bdd4;
export const TEXT_PLANE_OFFSET = 0x1bdd8;
const TEXT_PLANE_LENGTH = 0x1c0bd;
const SCROLLER_COLOUR_BASE = 0xc0;
const SCROLLER_STRINGS = 0x1bc04;
const ALONE_STRINGS = 0x1be09;
const SYSTEM_STRINGS = 0x1bec6;
const SYSTEM_TEXT_PLANE_OFFSET = 0x2bcf;

/** 0x1c34d: nibble-RLE from `source` to `destination` until [RLE_LIMIT] bytes (or a few more) are written. */
export function decodeRle(m, source, destination) {
  const mem = m.mem;
  const limit = m.u32(RLE_LIMIT);
  let s = source;
  let d = destination;
  let count = 0;
  do {
    const b = mem[s++];
    let value;
    let length;
    if (!(b & 0x80)) {
      length = ((b & 3) << 8 | mem[s++]) + 1;
      value = b & 0x40 ? ((b & 0x3c) >> 2) | 0xf0 : b >> 2;
    } else if (b & 0x40) {
      value = (b & 0x20) >> 5;
      length = (b & 0x1f) + 1;
    } else {
      value = (b & 0x3c) >> 2;
      length = (b & 3) + 1;
    }
    mem.fill(value, d, d + length);
    d += length;
    count += length;
  } while (count < limit);
  m.set32(RLE_COUNT, count);
  return { source: s, destination: d };
}

/** frame[i] -= delta[i] for `count` bytes, mod 256. */
function subtractDelta(m, frame, count) {
  const mem = m.mem;
  const delta = m.u32(DELTA_BUFFER);
  for (let i = 0; i < count; i++) {
    mem[frame + i] = (mem[frame + i] - mem[delta + i]) & 0xff;
  }
}

function decodeKeyframe(m, item, buffer) {
  decodeRle(m, item + m.u32(item + 4), buffer);
}

function decodeDelta(m, item, frame) {
  decodeRle(m, (item + m.u32((item + 8 + 4 * frame) >>> 0)) >>> 0, m.u32(DELTA_BUFFER));
}

/** One 4-byte entry of the LERP4 table, read from flat memory (indices past the table read what follows). */
function lerpIndex(a, b) {
  return LERP4 + a * 256 + b * 4;
}

/**
 * 0x28623: the 78 x [UPSCALE_ROWS] source (each byte << [UPSCALE_SHIFT]) to 320 x 4*rows into W, bilinear
 * through LERP4, plus [UPSCALE_ADD]; then 20 rows of 0xc0. The intermediate buffers are in memory: rows the
 * call does not rewrite (row `rows` of the horizontal buffer) keep what an earlier, taller call left there.
 */
export function upscale4x(m, source) {
  const mem = m.mem;
  const rows = m.u32(UPSCALE_ROWS);
  const shift = mem[UPSCALE_SHIFT] & 31;
  let s = source;
  for (let r = 0; r < rows; r++) {
    const line = SHIFTED_BUFFER + r * SHIFTED_STRIDE;
    for (let c = 0; c < UPSCALE_WIDTH; c++) {
      mem[line + c] = (mem[s++] << shift) & 0xff;
    }
  }
  const pairs = (Math.imul(rows, SHIFTED_STRIDE) - 1) >>> 0;
  let q = HORIZONTAL_BUFFER;
  for (let n = 0; n < pairs; n++) {
    const entry = lerpIndex(mem[SHIFTED_READ_START + n], mem[SHIFTED_READ_START + n + 1]);
    mem[q++] = mem[entry];
    mem[q++] = mem[entry + 1];
    mem[q++] = mem[entry + 2];
    mem[q++] = mem[entry + 3];
  }
  const add = mem[UPSCALE_ADD];
  let destination = workBuffer(m);
  let h = HORIZONTAL_BUFFER;
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < ROW; x++) {
      const entry = lerpIndex(mem[h], mem[h + ROW]);
      mem[destination + x] = (mem[entry] + add) & 0xff;
      mem[destination + x + ROW] = (mem[entry + 1] + add) & 0xff;
      mem[destination + x + 2 * ROW] = (mem[entry + 2] + add) & 0xff;
      mem[destination + x + 3 * ROW] = (mem[entry + 3] + add) & 0xff;
      h++;
    }
    destination += 4 * ROW;
  }
  mem.fill(UPSCALE_FILL, destination, destination + 4 * UPSCALE_FILL_DWORDS);
}

/** RESET_ANIM: the next decode starts from frame 0 (its keyframe). */
export function resetAnimation(m) {
  m.set32(FRAME_NEXT, 0);
  m.set32(FRAME_REQUESTED, 0);
}

/** 0x28970 (and its copy 0x2898d): the current single-object frame upscaled again. */
export function redisplayAnimation(m) {
  upscale4x(m, m.u32(OBJECT_BUFFERS[0]));
}

/**
 * 0x28999: the single object [MORPH_ITEM] (78x48 frames): when a new frame is requested, decode it (the
 * keyframe first for frame 0), advance the next frame (looping to 0); always upscale it into W.
 */
export function stepAnimation(m) {
  m.set32(RLE_LIMIT, ANIMATION_FRAME_BYTES);
  const requested = m.u32(FRAME_REQUESTED);
  if (requested === m.u32(FRAME_DECODED)) {
    redisplayAnimation(m);
    return;
  }
  m.set32(FRAME_DECODED, requested);
  const item = m.u32(MORPH_ITEM);
  const frame = m.u32(OBJECT_BUFFERS[0]);
  if (requested === 0) {
    decodeKeyframe(m, item, frame);
    redisplayAnimation(m);
  }
  decodeDelta(m, item, requested);
  subtractDelta(m, frame, ANIMATION_FRAME_BYTES);
  redisplayAnimation(m);
  const next = m.u32(FRAME_NEXT) + 1;
  m.set32(FRAME_NEXT, next >= m.u32(item) ? 0 : next);
}

/**
 * 0x1ad47 for component k (0 R, 1 G, 2 B), [LINE_SELECT] and [PALETTE_ADD] set first as 0x1af4e does: W (320 wide,
 * 132 rows) to every 3rd line of the page, from line [LINE_SELECT]/80, + [PALETTE_ADD].
 */
export function writeComponentToPlanes(m, component) {
  m.set32(LINE_SELECT, COMPONENT_LINE_SELECT[component]);
  m.set8(PALETTE_ADD, COMPONENT_PALETTE_ADD[component]);
  const mem = m.mem;
  const add = mem[PALETTE_ADD];
  const start = m.u32(LINE_SELECT) + m.u32(PAGE_OFFSET);
  for (let p = 0; p < 4; p++) {
    m.mapMask = 1 << p;
    const plane = m.planes[p];
    let source = workBuffer(m) + p;
    let destination = start;
    for (let r = 0; r < COMPONENT_ROWS; r++) {
      for (let b = 0; b < BYTES_PER_LINE; b++) {
        plane[destination & 0xffff] = (mem[source] + add) & 0xff;
        source += 4;
        destination++;
      }
      destination += TRIPLET_SKIP;
    }
  }
}

/** 0x1af4e: the three object buffers upscaled and written as the R, G and B lines of the page. */
function displayObjects(m) {
  for (let k = 0; k < 3; k++) {
    upscale4x(m, m.u32(OBJECT_BUFFERS[k]));
    writeComponentToPlanes(m, k);
  }
}

/**
 * 0x1afc4: the three objects [MORPH_ITEM], [MORPH_GREEN_ITEM], [MORPH_BLUE_ITEM] (78x33 frames): on a new
 * request decode one frame of each (keyframes first for frame 0, which is displayed once before its delta),
 * then display; the next frame stops at the last one.
 */
export function stepObjects(m) {
  m.set32(RLE_LIMIT, RGB_FRAME_BYTES);
  m.set32(UPSCALE_ROWS, RGB_ROWS);
  const requested = m.u32(FRAME_REQUESTED);
  if (requested === m.u32(FRAME_DECODED)) {
    displayObjects(m);
    return;
  }
  m.set32(FRAME_DECODED, requested);
  const items = [m.u32(MORPH_ITEM), m.u32(MORPH_GREEN_ITEM), m.u32(MORPH_BLUE_ITEM)];
  if (requested === 0) {
    items.forEach((item, k) => decodeKeyframe(m, item, m.u32(OBJECT_BUFFERS[k])));
    displayObjects(m);
  }
  items.forEach((item, k) => {
    decodeDelta(m, item, requested);
    subtractDelta(m, m.u32(OBJECT_BUFFERS[k]), RGB_FRAME_BYTES);
  });
  displayObjects(m);
  const next = m.u32(FRAME_NEXT) + 1;
  m.set32(FRAME_NEXT, next >= m.u32(items[0]) ? next - 1 : next);
}

/** 0x1af37: CRTC start address (registers 0x0c/0x0d) = [PAGE_OFFSET], no retrace wait. */
function showPage(m) {
  m.crtcStart = m.u32(PAGE_OFFSET) & 0xffff;
}

/** The end of every mode-X frame: show the page just drawn, draw the next frame into the other one. */
export function flipPage(m) {
  showPage(m);
  m.set32(PAGE_OFFSET, m.u32(PAGE_OFFSET) ^ PAGE_FLIP);
}

/** 0x1c0c1: B2 as one linear run of [TEXT_PLANE_LENGTH] bytes per plane at page + [TEXT_PLANE_OFFSET], zeros skipped. */
export function copyTextToPlanes(m) {
  const mem = m.mem;
  const start = m.u32(TEXT_PLANE_OFFSET) + m.u32(PAGE_OFFSET);
  const length = m.u32(TEXT_PLANE_LENGTH);
  for (let p = 0; p < 4; p++) {
    m.mapMask = 1 << p;
    const plane = m.planes[p];
    let source = backBuffer(m) + p;
    for (let i = 0; i < length; i++) {
      const v = mem[source];
      if (v !== 0) {
        plane[(start + i) & 0xffff] = v;
      }
      source += 4;
    }
  }
}

/** The string list entry [SCROLLER_POSITION] drawn into B2 row 0 in the 0xc0 colours, then onto the planes. */
function drawScrollerEntry(m, strings) {
  m.set32(TEXT_POINTER, strings + m.u32(SCROLLER_POSITION));
  m.set8(TEXT_COLOUR_BASE, SCROLLER_COLOUR_BASE);
  drawText(m, backBuffer(m));
  copyTextToPlanes(m);
}

/** 0x1bddc: the scroller of 0x54ec3 (16-byte strings at 0x1bc04). */
export function drawScroller(m) {
  drawScrollerEntry(m, SCROLLER_STRINGS);
}

/** 0x1be99: the scroller of 0x552f4 (18-byte strings at 0x1be09, " you are alone.. " ...). */
export function drawAloneScroller(m) {
  drawScrollerEntry(m, ALONE_STRINGS);
}

/** 0x1c086: the scroller of 0x5543c (16-byte strings at 0x1bec6, "system ..."), at plane offset 0x2bcf. */
export function drawSystemScroller(m) {
  m.set32(TEXT_PLANE_OFFSET, SYSTEM_TEXT_PLANE_OFFSET);
  drawScrollerEntry(m, SYSTEM_STRINGS);
}
