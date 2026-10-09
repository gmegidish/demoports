// The frakcode overlay's drawing, function AH=1 (0x915a SetupFrame and 0x929e Render): a forward-mapping
// rotozoomer on the three-shear rotation (shear x by tan(θ/2), y by sin θ, x again). docs/disassembly/G7_zoomers.md.
// The tables live in the overlay's segment (`overlay` = its linear address) and keep their contents between frames.

// overlay tables
const STEP_TABLE = 0x3e;
const TAN_HALF_TABLE = 0x803e;
const SIN_TABLE = 0x8142;
const COS_TABLE = 0x8246;
const ROW_START_X = 0x834a;
const COLUMN_Y_OFFSET = 0x866a;
const ROW_X_SHIFT = 0x898a;
const ROW_TIMES_320 = 0x8caa;
const TEXTURE_ROWS = 0x8e42;
// overlay variables
const FRAME_INDEX = 0x904c;
const COLUMN_COUNT = 0x904e;
const ROW_COUNT = 0x9052;
const TAN_HALF = 0x9054;
const SIN = 0x9056;
const COS = 0x9058;
const HALF_TAN = 0x905a;
const COLUMN_SLOPE = 0x905c;
const HALF_SIN = 0x905e;
const SHIFT_START = 0x9060;
const SHIFT_SLOPE = 0x9062;
const FIRST_ROW_OFFSET = 0x9066;
const FIRST_COLUMN = 0x9068;
const ROW_ACCUMULATOR = 0x906a;
const ROW_STEPS = 0x923b;
const COLUMN_STEPS = 0x923d;

const GRID_ROWS = 127;
const GRID_COLUMNS = 128;
const SCREEN_CENTRE_ROW = 0x64;
const SCREEN_CENTRE_COLUMN = 0xa0;
const SCREEN_ROWS = 200;
const TEXTURE_ROW_COUNT = 253;
const SCREEN_BYTES = 64000;

/** dx:ax = a * b (unsigned 16 x 16), then al = ah, ah = dl: bits 8..23 of the product. */
function mulHigh(a, b) {
  return Math.floor((a * b) / 256) & 0xffff;
}

const signed16 = (value) => (value << 16) >> 16;

/** frakcode AH=0 (0x9094, 0x90a9): y * 320 for 200 rows, r * 256 - 1 for 253 texture rows. */
export function initFractalTables(m, overlay) {
  for (let y = 0; y < SCREEN_ROWS; y++) {
    m.set16(overlay + ROW_TIMES_320 + y * 2, y * 320);
  }
  // The store comes before the one-time `dec ax`: RT[0] = 0, RT[r] = r * 256 - 1 for r >= 1.
  let value = 0;
  for (let r = 0; r < TEXTURE_ROW_COUNT; r++) {
    m.set16(overlay + TEXTURE_ROWS + r * 2, value);
    if (r === 0) {
      value = (value - 1) & 0xffff;
    }
    value = (value + 0x100) & 0xffff;
  }
}

/** A Bresenham table: `count` words from `address`, value += `increment` whenever the error passes `limit`. */
function fillStepTable(m, address, count, start, slope, limit, increment) {
  let value = start;
  let error = 0;
  for (let i = 0; i < count; i++) {
    m.set16(address + i * 2, value);
    error = (error + slope) & 0xffff;
    if (signed16(error) > signed16(limit)) {
      error = (error - 2 * limit) & 0xffff;
      value = (value + increment) & 0xffff;
    }
  }
}

/** frakcode 0x915a: the shear parameters of frame [904c] / 2 and the three shear tables (90c5, 90f1, 9128). */
function setupFrame(m, overlay) {
  const variable = (offset) => overlay + offset;
  const frameOffset = m.u16(variable(FRAME_INDEX));
  const tanHalf = m.u16(overlay + TAN_HALF_TABLE + frameOffset);
  const sin = m.u16(overlay + SIN_TABLE + frameOffset);
  const cos = m.u16(overlay + COS_TABLE + frameOffset);
  m.set16(variable(TAN_HALF), tanHalf);
  m.set16(variable(SIN), sin);
  m.set16(variable(COS), cos);
  const halfTan = mulHigh(0x80, tanHalf);
  m.set16(variable(HALF_TAN), halfTan);
  const columnCount = (halfTan + 0x81) & 0xffff;
  m.set16(variable(COLUMN_COUNT), columnCount);
  const columnSlope = mulHigh(columnCount, sin);
  m.set16(variable(COLUMN_SLOPE), columnSlope);
  // [9050] is computed here too but never read.
  const rowCount = ((Math.floor((0x80 * cos + 0x80 * sin) / 256) & 0xffff) + 1) & 0xffff;
  const halfSin = Math.floor((0x80 * sin) / 256) & 0xffff;
  m.set16(variable(HALF_SIN), halfSin);
  m.set16(variable(ROW_COUNT), rowCount);
  const shiftSlope = mulHigh((rowCount - halfSin) & 0xffff, tanHalf);
  m.set16(variable(SHIFT_SLOPE), shiftSlope);
  const shiftStart = mulHigh(tanHalf, halfSin);
  m.set16(variable(SHIFT_START), shiftStart);
  const firstRowOffset = ((SCREEN_CENTRE_ROW - (rowCount >> 1)) * 2) & 0xffff;
  m.set16(variable(FIRST_ROW_OFFSET), firstRowOffset);
  const firstColumn = (SCREEN_CENTRE_COLUMN - (rowCount >> 1)) & 0xffff;
  m.set16(variable(FIRST_COLUMN), firstColumn);
  // 90c5: start x of 128 screen rows
  fillStepTable(m, overlay + ((ROW_START_X + firstRowOffset) & 0xffff), GRID_COLUMNS, firstColumn,
    (halfTan * 2) & 0xffff, GRID_COLUMNS, 1);
  // 90f1: 2 * y offset of columnCount screen columns
  fillStepTable(m, overlay + ((COLUMN_Y_OFFSET + firstColumn * 2) & 0xffff), columnCount, (halfSin * 2) & 0xffff,
    (columnSlope * 2) & 0xffff, columnCount, 0xfffe);
  // 9128: x shift of rowCount screen rows
  fillStepTable(m, overlay + ((ROW_X_SHIFT + firstRowOffset) & 0xffff), rowCount, (-shiftStart) & 0xffff,
    ((shiftStart + shiftSlope) * 2) & 0xffff, rowCount, 1);
}

/** frakcode 0x929e: 127 x 128 texture samples, each written to the screen pixel the shear tables give. */
function render(m, overlay, texture) {
  const mem = m.mem;
  const planes = m.vga.planes;
  const word = (offset) => mem[overlay + offset] | (mem[overlay + offset + 1] << 8);
  let accumulator = 0xfffd;
  let rowOffset = word(FIRST_ROW_OFFSET);
  const rowSteps = word(ROW_STEPS);
  const columnSteps = word(COLUMN_STEPS);
  for (let j = 0; j < GRID_ROWS; j++) {
    const startX = word((ROW_START_X + rowOffset) & 0xffff);
    let x = startX;
    let bx = (startX * 2) & 0xffff;
    accumulator = (accumulator + 1 + word(STEP_TABLE + rowSteps + j * 2)) & 0xffff;
    let si = word((TEXTURE_ROWS + accumulator * 2) & 0xffff);
    for (let k = 0; k < GRID_COLUMNS; k++) {
      const yOffset = (word((COLUMN_Y_OFFSET + bx) & 0xffff) + rowOffset) & 0xffff;
      const shift = word((ROW_X_SHIFT + yOffset) & 0xffff);
      const di = (word((ROW_TIMES_320 + yOffset) & 0xffff) + x + shift) & 0xffff;
      if (di < SCREEN_BYTES) {
        planes[di & 3][di >> 2] = mem[texture + si];
      }
      si = (si + 1 + word(STEP_TABLE + columnSteps + k * 2)) & 0xffff;
      x = (x + 1) & 0xffff;
      bx = (bx + 2) & 0xffff;
    }
    rowOffset = (rowOffset + 2) & 0xffff;
  }
  m.set16(overlay + ROW_ACCUMULATOR, accumulator);
}

/** frakcode AH=1: set up frame [904c] / 2 and draw it from the texture buffer at linear `texture`. */
export function drawFractalFrame(m, overlay, texture) {
  setupFrame(m, overlay);
  render(m, overlay, texture);
}
