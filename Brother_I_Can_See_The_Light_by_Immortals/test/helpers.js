// What every test needs: the demo's files, read out of BROTHER.EXE, and its module.
import { readFileSync } from 'node:fs';
import { readBundle, createAssets } from '../src/bundle.js';
import { createDemo, finishLoading, seekTo } from '../src/demo.js';
import { renderFrame } from '../src/screen.js';

const DEMO_FOLDER = new URL('../', import.meta.url);

export function readDemoFile(name) {
  return new Uint8Array(readFileSync(new URL(name, DEMO_FOLDER)));
}

export function demoFiles() {
  return readBundle(readDemoFile('BROTHER.EXE'));
}

export function demoAssets() {
  return createAssets(demoFiles());
}

export function demoMusic() {
  return readDemoFile('BICSTL.XM');
}

const RUN_IN_SECONDS = 0.5;
const FRAME_SECONDS = 1 / 70;

/**
 * A fresh demo played up to `seconds` of music: a jump to half a second before, then frames at
 * 70 per second, as the original's VGA shows them.
 */
export function demoAt(seconds) {
  const demo = createDemo(demoAssets(), demoMusic());
  finishLoading(demo);
  seekTo(demo, Math.max(0, seconds - RUN_IN_SECONDS));
  while (demo.machine.time + FRAME_SECONDS <= seconds) {
    demo.machine.time += FRAME_SECONDS;
    demo.step();
  }
  demo.machine.time = seconds;
  demo.step();
  return demo;
}

/** What the monitor shows at `seconds`, as 8-bit RGB bytes. */
export function screenAt(seconds) {
  const frame = renderFrame(demoAt(seconds).machine, readDemoFile('assets/vga8x16.bin'));
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
