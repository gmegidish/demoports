// Part 10's files and scene (init 0x13128 without the intro): the cloth object 0x80b00 with the room
// as a chain of children (floor 0x8077c, shadow plane 0x80830, light 0x80998, walls 0x808e4, flares
// 0x80a4c), their runtime materials, the floor and wall polygons (0x12f00, 0x12fd4), the
// environment map, row 0 of the blend table (the shadow), the doubled word pictures and the remapped
// flare. See docs/disassembly/P10_room.md §2, §4.

import {
  staticObject, staticMaterial, drawRoutine, generatePhongMap, readCameraRecording, CreateWorld,
  AddObject, ComputeBounds, SetRenderMode, SetCameraPos, SetCameraAngles, CameraMoveLocalZ, SetObjPos,
  SetObjAngleX, SetObjAngleZ,
} from '../engine/index.js';
import { createCloth, clothFaces, TRIANGLES } from './cloth.js';

const PALETTE_BYTES = 0x300;
const SCREEN_BYTES = 64000;
const TEXTURE_SIZE = 256;
const OBJECT = { cloth: 0x80b00, floor: 0x8077c, plane: 0x80830, light: 0x80998, walls: 0x808e4, flares: 0x80a4c };
const MATERIAL = { cloth: 0x92848, floor: 0x922d8, walls: 0x92308, plane: 0x92338, light: 0x92368, flares: 0x92398 };
/** Material +0x2c of each: 0x33170 shadow + texture x env map, 0x36890 perspective texture, ... */
const DRAW = { cloth: 0x33170, floor: 0x36890, walls: 0x36890, plane: 0x32788, light: 0x32714, flares: 0x31b64 };
const CLOTH_POINTS = 256;
const FACE_INTS = 12;
/** The cloth lies at AngleX -1024 (-90 degrees), the floor turns it back by +1024. */
const CLOTH_ANGLE_X = -0x400;
const FLOOR_ANGLE_X = 0x400;
/** 0x314c0(1.0, 0x30, 0x7f, 128.0, 0): 127 in the centre, falling linearly to 0x30. */
const ENV_MAP = [1, 0x30, 0x7f, 128, 0];
/** Row 0 of 0xfd0a0: colours 0x40..0x7f (the floor and walls) become black, the rest stay. */
const SHADOW_FIRST = 0x40;
const SHADOW_END = 0x80;
const FLARE_BASE = 0x40;
const FLARE_SIZE_SHIFT = 1;
const RING = 8;
/** 0x12f00: ring vertex (x, z) -> uv ((x + 800) * 4 / 25, (z + 800) * 4 / 25); centre (128, 128). */
const FLOOR_UV_OFFSET = 800;
const FLOOR_UV_CENTRE = 128;
/** 0x12fd4: even wall segments use texels 0..127 across, odd ones 128..255; rows 0..127. */
const WALL_HALF = 128;
const WALL_EDGE = 127;
/** CreateWorld(30, 0x76c, 0xa8c, 0xa8c), camera 500 back (overwritten by the first record), mode 3. */
const WORLD_SIZES = [30, 0x76c, 0xa8c, 0xa8c];
const CAMERA_BACK = -500;
const RENDER_MODE = 3;

function copyOf(bytes) {
  return Uint8Array.from(bytes);
}

/** vectors.raw / burns.raw / flesh.raw: the 320x200 pixels after the palette, doubled (0..31 -> 0..62). */
function doubledPicture(bytes) {
  return Uint8Array.from(bytes.subarray(PALETTE_BYTES, PALETTE_BYTES + SCREEN_BYTES), (p) => (p * 2) & 0xff);
}

function setDraw(material, address) {
  material.drawAddress = address;
  material.draw = drawRoutine(address);
}

function buildMaterials(demo, textures) {
  const materials = Object.fromEntries(Object.entries(MATERIAL).map(([name, address]) => [name, staticMaterial(demo.image, address)]));
  for (const [name, material] of Object.entries(materials)) {
    setDraw(material, DRAW[name]);
  }
  Object.assign(materials.cloth, {
    ambient: 0, colourBase: 0, texture: textures.cloth, phongMap: textures.envMap, textureWidth: TEXTURE_SIZE, textureHeight: TEXTURE_SIZE,
  });
  materials.floor.texture = textures.floor;
  materials.walls.texture = textures.walls;
  materials.light.subdivision = FLARE_SIZE_SHIFT;
  materials.flares.texture = textures.flare;
  materials.flares.subdivision = FLARE_SIZE_SHIFT;
  return materials;
}

function face(type, vertices, uvs) {
  return [type, 0, -1, ...vertices, ...uvs];
}

/** 0x12f00: eight triangles from the centre to the ring. */
function floorFaces(points) {
  const uv = (p) => [((points[3 * p] + FLOOR_UV_OFFSET) * 4 / 25) | 0, ((points[3 * p + 2] + FLOOR_UV_OFFSET) * 4 / 25) | 0];
  const faces = new Int32Array(RING * FACE_INTS);
  for (let k = 0; k < RING; k++) {
    const a = k + 1;
    const b = ((k + 1) & (RING - 1)) + 1;
    faces.set(face(0, [0, a, b], [FLOOR_UV_CENTRE, FLOOR_UV_CENTRE, ...uv(a), ...uv(b)]), k * FACE_INTS);
  }
  return faces;
}

/** 0x12fd4: two triangles per wall segment (the second one's last v is 127, as in the original). */
function wallFaces() {
  const faces = new Int32Array(2 * RING * FACE_INTS);
  for (let k = 0; k < RING; k++) {
    const n = (k + 1) & (RING - 1);
    const u0 = (k & 1) ? WALL_HALF : 0;
    const u1 = u0 + WALL_EDGE;
    faces.set(face(0, [k + 1, k + 1 + RING, n + 1 + RING], [u0, 0, u0, WALL_EDGE, u1, WALL_EDGE]), 2 * k * FACE_INTS);
    faces.set(face(0, [k + 1, n + 1 + RING, n + 1], [u0, 0, u1, WALL_EDGE, u1, WALL_EDGE]), (2 * k + 1) * FACE_INTS);
  }
  return faces;
}

/** The objects, chained as children so that each inherits the previous one's matrix. */
function buildScene(demo, materials) {
  const objects = Object.fromEntries(Object.entries(OBJECT).map(([name, address]) => [name, staticObject(demo.image, address)]));
  const { cloth, floor, plane, light, walls, flares } = objects;
  Object.assign(cloth, {
    points: new Int32Array(CLOTH_POINTS * 3),
    faces: clothFaces(),
    faceNormals: new Int32Array(TRIANGLES * 3),
    cornerNormals: new Int32Array(CLOTH_POINTS * 3),
    materials: [materials.cloth],
  });
  floor.faces = floorFaces(floor.points);
  walls.faces = wallFaces();
  SetObjPos(cloth, 0, 0, 0);
  SetObjAngleX(cloth, CLOTH_ANGLE_X);
  SetObjAngleZ(cloth, 0);
  cloth.child = floor;
  floor.child = plane;
  plane.child = light;
  light.child = walls;
  walls.child = flares;
  flares.child = null;
  SetObjAngleX(floor, FLOOR_ANGLE_X);
  return objects;
}

/** Row 0 of the blend table; rows 1..127 are part 9's (0x1e420). */
function writeShadowRow(table) {
  for (let i = 0; i < 256; i++) {
    table[i] = i >= SHADOW_FIRST && i < SHADOW_END ? 0 : i;
  }
}

/** Init 0x13128 up to the intro. */
export function loadRoom(demo) {
  const read = (name) => demo.archive.read(name);
  writeShadowRow(demo.blendTable);
  const textures = {
    envMap: generatePhongMap(...ENV_MAP),
    cloth: read('cl_cloth.raw'),
    walls: read('cl_walls.raw'),
    floor: read('cl_floor.raw').subarray(PALETTE_BYTES),
    flare: Uint8Array.from(read('su_star.raw'), (s) => (s >> 1) + FLARE_BASE),
  };
  const materials = buildMaterials(demo, textures);
  return {
    cloth: createCloth(read('cl_heigh.raw')),
    scene: buildScene(demo, materials),
    words: ['vectors.raw', 'burns.raw', 'flesh.raw'].map((name) => doubledPicture(read(name))),
    camera: readCameraRecording(read('cl_cam1.rec')),
    picture: copyOf(read('cl_pic.raw')),
    palette: read('cl_pal.col'),
    world: null,
    elapsed: 0,
    windPhase: 0,
  };
}

/** The end of init 0x13128, after the intro: the world with the cloth tree. */
export function createRoomWorld(scene) {
  const world = CreateWorld(...WORLD_SIZES);
  SetCameraPos(world, 0, 0, 0);
  SetCameraAngles(world, [0, 0, 0]);
  CameraMoveLocalZ(world, CAMERA_BACK);
  AddObject(world, scene.cloth);
  ComputeBounds(world);
  SetRenderMode(world, RENDER_MODE);
  return world;
}
