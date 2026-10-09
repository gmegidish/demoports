// The zoomcde2 overlay's 100 generated span scalers (overlay offsets 0x0013..0x7df3, entry table at 0xa568).
// docs/disassembly/G7_zoomers.md, "Span routine s". Each routine is `add di, x0` followed by W byte copies from
// the source row; this module rebuilds what each one copies: W(s) = floor(16 (s + 1) / 5) pixels, centred, from
// source column floor(k * 320 / W), except 22 entries the generator rounded down by one.

export const SCALER_COUNT = 100;
const SCREEN_WIDTH = 320;

/** The entries where the generated code differs from floor(k * 320 / W): width -> [k, source column, ...]. */
const SOURCE_COLUMN_EXCEPTIONS = new Map([
  [28, [21, 239]],
  [112, [21, 59, 42, 119, 77, 219, 84, 239]],
  [224, [21, 29, 42, 59, 77, 109, 84, 119, 154, 219, 161, 229, 168, 239, 175, 249]],
  [236, [177, 239]],
  [275, [55, 63, 110, 127, 220, 255]],
  [278, [139, 159]],
]);

/**
 * @typedef {object} Scaler
 * @property {number} left the `add di, x0` of the routine: (320 - width) >> 1
 * @property {number} width the number of pixels it copies
 * @property {Int16Array} sourceColumns the source column of each copied pixel
 */

function buildScaler(index) {
  const width = Math.floor((16 * (index + 1)) / 5);
  const sourceColumns = new Int16Array(width);
  for (let k = 0; k < width; k++) {
    sourceColumns[k] = Math.floor((k * SCREEN_WIDTH) / width);
  }
  const exceptions = SOURCE_COLUMN_EXCEPTIONS.get(width) ?? [];
  for (let i = 0; i < exceptions.length; i += 2) {
    sourceColumns[exceptions[i]] = exceptions[i + 1];
  }
  return { left: (SCREEN_WIDTH - width) >> 1, width, sourceColumns };
}

/** @type {Scaler[]} scaler s of the overlay */
export const SCALERS = Array.from({ length: SCALER_COUNT }, (_, index) => buildScaler(index));

/**
 * Runs scaler `index` (an overlay `call dx` / `call ax`): copies source row bytes m.mem[sourceRow + column] to the
 * mode 13h screen at destinationRow + left + k. Returns di after the routine: destinationRow + left + width.
 */
export function runScaler(vga, mem, index, sourceRow, destinationRow) {
  const { left, width, sourceColumns } = SCALERS[index];
  const planes = vga.planes;
  let di = destinationRow + left;
  for (let k = 0; k < width; k++, di++) {
    const address = di & 0xffff;
    planes[address & 3][address >> 2] = mem[sourceRow + sourceColumns[k]];
  }
  return di;
}
