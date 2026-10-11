// The depth-cued perspective texture mapper 0x38440 (src/engine/routines/r38440.js) against the
// original: test/fixtures/r38440.json holds CRC32s of what ROBOTNIK.EXE drew in unicorn
// (tools/re/r38440_fixtures.py) for the same random triangles (engine.test.js's xorshift stream and
// patterns), with depth shifts 0 and 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { demoFiles } from './helpers.js';
import { drawRoutine, createPolygon, VERTEX_INTS, SLOT_INTS } from '../src/engine/index.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/r38440.json', import.meta.url), 'utf8'));
const SCREEN_BYTES = 64000;
const COLOUR_TABLE_BYTES = 0x10000;
const SIDES = 3;

/** xorshift32, the same stream as engine_fixtures.py. */
function createRandom(seed) {
  let s = seed >>> 0;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
  return { next, int: (lo, hi) => lo + (next() % (hi - lo + 1)) };
}

function colourTablePattern() {
  return Uint8Array.from({ length: COLOUR_TABLE_BYTES }, (_, i) => Number((BigInt(i) * 2654435761n) & 0xffffffffn) >>> 24);
}

function backgroundPattern() {
  return Uint8Array.from({ length: SCREEN_BYTES }, (_, i) => ((i * 31) ^ (i >> 5)) & 255);
}

/** engine_fixtures.random_polygon: draws the same numbers in the same order (normal etc. unused here). */
function randomTriangle(random) {
  const reach = [10, 100, 300][random.int(0, 2)];
  const vertices = [];
  for (let i = 0; i < SIDES; i++) {
    const isOnScreen = random.int(0, 9) < 3;
    const [sx, sy] = isOnScreen ? [random.int(0, 319), random.int(0, 199)] : [random.int(-reach, 320 + reach), random.int(-reach, 200 + reach)];
    vertices.push([sx, sy, random.int(-256, 256), random.int(-256, 256), random.int(0, 255), random.int(0, 255)]);
  }
  if (random.int(0, 9) === 0) {
    vertices[1][1] = vertices[0][1];
  }
  random.int(-300, 300);
  random.int(0, 4);
  random.int(0, 255);
  return vertices;
}

function drawRandomTriangles(seed, depthShift, count) {
  const draw = drawRoutine(0x38440);
  const random = createRandom(seed);
  const colourTable = colourTablePattern();
  const material = { texture: demoFiles().archive.read('skultxt.raw').subarray(0x300), depthShift };
  const vertices = new Int32Array(SIDES * VERTEX_INTS);
  const crcs = [];
  for (let c = 0; c < count; c++) {
    const triangle = randomTriangle(random);
    const depths = triangle.map(() => random.int(20, 40000));
    const polygon = createPolygon();
    polygon.n = SIDES;
    polygon.normal = 0;
    polygon.material = material;
    triangle.forEach(([sx, sy, nx, ny, u, v], i) => {
      vertices.set([0, 0, depths[i], nx, ny, 0, sx, sy, 1], i * VERTEX_INTS);
      polygon.slots.set([i, u, v], i * SLOT_INTS);
    });
    const target = backgroundPattern();
    draw(polygon, { vertices, faceNormals: new Int32Array(3), target, colourTable });
    crcs.push(crc32(target));
  }
  return crcs;
}

for (const [name, seed, depthShift] of [['shift0', 71, 0], ['shift1', 72, 1]]) {
  test(`rasteriser 0x38440 (depth-cued perspective texture, depth shift ${depthShift}) draws random triangles as the original does`, () => {
    const expected = fixtures[name];
    const crcs = drawRandomTriangles(seed, depthShift, expected.length);
    const differing = crcs.map((c, i) => (c === expected[i] ? null : i)).filter((i) => i !== null);
    assert.deepEqual(differing, [], 'triangles drawn differently');
  });
}
