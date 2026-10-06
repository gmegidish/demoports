import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAdditiveTable, buildAverageTable, buildWeightedTable, blendBuffers } from '../src/tables.js';

const BLACK = 0;
const DARK_GREY = 1;
const MID_GREY = 2;
const WHITE = 3;

/** Four greys at 0, 20, 40 and 63; every other entry is a red that no grey mix should pick. */
function greyPalette() {
  const palette = new Uint8Array(768);
  for (let i = 4; i < 256; i++) {
    palette[i * 3] = 63;
  }
  [0, 20, 40, 63].forEach((level, index) => palette.fill(level, index * 3, index * 3 + 3));
  return palette;
}

function mixOf(table, a, b) {
  return table[(a << 8) | b];
}

test('adding two colours picks the palette entry nearest to their sum', () => {
  const additive = buildAdditiveTable(greyPalette());

  assert.equal(mixOf(additive, DARK_GREY, DARK_GREY), MID_GREY);
  assert.equal(mixOf(additive, BLACK, MID_GREY), MID_GREY);
});

test('an additive mix brighter than the DAC maximum clamps to white', () => {
  const additive = buildAdditiveTable(greyPalette());

  assert.equal(mixOf(additive, MID_GREY, WHITE), WHITE);
});

test('averaging two colours is symmetric and lands halfway', () => {
  const average = buildAverageTable(greyPalette());

  assert.equal(mixOf(average, BLACK, MID_GREY), DARK_GREY);
  assert.equal(mixOf(average, MID_GREY, BLACK), DARK_GREY);
});

test('a weighted mix applies the first weight to the row colour and the second to the column colour', () => {
  const mostlyRow = buildWeightedTable(greyPalette(), 1, 0);

  assert.equal(mixOf(mostlyRow, MID_GREY, WHITE), MID_GREY);
  assert.equal(mixOf(mostlyRow, WHITE, BLACK), WHITE);
});

test('blending looks every pixel pair up with the source colour as the row', () => {
  const mostlySource = buildWeightedTable(greyPalette(), 1, 0);
  const destination = Uint8Array.of(BLACK, WHITE);
  const source = Uint8Array.of(MID_GREY, DARK_GREY);

  blendBuffers(destination, source, mostlySource);

  assert.deepEqual([...destination], [MID_GREY, DARK_GREY]);
});
