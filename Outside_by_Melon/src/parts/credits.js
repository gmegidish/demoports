// credits.C, part 2: tunnel, the spinning star, the OUTSIDE logo wiped in and out, and the
// names sliding up from the bottom.
import {
  lbmPalette, setPalette, palApproach, tunnelSetTexture, tunnelSelect, tunnelDraw, overlay, wipeCopy, wipeClear,
} from '../machine.js'
import { setObjectPos, drawStar } from '../engine3d.js'

const A_SPEED = 0x1f09c0 // 132 int32 spin speeds
const NAME_ROWS = 17600 // 320x55
const LOGO_ROWS = 0xaf00 // rows 0..139

export function createCredits(m, e, demo) {
  const px = (name) => m.lbm(name).pixels
  const tex = px('TEXTURE4.LBM'), outside = px('OUTSIDE.LBM'), wipe = px('WIPE1.LBM')
  const names = [px('ADEPT.LBM'), px('JOACHIM.LBM'), px('JASON.LBM')]
  const pal = new Uint8Array(768) // 0x1f7d84
  const target = new Uint8Array(384) // 0x1f7a84
  const faded = new Uint8Array(384) // 0x1f7784
  const logo = demo.logoBuffer // 0x1fd744, allocated by text.C
  // static, never reset: the part runs once
  let wipeOut = 0, rotZ = 0, spdIdx = 0, ang = 0, tunOff = 0, palCnt = 0
  let t = 0, bright = 0, wipeIn = 0, spdCnt = 0, namePhase = 0, nameIdx = 0, palStep = 0

  return {
    // 0x12b00
    start() {
      tunnelSetTexture(m, tex)
      lbmPalette(m, pal, 'TEXTURE4.LBM', 256)
      lbmPalette(m, pal, 'ADEPT.LBM', 16, 240)
      lbmPalette(m, pal, 'OUTSIDE.LBM', 80, 128)
      lbmPalette(m, target, 'PAL1.LBM', 128)
      tunnelSelect(m, 0)
      nameIdx = 0; namePhase = 10000; t = 0; spdCnt = 0; wipeIn = 0; bright = 64; palStep = 0
      logo.fill(0)
      setPalette(m, pal, 0, 256, 64)
    },
    // 0x12dd0
    tick() {
      rotZ += 2 * m.view.getInt32(A_SPEED + 4 * spdIdx, true)
      if (t < 64) {
        bright = Math.max(bright - 1, 0)
      }
      if (spdCnt > 5) {
        spdCnt = 0
        spdIdx++
        if (spdIdx > 131) {
          spdIdx = 0
        }
      }
      ang = Math.fround(ang + 0.05)
      t++; spdCnt++; tunOff += 0x101
      if (t > 400) {
        namePhase += 200
        if (namePhase >= 81000) {
          nameIdx = (nameIdx + 1) % 3
          namePhase = 10000
        }
        if (palCnt > 2) {
          palCnt = 0
          palStep++
        }
        palCnt++
      }
    },
    // 0x12be0
    render() {
      if (t < 96) {
        setPalette(m, pal, 0, 256, bright)
      }
      tunnelDraw(m)
      setObjectPos(e, 1024 + Math.trunc(Math.sin(ang) * 2048), 0, 2048 + Math.trunc(Math.cos(ang) * 4096))
      drawStar(m, e, 0, -255, rotZ)
      if (t > 400) {
        const s = m.sine[Math.trunc(namePhase / 16) & 0xfff]
        const y = Math.trunc((s * 40) / 65536) + 180
        overlay(m, names[nameIdx], NAME_ROWS, y * 320, 0xf0)
      }
      if (wipeIn < 256) {
        wipeCopy(wipe, logo, outside, wipeIn & 0xff)
      }
      if (t > 340) {
        wipeClear(wipe, logo, wipeOut & 0xff)
        wipeOut++
      }
      overlay(m, logo, LOGO_ROWS, 0, 0x80)
      if (t > 400) {
        palApproach(target, faded, pal, palStep, 128)
        setPalette(m, faded, 0, 128, 0)
      }
      wipeIn++
      m.tunnelOffset = tunOff
      if (t > 1470) {
        demo.switchTo('pigpan')
      }
    },
  }
}
