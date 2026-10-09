// The machine the demo runs on: one megabyte of real-mode memory with the unpacked program at segment 0, DOS
// memory blocks for the resources, the VGA, and the timer's frame counter.
//
// Memory is addressed linearly (segment * 16 + offset). GBU.EXE is unpacked and rebased to segment 0 (mylz.js), so
// the address `08d8:275d` in docs/disassembly is m.mem[0x8d80 + 0x275d]. Tables, variables and self-modified
// immediates stay at their original addresses. Unlike a set of separate programs, the whole demo is one program:
// the memory lives from the first effect to the last.
import { Vga } from './vga.js';

const MEMORY_SIZE = 0x110000;
/** The first paragraph DOS hands out: after the image (0x13b9 paragraphs) and its stack (13b9:0100). */
const FIRST_FREE_SEGMENT = 0x13d0;
/** The end of conventional memory (a000:0000). */
const LAST_SEGMENT = 0xa000;
/** 0731:0004, the timer IRQ's frame counter (0731:007a increments it at every vertical retrace). */
export const FRAME_COUNTER = 0x7314;
/** PIT input clock / 17045 (0731:0120 programs 1234dch / 70). */
const MUSIC_TIMER_HZ = 1193182 / 17045;
/** 25.175 MHz / 800 dots / 449 lines: every mode of the demo. */
const RETRACE_HZ = 25175000 / 800 / 449;
/** Where the 70.002 Hz music timer starts in its period relative to the retrace (any value in [0.0012, 1) ticks at the next retrace). */
const MUSIC_TIMER_FIRST_PHASE = 0.5;

/** A far pointer seg:off as a linear address. */
export function linear(segment, offset) {
  return segment * 16 + offset;
}

export class Machine {
  /**
   * @param {Uint8Array} image the unpacked program, rebased to segment 0
   * @param {Map<string, Uint8Array>} resources the named resources appended to GBU.EXE
   */
  constructor(image, resources, vga = new Vga()) {
    this.mem = new Uint8Array(MEMORY_SIZE);
    this.view = new DataView(this.mem.buffer);
    this.mem.set(image);
    this.resources = resources;
    this.vga = vga;
    /** DOS memory blocks in use: segment -> paragraphs. */
    this.blocks = new Map();
    /**
     * The timer (module 0731): 'retrace' (0731:013c, the IRQ at each retrace increments the frame counter and
     * ticks the music), 'music' (0731:0120, the IRQ only ticks the music), 'bios' (0731:0158, the BIOS timer: the
     * effects tick the music themselves with tickMusic()).
     */
    this.timerMode = 'bios';
    this.musicTimerPhase = 0;
    /** The silent MOD sequencer (song.js): position and the 8xx sync counter the effects wait on. */
    this.song = null;
  }

  /** 0731:013c / 0731:0120 / 0731:0158. */
  setTimer(mode) {
    if (mode === 'music' && this.timerMode !== 'music') {
      // 0731:0120 starts the 70.002 Hz PIT at a retrace start: its first IRQ comes one period later, 17 us after
      // the next retrace, so the next frame gets a tick (the recording's audio loses none there, G1 notes).
      this.musicTimerPhase = MUSIC_TIMER_FIRST_PHASE;
    }
    this.timerMode = mode;
  }

  /** 008e:1f63 called directly: one tick of the music player. */
  tickMusic() {
    if (this.song) {
      this.song.tick();
    }
  }

  /** 008e:18a4: the music sync counter (008e:11cc), incremented by each 8xx effect in the song. */
  get musicSync() {
    return this.song ? this.song.syncCounter : 0;
  }

  /** What the timer IRQ does at a vertical retrace (0731:007a / 0731:00f0); the frame loop calls it. */
  timerInterrupt() {
    if (this.timerMode === 'retrace') {
      // 0731:007a polls 3da for the retrace, which also resets the attribute controller's flip-flop: the 08d8
      // effects rely on it, writing Color Select with a bare `out 3c0` pair right after a tick.
      this.vga.in8(0x3da);
      this.frameCounter = (this.frameCounter + 1) & 0xffff;
    }
    if (this.timerMode === 'retrace') {
      this.tickMusic();
    }
    if (this.timerMode === 'music') {
      // 0731:0120 runs the PIT at 70.002 Hz, not synced to the 70.086 Hz retrace: now and then a frame gets no tick.
      this.musicTimerPhase += MUSIC_TIMER_HZ / RETRACE_HZ;
      while (this.musicTimerPhase >= 1) {
        this.musicTimerPhase -= 1;
        this.tickMusic();
      }
    }
  }

  // ---- DOS memory (int 21h 48h/49h) ----

  /** int 21h ah=48h, first fit. The block keeps whatever an earlier block left there, as under DOS. */
  allocParagraphs(paragraphs) {
    let segment = FIRST_FREE_SEGMENT;
    const used = [...this.blocks].sort((a, b) => a[0] - b[0]);
    for (const [start, size] of used) {
      if (segment + paragraphs <= start) {
        break;
      }
      segment = Math.max(segment, start + size + 1);
    }
    if (segment + paragraphs > LAST_SEGMENT) {
      throw new Error(`out of memory allocating ${paragraphs} paragraphs`);
    }
    this.blocks.set(segment, paragraphs);
    return segment;
  }

  /** int 21h ah=49h. */
  free(segment) {
    this.blocks.delete(segment);
  }

  /** 008e:04b3: loads the resource named by the 8 bytes at `nameAddress` into a new block; its segment goes to `pointerAddress`. */
  loadResource(nameAddress, pointerAddress) {
    const name = String.fromCharCode(...this.mem.subarray(nameAddress, nameAddress + 8)).trimEnd();
    const data = this.resources.get(name);
    if (!data) {
      throw new Error(`no resource '${name}'`);
    }
    const segment = this.allocParagraphs((data.length >> 4) + 1);
    this.mem.set(data, linear(segment, 0));
    this.set16(pointerAddress, segment);
    return segment;
  }

  /** 008e:0014: allocates `paragraphs` and stores the segment at `pointerAddress`. */
  allocTo(pointerAddress, paragraphs) {
    const segment = this.allocParagraphs(paragraphs);
    this.set16(pointerAddress, segment);
    return segment;
  }

  /** 008e:0063: frees the block whose segment is stored at `pointerAddress`. */
  freeFrom(pointerAddress) {
    this.free(this.u16(pointerAddress));
  }

  // ---- the timer ----

  get frameCounter() {
    return this.u16(FRAME_COUNTER);
  }

  set frameCounter(value) {
    this.set16(FRAME_COUNTER, value);
  }

  // ---- memory, linear addresses ----

  u8(a) {
    return this.mem[a];
  }

  s8(a) {
    return (this.mem[a] << 24) >> 24;
  }

  u16(a) {
    return this.mem[a] | (this.mem[a + 1] << 8);
  }

  s16(a) {
    return (this.u16(a) << 16) >> 16;
  }

  u32(a) {
    return this.view.getUint32(a, true);
  }

  set8(a, v) {
    this.mem[a] = v;
  }

  set16(a, v) {
    this.mem[a] = v;
    this.mem[a + 1] = v >> 8;
  }

  set32(a, v) {
    this.view.setUint32(a, v >>> 0, true);
  }
}

/**
 * 0731:00a3: clears the frame counter and waits for the timer IRQ to set it again — the next vertical retrace.
 * In a part: `yield* waitTick(m)`.
 */
export function* waitTick(m) {
  m.frameCounter = 0;
  while (m.frameCounter === 0) {
    yield;
  }
}
