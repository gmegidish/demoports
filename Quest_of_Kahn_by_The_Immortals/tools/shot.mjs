// Render moments of the demo to PNG files, headless:
//   node tools/shot.mjs out-prefix 12.5 30 61.2      (seconds from the start of the music)
import { createDemo, finishLoading, seekTo } from '../src/demo.js';
import { TICKS_PER_SECOND } from '../src/machine.js';
import { demoAssets } from '../test/helpers.js';
import { writeScreenPng } from './png.mjs';

const [prefix, ...times] = process.argv.slice(2);
const demo = createDemo(demoAssets());
const loadStart = performance.now();
finishLoading(demo);
process.stdout.write(`loaded in ${Math.round(performance.now() - loadStart)} ms\n`);
for (const seconds of times.map(Number).sort((a, b) => a - b)) {
  const frameStart = performance.now();
  seekTo(demo, Math.round(seconds * TICKS_PER_SECOND));
  const { machine } = demo;
  const path = `${prefix}-${seconds.toFixed(1).padStart(5, '0')}.png`;
  writeScreenPng(path, machine.front, machine.dac, machine.width, machine.height);
  process.stdout.write(`${path}  (${Math.round(performance.now() - frameStart)} ms)\n`);
}
