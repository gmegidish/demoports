// title.C, part 0: the tunnel fades in, then the title picture flashes in on white.
import { lbmPalette, setPalette, tunnelSetTexture, tunnelSelect, tunnelDraw, overlay } from '../machine.js'

export function createTitle(m, demo) {
  const pig = m.lbm('TITLEPIG.LBM').pixels
  const tex = m.lbm('TEXTURE2.LBM').pixels
  const titlePal = new Uint8Array(384) // 0x1f75dc
  const texPal = new Uint8Array(384) // 0x1f745c
  lbmPalette(m, titlePal, 'TITLEPIG.LBM', 128)
  lbmPalette(m, texPal, 'TEXTURE2.LBM', 128)
  // BSS, and not reset by start: the timer runs this part's tick during loading
  let T = 0, fadeIn = 0, flash = 0, pos = 0, sub = 0

  return {
    // 0x12620
    start() {
      setPalette(m, texPal, 0, 128, -64)
      setPalette(m, titlePal, 128, 128, 0)
      tunnelSetTexture(m, tex)
      fadeIn = -64; T = 0; flash = 64
    },
    // 0x12760
    tick() {
      const old = T
      if (old > 760) {
        if (sub >= 3) {
          flash = Math.max(flash - 1, 0)
        }
      } else if (sub >= 7) {
        fadeIn++
        sub = 0
      }
      pos += old >= 760 ? 0x202 : 0x101
      sub++
      T++
    },
    // 0x12690
    render() {
      if (fadeIn < 0) {
        setPalette(m, texPal, 0, 128, fadeIn)
      }
      tunnelSelect(m, 3)
      m.tunnelOffset = pos
      tunnelDraw(m)
      if (T > 760) {
        overlay(m, pig, 64000, 0, 0x80)
        if (T < 960) {
          setPalette(m, texPal, 0, 128, flash)
          setPalette(m, titlePal, 128, 128, flash)
        }
      }
      if (T > 1200) {
        demo.switchTo('credits')
      }
    },
  }
}
