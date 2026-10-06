// The demo's bitmap font, TEXTURES\STANDARD.AFT: Silvatar's hand copy of the Warcraft II font.
// KAHN.EXE 0x13d20 (load), 0x13f1d (draw), 0x14048 (draw with a shadow).

import { WIDTH } from './machine.js';

const GLYPHS = 128;
const HEADER_BYTES = 3;
const SPACE = 0x20;
const LETTER_SPACING = 2;
const LINE_SPACING = 2;
const SHADOW_COLOUR = 0;

/**
 * @typedef {object} Font
 * @property {number} cellWidth
 * @property {number} cellHeight
 * @property {Uint8Array} pixels one byte per pixel, glyph after glyph, row after row
 * @property {Uint8Array} widths how many columns of each glyph are drawn, and its advance
 */

/**
 * The file is three bytes (cell width, cell height, bits per pixel), one continuous bit stream
 * of all 128 glyphs, least significant bit first, and 128 glyph widths.
 * @param {Uint8Array} bytes
 * @returns {Font}
 */
export function loadFont(bytes) {
  const cellWidth = bytes[0];
  const cellHeight = bytes[1];
  const bitsPerPixel = bytes[2];
  const pixelsPerByte = 8 / bitsPerPixel;
  const pixelCount = cellWidth * cellHeight * GLYPHS;
  const pixels = new Uint8Array(pixelCount);
  let at = HEADER_BYTES;
  for (let pixel = 0; pixel < pixelCount; pixel += pixelsPerByte) {
    const packed = bytes[at++];
    for (let i = 0; i < pixelsPerByte; i++) {
      pixels[pixel + i] = (packed >> (i * bitsPerPixel)) & ((1 << bitsPerPixel) - 1);
    }
  }
  const widths = bytes.slice(at, at + GLYPHS);
  widths[SPACE]--;
  return { cellWidth, cellHeight, pixels, widths };
}

/**
 * Draw a string, no clipping. A glyph that would cross the right edge of the screen moves the
 * text to the left edge of the next line.
 * @param {Font} font
 * @param {Uint8Array} target a screen-sized buffer
 */
export function drawText(font, target, x, y, text, colour) {
  const glyphBytes = font.cellWidth * font.cellHeight;
  let column = x;
  let row = y;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) & (GLYPHS - 1);
    const glyphWidth = font.widths[code];
    let source = code * glyphBytes;
    let destination = row * WIDTH + column;
    for (let glyphRow = 0; glyphRow < font.cellHeight; glyphRow++) {
      for (let glyphColumn = 0; glyphColumn < glyphWidth; glyphColumn++) {
        if (font.pixels[source + glyphColumn] !== 0) {
          target[destination + glyphColumn] = colour;
        }
      }
      source += font.cellWidth;
      destination += WIDTH;
    }
    column += glyphWidth + LETTER_SPACING;
    // The test also runs for the end of the string, with the width of glyph 0.
    const nextCode = i + 1 < text.length ? text.charCodeAt(i + 1) & (GLYPHS - 1) : 0;
    if (column + font.widths[nextCode] > WIDTH - 1) {
      row += font.cellHeight + LINE_SPACING;
      column = 0;
    }
  }
}

/** The text over a colour-0 shadow one pixel down and one down-right. */
export function drawTextShadowed(font, target, x, y, text, colour) {
  drawText(font, target, x + 1, y + 1, text, SHADOW_COLOUR);
  drawText(font, target, x, y + 1, text, SHADOW_COLOUR);
  drawText(font, target, x, y, text, colour);
}
