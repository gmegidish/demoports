// Frames of the original, captured in DOSBox at 320x200 (see README), that the port reproduces exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { screenAt, countDifferentPixels } from './helpers.js';

function originalFrame(seconds) {
  return new Uint8Array(gunzipSync(readFileSync(new URL(`./fixtures/original-${seconds}.rgb.gz`, import.meta.url))));
}

for (const seconds of [2, 10, 20]) {
  test(`the intro at ${seconds} s is pixel for pixel the original's frame`, () => {
    assert.equal(countDifferentPixels(screenAt(seconds), originalFrame(seconds)), 0);
  });
}
