// The scene of intro parts 3 and 5 ("shadow"): the bowl-shaped room with two pillars that init
// generates (0x228bc), the skull tree hanging in it with cylindrical UVs on the drill (0x231a4 with
// the octant atan 0x11d72), the light colour map (0x227d8), the projector-pixel -> film-texel table,
// and the rest of init 0x23264 (materials, textures, the two worlds). See
// docs/disassembly/P3_skull.md §3, §7.

import { sin, cos } from '../sine.js';
import {
  LoadObject, createObject, ScalePoints, ScaleKeys, useSingleMaterial, setTreeDraw, clearTreeFlags,
  CreateWorld, AddObject, ComputeBounds, SetRenderMode, SetCameraPos, SetCameraAngles, CameraPitchLocal,
  CameraMoveLocalZ, SetObjPos, SetObjAngles, SetObjAngleX, SetObjAngleY, SetObjAngleZ, drawProjected,
  createProjectorState, readCameraRecording, unpackFilmFrame,
} from '../engine/index.js';

const WIDTH = 320;
const HEIGHT = 200;
const PALETTE_BYTES = 0x300;
const TEXTURE_BYTES = 0x10000;
const TEXTURE_SIZE = 256;
const FACE_INTS = 12;

// --- the room 0x228bc ------------------------------------------------------------------------------

const RINGS = 9;
const RING_POINTS = 16;
const RING_ANGLE_STEP = 32;
const RING_SINE_START = 0x40;
const RING_SINE_STEP = 16;
const RING_BOTTOM_Z = -8192;
const RING_Z_STEP = 2048;
/** The pillars' three corners each (0x22790, 0x227b4), five levels from z = -8000 in steps of 4000. */
const PILLARS = [
  [[-5600, 9600], [-4600, 8200], [-3600, 9600]],
  [[3600, 9600], [4600, 8200], [5600, 9600]],
];
const PILLAR_LEVELS = 5;
const PILLAR_CORNERS = 3;
const PILLAR_BOTTOM_Z = -8000;
const PILLAR_Z_STEP = 4000;
/** Only two of each pillar's three sides get faces. */
const PILLAR_SIDES = 2;
const U_STEP = 16;
const V_STEP = 33;
const NORMAL_SCALE = 65536;
const ROOM_FLAGS = 8;

function face(a, b, c, uvs, material = 0) {
  return [0, material, 0, a, b, c, ...uvs];
}

function bowlPoints() {
  const points = [];
  for (let r = 0; r < RINGS; r++) {
    const s = sin(RING_SINE_START + RING_SINE_STEP * r);
    for (let k = 0; k < RING_POINTS; k++) {
      points.push((cos(RING_ANGLE_STEP * k) * s) >> 2, (sin(RING_ANGLE_STEP * k) * s) >> 2, RING_BOTTOM_Z + RING_Z_STEP * r);
    }
  }
  return points;
}

function pillarPoints(corners) {
  const points = [];
  for (let j = 0; j < PILLAR_LEVELS; j++) {
    for (const [x, y] of corners) {
      points.push(x, y, PILLAR_BOTTOM_Z + PILLAR_Z_STEP * j);
    }
  }
  return points;
}

function bowlFaces() {
  const faces = [];
  for (let r = 0; r < RINGS - 1; r++) {
    const v = V_STEP * r - V_STEP;
    for (let k = 0; k < RING_POINTS; k++) {
      const k1 = (k + 1) % RING_POINTS;
      const [a, b, c, d] = [RING_POINTS * r + k, RING_POINTS * r + k1, RING_POINTS * (r + 1) + k1, RING_POINTS * (r + 1) + k];
      const [u0, u1] = [U_STEP * k, U_STEP * k + U_STEP];
      faces.push(face(a, b, c, [u0, v, u1, v, u1, v + V_STEP]));
      faces.push(face(a, c, d, [u0, v, u1, v + V_STEP, u0, v + V_STEP]));
    }
  }
  return faces;
}

function pillarFaces(base) {
  const faces = [];
  const p = (j, i) => base + PILLAR_CORNERS * j + i;
  for (let j = 0; j < PILLAR_LEVELS - 1; j++) {
    const [v0, v1] = [V_STEP * j, V_STEP * j + V_STEP];
    for (let i = 0; i < PILLAR_SIDES; i++) {
      const [u0, u1] = [U_STEP * i, U_STEP * i + U_STEP];
      faces.push(face(p(j, i), p(j + 1, i + 1), p(j, i + 1), [u0, v0, u1, v1, u1, v0]));
      faces.push(face(p(j, i), p(j + 1, i), p(j + 1, i + 1), [u0, v0, u0, v1, u1, v1]));
    }
  }
  return faces;
}

/**
 * 0x247d4: (b-a) x (c-a) in single precision, scaled to length 65536 and chopped (0x44160).
 */
export function faceNormal(points, a, b, c) {
  const f = Math.fround;
  const at = (k) => [f(points[3 * k]), f(points[3 * k + 1]), f(points[3 * k + 2])];
  const [pa, pb, pc] = [at(a), at(b), at(c)];
  const e1 = pb.map((v, i) => f(v - pa[i]));
  const e2 = pc.map((v, i) => f(v - pa[i]));
  const n = [
    f(f(e1[1] * e2[2]) - f(e1[2] * e2[1])),
    f(f(e1[2] * e2[0]) - f(e1[0] * e2[2])),
    f(f(e1[0] * e2[1]) - f(e1[1] * e2[0])),
  ];
  const length = f(Math.sqrt(f(f(f(n[1] * n[1]) + f(n[0] * n[0])) + f(n[2] * n[2]))));
  return n.map((v) => Math.trunc(f(f(v * NORMAL_SCALE) / length)));
}

/** 0x228bc BuildRoom (+ 0x24cb0 normals): 174 points, 288 faces, each face its own normal. */
export function buildRoom(material) {
  const points = Int32Array.from([...bowlPoints(), ...pillarPoints(PILLARS[0]), ...pillarPoints(PILLARS[1])]);
  const firstPillar = RINGS * RING_POINTS;
  const list = [...bowlFaces(), ...pillarFaces(firstPillar), ...pillarFaces(firstPillar + PILLAR_LEVELS * PILLAR_CORNERS)];
  const faces = new Int32Array(list.length * FACE_INTS);
  const faceNormals = new Int32Array(list.length * 3);
  list.forEach((f, i) => {
    f[2] = i;
    faces.set(f, i * FACE_INTS);
    faceNormals.set(faceNormal(points, f[3], f[4], f[5]), i * 3);
  });
  return createObject({ points, faces, faceNormals, flags: ROOM_FLAGS, materials: [material] });
}

// --- cylindrical UVs 0x231a4 ----------------------------------------------------------------------

/** 0x11d72: octant-linear atan2, 0..1024 per turn, from +a towards +b (C division). */
export function octantAngle(a, b) {
  const div = (x, y) => Math.trunc(x / y);
  if (a > 0) {
    if (b > 0) {
      return a >= b ? div(b << 7, a) : 0x100 - div(a << 7, b);
    }
    if (b < 0) {
      return a >= -b ? 0x400 - div(-b << 7, a) : 0x300 + div(a << 7, -b);
    }
    return 0;
  }
  if (a < 0) {
    const A = -a;
    if (b >= 0) {
      return A >= b ? 0x200 - div(b << 7, A) : 0x100 + div(A << 7, b);
    }
    return A >= -b ? 0x200 + div(-b << 7, A) : 0x300 - div(A << 7, -b);
  }
  return b >= 0 ? 0x100 : 0x300;
}

/** 0x231a4 CylMap: u = angle around the Y axis (0..256), v = y / 8, per face corner. */
export function cylinderMap(object) {
  const { points, faces } = object;
  for (let f = 0; f < faces.length; f += FACE_INTS) {
    for (let k = 0; k < 3; k++) {
      const p = 3 * faces[f + 3 + k];
      faces[f + 6 + 2 * k] = octantAngle(points[p + 2], points[p]) >> 2;
      faces[f + 7 + 2 * k] = points[p + 1] >> 3;
    }
  }
}

// --- tables -----------------------------------------------------------------------------------------

const FILM_LEVELS = 16;
const GREYS = 64;
const RAMP_MASK = 0xe0;
const RAMP_TOP = 31;
const GREY_TOP = 63;
const LEVEL_STEP = 3;
const LAST_COLOUR = 255;
const LAST_COLOUR_CAP = 0xfe;

/** 0x227d8: 16 rows (film level) of 256: greys +3 per level, the 32-colour ramps +1.5. */
export function buildLightColourMap() {
  const map = new Uint8Array(FILM_LEVELS * 256);
  for (let r = 0; r < FILM_LEVELS; r++) {
    for (let c = 0; c < 256; c++) {
      const value = c < GREYS
        ? Math.min(GREY_TOP, c + LEVEL_STEP * r)
        : (c & RAMP_MASK) | Math.min(RAMP_TOP, (c & RAMP_TOP) + ((LEVEL_STEP * r) >> 1));
      map[r * 256 + c] = c === LAST_COLOUR ? Math.min(value, LAST_COLOUR_CAP) : value;
    }
  }
  return map;
}

const FILM_WIDTH = 128;

/** [0x11a880]: light-buffer pixel -> texel of the 128x80 film (2/5 scale); the tail stays 0. */
export function buildLightMap(lightMap) {
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH; col++) {
      lightMap[row * WIDTH + col] = Math.trunc((2 * row) / 5) * FILM_WIDTH + Math.trunc((2 * col) / 5);
    }
  }
  return lightMap;
}

// --- init 0x23264 -----------------------------------------------------------------------------------

const SKULL_SCALE_FIRST = 1;
const SKULL_SCALE = 0x20;
const SKULL_ANGLES = [0, 0x800, 0x800];
const FACE_NORMAL_Z_ONLY = 2;
const WORLD_SIZES = [30, 0x76c, 0xa8c, 0xa8c];
const RENDER_MODE = 3;
const PROJECTOR_PITCH = 0x400;
const PROJECTOR_BACK = -12000;
const ROOM_PITCH = 0x400;
/** The skull texture loses 4 levels and is clamped to the bone ramp's start. */
const SKULL_TEXTURE_DARKEN = 4;
const BONE_RAMP_START = 192;
const PART5_PALETTE_FROM = 0x1e0;
const PART5_PALETTE_BYTES = 0x60;
const PICTURE_COLOUR_BASE = 0xa0;
const PICTURE_BYTES = 0xfa00;
/** music.raw rows 0 and 198..199 are blanked. */
const PICTURE_BLANK_TOP = 320;
const PICTURE_BLANK_BOTTOM_FROM = 0xf780;
const VARIANT_PART5 = 2;

/** A runtime material of the bss (0xe0bb0 / 0xe0be0 / 0xe0c10): 256x256 texture, span 0x46d08. */
function projectedMaterial(texture) {
  return {
    ambient: 0, colourBase: 0, colourTable: 0xfd0a0, texture, phongMap: null,
    textureWidth: TEXTURE_SIZE, textureHeight: TEXTURE_SIZE, drawAddress: 0x46d08, draw: drawProjected,
  };
}

function loadSkull(archive) {
  const skull = LoadObject(archive, 'skull.eob');
  ScalePoints(skull, SKULL_SCALE_FIRST);
  ScalePoints(skull, SKULL_SCALE);
  ScaleKeys(skull, SKULL_SCALE);
  return skull;
}

/** music.raw for the shatter's background, its colours moved to 160..191 (gl_pal). */
function loadMusicPicture(archive) {
  const picture = archive.read('music.raw').slice(PALETTE_BYTES, PALETTE_BYTES + PICTURE_BYTES);
  for (let i = 0; i < picture.length; i++) {
    picture[i] = (picture[i] + PICTURE_COLOUR_BASE) & 0xff;
  }
  picture.fill(0, 0, PICTURE_BLANK_TOP);
  picture.fill(0, PICTURE_BLANK_BOTTOM_FROM);
  return picture;
}

/**
 * 0x23264(variant): variant 1 = part 3, 2 = part 5. Returns the scene: worlds, objects, the projector
 * state, the film, the recordings and (part 5) the damage map and the music picture.
 */
export function createSkullScene(demo, variant) {
  const { archive } = demo;
  const projector = createProjectorState();
  buildLightMap(projector.lightMap);
  const skull = loadSkull(archive);
  const palette = archive.read('sh_pal.col').slice(0, PALETTE_BYTES);
  if (variant === VARIANT_PART5) {
    palette.set(archive.read('gl_pal.col').subarray(0, PART5_PALETTE_BYTES), PART5_PALETTE_FROM);
  }
  const bit = skull.child;
  const box = bit.child;
  cylinderMap(box);
  cylinderMap(bit);
  const wall = archive.read('sh_text.raw').slice(0, TEXTURE_BYTES);
  const drill = archive.read('drill1.raw');
  useSingleMaterial(box, projectedMaterial(drill.subarray(PALETTE_BYTES, PALETTE_BYTES + TEXTURE_BYTES)));
  useSingleMaterial(bit, projectedMaterial(wall));
  setTreeDraw(skull, drawProjected);
  SetObjAngles(skull, SKULL_ANGLES);
  clearTreeFlags(skull, FACE_NORMAL_Z_ONLY);
  const room = buildRoom(projectedMaterial(wall));
  room.child = skull;
  const camera = CreateWorld(...WORLD_SIZES);
  camera.isFastPath = true;
  const projectorWorld = CreateWorld(...WORLD_SIZES);
  SetCameraPos(projectorWorld, 0, 0, 0);
  SetCameraAngles(projectorWorld, [0, 0, 0]);
  CameraPitchLocal(projectorWorld, PROJECTOR_PITCH);
  CameraMoveLocalZ(projectorWorld, PROJECTOR_BACK);
  const skullTexture = skull.materials[1].texture;
  for (let i = 0; i < TEXTURE_BYTES; i++) {
    wall[i] >>= 1;
    skullTexture[i] = Math.max(skullTexture[i] - SKULL_TEXTURE_DARKEN, BONE_RAMP_START);
  }
  SetObjPos(room, 0, 0, 0);
  SetObjAngleX(room, ROOM_PITCH);
  SetObjAngleY(room, 0);
  SetObjAngleZ(room, 0);
  AddObject(camera, room);
  ComputeBounds(camera);
  SetRenderMode(camera, RENDER_MODE);
  const rap = archive.read('teeth.rap');
  unpackFilmFrame(rap, 0, projector.film);
  const isPart5 = variant === VARIANT_PART5;
  return {
    palette,
    room,
    skull,
    bit,
    box,
    camera,
    projectorWorld,
    projector,
    colourMap: buildLightColourMap(),
    rap,
    skullTexture,
    cameraPath: readCameraRecording(archive.read(isPart5 ? 'sh_cam2.rec' : 'sh_cam1.rec')),
    projectorPath: readCameraRecording(archive.read(isPart5 ? 'sh_proj2.rec' : 'sh_proj1.rec')),
    damageMap: isPart5 ? archive.read('sh_blod.raw') : null,
    picture: isPart5 ? loadMusicPicture(archive) : null,
  };
}
