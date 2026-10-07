import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.js';
import { COLUMNS } from '../src/textscreen.js';
import { demoAssets, demoMusic, demoAt } from './helpers.js';

const FRAME_SECONDS = 1 / 70;

function textLine(machine, row) {
  return String.fromCharCode(...machine.textScreen.characters.subarray(row * COLUMNS, (row + 1) * COLUMNS)).trimEnd();
}

function playToTheEnd(demo) {
  while (!demo.machine.isMusicStarted) {
    demo.step();
  }
  while (!demo.isOver) {
    demo.machine.time += FRAME_SECONDS;
    demo.step();
  }
  return demo.machine.time;
}

test('the boot log is printed in text mode before the music starts', () => {
  const demo = createDemo(demoAssets(), demoMusic());
  demo.step();
  assert.equal(demo.machine.isTextMode, true);
  assert.equal(textLine(demo.machine, 1), ']  Brother I Can See The Light,');
  assert.equal(demo.machine.isMusicStarted, false);
});

test('the demo plays from the first bar to "The End!" in 175.8 s, when the fade-out ends', () => {
  const demo = createDemo(demoAssets(), demoMusic());
  const seconds = playToTheEnd(demo);
  assert.ok(Math.abs(seconds - 175.8) < 0.05, `ended at ${seconds}`);
  assert.equal(demo.machine.isTextMode, true);
  assert.equal(textLine(demo.machine, 1), 'The End!Brother I can see the light, Immortals 1997');
  assert.equal(textLine(demo.machine, 6), 'C:\\>');
});

test('the music fades out with the title picture, from position 29', () => {
  assert.equal(demoAt(172.7).machine.volume, 32);
  assert.ok(demoAt(174.3).machine.volume <= 16);
  assert.ok(demoAt(175.75).machine.volume <= 1);
});

test('the screen is graphics from the moment the music starts', () => {
  const machine = demoAt(1).machine;
  assert.equal(machine.isTextMode, false);
  assert.ok(machine.front.every((index) => index === 0));
});

test('a jump to the flares of part 2 shows what playing up to them shows', () => {
  const seconds = 56;
  const played = createDemo(demoAssets(), demoMusic());
  while (!played.machine.isMusicStarted) {
    played.step();
  }
  while (played.machine.time + FRAME_SECONDS <= seconds) {
    played.machine.time += FRAME_SECONDS;
    played.step();
  }
  played.machine.time = seconds;
  played.step();
  const jumped = demoAt(seconds);
  assert.deepEqual(jumped.machine.front, played.machine.front);
  assert.deepEqual(jumped.machine.dac, played.machine.dac);
});
