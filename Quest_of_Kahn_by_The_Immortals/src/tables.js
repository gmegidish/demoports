// Colour-mixing lookup tables. The demo is 8-bit: "add these two colours" means "find the palette
// entry closest to their sum", precomputed for all 256 x 256 pairs. KAHN.EXE 0x10770, 0x108e4, 0x10a28.

const COLOURS = 256;
const TABLE_BYTES = COLOURS * COLOURS;
const DAC_MAX = 63;
/** The search starts from this distance; three 6-bit channels can differ by 189 at most, so something always wins. */
const WORST_DISTANCE = 0xc0;

/**
 * First palette entry with the smallest sum of absolute channel differences.
 * The original keeps the running distance in a byte and replaces only on strictly smaller.
 */
function nearestColour(palette, r, g, b) {
  let best = 0;
  let bestDistance = WORST_DISTANCE;
  for (let k = 0; k < COLOURS; k++) {
    const distance = (Math.abs(palette[k * 3] - r) + Math.abs(palette[k * 3 + 1] - g) + Math.abs(palette[k * 3 + 2] - b)) & 0xff;
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
 * table[a << 8 | b] = the colour nearest to a + b, each channel clamped to the DAC maximum. 0x10770.
 * @param {Uint8Array} palette 256 RGB triplets, 0..63
 */
export function buildAdditiveTable(palette) {
  return buildSymmetricTable(palette, (a, b) => Math.min(a + b, DAC_MAX));
}

/** table[a << 8 | b] = the colour nearest to the average of a and b. 0x108e4. */
export function buildAverageTable(palette) {
  return buildSymmetricTable(palette, (a, b) => (a + b) >> 1);
}

/**
 * table[row << 8 | column] = the colour nearest to rowWeight * row + columnWeight * column. 0x10a28.
 * Each channel is truncated toward zero and stored in a byte without clamping, as the original does.
 */
export function buildWeightedTable(palette, rowWeight, columnWeight) {
  const table = new Uint8Array(TABLE_BYTES);
  // The weights arrive as 32-bit floats; the sum is formed at full precision.
  const rowFactor = Math.fround(rowWeight);
  const columnFactor = Math.fround(columnWeight);
  const mixChannel = (row, column) => Math.trunc(row * rowFactor + column * columnFactor) & 0xff;
  for (let row = 0; row < COLOURS; row++) {
    for (let column = 0; column < COLOURS; column++) {
      table[(row << 8) | column] = nearestColour(
        palette,
        mixChannel(palette[row * 3], palette[column * 3]),
        mixChannel(palette[row * 3 + 1], palette[column * 3 + 1]),
        mixChannel(palette[row * 3 + 2], palette[column * 3 + 2]),
      );
    }
  }
  return table;
}

/**
 * Mix a whole buffer into another through a table: dst = table[src << 8 | dst]. 0x106a0.
 */
export function blendBuffers(destination, source, table) {
  for (let i = 0; i < destination.length; i++) {
    destination[i] = table[(source[i] << 8) | destination[i]];
  }
}

const BRIGHTEN_LEVELS = 64;
/** Levels below this add half the level to each channel; the last four jump to full white. */
const BRIGHTEN_KNEE = 60;

/**
 * table[colour << 8 | level] = the colour nearest to `colour` brightened by a level of 0..63:
 * the lamp's light cone in the meeting. Only the first 64 columns of each row are filled. 0x14c30.
 */
export function buildBrightenTable(palette) {
  const table = new Uint8Array(TABLE_BYTES);
  for (let level = 0; level < BRIGHTEN_LEVELS; level++) {
    const added = level < BRIGHTEN_KNEE ? level >> 1 : 30 + 11 * (level - BRIGHTEN_KNEE);
    for (let colour = 0; colour < COLOURS; colour++) {
      table[(colour << 8) + level] = nearestColour(
        palette,
        Math.min(palette[colour * 3] + added, DAC_MAX),
        Math.min(palette[colour * 3 + 1] + added, DAC_MAX),
        Math.min(palette[colour * 3 + 2] + added, DAC_MAX),
      );
    }
  }
  return table;
}

/** Past this row every colour has reached white. */
const LIGHT_ROWS = 5;

/**
 * table[light << 8 | colour] = the colour nearest to `colour` moved a quarter of the way to white
 * per unit of light. The shadows part reads a light map as the row. 0x1853c.
 */
export function buildLightTable(palette) {
  const table = new Uint8Array(TABLE_BYTES);
  const lit = (channel, light) => Math.min(Math.trunc((DAC_MAX - channel) * 0.25 * light + channel), DAC_MAX);
  for (let light = 0; light < LIGHT_ROWS; light++) {
    for (let colour = 0; colour < COLOURS; colour++) {
      table[(light << 8) + colour] = nearestColour(
        palette,
        lit(palette[colour * 3], light),
        lit(palette[colour * 3 + 1], light),
        lit(palette[colour * 3 + 2], light),
      );
    }
  }
  for (let light = LIGHT_ROWS; light < COLOURS; light++) {
    table.copyWithin(light << 8, (LIGHT_ROWS - 1) << 8, LIGHT_ROWS << 8);
  }
  return table;
}
