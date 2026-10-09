// Renders docs/poster.png: sixteen moments of the demo, straight out of the port, no browser.
// Usage: node tools/poster.mjs
import { fileURLToPath } from 'node:url'
import { createDemo } from '../src/demo.js'
import { renderFrame } from '../src/screen.js'
import { writeFramePng } from './png.mjs'
import { readDemoFiles } from './files.mjs'

const COLUMNS = 4
const CELL_WIDTH = 320
const CELL_HEIGHT = 200
// timer ticks (70 per second), in order
const MOMENTS = [
  700, 1000, 1500, 2100,
  2500, 2950, 3500, 4100,
  4650, 5200, 6000, 6500,
  6900, 7700, 9000, 10200,
]

const demo = createDemo(readDemoFiles())
const rows = Math.ceil(MOMENTS.length / COLUMNS)
const width = CELL_WIDTH * COLUMNS
const height = CELL_HEIGHT * rows
const rgba = new Uint8ClampedArray(width * height * 4)
MOMENTS.forEach((tick, cell) => {
  while (demo.tick < tick) {
    demo.step()
  }
  const frame = renderFrame(demo.machine)
  const x0 = (cell % COLUMNS) * CELL_WIDTH, y0 = Math.floor(cell / COLUMNS) * CELL_HEIGHT
  for (let y = 0; y < CELL_HEIGHT; y++) {
    rgba.set(frame.rgba.subarray(y * CELL_WIDTH * 4, (y + 1) * CELL_WIDTH * 4), ((y0 + y) * width + x0) * 4)
  }
})
writeFramePng(fileURLToPath(new URL('../docs/poster.png', import.meta.url)), { width, height, rgba })
