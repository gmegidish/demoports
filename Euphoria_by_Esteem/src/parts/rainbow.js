// 0000:8768, 497.40 s: a flat-shaded torus over res/41.pcx in VESA 640x480, the picture's colours
// cycling through a rainbow. Double-buffered with the VESA display start. Notes:
// docs/disassembly/P07_parts_8768_9178.md "Part 0000:8768".
import { f32, int16, roundHalfEven } from '../machine.js';
import { gradient, addPalette, rotatePalette, setPaletteOffset } from '../gfx.js';
import { flatPoly } from '../raster.js';
import { PolyObject, Face } from '../engine3d.js';
import { loadPicture } from '../picture.js';
import { vesaSpan } from '../vesa.js';
import { partInit, mark, elapsed, waitUntil, frame, fps } from './common.js';

// Frame pacing, measured by fitting the palette rotation (3 entries per pass) of captured frames
// against res/41.pcx every 0.1-0.2 s: 150 passes/s while the torus is off screen (502, 524-525.4),
// 127 passes/s during the 64-pass fade-in (it sends 256 DAC entries more), and 70-75 passes/s while
// the torus is fully on screen (~96 faces filled), with a smooth slowdown as it enters (503.0-503.8).
// So a pass costs a base time, plus the fade-in, plus a cost per filled face.
const EMPTY_PASS_SECONDS = fps(150);
const FADE_IN_PASS_SECONDS = fps(127) - fps(150);
const FILLED_FACE_SECONDS = (fps(70) - fps(150)) / 96;
/** The fade-out loop only does palette work. */
const FADE_OUT_PASS_SECONDS = fps(127);
const VESA_640X480 = 2;
const MODE_13H = 0;
const PICTURE = 0x2a;
/** VESA page 1 starts at scanline 512 (bank 5). */
const PAGE1_ROW = 512;
const BANK_SIZE = 0x10000;
/** 0000:819c copies 0x3fff dwords and a word: the last 2 bytes of a bank are never copied. */
const COPY_BANK_BYTES = 65534;
const SAVED_BANKS = 2;
const VRAM_BANKS = 16;
const START_TICKS = 320;
const FADE_IN_FRAMES = 64;
const LAST_TICK = 2500;
const PART_TICKS = 3000;
const TORUS_FLAGS = 9;
const TORUS_MIN_COLOR = 201;
const TORUS_MAX_COLOR = 255;
/** cs:2109 float80 PI, cs:2113 180.0 */
const DEGREES = Math.PI / 180;

/** A face whose spans go through the span hook DS:911a, set to the VESA span 186a:1c8f. It counts its fills (pacing). */
class VesaFace extends Face {
  fill() {
    const e = this.engine;
    const P = e.pts;
    e.faceColor = this.color & 0xff;
    if (this.count === 3) {
      P[4].x = P[3].x;
      P[4].y = P[3].y;
      P[4].c = P[3].c;
    }
    // flags 9: shading mode 8 (flat Lambert), fill type 1 (colour range)
    this.shadeFlat();
    this.owner.filledFaces++;
    flatPoly(e.m, P, this.count, this.minColor, this.maxColor, this.color & 0xff, vesaSpan);
  }
}

class VesaPolyObject extends PolyObject {
  newFace() {
    const face = new VesaFace(this.engine, this.flags & 0xff, this.minColor, this.maxColor, 0);
    face.owner = this;
    return face;
  }

  draw() {
    this.filledFaces = 0;
    super.draw();
  }
}

/** 0e5a:2117 Torus.Init(R, r, nU, nV, flags, minColor, maxColor): nU rings of nV quads. */
function buildTorus(engine, R, r, nU, nV, flags, minColor, maxColor) {
  const torus = new VesaPolyObject(engine, flags, minColor, maxColor);
  let first = [];
  let prev = [];
  let hasPrev = false;
  let cur = [];
  for (let i = 1; i <= nU; i++) {
    const a = int16(i * 360) / nU;
    cur = [];
    for (let j = 1; j <= nV; j++) {
      const b = int16(j * 360) / nV;
      const rr = Math.sin(b * DEGREES) * r + R;
      const x = Math.sin(a * DEGREES) * rr;
      const y = Math.cos(a * DEGREES) * rr;
      const z = Math.cos(b * DEGREES) * r;
      cur[j] = [f32(x), f32(y), f32(z)];
    }
    if (hasPrev) {
      for (let j = 1; j <= nV - 1; j++) {
        torus.addQuad(prev[j], cur[j], cur[j + 1], prev[j + 1]);
      }
      torus.addQuad(prev[nV], cur[nV], cur[1], prev[1]);
    } else {
      first = cur;
    }
    hasPrev = true;
    prev = cur;
  }
  for (let j = 1; j <= nV - 1; j++) {
    torus.addQuad(first[j + 1], cur[j + 1], cur[j], first[j]);
  }
  torus.addQuad(cur[nV], first[nV], first[1], cur[1]);
  return torus;
}

/** 186a:1c3b: zero every bank (65534 bytes of each). */
function vesaClearAll(m) {
  for (let bank = 0; bank < VRAM_BANKS; bank++) {
    m.vram.fill(0, bank * BANK_SIZE, bank * BANK_SIZE + COPY_BANK_BYTES);
  }
}

/** The 64 KB window A000 at the current bank. */
function bankWindow(m) {
  return m.vram.subarray(m.bank * BANK_SIZE, m.bank * BANK_SIZE + BANK_SIZE);
}

/** 0000:819c */
function copyBank(src, dst) {
  dst.set(src.subarray(0, COPY_BANK_BYTES));
}

/** 0000:81b5: the picture into both VESA pages, the rainbow over colours 1..200. */
function setup(m) {
  gradient(m, 0, 255, 0, 0, 0, 0, 0, 0);
  m.lockPalette();
  m.vesaResetFlip();
  vesaClearAll(m);
  m.vesaFlip();
  // loadPCX(0, ..) writes from row 0 of the draw page, which is page 1 now
  loadPicture(m, PAGE1_ROW, PICTURE);
  m.vesaFlip();
  loadPicture(m, 0, PICTURE);
  gradient(m, 1, 40, 63, 0, 0, 0, 0, 63);
  gradient(m, 40, 80, 0, 0, 63, 63, 63, 0);
  gradient(m, 80, 120, 63, 63, 0, 63, 0, 63);
  gradient(m, 120, 160, 63, 0, 63, 0, 63, 63);
  gradient(m, 160, 200, 0, 63, 63, 63, 0, 0);
}

/** The torus path: x offset (zR) by phase, then the circle. */
function placeTorus(torus, t, state) {
  if (t < 1000) {
    state.zR = 400 - t / 2;
  }
  if (t > 1900) {
    state.zR = -100 - Math.imul(t - 1900, t - 1900) / 300;
  }
  const x = Math.cos(t / 250) * 200 + state.zR;
  const y = Math.sin(t / 250) * 40 - 35;
  torus.moveTo(f32(x), f32(y), 0);
  torus.rotateWork(f32(t / 4), f32(t / 3), f32(t / 2));
}

function passSeconds(isFadingIn, filledFaces) {
  return EMPTY_PASS_SECONDS + (isFadingIn ? FADE_IN_PASS_SECONDS : 0) + filledFaces * FILLED_FACE_SECONDS;
}

/** 0000:8292 */
function* run(m, partStart) {
  m.engine.perspective = 500;
  gradient(m, 201, 240, 0, 20, 30, 0, 40, 63);
  gradient(m, 240, 255, 0, 40, 63, 63, 63, 63);
  const torus = buildTorus(m.engine, 40, 20, 20, 10, TORUS_FLAGS, TORUS_MIN_COLOR, TORUS_MAX_COLOR);
  m.setActivePage(0);
  m.vesaFlip();
  // pages 101, 102 (EMS): the background of banks 1 and 2 of the draw page
  const saved = [null];
  for (let i = 1; i <= SAVED_BANKS; i++) {
    m.setBank(i);
    saved[i] = new Uint8Array(BANK_SIZE);
    copyBank(bankWindow(m), saved[i]);
  }
  let fadeFrame = 1;
  addPalette(m, 0, 255, -64, -64, -64);
  m.unlockPalette();
  yield* waitUntil(m, partStart, START_TICKS);
  const loopStart = mark(m);
  const state = { zR: 0 };
  let t;
  do {
    t = elapsed(m, loopStart);
    const isFadingIn = fadeFrame <= FADE_IN_FRAMES;
    if (isFadingIn) {
      addPalette(m, 0, 255, 1, 1, 1);
    }
    fadeFrame++;
    rotatePalette(m, 1, 200, 3);
    for (let i = 1; i <= SAVED_BANKS; i++) {
      m.setBank(i);
      copyBank(saved[i], bankWindow(m));
    }
    m.setActivePage(0);
    placeTorus(torus, t, state);
    torus.draw();
    m.vesaFlip();
    yield* frame(m, passSeconds(isFadingIn, torus.filledFaces));
  } while (t <= LAST_TICK);
  yield* fadeOut(m, partStart);
}

/** 0000:8292, the end: down to black at 30.00 s after the part start (the cycling stops). */
function* fadeOut(m, partStart) {
  const remaining = PART_TICKS - elapsed(m, partStart);
  const base = m.palette.slice();
  const fadeStart = mark(m);
  let el;
  do {
    rotatePalette(m, 1, 200, 1);
    // the music volume ramp (0d6d:0333) is not modelled: the soundtrack plays separately
    el = elapsed(m, fadeStart);
    const k = int16(roundHalfEven((el * 64) / remaining));
    setPaletteOffset(m, base, 0, 255, -k, -k, -k);
    yield* frame(m, FADE_OUT_PASS_SECONDS);
  } while (el < remaining);
}

/** 0000:8768 */
export function* rainbowPart(m) {
  const partStart = partInit(m);
  m.setMode(VESA_640X480);
  setup(m);
  yield* run(m, partStart);
  m.setMode(MODE_13H);
}
