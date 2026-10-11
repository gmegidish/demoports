// The parts of main (0x100891..0x100980), in order, with the song position each one runs up to: a part returns
// once MIDASgetPlayStatus' position reaches it (or the player presses a key, which the port never does).
// [name, part generator, last position]. A part generator returns true when it ends the demo (Esc).
import { POSITION, waitRetrace } from '../machine.js';
import { kaleidoskop } from './kaleidoscope.js';
import { credits, kolorLogo, spiralIntro, toonTown } from './intro.js';
import { spiralEnd, spiralReturn } from './outro.js';
import { fakeMode } from './fakemode.js';
import { plasma } from './plasma.js';
import { starTunnel } from './star.js';
import { rings } from './rings.js';
import { mickeyFilm } from './film.js';
import { mickeySilhouette } from './silhouette.js';
import { toonSway } from './ripple.js';

/**
 * Placeholder for a part not ported yet, and what development runs put in place of the parts before `firstPart`:
 * the screen stays as it is until the music reaches `lastPosition`.
 */
export function skipPart(m, lastPosition) {
  return (function* () {
    for (;;) {
      m.readPlayStatus();
      if (lastPosition <= m.u32(POSITION)) {
        return false;
      }
      yield* waitRetrace(m);
    }
  })();
}

export const PARTS = [
  ['p01_10ed9f', spiralIntro, 2],
  ['p02_10ecc1', kolorLogo, 4],
  ['p03_10e813', credits, 8],
  ['p04_10eaa0', toonTown, 0xb],
  ['p05_103808', mickeyFilm, 0x10],
  ['p06_100cd5', plasma, 0x14],
  ['p07_108c6a', rings, 0x18],
  // main 0x100918: eax = 0x1c (the kaleidoscope's end), edx = 0x20 (the part's)
  ['p08_1019b1', (m, lastPosition) => kaleidoskop(m, 0x1c, lastPosition), 0x20], // main: eax=0x1c, edx=0x20
  ['p09_1087bc', starTunnel, 0x24],
  ['p10_1049fe', mickeySilhouette, 0x28],
  ['p11_10629f', fakeMode, 0x2c],
  ['p12_10eeea', spiralReturn, 0x2d],
  ['p13_103409', toonSway, 0x30],
  ['p14_10efc2', spiralEnd, 0x33],
];


