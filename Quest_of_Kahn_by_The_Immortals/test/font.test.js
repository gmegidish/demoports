import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFont, drawText, drawTextShadowed } from '../src/font.js';

const font = loadFont(new Uint8Array(readFileSync(new URL('../TEXTURES/STANDARD.AFT', import.meta.url))));

const SCREEN_WIDTH = 320;
const SCREEN_BYTES = 64000;
const INK = 7;
const SHADOW = 0;
const PAPER = 99;

function blankScreen() {
  return new Uint8Array(SCREEN_BYTES).fill(PAPER);
}

/** Columns and rows that hold any pixel of the given colour. */
function boundsOf(screen, colour) {
  const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  screen.forEach((pixel, offset) => {
    if (pixel === colour) {
      const x = offset % SCREEN_WIDTH;
      const y = Math.floor(offset / SCREEN_WIDTH);
      bounds.left = Math.min(bounds.left, x);
      bounds.right = Math.max(bounds.right, x);
      bounds.top = Math.min(bounds.top, y);
      bounds.bottom = Math.max(bounds.bottom, y);
    }
  });
  return bounds;
}

test('the font file is 128 glyphs in 12x13 cells, with the space one pixel narrower than stored', () => {
  assert.equal(font.cellWidth, 12);
  assert.equal(font.cellHeight, 13);
  assert.equal(font.pixels.length, 12 * 13 * 128);
  assert.equal(font.widths['A'.charCodeAt(0)], 8);
  assert.equal(font.widths[' '.charCodeAt(0)], 7);
});

test('a letter is drawn inside its own width and the cell height, starting at the given position', () => {
  const screen = blankScreen();

  drawText(font, screen, 20, 160, 'A', INK);

  const ink = boundsOf(screen, INK);
  assert.ok(ink.left >= 20 && ink.right < 20 + 8);
  assert.ok(ink.top >= 160 && ink.bottom < 160 + 13);
});

test('the second letter starts two pixels after the first one ends', () => {
  const screen = blankScreen();

  drawText(font, screen, 0, 0, 'AW', INK);

  const farthestInk = boundsOf(screen, INK).right;
  assert.ok(farthestInk >= 8 + 2);
  assert.ok(farthestInk < 8 + 2 + 12);
});

test('a glyph that would cross the right edge moves to the start of the next line', () => {
  const screen = blankScreen();

  drawText(font, screen, 305, 10, 'WW', INK);

  const ink = boundsOf(screen, INK);
  assert.equal(ink.left < 12, true);
  assert.ok(ink.bottom >= 10 + 15);
});

test('shadowed text leaves a colour-0 shadow below and to the right of the ink', () => {
  const screen = blankScreen();

  drawTextShadowed(font, screen, 50, 50, 'W', INK);

  const ink = boundsOf(screen, INK);
  const shadow = boundsOf(screen, SHADOW);
  assert.equal(shadow.bottom, ink.bottom + 1);
  assert.equal(shadow.right, ink.right + 1);
});
