// The 80x25 text mode the demo starts and ends in: what main() prints with cout before and after
// the graphics, light grey on black, 9x16 cells drawn from the VGA ROM font.

export const COLUMNS = 80;
export const ROWS = 25;
const CELL_WIDTH = 9;
const CELL_HEIGHT = 16;
/** Text colour 7 and background 0 of the default text-mode palette, 8-bit. */
const FOREGROUND = 0xffaaaaaa;
const BACKGROUND = 0xff000000;
/** Box-drawing characters repeat their 8th column into the 9th. */
const FIRST_LINE_CHARACTER = 0xc0;
const LAST_LINE_CHARACTER = 0xdf;
const CURSOR_TOP = 13;
const CURSOR_BOTTOM = 14;

/** An empty screen with the cursor home, as int 10h mode 3 leaves it. */
export function createTextScreen() {
  return { characters: new Uint8Array(COLUMNS * ROWS).fill(0x20), row: 0, column: 0, isCursorShown: true };
}

function scroll(screen) {
  screen.characters.copyWithin(0, COLUMNS);
  screen.characters.fill(0x20, (ROWS - 1) * COLUMNS);
  screen.row = ROWS - 1;
}

/** Teletype output: '\n' moves to the start of the next line, scrolling at the bottom. */
export function print(screen, text) {
  for (const character of text) {
    if (character === '\n') {
      screen.column = 0;
      screen.row++;
    } else {
      screen.characters[screen.row * COLUMNS + screen.column] = character.charCodeAt(0) & 0xff;
      screen.column++;
      if (screen.column === COLUMNS) {
        screen.column = 0;
        screen.row++;
      }
    }
    if (screen.row === ROWS) {
      scroll(screen);
    }
  }
}

/**
 * @param {Uint8Array} font the 4096-byte 8x16 ROM font
 * @returns {{width: number, height: number, pixels: Uint32Array}} RGBA as little-endian words
 */
export function renderTextScreen(screen, font) {
  const width = COLUMNS * CELL_WIDTH;
  const height = ROWS * CELL_HEIGHT;
  const pixels = new Uint32Array(width * height);
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      const character = screen.characters[row * COLUMNS + column];
      const isLineCharacter = character >= FIRST_LINE_CHARACTER && character <= LAST_LINE_CHARACTER;
      const isCursor = screen.isCursorShown && row === screen.row && column === screen.column;
      for (let y = 0; y < CELL_HEIGHT; y++) {
        let bits = font[character * CELL_HEIGHT + y];
        // The hardware cursor: scanlines 13 and 14 of the cell, the BIOS default.
        if (isCursor && (y === CURSOR_TOP || y === CURSOR_BOTTOM)) {
          bits = 0xff;
        }
        for (let x = 0; x < CELL_WIDTH; x++) {
          const isOn = x < 8 ? (bits >> (7 - x)) & 1 : isLineCharacter ? bits & 1 : 0;
          pixels[(row * CELL_HEIGHT + y) * width + column * CELL_WIDTH + x] = isOn ? FOREGROUND : BACKGROUND;
        }
      }
    }
  }
  return { width, height, pixels };
}
