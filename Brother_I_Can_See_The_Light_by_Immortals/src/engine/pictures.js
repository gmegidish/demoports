// The picture loader, 0x1936c: decode a GIF into a 64 KB block, hand back a 6-bit copy of its palette.
// It never touches the DAC. The last palette also stays in the loader's own buffer ([0x5dbf0]),
// which the additive-table builder reads.

import { decodePicture } from '../picture.js';
import { PALETTE_BYTES } from '../machine.js';

/** Pictures and tables live in 64 KB blocks (0x10794); a texel address is (v << 8) | u. */
export const TEXTURE_BYTES = 0x10000;

/**
 * @param {{read: (name: string) => Uint8Array}} assets
 * @param {{lastPalette?: Uint8Array}} loader where [0x5dbf0] lives (the machine)
 * @returns {{pixels: Uint8Array, palette: Uint8Array}} pixels copied verbatim, w*h bytes, into a 64 KB block
 */
export function loadPicture(loader, assets, name) {
  const picture = decodePicture(assets.read(name));
  const palette = new Uint8Array(PALETTE_BYTES);
  for (let i = 0; i < PALETTE_BYTES; i++) {
    palette[i] = picture.palette[i] >> 2;
  }
  loader.lastPalette = palette;
  const pixels = new Uint8Array(TEXTURE_BYTES);
  pixels.set(picture.pixels.subarray(0, TEXTURE_BYTES));
  return { pixels, palette };
}
