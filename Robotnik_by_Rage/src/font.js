// font.raw: a 22-pixel wide intensity image (values 0..31), 39 glyphs of 22x14 from row 2:
// A..Z, '.', '!', 0..9, blank. Text is lower case; '{' is '.', '|' is '!'. loadFont 0x1dcd0 also
// builds a half-size font (11 wide) of 2x2 averages.

const FONT_WIDTH = 22;
const GLYPH_ROWS = 14;
const FIRST_GLYPH_ROW = 2;
const HALF_WIDTH = 11;
const HALF_ROWS = 275;
const SCREEN_WIDTH = 320;
const BIG_ADVANCE = 21;
const SMALL_ADVANCE = 10;
const SMALL_ROWS = 7;

/** 0x1dcd0 loadFont(name, add, shift): every byte becomes ((b << shift) + add) & 0xff. */
export function loadFont(raw, add = 0, shift = 0) {
  const big = raw.map((b) => ((b << shift) + add) & 0xff);
  const half = new Uint8Array(HALF_WIDTH * HALF_ROWS);
  for (let r = 0; r < HALF_ROWS; r++) {
    for (let c = 0; c < HALF_WIDTH; c++) {
      const at = r * 2 * FONT_WIDTH + 2 * c;
      half[r * HALF_WIDTH + c] = (big[at] + big[at + 1] + big[at + FONT_WIDTH] + big[at + FONT_WIDTH + 1] + 2) >> 2;
    }
  }
  return { big, half };
}

/** -1 for a space. */
function glyphOf(code) {
  if (code === 0x20) {
    return -1;
  }
  return code >= 0x61 ? code - 0x61 : code - 0x14;
}

function bigGlyphAt(glyph) {
  return (FIRST_GLYPH_ROW + GLYPH_ROWS * glyph) * FONT_WIDTH;
}

function smallGlyphAt(glyph) {
  return HALF_WIDTH + 77 * glyph;
}

/** 0x1ddb4 bigText: 21x14 cells blended through table L (L[glyph*256 + dst]). */
export function drawBigText(font, dst, text, x, y, table) {
  for (let i = 0; i < text.length; i++, x += BIG_ADVANCE) {
    const g = glyphOf(text.charCodeAt(i));
    if (g < 0) {
      continue;
    }
    const from = bigGlyphAt(g);
    for (let r = 0; r < GLYPH_ROWS; r++) {
      const row = (y + r) * SCREEN_WIDTH + x;
      for (let c = 0; c < BIG_ADVANCE; c++) {
        dst[row + c] = table[font.big[from + r * FONT_WIDTH + c] * 256 + dst[row + c]];
      }
    }
  }
}

/** 0x1de4c bigTextCentered: x = (320 - 21n) / 2, the glyph value clamped to clampMax first. */
export function drawBigTextCentered(font, dst, text, y, table, clampMax) {
  let x = (299 - BIG_ADVANCE * (text.length - 1)) >> 1;
  for (let i = 0; i < text.length; i++, x += BIG_ADVANCE) {
    const g = glyphOf(text.charCodeAt(i));
    if (g < 0) {
      continue;
    }
    const from = bigGlyphAt(g);
    for (let r = 0; r < GLYPH_ROWS; r++) {
      const row = (y + r) * SCREEN_WIDTH + x;
      for (let c = 0; c < BIG_ADVANCE; c++) {
        dst[row + c] = table[Math.min(font.big[from + r * FONT_WIDTH + c], clampMax) * 256 + dst[row + c]];
      }
    }
  }
}

/** 0x1dff8 smallTextCentered: opaque 10x7 cells, x = (320 - 10n) / 2. */
export function drawSmallTextCentered(font, dst, text, y) {
  let x = (310 - SMALL_ADVANCE * (text.length - 1)) >> 1;
  for (let i = 0; i < text.length; i++, x += SMALL_ADVANCE) {
    const g = glyphOf(text.charCodeAt(i));
    if (g < 0) {
      continue;
    }
    const from = smallGlyphAt(g);
    for (let r = 0; r < SMALL_ROWS; r++) {
      for (let c = 0; c < SMALL_ADVANCE; c++) {
        dst[(y + r) * SCREEN_WIDTH + x + c] = font.half[from + r * HALF_WIDTH + c];
      }
    }
  }
}

/** 0x1e09c smallText: 10x7 cells blended through table L. */
export function drawSmallText(font, dst, text, x, y, table) {
  for (let i = 0; i < text.length; i++, x += SMALL_ADVANCE) {
    const g = glyphOf(text.charCodeAt(i));
    if (g < 0) {
      continue;
    }
    const from = smallGlyphAt(g);
    for (let r = 0; r < SMALL_ROWS; r++) {
      const row = (y + r) * SCREEN_WIDTH + x;
      for (let c = 0; c < SMALL_ADVANCE; c++) {
        dst[row + c] = table[font.half[from + r * HALF_WIDTH + c] * 256 + dst[row + c]];
      }
    }
  }
}
