// The monitor: a 2D canvas the size of the current mode (320x200 graphics, 720x400 text). CSS
// stretches it to 4:3 with nearest-neighbour filtering, as a CRT shows either mode.

import { renderTextScreen } from './textscreen.js';

const DAC_ENTRIES = 256;

/** 6-bit DAC value to 8 bits, rounded, as the reference capture (DOSBox) does it. */
export function dacTo8(value) {
  return Math.round(((value & 63) * 255) / 63);
}

/**
 * What the monitor shows.
 * @param {object} machine
 * @param {Uint8Array} font the VGA ROM font, for text mode
 * @returns {{width: number, height: number, pixels: Uint32Array}} RGBA as little-endian words
 */
export function renderFrame(machine, font) {
  if (machine.isTextMode) {
    return renderTextScreen(machine.textScreen, font);
  }
  const colours = new Uint32Array(DAC_ENTRIES);
  for (let i = 0; i < DAC_ENTRIES; i++) {
    const r = dacTo8(machine.dac[i * 3]);
    const g = dacTo8(machine.dac[i * 3 + 1]);
    const b = dacTo8(machine.dac[i * 3 + 2]);
    colours[i] = 0xff000000 | (b << 16) | (g << 8) | r;
  }
  const pixels = new Uint32Array(machine.width * machine.height);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = colours[machine.front[i]];
  }
  return { width: machine.width, height: machine.height, pixels };
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
    const rgba = new Uint8ClampedArray(frame.pixels.buffer);
    this.context.putImageData(new ImageData(rgba, frame.width, frame.height), 0, 0);
  }
}
