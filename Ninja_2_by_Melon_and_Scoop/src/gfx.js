// Drawing routines, ported from the assembly in original_src/NINJA.A.
// Colour 0 is transparent everywhere. Reads past a buffer end yield 0, writes past the screen are dropped;
// the original did neither check.
import { XSIZE, YSIZE } from './machine.js';

/** Unknown in the original: BitmapZoom seeds its row accumulator with a pointer instead of 0 (see BitmapZoom). */
const ZOOM_ROW_SEED = 0;

/** Opaque copy of 320x256 from a 320-wide layer, starting at row ypos. Colour 0 is copied too. */
export function CopyLayerVert(m, layer, ypos, base = 0) {
  const start = base + Math.trunc(ypos) * XSIZE;
  m.screen.set(layer.subarray(start, start + XSIZE * YSIZE));
}

/** Opaque copy of 320x256 from an xsize-wide layer, starting at byte xpos. */
export function CopyLayerHor(m, layer, xpos, xsize) {
  for (let y = 0; y < YSIZE; y++) {
    const start = xpos + y * xsize;
    m.screen.set(layer.subarray(start, start + XSIZE), y * XSIZE);
  }
}

/** Draw 320x256 from a 320-wide layer, starting at row ypos. `base` is a byte offset added to the layer pointer. */
export function DrawLayerVert(m, layer, ypos, base = 0) {
  const screen = m.screen;
  let s = base + Math.trunc(ypos) * XSIZE;
  for (let d = 0; d < XSIZE * YSIZE; d++, s++) {
    const colour = layer[s];
    if (colour) {
      screen[d] = colour;
    }
  }
}

/** Draw 320x256 from an xsize-wide layer, starting at byte xpos, onto screen row ypos. */
export function DrawLayerHor(m, layer, xpos, xsize, ypos) {
  const screen = m.screen;
  let s = xpos;
  let d = ypos * XSIZE;
  for (let y = 0; y < YSIZE && d < screen.length; y++) {
    for (let x = 0; x < XSIZE; x++, s++, d++) {
      const colour = layer[s];
      if (colour) {
        screen[d] = colour;
      }
    }
    s += xsize - XSIZE;
  }
}

/** Like DrawLayerHor, but adds (colour + 16) to what is already on screen. */
export function DrawFog(m, layer, xpos, xsize, ypos) {
  const screen = m.screen;
  let s = xpos;
  let d = ypos * XSIZE;
  for (let y = 0; y < YSIZE && d < screen.length; y++) {
    for (let x = 0; x < XSIZE; x++, s++, d++) {
      const colour = layer[s];
      if (colour) {
        screen[d] += colour + 16;
      }
    }
    s += xsize - XSIZE;
  }
}

/** Sprite_Draw for the only case the demo uses: a 320x256 sprite, no flips, clipped to the screen. */
export function Sprite_Draw(m, vsprite, xpos, ypos) {
  const screen = m.screen;
  if (xpos >= XSIZE || ypos >= YSIZE || xpos + XSIZE < 0 || ypos + YSIZE < 0) {
    return;
  }
  const firstX = Math.max(0, -xpos);
  const lastX = Math.min(XSIZE, XSIZE - xpos);
  const firstY = Math.max(0, -ypos);
  const lastY = Math.min(YSIZE, YSIZE - ypos);
  for (let y = firstY; y < lastY; y++) {
    let s = y * XSIZE + firstX;
    let d = (y + ypos) * XSIZE + xpos + firstX;
    for (let x = firstX; x < lastX; x++, s++, d++) {
      const colour = vsprite[s];
      if (colour) {
        screen[d] = colour;
      }
    }
  }
}

/**
 * BitmapZoom: scale a 320x256 bitmap to nScaleX x nScaleY and draw the part that fits the screen.
 * 16.16 fixed point, integer division, as in the assembly.
 *
 * The assembly initialises the row accumulator with `mov z_y[esp],eax` while eax still holds the
 * Zoom_t pointer, so every row is offset by (address >> 16). That address is not recoverable from
 * the source. ZOOM_ROW_SEED is the knob if a capture of the original shows the logo sitting higher.
 */
export function BitmapZoom(m, bitmap, zoom) {
  const screen = m.screen;
  const { nXpos, nYpos, nScaleX, nScaleY, nSXpos, nSYpos } = zoom;
  const yAdd = nScaleY === 0 ? YSIZE << 16 : Math.trunc((YSIZE << 16) / nScaleY);
  const xAdd = nScaleX === 0 ? XSIZE << 16 : Math.trunc((XSIZE << 16) / nScaleX);
  const columns = Math.min(nScaleX, XSIZE);
  let rows = Math.min(nScaleY, YSIZE);
  let rowAccumulator = ZOOM_ROW_SEED;
  let d = XSIZE * nSYpos + nSXpos;
  for (; rows > 0; rows--) {
    const row = ((nYpos * yAdd + rowAccumulator) | 0) >> 16;
    const s = row * XSIZE;
    let x = (nXpos * xAdd) | 0;
    for (let i = 0; i < columns; i++, d++) {
      const colour = bitmap[s + (x >> 16)];
      x = (x + xAdd) | 0;
      if (colour) {
        screen[d] = colour;
      }
    }
    d += XSIZE - columns;
    rowAccumulator = (rowAccumulator + yAdd) | 0;
  }
}

/** MotionBlurr: average the screen with a previous frame. Works on palette indices, 8-bit wrap included. */
export function MotionBlurr(m, layer) {
  const screen = m.screen;
  for (let i = 0; i < XSIZE * YSIZE; i++) {
    screen[i] = ((layer[i] + screen[i]) & 0xff) >> 1;
  }
}
