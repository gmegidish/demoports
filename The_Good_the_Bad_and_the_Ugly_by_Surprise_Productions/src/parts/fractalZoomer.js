// Rotating-Fractal-zoomer (Erik), 0d34:04e1 with the code overlay frakcode. docs/disassembly/G7_zoomers.md.
// Mode 13h. A square of the fractal rotates 90 degrees and zooms in 2x, 128 frames per picture, through the 11
// pictures '0'..'10' (each the magnified centre of the previous one); the next picture is unpacked two rows per
// tick into the other texture buffer meanwhile. Then the palette fades to black.
import { linear, waitTick } from '../machine.js';
import { unpackRle, setDac, fadePalette } from '../library.js';
import { initFractalTables, drawFractalFrame } from './fractalRender.js';

const SEGMENT = 0x0d34;
const at = (offset) => linear(SEGMENT, offset);

const OVERLAY_NAME = at(0x00);
const OVERLAY_POINTER = at(0x08);
const PICTURE_NAMES = at(0x0a);
const PICTURE_NAME_BYTES = 8;
const PICTURE_COUNT = 11;
const BUFFER_A_POINTER = at(0x62);
const BUFFER_B_POINTER = at(0x64);
const PALETTE = at(0x1de);
const LAST_TICKS = at(0x1dc);
const ITERATION_BYTE = at(0x4e0);
const FADE_BLOCK_POINTER = at(0x4de);

// overlay header and variables (offsets in frakcode's segment)
const OVERLAY_BUFFER_A = 0x16;
const OVERLAY_BUFFER_B = 0x18;
const NEXT_PICTURE = 0x9048;
const BUFFER_TOGGLE = 0x904a;
const FRAME_INDEX = 0x904c;
const SOURCE_OFFSET = 0x906c;
const DESTINATION_OFFSET = 0x906e;
const ROW_STEPS = 0x923b;
const COLUMN_STEPS = 0x923d;

const TEXTURE_PARAGRAPHS = 0x1000;
const TEXTURE_FILL_BYTES = 0xffff;
const BORDER_COLOUR = 0xff;
const PICTURE_ROWS = 0xf8;
const PICTURE_ROW_BYTES = 0xf8;
const TEXTURE_ROW_GAP = 8;
/** Texel (4, 4): where row 0 of a picture goes. */
const PICTURE_ORIGIN = 0x404;
const DECODE_END = 0xfa00;
const BUFFER_TOGGLE_DECODES_INTO_B = 2;
const LAST_FRAME_OFFSET = 0xfe;
const FRAME_STEP_BYTES = 0x100;
const PICTURE_LIST_END = 0x16;
const ITERATIONS = 0x580;
const SCREEN_BYTES = 64000;

const FADE_BLOCK_PARAGRAPHS = 0x91;
const FADE_BLOCK_CLEAR = 0x900;
const PALETTE_BYTES = 0x300;
const FADE_COLOURS = 0xff;
const FADE_STEPS = 0x46;

const INPUT_STATUS = 0x3da;
const ATTRIBUTE_PORT = 0x3c0;
const OVERSCAN_REGISTER = 0x11;
const DAC_WRITE_INDEX = 0x3c8;
const DAC_DATA = 0x3c9;

/** RLE-unpacks `rows` picture rows of 248 bytes, each followed by the 8-byte gap; returns the new [source, dest]. */
function unpackRows(m, pictureSegment, sourceOffset, textureSegment, destinationOffset, rows) {
  let si = sourceOffset;
  let di = destinationOffset;
  for (let r = 0; r < rows; r++) {
    si = unpackRle(m, linear(pictureSegment, si), linear(textureSegment, di), PICTURE_ROW_BYTES) - linear(pictureSegment, 0);
    di += PICTURE_ROW_BYTES + TEXTURE_ROW_GAP;
  }
  return [si, di];
}

/** 0d34:0066: load the pictures, two 256x256 texture buffers with a black border, picture 0 into A, screen black. */
function fractalInit(m, overlay) {
  for (let p = 0; p < PICTURE_COUNT; p++) {
    m.loadResource(PICTURE_NAMES + p * PICTURE_NAME_BYTES, BUFFER_A_POINTER);
    m.set16(overlay + p * 2, m.u16(BUFFER_A_POINTER));
  }
  const bufferA = m.allocTo(BUFFER_A_POINTER, TEXTURE_PARAGRAPHS);
  const bufferB = m.allocTo(BUFFER_B_POINTER, TEXTURE_PARAGRAPHS);
  m.mem.fill(BORDER_COLOUR, linear(bufferA, 0), linear(bufferA, TEXTURE_FILL_BYTES));
  m.mem.fill(BORDER_COLOUR, linear(bufferB, 0), linear(bufferB, TEXTURE_FILL_BYTES));
  m.set16(overlay + OVERLAY_BUFFER_A, bufferA);
  m.set16(overlay + OVERLAY_BUFFER_B, bufferB);
  unpackRows(m, m.u16(overlay), 0, bufferA, PICTURE_ORIGIN, PICTURE_ROWS);
  const vga = m.vga;
  vga.out8(DAC_WRITE_INDEX, BORDER_COLOUR);
  vga.out8(DAC_DATA, 0);
  vga.out8(DAC_DATA, 0);
  vga.out8(DAC_DATA, 0);
  for (let i = 0; i < SCREEN_BYTES; i++) {
    vga.planes[i & 3][i >> 2] = BORDER_COLOUR;
  }
  return bufferA;
}

/** frakcode 0x9241: unpack two more rows of the next picture into the buffer not on display. */
function decodeStep(m, overlay) {
  const destination = m.u16(overlay + DESTINATION_OFFSET);
  if (destination >= DECODE_END) {
    return;
  }
  const isIntoB = m.u8(overlay + BUFFER_TOGGLE) === BUFFER_TOGGLE_DECODES_INTO_B;
  const texture = m.u16(overlay + (isIntoB ? OVERLAY_BUFFER_B : OVERLAY_BUFFER_A));
  const picture = m.u16(overlay + m.u16(overlay + NEXT_PICTURE));
  const [si, di] = unpackRows(m, picture, m.u16(overlay + SOURCE_OFFSET), texture, destination, 2);
  m.set16(overlay + SOURCE_OFFSET, si);
  m.set16(overlay + DESTINATION_OFFSET, di);
}

/** frakcode 0x9398 / 0x9342: next frame; after 128, show the buffer just unpacked. Returns the display segment. */
function nextFrame(m, overlay, displaySegment) {
  const frame = (m.u16(overlay + FRAME_INDEX) + 2) & 0xffff;
  m.set16(overlay + FRAME_INDEX, frame);
  if (frame <= LAST_FRAME_OFFSET) {
    m.set16(overlay + ROW_STEPS, m.u16(overlay + ROW_STEPS) + FRAME_STEP_BYTES);
    m.set16(overlay + COLUMN_STEPS, m.u16(overlay + COLUMN_STEPS) + FRAME_STEP_BYTES);
    return displaySegment;
  }
  m.set16(overlay + FRAME_INDEX, 0);
  m.set16(overlay + ROW_STEPS, 0);
  m.set16(overlay + COLUMN_STEPS, 0);
  let next = m.u16(overlay + NEXT_PICTURE) + 2;
  if (next >= PICTURE_LIST_END) {
    next = 0;
  }
  m.set16(overlay + NEXT_PICTURE, next);
  const toggle = m.u8(overlay + BUFFER_TOGGLE);
  const shown = m.u16(overlay + (toggle === BUFFER_TOGGLE_DECODES_INTO_B ? OVERLAY_BUFFER_B : OVERLAY_BUFFER_A));
  m.set16(overlay + SOURCE_OFFSET, 0);
  m.set16(overlay + DESTINATION_OFFSET, PICTURE_ORIGIN);
  m.set8(overlay + BUFFER_TOGGLE, ~toggle & 0xff);
  return shown;
}

/** 0d34:051e: the 256-colour palette and border colour 255. */
function setFractalPalette(m) {
  setDac(m, 0, 0x100, PALETTE);
  const vga = m.vga;
  vga.in8(INPUT_STATUS);
  vga.out8(ATTRIBUTE_PORT, OVERSCAN_REGISTER);
  vga.out8(ATTRIBUTE_PORT, 0xff);
  vga.out8(ATTRIBUTE_PORT, 0x20);
}

/** 0d34:0568..0620: free the pictures, fade the palette to black under the BIOS timer, the retrace timer back. */
function* fadeOut(m, overlay) {
  for (let p = 0; p < PICTURE_COUNT; p++) {
    m.free(m.u16(overlay + p * 2));
  }
  const block = m.allocTo(FADE_BLOCK_POINTER, FADE_BLOCK_PARAGRAPHS);
  const base = linear(block, 0);
  m.mem.fill(0, base, base + FADE_BLOCK_CLEAR);
  m.mem.copyWithin(base, PALETTE, PALETTE + PALETTE_BYTES);
  yield; // 0731:0158 waits for the retrace
  m.setTimer('bios');
  yield* fadePalette(m, {
    colours: FADE_COLOURS, from: base, to: base + PALETTE_BYTES, work: base + 2 * PALETTE_BYTES,
    steps: FADE_STEPS, first: 0, isTickingMusic: true,
  });
  yield; // 0731:013c waits for the retrace
  m.setTimer('retrace');
  m.freeFrom(FADE_BLOCK_POINTER);
}

/** 0d34:04e1. */
export function* fractalZoomer(m) {
  m.loadResource(OVERLAY_NAME, OVERLAY_POINTER);
  const overlaySegment = m.u16(OVERLAY_POINTER);
  const overlay = linear(overlaySegment, 0);
  let displaySegment = fractalInit(m, overlay);
  initFractalTables(m, overlay);
  m.set8(ITERATION_BYTE, 1);
  let remaining = ITERATIONS;
  do {
    yield* waitTick(m);
    if (m.u8(ITERATION_BYTE) === 1) {
      setFractalPalette(m);
    }
    drawFractalFrame(m, overlay, linear(displaySegment, 0));
    const ticks = m.frameCounter;
    m.set16(LAST_TICKS, ticks);
    for (let t = 0; t < ticks; t++) {
      decodeStep(m, overlay);
      displaySegment = nextFrame(m, overlay, displaySegment);
    }
    m.set8(ITERATION_BYTE, (m.u8(ITERATION_BYTE) + 1) & 0xff);
    remaining = (remaining - ticks) << 16 >> 16;
  } while (remaining > 0);
  yield* fadeOut(m, overlay);
}
