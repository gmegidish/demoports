// 3200-dots cubes (126e:13ea, Antibyte), geometry: rotation, projection, edge point lists and the dotted faces.
// docs/disassembly/G8_cubes_dots.md, part 2. Code segment 126e, data segment 120e (ds), all at their image addresses.

/** 126e:0000, the code segment (cube vertices, sine table, variables). */
export const CODE = 0x126e0;
/** 120e:0000, the data segment (mask table, rotation buffers, palette ramps, edge point lists). */
export const DATA = 0x120e0;

const SINE = 0x1ec;
const COSINE = 0x3ec;
const ANGLE_MASK = 0x7fe;
const CURRENT_ANGLES = 0xc22;
const ROTATE_IN = 0x200;
const ROTATED = 0x230;
const PROJECTED = 0x260;
const VERTEX_WORDS = 24;
const VERTICES = 8;
/** 126e:0dea: 0 = 0e21 copies its source from cs, 1 = from ds. */
const SOURCE_FLAG = 0xdea;
const SEPARATION = 0xbec;
const DISTANCE = 0xbee;
const GLOBAL_ANGLES = 0xc10;
const GLOBAL_SPEEDS = 0xc16;
/** 0dad: the projection's eye distance (bp = -500). */
const EYE = -500;
const CENTRE_X = 0xa0;
const CENTRE_Y = 0x64;
const POINT_LISTS = 0x400;
const POINT_LIST_BYTES = 0x40;
const POINTS_PER_EDGE = 16;
/** 126e:0000: the face list (count, then si, di, routine selector per face). */
const FACE_LIST = 0x0000;
/** 126e:1017: the jump table of 126e:100a (0 -> 126e:1067 sides, 2 -> 126e:10ce top/bottom). */
const SIDE_FACE = 0;
const VGA_WINDOW = 0x10000;
const CUBE_EDGES = [
  [0x260, 0x264], [0x264, 0x268], [0x268, 0x26c], [0x26c, 0x260],
  [0x270, 0x274], [0x274, 0x278], [0x278, 0x27c], [0x27c, 0x270],
];

/** int16 of a number. */
function s16(v) {
  return (v << 16) >> 16;
}

/** High word of 2 * a 32-bit sum (`shl ax,1 / adc dx,dx` after imul/add), as int16. */
function doubledHighWord(sum) {
  return s16(Math.imul(sum | 0, 2) >> 16);
}

/** x86 idiv quotient (truncated toward zero), 16 bits. */
function idiv(dividend, divisor) {
  if (divisor === 0) {
    return 0;
  }
  return s16(Math.trunc(dividend / divisor));
}

/**
 * 126e:0e21: angles += speeds (& 7feh), the 8 vertices at `source` (cs or ds, see SOURCE_FLAG) shifted left 5 to
 * ds:0200, rotated about three axes into ds:0230 (z shifted back right 5).
 */
export function rotate(m, anglesAt, speedsAt, source) {
  const mem = m.mem;
  const angles = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const angle = (m.u16(CODE + anglesAt + 2 * k) + m.u16(CODE + speedsAt + 2 * k)) & ANGLE_MASK;
    m.set16(CODE + anglesAt + 2 * k, angle);
    m.set16(CODE + CURRENT_ANGLES + 2 * k, angle);
    angles[k] = angle;
  }
  const sourceBase = mem[CODE + SOURCE_FLAG] === 0 ? CODE : DATA;
  for (let k = 0; k < VERTEX_WORDS; k++) {
    m.set16(DATA + ROTATE_IN + 2 * k, m.u16(sourceBase + source + 2 * k) << 5);
  }
  mem[CODE + SOURCE_FLAG] = 0;
  const sin1 = m.s16(CODE + SINE + angles[0]);
  const cos1 = m.s16(CODE + COSINE + angles[0]);
  const sin2 = m.s16(CODE + SINE + angles[1]);
  const cos2 = m.s16(CODE + COSINE + angles[1]);
  const sin3 = m.s16(CODE + SINE + angles[2]);
  const cos3 = m.s16(CODE + COSINE + angles[2]);
  for (let i = 0; i < VERTICES; i++) {
    const at = DATA + ROTATE_IN + 6 * i;
    const x = m.s16(at);
    const y = m.s16(at + 2);
    const z = m.s16(at + 4);
    const a = doubledHighWord(Math.imul(x, cos1) - Math.imul(y, sin1));
    const b = doubledHighWord(Math.imul(y, cos1) + Math.imul(x, sin1));
    const c = doubledHighWord(Math.imul(z, cos2) + Math.imul(b, sin2));
    const out = DATA + ROTATED + 6 * i;
    m.set16(out + 2, doubledHighWord(Math.imul(b, cos2) - Math.imul(z, sin2)));
    m.set16(out, doubledHighWord(Math.imul(c, sin3) + Math.imul(a, cos3)));
    m.set16(out + 4, doubledHighWord(Math.imul(c, cos3) - Math.imul(a, sin3)) >> 5);
  }
}

/** 126e:0deb: neg [bec]; x = (x sar 5) - [bec], y = y sar 5; then the global rotation (falls into 0e21). */
export function separateAndRotateGlobally(m) {
  const separation = s16(-m.s16(CODE + SEPARATION));
  m.set16(CODE + SEPARATION, separation);
  for (let i = 0; i < VERTICES; i++) {
    const at = DATA + ROTATED + 6 * i;
    m.set16(at, (m.s16(at) >> 5) - separation);
    m.set16(at + 2, m.s16(at + 2) >> 5);
  }
  m.mem[CODE + SOURCE_FLAG] = 1;
  rotate(m, GLOBAL_ANGLES, GLOBAL_SPEEDS, ROTATED);
}

/** 126e:0dad: perspective, distance [bee]. */
export function project(m) {
  const distance = m.s16(CODE + DISTANCE);
  for (let i = 0; i < VERTICES; i++) {
    const at = DATA + ROTATED + 6 * i;
    const divisor = s16(m.s16(at + 4) + distance - EYE);
    const x = s16(-idiv(m.s16(at) * EYE, divisor));
    const y = idiv(m.s16(at + 2) * EYE, divisor);
    m.set16(DATA + PROJECTED + 4 * i, (x >> 5) + CENTRE_X);
    m.set16(DATA + PROJECTED + 4 * i + 2, (y >> 5) + CENTRE_Y);
  }
}

/** The 4-bit fixed point step of 101b/1067/10ce: ((to << 4) - (from << 4)) sar 4, in 16 bits. */
function sixteenthStep(to, from) {
  return s16((to << 4) - (from << 4)) >> 4;
}

/** 126e:101b: 16 points from A (first) toward B (last = B + (A - B) / 16), stored at ds:out. */
function edgePoints(m, a, b, out) {
  const stepX = sixteenthStep(m.s16(DATA + a), m.s16(DATA + b));
  const stepY = sixteenthStep(m.s16(DATA + a + 2), m.s16(DATA + b + 2));
  let x = s16(m.s16(DATA + b) << 4);
  let y = s16(m.s16(DATA + b + 2) << 4);
  for (let k = 1; k <= POINTS_PER_EDGE; k++) {
    x = s16(x + stepX);
    y = s16(y + stepY);
    const at = DATA + out + 4 * (POINTS_PER_EDGE - k);
    m.set16(at, x >> 4);
    m.set16(at + 2, y >> 4);
  }
}

/**
 * `or es:[bx + (x >> 3)], ds:[x]`: a read (the read map plane) and a write (the map mask plane), through the VGA
 * so DOSBox's EGA pixel buffer sees it. Accesses past a000:ffff (es = a640) leave the VGA window and are lost.
 */
function plot(m, pageOffset, x, rowOffset) {
  const offset = (rowOffset + ((x & 0xffff) >> 3)) & 0xffff;
  const address = pageOffset + offset;
  if (address < VGA_WINDOW) {
    m.vga.write(address, m.vga.read(address) | m.mem[DATA + (x & 0xffff)]);
  }
}

/** 126e:1067 / 10ce: a dotted line from Q, `steps` points toward P in sixteenths (Q itself plotted first). */
function dottedLine(m, pageOffset, px, py, qx, qy, steps) {
  plot(m, pageOffset, qx, s16(qy << 6));
  const stepX = sixteenthStep(px, qx);
  const stepY = sixteenthStep(py, qy);
  let x = s16(qx << 4);
  let y = s16(qy << 4);
  for (let k = 0; k < steps; k++) {
    x = s16(x + stepX);
    y = s16(y + stepY);
    plot(m, pageOffset, x >> 4, (y << 2) & 0xffc0);
  }
}

/** 126e:0f7a: the 8 edge point lists, then the 6 dotted faces into the page at `pageOffset` (map mask / read map set). */
export function drawDottedCube(m, pageOffset) {
  let out = POINT_LISTS;
  for (const [a, b] of CUBE_EDGES) {
    edgePoints(m, a, b, out);
    out += POINT_LIST_BYTES;
  }
  const faces = m.u16(CODE + FACE_LIST);
  for (let f = 0; f < faces; f++) {
    const entry = CODE + FACE_LIST + 2 + 6 * f;
    const listP = m.u16(entry);
    const listQ = m.u16(entry + 2);
    const isSide = m.u16(entry + 4) === SIDE_FACE;
    for (let i = 0; i < POINTS_PER_EDGE; i++) {
      const p = DATA + listP + 4 * i;
      // 1067 pairs Q[i] with P[i]; 10ce walks back from its di (list + 4) one point per line.
      const q = DATA + ((isSide ? listQ + 4 * i : listQ - 4 * (i + 1)) & 0xffff);
      dottedLine(m, pageOffset, m.s16(p), m.s16(p + 2), m.s16(q), m.s16(q + 2), isSide ? 16 : 15);
    }
  }
}
