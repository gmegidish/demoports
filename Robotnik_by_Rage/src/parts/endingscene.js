// Part 14's scene, as init 0x15ab4 builds it: the robot en_obj.eob lying in pieces (posed once at key
// 0x1700, its root and the subtree of object 29 hidden), the skull with the drill, the built-in flesh
// floor 0x80dec and "RAGE" box 0x81170 (drawn by the depth-cued perspective mapper 0x38440), the
// blood stamps (0x23d64 into the skull texture, 0x31934 into the floor), the colour tables 0x15890
// and the three word pictures. See docs/disassembly/P14_ending.md §1, §2.

import {
  LoadObject, staticObject, staticMaterial, drawRoutine, useSingleMaterial, setTreeFlags,
  clearTreeFlags, CreateWorld, AddObject, ComputeBounds, SetRenderMode, SetCameraPos, SetCameraAngles,
  SetObjPos, SetObjAngles, ScalePoints, ScaleKeys, AnimateTree, readCameraRecording, FLAG,
} from '../engine/index.js';
import { octantAngle } from './skullscene.js';

const TEXTURE_BYTES = 0x10000;
const PALETTE_BYTES = 0x300;
const SCREEN_BYTES = 64000;
const FACE_INTS = 12;

/** Static objects and runtime materials (bss: zero but for the fields init sets). */
const FLOOR_OBJECT = 0x80dec;
const BOX_OBJECT = 0x81170;
const DRILL_MATERIAL_ADDRESS = 0x94a40;
const SHADE_MATERIAL_ADDRESS = 0x94a70;
const DEPTH_CUED_TEXTURE = 0x38440;
const AFFINE_TEXTURE = 0x331b4;
/** Material +0x28 of the floor and box: depth << 1 before the cue. */
const DEPTH_SHIFT = 1;

/** shade.raw: b = (b >> 2) + 0xa0, the flesh ramp 0xa0..0xbf. */
const SHADE_BASE = 0xa0;
/** sp_pic1.raw (256x32): colours < 0x80 -> 0..15, the rest -> 0x20..0x2f. */
const BOX_TEXTURE_SPLIT = 0x80;
const BOX_TEXTURE_UPPER = 0x20;

/** 0x23d64(skull texture, sh_blod, 1): 2x2 blocks of colour 0xf0 at texel (64 + 2c, 35 + 2r). */
const SKULL_BLOOD_AT = 0x2340;
const SKULL_BLOOD_COLOUR = 0xf0;
const SKULL_BLOOD_THRESHOLD = 1;
/** 0x31934(sp_blod, floor texture 1, 0xdf, 0xdf): texels == 0xff copied around (223, 223). */
const FLOOR_BLOOD_CENTRE = 0xdf;
const FLOOR_BLOOD_COLOUR = 0xff;
const STAMP_SIZE = 64;
const TEXTURE_ROW = 256;

/** 0x15890: 128 light rows of 8 ramps x 32; row 64 is the identity. */
const LIGHT_ROWS = 128;
const RAMP_MASK = 0xe0;
const RAMP_TOP = 31;
const LIGHT_NEUTRAL = 16;
/** The word overlay's add-light table: 32 rows, +row/2 inside each ramp. */
const ADD_LIGHT_ROWS = 32;

const WORLD_SIZES = [0x3c, 0xed8, 0x1518, 0x1518];
const RENDER_MODE = 3;
const SKULL_POSITION = [-800, 0, 500];
const SKULL_JAW_POSITION = [0, -350, 0];
const SKULL_ANGLES = [-824, -800, 0];
const BOX_POSITION = [1200, -200, -1800];
const ROBOT_POSITION = [-2000, 0, 1500];
const ROBOT_ANGLES = [-700, 0, -1024];
const ROBOT_ARM_ANGLES = [0, 0, -400];
/** AnimateTree(en, 0x1700): key time 23.0, never animated again. */
const ROBOT_POSE = 0x1700;
/** Overwritten by the first camera record. */
const INITIAL_CAMERA = [3000, 8000, -10000];
const INITIAL_CAMERA_ANGLES = [128, 2048, -1000];

/** 0x15a00: u = angle(z, x) >> 2 around the y axis, v = (y >> 4) & 0xff, on the unscaled points. */
function cylinderMapByHeight(object) {
  const { points, faces } = object;
  for (let f = 0; f < faces.length; f += FACE_INTS) {
    for (let k = 0; k < 3; k++) {
      const p = 3 * faces[f + 3 + k];
      faces[f + 6 + 2 * k] = octantAngle(points[p + 2], points[p]) >> 2;
      faces[f + 7 + 2 * k] = (points[p + 1] >> 4) & 0xff;
    }
  }
}

/** A runtime material of the bss with only a texture and a draw routine. */
function textureMaterial(image, address, texture, drawAddress, depthShift = 0) {
  const material = staticMaterial(image, address);
  material.texture = texture;
  material.depthShift = depthShift;
  material.drawAddress = drawAddress;
  material.draw = drawRoutine(drawAddress);
  return material;
}

/**
 * The data segment's floor and box are shared by every run of the program image: scale them from
 * their original points each time (the original scales them once per run).
 */
function pristineStatic(image, address) {
  const object = staticObject(image, address);
  object.pristine ??= { points: object.points.slice(), matrix: object.matrix.slice() };
  object.points.set(object.pristine.points);
  object.matrix.set(object.pristine.matrix);
  return object;
}

function convertedShade(archive) {
  return archive.read('shade.raw').slice(0, TEXTURE_BYTES).map((b) => (b >> 2) + SHADE_BASE);
}

function boxTexture(archive) {
  const texture = new Uint8Array(TEXTURE_BYTES);
  const file = archive.read('sp_pic1.raw');
  file.forEach((b, i) => {
    texture[i] = b < BOX_TEXTURE_SPLIT ? b >> 3 : ((b - BOX_TEXTURE_SPLIT) >> 3) + BOX_TEXTURE_UPPER;
  });
  return texture;
}

/** 0x23d64: every mask texel > threshold becomes a 2x2 block of 0xf0. */
export function stampSkullBlood(texture, mask) {
  for (let r = 0; r < STAMP_SIZE; r++) {
    for (let c = 0; c < STAMP_SIZE; c++) {
      if (mask[r * STAMP_SIZE + c] > SKULL_BLOOD_THRESHOLD) {
        const at = SKULL_BLOOD_AT + r * 2 * TEXTURE_ROW + 2 * c;
        texture[at] = SKULL_BLOOD_COLOUR;
        texture[at + 1] = SKULL_BLOOD_COLOUR;
        texture[at + TEXTURE_ROW] = SKULL_BLOOD_COLOUR;
        texture[at + TEXTURE_ROW + 1] = SKULL_BLOOD_COLOUR;
      }
    }
  }
}

/** 0x31934: the mask's 0xff texels into the 64x64 square centred on (cx, cy), clipped to the texture. */
export function stampFloorBlood(texture, mask, cx, cy) {
  const half = STAMP_SIZE / 2;
  for (let r = 0; r < STAMP_SIZE; r++) {
    const y = cy - half + r;
    if (y < 0 || y >= TEXTURE_ROW) {
      continue;
    }
    for (let c = 0; c < STAMP_SIZE; c++) {
      const x = cx - half + c;
      if (x >= 0 && x < TEXTURE_ROW && mask[r * STAMP_SIZE + c] === FLOOR_BLOOD_COLOUR) {
        texture[y * TEXTURE_ROW + x] = FLOOR_BLOOD_COLOUR;
      }
    }
  }
}

/** 0x15890, first loop: rows 0..127 of 0xfd0a0, row r adds (r >> 2) - 16 inside each ramp. */
export function fillLightRows(table) {
  for (let r = 0; r < LIGHT_ROWS; r++) {
    const add = (r >> 2) - LIGHT_NEUTRAL;
    for (let b = 0; b < 256; b++) {
      const v = (b & RAMP_TOP) + add;
      table[r * 256 + b] = (b & RAMP_MASK) + (v > RAMP_TOP ? RAMP_TOP : Math.max(v, 0));
    }
  }
}

/** 0x15890, second loop: [0x95b08], row r adds r >> 1, clamped to the ramp's top. */
export function buildAddLightTable() {
  const table = new Uint8Array(ADD_LIGHT_ROWS * 256);
  for (let r = 0; r < ADD_LIGHT_ROWS; r++) {
    for (let b = 0; b < 256; b++) {
      table[r * 256 + b] = (b & RAMP_MASK) + Math.min((b & RAMP_TOP) + (r >> 1), RAMP_TOP);
    }
  }
  return table;
}

function prepareSkull(demo) {
  const { archive, image } = demo;
  const skull = LoadObject(archive, 'skull.eob');
  clearTreeFlags(skull, FLAG.NO_BACKFACE_CULL);
  setTreeFlags(skull, FLAG.INVERT_BACKFACE);
  const jaw = skull.child;
  const drill = jaw.child;
  cylinderMapByHeight(drill);
  cylinderMapByHeight(jaw);
  const shade = convertedShade(archive);
  useSingleMaterial(drill, textureMaterial(image, DRILL_MATERIAL_ADDRESS, archive.read('drill1.raw').subarray(PALETTE_BYTES), AFFINE_TEXTURE));
  useSingleMaterial(jaw, textureMaterial(image, SHADE_MATERIAL_ADDRESS, shade.map((b) => b - SHADE_BASE), AFFINE_TEXTURE));
  stampSkullBlood(skull.materials[1].texture, archive.read('sh_blod.raw'));
  ScalePoints(skull, 1);
  ScalePoints(skull, 3);
  ScaleKeys(skull, 3);
  return { skull, shade };
}

function prepareRobot(archive) {
  const robot = LoadObject(archive, 'en_obj.eob');
  ScalePoints(robot, 1);
  ScalePoints(robot, 1);
  ScaleKeys(robot, 1);
  ScalePoints(robot, 0xc0);
  ScaleKeys(robot, 0xc0);
  return robot;
}

/** The floor's two materials (plain and blood-stamped shade) and the box's sp_pic1. */
function prepareFloorAndBox(demo, shade) {
  const { archive, image } = demo;
  const floor = pristineStatic(image, FLOOR_OBJECT);
  const box = pristineStatic(image, BOX_OBJECT);
  const bloody = shade.slice();
  stampFloorBlood(bloody, archive.read('sp_blod.raw'), FLOOR_BLOOD_CENTRE, FLOOR_BLOOD_CENTRE);
  textureMaterial(image, floor.materials[0].address, shade, DEPTH_CUED_TEXTURE, DEPTH_SHIFT);
  textureMaterial(image, floor.materials[1].address, bloody, DEPTH_CUED_TEXTURE, DEPTH_SHIFT);
  textureMaterial(image, box.materials[0].address, boxTexture(archive), DEPTH_CUED_TEXTURE, DEPTH_SHIFT);
  ScalePoints(floor, 0x200);
  ScaleKeys(floor, 0x200);
  return { floor, box };
}

/** en_obj: the root object hidden, object 29's subtree hidden, object 3 turned. */
function poseRobot(robot) {
  AnimateTree(robot, ROBOT_POSE);
  robot.flags = (robot.flags | FLAG.HIDDEN) >>> 0;
  setTreeFlags(robot.child.child.child.child.child, FLAG.HIDDEN);
  SetObjAngles(robot.child.child.child, ROBOT_ARM_ANGLES);
}

/**
 * Init 0x15ab4 (playback mode): the world with skull, robot, floor and box, the camera recording,
 * the light tables (rows 0..127 of demo.blendTable) and the word pictures. The DAC is set by the caller.
 */
export function createEndingScene(demo) {
  const { archive } = demo;
  const { skull, shade } = prepareSkull(demo);
  const robot = prepareRobot(archive);
  const { floor, box } = prepareFloorAndBox(demo, shade);
  const world = CreateWorld(...WORLD_SIZES);
  SetObjPos(skull, ...SKULL_POSITION);
  SetObjPos(skull.child, ...SKULL_JAW_POSITION);
  SetObjAngles(skull, SKULL_ANGLES);
  SetObjPos(box, ...BOX_POSITION);
  SetObjAngles(box, [0, 0, 0]);
  SetObjPos(floor, 0, 0, 0);
  SetObjAngles(floor, [0, 0, 0]);
  SetObjPos(robot, ...ROBOT_POSITION);
  SetObjAngles(robot, ROBOT_ANGLES);
  [skull, robot, floor, box].forEach((object) => AddObject(world, object));
  ComputeBounds(world);
  SetRenderMode(world, RENDER_MODE);
  fillLightRows(demo.blendTable);
  poseRobot(robot);
  SetCameraPos(world, ...INITIAL_CAMERA);
  SetCameraAngles(world, INITIAL_CAMERA_ANGLES);
  const word = (name) => archive.read(name).subarray(0, SCREEN_BYTES);
  return {
    world,
    camera: readCameraRecording(archive.read('end_cam.rec')),
    addLight: buildAddLightTable(),
    words: [word('rage.raw'), word('punished.raw'), word('robotnik.raw')],
  };
}
