// The monitor: a 2D canvas the size of the visible frame. CSS scales it up with nearest-neighbour filtering.
import { renderFrame, VIEW_WIDTH, VIEW_HEIGHT } from './display.js';

export class Screen {
  constructor(canvas) {
    canvas.width = VIEW_WIDTH;
    canvas.height = VIEW_HEIGHT;
    this.context = canvas.getContext('2d');
    this.image = this.context.createImageData(VIEW_WIDTH, VIEW_HEIGHT);
    this.pixels = new Uint32Array(this.image.data.buffer);
  }

  /** Show what the machine's monitor shows: its chip RAM through its copper list and palette. */
  present(machine) {
    renderFrame(machine, this.pixels);
    this.context.putImageData(this.image, 0, 0);
  }
}
