// Render moments of the demo to PNG files, headless:
//   node tools/shot.mjs out-prefix 12.5 30 61.2         (seconds on the soundtrack = the recording)
//   FROM=5 node tools/shot.mjs out 20                   (play every frame from 5 s instead of 0.5 s before)
import { createDemo, seekTo } from '../src/demo.js';
import { demoFiles, playTo, readDemoFile } from '../test/helpers.js';
import { writeFramePng } from './png.mjs';
import { renderFrame } from '../src/screen.js';

const RUN_IN_SECONDS = 0.5;
const [prefix, ...times] = process.argv.slice(2);
const font = readDemoFile('assets/vga8x16.bin');
const demo = createDemo(demoFiles());
const from = process.env.FROM === undefined ? undefined : Number(process.env.FROM);
let isFirst = true;
for (const seconds of times.map(Number).sort((a, b) => a - b)) {
  const frameStart = performance.now();
  const jumpTo = isFirst && from !== undefined ? from : seconds - RUN_IN_SECONDS;
  if (jumpTo > demo.machine.time) {
    seekTo(demo, jumpTo);
  }
  isFirst = false;
  playTo(demo, seconds);
  const path = `${prefix}-${seconds.toFixed(2).padStart(6, '0')}.png`;
  writeFramePng(path, renderFrame(demo.machine, font));
  process.stdout.write(`${path}  (${Math.round(performance.now() - frameStart)} ms)\n`);
}
