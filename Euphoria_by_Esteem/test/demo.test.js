// Every part starts and runs a few seconds headless without error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PART_STARTS } from '../src/demo.js';
import { demoAt } from './helpers.js';

const SECONDS_INTO_EACH_PART = 3;

PART_STARTS.forEach((start, part) => {
  test(`part ${part} (from ${start} s) runs`, () => {
    const demo = demoAt(start + SECONDS_INTO_EACH_PART);
    assert.ok(demo.machine.time >= start + SECONDS_INTO_EACH_PART || demo.machine.isOver);
  });
});
