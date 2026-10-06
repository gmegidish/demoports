// The end: a flight along a tube built in code, with the credits and greetings popping up at
// random places and everything smeared by a 50% feedback blur.
// KAHN.EXE 0x175d1 (build the tube), 0x17c93 (camera), 0x18286 (load), 0x18396 (run), 0x18310 (draw).

import { PALETTE_BYTES, SCREEN_BYTES, WIDTH, HEIGHT, showBuffer, clearBuffer } from '../machine.js';
import { createScene, createMesh, createFace, computeNormals, WORLD_MESH, NODE_MESH, FACE_AFFINE } from '../engine/scene.js';
import { createTrack, addKey, prepareTangents, evaluate } from '../engine/track.js';
import { asin, KAHN_PI } from '../engine/math.js';
import { engine, cullAndSort, toViewSpace } from '../engine/frame.js';
import { view } from '../engine/triangle.js';
import { drawFaceAffine } from '../engine/faces.js';
import { loadPicture } from '../engine/pictures.js';
import { buildAverageTable, blendBuffers } from '../tables.js';
import { drawTextShadowed } from '../font.js';
import { TICKS, loaderLog, stepFadeIn, drawSortedFaces } from './common.js';

const f = Math.fround;

const CONTROL_POINTS = 100;
const SAMPLES_PER_SEGMENT = 5;
const RINGS = CONTROL_POINTS * SAMPLES_PER_SEGMENT;
/** Eight points are computed per ring, but each ring only advances seven vertices. */
const POINTS_PER_RING = 8;
const VERTICES_PER_RING = 7;
const VERTEX_COUNT = RINGS * VERTICES_PER_RING;
const TUBE_RADIUS = 200.0;
const WALK_STEP = 12000;
const NO_TCB = [0, 0, 0, 0, 0];
const TWO_PI = 6.283185374;
/** Direction of the first and last ring, which have no neighbour to difference against. */
const END_DIRECTION = [0.7, 0.2, 0.5];

/** Spline keys per tick: the camera covers 0.45 control points a second. */
const PATH_SPEED = 0.0045;
const LOOK_BEHIND = -0.1;
const LOOK_AHEAD = 0.45;
/** The camera rides this far along its own up axis from the path. */
const CAMERA_LIFT = 500;
/** Half the field of view: 24.5 degrees. */
const HALF_FOV = 0.4276056712861111;
const PIXEL_ASPECT = 0.75;

const LINE_TICKS = TICKS * 2;
const TEXT_COLOUR = 0x9d;
/** Cursors of the path move one key per evaluation; after a jump in time this many catch it up. */
const SETTLE_PASSES = 120;

const LINES = [
  'The Quest of Kahn', 'Thank you for your Time', 'An Immortals Production 1997', 'This is the end-jumper',
  'Sudden and un-censored messages', 'may appear, so bWARE', 'Code by', 'Kombat', 'Rage', 'Graphix by', 'Thor',
  'Music by', 'Dark Spirit', 'Party version Crashed, haha', 'It crashed on the party computer btw',
  'push (Greets to...) pop', 'Y.o.E', 'Cyborg (baaaaaaah)', 'w8, Y.o.e are good ppl', 'they deserve 2 greets',
  'B.s.P', 'B.s.p are also very good ppl', '10x to Miki/bsp who helped', 'with the messages, wrath of kahn',
  'Magic Intros', 'Falcor', 'The tall guy from Falcor, call me', 'Spirit of Art',
  // Two lines in the source; a missing comma made them one.
  'Cracky, Mos 10x for mental supportDemo Took 1 Week Of Hard Work',
  'Flood', 'Flood demo rulez', '62m', 'yes, 62m will do a demo, some day', 'Fissure', 'very nice ppl too',
  '10x NightShadow for all you help', 'TRiP', 'You are good at MK3, almost like me :)', 'MunA Hunters',
  '10x Civax 4 help in Finland', 'Embryo', 'Original Design By Dark-Sprite', 'Emerge', 'NightD, U SUck',
  'Yesh Li Pil KOr-im Lo BOBO', 'Bobobobobobobobobobobobobobo', 'The Temple of Music', 'who are u guys',
  'alePh naaL', 'Math Demo Rulez', 'BNC', 'Adept/Paso/BSM', 'We dont greet sick ppl', 'Borzom prodcuTions',
  'now I understand the T joke', 'Design Was Raped By Kombat And Thor', 'Astroidea', 'NoooN',
  'The Romanian guy who raped a sheep', 'U RULE (baaaaaah)', 'Cubic and Seen', 'Gr8 ppl from Germany', 'Orange',
  'I only know Wog', 'Yes this is the Warcraft 2 Font', 'Trauma', 'Kombat likes Nitro Music',
  '10x Silvatar for font btw :)', 'DoomSDay', 'Taat 1997', 'If you dont know...', 'Taat means Tarzan Productions',
  'Thor insists that we greet Deathstar', 'Just 4 Claudia', 'uhh, hope u enjoyed Ritual',
  'See you at the Movement97', '10x for watching', 'IMMoRTaLS',
];

/** How long the part runs: it ends when the last line has had its two seconds. */
export const ROLLER_TICKS = LINES.length * LINE_TICKS;

function safeAsin(x) {
  if (x >= -1.0 && x <= 1.0) {
    return asin(x);
  }
  return 0.234;
}

/** A hundred points of a random walk, as two identical splines: one to build from, one to fly along. */
function createPaths(rand) {
  const build = createTrack();
  const flight = createTrack();
  const position = new Float32Array(3);
  const step = () => Math.trunc(((0x4000 - rand()) * WALK_STEP) / 16384);
  for (let i = 0; i < CONTROL_POINTS; i++) {
    // The original draws z, then y, then x.
    const dz = step();
    const dy = step();
    const dx = step();
    position[0] += dx;
    position[1] += dy;
    position[2] += dz;
    addKey(build, i, position, NO_TCB);
    addKey(flight, i, position, NO_TCB);
  }
  prepareTangents(build);
  prepareTangents(flight);
  return { build, flight };
}

/**
 * Rings of vertices around the path. The original writes a point's position one vertex before its
 * texture coordinates, so each ring's last point is overwritten by the next ring's first, the tube
 * becomes one spiral strip, and the texture sits a seventh of a turn off. Kept; only its two
 * writes outside the array are dropped.
 */
function placeRings(mesh, centres) {
  let vertex = -1;
  for (let ring = 0; ring < RINGS; ring++) {
    const centre = ring * 3;
    const direction = new Float32Array(3);
    if (ring === 0 || ring === RINGS - 1) {
      direction.set(END_DIRECTION);
    } else {
      direction[0] = centres[centre + 3] - centres[centre - 3];
      direction[1] = centres[centre + 4] - centres[centre - 2];
      direction[2] = centres[centre + 5] - centres[centre - 1];
    }
    const length = Math.sqrt(direction[0] * direction[0] + direction[1] * direction[1] + direction[2] * direction[2]);
    const yaw = -Math.atan2(direction[0], direction[2]);
    const pitch = safeAsin(direction[1] / length);

    for (let k = 0; k < POINTS_PER_RING; k++) {
      const angle = f((k * TWO_PI) / 7.0);
      const circleY = f(Math.sin(angle) * TUBE_RADIUS);
      const circleZ = f(Math.cos(angle) * TUBE_RADIUS);
      const x = f(-Math.sin(pitch) * circleY);
      const y = f(Math.cos(pitch) * circleY);
      if (vertex >= 0) {
        mesh.position[vertex * 3] = circleZ * Math.cos(yaw) + centres[centre] - x * Math.sin(yaw);
        mesh.position[vertex * 3 + 1] = centres[centre + 1] + y;
        mesh.position[vertex * 3 + 2] = circleZ * Math.sin(yaw) + centres[centre + 2] + x * Math.cos(yaw);
      }
      vertex++;
      if (vertex < VERTEX_COUNT) {
        mesh.uv[vertex * 2] = ring << 7;
        mesh.uv[vertex * 2 + 1] = (angle * f(128.0)) / KAHN_PI;
      }
    }
    vertex--;
  }
}

function buildTunnel(demo) {
  const { build, flight } = createPaths(demo.rand);

  const centres = new Float32Array(RINGS * 3);
  for (let i = 0; i < CONTROL_POINTS; i++) {
    for (let j = 0; j < SAMPLES_PER_SEGMENT; j++) {
      evaluate(build, f(j / 5 + i), centres, (i * SAMPLES_PER_SEGMENT + j) * 3, 3);
    }
  }

  const mesh = createMesh('Spline Object', 1000, VERTEX_COUNT);
  mesh.renderFlags = FACE_AFFINE;
  mesh.matrix.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  placeRings(mesh, centres);

  const texture = loadPicture(demo.machine, demo.assets, 'TEXTURES//roller1.GIF');
  // Two triangles per quad, straight through the vertex array.
  const quads = VERTEX_COUNT - 8;
  for (let q = 0; q < quads; q++) {
    for (const [a, b, c] of [[q, q + 1, q + 7], [q + 1, q + 8, q + 7]]) {
      const face = createFace(mesh, a, b, c, FACE_AFFINE);
      face.texture = texture;
      mesh.faces.push(face);
    }
  }
  computeNormals(mesh);
  // The camera is inside the tube.
  for (const face of mesh.faces) {
    face.normal[0] = -face.normal[0];
    face.normal[1] = -face.normal[1];
    face.normal[2] = -face.normal[2];
  }

  const scene = createScene();
  scene.world.push({ type: WORLD_MESH, object: mesh });
  scene.nodes.push({ type: NODE_MESH, id: 1000, object: mesh, tracks: new Array(5).fill(null), children: [] });
  flight.cursor = 0;
  return { scene, mesh, flight };
}

export function* loadRoller(demo) {
  const machine = demo.machine;
  yield* loaderLog(demo, 'building roller-coaster');
  const tunnel = buildTunnel(demo);
  // The tube's texture was the last picture loaded: the part plays in its palette.
  const palette = machine.palette.slice();
  yield* loaderLog(demo, 'transparecy table');
  const blurTable = buildAverageTable(machine.palette);
  const background = loadPicture(machine, demo.assets, 'textures\\roller2.gif', { showPalette: true });
  demo.roller = {
    ...tunnel, palette, blurTable, background,
    work: new Uint8Array(PALETTE_BYTES), isFadingIn: true,
    camera: { position: new Float32Array(3), matrix: new Float32Array(9) },
    line: 0, textX: 0, textY: 0,
  };
}

/** Camera on the path at t, looking from a little behind to a little ahead, then lifted. */
function placeCamera(part, t) {
  const path = part.flight;
  const { position, matrix } = part.camera;
  const ahead = new Float32Array(3);
  evaluate(path, f(t + LOOK_BEHIND), position, 0, 3);
  const cursor = path.cursor;
  evaluate(path, f(t + LOOK_AHEAD), ahead, 0, 3);
  path.cursor = cursor;
  ahead[0] -= position[0];
  ahead[1] -= position[1];
  ahead[2] -= position[2];
  const length = f(Math.sqrt(ahead[0] * ahead[0] + ahead[1] * ahead[1] + ahead[2] * ahead[2]));
  evaluate(path, t, position, 0, 3);

  const yaw = f(-Math.atan2(ahead[0], ahead[2]));
  const pitch = f(safeAsin(ahead[1] / length));
  const sy = f(Math.sin(yaw));
  const cy = f(Math.cos(yaw));
  const sp = f(Math.sin(pitch));
  const cp = f(Math.cos(pitch));
  matrix.set([cy, 0, sy, sy * sp, cp, -cy * sp, -sy * cp, sp, cy * cp]);
  position[0] += matrix[3] * CAMERA_LIFT;
  position[1] += matrix[4] * CAMERA_LIFT;
  position[2] += matrix[5] * CAMERA_LIFT;
}

function placeText(demo) {
  const part = demo.roller;
  part.textX = Math.trunc(demo.rand() / 0xccc) + 3;
  part.textY = Math.trunc(demo.rand() / 0xb0);
}

function drawRoller(demo) {
  const machine = demo.machine;
  const part = demo.roller;
  machine.bufferA.set(part.background.subarray(0, SCREEN_BYTES));
  drawSortedFaces(drawFaceAffine);
  // Buffer B is never cleared: every frame is averaged into what was there, text included.
  blendBuffers(machine.bufferB, machine.bufferA, part.blurTable);
  if (part.line < LINES.length) {
    drawTextShadowed(demo.font, machine.bufferB, part.textX, part.textY, LINES[part.line], TEXT_COLOUR);
  }
  showBuffer(machine, machine.bufferB);
}

export function* runRoller(demo) {
  const machine = demo.machine;
  const flightTimer = machine.timerA;
  const lineTimer = machine.timerB;
  const part = demo.roller;

  engine.scene = part.scene;
  engine.sorted = [];
  const tangent = f(Math.tan(HALF_FOV));
  view.scaleX = f((WIDTH * 0.5) / tangent);
  view.scaleY = f((HEIGHT * 0.5) / PIXEL_ASPECT / tangent);
  clearBuffer(machine.bufferB);
  placeText(demo);
  // The original zeroes both timers here. Keeping the few ticks the previous part overran, as
  // every other part does, lets a jump in time land in the right place.
  lineTimer.value = flightTimer.value;

  while (part.line < LINES.length) {
    stepFadeIn(machine, part, flightTimer.value);
    const t = f(flightTimer.value * PATH_SPEED);
    if (demo.isSettling) {
      demo.isSettling = false;
      for (let pass = 0; pass < SETTLE_PASSES; pass++) {
        placeCamera(part, t);
      }
      while (lineTimer.value > LINE_TICKS * 2) {
        lineTimer.value -= LINE_TICKS;
        part.line++;
        placeText(demo);
      }
      if (part.line >= LINES.length) {
        break;
      }
    }
    placeCamera(part, t);
    toViewSpace(part.mesh, part.camera);
    cullAndSort();
    drawRoller(demo);

    if (lineTimer.value > LINE_TICKS) {
      lineTimer.value -= LINE_TICKS;
      part.line++;
      placeText(demo);
    }
    yield;
  }
  flightTimer.value -= ROLLER_TICKS;
}
