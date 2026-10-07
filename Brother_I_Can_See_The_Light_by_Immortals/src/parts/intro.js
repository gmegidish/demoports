// Part 1: bars, the Immortals logo, the credits, "Brother I can see the LIGHT".
// TEST.EXE 0x110fb (load), 0x1128f (run). Everything waits on the music's position and row.

import { WIDTH, setDac, setDacEntry, clearBuffer, showBuffer, playStatus, rowTime, hasReached } from '../machine.js';
import { loadPicture } from '../engine/pictures.js';
import { whitenDac, scaleDac, greyRamp, waitFor } from './common.js';

const BAR_COLOUR = 255;
/**
 * The bars' colour fades by 0.999995 per pass of a busy loop, so its speed is the CPU's. The
 * recording's machine made it about 0.95 per second; the port fades by time at that rate.
 */
const BAR_FADE_PER_SECOND = 0.95;
const BAR_FADE_PER_PASS = 0.999995;
const DAC_MAX = 63;

/** Rows of TXT1.GIF revealed at each trigger row of position 5: "Brother", "I", "can see the", "LIGHT". */
const TITLE_BANDS = [
  { row: 0x5c, from: 0, bytes: 0x2bc0 },
  { row: 0x64, from: 0x2bc0, bytes: 0x2bc0 },
  { row: 0x6c, from: 0x5780, bytes: 0x3200 },
  { row: 0x73, from: 0x8980, bytes: 0x7080 },
];
const CREDIT_PICTURES = ['kombat.gif', 'thor.gif', 'rage.gif', 'dark.gif', 'more.gif'];
const LOGO_TICKS = 100;

export function loadIntro(demo) {
  const { machine, assets } = demo;
  const logo = loadPicture(machine, assets, 'logo.gif');
  demo.intro = {
    logo,
    credits: CREDIT_PICTURES.map((name) => loadPicture(machine, assets, name).pixels),
    title: loadPicture(machine, assets, 'txt1.gif').pixels,
    grey: greyRamp(),
  };
}

function fillRows(buffer, firstRow, lastRow) {
  buffer.fill(BAR_COLOUR, firstRow * WIDTH, (lastRow + 1) * WIDTH);
}

function fillColumns(buffer, firstColumn, width) {
  for (let y = 0; y < 200; y++) {
    buffer.fill(BAR_COLOUR, y * WIDTH + firstColumn, y * WIDTH + firstColumn + width);
  }
}

/** The four triggers of phase A (rows 0 and 64 of positions 0..2) and what each one draws. */
const BAR_TRIGGERS = [
  { position: 0, row: 64, draw: (a) => { fillColumns(a, 20, 4); fillColumns(a, 31, 4); } },
  { position: 1, row: 0, draw: (a) => fillRows(a, 110, 113) },
  { position: 1, row: 64, draw: (a) => { fillRows(a, 20, 23); fillRows(a, 112, 115); } },
  { position: 2, row: 0, draw: () => {} },
];

function* bars(demo) {
  const machine = demo.machine;
  let shown = 0;
  let fadeStart = 0;
  while (playStatus(machine).position <= 1) {
    const next = BAR_TRIGGERS[shown];
    if (next && machine.time >= rowTime(machine, next.position, next.row)) {
      clearBuffer(machine.bufferA);
      next.draw(machine.bufferA);
      showBuffer(machine, machine.bufferA);
      fadeStart = rowTime(machine, next.position, next.row);
      shown++;
      continue;
    }
    const fade = BAR_FADE_PER_PASS * Math.exp(-BAR_FADE_PER_SECOND * (machine.time - fadeStart));
    const grey = Math.trunc(fade * DAC_MAX);
    setDacEntry(machine, BAR_COLOUR, grey, grey, grey);
    yield;
  }
  // The last trigger, at position 2 row 0, shows an empty buffer.
  clearBuffer(machine.bufferA);
  showBuffer(machine, machine.bufferA);
}

function* logo(demo) {
  const machine = demo.machine;
  const part = demo.intro;
  setDac(machine, part.grey);
  machine.front.set(part.logo.pixels.subarray(0, machine.front.length));
  machine.timerA.zeroAtRow(2, 0);
  // The original spins until it sees exactly position 3 row 64; it never misses a row, a frame can.
  while (!hasReached(machine, 3, 0x40)) {
    const ticks = machine.timerA.value;
    if (ticks > LOGO_TICKS) {
      setDac(machine, part.logo.palette);
    } else if (ticks < LOGO_TICKS) {
      whitenDac(machine, part.logo.palette, 1 - ticks * 0.01);
    }
    yield;
  }
  // Fade out over rows 64..127 of position 3.
  for (let status = playStatus(machine); status.position === 3; status = playStatus(machine)) {
    scaleDac(machine, part.logo.palette, (128 - status.row) * 0.015625);
    yield;
  }
}

function* credits(demo) {
  const machine = demo.machine;
  const part = demo.intro;
  clearBuffer(machine.front);
  setDac(machine, part.grey);
  // A picture every 32 rows, from position 4 row 32 to position 5 row 32.
  let shown = 0;
  for (let status = playStatus(machine); status.position === 4 || (status.position === 5 && status.row <= 0x21); status = playStatus(machine)) {
    const due = (status.position - 4) * 4 + (status.row >> 5);
    if (due > shown && due <= part.credits.length) {
      machine.front.set(part.credits[due - 1].subarray(0, machine.front.length));
      shown = due;
    }
    yield;
  }
  yield* waitFor(machine, (s) => s.row >= 0x40 || s.position > 5);
  clearBuffer(machine.front);
  for (const band of TITLE_BANDS) {
    yield* waitFor(machine, (s) => s.row >= band.row || s.position > 5);
    machine.front.set(part.title.subarray(band.from, band.from + band.bytes), band.from);
  }
  yield* waitFor(machine, (s) => s.position > 5);
}

export function* runIntro(demo) {
  setDac(demo.machine, demo.intro.grey);
  yield* bars(demo);
  yield* logo(demo);
  yield* credits(demo);
}
