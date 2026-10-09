// The hand-written 3D engine in the data object: transform 0x4230d, lighting 0x424ff,
// back-face test 0x424ac, Gouraud triangle 0x41f65, the credits star 0x42657 (with its
// quicksort 0x4255e), and the bucket-sorted object batches 0x52a4c..0x530d6.
import { PIXELS } from './machine.js'

const FOCAL = 280 // [0x4655c]
const Z_BIAS = 5000 // [0x46560]
const CENTRE_X = 160 // [0x46528]
const CENTRE_Y = 100 // [0x4652a]
const CLIP_W = 320
const CLIP_H = 200
const Z_SLOTS = 0x800

const s16 = (v) => (v << 16) >> 16
const idiv = (a, b) => Math.trunc(a / b) | 0
// 64-bit product, arithmetic shift right 16, low 32 bits (imul + shrd)
const mulShr16 = (a, b) => Math.floor((a * b) / 65536) | 0

export function createEngine() {
  return {
    pos: [0, 0, 0], // [0x42a3b], [0x42a3f], [0x42a43], set by 0x42a25
    starLight: [0, 0, 0], // [0x4864d], [0x48651], [0x48655]
    L: [0, 0, 0], // light vector words [0x44ee8..]
    Zd: new Int32Array(Z_SLOTS), // per-vertex Z dwords at 0x6c53a: global, never cleared
    SX: new Int16Array(Z_SLOTS), SY: new Int16Array(Z_SLOTS), COL: new Uint16Array(Z_SLOTS),
    buckets: Array.from({ length: 256 }, () => []),
    out: { X: 0, Y: 0, Z: 0, sx: 0, sy: 0 },
  }
}

// 0x42a25
export function setObjectPos(e, x, y, z) {
  e.pos[0] = x | 0; e.pos[1] = y | 0; e.pos[2] = z | 0
}

// 0x4230d: x, y, z are int16 words; angles applied in the order a3 [0x4acba], a1 [0x4acb2], a2 [0x4acb6]
export function transform(m, e, x, y, z, a1, a2, a3) {
  const { S, C } = m
  let i = a3 & 0x3ff
  const t1 = (Math.imul(x, S[i]) + Math.imul(y, C[i])) >> 7
  const t2 = (Math.imul(x, C[i]) - Math.imul(y, S[i])) >> 7
  i = a1 & 0x3ff
  const X = (Math.imul(z, S[i]) + Math.imul(t2, C[i])) >> 7
  const t3 = (Math.imul(z, C[i]) - Math.imul(t2, S[i])) >> 7
  i = a2 & 0x3ff
  let Z = (Math.imul(t1, S[i]) + Math.imul(t3, C[i])) >> 7
  if (Z === 0) {
    Z = 1
  }
  const Y = (Math.imul(t1, C[i]) - Math.imul(t3, S[i])) >> 7
  const den = (Z + e.pos[2] + Z_BIAS) | 0
  const nx = Math.imul((X + e.pos[0]) | 0, FOCAL)
  const ny = Math.imul((Y + e.pos[1]) | 0, FOCAL)
  const o = e.out
  o.X = X; o.Y = Y; o.Z = Z
  o.sx = s16((den ? idiv(nx, den) : nx) + CENTRE_X)
  o.sy = s16((den ? idiv(ny, den) : ny) + CENTRE_Y)
  return o
}

// 0x424ff: (-(sum of (L - v) * n >> 16)) >> 6, v the untransformed vertex, n its 16.16 normal
export function light(e, x, y, z, nx, ny, nz) {
  const d = (mulShr16(s16(e.L[0] - x), nx) + mulShr16(s16(e.L[1] - y), ny) + mulShr16(s16(e.L[2] - z), nz)) | 0
  return (-d | 0) >> 6
}

// 0x424ac: true when the triangle faces the viewer (not culled)
export function isFrontFacing(x0, y0, x1, y1, x2, y2) {
  return (Math.imul(s16(y1 - y0), s16(x2 - x1)) - Math.imul(s16(y2 - y1), s16(x1 - x0))) >= 0
}

// 0x41f65: Gouraud triangle, colour = high byte of an 8.8 value stepped along each span
export function gouraudTriangle(fb, xa, ya, ca, xb, yb, cb, xc, yc, cc) {
  let v = [[xa << 16, ya << 16, ca << 16], [xb << 16, yb << 16, cb << 16], [xc << 16, yc << 16, cc << 16]]
  if (v[0][1] > v[1][1]) {
    v = [v[1], v[0], v[2]]
  }
  if (v[1][1] > v[2][1]) {
    v = [v[0], v[2], v[1]]
  }
  if (v[0][1] > v[1][1]) {
    v = [v[1], v[0], v[2]]
  }
  const [[X0, Y0, C0], [X1, Y1, C1], [X2, Y2, C2]] = v
  let y = Y0 >> 16
  let h = (Y2 - Y0) >> 16
  if (h === 0) {
    return
  }
  const dv = (a, b) => (b >> 16 ? idiv(a, b >> 16) : a)
  let dx01 = dv((X1 - X0) | 0, (Y1 - Y0) | 0), dc01 = dv((C1 - C0) | 0, (Y1 - Y0) | 0)
  const dx02 = dv((X2 - X0) | 0, (Y2 - Y0) | 0), dc02 = dv((C2 - C0) | 0, (Y2 - Y0) | 0)
  const dx12 = dv((X2 - X1) | 0, (Y2 - Y1) | 0), dc12 = dv((C2 - C1) | 0, (Y2 - Y1) | 0)
  // the cdq/shld quirk: (y1-y0)*65537/(y2-y0) instead of *65536
  const tt = Math.trunc((((Y1 - Y0) >> 16) * 65537) / ((Y2 - Y0) >> 16))
  const xm = (Math.floor((((X2 - X0) | 0) * tt) / 65536) + X0) | 0
  const cm = (Math.floor((((C2 - C0) | 0) * tt) / 65536) + C0) | 0
  const den = ((xm - X1) | 0) >> 16
  const dcdx = (den ? idiv((cm - C1) | 0, den) : (cm - C1) | 0) >> 8
  let xs = X0, xl = X0, cs = C0, cl = C0
  for (;;) {
    if (y >= CLIP_H) {
      return
    }
    if (y === Y1 >> 16) {
      dx01 = dx12; xs = X1; dc01 = dc12; cs = C1
    }
    cs = (cs + dc01) | 0
    cl = (cl + dc02) | 0
    xl = (xl + dx02) | 0
    xs = (xs + dx01) | 0
    let ea = cs >> 8, eb = cl >> 8
    let R = xl >> 16, Lx = xs >> 16
    let w = R - Lx
    if (w < 0) {
      w = -w;
      [ea, eb] = [eb, ea];
      [Lx, R] = [R, Lx]
    }
    if (!(y < 0 || Lx >= CLIP_W || R <= 0)) {
      let p = y * CLIP_W + Lx
      if (Lx < 0) {
        const k = -Lx
        p += k; w -= k
        ea = (ea + Math.imul(dcdx, k)) | 0
      }
      if (R > CLIP_W) {
        w -= R - CLIP_W
      }
      let a16 = ea & 0xffff
      const step = dcdx & 0xffff
      for (; w > 0 && p < PIXELS; w--) {
        fb[p++] = a16 >> 8
        a16 = (a16 + step) & 0xffff
      }
    }
    y++
    if (--h === 0) {
      return
    }
  }
}

// ---- the credits star, 0x42657 ----

const STAR_VERTICES = 0x42a48
const STAR_FACES = 0x4308c
const STAR_LAST_NZ = 5312 // ebx left by the vertex loop: nz of the last vertex, used as a pivot index

export function drawStar(m, e, ax, ay, az) {
  const { view, fb } = m
  const L = transform(m, e, -30000, 0, 0, e.starLight[0], e.starLight[1], e.starLight[2])
  e.L[0] = s16(L.X); e.L[1] = s16(L.Y); e.L[2] = s16(L.Z)
  e.starLight[0] += 2; e.starLight[1] += 5; e.starLight[2] += 7
  const PX = [], PY = [], SH = [], Z = []
  for (let a = STAR_VERTICES; view.getInt32(a, true) !== 0x7fffffff; a += 32) {
    const x = s16(view.getInt32(a, true) >> 11)
    const y = s16(view.getInt32(a + 4, true) >> 11)
    const z = s16(view.getInt32(a + 8, true) >> 11)
    const o = transform(m, e, x, y, z, ax, ay, az)
    let sh = light(e, x, y, z, view.getInt32(a + 20, true), view.getInt32(a + 24, true), view.getInt32(a + 28, true))
    sh >>= 3
    sh = sh >= 30 ? 30 : sh <= 0 ? 0 : sh
    PX.push(o.sx); PY.push(o.sy); SH.push(sh + 0xd1); Z.push(o.Z)
  }
  const faces = []
  for (let a = STAR_FACES; view.getInt16(a, true) !== 0x7fff; a += 8) {
    faces.push([view.getUint16(a, true), view.getUint16(a + 2, true), view.getUint16(a + 4, true)])
  }
  const n = faces.length
  const key = new Int32Array(n + 2), idx = new Int32Array(n + 2)
  faces.forEach((f, j) => {
    key[j + 1] = (Z[f[0]] + Z[f[1]] + Z[f[2]]) | 0
    idx[j + 1] = j
  })
  quicksort(key, idx, 1, n, STAR_LAST_NZ, true)
  // k = n+1 reads idx[n+1] = 0: face 0 is drawn once extra, first
  for (let k = n + 1; k >= 1; k--) {
    const [a, b, c] = faces[idx[k]]
    // the star tests the area the other way round from the batches
    if (!isFrontFacing(PX[a], PY[a], PX[b], PY[b], PX[c], PY[c])) {
      gouraudTriangle(fb, PX[a], PY[a], SH[a], PX[b], PY[b], SH[b], PX[c], PY[c], SH[c])
    }
  }
}

// 0x4255e: the first call's pivot index is (stale ebx + hi) >> 1, far past the keys: a zero dword (0x47fb0)
function quicksort(key, idx, lo, hi, ebx, isTop) {
  const pivot = isTop ? 0 : key[((ebx + hi) >>> 0) >> 1]
  let i = lo, j = hi
  for (;;) {
    while (key[i] < pivot) {
      i++
    }
    while (pivot < key[j]) {
      j--
    }
    if (i <= j) {
      [key[i], key[j]] = [key[j], key[i]];
      [idx[i], idx[j]] = [idx[j], idx[i]]
      i++; j--
    }
    if (!(i <= j)) {
      break
    }
  }
  if (lo < j) {
    quicksort(key, idx, lo, j, j, false)
  }
  if (i < hi) {
    quicksort(key, idx, i, hi, hi, false)
  }
}

// ---- object batches, 0x52a4c (add) and 0x52c83 (draw) ----

// obj: { vertices, faces, base, offset: [x, y, z], max, min, depthCue }
export function addObject(m, e, obj, angles, batch) {
  const { view } = m
  const B = batch.B
  let i = 0
  for (let a = obj.vertices; view.getInt32(a, true) !== 0x7fffffff; a += 32, i++) {
    const x = s16((view.getInt32(a, true) >> 12) + obj.offset[0])
    const y = s16((view.getInt32(a + 4, true) >> 12) + obj.offset[1])
    const z = s16((view.getInt32(a + 8, true) >> 12) + obj.offset[2])
    const o = transform(m, e, x, y, z, angles[0], angles[1], angles[2])
    const s = B / 2 + i
    e.SX[s] = o.sx; e.SY[s] = o.sy; e.Zd[s] = o.Z
    let sh = light(e, x, y, z, view.getInt32(a + 20, true), view.getInt32(a + 24, true), view.getInt32(a + 28, true))
    if (obj.depthCue) {
      sh = (sh + (o.Z >> 4) + 0x50) | 0
    }
    if (sh >= obj.max) {
      sh = obj.max
    }
    if (sh <= obj.min) {
      sh = obj.min
    }
    e.COL[s] = sh + obj.base
  }
  for (let a = obj.faces; view.getInt16(a, true) !== 0x7fff; a += 8) {
    const f0 = view.getUint16(a, true), f1 = view.getUint16(a + 2, true), f2 = view.getUint16(a + 4, true)
    // original bug: the depth key reads slot idx + B, not idx + B/2
    const za = e.Zd[f0 + B], zb = e.Zd[f1 + B], zc = e.Zd[f2 + B]
    const keyZ = Math.max(za, zb, zc)
    const bucket = (128 - (keyZ >> 6)) & 0xffff
    e.buckets[bucket].push(f0 + B / 2, f1 + B / 2, f2 + B / 2)
  }
  batch.B += 2 * i
}

export function drawBatch(m, e, batch) {
  const { fb } = m
  const { SX, SY, COL } = e
  for (const list of e.buckets) {
    for (let k = 0; k < list.length; k += 3) {
      const a = list[k], b = list[k + 1], c = list[k + 2]
      if (isFrontFacing(SX[a], SY[a], SX[b], SY[b], SX[c], SY[c])) {
        gouraudTriangle(fb, SX[a], SY[a], COL[a] & 0xff, SX[b], SY[b], COL[b] & 0xff, SX[c], SY[c], COL[c] & 0xff)
      }
    }
    list.length = 0
  }
  batch.B = 0
}

// the light of a batch: transform (x, y, z) by the light angles, keep the int16 results
export function setLight(m, e, x, y, z, a1, a2, a3) {
  const o = transform(m, e, x, y, z, a1, a2, a3)
  e.L[0] = s16(o.X); e.L[1] = s16(o.Y); e.L[2] = s16(o.Z)
}
