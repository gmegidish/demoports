// The "glod" credit engine shared by intro parts 2, 4 and 6: a picture burns away along a threshold
// map, the burning edge breathes smoke that a flow map (gl_smoke.dat) drifts and blurs, and a second
// picture flashes over it on a sync. Ports init 0x221e8, the burn loop 0x22604, the transitions
// glodzoom 0x224a4 and glodblack 0x225b0, the kernels 0x114bc..0x119e0 and the table 0x22180.
//
// The original keeps everything in one block of 0x6e200 bytes and its kernels read past the end of
// one buffer into the next; the port keeps that block and those offsets.

import { frame, entryFrame } from '../machine.js';
import { scale, blurWrap, buildBrightenTable, zoomBlit, shadeShifted } from '../gfx.js';

const WIDTH = 320;
const SCREEN_BYTES = 64000;
const PICTURE_HEADER = 0x300;
/** Rows 1..198: every glod kernel leaves rows 0 and 199 alone. */
const FIRST_PIXEL = WIDTH;
const END_PIXEL = 199 * WIDTH;
/** 0x114ff warps rows 0..198 only. */
const WARPED_PIXELS = 199 * WIDTH;

/** The 0x6e200 block of 0x221e8 and its six buffers ([0x1149c]..[0x114ac]). */
const BLOCK_BYTES = 0x6e200;
const BURN_MAP_AT = 0x00000;
const PICTURE_AT = 0x0fa00;
const SMOKE_AT = 0x1f400;
const WARPED_AT = 0x2ee00;
const FLOW_AT = 0x3e800;
const FLOW_BYTES = 0x20000;
const REVEAL_MAP_AT = 0x5e800;

/** gl_pat.raw: three 80x50 threshold maps, scaled to 320x200 and blurred four times. */
const PATTERN_WIDTH = 80;
const PATTERN_HEIGHT = 50;
const PATTERN_BYTES = PATTERN_WIDTH * PATTERN_HEIGHT;
const PATTERN_BLURS = 4;

/** gl_pal brighten table 0x22180: 32 levels towards white. */
const BRIGHTEN_LEVELS = 32;
const SHADE_TABLE_BYTES = 0x10000;

/** 0x114bc: T1 = min(i + 3, 21) feeds the smoke at the burning edge; T2 decays it. */
const SMOKE_FEED = 3;
const SMOKE_MAX = 21;
/** Edge ramps of 0x11540: threshold excess 1..12 picks one of gl_pal's fire ramps (16 colours). */
const EDGE_WIDTH = 12;
const BURNT_COLOURS = 0xd0;

/** Burn loop 0x22604: the threshold counts down 0x400 frames, then holds at 0 for 0x28 more. */
const BURN_FRAMES = 0x400;
const BURN_TAIL_FRAMES = 0x28;
/** Flash: picB at full strength for 16 frames + 5 per halving of its levels, gone at shift 5. */
const FLASH_HOLD_FRAMES = 16;
const FLASH_FRAMES_PER_SHIFT = 5;
const FLASH_LAST_SHIFT = 5;

/** glodzoom / glodblack: the reveal map (values < 256) is passed when 2e > it, after 128 frames. */
const REVEAL_FRAMES = 0x80;
/** glodzoom: from each edge inwards, 409/512 px across and 0.5 px down per frame. */
const ZOOM_X_STEP = 409;
const ZOOM_FRAME_SHIFT = 7;

/**
 * DOSBox's pace in the recording. The burn loop makes one smoke step per pass, so the smoke depends
 * on how many passes DOSBox (200000 cycles, MIDAS mixing in the timer interrupt) managed. Measured
 * in demo.avi by matching every pass against the recording, frame by frame:
 * - a normal pass waits for a tick and composites straight to the screen; passes show every 2
 *   frames, and every 3 once the music gets busier (`slowAfter` frames into the burn);
 * - it burns with the frame counter read `readLag[period]` frames before it shows;
 * - flash passes never wait: `flashFrames` apart, the first `flashLead` frames after the last
 *   normal one, and the normal passes resume 2 frames after the last flash.
 * `startAfter` is how long after the transition the loop starts (part 6 has none, see credits.js):
 * it reads the frame counter then, and its first pass shows `firstShow` frames later.
 */
export const PACES = {
  coding: { startAfter: 0, firstShow: 2, slowAfter: 252, readLag: { 2: 1, 3: 2 }, flashLead: 1, flashFrames: 2.86 },
  artwork: { startAfter: 2, firstShow: 2, slowAfter: 164, readLag: { 2: 0, 3: 1 }, flashLead: 0, flashFrames: 2.95 },
  music: { startAfter: 0, firstShow: 1, slowAfter: 237, readLag: { 2: 1, 3: 1 }, flashLead: 1, flashFrames: 3.02 },
};
const FAST_PERIOD = 2;
const SLOW_PERIOD = 3;
const SHOW_AFTER_FLASH = 2;
/** glodzoom's zoom takes more than a frame in DOSBox: it shows every second frame. */
const ZOOM_FRAMES_PER_PASS = 2;

/** 0x114bc buildBlurTables. */
function buildSmokeTables() {
  const feed = new Uint8Array(64);
  for (let i = 0; i < feed.length; i++) {
    feed[i] = Math.min(i + SMOKE_FEED, SMOKE_MAX);
  }
  const decay = new Uint8Array(256);
  for (let i = 0; i < decay.length; i++) {
    decay[i] = ((i & 3) ? i : Math.max(i - 1, 0)) >> 2;
  }
  return { feed, decay };
}

/** 0x1d1a0 + 4 x 0x11b5d: one 80x50 block of gl_pat.raw as a smooth 320x200 threshold map. */
function buildThresholdMap(pattern, block, dst) {
  scale(pattern.subarray(block * PATTERN_BYTES), PATTERN_WIDTH, PATTERN_HEIGHT, dst, WIDTH, 200);
  for (let pass = 0; pass < PATTERN_BLURS; pass++) {
    blurWrap(dst, dst, WIDTH, 200);
  }
}

/**
 * 0x221e8 init(picA, revealBlock, burnBlock, picB).
 * @returns the glod state: the block with its buffers, the tables and picB
 */
export function initGlod(demo, pictureName, revealBlock, burnBlock, flashName) {
  const memory = new Uint8Array(BLOCK_BYTES);
  memory.set(demo.archive.read('gl_smoke.dat').subarray(0, FLOW_BYTES), FLOW_AT);
  const pattern = demo.archive.read('gl_pat.raw');
  buildThresholdMap(pattern, revealBlock, memory.subarray(REVEAL_MAP_AT, REVEAL_MAP_AT + SCREEN_BYTES));
  buildThresholdMap(pattern, burnBlock, memory.subarray(BURN_MAP_AT, BURN_MAP_AT + SCREEN_BYTES));
  memory.set(demo.archive.read(pictureName).subarray(PICTURE_HEADER, PICTURE_HEADER + SCREEN_BYTES), PICTURE_AT);
  const palette = demo.archive.read('gl_pal.col').subarray(0, 768);
  const shade = new Uint8Array(SHADE_TABLE_BYTES);
  buildBrightenTable(BRIGHTEN_LEVELS, palette, shade);
  return {
    memory,
    flow: new Uint16Array(memory.buffer, FLOW_AT, FLOW_BYTES / 2),
    picture: memory.subarray(PICTURE_AT, PICTURE_AT + SCREEN_BYTES),
    revealMap: memory.subarray(REVEAL_MAP_AT, REVEAL_MAP_AT + SCREEN_BYTES),
    flashPicture: demo.archive.read(flashName).subarray(PICTURE_HEADER, PICTURE_HEADER + SCREEN_BYTES),
    palette,
    /** 0xfd0a0 as glod leaves it: rows 0..31 = the gl_pal brighten table. */
    shade,
    tables: buildSmokeTables(),
  };
}

/** 0x114ff warp: B[i] = A[flow[i]] for rows 0..198, the smoke follows the flow map. */
export function warpSmoke(glod) {
  const { memory, flow } = glod;
  for (let i = 0; i < WARPED_PIXELS; i++) {
    memory[WARPED_AT + i] = memory[SMOKE_AT + flow[i]];
  }
}

/**
 * 0x1178c diffuse: A[j + 2] = decay[2x2 sum of B at j], j = 0..63999. The sum wraps at 8 bits, the
 * last row reads past B into gl_smoke.dat and A[64000..64001] spill into B[0..1], as in the original.
 */
export function diffuseSmoke(glod) {
  const { memory } = glod;
  const decay = glod.tables.decay;
  for (let j = 0; j < SCREEN_BYTES; j++) {
    const b = WARPED_AT + j;
    memory[SMOKE_AT + j + 2] = decay[(memory[b] + memory[b + 1] + memory[b + WIDTH - 1] + memory[b + WIDTH]) & 0xff];
  }
}

/**
 * 0x11540 burn compositor into dst rows 1..198. t = T >> 2 (at least 0): pixels whose burn threshold
 * is above t burn, through 12 fire ramps (feeding smoke there) to black; the smoke above each pixel
 * brightens it through the gl_pal brighten table.
 */
export function burnPicture(glod, burnClock, dst) {
  const { memory, shade } = glod;
  const feed = glod.tables.feed;
  const t = Math.max(burnClock >> 2, 0);
  for (let i = FIRST_PIXEL; i < END_PIXEL; i++) {
    const excess = memory[BURN_MAP_AT + i] - t;
    let colour = memory[PICTURE_AT + i];
    const smoke = memory[SMOKE_AT + i + 2];
    if (excess > 0) {
      if (excess > EDGE_WIDTH) {
        colour = (colour >> 1) + BURNT_COLOURS;
      } else {
        memory[SMOKE_AT + i] = feed[memory[SMOKE_AT + i]];
        colour = (colour >> 1) + (((excess + 1) << 4) & 0xff);
      }
    }
    dst[i] = shade[(smoke << 8) | colour];
  }
}

/** 0x115ba reveal: rows 1..198 of the screen show `to` where 2e has passed the reveal map, else `from`. */
export function revealPicture(glod, elapsed, from, to, screen) {
  const map = glod.revealMap;
  const level = elapsed * 2;
  for (let i = FIRST_PIXEL; i < END_PIXEL; i++) {
    screen[i] = map[i] - level >= 0 ? from[i] : to[i];
  }
}

/** The flash shift of 0x22604: (dt - 16) / 5, C division, at least 0. */
function flashShift(sinceFlash) {
  return Math.max(Math.trunc((sinceFlash - FLASH_HOLD_FRAMES) / FLASH_FRAMES_PER_SHIFT), 0);
}

/** The pass after a normal one shown at `shown`: normal, or the first flash pass once it is due. */
function passAfterNormal(pace, startFrame, shown, flashFrame) {
  const period = shown - startFrame >= pace.slowAfter ? SLOW_PERIOD : FAST_PERIOD;
  const flashClock = shown + pace.flashLead;
  if (flashFrame !== null && Math.floor(flashClock) >= flashFrame) {
    return flashPass(pace, flashClock, Math.floor(flashClock));
  }
  return { isFlash: false, shows: shown + period, reads: shown + period - pace.readLag[period] };
}

/** A flash pass reading the frame counter at `clock` (fractional: it never waits). */
function flashPass(pace, clock, flashStart) {
  const done = clock + pace.flashFrames;
  return { isFlash: true, shows: Math.round(done), reads: Math.floor(clock), done, flashStart };
}

/**
 * 0x22604 burn loop: the picture burns for 0x400 + 0x28 frames from `startFrame` and picB flashes
 * when sync entry `flashEntry` passes. Every frame the port shows runs the passes due by then (see
 * PACES), so a seek replays them.
 */
export function* burnLoop(demo, glod, pace, flashEntry, startFrame) {
  const m = demo.machine;
  glod.memory.fill(0, SMOKE_AT, SMOKE_AT + 2 * SCREEN_BYTES);
  const endFrame = startFrame + BURN_FRAMES;
  let flashFrame = entryFrame(m, flashEntry);
  let pass = { isFlash: false, shows: startFrame + pace.firstShow, reads: startFrame };
  for (;;) {
    while (pass.shows <= frame(m)) {
      const burnClock = endFrame - pass.reads;
      warpSmoke(glod);
      diffuseSmoke(glod);
      if (!pass.isFlash) {
        burnPicture(glod, burnClock, m.front);
        if (burnClock < -BURN_TAIL_FRAMES) {
          return;
        }
        pass = passAfterNormal(pace, startFrame, pass.shows, flashFrame);
        continue;
      }
      const shift = flashShift(pass.reads - pass.flashStart);
      burnPicture(glod, burnClock, demo.offscreen);
      shadeShifted(glod.flashPicture, demo.offscreen, glod.shade, shift, 0);
      m.front.set(demo.offscreen.subarray(FIRST_PIXEL, END_PIXEL), FIRST_PIXEL);
      if (burnClock < -BURN_TAIL_FRAMES) {
        return;
      }
      if (shift >= FLASH_LAST_SHIFT) {
        flashFrame = null;
        const shows = Math.floor(pass.done) + SHOW_AFTER_FLASH;
        pass = { isFlash: false, shows, reads: shows - 1 };
      } else {
        pass = flashPass(pace, pass.done, pass.flashStart);
      }
    }
    yield;
  }
}

/**
 * The passes of glodzoom and glodblack: a pass reads the frame counter, waits for the retrace and
 * draws, so it shows from the next frame; passes come every `framesPerPass` frames from `startFrame`
 * until the one 128 frames in. After a seek the pass due now is drawn at once.
 * @returns the frame the last pass shows from
 */
function* revealPasses(demo, startFrame, framesPerPass, drawPass) {
  const m = demo.machine;
  const lastPass = startFrame + REVEAL_FRAMES;
  let passFrame = startFrame;
  for (;;) {
    while (frame(m) <= passFrame) {
      yield;
    }
    const behind = Math.max(frame(m) - 1 - passFrame, 0);
    passFrame = Math.min(passFrame + framesPerPass * Math.floor(behind / framesPerPass), lastPass);
    drawPass(passFrame - startFrame);
    if (passFrame === lastPass) {
      return lastPass + 1;
    }
    passFrame += framesPerPass;
  }
}

/**
 * 0x224a4 glodzoom: zoom into the picture part 1 left in the off-screen buffer (0.8 px across and
 * 0.5 px down per frame) while picA appears through the reveal map.
 */
export function glodZoom(demo, glod, startFrame) {
  const zoomed = new Uint8Array(SCREEN_BYTES);
  return revealPasses(demo, startFrame, ZOOM_FRAMES_PER_PASS, (elapsed) => {
    const d = elapsed << ZOOM_FRAME_SHIFT;
    const x0 = (d * ZOOM_X_STEP) >> 16;
    const x1 = ((319 << 16) - d * ZOOM_X_STEP) >> 16;
    const y0 = (d << 8) >> 16;
    const y1 = ((199 << 16) - (d << 8)) >> 16;
    zoomBlit(demo.offscreen, zoomed, x0, y0, x1, y1);
    revealPicture(glod, elapsed, zoomed, glod.picture, demo.machine.front);
  });
}

/**
 * 0x225b0 glodblack: picA appears through the reveal map over whatever the off-screen buffer holds
 * (black in the recording), one pass per retrace.
 */
export function glodBlack(demo, glod, startFrame) {
  return revealPasses(demo, startFrame, 1, (elapsed) => {
    revealPicture(glod, elapsed, demo.offscreen, glod.picture, demo.machine.front);
  });
}
