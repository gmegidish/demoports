// Frames of the original, recorded in DOSBox (Gravis Ultrasound run, see README), that the port reproduces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { newDemo, screenRgb, countDifferentPixels } from './helpers.js';

const EXACT_MOMENTS = [90, 174, 330, 378];

function originalFrame(seconds) {
  return new Uint8Array(gunzipSync(readFileSync(new URL(`./fixtures/original-${seconds}.rgb.gz`, import.meta.url))));
}

test('the demo runs from the first frame to the copyright text screen', () => {
  const demo = newDemo();
  demo.runUntil(400);
  assert.ok(demo.machine.isOver);
  assert.ok(demo.machine.isTextMode);
});

test('moments of the original are reproduced pixel for pixel', () => {
  const demo = newDemo();
  for (const seconds of EXACT_MOMENTS) {
    demo.runUntil(seconds);
    assert.equal(countDifferentPixels(screenRgb(demo.machine), originalFrame(seconds)), 0, `at ${seconds} s`);
  }
});

test('the opening starburst at 6 s matches the original to within a few pixels', () => {
  const demo = newDemo();
  demo.runUntil(6);
  assert.ok(countDifferentPixels(screenRgb(demo.machine), originalFrame(6)) < 200);
});
