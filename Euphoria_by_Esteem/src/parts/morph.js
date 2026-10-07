// 0a69:0620, 107.55 s: a sheet morphs into a lemon-shaped ball, which then tumbles. Every frame is
// blurred. Notes: docs/disassembly/P03_parts_0a69_4ebc.md "Part A".
import { f32, int16, roundHalfEven } from '../machine.js';
import { gradient, fillRect } from '../gfx.js';
import { blur } from '../effects.js';
import { PolyObject, Face, Pixel } from '../engine3d.js';
import { mark, elapsed, waitUntil, frame, fps, partInit } from './common.js';
import { sinR, cosR } from '../tables.js';

/** Measured in the capture (fps.txt, 111..121 s and 121..129 s). */
const MORPH_FRAME_SECONDS = fps(29);
const TUMBLE_FRAME_SECONDS = fps(40);
const MORPH_TICKS = 1000;
const TUMBLE_TICKS = 1100;
const PART_TICKS = 2200;

/** 0a69:0008 TBallSheet: a 21x15 flat grid, its rest copy, and the vector that bends it into the ball. */
function buildBallSheet(engine, spacing, amp, flags, minC, maxC) {
  const obj = new PolyObject(engine, flags, minC, maxC);
  const grid = [];
  const rest = [];
  for (let j = 0; j <= 14; j++) {
    for (let i = 0; i <= 20; i++) {
      const x = int16((i - 10) * spacing);
      const y = int16((j - 7) * spacing);
      grid[i] = grid[i] ?? [];
      rest[i] = rest[i] ?? [];
      grid[i][j] = new Pixel(x, y, 0, 0);
      rest[i][j] = new Pixel(x, y, 0, 0);
      obj.append(grid[i][j]);
    }
  }
  const lon = [];
  for (let i = 0; i <= 20; i++) {
    lon[i] = int16(roundHalfEven((i / 20) * 360) + 90);
  }
  const lat = [];
  for (let j = 0; j <= 14; j++) {
    lat[j] = int16(roundHalfEven(sinR(Math.trunc((j * 180) / 14)) * amp) + 1);
  }
  const seam = [];
  for (let j = 0; j <= 13; j++) {
    for (let i = 0; i <= 19; i++) {
      const f = new Face(engine, (flags + 0x40) & 0xff, minC, maxC, 0);
      f.setVertices(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
      obj.faces.push(f);
      if (i === 19) {
        seam[j] = f;
      }
    }
  }
  const morphVec = [];
  for (let j = 0; j <= 14; j++) {
    for (let i = 0; i <= 20; i++) {
      const c = cosR(lon[i]) * lat[j];
      const s = sinR(lon[i]) * lat[j];
      const P = grid[i][j];
      morphVec[i] = morphVec[i] ?? [];
      morphVec[i][j] = [f32(P.wx - c), 0, f32(-(P.wz - s))];
    }
  }
  return { obj, grid, rest, morphVec, seam };
}

/** 0a69:041c */
function morph(sheet, t) {
  for (let j = 0; j <= 14; j++) {
    for (let i = 0; i <= 20; i++) {
      const Q = sheet.rest[i][j];
      const V = sheet.morphVec[i][j];
      sheet.grid[i][j].setPos(f32(Q.wx - t * V[0]), f32(Q.wy - t * V[1]), f32(Q.wz - t * V[2]));
    }
  }
}

/** 0a69:050a: the last column of faces reuses column 0. */
function stitchSeam(sheet) {
  for (let k = 0; k <= 13; k++) {
    const f = sheet.seam[k];
    f.v[2] = sheet.grid[0][k];
    f.v[3] = sheet.grid[0][k + 1];
    f.items[1] = f.v[2];
    f.items[2] = f.v[3];
  }
}

export function* morphPart(m) {
  const e = m.engine;
  m.lockPalette();
  const partStart = partInit(m);
  fillRect(m, 0, 0, 320, 200, 0xfe);
  gradient(m, 0, 200, 0, 0, 0, 0, 50, 63);
  gradient(m, 200, 255, 0, 50, 63, 63, 63, 63);
  m.unlockPalette();
  fillRect(m, 0, 0, 320, 200, 0xff);
  e.freeLights();
  const sheet = buildBallSheet(e, 14, 60, 0x118, 4, 255);
  const { obj } = sheet;
  obj.setPhong(4, 0, 255, 1);
  m.setActivePage(1);
  let isFirstFrameDrawn = false;
  let angY = 0;
  let el;
  do {
    el = elapsed(m, partStart);
    let t = el / 1000;
    if (t > 1) {
      t = 1;
    }
    angY = f32(t * 250);
    m.fillActive(0);
    obj.draw();
    morph(sheet, t);
    obj.moveTo(0, 0, f32(t * -66));
    obj.rotateWork(0, angY, angY);
    blur(m);
    if (isFirstFrameDrawn) {
      m.present();
    }
    isFirstFrameDrawn = true;
    yield* frame(m, MORPH_FRAME_SECONDS);
  } while (el < MORPH_TICKS);

  const tumbleStart = mark(m);
  for (const f of obj.faces) {
    f.flags = 0x18;
  }
  stitchSeam(sheet);
  do {
    el = elapsed(m, tumbleStart);
    m.fillActive(0);
    obj.draw();
    blur(m);
    m.present();
    e.lightDir.update(f32(Math.sin(el / 100) * 40), 0, f32(Math.sin(el / 30) * 30));
    const a = int16(el * 3);
    obj.scale(cosR(a) * 0.2 + 1, sinR(a) * 0.2 + 1, 1);
    obj.moveTo(f32(el / 6 - sinR(int16(Math.trunc(el / 4))) * 160), 0, -66);
    obj.rotateWork(f32(el / 2), f32(el / 3 + angY), f32(el / 4 + angY));
    yield* frame(m, TUMBLE_FRAME_SECONDS);
  } while (el < TUMBLE_TICKS);

  m.freePage(1);
  m.getPage(0).fill(0, 0, 64000);
  yield* waitUntil(m, partStart, PART_TICKS);
}
