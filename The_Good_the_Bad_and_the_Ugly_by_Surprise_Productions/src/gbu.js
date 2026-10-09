// GBU.EXE: the MyLZ-packed program (mylz.js), then the MOD at 0x9c40 and 49 named resources. The resource table is
// in the unpacked image at 008e:01a2 (linear 0x0a82): 49 eight-character names, then an (offset, size) dword pair
// for each, offsets from the base dword at 0x0a7e (= 0x9c40, the file offset of the MOD).
import { unpackGbu } from './mylz.js';

const TABLE_BASE = 0x0a7e;
const TABLE_NAMES = 0x0a82;
const RESOURCE_COUNT = 49;
const NAME_LENGTH = 8;

/**
 * @param {Uint8Array} exe GBU.EXE, unmodified
 * @returns {{ image: Uint8Array, resources: Map<string, Uint8Array> }}
 */
export function openGbu(exe) {
  const { image } = unpackGbu(exe);
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const base = view.getUint32(TABLE_BASE, true);
  const resources = new Map();
  for (let i = 0; i < RESOURCE_COUNT; i++) {
    const nameAt = TABLE_NAMES + i * NAME_LENGTH;
    const name = String.fromCharCode(...image.subarray(nameAt, nameAt + NAME_LENGTH)).trimEnd();
    const entryAt = TABLE_NAMES + RESOURCE_COUNT * NAME_LENGTH + i * 8;
    const offset = base + view.getUint32(entryAt, true);
    const size = view.getUint32(entryAt + 4, true);
    resources.set(name, exe.subarray(offset, offset + size));
  }
  return { image, resources };
}
