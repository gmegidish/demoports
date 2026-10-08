import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unpackWwpack } from '../src/wwpack.js';

// The 32-bit segment starts at image offset 0xec0 and its initialised data
// ends at code32 offset 0x781c0.
const CODE32_START = 0xec0;
const CODE32_DATA_END = 0x781c0;
const CHECKED_IMAGE_END = CODE32_START + CODE32_DATA_END;
// The unpacked relocation code, then the moved stub, its table and stack.
const STUB_LEFTOVERS_START = 0x57070;
// SHA-1 of bytes 0..0x79080 of the image the original stub left in Unicorn.
const UNICORN_IMAGE_SHA1 = 'dd3a9e9213d3f1981a0b07d755bde3c6f8e18e68';

function readControlExe() {
  return readFileSync(new URL('../CONTROL.EXE', import.meta.url));
}

function sha1(bytes) {
  return createHash('sha1').update(bytes).digest('hex');
}

function unpackedImage() {
  return unpackWwpack(readControlExe());
}

function wordAt(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

// Adding 0x1000 to a segment word only changes its high byte.
function relocatedWordOffsets(lowerImage, higherImage, end) {
  const offsets = [];
  for (let offset = 1; offset < end; offset++) {
    if (lowerImage[offset] !== higherImage[offset]) {
      offsets.push(offset - 1);
    }
  }
  return offsets;
}

test('unpacking CONTROL.EXE gives the same image as running the original stub', () => {
  const image = unpackedImage();
  assert.ok(image.length >= CHECKED_IMAGE_END);
  assert.equal(sha1(image.subarray(0, CHECKED_IMAGE_END)), UNICORN_IMAGE_SHA1);
});

test('the program stack holds the far return to the entry point 0000:03d9', () => {
  const image = unpackedImage();
  const returnFrame = 0x76480 + 0x2c00 - 4;
  assert.equal(wordAt(image, returnFrame), 0x03d9);
  assert.equal(wordAt(image, returnFrame + 2), 0x1010);
});

test('loading 64 KB higher changes the 20 relocated segment words of the program', () => {
  const exe = readControlExe();
  const atUnicornSegment = unpackWwpack(exe, 0x1010);
  const atNextSegment = unpackWwpack(exe, 0x2010);
  const relocated = relocatedWordOffsets(atUnicornSegment, atNextSegment, STUB_LEFTOVERS_START);
  assert.equal(relocated.length, 20);
  assert.equal(relocated[0], 0x3f3);
  for (const offset of relocated) {
    assert.equal(wordAt(atNextSegment, offset) - wordAt(atUnicornSegment, offset), 0x1000);
  }
});

test('a file that is not an MZ executable is rejected', () => {
  assert.throws(() => unpackWwpack(new Uint8Array(64)), /not an MZ executable/);
});
