// roomc.C, part 1: the pig sitting in a turning textured room, colours wobbling toward PAL2.
import { lbmPalette, setPalette, palApproach, overlay } from '../machine.js'
import { setObjectPos } from '../engine3d.js'
import { drawMesh } from '../mesh.js'

const ROT_X = 0
const ROT_Y = 230

export function createRoom(m, e, demo) {
  const tex = m.lbm('ROOM.LBM').pixels
  const sitting = m.lbm('SITTING.LBM').pixels
  const roomPal = new Uint8Array(768) // 0x1f712c
  const pal2 = new Uint8Array(768) // 0x1f6e2c
  const tmpPal = new Uint8Array(480) // 0x1f6b2c
  let fade = 0, T = 0, t = 0, rotZ = 0

  return {
    // 0x12310
    start() {
      lbmPalette(m, roomPal, 'ROOM.LBM', 256)
      lbmPalette(m, roomPal, 'SITTING.LBM', 32, 224)
      lbmPalette(m, pal2, 'PAL2.LBM', 256)
      fade = 64; T = 0
      setPalette(m, roomPal, 0, 256, 64)
      t = 0
    },
    // 0x12470
    tick() {
      if (T < 64) {
        fade = Math.max(fade - 1, 0)
      }
      t = Math.fround(t + 0.025)
      T++
      rotZ += 2
    },
    // 0x12390
    render() {
      const v = Math.max(Math.trunc(Math.sin(t) * 8), 0)
      if (T < 96) {
        setPalette(m, roomPal.subarray(160 * 3), 160, 96, fade)
      }
      palApproach(pal2, tmpPal, roomPal, v, 160)
      setPalette(m, tmpPal, 0, 160, fade)
      if (T > 780) {
        demo.switchTo('text', 1)
      }
      setObjectPos(e, 0, 0, 0)
      drawMesh(m, e, tex, ROT_X, ROT_Y, rotZ)
      overlay(m, sitting, 64000, 0, 0xe0)
    },
  }
}
