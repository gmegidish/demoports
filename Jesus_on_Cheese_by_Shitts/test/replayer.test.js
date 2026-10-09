// The ported replay routines against the original 68000 code, run under Unicorn by tools/re/trace_replayer.py.
// For every module: the same Paula register writes in the same order (and on the same side of the DMA wait
// loops), the same replayer variables and channel structures after every frame, the same sample bytes
// changed at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createMachine, FRAME_MS, LINE_MS } from '../src/machine.js';
import { createChip } from '../src/display.js';
import { LED_FILTER } from '../src/paula.js';
import { mtInit, mtMusic, PART1_REPLAYER, PART2_REPLAYER, PART3_REPLAYER, DMA_WAIT_MS } from '../src/replayer.js';

/**
 * @typedef {object} Fixture
 * @property {number} part
 * @property {number} frames
 * @property {number} varsStart
 * @property {number} varsLength
 * @property {number[]} varsAfterInit
 * @property {Array<[number, number, number|string, number]>} writes  [frame (-1 = init), DMA waits so far, reg, value]
 * @property {Array<[number, number, number]>} varChanges  [frame, offset, byte]
 * @property {Array<[number, number]>} memoryChanges  [address, byte]
 * @property {Array<[number, string]>} patch  [address, hex bytes]: random patterns over the module (fuzzing)
 */

const PART_ADDRESS = 0xa500;
const PARTS = {
  1: { offset: 0xc00, length: 0x19600, replayer: PART1_REPLAYER },
  2: { offset: 0x1a200, length: 0x72000, replayer: PART2_REPLAYER },
  3: { offset: 0x8c200, length: 0x44a00, replayer: PART3_REPLAYER },
};
const INIT_FRAME = -1;
/** The CIA-A port write as the harness logs it; bit 1 high = LED (and its filter) off. */
const CIA_PORT = 'bfe001';
const LED_BIT = 2;

const adf = new Uint8Array(readFileSync(new URL('../assets/jesus-on-cheese.adf', import.meta.url)));

const FIXTURES = new URL('./fixtures/', import.meta.url);
const FIXTURE_NAME = /^replayer-.*\.json\.gz$/;

/** @returns {Fixture} */
function loadFixture(name) {
  return JSON.parse(gunzipSync(readFileSync(new URL(name, FIXTURES))).toString('utf8'));
}

/** The part as the boot block loads it, with the fixture's fuzzed patterns if any. */
function machineWithPartLoaded(fixture) {
  const m = createMachine();
  m.chip = createChip();
  m.isAudioOnly = true;
  const { offset, length } = PARTS[fixture.part];
  m.mem.set(adf.subarray(offset, offset + length), PART_ADDRESS);
  for (const [address, hex] of fixture.patch ?? []) {
    m.mem.set(Buffer.from(hex, 'hex'), address);
  }
  return m;
}

/** The queued Paula writes, in the harness's terms: [frame, DMA waits so far, reg, value]. */
function writesSince(m, first, frame, replayer) {
  const events = m.paula ? m.paula.events.slice(first) : [];
  return events.map(({ time, reg, value }) => {
    const sinceCall = frame === INIT_FRAME ? 0 : time - m.time - replayer.musicLine * LINE_MS;
    const waits = Math.round(sinceCall / DMA_WAIT_MS);
    if (reg === LED_FILTER) {
      return [frame, waits, CIA_PORT, value ? 0 : LED_BIT];
    }
    return [frame, waits, reg, value];
  });
}

/** The harness logs the whole $bfe001 byte; only the LED bit matters. */
function onlyTheLedBit(writes) {
  return writes.map(([frame, waits, reg, value]) => (reg === CIA_PORT ? [frame, waits, reg, value & LED_BIT] : [frame, waits, reg, value]));
}

/** Run the ported replayer as the fixture's harness ran the original: init, then one call per frame. */
function runPortedReplayer(fixture, onFrame) {
  const replayer = PARTS[fixture.part].replayer;
  const m = machineWithPartLoaded(fixture);
  const writes = [];
  m.time = INIT_FRAME * FRAME_MS;
  mtInit(m, replayer);
  writes.push(...writesSince(m, 0, INIT_FRAME, replayer));
  onFrame(m, INIT_FRAME);
  for (let frame = 0; frame < fixture.frames; frame++) {
    const first = m.paula ? m.paula.events.length : 0;
    m.time = frame * FRAME_MS;
    mtMusic(m, replayer);
    writes.push(...writesSince(m, first, frame, replayer));
    onFrame(m, frame);
  }
  return { m, writes };
}

/** The original's variables after each frame, rebuilt from the fixture's per-frame byte changes. */
function originalVariablesByFrame(fixture) {
  const changes = new Map();
  for (const [frame, offset, value] of fixture.varChanges) {
    if (!changes.has(frame)) {
      changes.set(frame, []);
    }
    changes.get(frame).push([offset, value]);
  }
  const current = Uint8Array.from(fixture.varsAfterInit);
  return (frame) => {
    for (const [offset, value] of changes.get(frame) ?? []) {
      current[offset] = value;
    }
    return current;
  };
}

function firstDifferentWrite(actual, expected) {
  const count = Math.max(actual.length, expected.length);
  for (let i = 0; i < count; i++) {
    if (JSON.stringify(actual[i]) !== JSON.stringify(expected[i])) {
      return { index: i, ported: actual[i], original: expected[i] };
    }
  }
  return null;
}

function firstDifferentByte(actual, expected) {
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      return i;
    }
  }
  return -1;
}

function memoryChangedOutside(m, fixture) {
  const original = machineWithPartLoaded(fixture).mem;
  const changed = [];
  for (let address = 0; address < m.mem.length; address++) {
    const isVariable = address >= fixture.varsStart && address < fixture.varsStart + fixture.varsLength;
    if (!isVariable && m.mem[address] !== original[address]) {
      changed.push([address, m.mem[address]]);
    }
  }
  return changed;
}

for (const name of readdirSync(FIXTURES).filter((file) => FIXTURE_NAME.test(file)).sort()) {
  const fixture = loadFixture(name);
  const song = fixture.patch.length ? 'random patterns' : 'its module';
  test(`part ${fixture.part}'s replayer plays ${song} (${name}) exactly as the original does`, () => {
    const originalVariables = originalVariablesByFrame(fixture);
    let variableMismatch = null;
    const { m, writes } = runPortedReplayer(fixture, (machine, frame) => {
      if (variableMismatch) {
        return;
      }
      const ported = machine.mem.subarray(fixture.varsStart, fixture.varsStart + fixture.varsLength);
      const offset = firstDifferentByte(ported, originalVariables(frame));
      if (offset >= 0) {
        variableMismatch = `frame ${frame}: byte $${(fixture.varsStart + offset).toString(16)} is ${ported[offset]}`;
      }
    });
    assert.equal(variableMismatch, null);
    assert.deepEqual(firstDifferentWrite(onlyTheLedBit(writes), onlyTheLedBit(fixture.writes)), null);
    assert.deepEqual(memoryChangedOutside(m, fixture), fixture.memoryChanges);
  });
}
