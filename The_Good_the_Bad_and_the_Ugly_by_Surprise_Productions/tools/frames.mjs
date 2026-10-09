// Renders frames of the port by recording frame index, headless: node tools/frames.mjs OUT_DIR FRAME...
// Frame g is what the port shows after g + 1 retraces (the retrace that starts frame g and the code after it):
// the same index as the reference recording's frames (70.086 Hz from the switch to 640x400 graphics).
import { readFileSync, mkdirSync } from 'node:fs';
import { createDemo } from '../src/demo.js';
import { renderFrame } from '../src/screen.js';
import { writeFramePng } from './png.mjs';

const [outDir, ...frames] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const exe = new Uint8Array(readFileSync(new URL('../GBU.EXE', import.meta.url)));
const font = new Uint8Array(readFileSync(new URL('../assets/vgafont.bin', import.meta.url)));
const demo = createDemo(exe, font);
let retraces = 0;
for (const frame of frames.map(Number).sort((a, b) => a - b)) {
  while (retraces < frame + 1 && !demo.state.isOver) {
    demo.step();
    retraces++;
  }
  const path = `${outDir}/port-${frame}.png`;
  writeFramePng(path, renderFrame(demo.state.vga));
  console.log(path);
}
