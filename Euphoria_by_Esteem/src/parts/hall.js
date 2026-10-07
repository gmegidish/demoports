// 0000:60dc, 296.00 s: first the "time-delay echo" (0b1a:01f7), a box spinning in a 120x70 window whose
// rows come from older and older frames; then a checker cube flying over the pillar hall.
// Notes: P05_part_60dc.md, and L5_units.md "0b1a". Music volume calls are left out (the soundtrack is a recording).
import { f32, int16, roundHalfEven } from '../machine.js';
import { gradient, addPalette, setPaletteOffset, timedFade, remapRange, repackPage } from '../gfx.js';
import { loadPicture } from '../picture.js';
import { newTexture } from '../raster.js';
import { PolyObject } from '../engine3d.js';
import { sinR } from '../tables.js';
import { partInit, mark, elapsed, waitUntil, frame, fps } from './common.js';

/** DS:255e is 100 with EMS. */
const EMS_PAGE_BASE = 100;

// ---- 0b1a: the time-delay echo ----

const WINDOW_X = 100;
const WINDOW_Y = 65;
const WINDOW_W = 120;
const WINDOW_H = 70;
/** EMS pages 0..69 exist; cursor value 70 maps nothing and keeps page 69 mapped. */
const RING_PAGES = 70;
const RING_LAST = 70;
const ECHO_TEXTURE_PAGE = 2;
const ECHO_BACKGROUND_PAGE = 3;
const ECHO_FADE_IN_END = 200;
const ECHO_FLY_IN_TICKS = 400;
const ECHO_FLY_OUT_TICKS = 3700;
const ECHO_SCALE_TICKS = 800;
const ECHO_TEXTURE_TICKS = 1500;
const ECHO_LOOP_TICKS = 4200;
const ECHO_PART_TICKS = 4500;
/** The loop waits for 0.75 tick per frame (133 fps); the capture changes on every 70 Hz frame. */
const ECHO_TICKS_PER_FRAME = f32(0.75);

/** 0e5a:0596 TBox.Init: a box of 6 walls, 8 shared vertices. */
function buildBox(engine, sx, sy, sz, flags, minColor, maxColor) {
  const box = new PolyObject(engine, flags, minColor, maxColor);
  const hx = Math.trunc(sx / 2);
  const hy = Math.trunc(sy / 2);
  const hz = Math.trunc(sz / 2);
  box.addWall('Z', -hx, -hy, hx, -hy, -hz, hz);
  box.addWall('Z', hx, hy, hx, -hy, hz, -hz);
  box.addWall('Z', hx, hy, -hx, hy, -hz, hz);
  box.addWall('Z', -hx, hy, -hx, -hy, -hz, hz);
  box.addWall('X', -hy, hz, hy, hz, -hx, hx);
  box.addWall('X', hy, -hz, -hy, -hz, -hx, hx);
  return box;
}

/** The ring of EMS frames (handle DS:467a), each a 120-stride window. */
class EchoRing {
  constructor(m) {
    this.m = m;
    this.frames = Array.from({ length: RING_PAGES }, () => new Uint8Array(0x10000));
    this.cur = 0;
  }

  /** emsMap1: the page that is mapped for cursor k. */
  frameAt(k) {
    return this.frames[Math.min(k, RING_PAGES - 1)];
  }

  /** 0b1a:0000 */
  grabBackground(dst) {
    const m = this.m;
    m.setActivePage(ECHO_BACKGROUND_PAGE);
    const src = m.active;
    for (let r = 0; r < WINDOW_H; r++) {
      const from = (WINDOW_Y + r) * 320 + WINDOW_X;
      dst.set(src.subarray(from, from + WINDOW_W), r * WINDOW_W);
    }
  }

  /** 0b1a:00e5 */
  init() {
    for (const f of this.frames) {
      this.grabBackground(f);
    }
    this.cur = 0;
    this.grabBackground(this.frameAt(0));
    this.m.centerX = 60;
    this.m.centerY = 35;
  }

  /** 0b1a:0045: screen row 65+i shows row i of frame cur+i; row 65 is never written. */
  show() {
    const screen = this.m.getPage(0);
    let k = this.cur;
    let dst = WINDOW_Y * 320 + WINDOW_X;
    for (let i = 0; i < WINDOW_H; i++) {
      if (i > 0) {
        screen.set(this.frameAt(k).subarray(i * WINDOW_W, (i + 1) * WINDOW_W), dst);
      }
      dst += 320;
      k++;
      if (k > RING_LAST) {
        k = 0;
      }
    }
  }

  /** 0b1a:0199 */
  step() {
    this.show();
    this.cur++;
    if (this.cur > RING_LAST) {
      this.cur = 0;
    }
    this.grabBackground(this.frameAt(this.cur));
  }

  /** 0b1a:0171 */
  done() {
    this.m.centerX = 160;
    this.m.centerY = 100;
  }
}

/** 1342:02be AddAngles, with its sic: a negative angle becomes 360 - a. */
function addAngle(a, d) {
  let r = f32(a + d);
  if (r > 360) {
    r = f32(r - 360);
  }
  if (r < 0) {
    r = f32(360 - r);
  }
  return r;
}

/** The fly-in/fly-out depth of the echo box. */
function echoDepth(u) {
  return f32((-(u * u) * 30) / 400);
}

/** 0b1a:01f7 setup: pictures, palette, the box and the ring. */
function setupEcho(m) {
  const tmp = EMS_PAGE_BASE + 1;
  loadPicture(m, tmp, 0x28);
  remapRange(m, tmp, 1, 104, 150);
  const backgroundPalette = m.palette.slice();
  loadPicture(m, ECHO_TEXTURE_PAGE, 0x1f);
  repackPage(m, ECHO_TEXTURE_PAGE, 256, 200);
  m.setActivePage(ECHO_BACKGROUND_PAGE);
  m.copyPage(tmp, ECHO_BACKGROUND_PAGE);
  m.freePage(tmp);
  m.setPaletteRange(150, 255, backgroundPalette);
  m.setColor(0, 0, 0, 0);
  gradient(m, 101, 130, 30, 20, 0, 63, 40, 0);
  gradient(m, 130, 149, 63, 40, 0, 63, 50, 30);
  const box = buildBox(m.engine, 38, 38, 38, 9, 101, 149);
  const t1 = newTexture(ECHO_TEXTURE_PAGE, 0, 0, 192, 150);
  const t2 = newTexture(ECHO_TEXTURE_PAGE, 0, 0, 192, 150);
  box.setTextures(t1, t2);
  box.translate(0, 0, -4500);
  const ring = new EchoRing(m);
  ring.init();
  return { box, ring };
}

/** Draws the box into the ring's current frame: DS:5c22 = frame, W = 120 for the row table. */
function drawIntoFrame(m, box, ring) {
  m.active = ring.frameAt(ring.cur);
  m.width = WINDOW_W;
  box.draw();
  m.width = 320;
}

/** 0b1a:01f7 */
function* echoScene(m) {
  const partStart = mark(m);
  m.setClip(0, 0, m.width - 1, m.height - 1);
  m.engine.perspective = 200;
  m.lockPalette();
  const { box, ring } = setupEcho(m);
  let angle = [0, 0, 0];
  let s = f32(1);
  let ds = f32(-0.1);
  let scaleStep = 0;
  let frameNumber = 1;
  let isTextured = false;
  addPalette(m, 0, 255, -64, -64, -64);
  m.setActivePage(ECHO_BACKGROUND_PAGE);
  m.unlockPalette();
  m.present();
  const darkPalette = m.palette.slice();
  const fadeTicks = ECHO_FADE_IN_END - elapsed(m, partStart);
  let clock = mark(m);
  let t;
  do {
    t = elapsed(m, clock);
    const v = roundHalfEven((t * 64) / fadeTicks);
    setPaletteOffset(m, darkPalette, 0, 255, v, v, v);
    if (t < fadeTicks) {
      yield m.tickTime(m.ticks + 1);
    }
  } while (t < fadeTicks);
  setPaletteOffset(m, darkPalette, 0, 0, 64, 64, 64);
  clock = mark(m);
  do {
    t = elapsed(m, clock);
    if (t <= ECHO_FLY_IN_TICKS) {
      box.moveTo(0, 0, echoDepth(ECHO_FLY_IN_TICKS - t));
    }
    if (t >= ECHO_FLY_OUT_TICKS) {
      box.moveTo(0, 0, echoDepth(t - ECHO_FLY_OUT_TICKS));
    }
    box.rotateWork(angle[0], angle[1], angle[2]);
    angle = [addAngle(angle[0], f32(0.6)), addAngle(angle[1], f32(0.8)), addAngle(angle[2], f32(0.7))];
    drawIntoFrame(m, box, ring);
    ring.step();
    if (t > ECHO_SCALE_TICKS) {
      box.scaleUniform(f32((sinR(int16(scaleStep * 10)) * s) / 1000 + 1));
      if (s < 1 || s > 20) {
        ds = f32(-ds);
      }
      s = f32(s + ds);
      scaleStep++;
    }
    if (t > ECHO_TEXTURE_TICKS && ring.cur === 0 && !isTextured) {
      for (const face of box.faces) {
        face.flags = 3;
      }
      isTextured = true;
    }
    t = elapsed(m, clock);
    yield* waitUntil(m, clock, frameNumber * ECHO_TICKS_PER_FRAME);
    frameNumber++;
  } while (t <= ECHO_LOOP_TICKS);
  ring.done();
  m.freePage(ECHO_TEXTURE_PAGE);
  m.freePage(ECHO_BACKGROUND_PAGE);
  yield* waitUntil(m, partStart, ECHO_PART_TICKS);
}

// ---- 0000:60dc: the checker cube over the pillar hall ----

/**
 * The loop has no vsync: the capture changes on every 70 Hz frame, so it ran faster. The frame-counted
 * wobble pins the rate: matching the cube's screen position at 343..390 s against rates of 60..200 fps
 * fits best at 103 passes/s.
 */
const CUBE_FRAME_SECONDS = fps(103);
const TEXTURE_PAGE = EMS_PAGE_BASE + 2;
const BACKGROUND_PAGE = EMS_PAGE_BASE + 3;
const PILLAR_PAGE = EMS_PAGE_BASE + 4;
const DRAW_PAGE = 1;
const HALF_SIDE = 45;
const SLIDE_IN_TICKS = 500;
const FLY_OUT_TICKS = 5340;
const LOOP_TICKS = 5800;
const FADE_END_TICKS = 5900;
const JITTER_MAX = 14;

/** MakeVec P1..P26 (index 0 unused). */
function cubePoints(s) {
  return [
    null,
    [-s, -s, s], [0, -s, s], [s, -s, s], [-s, 0, s], [0, 0, s], [s, 0, s], [-s, s, s], [0, s, s], [s, s, s],
    [-s, -s, -s], [0, -s, -s], [s, -s, -s], [-s, 0, -s], [0, 0, -s], [s, 0, -s], [-s, s, -s], [0, s, -s], [s, s, -s],
    [-s, -s, 0], [-s, 0, 0], [-s, s, 0], [s, -s, 0], [s, 0, 0], [s, s, 0], [0, -s, 0], [0, s, 0],
  ];
}

/** The 24 quads, four per side, as P-numbers a, b, c, d. */
const CUBE_QUADS = [
  [1, 2, 5, 4], [2, 3, 6, 5], [4, 5, 8, 7], [5, 6, 9, 8],
  [3, 22, 23, 6], [22, 12, 15, 23], [6, 23, 24, 9], [23, 15, 18, 24],
  [12, 11, 14, 15], [11, 10, 13, 14], [15, 14, 17, 18], [14, 13, 16, 17],
  [10, 19, 20, 13], [19, 1, 4, 20], [13, 20, 21, 16], [20, 4, 7, 21],
  [10, 11, 25, 19], [11, 12, 22, 25], [19, 25, 2, 1], [25, 22, 3, 2],
  [7, 8, 26, 21], [8, 9, 24, 26], [21, 26, 17, 16], [26, 24, 18, 17],
];

function buildCube(engine) {
  const P = cubePoints(HALF_SIDE);
  const textures = [
    newTexture(TEXTURE_PAGE, 0, 0, 128, 100),
    newTexture(TEXTURE_PAGE, 128, 0, 128, 100),
    newTexture(TEXTURE_PAGE, 0, 100, 128, 100),
    newTexture(TEXTURE_PAGE, 128, 100, 128, 100),
  ];
  const cube = new PolyObject(engine, 0x43, 100, 200);
  CUBE_QUADS.forEach(([a, b, c, d], k) => {
    const face = cube.addQuad(P[a], P[b], P[c], P[d]);
    face.setExtra(textures[k % 4], textures[k % 4]);
  });
  return cube;
}

/** Pictures and palette: 101..255 from the remapped 39.pcx, 1..100 from 30.pcx, 0 black. */
function setupHall(m) {
  m.lockPalette();
  m.setClip(0, 0, m.width - 1, m.height);
  loadPicture(m, PILLAR_PAGE, 0x29);
  remapRange(m, PILLAR_PAGE, 1, 104, 150);
  loadPicture(m, BACKGROUND_PAGE, 0x28);
  remapRange(m, BACKGROUND_PAGE, 1, 104, 150);
  const savedPalette = m.palette.slice();
  loadPicture(m, TEXTURE_PAGE, 0x1f);
  repackPage(m, TEXTURE_PAGE, 256, 200);
  m.setPaletteRange(101, 255, savedPalette);
  m.setActivePage(DRAW_PAGE);
}

/** The cube's vertices, their rest positions and their jitter phases. */
function vertexState(m, cube) {
  const vertices = [];
  for (let i = 1; i <= 26; i++) {
    const phase = m.random(50);
    const v = cube.getItem(i);
    vertices.push({ v, phase, x: v.wx, y: v.wy, z: v.wz });
  }
  return vertices;
}

/** The jitter amplitude: a ramp of one step per 30 frames, then 15 cos(cnt / 20). */
function stepJitter(j, frameNumber) {
  if (j.isOscillating) {
    j.amp = int16(roundHalfEven(Math.cos(j.cnt / 20) * 15));
    j.cnt = int16(j.cnt + 1);
    return;
  }
  if (frameNumber % 30 === 0) {
    j.amp++;
  }
  if (j.amp > JITTER_MAX) {
    j.isOscillating = true;
  }
}

function placeVertices(vertices, X, Y, amp) {
  for (const p of vertices) {
    const nx = f32(X + p.x + Math.sin(p.phase / 2) * amp);
    const ny = f32(Y + p.y + Math.sin(p.phase / 5) * amp);
    const nz = f32(p.z + Math.sin(p.phase / 6) * amp);
    p.v.setPos(nx, ny, nz);
    p.phase = int16(p.phase + 1);
  }
}

/** 0000:60dc */
export function* hallPart(m) {
  yield* echoScene(m);
  const partStart = partInit(m);
  setupHall(m);
  const cube = buildCube(m.engine);
  m.setColor(0, 0, 0, 0);
  const vertices = vertexState(m, cube);
  let A = 0;
  let B = 0;
  const jitter = { amp: 0, cnt: 0, isOscillating: false };
  let frameNumber = 0;
  m.unlockPalette();
  cube.moveTo(0, -10, -100);
  const rotationStart = mark(m);
  let et;
  do {
    frameNumber = int16(frameNumber + 1);
    et = elapsed(m, partStart);
    m.copyPage(BACKGROUND_PAGE, DRAW_PAGE);
    m.setActivePage(DRAW_PAGE);
    if (et < SLIDE_IN_TICKS) {
      A = Math.min(f32((et * 500) / 500 - 500), 0);
      B = Math.min(f32((et * 80) / 500 - 80), 0);
    }
    if (et > FLY_OUT_TICKS) {
      A = f32(((et - FLY_OUT_TICKS) * 470) / 400);
    }
    const X = f32(Math.sin(frameNumber / 30) * 40 + A);
    const Y = f32(Math.sin(frameNumber / 30) * 80 + B);
    placeVertices(vertices, X, Y, jitter.amp);
    if (et > SLIDE_IN_TICKS) {
      stepJitter(jitter, frameNumber);
    }
    const rt = elapsed(m, rotationStart);
    cube.rotateWork(f32((rt * 360) / 2200), f32((rt * 360) / 800), f32((rt * 360) / 1600));
    cube.draw();
    if (et < SLIDE_IN_TICKS) {
      m.copyPageTransparent(PILLAR_PAGE, DRAW_PAGE);
    }
    m.present();
    yield* frame(m, CUBE_FRAME_SECONDS);
  } while (et < LOOP_TICKS);
  m.freePage(DRAW_PAGE);
  m.freePage(TEXTURE_PAGE);
  m.freePage(BACKGROUND_PAGE);
  m.freePage(PILLAR_PAGE);
  yield* timedFade(m, 0, 255, -1, -1, -1, 64, FADE_END_TICKS - elapsed(m, partStart));
  m.getPage(0).fill(0, 0, 64000);
}
