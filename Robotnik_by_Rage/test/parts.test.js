// One moment per part against the recording: the share of pixels the port draws as DOSBox showed them.
// Fixtures are recording frames written by tools/re/fixtures.py. Porters: append your own test blocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { demoAt, screenOf, countDifferentPixels } from './helpers.js';

const PIXELS = 320 * 200;

function recordingFrame(name) {
  return new Uint8Array(gunzipSync(readFileSync(new URL(`fixtures/${name}.rgb.gz`, import.meta.url))));
}

function shareOfIdenticalPixels(seconds, fixtureName) {
  const screen = screenOf(demoAt(seconds));
  return 1 - countDifferentPixels(screen, recordingFrame(fixtureName)) / PIXELS;
}

test('part 1 shows presents.raw once the zoom out is over', () => {
  assert.ok(shareOfIdenticalPixels(30.0, 'presents-30.00') >= 0.999);
});

test('part 2 burns "coding" into smoke as the recording does', () => {
  assert.ok(shareOfIdenticalPixels(38.0, 'coding-38.00') >= 0.95);
});

test('part 4 burns "artwork" after the "is" flash as the recording does', () => {
  assert.ok(shareOfIdenticalPixels(84.0, 'artwork-84.00') >= 0.93);
});

test('part 6 burns "music" into smoke as the recording does', () => {
  assert.ok(shareOfIdenticalPixels(110.5, 'music-110.50') >= 0.98);
});

test('part 1 flies the 3D logo over the picture as the recording shows it', () => {
  assert.ok(shareOfIdenticalPixels(33.35, 'logo-33.35') >= 0.999);
});

test('part 7 bounces the first ball picture in as the recording does', () => {
  assert.ok(shareOfIdenticalPixels(127.5, 'ball-127.50') >= 0.999);
});

test('part 7 grows light rays from the swinging centre as the recording does', () => {
  assert.ok(shareOfIdenticalPixels(129.0, 'ball-129.00') >= 0.93);
});

test('part 8 shows the sunset over water as the recording does', () => {
  assert.ok(shareOfIdenticalPixels(170.0, 'sunset-170.00') >= 0.94);
});

const WINDOW_TOP = 24;
const WINDOW_BOTTOM = 176;
const ROW_BYTES = 320 * 3;
/** After a jump, the parts before 11 take a few dozen frames to fall through; start well before. */
const RUN_IN_SECONDS = 2;

function screenAfterRunningInTo(seconds) {
  return screenOf(demoAt(seconds, seconds - RUN_IN_SECONDS));
}

function shareOfIdenticalPixelsAfterRunningIn(seconds, fixtureName) {
  return 1 - countDifferentPixels(screenAfterRunningInTo(seconds), recordingFrame(fixtureName)) / PIXELS;
}

/** Part 11 draws only screen rows 24..175; the rest is whatever the parts before it left. */
function shareOfIdenticalPixelsInTheMazeWindow(seconds, fixtureName) {
  const window = (rgb) => rgb.subarray(WINDOW_TOP * ROW_BYTES, WINDOW_BOTTOM * ROW_BYTES);
  const screen = screenAfterRunningInTo(seconds);
  const differing = countDifferentPixels(window(screen), window(recordingFrame(fixtureName)));
  return 1 - differing / ((WINDOW_BOTTOM - WINDOW_TOP) * 320);
}

test('part 11 flies over the maze with its words as the recording does', () => {
  assert.ok(shareOfIdenticalPixelsInTheMazeWindow(260.0, 'maze-260.00') >= 0.999);
});

test('part 13 lights the face in its liquid as the recording does', () => {
  assert.ok(shareOfIdenticalPixelsAfterRunningIn(343.06, 'face-343.06') >= 0.999);
});

test('part 13 shatters the face into falling pieces as the recording does', () => {
  assert.ok(shareOfIdenticalPixelsAfterRunningIn(355.0, 'shatter-355.00') >= 0.999);
});

test('part 3 projects the mouth onto the room and the skull casts its shadow as the recording does', () => {
  assert.ok(shareOfIdenticalPixels(61.0, 'skull-61.00') >= 0.999);
});

test('part 5 drills into the cracking skull as the recording does', () => {
  assert.ok(shareOfIdenticalPixels(98.0, 'drill-98.00') >= 0.999);
});

test('part 5 shatters the last skull picture over music.raw as the recording does', () => {
  assert.ok(shareOfIdenticalPixels(106.4, 'skullshatter-106.40') >= 0.999);
});

test('part 10 tumbles the last robot picture away with cl_pic on its back as the recording does', () => {
  assert.ok(shareOfIdenticalPixelsAfterRunningIn(227.0, 'roomintro-227.00') >= 0.999);
});

test('part 10 drapes the cloth with its shadow, flares and "burn" as the recording does', () => {
  assert.ok(shareOfIdenticalPixelsAfterRunningIn(239.2, 'room-239.20') >= 0.999);
});

test('part 9 renders the robot in its octagonal room as the recording does', () => {
  assert.ok(shareOfIdenticalPixelsAfterRunningIn(200.0, 'robot-200.00') >= 0.999);
});

test('part 9 reflects the robot in the "rage mirror" as the recording does', () => {
  assert.ok(shareOfIdenticalPixelsAfterRunningIn(205.5, 'robot-205.50') >= 0.97);
});

/**
 * The recording reached entries 10 and 11 about 24 ticks early against part 9's tick counter (its song
 * ran fast against the frames); the port keeps the machine's clock, so its headless robot starts
 * sinking 24 ticks later along the camera path and no recording frame shows the port's pose of it
 * (best 96.5%, everything but the sinking robot identical).
 */
test('part 9 slides the blocks into "RAGE RAGE" and sinks the headless robot as the recording does', () => {
  assert.ok(shareOfIdenticalPixelsAfterRunningIn(225.1, 'robot-225.10') >= 0.96);
});

test('part 14 flies the recorded camera over the robot lying on the flesh floor as the recording does', () => {
  assert.ok(shareOfIdenticalPixelsAfterRunningIn(365.32, 'ending-365.32') >= 0.999);
});

test('part 14 lights up "rage" over the scene as the recording does', () => {
  assert.ok(shareOfIdenticalPixelsAfterRunningIn(369.38, 'ending-369.38') >= 0.999);
});

test('part 15 flips "your" over to "machine" as the recording does', () => {
  assert.ok(shareOfIdenticalPixelsAfterRunningIn(389.72, 'endflip-389.72') >= 0.999);
});

test('part 15 shatters "machine" at the viewer over endlogo as the recording does', () => {
  assert.ok(shareOfIdenticalPixelsAfterRunningIn(396.27, 'endshatter-396.27') >= 0.999);
});

test('part 15 fades endlogo out as the recording does', () => {
  assert.ok(shareOfIdenticalPixelsAfterRunningIn(398.49, 'endfade-398.49') >= 0.999);
});

test('the demo returns to text mode when part 15 passes its last sync entry', () => {
  const beforeTheEnd = demoAt(402.8, 401.5);
  const afterTheEnd = demoAt(402.86, 401.5);
  assert.equal(beforeTheEnd.machine.isTextMode, false);
  assert.equal(afterTheEnd.machine.isTextMode, true);
  assert.equal(afterTheEnd.isOver, true);
});

test('part 0 follows the spider with the spotlight exactly as the recording shows it', () => {
  assert.ok(shareOfIdenticalPixels(15.4, 'spider-15.40') >= 0.999);
});

test('part 0 drops the RAGE cube on the spider exactly as the recording shows it', () => {
  assert.ok(shareOfIdenticalPixels(22.3, 'spider-22.30') >= 0.999);
});

/** Part 12 keeps state from pass to pass (the sphere's image, the flesh scratch): run in from `from`. */
function shareOfIdenticalPixelsInTheTunnel(seconds, from, fixtureName) {
  return 1 - countDifferentPixels(screenOf(demoAt(seconds, from)), recordingFrame(fixtureName)) / PIXELS;
}

/**
 * The recording frame of tunnel-300.00 (fitted moment of 300.00 s): the recording's sync entries ran
 * ~0.35 s ahead of the song here, and on the machine's clock the port reaches that pass at 300.355 s.
 * Part 12 renders every tick and DOSBox every 2-4, so only that tick matches exactly.
 */
const TUNNEL_300_ON_THE_MACHINE_CLOCK = 300.355;

test('part 12 reflects the tunnel in the chrome sphere between the spikes as the recording does', () => {
  assert.ok(shareOfIdenticalPixelsInTheTunnel(TUNNEL_300_ON_THE_MACHINE_CLOCK, 298.0, 'tunnel-300.00') >= 0.999);
});

test('part 12 spins the tube of bump-mapped flesh in the tunnel as the recording does', () => {
  assert.ok(shareOfIdenticalPixelsInTheTunnel(318.0, 313.0, 'tunnel-318.00') >= 0.999);
});
