import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { decodePicture } from '../src/picture.js';

const TEXTURES = new URL('../TEXTURES/', import.meta.url);
const digests = JSON.parse(readFileSync(new URL('./fixtures/picture-digests.json', import.meta.url), 'utf8'));

function sha1(bytes) {
  return createHash('sha1').update(bytes).digest('hex');
}

function allGifNames() {
  return readdirSync(TEXTURES).filter((name) => /\.GI.$/.test(name)).sort();
}

function decodeTexture(name) {
  return decodePicture(new Uint8Array(readFileSync(new URL(name, TEXTURES))));
}

test('every texture of the demo is covered by the reference digests', () => {
  assert.deepEqual(allGifNames(), Object.keys(digests).sort());
});

for (const name of allGifNames()) {
  test(`${name} decodes to the same pixels and palette as the reference decoder`, () => {
    const picture = decodeTexture(name);
    const expected = digests[name];

    assert.equal(picture.width, expected.width);
    assert.equal(picture.height, expected.height);
    assert.equal(sha1(picture.pixels), expected.pixels);
    assert.equal(sha1(picture.palette), expected.palette);
  });
}
