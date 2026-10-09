// The demo's sound, made in the audio thread: an AudioWorkletProcessor that runs its own copy of the demo
// (createRunner with isAudioOnly: the parts skip their drawing but run the replayers exactly as they do on
// screen) and mixes Paula in step with its sample clock. The demo is deterministic, so this runner and the
// page's runner agree as long as they are given the same clicks.
//
// Load with `audioContext.audioWorklet.addModule('src/audio-worklet.js')` and
// `new AudioWorkletNode(audioContext, 'paula', { outputChannelCount: [2] })`.
//
// The clock: demo time (ms) = startMs + (AudioContext.currentTime - contextTime) * 1000, the same formula on
// both threads. The page should draw for `currentTime - outputLatency` if it wants pictures and sound to meet.
//
// Messages to the worklet (node.port.postMessage):
//   { type: 'start', adf: Uint8Array, startMs: number, clicks: number[], contextTime?: number }
//       Build a runner (from a copy of the disk image) and play from demo time `startMs`, which is reached at
//       AudioContext time `contextTime` (default: the first audio block after the message). Before 'start'
//       the worklet outputs silence. Replies { type: 'ready' } once the runner is built.
//   { type: 'seek', ms: number, clicks: number[], contextTime?: number }
//       A new runner advanced to `ms` (the writes on the way are applied silently, so every channel is where
//       it would be), playing from there. `clicks` replaces the click list. Replies { type: 'ready' }.
//   { type: 'click', frame: number }
//       The left button goes down at demo frame `frame` (m.frame, as isLeftButtonDown counts). Send a frame a
//       little ahead of the one on screen (2 frames is plenty): the worklet runs up to one audio block (~3 ms) plus
//       one frame ahead of currentTime, and the page draws behind it by the output latency. If the worklet has already passed that frame it rebuilds its runner from the start
//       with the new click list and catches up silently, so the two runners never disagree.
//   { type: 'stop' }
//       Silence until the next 'start'.
// Messages from the worklet: { type: 'ready' }, and { type: 'error', message } if the runner throws.
//
// Only modules without DOM access are imported here (demo.js and what it imports: machine, display, blitter,
// disk, paula, replayer, parts), so this file runs in AudioWorkletGlobalScope.

import { createRunner } from './demo.js';
import { createMixer } from './paula.js';

/**
 * @typedef {object} Song  What the page asked to play.
 * @property {Uint8Array} adf
 * @property {number[]} clicks
 * @property {number} [startMs]             demo time reached at contextTime
 * @property {number|null} [contextTime]    AudioContext time of startMs; null until the first block
 */

/** If the mixer is further than this from where the clock says it should be, jump (or wait) instead of mixing. */
const RESYNC_MS = 50;

class PaulaProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    /** @type {Song|null} */
    this.song = null;
    this.runner = null;
    this.mixer = null;
    this.port.onmessage = (event) => this.receive(event.data);
  }

  receive(message) {
    try {
      if (message.type === 'start') {
        this.song = { adf: new Uint8Array(message.adf), clicks: [...(message.clicks ?? [])] };
        this.play(message.startMs ?? 0, message.contextTime);
      } else if (message.type === 'seek' && this.song) {
        this.song = { ...this.song, clicks: [...(message.clicks ?? this.song.clicks)] };
        this.play(message.ms, message.contextTime);
      } else if (message.type === 'click' && this.song) {
        this.click(message.frame);
      } else if (message.type === 'stop') {
        this.song = null;
        this.runner = null;
        this.mixer = null;
      }
    } catch (error) {
      this.port.postMessage({ type: 'error', message: String(error && error.stack || error) });
    }
  }

  /** A fresh runner at demo time `ms`, reached at AudioContext time `contextTime`. */
  play(ms, contextTime) {
    this.build(ms);
    this.song.startMs = ms;
    this.song.contextTime = contextTime ?? null;
    this.port.postMessage({ type: 'ready' });
  }

  build(ms) {
    this.runner = createRunner(this.song.adf, { isAudioOnly: true, clicks: this.song.clicks });
    this.mixer = createMixer(this.runner.m, sampleRate);
    this.runner.advanceTo(ms);
    this.mixer.skipTo(ms);
  }

  click(frame) {
    this.song.clicks = [...this.song.clicks, frame];
    if (frame >= this.runner.m.frame) {
      this.runner.m.clicks.push(frame);
      return;
    }
    // Too late for this runner: replay the demo with the click, up to where the sound is.
    this.build(this.mixer.ms);
  }

  /** Where the clock says the demo is at the start of this block. */
  demoMsNow() {
    if (this.song.contextTime === null) {
      this.song.contextTime = currentTime;
    }
    return this.song.startMs + (currentTime - this.song.contextTime) * 1000;
  }

  process(inputs, outputs) {
    const [left, right] = outputs[0];
    if (!this.mixer || !right) {
      return true;
    }
    try {
      const wanted = this.demoMsNow();
      const blockMs = (left.length * 1000) / sampleRate;
      if (wanted + blockMs <= this.mixer.ms) {
        // The clock is behind the sound (a start time in the future): wait in silence until the block it starts in.
        return true;
      }
      if (wanted > this.mixer.ms + RESYNC_MS) {
        this.runner.advanceTo(wanted);
        this.mixer.skipTo(wanted);
      }
      this.runner.advanceTo(this.mixer.ms + blockMs);
      this.mixer.render(left, right, 0, left.length);
    } catch (error) {
      this.port.postMessage({ type: 'error', message: String(error && error.stack || error) });
      this.mixer = null;
    }
    return true;
  }
}

registerProcessor('paula', PaulaProcessor);
