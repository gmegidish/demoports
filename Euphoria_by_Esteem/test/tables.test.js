import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WAVE_TABLE } from '../src/effects.js';
import { Machine } from '../src/machine.js';
import { buildLitTable } from '../src/raster.js';

test('the wave table equals the 256 bytes the original builds at start-up (179b:0531)', () => {
  const original = [75, 75, 75, 75, 75, 76, 76, 76, 77, 77, 77, 78, 78, 79, 79, 80, 80, 81, 82, 82, 83, 84, 85, 85, 86, 87, 88, 88, 89, 90, 91, 92];
  assert.deepEqual([...WAVE_TABLE.subarray(0, 32)], original);
  assert.equal(WAVE_TABLE[128], 75);
  assert.equal(WAVE_TABLE[255], 73);
});

test('the default lighting table is round(255 * cos(angle)) (1342:4467)', () => {
  const m = new Machine();
  buildLitTable(m, 0, 0, 255, 1);
  assert.equal(m.litTable[0], 255);
  assert.equal(m.litTable[60], 128);
  assert.equal(m.litTable[90], 0);
});

test("Random follows Borland Pascal's generator", () => {
  const m = new Machine();
  m.randSeed = 0;
  assert.equal(m.random(100), 0);
  assert.equal(m.randSeed, 1);
  assert.equal(m.random(65535), Math.floor((0x08088406 * 65535) / 2 ** 32));
});
