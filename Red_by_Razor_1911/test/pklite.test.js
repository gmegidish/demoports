import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unpackRed } from '../src/pklite.js';

const RED_EXE = new URL('../RED.EXE', import.meta.url);
const EMULATED_IMAGE = new URL('../tools/re/work/img.bin', import.meta.url);
const EMULATED_RELOCATIONS = new URL('../tools/re/work/relocs.txt', import.meta.url);

/** What the stub writes from load:0000; img.bin continues with leftovers of the packed copy. */
const IMAGE_BYTES = 0x8b1ff;
const IMAGE_MD5 = '42b0606af98c4d8d707a21978c71be32';
const MOD_SIGNATURE_AT = 0x828d8;    // 824a:0000 + 0x438
const CREDITS_TEXT_AT = 0x16c74;
/** Words unpack.py saw change by the load segment that the stub's table does not list (stack / leftovers). */
const NOT_RELOCATIONS = [0x2285e, 0x8c58e];

const unpacked = unpackRed(new Uint8Array(readFileSync(RED_EXE)));

function textAt(image, offset, length) {
  return String.fromCharCode(...image.subarray(offset, offset + length));
}

function md5(bytes) {
  return createHash('md5').update(bytes).digest('hex');
}

test('the PKLITE stub unpacks RED.EXE to the program, entry 0000:0000, stack 2276:0100', () => {
  assert.equal(unpacked.image.length, IMAGE_BYTES);
  assert.equal(md5(unpacked.image), IMAGE_MD5);
  assert.equal(unpacked.relocations.length, 68);
  assert.deepEqual(unpacked.entry, { cs: 0, ip: 0 });
  assert.deepEqual(unpacked.stack, { ss: 0x2276, sp: 0x100 });
});

test('the image holds the MOD and the credits where the program expects them', () => {
  assert.equal(textAt(unpacked.image, MOD_SIGNATURE_AT, 4), 'M.K.');
  assert.equal(textAt(unpacked.image, CREDITS_TEXT_AT, 18), 'Coding : PERFORMER');
});

test('the image equals what the emulated stub left in memory (tools/re/work/img.bin)', { skip: !existsSync(EMULATED_IMAGE) }, () => {
  const emulated = new Uint8Array(readFileSync(EMULATED_IMAGE));
  assert.deepEqual(Buffer.from(unpacked.image), Buffer.from(emulated.subarray(0, IMAGE_BYTES)));
});

test('the relocations are the ones unpack.py found by diffing two load segments', { skip: !existsSync(EMULATED_RELOCATIONS) }, () => {
  const found = readFileSync(EMULATED_RELOCATIONS, 'utf8').split(/\s+/).filter(Boolean).map((hex) => parseInt(hex, 16));
  assert.deepEqual(unpacked.relocations, found.filter((offset) => !NOT_RELOCATIONS.includes(offset)));
});
