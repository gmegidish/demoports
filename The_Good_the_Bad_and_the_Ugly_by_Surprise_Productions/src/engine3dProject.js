// The 08d8 polygon engine, geometry half: rotation and perspective (07cb), the back-face test (0926) and the
// curve helpers of the bending objects (1026, 112a). docs/disassembly/G2_textmode_intro_credits.md section 3.2.
// An object lives in its own segment (see engine3d.js for the layout); projected vertices are written into it.
import { ENGINE, ENGINE_SEGMENT_BASE, engineWord, toS16 } from './engine3dRaster.js';

/** The sine table holds 720 entries per turn; cosine is 180 entries (0x168 bytes) further. */
const COSINE_OFFSET = 0x168;
const PERSPECTIVE = -400;
const Y_MODE_TWO_THIRDS_CENTRE = 0x42;

/** High word of a signed 16x16 product. */
const high = (a, b) => (a * b) >> 16;

/** The sine table word at byte offset `angle` (08d8:00c1 + angle). */
function sine(m, angle) {
  return m.s16(ENGINE_SEGMENT_BASE + ENGINE.SINE_TABLE + angle);
}

/**
 * 07cb: rotates and projects `count` vertices (x, y, z words) from ds:si to (sx, sy, depth) words at es:di.
 * @param {object} m the Machine
 * @param {number} source linear address of the first vertex
 * @param {number} destination linear address of the first projected entry
 * @param {number} count vertex count (the loop runs at least once, as `loop` does)
 */
export function projectVertices(m, source, destination, count) {
  const a97 = m.u16(ENGINE_SEGMENT_BASE + ENGINE.ANGLE_A97);
  const a99 = m.u16(ENGINE_SEGMENT_BASE + ENGINE.ANGLE_A99);
  const a95 = m.u16(ENGINE_SEGMENT_BASE + ENGINE.ANGLE_A95);
  const sin1 = sine(m, a97);
  const cos1 = sine(m, a97 + COSINE_OFFSET);
  const sin2 = sine(m, a99);
  const cos2 = sine(m, a99 + COSINE_OFFSET);
  const sin3 = sine(m, a95);
  const cos3 = sine(m, a95 + COSINE_OFFSET);
  const distance = engineWord(m, ENGINE.DISTANCE);
  const xCentre = engineWord(m, ENGINE.X_CENTRE);
  const yCentre = engineWord(m, ENGINE.Y_CENTRE);
  const yMode = m.u8(ENGINE_SEGMENT_BASE + ENGINE.Y_MODE);
  let si = source;
  let di = destination;
  let remaining = count & 0xffff;
  do {
    const x2 = toS16(m.s16(si) << 1);
    const y2 = toS16(m.s16(si + 2) << 1);
    const z2 = toS16(m.s16(si + 4) << 1);
    si += 6;
    const t1 = toS16((high(z2, cos1) + high(x2, sin1)) << 1);
    const u = toS16((high(x2, cos1) - high(z2, sin1)) << 1);
    const v = toS16((high(u, sin2) + high(y2, cos2)) << 1);
    const w = toS16(high(u, cos2) - high(y2, sin2));
    const x = toS16(high(v, cos3) + high(t1, sin3));
    const depth = toS16(high(t1, cos3) - high(v, sin3));
    const divisor = toS16(PERSPECTIVE - distance + depth);
    const projected = toS16(Math.trunc((x * PERSPECTIVE) / divisor));
    const sx = toS16(Math.trunc((w * PERSPECTIVE) / divisor) + xCentre);
    let sy;
    if (yMode === 0) {
      sy = toS16(projected + yCentre);
    } else if (yMode === 1) {
      sy = toS16(Math.trunc(toS16(projected << 1) / 3) + Y_MODE_TWO_THIRDS_CENTRE);
    } else {
      sy = toS16(toS16(projected << 1) + yCentre);
    }
    m.set16(di, sx);
    m.set16(di + 2, sy);
    m.set16(di + 4, depth);
    di += 6;
    remaining = (remaining - 1) & 0xffff;
  } while (remaining !== 0);
}

/**
 * 0926: the face at `face` (linear) faces the viewer when the 32-bit cross product of its first two edges is not
 * negative. Pointers in the face are offsets in the object segment `objectBase`.
 */
export function isFrontFace(m, objectBase, face) {
  const r = objectBase + m.u16(face + 4);
  const q = objectBase + m.u16(face + 6);
  const p = objectBase + m.u16(face + 0x0a);
  const rx = m.s16(r);
  const ry = m.s16(r + 2);
  const bp = toS16(m.s16(p) - rx);
  const cx = toS16(m.s16(p + 2) - ry);
  const dx = toS16(m.s16(q) - rx);
  const bx = toS16(m.s16(q + 2) - ry);
  return ((cx * dx - bx * bp) | 0) >= 0;
}

/**
 * 1026: a 9-point curve at es:di (6-byte vertices, x and y only): point 0 = (ax, dx), point 8 = (bx, bp), the y of
 * points 1..7 linear, their x bent by the 1/8, 1/4, 3/8, 1/2 fractions (points 5..7 mirror 3..1).
 */
export function bendCurve(m, di, ax, dx, bp, bx) {
  m.set16(di + 0x30, ax);
  m.set16(di + 0x32, bp);
  const ySpan = toS16(bp - dx);
  const x0 = ax;
  m.set16(di, ax);
  m.set16(di + 2, dx);
  let at = di + 8;
  let sum = 0;
  for (let i = 1; i <= 7; i++) {
    sum = toS16(sum + ySpan);
    m.set16(at, toS16((sum >> 3) + dx));
    at += 6;
  }
  const xEnd = bx;
  const xSpan = toS16(bx - x0);
  const fractions = [(v) => v >> 3, (v) => v >> 2, (v) => toS16(v * 3) >> 3, (v) => v >> 1];
  const mirrors = [0x2a, 0x24, 0x1e];
  let acc = 0;
  for (let k = 0; k < 4; k++) {
    acc = toS16(acc + xSpan);
    const bend = toS16((acc >> 3) << 1);
    const value = toS16(fractions[k](toS16(xEnd - x0 - bend)) + x0 + (acc >> 3));
    const point = di + 6 * (k + 1);
    m.set16(point, value);
    if (k < 3) {
      m.set16(di + mirrors[k], value);
    }
  }
}

/** 112a: the three curves of the bending objects, from projected points at fixed offsets of the object (es = ds). */
export function bendObjectCurves(m, objectBase) {
  const curve = (destination, start, end, target) => {
    bendCurve(m, objectBase + destination, m.s16(objectBase + start), m.s16(objectBase + start + 2),
      m.s16(objectBase + end), m.s16(objectBase + target));
  };
  curve(0x90, 0x4e, 0x62, 0x7e);
  curve(0xc6, 0x54, 0x5c, 0x84);
  curve(0xfc, 0x6c, 0x74, 0x8a);
}
