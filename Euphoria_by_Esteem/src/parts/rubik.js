// 0000:9178, 527.50 s: a Rubik's cube over res/34.pcx, scrambled off screen, solved on screen by
// replaying the moves backwards, then exploded. Notes: docs/disassembly/P07_parts_8768_9178.md
// "Part 0000:9178".
import { f32, int16 } from '../machine.js';
import { gradient, timedFade, fadeInFromBlack, remapRange } from '../gfx.js';
import { loadPicture } from '../picture.js';
import { PolyObject, Group } from '../engine3d.js';
import { partInit, mark, elapsed, frame, fps } from './common.js';

/** fps.txt: 70 changed frames per second over the whole loop (530-549). The motion is time based. */
const FRAME_SECONDS = fps(70);
/** DS:255e is 100 with EMS: the picture lives in page 102. */
const PICTURE_PAGE = 102;
const BACK_PAGE = 1;
const PICTURE = 0x23;
const PICTURE_SHIFT = 62;
const SCRAMBLE_MOVES = 15;
const QUARTER_TURN = 90;
const DROP_TICKS = 300;
const EXPLOSION_START = 1650;
const LAST_TICK = 2300;
const WHITE_FADE_TICKS = 50;
const PART_TICKS = 2700;
/** cs:915a / cs:8e85 float80 1.1: the cubie spacing factor (20 * 1.1 = 22). */
const SPACING = 1.1;
const CUBIE_SIZE = 20;
const FACE_COLORS = [
  [0, 0, 30, 0, 0, 60],
  [0, 30, 0, 0, 60, 0],
  [30, 0, 0, 60, 0, 0],
  [30, 30, 0, 60, 60, 0],
  [0, 30, 30, 0, 60, 60],
  [30, 0, 30, 60, 0, 60],
];
const FACE_COLOR_STEP = 10;

/** 0e5a:0929 Box.Init(sx, sy, sz, flags, colorStep, minColor, maxColor): six walls. */
function buildBox(engine, sx, sy, sz, flags, colorStep, minColor, maxColor) {
  const box = new PolyObject(engine, flags, minColor, maxColor);
  const hx = Math.trunc(sx / 2);
  const hy = Math.trunc(sy / 2);
  const hz = Math.trunc(sz / 2);
  box.setColorStep(colorStep);
  box.addWall('Z', -hx, -hy, hx, -hy, -hz, hz);
  box.addWall('Z', hx, hy, hx, -hy, hz, -hz);
  box.addWall('Z', hx, hy, -hx, hy, -hz, hz);
  box.addWall('Z', -hx, hy, -hx, -hy, -hz, hz);
  box.addWall('X', -hy, hz, hy, hz, -hx, hx);
  box.addWall('X', hy, -hz, -hy, -hz, -hx, hx);
  return box;
}

/** grid[X][Y][Z] (1..3 each) = id of the cubie in that cell. */
function newGrid() {
  return [0, 1, 2, 3].map(() => [0, 1, 2, 3].map(() => [0, 0, 0, 0]));
}

/** id 1..27 for home cell (i, j+1, k+1). */
function cubieId(i, j, k) {
  return (k * 9 + j * 3 + i) & 0xff;
}

/** 0000:8e8f: 27 cubies, each face cycling through its own 10 colours, in one group. */
function buildCubes(engine, cube, grid) {
  const group = new Group(engine);
  for (let k = 0; k <= 2; k++) {
    for (let j = 0; j <= 2; j++) {
      for (let i = 1; i <= 3; i++) {
        const id = cubieId(i, j, k);
        const c = buildBox(engine, CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE, 1, FACE_COLOR_STEP, 1, 60);
        cube[id] = c;
        c.faces.forEach((face, f) => {
          face.minColor = 1 + f * FACE_COLOR_STEP;
          face.maxColor = FACE_COLOR_STEP + f * FACE_COLOR_STEP;
        });
        c.moveTo(f32((i - 2) * 20 * SPACING), f32((j - 1) * 20 * SPACING), f32((k - 1) * 20 * SPACING));
        c.setPivot(0, 0, 0);
        grid[i][j + 1][k + 1] = id;
        group.addMesh(c);
      }
    }
  }
  return group;
}

/** 0000:8dfa */
function cubePalette(m) {
  m.gradStep = 0xffb0;
  FACE_COLORS.forEach((rgb, f) => {
    gradient(m, 1 + f * FACE_COLOR_STEP, FACE_COLOR_STEP + f * FACE_COLOR_STEP, ...rgb);
  });
}

/** Each cell takes the value of the next one; the last takes the first's. */
function cycleCells(get, set, cells) {
  const first = get(...cells[0]);
  for (let n = 0; n < cells.length - 1; n++) {
    set(...cells[n], get(...cells[n + 1]));
  }
  set(...cells[cells.length - 1], first);
}

const EDGES_X = [[1, 2], [2, 1], [3, 2], [2, 3]];
const CORNERS_X = [[1, 1], [3, 1], [3, 3], [1, 3]];
const EDGES_Y = [[2, 1], [1, 2], [2, 3], [3, 2]];
const CORNERS_Y = [[1, 1], [1, 3], [3, 3], [3, 1]];

/** 0000:878e: one quarter turn of a slice of the grid. */
function rotateGrid(grid, fx, fy, fz, lx, ly, lz) {
  if (fx === 1) {
    const get = (y, z) => grid[lx][y][z];
    const set = (y, z, v) => {
      grid[lx][y][z] = v;
    };
    cycleCells(get, set, EDGES_X);
    cycleCells(get, set, CORNERS_X);
  }
  if (fy === 1) {
    const get = (x, z) => grid[x][ly][z];
    const set = (x, z, v) => {
      grid[x][ly][z] = v;
    };
    cycleCells(get, set, EDGES_Y);
    cycleCells(get, set, CORNERS_Y);
  }
  if (fz === 1) {
    const get = (x, y) => grid[x][y][lz];
    const set = (x, y, v) => {
      grid[x][y][lz] = v;
    };
    cycleCells(get, set, EDGES_X);
    cycleCells(get, set, CORNERS_X);
  }
}

/** 1342:02be AddAngles, one component. */
function addAngle(a, d) {
  let v = f32(a + d);
  if (v > 360) {
    v = f32(v - 360);
  }
  if (v < 0) {
    v = f32(360 - v);
  }
  return v;
}

/** 0000:8ab9: turns slice `move` (1..9) by `delta` degrees (its low byte, signed). Returns true when the turn is complete. */
function turn(state, move, delta) {
  const { cube, grid, acc } = state;
  const d = (delta << 24) >> 24;
  const f = [0, 0, 0];
  const l = [0, 0, 0];
  const axis = Math.trunc((move - 1) / 3);
  f[axis] = 1;
  l[axis] = move - axis * 3;
  const [fx, fy, fz] = f;
  const [lx, ly, lz] = l;
  for (let a = 1; a <= 3; a++) {
    for (let b = 1; b <= 3; b++) {
      for (let c = 1; c <= 3; c++) {
        if ((lz === a || lz === 0) && (ly === b || ly === 0) && (lx === c || lx === 0)) {
          cube[grid[c][b][a]].rotate(int16(d * fx), int16(d * fy), int16(d * fz));
        }
      }
    }
  }
  acc[0] = addAngle(acc[0], Math.abs(int16(d * fx)));
  acc[1] = addAngle(acc[1], Math.abs(int16(d * fy)));
  acc[2] = addAngle(acc[2], Math.abs(int16(d * fz)));
  if (acc[0] - 90 === 1 - fx || acc[1] - 90 === 1 - fy || acc[2] - 90 === 1 - fz) {
    rotateGrid(grid, fx, fy, fz, lx, ly, lz);
    if (d < 0) {
      rotateGrid(grid, fx, fy, fz, lx, ly, lz);
      rotateGrid(grid, fx, fy, fz, lx, ly, lz);
    }
    acc.fill(0);
    return true;
  }
  return false;
}

/** 15 random quarter turns, never the same axis twice in a row (hist[0] is the loop byte, 1). */
function scramble(m, state) {
  const hist = [1];
  for (let n = 1; n <= SCRAMBLE_MOVES; n++) {
    let r;
    do {
      r = m.random(9) + 1;
    } while (r === hist[n - 1] || Math.trunc((hist[n - 1] - 1) / 3) === Math.trunc((r - 1) / 3));
    hist[n] = r;
    turn(state, r, -QUARTER_TURN);
  }
  return hist;
}

/** The explosion: cubies fly apart and toward the camera, the group drifts down. */
function explode(cube, group, e) {
  for (let kz = 0; kz <= 2; kz++) {
    for (let jy = 0; jy <= 2; jy++) {
      for (let ix = 1; ix <= 3; ix++) {
        const c = cube[cubieId(ix, jy, kz)];
        c.moveTo(
          f32((ix - 2) * 20 * SPACING + Math.imul(ix - 2, e) / 3),
          f32((jy - 1) * 20 * SPACING + Math.imul(jy - 1, e) / 3),
          f32((kz - 1) * 20 * SPACING + Math.imul(kz - 1, e) / 3),
        );
        c.setPivot(0, 0, 0);
      }
    }
  }
  group.moveTo(0, f32(e / 5), f32(Math.imul(Math.imul(e, e), e) / 300000));
}

/** 0000:9178 */
export function* rubikPart(m) {
  const partStart = partInit(m);
  gradient(m, 0, 255, 0, 0, 0, 0, 0, 0);
  m.lockPalette();
  loadPicture(m, PICTURE_PAGE, PICTURE);
  remapRange(m, PICTURE_PAGE, 0, 192, PICTURE_SHIFT);
  const picturePalette = m.palette.slice();
  const cube = [];
  const grid = newGrid();
  const group = buildCubes(m.engine, cube, grid);
  cubePalette(m);
  m.setPaletteRange(62, 255, picturePalette);
  m.setColor(0, 0, 0, 0);
  const state = { cube, grid, acc: [0, 0, 0] };
  const hist = scramble(m, state);
  m.setActivePage(BACK_PAGE);
  let left = SCRAMBLE_MOVES;
  let cur = 0;
  let prev = 0;
  m.copyPage(PICTURE_PAGE, BACK_PAGE);
  m.present();
  yield* fadeInFromBlack(m, 100);
  const loopStart = mark(m);
  let t;
  do {
    t = elapsed(m, loopStart);
    m.copyPage(PICTURE_PAGE, BACK_PAGE);
    if (t <= DROP_TICKS) {
      group.moveTo(0, f32(300 - (t * 300) / 300), 0);
      group.setPivot(0, 0, 0);
    } else if (left > 0) {
      if (left === SCRAMBLE_MOVES) {
        group.moveTo(0, 0, 0);
      }
      cur = int16(t - DROP_TICKS - int16((SCRAMBLE_MOVES - left) * QUARTER_TURN));
      if (Math.abs(int16(QUARTER_TURN - cur)) < Math.abs(int16(cur - prev))) {
        cur = QUARTER_TURN;
      }
      const isTurnDone = turn(state, hist[left], (cur - prev) & 0xff);
      prev = cur % QUARTER_TURN;
      if (isTurnDone) {
        left--;
      }
    } else {
      m.gradStep = 0;
      explode(cube, group, t - EXPLOSION_START);
    }
    group.rotateWork(f32(t / 2), f32(t / 2), f32(t / 3));
    group.draw();
    m.present();
    yield* frame(m, FRAME_SECONDS);
  } while (!(t > LAST_TICK));
  yield* timedFade(m, 0, 255, 1, 1, 1, 64, WHITE_FADE_TICKS);
  m.freePage(PICTURE_PAGE);
  m.freePage(BACK_PAGE);
  const remaining = PART_TICKS - elapsed(m, partStart);
  yield* timedFade(m, 0, 255, -1, -1, -1, 128, remaining);
  m.getPage(0).fill(0, 0, 64000);
}
