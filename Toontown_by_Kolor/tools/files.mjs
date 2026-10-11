// The demo's files, read from the repository for the headless tools and tests.
import { readFileSync } from 'node:fs';

const read = (name) => new Uint8Array(readFileSync(new URL(`../${name}`, import.meta.url)));

export function loadFiles() {
  return {
    exe: read('TOONTOWN.EXE'),
    dat: read('TOONTOWN.DAT'),
    xm: read('TOONTOWN.XM'),
    font: read('assets/vgafont.bin'),
  };
}
