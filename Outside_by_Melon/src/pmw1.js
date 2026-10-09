// OUTSIDE.EXE is a PMODE/W 1.33 stub followed by a PMW1 executable: the
// Watcom LE program re-packed by PMWLITE. Each object and each block of
// fixups is compressed with the same LZ coder the stub uses on itself.
// This is the loader of the stub (its code at 0x254b and 0x2880..0x2a18).

export const CODE_BASE = 0x10000
export const DATA_BASE = 0x40000

const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0
const u16 = (b, o) => b[o] | b[o + 1] << 8

// decompresses from src[pos..] into dst at out; returns [end of input, end of output]
export function unlite(src, pos, dst, out) {
  let bits = 0, left = 0
  const bit = () => {
    if (--left < 0) {
      bits = u32(src, pos); pos += 4; left = 31
    }
    const b = bits >>> 31
    bits = bits << 1 >>> 0
    return b
  }
  const copy = (dist, n) => {
    for (let i = 0; i < n; i++) {
      dst[out] = dst[out - dist]; out++
    }
  }
  dst[out++] = src[pos++]
  for (;;) {
    if (!bit()) {
      dst[out++] = src[pos++]
      continue
    }
    let off = src[pos++]
    if (!bit()) {
      if (!bit()) {
        if (off === 0) {
          return [pos, out]
        }
        copy(off, 2)
        continue
      }
      let hi = 0
      for (let i = 0; i < 3; i++) {
        hi = hi << 1 | bit()
      }
      copy((hi << 8 | off) + 1, 2)
      continue
    }
    let hi = 0
    if (bit()) {
      const n = (1 + bit()) << 1
      for (let i = 0; i < n; i++) {
        hi = (hi << 1 | bit()) & 0xff
      }
    }
    let len = 0
    for (let k = 3; k <= 6 && !len; k++) {
      if (bit()) {
        len = k
      }
    }
    if (!len) {
      if (bit()) {
        len = src[pos++] + 15
      } else {
        len = 7 + (bit() << 2 | bit() << 1 | bit())
      }
    }
    copy((hi << 8 | off) + 1, len)
  }
}

// returns { mem, eip, esp, objects } with the program's two objects loaded at
// CODE_BASE and DATA_BASE in a flat memory of memSize bytes, fixups applied
export function loadPmw1(exe, memSize) {
  const h = findPmw1(exe)
  if (h < 0) {
    throw new Error('no PMW1 executable in OUTSIDE.EXE')
  }
  const mem = new Uint8Array(memSize)
  const bases = [CODE_BASE, DATA_BASE]
  const nObj = u32(exe, h + 0x1c)
  const objTab = h + u32(exe, h + 0x18)
  const fixups = h + u32(exe, h + 0x20)
  let data = h + u32(exe, h + 0x24)
  const objects = []
  for (let i = 0; i < nObj; i++) {
    const e = objTab + i * 0x18
    const o = {
      base: bases[i], vsize: u32(exe, e), packed: u32(exe, e + 4), flags: u32(exe, e + 8),
      fixOff: u32(exe, e + 12), fixBlocks: u32(exe, e + 16), size: u32(exe, e + 20),
    }
    const [, end] = unlite(exe, data, mem, o.base)
    if (end - o.base !== o.size) {
      throw new Error(`object ${i + 1}: unpacked ${end - o.base} bytes, expected ${o.size}`)
    }
    data += o.packed
    objects.push(o)
  }
  const buf = new Uint8Array(0x10000)
  for (const o of objects) {
    let pos = fixups + o.fixOff
    for (let b = 0; b < o.fixBlocks; b++) {
      const packed = u16(exe, pos), size = u16(exe, pos + 2)
      unlite(exe, pos + 4, buf, 0)
      pos += 4 + packed
      for (let p = 0; p < size; p += 10) {
        applyFixup(mem, o.base, buf, p, bases)
      }
    }
  }
  return {
    mem, objects,
    eip: bases[u32(exe, h + 8) - 1] + u32(exe, h + 12),
    esp: bases[u32(exe, h + 16) - 1] + u32(exe, h + 20),
  }
}

function findPmw1(exe) {
  for (let i = 0; i + 4 <= exe.length; i++) {
    if (u32(exe, i) === 0x31574d50) {
      return i
    }
  }
  return -1
}

// record: type byte, source offset dword, target object byte (1-based), target offset dword
function applyFixup(mem, base, rec, p, bases) {
  const type = rec[p] & 0x0f
  const src = u32(rec, p + 1) | 0
  const target = (bases[rec[p + 5] - 1] + u32(rec, p + 6)) >>> 0
  if (src < 0) {
    return
  }
  const at = base + src
  if (type === 7) {
    mem[at] = target; mem[at + 1] = target >>> 8; mem[at + 2] = target >>> 16; mem[at + 3] = target >>> 24
  } else if (type === 8) {
    const rel = (target - (at + 4)) >>> 0
    mem[at] = rel; mem[at + 1] = rel >>> 8; mem[at + 2] = rel >>> 16; mem[at + 3] = rel >>> 24
  } else if (type !== 2) {
    // selectors (type 2) stay 0 in a flat memory; nothing else is expected in a Watcom flat program
    throw new Error(`unexpected fixup type ${type} at ${at.toString(16)}`)
  }
}
