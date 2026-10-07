// The monitor: a 2D canvas the size of the framebuffer. CSS scales it up with nearest-neighbour filtering.

export class Screen {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.image = null;
    this.pixels = null;
    /** The DAC as 256 ready-to-store pixels. ImageData is RGBA bytes, so little-endian words are ABGR. */
    this.colours = new Uint32Array(256);
  }

  /** The demo changes resolution once (credits), which swaps the machine's front buffer. */
  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.image = this.context.createImageData(width, height);
    this.pixels = new Uint32Array(this.image.data.buffer);
  }

  /** Show what the machine's monitor shows: its front buffer through its 6-bit DAC. */
  present(machine) {
    if (!this.image || this.image.width !== machine.width || this.image.height !== machine.height) {
      this.resize(machine.width, machine.height);
    }
    const dac = machine.palette;
    const colours = this.colours;
    for (let i = 0; i < 256; i++) {
      const r = dac[i * 3];
      const g = dac[i * 3 + 1];
      const b = dac[i * 3 + 2];
      colours[i] = 0xff000000 | (((b << 2) | (b >> 4)) << 16) | (((g << 2) | (g >> 4)) << 8) | ((r << 2) | (r >> 4));
    }
    const front = machine.front;
    const pixels = this.pixels;
    for (let i = 0; i < front.length; i++) {
      pixels[i] = colours[front[i]];
    }
    this.context.putImageData(this.image, 0, 0);
  }
}
