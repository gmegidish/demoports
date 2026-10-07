// Render moments of the demo to PNG files, headless:
//   node tools/shot.mjs out-prefix 12.5 30 61.2      (seconds from the start of the music)
import { createDemo, finishLoading, seekTo } from '../src/demo.js';
import { demoAssets, demoMusic } from '../test/helpers.js';
import { writeFramePng } from './png.mjs';
import { renderFrame } from '../src/screen.js';
import { readDemoFile } from '../test/helpers.js';

/** Each moment is approached over this long, at 70 frames per second, so fades look as they do in play. */
const RUN_IN_SECONDS = 0.5;
const FRAME_SECONDS = 1 / 70;

const [prefix, ...times] = process.argv.slice(2);
const font = readDemoFile('assets/vga8x16.bin');
const demo = createDemo(demoAssets(), demoMusic());
const loadStart = performance.now();
finishLoading(demo);
process.stdout.write(`loaded in ${Math.round(performance.now() - loadStart)} ms\n`);
for (const seconds of times.map(Number).sort((a, b) => a - b)) {
  const frameStart = performance.now();
  seekTo(demo, Math.max(demo.machine.time, seconds - RUN_IN_SECONDS));
  while (demo.machine.time + FRAME_SECONDS <= seconds) {
    demo.machine.time += FRAME_SECONDS;
    demo.step();
  }
  demo.machine.time = seconds;
  demo.step();
  const path = `${prefix}-${seconds.toFixed(2).padStart(6, '0')}.png`;
  writeFramePng(path, renderFrame(demo.machine, font));
  process.stdout.write(`${path}  (${Math.round(performance.now() - frameStart)} ms)\n`);
}
