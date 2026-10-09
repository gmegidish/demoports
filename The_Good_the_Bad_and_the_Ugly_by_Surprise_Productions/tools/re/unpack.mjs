// node tools/re/unpack.mjs: unpacks GBU.EXE (src/mylz.js) into tools/re/work/: img.bin (the program at segment 0,
// up to the stack segment 13b9:0000), relocs.txt ("linear_offset value" per relocated word) and res/NN_name (the 49
// resources appended to the EXE, src/gbu.js), plus mod.bin (the MOD at file offset 0x9c40).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { unpackGbu } from '../../src/mylz.js';
import { openGbu } from '../../src/gbu.js';

const MOD_FILE_OFFSET = 0x9c40;
const work = new URL('./work/', import.meta.url);
mkdirSync(new URL('./res/', work), { recursive: true });
const exe = new Uint8Array(readFileSync(new URL('../../GBU.EXE', import.meta.url)));
const { image, relocations } = unpackGbu(exe);
writeFileSync(new URL('./img.bin', work), image);
const word = (at) => image[at] | (image[at + 1] << 8);
writeFileSync(new URL('./relocs.txt', work), relocations.map((at) => `${at.toString(16)} ${word(at).toString(16).padStart(4, '0')}`).join('\n'));
const { resources } = openGbu(exe);
[...resources].forEach(([name, data], i) => {
  writeFileSync(new URL(`./res/${String(i).padStart(2, '0')}_${name}`, work), data);
});
const firstResource = resources.values().next().value.byteOffset;
writeFileSync(new URL('./mod.bin', work), exe.subarray(MOD_FILE_OFFSET, firstResource));
console.log(`img.bin ${image.length} bytes, ${relocations.length} relocations, ${resources.size} resources`);
