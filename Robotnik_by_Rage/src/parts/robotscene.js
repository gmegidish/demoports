// Part 9's scene, as init 0x1f064 builds it: the octagonal room (0x1e1e4) in place of the robot
// file's root mesh, the panels object 0x81ef8 spliced in under the root, the two "RAGE" blocks
// 0x81c28 / 0x81cdc, the panels' light maps with their stamped labels, the block texture remap and
// the shade table 0x1e420 (0xfd0a0 rows 0..127, which part 10 reuses). See
// docs/disassembly/P9_robot.md §1, §2, §3.

import {
  LoadObject, staticObject, staticMaterial, drawRoutine, setTreeFlags, CreateWorld, AddObject,
  ComputeBounds, SetRenderMode, SetCameraPos, SetCameraAngles, SetObjPos, SetObjAngleX, SetObjAngleY,
  SetObjAngleZ, ScalePoints, ScaleKeys, FLAG,
} from '../engine/index.js';
import { scale, mirrorRows } from '../gfx.js';
import { drawBigText } from '../font.js';
import { drawPanel } from './robotpanels.js';

const WIDTH = 320;
const HEIGHT = 200;
/** The part's five 64 KB buffers (malloc(0x10000)): panels read up to offset 64000 + 287. */
const BUFFER_BYTES = 0x10000;

/** 0x81fac: the octagon (model space, z up); 0x1e1b0: the heights of its four rings. */
const OCTAGON = [[2000, 6000], [6000, 2000], [6000, -2000], [2000, -6000], [-2000, -6000], [-6000, -2000], [-6000, 2000], [-2000, 6000]];
const RING_HEIGHTS = [-1000, 2000, 6000, 9000];
const SEGMENTS = 8;
/** Floor, wall and ceiling bands; the wall has holes for the mirror (segment 0) and the TV (4). */
const BANDS = 3;
const WALL_BAND = 1;
const PANEL_SEGMENTS = [0, 4];
const SEGMENT_TEXELS = 32;
const BAND_TEXELS = 0x2a;
const BOTTOM_TEXEL = 0x7f;

/** Static objects and runtime materials of the data segment. */
const PANELS_OBJECT = 0x81ef8;
const BLOCK_A_OBJECT = 0x81c28;
const BLOCK_B_OBJECT = 0x81cdc;
const ROOM_MATERIAL = 0xd9a40;
const MIRROR_MATERIAL = 0xd9a70;
const TV_MATERIAL = 0xd9aa0;
const BLOCK_MATERIAL = 0xda320;
const PERSPECTIVE_TEXTURE = 0x36890;

/** cy_mirr.raw: 160x100 light map, scaled 2x to 320x200, the label stamped at (40, 8). */
const LIGHT_MAP_WIDTH = 160;
const LIGHT_MAP_HEIGHT = 100;
const LIGHT_MAP_BYTES = LIGHT_MAP_WIDTH * LIGHT_MAP_HEIGHT;
const LABEL_X = 40;
const LABEL_Y = 8;
/** The table the labels are stamped through (inline at 0x1f1d2): min(2*glyph + light, 127). */
const LABEL_ROWS = 32;
const LIGHT_MAX = 127;

/** 0x1e420: 128 light levels over 8 ramps of 32 colours. */
const SHADE_LEVELS = 128;
const RAMP_SIZE = 32;
const DARK_RAMPS = 3;

/** The model is z up: turned by -90° about x to stand y up. */
const ROOT_PITCH = -1024;
const WORLD_SIZES = [30, 1900, 2700, 2700];
const RENDER_MODE = 3;
const INITIAL_CAMERA = [0, 3800, -8000];

/** 0x1e1e4 BuildRoom: 32 points in four rings, 44 triangles textured from pattrn2 (256x128). */
export function buildRoom() {
  const points = new Int32Array(RING_HEIGHTS.length * SEGMENTS * 3);
  RING_HEIGHTS.forEach((height, j) => {
    const isSmallRing = j === 0 || j === RING_HEIGHTS.length - 1;
    OCTAGON.forEach(([x, y], i) => {
      points.set([isSmallRing ? x >> 2 : x, isSmallRing ? y >> 2 : y, height], (j * SEGMENTS + i) * 3);
    });
  });
  const faces = [];
  for (let k = 0; k < BANDS; k++) {
    const vTop = BOTTOM_TEXEL - BAND_TEXELS * k;
    const vBottom = vTop - BAND_TEXELS;
    for (let i = 0; i < SEGMENTS; i++) {
      if (k === WALL_BAND && PANEL_SEGMENTS.includes(i)) {
        continue;
      }
      const next = (i + 1) % SEGMENTS;
      const a = k * SEGMENTS + i;
      const b = k * SEGMENTS + next;
      const c = (k + 1) * SEGMENTS + next;
      const d = (k + 1) * SEGMENTS + i;
      const uLeft = SEGMENT_TEXELS * i;
      const uRight = uLeft + SEGMENT_TEXELS - 1;
      faces.push(0, 0, -1, a, b, c, uLeft, vTop, uRight, vTop, uRight, vBottom);
      faces.push(0, 0, -1, a, c, d, uLeft, vTop, uRight, vBottom, uLeft, vBottom);
    }
  }
  return { points, faces: Int32Array.from(faces) };
}

/** 0x1e420 ShadeTable8x32: rows 0..127 of `table` (colour x light; light 64, or 63, keeps a colour). */
export function buildShadeTable(table) {
  for (let light = 0; light < SHADE_LEVELS; light++) {
    const darkShift = (light >> 2) - 16;
    const brightShift = Math.trunc(light / 3) - 21;
    for (let c = 0; c < 256; c++) {
      const ramp = c >> 5;
      const level = (c & (RAMP_SIZE - 1)) + (ramp < DARK_RAMPS ? darkShift : brightShift);
      table[light * 256 + c] = ramp * RAMP_SIZE + Math.min(Math.max(level, 0), RAMP_SIZE - 1);
    }
  }
  return table;
}

function labelTable() {
  const table = new Uint8Array(LABEL_ROWS * 256);
  for (let s = 0; s < LABEL_ROWS; s++) {
    for (let d = 0; d <= LIGHT_MAX; d++) {
      table[s * 256 + d] = Math.min(2 * s + d, LIGHT_MAX);
    }
  }
  return table;
}

/** A panel's light map: cy_mirr.raw at 2x, the label added, every row reversed (0x1d648). */
function lightMapWithLabel(demo, picture, label) {
  const map = new Uint8Array(BUFFER_BYTES);
  scale(picture, LIGHT_MAP_WIDTH, LIGHT_MAP_HEIGHT, map, WIDTH, HEIGHT);
  drawBigText(demo.font, map, label, LABEL_X, LABEL_Y, labelTable());
  mirrorRows(map, WIDTH, HEIGHT);
  return map;
}

/** 0x1f27d: cy_block.raw onto ramp 0 (grey): b < 0x80 ? b >> 2 : (b - 0x80) >> 3. */
function remapBlockTexture(raw) {
  return raw.map((b) => (b < 0x80 ? b >> 2 : (b - 0x80) >> 3));
}

function panelMaterial(image, address, texture, lightMap) {
  const material = staticMaterial(image, address);
  Object.assign(material, { texture, lightMap, drawAddress: 0x37668, draw: drawPanel });
  return material;
}

function texturedMaterial(image, address, texture) {
  const material = staticMaterial(image, address);
  Object.assign(material, { texture, drawAddress: PERSPECTIVE_TEXTURE, draw: drawRoutine(PERSPECTIVE_TEXTURE) });
  return material;
}

/** The robot (en_obj.eob) with the room as its root mesh and the panels as its root's first child. */
function buildRobot(demo, buffers) {
  const image = demo.image;
  const root = LoadObject(demo.archive, 'en_obj.eob');
  const wallTexture = root.materials[1].texture;
  const room = buildRoom();
  SetObjPos(root, 0, 0, 0);
  SetObjAngleX(root, ROOT_PITCH);
  SetObjAngleY(root, 0);
  SetObjAngleZ(root, 0);
  ScalePoints(root, 1);
  ScalePoints(root, 1);
  ScaleKeys(root, 1);
  Object.assign(root, {
    points: room.points,
    faces: room.faces,
    faceNormals: new Int32Array(0),
    cornerNormals: null,
    materials: [texturedMaterial(image, ROOM_MATERIAL, wallTexture)],
  });
  const panels = staticObject(image, PANELS_OBJECT);
  panels.materials = [
    panelMaterial(image, MIRROR_MATERIAL, buffers.mirror, buffers.mirrorLight),
    panelMaterial(image, TV_MATERIAL, buffers.tv, buffers.tvLight),
  ];
  panels.child = root.child;
  root.child = panels;
  setTreeFlags(root, FLAG.KEY_AVERAGE_Z);
  return { root, panels };
}

/** Init 0x1f064 without the camera recording and the palette: buffers, objects, world, tables. */
export function buildScene(demo) {
  const mirrorPicture = demo.archive.read('cy_mirr.raw').subarray(0, LIGHT_MAP_BYTES);
  const buffers = {
    mirror: new Uint8Array(BUFFER_BYTES),
    tv: new Uint8Array(BUFFER_BYTES),
    mirrorLight: lightMapWithLabel(demo, mirrorPicture, 'rage mirror'),
    tvLight: lightMapWithLabel(demo, mirrorPicture, 'rage tv'),
  };
  buffers.mirror.set(mirrorPicture);
  const blockTexture = remapBlockTexture(demo.archive.read('cy_block.raw'));
  texturedMaterial(demo.image, BLOCK_MATERIAL, blockTexture);

  const world = CreateWorld(...WORLD_SIZES);
  SetCameraPos(world, ...INITIAL_CAMERA);
  SetCameraAngles(world, [0, 0, 0]);
  const { root, panels } = buildRobot(demo, buffers);
  const blocks = [staticObject(demo.image, BLOCK_A_OBJECT), staticObject(demo.image, BLOCK_B_OBJECT)];
  AddObject(world, root);
  blocks.forEach((block) => AddObject(world, block));
  ComputeBounds(world);
  SetRenderMode(world, RENDER_MODE);
  world.isFastPath = true;
  buildShadeTable(demo.blendTable);
  return { world, root, panels, blocks, buffers, lowerBody: panels.child, head: headOf(panels.child) };
}

/** n6: the head (with face, add-on and eye below it), five children down from the lower body. */
function headOf(lowerBody) {
  let o = lowerBody;
  for (let k = 0; k < 4; k++) {
    o = o.child;
  }
  return o;
}
