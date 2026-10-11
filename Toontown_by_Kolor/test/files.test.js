// The two file formats the port reads itself: the PMW1 executable and the module's timeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPmw1, PROGRAM_BASE } from '../src/pmw1.js';
import { rowTimeline, rowAt } from '../src/xm.js';
import { loadFiles } from '../tools/files.mjs';

const { exe, xm } = loadFiles();

function readCString(mem, address) {
  let text = '';
  for (let a = address; mem[a] !== 0; a++) {
    text += String.fromCharCode(mem[a]);
  }
  return text;
}

test('TOONTOWN.EXE unpacks to the program the listing describes', () => {
  const { mem, eip, objects } = loadPmw1(exe, 0x200000);
  assert.equal(eip, 0x114b6c);
  assert.equal(objects[1].base, PROGRAM_BASE);
  assert.equal(objects[1].size, 179543);
  assert.equal(readCString(mem, 0x127102), '\xfe Digging out music');
});

test('the module plays 52 positions of 5.12 s each, the last W01 sync at position 43', () => {
  const timeline = rowTimeline(xm);
  const end = timeline[timeline.length - 1];
  assert.equal(end.position, 52);
  assert.ok(Math.abs(end.time - 266.24) < 1e-9);
  assert.equal(end.syncs, 52);
  assert.equal(rowAt(timeline, 225.27).syncs, 52);
  assert.equal(rowAt(timeline, 81.9).syncs, 0);
});
