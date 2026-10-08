// What the monitor shows: mode 13h (320x200 from A000) or the unchained 320x400 mode (four planes from the
// CRTC start address), through the 6-bit DAC and its pixel mask.
import { SCREEN_WIDTH, SCREEN_HEIGHT, MODE_X_HEIGHT, dacTo8 } from './machine.js';
import { renderTextScreen } from './textscreen.js';

const BYTES_PER_ROW = 80;

function paletteColours(m) {
  const colours = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const index = i & m.dacMask;
    colours[i] = 0xff000000 | (dacTo8(m.dac[index * 3 + 2]) << 16) | (dacTo8(m.dac[index * 3 + 1]) << 8) | dacTo8(m.dac[index * 3]);
  }
  return colours;
}

/** { width, height, rgba }. */
export function renderFrame(m) {
  if (m.isTextMode) {
    return renderTextScreen(m, m.romFont);
  }
  const colours = paletteColours(m);
  const width = SCREEN_WIDTH;
  const height = m.isModeX ? MODE_X_HEIGHT : SCREEN_HEIGHT;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const pixels = new Uint32Array(rgba.buffer);
  if (m.isModeX) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (m.crtcStart + y * BYTES_PER_ROW + (x >> 2)) & 0xffff;
        pixels[y * width + x] = colours[m.planes[x & 3][offset]];
      }
    }
  } else {
    for (let i = 0; i < width * height; i++) {
      pixels[i] = colours[m.screen[i]];
    }
  }
  return { width, height, rgba };
}

export class Screen {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
  }

  present(frame) {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.canvas.width = frame.width;
      this.canvas.height = frame.height;
      // The 400-line mode puts red, green and blue on alternate scanlines for a CRT to blend: scale it smoothly.
      this.canvas.style.imageRendering = frame.height === MODE_X_HEIGHT ? 'auto' : 'pixelated';
    }
    this.context.putImageData(new ImageData(frame.rgba, frame.width, frame.height), 0, 0);
  }
}
