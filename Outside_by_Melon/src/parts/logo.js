// logo.C, part 6: the pigs in the oval (variant 0), then the melon backdrop with the closing texts
// wiped in and out, ending on "THE END" (variant 1, runs until ESC).
import { lbmPalette, setPalette, overlay, wipeCopy, wipeClear, PIXELS } from '../machine.js'

const HOLD_TICKS = 300

export function createLogo(m, demo) {
  const px = (name) => m.lbm(name).pixels
  const endpigs = px('ENDPIGS.LBM'), melon = px('MELON.LBM')
  const texts = [px('TEXT3.LBM'), px('TEXT4.LBM'), px('TEXT5.LBM')]
  const wipeIn = px('WIPE4.LBM'), wipeOut = px('WIPE2.LBM')
  const logo = demo.logoBuffer // 0x1fd744
  const pal = new Uint8Array(768) // 0x1fd79c
  let v = 0, bias = 0, counter = 0, k = 0, inThreshold = 0, outThreshold = 0
  // not reset by start
  let state = 0, hold = 0

  return {
    // 0x13ad0
    start(variant) {
      lbmPalette(m, pal, variant === 0 ? 'ENDPIGS.LBM' : 'MELON.LBM', 256)
      bias = 64; counter = 0
      setPalette(m, pal, 0, 256, 64)
      v = variant; k = 0; outThreshold = 0; inThreshold = 0
      logo.fill(0)
    },
    // 0x13d00
    tick() {
      if (state === 1) {
        hold++
      }
      if (counter < 0x40) {
        bias = Math.max(bias - 1, 0)
      }
      counter++
    },
    // 0x13b70 (it starts by waiting for the retrace)
    render() {
      if (counter < 0x60) {
        setPalette(m, pal, 0, 256, bias)
      }
      if (v === 0) {
        m.fb.set(endpigs.subarray(0, PIXELS))
        if (counter > 500) {
          demo.switchTo('landscape')
        }
        return
      }
      m.fb.set(melon.subarray(0, PIXELS))
      if (state === 0) {
        wipeCopy(wipeIn, logo, texts[k], inThreshold & 0xff)
        outThreshold = 0
        inThreshold++
        if (inThreshold >= 256) {
          state = 1
        }
      } else if (hold > HOLD_TICKS && k < 2) {
        wipeClear(wipeOut, logo, outThreshold & 0xff)
        outThreshold++
        if (outThreshold >= 256) {
          inThreshold = 0; outThreshold = 0; hold = 0; k++; state = 0
        }
      }
      overlay(m, logo, 64000, 0, 0)
    },
  }
}
