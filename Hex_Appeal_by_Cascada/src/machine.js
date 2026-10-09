// The machine a part runs on: its real-mode memory, the VGA, and the music system's int 0x80 services.
//
// Memory is one megabyte, addressed linearly (segment * 16 + offset). A part's image is loaded at segment 0,
// exactly as in the listings (tools/re/hdis.py): the address `180d:0f37` in the notes is m.mem[0x180d0 + 0xf37].
// Memory a part allocates from DOS comes after its image (allocParagraphs). The VGA and the music carry over
// from one part to the next; the memory does not.
import { Vga } from './vga.js';
import { musicPosition } from './music.js';

const MEMORY_SIZE = 0x110000;
const SCAN_CODE_ESCAPE = 1;

/** A far pointer seg:off as a linear address. */
export function linear(segment, offset) {
  return segment * 16 + offset;
}

export class Machine {
  constructor(vga = new Vga()) {
    this.mem = new Uint8Array(MEMORY_SIZE);
    this.view = new DataView(this.mem.buffer);
    this.vga = vga;
    /** The first free paragraph for allocParagraphs. */
    this.freeSegment = 0;

    /** int 0x80 state: the frame counter (fn 0x19/0x1a), the per-retrace callback (fn 0x1b/0x1c), master volume (fn 9). */
    this.frameCounter = 0;
    this.callback = null;
    this.volume = 64;
    /** Song time in seconds at the current retrace (set by the frame loop, demo.js). */
    this.songSeconds = 0;
    /** Port 0x60: the keyboard IRQ is masked for the whole demo; parts poll for ESC. The port never sends ESC. */
    this.scanCode = 0;
    /** The part's int 21h/4Ch code: 1 (ESC) ends the demo. */
    this.exitCode = 0;
  }

  /** Copies a part's image to segment 0; allocations start at the next paragraph. */
  loadImage(image) {
    this.mem.set(image);
    this.freeSegment = (image.length + 15) >> 4;
  }

  /** int 21h ah=48h: `paragraphs` of memory, returns the segment. Zeroed here; DOS leaves whatever was there. */
  allocParagraphs(paragraphs) {
    const segment = this.freeSegment;
    this.freeSegment += paragraphs;
    return segment;
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

  // ---- int 0x80, the music system (exe0 0c00:3067; docs/disassembly/H0_loader_music.md) ----

  /** fn 0x0a: the pattern-order index + 1 (0 before the first row). */
  musicOrder() {
    return musicPosition(this.songSeconds).order + 1;
  }

  /** fn 0x0c: the row + 1. */
  musicRow() {
    return musicPosition(this.songSeconds).row + 1;
  }

  /** fn 0x1d called twice around a mode set: the frame loop moves the song back by the pause (demo.js). */
  pauseMusic() {}

  /** `in al, 60h`. */
  readKeyboard() {
    return this.scanCode;
  }

  get isEscapePressed() {
    return this.scanCode === SCAN_CODE_ESCAPE;
  }
}
