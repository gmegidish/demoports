// The demo's sine table: 0x11bc0 buildSine fills 641 dwords at 0x9025c with an 8.8 sine of 512 steps
// per turn (peak 257), from a Taylor series in integers. sin 0x11a7d and cos 0x11a70 read it.

const QUARTER = 128;
const TABLE_ENTRIES = 641;
const PI_16_16 = 0x3243f;
const CUBE_DIVISOR = 0x60000;
const FIFTH_DIVISOR = 0x140000;
const ANGLE_MASK = 511;

function buildSine() {
  const table = new Int32Array(TABLE_ENTRIES);
  for (let i = 0; i <= QUARTER; i++) {
    const x = (i * PI_16_16) >>> 16;
    const cube = Math.floor((x * x * x) / CUBE_DIVISOR);
    const value = x - cube + Math.floor((cube * x * x) / FIFTH_DIVISOR);
    table[i] = value;
    table[256 - i] = value;
    table[512 + i] = value;
    table[256 + i] = -value;
    table[512 - i] = -value;
  }
  return table;
}

/** 0x9025c, the table itself. */
export const SINE = buildSine();

/** 0x11a7d: 8.8 sine of a = 0..511 per turn. */
export function sin(a) {
  return SINE[a & ANGLE_MASK];
}

/** 0x11a70: 8.8 cosine. */
export function cos(a) {
  return SINE[(a & ANGLE_MASK) + QUARTER];
}
