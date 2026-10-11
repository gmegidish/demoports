// The machine the demo runs on: PMODE/W's flat 32-bit memory with the unpacked program, TOONTOWN.DAT, the VGA,
// the retrace counter and the music player's state.
//
// TOONTOWN.EXE is unpacked by pmw1.js with its program object at 0x100000 (PROGRAM_BASE), so an address in
// docs/disassembly (tools/re/work/toontown.lst) is an index into m.mem: m.u32(0x12bd84) is the retrace counter.
// The VGA window is at 0xa0000 in the same space, as under PMODE/W; parts write it through m.vga.
// malloc (0x114ee4) hands out blocks from HEAP_BASE up: the program never frees anything it uses again.
import { Vga } from './vga.js';
import { loadPmw1, PROGRAM_BASE } from './pmw1.js';

const MEMORY_SIZE = 0x800000;
const HEAP_BASE = 0x200000;
/** The program object's size in memory (code, data and bss). */
const PROGRAM_SIZE = 0x73570;
/** 0x100006, the timer's per-retrace callback, counts here: every retrace, and every second one. */
export const RETRACES = 0x12bd84;
export const HALF_RETRACES = 0x12bd88;
/** 0x100064 copies MIDASgetPlayStatus' position, pattern and row here. */
export const POSITION = 0x12bd70;
export const PATTERN = 0x12bd74;
export const ROW = 0x12bd78;
/** 0x1000ad, the music sync callback, counts the module's W01 commands here. */
export const SYNCS = 0x170614;

export { PROGRAM_BASE };

export class Machine {
  /**
   * @param {Uint8Array} exe TOONTOWN.EXE
   * @param {Uint8Array} dat TOONTOWN.DAT
   * @param {(retraces: number) => {position: number, pattern: number, row: number, syncs: number}} music
   *   the player's state after a number of retraces since the timer was installed
   */
  constructor(exe, dat, music, vga = new Vga()) {
    const { mem } = loadPmw1(exe, MEMORY_SIZE);
    this.mem = mem;
    this.view = new DataView(mem.buffer);
    this.dat = dat;
    this.music = music;
    this.vga = vga;
    this.heapTop = HEAP_BASE;
    /** The retrace callbacks are installed (MIDASsetTimerCallbacks, main 0x100840). */
    this.isTimerInstalled = false;
  }

  /** 0x100006 at every vertical retrace; the frame loop calls it. */
  timerInterrupt() {
    if (!this.isTimerInstalled) {
      return;
    }
    const retraces = this.u32(RETRACES) + 1;
    this.set32(RETRACES, retraces);
    if ((retraces & 1) === 0) {
      this.set32(HALF_RETRACES, this.u32(HALF_RETRACES) + 1);
    }
    this.retracesSinceInstall++;
    this.set32(SYNCS, this.syncBase + this.music(this.retracesSinceInstall).syncs);
  }

  installTimer() {
    this.isTimerInstalled = true;
    this.retracesSinceInstall = 0;
    this.syncBase = this.u32(SYNCS);
  }

  /** The sync counter is also reset by parts (0x106323); keep counting from what they wrote. */
  setSyncs(value) {
    this.syncBase = value - this.music(this.retracesSinceInstall).syncs;
    this.set32(SYNCS, value);
  }

  /** 0x100064: MIDASgetPlayStatus into the position, pattern and row globals. */
  readPlayStatus() {
    const { position, pattern, row } = this.music(this.retracesSinceInstall ?? 0);
    this.set32(POSITION, position);
    this.set32(PATTERN, pattern);
    this.set32(ROW, row);
  }

  /** 0x114ee4 malloc. */
  malloc(size) {
    const at = this.heapTop;
    this.heapTop = (this.heapTop + size + 15) & ~15;
    if (this.heapTop > MEMORY_SIZE) {
      throw new Error('out of memory');
    }
    return at;
  }

  /**
   * 0x10102c: decodes the PCX picture at `offset` in TOONTOWN.DAT into a new block, and its palette (6 bits per
   * component) to `palette`. Returns the block.
   */
  loadPcx(offset, palette) {
    const d = this.dat;
    const u16 = (o) => d[offset + o] | (d[offset + o + 1] << 8);
    if (d[offset] !== 0x0a || d[offset + 3] !== 8 || d[offset + 2] !== 1) {
      throw new Error(`no PCX at ${offset.toString(16)}`);
    }
    const width = u16(8) - u16(4) + 1;
    const lines = u16(10) - u16(6) + 1;
    const bytesPerLine = u16(0x42);
    const block = this.malloc(Math.max(width * lines, bytesPerLine * lines));
    let out = block;
    let i = offset + 0x80;
    for (let y = 0; y < lines; y++) {
      for (let x = 0; x < bytesPerLine;) {
        const b = d[i++];
        if ((b & 0xc0) === 0xc0) {
          const value = d[i++];
          for (let n = b & 0x3f; n > 0; n--, x++) {
            this.mem[out++] = value;
          }
        } else {
          this.mem[out++] = b;
          x++;
        }
      }
    }
    // the byte after the picture (the 0x0c marker), then 768 bytes over it
    for (let k = 0; k < 0x300; k++) {
      this.mem[palette + k] = d[i + 1 + k] >> 2;
    }
    return block;
  }

  /** Copies `size` bytes of TOONTOWN.DAT from `offset` to `to`. */
  readDat(offset, size, to) {
    this.mem.set(this.dat.subarray(offset, offset + size), to);
  }

  // ---- memory ----

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

  s32(a) {
    return this.view.getInt32(a, true);
  }

  f32(a) {
    return this.view.getFloat32(a, true);
  }

  f64(a) {
    return this.view.getFloat64(a, true);
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

  setF32(a, v) {
    this.view.setFloat32(a, v, true);
  }

  setF64(a, v) {
    this.view.setFloat64(a, v, true);
  }
}

/** The program's memory ends here; checks that nothing is mapped over it. */
export const PROGRAM_END = PROGRAM_BASE + PROGRAM_SIZE;

/**
 * 0x100056: waits until the retrace counter changes, i.e. for the next retrace. In a part: `yield* waitRetrace(m)`.
 */
export function* waitRetrace(m) {
  const seen = m.u32(RETRACES);
  while (m.u32(RETRACES) === seen) {
    yield;
  }
}

/** 0x100bcc: copies 64000 bytes (one mode 13h screen) from `from` to the VGA at 0xa0000 (or to memory). */
export function copyToScreen(m, from, to = 0xa0000, size = 0xfa00) {
  if (to === 0xa0000) {
    for (let i = 0; i < size; i++) {
      m.vga.write(i, m.mem[from + i]);
    }
  } else {
    m.mem.copyWithin(to, from, from + size);
  }
}

/** 0x100a1e: the whole DAC from 768 bytes at `from`. */
export function setPalette(m, from) {
  m.vga.out8(0x3c8, 0);
  for (let i = 0; i < 0x300; i++) {
    m.vga.out8(0x3c9, m.mem[from + i]);
  }
}
