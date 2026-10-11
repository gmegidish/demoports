// Objects and runtime materials built into ROBOTNIK.EXE's data segment (0x82a74, 0x835b8, 0x80dec,
// ...): same 0xb4-byte Object layout as the .eob records, with real pointers into the image. Parts
// change them permanently (flags, child links, material textures), so each address maps to one
// shared instance per program image, as the data segment does.

import { createObject } from './eob.js';
import { drawRoutine } from './raster/routines.js';

const FACE_INTS = 12;
const MATERIAL_BYTES = 0x30;

const instances = new WeakMap();

function cacheOf(image) {
  if (!instances.has(image)) {
    instances.set(image, { objects: new Map(), materials: new Map() });
  }
  return instances.get(image);
}

function int32s(image, address, count) {
  return Int32Array.from({ length: count }, (_, i) => image.i32(address + 4 * i));
}

/** A runtime material (0x30 bytes) of the data segment; its draw routine is looked up by address. */
export function staticMaterial(image, address) {
  const cache = cacheOf(image).materials;
  if (!cache.has(address)) {
    const drawAddress = image.u32(address + 0x2c);
    cache.set(address, {
      address,
      ambient: image.i32(address + 4),
      colourBase: image.i16(address + 8),
      colourTable: image.u32(address + 0xc),
      texture: null, // +0x10: set by the part (the image holds no texture data here)
      phongMap: null, // +0x14
      textureWidth: image.i32(address + 0x1c),
      textureHeight: image.i32(address + 0x20),
      drawAddress,
      draw: drawAddress ? drawRoutine(drawAddress) : null,
    });
  }
  return cache.get(address);
}

function staticKeys(image, address) {
  const keys = [];
  for (let at = address; at; at = image.u32(at)) {
    const floats = (offset, count) => Float32Array.from({ length: count }, (_, i) => image.f32(at + offset + 4 * i));
    keys.push({ frame: image.i32(at + 4), rotation: floats(0x08, 9), position: floats(0x2c, 3), euler: floats(0x38, 3) });
  }
  return keys;
}

/** The object at `address` in the data segment (with its sibling and child objects). */
export function staticObject(image, address) {
  const cache = cacheOf(image).objects;
  if (cache.has(address)) {
    return cache.get(address);
  }
  const at = (offset) => image.u32(address + offset);
  const collection = (countOffset, ints) => (at(countOffset + 4) ? int32s(image, at(countOffset + 4), image.i32(address + countOffset) * ints) : new Int32Array(0));
  const materialCount = image.i32(address + 0xa0);
  const object = createObject({
    points: collection(0x08, 3),
    faces: collection(0x10, FACE_INTS),
    faceNormals: collection(0x18, 3),
    cornerNormals: at(0x24) ? collection(0x20, 3) : null,
    matrix: int32s(image, address + 0x28, 12),
    position: int32s(image, address + 0x58, 3),
    angles: Int16Array.of(image.i16(address + 0x64), image.i16(address + 0x66), image.i16(address + 0x68)),
    bbox: int32s(image, address + 0x6c, 6),
    flags: at(0x84),
    centre: int32s(image, address + 0x88, 3),
    radius: image.i32(address + 0x94),
    materials: materialCount ? Array.from({ length: materialCount }, (_, i) => staticMaterial(image, at(0xa4) + i * MATERIAL_BYTES)) : null,
    keys: at(0xac) ? staticKeys(image, at(0xac)) : null,
    address,
  });
  cache.set(address, object);
  object.next = at(0) ? staticObject(image, at(0)) : null;
  object.child = at(4) ? staticObject(image, at(4)) : null;
  return object;
}

