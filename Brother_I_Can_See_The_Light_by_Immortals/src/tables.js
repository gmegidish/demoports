// Colour-mixing lookup tables. The demo is 8-bit: "add these two colours" means "find the palette


const COLOURS = 256;
const TABLE_BYTES = COLOURS * COLOURS;
const DAC_MAX = 63;
/** The search starts from this distance; three 6-bit channels can differ by 189 at most, so something always wins. */
const WORST_DISTANCE = 0xc0;

/**
 * First palette entry with the smallest sum of absolute channel differences.
 * The distance is a full integer (Kahn kept it in a byte; it never exceeds 189 either way) and
 * only a strictly smaller one replaces the best.
 */
function nearestColour(palette, r, g, b) {
  let best = 0;
  let bestDistance = WORST_DISTANCE;
  for (let k = 0; k < COLOURS; k++) {
    const distance = Math.abs(palette[k * 3] - r) + Math.abs(palette[k * 3 + 1] - g) + Math.abs(palette[k * 3 + 2] - b);
    if (distance < bestDistance) {
      best = k;
      bestDistance = distance;
    }
  }
  return best;
}

/** Both orders of a pair share one search: the mix is symmetric. */
function buildSymmetricTable(palette, mixChannel) {
  const table = new Uint8Array(TABLE_BYTES);
  for (let i = 0; i < COLOURS; i++) {
    for (let j = i; j < COLOURS; j++) {
      const colour = nearestColour(
        palette,
        mixChannel(palette[i * 3], palette[j * 3]),
        mixChannel(palette[i * 3 + 1], palette[j * 3 + 1]),
        mixChannel(palette[i * 3 + 2], palette[j * 3 + 2]),
      );
      table[(i << 8) | j] = colour;
      table[(j << 8) | i] = colour;
    }
  }
  return table;
}

/**
 * table[a << 8 | b] = the colour nearest to a + b, each channel clamped to the DAC maximum. 0x10908.
 * @param {Uint8Array} palette 256 RGB triplets, 0..63
 */
export function buildAdditiveTable(palette) {
  return buildSymmetricTable(palette, (a, b) => Math.min(a + b, DAC_MAX));
}

const SHADE_LEVELS = 64;

/**
 * table[colour << 8 | level] = the colour nearest to `colour` darkened to level/63, for levels
 * 0..63; the other 192 columns of each row are never written. Integer maths, truncating. 0x11780.
 */
export function buildShadeTable(palette) {
  const table = new Uint8Array(TABLE_BYTES);
  for (let level = 0; level < SHADE_LEVELS; level++) {
    for (let colour = 0; colour < COLOURS; colour++) {
      table[(colour << 8) | level] = nearestColour(
        palette,
        Math.trunc((palette[colour * 3] * level) / DAC_MAX),
        Math.trunc((palette[colour * 3 + 1] * level) / DAC_MAX),
        Math.trunc((palette[colour * 3 + 2] * level) / DAC_MAX),
      );
    }
  }
  return table;
}
