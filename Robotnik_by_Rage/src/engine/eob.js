// The .eob object files (raw dumps of the Imagine-TDDD-derived library's structs) and the material
// pass that turns their disk materials into runtime ones with a draw (span) routine each.
// Ports 0x24688 LoadObject = 0x433b0 LoadObjectTree + 0x41c50 BuildMaterialsTree (0x418b4 per object),
// and the demo helpers 0x2469c / 0x246d0 / 0x24720 that replace draw routines. See E1 §1, §3.1.
//
// An object here is a plain JS object whose fields mirror the 0xb4-byte struct (offsets in the
// comments of createObject). Faces stay as raw ints (12 per face) because the projector pass reuses
// the face type field as flags.

import { phongMap } from './tables.js';
import { drawRoutine } from './raster/routines.js';
import { FACE_INTS } from './layout.js';

const OBJECT_HEADER = 0xb4;
const POINT_BYTES = 12;
const FACE_BYTES = 0x30;
const DISK_MATERIAL_BYTES = 0x11c;
const KEY_BYTES = 0x44;
const TEXTURE_PALETTE_BYTES = 0x300;
const REQUIRED_TEXTURE_WIDTH = 256;

/** Disk material flags (+0x000). */
const MATERIAL_TEXTURED = 1;
const MATERIAL_PHONG = 2;
const MATERIAL_MAP_TYPE_2 = 4;
const MATERIAL_SPECIAL = 8;

/** The colour/shade table every runtime material points at (+0x0c), and the "special" one. */
export const COLOUR_TABLE = 0xfd0a0;
export const SPECIAL_COLOUR_TABLE = 0x1050cc;
const TEXTURED_COLOUR_BASE = 0x37;
const UNTEXTURED_SIZE = 0x80;

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.at = 0;
  }

  take(length) {
    if (this.at + length > this.bytes.length) {
      throw new Error('load error');
    }
    const chunk = this.bytes.subarray(this.at, this.at + length);
    this.at += length;
    return chunk;
  }

  u32() {
    const value = this.view.getUint32(this.at, true);
    this.at += 4;
    return value;
  }
}

function int32sOf(chunk) {
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  const out = new Int32Array(chunk.byteLength >> 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getInt32(4 * i, true);
  }
  return out;
}

/** 0x4304c / 0x430fc / 0x431b8: u32 count, then count records. */
function readCollection(reader, recordBytes) {
  const count = reader.u32();
  return { count, bytes: reader.take(count * recordBytes) };
}

function readDiskMaterial(chunk) {
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  const nameBytes = chunk.subarray(4, 0x104);
  const end = nameBytes.indexOf(0);
  return {
    flags: view.getUint32(0, true),
    texturePath: String.fromCharCode(...nameBytes.subarray(0, end < 0 ? nameBytes.length : end)),
    textureWidth: view.getInt32(0x104, true),
    textureHeight: view.getInt32(0x108, true),
    shadeExponent: view.getFloat32(0x10c, true),
    diffuse: view.getInt32(0x110, true),
    shades: view.getInt32(0x114, true),
    colourBase: view.getInt32(0x118, true),
  };
}

/** 0x43260: 0x44-byte keys back to back while Next != 0. */
function readKeys(reader) {
  const keys = [];
  for (;;) {
    const chunk = reader.take(KEY_BYTES);
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const floats = (offset, count) => Float32Array.from({ length: count }, (_, i) => view.getFloat32(offset + 4 * i, true));
    keys.push({
      frame: view.getInt32(4, true),
      rotation: floats(0x08, 9),
      position: floats(0x2c, 3),
      euler: floats(0x38, 3),
    });
    if (view.getUint32(0, true) === 0) {
      return keys;
    }
  }
}

/**
 * A fresh object with the fields of the 0xb4-byte struct. Static objects built by parts (the
 * original's data-segment objects 0x82a74...) use this too.
 */
export function createObject(fields = {}) {
  return {
    next: null, // +0x00 next sibling; also the render-list link (AddObject)
    child: null, // +0x04 first child
    points: new Int32Array(0), // +0x08 count / +0x0c: x,y,z per point
    faces: new Int32Array(0), // +0x10 / +0x14: 12 ints per face (FACE_INTS)
    faceNormals: new Int32Array(0), // +0x18 / +0x1c
    cornerNormals: null, // +0x20 / +0x24 (count must equal the point count)
    matrix: new Int32Array([256, 0, 0, 0, 256, 0, 0, 0, 256, 0, 0, 0]), // +0x28 K, 8.8 rotation
    position: new Int32Array(3), // +0x58
    angles: new Int16Array(3), // +0x64 (read unsigned by the renderer)
    bbox: new Int32Array(6), // +0x6c min x, max x, min y, max y, min z, max z
    flags: 0, // +0x84
    centre: new Int32Array(3), // +0x88
    radius: 0, // +0x94
    diskMaterials: [], // +0x98 / +0x9c
    materials: null, // +0xa0 / +0xa4 runtime materials (null: the world's)
    keys: null, // +0xac
    projectorVertex: 0, // +0xb0 first projector-vertex index (0x457f0 pass 1)
    ...fields,
  };
}

/** 0x432b0 / 0x43378: one object record, then its sibling subtree, then its child subtree. */
function readObject(reader) {
  const header = int32sOf(reader.take(OBJECT_HEADER));
  const headerView = new DataView(header.buffer);
  const points = readCollection(reader, POINT_BYTES);
  const faces = readCollection(reader, FACE_BYTES);
  const faceNormals = readCollection(reader, POINT_BYTES);
  const cornerNormals = readCollection(reader, POINT_BYTES);
  const materials = readCollection(reader, DISK_MATERIAL_BYTES);
  const object = createObject({
    points: int32sOf(points.bytes),
    faces: int32sOf(faces.bytes),
    faceNormals: int32sOf(faceNormals.bytes),
    cornerNormals: cornerNormals.count ? int32sOf(cornerNormals.bytes) : null,
    matrix: header.slice(0x28 / 4, 0x58 / 4),
    position: header.slice(0x58 / 4, 0x64 / 4),
    angles: new Int16Array([headerView.getInt16(0x64, true), headerView.getInt16(0x66, true), headerView.getInt16(0x68, true)]),
    bbox: header.slice(0x6c / 4, 0x84 / 4),
    flags: header[0x84 / 4] >>> 0,
    centre: header.slice(0x88 / 4, 0x94 / 4),
    radius: header[0x94 / 4],
    diskMaterials: Array.from({ length: materials.count },
      (_, i) => readDiskMaterial(materials.bytes.subarray(i * DISK_MATERIAL_BYTES, (i + 1) * DISK_MATERIAL_BYTES))),
  });
  if (header[0xac / 4] !== 0) {
    object.keys = readKeys(reader);
  }
  if (header[0] !== 0) {
    object.next = readObject(reader);
  }
  if (header[1] !== 0) {
    object.child = readObject(reader);
  }
  return object;
}

/** 0x433b0 LoadObjectTree: the whole file, which must be consumed exactly. */
export function LoadObjectTree(bytes) {
  const reader = new Reader(bytes);
  const root = readObject(reader);
  if (reader.at !== bytes.length) {
    throw new Error(`eob: ${bytes.length - reader.at} bytes left over`);
  }
  return root;
}

/** "E:\tomoons2\skultxt.pic" -> "skultxt.raw" (_splitpath / _makepath with no drive or directory). */
export function textureFileName(path) {
  const base = path.split(/[\\/:]/).pop();
  const dot = base.lastIndexOf('.');
  return `${(dot < 0 ? base : base.slice(0, dot)).toLowerCase()}.raw`;
}

function textureDrawAddress(disk, hasPhongMap) {
  if (hasPhongMap) {
    if (disk.flags & MATERIAL_MAP_TYPE_2) {
      return 0x2a9fc;
    }
    // Neither flag: "unknown map type" is printed and the untextured routine stays.
    return (disk.flags & MATERIAL_TEXTURED) ? 0x35860 : null;
  }
  if (disk.flags & MATERIAL_SPECIAL) {
    return 0x29994;
  }
  if (disk.flags & MATERIAL_MAP_TYPE_2) {
    return 0x2b1a4;
  }
  if (disk.flags & MATERIAL_TEXTURED) {
    return 0x331b4;
  }
  throw new Error('unknown mapping');
}

function untexturedDrawAddress(disk, hasPhongMap) {
  if (!hasPhongMap) {
    return 0x28b60;
  }
  if (disk.flags & MATERIAL_SPECIAL) {
    return 0x29710;
  }
  return disk.diffuse !== 256 ? 0x44354 : 0x2c118;
}

/** 0x418b4 for one disk material: the 0x30-byte runtime material. */
export function buildMaterial(disk, readFile) {
  const hasPhongMap = (disk.flags & MATERIAL_PHONG) !== 0;
  const product = Math.imul(disk.shades, disk.diffuse);
  const material = {
    ambient: Math.imul(256 - disk.diffuse, disk.shades) >> 8, // +0x04
    colourBase: (disk.colourBase << 16) >> 16, // +0x08
    colourTable: COLOUR_TABLE, // +0x0c
    texture: null, // +0x10 (256 wide)
    phongMap: hasPhongMap ? phongMap(disk.shadeExponent, 0, (product >> 8) - 1, (disk.shades * disk.diffuse) / 256, disk.colourBase) : null, // +0x14
    textureWidth: UNTEXTURED_SIZE, // +0x1c
    textureHeight: UNTEXTURED_SIZE, // +0x20
    drawAddress: untexturedDrawAddress(disk, hasPhongMap), // +0x2c
    draw: null,
  };
  if (material.drawAddress === 0x29710) {
    material.colourTable = SPECIAL_COLOUR_TABLE;
  }
  if (disk.texturePath) {
    const file = readFile(textureFileName(disk.texturePath));
    if (disk.textureWidth !== REQUIRED_TEXTURE_WIDTH) {
      throw new Error('assert dm[i].texture_width==256');
    }
    material.textureWidth = disk.textureWidth;
    material.textureHeight = disk.textureHeight;
    material.colourBase = TEXTURED_COLOUR_BASE;
    material.colourTable = COLOUR_TABLE;
    material.texture = file.subarray(TEXTURE_PALETTE_BYTES);
    const address = textureDrawAddress(disk, hasPhongMap);
    if (address !== null) {
      material.drawAddress = address;
    }
    if (address === 0x29994) {
      material.colourTable = SPECIAL_COLOUR_TABLE;
    }
  }
  material.draw = drawRoutine(material.drawAddress);
  return material;
}

/** 0x41c50 BuildMaterialsTree: 0x418b4 for the object, its siblings and children. */
export function BuildMaterialsTree(object, readFile) {
  for (let o = object; o; o = o.next) {
    o.materials = o.diskMaterials.map((disk) => buildMaterial(disk, readFile));
    if (o.child) {
      BuildMaterialsTree(o.child, readFile);
    }
  }
}

/**
 * 0x24688 LoadObject(name): load the tree out of the archive and build its materials (textures are
 * `<name>.raw` archive files: 768-byte palette + 256-wide pixels).
 */
export function LoadObject(archive, name) {
  const root = LoadObjectTree(archive.read(name));
  BuildMaterialsTree(root, (file) => archive.read(file));
  return root;
}

/** Every object of a tree (pre-order: self, children, then siblings' subtrees). */
export function* objectsOf(object) {
  for (let o = object; o; o = o.next) {
    yield o;
    if (o.child) {
      yield* objectsOf(o.child);
    }
  }
}

/** 0x2469c: one draw routine for every runtime material of one object. */
export function setObjectDraw(object, draw) {
  for (const material of object.materials ?? []) {
    material.draw = draw;
  }
}

/** 0x246d0: setObjectDraw for the whole tree (siblings and children). */
export function setTreeDraw(object, draw) {
  for (const o of objectsOf(object)) {
    setObjectDraw(o, draw);
  }
}

/** 0x24720: the object uses the single runtime material `material` for every face. */
export function useSingleMaterial(object, material) {
  object.materials = [material];
  for (let f = 0; f < object.faces.length; f += FACE_INTS) {
    object.faces[f + 1] = 0;
  }
}

/** 0x27798 / 0x277bc: set / clear render-flag bits in the whole tree. */
export function setTreeFlags(object, bits) {
  for (const o of objectsOf(object)) {
    o.flags = (o.flags | bits) >>> 0;
  }
}

export function clearTreeFlags(object, bits) {
  for (const o of objectsOf(object)) {
    o.flags = (o.flags & ~bits) >>> 0;
  }
}
