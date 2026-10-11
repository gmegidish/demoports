// Renders frames of the port by recording frame index, headless:
//   node tools/frames.mjs OUT_DIR [--rate R] [--part NAME] FRAME...
// Frame g is what the port shows after g + 1 retraces from the switch to mode 13h: the same index as the
// reference recording's frames (tools/re/capframe.mjs). --rate plays the music at the recording's speed (DOSBox
// played it about 0.9 % fast); --part starts at a part (frames then count from that part's mode 13h too).
import { mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createDemo } from '../src/demo.js';
import { renderFrame } from '../src/screen.js';
import { writeFramePng } from './png.mjs';
import { loadFiles } from './files.mjs';
import { runToRecordingFrame } from './run.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { rate: { type: 'string' }, part: { type: 'string' } } });
const [outDir, ...frames] = positionals;
mkdirSync(outDir, { recursive: true });
const demo = createDemo(loadFiles(), { musicRate: Number(values.rate ?? 1), firstPart: values.part });
for (const frame of frames.map(Number).sort((a, b) => a - b)) {
  runToRecordingFrame(demo, frame);
  const path = `${outDir}/port-${frame}.png`;
  writeFramePng(path, renderFrame(demo.state.vga));
  console.log(path);
}
