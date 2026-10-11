// The DOS/4GW program inside ROBOTNIK.EXE (a Linear Executable behind Watcom's stub), loaded the
// way DOS/4GW loads it: object 1 (code) at 0x10000, object 2 at 0x70000, object 3 (data) at 0x80000,
// 32-bit offset fixups (source type 7) applied. Parts read their tables and built-in objects from it.

const LE_HEADER_POINTER = 0x3c;
const FIXUP_OFFSET32 = 7;
const FIXUP_SELF_RELATIVE32 = 8;
const SOURCE_TYPE_MASK = 0x0f;
const TARGET_HAS_32BIT_OFFSET = 0x10;
const TARGET_HAS_16BIT_OBJECT = 0x40;

export function loadImage(exe) {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const u32 = (at) => view.getUint32(at, true);
  const u16 = (at) => view.getUint16(at, true);
  const le = u32(LE_HEADER_POINTER);
  const pageCount = u32(le + 0x14);
  const pageSize = u32(le + 0x28);
  const lastPageSize = u32(le + 0x2c);
  const objectTable = le + u32(le + 0x40);
  const objectCount = u32(le + 0x44);
  const fixupPageTable = le + u32(le + 0x68);
  const fixupRecords = le + u32(le + 0x6c);
  const dataPages = u32(le + 0x80);

  const objects = [];
  for (let i = 0; i < objectCount; i++) {
    const at = objectTable + i * 24;
    objects.push({ size: u32(at), base: u32(at + 4), firstPage: u32(at + 12), pages: u32(at + 16) });
  }
  const last = objects[objects.length - 1];
  const imageBase = objects[0].base;
  const image = new Uint8Array(last.base + last.size - imageBase);
  const imageView = new DataView(image.buffer);

  for (const o of objects) {
    for (let p = 0; p < o.pages; p++) {
      const page = o.firstPage + p;
      const from = dataPages + (page - 1) * pageSize;
      const length = page === pageCount ? lastPageSize : pageSize;
      const to = o.base - imageBase + p * pageSize;
      image.set(exe.subarray(from, from + Math.min(length, o.size - p * pageSize)), to);
    }
  }
  for (const o of objects) {
    for (let p = 0; p < o.pages; p++) {
      const page = o.firstPage + p;
      let at = fixupRecords + u32(fixupPageTable + (page - 1) * 4);
      const end = fixupRecords + u32(fixupPageTable + page * 4);
      while (at < end) {
        const sourceType = exe[at] & SOURCE_TYPE_MASK;
        const flags = exe[at + 1];
        const sourceOffset = view.getInt16(at + 2, true);
        at += 4;
        let targetObject;
        if (flags & TARGET_HAS_16BIT_OBJECT) {
          targetObject = u16(at);
          at += 2;
        } else {
          targetObject = exe[at];
          at += 1;
        }
        let targetOffset = 0;
        if (sourceType !== 2) {
          if (flags & TARGET_HAS_32BIT_OFFSET) {
            targetOffset = u32(at);
            at += 4;
          } else {
            targetOffset = u16(at);
            at += 2;
          }
        }
        const source = o.base + p * pageSize + sourceOffset;
        const target = objects[targetObject - 1].base + targetOffset;
        const inImage = source - imageBase;
        if (inImage < 0 || inImage + 4 > o.base - imageBase + o.size) {
          continue;
        }
        if (sourceType === FIXUP_OFFSET32) {
          imageView.setUint32(inImage, target, true);
        } else if (sourceType === FIXUP_SELF_RELATIVE32) {
          imageView.setUint32(inImage, (target - (source + 4)) >>> 0, true);
        }
      }
    }
  }
  return createImage(image, imageBase);
}

/**
 * Reads at the program's own addresses. clone() gives a demo its own copy: parts link and patch
 * the built-in objects of the data segment as the original did, and a rewind starts a fresh demo.
 */
function createImage(bytes, base) {
  const view = new DataView(bytes.buffer);
  return {
    bytes,
    base,
    clone: () => createImage(bytes.slice(), base),
    u8: (address) => bytes[address - base],
    u16: (address) => view.getUint16(address - base, true),
    i16: (address) => view.getInt16(address - base, true),
    u32: (address) => view.getUint32(address - base, true),
    i32: (address) => view.getInt32(address - base, true),
    f32: (address) => view.getFloat32(address - base, true),
    f64: (address) => view.getFloat64(address - base, true),
    slice: (address, length) => bytes.slice(address - base, address - base + length),
  };
}
