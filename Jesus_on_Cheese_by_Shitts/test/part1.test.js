// Part 1, the intro: black, then "PREPARE YOURSELF", "FOR" and "A BORING WAIT WHILE IT LOADS", each with a
// white flash. Moments are in seconds since the boot block; the reference capture is 1.99 s behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../src/demo.js';
import { renderFrame, VIEW_WIDTH, VIEW_HEIGHT, VIEW_Y } from '../src/display.js';

/**
 * @typedef {{ pixels: Uint32Array, mem: Uint8Array, cop1lc: number }} Moment
 */

const disk = new Uint8Array(readFileSync(new URL('../assets/jesus-on-cheese.adf', import.meta.url)));

/** Canvas pixels are little-endian ABGR. */
const BLACK = 0xff000000;
const WHITE = 0xffffffff;
const BLUE = 0xffff0000;
const BOOT_COPPER = 0x7f18a;
const PART1_COPPER = 0xa6f6;
/** The pictures: 40 bytes by 44 lines, shown from line $96. */
const PREPARE_YOURSELF = 0xa756;
const FOR = 0xae36;
const A_BORING_WAIT = 0xb516;
const BAND_TOP = 0x96 - VIEW_Y;
const BAND_LINES = 44;
const BYTES_PER_LINE = 40;

/** @returns {Moment} */
function momentAt(seconds, clicks = []) {
  const runner = createRunner(disk, { clicks });
  runner.advanceTo(seconds * 1000);
  const pixels = new Uint32Array(VIEW_WIDTH * VIEW_HEIGHT);
  renderFrame(runner.m, pixels);
  return { pixels, mem: runner.m.mem, cop1lc: runner.m.cop1lc };
}

function isAllOneColour(pixels, colour) {
  return pixels.every((pixel) => pixel === colour);
}

function topLeftColour(moment) {
  return moment.pixels[0];
}

function isPictureBitSet(mem, picture, line, x) {
  if (x < 0) {
    return false;
  }
  return ((mem[picture + line * BYTES_PER_LINE + (x >> 3)] >> (7 - (x & 7))) & 1) !== 0;
}

/**
 * Every pixel of the band is lit exactly where the picture has a bit, or the bit to its left (plane 2 is the
 * same picture one pixel later), and everything outside the band is the background colour.
 */
function showsPicture(moment, picture) {
  const { pixels, mem } = moment;
  const background = pixels[0];
  for (let y = 0; y < VIEW_HEIGHT; y++) {
    const line = y - BAND_TOP;
    for (let x = 0; x < VIEW_WIDTH; x++) {
      const isInBand = line >= 0 && line < BAND_LINES;
      const isLit = isInBand && (isPictureBitSet(mem, picture, line, x) || isPictureBitSet(mem, picture, line, x - 1));
      if ((pixels[y * VIEW_WIDTH + x] !== background) !== isLit) {
        return false;
      }
    }
  }
  return true;
}

function hasBlueLetters(moment) {
  return moment.pixels.some((pixel) => pixel === BLUE);
}

function isShowingBootScreen(moment) {
  return moment.cop1lc === BOOT_COPPER;
}

test('the screen stays black while the music plays its first nine seconds', () => {
  const moment = momentAt(12);
  assert.equal(moment.cop1lc, PART1_COPPER);
  assert.ok(isAllOneColour(moment.pixels, BLACK));
});

test('frame $1c0 flashes the whole screen white', () => {
  assert.equal(topLeftColour(momentAt(15.5)), WHITE);
});

test('the flash fades one step a frame, so it is darker a few frames later', () => {
  const later = topLeftColour(momentAt(15.6)) & 0xff;
  assert.ok(later > 0 && later < 0xff);
});

test('"PREPARE YOURSELF" is shown in blue on black once the flash is over', () => {
  const moment = momentAt(16.5);
  assert.equal(topLeftColour(moment), BLACK);
  assert.ok(hasBlueLetters(moment));
  assert.ok(showsPicture(moment, PREPARE_YOURSELF));
});

test('"FOR" follows', () => {
  assert.ok(showsPicture(momentAt(18.5), FOR));
});

test('"A BORING WAIT WHILE IT LOADS" follows', () => {
  assert.ok(showsPicture(momentAt(20.7), A_BORING_WAIT));
});

test('the last flash fades to an empty black screen', () => {
  const moment = momentAt(22.1);
  assert.equal(moment.cop1lc, PART1_COPPER);
  assert.ok(!hasBlueLetters(moment));
});

test('the part returns to the boot block at frame $310', () => {
  assert.ok(isShowingBootScreen(momentAt(22.25)));
});

test('a click leaves the intro early', () => {
  const frameOfClick = 500;
  assert.ok(isShowingBootScreen(momentAt(10.2, [frameOfClick])));
});
