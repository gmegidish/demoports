import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { demoFiles, demoAssets, readDemoFile } from './helpers.js';
import { decodePicture } from '../src/picture.js';
import { rowTimeline, rowAt } from '../src/xm.js';

function sha1(bytes) {
  return createHash('sha1').update(bytes).digest('hex');
}

test('the file table bound into BROTHER.EXE lists 31 files', () => {
  const files = demoFiles();
  assert.equal(files.size, 31);
  assert.equal(files.get('SHPITZ.3DS').length, 0x9793);
  assert.equal(files.get('TXT1.GIF').length, 0x2cfb);
});

test('the bound program is the DOS/4GW executable that prints the banner', () => {
  const program = demoFiles().get('TEST.EXE');
  assert.equal(String.fromCharCode(program[0], program[1]), 'MZ');
  assert.ok(Buffer.from(program).includes('Immortals Demo System V 1.08'));
});

test('files open by basename whatever the case and folder, as the int 21h hook matches them', () => {
  const assets = demoAssets();
  assert.equal(assets.read('textures\\sea.gif'), assets.read('SEA.GIF'));
  assert.throws(() => assets.read('flare.gif'), /Unable to load file/);
});

test('every GIF in the bundle decodes', () => {
  for (const [name, bytes] of demoFiles()) {
    if (name.endsWith('.GIF')) {
      const picture = decodePicture(bytes);
      assert.ok(picture.width === 256 || picture.width === 320, name);
    }
  }
});

test('the module plays 128-row patterns at 0.05 s per row, 4:35.2 in all', () => {
  const timeline = rowTimeline(readDemoFile('BICSTL.XM'));
  assert.equal(timeline.at(-1).time.toFixed(1), '275.2');
  assert.equal(rowAt(timeline, 64.02).position, 10);
  assert.equal(rowAt(timeline, 64.02).row, 0);
  assert.equal(rowAt(timeline, 6.42).row, 0);
  assert.equal(rowAt(timeline, 6.37).row, 127);
});

test('the bundle is read without copying: same bytes as the file at its offset', () => {
  const exe = readDemoFile('BROTHER.EXE');
  const logo = demoFiles().get('LOGO.GIF');
  assert.equal(sha1(logo), sha1(exe.subarray(0x958 + 0xe8260, 0x958 + 0xe8260 + 0x89e4)));
});
