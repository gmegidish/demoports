// Part 3, the end part: a wobbling starfield behind a green text scroller. Run on its own, with memory set up as
// the boot block leaves it (part 2's bytes, part 3's over them). Frames are counted from the part's start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createMachine, r16, w32 } from '../src/machine.js';
import { createChip, custom, renderFrame, VIEW_WIDTH, VIEW_HEIGHT } from '../src/display.js';
import { readDisk } from '../src/disk.js';
import { part3 } from '../src/parts/part3.js';

/**
 * @typedef {{ clicks?: number[], isAudioOnly?: boolean, isMusicSkipped?: boolean }} RunOptions
 * @typedef {{ m: object, advanceTo: (frame: number) => void }} Run
 */

const disk = new Uint8Array(readFileSync(new URL('../assets/jesus-on-cheese.adf', import.meta.url)));
const PART2 = { offset: 0x1a200, length: 0x72000 };
const PART3 = { offset: 0x8c200, length: 0x44a00 };
const PART_ADDRESS = 0xa500;
const BOOT_COPPER = 0x7f18a;
const MODULE = 0x112ee;
const NO_MUSIC = 0xabcdef;

const STAR_PLANES = [0x50000, 0x5a000];
const COPPER_STAR_COLOURS = [0xa9ea, 0xa9ee, 0xa9f2];
/** The copper list's BPL2PTH and BPL2PTL values: the top of the scroller's window. */
const COPPER_SCROLLER_HIGH = 0xa9d6;
const COPPER_SCROLLER_LOW = 0xa9da;
const TEXT_POSITION = 0xece0;
const SCROLLER_STOPPED = 0x112ec;
const FIRST_ROW_LENGTH = 'WELL THIS IS THE END'.length;
/** COLOR09, the scroller's brightest green, as a canvas pixel (little-endian ABGR). */
const GREEN = 0xff00ff00;
/** The text has 760 rows of 16 lines; the last is blitted in frame 12145. */
const LAST_ROW_FRAME = 12145;

/** The regions tools/re/part3_handler.py hashes, in its order. */
const COMPARED_REGIONS = [
  [0x50000, 0x5a000], [0x59d80, 0x64830], [0xa9a0, 0xaa22], [0xaa14, 0xaa22], [0xbc22, 0xbf88],
  [0xc7da, 0xca1e], [0xdb00, 0xdb14], [0xecde, 0xece2], [0x112ec, 0x112ee],
];

/**
 * Part 3 as the boot block calls it. Frame n is the state after the n-th interrupt has drawn its stars (what
 * the n-th frame shows).
 * @param {RunOptions} options
 * @returns {Run}
 */
function startPart3({ clicks = [], isAudioOnly = false, isMusicSkipped = true } = {}) {
  const m = createMachine();
  m.chip = createChip();
  m.clicks = clicks;
  m.isAudioOnly = isAudioOnly;
  readDisk(m, disk, PART2.offset, PART2.length, PART_ADDRESS);
  readDisk(m, disk, PART3.offset, PART3.length, PART_ADDRESS);
  if (isMusicSkipped) {
    w32(m, MODULE, NO_MUSIC);
  }
  custom(m, 0x96, 0x8380);
  const sequence = part3(m, BOOT_COPPER);
  sequence.next();
  let frame = 0;
  return {
    m,
    advanceTo(target) {
      while (frame < target) {
        sequence.next();
        frame++;
      }
    },
  };
}

function screenOf(run) {
  const pixels = new Uint32Array(VIEW_WIDTH * VIEW_HEIGHT);
  renderFrame(run.m, pixels);
  return pixels;
}

function hasGreenOnLine(pixels, y) {
  return pixels.subarray(y * VIEW_WIDTH, (y + 1) * VIEW_WIDTH).includes(GREEN);
}

function topmostGreenLine(pixels) {
  for (let y = 0; y < VIEW_HEIGHT; y++) {
    if (hasGreenOnLine(pixels, y)) {
      return y;
    }
  }
  return -1;
}

function hasAnyText(pixels) {
  return pixels.includes(GREEN);
}

function hashOf(m, [start, end]) {
  return createHash('sha1').update(m.mem.subarray(start, end)).digest('hex').slice(0, 12);
}

function starPlanesHash(m) {
  return hashOf(m, STAR_PLANES);
}

function areStarPlanesEmpty(m) {
  return m.mem.subarray(STAR_PLANES[0], STAR_PLANES[1]).every((byte) => byte === 0);
}

function starColours(m) {
  return COPPER_STAR_COLOURS.map((address) => r16(m, address));
}

function scrollerWindow(m) {
  return (r16(m, COPPER_SCROLLER_HIGH) << 16) | r16(m, COPPER_SCROLLER_LOW);
}

function isScrollerStopped(m) {
  return r16(m, SCROLLER_STOPPED) !== 0;
}

/** "frame hash hash ..." lines from the original code run under Unicorn, clicks at frames 3000 and 16000. */
function originalHandlerHashes() {
  const lines = readFileSync(new URL('./fixtures/part3-handler-every-50th.txt', import.meta.url), 'utf8');
  return lines.trim().split('\n').map((line) => {
    const [frame, ...hashes] = line.split(' ');
    return { frame: Number(frame), hashes };
  });
}

test('every 50th frame, 16500 frames long, matches the original handler run under a 68000 emulator', () => {
  const run = startPart3({ clicks: [3000, 16000] });
  for (const { frame, hashes } of originalHandlerHashes()) {
    run.advanceTo(frame);
    assert.deepEqual(COMPARED_REGIONS.map((region) => hashOf(run.m, region)), hashes, `frame ${frame}`);
  }
});

test('the stars fade in over 64 frames to lilac, mauve and dark purple', () => {
  const run = startPart3();
  run.advanceTo(1);
  assert.deepEqual(starColours(run.m), [0x000, 0x000, 0x000]);
  run.advanceTo(32);
  assert.deepEqual(starColours(run.m), [0x667, 0x445, 0x223]);
  run.advanceTo(64);
  assert.deepEqual(starColours(run.m), [0xdcf, 0x98a, 0x546]);
  run.advanceTo(200);
  assert.deepEqual(starColours(run.m), [0xdcf, 0x98a, 0x546]);
});

test('the stars are redrawn every frame', () => {
  const run = startPart3();
  run.advanceTo(100);
  const before = starPlanesHash(run.m);
  run.advanceTo(101);
  assert.notEqual(starPlanesHash(run.m), before);
});

test('"WELL THIS IS THE END" rises from the bottom edge one line a frame', () => {
  const run = startPart3();
  run.advanceTo(2);
  assert.equal(hasAnyText(screenOf(run)), false);
  // The row enters the window in frame 2, but the font's top line is empty.
  run.advanceTo(3);
  assert.equal(topmostGreenLine(screenOf(run)), VIEW_HEIGHT - 1);
  run.advanceTo(100);
  const top = topmostGreenLine(screenOf(run));
  run.advanceTo(110);
  assert.equal(topmostGreenLine(screenOf(run)), top - 10);
  assert.equal(r16(run.m, TEXT_POSITION) > FIRST_ROW_LENGTH, true);
});

test('a click while the text runs changes nothing: the button only restarts a scroller that has ended', () => {
  const clicked = startPart3({ clicks: [3000] });
  const untouched = startPart3();
  clicked.advanceTo(3100);
  untouched.advanceTo(3100);
  assert.equal(r16(clicked.m, TEXT_POSITION), r16(untouched.m, TEXT_POSITION));
  assert.equal(scrollerWindow(clicked.m), scrollerWindow(untouched.m));
});

test('after the last row the scroller stops on an empty screen, for good, and the stars go on', () => {
  const run = startPart3();
  run.advanceTo(LAST_ROW_FRAME - 1);
  assert.equal(isScrollerStopped(run.m), false);
  run.advanceTo(LAST_ROW_FRAME + 1);
  assert.equal(isScrollerStopped(run.m), true);
  const window = scrollerWindow(run.m);
  const stars = starPlanesHash(run.m);
  run.advanceTo(LAST_ROW_FRAME + 1000);
  assert.equal(scrollerWindow(run.m), window);
  assert.equal(hasAnyText(screenOf(run)), false);
  assert.notEqual(starPlanesHash(run.m), stars);
});

test('a click after the end starts the text again from "WELL THIS IS THE END"', () => {
  const click = LAST_ROW_FRAME + 500;
  const run = startPart3({ clicks: [click] });
  run.advanceTo(click - 1);
  assert.equal(r16(run.m, TEXT_POSITION), 0);
  run.advanceTo(click + 1);
  assert.equal(isScrollerStopped(run.m), false);
  run.advanceTo(click + 200);
  assert.equal(hasAnyText(screenOf(run)), true);
});

test('with only the music wanted, nothing is drawn but the part keeps running', () => {
  const run = startPart3({ isAudioOnly: true, isMusicSkipped: false });
  run.advanceTo(300);
  assert.equal(areStarPlanesEmpty(run.m), true);
  assert.equal(r16(run.m, TEXT_POSITION), 0);
});
