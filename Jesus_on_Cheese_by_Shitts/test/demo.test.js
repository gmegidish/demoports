// The boot block's schedule: the port's own click at the end of part 2's script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../src/demo.js';
import { FRAME_MS } from '../src/machine.js';

const adf = new Uint8Array(readFileSync(new URL('../assets/jesus-on-cheese.adf', import.meta.url)));
const PART2_START_FRAME = 2361;
const PART2_SCRIPT_FRAMES = 9280;
const PART3_COPPER = 0xa9a0;

function runUntilPart3(clicks) {
  const runner = createRunner(adf, { clicks });
  let ms = 0;
  while (runner.m.cop1lc !== PART3_COPPER) {
    ms += 1000;
    runner.advanceTo(ms);
  }
  return runner;
}

const clicksStillToCome = (runner) => runner.m.clicks.filter((frame) => frame > runner.m.frame);

test('without a click, part 2 ends after one pass of its script', () => {
  const runner = runUntilPart3([]);
  assert.ok(runner.m.time > (PART2_START_FRAME + PART2_SCRIPT_FRAMES - 10) * FRAME_MS);
});

test('when the viewer ends part 2 early, the port does not click later in part 3', () => {
  const runner = runUntilPart3([PART2_START_FRAME + 500]);
  assert.ok(runner.m.time < (PART2_START_FRAME + PART2_SCRIPT_FRAMES) * FRAME_MS);
  assert.deepEqual(clicksStillToCome(runner), []);
});

test('the runner keeps its own copy of the clicks it is given', () => {
  const clicks = [];
  runUntilPart3(clicks);
  assert.deepEqual(clicks, []);
});
