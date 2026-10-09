import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { unpackGbu } from '../src/mylz.js';
import { openGbu } from '../src/gbu.js';
import { createSong } from '../src/song.js';
import { gbuExe } from './helpers.js';

/** The unpacked image up to the stack segment 13b9:0000, as the stub leaves it in memory (re/img.bin). */
const IMAGE_BYTES = 0x13b90;
const IMAGE_MD5 = '031bacde0494ea8c7300e3a63de154ed';
const MOD_FILE_OFFSET = 0x9c40;

test('the MyLZ (LZEXE 0.91) stub unpacks to the program, entry 0000:03b1', () => {
  const { image, relocations, entry, stack } = unpackGbu(gbuExe);
  assert.equal(image.length, IMAGE_BYTES);
  assert.equal(createHash('md5').update(image).digest('hex'), IMAGE_MD5);
  assert.equal(relocations.length, 452);
  assert.deepEqual(entry, { cs: 0, ip: 0x3b1 });
  assert.deepEqual(stack, { ss: 0x13b9, sp: 0x100 });
});

test('the 49 resources fill GBU.EXE up to its last byte', () => {
  const { resources } = openGbu(gbuExe);
  assert.equal(resources.size, 49);
  const ending = resources.get('ending');
  assert.equal(ending.byteOffset + ending.length, gbuExe.length);
  assert.equal(resources.get('plasma').length, 0xfa00);
});

test('the song fires its six 8xx syncs on the ticks the effects wait for', () => {
  const song = createSong(gbuExe.subarray(MOD_FILE_OFFSET));
  const syncTicks = [];
  for (let tick = 0; syncTicks.length < 6; tick++) {
    const before = song.syncCounter;
    song.tick();
    if (song.syncCounter !== before) {
      syncTicks.push(tick);
    }
  }
  assert.deepEqual(syncTicks, [1372, 2736, 4573, 5629, 8093, 11613]);
});
