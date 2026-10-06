// The monitor: a 2D canvas the size of the framebuffer. CSS scales it up with nearest-neighbour filtering.

const DAC_ENTRIES = 256;

export class Screen {
  constructor(canvas, width, height) {
    canvas.width = width;
    canvas.height = height;
    this.context = canvas.getContext('2d');
    this.image = this.context.createImageData(width, height);
    this.pixels = new Uint32Array(this.image.data.buffer);
    /** The DAC as 256 ready-to-store pixels. ImageData is RGBA bytes, so little-endian words are ABGR. */
    this.colours = new Uint32Array(DAC_ENTRIES);
  }

  /**
   * Show what the monitor shows: a buffer of palette indices through the 6-bit VGA DAC.
   * @param {Uint8Array} front palette indices, width * height
   * @param {Uint8Array} dac 256 RGB triplets, 0..63 each
   */
  present(front, dac) {
    const colours = this.colours;
    for (let i = 0; i < DAC_ENTRIES; i++) {
      const r = dac[i * 3] & 63;
      const g = dac[i * 3 + 1] & 63;
      const b = dac[i * 3 + 2] & 63;
      colours[i] = 0xff000000 | (((b << 2) | (b >> 4)) << 16) | (((g << 2) | (g >> 4)) << 8) | ((r << 2) | (r >> 4));
    }
    const pixels = this.pixels;
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = colours[front[i]];
    }
    this.context.putImageData(this.image, 0, 0);
  }
}
