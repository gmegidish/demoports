// Frames of the original, captured in DOSBox (see README), that the port reproduces. The capture's
// clock runs ahead of the song by up to 0.8 s and its 100 Hz timer drifts against the music, so
// each frame is paired with the moment of the song at which the port shows it (tools/re/fixtures.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { screenAt, countDifferentPixels } from './helpers.js';

function originalFrame(seconds) {
  return new Uint8Array(gunzipSync(readFileSync(new URL(`./fixtures/original-${seconds}.rgb.gz`, import.meta.url))));
}

const EXACT_MOMENTS = [
  { seconds: 16, what: 'the logo, part 1' },
  { seconds: 30, what: 'the credits, part 1' },
  { seconds: 41.895, what: 'the polar swirl, part 2' },
  { seconds: 92.05, what: 'the tunnel, part 4' },
];

for (const { seconds, what } of EXACT_MOMENTS) {
  test(`${what} at ${seconds} s is pixel for pixel the original's frame`, () => {
    assert.equal(countDifferentPixels(screenAt(seconds), originalFrame(seconds)), 0);
  });
}

/**
 * The 3D scenes: a handful of perspective-mapped pixels take the neighbouring texel. The x87
 * keeps intermediate results in 80 bits where JavaScript has 64, and texel boundaries feel it.
 */
const NEAR_MOMENTS = [
  { seconds: 72.04, what: 'the spiked star, part 3' },
  { seconds: 130, what: 'the tennis player, part 5' },
];
const MAX_TEXEL_SLIPS = 100;

for (const { seconds, what } of NEAR_MOMENTS) {
  test(`${what} at ${seconds} s differs from the original's frame in fewer than ${MAX_TEXEL_SLIPS} pixels`, () => {
    assert.ok(countDifferentPixels(screenAt(seconds), originalFrame(seconds)) < MAX_TEXEL_SLIPS);
  });
}
