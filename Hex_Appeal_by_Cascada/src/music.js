// Where the song is at a given song time. The player runs on real time (exe0, H0_loader_music.md): every Fxx in
// "libertine" is F08 at the default 125 BPM, so a row is 8 ticks of 20 ms and an order is 64 rows. Order 31 row 63
// holds B15: after it the song loops from order 21.
//
// In the recording the song is a little faster than 0.16 s a row: pattern 2, played twice in a row (orders 6 and
// 7), repeats after 10.225 s, not 10.24 (the emulated Sound Blaster's rate runs 0.15% fast against the recorded
// audio). The soundtrack is that recording, so the song position follows its tempo.

const RECORDED_ORDER_SECONDS = 10.225;
export const ROW_SECONDS = RECORDED_ORDER_SECONDS / 64;
const ROWS_PER_ORDER = 64;
const ORDER_COUNT = 32;
const LOOP_ORDER = 21;

/** { order, row } playing at `seconds` of song time (0-based, as the player stores them minus one). */
export function musicPosition(seconds) {
  let rows = Math.floor(Math.max(0, seconds) / ROW_SECONDS + 1e-9);
  const songRows = ORDER_COUNT * ROWS_PER_ORDER;
  if (rows >= songRows) {
    const loopRows = (ORDER_COUNT - LOOP_ORDER) * ROWS_PER_ORDER;
    rows = LOOP_ORDER * ROWS_PER_ORDER + ((rows - songRows) % loopRows);
  }
  return { order: Math.floor(rows / ROWS_PER_ORDER), row: rows % ROWS_PER_ORDER };
}
