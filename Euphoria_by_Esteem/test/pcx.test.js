import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readResources } from '../src/resources.js';
import { decodePcx } from '../src/pcx.js';

const resources = readResources(new Uint8Array(readFileSync(new URL('../EUPHORIA.EXE', import.meta.url))));
const digests = JSON.parse(readFileSync(new URL('./fixtures/pcx-digests.json', import.meta.url), 'utf8'));

function sha1(bytes) {
  return createHash('sha1').update(bytes).digest('hex');
}

function pictureIndexOf(fileName) {
  return Number(fileName.split('.')[0]);
}

for (const [fileName, expected] of Object.entries(digests)) {
  test(`picture ${fileName} decodes to the same pixels and palette as Pillow`, () => {
    const picture = decodePcx(resources[pictureIndexOf(fileName)]);
    assert.equal(picture.width, expected.w);
    assert.equal(picture.height, expected.h);
    assert.equal(sha1(picture.pixels), expected.pix);
    assert.equal(sha1(picture.palette), expected.pal);
  });
}

test('the resource table accounts for the whole executable', () => {
  assert.equal(resources.length, 50);
  assert.equal(new TextDecoder().decode(resources[9].subarray(0, 3)), 'GDM');
});
