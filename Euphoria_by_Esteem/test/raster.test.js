import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Machine } from '../src/machine.js';
import { line } from '../src/gfx.js';
import { flatPoly, gouraudPoly, phongPoly, textureQuad, newTexture, solidSpan, gradientSpan, additiveSpan } from '../src/raster.js';

// The cases and the expected pages come from the demo's own machine code (graphics unit 186a) run in
// Unicorn: tools/re/emu.py and tools/re/gen_raster_cases.py.
const cases = JSON.parse(readFileSync(new URL('./fixtures/raster-cases.json', import.meta.url), 'utf8'));

const SEGMENT_BYTES = 0x10000;
const TRANSPARENT_BELOW = 40;
const TEXTURE_PAGE = 2;
const ACTIVE_PAGE = 1;
const SPANS = { solid: solidSpan, gradient: gradientSpan, additive: additiveSpan };

/** xorshift32: the generator the background, the texture and the lighting table were made with. */
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

const background = noise(3, SEGMENT_BYTES);
const texturePage = noise(1, SEGMENT_BYTES).map((texel) => (texel < TRANSPARENT_BELOW ? 0 : texel));
const lightingTable = noise(2, 91);

function sha1(bytes) {
  return createHash('sha1').update(bytes).digest('hex');
}

/** A machine as the harness sets it up: 320x200, the case's clip rectangle, a noisy active page. */
function machineFor(one) {
  const m = new Machine();
  m.setActivePage(ACTIVE_PAGE);
  m.active.set(background);
  m.pages.set(TEXTURE_PAGE, texturePage.slice());
  m.litTable.set(lightingTable);
  m.setClip(...one.clip);
  return m;
}

/** The 1-based vertex array of the original (DS:5ac2): always 4 records. */
function verticesOf(one) {
  return [null, ...one.v.map(([x, y, c]) => ({ x, y, c }))];
}

function drawFlat(m, one) {
  m.gradStep = one.gradStep;
  flatPoly(m, verticesOf(one), one.n, one.cyc[0], one.cyc[1], one.color, SPANS[one.span]);
}

function drawGouraud(m, one) {
  m.gouraudFraction = one.fraction;
  gouraudPoly(m, verticesOf(one), one.n, one.bias);
}

function drawPhong(m, one) {
  phongPoly(m, verticesOf(one), one.n);
}

function drawTexturedQuad(m, one) {
  const [u0, v0, w, h] = one.tex;
  textureQuad(m, verticesOf(one), newTexture(TEXTURE_PAGE, u0, v0, w, h), { isMirrored: one.mirrored, isLit: one.lit });
}

function drawLine(m, one) {
  line(m, ...one.p, one.color);
}

function casesOf(routine, filter = () => true) {
  return cases.map((one, index) => ({ ...one, index })).filter((one) => one.routine === routine && filter(one));
}

/** The indices of the cases whose page differs from the original's (at most a few, for the message). */
function differingCases(all, draw, check = () => true) {
  return all.filter((one) => {
    const m = machineFor(one);
    draw(m, one);
    return sha1(m.active) !== one.sha1 || !check(m, one);
  }).map((one) => one.index);
}

function assertAllMatch(all, draw, check) {
  assert.ok(all.length > 0);
  const differing = differingCases(all, draw, check);
  assert.deepEqual(differing.slice(0, 10), [], `${differing.length} of ${all.length} cases differ`);
}

for (const span of Object.keys(SPANS)) {
  test(`flat polygons with the ${span} span match the original machine code`, () => {
    assertAllMatch(casesOf('flat', (one) => one.span === span), drawFlat);
  });
}

test('gouraud polygons match the original, including the fraction left in the high word of EDI', () => {
  assertAllMatch(casesOf('gouraud'), drawGouraud, (m, one) => m.gouraudFraction === one.fractionAfter);
});

test('phong polygons match the original machine code', () => {
  assertAllMatch(casesOf('phong'), drawPhong);
});

for (const isLit of [false, true]) {
  for (const isMirrored of [false, true]) {
    const name = `${isLit ? 'lit ' : ''}textured quads${isMirrored ? ', mirrored,' : ''}`;
    test(`${name} match the original machine code`, () => {
      assertAllMatch(casesOf('texture', (one) => one.lit === isLit && one.mirrored === isMirrored), drawTexturedQuad);
    });
  }
}

test('clipped lines match the original machine code', () => {
  assertAllMatch(casesOf('line'), drawLine);
});
