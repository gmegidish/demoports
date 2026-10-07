// 0000:7d84, 554.60 s: a landscape grid from a blurred heightmap scrolling under a flying ship.
// Notes: docs/disassembly/P08_parts_7d84_0073.md.
import { f32, int16, roundHalfEven } from '../machine.js';
import { gradient, addPalette, timedFade, fillRect, getPixel, remapRange } from '../gfx.js';
import { blur } from '../effects.js';
import { loadPicture } from '../picture.js';
import { loadAsc } from '../asc.js';
import { PolyObject, Face, Pixel, Light } from '../engine3d.js';
import { partInit, mark, elapsed, frame, fps } from './common.js';

const FRAME_SECONDS = fps(28);
/** DS:255e is 100 with EMS: the scratch pages are 102 and 103. */
const HEIGHT_PAGE = 102;
const PICTURE_PAGE = 103;
const HEADING = -90;
const RISE_TICKS = 500;
const SINK_TICKS = 5400;
const LOOP_TICKS = 5800;
const FADE_IN_END = 300;
const FADE_OUT_END = 6400;

/** 0000:74c4: 31 x 17 vertices, 480 faces in column-major order, no sort, angle shading. */
function buildTerrain(engine) {
  const terrain = new PolyObject(engine, 0x358, 1, 255);
  terrain.setPhong(0, 0, 100, 1);
  const grid = [];
  for (let col = 0; col <= 16; col++) {
    for (let row = 0; row <= 30; row++) {
      const v = new Pixel(f32((row - 15) * 25), 0, f32((col - 8) * 25 - 100), 0xfa);
      grid[row] = grid[row] ?? [];
      grid[row][col] = v;
      terrain.append(v);
    }
  }
  for (let col = 0; col <= 15; col++) {
    for (let row = 0; row <= 29; row++) {
      const f = new Face(engine, 0x58, 1, 255, 0);
      f.setVertices(grid[row][col], grid[row + 1][col], grid[row + 1][col + 1], grid[row][col + 1]);
      terrain.faces.push(f);
    }
  }
  terrain.moveTo(0, 0, 30);
  return { terrain, grid };
}

function headingAngle() {
  return (HEADING / 180) * Math.PI;
}

/** 0000:772b */
function drawFrame(m, scene, posX, posY, lift) {
  const { terrain, grid, ship } = scene;
  m.setActivePage(HEIGHT_PAGE);
  const a = headingAngle();
  const cA = int16(roundHalfEven(Math.cos(a) * 256));
  const sA = int16(roundHalfEven(Math.sin(a) * 256));
  const sx = (i, j) => (posX + Math.trunc(int16(j * sA + i * cA) / 128)) % 320;
  const sy = (i, j) => (posY + Math.trunc(int16(j * cA - i * sA) / 128)) % 200;
  const height = (i, j) => getPixel(m, sx(i, j), sy(i, j)) * 2;
  let maxH = -Infinity;
  for (let j = 6; j <= 8; j++) {
    for (let i = -1; i <= 1; i++) {
      maxH = Math.max(maxH, height(i, j));
    }
  }
  for (let j = -8; j <= 8; j++) {
    for (let i = -15; i <= 15; i++) {
      const v = grid[i + 15][j + 8];
      const y = f32(int16(50 - height(i, j) + maxH) + lift);
      v.py = y;
      v.wy = y;
    }
  }
  m.copyPage(PICTURE_PAGE, 1);
  m.setActivePage(1);
  if (lift === 0) {
    fillRect(m, 0, 180, 320, 200, 50);
  }
  terrain.draw();
  scene.frame++;
  const sinOf = (k, amplitude) => Math.sin((scene.frame * k * Math.PI) / 180) * amplitude;
  const x = sinOf(8, 40);
  const y = sinOf(5, 30);
  const z = sinOf(2, 70);
  ship.moveTo(f32(x), f32(y + lift), f32(z));
  const [px, py, pz] = scene.previous;
  ship.rotateWork(f32(-(y - py) * 5 + 10), f32(-(z - pz) * 5 + 10), f32(-(x - px) * 5));
  if (px !== 0 || py !== 0 || pz !== 0) {
    ship.draw();
  }
  scene.previous = [x, y, z];
  m.engine.lights[1].setPos(f32(x), f32(y), f32(z));
  fillRect(m, 319, 0, 319, 200, 0);
}

export function* terrainPart(m) {
  const e = m.engine;
  const partStart = partInit(m);
  loadPicture(m, HEIGHT_PAGE, 0x22);
  for (let k = 0; k < 5; k++) {
    blur(m);
  }
  loadPicture(m, PICTURE_PAGE, 0x24);
  remapRange(m, PICTURE_PAGE, 1, 104, 100);
  gradient(m, 1, 50, 0, 0, 0, 40, 20, 0);
  gradient(m, 50, 100, 40, 20, 0, 63, 63, 0);
  gradient(m, 205, 245, 0, 20, 30, 0, 50, 63);
  gradient(m, 245, 255, 0, 50, 63, 63, 63, 63);
  e.freeLights();
  e.addLight(new Light(e, 0, 0, 0, 600, 255));
  const scene = buildTerrain(e);
  scene.ship = new PolyObject(e, 0x118, 1, 255);
  loadAsc(m, 0x12, scene.ship);
  scene.ship.scaleUniform(f32(0.2));
  scene.ship.rotate(0, 0, 180);
  scene.ship.rotate(-90, 0, 0);
  scene.ship.setPhong(205, 0, 50, 1);
  scene.frame = 0;
  scene.previous = [0, 0, 0];
  let posX = 10;
  const posY = 96;

  m.setActivePage(1);
  addPalette(m, 0, 255, -64, -64, -64);
  m.copyPage(PICTURE_PAGE, 1);
  m.present();
  yield* timedFade(m, 0, 255, 1, 1, 1, 64, FADE_IN_END - elapsed(m, partStart));
  const loopStart = mark(m);
  for (;;) {
    const t = elapsed(m, loopStart);
    let lift = 0;
    if (t < RISE_TICKS) {
      lift = 300 - (t * 300) / 500;
    } else if (t >= SINK_TICKS) {
      lift = ((t - SINK_TICKS) * 400) / 400;
    }
    drawFrame(m, scene, posX, posY, lift);
    m.present();
    posX = int16(posX - roundHalfEven(Math.sin(headingAngle())));
    if (posX > 319) {
      posX = 0;
    }
    yield* frame(m, FRAME_SECONDS);
    if (t > LOOP_TICKS) {
      break;
    }
  }
  m.freePage(HEIGHT_PAGE);
  m.freePage(PICTURE_PAGE);
  m.freePage(1);
  yield* timedFade(m, 0, 255, -1, -1, -1, 64, FADE_OUT_END - elapsed(m, partStart));
  m.getPage(0).fill(0, 0, 64000);
}
