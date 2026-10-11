// The demo's random bits: a 32-bit shift register at 0x11c64 (taps 10 and 15), read by 0x11c2b and
// seeded from the timer accumulator by 0x11c68 (parts 8 and 13). The seed in the original depends on
// how many timer ticks have passed, so the port's parts pick a fixed one.

/** Initial value of the register at 0x11c64. */
export const DEFAULT_SEED = 0x12345678;

export function createRandomBits(seed = DEFAULT_SEED) {
  let state = seed >>> 0;
  /** 0x11c2b randomBits(n): n bits out of the low end, first bit out = most significant. */
  return (n) => {
    let r = 0;
    for (let k = 0; k < n; k++) {
      r = (r << 1) | (state & 1);
      const feedback = ((state >>> 10) ^ (state >>> 15)) & 1;
      state = ((state >>> 1) | (feedback << 31)) >>> 0;
    }
    return r;
  };
}
