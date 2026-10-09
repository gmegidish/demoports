// Part 2's oscilloscopes against the original 68000 code. The fixtures come from tools/re/scopes_harness.py,
// which ran the real level-3 interrupt (dispatcher, effect, mt_music) under Unicorn: per frame of a scope they
// hold the registers the dispatcher handed over, the replayer and dispatcher state the scope read, and SHA-256
// hashes of the memory the scope owns (copper list, variables, both buffers) after it ran.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createMachine } from '../src/machine.js';
import { createChip } from '../src/display.js';
import { readDisk } from '../src/disk.js';
import { scope1, scope2 } from '../src/parts/part2-scopes.js';

/**
 * @typedef {object} RecordedFrame
 * @property {number} a0
 * @property {number} a1
 * @property {Array<[number, string]>} plants memory others wrote, as (address, hex bytes), as the scope found it
 * @property {string[]} hashes one per owned region, after the scope ran
 */
/**
 * @typedef {object} ScopeRecording
 * @property {string} scope
 * @property {Array<[number, number]>} regions the memory the scope owns, as [start, end)
 * @property {Array<[number, string]>} startDiff chip RAM before the first recorded frame, as changes from the
 *   freshly loaded part
 * @property {Array<[number, number]>} written every address the original wrote while the scope ran
 * @property {RecordedFrame[]} frames
 */

const disk = new Uint8Array(readFileSync(new URL('../assets/jesus-on-cheese.adf', import.meta.url)));
const PART2 = { offset: 0x1a200, length: 0x72000, address: 0xa500 };

/** @returns {ScopeRecording} */
function recordingOf(name) {
  const gzipped = readFileSync(new URL(`fixtures/part2-${name}.json.gz`, import.meta.url));
  return JSON.parse(gunzipSync(gzipped).toString());
}

function writeHex(m, address, hex) {
  m.mem.set(Buffer.from(hex, 'hex'), address);
}

/** A machine with part 2 loaded and its memory as the original's was when the recording started. */
function machineAsRecorded(recording) {
  const m = createMachine();
  m.chip = createChip();
  readDisk(m, disk, PART2.offset, PART2.length, PART2.address);
  for (const [address, hex] of recording.startDiff) {
    writeHex(m, address, hex);
  }
  return m;
}

function plantWhatTheScopeReads(m, frame) {
  for (const [address, hex] of frame.plants) {
    writeHex(m, address, hex);
  }
}

function hashesOfOwnedMemory(m, regions) {
  return regions.map(([start, end]) => createHash('sha256').update(m.mem.subarray(start, end)).digest('hex'));
}

function isInsideAny(address, ranges) {
  return ranges.some(([start, end]) => address >= start && address < end);
}

function addressesChangedOutside(before, after, ranges) {
  const outside = [];
  for (let address = 0; address < after.length; address++) {
    if (before[address] !== after[address] && !isInsideAny(address, ranges)) {
      outside.push(`$${address.toString(16)}`);
    }
  }
  return outside;
}

/**
 * Runs the port over every recorded frame. Returns the first frame whose owned memory differs from the
 * original's (or -1), and any write outside what the original wrote.
 */
function replay(recording, scope) {
  const m = machineAsRecorded(recording);
  let firstMismatch = -1;
  const strayWrites = new Set();
  recording.frames.forEach((frame, index) => {
    plantWhatTheScopeReads(m, frame);
    const before = m.mem.slice();
    scope(m, { a0: frame.a0, a1: frame.a1 });
    addressesChangedOutside(before, m.mem, recording.written).forEach((address) => strayWrites.add(address));
    const isSame = hashesOfOwnedMemory(m, recording.regions).every((hash, i) => hash === frame.hashes[i]);
    if (!isSame && firstMismatch < 0) {
      firstMismatch = index;
    }
  });
  return { firstMismatch, strayWrites: [...strayWrites] };
}

test('scope1 (the line scope, $d1c6) draws the same planes and copper values as the original, frame by frame', () => {
  const recording = recordingOf('scope1');
  const { firstMismatch } = replay(recording, scope1);
  assert.equal(recording.frames.length, 320);
  assert.equal(firstMismatch, -1, `first differing frame: ${firstMismatch}`);
});

test('scope1 writes only where the original writes', () => {
  assert.deepEqual(replay(recordingOf('scope1'), scope1).strayWrites, []);
});

test('scope2 (the filled scope over the picture, $d4e2) matches the original, frame by frame', () => {
  const recording = recordingOf('scope2');
  const { firstMismatch } = replay(recording, scope2);
  assert.equal(recording.frames.length, 720);
  assert.equal(firstMismatch, -1, `first differing frame: ${firstMismatch}`);
});

test('scope2 writes only where the original writes', () => {
  assert.deepEqual(replay(recordingOf('scope2'), scope2).strayWrites, []);
});

/** The script entry at $a8ea is the first with an upside-down picture and thick dots. */
const UPSIDE_DOWN_THICK_ENTRY_PARAMETERS = 0xa8ea + 4;

test('the scope2 recording reaches an upside-down picture with thick dots', () => {
  const frames = recordingOf('scope2').frames;
  assert.ok(frames.some((frame) => frame.a0 === UPSIDE_DOWN_THICK_ENTRY_PARAMETERS));
});
