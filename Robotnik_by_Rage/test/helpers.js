// What every test needs: the demo's files, read out of ROBOTNIK.EXE.
import { readFileSync } from 'node:fs';
import { openExe } from '../src/files.js';
import { createDemo, seekTo } from '../src/demo.js';
import { renderFrame } from '../src/screen.js';

const DEMO_FOLDER = new URL('../', import.meta.url);
const FRAME_SECONDS = 1 / 70.086;
const RUN_IN_SECONDS = 0.5;

export function readDemoFile(name) {
  return new Uint8Array(readFileSync(new URL(name, DEMO_FOLDER)));
}

let cachedFiles;
export function demoFiles() {
  cachedFiles ??= openExe(readDemoFile('ROBOTNIK.EXE'));
  return cachedFiles;
}

/** Play forward to `seconds` one 70 Hz frame at a time, as the VGA shows them. */
export function playTo(demo, seconds) {
  while (demo.machine.time + FRAME_SECONDS <= seconds && !demo.isOver) {
    demo.machine.time += FRAME_SECONDS;
    demo.step();
  }
  demo.machine.time = seconds;
  demo.step();
}

/**
 * A fresh demo at `seconds` of the soundtrack: a jump to `from` (default half a second before),
 * then frames at 70 per second.
 */
export function demoAt(seconds, from = seconds - RUN_IN_SECONDS) {
  const demo = createDemo(demoFiles());
  seekTo(demo, Math.max(0, from));
  playTo(demo, seconds);
  return demo;
}

/** What the monitor shows, as 8-bit RGB bytes. */
export function screenOf(demo) {
  const frame = renderFrame(demo.machine, readDemoFile('assets/vga8x16.bin'));
  const rgb = new Uint8Array(frame.pixels.length * 3);
  frame.pixels.forEach((rgba, i) => {
    rgb[i * 3] = rgba & 0xff;
    rgb[i * 3 + 1] = (rgba >> 8) & 0xff;
    rgb[i * 3 + 2] = (rgba >> 16) & 0xff;
  });
  return rgb;
}

/** Pixels whose colour differs by more than DOSBox's rounding of a 6-bit DAC value. */
export function countDifferentPixels(a, b) {
  let count = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.abs(a[i] - b[i]) > 2 || Math.abs(a[i + 1] - b[i + 1]) > 2 || Math.abs(a[i + 2] - b[i + 2]) > 2) {
      count++;
    }
  }
  return count;
}
