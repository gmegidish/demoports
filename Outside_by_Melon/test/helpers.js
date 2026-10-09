// Shared by the tests: the original files, the demo, and frames of the recording.
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { createDemo } from '../src/demo.js'
import { renderFrame } from '../src/screen.js'
import { readDemoFiles } from '../tools/files.mjs'

export const originalFiles = readDemoFiles()

export function newDemo() {
  return createDemo(originalFiles)
}

export function runToTick(demo, tick) {
  while (demo.tick < tick) {
    demo.step()
  }
}

// what the screen shows, as RGB bytes
export function screenRgb(machine) {
  const { rgba, width, height } = renderFrame(machine)
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = rgba[i * 4]
    rgb[i * 3 + 1] = rgba[i * 4 + 1]
    rgb[i * 3 + 2] = rgba[i * 4 + 2]
  }
  return rgb
}

// frame n of the DOSBox recording (one frame per timer tick)
export function recordedFrame(n) {
  return new Uint8Array(gunzipSync(readFileSync(new URL(`./fixtures/recording-${n}.rgb.gz`, import.meta.url))))
}

export function countDifferentPixels(a, b) {
  let count = 0
  for (let i = 0; i < a.length; i += 3) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
      count++
    }
  }
  return count
}
