// Writes every file of the archive appended to ROBOTNIK.EXE into tools/re/work/res/.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { openArchive } from '../../src/archive.js';
const here = new URL('.', import.meta.url).pathname;
const exe = new Uint8Array(readFileSync(here + '../../ROBOTNIK.EXE'));
const archive = openArchive(exe);
mkdirSync(here + 'work/res', { recursive: true });
for (const f of archive.files.values()) {
  const data = archive.read(f.name);
  writeFileSync(here + 'work/res/' + f.name, data);
  console.log(f.name.padEnd(14), f.method, String(f.size).padStart(7), String(f.packedSize).padStart(7));
}
