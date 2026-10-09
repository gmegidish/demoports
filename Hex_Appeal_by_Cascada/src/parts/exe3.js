// exe3: cubes and stars, the Cascada fire logo, IFS fractals and 3D dot morphs (Hellraiser; logo by O'Hara).
// docs/disassembly/H3_ifs_morphs.md. The part does not set a video mode: it inherits exe2's unchained 256-colour
// mode and only writes CRTC 9 = 0x40 (320x400, two pages at 0x0000 and 0x7d00). The retrace callback shows the
// page flag's page and advances all the motion; the main loop flips the flag, waits for a retrace and draws the
// page that is on screen. The whole timeline is retrace counts (the part never asks the music where it is).
/** @typedef {import('../machine.js').Machine} Machine */
import {
  ANGLE_Z, ANGLE_Y, ANGLE_X, MORPH_ANGLE_Z, MORPH_ANGLE_Y, MORPH_ANGLE_X, STAR_ANGLE_Z, STAR_ANGLE_Y,
  STAR_ANGLE_X, END_COUNTER, IS_ENDING, POINT_X, PERSPECTIVE, STAR_MOTION, CUBE_MOTION, CUBE_Y_OFFSET,
  DOT_LIST_PAGE0, QUIT_FLAG, IFS_WEIGHT, MORPH_WEIGHT, FRAMES_WAITED, PLOT_SEGMENT, POLYGON_PAGE, PAGE_FLAG,
  PLOT_COLOUR, IFS_COLOUR, IS_CUBES_DONE, LOGO_STATE, IS_IFS_ON, IFS_HALF_RATE, IFS_CYCLES, POLYGON,
  POLYGON_MIN_Y, POLYGON_MAX_Y, BLEND_WEIGHT, IFS_STEP, IFS_PAIR_INDEX, IFS_WEIGHTS, MORPH_WEIGHTS, IFS_PAIRS,
  IFS_FIRST, IFS_SECOND, SHAPES, MORPH_STEP, SHAPE_INDEX, SHAPE_A_PATCHES, SHAPE_B_PATCHES,
} from './exe3-memory.js';
import {
  eraseDots, clearPage, drawLogo, fillPolygon, setPalette, fadeInFire, fadeInBlues, fadeOutLogo,
  PAGE0_SEGMENT, PAGE1_SEGMENT, PAGE1_OFFSET,
} from './exe3-video.js';
import { seedRandom, drawStars, drawCubes, drawIfs, drawMorph } from './exe3-scenes.js';

/**
 * The original seeds its random numbers from the DOS clock (seed_rng 0a09: one of the 64 odd values 1..0xfd with
 * bit 1 clear). The seed only picks the IFS maps point by point. 0x6d is the seed of the recorded run, found by
 * matching the IFS frames of the recording against all 64 candidates.
 */
const RANDOM_SEED = 0x6d;
const CRTC_INDEX = 0x3d4;
const MAX_SCAN_LINE_400 = 0x4009;
const ANGLE_LIMIT = 0x7d0;
const ANGLE_WRAP = 0x7cf;
const STAR_SPEED = -0x23;
const CUBE_SPEED = -0x64;
const MORPH_SPIN = 6;
const IFS_PAIR_SWITCH_STEP = 0x15;
const IFS_LAST_STEP = 0x28;
const MORPH_SHAPE_A_STEP = 0x188;
const MORPH_LAST_STEP = 0x2f3;
const ENDING_SHAPE_INDEX = 0x14;
const ENDING_RETRACES = 0x1c2;
const IFS_LAST_COLOUR = 0x50;
const MORPH_CYCLE = 8;
const LOGO_PERSPECTIVE = 0x12c;
const MORPH_START_ANGLE = 0x3e8;
const DOT_LISTS_WORDS = 0x708;
const STAR_DOTS = 64;
const SCAN_CODE_ESCAPE = 1;

/** `add [v], step` then the wrap at 2000 (0x7d0) that subtracts 1999. */
function advanceAngle(m, address, step) {
  let angle = (m.u16(address) + step) & 0xffff;
  if (angle >= ANGLE_LIMIT) {
    angle -= ANGLE_WRAP;
  }
  m.set16(address, angle);
}

/** 02c0..030a: the next pair of IFS functions from the PAIRS list, which restarts at its 0 end marker. */
function nextIfsPair(m) {
  const loadPair = () => {
    m.set16(IFS_FIRST, m.u16(IFS_PAIRS + m.u16(IFS_PAIR_INDEX)));
    m.set16(IFS_PAIR_INDEX, m.u16(IFS_PAIR_INDEX) + 2);
    m.set16(IFS_SECOND, m.u16(IFS_PAIRS + m.u16(IFS_PAIR_INDEX)));
    m.set16(IFS_PAIR_INDEX, m.u16(IFS_PAIR_INDEX) + 2);
  };
  loadPair();
  if (m.u16(IFS_FIRST) === 0) {
    m.set16(IFS_PAIR_INDEX, 0);
    loadPair();
  }
}

/** 03d9..0411 / 041e..045c: the next shape of the SHAPES list, patched into the morph's reads. Returns it. */
function nextShape(m, patches) {
  const shape = m.u16(SHAPES + m.u16(SHAPE_INDEX));
  for (const patch of patches) {
    m.set16(patch, shape);
  }
  m.set16(SHAPE_INDEX, m.u16(SHAPE_INDEX) + 2);
  return shape;
}

function restartShapes(m, patches) {
  m.set16(SHAPE_INDEX, 0);
  nextShape(m, patches);
}

/** 028e..0374: the IFS blend weight, one step every 2nd retrace, and the pair switches. */
function stepIfs(m) {
  m.set8(IFS_HALF_RATE, m.u8(IFS_HALF_RATE) ^ 1);
  if (m.u8(IFS_HALF_RATE) & 1) {
    return;
  }
  m.set16(IFS_WEIGHT, m.u8(IFS_WEIGHTS + m.u8(IFS_STEP)));
  if (m.u8(IFS_STEP) === IFS_PAIR_SWITCH_STEP) {
    m.set8(IFS_CYCLES, m.u8(IFS_CYCLES) + 1);
    nextIfsPair(m);
  } else if (m.u8(IFS_STEP) === IFS_LAST_STEP) {
    nextIfsPair(m);
    m.set8(IFS_STEP, 0);
    m.set16(IFS_WEIGHT, m.u8(IFS_WEIGHTS));
  }
  m.set8(IFS_STEP, m.u8(IFS_STEP) + 1);
}

/** 0379..0472: the morph's spin, blend weight and shape switches. */
function stepMorph(m) {
  advanceAngle(m, MORPH_ANGLE_Z, 0);
  advanceAngle(m, MORPH_ANGLE_Y, MORPH_SPIN);
  advanceAngle(m, MORPH_ANGLE_X, 0);
  m.set16(MORPH_WEIGHT, m.u8(MORPH_WEIGHTS + m.u16(MORPH_STEP)));
  if (m.u16(MORPH_STEP) === MORPH_SHAPE_A_STEP && nextShape(m, SHAPE_A_PATCHES) === 0) {
    restartShapes(m, SHAPE_A_PATCHES);
  }
  if (m.u16(MORPH_STEP) >= MORPH_LAST_STEP) {
    if (nextShape(m, SHAPE_B_PATCHES) === 0) {
      m.set16(QUIT_FLAG, 1);
      restartShapes(m, SHAPE_B_PATCHES);
    }
    m.set16(MORPH_STEP, 0);
    m.set16(MORPH_WEIGHT, m.u8(MORPH_WEIGHTS));
  }
  m.set16(MORPH_STEP, m.u16(MORPH_STEP) + 1);
}

/** 0000:0204 the retrace callback: shows page [f37] and advances the motion of the current phase. */
function retraceCallback(m) {
  const start = m.u8(PAGE_FLAG) === 1 ? PAGE1_OFFSET : 0;
  m.vga.out16(CRTC_INDEX, 0x0c | (start & 0xff00));
  m.vga.out16(CRTC_INDEX, 0x0d | ((start & 0xff) << 8));
  if (m.u8(IS_CUBES_DONE) !== 1) {
    advanceAngle(m, STAR_ANGLE_Z, 1);
    advanceAngle(m, STAR_ANGLE_Y, 2);
    advanceAngle(m, STAR_ANGLE_X, 1);
    m.set16(STAR_MOTION, m.u16(STAR_MOTION) + STAR_SPEED);
    m.set16(CUBE_Y_OFFSET, m.u16(CUBE_Y_OFFSET) + 1);
    m.set16(CUBE_MOTION, m.u16(CUBE_MOTION) + CUBE_SPEED);
  }
  if (m.u8(IS_IFS_ON) !== 0) {
    stepIfs(m);
  }
  if (m.u8(IFS_CYCLES) === MORPH_CYCLE) {
    stepMorph(m);
  }
  if (m.s16(SHAPE_INDEX) >= ENDING_SHAPE_INDEX) {
    m.set16(IS_ENDING, 1);
    fadeOutLogo(m);
  }
  if (m.u16(IS_ENDING) === 1) {
    m.set16(END_COUNTER, m.u16(END_COUNTER) + 1);
    if (m.u16(END_COUNTER) >= ENDING_RETRACES) {
      m.set16(QUIT_FLAG, 1);
    }
  }
}

/** 0053..0101: the cube phase frame: clear the band of the last polygon, then stars and cubes on this page. */
function drawCubePhase(m) {
  const isPage1 = m.u8(PAGE_FLAG) !== 0;
  m.set16(POLYGON_PAGE, isPage1 ? PAGE1_OFFSET : 0);
  m.set16(PLOT_SEGMENT, isPage1 ? PAGE1_SEGMENT : PAGE0_SEGMENT);
  eraseDots(m, isPage1, STAR_DOTS);
  const top = m.u16(POLYGON_MIN_Y);
  const bottom = m.u16(POLYGON_MAX_Y) + 0x14;
  const band = [0, top, 0x13f, top, 0x13f, bottom, 0, bottom];
  m.set16(POLYGON, 4);
  band.forEach((value, i) => m.set16(POLYGON + 2 + i * 2, value));
  fillPolygon(m);
  drawStars(m);
  drawCubes(m);
}

/** 010d..018b: the logo phase (still running during the IFS): the logo once, then the fire fade-in. */
function runLogoPhase(m) {
  for (let i = 0; i < 9; i++) {
    m.set16(POINT_X + i * 2, 0);
  }
  m.set16(PERSPECTIVE, LOGO_PERSPECTIVE);
  m.set16(MORPH_ANGLE_Z, 0);
  m.set16(MORPH_ANGLE_Y, MORPH_START_ANGLE);
  m.set16(MORPH_ANGLE_X, 0);
  m.set16(BLEND_WEIGHT, 0);
  if (m.u8(LOGO_STATE) !== 2) {
    m.set8(LOGO_STATE, 2);
    eraseDots(m, false, STAR_DOTS);
    eraseDots(m, true, STAR_DOTS);
    m.mem.fill(0, DOT_LIST_PAGE0, DOT_LIST_PAGE0 + DOT_LISTS_WORDS * 2);
    drawLogo(m);
  }
  fadeInFire(m);
}

/** 0195..01a8: the IFS colour immediate counts down from 0x64 to 0x50, one per frame. */
function runIfsPhase(m) {
  const colour = m.u8(IFS_COLOUR);
  if (colour !== IFS_LAST_COLOUR) {
    m.set8(IFS_COLOUR, colour - 1);
  }
  m.set8(PLOT_COLOUR, colour);
  drawIfs(m);
}

/** 01b2..01ce: the morph phase (the logo and IFS are off from here). */
function runMorphPhase(m) {
  m.set8(LOGO_STATE, 0);
  m.set8(IS_IFS_ON, 0);
  m.set16(ANGLE_Z, m.u16(MORPH_ANGLE_Z));
  m.set16(ANGLE_Y, m.u16(MORPH_ANGLE_Y));
  m.set16(ANGLE_X, m.u16(MORPH_ANGLE_X));
  drawMorph(m);
}

/** 0000:0000 main. */
export function* runIfsMorphs(m) {
  m.vga.out16(CRTC_INDEX, MAX_SCAN_LINE_400);
  seedRandom(m, RANDOM_SEED);
  clearPage(m, PAGE0_SEGMENT);
  clearPage(m, PAGE1_SEGMENT);
  setPalette(m);
  fadeInFire(m);
  m.callback = retraceCallback;
  let exitCode = 0;
  for (;;) {
    m.set8(PAGE_FLAG, (m.u8(PAGE_FLAG) + 1) & 1);
    const before = m.frameCounter;
    while (m.frameCounter <= before) {
      yield;
    }
    m.set16(FRAMES_WAITED, m.frameCounter - 1);
    m.frameCounter = 0;
    fadeInBlues(m);
    if (m.u8(IS_CUBES_DONE) !== 1) {
      drawCubePhase(m);
    }
    if (m.u8(LOGO_STATE) !== 0) {
      runLogoPhase(m);
    }
    if (m.u8(IS_IFS_ON) !== 0) {
      runIfsPhase(m);
    }
    if (m.u8(IFS_CYCLES) === MORPH_CYCLE) {
      runMorphPhase(m);
    }
    if (m.u16(QUIT_FLAG) === 1) {
      break;
    }
    // 01db: the BIOS keyboard buffer is flushed here (0040:001c = 0040:001a); the port has no BIOS data area.
    if (m.readKeyboard() === SCAN_CODE_ESCAPE) {
      exitCode = 1;
      break;
    }
  }
  m.callback = null;
  m.exitCode = exitCode;
}
