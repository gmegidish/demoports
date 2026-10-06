import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../src/demo.js';
import { renderFrame, VIEW_WIDTH, VIEW_HEIGHT } from '../src/display.js';

const WHITE = 0xffffffff;

const asset = (name) => new Uint8Array(readFileSync(new URL(`../assets/${name}`, import.meta.url)));
const disk = asset('baygon.adf');
const unpacked = { 0xd3a68: asset('part-d3a68.bin'), 0xc96e8: asset('part-c96e8.bin') };

function pictureAt(seconds) {
  const runner = createRunner(disk, unpacked);
  runner.advanceTo(seconds * 1000);
  const pixels = new Uint32Array(VIEW_WIDTH * VIEW_HEIGHT);
  renderFrame(runner.m, pixels);
  return pixels;
}

function coloursIn(pixels) {
  return new Set(pixels).size;
}

function brightnessOf(pixels) {
  return pixels.reduce((sum, pixel) => sum + (pixel & 0xff), 0);
}

function shareOf(pixels, colour) {
  return pixels.filter((pixel) => pixel === colour).length / pixels.length;
}

test('the loader shows sixteen greys of noise while the disk loads', () => {
  assert.equal(coloursIn(pictureAt(1)), 16);
});

test('the noise fades towards black once the disk has loaded', () => {
  assert.ok(brightnessOf(pictureAt(4.2)) < brightnessOf(pictureAt(1)) / 4);
});

test('the mushroom picture uses far more colours than an OCS Amiga has', () => {
  assert.ok(coloursIn(pictureAt(8)) > 32);
});

test('the star has not appeared while the character is still walking', () => {
  assert.equal(shareOf(pictureAt(11.5), WHITE), 0);
});

test('the star grows until it covers most of the picture', () => {
  assert.ok(shareOf(pictureAt(16.9), WHITE) > 0.7);
});

test('rendering the same moment twice gives the same picture', () => {
  assert.deepEqual(pictureAt(16.4), pictureAt(16.4));
});
