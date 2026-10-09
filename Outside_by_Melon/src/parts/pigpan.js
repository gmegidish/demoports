// pigpan.C, part 5: two additive rotozoom layers of a texture under the pig panorama.
import { lbmPalette, setPalette, overlay } from '../machine.js'

export function createPigpan(m, demo) {
  const panorama = m.lbm('PANORAMA.LBM').pixels
  const tex = m.lbm('TEXTURE3.LBM').pixels
  const pal = new Uint8Array(768) // 0x1f8108; 128..191 stay 0
  let bright = 0, t = 0, L1 = 0, L2 = 0, angle1 = 0, angle2 = 0

  // 0x4bb3f: the texture square (0,0)-(L,0)-(0,L) turned by angle, drawn as 160x100 2x2 blocks, texel / 2 added
  function rotoLayer(L, angle) {
    const { S, C, fb } = m
    const i = angle & 1023
    // 0x4230d with only the first rotation: u = -t2, v = -t1 of each point; P0 = (0, 0) maps to (0, 0)
    const pu = (x, y) => -((Math.imul(x, C[i]) - Math.imul(y, S[i])) >> 7)
    const pv = (x, y) => -((Math.imul(x, S[i]) + Math.imul(y, C[i])) >> 7)
    const duCol = Math.trunc((pu(L, 0) << 16) / 1024), dvCol = Math.trunc((pv(L, 0) << 16) / 1024)
    const duRow = Math.trunc((pu(0, L) << 16) / 1024), dvRow = Math.trunc((pv(0, L) << 16) / 1024)
    const se = duCol >> 8, sb = dvCol >> 8
    let U = 0, V = 0
    for (let row = 0; row < 100; row++) {
      let ec = U >> 8, bc = V >> 8, p = row * 640
      for (let col = 0; col < 160; col++) {
        const c = tex[((bc >> 8) & 255) * 256 + ((ec >> 8) & 255)] >> 1
        ec += se; bc += sb
        fb[p] += c; fb[p + 1] += c; fb[p + 320] += c; fb[p + 321] += c
        p += 2
      }
      U = (U + duRow) | 0; V = (V + dvRow) | 0
    }
  }

  return {
    // 0x13030
    start() {
      lbmPalette(m, pal, 'TEXTURE3.LBM', 128)
      lbmPalette(m, pal, 'PANORAMA.LBM', 64, 192)
      bright = 64; t = 0
      setPalette(m, pal, 0, 256, 64)
      L1 = 0x200; angle1 = 0; L2 = 0x400; angle2 = 0
    },
    // 0x13100
    tick() {
      if (t < 64) {
        bright = Math.max(bright - 1, 0)
      }
      t++
      L1 += 3; L2 += 2; angle1 += 1; angle2 -= 2
    },
    // 0x13090
    render() {
      if (t < 96) {
        setPalette(m, pal, 0, 256, bright)
      }
      m.fb.fill(0)
      rotoLayer(L1, angle1)
      rotoLayer(L2, angle2)
      overlay(m, panorama, 64000, 0, 0xc0)
      if (t > 500) {
        demo.switchTo('text', 0)
      }
    },
  }
}
