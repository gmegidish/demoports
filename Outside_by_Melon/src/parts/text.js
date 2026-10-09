// text.C, parts 3 and 4: a tunnel, the two turning "melon" signs, and a text wiped in (and, in part 4, out).
import { lbmPalette, setPalette, tunnelSetTexture, tunnelSelect, tunnelDraw, overlay, wipeCopy, wipeClear } from '../machine.js'
import { setObjectPos, addObject, drawBatch, setLight } from '../engine3d.js'

const SIGN_A = { vertices: 0x5742d, faces: 0x5a631, base: 0xad, offset: [0x8c, 0, 0], max: 0x1e, min: 5, depthCue: false }
const SIGN_B = { vertices: 0x530d7, faces: 0x5631b, base: 0x94, offset: [0, 0, 0], max: 0x1e, min: 5, depthCue: false }

export function createText(m, e, demo) {
  const px = (name) => m.lbm(name).pixels
  const wipe = px('WIPE1.LBM')
  const variants = [
    { tunnel: 1, tex: px('TEXTURE5.LBM'), palette: 'TEXTURE5.LBM', text: px('TEXT1.LBM') },
    { tunnel: 2, tex: px('TEXTURE6.LBM'), palette: 'TEXT2.LBM', text: px('TEXT2.LBM') },
  ]
  const logo = demo.logoBuffer // 0x1fd744
  const pal = new Uint8Array(768) // 0x1fd424
  const batch = { B: 0 }
  let v = 0, bias = 0, counter = 0, wipeIn = 0, wipeOut = 0, angA = 0, angB = 0
  // not reset at start: part 4 carries on from part 3
  let a = 0, tunOff = 0

  function drawSigns() {
    // 0x52dbd: the light angles are never written
    setLight(m, e, 0, -30000, 0, 0, 0, 0)
    const angles = [angA, angB, 0]
    addObject(m, e, SIGN_A, angles, batch)
    addObject(m, e, SIGN_B, angles, batch)
    drawBatch(m, e, batch)
  }

  return {
    // 0x134c0
    start(variant) {
      v = variant
      const cur = variants[v]
      tunnelSelect(m, cur.tunnel)
      tunnelSetTexture(m, cur.tex)
      lbmPalette(m, pal, cur.palette, 256)
      bias = 64
      counter = 0; wipeIn = 0; wipeOut = 0; angA = 0; angB = 0
      logo.fill(0)
      setPalette(m, pal, 0, 256, 64)
    },
    get isWipingOut() {
      return v === 1 && wipeIn >= 256
    },
    // 0x13720
    tick() {
      if (counter < 0x40) {
        bias = Math.max(bias - 1, 0)
      }
      a = Math.fround(a + 0.05)
      counter++
      angB += 3; angA += 7; tunOff += 0x101
    },
    // 0x135b0
    render() {
      if (counter < 0x60) {
        setPalette(m, pal, 0, 256, bias)
      }
      tunnelDraw(m)
      setObjectPos(e, Math.trunc(Math.sin(a) * 2048) + 0x400, 0, Math.trunc(Math.cos(a) * 4096) + 0x800)
      drawSigns()
      const text = variants[v].text
      if (v === 0) {
        if (counter > 720) {
          demo.switchTo('room')
        }
        if (wipeIn < 256) {
          wipeCopy(wipe, logo, text, wipeIn & 0xff)
        }
      } else {
        if (wipeIn < 256) {
          wipeCopy(wipe, logo, text, wipeIn & 0xff)
        } else {
          wipeClear(wipe, logo, wipeOut & 0xff)
          wipeOut++
        }
        if (counter > 1200) {
          demo.switchTo('logo', 0)
        }
      }
      overlay(m, logo, 64000, 0, 0)
      wipeIn++
      m.tunnelOffset = tunOff
    },
  }
}
