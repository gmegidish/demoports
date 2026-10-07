// 0000:0697 (preload) and 0000:0cd6 (the intro, 0 to 46.15 s): the greeting scroller over a picture,
// then a waving, lit, textured flag. Notes: docs/disassembly/P01_intro.md.
import { f32, int16, roundHalfEven } from '../machine.js';
import { gradient, addPalette, timedFade, repackPage } from '../gfx.js';
import { presetGradient } from '../effects.js';
import { loadPicture } from '../picture.js';
import { Font } from '../font.js';
import { newTexture } from '../raster.js';
import { PolyObject, Face, Pixel } from '../engine3d.js';
import { partInit, mark, elapsed, waitUntil, frame, fps } from './common.js';

const BACKGROUND_PAGE = 102;
const TEXTURE_PAGE = 103;
const FRAME_SECONDS = fps(70);
const TEXT = [
  ['We are very', 0],
  ['glad to', 35],
  ['present our', 70],
  ['first demo', 105],
  ['for the', 140],
  ['first', 175],
  ['israeli', 210],
  ['demo compo.', 245],
  ["MOVEMENT'95", 360],
];
const LOWEST_TEXT_Y = -276;

/**
 * 0000:0697, before the music: 25.pcx into the hidden second page of VESA 640x480 (scanline 512),
 * and its palette saved (DS:2688) for part 143e.
 */
export function preload(m) {
  m.setMode(2);
  m.vesaResetFlip();
  m.vesaFlip();
  loadPicture(m, 512, 0x1a);
  m.savedFlagPalette = m.palette.slice();
  m.setMode(0);
}

/** 0000:094b: 11 x 7 vertices, 10 x 6 lit textured faces, each a 26x33 window of the flag picture. */
function buildFlag(engine) {
  const mesh = new PolyObject(engine, 0x5b, 200, 255);
  mesh.setPhong(0, 0, 63, 1);
  const grid = [];
  for (let i = 0; i <= 6; i++) {
    for (let j = 0; j <= 10; j++) {
      grid[j] = grid[j] ?? [];
      grid[j][i] = new Pixel((j - 5) * 15, (i - 3) * 15, 0, 0);
    }
  }
  for (let i = 0; i <= 5; i++) {
    for (let j = 0; j <= 9; j++) {
      const face = new Face(engine, 0x5b, 0, 0, 0);
      face.setVertices(grid[j][i], grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1]);
      const tex = newTexture(TEXTURE_PAGE, roundHalfEven((j * 256) / 10), roundHalfEven((i * 200) / 6), 26, 33);
      face.setExtra(tex, tex);
      mesh.addFace(face);
    }
  }
  return { mesh, grid };
}

/** 0000:0bcc: z = originZ + round(15 sin(phase + 25i + 55j)), whole units. */
function waveFlag(flag, phase) {
  const { mesh, grid } = flag;
  mesh.rotateWork(0, 0, 0);
  for (let i = 0; i <= 6; i++) {
    for (let j = 0; j <= 10; j++) {
      const p = grid[j][i];
      const a = int16(phase + i * 25 + j * 55);
      const w = roundHalfEven(Math.sin((a * Math.PI) / 180) * 15);
      p.setPos(p.wx, p.wy, f32(w + mesh.origin.wz));
    }
  }
}

/** 0000:07a3 */
function drawText(m, font, y) {
  m.setClip(0, 0, 320, 200);
  for (const [text, dy] of TEXT) {
    font.drawCentered(160, int16(y + dy), text.toUpperCase());
  }
  m.setClip(-1, 0, 320, 200);
}

function* flagFrame(m, flag, phase, rotation) {
  m.copyPage(BACKGROUND_PAGE, 1);
  waveFlag(flag, phase);
  if (rotation !== null) {
    flag.mesh.rotateWork(0, rotation, 0);
  }
  flag.mesh.draw();
  m.present();
  yield* frame(m, FRAME_SECONDS);
}

export function* introPart(m) {
  const partStart = partInit(m);
  const font = new Font(m);
  loadPicture(m, TEXTURE_PAGE, 0x19);
  repackPage(m, TEXTURE_PAGE, 256, 200);
  const flag = buildFlag(m.engine);
  loadPicture(m, BACKGROUND_PAGE, 0x18);
  font.load(0x16, 0x17);
  presetGradient(m);
  gradient(m, 0x80, 0xc0, 0, 0, 0, 63, 63, 63);
  gradient(m, 0xc0, 0xff, 0, 0, 0, 0, 0, 63);
  m.setActivePage(1);
  m.setActivePage(BACKGROUND_PAGE);
  addPalette(m, 0x21, 0x7f, -60, -60, -60);
  m.present();
  yield* timedFade(m, 0x21, 0x7f, 1, 1, 1, 40, 100 - elapsed(m, partStart));

  m.setActivePage(1);
  yield* waitUntil(m, partStart, 300);
  let line = 200;
  let el;
  do {
    el = elapsed(m, partStart);
    let y = int16(200 - roundHalfEven((el - 300) / 5.04));
    if (line < y) {
      y = line;
    }
    m.copyPage(BACKGROUND_PAGE, 1);
    drawText(m, font, y > LOWEST_TEXT_Y ? y : LOWEST_TEXT_Y);
    m.present();
    line--;
    yield* waitUntil(m, partStart, (201 - line) * 3.3 + 300 - 1e-9);
  } while (el <= 2700);
  yield* waitUntil(m, partStart, 2700);
  m.copyPage(1, BACKGROUND_PAGE);

  const flagStart = mark(m);
  let el2 = elapsed(m, flagStart);
  let phase = 0;
  do {
    flag.mesh.moveTo(f32((el2 * 220) / 600 - 380), -100, -100);
    yield* flagFrame(m, flag, phase, null);
    el2 = elapsed(m, flagStart);
    phase = (el2 * 3) % 360;
  } while (el2 < 600);

  let ay = 0;
  let flagX = 0;
  let flagZ = 0;
  do {
    ay = f32(((el2 - 600) * 90) / 600);
    yield* flagFrame(m, flag, phase, ay);
    el2 = elapsed(m, flagStart);
    phase = (el2 * 3) % 360;
    flagX = f32(((el2 - 600) * 160) / 600 - 160);
    const flagY = f32(((el2 - 600) * 100) / 600 - 100);
    flagZ = f32(((el2 - 600) * 50) / 600 - 100);
    flag.mesh.moveTo(flagX, flagY, flagZ);
  } while (el2 <= 1200);

  el2 = elapsed(m, flagStart);
  do {
    ay = f32(((el2 - 600) * 90) / 600);
    yield* flagFrame(m, flag, phase, ay);
    el2 = elapsed(m, flagStart);
    phase = (el2 * 3) % 360;
  } while (el2 <= 1800);

  do {
    yield* flagFrame(m, flag, phase, ay);
    phase = (el2 * 3) % 360;
    const d = el2 - 1800;
    const zz = f32((d * 2 * d) / 100 + flagZ);
    flag.mesh.moveTo(flagX, 0, zz);
    if (zz > 150) {
      m.getPage(BACKGROUND_PAGE).fill(1, 0, 64000);
    }
    el2 = elapsed(m, flagStart);
  } while (el2 <= 1900);

  addPalette(m, 0, 255, 64, 64, 64);
  m.freePage(font.page);
  m.freePage(BACKGROUND_PAGE);
  m.freePage(TEXTURE_PAGE);
  m.freePage(1);
}
