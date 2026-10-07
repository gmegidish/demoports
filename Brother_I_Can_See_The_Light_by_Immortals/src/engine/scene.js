// Loading a 3D Studio scene into the engine's model. TEST.EXE 0x2b88c..0x2ddd4, 0x3a200
// (Kahn's loader, KAHN.EXE 0x2cc1c..0x2f2f0, with the differences of docs/disassembly/E_engine.md).
// The engine is a 3DS keyframer player: meshes, cameras and lights from the editor chunks, one
// animation node per object from the keyframer chunks. Every xyz triple in the file is stored
// as (x, z, y), so +y is up here.

import { cross, normalize, transform, quaternionFromAxisAngle, quaternionMultiply, quaternionDivideBySquaredLength, DEMO_PI } from './math.js';
import { createTrack, addKey, prepareTangents } from './track.js';
import { loadPicture, TEXTURE_BYTES } from './pictures.js';

const f = Math.fround;

export const NODE_MESH = 0;
export const NODE_CAMERA = 1;
export const NODE_TARGET = 2;
export const NODE_LIGHT = 3;

export const WORLD_MESH = 0;
export const WORLD_CAMERA = 1;
export const WORLD_LIGHT = 2;

/** Mesh state flags. A mesh with any of the first three is not transformed. */
export const MESH_HIDDEN = 0x01;
export const MESH_HIDDEN_BY_TRACK = 0x02;
export const MESH_DUMMY = 0x04;
export const MESH_MORPHS = 0x08;
/** Set by the parts on meshes they draw by hand: kept out of the sorted face list. */
export const MESH_DRAWN_BY_PART = 0x10;

/** Face flags, derived from substrings of the object's name. Each part's draw loop tests them in its own order. */
export const FACE_AFFINE = 0x01;
export const FACE_PERSPECTIVE = 0x02;
export const FACE_ENVIRONMENT = 0x04;
export const FACE_SPECIAL = 0x08;
export const FACE_GOURAUD = 0x10;
export const FACE_ZER = 0x20;
export const FACE_TRN = 0x40;
export const FACE_TWO_SIDED = 0x80;
export const FACE_FLARE = 0x100;

const TRACK_POSITION = 0;
const TRACK_ROTATION = 1;
const TRACK_SCALE = 2;
const TRACK_HIDE = 3;
const TRACK_MORPH = 4;
const TRACK_ROLL = 1;
const TRACK_FOV = 2;
const TRACKS_PER_NODE = [5, 3, 1, 1];

const NODE_FLAG_HIDDEN = 0x0800;
const NO_PARENT = -1;
const NO_TCB = [0, 0, 0, 0, 0];

const CHUNK_OBJECT_NODE = 0xb002;
const CHUNK_CAMERA_NODE = 0xb003;
const CHUNK_TARGET_NODE = 0xb004;
const CHUNK_LIGHT_NODES = [0xb005, 0xb006, 0xb007];

/** Chunks that only hold other chunks. */
const CONTAINERS = new Set([
  0xc23d, 0x3daa, 0x4d4d, 0x3d3d, 0x1200, 0x2100, 0x4f00, 0xafff, 0xa010, 0xa020, 0xa030, 0xa200, 0xa230,
  0xb000, 0xb001, 0xb002, 0xb003, 0xb004, 0xb005, 0xb006, 0xb007,
]);

/** Lens in millimetres to field of view in degrees; an exact match or the formula. 0x55d98. */
const LENS_TO_FOV = [[15, 115], [20, 94.28571], [24, 84], [28, 76.36364], [35, 63], [50, 46], [85, 28], [135, 18], [200, 12]];


class Reader {
  constructor(bytes) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.bytes = bytes;
    this.at = 0;
  }

  u16() {
    const value = this.view.getUint16(this.at, true);
    this.at += 2;
    return value;
  }

  s16() {
    const value = this.view.getInt16(this.at, true);
    this.at += 2;
    return value;
  }

  u32() {
    const value = this.view.getUint32(this.at, true);
    this.at += 4;
    return value;
  }

  float() {
    const value = this.view.getFloat32(this.at, true);
    this.at += 4;
    return value;
  }

  /** File order x, y, z comes back as x, z, y. */
  swappedVector() {
    const x = this.float();
    const y = this.float();
    const z = this.float();
    return [x, z, y];
  }

  name() {
    let text = '';
    while (this.at < this.bytes.length && this.bytes[this.at] !== 0) {
      text += String.fromCharCode(this.bytes[this.at++]);
    }
    this.at++;
    return text;
  }
}

/**
 * The name, upper-cased, decides how the faces are drawn. SPC and GOR replace whatever came
 * before them; the rest combine. 0x2bf9c.
 */
function renderFlagsFromName(name) {
  const upper = name.toUpperCase();
  const has = (needle) => upper.includes(needle);
  let flags = 0;
  if (has('PRS')) {
    flags = FACE_PERSPECTIVE;
  } else if (has('ZER')) {
    flags = FACE_ZER;
  } else if (has('TRN')) {
    flags = FACE_TRN;
  } else if (!has('SPC') && !has('GOR')) {
    flags = FACE_AFFINE;
  }
  if (has('ENV')) {
    flags |= FACE_ENVIRONMENT;
  }
  if (has('SPC')) {
    flags = FACE_SPECIAL;
  }
  if (has('GOR')) {
    flags = FACE_GOURAUD;
  }
  if (has('CUL')) {
    flags |= FACE_TWO_SIDED;
  }
  return flags;
}

/**
 * Vertex data is kept in flat arrays, three floats a vertex (two for texture coordinates);
 * faces index into them.
 */
export function createMesh(name, id, vertexCount = 0) {
  const mesh = {
    name,
    id,
    parentId: NO_PARENT,
    flags: 0,
    renderFlags: 0,
    materialName: null,
    faces: [],
    translate: new Float32Array(3),
    inverseMatrix: new Float32Array(9),
    pivot: new Float32Array(3),
    // Animated every frame:
    origin: new Float32Array(3),
    quaternion: new Float32Array(4),
    scale: new Float32Array(3),
    matrix: new Float32Array(9),
    rotation: new Float32Array(9),
    morphFrom: null,
    morphTo: null,
    morphWeight: 0,
  };
  allocateVertices(mesh, vertexCount);
  return mesh;
}

export function allocateVertices(mesh, count) {
  mesh.vertexCount = count;
  /** Object space. */
  mesh.position = new Float32Array(count * 3);
  mesh.normal = new Float32Array(count * 3);
  /** View space, rewritten every frame. */
  mesh.view = new Float32Array(count * 3);
  /** Texel coordinates; environment-mapped meshes get new ones every frame. */
  mesh.uv = new Float32Array(count * 2);
}

export function createFace(mesh, a, b, c, flags) {
  return { mesh, a, b, c, normal: new Float32Array(3), viewNormal: new Float32Array(3), key: 0, flags, texture: null };
}

function lensToFov(lens) {
  for (const [knownLens, fov] of LENS_TO_FOV) {
    if (lens === f(knownLens)) {
      return f(fov);
    }
  }
  return f((15.0 / lens) * 160.0);
}

function findWorldObject(scene, name) {
  const wanted = name.toLowerCase();
  const entry = scene.world.find((item) => item.object.name !== null && item.object.name.toLowerCase() === wanted);
  return entry ? entry.object : null;
}

/** Case-insensitive, meshes only. 0x2d0b8. */
export function findMesh(scene, name) {
  const wanted = name.toLowerCase();
  const entry = scene.world.find((item) => item.type === WORLD_MESH && item.object.name !== null && item.object.name.toLowerCase() === wanted);
  if (!entry) {
    throw new Error(`no mesh named "${name}" in the scene`);
  }
  return entry.object;
}

/** Case-insensitive, any kind of object: the parts use it to find cameras. 0x2d014. */
export function findObject(scene, name) {
  const object = findWorldObject(scene, name);
  if (!object) {
    throw new Error(`no object named "${name}" in the scene`);
  }
  return object;
}

function readTrackHeader(reader) {
  const track = createTrack();
  const flags = reader.u16();
  track.loop = flags & 3 ? 0x0f00 : 0;
  reader.at += 8;
  const keyCount = reader.u16();
  reader.at += 2;
  return { track, keyCount };
}

/** Per key: frame, then whichever of tension, continuity, bias, ease to, ease from the flags name. 0x2e2f8. */
function readKeyHeader(reader) {
  const frame = reader.u16();
  reader.at += 2;
  const present = reader.u16();
  const tcb = [0, 0, 0, 0, 0];
  for (let bit = 0; bit < 16; bit++) {
    if (present & (1 << bit)) {
      const value = reader.float();
      if (bit < 5) {
        tcb[bit] = value;
      }
    }
  }
  return { frame, tcb };
}

function readChunks(reader, end, loading) {
  while (reader.at < end) {
    const start = reader.at;
    if (start + 6 > reader.bytes.length) {
      return;
    }
    const id = reader.u16();
    const length = reader.u32();
    if (length === 0) {
      return;
    }
    const chunkEnd = start + length;
    if (CONTAINERS.has(id)) {
      loading.container = id;
      readChunks(reader, chunkEnd, loading);
    } else if (HANDLERS[id]) {
      HANDLERS[id](reader, chunkEnd, loading);
    }
    reader.at = chunkEnd;
  }
}

function attachTrack(loading, slot, track, nodeTypes) {
  const node = loading.scene.nodes.find((candidate) => candidate.id === loading.id);
  if (node && nodeTypes.includes(node.type)) {
    node.tracks[slot] = track;
  }
  return node;
}

function readVectorTrack(reader, loading, slot, nodeTypes) {
  const { track, keyCount } = readTrackHeader(reader);
  for (let i = 0; i < keyCount; i++) {
    const { frame, tcb } = readKeyHeader(reader);
    addKey(track, frame, reader.swappedVector(), tcb);
  }
  prepareTangents(track);
  attachTrack(loading, slot, track, nodeTypes);
}

const HANDLERS = {
  // Object block: a name, then a mesh, a light or a camera.
  0x4000(reader, end, loading) {
    loading.name = reader.name();
    readChunks(reader, end, loading);
  },

  0x4100(reader, end, loading) {
    const mesh = createMesh(loading.name, loading.id++);
    mesh.renderFlags = renderFlagsFromName(mesh.name);
    loading.current = mesh;
    loading.scene.world.push({ type: WORLD_MESH, object: mesh });
    readChunks(reader, end, loading);
  },

  0x4110(reader, end, loading) {
    const mesh = loading.current;
    allocateVertices(mesh, reader.u16());
    for (let i = 0; i < mesh.vertexCount; i++) {
      mesh.position.set(reader.swappedVector(), i * 3);
    }
  },

  0x4120(reader, end, loading) {
    const mesh = loading.current;
    const count = reader.u16();
    loading.scene.faceCount += count;
    for (let i = 0; i < count; i++) {
      const a = reader.u16();
      const b = reader.u16();
      const c = reader.u16();
      reader.at += 2;
      mesh.faces.push(createFace(mesh, a, b, c, mesh.renderFlags));
    }
    readChunks(reader, end, loading);
  },

  // One material per mesh: the last face-material chunk wins.
  0x4130(reader, end, loading) {
    loading.current.materialName = reader.name();
  },

  // Texel coordinates for a 256x256 texture, v flipped, biased by 32 widths to stay positive.
  0x4140(reader, end, loading) {
    const mesh = loading.current;
    const count = reader.u16();
    for (let i = 0; i < count; i++) {
      const u = reader.float();
      const v = reader.float();
      mesh.uv[i * 2] = u * 256.0 + 8192.0;
      mesh.uv[i * 2 + 1] = 8192.0 + -v * 256.0;
    }
  },

  // Mesh matrix: stored inverted (each row over its squared length) in the swapped axes.
  0x4160(reader, end, loading) {
    const mesh = loading.current;
    const m = new Float32Array(9);
    for (let i = 0; i < 9; i++) {
      m[i] = reader.float();
    }
    for (let row = 0; row < 3; row++) {
      const scale = f(1.0 / (m[row * 3 + 1] * m[row * 3 + 1] + m[row * 3] * m[row * 3] + m[row * 3 + 2] * m[row * 3 + 2]));
      m[row * 3] *= scale;
      m[row * 3 + 1] *= scale;
      m[row * 3 + 2] *= scale;
    }
    const inverse = mesh.inverseMatrix;
    inverse.set([m[0], m[2], m[1], m[6], m[8], m[7], m[3], m[5], m[4]]);
    mesh.translate.set(reader.swappedVector());
  },

  // A light is a flare: one position and a pseudo-face so it can sit in the sorted face list.
  0x4600(reader, end, loading) {
    const light = {
      name: loading.name,
      id: loading.id++,
      parentId: NO_PARENT,
      position: Float32Array.from(reader.swappedVector()),
      view: new Float32Array(3),
    };
    light.face = { light, key: 0, flags: FACE_FLARE, texture: null };
    loading.current = light;
    loading.scene.world.push({ type: WORLD_LIGHT, object: light });
    loading.scene.lightCount++;
    loading.scene.faceCount++;
  },

  0x4700(reader, end, loading) {
    const position = reader.swappedVector();
    const target = reader.swappedVector();
    const roll = reader.float();
    const lens = reader.float();
    const camera = {
      name: loading.name,
      id: loading.id++,
      parentId: NO_PARENT,
      targetParentId: NO_PARENT,
      position: Float32Array.from(position),
      target: Float32Array.from(target),
      /** Radians. */
      rollAndFov: Float32Array.of(-roll * 3.14159265358979 * 0.00555555555, lensToFov(lens)),
      matrix: new Float32Array(9),
    };
    loading.current = camera;
    loading.scene.world.push({ type: WORLD_CAMERA, object: camera });
  },

  0xa000(reader, end, loading) {
    loading.material = { name: reader.name(), file: null, texture: null };
    loading.scene.materials.push(loading.material);
  },

  0xa300(reader, end, loading) {
    loading.material.file = reader.name();
  },

  0xb008(reader, end, loading) {
    const first = reader.u32() & 0xffff;
    const last = reader.u32() & 0xffff;
    loading.scene.firstFrame = first;
    loading.scene.lastFrame = last;
    loading.scene.span = last - first;
  },

  0xb030(reader, end, loading) {
    loading.id = reader.u16();
  },

  // Node header: which object this animation node drives, and its parent node.
  0xb010(reader, end, loading) {
    const scene = loading.scene;
    const name = reader.name();
    const flags = reader.u16();
    reader.at += 2;
    const parent = reader.s16();

    let parentObjectId = NO_PARENT;
    if (parent !== NO_PARENT) {
      for (const node of scene.nodes) {
        if (node.id === parent) {
          parentObjectId = node.object.id;
        }
      }
    }

    let object;
    if (name === '$$$DUMMY') {
      object = createMesh(null, loading.id);
      object.flags = MESH_DUMMY;
      scene.world.push({ type: WORLD_MESH, object });
    } else {
      object = findWorldObject(scene, name);
      if (!object) {
        if (name.includes('$AMBIENT$')) {
          return;
        }
        throw new Error(`3DS: keyframer node for unknown object "${name}"`);
      }
    }

    let type;
    if (loading.container === CHUNK_OBJECT_NODE) {
      type = NODE_MESH;
      object.parentId = parentObjectId;
      if (flags & NODE_FLAG_HIDDEN) {
        object.flags |= MESH_HIDDEN;
        scene.faceCount -= object.faces.length;
      }
      loading.current = object;
    } else if (loading.container === CHUNK_CAMERA_NODE) {
      type = NODE_CAMERA;
      object.parentId = parentObjectId;
    } else if (loading.container === CHUNK_TARGET_NODE) {
      type = NODE_TARGET;
      object.targetParentId = parentObjectId;
    } else if (CHUNK_LIGHT_NODES.includes(loading.container)) {
      type = NODE_LIGHT;
      object.parentId = parentObjectId;
    } else {
      return;
    }

    const node = { type, id: loading.id, object, tracks: new Array(TRACKS_PER_NODE[type]).fill(null), children: [] };
    if (parent !== NO_PARENT) {
      for (const candidate of scene.nodes) {
        if (candidate.id === parent) {
          // The newest child goes first, as in the original's linked list.
          candidate.children.unshift(node);
        }
      }
    }
    scene.nodes.push(node);
  },

  0xb011(reader, end, loading) {
    loading.current.name = reader.name();
  },

  0xb013(reader, end, loading) {
    loading.current.pivot.set(reader.swappedVector());
  },

  0xb020(reader, end, loading) {
    readVectorTrack(reader, loading, TRACK_POSITION, [NODE_MESH, NODE_CAMERA, NODE_TARGET, NODE_LIGHT]);
  },

  // Each key is a rotation relative to the previous one; they are accumulated into absolute
  // orientations here, so playback can treat the quaternion as four plain spline channels.
  0xb021(reader, end, loading) {
    const { track, keyCount } = readTrackHeader(reader);
    let accumulated = Float32Array.of(0, 0, 0, 1);
    for (let i = 0; i < keyCount; i++) {
      const { frame, tcb } = readKeyHeader(reader);
      const angle = reader.float();
      const axis = reader.swappedVector();
      const q = Float32Array.of(axis[0], axis[1], axis[2], angle);
      quaternionFromAxisAngle(q);
      const product = new Float32Array(4);
      quaternionMultiply(q, accumulated, product);
      accumulated = product;
      const key = Float32Array.from(product);
      quaternionDivideBySquaredLength(key);
      addKey(track, frame, key, tcb);
    }
    prepareTangents(track);
    attachTrack(loading, TRACK_ROTATION, track, [NODE_MESH]);
  },

  0xb022(reader, end, loading) {
    readVectorTrack(reader, loading, TRACK_SCALE, [NODE_MESH]);
  },

  0xb023(reader, end, loading) {
    const { track, keyCount } = readTrackHeader(reader);
    for (let i = 0; i < keyCount; i++) {
      const { frame, tcb } = readKeyHeader(reader);
      addKey(track, frame, [reader.float()], tcb);
    }
    prepareTangents(track);
    attachTrack(loading, TRACK_FOV, track, [NODE_CAMERA]);
  },

  0xb024(reader, end, loading) {
    const { track, keyCount } = readTrackHeader(reader);
    for (let i = 0; i < keyCount; i++) {
      const { frame, tcb } = readKeyHeader(reader);
      addKey(track, frame, [-reader.float() * DEMO_PI * 0.005555555555555555], tcb);
    }
    prepareTangents(track);
    attachTrack(loading, TRACK_ROLL, track, [NODE_CAMERA]);
  },

  // Hide keys carry a frame and nothing else. A hide track takes over from the node's hidden flag.
  0xb029(reader, end, loading) {
    const { track, keyCount } = readTrackHeader(reader);
    for (let i = 0; i < keyCount; i++) {
      const frame = reader.u16();
      reader.at += 4;
      addKey(track, frame, [0], NO_TCB);
    }
    track.length = keyCount > 0 ? track.keys[keyCount - 1].frame : 0;
    const node = attachTrack(loading, TRACK_HIDE, track, [NODE_MESH]);
    if (node && node.type === NODE_MESH) {
      node.object.flags &= ~MESH_HIDDEN;
    }
  },

  0xb026(reader, end, loading) {
    const { track, keyCount } = readTrackHeader(reader);
    for (let i = 0; i < keyCount; i++) {
      const { frame, tcb } = readKeyHeader(reader);
      addKey(track, frame, [0], tcb, findObject(loading.scene, reader.name()));
    }
    prepareTangents(track);
    const node = attachTrack(loading, TRACK_MORPH, track, [NODE_MESH]);
    if (node && node.type === NODE_MESH) {
      node.object.flags |= MESH_MORPHS;
    }
  },
};

/** File vertices are in world space; make them local to the mesh and relative to its pivot. 0x2f140. */
function moveVerticesToObjectSpace(scene) {
  const relative = new Float32Array(3);
  for (const { type, object: mesh } of scene.world) {
    if (type !== WORLD_MESH) {
      continue;
    }
    const position = mesh.position;
    for (let at = 0; at < position.length; at += 3) {
      relative[0] = position[at] - mesh.translate[0];
      relative[1] = position[at + 1] - mesh.translate[1];
      relative[2] = position[at + 2] - mesh.translate[2];
      transform(mesh.inverseMatrix, relative, 0, position, at);
      position[at] -= mesh.pivot[0];
      position[at + 1] -= mesh.pivot[1];
      position[at + 2] -= mesh.pivot[2];
    }
  }
}

/**
 * Face normals for every mesh; vertex normals, plain averages of them, only for environment-mapped
 * meshes. Smoothing groups are ignored. 0x31550.
 */
export function computeNormals(mesh) {
  const position = mesh.position;
  const edge1 = new Float32Array(3);
  const edge2 = new Float32Array(3);
  for (const face of mesh.faces) {
    for (let i = 0; i < 3; i++) {
      edge1[i] = position[face.b * 3 + i] - position[face.a * 3 + i];
      edge2[i] = position[face.c * 3 + i] - position[face.a * 3 + i];
    }
    cross(edge1, edge2, face.normal);
    normalize(face.normal);
  }
  // Every mesh: the test is renderFlags != 0, and every name yields some flag (Kahn: env meshes only).
  if (mesh.renderFlags === 0) {
    return;
  }
  const sums = new Float32Array(mesh.vertexCount * 3);
  const isReferenced = new Uint8Array(mesh.vertexCount);
  for (const face of mesh.faces) {
    for (const vertex of new Set([face.a, face.b, face.c])) {
      isReferenced[vertex] = 1;
      sums[vertex * 3] += face.normal[0];
      sums[vertex * 3 + 1] += face.normal[1];
      sums[vertex * 3 + 2] += face.normal[2];
    }
  }
  const one = new Float32Array(3);
  for (let vertex = 0; vertex < mesh.vertexCount; vertex++) {
    if (isReferenced[vertex]) {
      one.set(sums.subarray(vertex * 3, vertex * 3 + 3));
      normalize(one);
    } else {
      one.set([0, 0, 1]);
    }
    mesh.normal.set(one, vertex * 3);
  }
}

/**
 * One 256x256 texture per material, loaded in file order whether used or not, by the bare file name.
 * Each material keeps its picture's palette; the last one loaded becomes the scene's. The light
 * faces get an empty block: the parts load their own flare and draw that. 0x2bcd4.
 */
function loadTextures(scene, machine, assets) {
  if (scene.lightCount !== 0) {
    const empty = new Uint8Array(TEXTURE_BYTES);
    for (const { type, object } of scene.world) {
      if (type === WORLD_LIGHT) {
        object.face.texture = empty;
      }
    }
  }
  for (const material of scene.materials) {
    material.texture = new Uint8Array(TEXTURE_BYTES);
    if (material.file) {
      const picture = loadPicture(machine, assets, material.file);
      material.texture = picture.pixels;
      material.palette = picture.palette;
    }
  }
  for (const { type, object: mesh } of scene.world) {
    if (type !== WORLD_MESH || mesh.faces.length === 0) {
      continue;
    }
    // A mesh with no material, or an unknown one, silently gets the scene's first.
    const material = scene.materials.find((candidate) => candidate.name === mesh.materialName) ?? scene.materials[0];
    for (const face of mesh.faces) {
      face.texture = material.texture;
    }
  }
}

export function createScene(userWord = 0) {
  return {
    /** Meshes, cameras and lights in creation order. */
    world: [],
    /** Animation nodes in file order; parents come before their children. */
    nodes: [],
    materials: [],
    faceCount: 0,
    lightCount: 0,
    camera: null,
    firstFrame: 0,
    lastFrame: 0,
    span: 0,
    /** Second argument of the loader; the flare drawer uses it as the flare's size. */
    userWord,
    palette: null,
  };
}

/**
 * Load a .3DS file with its textures. 0x2ddd4.
 * @param {object} machine the picture loader's last palette ([0x5dbf0]) is kept on it
 * @param {{read: (name: string) => Uint8Array}} assets
 * @param {string} name as the demo spells it, e.g. "scenes\\creat.3ds"
 * @param {number} userWord
 */
export function loadScene(machine, assets, name, userWord) {
  const bytes = assets.read(name);
  const scene = createScene(userWord);
  const loading = { scene, id: 0, name: '', current: null, material: null, container: 0 };
  readChunks(new Reader(bytes), bytes.length, loading);
  moveVerticesToObjectSpace(scene);

  const firstCamera = scene.world.find((item) => item.type === WORLD_CAMERA);
  if (!firstCamera) {
    throw new Error(`${name}: No Camera Defined.`);
  }
  scene.camera = firstCamera.object;
  for (const { type, object } of scene.world) {
    if (type === WORLD_MESH) {
      computeNormals(object);
    }
  }
  loadTextures(scene, machine, assets);
  scene.palette = machine.lastPalette.slice();
  return scene;
}

export { TEXTURE_BYTES };
