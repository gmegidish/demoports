// Part 8, 0x1019b1 (main runs it with eax = 0x1c, edx = 0x20): "Kaleidoskop" (docs/disassembly/D2_kaleidoscope.md).
//
// Until position 0x1c: twelve texture-mapped triangles around the screen's centre, the mirror images alternating,
// make a kaleidoscope of a 256x256 picture. The same triangles from a second picture make a height map, with the
// "Kaleidoskop" text pasted in; the colour picture is bump-mapped with it, lit from a light that moves along two
// sine tables. The palette fades in from white.
// Then (until 0x20) a 3D object (src/engine3d.js) turns over a background of grey noise with the "Kolor ru Kolor"
// sign: until position 0x1f a box with the kaleidoscope (now drawn into a 256x161 texture and bump-mapped there)
// as its texture, then a star from TOONTOWN.DAT with the colour picture.
//
// One deviation: the fade from white (0x1018de) takes passed / 2 steps per frame, rounding down. The original
// took 8 retraces a frame in the recording; at one retrace a frame (the port, or a fast machine) it never fades and
// the whole part stays white. The port keeps the odd retrace for the next frame instead, which gives the
// recording's palettes.
import { RETRACES, POSITION, ROW, setPalette, waitRetrace } from '../machine.js';
import { blitSkipZero } from './plasma.js';
import {
  sub_10900c, sub_109725, sub_10af2c, sub_109097, sub_10b278, sub_10b21a, sub_10b356, sub_10b055, sub_109efc,
  sub_1090b2, sub_10b2ce, sub_109083,
} from '../engine3d.js';

/** @typedef {import('../machine.js').Machine} Machine */
/** @typedef {{ x: number, y: number, u: number, v: number }} Vertex */
/**
 * @typedef {object} Geometry one of the two versions of the kaleidoscope and its triangle filler
 * @property {number} centreX the triangles' common corner
 * @property {number} centreY
 * @property {number} stride the destination's row length
 * @property {number} lastRow the filler draws rows 0..lastRow
 * @property {number} lastLeft a row whose left end is beyond this is not drawn
 * @property {number} lastRight a row ends at this column (inclusive)
 * @property {number} bumpRows the bump mapping covers rows 1..bumpRows
 * @property {number} bumpColumns and columns 1..bumpColumns
 */
/** @typedef {{ x: number, xStep: number, u: number, uStep: number, v: number, vStep: number, count: number }} Edge */

const SCREEN_WIDTH = 0x140;
const SCREEN_BYTES = 0xfa00;
/** [0x12bd80], the frame buffer every part renders into (0x2ee00 bytes, allocated by main at 0x100317). */
const BUFFER = 0x12bd80;
const BUFFER_SIZE = 0x2ee00;

/**
 * Allocated by the static initialiser 0x101274 (Watcom's XI table, before main): [0x16e0ac] 0x30 bytes for the
 * three corners of a triangle, [0x16e0b0] the height map (64 KB, 320 or 256 bytes per row).
 */
const CORNERS = 0x16e0ac;
const CORNERS_SIZE = 0x30;
const HEIGHT_MAP = 0x16e0b0;
const HEIGHT_MAP_SIZE = 0x10000;
/** [0x16e0b4]: 128x128 bytes, (x * y) >> 6: the light of a pixel from its two slopes. */
const LIGHT = 0x16e0b4;
const LIGHT_SIZE = 0x4000;
const LIGHT_SIDE = 0x80;
const LIGHT_MAX = 0x7f;
/** 0x12c6a4: 64 KB (a picture main copies there): the colour of colour * 256 + light. */
const SHADE_TABLE = 0x12c6a4;
/**
 * The light's path, 512 dwords each: y = trunc(100 - sin(i * 2pi / 511) * 40) (read at t) and
 * x = trunc(160 - cos(i * 2pi / 511) * 80) (read at 2t).
 */
const LIGHT_PATH_Y = 0x16e0b8;
const LIGHT_PATH_X = 0x16e8b8;
const LIGHT_PATH_LENGTH = 0x200;
const LIGHT_PATH_MASK = 0x1ff;
const TWO_PI = 0x127308;
const LIGHT_PATH_DIVISOR = 0x127338;
const LIGHT_PATH_Y_AMPLITUDE = 0x127310;
const LIGHT_PATH_Y_CENTRE = 0x127340;
const LIGHT_PATH_X_AMPLITUDE = 0x127318;
const LIGHT_PATH_X_CENTRE = 0x127348;

/** The pictures (all 256x256 but the texts): colour, height, the two texts (200x50 and 320x50). */
const COLOUR_PICTURE = 0x12c398;
const HEIGHT_PICTURE = 0x12c6a0;
const KALEIDOSKOP_TEXT = 0x12c69c;
const KALEIDOSKOP_TEXT_WIDTH = 0xc8;
const KOLOR_TEXT = 0x16def0;
const TEXT_ROW = 0x96;
const TEXT_ROWS = 0x32;
/** The pictures' palette (loaded with them), and the palette the part fades from white towards it. */
const PICTURE_PALETTE = 0x12c39c;
const PALETTE = 0x16f0b8;
const PALETTE_BYTES = 0x300;
const WHITE = 0x3f;

/** 0x16e09c: the black-out level of part 6; this part takes it down by 2 per retrace (and never reads it). */
const BLACKOUT_LEVEL = 0x16e09c;

/** [esp+0x64], [esp+0x68]: two float angles; the first turns the triangles, both turn the mirrors. */
const FIRST_ANGLE_STEP = 0x127350;
const SECOND_ANGLE_STEP = 0x127354;
const SECOND_ANGLE_START = 0x3f490fdb; // pi / 4 as a float
/** 0x101293 / 0x1014be: 12 triangles, pi / 6 apart, 380 pixels long; the mirrors' corners 127.5 from 158,158. */
const TRIANGLES = 0xc;
const PI_A = 0x1272a8;
const SIX_A = 0x1272c0;
const RADIUS_A = 0x1272b0;
const MIRROR_RADIUS_A = 0x1272b8;
const MIRROR_CENTRE = 0x9e;

/** @type {Geometry} 0x101293 with the filler 0x102442: the whole screen. */
const SCREEN_GEOMETRY = {
  centreX: 0xa0, centreY: 0x64, stride: SCREEN_WIDTH, lastRow: 0xc7, lastLeft: 0x149, lastRight: 0x140,
  bumpRows: 0xc6, bumpColumns: 0x13e,
};
/** @type {Geometry} 0x1014be with the filler 0x102796: a 256x161 texture. */
const TEXTURE_GEOMETRY = {
  centreX: 0x80, centreY: 0x50, stride: 0x100, lastRow: 0xa0, lastLeft: 0xff, lastRight: 0xff,
  bumpRows: 0xa9, bumpColumns: 0xfe,
};
/** The smallest width (16.16) the gradients are divided by, for the two signs. */
const MIN_NEGATIVE_WIDTH = -0x10000;
const MIN_POSITIVE_WIDTH = 0x1000;

/** 0x1019b1: the noise: three buffers with the colours nearest to these greys, in turn. */
const NOISE_GREYS = [0, 0x1b, 0x2b];
/** 0x10193a starts with a distance no colour reaches. */
const FAR = 0xfffff;
/** 0x114f3f, Watcom's rand: its seed (initially 1). */
const RAND_SEED = 0x129bec;
/**
 * Part 7 (0x108e64) calls rand three times per frame it renders, so the seed when this part starts depends on how
 * fast the original ran. The recording's noise is the one after 807 calls (part 7 drew 269 frames there; fitted to
 * the noise of recording frame 10100): the part starts from that seed.
 */
const RECORDING_SEED = 0x86134d60;

/** The 3D object: draw modes, shading scales (ebx, left over from the calls before), the star's offset in
 * TOONTOWN.DAT, the light (0, 0, -11), the box's first place and the z-buffer's clear value. */
const BOX_DRAW_MODE = 0xb;
const BOX_SHADE_SCALE = 0x64;
const STAR_DRAW_MODE = 0xc;
const STAR_SHADE_SCALE = 0xff;
const STAR_OFFSET = 0xab89c;
const LIGHT_Z = -0xb;
const BOX_START_Z = 0x200;
const Z_CLEAR = 0x375;
/** 0x101e46: the object's angles in degrees ([esp+0x6c]); its position from them. */
const OBJECT_START_DEGREES = 0x5a;
const DEGREES = 0x168;
const PI_B = 0x127320;
const HALF_TURN = 0x127358;
const OBJECT_Z_AMPLITUDE = 0x127328;
const OBJECT_Z_CENTRE = 0x127360;
const OBJECT_Y_AMPLITUDE = 0x127330;
const OBJECT_X_AMPLITUDE = 0x127310;
/** 0x101fe2: during the first 15 rows of position 0x1c the box does not turn. */
const STILL_ROWS = 0xf;
/** 0x102039: after the first two rows of a position the noise changes every frame. */
const NOISE_STILL_ROWS = 2;


/** 0x114f3f: rand(). */
function rand(m) {
  const seed = (Math.imul(m.u32(RAND_SEED), 0x41c64e6d) + 0x3039) >>> 0;
  m.set32(RAND_SEED, seed);
  return (seed >>> 16) & 0x7fff;
}

function allocated(m, global, size) {
  if (m.u32(global) === 0) {
    m.set32(global, m.malloc(size));
  }
  return m.u32(global);
}

/** 0x10193a: the colour of `palette` nearest to r, g, b (the first of equals). */
function nearestColour(m, palette, red, green, blue) {
  let best = FAR;
  let colour = 0;
  for (let i = 0; i < 0x100; i++) {
    const dr = m.u8(palette + i * 3) - red;
    const dg = m.u8(palette + i * 3 + 1) - green;
    const db = m.u8(palette + i * 3 + 2) - blue;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < best) {
      best = distance;
      colour = i;
    }
  }
  return colour;
}

/** 0x101a11..0x101acc: three buffers of noise, each pixel one of the three greys, the buffers shifted by one. */
function makeNoise(m) {
  const buffers = [m.malloc(SCREEN_BYTES), m.malloc(SCREEN_BYTES), m.malloc(SCREEN_BYTES)];
  const greys = NOISE_GREYS.map((grey) => nearestColour(m, PICTURE_PALETTE, grey, grey, grey));
  for (let i = 0; i < SCREEN_BYTES; i++) {
    const r = rand(m) % 3;
    for (let k = 0; k < 3; k++) {
      m.mem[buffers[k] + i] = greys[(r + k) % 3];
    }
  }
  return buffers;
}

/** 0x101b58: the light table. */
function makeLightTable(m) {
  const table = m.malloc(LIGHT_SIZE);
  m.set32(LIGHT, table);
  for (let y = 0; y < LIGHT_SIDE; y++) {
    for (let x = 0; x < LIGHT_SIDE; x++) {
      m.mem[table + y * LIGHT_SIDE + x] = (x * y) >> 6;
    }
  }
}

/** 0x101bca: the light's two paths. */
function makeLightPaths(m) {
  for (let i = 0; i < LIGHT_PATH_LENGTH; i++) {
    const angle = (i * m.f64(TWO_PI)) / m.f64(LIGHT_PATH_DIVISOR);
    m.set32(LIGHT_PATH_Y + i * 4,
      Math.trunc(m.f64(LIGHT_PATH_Y_CENTRE) - Math.sin(angle) * m.f64(LIGHT_PATH_Y_AMPLITUDE)));
    m.set32(LIGHT_PATH_X + i * 4,
      Math.trunc(m.f64(LIGHT_PATH_X_CENTRE) - Math.cos(angle) * m.f64(LIGHT_PATH_X_AMPLITUDE)));
  }
}

/** idiv: the quotient truncated toward zero (exact for |a| < 2^52). */
function divide(a, b) {
  return Math.trunc(a / b);
}

/**
 * 0x1023af / 0x10235c: an edge from `from` down to `to` (16.16; the right edges use x only); null when it has no
 * rows.
 * @param {Vertex} from
 * @param {Vertex} to
 * @returns {Edge | null}
 */
function edgeOf(from, to) {
  const count = to.y - from.y;
  if (count === 0) {
    return null;
  }
  return {
    x: from.x << 16,
    xStep: divide((to.x - from.x) << 16, count),
    u: from.u << 16,
    uStep: divide((to.u - from.u) << 16, count),
    v: from.v << 16,
    vStep: divide((to.v - from.v) << 16, count),
    count,
  };
}

/** The gradient of u or v across a row: 8.8 fixed point. */
function gradient(slope, top, mid, bottom, width) {
  const across = (Math.imul(slope, bottom - top) + ((top - mid) << 16)) | 0;
  return (divide(across * 0x10000, width) | 0) >> 8;
}

/**
 * 0x102442 (320 bytes per row) and 0x102796 (256): a triangle of `texture` (256x256) into `dest`, affine.
 * The corners are sorted by y; the long edge is one side, the two short ones the other. A row is drawn from the
 * left edge to the right edge inclusive, clipped as the geometry says.
 * @param {Machine} m
 * @param {Geometry} g
 * @param {Vertex} a
 * @param {Vertex} b
 * @param {Vertex} c
 */
function texturedTriangle(m, g, a, b, c, dest, texture) {
  let top = a;
  let mid = b;
  let bottom = c;
  if (top.y > mid.y) {
    [top, mid] = [mid, top];
  }
  if (top.y > bottom.y) {
    [top, bottom] = [bottom, top];
  }
  if (mid.y > bottom.y) {
    [mid, bottom] = [bottom, mid];
  }
  if (top.y > g.lastRow || bottom.y < 0) {
    return;
  }
  const slope = divide((mid.y - top.y) << 16, bottom.y - top.y + 1);
  let width = (Math.imul(slope, bottom.x - top.x) + ((top.x - mid.x) << 16)) | 0;
  if (width === 0) {
    return;
  }
  const longEdge = [[top, bottom]];
  const shortEdges = [[top, mid], [mid, bottom]];
  const lefts = width < 0 ? longEdge : shortEdges;
  const rights = width < 0 ? shortEdges : longEdge;
  /** The next edge with rows, or null (then the triangle ends). */
  const next = (edges) => {
    while (edges.length > 0) {
      const edge = edgeOf(...edges.shift());
      if (edge !== null) {
        return edge;
      }
    }
    return null;
  };
  let left = next(lefts);
  let right = next(rights);
  width = width < 0 ? Math.min(width, MIN_NEGATIVE_WIDTH) : Math.max(width, MIN_POSITIVE_WIDTH);
  if (left === null || right === null) {
    return;
  }
  const uStep = gradient(slope, top.u, mid.u, bottom.u, width);
  const vStep = gradient(slope, top.v, mid.v, bottom.v, width);
  const mem = m.mem;
  for (let y = top.y, row = dest + top.y * g.stride; y <= g.lastRow; y++, row += g.stride) {
    let xLeft = left.x >> 16;
    let xRight = right.x >> 16;
    let u = left.u >> 8;
    let v = left.v >> 8;
    if (xLeft <= g.lastLeft && xRight >= 0) {
      xRight = Math.min(xRight, g.lastRight);
      if (xLeft < 0) {
        u = (u + Math.imul(uStep, -xLeft)) | 0;
        v = (v + Math.imul(vStep, -xLeft)) | 0;
        xLeft = 0;
      }
      const count = xRight - xLeft + 1;
      if (count > 0 && y >= 0) {
        for (let i = 0, at = row + xLeft; i < count; i++, at++) {
          mem[at] = mem[texture + ((u & 0xff00) >> 8) + (v & 0xff00)];
          u = (u + uStep) | 0;
          v = (v + vStep) | 0;
        }
      }
    }
    left.count--;
    if (left.count <= 0) {
      left = next(lefts);
      if (left === null) {
        return;
      }
    } else {
      left.x = (left.x + left.xStep) | 0;
      left.u = (left.u + left.uStep) | 0;
      left.v = (left.v + left.vStep) | 0;
    }
    right.count--;
    if (right.count <= 0) {
      right = next(rights);
      if (right === null) {
        return;
      }
    } else {
      right.x = (right.x + right.xStep) | 0;
    }
  }
}

/**
 * 0x101293 / 0x1014be: the kaleidoscope. Triangle k has its corners at the centre and at `turn` + k pi / 6 and
 * `turn` + (k + 1) pi / 6, 380 pixels out; its texture corners are 158,158 and 127.5 along two mirror angles, which
 * swap after every triangle: neighbours are mirror images. Each triangle is drawn from the colour picture into
 * `dest` and from the height picture into the height map ([0x16e0b0]). The corners go through [0x16e0ac].
 * @param {Geometry} g
 */
function kaleidoscope(m, g, dest, turn, mirror) {
  const corners = allocated(m, CORNERS, CORNERS_SIZE);
  const radius = m.f64(RADIUS_A);
  const mirrorRadius = m.f64(MIRROR_RADIUS_A);
  const colour = m.u32(COLOUR_PICTURE);
  const height = m.u32(HEIGHT_PICTURE);
  const heightMap = allocated(m, HEIGHT_MAP, HEIGHT_MAP_SIZE);
  let mirrorA = mirror;
  let mirrorB = turn;
  let isSwapped = false;
  for (let k = 0; k < TRIANGLES; k++) {
    const from = turn + (k * m.f64(PI_A)) / m.f64(SIX_A);
    const to = turn + ((k + 1) * m.f64(PI_A)) / m.f64(SIX_A);
    const centre = { x: g.centreX, y: g.centreY, u: MIRROR_CENTRE, v: MIRROR_CENTRE };
    const first = {
      x: Math.trunc(Math.cos(from) * radius + g.centreX),
      y: Math.trunc(Math.sin(from) * radius + g.centreY),
      u: Math.trunc(Math.cos(mirrorA) * mirrorRadius),
      v: Math.trunc(Math.sin(mirrorA) * mirrorRadius),
    };
    const second = {
      x: Math.trunc(Math.cos(to) * radius + g.centreX),
      y: Math.trunc(Math.sin(to) * radius + g.centreY),
      u: Math.trunc(Math.cos(mirrorB) * mirrorRadius),
      v: Math.trunc(Math.sin(mirrorB) * mirrorRadius),
    };
    writeCorners(m, corners, [centre, first, second]);
    texturedTriangle(m, g, centre, first, second, dest, colour);
    texturedTriangle(m, g, centre, first, second, heightMap, height);
    isSwapped = !isSwapped;
    if (isSwapped) {
      [mirrorA, mirrorB] = [mirrorB, mirrorA];
    }
  }
}

/** The corners as the original leaves them at [0x16e0ac] (x, y, u, v dwords). */
function writeCorners(m, at, corners) {
  corners.forEach(({ x, y, u, v }, i) => {
    m.set32(at + i * 16, x);
    m.set32(at + i * 16 + 4, y);
    m.set32(at + i * 16 + 8, u);
    m.set32(at + i * 16 + 12, v);
  });
}

/**
 * 0x1016d9 (the screen: rows 1..198, columns 1..318) and 0x1017d7 (the texture: rows 1..169, columns 1..254, the
 * height map read with 256 bytes per row too): bump mapping. A pixel's slopes in the height map, less its distance
 * from the light, give 127 - |...| (at least 0) across and down; the light table makes a light of them and the
 * shade table the pixel's new colour. The light is at (lightX(t), lightY(t)).
 * @param {Geometry} g
 */
function bumpMap(m, g, dest, t) {
  const mem = m.mem;
  const heights = m.u32(HEIGHT_MAP);
  const light = m.u32(LIGHT);
  const stride = g.stride;
  const lightX = m.s32(LIGHT_PATH_X + ((t * 2) & LIGHT_PATH_MASK) * 4);
  const lightY = m.s32(LIGHT_PATH_Y + (t & LIGHT_PATH_MASK) * 4);
  for (let y = 1; y <= g.bumpRows; y++) {
    const dy = y - lightY;
    for (let x = 1; x <= g.bumpColumns; x++) {
      const at = y * stride + x;
      const across = mem[heights + at + 1] - mem[heights + at - 1];
      const nx = Math.max(0, LIGHT_MAX - Math.abs(across - (x - lightX)));
      const down = mem[heights + at + stride] - mem[heights + at - stride];
      const ny = Math.max(0, LIGHT_MAX - Math.abs(down - dy));
      mem[dest + at] = mem[SHADE_TABLE + mem[dest + at] * 0x100 + mem[light + nx * LIGHT_SIDE + ny]];
    }
  }
}

/** 0x101cf4: rows 1..198, columns 2..317 of the buffer to the screen (the rest stays black). */
function showBuffer(m, buffer) {
  for (let y = 1; y <= 0xc6; y++) {
    for (let x = 2; x < 2 + 0x9e * 2; x++) {
      m.vga.write(y * SCREEN_WIDTH + x, m.mem[buffer + y * SCREEN_WIDTH + x]);
    }
  }
}

/** 0x1018de: `steps` steps of the palette toward the pictures' palette, one unit per component per step. */
function fadeIn(m, steps) {
  for (let step = 0; step < steps; step++) {
    for (let i = 0; i < PALETTE_BYTES; i++) {
      if (m.u8(PALETTE + i) > m.u8(PICTURE_PALETTE + i)) {
        m.set8(PALETTE + i, m.u8(PALETTE + i) - 1);
      }
    }
  }
}

/**
 * The state the loops share: the angles (floats), the frame counter t (ebp), the noise buffers, the retrace
 * counter last seen.
 */
function createState() {
  return {
    turn: 0,
    mirror: new Float32Array(new Uint32Array([SECOND_ANGLE_START]).buffer)[0],
    t: 0,
    lastRetraces: 0,
    fadeRetraces: 0,
    noise: [],
  };
}

/** One retrace's animation step: 0x101d3c / 0x101faf. */
function stepAngles(m, state) {
  state.turn = Math.fround(state.turn + m.f32(FIRST_ANGLE_STEP));
  state.t++;
  state.mirror = Math.fround(state.mirror + m.f32(SECOND_ANGLE_STEP));
}

/** The retraces since the last frame ([esp+0x50]). */
function retracesPassed(m, state) {
  const now = m.u32(RETRACES);
  const passed = (now - state.lastRetraces) >>> 0;
  state.lastRetraces = now;
  return passed;
}

/** 0x101ace..0x101c44: everything before the first frame. */
function* setUp(m, state) {
  allocated(m, BUFFER, BUFFER_SIZE);
  allocated(m, CORNERS, CORNERS_SIZE);
  allocated(m, HEIGHT_MAP, HEIGHT_MAP_SIZE);
  m.set32(RAND_SEED, RECORDING_SEED);
  state.texture = m.malloc(0x10000); // [esp+0x4c], never cleared
  state.noise = makeNoise(m);
  m.mem.fill(WHITE, PALETTE, PALETTE + PALETTE_BYTES);
  yield* waitRetrace(m);
  setPalette(m, PALETTE);
  makeLightTable(m);
  makeLightPaths(m);
  state.lastRetraces = m.u32(RETRACES);
  m.readPlayStatus();
  m.mem.fill(0, m.u32(BUFFER), m.u32(BUFFER) + SCREEN_BYTES);
  for (let i = 0; i < SCREEN_BYTES; i++) {
    m.vga.write(i, 0);
  }
}

/** 0x101c7d..0x101da6: the kaleidoscope on the screen, until `lastPosition`. */
function* screenKaleidoscope(m, state, lastPosition) {
  const firstPosition = m.u32(POSITION);
  do {
    const buffer = m.u32(BUFFER);
    kaleidoscope(m, SCREEN_GEOMETRY, buffer, state.turn, state.mirror);
    blitSkipZero(m, m.u32(KALEIDOSKOP_TEXT), m.u32(HEIGHT_MAP), 0, TEXT_ROW, KALEIDOSKOP_TEXT_WIDTH, TEXT_ROWS);
    bumpMap(m, SCREEN_GEOMETRY, buffer, state.t);
    m.readPlayStatus();
    yield* waitRetrace(m);
    if (firstPosition === m.u32(POSITION)) {
      setPalette(m, PALETTE);
    }
    showBuffer(m, buffer);
    const passed = retracesPassed(m, state);
    for (let i = 1; i <= passed; i++) {
      const level = m.s32(BLACKOUT_LEVEL);
      if (level > 1) {
        m.set32(BLACKOUT_LEVEL, level - 2);
      }
      stepAngles(m, state);
    }
    if (firstPosition === m.u32(POSITION)) {
      // 0x101d81: passed / 2 steps (the odd retrace kept: see the top of the file)
      state.fadeRetraces += passed;
      fadeIn(m, state.fadeRetraces >> 1);
      state.fadeRetraces &= 1;
    }
  } while (lastPosition > m.u32(POSITION));
}

/** 0x101dbd..0x101e1a: object 0 is a box (0x109725) with the kaleidoscope as its texture, draw mode 11. */
function setUpBox(m, texture) {
  sub_10900c(m, 1);
  sub_109725(m, 0);
  sub_10af2c(m, 0, BOX_DRAW_MODE, BOX_SHADE_SCALE, 0, texture, 0);
  sub_109097(m, 0, 0);
  sub_10b278(m, 0, 0, LIGHT_Z);
  sub_10b21a(m, 0, 0, 0, BOX_START_Z, 0, 0, 0);
  sub_10b356(m, Z_CLEAR);
}

/** 0x10207f..0x1020cc: object 0 becomes the star from TOONTOWN.DAT, with the colour picture, draw mode 12. */
function setUpStar(m) {
  sub_109efc(m, 0);
  sub_1090b2(m, 0, STAR_OFFSET);
  sub_109097(m, 0, 0);
  sub_10b2ce(m, 0, 1);
  sub_10af2c(m, 0, STAR_DRAW_MODE, STAR_SHADE_SCALE, 0, m.u32(COLOUR_PICTURE), 0);
  sub_10b278(m, 0, 0, LIGHT_Z);
}

/**
 * 0x101e46 / 0x1020d1: the object's place and angles from `degrees` (z from 2 * degrees, mod 360). On a real x87
 * (80 bits) cos(300 degrees) * 300 + 752 and the like truncate one lower than in doubles (z at 135, 150, 315 and
 * 330 degrees, x and y at 300); the recording (DOSBox's FPU, in doubles) has the doubles' values, and so has the
 * port.
 */
function placeObject(m, degrees) {
  const pi = m.f64(PI_B);
  const halfTurn = m.f64(HALF_TURN);
  const twice = (degrees * 2) % DEGREES;
  const z = Math.trunc(Math.cos((twice * pi) / halfTurn) * m.f64(OBJECT_Z_AMPLITUDE) + m.f64(OBJECT_Z_CENTRE));
  const y = Math.trunc(Math.cos((degrees * pi) / halfTurn) * m.f64(OBJECT_Y_AMPLITUDE));
  const x = Math.trunc(Math.cos((degrees * pi) / halfTurn) * m.f64(OBJECT_X_AMPLITUDE));
  sub_10b21a(m, 0, x, y, z, degrees, degrees, degrees);
}

/**
 * 0x101e46..0x102079 (the box, `isFirst`: it holds still for the first rows) and 0x1020d1..0x1022e3 (the star):
 * the object over the noise, until `lastPosition`. The kaleidoscope texture is drawn in both, though the star does
 * not show it.
 */
function* objectFrames(m, state, lastPosition, isFirst) {
  const buffer = m.u32(BUFFER);
  do {
    placeObject(m, state.degrees);
    m.mem.copyWithin(buffer, state.noise[0], state.noise[0] + SCREEN_BYTES); // 0x100bcc
    kaleidoscope(m, TEXTURE_GEOMETRY, state.texture, state.turn, state.mirror);
    bumpMap(m, TEXTURE_GEOMETRY, state.texture, state.t);
    blitSkipZero(m, m.u32(KOLOR_TEXT), buffer, 0, TEXT_ROW, SCREEN_WIDTH, TEXT_ROWS);
    sub_10b055(m, buffer);
    m.readPlayStatus();
    yield* waitRetrace(m);
    showBuffer(m, buffer);
    const passed = retracesPassed(m, state);
    const row = m.u32(ROW);
    for (let i = 1; i <= passed; i++) {
      if (isFirst && state.holdPosition === m.u32(POSITION) && row < STILL_ROWS) {
        state.degrees--;
      }
      stepAngles(m, state);
      state.degrees++;
    }
    if (state.degrees > DEGREES) {
      state.degrees -= DEGREES;
    }
    if (state.noisePosition !== m.u32(POSITION)) {
      state.noiseRow = m.u32(ROW);
      state.noisePosition = m.u32(POSITION);
      state.noise.push(state.noise.shift());
    }
    if (state.noiseRow + NOISE_STILL_ROWS < m.u32(ROW)) {
      state.noise.push(state.noise.shift());
    }
  } while (lastPosition > m.u32(POSITION));
}

/**
 * 0x1019b1.
 * @param {Machine} m
 * @param {number} kaleidoscopeEnd the position the kaleidoscope runs up to (0x1c)
 * @param {number} lastPosition the position the part runs up to (0x20); the box turns until lastPosition - 1
 */
export function* kaleidoskop(m, kaleidoscopeEnd, lastPosition) {
  const state = createState();
  yield* setUp(m, state);
  yield* screenKaleidoscope(m, state, kaleidoscopeEnd);
  setUpBox(m, state.texture);
  state.noiseRow = m.u32(ROW);
  state.noisePosition = m.u32(POSITION);
  state.holdPosition = m.u32(POSITION);
  state.degrees = OBJECT_START_DEGREES;
  yield* objectFrames(m, state, lastPosition - 1, true);
  setUpStar(m);
  yield* objectFrames(m, state, lastPosition, false);
  sub_109efc(m, 0);
  sub_109083(m);
  return false;
}
