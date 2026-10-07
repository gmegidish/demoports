// 0d6d:0393(5, 0xff): the BWSB player's VU level of music channel 5, read by part 4ebc to make the gems
// bounce (pulse = VU - 18). The port has no module player. The bounces were measured in the reference
// capture instead: each entry is [tick, pulse], the moment a bounce starts and its size, read from the
// gems' vertical jump (2 * pulse pixels). tools/re/bounces.py regenerates the table.
const BOUNCES = [
  [13544, 6], [13587, 6], [13627, 6], [13667, 6], [13711, 6], [13749, 7],
  [13791, 7], [13831, 7], [13874, 8], [13911, 7], [13952, 7], [13995, 6],
  [14035, 7], [14076, 8], [14118, 7], [14159, 8], [14200, 9], [14240, 5],
  [14283, 9], [14323, 8], [14364, 7], [14407, 8], [14447, 8], [14489, 9],
  [14530, 7], [14571, 7], [14611, 7], [14655, 7], [14695, 8], [14735, 7],
  [14775, 6], [14820, 8], [14862, 8], [14905, 7], [14954, 8], [15005, 5],
  [15046, 8], [15088, 9], [15128, 8], [15169, 8], [15212, 8], [15252, 9],
  [15292, 8], [15335, 8], [15356, 2], [15376, 9], [15416, 9], [15459, 8],
  [15499, 8], [15540, 9], [15580, 10], [15621, 8], [15663, 9], [15703, 9],
  [15747, 8], [15787, 7], [15828, 6], [15870, 8], [15911, 7], [15952, 9],
  [15994, 9], [16034, 8], [16075, 7], [16115, 7], [16158, 9], [16199, 9],
  [16239, 10], [16282, 10], [16323, 9], [16363, 6], [16393, 12], [16446, 9],
  [16486, 10], [16526, 8], [16570, 4], [16610, 5], [16652, 3], [16694, 8],
  [16734, 7], [16774, 7], [16818, 8], [16857, 15], [16898, 11],
];
/** How long the VU holds a new value, in ticks: long enough for one frame to read it. */
const HOLD_TICKS = 3;
/** The part subtracts this from the VU. */
const VU_THRESHOLD = 18;

/** Channel VU at the machine's current tick: high right after a bounce, 0 otherwise. */
export function channelVu(m, channel) {
  if (channel !== 5) {
    return 0;
  }
  const tick = m.ticks;
  const bounce = BOUNCES.find(([start]) => tick >= start && tick < start + HOLD_TICKS);
  return bounce ? VU_THRESHOLD + bounce[1] : 0;
}
