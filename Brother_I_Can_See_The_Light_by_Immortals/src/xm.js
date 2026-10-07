// When each row of the module is played. The demo polls MIDAS for the song position and row
// (MIDASgetPlayStatus, 0x10e50) and steps its parts on them; the port reads the same numbers off
// the music's clock through this table. Only what moves time is interpreted: speed and tempo
// (Fxx), position jump (Bxx), pattern break (Dxx), pattern loop (E6x) and pattern delay (EEx).

const HEADER_SIZE_AT = 60;
const ORDER_TABLE_AT = 80;
const MAX_LOOP_GUARD = 100000;

const EFFECT_JUMP = 0x0b;
const EFFECT_BREAK = 0x0d;
const EFFECT_EXTENDED = 0x0e;
const EFFECT_SPEED = 0x0f;
/** Fxx below this sets ticks per row, from it up sets the tempo in BPM. */
const FIRST_TEMPO = 0x20;

/** @returns {{rows: number, cells: Array<Array<{effect: number, param: number}>>}[]} */
function readPatterns(bytes, view, channels, count, at) {
  const patterns = [];
  for (let p = 0; p < count; p++) {
    const headerLength = view.getUint32(at, true);
    const rows = view.getUint16(at + 5, true);
    const packedSize = view.getUint16(at + 7, true);
    let i = at + headerLength;
    const end = i + packedSize;
    const cells = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < channels; c++) {
        let effect = 0;
        let param = 0;
        if (packedSize > 0 && i < end) {
          const first = bytes[i];
          if (first & 0x80) {
            i++;
            if (first & 1) { i++; }
            if (first & 2) { i++; }
            if (first & 4) { i++; }
            if (first & 8) { effect = bytes[i++]; }
            if (first & 16) { param = bytes[i++]; }
          } else {
            effect = bytes[i + 3];
            param = bytes[i + 4];
            i += 5;
          }
        }
        row.push({ effect, param });
      }
      cells.push(row);
    }
    patterns.push({ rows, cells });
    at = end;
  }
  return patterns;
}

/**
 * @param {Uint8Array} bytes an .XM file
 * @returns {{position: number, pattern: number, row: number, time: number}[]} every row played, in
 *   order, with its start in seconds, until the song ends or loops back to a row already played
 */
export function rowTimeline(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = view.getUint32(HEADER_SIZE_AT, true);
  const songLength = view.getUint16(64, true);
  const channels = view.getUint16(68, true);
  const patternCount = view.getUint16(70, true);
  let speed = view.getUint16(76, true);
  let tempo = view.getUint16(78, true);
  const order = bytes.subarray(ORDER_TABLE_AT, ORDER_TABLE_AT + songLength);
  const patterns = readPatterns(bytes, view, channels, patternCount, HEADER_SIZE_AT + headerSize);

  const timeline = [];
  const visited = new Set();
  const loopStart = new Array(channels).fill(0);
  const loopCount = new Array(channels).fill(0);
  let time = 0;
  let position = 0;
  let row = 0;
  for (let guard = 0; guard < MAX_LOOP_GUARD && position < songLength; guard++) {
    const patternIndex = order[position];
    const pattern = patterns[patternIndex];
    const key = position * 256 + row;
    const isLooping = loopCount.some((n) => n > 0);
    if (visited.has(key) && !isLooping) {
      break;
    }
    visited.add(key);
    timeline.push({ position, pattern: patternIndex, row, time });

    let jumpTo = -1;
    let breakTo = -1;
    let delay = 0;
    let loopTo = -1;
    for (let c = 0; c < channels; c++) {
      const { effect, param } = pattern.cells[row][c];
      if (effect === EFFECT_SPEED && param > 0) {
        if (param < FIRST_TEMPO) {
          speed = param;
        } else {
          tempo = param;
        }
      } else if (effect === EFFECT_JUMP) {
        jumpTo = param;
      } else if (effect === EFFECT_BREAK) {
        breakTo = (param >> 4) * 10 + (param & 15);
      } else if (effect === EFFECT_EXTENDED && (param >> 4) === 0xe) {
        delay = param & 15;
      } else if (effect === EFFECT_EXTENDED && (param >> 4) === 6) {
        if ((param & 15) === 0) {
          loopStart[c] = row;
        } else if (loopCount[c] === 0) {
          loopCount[c] = param & 15;
          loopTo = loopStart[c];
        } else if (--loopCount[c] > 0) {
          loopTo = loopStart[c];
        }
      }
    }
    time += (speed * (1 + delay) * 2.5) / tempo;

    if (loopTo >= 0) {
      row = loopTo;
    } else if (jumpTo >= 0 || breakTo >= 0) {
      position = jumpTo >= 0 ? jumpTo : position + 1;
      row = breakTo >= 0 ? breakTo : 0;
      loopStart.fill(0);
    } else if (++row >= pattern.rows) {
      position++;
      row = 0;
      loopStart.fill(0);
    }
  }
  timeline.push({ position, pattern: -1, row: 0, time });
  return timeline;
}

/** The row playing at `seconds`: binary search in a rowTimeline. */
export function rowAt(timeline, seconds) {
  let lo = 0;
  let hi = timeline.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (timeline[mid].time <= seconds) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return timeline[lo];
}
