import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrack, addKey, prepareTangents, evaluate, evaluateHide, OBJECT_HIDDEN_BY_TRACK } from '../src/engine/track.js';
import { quaternionFromAxisAngle, quaternionDivideBySquaredLength, quaternionToMatrix, lookAt, createRandom } from '../src/engine/math.js';

const NO_TCB = [0, 0, 0, 0, 0];
const TOLERANCE = 1e-5;

function positionTrack(keys) {
  const track = createTrack();
  for (const [frame, x] of keys) {
    addKey(track, frame, [x, 0, 0], NO_TCB);
  }
  prepareTangents(track);
  return track;
}

function xAt(track, frame) {
  const out = new Float32Array(3);
  evaluate(track, frame, out, 0, 3);
  return out[0];
}

function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < TOLERANCE, `${actual} is not close to ${expected}`);
}

test('a two-key track with no tension moves in a straight line', () => {
  const track = positionTrack([[0, 10], [100, 30]]);

  assertClose(xAt(track, 25), 15);
  assertClose(xAt(track, 50), 20);
});

test('a track holds the value of its last key once the cursor reaches it', () => {
  const track = positionTrack([[0, 10], [100, 30]]);

  xAt(track, 150);

  assertClose(xAt(track, 150), 30);
});

test('a single key is the value at every frame', () => {
  const track = positionTrack([[40, 7]]);

  assertClose(xAt(track, 0), 7);
  assertClose(xAt(track, 999), 7);
});

test('the spline passes through a middle key', () => {
  const track = positionTrack([[0, 0], [10, 5], [20, 0]]);

  xAt(track, 5);

  assertClose(xAt(track, 10), 5);
});

test('each hide key reached flips the mesh between shown and hidden', () => {
  const track = positionTrack([[10, 0], [20, 0]]);
  const mesh = { flags: 0 };

  evaluateHide(track, 5, mesh);
  assert.equal(mesh.flags, 0);

  evaluateHide(track, 12, mesh);
  assert.equal(mesh.flags, OBJECT_HIDDEN_BY_TRACK);

  evaluateHide(track, 25, mesh);
  assert.equal(mesh.flags, 0);
});

test('a quarter turn about z maps the x axis onto the y axis', () => {
  const q = Float32Array.of(0, 0, 1, Math.PI / 2);
  const m = new Float32Array(9);

  quaternionFromAxisAngle(q);
  quaternionDivideBySquaredLength(q);
  quaternionToMatrix(q, m);

  assertClose(m[0], 0);
  assertClose(m[3], 1);
});

test('a camera looking down +z with no roll has the identity as its view matrix', () => {
  const m = new Float32Array(9);

  lookAt([0, 0, 0], [0, 0, 10], 0, m);

  [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((expected, i) => assertClose(m[i], expected));
});

test('rand() gives the Watcom runtime sequence for seed 1', () => {
  const rand = createRandom();

  assert.deepEqual([rand(), rand(), rand()], [16838, 5758, 10113]);
});
