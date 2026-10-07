// 0000:9778, 618.65 s: the credits in fire, with two tumbling pentagram stars.
// Notes: docs/disassembly/P09_part_9778.md.
import { f32, roundHalfEven } from '../machine.js';
import { remapRange, setPaletteOffset, putPixel } from '../gfx.js';
import { fire, fire2, fireRamp } from '../effects.js';
import { Font } from '../font.js';
import { PolyObject } from '../engine3d.js';
import { partInit, mark, elapsed, waitUntil, frame, fps } from './common.js';

/** Measured in the reference capture. */
const FRAME_SECONDS = fps(63);
const CREDITS = ['CREDITS', 'CODER: ADEPT', 'CODER: SKYER', 'MUSIC: BAHC', 'MUSIC: PASO', 'GFX: Mr.ED', 'GFX: Insane Tilt', ''];
const FADE_TICKS = 200;
const MAIN_TICKS = 8000;
const OUTRO_TICKS = 800;

/** 0e5a:13e4 / 1433 */
function sinDeg(x) {
  return Math.sin((x * Math.PI) / 180);
}

function cosDeg(x) {
  return Math.cos((x * Math.PI) / 180);
}

/** 0e5a:1b9f: a triangle with new vertices; the colour counter wraps to minColor after 10 faces. */
function addTriangle(mesh, a, b, c) {
  mesh.setColorStep(5);
  mesh.nextColor = (mesh.nextColor + mesh.colorStep) & 0xff;
  if (mesh.faces.length > 10) {
    mesh.nextColor = mesh.minColor;
  }
  mesh.addTri(a, b, c);
}

/** 0e5a:1478: a pentagram bipyramid, outer radius 50, inner 19.098, apexes at z = +-10. */
export function buildStar(engine, flags, minColor, maxColor) {
  const star = new PolyObject(engine, flags, minColor, maxColor);
  const r = 50;
  const A = (r * (1 - cosDeg(72)) * cosDeg(54)) / (sinDeg(54) + 1);
  const B = -r * cosDeg(72);
  const C = Math.sqrt(A * A + B * B);
  const v = [
    [0, -r],
    [-A, B],
    [-r * sinDeg(72), -r * cosDeg(72)],
    [C * cosDeg(198), -C * sinDeg(198)],
    [-r * cosDeg(54), r * sinDeg(54)],
    [0, C],
    [r * cosDeg(54), r * sinDeg(54)],
    [C * cosDeg(-18), -C * sinDeg(-18)],
    [r * sinDeg(72), -r * cosDeg(72)],
    [A, B],
  ].map(([x, y]) => [f32(x), f32(y), 0]);
  const top = [0, 0, 10];
  const bottom = [0, 0, -10];
  for (let i = 0; i < 10; i++) {
    const [p, q] = i === 0 ? [1, 0] : i === 1 ? [0, 9] : [i, i - 1];
    addTriangle(star, v[p], v[q], top);
  }
  for (let i = 0; i < 10; i++) {
    const [p, q] = i === 0 ? [0, 1] : i === 1 ? [9, 0] : [i - 1, i];
    addTriangle(star, v[p], v[q], bottom);
  }
  return star;
}

function seedRow(m, r1, r2, base) {
  for (let x = 0; x <= 319; x++) {
    putPixel(m, x, 199, m.random(r1) & 0xff);
  }
  for (let x = 0; x <= 319; x++) {
    if (m.random(2) === 1) {
      putPixel(m, x, 199, 0);
    } else {
      const y = 199 - m.random(10);
      putPixel(m, x, y, (m.random(r2) + base) & 0xff);
    }
  }
}

function drawStars(star, t, yoff) {
  const th = (t * 2 * Math.PI) / 1000;
  const ax = f32((t * 360) / 700);
  const ay = f32((t * 360) / 800);
  const az = f32((t * 360) / 1000);
  for (const side of [1, -1]) {
    star.moveTo(f32(side * Math.sin(th) * 130), f32(Math.cos(th) * 70 + yoff), 0);
    star.rotateWork(ax, ay, az);
    star.draw();
  }
}

export function* creditsPart(m) {
  const partStart = partInit(m);
  const font = new Font(m);
  font.load(0x14, 0x15);
  remapRange(m, font.page, 1, 1, 70);
  remapRange(m, font.page, 2, 2, 40);
  remapRange(m, font.page, 3, 3, 20);
  const star = buildStar(m.engine, 9, 20, 80);
  star.scaleUniform(0.5);
  fireRamp(m, 80);
  m.setActivePage(1);
  const palette = m.palette.slice();
  yield* waitUntil(m, partStart, 50);

  let phase = mark(m);
  let t = 0;
  do {
    t = elapsed(m, phase);
    const d = roundHalfEven((t * 60) / 200 - 60);
    setPaletteOffset(m, palette, 0, 80, d, d, d);
    m.setActivePage(1);
    seedRow(m, 255, 200, 55);
    fire(m.getPage(1), m.getPage(0), 80);
    yield* frame(m, FRAME_SECONDS);
  } while (t < FADE_TICKS);

  let lineStart = 0;
  let age = -1;
  let line = 0;
  let yoff = 20;
  let wave = { a: 1, ang: 0, amp: 0 };
  phase = mark(m);
  do {
    t = elapsed(m, phase);
    m.setActivePage(1);
    seedRow(m, 255, 200, 55);
    drawStars(star, t, yoff);
    yoff = f32(20 - (t * 20) / 200);
    if (yoff < 0) {
      yoff = 0;
    }
    if (t > 500) {
      if (age < 0 || age >= 1000) {
        lineStart = mark(m);
        line = (line + 1) & 0xff;
        font.setWave(160, 95, CREDITS[line - 1] ?? '');
        wave = { a: (m.random(10) + 10) / 10, ang: 0, amp: 0 };
      }
      age = elapsed(m, lineStart);
      let scale = roundHalfEven((age * 1000) / 100);
      if (scale > 1000) {
        scale = 1000;
      }
      wave.ang += 20;
      wave.amp = age <= 500 ? (age * 10) / 500 : 10 - ((age - 500) * 10) / 500;
      if (age < 900 && line <= 7 && font.text.length > 0) {
        font.drawWave(wave.a, wave.ang, wave.amp, scale);
      }
    }
    fire(m.getPage(1), m.getPage(0), 80);
    yield* frame(m, FRAME_SECONDS);
  } while (t < MAIN_TICKS);

  let cap = 100;
  let r1 = 254;
  let r2 = 200;
  let base = 54;
  do {
    t = elapsed(m, phase);
    m.setActivePage(1);
    seedRow(m, r1, r2, base);
    fire2(m.getPage(1), m.getPage(0), 80, cap);
    cap = 100 - roundHalfEven(Math.sin(t / 200) * 8);
    r1 = Math.max(r1 - 1, 0);
    r2 = Math.max(r2 - 1, 0);
    base = Math.max(base - 1, 0);
    m.setActivePage(0);
    yield* frame(m, FRAME_SECONDS);
  } while (t <= MAIN_TICKS + OUTRO_TICKS);

  m.getPage(0).fill(0, 0, 64000);
  m.freePage(1);
  m.freePage(font.page);
}
