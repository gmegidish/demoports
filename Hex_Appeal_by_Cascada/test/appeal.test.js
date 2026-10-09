import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAppeal } from '../src/appeal.js';
import { appealExe } from './helpers.js';

const TAIL_START = 0xb21f3;

test('APPEAL.EXE splits into seven programs followed by the music', () => {
  const { programs, tailStart } = splitAppeal(appealExe);
  assert.equal(programs.length, 7);
  assert.equal(programs[2].start, 0x12e6c);
  assert.equal(tailStart, TAIL_START);
  assert.equal(new TextDecoder().decode(appealExe.subarray(TAIL_START + 1080, TAIL_START + 1084)), '6CHN');
});
