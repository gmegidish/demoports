// What the monitor shows: the 320x200 frame buffer through the 6-bit DAC.
import { WIDTH, HEIGHT, PIXELS } from './machine.js'

// 6-bit DAC value to 8 bits, rounded, as DOSBox shows it
const dacTo8 = (v) => Math.trunc((v * 255 + 31) / 63)

// { width, height, rgba }
export function renderFrame(m) {
  const colours = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    colours[i] = 0xff000000 | dacTo8(m.dac[i * 3 + 2]) << 16 | dacTo8(m.dac[i * 3 + 1]) << 8 | dacTo8(m.dac[i * 3])
  }
  const rgba = new Uint8ClampedArray(PIXELS * 4)
  const pixels = new Uint32Array(rgba.buffer)
  for (let i = 0; i < PIXELS; i++) {
    pixels[i] = colours[m.fb[i]]
  }
  return { width: WIDTH, height: HEIGHT, rgba }
}

export class Screen {
  constructor(canvas) {
    this.context = canvas.getContext('2d')
  }

  present(frame) {
    this.context.putImageData(new ImageData(frame.rgba, frame.width, frame.height), 0, 0)
  }
}
