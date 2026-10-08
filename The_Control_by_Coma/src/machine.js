// The machine The Control runs on: the program's flat 32-bit memory, the VGA (mode 13h, and an unchained
// 320x400 mode), the DAC, and virtual time driven by the 30 Hz timer.
//
// Memory is one byte array. Address 0 is the start of the program's 32-bit segment (the PMODE "code32"
// segment, unpacked from CONTROL.EXE); the allocations the program makes at start-up follow it, in the same
// order, so pointers stored in memory and pointer arithmetic work as in the original.

export const TICKS_PER_SECOND = 1193182 / 39772;
const SEGMENT_SIZE = 0x80000;
const MEMORY_SIZE = 0x800000;
const PLANE_SIZE = 0x10000;
export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;
export const MODE_X_HEIGHT = 400;

/** 6-bit DAC value to 8 bits, rounded, as the reference recording (DOSBox) does it. */
export function dacTo8(v) {
  return Math.round(((v & 63) * 255) / 63);
}

export class Machine {
  constructor(segmentImage) {
    this.mem = new Uint8Array(MEMORY_SIZE);
    this.mem.set(segmentImage.subarray(0, SEGMENT_SIZE));
    this.view = new DataView(this.mem.buffer);
    this.heapTop = SEGMENT_SIZE;

    /** Mode 13h video memory: A000:0000, 64000 bytes, linear. */
    this.screen = new Uint8Array(PLANE_SIZE);
    /** Unchained mode: four planes of 64 KB, 80 bytes per row. */
    this.planes = [0, 1, 2, 3].map(() => new Uint8Array(PLANE_SIZE));
    this.mapMask = 0x0f;
    this.isModeX = false;
    this.crtcStart = 0;
    this.dac = new Uint8Array(768);
    this.dacMask = 0xff;

    /** The attribute controller's overscan colour (register 0x11). */
    this.borderColor = 0;
    /** The 80x25 text mode the demo exits to: 2000 (character, attribute) pairs, and the 8x16 ROM font. */
    this.isTextMode = false;
    this.textScreen = null;
    this.romFont = null;

    /** The selection register (edi) of the triangle's corner sort, kept between calls (triangle.js). */
    this.triangleSelectedCorner = 0;

    this.time = 0;
    this.isOver = false;
    /** Set by the browser when a frame threw, so it stops running this demo. */
    this.hasFailed = false;
  }

  // ---- memory ----

  u8(a) {
    return this.mem[a];
  }

  s8(a) {
    return (this.mem[a] << 24) >> 24;
  }

  u16(a) {
    return this.view.getUint16(a, true);
  }

  s32(a) {
    return this.view.getInt32(a, true);
  }

  u32(a) {
    return this.view.getUint32(a, true);
  }

  set8(a, v) {
    this.mem[a] = v;
  }

  set16(a, v) {
    this.view.setUint16(a, v & 0xffff, true);
  }

  set32(a, v) {
    this.view.setUint32(a, v >>> 0, true);
  }

  /** `add byte [a], v` (with carry in, as adc): returns the carry out. */
  addByte(a, v, carryIn = 0) {
    const sum = this.mem[a] + (v & 0xff) + carryIn;
    this.mem[a] = sum & 0xff;
    return sum > 0xff ? 1 : 0;
  }

  /** `sub byte [a], v` (with borrow in, as sbb): returns the borrow out. */
  subByte(a, v, borrowIn = 0) {
    const difference = this.mem[a] - (v & 0xff) - borrowIn;
    this.mem[a] = difference & 0xff;
    return difference < 0 ? 1 : 0;
  }

  /** The PMODE runtime's bump allocator (0x2b9): consecutive blocks after the segment. */
  alloc(size) {
    const address = this.heapTop;
    this.heapTop += size;
    return address;
  }

  /** A dword table of offsets relative to `base` turned into pointers (0x1b27d does this for the data files). */
  relocate(table, count, base) {
    for (let i = 0; i < count; i++) {
      this.set32(table + 4 * i, this.u32(table + 4 * i) + base);
    }
  }

  // ---- VGA ----

  /** int 10h ax=13h: mode 13h, video memory cleared, the default palette (only what the demo then overwrites matters). */
  setMode13() {
    this.isModeX = false;
    this.screen.fill(0);
    this.crtcStart = 0;
  }

  /** 0x54e0b: chain-4 off, no double scan (400 lines), all planes cleared. */
  setModeX() {
    this.isModeX = true;
    for (const plane of this.planes) {
      plane.fill(0);
    }
  }

  /** A byte written to A000:offset in the unchained mode, through the sequencer's map mask. */
  writePlanes(offset, value) {
    for (let p = 0; p < 4; p++) {
      if (this.mapMask & (1 << p)) {
        this.planes[p][offset & 0xffff] = value;
      }
    }
  }

  /** `out 3c8, first; rep outsb` from memory: `count` 6-bit components into the DAC. */
  dacLoad(first, address, count) {
    for (let i = 0; i < count; i++) {
      this.dac[first * 3 + i] = this.mem[address + i] & 63;
    }
  }

  /** DAC entries first..first+count-1 = a grey ramp 0..63 (main, 0x5277b, 0x55c6d ...). */
  dacGreyRamp(first) {
    for (let i = 0; i < 64; i++) {
      this.dac[(first + i) * 3] = i;
      this.dac[(first + i) * 3 + 1] = i;
      this.dac[(first + i) * 3 + 2] = i;
    }
  }
}
