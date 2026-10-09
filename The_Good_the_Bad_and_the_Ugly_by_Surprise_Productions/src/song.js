// song.js: silent sequencer of the GBU.EXE MOD player (segment 008e), timing and position only.
// It reproduces how 008e:1f63 advances tick -> (order, row, speed, sync counter); no audio.
//
// createSong(modBytes) -> { tick(), order, row, speed, tickInRow, syncCounter, pattern }
//   modBytes: the module ("Beastsong", M.K., 31 samples) as stored at GBU.EXE file offset 0x9c40.
//   tick(): one call of 008e:1f63 (one timer IRQ = one retrace, or one hand-made call by an effect).

const SONG_LENGTH_OFFSET = 0x3b6;      // 008e:1af1 reads the song length here
const ORDER_TABLE_OFFSET = 0x3b8;      // 128 entries, copied to 008e:11df
const PATTERN_DATA_OFFSET = 0x43c;     // header size read by 008e:1942
const BYTES_PER_PATTERN = 1024;
const BYTES_PER_ROW = 16;              // 4 channels x 4 bytes
const CHANNEL_COUNT = 4;
const ROWS_PER_PATTERN = 64;
const INITIAL_SPEED = 8;               // byte 008e:1268 in the image
const LOOP_ORDER = 0x0b;               // 008e:205a: order wraps to 11
const MAX_SPEED_PARAM = 0x1f;          // 008e:1f2f: larger Fxx params (BPM) are ignored
const SPEED_PARAM_BIAS = 3;            // 008e:1f34: speed = param + 3
const BREAK_ROW = 0x3f;                // 008e:1f1d: Dxx forces row 63
const EFFECT_SYNC = 0x8;               // 008e:1e8e: inc word 008e:11cc
const EFFECT_PATTERN_BREAK = 0xd;      // 008e:1f12
const EFFECT_SET_SPEED = 0xf;          // 008e:1f2f

export function createSong(modBytes) {
  // 008e:19a3 increments the song length once more after loading: one extra order is played.
  const playerSongLength = modBytes[SONG_LENGTH_OFFSET] + 1;
  const orders = modBytes.subarray(ORDER_TABLE_OFFSET, ORDER_TABLE_OFFSET + 128);

  function readCell(rowPointer, channel) {
    const offset = PATTERN_DATA_OFFSET + rowPointer + channel * 4;
    if (offset + 3 >= modBytes.length) {
      return { effect: 0, param: 0 };
    }
    return { effect: modBytes[offset + 2] & 0x0f, param: modBytes[offset + 3] };
  }

  const state = {
    order: 0,              // word 008e:1261
    row: 0,                // byte 008e:1263
    rowPointer: orders[0] * BYTES_PER_PATTERN,   // word 008e:1264, set by 008e:206d at load
    breakOffset: 0,        // word 008e:1266
    speed: INITIAL_SPEED,  // byte 008e:1268
    tickInRow: 0,          // byte 008e:1269
    syncCounter: 0,        // word 008e:11cc (returned by 008e:18a4)
  };

  // 008e:206d: start the pattern of the current order at the pending break offset.
  function startOrder() {
    state.rowPointer = orders[state.order] * BYTES_PER_PATTERN + state.breakOffset;
    state.row = 0;
    state.breakOffset = 0;
  }

  // Tick 0 of a row: the cells are read and their effects run in channel order 0..3, within the same call.
  // Only 8xx, Dxx and Fxx change timing or position; Bxx and Exx (E6x, EEx...) are ignored by this player.
  function runRowEffects() {
    for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
      const { effect, param } = readCell(state.rowPointer, channel);
      if (effect === EFFECT_SET_SPEED) {
        if (param <= MAX_SPEED_PARAM) {
          state.speed = param + SPEED_PARAM_BIAS;
        }
      } else if (effect === EFFECT_PATTERN_BREAK) {
        state.breakOffset = param * BYTES_PER_ROW;   // raw param, not BCD
        state.row = BREAK_ROW;
      } else if (effect === EFFECT_SYNC) {
        state.syncCounter = (state.syncCounter + 1) & 0xffff;
      }
    }
  }

  // 008e:1f63
  function tick() {
    if (state.tickInRow === 0) {
      runRowEffects();
    }
    state.tickInRow = (state.tickInRow + 1) & 0xff;
    if (state.tickInRow < state.speed) {
      return;
    }
    state.rowPointer = (state.rowPointer + BYTES_PER_ROW) & 0xffff;
    state.tickInRow = 0;
    state.row = (state.row + 1) & 0xff;
    if (state.row < ROWS_PER_PATTERN) {
      return;
    }
    state.order += 1;
    if (state.order >= playerSongLength) {
      state.order = LOOP_ORDER;
    }
    startOrder();
  }

  // The number of channels with a note (period) in the row the next tick 0 reads (the GUS work of that tick;
  // the plasma 0cf9 loses scanlines on such ticks).
  function notesInNextRow() {
    let notes = 0;
    for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
      const offset = PATTERN_DATA_OFFSET + state.rowPointer + channel * 4;
      if (offset + 1 < modBytes.length && (((modBytes[offset] & 0x0f) << 8) | modBytes[offset + 1]) !== 0) {
        notes++;
      }
    }
    return notes;
  }

  return {
    tick,
    notesInNextRow,
    get order() { return state.order; },
    get row() { return state.row; },
    get speed() { return state.speed; },
    get tickInRow() { return state.tickInRow; },
    get syncCounter() { return state.syncCounter; },
    get pattern() { return orders[state.order]; },
  };
}
