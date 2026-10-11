// Demo part 12: a necklace of six mechanical tunnel segments seen from outside; a hatch opens and
// the camera flies inside, where a chrome pod (a sphere reflecting the tunnel, two spikes) sits in
// the segment nearest the camera, lit by a wandering lightning streak; later the sphere gives way to
// a spinning tube lined with bump-mapped "flesh" while the irises at both ends open and close. The
// screen then falls away (0x28038). Ports init 0x19ae0 (clone 0x19794, lerp 0x189e8, shade table
// 0x17490), run 0x1a850 (environment pass, lightning 0x1a654) and deinit 0x1a528. Meshes:
// tunnelmeshes.js; material 6 and the lightning: tunnelchrome.js; material 0: tunnelflesh.js.
// See docs/disassembly/P12_tunnel.md.
//
// The original renders as fast as it can and uses the timer count at the start of each loop pass;
// the port renders every frame it shows, with the time a pass of the original would have read
// (RENDER_LAG_TICKS). The lightning, drawn with the previous pass's time, uses LIGHTNING_LAG_TICKS. Checked frame for frame against the real
// code run in unicorn with the same pass times (scratch tools: run_dump.py / drive.mjs).

import { frame, syncAdvance, entryFrame, setDac } from '../machine.js';
import { scale } from '../gfx.js';
import { sin, cos } from '../sine.js';
import { flyAway } from './flyaway.js';
import {
  createObject, CreateWorld, AddObject, ComputeBounds, SetRenderMode, SetCameraPos, SetCameraAngles,
  GetCameraPos, GetCameraAngles, SetObjPos, SetObjAngles, GetObjPos, GetObjAngles, RenderWorld,
  readCameraRecording, playCameraRecord, drawRoutine, generatePhongMap, createTriangleEngine,
  triangleSineTable, FLAG,
} from '../engine/index.js';
import {
  buildPod, buildSphere, buildTube, buildSegment, MINUS_IRIS, PLUS_IRIS, HATCH_A, HATCH_B, HATCH_A_FROM,
  HATCH_A_TO, HATCH_B_FROM, HATCH_B_TO, IRIS_DEPTH,
} from './tunnelmeshes.js';
import { drawChrome, createLightning, drawLightning } from './tunnelchrome.js';
import { buildBumpTable, createFleshRenderer, drawFlesh } from './tunnelflesh.js';

const WIDTH = 320;
const HEIGHT = 200;
/** The 320x200 buffers are 64 KB blocks; the chrome reads row 200 (bytes 64000..) for v >= 200. */
const BLOCK_BYTES = 0x10000;
const TEXTURE_BYTES = 0x10000;

/** camera_create(30, 1900, 2700, 2700); mode 3 = near clipping. */
const WORLD_SIZES = [30, 0x76c, 0xa8c, 0xa8c];
const RENDER_MODE = 3;
const CAMERA_START_ANGLES = [-256, 0, 0];
const CAMERA_START = [0, 4000, -12000];

/** Six segments on a circle of radius 257*24 in xz, 0x5555/65536 of a turn apart. */
const SEGMENTS = 6;
const RING_RADIUS = 24;
const SEGMENT_STEP = 0x5555;
const SEGMENT_ANGLE_SHIFT = 8;
const SEGMENT_TURN_SHIFT = 5;

/** 0x17490: 128 light rows; row 64 leaves a colour as it is, each 4 rows add or take one step. */
const SHADE_ROWS = 128;
const SHADE_TABLE_BYTES = 256 * 256;
const RAMP_MASK = 0xe0;
const RAMP_STEP_MASK = 31;
const SHADE_NEUTRAL = 16;
const SHADE_DARKEST = 4;

/** 0x314c0 parameters: (gamma, lo, hi, scale, base). Material 0's map is 256x256, the others 128. */
const FLESH_LIGHT_MAP = { exponent: 0.9, lo: 0, hi: 127, scale: 128.0, size: 256 };
const PHONG_MAP = [2.0, 0, 31, 32.0, 0];
const SPIKE_MAP = [2.0, 0, 7, 8.0, 0];
const SPIKE_AMBIENT = 0xf;

/** Run: sync entries counted from the part's first one (end = 0x12). */
const HATCH_ENTRY = 2;
const TUBE_ENTRY = 3;
const PLUS_IRIS_ENTRY = 4;
const LAST_ENTRY = 4;
const FALL_AWAY_ENTRY = 5;
/** Hatch and irises: a countdown of 256 ticks, the opening = sin(countdown) (512 per turn). */
const COUNTDOWN = 0x100;
const HATCH_SHUT_BELOW = 0x60;
/** Billboard: the sphere turned to face the camera, angle = 0x578 - atan2(dz, dx) * 2048 / pi. */
const SPHERE_PITCH = 0x400;
const SPHERE_YAW_BASE = 0x578;
const BILLBOARD_UNITS = 2048;
/** The tube spins about the sphere's axis by 4 units per tick. */
const TUBE_PITCH = 0x400;
const TUBE_SPIN_PER_TICK = 4;
const NEAREST_START = -0x40000000;
/** 0x28038(0x17, (0, -4, 0), (0, 0, 10)). */
const FALL_VELOCITY = [0, -4, 0];
const FALL_SPIN = [0, 0, 10];
/**
 * 0x1a654 is called first in each loop pass with the previous pass's time. DOSBox rendered phase B
 * every 2-4 ticks before the tube appears (demo.avi 285-306 s: mostly 3), so the port draws the
 * streak of 3 ticks before the frame it renders.
 */
const LIGHTNING_LAG_TICKS = 3;
/**
 * Timing against demo.avi: a frame shows the time its pass read when it began, RENDER_LAG_TICKS
 * before (DOSBox rendered every 2-4 ticks before the tube appears, 6-11 after: fitted 3 and 12).
 */
const RENDER_LAG_TICKS = { tunnel: 3, flesh: 12 };

/** t of a loop pass: ticks since the part's start, as of when the shown frame was begun. */
function passTime(m, clock) {
  return frame(m) - clock.t0 - clock.lag;
}

/** [0x89f54] = 255: init lets the triangle engine fill rows 0..255 (part 12's scratch is 256 rows). */
export const TUNNEL_TRIANGLE_ROWS = 255;

// --- init ------------------------------------------------------------------------------------------

/** 0x17490: T[row*256 + k] = (k & 0xe0) + clamp((k & 31) + (row >> 2) - 16): >31 -> 31, then <=4 -> 4. */
function buildShadeTable() {
  const table = new Uint8Array(SHADE_TABLE_BYTES);
  for (let row = 0; row < SHADE_ROWS; row++) {
    for (let k = 0; k < 256; k++) {
      let level = (k & RAMP_STEP_MASK) + (row >> 2) - SHADE_NEUTRAL;
      if (level > RAMP_STEP_MASK) {
        level = RAMP_STEP_MASK;
      }
      if (level <= SHADE_DARKEST) {
        level = SHADE_DARKEST;
      }
      table[row * 256 + k] = (k & RAMP_MASK) + level;
    }
  }
  return table;
}

/** 0x314c0 with N = 256 and a fractional exponent (the engine's generatePhongMap takes integer ones). */
function buildFleshLightMap() {
  const { exponent, lo, hi, scale: amount, size } = FLESH_LIGHT_MAP;
  const map = new Uint8Array(size * size);
  const half = size * 0.5;
  const denominator = half * 2 * half;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const squared = (x - half) * (x - half) + (y - half) * (y - half);
      const distance = Math.sqrt(squared / denominator);
      const k = Math.trunc(Math.pow(1 - distance, exponent) * amount);
      map[y * size + x] = Math.max(Math.min(k, hi), lo);
    }
  }
  return map;
}

function readTextures(archive) {
  const flesh = new Uint8Array(TEXTURE_BYTES);
  scale(archive.read('hy_txt1.raw'), 128, 128, flesh, 256, 256);
  const door = new Uint8Array(0x4000);
  const doorFile = archive.read('hy_door.raw');
  for (let y = 0; y < 64; y++) {
    door.set(doorFile.subarray(y * 64, y * 64 + 64), y * 256);
  }
  const ends = new Uint8Array(TEXTURE_BYTES);
  const endsFile = archive.read('hy_txt2.raw');
  ends.set(endsFile);
  ends.set(endsFile, endsFile.length);
  const lightMap = new Uint8Array(BLOCK_BYTES);
  scale(archive.read('cy_mirr.raw'), 160, 100, lightMap, WIDTH, HEIGHT);
  return {
    flesh,
    door,
    ends,
    wall: archive.read('hy_txt3.raw'),
    heights: archive.read('hy_bukt.raw'),
    lightMap,
  };
}

function material(fields) {
  return { ambient: 0, colourBase: 0, texture: null, phongMap: null, textureWidth: 0, textureHeight: 0, ...fields };
}

/** The 7 runtime materials at 0xd1ba8 (P12 §2.3), shared by every object. */
function buildMaterials(textures, environment, flesh) {
  const fleshMaterial = material({ texture: textures.flesh, phongMap: buildFleshLightMap(), heightMap: textures.heights, drawAddress: 0x19160 });
  fleshMaterial.draw = (polygon, context) => drawFlesh(flesh, polygon, context);
  const perspective = drawRoutine(0x36890);
  return [
    fleshMaterial,
    material({ texture: textures.ends, draw: perspective }),
    material({ phongMap: generatePhongMap(...PHONG_MAP), draw: drawRoutine(0x2c118) }),
    material({ texture: textures.wall, draw: perspective }),
    material({ phongMap: generatePhongMap(...SPIKE_MAP), ambient: SPIKE_AMBIENT, draw: drawRoutine(0x44354) }),
    material({ texture: textures.door, draw: perspective }),
    material({ texture: environment, phongMap: textures.lightMap, draw: drawChrome }),
  ];
}

/** 0x19794: a new header for the same mesh arrays, placed and turned, added to the render list. */
function cloneSegment(world, source, position, angles) {
  const clone = createObject({
    ...source,
    matrix: Int32Array.from(source.matrix),
    position: Int32Array.from(position),
    angles: Int16Array.from(angles),
    bbox: Int32Array.from(source.bbox),
    centre: Int32Array.from(source.centre),
  });
  AddObject(world, clone);
  return clone;
}

/** Segment k sits at angle 0x5555*k/65536 of a turn on the ring and is turned to follow it. */
function buildRing(world) {
  const first = buildSegment();
  SetObjPos(first, cos(0) * RING_RADIUS, 0, sin(0) * RING_RADIUS);
  SetObjAngles(first, [0, 0, 0]);
  AddObject(world, first);
  const segments = [first];
  for (let k = 1; k < SEGMENTS; k++) {
    const e = SEGMENT_STEP * k;
    const a = e >> SEGMENT_ANGLE_SHIFT;
    const angles = GetObjAngles(first);
    angles[1] += -(e >> SEGMENT_TURN_SHIFT);
    segments.push(cloneSegment(world, first, [cos(a) * RING_RADIUS, 0, sin(a) * RING_RADIUS], angles));
  }
  return segments;
}

function buildScene(demo, materials) {
  const world = CreateWorld(...WORLD_SIZES);
  const pod = buildPod(demo.image);
  const sphere = buildSphere();
  const tube = buildTube();
  pod.child = sphere;
  sphere.child = tube;
  sphere.next = null;
  tube.next = null;
  AddObject(world, pod);
  SetObjAngles(pod, [0, 0, 0]);
  SetObjPos(pod, 0xc00, 0, 0);
  const segments = buildRing(world);
  for (const object of [pod, sphere, tube, ...segments]) {
    object.materials = materials;
  }
  ComputeBounds(world);
  SetRenderMode(world, RENDER_MODE);
  SetCameraAngles(world, CAMERA_START_ANGLES);
  SetCameraPos(world, ...CAMERA_START);
  return { world, pod, sphere, tube, segments, mesh: segments[0] };
}

// --- run helpers -------------------------------------------------------------------------------------

/** 0x189e8: (A*(256-f) + B*f) >> 8 per component. */
function lerp(a, b, f) {
  return [0, 1, 2].map((k) => (Math.imul(a[k], 256 - f) + Math.imul(b[k], f)) >> 8);
}

function pointOf(points, i) {
  return [points[3 * i], points[3 * i + 1], points[3 * i + 2]];
}

/** The hatch quad 10-11-19-18: 96 and 97 slide open by sin(countdown). */
function setHatch(mesh, opening) {
  const p = mesh.points;
  p.set(lerp(pointOf(p, HATCH_A_FROM), pointOf(p, HATCH_A_TO), opening), 3 * HATCH_A);
  p.set(lerp(pointOf(p, HATCH_B_FROM), pointOf(p, HATCH_B_TO), opening), 3 * HATCH_B);
}

/** An iris: its 8 centre points move from the axis at z = depth towards the ring at `rim`. */
function setIris(mesh, centre, rim, depth, opening) {
  const p = mesh.points;
  for (let k = 0; k < 8; k++) {
    p.set(lerp([0, 0, depth], pointOf(p, rim + k), opening), 3 * (centre + k));
  }
}

function dot(a, b) {
  return (Math.imul(a[0], b[0]) + Math.imul(a[1], b[1]) + Math.imul(a[2], b[2])) | 0;
}

/** The segment whose centre has the largest dot product with the camera position, and the next one. */
function nearestSegments(segments, camera) {
  let best = 0;
  let bestDot = dot(GetObjPos(segments[0]), camera);
  for (let i = 1; i < SEGMENTS; i++) {
    const d = dot(GetObjPos(segments[i]), camera);
    if (d > bestDot) {
      best = i;
      bestDot = d;
    }
  }
  let second = -1;
  let secondDot = NEAREST_START;
  for (let i = 0; i < SEGMENTS; i++) {
    const d = dot(GetObjPos(segments[i]), camera);
    if (i !== best && d > secondDot) {
      second = i;
      secondDot = d;
    }
  }
  return [best, second];
}

/** fpatan(dz, dx) * 2048 / pi (x87 extended), fistp (nearest, ties to even). */
function billboardAngle(dz, dx) {
  const turned = (Math.atan2(dz, dx) * BILLBOARD_UNITS) / Math.PI;
  const r = Math.round(turned);
  return r - turned === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/**
 * The environment pass (P12 §4): the sphere turned towards the camera, then the world rendered from
 * the pod's centre, roll dropped, with the walls affine (0x331b4), into the sphere's own image.
 */
function renderEnvironment(state, best) {
  const { world, sphere, segments } = state.scene;
  const camera = GetCameraPos(world);
  const centre = GetObjPos(segments[best]);
  const angle = billboardAngle(camera[2] - centre[2], camera[0] - centre[0]);
  SetObjAngles(sphere, [SPHERE_PITCH, (SPHERE_YAW_BASE - angle) << 16 >> 16, 0]);
  const angles = GetCameraAngles(world);
  SetCameraPos(world, ...centre);
  SetCameraAngles(world, [angles[0], angles[1], 0]);
  const [, ends, , wall] = state.materials;
  const perspective = wall.draw;
  ends.draw = wall.draw = drawRoutine(0x331b4);
  RenderWorld(world, { target: state.environment, colourTable: state.shade });
  ends.draw = wall.draw = perspective;
  SetCameraPos(world, ...camera);
  SetCameraAngles(world, angles);
}

/** A countdown started at a sync edge; after a seek it starts as late as the entry passed. */
function startCountdown(demo, entry, previousFrame) {
  return COUNTDOWN - Math.max(0, previousFrame - entryFrame(demo.machine, entry));
}

function countDown(countdown, dt) {
  return Math.max(countdown - dt, 0);
}

function setSegmentFlags(segments, change) {
  for (const segment of segments) {
    segment.flags = change(segment.flags) >>> 0;
  }
}

// --- run ---------------------------------------------------------------------------------------------

/**
 * The loop at the start of 0x1a850 clears 256 entries of D1750 (0xd1750), a table of 200 rows. The
 * 224 bytes past it hold the pod's corner normals (0xd1a70, 14 points) and the start of its face
 * normals (0xd1b18): all corner normals and the face normals of faces 0..3 and the x of face 4
 * become 0 (sic). The spikes then show the phong map's centre plus the faces' flat term.
 */
const CLEARED_END = 0xd1750 + 0x400;
const POD_FACE_NORMALS = 0xd1b18;

function clobberPodNormals(pod) {
  pod.cornerNormals.fill(0);
  pod.faceNormals.fill(0, 0, (CLEARED_END - POD_FACE_NORMALS) / 4);
}

/** Phase A: outside the ring, the back buffer cleared after each frame; ends when the hatch has shut. */
function* outside(demo, state, clock) {
  const m = demo.machine;
  const { world, segments, mesh } = state.scene;
  const end = state.end;
  let hatch = 0;
  let isHatchStarted = false;
  for (;;) {
    const now = passTime(m, clock);
    const dt = now - clock.t;
    clock.t = now;
    clock.s = syncAdvance(m);
    playCameraRecord(world, state.camera, clock.t);
    RenderWorld(world, { target: state.back, colourTable: state.shade });
    m.front.set(state.back);
    state.back.fill(0);
    yield;
    if (!isHatchStarted && clock.s >= end + HATCH_ENTRY) {
      isHatchStarted = true;
      setSegmentFlags(segments, (f) => f | FLAG.NO_BACKFACE_CULL);
      hatch = startCountdown(demo, end + HATCH_ENTRY, clock.t0 + clock.t - dt);
    }
    if (hatch !== 0) {
      hatch = countDown(hatch, dt);
      setHatch(mesh, sin(hatch));
      if (hatch < HATCH_SHUT_BELOW) {
        setHatch(mesh, sin(0));
        setSegmentFlags(segments, (f) => f & ~FLAG.NO_BACKFACE_CULL);
        return;
      }
    }
  }
}

/** Phase B: inside; the pod follows the nearest segment, the back buffer is not cleared. */
function* inside(demo, state, clock) {
  const m = demo.machine;
  const { world, pod, sphere, tube, segments, mesh } = state.scene;
  const end = state.end;
  pod.flags &= ~FLAG.HIDDEN;
  sphere.flags &= ~FLAG.HIDDEN;
  setSegmentFlags(segments, (f) => f | FLAG.INVERT_BACKFACE);
  let isEnvironmentOn = true;
  let plusIris = 0;
  let minusIris = 0;
  let hasPlusStarted = false;
  let hasTubeStarted = false;
  while (clock.s <= end + LAST_ENTRY) {
    const now = passTime(m, clock);
    const dt = now - clock.t;
    clock.t = now;
    drawLightning(state.lightning, state.lightMap, clock.t - state.lightningLagTicks);
    const previousFrame = clock.t0 + clock.t - dt;
    clock.s = syncAdvance(m);
    playCameraRecord(world, state.camera, clock.t);
    const [best, second] = nearestSegments(segments, GetCameraPos(world));
    SetObjPos(pod, ...GetObjPos(segments[best]));
    segments.forEach((segment, i) => {
      segment.flags = (i === best || i === second ? segment.flags & ~FLAG.HIDDEN : segment.flags | FLAG.HIDDEN) >>> 0;
    });
    SetObjAngles(pod, GetObjAngles(segments[best]));
    SetObjAngles(tube, [TUBE_PITCH, (clock.t * TUBE_SPIN_PER_TICK) << 16 >> 16, 0]);
    if (!hasPlusStarted && clock.s >= end + PLUS_IRIS_ENTRY) {
      plusIris = startCountdown(demo, end + PLUS_IRIS_ENTRY, previousFrame);
      hasPlusStarted = true;
    }
    if (plusIris !== 0) {
      plusIris = countDown(plusIris, dt);
      setIris(mesh, PLUS_IRIS, 56, IRIS_DEPTH, sin(plusIris));
    }
    if (!hasTubeStarted && clock.s >= end + TUBE_ENTRY) {
      hasTubeStarted = true;
      sphere.flags |= FLAG.HIDDEN;
      SetObjAngles(sphere, [0, 0, 0]);
      tube.flags &= ~FLAG.HIDDEN;
      minusIris = startCountdown(demo, end + TUBE_ENTRY, previousFrame);
      isEnvironmentOn = false;
      clock.lag = state.timing.lag.flesh;
    }
    if (minusIris !== 0) {
      minusIris = countDown(minusIris, dt);
      setIris(mesh, MINUS_IRIS, 0, -IRIS_DEPTH, sin(minusIris));
    }
    if (isEnvironmentOn) {
      renderEnvironment(state, best);
    }
    RenderWorld(world, { target: state.back, colourTable: state.shade });
    m.front.set(state.back);
    yield;
  }
}

export const tunnel = {
  /** 0x19ae0: textures, tables, the meshes, the world, the camera recording. */
  init(demo) {
    // [0x89f50] = 0, [0x89f54] = 255: never restored, later users of the triangle engine see it.
    demo.triangleRowClip = { yMin: 0, yMax: TUNNEL_TRIANGLE_ROWS };
    setDac(demo.machine, demo.archive.read('hy_pal.col'));
    const textures = readTextures(demo.archive);
    const sine = triangleSineTable(demo.image);
    const engine = createTriangleEngine(sine);
    engine.yMin = demo.triangleRowClip.yMin;
    engine.yMax = demo.triangleRowClip.yMax;
    const flesh = createFleshRenderer(engine, sine, buildBumpTable(textures.heights));
    const environment = new Uint8Array(BLOCK_BYTES);
    const materials = buildMaterials(textures, environment, flesh);
    return {
      shade: buildShadeTable(),
      environment,
      lightMap: textures.lightMap,
      materials,
      scene: buildScene(demo, materials),
      camera: readCameraRecording(demo.archive.read('hy_cam.rec')),
      back: demo.offscreen,
      lightningLagTicks: LIGHTNING_LAG_TICKS,
      timing: { lag: RENDER_LAG_TICKS },
      end: 0,
    };
  },

  /** 0x1a850(end = 0x12): the outside, the inside, then the fall-away until entry end + 5. */
  *run(demo, state, end) {
    const m = demo.machine;
    state.end = end;
    state.lightning = createLightning();
    clobberPodNormals(state.scene.pod);
    while (syncAdvance(m) <= end) {
      yield;
    }
    // t0 = [0x91260] when the wait ends: the tick the song reached entry `end` (also after a seek).
    // The sync index as the wait reads it; the events below fire once the song passes their entry
    // (the original tests the edge sPrev == k-1 && s == k, the same in a run without jumps).
    const clock = { s: end + 1, t0: entryFrame(m, end), t: 0, lag: state.timing.lag.tunnel };
    yield* outside(demo, state, clock);
    yield* inside(demo, state, clock);
    const fallStart = entryFrame(m, end + LAST_ENTRY);
    yield* flyAway(demo, end + FALL_AWAY_ENTRY, FALL_VELOCITY, FALL_SPIN, demo.isSeeking ? fallStart : frame(m));
  },

  /** 0x1a528 frees everything; the screen and the triangle engine's row clip stay. */
  deinit() {},
};
