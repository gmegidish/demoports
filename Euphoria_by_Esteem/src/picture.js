// 0e30:0223 loadPCX(dest, N): a resource picture into a page (or, 640 wide, into VESA memory from row
// `dest`), and its palette through setColor (8-bit >> 2). Notes: L5_units.md "0e30".
import { decodePcx } from './pcx.js';

/** `resourceNumber` is the code's 1-based number (item N-1 of the resource file). */
export function loadPicture(m, dest, resourceNumber) {
  const picture = decodePcx(m.resources[resourceNumber - 1]);
  if (picture.width > 320) {
    let offset = Math.imul(m.width, dest);
    for (let y = 0; y < picture.height; y++) {
      m.vram.set(picture.pixels.subarray(y * picture.width, (y + 1) * picture.width), offset);
      offset += m.width;
    }
  } else {
    m.setActivePage(dest);
    for (let y = 0; y < picture.height; y++) {
      m.active.set(picture.pixels.subarray(y * picture.width, (y + 1) * picture.width), y * m.width);
    }
  }
  for (let i = 0; i < 256; i++) {
    m.setColor(i, picture.palette[i * 3] >> 2, picture.palette[i * 3 + 1] >> 2, picture.palette[i * 3 + 2] >> 2);
  }
}
