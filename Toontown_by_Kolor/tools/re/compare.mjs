// Compares the port with the recording, frame by frame:
//   node tools/re/compare.mjs [--rate R] [--part NAME] [--shift S] [--png DIR] FRAME...
// Port frame g + shift is compared with recording frame g. Prints the number of differing pixels; --png writes
// recording | port | difference side by side. --rate and --part as in tools/frames.mjs.
import { mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createDemo } from '../../src/demo.js';
import { renderFrame } from '../../src/screen.js';
import { writeFramePng } from '../png.mjs';
import { loadFiles } from '../files.mjs';
import { runToRecordingFrame } from '../run.mjs';
import { recordedFrames } from './recording.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  rate: { type: 'string' }, part: { type: 'string' }, shift: { type: 'string' }, png: { type: 'string' } } });
const shift = Number(values.shift ?? 0);
const frames = positionals.map(Number).sort((a, b) => a - b);
const recorded = recordedFrames(frames);
const demo = createDemo(loadFiles(), { musicRate: Number(values.rate ?? 1), firstPart: values.part });
if (values.png) {
  mkdirSync(values.png, { recursive: true });
}
for (const { frame, width, height, rgb } of recorded) {
  runToRecordingFrame(demo, frame + shift);
  const port = renderFrame(demo.state.vga);
  if (port.width !== width || port.height !== height) {
    console.log(frame, `size ${port.width}x${port.height} vs recording ${width}x${height}`);
    continue;
  }
  let differing = 0;
  const out = new Uint8Array(width * 3 * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const r = [rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]];
      const q = [port.rgba[p * 4], port.rgba[p * 4 + 1], port.rgba[p * 4 + 2]];
      const isSame = r[0] === q[0] && r[1] === q[1] && r[2] === q[2];
      differing += isSame ? 0 : 1;
      const row = y * width * 3;
      out.set([...r, 255], (row + x) * 4);
      out.set([...q, 255], (row + width + x) * 4);
      out.set(isSame ? [0, 0, 0, 255] : [255, 0, 255, 255], (row + 2 * width + x) * 4);
    }
  }
  console.log(frame, differing);
  if (values.png) {
    writeFramePng(`${values.png}/cmp-${frame}.png`, { width: width * 3, height, rgba: out });
  }
}
