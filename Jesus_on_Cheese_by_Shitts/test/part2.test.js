import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { r16 } from '../src/machine.js';
import { renderFrame, VIEW_WIDTH, VIEW_HEIGHT } from '../src/display.js';
import { part2, enterPart2, part2Interrupt, flushLateCopperWrites } from '../src/parts/part2.js';
import { machineWithPart2, snapshot, SNAPSHOT_BYTES } from '../tools/re/part2-watched.mjs';

const BOOT_COPPER = 0x7f18a;
const SCRIPT_FRAMES = 9280;
const SCRIPT_INDEX = 0xa6ee;
const FIRST_ENTRY_END = 0xc;
/** Value word of COLOR00's move in the pictures' copper list. */
const PICTURE_COLOURS = 0x21ebc;
const COPPER_MOVE_BYTES = 4;
/** Every 37th frame of the original handler's memory, from tools/re/part2_handler.py (frames 1, 38, 75 ...). */
const ORIGINAL_EVERY = 37;
const ORIGINAL_FRAMES = 9400;

const adf = new Uint8Array(readFileSync(new URL('../assets/jesus-on-cheese.adf', import.meta.url)));
const original = readFileSync(new URL('./fixtures/part2-handler-every-37th.bin', import.meta.url));

function startedPart2() {
  const m = machineWithPart2(adf);
  enterPart2(m, BOOT_COPPER);
  return m;
}

function runFrames(m, count) {
  for (let i = 0; i < count; i++) {
    part2Interrupt(m);
  }
}

function originalMemoryAfterFrame(frame) {
  const record = (frame - 1) / ORIGINAL_EVERY;
  return original.subarray(record * SNAPSHOT_BYTES, (record + 1) * SNAPSHOT_BYTES);
}

function pictureColour(m, index) {
  return r16(m, PICTURE_COLOURS + index * COPPER_MOVE_BYTES);
}

/** The frame as shown after `frames` runs of the handler: script frame `frames - 1`. */
function pictureAfter(frames) {
  const m = startedPart2();
  runFrames(m, frames);
  const pixels = new Uint32Array(VIEW_WIDTH * VIEW_HEIGHT);
  renderFrame(m, pixels);
  return pixels;
}

function coloursIn(pixels) {
  return new Set(pixels).size;
}

const RGB_MASK = 0xffffff;
const rgbOf = (colour) => (((colour & 0xf) * 0x11) << 16) | ((((colour >> 4) & 0xf) * 0x11) << 8) | (((colour >> 8) & 0xf) * 0x11);

function pixelAt(pixels, x, y) {
  return pixels[y * VIEW_WIDTH + x] & RGB_MASK;
}

test('the dispatcher and its effects leave the copper lists and counters the original leaves, over two passes', () => {
  const m = startedPart2();
  for (let frame = 1; frame <= ORIGINAL_FRAMES; frame++) {
    part2Interrupt(m);
    flushLateCopperWrites(m);
    if ((frame - 1) % ORIGINAL_EVERY === 0) {
      assert.deepEqual(snapshot(m), new Uint8Array(originalMemoryAfterFrame(frame)), `after frame ${frame}`);
    }
  }
});

test('the script lasts 9280 frames, then starts again from its first entry', () => {
  const m = startedPart2();
  runFrames(m, SCRIPT_FRAMES);
  assert.notEqual(r16(m, SCRIPT_INDEX), FIRST_ENTRY_END);
  runFrames(m, 1);
  assert.equal(r16(m, SCRIPT_INDEX), FIRST_ENTRY_END);
});

test('a picture flash shows six new colours on its first frame and all sixteen on its second', () => {
  // Script frame 1602: the face, from (fff, 0) to (00f, f00). Colour 0 is the second colour, 15 the first.
  const m = startedPart2();
  runFrames(m, 1603);
  assert.equal(pictureColour(m, 0), 0xf00);
  assert.equal(pictureColour(m, 5), 0xa05);
  assert.equal(pictureColour(m, 6), 0x666, 'still the previous ramp from white to black');
  runFrames(m, 1);
  assert.equal(pictureColour(m, 6), 0x906);
  assert.equal(pictureColour(m, 15), 0x00f);
});

function brightnessOf(pixels) {
  return pixels.reduce((sum, pixel) => sum + (pixel & 0xff) + ((pixel >> 8) & 0xff) + ((pixel >> 16) & 0xff), 0);
}

test('the face comes in nearly black: on its first frame most of its colours have not reached the copper', () => {
  // Script frame 1200, as in the capture at 69.18 s; the copper list's previous colours are all black.
  assert.ok(brightnessOf(pictureAfter(1201)) < brightnessOf(pictureAfter(1202)) / 4);
});

test('then the face shows its sixteen greys, centred on black', () => {
  const pixels = pictureAfter(1202);
  assert.equal(pixelAt(pixels, 0, 0), 0);
  assert.equal(coloursIn(pixels), 16);
});

test('the rings fill the whole screen with sixteen cycling colours', () => {
  const pixels = pictureAfter(1300);
  assert.equal(coloursIn(pixels), 16);
  assert.notDeepEqual(pictureAfter(1301), pixels);
});

test('a plain-colour entry shows nothing but its colour', () => {
  // Script frame 3524: effect 0 with colour 0, between one-frame flashes.
  const pixels = pictureAfter(3525);
  assert.equal(coloursIn(pixels), 1);
  assert.equal(pixelAt(pixels, 160, 128), rgbOf(0));
});

test('the left mouse button ends part 2 and gives the copper back to the boot block', () => {
  const m = machineWithPart2(adf);
  m.clicks = [100];
  let frames = 0;
  for (const _ of part2(m, BOOT_COPPER)) {
    frames++;
  }
  assert.equal(frames, 100);
  assert.equal(m.cop1lc, BOOT_COPPER);
});

test('while the button is held the handler leaves everything alone', () => {
  const m = startedPart2();
  runFrames(m, 50);
  const before = snapshot(m);
  m.clicks = [m.frame];
  part2Interrupt(m);
  assert.deepEqual(snapshot(m), before);
});
