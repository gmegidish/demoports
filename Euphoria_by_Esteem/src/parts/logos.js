// 0000:143e (46.15 s): the 640x480 picture, a line wipe, the ESTEEM logo and "present", both with a
// motion trail; and 0000:1dab (85.15 s): the moon landscape, a starburst that reveals EUPHORIA and the
// white-out. Notes: docs/disassembly/P02_logos.md.
import { f32, roundHalfEven, PAGE_SIZE, real48 } from '../machine.js';
import { gradient, addPalette, timedFade, remapRange, maxBlend, line, putPixel } from '../gfx.js';
import { blur, blurDecay, buildBlendTable, blendPages } from '../effects.js';
import { loadPicture } from '../picture.js';
import { loadAsc } from '../asc.js';
import { PolyObject, WireMesh } from '../engine3d.js';
import { partInit, mark, elapsed, waitUntil, frame, fps } from './common.js';

/** [255e] + 2 and [255e] + 3 with EMS ([255e] = 100). */
const TRAIL_PAGE = 102;
const LANDSCAPE_PAGE = 103;
const LOGO_PAGE = 102;
const VESA_640X480 = 2;
const MODE_13H = 0;
const FLAG_PICTURE_SCANLINE = 512;
const FLAG_PICTURE_ROWS = 480;
/**
 * The reference capture shows the 640x480 phase as one flat colour (index 0 of 25.pcx, going through
 * the same fades), not the flag: the hidden VESA page was blank in that run, so the port blanks it too.
 * The code means to show res/25.pcx; set this to false to see it.
 */
const IS_FLAG_PICTURE_LOST = true;

// Loop rates measured in the capture: fps.txt (changed 70 Hz frames per second) gives about 20 for the
// ESTEEM loop (53..72 s) and 40 for "present" while it is drawn (76..83 s). Once "present" is no longer
// drawn, the trail drops about one colour index per capture frame (83.76..84.09 s): 70 passes/s.
// 1dab presents without vsync, so fps.txt saturates at 70 through tearing; its rates come from the
// palette steps: the 20-step fade-in takes 85.26..85.65 s (51/s), the +4 white-out steps every second
// capture frame (35/s, with the re-expanded starburst's long lines). The wipe is a busy loop: once per
// tick is all it can show.
const WIPE_FRAME_SECONDS = fps(100);
const ESTEEM_FRAME_SECONDS = fps(20);
const PRESENT_FRAME_SECONDS = fps(40);
const TRAIL_ONLY_FRAME_SECONDS = fps(70);
const MOON_FRAME_SECONDS = fps(51);
const WHITE_OUT_FRAME_SECONDS = fps(35);

const WIPE_TICKS = 33.333333333333336;
const ESTEEM_TICKS = 2000;
const PRESENT_START = 3050;
const PRESENT_TURN_TICKS = 700;
const LOGOS_PART_TICKS = 3900;
const MOON_PART_TICKS = 2500;
const WHITE = 254;
const RAY_COUNT = 120;
const RAY_SIZE = 70;
const FADE_IN_FRAMES = 20;
const REVEAL_LIMIT = 300;
const RE_EXPAND_START = 2252;


function clearScreen(m) {
  m.getPage(0).fill(0, 0, PAGE_SIZE);
}

/** 186a:1baf */
function setDisplayStart(m, x, y) {
  m.displayStart = y * m.width + x;
}

/** 0000:143e, the 640x480 phase: fade in from white over part ticks 0..100. */
function* showFlagPicture(m, partStart) {
  m.setMode(VESA_640X480, { keepMemory: true });
  addPalette(m, 0, 255, 64, 64, 64);
  m.lockPalette();
  setDisplayStart(m, 0, FLAG_PICTURE_SCANLINE);
  if (IS_FLAG_PICTURE_LOST) {
    const start = FLAG_PICTURE_SCANLINE * m.width;
    m.vram.fill(0, start, start + FLAG_PICTURE_ROWS * m.width);
  }
  m.setPalette(m.savedFlagPalette);
  addPalette(m, 0, 255, 64, 64, 64);
  m.unlockPalette();
  yield* timedFade(m, 0, 255, -1, -1, -1, 64, 100 - elapsed(m, partStart));
}

function buildEsteem(m) {
  const esteem = new PolyObject(m.engine, 0x108, 30, 70);
  loadAsc(m, 0x10, esteem);
  esteem.scaleUniform(f32(0.6));
  esteem.translate(0, 20, 0);
  esteem.scale(0.8999999999996362, 0.020000000000010232, 1.0);
  esteem.center();
  esteem.moveTo(-12, 0, 0);
  return esteem;
}

function buildPresent(m) {
  const present = new PolyObject(m.engine, 0x348, 40, 63);
  loadAsc(m, 0x11, present);
  present.scaleUniform(f32(0.6));
  present.translate(0, 20, 0);
  present.rotate(-90, 0, 0);
  present.rotate(-90, 0, 0);
  present.center();
  present.moveTo(0, -5, 0);
  return present;
}

/** Rows 99 and 101 from opposite sides, then row 100 from both ends, straight on the screen. */
function* lineWipe(m) {
  const phases = [
    (x) => {
      line(m, 0, 99, x, 99, 30);
      line(m, 320 - x, 101, 320, 101, 30);
    },
    (x) => {
      line(m, 0, 100, x, 100, 50);
      line(m, 320 - x, 100, 320, 100, 50);
    },
  ];
  const widths = [320, 160];
  for (let k = 0; k < phases.length; k++) {
    const start = mark(m);
    let t;
    do {
      t = elapsed(m, start);
      phases[k](roundHalfEven((t * widths[k]) / WIPE_TICKS));
      yield* frame(m, WIPE_FRAME_SECONDS);
    } while (t <= WIPE_TICKS);
  }
  m.setActivePage(TRAIL_PAGE);
  line(m, 0, 99, 320, 99, 30);
  line(m, 0, 100, 320, 100, 50);
  line(m, 0, 101, 320, 101, 30);
}

/** ESTEEM's pose at phase tick t: thickens, tumbles -450 degrees while sinking, swings into place. */
function poseEsteem(esteem, t, state) {
  if (t < 200) {
    esteem.scaleWork(1, real48(t / 5), 1);
  } else if (!state.isThick) {
    state.isThick = true;
    esteem.scale(1, 40, 1);
  }
  if (t > 200 && t <= 1600) {
    esteem.moveTo(-12, f32(-(t - 200) * 0.04), 0);
    esteem.setPivot(0, -8, 0);
    esteem.rotateWork(f32((-(t - 200) * 450) / 1400), 0, 0);
  } else if (t > 1600 && t < 1800) {
    esteem.moveTo(-12, f32(((t - 1600) * 50) / 200 + -56), 0);
    esteem.setPivot(0, -8, 0);
    esteem.rotateWork(-90, 0, 0);
  }
}

/** Page 1 into the trail page through the blend table, then the trail page to the screen. */
function trail(m, table, isBlurred) {
  blendPages(m, table, 1, TRAIL_PAGE);
  m.setActivePage(TRAIL_PAGE);
  if (isBlurred) {
    blur(m);
    putPixel(m, 319, 199, 0);
  }
  m.present();
}

function* esteemLoop(m, esteem, table) {
  const state = { isThick: false };
  const start = mark(m);
  let t;
  do {
    t = elapsed(m, start);
    m.setActivePage(1);
    m.fillActive(0);
    poseEsteem(esteem, t, state);
    esteem.draw();
    trail(m, table, true);
    yield* frame(m, ESTEEM_FRAME_SECONDS);
  } while (t < ESTEEM_TICKS);
}

/** "present" turns 0..180 degrees about X in 7 s; the music volume fade (3800..3900) is not ported. */
function* presentLoop(m, present, table, partStart) {
  const start = mark(m);
  do {
    const t = elapsed(m, start);
    const isTurning = t <= PRESENT_TURN_TICKS;
    m.setActivePage(1);
    m.fillActive(0);
    if (isTurning) {
      present.rotateWork(f32(t / 3.88888), 0, 0);
      present.draw();
    }
    trail(m, table, false);
    yield* frame(m, isTurning ? PRESENT_FRAME_SECONDS : TRAIL_ONLY_FRAME_SECONDS);
  } while (elapsed(m, partStart) <= LOGOS_PART_TICKS);
}

/** 0000:143e */
export function* logosPart(m) {
  const partStart = partInit(m);
  yield* showFlagPicture(m, partStart);

  m.engine.perspective = 150;
  const esteem = buildEsteem(m);
  let table = buildBlendTable(50);
  m.setActivePage(1);
  m.fillActive(0);
  m.setActivePage(TRAIL_PAGE);
  m.fillActive(0);
  m.setActivePage(0);
  yield* waitUntil(m, partStart, 370);
  yield* timedFade(m, 0, 255, -1, -1, -1, 64, 600 - elapsed(m, partStart));
  setDisplayStart(m, 0, 0);
  m.setMode(MODE_13H);
  yield* waitUntil(m, partStart, 700);
  gradient(m, 0, 30, 0, 0, 0, 0, 0, 63);
  gradient(m, 30, 63, 0, 0, 63, 63, 63, 63);
  gradient(m, 63, 255, 63, 63, 63, 63, 63, 63);

  yield* lineWipe(m);
  yield* esteemLoop(m, esteem, table);

  const present = buildPresent(m);
  table = buildBlendTable(60);
  yield* waitUntil(m, partStart, PRESENT_START);
  yield* presentLoop(m, present, table, partStart);
  clearScreen(m);
  m.freePage(TRAIL_PAGE);
  m.freePage(1);
}

/** 0000:1d08: ORs the first 4*((min(w,319)>>2)+1) columns of src into dst, a dword at a time. */
function orRevealColumns(src, dst, w) {
  if (w === 0) {
    return;
  }
  const columns = 4 * ((Math.min(w, 319) >> 2) + 1);
  for (let row = 0; row < 200; row++) {
    for (let i = row * 320; i < row * 320 + columns; i++) {
      dst[i] |= src[i];
    }
  }
}

function buildStarburst(m) {
  const wire = new WireMesh(m.engine, WHITE);
  for (let i = 1; i <= RAY_COUNT; i++) {
    const r1 = m.random(RAY_SIZE * 2) - RAY_SIZE;
    const r2 = m.random(RAY_SIZE * 2) - RAY_SIZE;
    const r3 = m.random(RAY_SIZE * 2) - RAY_SIZE;
    wire.addLine(0, 0, 0, r1, r2, r3);
  }
  wire.scaleUniform(f32(0.01));
  wire.translate(-320, 0, 0);
  return wire;
}

/** The starburst's flight and size at part tick p; returns the new reveal width. */
function moveStarburst(wire, p, state) {
  if (p > 0 && p < 1182) {
    wire.moveTo(f32((p * 420) / 1182 + -280), 0, 0);
    if (wire.origin.wx > -160 && state.revealWidth < REVEAL_LIMIT) {
      state.revealWidth = (roundHalfEven(wire.origin.wx) + 160) & 0xffff;
    }
  }
  if (p > 380 && p < 400) {
    const s = real48((p - 380) / 0.2);
    wire.scaleWork(s, s, s);
  }
  if (p >= 400 && !state.isBurst) {
    wire.scaleUniform(f32(100));
    state.isBurst = true;
  }
  if (p > 1182) {
    if (p <= 1542) {
      wire.moveTo(f32(140 - (p - 1182) / 2.57), 0, 0);
    } else if (p < 1900) {
      let g = f32(1 - (p - 1542) / 50);
      if (g < 0) {
        g = f32(0.001);
      }
      wire.scaleWork(g, g, g);
    } else if (p <= RE_EXPAND_START) {
      wire.scaleWork(0.0009999999999994458, 0.0009999999999994458, 0.0009999999999994458);
    } else if (p < 2400) {
      const s = real48((p - RE_EXPAND_START) / 30);
      wire.scaleWork(s, s, s);
    }
  }
}

/** 0000:1dab */
export function* moonPart(m) {
  const partStart = partInit(m);
  m.setClip(2, 0, m.width - 1, m.height - 1);
  m.setActivePage(1);
  loadPicture(m, LANDSCAPE_PAGE, 0x1c);
  for (let k = 0; k < 4; k++) {
    blur(m);
  }
  loadPicture(m, LOGO_PAGE, 0x1b);
  remapRange(m, LOGO_PAGE, 8, 12, 243);
  m.setActivePage(1);
  gradient(m, 0, 200, 0, 0, 0, 0, 50, 63);
  gradient(m, 200, 249, 0, 50, 63, 63, 63, 63);
  gradient(m, 249, 254, 63, 63, 63, 63, 63, 63);
  const wire = buildStarburst(m);
  m.engine.starMode = 2;
  m.gradStep = 30;
  m.setColor(255, 0, 0, 0);
  addPalette(m, 0, 254, -60, -60, -60);
  const state = { revealWidth: 0, isBurst: false };
  let fadeFrames = 0;
  let p;
  do {
    p = elapsed(m, partStart);
    m.setActivePage(1);
    orRevealColumns(m.getPage(LOGO_PAGE), m.getPage(1), state.revealWidth);
    if (fadeFrames < FADE_IN_FRAMES) {
      addPalette(m, 0, 254, 3, 3, 3);
      fadeFrames++;
    }
    wire.rotate(4, 3, 5);
    moveStarburst(wire, p, state);
    if (p > 2304) {
      addPalette(m, 0, 254, 4, 4, 4);
    }
    wire.drawLines();
    blurDecay(m, 1);
    maxBlend(m.getPage(LANDSCAPE_PAGE), m.getPage(1));
    m.present();
    yield* frame(m, p > RE_EXPAND_START ? WHITE_OUT_FRAME_SECONDS : MOON_FRAME_SECONDS);
  } while (p < MOON_PART_TICKS);
  m.fillActive(WHITE);
  m.present();
  m.freePage(LANDSCAPE_PAGE);
  m.freePage(LOGO_PAGE);
  m.freePage(1);
  m.setColor(0, 0, 0, 0);
}
