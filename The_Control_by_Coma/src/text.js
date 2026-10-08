// The proportional font: strings drawn into a 320-wide buffer (0x1bab5 / 0x1bafa) or, opaque, into the 256-wide
// texture (0x1bb5c / 0x1bbac). Notes: C2 "Font", C4.
// The string pointer [0x1baa7], the colour base [0x1b882] and the letter gap [0x1bab1] live in memory,
// where the effects put them before the call.

export const TEXT_POINTER = 0x1baa7;
export const TEXT_COLOUR_BASE = 0x1b882;
const LETTER_GAP = 0x1bab1;
/** 0x1baf6: the advance of the last glyph (scratch of 0x1bafa and 0x1bbac). */
const GLYPH_ADVANCE = 0x1baf6;
const GLYPH_TABLE = 0x1b887;
const FIRST_GLYPH = 0x0f;
const FONT_BLOCK = 0x63a0;
const EMPTY_GLYPH_ADVANCE = 8;
const CARRIAGE_RETURN = 0x0d;
/** 0x1bab5 into a 320-wide buffer: a CR moves 20 rows down, a second CR right after it 5 more. */
const SCREEN_LAYOUT = { stride: 320, lineStep: 0x1900, blankLineStep: 0x640, isOpaque: false };
/** 0x1bb5c into the 256-wide texture: a CR moves 25 rows down, a second CR 5 more. */
export const TEXTURE_LAYOUT = { stride: 0x100, lineStep: 0x1900, blankLineStep: 0x500, isOpaque: true };

/**
 * 0x1bafa (transparent: non-zero pixels v become (v << 2) + colour base) and 0x1bbac (opaque: every pixel,
 * v << 2): one glyph at `destination`, rows `layout.stride` apart. Returns the advance: the glyph width, or 8
 * for an empty glyph.
 */
function drawGlyph(m, character, destination, layout, colourBase) {
  m.set32(GLYPH_ADVANCE, EMPTY_GLYPH_ADVANCE);
  const pointer = m.u32((GLYPH_TABLE + (((character - FIRST_GLYPH) << 2) >>> 0)) >>> 0);
  const width = m.u16(pointer + FONT_BLOCK);
  if (width === 0) {
    return EMPTY_GLYPH_ADVANCE;
  }
  m.set32(GLYPH_ADVANCE, width);
  const height = m.u16(pointer + FONT_BLOCK + 2);
  const mem = m.mem;
  let source = pointer + FONT_BLOCK + 4;
  let row = destination;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = mem[source++];
      if (v !== 0 || layout.isOpaque) {
        mem[row + x] = ((v << 2) + colourBase) & 0xff;
      }
    }
    row += layout.stride;
  }
  return width;
}

/**
 * The zero-terminated string at [0x1baa7] drawn at `destination`, glyphs [0x1bab1] apart, in the given layout.
 * Colour base 0 for the opaque layout (0x1bbac adds none).
 */
export function drawString(m, destination, layout, colourBase = 0) {
  const text = m.u32(TEXT_POINTER);
  const gap = m.u32(LETTER_GAP);
  let index = 0;
  let lineStart = destination;
  for (;;) {
    let x = lineStart;
    for (;;) {
      const character = m.u8(text + index);
      index++;
      if (character === CARRIAGE_RETURN) {
        break;
      }
      if (character === 0) {
        return;
      }
      x = (x + drawGlyph(m, character, x, layout, colourBase) + gap) >>> 0;
    }
    lineStart += layout.lineStep;
    if (m.u8(text + index) === CARRIAGE_RETURN) {
      index++;
      lineStart += layout.blankLineStep;
    }
  }
}

/**
 * 0x1bab5: draws the zero-terminated string at [0x1baa7] at `destination` (an address in a 320-wide buffer),
 * in colours (glyph pixel << 2) + [0x1b882]. To draw a caption: m.set32(TEXT_POINTER, stringAddress);
 * m.set8(TEXT_COLOUR_BASE, base); drawText(m, buffer + 320 * y + x).
 */
export function drawText(m, destination) {
  drawString(m, destination, SCREEN_LAYOUT, m.u8(TEXT_COLOUR_BASE));
}
