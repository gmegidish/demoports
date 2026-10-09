// The AudioWorklet, run under node with the few globals AudioWorkletGlobalScope gives it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../src/demo.js';
import { createMixer } from '../src/paula.js';
import { FRAME_MS } from '../src/machine.js';

/** @typedef {{ type: string }} WorkletMessage */

const SAMPLE_RATE = 48000;
const BLOCK = 128;
/** Part 1's music is playing by then (the part starts about 6.5 s after the boot block). */
const MUSIC_MS = 8000;

const processors = new Map();
globalThis.sampleRate = SAMPLE_RATE;
globalThis.currentTime = 0;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.sent = [];
    this.port = { postMessage: (message) => this.sent.push(message), onmessage: null };
  }
};
globalThis.registerProcessor = (name, processorClass) => processors.set(name, processorClass);
await import('../src/audio-worklet.js');

const adf = new Uint8Array(readFileSync(new URL('../assets/jesus-on-cheese.adf', import.meta.url)));

function createWorklet() {
  const Processor = processors.get('paula');
  return new Processor();
}

/** @param {WorkletMessage} message */
function send(worklet, message) {
  worklet.port.onmessage({ data: message });
}

/** Run the worklet for `blocks` render quanta from AudioContext time `fromSeconds`; returns the left channel. */
function listen(worklet, fromSeconds, blocks) {
  const left = new Float32Array(blocks * BLOCK);
  for (let block = 0; block < blocks; block++) {
    globalThis.currentTime = fromSeconds + (block * BLOCK) / SAMPLE_RATE;
    const outputs = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
    worklet.process([], outputs);
    left.set(outputs[0][0], block * BLOCK);
  }
  return left;
}

/** The same stretch of sound made directly: a runner and a mixer, no worklet. */
function renderDirectly(startMs, samples, clicks = []) {
  const runner = createRunner(adf, { isAudioOnly: true, clicks });
  const mixer = createMixer(runner.m, SAMPLE_RATE);
  runner.advanceTo(startMs);
  mixer.skipTo(startMs);
  const left = new Float32Array(samples);
  const right = new Float32Array(samples);
  for (let at = 0; at < samples; at += BLOCK) {
    runner.advanceTo(mixer.ms + (BLOCK * 1000) / SAMPLE_RATE);
    mixer.render(left, right, at, BLOCK);
  }
  return left;
}

const loudness = (samples) => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);

test('the worklet is silent until it is started', () => {
  const worklet = createWorklet();
  assert.equal(loudness(listen(worklet, 0, 10)), 0);
});

test('after start, the worklet says it is ready and plays what a mixer driven directly plays', () => {
  const worklet = createWorklet();
  send(worklet, { type: 'start', adf, startMs: MUSIC_MS, clicks: [], contextTime: 1 });
  assert.deepEqual(worklet.sent, [{ type: 'ready' }]);
  const heard = listen(worklet, 1, 200);
  assert.ok(loudness(heard) > 0.01);
  assert.deepEqual(heard, renderDirectly(MUSIC_MS, heard.length));
});

test('a seek plays from the new time, as if the demo had run there', () => {
  const worklet = createWorklet();
  send(worklet, { type: 'start', adf, startMs: 0, clicks: [], contextTime: 0 });
  listen(worklet, 0, 10);
  send(worklet, { type: 'seek', ms: MUSIC_MS, clicks: [], contextTime: 5 });
  const heard = listen(worklet, 5, 100);
  assert.deepEqual(heard, renderDirectly(MUSIC_MS, heard.length));
});

test('a click the worklet has already passed still ends part 1 for the sound', () => {
  const clickFrame = Math.round(MUSIC_MS / FRAME_MS);
  const worklet = createWorklet();
  send(worklet, { type: 'start', adf, startMs: MUSIC_MS + 200, clicks: [], contextTime: 0 });
  listen(worklet, 0, 10);
  send(worklet, { type: 'click', frame: clickFrame });
  const later = 3;
  const heard = listen(worklet, later, 50);
  const atMs = MUSIC_MS + 200 + later * 1000;
  assert.ok(loudness(renderDirectly(atMs, heard.length)) > 0.01, 'without the click the music would still play');
  assert.equal(loudness(renderDirectly(atMs, heard.length, [clickFrame])), 0);
  assert.equal(loudness(heard), 0);
});
