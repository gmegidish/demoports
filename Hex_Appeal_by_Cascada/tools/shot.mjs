// Renders moments of the demo to PNG, headless: node tools/shot.mjs OUT_DIR SECONDS...
// The demo is run once from the start (parts keep state from frame to frame); moments are soundtrack seconds.
import { readFileSync, mkdirSync } from 'node:fs';
import { createDemo } from '../src/demo.js';
import { renderFrame } from '../src/screen.js';
import { writeFramePng } from './png.mjs';

const [outDir, ...moments] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const demo = createDemo(new Uint8Array(readFileSync(new URL('../appeal.exe', import.meta.url))));
for (const moment of moments.map(Number).sort((a, b) => a - b)) {
  demo.runUntil(moment);
  const path = `${outDir}/port-${moment.toFixed(2)}.png`;
  writeFramePng(path, renderFrame(demo.state.vga));
  console.log(path);
}
