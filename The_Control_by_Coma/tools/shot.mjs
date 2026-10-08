// Renders moments of the demo to PNG, headless: node tools/shot.mjs OUT_DIR SECONDS...
// Every moment is run from the start (effects keep state from frame to frame).
import { readFileSync, mkdirSync } from 'node:fs';
import { createDemo } from '../src/demo.js';
import { renderFrame } from '../src/screen.js';
import { writeFramePng } from './png.mjs';

const [outDir, ...moments] = process.argv.slice(2);
const read = (name) => new Uint8Array(readFileSync(new URL(`../${name}`, import.meta.url)));
const files = { exe: read('CONTROL.EXE'), avi: read('DEMO.AVI'), fli: read('DEMO.FLI') };
mkdirSync(outDir, { recursive: true });
const demo = createDemo(files);
demo.machine.romFont = read('assets/vga8x16.bin');
for (const moment of moments.map(Number).sort((a, b) => a - b)) {
  demo.runUntil(moment);
  const path = `${outDir}/port-${moment.toFixed(2)}.png`;
  writeFramePng(path, renderFrame(demo.machine));
  console.log(path);
}
