// The 08d8 polygon engine, raster half: clipping (0b70, 0b24), the XOR edge lines into the scr_data buffer (097f),
// the left-border edge (0ad3), the bounding boxes (0f93, 0fe1) and the edge-flag fills into video memory (0e00,
// 0ecc). docs/disassembly/G2_textmode_intro_credits.md section 3. All variables live in m.mem at their 08d8
// offsets (ENGINE below), so their state carries from one effect to the next as in the original.

/** 08d8 variable offsets (linear address = ENGINE_SEGMENT_BASE + offset). */
export const ENGINE_SEGMENT_BASE = 0x8d80;
export const ENGINE = {
  /** Segment of the XOR buffer (resource scr_data): 320x200 1 bpp, then the mask and fill tables. */
  BUFFER_SEGMENT: 0x0000,
  X_CENTRE: 0x008e,
  Y_MAX: 0x0090,
  /** Byte: 0 = y as is, 1 = y*2/3 + 42h, 2 = y*2 (0x92). */
  Y_MODE: 0x0092,
  ANGLE_A95: 0x0095,
  ANGLE_A97: 0x0097,
  ANGLE_A99: 0x0099,
  LEFT_EDGE_FLAG: 0x009b,
  LEFT_EDGE_Y1: 0x009c,
  LEFT_EDGE_Y2: 0x009e,
  LEFT_EDGE_OFFSET: 0x00a0,
  LEFT_EDGE_MASK: 0x00a2,
  DISTANCE: 0x00a3,
  PLANE_MIN_Y: 0x00a7,
  PLANE_MAX_Y: 0x00a9,
  PLANE_MIN_X: 0x00ab,
  PLANE_MAX_X: 0x00ad,
  FRAME_MIN_Y: 0x00af,
  FRAME_MAX_Y: 0x00b1,
  FRAME_MIN_X: 0x00b3,
  FRAME_MAX_X: 0x00b5,
  PREVIOUS_MIN_Y: 0x00b7,
  PREVIOUS_MAX_Y: 0x00b9,
  PREVIOUS_MIN_X: 0x00bb,
  PREVIOUS_MAX_X: 0x00bd,
  SINE_TABLE: 0x00c1,
  /** Self-modified immediate of `add ax, 64h` at 0913: the y centre. */
  Y_CENTRE: 0x0914,
  LINE_COUNT: 0x0ad1,
  /** Self-modified segment of the fill 0e00 (a000 / a800 / a1f4). */
  FILL_SEGMENT: 0x0e61,
  /** Self-modified segment of the fill 0ecc. */
  FILL_ALL_SEGMENT: 0x0f2d,
  /** Byte: 1 = 128d fills each plane. */
  FILL_ENABLE: 0x128c,
  /** The back page offset (14a9 / 14e6 toggle it). */
  PAGE: 0x1413,
  /** Self-modified immediate of `mov ax, 0f02h` at 1460: the map mask word of the clear 1417. */
  CLEAR_MAP_MASK: 0x1461,
  ROLL_SPEED: 0x1578,
  APPROACH_SPEED: 0x157a,
  FRAME_COUNT_COPY: 0x157c,
  SPEED_A97: 0x2002,
  SPEED_A99: 0x2004,
  SPEED_DISTANCE: 0x2006,
  SPEED_Y_CENTRE: 0x2008,
};

const SCREEN_RIGHT = 0x13f;
const BUFFER_STRIDE = 40;
const MASK_TABLE = 0x1f41;
const FILL_TABLE_OFF = 0x1f49;
const FILL_TABLE_ON = 0x2049;
const SEQUENCER_INDEX = 0x3c4;
const VIDEO_SEGMENT = 0xa000;

const toS16 = (v) => (v << 16) >> 16;
/** x86 idiv of a 32-bit dividend by a 16-bit divisor: quotient truncated toward zero, wrapped to 16 bits. */
const idiv = (dividend, divisor) => toS16(Math.trunc(dividend / divisor));

/** Reads/writes the engine's signed word variables. */
function word(m, offset) {
  return m.s16(ENGINE_SEGMENT_BASE + offset);
}

function setWord(m, offset, value) {
  m.set16(ENGINE_SEGMENT_BASE + offset, value);
}

/**
 * The 08d8 word holding the segment the buffer routines use (their ds): scr_data at [0000] for every effect but the
 * rotating door (08d8:3e3a), which draws and fills through screen2 at [000a] (selectBuffer).
 */
let bufferSegmentVariable = ENGINE.BUFFER_SEGMENT;

/** Sets the 08d8 offset of the word whose segment is the XOR buffer (`push cs:[x] ; pop ds`). */
export function selectBuffer(segmentVariable) {
  bufferSegmentVariable = segmentVariable;
}

/** Linear address of the XOR buffer (scr_data unless selectBuffer chose another). */
export function bufferBase(m) {
  return m.u16(ENGINE_SEGMENT_BASE + bufferSegmentVariable) * 16;
}

// ---------------------------------------------------------------------------------------------------------------
// 097f: XOR line from (x1, y1) to (x2, y2) into the buffer, stride 40. Starts at the endpoint with the larger y and
// goes up; dy pixels, one per row, the top endpoint excluded. Horizontal lines are not drawn.
// ---------------------------------------------------------------------------------------------------------------
export function xorLine(m, x1, y1, x2, y2) {
  const mem = m.mem;
  const base = bufferBase(m);
  let si = x1;
  let di = y1;
  let bp = x2;
  let dx = y2;
  if (di === dx) {
    return;
  }
  if (!((di & 0xffff) > (dx & 0xffff))) {
    [bp, si] = [si, bp];
    [dx, di] = [di, dx];
  }
  const dy = di - dx;
  let at = base + toS16(di * BUFFER_STRIDE);
  let mask = mem[base + MASK_TABLE + (si & 7)];
  at += si >> 3;
  const run = bp - si;
  if (run === 0) {
    for (let i = 0; i < dy; i++) {
      mem[at] ^= mask;
      at -= BUFFER_STRIDE;
    }
    return;
  }
  const isRight = run > 0;
  const width = isRight ? run : -run;
  if (width === dy) {
    for (let i = 0; i < dy; i++) {
      mem[at] ^= mask;
      at -= BUFFER_STRIDE;
      if (isRight) {
        if (mask === 1) { mask = 0x80; at++; } else { mask >>= 1; }
      } else if (mask === 0x80) { mask = 1; at--; } else { mask <<= 1; }
    }
    return;
  }
  if (width > dy) {
    // x-major (09d1 / 0a67): ah counts the rows (8 bits).
    let rows = dy & 0xff;
    let error = 0;
    mem[at] ^= mask;
    for (;;) {
      if (isRight) {
        if (mask === 1) { mask = 0x80; at++; } else { mask >>= 1; }
      } else if (mask === 0x80) { mask = 1; at--; } else { mask <<= 1; }
      error = toS16(error + 2 * dy);
      if (error > width) {
        at -= BUFFER_STRIDE;
        rows = (rows - 1) & 0xff;
        if (rows === 0) {
          return;
        }
        error = toS16(error - 2 * width);
        mem[at] ^= mask;
      }
    }
  }
  // y-major (0a0d / 0aa3).
  let error = 0;
  for (let i = 0; i < dy; i++) {
    mem[at] ^= mask;
    at -= BUFFER_STRIDE;
    error = toS16(error + 2 * width);
    if (error > dy) {
      error = toS16(error - 2 * dy);
      if (isRight) {
        if (mask === 1) { mask = 0x80; at++; } else { mask >>= 1; }
      } else if (mask === 0x80) { mask = 1; at--; } else { mask <<= 1; }
    }
  }
}

/** 0ad3: XORs the left border column (mask [0xa2] at [0xa0] + row*40) between the stored y range; clears the flag. */
export function leftEdge(m) {
  let bx = word(m, ENGINE.LEFT_EDGE_Y1);
  let cx = word(m, ENGINE.LEFT_EDGE_Y2);
  if (bx !== cx) {
    if (!(bx < cx)) {
      [bx, cx] = [cx, bx];
    }
    if (bx < 0) {
      bx = 0;
    }
    const yMax = word(m, ENGINE.Y_MAX);
    if (cx > yMax) {
      cx = yMax;
    }
    const count = (cx - bx) & 0xffff;
    if (count !== 0) {
      const base = bufferBase(m);
      const mask = m.mem[ENGINE_SEGMENT_BASE + ENGINE.LEFT_EDGE_MASK];
      let at = ((bx + 1) * BUFFER_STRIDE + word(m, ENGINE.LEFT_EDGE_OFFSET)) & 0xffff;
      for (let i = 0; i < count; i++) {
        m.mem[base + at] ^= mask;
        at = (at + BUFFER_STRIDE) & 0xffff;
      }
      setWord(m, ENGINE.LINE_COUNT, word(m, ENGINE.LINE_COUNT) + 1);
    }
  }
  m.mem[ENGINE_SEGMENT_BASE + ENGINE.LEFT_EDGE_FLAG] = 0;
}

/** 0b24: a trivially rejected line still widens the plane box to the screen edges it lies beyond. */
function widenBoxForRejected(m, codes) {
  if (codes & 0x101) {
    setWord(m, ENGINE.PLANE_MIN_X, 0);
  }
  if (codes & 0x202) {
    setWord(m, ENGINE.PLANE_MIN_Y, 0);
  }
  if (codes & 0x404) {
    setWord(m, ENGINE.PLANE_MAX_X, SCREEN_RIGHT);
  }
  if (codes & 0x808) {
    setWord(m, ENGINE.PLANE_MAX_Y, word(m, ENGINE.Y_MAX));
  }
}

/** Clamps y to 0..ymax as 0c15..0c34 do. */
function clampY(y, yMax) {
  if (y < 0) {
    return 0;
  }
  return y > yMax ? yMax : y;
}

/** `imul` then, if the divisor is not 0, `idiv`; without the division the low word of the product. */
function scaled(a, b, divisor) {
  const product = a * b;
  return divisor !== 0 ? idiv(product, divisor) : toS16(product);
}

/**
 * 0b70: clips the line (si, di)-(bp, dx) to 0..319 x 0..ymax. Returns null if it is not drawn (it may still have
 * set the left edge flag), or the clipped [si, di, bp, dx].
 */
export function clipLine(m, si, di, bp, dx) {
  const yMax = word(m, ENGINE.Y_MAX);
  let cl = 0;
  let ch = 0;
  if (si < 0) { cl = 1; }
  if (si > SCREEN_RIGHT) { cl |= 4; }
  if (bp < 0) { ch = 1; }
  if (bp > SCREEN_RIGHT) { ch |= 4; }
  if (di < 0) { cl |= 2; }
  if (di > yMax) { cl |= 8; }
  if (dx < 0) { ch |= 2; }
  if (dx > yMax) { ch |= 8; }
  const both = cl & ch;
  if (both !== 0) {
    widenBoxForRejected(m, cl | (ch << 8));
    if ((both & 1) && !(both & 2) && !(both & 8) && di !== dx) {
      if (!(di < dx)) {
        [dx, di] = [di, dx];
      }
      m.mem[ENGINE_SEGMENT_BASE + ENGINE.LEFT_EDGE_FLAG] = 1;
      setWord(m, ENGINE.LEFT_EDGE_Y1, di < 0 ? 0 : di);
      setWord(m, ENGINE.LEFT_EDGE_Y2, dx > yMax ? yMax : dx);
    }
    return null;
  }
  if ((cl | ch) === 0) {
    return [si, di, bp, dx];
  }
  if (cl !== 0) {
    if (cl & 1) {
      m.mem[ENGINE_SEGMENT_BASE + ENGINE.LEFT_EDGE_FLAG] = 1;
      setWord(m, ENGINE.LEFT_EDGE_Y1, clampY(di, yMax));
      di = toS16(di + scaled(toS16(dx - di), toS16(-si), toS16(bp - si)));
      setWord(m, ENGINE.LEFT_EDGE_Y2, di);
      si = 0;
    }
    if ((cl & 4) && si > SCREEN_RIGHT) {
      di = toS16(di + scaled(toS16(dx - di), toS16(SCREEN_RIGHT - si), toS16(bp - si)));
      si = SCREEN_RIGHT;
    }
    if ((cl & 2) && di < 0) {
      si = toS16(si + scaled(toS16(bp - si), toS16(-di), toS16(dx - di)));
      di = 0;
    }
    if ((cl & 8) && di > yMax) {
      si = toS16(si + scaled(toS16(bp - si), toS16(yMax - di), toS16(dx - di)));
      di = yMax;
    }
  }
  if (ch !== 0) {
    if (ch & 1) {
      m.mem[ENGINE_SEGMENT_BASE + ENGINE.LEFT_EDGE_FLAG] = 1;
      setWord(m, ENGINE.LEFT_EDGE_Y1, clampY(dx, yMax));
      dx = toS16(dx + scaled(toS16(dx - di), toS16(-bp), toS16(bp - si)));
      bp = 0;
      setWord(m, ENGINE.LEFT_EDGE_Y2, dx);
    }
    if ((ch & 4) && bp > SCREEN_RIGHT) {
      const divisor = toS16(bp - si);
      const delta = scaled(toS16(dx - di), toS16(SCREEN_RIGHT - bp), divisor);
      if (divisor !== 0) {
        bp = SCREEN_RIGHT; // 0d50: with a zero divisor bp keeps its value (quirk)
      }
      dx = toS16(dx + delta);
    }
    if ((ch & 2) && dx < 0) {
      bp = toS16(bp + scaled(toS16(bp - si), toS16(-dx), toS16(dx - di)));
      dx = 0;
    }
    if ((ch & 8) && dx > yMax) {
      bp = toS16(bp + scaled(toS16(bp - si), toS16(yMax - dx), toS16(dx - di)));
      dx = yMax;
    }
  }
  si = si < 0 ? 0 : si > SCREEN_RIGHT ? SCREEN_RIGHT : si;
  bp = bp < 0 ? 0 : bp > SCREEN_RIGHT ? SCREEN_RIGHT : bp;
  di = clampY(di, yMax);
  dx = clampY(dx, yMax);
  return [si, di, bp, dx];
}

/** 0f93: widens the plane box by a clipped line (di is its lower end, dx its upper end). */
function widenPlaneBox(m, si, di, bp, dx) {
  if (di >= word(m, ENGINE.PLANE_MAX_Y)) {
    setWord(m, ENGINE.PLANE_MAX_Y, di);
  }
  if (dx <= word(m, ENGINE.PLANE_MIN_Y)) {
    setWord(m, ENGINE.PLANE_MIN_Y, dx);
  }
  const [low, high] = si <= bp ? [si, bp] : [bp, si];
  if (high >= word(m, ENGINE.PLANE_MAX_X)) {
    setWord(m, ENGINE.PLANE_MAX_X, high);
  }
  if (low <= word(m, ENGINE.PLANE_MIN_X)) {
    setWord(m, ENGINE.PLANE_MIN_X, low);
  }
}

/** 13f7: clip, then XOR the line and count it, then the left edge if the clip asked for it. */
export function drawEdge(m, si, di, bp, dx) {
  const clipped = clipLine(m, si, di, bp, dx);
  if (clipped !== null) {
    widenPlaneBox(m, clipped[0], clipped[1], clipped[2], clipped[3]);
    xorLine(m, clipped[0], clipped[1], clipped[2], clipped[3]);
    setWord(m, ENGINE.LINE_COUNT, word(m, ENGINE.LINE_COUNT) + 1);
  }
  if (m.mem[ENGINE_SEGMENT_BASE + ENGINE.LEFT_EDGE_FLAG] === 1) {
    leftEdge(m);
  }
}

/** 0fe1: merges the plane box into the frame box. */
export function mergePlaneBox(m) {
  const maxY = word(m, ENGINE.PLANE_MAX_Y);
  const minY = word(m, ENGINE.PLANE_MIN_Y);
  const minX = word(m, ENGINE.PLANE_MIN_X);
  const maxX = word(m, ENGINE.PLANE_MAX_X);
  if (maxY >= word(m, ENGINE.FRAME_MAX_Y)) {
    setWord(m, ENGINE.FRAME_MAX_Y, maxY);
  }
  if (minY <= word(m, ENGINE.FRAME_MIN_Y)) {
    setWord(m, ENGINE.FRAME_MIN_Y, minY);
  }
  if (maxX >= word(m, ENGINE.FRAME_MAX_X)) {
    setWord(m, ENGINE.FRAME_MAX_X, maxX);
  }
  if (minX <= word(m, ENGINE.FRAME_MIN_X)) {
    setWord(m, ENGINE.FRAME_MIN_X, minX);
  }
}

/**
 * 0e00 (writesZeroRuns false, segment [0e61]) and 0ecc (true, segment [0f2d]): edge-flag fill of the plane box
 * from the buffer into video memory at the same offsets, with the current map mask; clears the buffer bytes it
 * reads. 0e00 skips zero bytes while outside a polygon; 0ecc writes them.
 */
function fillPlaneBox(m, segmentOffset, writesZeroRuns) {
  const minY = word(m, ENGINE.PLANE_MIN_Y);
  const rows = toS16(word(m, ENGINE.PLANE_MAX_Y) - minY + 1);
  if (rows <= 0) {
    return;
  }
  const mem = m.mem;
  const vga = m.vga;
  const base = bufferBase(m);
  const firstByte = (m.u16(ENGINE_SEGMENT_BASE + ENGINE.PLANE_MIN_X)) >> 3;
  const width = (((m.u16(ENGINE_SEGMENT_BASE + ENGINE.PLANE_MAX_X)) >> 3) + 1 - firstByte) & 0xffff;
  const tableOff = base + FILL_TABLE_OFF;
  const tableOn = base + FILL_TABLE_ON;
  const segment = (m.u16(ENGINE_SEGMENT_BASE + segmentOffset) - VIDEO_SEGMENT) * 16;
  let rowStart = (minY * BUFFER_STRIDE + firstByte) & 0xffff;
  for (let row = 0; row < rows; row++) {
    let isInside = false;
    for (let i = 0; i < width; i++) {
      const at = (rowStart + i) & 0xffff;
      const value = mem[base + at];
      if (value !== 0 || i === width - 1) {
        const out = mem[(isInside ? tableOn : tableOff) + value];
        if (PARITY[value]) {
          isInside = !isInside;
        }
        vga.write(segment + at, out);
        mem[base + at] = 0;
      } else if (isInside) {
        vga.write(segment + at, 0xff);
      } else if (writesZeroRuns) {
        vga.write(segment + at, 0);
      }
    }
    rowStart = (rowStart + width + (BUFFER_STRIDE - width)) & 0xffff;
  }
}

/** Odd parity of each byte (the x86 parity flag is set for even parity). */
const PARITY = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let bits = 0;
  for (let b = i; b; b >>= 1) {
    bits += b & 1;
  }
  PARITY[i] = bits & 1;
}

/** 0e00. */
export function fill(m) {
  fillPlaneBox(m, ENGINE.FILL_SEGMENT, false);
}

/** 0ecc. */
export function fillAll(m) {
  fillPlaneBox(m, ENGINE.FILL_ALL_SEGMENT, true);
}

/** `out 3c4, ax` with al = 2: the map mask. */
export function setMapMask(m, mask) {
  m.vga.out16(SEQUENCER_INDEX, 0x02 | (mask << 8));
}

export { word as engineWord, setWord as setEngineWord, toS16 };
