// Demo part 8: a sunset over water. A blurred sky, a pulsing sun glow, a scrolling strip of mountains,
// rocks drifting by at three depths, and water that reflects all of it through two scrolling copies of
// a wave displacement map. Ports init 0x106f5, run 0x286b4(5) with the bounce 0x2850c and the zoom
// out 0x285e8, the drawers 0x10946..0x10d58 and deinit 0x106e8. See docs/disassembly/P7_ball_sunset.md §3.

import { frame, syncAdvance, entryFrame } from '../machine.js';
import { scale, blurWrap, zoomBlit, zoomRectangle } from '../gfx.js';
import { sin } from '../sine.js';
import { createRandomBits } from '../random.js';

const WIDTH = 320;
const SCREEN_BYTES = 64000;
const HALF_SCREEN = 32000;
const HORIZON_ROW = 100;

/** su_sky2: 80x50, scaled to 320x100, blurred 8 times, mirrored below the horizon. */
const SKY_WIDTH = 80;
const SKY_HEIGHT = 50;
const SKY_BLURS = 8;
/** su_wave: 64x64 heights, 4x nearest to 256x256, halved, blurred 15 times. */
const WAVE_SIZE = 64;
const MAP_SIZE = 256;
const WAVE_BLURS = 15;
/** The displacement map steps to the right neighbour and two rows down. */
const WAVE_ROW_STEP = 2;

/** The sun: 64x58 glow at (194, 41); rows 0..18 straight to the screen, the rest under the mountains. */
const SUN_X = 194;
const SUN_Y = 41;
const SUN_SIZE = 64;
const SUN_ROWS = 58;
const SUN_SCREEN_ROWS = 19;
const STAR_BYTES = SUN_SIZE * SUN_SIZE;
const GLOW_MAX = 127;
/** Mountains: 40 rows of a 256-wide mask from row 60, mirrored into rows 100..139 of the reflection. */
const MOUNTAIN_ROW = 60;
const MOUNTAIN_ROWS = 40;
const MOUNTAIN_MIRROR_ROW = 139;
const MOUNTAIN_SCROLL_START = 64;

/** Rocks: 4 sprites 64x32 side by side in su_rock1, bottom edge at y, x in 22.10 fixed point. */
const ROCKS = 4;
const ROCK_WIDTH = 64;
const ROCK_HEIGHT = 32;
const ROCK_SHEET_WIDTH = 256;
const ROCK_FIRST_Y = 130;
const ROCK_Y_STEP = 7;
const ROCK_Y_RANGE = 38;
const FIXED_SHIFT = 10;
const ROCK_SPEED_NUMERATOR = 0x14a00;
const ROCK_SPEED_HORIZON = 210;
const ROCK_ENTER_X = 0x4fc00;
const ROCK_LEAVE_X = -0xfc00;
const ROCK_CLIP_X = 256;
/**
 * [0x11c64] after 0x11c68: the timer accumulator when part 8 starts, 0x428f per tick. It is not
 * reproducible. 12759 * 0x428f puts the first rows of rocks where demo.avi shows them; the later
 * re-entries do not match (no seed of the form n * 0x428f, n < 10^6, matches them all).
 */
const ROCK_SEED = Math.imul(12759, 0x428f) >>> 0;
/**
 * On the first pass the elapsed count E is an uninitialised stack slot, so that pass moves the rocks
 * by garbage. In demo.avi every rock enters from the right on a random row right after the part
 * starts: a large positive dt, which sends each rock through the re-entry of moveObj.
 */
const UNINITIALISED_DT = 0x10000;

/** water: 2.75 texels per tick (0x2c0 / 256); the horizon row samples 0x6e00 / 10 per pixel. */
const WATER_SPEED = 0x2c0;
const WATER_DEPTH = 0x6e00;
const WATER_FAR = 110;

/** 0x1d5dc: the palette fades in over 256 ticks from the part's first frame. */
const FADE_TICKS = 256;
/** 0x2850c: t = 6 per tick to 256 (43 ticks). 0x285e8: t = 3 per tick to 128 (43 ticks). */
const BOUNCE_SPEED = 6;
const BOUNCE_END = 256;
const BOUNCE_TICKS = Math.floor(BOUNCE_END / BOUNCE_SPEED) + 1;
const ZOOM_OUT_SPEED = 3;
const ZOOM_OUT_END = 128;
/**
 * Init 0x106f5 (blurring the wave map 15 times and the rest) took DOSBox about 0.7 s, with the
 * screen black, between the end of part 7 (its last sync entry) and the first frame of this part.
 * Fitted to where the sun, the mountains and the water stand in demo.avi.
 */
const INIT_TICKS = 53;
/** A part that starts more than this many ticks late is catching up after a seek. */
const LATE_TICKS = 4;

function signedByte(x) {
  return (x << 24) >> 24;
}

/** The working sky (0x106cc) and right after it the pristine copy (0x106d0): water reads across. */
function buildSky(file) {
  const skies = new Uint8Array(2 * SCREEN_BYTES);
  const sky = skies.subarray(0, SCREEN_BYTES);
  const top = sky.subarray(0, HALF_SCREEN);
  scale(file, SKY_WIDTH, SKY_HEIGHT, top, WIDTH, HORIZON_ROW);
  for (let k = 0; k < SKY_BLURS; k++) {
    blurWrap(top, top, WIDTH, HORIZON_ROW);
  }
  for (let r = 0; r < HORIZON_ROW; r++) {
    sky.copyWithin((199 - r) * WIDTH, r * WIDTH, (r + 1) * WIDTH);
  }
  skies.copyWithin(SCREEN_BYTES, 0, SCREEN_BYTES);
  return skies;
}

/** The wave displacement map: dx + 320*dy, each half the byte difference to a neighbour. */
function buildDisplacement(file) {
  const heights = new Uint8Array(MAP_SIZE * MAP_SIZE);
  for (let c = 0; c < heights.length; c++) {
    heights[c] = file[((c >> 8) >> 2) * WAVE_SIZE + ((c & 0xff) >> 2)] >> 1;
  }
  for (let k = 0; k < WAVE_BLURS; k++) {
    blurWrap(heights, heights, MAP_SIZE, MAP_SIZE);
  }
  const displacement = new Int32Array(MAP_SIZE * MAP_SIZE);
  for (let c = 0; c < displacement.length; c++) {
    const y = c >> 8;
    const x = c & 0xff;
    const dx = signedByte(heights[c] - heights[(y << 8) | ((x + 1) & 0xff)]) >> 1;
    const dy = signedByte(heights[c] - heights[(((y + WAVE_ROW_STEP) & 0xff) << 8) | x]) >> 1;
    displacement[c] = dx + dy * WIDTH;
  }
  return displacement;
}

/** su_star's glow, followed by the 64x64 patch of sky behind it. */
function buildStar(file, sky) {
  const star = new Uint8Array(2 * STAR_BYTES);
  star.set(file.subarray(0, STAR_BYTES));
  for (let r = 0; r < SUN_SIZE; r++) {
    const at = (SUN_Y + r) * WIDTH + SUN_X;
    star.set(sky.subarray(at, at + SUN_SIZE), STAR_BYTES + r * SUN_SIZE);
  }
  return star;
}

function readInt32s(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.byteLength >> 2 }, (_, k) => view.getInt32(k * 4, true));
}

function rockSpeed(y) {
  return Math.trunc(ROCK_SPEED_NUMERATOR / (ROCK_SPEED_HORIZON - y));
}

/** 0x10ca1 newObj. */
function createRock(randomBits, y, sprite) {
  return { y, sprite, speed: rockSpeed(y), x: randomBits(8) << FIXED_SHIFT };
}

/** 0x10cca moveObj: drift left; past x = -63 the rock comes back at x = 319 on a random row. */
function moveRock(rock, dt, randomBits) {
  rock.x -= dt * rock.speed;
  if (rock.x > ROCK_ENTER_X) {
    rock.x = ROCK_ENTER_X;
  }
  if (rock.x < ROCK_LEAVE_X) {
    rock.x = ROCK_ENTER_X;
    let r = randomBits(6);
    if (r > ROCK_Y_RANGE) {
      r -= ROCK_Y_RANGE;
    }
    rock.y = ROCK_FIRST_Y + r;
    rock.speed = rockSpeed(rock.y);
  }
}

/** The clip both rock drawers share: screen x, first sprite column, width. */
function clipRock(rock) {
  let x = rock.x >> FIXED_SHIFT;
  let from = 0;
  let width = ROCK_WIDTH;
  if (x < 0) {
    from = -x;
    width += x;
    x = 0;
  }
  if (x >= ROCK_CLIP_X) {
    width -= x - ROCK_CLIP_X;
  }
  return { x, from, width };
}

/** 0x109d9 rockReflect: upside down into the working sky, masked against the pristine one. */
function reflectRock(state, rock) {
  const { x, from, width } = clipRock(rock);
  for (let c = 0; c < ROCK_HEIGHT; c++) {
    const d = (rock.y + ROCK_HEIGHT - 1 - c) * WIDTH + x;
    const s = rock.sprite + c * ROCK_SHEET_WIDTH + from;
    for (let i = 0; i < width; i++) {
      state.sky[d + i] = state.rock[s + i] & state.pristine[d + i];
    }
  }
}

/** 0x10a72 rockDraw: upright, ANDed into the water image above row y. */
function drawRock(state, target, rock) {
  const { x, from, width } = clipRock(rock);
  for (let c = 0; c < ROCK_HEIGHT; c++) {
    const d = (rock.y - ROCK_HEIGHT + c) * WIDTH + x;
    const s = rock.sprite + c * ROCK_SHEET_WIDTH + from;
    for (let i = 0; i < width; i++) {
      target[d + i] &= state.rock[s + i];
    }
  }
}

/**
 * 0x10af9 water(T): rows 100..199 of `target`. Each row samples the reflection at its own position
 * plus two displacements (the second wave copy scrolls at half speed). Bottom rows may read into the
 * pristine sky that follows the working one.
 */
function drawWater(state, target, t) {
  const { skies, displacement } = state;
  const slow = (Math.imul(t, 128) >>> 16) & 0xff;
  let p = 0;
  for (let r = HORIZON_ROW; r >= 1; r--) {
    const q = Math.trunc(WATER_DEPTH / (WATER_FAR - r));
    const waveRow = ((q - 256) & 0xff) << 8;
    let u = t - q * 160;
    for (let i = 0; i < WIDTH; i++, p++, u += q) {
      const column = (u >> 8) & 0xff;
      const o = p + HALF_SCREEN + displacement[waveRow | column] + displacement[waveRow | ((column - slow) & 0xff)];
      target[HALF_SCREEN + p] = skies[o];
    }
  }
}

/** 0x10d58 sun(idx): glow (dimmed by su_brigh[idx]) over the sky patch, saturating at 255. */
function drawSun(state, screen, index) {
  const dim = GLOW_MAX - state.brightness[index & 0xff];
  for (let k = 0; k < SUN_ROWS; k++) {
    const target = k < SUN_SCREEN_ROWS ? screen : state.pristine;
    const d = (SUN_Y + k) * WIDTH + SUN_X;
    for (let i = 0; i < SUN_SIZE; i++) {
      const glow = Math.max(state.star[k * SUN_SIZE + i] - dim, 0);
      target[d + i] = Math.min(glow + state.star[STAR_BYTES + k * SUN_SIZE + i], 255);
    }
  }
}

/** 0x10946 mountains(sc): mask over the (sun-lit) pristine sky, to the screen and both reflections. */
function drawMountains(state, screen, scroll) {
  for (let k = 0; k < MOUNTAIN_ROWS; k++) {
    const row = (MOUNTAIN_ROW + k) * WIDTH;
    const mirror = (MOUNTAIN_MIRROR_ROW - k) * WIDTH;
    for (let i = 0; i < WIDTH; i++) {
      const b = state.mountains[k * MAP_SIZE + ((scroll + i) & 0xff)] & state.pristine[row + i];
      screen[row + i] = b;
      state.sky[row + i] = b;
      state.sky[mirror + i] = b;
    }
  }
}

/** 0x10c4d present: the water to the screen; the reflection loses this frame's rocks and mountains. */
function present(state, screen, image) {
  screen.set(image.subarray(HALF_SCREEN, SCREEN_BYTES), HALF_SCREEN);
  state.sky.set(state.pristine.subarray(HALF_SCREEN, SCREEN_BYTES), HALF_SCREEN);
}

/** 0x1d5dc fade: DAC = palette * e / 256. */
function fade(machine, palette, e) {
  for (let i = 0; i < palette.length; i++) {
    machine.dac[i] = (palette[i] * e) >> 8;
  }
}

/** 0x2850c Bounce: the screen zooms in to x2 and back, a tick per frame. */
function* bounce(demo) {
  const m = demo.machine;
  const picture = demo.offscreen;
  picture.set(m.front);
  const startFrame = frame(m);
  let t = 0;
  do {
    const a = sin(t) >> 2;
    yield;
    zoomBlit(picture, m.front, ...zoomRectangle(a));
    t = (frame(m) - startFrame) * BOUNCE_SPEED;
  } while (t <= BOUNCE_END);
  m.front.set(picture);
}

/** 0x285e8 ZoomOut: the screen zooms into its centre pixel; the last frame stays. */
function* zoomOut(demo) {
  const m = demo.machine;
  const picture = demo.offscreen;
  picture.set(m.front);
  const startFrame = frame(m);
  let t = 0;
  do {
    const a = t;
    yield;
    zoomBlit(picture, m.front, ...zoomRectangle(a));
    t = (frame(m) - startFrame) * ZOOM_OUT_SPEED;
  } while (t <= ZOOM_OUT_END);
  picture.fill(0);
}

/**
 * After a seek: [base] as the bounces that already happened (entries first+1 .. last-1) left it.
 */
function baseAfterBounces(machine, partStart, firstSync, lastSync) {
  let base = partStart;
  for (let entry = firstSync + 1; entry < lastSync; entry++) {
    if (entryFrame(machine, entry) < frame(machine)) {
      base += BOUNCE_TICKS;
    }
  }
  return base;
}

/**
 * The original passes once per tick, so dt is 1 but for the first pass; stepping a tick at a time
 * keeps the rocks' re-entries (and their random rows) the same when the port's steps are longer.
 */
function moveRocks(rocks, dt, randomBits) {
  for (let k = 0; k < dt; k++) {
    for (const rock of rocks) {
      moveRock(rock, 1, randomBits);
    }
  }
}

export const sunset = {
  /** 0x106f5: everything is precomputed here. */
  init(demo) {
    const read = (name) => demo.archive.read(name);
    const skies = buildSky(read('su_sky2.raw'));
    const sky = skies.subarray(0, SCREEN_BYTES);
    return {
      palette: read('su_pal.col'),
      mountains: read('su_moun2.raw'),
      rock: read('su_rock1.raw'),
      brightness: readInt32s(read('su_brigh.dat')),
      skies,
      sky,
      pristine: skies.subarray(SCREEN_BYTES),
      displacement: buildDisplacement(read('su_wave.raw')),
      star: buildStar(read('su_star.raw'), sky),
    };
  },

  /** 0x286b4(start): from the end of init until entry start+3 has passed, then the zoom out. */
  *run(demo, state, start) {
    const m = demo.machine;
    const image = demo.offscreen;
    const lastSync = start + 3;
    // Part 7's last entry (start - 1) ended it; init took INIT_TICKS more.
    const partStart = entryFrame(m, start - 1) + INIT_TICKS;
    while (frame(m) < partStart) {
      yield;
    }
    m.front.fill(0);
    const randomBits = createRandomBits(ROCK_SEED);
    const rocks = Array.from({ length: ROCKS }, (_, k) => createRock(randomBits, ROCK_FIRST_Y + ROCK_Y_STEP * k, ROCK_WIDTH * k));
    m.dac.fill(0);
    m.front.set(state.sky.subarray(0, HALF_SCREEN));
    let current = syncAdvance(m);
    let previous = current;
    let base = partStart;
    let elapsed = 0;
    let isLate = frame(m) - partStart > LATE_TICKS;
    let isFadedIn = false;
    let isFirstPass = true;
    while (current <= lastSync) {
      const scroll = (elapsed >> 2) + MOUNTAIN_SCROLL_START;
      if (isLate || demo.isSeeking) {
        base = baseAfterBounces(m, partStart, start, lastSync);
        current = syncAdvance(m);
        previous = current;
        isLate = false;
      }
      if (current !== previous) {
        const bounceStart = frame(m);
        yield* bounce(demo);
        base += frame(m) - bounceStart;
      }
      previous = current;
      current = syncAdvance(m);
      const dt = frame(m) - elapsed - base;
      elapsed = frame(m) - base;
      if (isFirstPass) {
        for (const rock of rocks) {
          moveRock(rock, UNINITIALISED_DT, randomBits);
        }
        isFirstPass = false;
      }
      moveRocks(rocks, dt, randomBits);
      for (const rock of rocks) {
        reflectRock(state, rock);
      }
      drawWater(state, image, elapsed * WATER_SPEED);
      drawSun(state, m.front, scroll & 0xff);
      for (const rock of rocks) {
        drawRock(state, image, rock);
      }
      if (!isFadedIn) {
        fade(m, state.palette, Math.min(elapsed, FADE_TICKS));
        isFadedIn = elapsed >= FADE_TICKS;
      }
      yield;
      present(state, m.front, image);
      drawMountains(state, m.front, scroll);
    }
    yield* zoomOut(demo);
  },
};
