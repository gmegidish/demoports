// Part 13, 0x103409: a picture on the bending grid over the first spiral frame, swaying from side to side, while
// a mask picture eats the screen to black (docs/disassembly/B_film.md).
//
// The background is the spiral animation's first frame (decoded by 0x1011ec), with its colours 0x5b and 0x5c
// replaced by two bytes of the grid's picture. The grid (mesh.js) is drawn with 0x106574: shaded through the table
// at 0x13c6a4, colour 0 transparent. Every frame, the pixels whose mask byte is at most [0x16e09c] are cleared;
// [0x16e09c] (left by the parts before) counts down by 2 per retrace.
import { POSITION, ROW, RETRACES, copyToScreen, setPalette, waitRetrace } from '../machine.js';
import { SPIRAL_BLOCKS, SPIRAL_BUFFER, decodeSpiralFrame } from './spiral.js';
import { SHADED_TRANSPARENT_106574 } from './triangles.js';
import { buildMesh, drawMesh, projectMeshMovedRight, waveMesh } from './mesh.js';

/** @typedef {import('../machine.js').Machine} Machine */

const SCREEN_PIXELS = 0xfa00;
const BACK_BUFFER = 0x12bd80;
/** The grid's picture (256x258: two more rows below the texture) and its palette. */
const PICTURE = 0x15c6a8;
const PALETTE = 0x15c6ac;
/** 0x103470: background colours replaced by bytes of the picture's extra rows. */
const BACKGROUND_COLOURS = [[0x5b, 0x10000], [0x5c, 0x10100]];
/** The palette 0x1011ec writes for this call (the spiral frame's; not shown). */
const SPIRAL_FRAME_PALETTE = 0x16dbe8;
/** The 320x200 mask picture and the threshold below which its pixels clear the screen. */
const MASK = 0x15c6a4;
const MASK_LEVEL = 0x16e09c;
const DEPTH = 0x28c;
const SHADE_DIVISOR = 3.125;
const SHADE_BASE = 128;
const SWAY_AMPLITUDE = 142;
/** After this row of the part's last position the grid moves right, a pixel per retrace. */
const MOVE_ROW = 0x10;

/** 0x103463: the background, decoded into a block of its own. */
function buildBackground(m) {
  const background = m.malloc(SCREEN_PIXELS);
  const saved = m.u32(SPIRAL_BUFFER);
  m.set32(SPIRAL_BUFFER, background);
  decodeSpiralFrame(m, m.u32(SPIRAL_BLOCKS), SPIRAL_FRAME_PALETTE);
  m.set32(SPIRAL_BUFFER, saved);
  const picture = m.u32(PICTURE);
  for (let i = background; i < background + SCREEN_PIXELS; i++) {
    for (const [colour, offset] of BACKGROUND_COLOURS) {
      if (m.mem[i] === colour) {
        m.mem[i] = m.mem[picture + offset];
        break;
      }
    }
  }
  return background;
}

/** 0x10366d: clears the pixels whose mask byte is at most the level (the level's low byte). */
function eatScreen(m, dest) {
  const level = m.u8(MASK_LEVEL);
  const mask = m.u32(MASK);
  for (let i = 0; i < SCREEN_PIXELS; i++) {
    if (m.mem[mask + i] <= level) {
      m.mem[dest + i] = 0;
    }
  }
}

/** @param {Machine} m */
export function* toonSway(m, lastPosition) {
  const background = buildBackground(m);
  yield* waitRetrace(m);
  setPalette(m, PALETTE);
  copyToScreen(m, background);
  buildMesh(m);
  let lastRetraces = m.u32(RETRACES);
  m.readPlayStatus();
  /** [esp+0x24] the grid's move right, [0x30] the sway's phase, [0x2c] the sway, [0x20], [0x28] wave phases. */
  let moved = 0;
  let swayPhase = 0;
  let sway = 0;
  let columnPhase = 0;
  let rowPhase = 0;
  const back = m.u32(BACK_BUFFER);
  do {
    waveMesh(m, {
      start: sway - Math.trunc(columnPhase / 2),
      columnStep: 5,
      rowStart: Math.trunc(rowPhase / 2) + sway,
      rowStep: 4,
      depth: DEPTH,
      shadeOf: (dz) => Math.trunc(-dz / SHADE_DIVISOR + SHADE_BASE),
    });
    projectMeshMovedRight(m, moved);
    copyToScreen(m, background, back);
    drawMesh(m, SHADED_TRANSPARENT_106574, back, m.u32(PICTURE));
    if (m.s32(MASK_LEVEL) > 2) {
      eatScreen(m, back);
    }
    // 0x1036a2: waits for the counter to move on from the value read after the last frame
    while (m.u32(RETRACES) === lastRetraces) {
      yield;
    }
    copyToScreen(m, back);
    m.readPlayStatus();
    const now = m.u32(RETRACES);
    const passed = now - lastRetraces;
    lastRetraces = now;
    for (let i = 1; i <= passed; i++) {
      if (m.s32(MASK_LEVEL) > 1) {
        m.set32(MASK_LEVEL, m.s32(MASK_LEVEL) - 2);
      }
      swayPhase++;
      columnPhase--;
      rowPhase += 3;
      if (m.u32(POSITION) === lastPosition - 1 && m.u32(ROW) > MOVE_ROW) {
        moved++;
      }
    }
    swayPhase &= 0xff;
    sway = Math.trunc(Math.sin(swayPhase * Math.PI * 0.0078125) * SWAY_AMPLITUDE);
  } while (lastPosition > m.u32(POSITION));
  return false;
}
