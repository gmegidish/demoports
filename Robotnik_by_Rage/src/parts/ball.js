// Demo part 7: a textured ball (la_ball) with eyes and a mouth swings and spins in front of a blurred
// background (la_pic); light rays fan out from a centre point, lit ones (whose sphere point lies in
// a hole of the turned texture) carry on to the edge of the screen, and everything glows through a
// decaying feedback buffer. Ports init 0x1fffc (with the maps of 0x1fd38, which the original builds
// during the "waiting for robotnik" screen), run 0x20480(0) with the intro zoom 0x203ac and the
// fly-away 0x28038, and deinit 0x20398. See docs/disassembly/P7_ball_sunset.md §2.

import {
  frame, frameRow, ticks, syncAdvance, resyncFrame, entryFrame, entryTime, setDac, TICKS_PER_SECOND,
} from '../machine.js';
import { scale, blurWrap, zoomBlit, zoomRectangle } from '../gfx.js';
import { sin as isin, cos as icos } from '../sine.js';
import { roundHalfEven } from '../fpu.js';
import { buildBallMaps } from './ballmaps.js';
import {
  WIDTH, FRAME_ORIGIN, BLOCK_BYTES, createBlock, buildGlowTables, idiv, drawBall, drawRaysInner,
  drawRaysOuter, feedBack, composite,
} from './balldraw.js';
import { flyAway } from './flyaway.js';

const PALETTE_BYTES = 0x300;
const TEXTURE_BYTES = 0x10000;
const TEXTURE_ROW = 256;
const PICTURE_WIDTH = 160;
const PICTURE_HEIGHT = 100;
const HEIGHT = 200;

/** [0x820d4]: rays in the table; srand(1) with Watcom's rand picks their sphere points. */
const RAY_COUNT = 700;
const RANDOM_SEED = 1;
/** Sphere point table: 256 latitudes x 256 longitudes, radius 468/256, eye at 768, focal 384. */
const SPHERE_DIVISOR = 468;
const SPHERE_ROW_SCALE = 334;
const EYE_DISTANCE = 768;
const FOCAL = 384;
const SCREEN_CENTRE_X = 160;
const SCREEN_CENTRE_Y = 100;
/** The first picture shows the ball turned by 0xc0 (rotU = (0 >> 8) - 64). */
const FIRST_ROT_U = 0xc0;
const ROT_U_OFFSET = 64;

/** 0x203ac: t = 10 per tick from 0 to 768, so 77 ticks. */
const ZOOM_SPEED = 10;
const ZOOM_END = 768;
const ZOOM_TICKS = Math.floor(ZOOM_END / ZOOM_SPEED) + 1;

/** The truncated pi of 0x8db3c; b starts at 3 pi. */
const PI = 3.14159265;
const ANGLE_PER_TICK = 0.016;
const START_ANGLE = Math.fround(3 * PI);
/** Phase 1: the centre swings by 32 x 24 px; 20 more rays per song row. */
const CENTRE_SWING_X = 32;
const CENTRE_SWING_Y = 24;
const RAYS_PER_ROW = 20;
/** Phase 2: the ball swings by 24 x 16 px and spins 75/256 and 31/256 texel per tick. */
const SWING_X = 24;
const SWING_Y = 32;
const SPIN_U = 75;
const SPIN_V = 31;
/** Phase 3: 4 rays fewer per tick. */
const RAYS_DYING_PER_TICK = 4;

/** FlyAway(start + 4, 0, 0, 30, 15, 32, 0). */
const FLY_VELOCITY = [0, 0, 30];
const FLY_SPIN = [15, 32, 0];

/**
 * The run loop never waits for a tick: DOSBox (200000 cycles) finished a pass every 1.45 ticks with
 * no rays and every 2.33 ticks with all 700 (measured in demo.avi: 28..30 distinct frames a second
 * with every ray, 46..52 once they have died out). The glow trails depend on that rate.
 */
const PASS_TICKS = 1.45;
const PASS_TICKS_PER_RAY = 0.00126;
/** After a seek, the last pass is taken to be this many ticks ago. */
const SEEK_PASS_TICKS = 2;
/** A stage that starts more than this many ticks after it should have is catching up after a seek. */
const LATE_TICKS = 4;

/** Watcom rand(): s = s * 1103515245 + 12345, returns bits 16..30. */
function createRandom(seed) {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) | 0;
    return (s >>> 16) & 0x7fff;
  };
}

/** 0x1fffc: projected sphere points {sx, sy} by (v << 8 | u); (-1, -1) on the back. */
function buildSpherePoints() {
  const points = new Int32Array(256 * 256 * 2);
  for (let p = -128; p < 128; p++) {
    const c = icos(p);
    const ys = idiv(isin(p) << 8, SPHERE_DIVISOR) * SPHERE_ROW_SCALE;
    for (let a = -256; a < 256; a += 2) {
      const k = ((p + 128) * 256 + (a + 256) / 2) * 2;
      const x = idiv(icos(a) * c, SPHERE_DIVISOR);
      const z = idiv(-c * isin(a), SPHERE_DIVISOR);
      if (z > 0) {
        points[k] = -1;
        points[k + 1] = -1;
      } else {
        points[k] = idiv(x * FOCAL, z + EYE_DISTANCE) + SCREEN_CENTRE_X;
        points[k + 1] = idiv(ys, z + EYE_DISTANCE) + SCREEN_CENTRE_Y;
      }
    }
  }
  return points;
}

/** u in 128..255 (the front half), v triangular around 128. */
function buildRays() {
  const random = createRandom(RANDOM_SEED);
  const rays = [];
  for (let k = 0; k < RAY_COUNT; k++) {
    const u = (random() & 0x7f) + 0x80;
    const r1 = random();
    const r2 = random();
    rays.push({ u, v: ((r1 & 0xff) + (r2 & 0xff)) >> 1, isLit: true });
  }
  return rays;
}

/** la_pic halved, doubled to 320x200 and blurred once: values 0..15. */
function buildBackground(picture) {
  const halved = picture.map((b) => b >> 1);
  const background = new Uint8Array(WIDTH * HEIGHT);
  scale(halved, PICTURE_WIDTH, PICTURE_HEIGHT, background, WIDTH, HEIGHT);
  blurWrap(background, background, WIDTH, HEIGHT);
  return background;
}

/** la_ball's 256x256 texture, first row cleared, 0 = hole, everything else 2..9. */
function buildTexture(file) {
  const texture = file.slice(PALETTE_BYTES, PALETTE_BYTES + TEXTURE_BYTES);
  texture.fill(0, 0, TEXTURE_ROW);
  return texture.map((b) => (b === 0 ? 0 : Math.max(b >> 2, 2)));
}

function* waitForEntry(machine, entry) {
  while (syncAdvance(machine) <= entry) {
    yield;
  }
}

/** 0x203ac IntroZoom: the first picture bounces in from its centre pixel, a tick per frame. */
function* introZoom(demo, picture, startFrame) {
  const m = demo.machine;
  let t = 0;
  do {
    const a = idiv((ZOOM_END - t) * ((isin(t + 128) + 256) >> 2), ZOOM_END);
    yield;
    zoomBlit(picture, m.front, ...zoomRectangle(a));
    t = (frame(m) - startFrame) * ZOOM_SPEED;
  } while (t <= ZOOM_END);
}

function swingCentre(loop) {
  return {
    x: SCREEN_CENTRE_X + roundHalfEven(Math.fround(CENTRE_SWING_X * Math.sin(loop.a))),
    y: SCREEN_CENTRE_Y + roundHalfEven(Math.fround(Math.fround(CENTRE_SWING_Y * Math.sin(loop.a)) * Math.cos(loop.a))),
  };
}

function swingBall(loop) {
  const h = Math.fround(loop.b * 0.5);
  const c = Math.fround(Math.cos(h));
  loop.xo = roundHalfEven(Math.fround(c * SWING_X));
  loop.yo = roundHalfEven(Math.fround(Math.fround(SWING_Y * c) * Math.fround(Math.sin(h))));
}

/** Phase 2 integrates per pass: b by 0.016 per tick, the spin by 75 and 31 per tick. */
function advanceSpin(loop, dt) {
  loop.b = Math.fround(loop.b + Math.fround(dt * ANGLE_PER_TICK));
  swingBall(loop);
  loop.accU += dt * SPIN_U;
  loop.accV += dt * SPIN_V;
}

/**
 * After a seek: the loop variables as passes every SEEK_PASS_TICKS would have left them. Phase 1
 * froze the centre at its last pass before entry start+1; phase 2 has spun since then; phase 3 has
 * taken 4 rays per tick since entry start+2.
 */
function catchUp(state, loop, startFrame, start) {
  const m = state.machine;
  const index = syncAdvance(m);
  loop.prevElapsed = Math.max(frame(m) - startFrame - SEEK_PASS_TICKS, 0);
  if (index <= start + 1) {
    loop.a = Math.fround(Math.max(loop.prevElapsed - SEEK_PASS_TICKS, 0) * ANGLE_PER_TICK);
    return;
  }
  const lastSwing = Math.max(entryFrame(m, start + 1) - startFrame - SEEK_PASS_TICKS, 0);
  Object.assign(loop, { b: START_ANGLE, accU: 0, accV: 0 });
  loop.a = Math.fround(Math.max(lastSwing - SEEK_PASS_TICKS, 0) * ANGLE_PER_TICK);
  state.centre = swingCentre(loop);
  state.rayCount = RAY_COUNT;
  advanceSpin(loop, loop.prevElapsed - lastSwing);
  if (index > start + 2) {
    const dying = loop.prevElapsed - (entryFrame(m, start + 2) - startFrame);
    state.rayCount = Math.max(RAY_COUNT - dying * RAYS_DYING_PER_TICK, 0);
  }
}

/** One pass of the 0x20480 loop: draw with the current values, then step them. */
function pass(state, loop, index, start, elapsed, startRow) {
  const m = state.machine;
  const dt = elapsed - loop.prevElapsed;
  loop.prevElapsed = elapsed;
  const rotU = (loop.accU >> 8) - ROT_U_OFFSET;
  const rotV = loop.accV >> 8;
  drawRaysInner(state, rotU, rotV, loop.xo, loop.yo);
  drawBall(state.frame, state.maps, state.texture, rotU & 0xff, rotV & 0xff, loop.yo * WIDTH + loop.xo);
  drawRaysOuter(state, loop.xo, loop.yo);
  feedBack(state.frame, state.glowBlock, state.glow.decay);
  composite(m.front, 0, state.glowBlock, state.background, state.glow.average);
  if (index > start + 1) {
    advanceSpin(loop, dt);
  } else {
    state.centre = swingCentre(loop);
    state.rayCount = Math.min((frameRow(m) - startRow) * RAYS_PER_ROW, RAY_COUNT);
  }
  loop.a = Math.fround(elapsed * ANGLE_PER_TICK);
  if (index > start + 2) {
    state.rayCount = Math.max(state.rayCount - dt * RAYS_DYING_PER_TICK, 0);
  }
}

/**
 * The loop of 0x20480 from the resync after the zoom until entry start+3 has passed. Phase 1 (until
 * entry start+1): the centre swings, rays grow. Phase 2: the centre freezes, the ball swings and
 * spins. Phase 3 (from entry start+2): the rays die out.
 */
function* rays(demo, state, start, startFrame) {
  const m = demo.machine;
  const startRow = Math.floor((startFrame * 5) / 49);
  const loop = { prevElapsed: 0, a: 0, b: START_ANGLE, accU: 0, accV: 0, xo: 0, yo: 0 };
  if (syncAdvance(m) > start + 3) {
    return;
  }
  if (frame(m) - startFrame > LATE_TICKS) {
    catchUp(state, loop, startFrame, start);
  }
  let due = ticks(m);
  for (;;) {
    const index = syncAdvance(m);
    pass(state, loop, index, start, frame(m) - startFrame, startRow);
    if (index > start + 3) {
      return;
    }
    due += PASS_TICKS + PASS_TICKS_PER_RAY * state.rayCount;
    do {
      yield;
    } while (ticks(m) < due);
    if (demo.isSeeking) {
      catchUp(state, loop, startFrame, start);
      due = ticks(m);
    }
  }
}

export const ball = {
  /** 0x1fd38 + 0x1fffc: the maps, tables, background and texture; la_pal on the DAC. */
  init(demo) {
    const m = demo.machine;
    m.front.fill(0);
    const state = {
      machine: m,
      maps: buildBallMaps(),
      spherePoints: buildSpherePoints(),
      rays: buildRays(),
      rayCount: 0,
      centre: { x: SCREEN_CENTRE_X, y: SCREEN_CENTRE_Y },
      background: buildBackground(demo.archive.read('la_pic.raw')),
      texture: buildTexture(demo.archive.read('la_ball.raw')),
      glow: buildGlowTables(),
      frame: createBlock(),
      glowBlock: createBlock(),
    };
    setDac(m, demo.archive.read('la_pal.col'));
    return state;
  },

  /** 0x20480(start): the first picture, the zoom at entry start, the rays, the fly-away. */
  *run(demo, state, start) {
    const m = demo.machine;
    state.rayCount = 0;
    drawBall(state.frame, state.maps, state.texture, FIRST_ROT_U, 0, 0);
    state.glowBlock.set(state.frame.subarray(0, BLOCK_BYTES));
    feedBack(state.frame, state.glowBlock, state.glow.decay);
    composite(state.frame, FRAME_ORIGIN, state.glowBlock, state.background, state.glow.average);
    yield* waitForEntry(m, start);
    const zoomStart = entryFrame(m, start);
    yield* introZoom(demo, state.frame.subarray(FRAME_ORIGIN), zoomStart);
    // 0x121d4 right after the zoom; after a seek, as of the tick the zoom ended.
    const zoomEndTick = Math.floor(entryTime(m, start) * TICKS_PER_SECOND) + ZOOM_TICKS;
    resyncFrame(m, (zoomEndTick + 0.5) / TICKS_PER_SECOND);
    const startFrame = frame(m) - Math.max(ticks(m) - zoomEndTick, 0);
    yield* rays(demo, state, start, startFrame);
    const lastEntryFrame = entryFrame(m, start + 3);
    const flyStart = frame(m) - lastEntryFrame > LATE_TICKS ? lastEntryFrame : frame(m);
    yield* flyAway(demo, start + 4, FLY_VELOCITY, FLY_SPIN, flyStart);
    m.front.fill(0);
  },
};
