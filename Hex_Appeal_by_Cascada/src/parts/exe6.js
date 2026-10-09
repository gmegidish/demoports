// exe6, the "slimy panner" end scroller (code Iceman; font and marble O'Hara). docs: H6_slimy.md.
//
// A grey marble checkerboard scrolls up and wobbles like jelly; the end text is written into the board one pixel
// row at a time, chrome-and-gold letters over a dark drop shadow. The part sets no mode: it inherits exe5's mode 13h
// with the 60 Hz CRTC tweak and draws straight into A000 (chain-4, 320 bytes a line). The only register writes are
// the DAC's.
//
// All state lives in the image at its original addresses (cs = 0000, the image at segment 0): the line table that
// parseText builds, the pointers, the phases, the palettes, and the draw loop whose column offsets renderWarp
// patches into its own code. The 223488-byte board buffer is a DOS allocation addressed with 32-bit offsets
// (unreal mode, exe0 set it up).
//
// Cadence: the main loop's frame limiter (0000:01dd) waits as long as the last render took. On the reference
// recording's CPU (video0026, DOSBox 200000 cycles) a render fits in one retrace, so it redraws after every
// callback; the older, CPU-starved run redrew every second retrace. The port's render takes no retrace time,
// so the literal limiter gives one render per retrace, which is what video0026 shows.

/** @typedef {import('../machine.js').Machine} Machine */

// ---- the image (linear = cs offset) ----
const SCROLL_TEXT = 0x1829;
const FADE_PALETTE = 0x1d40;
const TARGET_PALETTE = 0x2040;
const ROW_DIVIDER = 0x2340;
const LINE_TABLE = 0x2342;
const PARSE_HEADER = 0x33ae;
const PARSE_COUNT = 0x33b0;
const CHARSET = 0x3342;
const CHAR_WIDTHS = 0x3378;
const MAIN_LINE = 0x3434;
const MAIN_ROW_OFFSET = 0x3436;
const SHADOW_LINE = 0x3438;
const SHADOW_ROW_OFFSET = 0x343a;
const TILE_ROW_OFFSET = 0x343c;
const RENDER_LAG = 0x3440;
const TILE_FLIP = 0x3442;
const FADE_STATE = 0x397e;
const FADE_LEVEL = 0x3980;
const DONE = 0x3982;
const AMPLITUDE1_MAX = 0x3984;
const AMPLITUDE2_MAX = 0x3986;
const AMPLITUDE1 = 0x398a;
const AMPLITUDE2 = 0x398c;
const SNAPSHOT_COLUMN_PHASE = 0x398e;
const SNAPSHOT_ROW_PHASE = 0x3990;
const SNAPSHOT_UNUSED_PHASE = 0x3992;
const SNAPSHOT_AMPLITUDE1_PHASE = 0x3994;
const SNAPSHOT_AMPLITUDE2_PHASE = 0x3996;
const COLUMN_PHASE = 0x3998;
const ROW_PHASE = 0x399a;
const UNUSED_PHASE = 0x399c;
const AMPLITUDE1_PHASE = 0x399e;
const AMPLITUDE2_PHASE = 0x39a0;
const SCROLL = 0x39a2;
const BUFFER_SEGMENT = 0x39a6;
/** The unrolled draw loop: 160 blocks of 15 bytes, each `mov al,[ebx+d0]; mov ah,[ebx+d1]; stosw`. */
const DRAW_LOOP = 0x3aa1;
const DRAW_LOOP_END = 0x4401;
const DRAW_BLOCK_BYTES = 15;
const DRAW_BLOCK_EVEN_DISPLACEMENT = 3;
const DRAW_BLOCK_ODD_DISPLACEMENT = 0xa;
const SINE = 0x446a;
const MAIN_PALETTE = 0x4967;
const FONT = 0x4e50;
const GREY_PALETTE = 0xcb50;
const TILES = 0xce50;

// ---- constants of the code ----
const BUFFER_PARAGRAPHS = 0x36b1;
const BUFFER_CLEAR_BYTES = 0xdac0 * 4;
const ROW_BYTES = 400;
/** 280 rows: the ring; every row is mirrored this far on. */
const RING_BYTES = 0x1b580;
const TILE_WIDTH = 50;
const TILE_ROWS = 42;
/** Tile B follows tile A: 50 x 42 bytes. */
const TILE_BYTES = 0x834;
const TILES_PER_ROW = 4;
const GLYPH_WIDTH = 24;
const GLYPH_BYTES = 0x258;
const GLYPH_ROW_STEP = 0x18;
const SKIPPED_CHAR = 0x23;
const SHADOW_DARKEN = 0x20;
const SHADOW_SHIFT_LEFT = 4;
const TEXT_END = 0xff;
const LINE_END = 0;
const TABLE_END = 0xffff;
const GREY_FIRST_COLOUR = 0xc0;
const GREY_PALETTE_OFFSET = 0x240;
const GREY_COLOURS = 0x40;
const PALETTE_BYTES = 0x300;
const FADE_FULL = 0x40;
const FADE_NONE = 0;
const FADE_IN = 1;
const FADE_OUT = 2;
const SINE_INDEX_MASK = 0x3fe;
/** 40 rows * 400 + 40 columns: the screen's top-left corner in the board. */
const VIEW_ORIGIN = 0x3ea8;
const SCREEN_WIDTH = 320;
const SCREEN_LINES = 200;
const LINE_PHASE_STEP = 5;
const SCAN_CODE_ESCAPE = 1;
const BLOCK_DISPLACEMENTS = [DRAW_BLOCK_EVEN_DISPLACEMENT, DRAW_BLOCK_ODD_DISPLACEMENT];

/** Signed high word of a 16 x 16 `imul`. */
function imulHigh(a, b) {
  return (a * b) >> 16;
}

/** 0000:33b2 parseText: the ASCII text at 0x1829 into the line table at 0x2342 (header + one word per char). */
function parseText(m) {
  let si = SCROLL_TEXT;
  let di = LINE_TABLE + 2;
  let bx = BUFFER_PARAGRAPHS; // what main leaves in bx; only the unused '#' escape writes through it
  for (;;) {
    const al = m.u8(si++);
    if (al === TEXT_END) {
      m.set16(di - 2, TABLE_END);
      return;
    }
    if (al === SKIPPED_CHAR) {
      m.set8(bx, al);
      m.set8(bx + 1, m.u8(si++));
      bx += 2;
      continue;
    }
    if (al === LINE_END) {
      closeLine(m, di);
      di += 2;
      continue;
    }
    m.set16(PARSE_COUNT, m.u16(PARSE_COUNT) + 1);
    let index = CHARSET - 1;
    do {
      index++;
    } while (m.u8(index) !== al);
    index -= CHARSET;
    m.set16(di, index | (m.u8(CHAR_WIDTHS + index) << 8));
    di += 2;
  }
}

/** 0000:33d8: the line's header = centred x offset (low byte) and char count; the next header goes at di. */
function closeLine(m, di) {
  let bx = m.u16(PARSE_HEADER) + 3;
  let count = m.u16(PARSE_COUNT) || 0x10000;
  let sum = 0;
  for (; count > 0; count--) {
    sum = (sum + m.u8(bx) + 1) & 0xffff;
    bx += 2;
  }
  const xOffset = (((ROW_BYTES - sum) & 0xffff) >> 1) & 0xff;
  m.set16(m.u16(PARSE_HEADER), xOffset | (m.u8(PARSE_COUNT) << 8));
  m.set16(PARSE_HEADER, di);
  m.set16(PARSE_COUNT, 0);
}

/** `rep movsw` of one 50-byte tile row from the tile segment (0ce5) into the buffer. */
function copyTileRow(m, bufferBase, destination, tileOffset) {
  m.mem.copyWithin(bufferBase + destination, TILES + tileOffset, TILES + tileOffset + TILE_WIDTH);
}

/** One 400-byte board row: four tile pairs, first/second tile row at `tileOffset`. */
function copyBoardRow(m, bufferBase, destination, firstTile, secondTile, tileOffset) {
  for (let k = 0; k < TILES_PER_ROW; k++) {
    copyTileRow(m, bufferBase, destination + k * 2 * TILE_WIDTH, firstTile + tileOffset);
    copyTileRow(m, bufferBase, destination + k * 2 * TILE_WIDTH + TILE_WIDTH, secondTile + tileOffset);
  }
}

/** 0000:0092 the initial board: BA rows from tile row 14, then AB; then 3 x (BA, AB) bands of 42 rows. */
function fillInitialBoard(m, bufferBase) {
  const tileA = 0;
  const tileB = TILE_BYTES;
  let edi = 0;
  const band = (firstTile, secondTile, firstRow) => {
    for (let row = firstRow; row < TILE_ROWS; row++) {
      copyBoardRow(m, bufferBase, edi, firstTile, secondTile, row * TILE_WIDTH);
      edi += ROW_BYTES;
    }
  };
  band(tileB, tileA, 14);
  band(tileA, tileB, 0);
  for (let pass = 0; pass < 3; pass++) {
    band(tileB, tileA, 0);
    band(tileA, tileB, 0);
  }
}

/** 0000:35a0 / 0000:378c: one glyph row of a text line into the buffer, darkening (shadow) or opaque (text). */
function drawTextRow(m, bufferBase, line, rowOffset, rowStart, isShadow) {
  const mem = m.mem;
  let edi = rowStart + mem[line];
  let count = mem[line + 1];
  let bx = line + 2;
  do {
    while (mem[bx] === SKIPPED_CHAR) {
      bx += 2;
    }
    const source = FONT + ((mem[bx] * GLYPH_BYTES + rowOffset) & 0xffff);
    const high = edi & 0xffff0000;
    for (let i = 0; i < GLYPH_WIDTH; i++) {
      const value = mem[source + i];
      if (value === 0) {
        continue;
      }
      // `inc di`: the pixel address wraps inside 64 KiB.
      const address = bufferBase + ((high | ((edi + i) & 0xffff)) >>> 0);
      mem[address] = isShadow ? (mem[address] - SHADOW_DARKEN) & 0xff : value;
    }
    edi += ((mem[bx + 1] + 1) & 0xff);
    bx += 2;
    count = (count - 1) & 0xff;
  } while (count !== 0);
}

/** The header of the line after `line`, or null at the 0xffff end marker. */
function nextLine(m, line) {
  const next = line + ((m.u8(line + 1) << 1) + 2);
  return m.u16(next) === TABLE_END ? null : next;
}

/** 0000:3444 writeRow: tiles, the shadow pass, the text pass, then the mirror copy 280 rows on. */
function writeRow(m, bufferBase) {
  const scroll = m.u32(SCROLL);
  const tileOffset = m.u32(TILE_ROW_OFFSET);
  if (m.u8(TILE_FLIP) === 1) {
    copyBoardRow(m, bufferBase, scroll, TILE_BYTES, 0, tileOffset);
  } else {
    copyBoardRow(m, bufferBase, scroll, 0, TILE_BYTES, tileOffset);
  }
  m.set32(TILE_ROW_OFFSET, tileOffset + TILE_WIDTH);
  if (m.u32(TILE_ROW_OFFSET) === TILE_BYTES) {
    m.set32(TILE_ROW_OFFSET, 0);
    m.set8(TILE_FLIP, m.u8(TILE_FLIP) ^ 1);
  }

  drawTextRow(m, bufferBase, m.u16(SHADOW_LINE), m.u16(SHADOW_ROW_OFFSET), scroll - SHADOW_SHIFT_LEFT, true);
  m.set16(SHADOW_ROW_OFFSET, m.u16(SHADOW_ROW_OFFSET) + GLYPH_ROW_STEP);
  if (m.u16(SHADOW_ROW_OFFSET) === GLYPH_BYTES) {
    const next = nextLine(m, m.u16(SHADOW_LINE));
    m.set16(SHADOW_LINE, next === null ? LINE_TABLE : next);
    m.set16(SHADOW_ROW_OFFSET, 0);
  }

  drawTextRow(m, bufferBase, m.u16(MAIN_LINE), m.u16(MAIN_ROW_OFFSET), scroll, false);
  m.set16(MAIN_ROW_OFFSET, m.u16(MAIN_ROW_OFFSET) + GLYPH_ROW_STEP);
  if (m.u16(MAIN_ROW_OFFSET) === GLYPH_BYTES) {
    const next = nextLine(m, m.u16(MAIN_LINE));
    if (next === null) {
      m.set16(MAIN_LINE, LINE_TABLE);
      m.set16(FADE_STATE, FADE_OUT); // the text has ended: fade out and quit
    } else {
      m.set16(MAIN_LINE, next);
    }
    m.set16(MAIN_ROW_OFFSET, 0);
  }

  m.mem.copyWithin(bufferBase + scroll + RING_BYTES, bufferBase + scroll, bufferBase + scroll + ROW_BYTES);
}

/** 0000:02a6: upload the palette computed last time, then compute fadePal = srcPal * level >> 6 (mul bl; shr ax,6). */
function uploadAndFadePalette(m) {
  m.vga.dacLoad(0, m.mem, FADE_PALETTE, PALETTE_BYTES);
  const level = m.u8(FADE_LEVEL);
  for (let i = 0; i < PALETTE_BYTES; i++) {
    m.mem[FADE_PALETTE + i] = (m.mem[TARGET_PALETTE + i] * level) >> 6;
  }
}

/** 0000:0257 slimyCallback, once per retrace: the fade, a board row every second call, the phases. */
function slimyCallback(m, bufferBase) {
  if (m.u16(FADE_STATE) !== FADE_NONE) {
    if (m.u16(FADE_STATE) === FADE_IN) {
      m.set16(FADE_LEVEL, m.u16(FADE_LEVEL) + 1);
      if (m.u16(FADE_LEVEL) >= FADE_FULL) {
        m.set16(FADE_STATE, FADE_NONE);
      }
    }
    if (m.u16(FADE_STATE) === FADE_OUT) {
      m.set16(FADE_LEVEL, m.u16(FADE_LEVEL) - 1);
      // int 0x80 fn 9: the music master volume. The port plays the recorded audio, so this is informational.
      m.volume = m.u16(FADE_LEVEL);
      // jne after the int: iret restores the flags of the dec.
      if (m.u16(FADE_LEVEL) === 0) {
        m.set16(FADE_STATE, FADE_NONE);
        m.set16(DONE, 1);
      }
    }
    uploadAndFadePalette(m);
    if (m.u16(FADE_LEVEL) >= FADE_FULL) {
      m.set16(RENDER_LAG, 0);
    }
  }
  m.set16(ROW_DIVIDER, m.u16(ROW_DIVIDER) - 1);
  if (m.u16(ROW_DIVIDER) === 0) {
    m.set16(ROW_DIVIDER, 2);
    writeRow(m, bufferBase);
    m.set32(SCROLL, m.u32(SCROLL) + ROW_BYTES);
    if (m.u32(SCROLL) >= RING_BYTES) {
      m.set32(SCROLL, 0);
    }
  }
  m.set16(AMPLITUDE1_PHASE, m.u16(AMPLITUDE1_PHASE) + 4);
  m.set16(AMPLITUDE2_PHASE, m.u16(AMPLITUDE2_PHASE) + 1);
  m.set16(ROW_PHASE, m.u16(ROW_PHASE) + 6);
  m.set16(COLUMN_PHASE, m.u16(COLUMN_PHASE) + 12);
  m.set16(UNUSED_PHASE, m.u16(UNUSED_PHASE) + 2);
}

/** 0000:39e1: the 320 column offsets, patched as disp32 into the unrolled draw loop (self-modifying code). */
function patchColumnOffsets(m) {
  let bx = m.u16(SNAPSHOT_COLUMN_PHASE) & SINE_INDEX_MASK;
  let ecx = (m.u32(SCROLL) + VIEW_ORIGIN) | 0;
  const amplitude = m.s16(AMPLITUDE2);
  for (let di = DRAW_LOOP; di !== DRAW_LOOP_END; di += DRAW_BLOCK_BYTES) {
    for (const displacement of BLOCK_DISPLACEMENTS) {
      const product = Math.imul(m.s16(SINE + bx), amplitude);
      bx = (bx + 2) & SINE_INDEX_MASK;
      const ebp = (Math.imul(product >> 16, ROW_BYTES) + ecx) | 0;
      ecx = (ecx + 1) | 0;
      m.set32(di + displacement, ebp);
    }
  }
}

/** 0000:39a8 renderWarp: amplitudes, column table, then 200 warped lines from the buffer into A000. */
function renderWarp(m, bufferBase, columnOffsets) {
  m.set16(AMPLITUDE1, imulHigh(m.s16(SINE + (m.u16(SNAPSHOT_AMPLITUDE1_PHASE) & SINE_INDEX_MASK)), m.s16(AMPLITUDE1_MAX)));
  m.set16(AMPLITUDE2, imulHigh(m.s16(SINE + (m.u16(SNAPSHOT_AMPLITUDE2_PHASE) & SINE_INDEX_MASK)), m.s16(AMPLITUDE2_MAX)));
  patchColumnOffsets(m);
  for (let column = 0; column < SCREEN_WIDTH; column++) {
    const block = DRAW_LOOP + (column >> 1) * DRAW_BLOCK_BYTES;
    columnOffsets[column] = m.u32(block + (column & 1 ? DRAW_BLOCK_ODD_DISPLACEMENT : DRAW_BLOCK_EVEN_DISPLACEMENT)) | 0;
  }

  const mem = m.mem;
  const planes = m.vga.planes;
  const amplitude = m.s16(AMPLITUDE1);
  let si = m.u16(SNAPSHOT_ROW_PHASE);
  let ebp = 0;
  let di = 0;
  for (let line = 0; line < SCREEN_LINES; line++) {
    si &= SINE_INDEX_MASK;
    const ebx = imulHigh(amplitude, m.s16(SINE + si)) + ebp;
    si += LINE_PHASE_STEP;
    // Chain-4: CPU address a is plane a & 3, offset a >> 2 (a line is 320 bytes, so plane = column & 3).
    for (let column = 0; column < SCREEN_WIDTH; column++) {
      planes[column & 3][(di + column) >> 2] = mem[bufferBase + ((ebx + columnOffsets[column]) >>> 0)];
    }
    di += SCREEN_WIDTH;
    ebp += ROW_BYTES;
  }
}

/** 0000:0035: the target palette (and the DAC, at full brightness until callback 1) with the grey ramps at 0xc0. */
function loadPalettes(m) {
  m.mem.copyWithin(TARGET_PALETTE, MAIN_PALETTE, MAIN_PALETTE + PALETTE_BYTES);
  m.vga.dacLoad(0, m.mem, MAIN_PALETTE, PALETTE_BYTES);
  const greys = GREY_PALETTE + GREY_PALETTE_OFFSET;
  m.mem.copyWithin(TARGET_PALETTE + GREY_PALETTE_OFFSET, greys, greys + GREY_COLOURS * 3);
  m.vga.dacLoad(GREY_FIRST_COLOUR, m.mem, greys, GREY_COLOURS * 3);
}

/**
 * 0000:0000 main. A generator: `yield` = wait for the next retrace (the frame loop then bumps the counter and runs
 * the callback). Returns when the fade-out has reached 0: the demo is over.
 * @param {Machine} m
 */
export function* runSlimy(m) {
  // DOS 4Ah (shrink to 0xe29 paragraphs) has nothing to do here; 48h allocates the board buffer.
  const bufferSegment = m.allocParagraphs(BUFFER_PARAGRAPHS);
  m.set16(BUFFER_SEGMENT, bufferSegment);
  const bufferBase = bufferSegment * 16;
  m.mem.fill(0, bufferBase, bufferBase + BUFFER_CLEAR_BYTES);
  parseText(m);
  loadPalettes(m);
  fillInitialBoard(m, bufferBase);

  m.callback = () => slimyCallback(m, bufferBase);
  m.frameCounter = 0;
  const columnOffsets = new Int32Array(SCREEN_WIDTH);
  for (;;) {
    // 0000:01dd the frame limiter: wait for a tick, then for more ticks than the last render took (`jbe`).
    const startTick = m.frameCounter;
    while (m.frameCounter === startTick) {
      yield;
    }
    while (m.frameCounter <= m.u16(RENDER_LAG)) {
      yield;
    }
    m.set16(RENDER_LAG, m.frameCounter - 1);
    m.frameCounter = 0;

    m.set16(SNAPSHOT_ROW_PHASE, m.u16(ROW_PHASE));
    m.set16(SNAPSHOT_COLUMN_PHASE, m.u16(COLUMN_PHASE));
    m.set16(SNAPSHOT_UNUSED_PHASE, m.u16(UNUSED_PHASE));
    m.set16(SNAPSHOT_AMPLITUDE1_PHASE, m.u16(AMPLITUDE1_PHASE));
    m.set16(SNAPSHOT_AMPLITUDE2_PHASE, m.u16(AMPLITUDE2_PHASE));
    renderWarp(m, bufferBase, columnOffsets);

    if (m.readKeyboard() === SCAN_CODE_ESCAPE) {
      m.set16(FADE_STATE, FADE_OUT); // ESC: the same fade-out, from the current level
    }
    if (m.u16(DONE) === 1) {
      break;
    }
  }
  // int 0x80 fn 0x1c, free the buffer, int 21h/4Ch: the demo ends.
  m.callback = null;
}
