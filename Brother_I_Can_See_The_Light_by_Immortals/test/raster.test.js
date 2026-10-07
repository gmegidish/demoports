import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  fillTrapezoids, createTrapezoids, fillAffineTriangle, drawScaledSprite, AFFINE_OPAQUE, AFFINE_KEYED, AFFINE_SHADE,
} from '../src/engine/raster.js';

// Cases and expected screens come from Python models that were matched byte for byte against
// the demo's own machine code running in an emulator.
const cases = JSON.parse(readFileSync(new URL('./fixtures/raster-cases.json', import.meta.url), 'utf8'));

const SCREEN_BYTES = 64000;
const TEXTURE_BYTES = 65536;
const TRANSPARENT_BELOW = 50;

/** xorshift32: the generator the fixture's textures, table and background were made with. */
function noise(seed, count) {
  const bytes = new Uint8Array(count);
  let state = seed;
  for (let i = 0; i < count; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[i] = state & 0xff;
  }
  return bytes;
}

const texture = noise(1, TEXTURE_BYTES);
const table = noise(2, TEXTURE_BYTES);
const background = noise(3, SCREEN_BYTES);
const keyedTexture = texture.map((texel) => (texel < TRANSPARENT_BELOW ? 0 : texel));

function sha1(bytes) {
  return createHash('sha1').update(bytes).digest('hex');
}

function freshScreen() {
  return background.slice();
}

function trapezoidsFrom(block, rows1, rows2) {
  return Object.assign(createTrapezoids(), {
    left: block.i04, right: block.i08,
    leftStep1: block.i0c, leftStep2: block.i10, rightStep1: block.i14, rightStep2: block.i18,
    zPerSpan: block.f1c, uPerSpan: block.f20, vPerSpan: block.f24,
    zPerRow1: block.f28, zPerRow2: block.f2c, uPerRow1: block.f30, uPerRow2: block.f34, vPerRow1: block.f38, vPerRow2: block.f3c,
    z: block.f40, u: block.f44, v: block.f48, rows1, rows2,
  });
}

function vertexFrom([x, y, u, v]) {
  return { x, y, u, v };
}

function countMismatches(all, drawOne) {
  return all.filter((one) => {
    const screen = freshScreen();
    drawOne(screen, one);
    return sha1(screen) !== one.sha1;
  }).length;
}

test('perspective spans match the original machine code on 300 random trapezoids', () => {
  const mismatches = countMismatches(cases.spans, (screen, one) => {
    fillTrapezoids(screen, texture, one.variant === 'blend' ? table : null, trapezoidsFrom(one.s, one.rows1, one.rows2));
  });

  assert.equal(mismatches, 0);
});

test('affine triangles match the original machine code on 600 random triangles', () => {
  const variants = { opaque: [texture, AFFINE_OPAQUE], key: [keyedTexture, AFFINE_KEYED], blend: [table, AFFINE_SHADE] };

  const mismatches = countMismatches(cases.triangles, (screen, one) => {
    const [source, variant] = variants[one.variant];
    const [a, b, c] = one.v.map(vertexFrom);
    fillAffineTriangle(screen, source, a, b, c, variant);
  });

  assert.equal(mismatches, 0);
});

test('scaled sprites match the original machine code on 300 random rectangles', () => {
  const mismatches = countMismatches(cases.sprites, (screen, one) => {
    drawScaledSprite(screen, texture, table, one.p0, one.p1);
  });

  assert.equal(mismatches, 0);
});
