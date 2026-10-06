// The encore: three spinning slabs casting shadows on each other ("scene - shadows", CRED.3DS).
// The light shines straight down. A shadow is the caster's triangles painted black into a copy of
// a light map, with world x and z as its texel coordinates; the map then brightens whatever is
// drawn under it. KAHN.EXE 0x1d210 (load), 0x1d2d1 (run), 0x1ce47 (shadows), 0x1c893 (draw).

import { setDac, showBuffer, clearBuffer } from '../machine.js';
import { loadScene, findMesh, WORLD_MESH } from '../engine/scene.js';
import { loadPicture } from '../engine/pictures.js';
import { dot, transform } from '../engine/math.js';
import { activateScene } from '../engine/frame.js';
import { drawPerspectiveTriangle } from '../engine/triangle.js';
import { drawFacePerspective } from '../engine/faces.js';
import { buildLightTable } from '../tables.js';
import { drawTextShadowed } from '../font.js';
import { TICKS, loaderLog, setFrame, animateScene } from './common.js';

const DURATION = TICKS * 35;
const MAP_SIZE = 256;
const MAP_LAST = MAP_SIZE - 1;
const SHADOW = 0;
/** Keeps the light map's texel coordinates positive; a whole number of map widths. */
const TEXEL_BIAS = 8192.0;
const TEXT_COLOUR = 4;
const TEXT_LEFT = 10;
const TEXT = [
  [5, 'OK, Let me explain...'],
  [25, 'Rage wrote some nice shadows'],
  [45, 'But they didnt really fit the design'],
  [65, 'So, to make Eyal happy, here you go :)'],
  [185, 'P.S - The demo may crash after this :('],
];

export function* loadShadows(demo) {
  const machine = demo.machine;
  yield* loaderLog(demo, 'scene - shadows');
  const scene = loadScene(machine, demo.assets, 'scenes\\cred.3ds', 9);
  yield* loaderLog(demo, 'shadow color table');
  const lightTable = buildLightTable(scene.palette);
  yield* loaderLog(demo, 'searching objects');
  const slabs = ['1prs', '2prs', '3prs'].map((name) => findMesh(scene, name));
  yield* loaderLog(demo, 'texture memory');
  const lightMap = loadPicture(machine, demo.assets, 'textures\\shad.gif');
  for (const { type, object } of scene.world) {
    if (type === WORLD_MESH) {
      object.world = new Float32Array(object.vertexCount * 3);
    }
  }
  demo.shadows = {
    scene, lightTable, slabs, lightMap,
    /** The light map as each slab receives it. */
    maps: slabs.map(() => new Uint8Array(lightMap.length)),
    isSecondOnTop: false,
  };
}

function fillSpan(map, y, from, to) {
  let left = Math.min(from, to);
  let right = Math.max(from, to);
  left = Math.max(left, 0);
  right = Math.min(right, MAP_LAST);
  if (left > MAP_LAST || right < 0) {
    return;
  }
  map.fill(SHADOW, (y << 8) + left, (y << 8) + right + 1);
}

/** Flat triangle into a 256x256 map, 20.12 fixed point, clipped to the map. 0x1c37e. */
function paintShadow(map, ax, ay, bx, by, cx, cy) {
  let [x0, y0, x1, y1, x2, y2] = [ax, ay, bx, by, cx, cy];
  if (y1 < y0) {
    [x0, y0, x1, y1] = [x1, y1, x0, y0];
  }
  if (y2 < y0) {
    [x0, y0, x2, y2] = [x2, y2, x0, y0];
  }
  if (y2 < y1) {
    [x1, y1, x2, y2] = [x2, y2, x1, y1];
  }
  if (y2 < 0 || y0 > MAP_LAST) {
    return;
  }
  if ((x0 < 0 && x1 < 0 && x2 < 0) || (x0 > MAP_LAST && x1 > MAP_LAST && x2 > MAP_LAST)) {
    return;
  }

  const longStep = y2 > y0 ? Math.trunc(((x2 - x0) << 12) / (y2 - y0)) : 0;
  let longX = x0 << 12;
  let isCutAtBottom = false;
  if (y1 >= 0 && y0 !== y1) {
    let shortX = x0 << 12;
    const shortStep = Math.trunc(((x1 - x0) << 12) / (y1 - y0));
    let y = y0;
    if (y0 < 0) {
      shortX -= shortStep * y0;
      longX -= longStep * y0;
      y = 0;
      y0 = 0;
    }
    if (y1 >= MAP_SIZE) {
      y1 = MAP_SIZE;
      isCutAtBottom = true;
    }
    for (; y <= y1 - 1; y++) {
      fillSpan(map, y, shortX >> 12, longX >> 12);
      shortX += shortStep;
      longX += longStep;
    }
  }
  // The last row of a triangle with a flat bottom is never drawn.
  if (isCutAtBottom || y1 > MAP_LAST || y1 === y2) {
    return;
  }
  let shortX = x1 << 12;
  const shortStep = Math.trunc(((x2 - x1) << 12) / (y2 - y1));
  if (y1 < 0) {
    shortX -= shortStep * y1;
    longX -= longStep * y0;
    y1 = 0;
  }
  const lastRow = Math.min(y2, MAP_LAST);
  for (let y = y1; y <= lastRow; y++) {
    fillSpan(map, y, shortX >> 12, longX >> 12);
    shortX += shortStep;
    longX += longStep;
  }
}

function castShadow(map, caster) {
  const world = caster.world;
  const faces = caster.faces;
  for (let i = faces.length - 1; i >= 0; i--) {
    const { a, b, c } = faces[i];
    paintShadow(
      map,
      Math.trunc(world[a * 3]), Math.trunc(world[a * 3 + 2]),
      Math.trunc(world[b * 3]), Math.trunc(world[b * 3 + 2]),
      Math.trunc(world[c * 3]), Math.trunc(world[c * 3 + 2]),
    );
  }
}

/** World positions of every vertex, then the three light maps: clean, one shadow, both shadows. */
function buildShadowMaps(part) {
  for (const { type, object: mesh } of part.scene.world) {
    if (type !== WORLD_MESH) {
      continue;
    }
    for (let at = 0; at < mesh.world.length; at += 3) {
      transform(mesh.matrix, mesh.position, at, mesh.world, at);
      mesh.world[at] += mesh.origin[0];
      mesh.world[at + 1] += mesh.origin[1];
      mesh.world[at + 2] += mesh.origin[2];
    }
  }
  const [first, second] = part.slabs;
  const [firstMap, secondMap, floorMap] = part.maps;
  part.isSecondOnTop = second.origin[1] > first.origin[1];
  const [upper, lower] = part.isSecondOnTop ? [second, first] : [first, second];
  const [upperMap, lowerMap] = part.isSecondOnTop ? [secondMap, firstMap] : [firstMap, secondMap];
  upperMap.set(part.lightMap);
  lowerMap.set(upperMap);
  castShadow(lowerMap, upper);
  floorMap.set(lowerMap);
  castShadow(floorMap, lower);
}

const corners = [new Float32Array(5), new Float32Array(5), new Float32Array(5)];

/** The light pass: the face again, textured with its light map looked at from straight above. */
function drawLight(face, map, lightTable) {
  const mesh = face.mesh;
  [face.a, face.b, face.c].forEach((vertex, i) => {
    const corner = corners[i];
    corner[0] = mesh.view[vertex * 3];
    corner[1] = mesh.view[vertex * 3 + 1];
    corner[2] = mesh.view[vertex * 3 + 2];
    corner[3] = mesh.world[vertex * 3] + TEXEL_BIAS;
    corner[4] = mesh.world[vertex * 3 + 2] + TEXEL_BIAS;
  });
  drawPerspectiveTriangle(corners[0], corners[1], corners[2], map, lightTable, false);
}

const facing = new Float32Array(3);

/** The slabs are not sorted or clipped away by depth: a face is drawn when it faces the camera. */
function isFacingCamera(face) {
  const view = face.mesh.view;
  for (let i = 0; i < 3; i++) {
    facing[i] = view[face.a * 3 + i] + view[face.b * 3 + i] + view[face.c * 3 + i];
  }
  return dot(facing, face.viewNormal) > 0;
}

function drawSlab(mesh, map, lightTable, isAlwaysVisible) {
  for (let i = mesh.faces.length - 1; i >= 0; i--) {
    const face = mesh.faces[i];
    if (isAlwaysVisible || isFacingCamera(face)) {
      drawFacePerspective(face);
      drawLight(face, map, lightTable);
    }
  }
}

/** The work buffer is not cleared: the floor slab covers the screen. */
function drawShadows(demo) {
  const machine = demo.machine;
  const part = demo.shadows;
  const [first, second, floor] = part.slabs;
  const [firstMap, secondMap, floorMap] = part.maps;
  drawSlab(floor, floorMap, part.lightTable, true);
  // Lower slab first.
  if (part.isSecondOnTop) {
    drawSlab(first, firstMap, part.lightTable, false);
    drawSlab(second, secondMap, part.lightTable, false);
  } else {
    drawSlab(second, secondMap, part.lightTable, false);
    drawSlab(first, firstMap, part.lightTable, false);
  }
  for (const [y, line] of TEXT) {
    drawTextShadowed(demo.font, machine.bufferA, TEXT_LEFT, y, line, TEXT_COLOUR);
  }
  showBuffer(machine, machine.bufferA);
}

export function* runShadows(demo) {
  const machine = demo.machine;
  const timer = machine.timerA;
  const part = demo.shadows;
  activateScene(part.scene);
  clearBuffer(machine.front);
  setDac(machine, part.scene.palette);
  while (timer.value < DURATION) {
    setFrame(timer.value, DURATION);
    animateScene(demo);
    buildShadowMaps(part);
    drawShadows(demo);
    yield;
  }
  timer.value -= DURATION;
}
