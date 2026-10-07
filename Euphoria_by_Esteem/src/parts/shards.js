// 0000:2aa9, 400.40 s: the picture 38.pcx shatters into spinning additive triangles, a translucent box
// drops, spins and flies into the camera, then a white flash and the wobbling picture.
// 0000:3050, 443.45 s: a texture-mapped, lit torus from 32.pcx. Notes: docs/disassembly/P06_parts_2aa9_3050.md.
import { f32, int16, roundHalfEven, PAGE_SIZE, real48 } from '../machine.js';
import { gradient, addPalette, setPaletteOffset, timedFade, StepFade, repackPage, fillRect } from '../gfx.js';
import { wobble } from '../effects.js';
import { loadPicture } from '../picture.js';
import { newTexture } from '../raster.js';
import { PolyObject, FILL_ADDITIVE } from '../engine3d.js';
import { partInit, mark, elapsed, waitUntil, frame, fps } from './common.js';

// Loop rates of the reference machine. The shard and box loops run faster than the display (fps.txt
// shows 70), so they were measured from the motion.
// Box: its bounces (28 passes of fall, then bounces of 22.5, 20, 17.5 ... passes) land on display frames
// 5, 4, 5, 4 apart and settle 0.46 s after it appears: about 360 passes/s. The 100-step palette fade (one
// step per pass, each writing the whole DAC) runs from 416.50 to 417.10 s in the capture: 167 passes/s.
// Shards: a pass costs more the more of the screen the additive triangles cover (the % of blue pixels
// per display frame goes 60 54 46 37 27 15 8 5 4 3 in the capture: slow while they cover the screen,
// fast once they have left); this cost per pass matches it (about 60 passes/s at full cover, 1000 at none).
const SHARD_PASS_BASE_SECONDS = 0.001;
const SHARD_SECONDS_PER_PIXEL = 0.00000025;
const BOX_FRAME_SECONDS = fps(360);
const BOX_FADING_FRAME_SECONDS = fps(167);
// The wobble loop: 42 changed frames per second in fps.txt (430..440 s). The torus loops: fps.txt per
// phase (they are time based anyway).
const WOBBLE_FRAME_SECONDS = fps(42);
const TUNNEL_FRAME_SECONDS = fps(38);
const RECEDE_FRAME_SECONDS = fps(32);
const SPIN_FRAME_SECONDS = fps(58);
const FLY_FRAME_SECONDS = fps(48);

const PICTURE_PAGE = 102;
const TEXTURE_PAGE = 2;
const SHARD_COLOR = 100;
const SHARD_COUNT = 18;

/** DS:0002: the 18 shard triangles, 1-based grid points k = row*4 + col. */
const SHARD_TRIANGLES = [
  [1, 6, 5], [1, 2, 6], [2, 3, 6], [3, 7, 6], [3, 4, 7], [4, 8, 7], [5, 6, 9], [6, 10, 9], [6, 7, 10],
  [7, 11, 10], [7, 12, 11], [7, 8, 12], [9, 14, 13], [9, 10, 14], [10, 11, 14], [11, 15, 14], [11, 16, 15], [11, 12, 16],
];

/** 1d81:470c Randomize: RandSeed from the DOS clock (INT 21h/2Ch: CX = hour:minute, DX = second:hundredth). */
function randomize(m) {
  const hundredths = Math.floor(m.time * 100);
  const cx = ((Math.floor(hundredths / 360000) % 24) << 8) | (Math.floor(hundredths / 6000) % 60);
  const dx = ((Math.floor(hundredths / 100) % 60) << 8) | (hundredths % 100);
  m.randSeed = ((dx << 16) | cx) >>> 0;
}

/** -6..-2 or 3..8 degrees per pass, from Random(13) - 6. */
function spinAngle(r) {
  return r > 0 ? r + 2 : r - 2;
}

/** -6..-2 or 2..6 units per pass, away from the centre. */
function outwardSpeed(m, coordinate) {
  return coordinate > 0 ? m.random(5) + 2 : m.random(5) - 6;
}

/** 0000:2484: a jittered 4x4 grid over the screen, cut into 18 triangles that fly and spin apart. */
function buildShards(m, shards) {
  randomize(m);
  const rows = roundHalfEven(Math.sqrt(SHARD_COUNT));
  const cols = roundHalfEven(Math.sqrt(SHARD_COUNT));
  const V = [];
  for (let row = 0; row <= rows - 1; row++) {
    for (let col = 1; col <= cols; col++) {
      const k = row * rows + col;
      const jx = roundHalfEven(320 / cols / 2);
      const jy = roundHalfEven(200 / rows / 2);
      let x;
      let y;
      if (col === 1) {
        x = 0;
      } else if (col === cols) {
        x = 319;
      } else {
        x = roundHalfEven(m.random(jx) - jx / 2 + ((col - 1) * 320) / (cols - 1));
      }
      if (row === 0) {
        y = 0;
      } else if (row === rows - 1) {
        y = 199;
      } else {
        y = roundHalfEven(m.random(jy) - jy / 2 + (row * 200) / (rows - 1));
      }
      V[k] = [f32(x - 160), f32(y - 100), 0];
    }
  }
  for (const [a, b, c] of SHARD_TRIANGLES) {
    shards.addTri(V[a], V[b], V[c]);
    const f = shards.faces[shards.faces.length - 1];
    f.center();
    const vx = outwardSpeed(m, f.pivot.wx);
    const vy = outwardSpeed(m, f.pivot.wy);
    const vz = m.random(5) - 2;
    f.setVelocity(f32(vx), f32(vy), f32(vz));
    const ax = m.random(13) - 6;
    const ay = m.random(13) - 6;
    const az = m.random(13) - 6;
    f.setAngles(spinAngle(ax), spinAngle(ay), spinAngle(az));
  }
}

/** The pixels of page 1 the shards changed: what the additive fill of a pass costs. */
function countPixelsDrawn(m) {
  const picture = m.getPage(PICTURE_PAGE);
  const page = m.getPage(1);
  let count = 0;
  for (let i = 0; i < PAGE_SIZE; i++) {
    if (page[i] !== picture[i]) {
      count++;
    }
  }
  return count;
}

function shardPassSeconds(pixelsDrawn) {
  return SHARD_PASS_BASE_SECONDS + SHARD_SECONDS_PER_PIXEL * pixelsDrawn;
}

/** 0000:2893: the picture tinted blue fades in, then breaks into the shards (until part time 6 s). */
function* shatterIntro(m, partStart) {
  const e = m.engine;
  m.setActivePage(1);
  gradient(m, 100, 163, 0, 0, 0, 0, 0, 63);
  gradient(m, 163, 255, 0, 0, 63, 0, 0, 63);
  const shards = new PolyObject(e, 0x144, SHARD_COLOR, 255);
  shards.setColorStep(0);
  const tint = new PolyObject(e, FILL_ADDITIVE, SHARD_COLOR, 255);
  tint.addWall('X', -100, 0, 100, 0, -160, 160);
  randomize(m);
  buildShards(m, shards);
  addPalette(m, 0, 255, -64, -64, -64);
  m.copyPage(PICTURE_PAGE, 1);
  tint.draw();
  m.present();
  m.unlockPalette();
  yield* timedFade(m, 0, 255, 1, 1, 1, 64, 200);
  yield* waitUntil(m, partStart, 300);
  let t;
  do {
    t = elapsed(m, partStart);
    m.copyPage(PICTURE_PAGE, 1);
    for (const f of shards.faces) {
      f.stepRotate();
      f.stepTranslate();
    }
    shards.draw();
    m.present();
    yield* frame(m, shardPassSeconds(countPixelsDrawn(m)));
  } while (t <= 600);
  m.copyPage(PICTURE_PAGE, 1);
  m.present();
  m.freePage(1);
}

/** 0e5a:0cca: a sx x sy x sz box, opposite faces in the same colour (min, min+step, min+2*step). */
function buildBox(engine, sx, sy, sz, flags, colorStep, minColor, maxColor) {
  const box = new PolyObject(engine, flags, minColor, maxColor);
  const hx = Math.trunc(sx / 2);
  const hy = Math.trunc(sy / 2);
  const hz = Math.trunc(sz / 2);
  box.setColorStep(colorStep);
  box.addWall('Z', -hx, -hy, hx, -hy, -hz, hz);
  box.addWall('Z', -hx, hy, -hx, -hy, -hz, hz);
  box.addWall('X', -hy, hz, hy, hz, -hx, hx);
  box.nextColor = box.minColor;
  box.addWall('Z', hx, hy, -hx, hy, -hz, hz);
  box.addWall('Z', hx, hy, hx, -hy, hz, -hz);
  box.addWall('X', hy, -hz, -hy, -hz, -hx, hx);
  return box;
}

/**
 * The part sets the span hook (186a:1620) to AddSpan (186a:16fa) while the box is drawn, so its flat
 * faces add their colour to the picture. The engine has no hook: its additive fill type is the same thing.
 */
function drawFlatFacesAdditively(box) {
  for (const f of box.faces) {
    f.flags = (f.flags & ~7) | FILL_ADDITIVE;
  }
}

/** Loop 1 of 0000:2aa9: the box bounces down, its colours fade, it spins and flies into the camera. */
function* boxLoop(m, fade) {
  const box = buildBox(m.engine, 100, 100, 100, 0x80, 0x40, 0x40, 0xff);
  drawFlatFacesAdditively(box);
  const phaseStart = mark(m);
  let posY = f32(-160);
  let bounce = f32(5);
  let velY = f32(0);
  let t;
  do {
    t = elapsed(m, phaseStart);
    m.copyPage(PICTURE_PAGE, 1);
    let passSeconds = BOX_FRAME_SECONDS;
    if (t > 1000 && !fade.step()) {
      passSeconds = BOX_FADING_FRAME_SECONDS;
    }
    if (t > 1900) {
      box.moveTo(0, 0, f32(((t - 1900) * 100) / 400));
    } else if (bounce > 0) {
      posY = f32(posY + velY);
      velY = f32(0.4 + velY);
      if (posY > 0) {
        posY = f32(posY - velY);
        if (bounce > 0) {
          bounce = f32(bounce - 0.5);
        }
        velY = f32(-bounce);
      }
      box.moveTo(0, posY, 0);
    }
    box.rotateWork(f32((t * 360) / 900), f32((t * 360) / 600), f32((t * 360) / 500));
    box.draw();
    m.present();
    yield* frame(m, passSeconds);
  } while (t < 2300);
}

/** Loop 2 of 0000:2aa9: the picture wobbles, the speed decaying to 0 over 11 s, from white in 1 s. */
function* wobbleLoop(m) {
  const pal = m.palette.slice();
  const phaseStart = mark(m);
  m.setColor(0, 0, 0, 0);
  let t;
  do {
    t = elapsed(m, phaseStart);
    if (t <= 100) {
      const o = int16(-roundHalfEven((t * 64) / 100));
      setPaletteOffset(m, pal, 0, 255, o, o, o);
    }
    let speed = roundHalfEven(40 - (t * 40) / 1100);
    if (speed < 0) {
      speed = 0;
    }
    wobble(m, PICTURE_PAGE, m.activePageNumber, speed & 0xff);
    m.present();
    yield* frame(m, WOBBLE_FRAME_SECONDS);
  } while (t <= 1100);
}

/** 0000:2aa9 */
export function* shardsPart(m) {
  const partStart = partInit(m);
  gradient(m, 0, 255, 0, 0, 0, 0, 0, 0);
  m.lockPalette();
  loadPicture(m, PICTURE_PAGE, 0x27);
  yield* shatterIntro(m, partStart);
  yield* waitUntil(m, partStart, 615);

  gradient(m, 64, 127, 0, 0, 0, 50, 0, 63);
  gradient(m, 128, 191, 0, 0, 0, 0, 63, 63);
  gradient(m, 192, 255, 0, 0, 0, 63, 50, 0);
  const target = m.palette.slice();
  gradient(m, 64, 127, 0, 0, 0, 0, 0, 63);
  gradient(m, 128, 191, 0, 0, 0, 0, 63, 0);
  gradient(m, 192, 255, 0, 0, 0, 63, 0, 0);
  const fade = new StepFade(m, 64, 255, target, 100);
  m.setActivePage(1);
  yield* boxLoop(m, fade);

  yield* timedFade(m, 0, 255, 1, 1, 1, 64, 33);
  m.getPage(0).fill(1, 0, 64000);
  yield* wobbleLoop(m);

  yield* timedFade(m, 0, 255, 1, 1, 1, 64, 50);
  m.getPage(0).fill(0, 0, 64000);
  m.setColor(0, 64, 64, 64);
  m.freePage(1);
  m.freePage(PICTURE_PAGE);
  const remaining = 4300 - elapsed(m, partStart);
  yield* timedFade(m, 0, 255, -1, -1, -1, 64, remaining);
  m.getPage(0).fill(0, 0, 64000);
}

// ---- 0000:3050 the torus ----


/** The ring i (1-based sides): R around the z axis, tube radius r. */
function torusRing(i, nRing, nSide, R, r) {
  const a = real48((i * 360) / nRing);
  const ring = [null];
  for (let j = 1; j <= nSide; j++) {
    const b = real48((j * 360) / nSide);
    const rr = real48(Math.sin((b * Math.PI) / 180) * r + R);
    const x = real48(Math.sin((a * Math.PI) / 180) * rr);
    const y = real48(Math.cos((a * Math.PI) / 180) * rr);
    const z = real48(Math.cos((b * Math.PI) / 180) * r);
    ring.push([f32(x), f32(y), f32(z)]);
  }
  return ring;
}

/** 0e5a:2500: nRing x nSide textured quads, each a window of the texture page. */
function buildTorus(engine, R, r, nRing, nSide, flags, minColor, maxColor, texPage) {
  const torus = new PolyObject(engine, flags, minColor, maxColor);
  const du = real48(255 / nRing);
  const dv = real48(200 / nSide);
  const texW = roundHalfEven(du);
  const texH = roundHalfEven(dv);
  const quad = (a, b, c, d, u0, v0) => {
    const f = torus.addQuad(a, b, c, d);
    const tex = newTexture(texPage, u0, v0, texW, texH);
    f.setExtra(tex, tex);
  };
  let first = null;
  let prev = null;
  let cur = null;
  for (let i = 1; i <= nRing; i++) {
    cur = torusRing(i, nRing, nSide, R, r);
    if (prev) {
      const u0 = roundHalfEven((i - 1) * du);
      for (let j = 1; j <= nSide - 1; j++) {
        quad(prev[j], cur[j], cur[j + 1], prev[j + 1], u0, roundHalfEven((j - 1) * dv));
      }
      quad(prev[nSide], cur[nSide], cur[1], prev[1], u0, roundHalfEven((nSide - 1) * dv));
    } else {
      first = cur;
    }
    prev = cur;
  }
  for (let j = 1; j <= nSide - 1; j++) {
    quad(cur[j], first[j], first[j + 1], prev[j + 1], 0, roundHalfEven((j - 1) * dv));
  }
  quad(cur[nSide], first[nSide], first[1], cur[1], 0, roundHalfEven((nSide - 1) * dv));
  return torus;
}

/** A 10/11-pixel black frame around the screen. */
function drawBorder(m) {
  fillRect(m, 0, 0, 320, 10, 0);
  fillRect(m, 0, 190, 320, 200, 0);
  fillRect(m, 0, 0, 10, 200, 0);
  fillRect(m, 310, 0, 320, 200, 0);
}

function rotateAll(torus, t) {
  torus.rotateWork(f32(t / 4), f32((t - 800) / 10), f32((t - 800) / 6));
}

function* torusFrame(m, torus, seconds) {
  torus.draw();
  drawBorder(m);
  m.present();
  yield* frame(m, seconds);
}

/** 0000:3050 */
export function* torusPart(m) {
  const e = m.engine;
  partInit(m);
  e.freeLights();
  e.lightDir.update(30, 0, 0);
  loadPicture(m, TEXTURE_PAGE, 0x21);
  repackPage(m, TEXTURE_PAGE, 256, 200);
  const torus = buildTorus(e, 60, 25, 20, 11, 0x5b, 0, 255, TEXTURE_PAGE);
  torus.setPhong(0, 0, 120, 10);
  gradient(m, 0, 70, 0, 0, 0, 63, 40, 0);
  gradient(m, 70, 120, 63, 40, 0, 63, 63, 63);
  gradient(m, 120, 255, 63, 63, 63, 63, 63, 63);
  m.setActivePage(1);
  const pal = m.palette.slice();
  let isPaletteDone = false;
  torus.rotate(0, 0, 90);
  torus.rotate(0, 90, 0);
  torus.rotate(120, 0, 0);
  torus.moveTo(0, 50, 150);
  const phaseStart = mark(m);

  let t;
  do {
    t = elapsed(m, phaseStart);
    if (t <= 200) {
      const o = int16(roundHalfEven((t * 64) / 200) - 64);
      setPaletteOffset(m, pal, 0, 255, o, o, o);
    } else if (!isPaletteDone) {
      m.setPalette(pal);
      isPaletteDone = true;
    }
    torus.rotateWork(f32(t / 4), 0, 0);
    yield* torusFrame(m, torus, TUNNEL_FRAME_SECONDS);
  } while (t <= 800);

  do {
    t = elapsed(m, phaseStart);
    m.fillActive(0);
    if (t < 1200) {
      torus.moveTo(0, f32(50 - ((t - 800) * 50) / 400), f32(150 - ((t - 800) * 200) / 400));
    }
    rotateAll(torus, t);
    yield* torusFrame(m, torus, RECEDE_FRAME_SECONDS);
  } while (t <= 1300);

  torus.flags = 0x1b;
  for (const f of torus.faces) {
    f.flags = 0x1b;
  }
  do {
    t = elapsed(m, phaseStart);
    m.fillActive(0);
    rotateAll(torus, t);
    yield* torusFrame(m, torus, SPIN_FRAME_SECONDS);
  } while (t < 4200);

  do {
    t = elapsed(m, phaseStart);
    m.fillActive(0);
    torus.moveTo(0, f32(((t - 4200) * 25) / 1000), f32(((t - 4200) * 220) / 760 + -50));
    rotateAll(torus, t);
    yield* torusFrame(m, torus, FLY_FRAME_SECONDS);
  } while (t <= 5200);
  m.fillActive(0);
  m.present();
  m.freePage(TEXTURE_PAGE);
  m.freePage(1);
}
