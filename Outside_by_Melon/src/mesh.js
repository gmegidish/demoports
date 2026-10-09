// The room's textured mesh: 0x4e611 (vertices, faces, no depth sort) and its affine,
// shaded triangle filler 0x4de50. Coordinates are 16.16 with zero fractions.
import { transform, isFrontFacing } from './engine3d.js'

const VERTICES = 0x4e878 // 150 records of 32 bytes: x, y, z (>>12), u, v (>>16), normal (unused)
const FACES = 0x4fb3c // u16 i0, i1, i2, pad; ends with 0x7fff
const Z_SHIFT = -1200 // [0x5090e]
const CLIP_W = 320 // [0x50927]
const CLIP_H = 200 // [0x5092b]

const s16 = (v) => (v << 16) >> 16
const idiv = (a, b) => Math.trunc(a / b) | 0

// angles: rotX [0x1f7438], rotY [0x1f743c], rotZ [0x1f7440]
export function drawMesh(m, e, tex, rotX, rotY, rotZ) {
  const { view } = m
  const V = []
  for (let a = VERTICES; view.getInt32(a, true) !== 0x7fffffff; a += 32) {
    const x = s16(view.getInt32(a, true) >> 12)
    const y = s16(view.getInt32(a + 4, true) >> 12)
    const z = s16((view.getInt32(a + 8, true) >> 12) + Z_SHIFT)
    const o = transform(m, e, x, y, z, rotX, rotY, rotZ)
    const s = Math.max(Math.min(((-o.Z) >> 4) + 80, 30), -20)
    V.push({
      x: o.sx << 16, y: o.sy << 16, s: s << 16,
      u: s16(view.getInt32(a + 12, true) >> 16) << 16, v: s16(view.getInt32(a + 16, true) >> 16) << 16,
    })
  }
  for (let a = FACES; view.getInt16(a, true) !== 0x7fff; a += 8) {
    const p0 = V[view.getUint16(a, true)], p1 = V[view.getUint16(a + 2, true)], p2 = V[view.getUint16(a + 4, true)]
    if (isFrontFacing(p0.x >> 16, p0.y >> 16, p1.x >> 16, p1.y >> 16, p2.x >> 16, p2.y >> 16)) {
      texturedTriangle(m, tex, p0, p1, p2)
    }
  }
}

const KEYS = ['x', 'u', 'v', 's']

function texturedTriangle(m, tex, a, b, c) {
  let P = [a, b, c]
  if (P[0].y > P[1].y) {
    P = [P[1], P[0], P[2]]
  }
  if (P[1].y > P[2].y) {
    P = [P[0], P[2], P[1]]
  }
  if (P[0].y > P[1].y) {
    P = [P[1], P[0], P[2]]
  }
  const [P0, P1, P2] = P
  if (P0.y >> 16 > CLIP_H || P2.y >> 16 < 0) {
    return
  }
  if (P.every((p) => p.x >> 16 > CLIP_W) || P.every((p) => p.x >> 16 < 0)) {
    return
  }
  const H = (P2.y - P0.y) >> 16
  if (H === 0) {
    return
  }
  let count = H
  const h01 = (P1.y - P0.y) >> 16
  const A = {}, Bv = {}, dA = {}, dB = {}
  for (const k of KEYS) {
    A[k] = P0[k]; Bv[k] = P0[k]
    dA[k] = h01 ? idiv((P1[k] - P0[k]) | 0, h01) : (P1[k] - P0[k]) | 0
    dB[k] = idiv((P2[k] - P0[k]) | 0, H)
  }
  // the cdq/shld quirk: dy01 * 65537 / dy02
  const q = Math.trunc((h01 * 65537 * 65536) / (P2.y - P0.y))
  const M = {}
  for (const k of KEYS) {
    M[k] = (Math.floor((((P2[k] - P0[k]) | 0) * q) / 65536) + P0[k]) | 0
  }
  const g = {}
  for (const k of ['u', 'v', 's']) {
    let e = (M[k] - P1[k]) | 0
    let w = (M.x - P1.x) | 0
    if (w < 0) {
      w = -w; e = -e | 0
    }
    w >>= 16
    if (w) {
      e = idiv(e, w)
    }
    g[k] = (e >> 8) & 0xffff
  }
  const { fb } = m
  let cy = P0.y >> 16
  for (;;) {
    if (cy === P1.y >> 16) {
      const h12 = (P2.y - P1.y) >> 16
      for (const k of KEYS) {
        A[k] = P1[k]
        dA[k] = h12 ? idiv((P2[k] - P1[k]) | 0, h12) : (P2[k] - P1[k]) | 0
      }
    }
    if (cy >= CLIP_H) {
      return
    }
    for (const k of KEYS) {
      A[k] = (A[k] + dA[k]) | 0
      Bv[k] = (Bv[k] + dB[k]) | 0
    }
    if (cy >= 0) {
      span(fb, tex, cy, A, Bv, g)
    }
    cy++
    count = (count - 1) & 0xffff
    if (count === 0) {
      return
    }
  }
}

function span(fb, tex, cy, A, B, g) {
  let XL = A.x >> 16, XR = B.x >> 16, L = A
  if (XL > XR) {
    [XL, XR] = [XR, XL]
    L = B
  }
  let n = XR - XL
  if (!(n > 0 && XR > 0)) {
    return
  }
  if (XR >= CLIP_W) {
    n -= XR - CLIP_W
  }
  if (XL >= CLIP_W) {
    return
  }
  let Uc = (L.u >> 8) & 0xffff, Vc = (L.v >> 8) & 0xffff, Sc = (L.s >> 8) & 0xffff
  let p = cy * CLIP_W + XL
  if (XL < 0) {
    const k = -XL
    p += k; n -= k
    Uc = (Uc + k * g.u) & 0xffff; Vc = (Vc + k * g.v) & 0xffff; Sc = (Sc + k * g.s) & 0xffff
  }
  for (; n > 0; n--) {
    fb[p++] = tex[(Vc >> 8) * 256 + (Uc >> 8)] + (Sc >> 8)
    Uc = (Uc + g.u) & 0xffff; Vc = (Vc + g.v) & 0xffff; Sc = (Sc + g.s) & 0xffff
  }
}
