// landscape.C, part 7: scrolling clouds over the ground, the 3D terrain and the flying pig.
import { lbmPalette, setPalette, palApproach } from '../machine.js'
import { setObjectPos, addObject, drawBatch, setLight } from '../engine3d.js'

const TERRAIN = { vertices: 0x5b6c3, faces: 0x617a7, base: 0xa0, offset: [0, 0, -800], max: 0x5f, min: 5, depthCue: true }
const PIG = { vertices: 0x644a9, faces: 0x6514d, base: 0x40, offset: [0, 0, 0x320], max: 0x5a, min: 5, depthCue: false }
const CLOUDS_WIDTH = 576
const SKY_ROWS = 96
const GROUND_COLOUR = 0x32
const ANGLE_Y = -290

// C division by a power of two, truncating toward zero
const tdiv = (x, n) => Math.trunc(x / n)

export function createLandscape(m, e, demo) {
  const clouds = m.lbm('CLOUDS.LBM').pixels
  const cloudsPal = new Uint8Array(768) // 0x1fe0f0
  const pal3 = new Uint8Array(768) // 0x1fddf0
  const blended = new Uint8Array(768) // 0x1fdaf0
  const batch = { B: 0 }
  let counter = 0, scroll = 0, a = 0, b = 0, angZ = 0
  // not reset: the part runs once
  let t = 0, lightAngle = 0

  return {
    // 0x13de0
    start() {
      setObjectPos(e, 0, 0, 0)
      angZ = 0
      lbmPalette(m, cloudsPal, 'CLOUDS.LBM', 256)
      lbmPalette(m, pal3, 'PAL3.BBM', 256)
      setPalette(m, cloudsPal, 0, 256, 0)
      counter = 0; scroll = 0; a = 0; b = 0
    },
    // 0x140b0
    tick() {
      t = Math.fround(t + 0.025)
      b += 0x5a; scroll++; angZ += 5; lightAngle += 5; a += 0x50; counter++
    },
    // 0x13e90
    render() {
      const step = Math.max(Math.trunc(Math.sin(t) * 16), 0)
      palApproach(pal3, blended, cloudsPal, step, 256)
      setPalette(m, blended, 0, 256, 0)
      if (counter > 800) {
        demo.switchTo('logo', 1)
      }
      const { fb, sine: T } = m
      for (let row = 0; row < SKY_ROWS; row++) {
        const src = scroll + row * CLOUDS_WIDTH
        fb.set(clouds.subarray(src, src + 320), row * 320)
      }
      fb.fill(GROUND_COLOUR, SKY_ROWS * 320)
      const i = tdiv(a, 16) & 0xfff
      const pigX = tdiv(T[i] * 150, 4096)
      const pigZ = tdiv(T[i + 1024] * 150, 4096)
      const j = tdiv(tdiv(a, 2), 16) & 0xfff
      const pigY = tdiv(T[j] * 50, 4096)
      const pigAngZ = tdiv(-(T[i] * 40), 4096)
      const k = tdiv(b, 16) & 0xfff
      const angX = tdiv(T[k] * 60, 65536)
      // 0x52f12: the terrain; its light is reused by the pig
      setLight(m, e, 0, -10000, 0, 0, 0, lightAngle)
      setObjectPos(e, 0, 0, 0)
      addObject(m, e, TERRAIN, [angX, ANGLE_Y, angZ], batch)
      drawBatch(m, e, batch)
      // 0x53024: the pig
      setObjectPos(e, pigX, pigY, pigZ)
      addObject(m, e, PIG, [angX, ANGLE_Y, angZ + pigAngZ], batch)
      drawBatch(m, e, batch)
    },
  }
}
