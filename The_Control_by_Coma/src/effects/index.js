// The per-frame effects, keyed by their original address (what the scene functions put in [0x52185]).
// Each is one pass of the main loop: draw one frame. FRAMES are the passes per second measured in the
// reference recording for that effect (the main loop never waits for the retrace).
import { MODEX_EFFECTS } from './modex.js';
import { PART1_EFFECTS } from './part1.js';
import { OBJECT_EFFECTS } from './objects.js';
import { PART2_EFFECTS } from './part2.js';

/** effect address -> { draw(m), passesPerSecond } */
export const EFFECTS = {
  /** 0x55ef1: a bare `ret`. */
  0x55ef1: { draw() {}, passesPerSecond: 70 },
  ...MODEX_EFFECTS,
  ...PART1_EFFECTS,
  ...OBJECT_EFFECTS,
  ...PART2_EFFECTS,
};
