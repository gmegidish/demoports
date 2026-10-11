// The screen shatter: the picture on VGA breaks into 532 jittered triangles (a 20x15 grid of quads,
// each cut in two) that tumble away, textured with the picture they came from. Shared by the end of
// part 5 (0x243a6, speed 0x78, mode 1), part 13 (0x1da10, speed 0x8c, mode 0) and part 15 (0x1dc1d,
// speed 0x8c, mode 1). Ports 0x16f20 setup (0x16c04 makeQuad, 0x169e4 launch), 0x168e8 one pass
// (0x16650 stepTri, 0x43450 rotate, 0x435e8 project), the run loops 0x17138 and 0x171a8, and the
// engine's affine textured triangle that draws the pieces: 0x43654 setup (0x43960 reset) with the
// edge function 0x439cc, span filler obj2 0x764a2, target set by 0x76a3c. The filler lives here
// rather than in src/engine/ so that it is ported exactly, with its stale-state quirks.
// See docs/disassembly/P14_ending.md §6, P3_skull.md §9, P11_maze_face.md.
//
// API
//   const shatter = createShatter(demo.image, machine.front, { speed, mode })
//       0x16f20: samples the screen now (call it when VGA holds the picture to break).
//       mode 0 = pieces fall (part 13), mode 1 = pieces fly at the viewer from (0,0,0xfa000).
//   yield* runShatter(demo, shatter, { lastIndex, background, pace, startFrame })
//       0x17138 (no background: the back buffer is cleared after each frame and VGA is cleared at the
//       end) or 0x171a8 (background = a 320x200 picture copied into the back buffer after each frame;
//       VGA keeps the last frame). Runs until sync entry lastIndex has passed. Draws into
//       demo.offscreen (0xe4d40), whose current content is the first frame's background.
//       pace: how many timer ticks a pass took in the recording (see PART_13_PACE); startFrame:
//       entryFrame of the entry that started it, so that seeks land on the same pass.
//   shatterPass(shatter, target) -> pixels written: one 0x168e8 step + draw, for custom loops.

import { frame, syncAdvance, SCREEN_BYTES } from './machine.js';

const WIDTH = 320;
const HEIGHT = 200;
const CENTRE_X = 160;
const CENTRE_Y = 100;

const GRID_COLUMNS = 20;
const GRID_ROWS = 15;
const GRID_POINTS = GRID_COLUMNS * GRID_ROWS;
/** Quads are made for grid points 0..279 except the last column. */
const QUAD_POINTS = GRID_POINTS - GRID_COLUMNS;
const COLUMN_DIVISOR = 19;
const ROW_DIVISOR = 14;
/** sic: the jitter skips grid row 5 instead of the last row 14. */
const UNJITTERED_ROW = 5;
const X_JITTER = 7;
const Y_JITTER = 6;
/** Pieces whose top-left corner is right of x = 128 take their texels from the right texture. */
const RIGHT_TEXTURE_FROM = 128;
const RIGHT_TEXTURE_SHIFT = 64;
const TEXTURE_BYTES = 0x10000;
const TEXTURE_ROW = 256;

/** [0x89f18] focal distance; positions are 16.10, so one unit at z = 0 is one pixel. */
const FOCAL = 0x100000;
const FIXED_SHIFT = 10;
/** [0x81234..0x8123c]: where mode 1 blows the pieces away from. */
const BLAST_Z = 0xfa000;
/** mode 0: vel.y = rand()%5 + ((2*c.y + 0x4b000) >> 5), so the low pieces fall faster. */
const FALL_BIAS = 0x4b000;
const ANGLE_MASK = 0x3ff;
/** 0x71054: dword sine table of obj2, 1024 per turn, x1024; cosine = 256 entries later. */
const SINE_TABLE = 0x71054;
const SINE_ENTRIES = 1280;
const QUARTER_TURN = 256;

/** Watcom rand 0x43413 seeded by srand(1) 0x43437. */
const RAND_MULTIPLIER = 0x41c64e6d;
const RAND_INCREMENT = 0x3039;

/** Edge tables 0x11283c (right edges) and 0x11683c (left edges); 0x43960 fills x with these. */
const TABLE_ROWS = 256;
const RIGHT_EMPTY = 0x82d48b00 | 0;
const LEFT_EMPTY = 0x7d2b7500;
/**
 * 0x43960 resets the row range to start at 200, and 0x439cc rejects an edge starting below row 200,
 * whatever the clip. The clip itself is [0x89f50] / [0x89f54] (demo.triangleRowClip): rows 0..200
 * until part 12's init sets 0..255 for good (parts 13 and 15 then fill rows past the screen, and
 * fewer triangles are skipped as off screen).
 */
const FIXED_BOTTOM = 200;
const DEFAULT_CLIP = { yMin: 0, yMax: 200 };

/**
 * How long a pass took in the recording: DOSBox is CPU bound here, so a pass (step, draw, wait for
 * the tick, copy) shows for ceil(baseTicks + pixels / pixelsPerTick) ticks, at least 1, where pixels
 * is what the pass wrote. Fitted on part 13 (demo.avi frames 24779..24872, every pass pixel-exact):
 * passes 1..6 (71584..49538 pixels) took 3 ticks, 7..28 (46166..12137) 2 ticks, the rest 1 tick.
 */
export const PART_13_PACE = { baseTicks: 0.6667, pixelsPerTick: 35890 };
/** The code's own rate: one pass per tick. */
export const ONE_PASS_PER_TICK = { baseTicks: 1, pixelsPerTick: Infinity };

function createRandom(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(state, RAND_MULTIPLIER) + RAND_INCREMENT) | 0;
    return (state >>> 16) & 0x7fff;
  };
}

/** C's int division: truncates toward zero. */
function div(a, b) {
  return Math.trunc(a / b);
}

function readSineTable(image) {
  const table = new Int32Array(SINE_ENTRIES);
  for (let i = 0; i < SINE_ENTRIES; i++) {
    table[i] = image.i32(SINE_TABLE + 4 * i);
  }
  return table;
}

/** 0x16f20, first half: two 256x256 textures, columns 0..255 and 64..319 of the screen's rows. */
function sampleTextures(screen) {
  const left = new Uint8Array(TEXTURE_BYTES);
  const right = new Uint8Array(TEXTURE_BYTES);
  for (let y = 0; y < HEIGHT; y++) {
    left.set(screen.subarray(y * WIDTH, y * WIDTH + TEXTURE_ROW), y * TEXTURE_ROW);
    right.set(screen.subarray(y * WIDTH + RIGHT_TEXTURE_SHIFT, y * WIDTH + WIDTH), y * TEXTURE_ROW);
  }
  return [left, right];
}

/** 15 rows x 20 columns, inner points jittered; X pair then Y pair of rand calls per point. */
function jitteredGrid(rand) {
  const xs = new Int32Array(GRID_POINTS);
  const ys = new Int32Array(GRID_POINTS);
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLUMNS; c++) {
      const k = r * GRID_COLUMNS + c;
      xs[k] = div(c * WIDTH, COLUMN_DIVISOR);
      if (c !== 0 && c !== GRID_COLUMNS - 1) {
        const a = rand() % X_JITTER;
        xs[k] += a - (rand() % X_JITTER);
      }
      ys[k] = div(r * HEIGHT, ROW_DIVISOR);
      if (r !== 0 && r !== UNJITTERED_ROW) {
        const a = rand() % Y_JITTER;
        ys[k] += a - (rand() % Y_JITTER);
      }
    }
  }
  return { xs, ys };
}

function createVertices(count) {
  return {
    x: new Int32Array(count), y: new Int32Array(count), z: new Int32Array(count),
    rx: new Int32Array(count), ry: new Int32Array(count), rz: new Int32Array(count),
    sx: new Int32Array(count), sy: new Int32Array(count),
    row: new Int32Array(count), column: new Int32Array(count),
  };
}

function createTriangles(count) {
  return {
    texture: new Array(count),
    vx: new Int32Array(count), vy: new Int32Array(count), vz: new Int32Array(count),
    ax: new Int32Array(count), ay: new Int32Array(count), az: new Int32Array(count),
    wx: new Int32Array(count), wy: new Int32Array(count), wz: new Int32Array(count),
  };
}

/** 0x16c04: two triangles (corners k,k+1,k+21 and k,k+20,k+21), each with its own three vertices. */
function makeQuad(shatter, grid, k, textures) {
  const isRight = grid.xs[k] > RIGHT_TEXTURE_FROM ? 1 : 0;
  const corners = [[k, k + 1, k + GRID_COLUMNS + 1], [k, k + GRID_COLUMNS, k + GRID_COLUMNS + 1]];
  const { vertices, triangles } = shatter;
  for (const triangle of corners) {
    const j = shatter.count++;
    triangles.texture[j] = textures[isRight];
    triangle.forEach((g, n) => {
      const v = 3 * j + n;
      vertices.x[v] = (grid.xs[g] - CENTRE_X) << FIXED_SHIFT;
      vertices.y[v] = (grid.ys[g] - CENTRE_Y) << FIXED_SHIFT;
      vertices.z[v] = 0;
      vertices.row[v] = grid.ys[g];
      vertices.column[v] = grid.xs[g] - RIGHT_TEXTURE_SHIFT * isRight;
    });
  }
}

function centroid(values, first) {
  return div(values[first] + values[first + 1] + values[first + 2], 3);
}

/** 0x169e4: velocity and spin of triangle j. */
function launch(shatter, j, rand) {
  const { vertices: v, triangles: t, speed, mode } = shatter;
  const cx = centroid(v.x, 3 * j);
  const cy = centroid(v.y, 3 * j);
  const cz = centroid(v.z, 3 * j);
  if (mode === 0) {
    t.vx[j] = rand() & 31;
    t.vz[j] = rand() & 63;
    t.vy[j] = (rand() % 5) + ((2 * cy + FALL_BIAS) >> 5);
    t.wx[j] = (rand() % 15) - 7;
    t.wy[j] = (rand() % 15) - 7;
    t.wz[j] = (rand() % 15) - 7;
    return;
  }
  const dx = cx;
  const dy = cy;
  const dz = cz - BLAST_Z;
  const squares = (Math.imul(dx >> 8, dx >> 8) + Math.imul(dy >> 8, dy >> 8) + Math.imul(dz >> 8, dz >> 8)) | 0;
  // fild, fsqrt, __CHP (chop); single precision as main set the x87 to 24 bits.
  const distance = Math.trunc(Math.fround(Math.sqrt(squares)));
  t.vx[j] = div(Math.imul(dx, speed), distance);
  t.vy[j] = div(Math.imul(dy, speed), distance);
  t.vz[j] = div(Math.imul(dz, speed), distance);
  t.wx[j] = (rand() % 11) - 5;
  t.wy[j] = (rand() % 13) - 6;
  t.wz[j] = (rand() % 11) - 5;
}

/**
 * 0x16f20: break `screen` (VGA now) into 532 triangles and launch them.
 * @param {object} image the program image (for the sine table 0x71054)
 * @param {Uint8Array} screen 320x200
 * @param {{speed: number, mode: number}} options [0x81240] and the launch mode
 */
export function createShatter(image, screen, { speed, mode }) {
  const rand = createRandom(1);
  const textures = sampleTextures(screen);
  const grid = jitteredGrid(rand);
  const capacity = 2 * QUAD_POINTS;
  const shatter = {
    speed,
    mode,
    sine: readSineTable(image),
    count: 0,
    vertices: createVertices(3 * capacity),
    triangles: createTriangles(capacity),
    edges: createEdgeState(),
  };
  for (let k = 0; k < QUAD_POINTS; k++) {
    if (k % GRID_COLUMNS !== GRID_COLUMNS - 1) {
      makeQuad(shatter, grid, k, textures);
    }
  }
  for (let j = 0; j < shatter.count; j++) {
    launch(shatter, j, rand);
  }
  return shatter;
}

/** 0x43450: the rotation matrix of angles (a, b, c), 1024 per turn, entries x1024. */
function rotationMatrix(sine, a, b, c) {
  const sa = sine[a];
  const ca = sine[a + QUARTER_TURN];
  const sb = sine[b];
  const cb = sine[b + QUARTER_TURN];
  const sc = sine[c];
  const cc = sine[c + QUARTER_TURN];
  const cbcc = Math.imul(cb, cc);
  const nscb = Math.imul(-sc, cb);
  return [
    ((Math.imul(cbcc, ca) >> 10) - Math.imul(sc, sa)) >> 10,
    ((Math.imul(cbcc, sa) >> 10) + Math.imul(sc, ca)) >> 10,
    Math.imul(-cc, sb) >> 10,
    ((Math.imul(nscb, ca) >> 10) - Math.imul(cc, sa)) >> 10,
    (Math.imul(cc, ca) + (Math.imul(nscb, sa) >> 10)) >> 10,
    Math.imul(sc, sb) >> 10,
    Math.imul(ca, sb) >> 10,
    Math.imul(sa, sb) >> 10,
    cb,
  ];
}

/** 0x16650: spin triangle j about its centroid and move it by its velocity. */
function stepTriangle(shatter, j) {
  const { vertices: v, triangles: t } = shatter;
  const first = 3 * j;
  const cx = centroid(v.x, first);
  const cy = centroid(v.y, first);
  const cz = centroid(v.z, first);
  const m = rotationMatrix(shatter.sine, t.ax[j], t.ay[j], t.az[j]);
  t.ax[j] = (t.ax[j] + t.wx[j]) & ANGLE_MASK;
  t.ay[j] = (t.ay[j] + t.wy[j]) & ANGLE_MASK;
  t.az[j] = (t.az[j] + t.wz[j]) & ANGLE_MASK;
  for (let k = first; k < first + 3; k++) {
    const x = (v.x[k] - cx) | 0;
    const y = (v.y[k] - cy) | 0;
    const z = (v.z[k] - cz) | 0;
    v.rx[k] = (((Math.imul(x, m[0]) + Math.imul(y, m[1]) + Math.imul(z, m[2])) | 0) >> FIXED_SHIFT) + cx;
    v.ry[k] = (((Math.imul(x, m[3]) + Math.imul(y, m[4]) + Math.imul(z, m[5])) | 0) >> FIXED_SHIFT) + cy;
    v.rz[k] = (((Math.imul(x, m[6]) + Math.imul(y, m[7]) + Math.imul(z, m[8])) | 0) >> FIXED_SHIFT) + cz;
    v.x[k] = x + cx + t.vx[j];
    v.y[k] = y + cy + t.vy[j];
    v.z[k] = z + cz + t.vz[j];
  }
}

/** 0x435e8: vertices behind the eye keep their previous screen position. */
function project(vertices, count) {
  for (let k = 0; k < count; k++) {
    if (vertices.rz[k] > -FOCAL) {
      const depth = (vertices.rz[k] + FOCAL) | 0;
      vertices.sx[k] = (div(vertices.rx[k] << FIXED_SHIFT, depth) + CENTRE_X) | 0;
      vertices.sy[k] = (div(vertices.ry[k] << FIXED_SHIFT, depth) + CENTRE_Y) | 0;
    }
  }
}

// ---- the engine's textured triangle (0x43654 + 0x439cc + 0x764a2) ----

/** Per row: x, texture row << 8 (+8), texture column << 8 (+0xc); [0x89f40]/[0x89f44] the row range. */
function createEdgeState() {
  const table = () => ({ x: new Int32Array(TABLE_ROWS), row: new Int32Array(TABLE_ROWS), column: new Int32Array(TABLE_ROWS) });
  return { right: table(), left: table(), top: 0, bottom: FIXED_BOTTOM, ...DEFAULT_CLIP };
}

/** 0x43960: forget the previous triangle's rows. */
function resetEdges(edges) {
  for (let y = edges.top; y < edges.bottom; y++) {
    edges.left.x[y] = LEFT_EMPTY;
    edges.right.x[y] = RIGHT_EMPTY;
  }
  edges.bottom = 0;
  edges.top = FIXED_BOTTOM;
}

/** 0x439cc: walk the edge p-q downwards into `table`, 8.8 x / row / column, clipped to the row clip. */
function walkEdge(edges, table, v, p, q) {
  let dy = (v.sy[q] - v.sy[p]) | 0;
  if (dy < 0) {
    [p, q] = [q, p];
    dy = -dy | 0;
  }
  if (dy === 0 || v.sy[p] > FIXED_BOTTOM || v.sy[q] < 0) {
    return;
  }
  const dx = div((v.sx[q] - v.sx[p]) << 8, dy);
  const drow = div((v.row[q] - v.row[p]) << 8, dy);
  const dcolumn = div((v.column[q] - v.column[p]) << 8, dy);
  let row = v.row[p] << 8;
  let column = v.column[p] << 8;
  let x = v.sx[p] << 8;
  let y = v.sy[p];
  let end = v.sy[q];
  if (y < edges.yMin) {
    const skipped = y - edges.yMin;
    row = (row - Math.imul(drow, skipped)) | 0;
    column = (column - Math.imul(dcolumn, skipped)) | 0;
    x = (x - Math.imul(skipped, dx)) | 0;
    y = 0;
    edges.top = 0;
  } else if (y < edges.top) {
    edges.top = y;
  }
  if (end > edges.yMax) {
    edges.bottom = edges.yMax;
    end = edges.yMax;
  } else if (end > edges.bottom) {
    edges.bottom = end;
  }
  for (; y < end; y++) {
    table.x[y] = x >> 8;
    table.row[y] = row;
    table.column[y] = column;
    x = (x + dx) | 0;
    row = (row + drow) | 0;
    column = (column + dcolumn) | 0;
  }
}

function isOffScreen(edges, v, k) {
  return (v.sx[k] >>> 0) >= WIDTH && (v.sy[k] >>> 0) >= edges.yMax;
}

/**
 * 0x43654: sort by y and walk the three edges into the right/left tables. A triangle with every
 * vertex both right of and below the screen (unsigned) is skipped without touching the tables, so
 * the span filler then redraws the previous triangle's rows with this triangle's texture (sic).
 */
function setupTriangle(edges, v, a, b, c) {
  if (isOffScreen(edges, v, a) && isOffScreen(edges, v, b) && isOffScreen(edges, v, c)) {
    return;
  }
  resetEdges(edges);
  const ids = [a, b, c];
  let low = 0;
  let high = 0;
  let minY = v.sy[a];
  let maxY = minY;
  for (let i = 1; i < 3; i++) {
    const y = v.sy[ids[i]];
    if (minY > y) {
      low = i;
      minY = y;
    } else if (maxY < y) {
      high = i;
      maxY = y;
    }
  }
  const middle = 3 - low - high;
  if (middle > 2) {
    return;
  }
  const top = ids[low];
  const mid = ids[middle];
  const bottom = ids[high];
  const bend = Math.imul((minY - v.sy[mid]) | 0, (v.sx[top] - v.sx[bottom]) | 0);
  const cross = Math.imul((minY - maxY) | 0, (v.sx[top] - v.sx[mid]) | 0);
  const [twoEdges, oneEdge] = cross > bend ? [edges.right, edges.left] : [edges.left, edges.right];
  walkEdge(edges, twoEdges, v, top, mid);
  walkEdge(edges, twoEdges, v, mid, bottom);
  walkEdge(edges, oneEdge, v, top, bottom);
}

function sext16(value) {
  return (value << 16) >> 16;
}

/**
 * 0x764a2: rows top..bottom (inclusive), each from the right edge leftwards, both ends included,
 * texel = texture[(row & ~0xff) | (column >> 8 & 0xff)], 16-bit steps. x = 320 is not clipped (it
 * lands on the next row's first pixel), x > 320 is clipped to 319. Returns the pixels written.
 */
function fillSpans(edges, texture, target) {
  let written = 0;
  for (let y = edges.top; y <= edges.bottom && edges.top < edges.bottom; y++) {
    let right = edges.right.x[y];
    let left = edges.left.x[y];
    if (right < 0 || left >= WIDTH || right - left <= 0) {
      continue;
    }
    const width = right - left;
    const drow = sext16(div((edges.left.row[y] - edges.right.row[y]) | 0, width));
    const dcolumn = sext16(div((edges.left.column[y] - edges.right.column[y]) | 0, width));
    let row = edges.right.row[y];
    let column = edges.right.column[y];
    if (right > WIDTH) {
      row = (row + sext16(Math.imul(right - WIDTH, drow))) | 0;
      column = (column + sext16(Math.imul(right - WIDTH, dcolumn))) | 0;
      right = WIDTH - 1;
    }
    if (left <= 0) {
      left = 0;
    }
    const line = y * WIDTH + left;
    for (let k = right - left; k >= 0; k--) {
      const at = ((row & ~0xff) | ((column >> 8) & 0xff)) >>> 0;
      if (line + k < SCREEN_BYTES) {
        target[line + k] = at < TEXTURE_BYTES ? texture[at] : 0;
      }
      row = (row + drow) | 0;
      column = (column + dcolumn) | 0;
    }
    // The pace models were fitted on the pixels that land on the screen; rows past it do not count.
    written += y < FIXED_BOTTOM ? right - left + 1 : 0;
  }
  return written;
}

/**
 * 0x168e8: step every triangle, project, draw them in creation order into `target`.
 * @returns the number of pixels written (for the pace model)
 */
export function shatterPass(shatter, target) {
  for (let j = 0; j < shatter.count; j++) {
    stepTriangle(shatter, j);
  }
  const v = shatter.vertices;
  project(v, 3 * shatter.count);
  let written = 0;
  for (let j = 0; j < shatter.count; j++) {
    setupTriangle(shatter.edges, v, 3 * j, 3 * j + 1, 3 * j + 2);
    written += fillSpans(shatter.edges, shatter.triangles.texture[j], target);
  }
  return written;
}

function passTicks(pace, pixels) {
  return Math.max(1, Math.ceil(pace.baseTicks + pixels / pace.pixelsPerTick));
}

/**
 * 0x17138 / 0x171a8: one pass per loop, each shown after the timer tick it waited for; the pace says
 * how many ticks a pass took. Passes due after a jump in time are run at once.
 * @param {{lastIndex: number, background?: Uint8Array, pace?: object, startFrame?: number}} options
 *   startFrame: the frame the first pass began at (default now); give the sync entry's frame
 *   (entryFrame) so that a seek into the shatter lands on the same pass
 */
export function* runShatter(demo, shatter, { lastIndex, background = null, pace = ONE_PASS_PER_TICK, startFrame }) {
  const m = demo.machine;
  const target = demo.offscreen;
  Object.assign(shatter.edges, demo.triangleRowClip ?? DEFAULT_CLIP);
  let due = startFrame ?? frame(m);
  while (syncAdvance(m) <= lastIndex) {
    due += passTicks(pace, shatterPass(shatter, target));
    while (frame(m) < due) {
      yield;
    }
    m.front.set(target);
    if (background) {
      target.set(background.subarray(0, SCREEN_BYTES));
    } else {
      target.fill(0);
    }
  }
  if (!background) {
    m.front.fill(0);
  }
}
