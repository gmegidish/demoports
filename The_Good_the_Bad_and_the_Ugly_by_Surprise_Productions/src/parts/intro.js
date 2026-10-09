// The intro (Erik, graphics Maestro): 08d8:275d. The chess plane, the "Surprise!" picture stretching to yellow, the
// yellow pyramid, "PRESENTS" and the heads logo sliding in on the music's first sync event.
// docs/disassembly/G2_textmode_intro_credits.md section 4.
import { linear, waitTick } from '../machine.js';
import * as lib from '../library.js';
import * as engine from '../engine3d.js';

/**
 * @typedef {object} TickFade a palette loop of the intro
 * @property {number} colours DAC entries from 0
 * @property {number} from linear address of the start palette
 * @property {number} to linear address of the end palette
 * @property {number} work linear address of the interpolated palette
 * @property {number} steps steps (dh runs 0..steps-1, dl = steps)
 * @property {() => void} [onTick] register writes right after the tick, before the upload
 */

const CODE = 0x08d8;
const at = (offset) => linear(CODE, offset);
const E = engine.ENGINE;
const engineAt = (offset) => engine.ENGINE_SEGMENT_BASE + offset;

/** 08d8 pointers and their resource names. */
const WORK_POINTER = 0x2635;
const CHESS_POINTER = 0x2637;
const CHESS_NAME = 0x2639;
const PRESENTS_NAME = 0x2641;
const PRESENTS_POINTER = 0x2649;
const HEADS_NAME = 0x264b;
const HEADS_POINTER = 0x2653;
const PALETTE_NAME = 0x2655;
const PALETTE_POINTER = 0x265d;
const PALETTES_POINTER = 0x265f;
const WORK_PARAGRAPHS = 0x3e80;
const PALETTES_PARAGRAPHS = 0xf5;
/** In the palette area [265f]: intropal's two palettes, black, white, the fade output. */
const PALETTE_PRESENTS = 0x000;
const PALETTE_HEADS = 0x300;
const PALETTE_BLACK = 0x600;
const PALETTE_WHITE = 0x900;
const PALETTE_WORK = 0xc00;
const PICTURE_BYTES = 0xfa00;
const MODE_X_PAGE = 0x3e80;
const MODE_X_PLANE_BYTES = 0x3e80;

/** 08d8 variables of the intro. */
const CHESS_TICKS = 0x2633;
const CHESS_TICKS_END = 0x172;
const STEP_COUNT = 0x2661;
const STRETCH = 0x26ae;
const STRETCH_LIMIT = 0x3e;
const STRETCH_START = 0x26af;
const SEQUENCE_LEFT = 0x26b1;
/** See surprisePicture. */
const STRETCH_LATE_SCANLINES = 183;

/** Fade palettes in module 0299 (segment 02bf). */
const FADES = 0x02bf;
const FADE_YELLOW = 0x0096;
const FADE_WORK = 0x012c;
const FADE_WHITE = 0x01c2;
const FADE_CHESS = 0x0258;
const PYRAMID_COLOURS = 0x02f1;
const FADE_COLOURS = 0x32;

const CHESS_PLANE = 0x0512;
const PYRAMID = 0x053e;

const SEQUENCER_INDEX = 0x3c4;
const CRTC_INDEX = 0x3d4;
const ATTRIBUTE_PORT = 0x3c0;
const DAC_WRITE_INDEX = 0x3c8;
const DAC_DATA = 0x3c9;

/** in 3da; attribute 11h (border) = ffh. */
function setBorderFF(vga) {
  vga.in8(0x3da);
  vga.out8(ATTRIBUTE_PORT, 0x11);
  vga.out8(ATTRIBUTE_PORT, 0xff);
  vga.out8(ATTRIBUTE_PORT, 0x20);
}

/** `mov cs:[offset], value` on an 08d8 word. */
function setVariable(m, offset, value) {
  m.set16(engineAt(offset), value);
}

/** Busy-polls 08d8:157e until `isDone(count)`; each poll that fails waits a retrace. */
function* waitForCounter(m, isDone) {
  while (!isDone(engine.readFrameCounter(m))) {
    yield;
  }
}

/** 0299:0000 of the picture whose segment is at `pointer` into the work buffer [2635]. */
function unpackPicture(m, pointer) {
  lib.unpackRle(m, linear(m.u16(at(pointer)), 0), linear(m.u16(at(WORK_POINTER)), 0), PICTURE_BYTES);
}

/** 272d: the chunky 320x200 picture in [2635] to mode X at a000:3e80 (plane p, byte i = picture[4i + p]). */
function copyPictureModeX(m) {
  const vga = m.vga;
  const source = linear(m.u16(at(WORK_POINTER)), 0);
  for (let plane = 0; plane < 4; plane++) {
    vga.out16(SEQUENCER_INDEX, 0x02 | ((1 << plane) << 8));
    for (let i = 0; i < MODE_X_PLANE_BYTES; i++) {
      vga.write(MODE_X_PAGE + i, m.mem[source + plane + 4 * i]);
    }
  }
}

/** `rep stosw` of zero words at a000:0 with all planes. */
function clearVideo(m, words) {
  m.vga.out16(SEQUENCER_INDEX, 0x0f02);
  for (let i = 0; i < words * 2; i++) {
    m.vga.write(i, 0);
  }
}

/**
 * The palette loops: per step (dh = 0..steps-1) interpolate `colours` from `from` to `to` into `work` (0299:0023),
 * wait for the tick, then `onTick` (start address writes) and upload to DAC 0 (0299:0076).
 * @param {object} m the Machine
 * @param {TickFade} fade
 */
function* fadeOnTicks(m, { colours, from, to, work, steps, onTick = () => {} }) {
  for (let step = 0; step < steps; step++) {
    lib.interpolatePalette(m, colours, from, to, work, step, steps);
    yield* waitTick(m);
    onTick();
    lib.setDac(m, 0, colours, work);
  }
}

/** The frame body of the 3D loops: 1417, es = object, 1514, box reset, 128d. */
function drawEngineFrame(m, object) {
  engine.drawObjectFrame(m, object);
}

/** 08d8:2663: draws the pyramid for `ticks` ticks of 200a motion; returns the overshoot (<= 0). */
function* pyramidLoop(m, ticks) {
  let cx = ticks;
  if ((cx & 0xffff) === 0) {
    return cx;
  }
  do {
    yield* engine.flipPageTick(m);
    drawEngineFrame(m, PYRAMID);
    const elapsed = engine.readFrameCounter(m);
    m.set16(at(STEP_COUNT), elapsed);
    for (let i = 0; i < elapsed; i++) {
      engine.stepMotion(m);
    }
    cx = engine.toS16(cx - m.u16(at(STEP_COUNT)));
  } while (cx > 0);
  return cx;
}

/** 08d8:26b3: the pyramid loop for 40 more ticks while DAC 0..3 fade from its colours to white. */
function* pyramidToWhite(m, ticks) {
  let cx = engine.toS16(ticks + 0x28);
  do {
    yield* engine.flipPageTick(m);
    const step = (0x28 - cx) & 0xff;
    lib.interpolatePalette(m, 4, linear(FADES, PYRAMID_COLOURS), linear(FADES, FADE_WHITE), linear(FADES, FADE_WORK),
      step, 0x28);
    lib.setDac(m, 0, 4, linear(FADES, FADE_WORK));
    drawEngineFrame(m, PYRAMID);
    const elapsed = engine.readFrameCounter(m);
    m.set16(at(STEP_COUNT), elapsed);
    for (let i = 0; i < elapsed; i++) {
      engine.stepMotion(m);
    }
    cx = engine.toS16(cx - m.u16(at(STEP_COUNT)));
  } while (cx > 0);
}

/** Sets the 200a speeds: a95, a97, a99, distance. */
function setMotion(m, roll, a97, a99, distance) {
  setVariable(m, E.ROLL_SPEED, roll);
  setVariable(m, E.SPEED_A97, a97);
  setVariable(m, E.SPEED_A99, a99);
  setVariable(m, E.SPEED_DISTANCE, distance);
}

/** 275d..2800: resources, the palette area, the chess picture into mode X memory. */
function loadIntro(m) {
  const vga = m.vga;
  m.loadResource(at(CHESS_NAME), at(CHESS_POINTER));
  m.loadResource(at(PRESENTS_NAME), at(PRESENTS_POINTER));
  m.loadResource(at(HEADS_NAME), at(HEADS_POINTER));
  m.loadResource(at(PALETTE_NAME), at(PALETTE_POINTER));
  m.allocTo(at(WORK_POINTER), WORK_PARAGRAPHS);
  m.allocTo(at(PALETTES_POINTER), PALETTES_PARAGRAPHS);
  const palettes = linear(m.u16(at(PALETTES_POINTER)), 0);
  m.mem.copyWithin(palettes, linear(m.u16(at(PALETTE_POINTER)), 0), linear(m.u16(at(PALETTE_POINTER)), 0x600));
  m.mem.fill(0, palettes + PALETTE_BLACK, palettes + PALETTE_WHITE);
  m.mem.fill(0x3f, palettes + PALETTE_WHITE, palettes + PALETTE_WORK);
  unpackPicture(m, CHESS_POINTER);
  setBorderFF(vga);
  vga.out8(DAC_WRITE_INDEX, 1);
  vga.out8(DAC_DATA, 0x19);
  vga.out8(DAC_DATA, 0x19);
  vga.out8(DAC_DATA, 0x1d);
  copyPictureModeX(m);
  m.freeFrom(at(CHESS_POINTER));
}

/** Phase A (2868): the chess plane until 370 ticks have passed. */
function* chessPlane(m) {
  for (;;) {
    yield* engine.flipPageTick(m);
    drawEngineFrame(m, CHESS_PLANE);
    if (m.u16(at(CHESS_TICKS)) >= CHESS_TICKS_END) {
      return;
    }
    const elapsed = engine.readFrameCounter(m);
    m.set16(at(CHESS_TICKS), m.u16(at(CHESS_TICKS)) + elapsed);
    for (let i = 0; i < elapsed; i++) {
      engine.stepAngles(m);
      m.set16(engineAt(E.X_CENTRE), m.u16(engineAt(E.X_CENTRE)) + 1);
    }
  }
}

/** Phase B (28b5): the chess picture fades in from white, then fades to yellow while it scrolls and stretches. */
function* surprisePicture(m) {
  const vga = m.vga;
  yield* waitTick(m);
  vga.out8(DAC_WRITE_INDEX, 0);
  for (let i = 0; i < 0x96; i++) {
    vga.out8(DAC_DATA, 0x3f);
  }
  lib.setUnchained256(vga);
  engine.setStartAddress(m, MODE_X_PAGE);
  yield* fadeOnTicks(m, {
    colours: FADE_COLOURS, from: linear(FADES, FADE_WHITE), to: linear(FADES, FADE_CHESS),
    work: linear(FADES, FADE_WORK), steps: 0x1e,
  });
  yield* waitForCounter(m, (count) => engine.toS16(count) >= 0x43);
  yield* fadeOnTicks(m, {
    colours: FADE_COLOURS, from: linear(FADES, FADE_CHESS), to: linear(FADES, FADE_YELLOW),
    work: linear(FADES, FADE_WORK), steps: 0x46,
    onTick: () => {
      const start = m.u16(at(STRETCH_START));
      engine.setStartAddress(m, start);
      m.set16(at(STRETCH_START), start + 0x50);
      if (start + 0x50 > 0xffff) {
        return;
      }
      // DOSBox shows this maximum-scan-line change only from scanline 182 (output line 91) of the frame, but the DAC upload that
      // follows it on the whole frame (measured, G2). Modelled as: the DAC first (uploaded again, unchanged, after
      // this callback), then the CRTC write after 183 horizontal retraces.
      lib.setDac(m, 0, FADE_COLOURS, linear(FADES, FADE_WORK));
      vga.hblank(STRETCH_LATE_SCANLINES);
      vga.out8(CRTC_INDEX, 9);
      const scanLine = vga.in8(CRTC_INDEX + 1) & 0x60;
      let stretch = (m.u8(at(STRETCH)) + 1) & 0xff;
      if (stretch > STRETCH_LIMIT) {
        stretch = STRETCH_LIMIT;
      }
      m.set8(at(STRETCH), stretch);
      vga.out8(CRTC_INDEX + 1, scanLine | ((stretch >> 1) & 0x1f));
    },
  });
}

/** Phase C (299b): the pyramid's scripted motion, then its fade to white. */
function* pyramid(m) {
  const vga = m.vga;
  lib.setEgaPlanar(vga);
  setBorderFF(vga);
  setVariable(m, E.X_CENTRE, 0xa0);
  setVariable(m, E.DISTANCE, 0x12c);
  setVariable(m, E.ANGLE_A95, 0x438);
  setVariable(m, E.ANGLE_A97, 0);
  setVariable(m, E.ANGLE_A99, 0);
  setMotion(m, 0, 0, 0, 0);
  let cx = yield* pyramidLoop(m, 0x0a);
  lib.setDac(m, 0, 4, linear(FADES, PYRAMID_COLOURS));
  setMotion(m, 0, 6, 0, 9);
  cx = yield* pyramidLoop(m, engine.toS16(cx + 0x78));
  for (const roll of [-2, -4, -6]) {
    setMotion(m, roll, 6, 0, 9);
    cx = yield* pyramidLoop(m, engine.toS16(cx + 0x14));
  }
  m.set16(at(SEQUENCE_LEFT), cx);
  let distanceSpeed = 9;
  for (let i = 0; i < 0x0a; i++) {
    setMotion(m, -8, 6, 0, distanceSpeed);
    cx = yield* pyramidLoop(m, engine.toS16(m.s16(at(SEQUENCE_LEFT)) + 0x0a));
    m.set16(at(SEQUENCE_LEFT), cx);
    distanceSpeed -= 4;
  }
  setMotion(m, 0, 8, 0, distanceSpeed);
  cx = yield* pyramidLoop(m, engine.toS16(cx + 3));
  yield* pyramidToWhite(m, cx);
}

/** Phase D (2af0): "PRESENTS" from white, held, to black. */
function* presents(m) {
  const vga = m.vga;
  const palettes = linear(m.u16(at(PALETTES_POINTER)), 0);
  lib.setDac(m, 0, 0xff, palettes + PALETTE_WHITE);
  clearVideo(m, 0x1f40);
  yield* waitTick(m);
  lib.setUnchained256(vga);
  unpackPicture(m, PRESENTS_POINTER);
  copyPictureModeX(m);
  engine.setStartAddress(m, MODE_X_PAGE);
  yield* fadeOnTicks(m, {
    colours: 0x64, from: palettes + PALETTE_WHITE, to: palettes + PALETTE_PRESENTS, work: palettes + PALETTE_WORK,
    steps: 0x46,
  });
  yield* waitForCounter(m, (count) => count >= 0x78);
  yield* fadeOnTicks(m, {
    colours: 0x64, from: palettes + PALETTE_PRESENTS, to: palettes + PALETTE_BLACK, work: palettes + PALETTE_WORK,
    steps: 0x50,
  });
}

/** Phase E (2bcd): the heads logo slides in on the first music sync, white flash, held, to black. */
function* headsLogo(m) {
  const vga = m.vga;
  const palettes = linear(m.u16(at(PALETTES_POINTER)), 0);
  clearVideo(m, 0x3e80);
  lib.setDacBlack(vga);
  unpackPicture(m, HEADS_POINTER);
  const source = linear(m.u16(at(WORK_POINTER)), 0);
  for (let plane = 0; plane < 4; plane++) {
    vga.out16(SEQUENCER_INDEX, 0x02 | ((1 << plane) << 8));
    let si = source + plane;
    let di = 0x50;
    for (let row = 0; row < 0xc8; row++) {
      for (let i = 0; i < 0x50; i++) {
        vga.write(di++, m.mem[si]);
        si += 4;
      }
      di += 0x50;
    }
  }
  engine.setStartAddress(m, 0);
  vga.out16(CRTC_INDEX, 0x5013);
  yield* waitTick(m);
  lib.setDac(m, 0, 0xff, palettes + PALETTE_HEADS);
  while (m.musicSync === 0) {
    yield;
  }
  let start = 2;
  for (let i = 0; i < 0x1b; i++) {
    yield* waitTick(m);
    engine.setStartAddress(m, start);
    start += 3;
  }
  yield* fadeOnTicks(m, {
    colours: 0xff, from: palettes + PALETTE_WHITE, to: palettes + PALETTE_HEADS, work: palettes + PALETTE_WORK,
    steps: 0x28,
  });
  yield* waitTick(m);
  yield* waitForCounter(m, (count) => count > 0xc8);
  yield* fadeOnTicks(m, {
    colours: 0xff, from: palettes + PALETTE_HEADS, to: palettes + PALETTE_BLACK, work: palettes + PALETTE_WORK,
    steps: 0x46,
  });
}

/** 08d8:275d. */
export function* intro(m) {
  const vga = m.vga;
  loadIntro(m);
  vga.out8(CRTC_INDEX, 9);
  vga.out8(CRTC_INDEX + 1, vga.in8(CRTC_INDEX + 1) & 0x60);
  setVariable(m, E.DISTANCE, 0x190);
  setVariable(m, E.X_CENTRE, 0xff38);
  setVariable(m, E.ANGLE_A95, 0x1d6);
  setVariable(m, E.ANGLE_A97, 0);
  setVariable(m, E.ANGLE_A99, 0x50);
  setVariable(m, E.SPEED_DISTANCE, 0);
  setVariable(m, E.ROLL_SPEED, 2);
  setVariable(m, E.SPEED_A97, 0);
  setVariable(m, E.SPEED_A99, 2);
  yield; // 0731:013c waits for the retrace start
  m.setTimer('retrace');
  yield* waitForCounter(m, (count) => count > 0x82);
  yield* chessPlane(m);
  yield* surprisePicture(m);
  yield* pyramid(m);
  yield* presents(m);
  yield* headsLogo(m);
  for (const pointer of [PRESENTS_POINTER, HEADS_POINTER, PALETTE_POINTER, WORK_POINTER, PALETTES_POINTER]) {
    m.freeFrom(at(pointer));
  }
}
