// Writes recording frames as PNG: node tools/re/capframe.mjs OUT_DIR FRAME...
import { mkdirSync } from 'node:fs';
import { writeFramePng } from '../png.mjs';
import { recordedFrames } from './recording.mjs';

const [outDir, ...frames] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
for (const { frame, width, height, rgb } of recordedFrames(frames.map(Number))) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba.set([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 255], i * 4);
  }
  writeFramePng(`${outDir}/rec-${frame}.png`, { width, height, rgba });
  console.log(`${outDir}/rec-${frame}.png`);
}
