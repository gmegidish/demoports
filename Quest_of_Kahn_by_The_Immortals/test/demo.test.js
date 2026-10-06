import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createDemo, finishLoading, seekTo } from '../src/demo.js';
import { DEMO_FILES } from '../src/manifest.js';
import { demoAssets } from './helpers.js';

const TICKS_PER_SECOND = 100;
const FRAMES_PER_SECOND = 20;
/** Sum of every part's length: 193.5 s of story, 156 s of scroller, 35 s of shadows. */
const DEMO_SECONDS = 384.5;
const DEMO_FOLDER = new URL('../', import.meta.url);
const WHITE = 63;
const HALF_WHITE = 32;

function loadedDemo() {
  const demo = createDemo(demoAssets());
  finishLoading(demo);
  return demo;
}

function playUntilOver(demo, limitSeconds) {
  let frames = 0;
  while (!demo.isOver && frames < limitSeconds * FRAMES_PER_SECOND) {
    frames++;
    demo.machine.ticks = Math.round((frames * TICKS_PER_SECOND) / FRAMES_PER_SECOND);
    demo.step();
  }
  return frames / FRAMES_PER_SECOND;
}

function demoAt(seconds) {
  const demo = loadedDemo();
  seekTo(demo, Math.round(seconds * TICKS_PER_SECOND));
  return demo;
}

function coloursOnScreen(demo) {
  return new Set(demo.machine.front).size;
}

function isDacAllWhite(demo) {
  return demo.machine.dac.every((component) => component === WHITE);
}

test('every file in the manifest exists with that exact spelling', () => {
  const missing = DEMO_FILES.filter((path) => !existsSync(new URL(path, DEMO_FOLDER)));

  assert.deepEqual(missing, []);
});

test('the loading screen shows the loading picture with the log over it', () => {
  const demo = createDemo(demoAssets());

  demo.step();
  demo.step();

  assert.ok(coloursOnScreen(demo) > 16);
  assert.equal(demo.logLines.at(-1), "initializing Silvatar's fonts");
});

test('the demo plays through every part and ends on a black screen at 6:24.5', () => {
  const demo = loadedDemo();

  const secondsPlayed = playUntilOver(demo, DEMO_SECONDS + 10);

  assert.ok(demo.isOver);
  assert.ok(Math.abs(secondsPlayed - DEMO_SECONDS) < 0.2, `ended after ${secondsPlayed} s`);
  assert.ok(demo.machine.front.every((pixel) => pixel === 0));
  assert.ok(demo.machine.dac.every((component) => component === 0));
});

test('jumping into the middle of a part shows a picture, not a blank screen', () => {
  const momentsInsideParts = [10, 24, 40, 60, 76, 80, 100, 115, 130, 150, 160, 175, 196, 250, 370];

  for (const seconds of momentsInsideParts) {
    assert.ok(coloursOnScreen(demoAt(seconds)) > 16, `only a few colours on screen at ${seconds} s`);
  }
});

test('a part opens on white and is half way down to its own palette after half a second', () => {
  const villainStarts = 78.5;

  const firstTick = demoAt(villainStarts + 0.01);
  const halfWay = demoAt(villainStarts + 0.5);

  assert.ok(isDacAllWhite(firstTick));
  assert.ok(!isDacAllWhite(halfWay));
  assert.ok(halfWay.machine.dac.every((component) => component >= HALF_WHITE));
});

test('the scroller is on its last line just before the shadows part', () => {
  const demo = demoAt(349);

  assert.equal(demo.roller.line, 77);
});

test('the music file the page plays has been rendered', () => {
  const music = readFileSync(new URL('assets/music.ogg', DEMO_FOLDER));

  assert.equal(music.subarray(0, 4).toString('latin1'), 'OggS');
});
