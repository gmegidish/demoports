// The 80x25 colour text mode the demo ends in: 9x16 cells, the VGA ROM font, the 16 attribute
// colours through the attribute controller's default palette registers into the DAC.
import { dacTo8 } from './machine.js';

const COLUMNS = 80;
const ROWS = 25;
const CELL_WIDTH = 9;
const CELL_HEIGHT = 16;
/** Default EGA attribute registers: text colour i is DAC entry ATTRIBUTE_TO_DAC[i]. */
export const ATTRIBUTE_TO_DAC = [0, 1, 2, 3, 4, 5, 20, 7, 56, 57, 58, 59, 60, 61, 62, 63];
/** DS:2560: the default text colours, 6-bit. */
export const TEXT_COLOURS = [
  [0, 0, 0], [0, 0, 42], [0, 42, 0], [0, 42, 42], [42, 0, 0], [42, 0, 42], [42, 42, 0], [42, 42, 42],
  [21, 21, 21], [21, 21, 63], [21, 63, 21], [21, 63, 63], [63, 21, 21], [63, 21, 63], [63, 63, 21], [63, 63, 63],
];

/** `font` is the 4096-byte 8x16 ROM font; the 9th column repeats the 8th for the line characters. */
export function renderTextScreen(m, font) {
  const width = COLUMNS * CELL_WIDTH;
  const height = ROWS * CELL_HEIGHT;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const colour = (attribute) => {
    const d = ATTRIBUTE_TO_DAC[attribute] * 3;
    return [dacTo8(m.dac[d]), dacTo8(m.dac[d + 1]), dacTo8(m.dac[d + 2])];
  };
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLUMNS; col++) {
      const cell = (row * COLUMNS + col) * 2;
      const ch = m.textScreen[cell];
      const attr = m.textScreen[cell + 1];
      const fg = colour(attr & 15);
      const bg = colour((attr >> 4) & 7);
      for (let y = 0; y < CELL_HEIGHT; y++) {
        const bits = font[ch * CELL_HEIGHT + y];
        for (let x = 0; x < CELL_WIDTH; x++) {
          const isLineChar = ch >= 0xc0 && ch <= 0xdf;
          const on = x < 8 ? (bits >> (7 - x)) & 1 : isLineChar ? bits & 1 : 0;
          const c = on ? fg : bg;
          const p = ((row * CELL_HEIGHT + y) * width + col * CELL_WIDTH + x) * 4;
          rgba[p] = c[0];
          rgba[p + 1] = c[1];
          rgba[p + 2] = c[2];
          rgba[p + 3] = 255;
        }
      }
    }
  }
  return { width, height, rgba };
}
