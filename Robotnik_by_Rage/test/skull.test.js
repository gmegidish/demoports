// Parts 3 and 5: the generated room, the cylindrical UV angle, the light colour map and the measured
// pass schedules, against the original code run in unicorn (skull-room.json: points, faces and
// normals of 0x228bc + 0x24cb0) and the values docs/disassembly/P3_skull.md verified.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRoom, octantAngle, buildLightColourMap } from '../src/parts/skullscene.js';
import { passSchedule, PART3_PASS_TICKS, PART5_PASS_TICKS } from '../src/parts/skull.js';

const FACE_INTS = 12;

function roomAsTheOriginalBuiltIt() {
  return JSON.parse(readFileSync(new URL('fixtures/skull-room.json', import.meta.url), 'utf8'));
}

function triplesOf(ints) {
  return Array.from({ length: ints.length / 3 }, (_, i) => Array.from(ints.subarray(3 * i, 3 * i + 3)));
}

function facesOf(room) {
  return Array.from({ length: room.faces.length / FACE_INTS }, (_, i) => Array.from(room.faces.subarray(i * FACE_INTS, (i + 1) * FACE_INTS)));
}

function sumOfDrillSteps(passTicks) {
  return passSchedule(passTicks, 2000).filter((t) => t < 700).reduce((sum, t) => sum + ((-t) >> 3), 0);
}

test('the room has the points, faces and normals the original generates', () => {
  const expected = roomAsTheOriginalBuiltIt();
  const room = buildRoom({});
  assert.deepEqual(triplesOf(room.points), expected.pts);
  assert.deepEqual(facesOf(room), expected.polys);
  assert.deepEqual(triplesOf(room.faceNormals), expected.nrm);
});

test('the octant angle runs from +a towards +b, 1024 per turn', () => {
  assert.deepEqual(
    [[100, 0], [0, 100], [-100, 0], [0, -100], [100, 50], [50, 100]].map(([a, b]) => octantAngle(a, b)),
    [0, 256, 512, 768, 64, 192]);
});

test('film level 0 leaves colours as they are and full light brightens greys by 45', () => {
  const map = buildLightColourMap();
  assert.deepEqual(Array.from(map.subarray(0, 255)), Array.from({ length: 255 }, (_, c) => c));
  assert.equal(map[15 * 256 + 10], 55);
  assert.equal(map[15 * 256 + 200], 222);
  assert.equal(map[15 * 256 + 255], 0xfe);
});

test('the recorded passes start where the recording showed them', () => {
  assert.deepEqual(passSchedule(PART5_PASS_TICKS, 80), [0, 6, 13, 20, 27, 34, 41, 49, 58, 66, 75, 83]);
  assert.equal(passSchedule(PART3_PASS_TICKS, 1213).at(-2), 1210);
});

test('the drill bit moves -4455 units over the recorded passes, not the -30888 of one pass per tick', () => {
  assert.equal(sumOfDrillSteps(PART5_PASS_TICKS), -4455);
  assert.equal(sumOfDrillSteps('1'), -30888);
});
