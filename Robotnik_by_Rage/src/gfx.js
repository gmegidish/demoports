// Image helpers several parts share (0x10000..0x12fff, 0x1d000..0x1e2ff). All buffers are 8-bit.

const WIDTH = 320;
const HEIGHT = 200;
const SCREEN_BYTES = WIDTH * HEIGHT;

/** 0x10db7 zoomBlit: stretch the rectangle (x0,y0)-(x1,y1) of a 320-wide image over 320x200. */
export function zoomBlit(src, dst, x0, y0, x1, y1) {
  const dy = Math.trunc(((y1 - y0) * 65536) / HEIGHT);
  const dx = Math.trunc(((x1 - x0) * 65536) / WIDTH);
  let yf = (y0 << 16) | 0;
  let d = 0;
  for (let row = 0; row < HEIGHT; row++, yf = (yf + dy) | 0) {
    const s = (yf >>> 16) * WIDTH;
    let xf = (x0 << 16) | 0;
    for (let k = 0; k < WIDTH; k++, xf = (xf + dx) | 0) {
      dst[d++] = src[s + (xf >>> 16)];
    }
  }
}

/**
 * The centred zoom rectangle of 0x203ac, 0x2850c and 0x285e8 for a zoom amount `a` (1/256 of the
 * half size): a = 0 is the whole screen, a = 128 its centre pixel. Returns [x0, y0, x1, y1] for zoomBlit.
 */
export function zoomRectangle(a) {
  return [
    Math.max(a * 320, 0) >> 8,
    Math.max(a * 200, 0) >> 8,
    Math.min(0x14000 - a * 320, 0x13f00) >> 8,
    Math.min(0xc800 - a * 200, 0xc700) >> 8,
  ];
}

/** 0x1d1a0 scale: nearest-neighbour resample of srcW x srcH into dstW x dstH. */
export function scale(src, srcW, srcH, dst, dstW, dstH) {
  const sx = Math.trunc((srcW << 16) / dstW);
  const sy = Math.trunc((srcH << 16) / dstH);
  let d = 0;
  for (let y = 0, yf = 0; y < dstH; y++, yf += sy) {
    const s = (yf >> 16) * srcW;
    for (let x = 0, xf = 0; x < dstW; x++, xf += sx) {
      dst[d++] = src[s + (xf >> 16)];
    }
  }
}

/** 0x11b5d blurWrap: 2x2 box average with indices wrapping mod w*h; in place when src === dst. */
export function blurWrap(src, dst, w, h) {
  const n = w * h;
  for (let c = 0; c < n; c++) {
    dst[c] = (src[c] + src[(c + 1) % n] + src[(c + 1 + w) % n] + src[(c + w) % n] + 2) >> 2;
  }
}

/** 0x1d254 nearestColor: weighted 2R+7G+B distance, the first best match. */
export function nearestColor(palette, r, g, b) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < 256; i++) {
    const d = 2 * Math.abs(palette[i * 3] - r) + 7 * Math.abs(palette[i * 3 + 1] - g) + Math.abs(palette[i * 3 + 2] - b);
    if (d === 0) {
      return i;
    }
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

/** 0x1d340 buildBrightenTable: N tables of 256, table L = palette brightened by (L*step)>>8. */
export function buildBrightenTable(levels, palette, out = new Uint8Array(levels * 256)) {
  for (let c = 0; c < 256; c++) {
    out[c] = c;
  }
  const step = Math.trunc(0x4000 / (levels - 1));
  let acc = 0;
  for (let level = 1; level < levels; level++) {
    acc += step;
    const add = acc >> 8;
    for (let c = 0; c < 256; c++) {
      out[level * 256 + c] = nearestColor(palette,
        Math.min(palette[c * 3] + add, 63), Math.min(palette[c * 3 + 1] + add, 63), Math.min(palette[c * 3 + 2] + add, 63));
    }
  }
  return out;
}

/** 0x119e0 shadeShifted: dst = L[((src >> shift) + add) & 0xff][dst]. */
export function shadeShifted(src, dst, table, shift, add) {
  for (let i = 0; i < SCREEN_BYTES; i++) {
    dst[i] = table[(((src[i] >> shift) + add) & 0xff) * 256 + dst[i]];
  }
}

/** 0x11a02 shadeClamped: dst = table[min(src, max)][dst]. */
export function shadeClamped(src, dst, table, max) {
  for (let i = 0; i < SCREEN_BYTES; i++) {
    dst[i] = table[Math.min(src[i], max) * 256 + dst[i]];
  }
}

/** 0x1d648 mirrorRows: reverse each row in place. */
export function mirrorRows(buffer, rowLength, rows) {
  for (let r = 0; r < rows; r++) {
    buffer.subarray(r * rowLength, (r + 1) * rowLength).reverse();
  }
}
