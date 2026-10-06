// Part 7 ($70110): four Deluxe Paint animations, played straight from their IFF ANIM files.
// First a white pen sketches two tower blocks on black. Then a dark red spiral fades in behind and three more
// line animations (a spinning ring, a little walking figure) scroll in from below, play, and leave again.
//
// The part is a general ANIM opcode-5 player: the first frame is a ByteRun1 BODY unpacked into two buffers, every
// further frame is a column-wise delta applied to the hidden buffer, then the buffers swap. Each animation is one
// bitplane. The spiral is a second bitplane cycling through eight stored pictures, and the scrolling is nothing
// but an offset added to the animation's bitplane pointer (the memory around the buffers is empty).
//
// Time is kept by a copper interrupt (line $0c of every frame) that walks a script of (frames, animation) pairs,
// also calls the music, and writes the bitplane pointers into the copper list. The main loop only unpacks frames,
// at the 30 pictures a second the files ask for.
import { r8, r16, r16s, r32, w16, w32, s8, waitLine } from '../machine.js';
import { custom } from '../display.js';

const WORKSPACE = 0x100000;
const WORKSPACE_BYTES = 0x4b000;
const BITMAP_MEMORY = 0x119000;
const FRAME_TABLE = 0x14b000;
const FRAME_ENTRY_BYTES = 8;
const ANIMATIONS = 0x85270;
const SCRIPT = 0xb9e88;
/** The script counter starts at 1 ($b9e82), so the first entry is read on the second interrupt. */
const SCRIPT_FIRST_COUNT = 1;

const COPPER_ENTRY = 0x71188;
const COPPER_DISPLAY = 0x71190;
const COPPER_BLANK = 0x71264;
const COPPER_FMODE = 0x71196;
const COPPER_DDFSTRT = 0x711a6;
const COPPER_DDFSTOP = 0x711aa;
const COPPER_BPLCON0 = 0x711be;
const COPPER_BPL1MOD = 0x711c2;
const COPPER_BPL2MOD = 0x711c6;
const COPPER_SPRITES = 0x711c8;
const COPPER_PLANES = 0x7120c;
const COPPER_SPIRAL_PLANE = 0x71214;
const COPPER_COLOURS = 0x7124c;
const COPPER_END = 0xfffffffe;
const INTERRUPT_LINE = 0x0c;

const REG_SPR0PTH = 0x120;
const REG_BPL1PTH = 0xe0;
const REG_BPL2PTH = 0xe4;
const REG_COLOR00 = 0x180;
const REG_COLOR02 = 0x184;
const SPRITE_POINTER_WORDS = 16;
const ONE_PLANE = 0x1200;
const TWO_PLANES = 0x2200;
/** AGA (LISAID $fcf8) gets 64-bit fetches and the data-fetch window that goes with them. */
const AGA_FMODE = 3;
const AGA_DDFSTRT = 0x38;
const AGA_DDFSTOP = 0xa0;
const LORES_LINE_BYTES = 0x28;

const SPIRAL = 0x71270;
const SPIRAL_PICTURE_BYTES = 0x2800;
const SPIRAL_END = 0x14000;
const SPIRAL_FADE = 0x70412;

const SCENE_RING = 2;
const SCENE_FIGURE = 3;
const SCENE_LAST = 4;
/** Two lines of 40 bytes: the scroll speed. */
const SCROLL_STEP = 0x50;
const SCROLL_BELOW = -0x1c20;
const SCROLL_ABOVE = 0x1f40;
const RING_STARTS = 0x258;
const RING_FADE_ENDS = 0x218;
const RING_RISE_STARTS = 0x190;
const RING_RISE_ENDS = 0x136;
const LAST_STARTS = 0x1f4;
const LAST_ARRIVED = 0x190;
const LEAVE_STARTS = 0x64;
const FIGURE_SHOWN = 0x3a;

/** ExecBase.VBlankFrequency ($212), which the part reads to turn the file's frame rate into a wait. PAL. */
const VBLANK_FREQUENCY = 50;
const TICKS_PER_INTERRUPT = 0x64;

/**
 * Measured from the capture: the first animation starts three frames later than the code alone explains (the
 * script, which runs off the interrupt, is not late). Nothing of the kind shows when the third one opens.
 */
const FIRST_OPEN_EXTRA_FRAMES = 3;

const ID_BMHD = 0x424d4844;
const ID_BODY = 0x424f4459;
const ID_DPAN = 0x4450414e;
const ID_ANHD = 0x414e4844;
const ID_DLTA = 0x444c5441;
const CHUNK_HEADER = 8;
const FORM_HEADER = 12;
const BMHD_WIDTH = 0;
const BMHD_HEIGHT = 2;
const BMHD_PLANES = 8;
const BMHD_COMPRESSION = 10;
const DPAN_FRAMES_PER_SECOND = 4;
const ANHD_WIDTH = 2;
const ANHD_BITS = 0x17;
const ANHD_XOR = 2;

/** The start-up check ($705e4) walks all four files; the last one's rate (30, like the others) is left behind. */
const SCANNED_FRAMES_PER_SECOND = 0x1e;

const ticksPerPicture = (framesPerSecond) => Math.trunc((VBLANK_FREQUENCY * TICKS_PER_INTERRUPT) / framesPerSecond);
const even = (size) => (size + 1) & ~1;

/** Address of the data of chunk `id` inside the FORM at `form`, or 0. */
function findChunk(m, form, id) {
  const end = form + CHUNK_HEADER + r32(m, form + 4);
  for (let chunk = form + FORM_HEADER; chunk < end; chunk += CHUNK_HEADER + even(r32(m, chunk + 4))) {
    if (r32(m, chunk) === id) {
      return chunk + CHUNK_HEADER;
    }
  }
  return 0;
}

/** $70422: the script. Each entry is shown for its count plus one interrupts; animation 0 ends the part. */
function advanceScript(m, s) {
  s.count -= 1;
  if (s.count >= 0) {
    return;
  }
  s.count = r16s(m, s.script);
  s.scene = r16(m, s.script + 2);
  s.script += 4;
  s.requested = s.scene;
  if (s.scene === 0) {
    s.isFinished = true;
  }
}

/** $702de: the spiral plane shows the next of its eight pictures every second frame. */
function cycleSpiral(m, s) {
  if (s.scene <= 1) {
    return;
  }
  w16(m, COPPER_BPL2MOD, 0);
  const picture = SPIRAL + s.spiralOffset;
  s.spiralHold -= 1;
  if (s.spiralHold < 0) {
    s.spiralOffset += SPIRAL_PICTURE_BYTES;
    s.spiralHold = 1;
  }
  if (s.spiralOffset >= SPIRAL_END) {
    s.spiralOffset = 0;
  }
  w16(m, COPPER_SPIRAL_PLANE, REG_BPL2PTH);
  w16(m, COPPER_SPIRAL_PLANE + 2, picture >>> 16);
  w16(m, COPPER_SPIRAL_PLANE + 4, REG_BPL2PTH + 2);
  w16(m, COPPER_SPIRAL_PLANE + 6, picture & 0xffff);
}

/** $7034e: the ring starts 180 lines down, waits, rises into place, and finally leaves through the top. */
function scrollRing(s) {
  if (s.scene !== SCENE_RING) {
    return;
  }
  if (s.count === RING_STARTS) {
    s.scroll = SCROLL_BELOW;
    return;
  }
  if (s.count >= RING_RISE_STARTS) {
    return;
  }
  if (s.count >= RING_RISE_ENDS || s.count <= LEAVE_STARTS) {
    s.scroll += SCROLL_STEP;
  }
}

/** $7039a: the last animation comes down from above the screen and leaves through the bottom. */
function scrollLast(s) {
  if (s.scene !== SCENE_LAST) {
    return;
  }
  if (s.count === LAST_STARTS) {
    s.scroll = SCROLL_ABOVE;
    return;
  }
  if (s.count >= LAST_ARRIVED || s.count <= LEAVE_STARTS) {
    s.scroll -= SCROLL_STEP;
  }
}

/** $703dc: the spiral's colour goes from black to $703 during the ring's first 64 frames. */
function fadeSpiralIn(m, s) {
  if (s.scene !== SCENE_RING || s.count <= RING_FADE_ENDS) {
    return;
  }
  const step = ((RING_STARTS - s.count) >> 2) & 0xfffe;
  custom(m, REG_COLOR02, r16(m, SPIRAL_FADE + step));
}

/** $70548: point the copper at the visible buffer, moved by the scroll, and switch the spiral plane on. */
function showFrontBuffer(m, s) {
  if (s.front === null) {
    return;
  }
  s.front.planes.forEach((plane, i) => {
    const pointer = plane + s.scroll;
    w16(m, COPPER_PLANES + i * 8, REG_BPL1PTH + i * 4);
    w16(m, COPPER_PLANES + i * 8 + 2, pointer >>> 16);
    w16(m, COPPER_PLANES + i * 8 + 4, REG_BPL1PTH + i * 4 + 2);
    w16(m, COPPER_PLANES + i * 8 + 6, pointer & 0xffff);
  });
  w16(m, COPPER_BPLCON0, s.scene > 1 ? TWO_PLANES : ONE_PLANE);
}

/** $7026a: the level-3 handler, raised by the copper. (It also calls mt_music; the vertical blank is off.) */
function interrupt(m, s) {
  advanceScript(m, s);
  cycleSpiral(m, s);
  scrollRing(s);
  scrollLast(s);
  fadeSpiralIn(m, s);
  showFrontBuffer(m, s);
  if (s.scene === SCENE_FIGURE && s.count < FIGURE_SHOWN) {
    s.scroll = 0;
  }
  s.ticks += TICKS_PER_INTERRUPT;
}

/** $702c8: wait for the next interrupt. */
function* waitInterrupt(m, s) {
  yield* waitLine(m, INTERRUPT_LINE);
  interrupt(m, s);
}

/** $70df4: the first picture, ByteRun1-packed line by line, into every plane of a buffer. */
function unpackBody(m, bitmap, bmhd, body) {
  const rows = Math.min(r16(m, bmhd + BMHD_HEIGHT), bitmap.height);
  const lineBytes = ((r16(m, bmhd + BMHD_WIDTH) + 15) >> 3) & 0xfffe;
  const isPacked = r8(m, bmhd + BMHD_COMPRESSION) !== 0;
  let source = body;
  for (let row = 0; row < rows; row++) {
    for (const plane of bitmap.planes) {
      let destination = plane + row * bitmap.rowBytes;
      const lineEnd = destination + lineBytes;
      while (destination < lineEnd) {
        const code = isPacked ? s8(r8(m, source++)) : lineBytes - 1;
        const length = (code < 0 ? -code : code) + 1;
        if (code < 0) {
          m.mem.fill(r8(m, source++), destination, destination + length);
        } else {
          m.mem.copyWithin(destination, source, source + length);
          source += length;
        }
        destination += length;
      }
    }
  }
}

/** $70f10 / $70f68: one plane of an opcode-5 delta. Every column is a list of skip, run and literal ops. */
function applyColumns(m, source, plane, columns, rowBytes, isXor) {
  const put = (at, value) => {
    m.mem[at] = isXor ? m.mem[at] ^ value : value;
  };
  for (let column = 0; column < columns; column++) {
    let destination = plane + column;
    for (let ops = r8(m, source++); ops > 0; ops--) {
      const op = r8(m, source++);
      if (op & 0x80) {
        for (let i = op & 0x7f; i > 0; i--, destination += rowBytes) {
          put(destination, r8(m, source++));
        }
      } else if (op === 0) {
        const value = r8(m, source + 1);
        for (let i = r8(m, source); i > 0; i--, destination += rowBytes) {
          put(destination, value);
        }
        source += 2;
      } else {
        destination += op * rowBytes;
      }
    }
  }
}

/** $70d6a: apply the next delta to the hidden buffer. After the last one the animation loops to its second. */
function unpackNextFrame(m, s) {
  const entry = FRAME_TABLE + s.frame * FRAME_ENTRY_BYTES;
  const header = r32(m, entry);
  const delta = r32(m, entry + 4);
  const columns = ((r16(m, header + ANHD_WIDTH) + 15) >> 3) & 0xfffe;
  const isXor = (r8(m, header + ANHD_BITS) & ANHD_XOR) !== 0;
  s.back.planes.forEach((plane, i) => {
    const offset = r32(m, delta + i * 4);
    if (offset !== 0) {
      applyColumns(m, delta + offset, plane, columns, s.back.rowBytes, isXor);
    }
  });
  s.frame = s.frame + 1 < s.frameCount - 1 ? s.frame + 1 : 1;
}

/** $70b80: note where every later frame keeps its ANHD and DLTA chunks. Returns the number of frames. */
function listFrames(m, anim) {
  const end = anim + CHUNK_HEADER + r32(m, anim + 4);
  const first = anim + FORM_HEADER;
  let entry = FRAME_TABLE;
  let count = 1;
  for (let form = first + CHUNK_HEADER + even(r32(m, first + 4)); form < end; form += CHUNK_HEADER + even(r32(m, form + 4))) {
    w32(m, entry, findChunk(m, form, ID_ANHD));
    w32(m, entry + 4, findChunk(m, form, ID_DLTA));
    entry += FRAME_ENTRY_BYTES;
    count += 1;
  }
  w32(m, entry, 0);
  w32(m, entry + 4, 0);
  return count;
}

/** $70a70: display set-up in the copper list: modulos, the AGA fetch mode, and eight sprite pointers to nowhere. */
function prepareCopper(m, s) {
  const modulo = s.back.rowBytes - LORES_LINE_BYTES;
  w16(m, COPPER_BPL1MOD, modulo);
  w16(m, COPPER_BPL2MOD, modulo);
  w16(m, COPPER_FMODE, AGA_FMODE);
  w16(m, COPPER_DDFSTRT, AGA_DDFSTRT);
  w16(m, COPPER_DDFSTOP, AGA_DDFSTOP);
  for (let i = 0; i < SPRITE_POINTER_WORDS; i++) {
    w16(m, COPPER_SPRITES + i * 4, REG_SPR0PTH + i * 2);
    w16(m, COPPER_SPRITES + i * 4 + 2, 0);
  }
  showFrontBuffer(m, s);
}

/**
 * Not original code. The copper has run the whole display list on the few frames before it gets cut, and that is
 * the only time the four colours are set. The display model runs the copper only for frames that are drawn,
 * which may be none of those, so its moves are replayed here.
 */
function runDisplayListOnce(m) {
  for (let at = COPPER_DISPLAY; r32(m, at) !== COPPER_END; at += 4) {
    if ((r16(m, at) & 1) === 0) {
      custom(m, r16(m, at) & 0x1fe, r16(m, at + 2));
    }
  }
}

/**
 * $70716: open an animation: read its header, show the first picture.
 * The file's own palette is never used ($709d6 is a bare rts); instead the copper list is cut short just before
 * its colours, so black/white/black/white stay as they were set on the very first frame.
 */
function* openAnimation(m, s, anim) {
  const first = anim + FORM_HEADER;
  const bmhd = findChunk(m, first, ID_BMHD);
  const framesPerSecond = r8(m, findChunk(m, first, ID_DPAN) + DPAN_FRAMES_PER_SECOND);
  const rowBytes = ((r16(m, bmhd + BMHD_WIDTH) >> 3) + 1) & 0xfffe;
  const height = r16(m, bmhd + BMHD_HEIGHT);
  const planeCount = r8(m, bmhd + BMHD_PLANES);
  const planeBytes = rowBytes * height;
  if (!s.hasBuffers) {
    // $70c5c: only when the size changes, and all four are 320x256x1. The screen is blanked for it.
    m.cop2lc = COPPER_BLANK;
    yield* waitInterrupt(m, s);
    for (let i = 0; i < FIRST_OPEN_EXTRA_FRAMES; i++) {
      yield* waitInterrupt(m, s);
    }
    s.hasBuffers = true;
  }
  yield* waitInterrupt(m, s);
  if (r32(m, COPPER_COLOURS) !== COPPER_END) {
    runDisplayListOnce(m);
  }
  w32(m, COPPER_COLOURS, COPPER_END);
  // $709d8: two buffers, with one buffer's worth of empty memory between them for the scroll to show.
  const planesAt = (base) => Array.from({ length: planeCount }, (_, i) => base + i * planeBytes);
  s.back = { rowBytes, height, planes: planesAt(BITMAP_MEMORY) };
  s.front = { rowBytes, height, planes: planesAt(BITMAP_MEMORY + 2 * planeBytes * planeCount) };
  prepareCopper(m, s);
  s.frameCount = listFrames(m, anim);
  const body = findChunk(m, first, ID_BODY);
  unpackBody(m, s.back, bmhd, body);
  unpackBody(m, s.front, bmhd, body);
  s.frame = 0;
  // $70928: interrupts are worth 100 ticks; a picture is due whenever more than this many have piled up.
  s.ticksPerPicture = ticksPerPicture(framesPerSecond);
  s.ticks = 0;
}

export function* Sketches(m) {
  m.mem.fill(0, WORKSPACE, WORKSPACE + WORKSPACE_BYTES);
  const s = {
    script: SCRIPT, count: SCRIPT_FIRST_COUNT, scene: 0, requested: -1, isFinished: false,
    spiralOffset: 0, spiralHold: 1, scroll: 0, ticks: 0, ticksPerPicture: ticksPerPicture(SCANNED_FRAMES_PER_SECOND),
    back: null, front: null, hasBuffers: false, frame: 0, frameCount: 0,
  };
  // $7047e: the copper waits for line $0c, then jumps through COP2LC, where the list raises the interrupt.
  m.cop1lc = COPPER_ENTRY;
  m.cop2lc = COPPER_BLANK;
  yield* waitInterrupt(m, s);
  custom(m, REG_COLOR00, 0);
  m.cop2lc = COPPER_DISPLAY;

  for (;;) {
    if (s.isFinished) {
      return;
    }
    if (s.requested > 0) {
      yield* openAnimation(m, s, r32(m, ANIMATIONS + (s.requested - 1) * 4));
      s.requested = -1;
      m.cop2lc = COPPER_DISPLAY;
      continue;
    }
    while (s.ticksPerPicture >= s.ticks) {
      yield* waitInterrupt(m, s);
    }
    s.ticks -= s.ticksPerPicture;
    if (s.back !== null) {
      // The script asks for the first animation one picture late; until then $70d1a finds nothing to unpack.
      unpackNextFrame(m, s);
    }
    [s.back, s.front] = [s.front, s.back];
    yield* waitInterrupt(m, s);
  }
}
