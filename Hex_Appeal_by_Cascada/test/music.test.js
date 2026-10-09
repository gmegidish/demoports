import { test } from 'node:test';
import assert from 'node:assert/strict';
import { musicPosition, ROW_SECONDS } from '../src/music.js';

const ORDER_SECONDS = 64 * ROW_SECONDS;

test('the song starts at order 0, row 0', () => {
  assert.deepEqual(musicPosition(0), { order: 0, row: 0 });
});

test('a row lasts eight ticks of the recorded tempo', () => {
  assert.deepEqual(musicPosition(ROW_SECONDS * 51.5), { order: 0, row: 51 });
  assert.deepEqual(musicPosition(ORDER_SECONDS * 18.5), { order: 18, row: 32 });
});

test('after the last row of order 31 the song loops back to order 21', () => {
  assert.deepEqual(musicPosition(ORDER_SECONDS * 32 + ROW_SECONDS * 0.5), { order: 21, row: 0 });
  assert.deepEqual(musicPosition(ORDER_SECONDS * 43 + ROW_SECONDS * 0.5), { order: 21, row: 0 });
});
