// Render the demo's sound to a WAV file with the same mixer the AudioWorklet uses. No browser.
//
// usage: node tools/render-audio.mjs out.wav <seconds> [options]
//   --from <s>        start at this demo time (seconds since the boot block); default 0
//   --clicks a,b,...  frames at which the left button goes down (as the page would send them)
//   --part <1|2|3>    drive only that part's replayer: the part loaded at $a500, mt_init, then mt_music once a
//                     frame, starting at time 0 (no boot block, no other parts)
//   --rate <hz>       output sample rate; default 48000
//   --no-filter       without the A500's fixed low-pass filter
import { readFileSync, writeFileSync } from 'node:fs';
import { createRunner } from '../src/demo.js';
import { createMachine, FRAME_MS } from '../src/machine.js';
import { createChip, custom } from '../src/display.js';
import { createMixer } from '../src/paula.js';
import { mtInit, mtMusic, PART1_REPLAYER, PART2_REPLAYER, PART3_REPLAYER } from '../src/replayer.js';

/** @typedef {{ m: object, advanceTo: (ms: number) => void }} Clocked  Something that runs a machine up to a time. */

const BLOCK = 1024;
const PART_ADDRESS = 0xa500;
const PARTS = {
  1: { offset: 0xc00, length: 0x19600, replayer: PART1_REPLAYER },
  2: { offset: 0x1a200, length: 0x72000, replayer: PART2_REPLAYER },
  3: { offset: 0x8c200, length: 0x44a00, replayer: PART3_REPLAYER },
};
/** DMACON: set DMAEN, as the boot block leaves it. */
const DMA_MASTER_ON = 0x8200;

function option(args, name, fallback) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
}

/** Just one part's replayer at 50 Hz (the PAL frame), for checking the music without the parts' code. */
function replayerOnly(adf, number) {
  const { offset, length, replayer } = PARTS[number];
  const m = createMachine();
  m.chip = createChip();
  m.isAudioOnly = true;
  m.mem.set(adf.subarray(offset, offset + length), PART_ADDRESS);
  custom(m, 0x96, DMA_MASTER_ON);
  mtInit(m, replayer);
  let frame = 0;
  return {
    m,
    advanceTo(ms) {
      while (frame * FRAME_MS <= ms) {
        m.time = frame * FRAME_MS;
        mtMusic(m, replayer);
        frame++;
      }
    },
  };
}

function wav(left, right, rate) {
  const frames = left.length;
  const out = Buffer.alloc(44 + frames * 4);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + frames * 4, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(2, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 4, 28);
  out.writeUInt16LE(4, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(frames * 4, 40);
  const clip = (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
  for (let i = 0; i < frames; i++) {
    out.writeInt16LE(clip(left[i]), 44 + i * 4);
    out.writeInt16LE(clip(right[i]), 46 + i * 4);
  }
  return out;
}

const args = process.argv.slice(2);
const [out, secondsText] = args;
const seconds = Number(secondsText);
const fromMs = Number(option(args, '--from', '0')) * 1000;
const rate = Number(option(args, '--rate', '48000'));
const clicks = option(args, '--clicks', '').split(',').filter(Boolean).map(Number);
const part = option(args, '--part', null);
const adf = new Uint8Array(readFileSync(new URL('../assets/jesus-on-cheese.adf', import.meta.url)));

/** @type {Clocked} */
const clocked = part ? replayerOnly(adf, Number(part)) : createRunner(adf, { isAudioOnly: true, clicks });
const mixer = createMixer(clocked.m, rate, { isA500Filter: !args.includes('--no-filter') });
clocked.advanceTo(fromMs);
mixer.skipTo(fromMs);
const total = Math.round(seconds * rate);
const left = new Float32Array(total);
const right = new Float32Array(total);
for (let at = 0; at < total; at += BLOCK) {
  const count = Math.min(BLOCK, total - at);
  clocked.advanceTo(mixer.ms + (count * 1000) / rate);
  mixer.render(left, right, at, count);
}
writeFileSync(out, wav(left, right, rate));
