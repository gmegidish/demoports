// The monitor: what the VGA/VESA card shows from video memory through the 6-bit DAC. The canvas takes
// the size of the current mode; CSS stretches it to 4:3, as a CRT does with 320x200.

import { renderTextScreen } from './textscreen.js';

const DAC_ENTRIES = 256;

/** 6-bit DAC value to 8 bits, rounded, as the reference capture (DOSBox) does it. */
export function dacTo8(v) {
  return Math.round(((v & 63) * 255) / 63);
}

/** The visible picture: { width, height, rgba: Uint8ClampedArray }. */
export function renderFrame(m) {
  if (m.isTextMode) {
    return renderTextScreen(m, m.romFont);
  }
  const width = m.width;
  const height = m.height;
  const colours = new Uint32Array(DAC_ENTRIES);
  for (let i = 0; i < DAC_ENTRIES; i++) {
    colours[i] = 0xff000000 | (dacTo8(m.dac[i * 3 + 2]) << 16) | (dacTo8(m.dac[i * 3 + 1]) << 8) | dacTo8(m.dac[i * 3]);
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  const pixels = new Uint32Array(rgba.buffer);
  const start = m.displayStart;
  for (let i = 0; i < width * height; i++) {
    pixels[i] = colours[m.vram[start + i]];
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
    }
    this.context.putImageData(new ImageData(frame.rgba, frame.width, frame.height), 0, 0);
  }
}
