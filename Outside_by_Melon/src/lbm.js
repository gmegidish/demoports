// Deluxe Paint PBM files (IFF FORM PBM: chunky 8-bit pixels, ByteRun1 compression), the
// format of every picture in DATA/. Returns the picture and its CMAP as stored (8-bit values).

const id = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
const be32 = (b, o) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0
const be16 = (b, o) => b[o] << 8 | b[o + 1]

export function decodeLbm(bytes, name = 'LBM') {
  if (id(bytes, 0) !== 'FORM' || id(bytes, 8) !== 'PBM ') {
    throw new Error(`${name}: not an IFF PBM file`)
  }
  let width = 0, height = 0, compression = 0, cmap = null, pixels = null
  for (let p = 12; p + 8 <= bytes.length;) {
    const chunk = id(bytes, p), size = be32(bytes, p + 4), body = p + 8
    if (chunk === 'BMHD') {
      width = be16(bytes, body)
      height = be16(bytes, body + 2)
      compression = bytes[body + 10]
    } else if (chunk === 'CMAP') {
      cmap = bytes.slice(body, body + size)
    } else if (chunk === 'BODY') {
      pixels = unpackBody(bytes, body, size, width + (width & 1), height, compression)
    }
    p = body + size + (size & 1)
  }
  if (!pixels) {
    throw new Error(`${name}: no BODY chunk`)
  }
  return { width, height, pixels: cropRows(pixels, width, height), cmap }
}

// rows are stored padded to an even width
function unpackBody(bytes, at, size, stride, height, compression) {
  const out = new Uint8Array(stride * height)
  if (compression === 0) {
    out.set(bytes.subarray(at, at + Math.min(size, out.length)))
    return out
  }
  let o = 0
  for (let p = at, end = at + size; p < end && o < out.length;) {
    const n = bytes[p++]
    if (n < 128) {
      for (let i = 0; i <= n; i++) {
        out[o++] = bytes[p++]
      }
    } else if (n > 128) {
      const v = bytes[p++]
      for (let i = 0; i < 257 - n; i++) {
        out[o++] = v
      }
    }
  }
  return out
}

function cropRows(pixels, width, height) {
  if (!(width & 1)) {
    return pixels
  }
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    out.set(pixels.subarray(y * (width + 1), y * (width + 1) + width), y * width)
  }
  return out
}
