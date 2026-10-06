// The demo's files and its picture loader. KAHN.EXE 0x1f07c, 0x1f114.

import { decodePicture } from '../picture.js';
import { setDac, PALETTE_BYTES } from '../machine.js';

/** Textures are 256x256 in a 64 KB block, so a texel address is just (v << 8) | u. */
export const TEXTURE_BYTES = 0x10000;

/** DOS paths are case-insensitive, use backslashes, and the demo doubles a slash in one place. */
function normalizePath(name) {
  return name.toUpperCase().replace(/[\\/]+/g, '/');
}

/**
 * @param {Map<string, Uint8Array>|Record<string, Uint8Array>} files keyed by path relative to the demo's folder
 * @returns {{read: (name: string) => Uint8Array}}
 */
export function createAssets(files) {
  const byPath = new Map();
  for (const [path, bytes] of files instanceof Map ? files : Object.entries(files)) {
    byPath.set(normalizePath(path), bytes);
  }
  return {
    read(name) {
      const bytes = byPath.get(normalizePath(name));
      if (!bytes) {
        throw new Error(`Unable to load file : ${name}`);
      }
      return bytes;
    },
  };
}

/**
 * Decode a picture into a 64 KB block of palette indices. Every load replaces the machine's
 * palette with the picture's, scaled to 6 bits; the DAC changes only when asked.
 * @param {Uint8Array} [into] decode here instead of into a new block (the logo goes straight to the screen)
 * @returns {Uint8Array}
 */
export function loadPicture(machine, assets, name, { showPalette = false, into = null } = {}) {
  const picture = decodePicture(assets.read(name));
  for (let i = 0; i < PALETTE_BYTES; i++) {
    machine.palette[i] = picture.palette[i] >> 2;
  }
  if (showPalette) {
    setDac(machine, machine.palette);
  }
  const pixels = into ?? new Uint8Array(TEXTURE_BYTES);
  pixels.set(picture.pixels.subarray(0, pixels.length));
  return pixels;
}
