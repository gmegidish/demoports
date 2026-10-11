// Whole-run check: for recording frames, the smallest number of differing pixels over port frames frame+s,
// s in [-before, +after] (the original renders every few retraces, so a recorded picture is an older port frame):
//   node tools/re/sweep.mjs [--rate R] [--before B] [--after A] FRAME...
import { parseArgs } from 'node:util';
import { createDemo } from '../../src/demo.js';
import { renderFrame } from '../../src/screen.js';
import { loadFiles } from '../files.mjs';
import { runToRecordingFrame } from '../run.mjs';
import { recordedFrames } from './recording.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  rate: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' } } });
const before = Number(values.before ?? 20);
const after = Number(values.after ?? 3);
const frames = positionals.map(Number).sort((a, b) => a - b);
const recorded = recordedFrames(frames);
const demo = createDemo(loadFiles(), { musicRate: Number(values.rate ?? 1) });
const window = new Map();
for (const { frame, width, height, rgb } of recorded) {
  let best = [Infinity, 0];
  for (let s = -before; s <= after; s++) {
    const g = frame + s;
    if (g < 0) {
      continue;
    }
    if (!window.has(g)) {
      runToRecordingFrame(demo, g);
      window.set(g, renderFrame(demo.state.vga));
    }
    const port = window.get(g);
    if (port.width !== width || port.height !== height) {
      continue;
    }
    let differing = 0;
    for (let p = 0; p < width * height; p++) {
      if (rgb[p * 3] !== port.rgba[p * 4] || rgb[p * 3 + 1] !== port.rgba[p * 4 + 1] || rgb[p * 3 + 2] !== port.rgba[p * 4 + 2]) {
        differing++;
      }
    }
    if (differing < best[0]) {
      best = [differing, s];
    }
  }
  for (const g of window.keys()) {
    if (g < frame) {
      window.delete(g);
    }
  }
  console.log(frame, best[0], best[1]);
}
