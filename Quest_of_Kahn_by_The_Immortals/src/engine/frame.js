// What the engine does every frame before anything is drawn: evaluate the keyframer, build the
// matrices, move every vertex to view space, then cull and depth-sort the faces.
// KAHN.EXE 0x2d150 (make a scene current), 0x2f43c (animate), 0x2c7a8 (cull and sort).
// The engine draws nothing itself: each part walks the sorted list and picks a drawer per face.

import { WIDTH, HEIGHT } from '../machine.js';
import { dot, transform, multiply, scaleColumns, quaternionDivideBySquaredLength, quaternionToMatrix, lookAt, KAHN_PI } from './math.js';
import { evaluate, evaluateHide, evaluateMorph, rewind } from './track.js';
import { view } from './triangle.js';
import {
  NODE_MESH, NODE_CAMERA, NODE_TARGET, NODE_LIGHT, WORLD_MESH, WORLD_LIGHT,
  MESH_HIDDEN, MESH_HIDDEN_BY_TRACK, MESH_DUMMY, MESH_MORPHS, MESH_DRAWN_BY_PART, FACE_ENVIRONMENT, FACE_TWO_SIDED,
} from './scene.js';

const f = Math.fround;

const NOT_TRANSFORMED = MESH_HIDDEN | MESH_HIDDEN_BY_TRACK | MESH_DUMMY;
const NOT_SORTED = NOT_TRANSFORMED | MESH_DRAWN_BY_PART;
const NEAR_PLANE = 1;
/** Sort keys are view depth in 1/16384 units, summed over a face's three vertices. */
const DEPTH_KEY_SCALE = 16384;
const FLARE_KEY_SCALE = 49152;
const KEY_BIAS = 0x1000000;
/** Pixels are not square in 320x200 on a 4:3 monitor. 0x5472c. */
const PIXEL_ASPECT = 0.75;

const TRACK_POSITION = 0;
const TRACK_ROTATION = 1;
const TRACK_SCALE = 2;
const TRACK_HIDE = 3;
const TRACK_MORPH = 4;
const TRACK_ROLL = 1;
const TRACK_FOV = 2;
const ROLL = 0;
const FOV = 1;

/** The scene being played: the globals the original keeps at 0x5c964..0x5c998 and 0x5e0c8. */
export const engine = {
  scene: null,
  /** The camera in use; parts switch it by frame number. 0x5c988. */
  camera: null,
  /** The only input of animate(). Parts compute it from the timer. 0x5c994. */
  frame: 0,
  firstFrame: 0,
  lastFrame: 0,
  /** Frames per run of the part, before the part overrides it. 0x5c990. */
  span: 0,
  /** Visible faces, nearest first; parts draw from the end. 0x5e0c8. */
  sorted: [],
};

const modelView = new Float32Array(9);
const normalView = new Float32Array(9);
const product = new Float32Array(9);
const offset = new Float32Array(3);
const moved = new Float32Array(3);
const blended = new Float32Array(3);

/** The field of view is horizontal, in degrees. */
export function setProjection(camera) {
  const tangent = Math.tan(camera.rollAndFov[FOV] * 0.5 * 0.005555555555555555 * KAHN_PI);
  view.scaleX = f(WIDTH * 0.5 * (1 / tangent));
  view.scaleY = f((1 / tangent) * ((HEIGHT * 0.5) / PIXEL_ASPECT));
}

/** Make a scene the one that animate() and cullAndSort() work on. */
export function activateScene(scene) {
  engine.scene = scene;
  engine.camera = scene.camera;
  engine.firstFrame = scene.firstFrame;
  engine.lastFrame = scene.lastFrame;
  engine.span = scene.span;
  engine.sorted = [];
  setProjection(scene.camera);
}

/**
 * Put every track cursor back on its first key. The original never does (its parts play once);
 * seeking replays a part from its start, and cursors only move forward.
 */
export function rewindScene(scene) {
  for (const node of scene.nodes) {
    node.tracks.forEach(rewind);
  }
}

function evaluateTracks(node, frame) {
  const object = node.object;
  const tracks = node.tracks;
  if (node.type === NODE_MESH) {
    evaluate(tracks[TRACK_POSITION], frame, object.origin, 0, 3);
    evaluate(tracks[TRACK_ROTATION], frame, object.quaternion, 0, 4);
    evaluate(tracks[TRACK_SCALE], frame, object.scale, 0, 3);
    evaluateHide(tracks[TRACK_HIDE], frame, object);
    evaluateMorph(tracks[TRACK_MORPH], frame, object);
    quaternionDivideBySquaredLength(object.quaternion);
    quaternionToMatrix(object.quaternion, object.rotation);
    object.matrix.set(object.rotation);
    scaleColumns(object.matrix, object.scale);
  } else if (node.type === NODE_CAMERA) {
    evaluate(tracks[TRACK_POSITION], frame, object.position, 0, 3);
    evaluate(tracks[TRACK_ROLL], frame, object.rollAndFov, ROLL, 1);
    evaluate(tracks[TRACK_FOV], frame, object.rollAndFov, FOV, 1);
    // Any camera with an animated field of view re-projects, but always with the camera in use.
    if (tracks[TRACK_FOV] && tracks[TRACK_FOV].keys.length > 1) {
      setProjection(engine.camera);
    }
  } else if (node.type === NODE_TARGET) {
    evaluate(tracks[TRACK_POSITION], frame, object.target, 0, 3);
  } else if (node.type === NODE_LIGHT) {
    evaluate(tracks[TRACK_POSITION], frame, object.position, 0, 3);
  }
}

/** point = parent matrix * point + parent origin */
function moveIntoParent(parent, point) {
  transform(parent.matrix, point, 0, moved, 0);
  point[0] = moved[0] + parent.origin[0];
  point[1] = moved[1] + parent.origin[1];
  point[2] = moved[2] + parent.origin[2];
}

/**
 * One pass in file order, which is enough because parents come before their children. A child's
 * own rotation matrix is not combined with its parent's, so environment mapping ignores the parent.
 */
function applyHierarchy(node) {
  if (node.type === NODE_MESH) {
    const parent = node.object;
    for (const child of node.children) {
      if (child.type === NODE_MESH) {
        multiply(parent.matrix, child.object.matrix, product);
        child.object.matrix.set(product);
        moveIntoParent(parent, child.object.origin);
      } else if (child.type === NODE_CAMERA) {
        moveIntoParent(parent, child.object.position);
      } else if (child.type === NODE_TARGET) {
        moveIntoParent(parent, child.object.target);
      } else if (child.type === NODE_LIGHT) {
        moveIntoParent(parent, child.object.position);
      }
    }
  } else if (node.type === NODE_CAMERA) {
    for (const child of node.children) {
      if (child.type === NODE_LIGHT) {
        child.object.position[0] += node.object.position[0];
        child.object.position[1] += node.object.position[1];
        child.object.position[2] += node.object.position[2];
      }
    }
  }
}

/** Environment mapping: the view-space normal's x and y pick the texel. */
function setEnvironmentTexel(mesh, vertex, normal, normalAt) {
  const x = normal[normalAt];
  const y = normal[normalAt + 1];
  const z = normal[normalAt + 2];
  const viewX = f(normalView[1] * y + normalView[0] * x + normalView[2] * z);
  const viewY = f(normalView[4] * y + normalView[3] * x + normalView[5] * z);
  mesh.uv[vertex * 2] = viewX * 128.0 + 127.0;
  mesh.uv[vertex * 2 + 1] = viewY * 128.0 + 127.0;
}

function blend(from, to, at, weight, otherWeight) {
  blended[0] = from[at] * weight + to[at] * otherWeight;
  blended[1] = from[at + 1] * weight + to[at + 1] * otherWeight;
  blended[2] = from[at + 2] * weight + to[at + 2] * otherWeight;
}

/**
 * Move a mesh into the view space of a camera: anything with a `matrix` and a `position`.
 * The roller-coaster brings its own.
 */
export function toViewSpace(mesh, camera) {
  if (mesh.flags & NOT_TRANSFORMED) {
    return;
  }
  const cameraMatrix = camera.matrix;
  multiply(cameraMatrix, mesh.matrix, modelView);
  multiply(cameraMatrix, mesh.rotation, normalView);
  offset[0] = mesh.origin[0] - camera.position[0];
  offset[1] = mesh.origin[1] - camera.position[1];
  offset[2] = mesh.origin[2] - camera.position[2];
  transform(cameraMatrix, offset, 0, moved, 0);
  const tx = moved[0];
  const ty = moved[1];
  const tz = moved[2];
  const viewPositions = mesh.view;
  const isEnvironmentMapped = (mesh.renderFlags & FACE_ENVIRONMENT) !== 0;

  if (!(mesh.flags & MESH_MORPHS)) {
    for (let at = 0; at < viewPositions.length; at += 3) {
      transform(modelView, mesh.position, at, viewPositions, at);
      viewPositions[at] += tx;
      viewPositions[at + 1] += ty;
      viewPositions[at + 2] += tz;
    }
    for (const face of mesh.faces) {
      transform(modelView, face.normal, 0, face.viewNormal, 0);
    }
    if (isEnvironmentMapped) {
      for (let vertex = 0; vertex < mesh.vertexCount; vertex++) {
        setEnvironmentTexel(mesh, vertex, mesh.normal, vertex * 3);
      }
    }
    return;
  }

  const from = mesh.morphFrom;
  const to = mesh.morphTo;
  const weight = mesh.morphWeight;
  const otherWeight = f(1 - weight);
  for (let at = 0; at < viewPositions.length; at += 3) {
    blend(from.position, to.position, at, weight, otherWeight);
    transform(modelView, blended, 0, viewPositions, at);
    viewPositions[at] += tx;
    viewPositions[at + 1] += ty;
    viewPositions[at + 2] += tz;
  }
  mesh.faces.forEach((face, index) => {
    blend(from.faces[index].normal, to.faces[index].normal, 0, weight, otherWeight);
    transform(modelView, blended, 0, face.viewNormal, 0);
  });
  if (isEnvironmentMapped) {
    for (let vertex = 0; vertex < mesh.vertexCount; vertex++) {
      blend(from.normal, to.normal, vertex * 3, weight, otherWeight);
      setEnvironmentTexel(mesh, vertex, blended, 0);
    }
  }
}

/** Evaluate every track at engine.frame and move the scene into the camera's view space. */
export function animate() {
  const nodes = engine.scene.nodes;
  const frame = f(engine.frame);
  for (const node of nodes) {
    evaluateTracks(node, frame);
  }
  for (const node of nodes) {
    applyHierarchy(node);
  }
  const camera = engine.camera;
  lookAt(camera.position, camera.target, camera.rollAndFov[ROLL], camera.matrix);
  for (const node of nodes) {
    if (node.type === NODE_MESH) {
      toViewSpace(node.object, camera);
    } else if (node.type === NODE_LIGHT) {
      const light = node.object;
      offset[0] = light.position[0] - camera.position[0];
      offset[1] = light.position[1] - camera.position[1];
      offset[2] = light.position[2] - camera.position[2];
      transform(camera.matrix, offset, 0, light.view, 0);
    }
  }
}

const depthSum = new Float32Array(3);

/**
 * A face can be seen when some vertex is beyond the near plane and it faces the camera: the
 * stored normals point away from the viewer on visible faces. Sets the depth sum as a side effect.
 * Only the engine's own pass lets two-sided faces through; the parts' hand-drawn loops never ask.
 */
export function isFaceVisible(face, honoursTwoSided = true) {
  const positions = face.mesh.view;
  const a = face.a * 3;
  const b = face.b * 3;
  const c = face.c * 3;
  depthSum[0] = positions[a] + positions[b] + positions[c];
  depthSum[1] = positions[a + 1] + positions[b + 1] + positions[c + 1];
  depthSum[2] = positions[a + 2] + positions[b + 2] + positions[c + 2];
  if (!(positions[a + 2] > NEAR_PLANE || positions[b + 2] > NEAR_PLANE || positions[c + 2] > NEAR_PLANE)) {
    return false;
  }
  return (honoursTwoSided && (face.flags & FACE_TWO_SIDED) !== 0) || dot(depthSum, face.viewNormal) > 0;
}

/** Collect the visible faces and flares of the scene into engine.sorted, nearest first. */
export function cullAndSort() {
  const sorted = engine.sorted;
  sorted.length = 0;
  for (const { type, object } of engine.scene.world) {
    if (type === WORLD_MESH) {
      if (object.flags & NOT_SORTED) {
        continue;
      }
      for (const face of object.faces) {
        if (isFaceVisible(face)) {
          face.key = Math.trunc(depthSum[2] * DEPTH_KEY_SCALE) + KEY_BIAS;
          sorted.push(face);
        }
      }
    } else if (type === WORLD_LIGHT) {
      const depth = object.view[2];
      if (depth > 0) {
        object.face.key = Math.trunc(depth * FLARE_KEY_SCALE) + KEY_BIAS;
        sorted.push(object.face);
      }
    }
  }
  // The original is a radix sort; any stable ascending sort gives the same order.
  sorted.sort((near, far) => near.key - far.key);
}
