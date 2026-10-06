// What every test of the engine needs: the demo's files, read from the folder the demo shipped in.
import { readFileSync, readdirSync } from 'node:fs';
import { createAssets } from '../src/engine/pictures.js';

const DEMO_FOLDER = new URL('../', import.meta.url);
const DATA_FOLDERS = ['SCENES', 'TEXTURES'];

export function demoAssets() {
  const files = {};
  for (const folder of DATA_FOLDERS) {
    for (const name of readdirSync(new URL(`${folder}/`, DEMO_FOLDER))) {
      files[`${folder}/${name}`] = new Uint8Array(readFileSync(new URL(`${folder}/${name}`, DEMO_FOLDER)));
    }
  }
  return createAssets(files);
}
