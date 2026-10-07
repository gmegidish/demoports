import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../src/demo.js';
import { TICK_MS } from '../src/machine.js';
import { file_offsets } from '../src/files.js';
import { DepackILBM, ILBM_GetXSize, ILBM_GetYSize } from '../src/ilbm.js';

/** Where the credits begin in the reference capture of the original, measured from the first note. */
const CREDITS_IN_CAPTURE_MS = 143800;
const ONE_SECOND = 1000;
const TEN_MINUTES = 10 * 60 * ONE_SECOND;

const graphics = new Uint8Array(readFileSync(new URL('../assets/NINJA2.000', import.meta.url)));

function tagAt(offset) {
  return String.fromCharCode(...graphics.subarray(offset, offset + 4));
}

function isChunkyPicture(offset) {
  return tagAt(offset + 8) === 'PBM ';
}

function runUntilCredits() {
  const runner = createRunner(graphics);
  for (let time = 0; runner.m.creditsStartMs === null && time < TEN_MINUTES; time += ONE_SECOND) {
    runner.advanceTo(time);
  }
  return runner;
}

function checksumOf(bytes) {
  let sum = 0;
  for (const byte of bytes) {
    sum = (sum * 31 + byte) >>> 0;
  }
  return sum;
}

function pictureOnMonitorAt(timeMs) {
  const runner = createRunner(graphics);
  runner.advanceTo(timeMs);
  return checksumOf(runner.m.front) ^ checksumOf(runner.m.palette);
}

test('every file offset points at an IFF picture', () => {
  for (const offset of file_offsets) {
    assert.equal(tagAt(offset), 'FORM');
  }
});

test('every chunky picture depacks to exactly width x height bytes', () => {
  const scratch = new Uint8Array(400000);
  for (const offset of file_offsets.filter(isChunkyPicture)) {
    const expected = ILBM_GetXSize(graphics, offset) * ILBM_GetYSize(graphics, offset);
    assert.equal(DepackILBM(graphics, offset, scratch, 0), expected);
  }
});

test('the credits begin where they do in the capture of the original', () => {
  const { m } = runUntilCredits();

  assert.notEqual(m.creditsStartMs, null, 'credits never started');
  const musicTimeAtCredits = m.creditsStartMs - m.musicStartMs;
  assert.ok(Math.abs(musicTimeAtCredits - CREDITS_IN_CAPTURE_MS) < ONE_SECOND / 2, `credits start ${musicTimeAtCredits} ms into the music`);
});

test('the intro lasts 1632 ticks: its clock runs to 480 at 1/3.4 per tick', () => {
  const runner = createRunner(graphics);
  const ticksAt = (clockValue) => Math.ceil(clockValue * 3.4);

  while (runner.m.musicStartMs === null) {
    runner.advanceTo(runner.m.time + ONE_SECOND);
  }
  const introStart = runner.m.musicStartMs - 720;
  runner.advanceTo(introStart + (ticksAt(480) - 30) * TICK_MS);
  const duringIntro = runner.m.clockInc;
  runner.advanceTo(introStart + (ticksAt(480) + 30) * TICK_MS);
  const duringLogo = runner.m.clockInc;

  assert.ok(Math.abs(duringIntro - 1 / 3.4) < 1e-6, 'intro clock still running 30 ticks before its end');
  assert.ok(Math.abs(duringLogo - 1 / 30) < 1e-6, 'logo clock running 30 ticks after the intro ends');
});

test('the credits switch the monitor to 640x480 and keep looping', () => {
  const runner = runUntilCredits();

  runner.advanceTo(runner.m.creditsStartMs + 2 * 60 * ONE_SECOND);

  assert.equal(runner.m.width, 640);
  assert.equal(runner.m.height, 480);
  assert.equal(runner.m.front.length, 640 * 480);
});

test('replaying to the same time shows the same picture', () => {
  const duringCity = 110 * ONE_SECOND;

  assert.equal(pictureOnMonitorAt(duringCity), pictureOnMonitorAt(duringCity));
});
