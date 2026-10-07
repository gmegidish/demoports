// 0000:3f83, 173.00 s: a starfield, a comet meets an explosion, the warp and its white flash, Jupiter
// and the Earth rushing at the camera, the warp again, then the cloud tunnel (0000:3921), which restarts
// the part clock and ends at about 296.0 s. Notes: docs/disassembly/P04_part_3f83.md.
import { f32, int16, roundHalfEven, real48 } from '../machine.js';
import { gradient, setPaletteOffset, addPalette, remapRange, repackPage, fillRect, StepFade, sinTableInt, cosTableInt } from '../gfx.js';
import { newTexture } from '../raster.js';
import { blur, blurDecay } from '../effects.js';
import { PolyObject, BigPixel, Starfield, Explosion } from '../engine3d.js';
import { loadPicture } from '../picture.js';
import { mark, elapsed, frame, fps, partInit } from './common.js';

/** Every loop of the part showed 70 changed frames per second in the capture (fps.txt, 174..267 s). */
const FRAME_SECONDS = fps(70);
/**
 * The tunnel loop is slower than a refresh, and each present() tears across two or three refreshes (so fps.txt
 * shows ~31). Counting the torn updates frame by frame in the capture gives 17..18 passes per second (268..288 s).
 */
const TUNNEL_FRAME_SECONDS = fps(18);
/** Once the texture is smeared each pass too (el > 2000), 15 passes per second (torn updates, 288..289 s). */
const TUNNEL_FADING_FRAME_SECONDS = fps(15);

const JUPITER_PAGE = 102;
const EARTH_PAGE = 103;
const STAR_LAYER_PAGE = 104;
const CLOUD_PAGE = 102;
const DRAW_PAGE = 1;

const STAR_DOTS = 0;
const STAR_PLUS = 1;
const STAR_STREAKS = 2;
const STAR_COUNT = 100;
const EXPLOSION_PARTICLES = 500;
const COMET_COLOR = 200;
const BASE_SPEED = 10;

const STARS_TICKS = 750;
const FADE_IN_TICKS = 200;
const COMET_TICKS = 500;
const EXPLOSION_TICKS = 1500;
const WARP_RAMP_START = 1800;
const FLASH_START = 4400;
const FLASH_PEAK = 4450;
const FLASH_END = 4500;
const FLASH_HOLD = 4600;
const WARP_TICKS = 5000;
const DIM_TICKS = 500;
const SPHERE1_TICKS = 800;
const SPHERE2_START = 1000;
const SPHERE2_END = 1800;
const PART_TICKS = 8800;

const TUNNEL_PRECOMPUTE_FRAMES = 64;
const BORDERS_TICKS = 700;
const TUNNEL_OPEN_TICKS = 500;
const TUNNEL_FADE_START = 2000;
const TUNNEL_PART_TICKS = 3500;
const TUNNEL_RINGS = 60;
const TUNNEL_DEPTHS = 64;
const MAX_TWIST = 60;


/** A float32 vector of the sphere builder (1342:03ef MakeVec). */
function ringPoint(radius, y, angle) {
  return [f32(radius * Math.cos(angle)), f32(y), f32(radius * Math.sin(angle))];
}

/** 0e5a:1cf5 TSphere.Init: n x n textured quads, band by band from the +y pole, the page mapped once around. */
function buildSphere(engine, radius, n, flags, page) {
  const sphere = new PolyObject(engine, flags, 100, 250);
  const dPhi = real48((2 * Math.PI) / n);
  let ringR = 0;
  let ringY = radius;
  const du = Math.trunc(256 / n);
  const dv = Math.trunc(200 / n);
  for (let i = 1; i <= n; i++) {
    const prevR = ringR;
    const prevY = ringY;
    ringR = real48(radius * Math.sin((i * Math.PI) / n));
    ringY = real48(radius * Math.cos((i * Math.PI) / n));
    for (let j = 1; j <= n; j++) {
      const a1 = real48(dPhi * j);
      const a0 = real48(dPhi * (j - 1));
      const v1 = ringPoint(prevR, prevY, a0);
      const v2 = ringPoint(ringR, ringY, a1);
      const v3 = ringPoint(prevR, prevY, a1);
      const v4 = ringPoint(ringR, ringY, a0);
      const face = sphere.addQuad(v1, v3, v2, v4);
      const texture = newTexture(page, ((j - 1) * du) & 0xffff, ((i - 1) * dv) & 0xffff, du, dv);
      face.setExtra(texture, texture);
    }
  }
  return sphere;
}

/** The palette after the gradients of a sphere picture: 0..150 a blue-white ramp, the picture above. */
function loadSpherePalette(m, page, resourceNumber) {
  loadPicture(m, page, resourceNumber);
  remapRange(m, page, 1, 100, 155);
  gradient(m, 0, 120, 0, 0, 0, 40, 40, 63);
  gradient(m, 120, 150, 40, 40, 63, 63, 63, 63);
  return m.palette.slice();
}

function setUp(m) {
  const engine = m.engine;
  gradient(m, 0, 120, 0, 0, 0, 0, 0, 63);
  gradient(m, 120, 200, 0, 0, 63, 63, 63, 63);
  gradient(m, 200, 255, 63, 63, 63, 0, 0, 63);
  const palA = m.palette.slice();
  const palB = loadSpherePalette(m, JUPITER_PAGE, 0x1d);
  const palC = loadSpherePalette(m, EARTH_PAGE, 0x1e);
  repackPage(m, JUPITER_PAGE, 256, 200);
  repackPage(m, EARTH_PAGE, 256, 200);
  const jupiter = buildSphere(engine, 54, 12, 0x203, JUPITER_PAGE);
  const earth = buildSphere(engine, 60, 12, 0x203, EARTH_PAGE);
  earth.rotate(0, 0, 180);
  m.setActivePage(DRAW_PAGE);
  engine.perspective = 200;
  m.setClip(2, 0, 319, 199);
  gradient(m, 0, 180, 0, 0, 0, 0, 0, 63);
  gradient(m, 180, 255, 0, 0, 63, 63, 63, 63);
  const palD = m.palette.slice();
  gradient(m, 0, 120, 0, 0, 0, 0, 0, 63);
  gradient(m, 120, 230, 0, 0, 63, 63, 63, 63);
  gradient(m, 230, 255, 63, 63, 63, 63, 63, 63);
  const stars = new Starfield(engine, STAR_COUNT, 0, 255);
  const explosion = new Explosion(engine, EXPLOSION_PARTICLES);
  const comet = new BigPixel(120, 245, 0, COMET_COLOR);
  engine.starMode = STAR_DOTS;
  m.gradStep = 0;
  const palF = m.palette.slice();
  return { stars, explosion, comet, jupiter, earth, palA, palB, palC, palD, palF, speed: BASE_SPEED };
}

function moveAndDrawStars(stars, speed) {
  stars.move(int16(speed));
  stars.drawAll();
}

/** S0, 42a4: the starfield fades in from black. */
function* starsFadeIn(m, scene, partStart) {
  const sceneStart = mark(m);
  do {
    const el = elapsed(m, sceneStart);
    if (el < FADE_IN_TICKS) {
      const o = int16(roundHalfEven((el * 60) / 200) - 60);
      setPaletteOffset(m, scene.palF, 0, 255, o, o, o);
    }
    moveAndDrawStars(scene.stars, BASE_SPEED);
    blur(m);
    m.present();
    yield* frame(m, FRAME_SECONDS);
  } while (!(elapsed(m, partStart) > STARS_TICKS));
}

/** S1a/S1b: the comet and the explosion cluster meet in the centre, then the explosion expands. */
function cometAndExplosion(m, scene, el) {
  const { comet, explosion } = scene;
  if (el <= COMET_TICKS) {
    const cx = f32(120 - (el * 120) / 500);
    const cy = f32(240 - (el * 240) / 500);
    comet.setPos(cx, cy, 0);
    comet.draw(m.engine);
    const ex = f32((el * 180) / 500 + -180);
    const ey = f32((el * el) / 6.25 / 500 + -80);
    explosion.moveTo(ex, ey, 0);
  } else {
    explosion.step();
    m.engine.starMin = 150;
  }
  explosion.drawAll();
  blur(m);
}

/** S1c: the warp accelerates; streaks get longer and brighter. */
function warpRamp(m, scene, el) {
  const engine = m.engine;
  engine.starMin = int16(roundHalfEven(((el - WARP_RAMP_START) * 155) / 500) + 150);
  m.gradStep = int16(roundHalfEven(((el - WARP_RAMP_START) * 50) / 200));
  scene.speed = roundHalfEven(((el - WARP_RAMP_START) * 60) / 1500) + 10;
  if (scene.speed < 10) {
    scene.speed = 10;
  }
  if (scene.speed > 60) {
    scene.speed = 60;
  }
  if (m.gradStep < 0) {
    m.gradStep = 0;
  }
  if (m.gradStep > 50) {
    m.gradStep = 50;
  }
  if (engine.starMin < 0) {
    engine.starMin = 0;
  }
  if (engine.starMin > 255) {
    engine.starMin = 255;
  }
  blur(m);
}

/** S1 (43db): comet, explosion, warp and the white flash, 50 s on the scene clock. */
function* warp(m, scene) {
  const engine = m.engine;
  m.setPalette(scene.palF);
  const sceneStart = mark(m);
  let fade = null;
  let isFlashFading = false;
  let isCleared = false;
  let el;
  do {
    el = elapsed(m, sceneStart);
    moveAndDrawStars(scene.stars, scene.speed);
    if (el < EXPLOSION_TICKS) {
      cometAndExplosion(m, scene, el);
    } else {
      if (!fade) {
        fade = new StepFade(m, 0, 255, scene.palD, 100);
      }
      fade.step();
      engine.starMode = STAR_STREAKS;
      let tmp = el;
      if (isFlashFading) {
        if (!isCleared) {
          m.fillActive(0);
          isCleared = true;
          scene.speed = BASE_SPEED;
          m.gradStep = 5;
          engine.starMin = 60;
        }
        if (tmp > FLASH_END) {
          tmp = FLASH_END;
        }
        if (el <= FLASH_HOLD) {
          const o = int16(64 - roundHalfEven(((tmp - FLASH_END + 50) * 64) / 50));
          setPaletteOffset(m, scene.palD, 0, 255, o, o, o);
        }
        blurDecay(m, 1);
      } else if (el >= FLASH_START) {
        const o = int16(roundHalfEven(((el - FLASH_START) * 64) / 50));
        setPaletteOffset(m, scene.palD, 0, 255, o, o, o);
        if (el >= FLASH_PEAK) {
          isFlashFading = true;
        }
        blur(m);
      } else {
        warpRamp(m, scene, el);
      }
    }
    m.present();
    yield* frame(m, FRAME_SECONDS);
  } while (el < WARP_TICKS);
}

/** S2 (4941): the warp dims while the palette goes to the Jupiter one. */
function* dimWarp(m, scene) {
  const engine = m.engine;
  const sceneStart = mark(m);
  const fade = new StepFade(m, 0, 255, scene.palB, 50);
  m.setActivePage(DRAW_PAGE);
  engine.starMode = STAR_STREAKS;
  let el;
  do {
    el = elapsed(m, sceneStart);
    if (engine.starMin > 30) {
      engine.starMin -= 2;
    }
    if (engine.starMax > 150) {
      engine.starMax -= 2;
    }
    fade.step();
    moveAndDrawStars(scene.stars, scene.speed);
    blurDecay(m, 1);
    m.present();
    yield* frame(m, FRAME_SECONDS);
  } while (el <= DIM_TICKS);
}

/** The sphere over a copy of the star layer: z from -7800 to 200 on a parabola. */
function drawSphere(m, sphere, x, y, tmp, angle) {
  m.copyPage(STAR_LAYER_PAGE, DRAW_PAGE);
  m.setActivePage(DRAW_PAGE);
  sphere.moveTo(x, y, f32(200 - (tmp * tmp * 10) / 800));
  sphere.rotateWork(0, angle, 0);
  sphere.draw();
}

/** S3 (4a2f): Jupiter, then the Earth, fly at the camera over trailing stars. */
function* spheres(m, scene) {
  const { jupiter, earth } = scene;
  const sceneStart = mark(m);
  jupiter.translate(0, 0, -8000);
  jupiter.rotate(0, -20, 0);
  earth.translate(0, 0, -7900);
  m.setActivePage(STAR_LAYER_PAGE);
  m.copyPage(DRAW_PAGE, STAR_LAYER_PAGE);
  let isEarthPalette = false;
  let el;
  do {
    el = elapsed(m, sceneStart);
    m.setActivePage(STAR_LAYER_PAGE);
    moveAndDrawStars(scene.stars, scene.speed);
    blurDecay(m, 1);
    if (el < SPHERE1_TICKS) {
      const angle = f32((el * 360) / 800 - 10);
      drawSphere(m, jupiter, f32((el * -70) / 800), f32((el * 50) / 800), SPHERE1_TICKS - el, angle);
    } else if (el > SPHERE2_START && el < SPHERE2_END) {
      if (!isEarthPalette) {
        m.setPalette(scene.palC);
        isEarthPalette = true;
      }
      const t = el - SPHERE2_START;
      const tmp = Math.max(SPHERE2_END - el, 0);
      const angle = f32((t * 360) / 800 - 140);
      drawSphere(m, earth, f32((t * 100) / 800), f32((t * -30) / 800), tmp, angle);
    }
    m.present();
    yield* frame(m, FRAME_SECONDS);
  } while (el < SPHERE2_END);
}

/** S4 (4d9f): the bright warp again, until the part clock reaches 88 s. */
function* brightWarp(m, scene, partStart) {
  const engine = m.engine;
  const fade = new StepFade(m, 0, 255, scene.palA, 50);
  m.setActivePage(DRAW_PAGE);
  engine.starMode = STAR_STREAKS;
  do {
    if (engine.starMin < 200) {
      engine.starMin += 2;
    }
    if (engine.starMax < 255) {
      engine.starMax += 2;
    }
    if (m.gradStep < 10) {
      m.gradStep++;
    }
    fade.step();
    moveAndDrawStars(scene.stars, scene.speed);
    blur(m);
    m.present();
    yield* frame(m, FRAME_SECONDS);
  } while (elapsed(m, partStart) < PART_TICKS);
}

export function* spacePart(m) {
  m.setMode(0);
  const partStart = partInit(m);
  const scene = setUp(m);
  yield* starsFadeIn(m, scene, partStart);
  yield* warp(m, scene);
  yield* dimWarp(m, scene);
  yield* spheres(m, scene);
  yield* brightWarp(m, scene, partStart);
  m.freePage(STAR_LAYER_PAGE);
  m.freePage(EARTH_PAGE);
  m.freePage(JUPITER_PAGE);
  yield* cloudTunnel(m, scene.stars);
}

// ---- 0000:3921 the cloud tunnel ----

/** The tables of 3921: radius per (texel, depth), the angle per column, twist*depth. */
function buildTunnelTables() {
  return {
    radius: new Uint8Array(256 * TUNNEL_DEPTHS),
    angle: Uint16Array.from({ length: 321 }, (_, k) => Math.trunc((k * 9) / 8)),
    twist: new Uint16Array(TUNNEL_DEPTHS * TUNNEL_DEPTHS),
  };
}

function fillTunnelTablesFor(tables, j) {
  for (let i = 0; i < TUNNEL_DEPTHS; i++) {
    tables.twist[i * TUNNEL_DEPTHS + j] = (i * j) & 0xffff;
  }
  for (let k = 0; k <= 255; k++) {
    tables.radius[k * TUNNEL_DEPTHS + j] = roundHalfEven(((220 - k / 5) * 20) / (j + 20)) & 0xff;
  }
}

/** 0000:37c3: 60 rings of 320 blocks, far first; each texel of the cloud picture gives a radius and a shade. */
function drawTunnel(m, state, tables) {
  const tex = m.getPage(CLOUD_PAGE);
  const dst = m.getPage(DRAW_PAGE);
  const { xs, ys, fade, twist } = state;
  for (let r = TUNNEL_RINGS; r >= 1; r--) {
    let row = ys + r;
    if (row >= 200) {
      row -= 200;
    }
    const rowOfs = (row * 320) & 0xffff;
    for (let c = 320; c >= 1; c--) {
      let col = xs + c;
      if (col >= 320) {
        col -= 320;
      }
      const t = tex[(rowOfs + col) & 0xffff];
      let v = int16(tables.radius[t * TUNNEL_DEPTHS + r] - fade);
      if (!(v > 0)) {
        v = 0;
      }
      let color = (((60 - r) * t) & 0xffff) >> 5;
      if (color >= 240) {
        color = 240;
      }
      let a = (tables.twist[twist * TUNNEL_DEPTHS + r] >> 4) - c;
      if (!(a > 0)) {
        a += 320;
      }
      const angle = tables.angle[a];
      const x = (int16(Math.imul(cosTableInt(angle), v)) >> 7) + 160;
      const y = (int16(Math.imul(sinTableInt(angle), v)) >> 7) + 100;
      if (x < 0 || x > 309 || y < 0 || y > 192) {
        continue;
      }
      drawTunnelBlock(dst, y * 320 + x, color, state.eaxHigh);
      state.eaxHigh = color * 0x101;
    }
  }
}

/** One 10x8 block: shrd leaves EAX's old high word in bytes 0-1, 4-5 and 8-9 of every row. */
function drawTunnelBlock(dst, p, color, eaxHigh) {
  const lo = eaxHigh & 0xff;
  const hi = eaxHigh >> 8;
  for (let k = 0; k < 8; k++, p += 320) {
    dst[p] = lo;
    dst[p + 1] = hi;
    dst[p + 2] = color;
    dst[p + 3] = color;
    dst[p + 4] = lo;
    dst[p + 5] = hi;
    dst[p + 6] = color;
    dst[p + 7] = color;
    dst[p + 8] = lo;
    dst[p + 9] = hi;
  }
}

function blackFrame(m, inset) {
  fillRect(m, 0, 200 - inset, 319, 199, 0);
  fillRect(m, 0, 0, 319, 2 * inset, 0);
  fillRect(m, 320 - 2 * inset, 0, 319, 199, 0);
  fillRect(m, 0, 0, inset, 199, 0);
}

/** The per-frame motion: scroll down, rotate faster and faster, twist. */
function advanceTunnel(state, el) {
  state.ys += 2;
  for (const threshold of [600, 900, 1200, 1500]) {
    if (el > threshold) {
      state.xs++;
    }
  }
  if (state.xs > 320) {
    state.xs -= 320;
  }
  if (state.xs < 0) {
    state.xs += 320;
  }
  if (state.ys > 200) {
    state.ys -= 200;
  }
  if (state.ys < 0) {
    state.ys += 200;
  }
  if (el > 1400 && state.twist < MAX_TWIST) {
    state.twist += 4;
  }
}

/** 0000:3921 */
function* cloudTunnel(m, stars) {
  const partStart = partInit(m);
  const savedPalette = m.palette.slice();
  loadPicture(m, CLOUD_PAGE, 0x20);
  m.setPalette(savedPalette);
  m.setActivePage(DRAW_PAGE);
  const tables = buildTunnelTables();
  for (let j = 0; j < TUNNEL_PRECOMPUTE_FRAMES; j++) {
    fillTunnelTablesFor(tables, j);
    moveAndDrawStars(stars, BASE_SPEED);
    blur(m);
    m.present();
    yield* frame(m, FRAME_SECONDS);
  }
  const state = { xs: 0, ys: 0, fade: 210, twist: 0, eaxHigh: 0 };
  const t0 = elapsed(m, partStart);
  let el;
  do {
    el = elapsed(m, partStart);
    moveAndDrawStars(stars, BASE_SPEED);
    blur(m);
    let inset = roundHalfEven(((el - t0) * 10) / (BORDERS_TICKS - t0)) & 0xff;
    if (inset > 10) {
      inset = 10;
    }
    blackFrame(m, inset);
    m.present();
    yield* frame(m, FRAME_SECONDS);
  } while (el < BORDERS_TICKS);

  const sceneStart = mark(m);
  do {
    el = elapsed(m, sceneStart);
    m.setActivePage(DRAW_PAGE);
    if (state.fade < 50) {
      m.fillActive(0);
      state.eaxHigh = 0;
    }
    if (state.fade > 30) {
      moveAndDrawStars(stars, BASE_SPEED);
    }
    if (el <= TUNNEL_OPEN_TICKS) {
      const tmp = TUNNEL_OPEN_TICKS - el;
      state.fade = tmp > 0 ? int16(roundHalfEven((tmp * tmp * 0.42) / 500)) : 0;
      if (state.fade < 0) {
        state.fade = 0;
      }
    }
    drawTunnel(m, state, tables);
    blur(m);
    blackFrame(m, 10);
    m.present();
    advanceTunnel(state, el);
    const isFading = el > TUNNEL_FADE_START;
    if (isFading) {
      m.setActivePage(CLOUD_PAGE);
      blurDecay(m, 2);
      state.fade = int16(state.fade - 1);
      addPalette(m, 0, 255, -1, -1, -1);
    }
    yield* frame(m, isFading ? TUNNEL_FADING_FRAME_SECONDS : TUNNEL_FRAME_SECONDS);
  } while (elapsed(m, partStart) <= TUNNEL_PART_TICKS);
  m.getPage(0).fill(0, 0, 64000);
  m.gradStep = 1;
  m.engine.starMode = STAR_PLUS;
  m.freePage(CLOUD_PAGE);
  m.freePage(DRAW_PAGE);
}
