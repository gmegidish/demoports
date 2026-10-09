// The shared 08d8 polygon engine: objects (128d, 1184), the frame's clear and boxes (1417, 1514), the page flips
// (14a9, 14e6), the angle and motion steps (1535, 200a) and the frame counter read (157e). Every 3D effect of
// segment 08d8 uses it (the blue cubes, the intro, the glentz vectors and cubes, the chess cube, the transforming
// objects). docs/disassembly/G2_textmode_intro_credits.md section 3.
//
// State is the original's: the variables are words in m.mem at their 08d8 offsets (ENGINE), so what one effect
// leaves (angles, page, boxes) is what the next one finds.
//
// Object layout (in its own segment): [0] planes, [2] face count, [4] face list, [6] edge buffer, [8] vertex count,
// [0a] projected buffer, vertices (x, y, z words) from 0c. A face: colour word (low byte = plane bits, high byte =
// XOR applied when it faces away; 0 = hidden then), edge count, edges as pairs of projected-entry offsets. The edge
// buffer: a count word, then 9-byte entries [colour][Ax][Ay][Bx][By].
import { waitTick } from './machine.js';
import {
  ENGINE, ENGINE_SEGMENT_BASE, engineWord, setEngineWord, drawEdge, fill, mergePlaneBox, setMapMask, toS16,
} from './engine3dRaster.js';
import { projectVertices, isFrontFace, bendObjectCurves } from './engine3dProject.js';

export { ENGINE, ENGINE_SEGMENT_BASE, engineWord, setEngineWord, toS16 } from './engine3dRaster.js';
export { xorLine, clipLine, drawEdge, leftEdge, fill, fillAll, mergePlaneBox, setMapMask, selectBuffer, bufferBase } from './engine3dRaster.js';
export { projectVertices, isFrontFace, bendCurve, bendObjectCurves } from './engine3dProject.js';

const BOX_EMPTY_MIN = 1000;
const BOX_EMPTY_MAX = -1000;
const ANGLE_TURN = 0x5a0;
const EDGE_ENTRY_SIZE = 9;
const VERTICES = 0x0c;
const CRTC_INDEX = 0x3d4;
const SEQUENCER_INDEX = 0x3c4;
const PAGE_TOGGLE_8000 = 0x8000;
const SEGMENT_TOGGLE_800 = 0x0800;
const PAGE_TOGGLE_1F40 = 0x1f40;
const SEGMENT_TOGGLE_1F4 = 0x01f4;
const SCREEN_WORDS_PER_ROW = 0x14;
const ROW_BYTES = 40;

/** `mov bx, page; out 3d4 0c/0d`: the CRTC start address. */
export function setStartAddress(m, address) {
  m.vga.out16(CRTC_INDEX, 0x0c | (address & 0xff00));
  m.vga.out16(CRTC_INDEX, 0x0d | ((address & 0xff) << 8));
}

/**
 * Adds the edge (x1, y1)-(x2, y2) with plane bits `colour` to the object's edge buffer, the endpoints ordered so
 * that A has the larger y (equal y: the smaller x first); an edge already there gets its colour XORed instead.
 */
function addEdge(m, objectBase, colour, x1, y1, x2, y2) {
  let ax = x1;
  let ay = y1;
  let bx = x2;
  let by = y2;
  if (ay > by) {
    // kept
  } else if (ay === by) {
    if (!(bx > ax)) {
      [ax, bx] = [bx, ax];
    }
  } else {
    [ax, bx] = [bx, ax];
    [ay, by] = [by, ay];
  }
  const list = objectBase + m.u16(objectBase + 6);
  const count = m.u16(list);
  let entry = list + 2;
  for (let i = 0; i < count; i++, entry += EDGE_ENTRY_SIZE) {
    if (m.s16(entry + 1) === ax && m.s16(entry + 3) === ay && m.s16(entry + 5) === bx && m.s16(entry + 7) === by) {
      m.mem[entry] ^= colour;
      return;
    }
  }
  m.mem[entry] = colour;
  m.set16(entry + 1, ax);
  m.set16(entry + 3, ay);
  m.set16(entry + 5, bx);
  m.set16(entry + 7, by);
  m.set16(list, count + 1);
}

/** Adds the edges of the face at `face` with colour `colour`; returns the address after the face. */
function addFaceEdges(m, objectBase, face, colour) {
  const edges = m.u16(face + 2);
  let at = face + 4;
  for (let i = 0; i < edges; i++, at += 4) {
    const a = objectBase + m.u16(at);
    const b = objectBase + m.u16(at + 2);
    addEdge(m, objectBase, colour, m.s16(a), m.s16(a + 2), m.s16(b), m.s16(b + 2));
  }
  return at;
}

/** Projects the object's vertices (07cb from ds:0c to es:[0a]) after emptying its edge buffer. */
function projectObject(m, objectBase) {
  m.set16(objectBase + m.u16(objectBase + 6), 0);
  projectVertices(m, objectBase + VERTICES, objectBase + m.u16(objectBase + 0x0a), m.u16(objectBase + 8));
}

/** Draws the edges with `colourBit` of the object's edge buffer (the 13f7 loop of 123a / 1391). */
function drawPlaneEdges(m, objectBase, colourBit) {
  const list = objectBase + m.u16(objectBase + 6);
  const count = m.u16(list);
  let entry = list + 2;
  for (let i = 0; i < count; i++, entry += EDGE_ENTRY_SIZE) {
    if (m.mem[entry] & colourBit) {
      drawEdge(m, m.s16(entry + 1), m.s16(entry + 3), m.s16(entry + 5), m.s16(entry + 7));
    }
  }
}

/**
 * 128d: draws the object at `objectSegment` into the back page: project, cull and collect edges, then per plane
 * (map mask 1, 2, 4...) reset the plane box, XOR the edges into the buffer and fill them into video memory.
 */
export function drawObject(m, objectSegment) {
  const objectBase = objectSegment * 16;
  projectObject(m, objectBase);
  const faces = m.u16(objectBase + 2);
  let face = objectBase + m.u16(objectBase + 4);
  for (let f = 0; f < faces; f++) {
    const isFront = isFrontFace(m, objectBase, face);
    let colour = m.u8(face);
    const backXor = m.u8(face + 1);
    if (!isFront) {
      if (backXor === 0) {
        face += 4 + m.u16(face + 2) * 4;
        continue;
      }
      colour ^= backXor;
    }
    face = addFaceEdges(m, objectBase, face, colour);
  }
  const planes = m.u16(objectBase);
  let colourBit = 1;
  for (let p = 0; p < planes; p++) {
    setMapMask(m, colourBit);
    setEngineWord(m, ENGINE.PLANE_MAX_X, BOX_EMPTY_MAX);
    setEngineWord(m, ENGINE.PLANE_MIN_X, BOX_EMPTY_MIN);
    setEngineWord(m, ENGINE.PLANE_MAX_Y, BOX_EMPTY_MAX);
    setEngineWord(m, ENGINE.PLANE_MIN_Y, BOX_EMPTY_MIN);
    setEngineWord(m, ENGINE.LINE_COUNT, 0);
    drawPlaneEdges(m, objectBase, colourBit);
    if (m.u8(ENGINE_SEGMENT_BASE + ENGINE.FILL_ENABLE) === 1) {
      if (engineWord(m, ENGINE.LINE_COUNT) !== 0) {
        fill(m); // 13e2
      }
      mergePlaneBox(m);
    }
    colourBit = (colourBit << 1) & 0xff;
  }
}

/**
 * 1184: the bending objects: project, bend the three curves (112a), collect the edges of every face (no culling),
 * then per plane draw and always fill and merge, without resetting the plane box.
 */
export function drawBendingObject(m, objectSegment) {
  const objectBase = objectSegment * 16;
  projectObject(m, objectBase);
  bendObjectCurves(m, objectBase);
  const faces = m.u16(objectBase + 2);
  let face = objectBase + m.u16(objectBase + 4);
  for (let f = 0; f < faces; f++) {
    face = addFaceEdges(m, objectBase, face, m.u8(face));
  }
  const planes = m.u16(objectBase);
  let colourBit = 1;
  for (let p = 0; p < planes; p++) {
    setMapMask(m, colourBit);
    drawPlaneEdges(m, objectBase, colourBit);
    fill(m);
    mergePlaneBox(m);
    colourBit = (colourBit << 1) & 0xff;
  }
}

/** 1417: clears the previous frame's box in the back page, whole 16-pixel words, with map mask word [1461]. */
export function clearPreviousBox(m) {
  let words = m.u16(ENGINE_SEGMENT_BASE + ENGINE.PREVIOUS_MAX_X) >> 4;
  const firstWord = m.u16(ENGINE_SEGMENT_BASE + ENGINE.PREVIOUS_MIN_X) >> 4;
  if (words < SCREEN_WORDS_PER_ROW) {
    words++;
  }
  words = toS16(words - firstWord);
  if (words <= 0) {
    return;
  }
  const minY = m.u16(ENGINE_SEGMENT_BASE + ENGINE.PREVIOUS_MIN_Y);
  let rows = toS16(m.u16(ENGINE_SEGMENT_BASE + ENGINE.PREVIOUS_MAX_Y) - minY);
  if (rows < 0) {
    return;
  }
  rows++;
  let di = (minY * ROW_BYTES + firstWord * 2 + m.u16(ENGINE_SEGMENT_BASE + ENGINE.PAGE)) & 0xffff;
  m.vga.out16(SEQUENCER_INDEX, m.u16(ENGINE_SEGMENT_BASE + ENGINE.CLEAR_MAP_MASK));
  const vga = m.vga;
  const skip = ROW_BYTES - 2 * words;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < 2 * words; i++) {
      vga.write(di, 0);
      di = (di + 1) & 0xffff;
    }
    di = (di + skip) & 0xffff;
  }
}

/** 1514: the frame box becomes the previous box. */
export function saveBox(m) {
  setEngineWord(m, ENGINE.PREVIOUS_MAX_X, engineWord(m, ENGINE.FRAME_MAX_X));
  setEngineWord(m, ENGINE.PREVIOUS_MAX_Y, engineWord(m, ENGINE.FRAME_MAX_Y));
  setEngineWord(m, ENGINE.PREVIOUS_MIN_Y, engineWord(m, ENGINE.FRAME_MIN_Y));
  setEngineWord(m, ENGINE.PREVIOUS_MIN_X, engineWord(m, ENGINE.FRAME_MIN_X));
}

/** The four `mov` after each 1514 call: frame box = (min 1000, max 0). */
export function resetFrameBox(m) {
  setEngineWord(m, ENGINE.FRAME_MIN_X, BOX_EMPTY_MIN);
  setEngineWord(m, ENGINE.FRAME_MAX_X, 0);
  setEngineWord(m, ENGINE.FRAME_MIN_Y, BOX_EMPTY_MIN);
  setEngineWord(m, ENGINE.FRAME_MAX_Y, 0);
}

/** 1417, 1514 and the box reset, then 128d: one frame of an object after the page flip. */
export function drawObjectFrame(m, objectSegment) {
  clearPreviousBox(m);
  saveBox(m);
  resetFrameBox(m);
  drawObject(m, objectSegment);
}

/** 14e6: shows the page just drawn, waits for the retrace (3da), then toggles the pages 0 / 8000h (a000 / a800). */
export function* flipPageRetrace(m) {
  setStartAddress(m, m.u16(ENGINE_SEGMENT_BASE + ENGINE.PAGE));
  yield;
  m.set16(ENGINE_SEGMENT_BASE + ENGINE.PAGE, m.u16(ENGINE_SEGMENT_BASE + ENGINE.PAGE) ^ PAGE_TOGGLE_8000);
  m.set16(ENGINE_SEGMENT_BASE + ENGINE.FILL_SEGMENT, m.u16(ENGINE_SEGMENT_BASE + ENGINE.FILL_SEGMENT) ^ SEGMENT_TOGGLE_800);
}

/**
 * 14a9: shows the page just drawn, waits for the timer tick (0731:00a3), sets the maximum scan line to [92]+1,
 * then toggles the pages 0 / 1f40h (a000 / a1f4).
 */
export function* flipPageTick(m) {
  setStartAddress(m, m.u16(ENGINE_SEGMENT_BASE + ENGINE.PAGE));
  yield* waitTick(m);
  const vga = m.vga;
  vga.out8(CRTC_INDEX, 9);
  const value = (vga.in8(CRTC_INDEX + 1) & 0x60) | ((m.u8(ENGINE_SEGMENT_BASE + ENGINE.Y_MODE) + 1) & 0xff);
  vga.out8(CRTC_INDEX + 1, value);
  m.set16(ENGINE_SEGMENT_BASE + ENGINE.PAGE, m.u16(ENGINE_SEGMENT_BASE + ENGINE.PAGE) ^ PAGE_TOGGLE_1F40);
  m.set16(ENGINE_SEGMENT_BASE + ENGINE.FILL_SEGMENT, m.u16(ENGINE_SEGMENT_BASE + ENGINE.FILL_SEGMENT) ^ SEGMENT_TOGGLE_1F4);
}

/** Adds `delta` to the angle word at `offset`, then subtracts a turn once if it is >= 5a0h (unsigned). */
function stepAngle(m, offset, delta) {
  let value = (m.u16(ENGINE_SEGMENT_BASE + offset) + delta) & 0xffff;
  if (value >= ANGLE_TURN) {
    value = (value - ANGLE_TURN) & 0xffff;
  }
  m.set16(ENGINE_SEGMENT_BASE + offset, value);
}

/** 1535: a97 += 2, a99 += 4, a95 += 2. */
export function stepAngles(m) {
  m.set16(ENGINE_SEGMENT_BASE + ENGINE.ANGLE_A97, m.u16(ENGINE_SEGMENT_BASE + ENGINE.ANGLE_A97) + 2);
  m.set16(ENGINE_SEGMENT_BASE + ENGINE.ANGLE_A99, m.u16(ENGINE_SEGMENT_BASE + ENGINE.ANGLE_A99) + 4);
  m.set16(ENGINE_SEGMENT_BASE + ENGINE.ANGLE_A95, m.u16(ENGINE_SEGMENT_BASE + ENGINE.ANGLE_A95) + 2);
  stepAngle(m, ENGINE.ANGLE_A97, 0);
  stepAngle(m, ENGINE.ANGLE_A95, 0);
  stepAngle(m, ENGINE.ANGLE_A99, 0);
}

/** 200a: a95 += [1578], a97 += [2002], a99 += [2004], distance += [2006], y centre += [2008]; angles wrapped. */
export function stepMotion(m) {
  const add = (offset, speed) => {
    m.set16(ENGINE_SEGMENT_BASE + offset, m.u16(ENGINE_SEGMENT_BASE + offset) + m.u16(ENGINE_SEGMENT_BASE + speed));
  };
  add(ENGINE.ANGLE_A95, ENGINE.ROLL_SPEED);
  add(ENGINE.ANGLE_A97, ENGINE.SPEED_A97);
  add(ENGINE.ANGLE_A99, ENGINE.SPEED_A99);
  add(ENGINE.DISTANCE, ENGINE.SPEED_DISTANCE);
  add(ENGINE.Y_CENTRE, ENGINE.SPEED_Y_CENTRE);
  stepAngle(m, ENGINE.ANGLE_A97, 0);
  stepAngle(m, ENGINE.ANGLE_A95, 0);
  stepAngle(m, ENGINE.ANGLE_A99, 0);
}

/** 157e: cx = the frame counter 0731:[4] (ticks since the last 0731:00a3), also kept at [157c]. */
export function readFrameCounter(m) {
  const count = m.frameCounter;
  m.set16(ENGINE_SEGMENT_BASE + ENGINE.FRAME_COUNT_COPY, count);
  return count;
}
