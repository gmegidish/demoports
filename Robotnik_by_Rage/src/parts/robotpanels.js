// Part 9's "rage mirror" and "rage tv" panels: the draw routine 0x37668 (perspective) and its affine
// twin 0x34f6c, which light a 320x200 picture by a 320x200 light map through the shade table, and
// the fake mirror: 0x1e860 RenderMirror renders the scene from the mirror's centre, with the camera
// aimed by 0x1e704 AimMirrorCam. See docs/disassembly/P9_robot.md §4, §5.

import {
  perspectiveTriangle, roundToEven, triangleOf, rasterTemplate, clippedSpan, drawRoutine,
  setObjectDraw, RenderWorld, GetCameraPos, GetCameraAngles, SetCameraPos, SetCameraAngles, GetObjPos,
} from '../engine/index.js';
import { textureChannel } from '../engine/raster/texture.js';
import { f32, imul, trunc, sext16 } from '../engine/fixed.js';

const WIDTH = 320;
const HEIGHT = 200;
/** The panel buffers are read through a 256-wide window starting at column 32 (mat+0x10 + 0x20). */
const WINDOW_LEFT = 32;
/** 0x90e5c: row offsets v*320 below row 200; rows 200..255 all point at 64000. */
const PAST_LAST_ROW = HEIGHT * WIDTH;
const BLOCK = 16;

/** The mirror's centre relative to the robot's root (world units). */
export const MIRROR_CENTRE = [4000, 4000, -4000];
/** 0x8da9c: 4000² + 4000², the squared distance from the room centre to the mirror in xz and yz. */
const MIRROR_DISTANCE_SQUARED = 32000000;
/** 0x8daac: radians to angle units (4096 per turn would be 651.899...). */
const ANGLE_UNITS_PER_RADIAN = 651.9;
const QUARTER_TURN = 512;

const AFFINE_TEXTURE = 0x331b4;
const PERSPECTIVE_TEXTURE = 0x36890;

/** The texel offset of the packed 8.8 pair (v<<16 | u) in a 320x200 panel buffer. */
function panelOffset(uv) {
  const v = uv >>> 24;
  const u = (uv >>> 8) & 0xff;
  return (v < HEIGHT ? v * WIDTH : PAST_LAST_ROW) + u + WINDOW_LEFT;
}

/** The panel texel: the picture's colour lit by the light map, shade[light*256 + colour]. */
function panelTexel(material, shade, uv) {
  const at = panelOffset(uv);
  return shade[material.lightMap[at] * 256 + material.texture[at]];
}

/**
 * 0x4f9dd: 0x4f891's span with 0x37668's own ends: `count` pixels from x (not count + 1), cut at
 * x = 319 inclusive; the pixel loop 0x4fb35 always writes at least one pixel.
 */
function panelSpan(state, material, shade, target, rowOffset, x0, count0) {
  let [iz, uz, vz] = state.values;
  let inverse = state.inverse;
  let x = x0;
  let count = count0;
  if (x < 0) {
    vz = f32(vz + f32(state.perPixel[2] * x));
    uz = f32(uz + f32(state.perPixel[1] * x));
    iz = f32(iz + f32(state.perPixel[0] * x));
    inverse = f32(1 / iz);
    count += x;
    x = 0;
  }
  let v0 = roundToEven(f32(vz * inverse));
  let u0 = roundToEven(f32(uz * inverse));
  let izAhead = f32(iz + state.perBlock[0]);
  let inverseAhead = f32(1 / izAhead);
  if (x + count > WIDTH - 1) {
    count = WIDTH - x;
  }
  let remaining = count;
  if (remaining < 0) {
    return;
  }
  do {
    let uv = ((v0 << 16) + u0) | 0;
    vz = f32(vz + state.perBlock[2]);
    uz = f32(uz + state.perBlock[1]);
    const v1 = roundToEven(f32(vz * inverseAhead));
    const u1 = roundToEven(f32(uz * inverseAhead));
    izAhead = f32(izAhead + state.perBlock[0]);
    inverseAhead = f32(1 / izAhead);
    const duv = ((((v1 - v0) >> 4) << 16) + ((u1 - u0) >> 4)) | 0;
    const n = Math.min(BLOCK, remaining);
    const pixels = Math.max(n, 1);
    for (let k = 0; k < pixels; k++) {
      target[rowOffset + x + k] = panelTexel(material, shade, uv);
      uv = (uv + duv) | 0;
    }
    u0 = u1;
    v0 = v1;
    x += n;
    remaining -= n;
  } while (remaining > 0);
}

/** 0x37668: perspective-correct panel (0x36890's setup with the span 0x4f9dd). */
export function drawPanel(polygon, context) {
  const { target, colourTable } = context;
  const material = polygon.material;
  perspectiveTriangle(polygon, context, (state, rowOffset, x, count) =>
    panelSpan(state, material, colourTable, target, rowOffset, x, count));
}

function isOutsideHorizontally(xs) {
  return Math.max(...xs) < 0 || Math.min(...xs) >= WIDTH;
}

/** 0x34f6c: the affine panel (0x331b4's template, spans 0x4fef6 / 0x4ff39). */
export function drawPanelAffine(polygon, context) {
  const triangle = triangleOf(context.vertices, polygon);
  const material = polygon.material;
  const { target, colourTable } = context;
  rasterTemplate(triangle, [textureChannel(polygon, triangle.order)],
    (y, xLong, xShort, isLongLeft, values, dx) => clippedSpan(y, xLong, xShort, isLongLeft, values, dx,
      (at, v) => {
        target[at] = panelTexel(material, colourTable, v[0]);
      }),
    { rejectBox: isOutsideHorizontally });
}

/**
 * The angle (4096 per turn) at the mirror between the directions to the room centre and to the
 * viewer, by the law of cosines: `toViewer` and `toCentre` are squared distances. The x87 keeps
 * extended intermediates (DOSBox ignores the 24-bit precision control) and the result is stored as
 * a double, so plain double math. acos (0x45542) of a value rounded past ±1 is a guess: clamped.
 */
function mirrorAngle(toViewer, viewerToCentre) {
  const k = MIRROR_DISTANCE_SQUARED;
  const cosine = (k + toViewer - viewerToCentre) / (Math.sqrt(k) * Math.sqrt(toViewer) * 2);
  return Math.acos(Math.min(1, Math.max(-1, cosine))) * ANGLE_UNITS_PER_RADIAN;
}

/** 0x44160 + fistp + a word store. */
function angleWord(x) {
  return sext16(trunc(x));
}

function squared(a) {
  return imul(a, a);
}

/**
 * 0x1e704 AimMirrorCam(world, viewer): the camera (already at the mirror) turns towards the room
 * centre by the angles the viewer makes with it, in the xz plane (yaw) and the yz plane (pitch).
 */
export function aimMirrorCamera(world, viewer) {
  const [cx, cy, cz] = GetCameraPos(world);
  const [px, py, pz] = viewer;
  const dz = cz - pz;
  let yaw = mirrorAngle((squared(cx - px) + squared(dz)) | 0, (squared(px) + squared(pz)) | 0);
  if (-pz < px) {
    yaw = -yaw;
  }
  const pitch = mirrorAngle((squared(cy - py) + squared(dz)) | 0, (squared(py) + squared(pz)) | 0);
  SetCameraAngles(world, [angleWord(pitch - QUARTER_TURN), angleWord(yaw - QUARTER_TURN), 0]);
}

/**
 * 0x1e860 RenderMirror(world, target, root): the whole scene from the mirror's centre into
 * `target` (the mirror's own picture), with the affine routines for the room and the panels; then
 * the perspective ones and the viewer's camera are put back.
 */
export function renderMirror(world, target, scene, colourTable) {
  const viewerPosition = GetCameraPos(world);
  const viewerAngles = GetCameraAngles(world);
  const root = GetObjPos(scene.root);
  SetCameraPos(world, root[0] + MIRROR_CENTRE[0], root[1] + MIRROR_CENTRE[1], root[2] + MIRROR_CENTRE[2]);
  aimMirrorCamera(world, viewerPosition);
  setObjectDraw(scene.root, drawRoutine(AFFINE_TEXTURE));
  setObjectDraw(scene.panels, drawPanelAffine);
  RenderWorld(world, { target, colourTable });
  setObjectDraw(scene.root, drawRoutine(PERSPECTIVE_TEXTURE));
  setObjectDraw(scene.panels, drawPanel);
  SetCameraPos(world, ...viewerPosition);
  SetCameraAngles(world, viewerAngles);
}
