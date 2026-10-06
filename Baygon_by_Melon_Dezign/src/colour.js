// The colour fade every part carries a copy of (loader $22d8, part 1 $d4140, ...).
// Colours are 12-bit $RGB words going in and 24 bits coming out, split the way AGA wants them:
// one word of high nibbles and one word of low nibbles.

function fadeChannel(from, to, level17) {
  const delta = (((to - from) * level17) & 0xffff) >> 8;
  return (from * 17 + delta) & 0xff;
}

/** Blend `from` towards `to`. Level 0 is `from`, level $100 is `to`. Returns { high, low } nibble words. */
export function fadeColour(from, to, level) {
  const level17 = level * 0x11;
  const r = fadeChannel((from >> 8) & 0xf, (to >> 8) & 0xf, level17);
  const g = fadeChannel((from >> 4) & 0xf, (to >> 4) & 0xf, level17);
  const b = fadeChannel(from & 0xf, to & 0xf, level17);
  return {
    high: ((r >> 4) << 8) | (g & 0xf0) | (b >> 4),
    low: ((r & 0xf) << 8) | ((g & 0xf) << 4) | (b & 0xf),
  };
}
