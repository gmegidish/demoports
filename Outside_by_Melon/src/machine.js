// The machine the parts draw on: the program's memory image (for its tables and 3D objects),
// the 320x200 frame buffer, the VGA DAC, the data files, and the shared C and asm helpers.
import { loadPmw1 } from './pmw1.js'
import { decodeLbm } from './lbm.js'
import { buildSineTable, readTrigTables } from './tables.js'

export const WIDTH = 320
export const HEIGHT = 200
export const PIXELS = WIDTH * HEIGHT
export const TICK_HZ = 70.086 // the MIDAS timer fires once per vertical retrace of mode 13h
const MEMORY_SIZE = 0x240000

// files: { 'OUTSIDE.EXE': Uint8Array, 'ROOM.LBM': Uint8Array, ... } (names in capitals)
export function createMachine(files) {
  const image = loadPmw1(files['OUTSIDE.EXE'], MEMORY_SIZE)
  const mem = image.mem
  const view = new DataView(mem.buffer)
  const { S, C } = readTrigTables(mem)
  const lbmCache = new Map()
  const m = {
    mem, view, S, C,
    sine: buildSineTable(),
    fb: new Uint8Array(PIXELS),
    dac: new Uint8Array(768),
    tunnels: [1, 2, 3, 4].map((n) => ({
      map: new Uint16Array(files[`TUNNEL${n}.MAP`].slice().buffer, 0, PIXELS),
      shade: files[`TUNNEL${n}.SHD`],
    })),
    tunnelTexture: new Uint8Array(0x10000),
    tunnel: null,
    tunnelOffset: 0,
    // 0x416e3 and 0x416aa read a file's first BODY and CMAP
    lbm(name) {
      if (!lbmCache.has(name)) {
        lbmCache.set(name, decodeLbm(files[name], name))
      }
      return lbmCache.get(name)
    },
  }
  m.tunnel = m.tunnels[0]
  return m
}

// 0x416aa: count CMAP entries as 6-bit values, written at dst[at*3..]
export function lbmPalette(m, dst, name, count, at = 0) {
  const cmap = m.lbm(name).cmap
  for (let i = 0; i < count * 3; i++) {
    dst[at * 3 + i] = cmap[i] >> 2
  }
}

// 0x12010: DAC[first+i] = clamp(int8(pal[i]) + bright, 0, 63) (the add-per-component arguments are always 0)
export function setPalette(m, pal, first, count, bright) {
  for (let i = 0; i < count * 3; i++) {
    const v = ((pal[i] << 24) >> 24) + bright
    m.dac[first * 3 + i] = v >= 63 ? 63 : v <= 0 ? 0 : v
  }
}

// 0x12100: out = cur moved by step toward target, per component (cur is not changed)
export function palApproach(target, out, cur, step, count) {
  for (let j = 0; j < count * 3; j++) {
    const c = cur[j], g = target[j]
    if (c > g) {
      out[j] = c - step < g ? g : c - step
    } else {
      out[j] = c + step > g ? g : c + step
    }
  }
}

// 0x10990
export function tunnelSetTexture(m, pixels) {
  m.tunnelTexture.set(pixels.subarray(0, 0x10000))
}

// 0x10a10
export function tunnelSelect(m, n) {
  m.tunnel = m.tunnels[n]
}

// 0x4162c: fb[i] = tex[(offset + map[i]) & 0xffff] + shade[i]
export function tunnelDraw(m) {
  const { fb, tunnelTexture: tex } = m
  const { map, shade } = m.tunnel
  const off = m.tunnelOffset & 0xffff
  for (let i = 0; i < PIXELS; i++) {
    fb[i] = tex[(off + map[i]) & 0xffff] + shade[i]
  }
}

// 0x415c3: non-zero source pixels plus add, from fb[dst]; the frame buffer has slack below row 199
export function overlay(m, src, count, dst, add) {
  const { fb } = m
  const end = Math.min(count, PIXELS - dst)
  for (let i = 0; i < end; i++) {
    const p = src[i]
    if (p !== 0) {
      fb[dst + i] = p + add
    }
  }
}

// 0x41575
export function wipeCopy(mask, dst, src, threshold) {
  for (let i = 0; i < PIXELS; i++) {
    if (mask[i] === threshold) {
      dst[i] = src[i]
    }
  }
}

// 0x41590
export function wipeClear(mask, dst, threshold) {
  for (let i = 0; i < PIXELS; i++) {
    if (mask[i] === threshold) {
      dst[i] = 0
    }
  }
}
