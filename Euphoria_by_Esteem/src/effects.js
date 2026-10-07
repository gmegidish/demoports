// Unit 179b: 8-bit effects on 320x200 linear pages, plus the palette preset of unit 1856.
// Notes: L5_units.md "179b", "1856".
import { PAGE_SIZE, roundHalfEven } from './machine.js';
import { gradient } from './gfx.js';

export { darkenActivePage as fadePage } from './gfx.js';

const W = 320;
const LAST_ROW = 199 * W;

/** DS:5aec, built at start-up by 179b:0711 from 179b:0531: round(sin(x)*ln(x+1)*43)+75, x = i*pi/128. */
export const WAVE_TABLE = Uint8Array.from({ length: 256 }, (_, i) => {
  const x = (i * Math.PI) / 128;
  return (roundHalfEven(Math.sin(x) * Math.log(x + 1) * 43) + 75) & 0xff;
});

/** 179b:002f: a running 4-tap blur written in place (the left neighbour is the value just written). */
export function blur(m) {
  blurDecay(m, null);
}

/** 179b:0097: blur, with the middle rows darkened by d where non-zero (zero results are not written). */
export function blurDecay(m, d) {
  const P = m.active;
  let v = 0;
  for (let i = 0; i < W; i++) {
    v = (v + P[i + W] + P[i + 1]) >> 2;
    P[i] = v;
  }
  for (let row = 1; row < 199; row++) {
    v = 0;
    for (let i = row * W; i < row * W + W; i++) {
      v = (v + P[i - W] + P[i + W] + P[i + 1]) >> 2;
      if (d === null) {
        P[i] = v;
      } else if (v !== 0) {
        v = Math.max(v - d, 0);
        P[i] = v;
      }
    }
  }
  v = 0;
  for (let i = LAST_ROW; i < PAGE_SIZE; i++) {
    v = (v + P[i - W] + P[i + 1]) >> 2;
    P[i] = v;
  }
}

/** 179b:0276: T[a*128+b] = trunc(((65-k)*a)/64 + (b*k)/64), 16-bit unsigned products. */
export function buildBlendTable(k) {
  const T = new Uint8Array(16384);
  for (let a = 0; a < 128; a++) {
    for (let b = 0; b < 128; b++) {
      T[a * 128 + b] = Math.trunc((((65 - k) * a) & 0xffff) / 64 + ((b * k) & 0xffff) / 64);
    }
  }
  return T;
}

/** 179b:0110: B = T[(A << 7) | B]. */
export function blendPages(m, T, srcPage, dstPage) {
  const A = m.getPage(srcPage);
  const B = m.getPage(dstPage);
  for (let i = 0; i < PAGE_SIZE; i++) {
    B[i] = T[((A[i] << 7) | B[i]) & 0xffff];
  }
}

/** 179b:018c: dword-wise (src+dst)>>1 with carries crossing bytes; the last 4 bytes are untouched. */
export function averagePages(m, dstPage, srcPage) {
  const src = m.getPage(srcPage);
  const dst = m.getPage(dstPage);
  const s32 = new Uint32Array(src.buffer, src.byteOffset, 16000);
  const d32 = new Uint32Array(dst.buffer, dst.byteOffset, 16000);
  for (let i = 0; i < 15999; i++) {
    const sum = s32[i] + d32[i];
    if ((sum >>> 0) !== 0) {
      d32[i] = ((sum >>> 1) & 0x7f7f7f7f) >>> 0;
    }
  }
}

/** 179b:01cc: fire. S is a separate buffer view; dst gets min(v, cap) for i <= 63360. */
export function fire(S, dst, cap) {
  for (let i = 0; i < 63680; i++) {
    let v = (S[i] + S[i + 319] + S[i + 320] + S[i + 321]) >> 2;
    if (v !== 0) {
      v--;
      S[i] = v;
      if (i <= 63360) {
        dst[i] = Math.min(v, cap);
      }
    }
  }
}

/** 179b:021a: fire with shifted neighbours; then 320 bytes at offset 63700 of the buffer are cleared. */
export function fire2(S, dst, cap, offset) {
  for (let i = 0; i < 63680; i++) {
    let v = (S[i] + S[i + offset + 219] + S[i + offset + 220] + S[i + offset + 221]) >> 2;
    if (v !== 0) {
      v--;
      S[i] = v;
    }
    dst[i] = Math.min(v, cap);
  }
  S.fill(0, 63700, 64020);
}

/** 179b:060b: rows 10..189 of src displaced by the wave table into dst. */
export function wobble(m, srcPage, dstPage, speed) {
  const state = m.wobblePhases;
  const T = WAVE_TABLE;
  const src = m.getPage(srcPage);
  const dst = m.getPage(dstPage);
  state.ph1 = (state.ph1 - speed) & 0xff;
  state.ph2 = (state.ph2 + speed) & 0xff;
  let s = 3200;
  let d = 3200;
  for (let row = 10; row < 190; row++) {
    const p = T[(row + state.ph1) & 0xff];
    const q = T[state.ph2];
    const vy = Math.abs((T[(row + q) & 0xff] >> 4) - 8);
    for (let x = 0; x < 320; x++) {
      const vx = Math.abs((T[((x & 0xff) + p) & 0xff] >> 4) - 8);
      dst[d++] = src[(s + (vy - 4) * 320 + vx) & 0xffff];
      s++;
    }
  }
}

/** 179b:02f6: white -> yellow -> red -> black, from colour n downwards; the rest black. */
export function fireRamp(m, n) {
  const pal = new Int16Array(768);
  const k = 64 / (n / 3);
  const q = Math.trunc(n / 3);
  let idx = n;
  const put = (r, g, b) => {
    pal[idx * 3] = r;
    pal[idx * 3 + 1] = g;
    pal[idx * 3 + 2] = b;
    idx = (idx - 1) & 0xff;
  };
  for (let j = q; j >= 1; j--) {
    put(63, 63, roundHalfEven(j * k));
  }
  for (let j = q; j >= 0; j--) {
    put(63, roundHalfEven(j * k), 1);
  }
  for (let j = q; j >= 0; j--) {
    put(roundHalfEven(j * k), 0, 1);
  }
  m.setPalette(pal);
}

/** 1856:0000 with the only preset used (n = 10, DS:250a). */
export function presetGradient(m) {
  const c = [[11, 38, 60], [63, 63, 63], [63, 40, 0], [6, 6, 63]];
  gradient(m, 0x21, 0x40, ...c[0], ...c[1]);
  gradient(m, 0x40, 0x5f, ...c[1], ...c[2]);
  gradient(m, 0x5f, 0x7f, ...c[2], ...c[3]);
}
