// Renders moments of the demo to PNG, headless: node tools/shot.mjs OUT_DIR SECONDS...
// Each moment is run from the start of its part (parts are independent in the original too).
import { readFileSync, mkdirSync } from 'node:fs';
import { createDemo, partContaining } from '../src/demo.js';
import { renderFrame } from '../src/screen.js';
import { writeFramePng } from './png.mjs';

const [outDir, ...moments] = process.argv.slice(2);
const exe = new Uint8Array(readFileSync(new URL('../EUPHORIA.EXE', import.meta.url)));
const romFont = new Uint8Array(readFileSync(new URL('../assets/vga8x16.bin', import.meta.url)));
mkdirSync(outDir, { recursive: true });

for (const moment of moments.map(Number)) {
  const demo = createDemo(exe, { firstPart: partContaining(moment) });
  demo.machine.romFont = romFont;
  demo.runUntil(moment);
  const path = `${outDir}/port-${moment.toFixed(2)}.png`;
  writeFramePng(path, renderFrame(demo.machine));
  console.log(path);
}
