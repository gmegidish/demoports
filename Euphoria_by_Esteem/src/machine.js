// The parts of the PC the demo touches: video memory and the VGA DAC, the "pages" of the graphics
// unit (segment 186a), the 100 Hz timer (unit 1cbc) and the Borland RTL's Random.
//
// Time is virtual. A part is a generator; it yields the machine time (seconds) it waits for, and the
// driver advances `time` to that value. Nothing reads the wall clock, so a run is reproducible.

export const TICKS_PER_SECOND = 100;
export const PAGE_SIZE = 64000;
/** Pages are addressed with 16-bit offsets: keep a whole segment so wrapped reads stay in bounds. */
const SEGMENT_SIZE = 0x10000;
const VIDEO_MEMORY_SIZE = 0x100000;

/** Video modes of the graphics unit, DS:2522 (mode numbers) and DS:252c (sizes). */
export const VIDEO_MODES = [
  { number: 0x13, width: 320, height: 200 },
  { number: 0x100, width: 640, height: 400 },
  { number: 0x101, width: 640, height: 480 },
  { number: 0x103, width: 800, height: 600 },
  { number: 0x105, width: 1024, height: 768 },
];

/** Bank of VESA "page 1" (DS:2540) and its display start (DS:254a, DS:2554), per mode. */
const VESA_PAGE1_BANK = [0, 3, 5, 7, 8];
const VESA_PAGE1_START_X = [0, 0, 0, 355, 0];
const VESA_PAGE1_START_Y = [0, 0, 512, 573, 512];

export class Machine {
  constructor() {
    this.time = 0;
    this.vram = new Uint8Array(VIDEO_MEMORY_SIZE);
    /** What the DAC shows, 6-bit, clamped. */
    this.dac = new Uint8Array(768);
    /** The graphics unit's shadow palette (DS:5d98): unclamped int16 r, g, b. */
    this.palette = new Int16Array(768);
    this.isPaletteLocked = false;

    this.modeIndex = 0;
    this.isTextMode = false;
    this.width = 320;
    this.height = 200;
    this.centerX = 160;
    this.centerY = 100;
    this.clip = { left: 0, top: 0, right: 319, bottom: 199 };
    this.bank = 0;
    this.drawBankOffset = 0;
    this.isVesaFlipped = false;
    this.displayStart = 0;

    this.pages = new Map();
    this.pages.set(0, this.vram.subarray(0, SEGMENT_SIZE));
    this.activePageNumber = 0;
    this.active = this.pages.get(0);

    this.randSeed = 0;
    this.textScreen = null;

    /** DS:9118: per-pixel step of the gradient span (8.8), and the streak length of the stars. */
    this.gradStep = 1;
    /** The high word of EDI in the gouraud span (186a:2084): never initialised, carries over. */
    this.gouraudFraction = 0;
    /** DS:90bc: the lighting table, 0..90 degrees (186a:26a6). */
    this.litTable = new Uint8Array(91);
    /** DS:2472 / DS:2473: the phases of the wobble (179b:060b), 0xbe at start. */
    this.wobblePhases = { ph1: 0xbe, ph2: 0xbe };
  }

  /**
   * A lighting-table read. Indices past 90 read the variables that follow the table in the data
   * segment: a byte, gradStep (DS:9118), the span hook far pointer (186a:1689) and the texture pointer.
   */
  litTableAt(index) {
    if (index <= 90) {
      return this.litTable[index];
    }
    const tail = [0, this.gradStep & 0xff, this.gradStep >> 8, 0x89, 0x16];
    return tail[index - 91] ?? 0;
  }

  get ticks() {
    return Math.floor(this.time * TICKS_PER_SECOND + 1e-9);
  }

  /** Machine time of a 100 Hz tick. */
  tickTime(tick) {
    return tick / TICKS_PER_SECOND;
  }

  // ---- palette (186a:0419, 047d, 04b4, 04be) ----

  setColor(index, r, g, b) {
    if (!this.isPaletteLocked) {
      this.dac[index * 3] = clamp6(r);
      this.dac[index * 3 + 1] = clamp6(g);
      this.dac[index * 3 + 2] = clamp6(b);
    }
    this.palette[index * 3] = r;
    this.palette[index * 3 + 1] = g;
    this.palette[index * 3 + 2] = b;
  }

  lockPalette() {
    this.isPaletteLocked = true;
  }

  unlockPalette() {
    this.isPaletteLocked = false;
    this.setPalette(this.palette.slice());
  }

  /** 186a:04d1: all 256 entries from an array of int16 r, g, b. */
  setPalette(palette) {
    this.setPaletteRange(0, 255, palette);
  }

  /** 186a:053b */
  setPaletteRange(first, last, palette) {
    for (let i = first; i <= last; i++) {
      this.setColor(i, palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]);
    }
  }

  // ---- video modes (186a:01a7, 0229) ----

  /**
   * 186a:01a7 (and 0229 with `keepMemory`). Setting mode 13h clears only the VGA window, so a picture
   * left in VESA memory above it survives (part 143e relies on that).
   */
  setMode(index, { keepMemory = false } = {}) {
    const mode = VIDEO_MODES[index];
    if (!keepMemory) {
      this.vram.fill(0, 0, index === 0 ? SEGMENT_SIZE : VIDEO_MEMORY_SIZE);
    }
    this.modeIndex = index;
    this.isTextMode = false;
    this.width = mode.width;
    this.height = mode.height;
    this.centerX = mode.width >> 1;
    this.centerY = mode.height >> 1;
    this.setClip(0, 0, mode.width - 1, mode.height - 1);
    this.displayStart = 0;
    this.isVesaFlipped = false;
    this.drawBankOffset = 0;
    this.setBank(0);
  }

  setTextMode() {
    this.isTextMode = true;
  }

  /** 186a:02f3, all edges inclusive. */
  setClip(left, top, right, bottom) {
    this.clip = { left, top, right, bottom };
  }

  // ---- VESA banking (186a:1b75, 1bc5, 1c24, 1c3b) ----

  setBank(n) {
    this.bank = (n + this.drawBankOffset) & 0xff;
    const page0 = this.vram.subarray(this.bank * SEGMENT_SIZE, this.bank * SEGMENT_SIZE + SEGMENT_SIZE);
    this.pages.set(0, page0);
    if (this.activePageNumber === 0) {
      this.active = page0;
    }
  }

  vesaFlip() {
    this.isVesaFlipped = !this.isVesaFlipped;
    if (this.isVesaFlipped) {
      this.drawBankOffset = VESA_PAGE1_BANK[this.modeIndex];
      this.displayStart = 0;
    } else {
      this.drawBankOffset = 0;
      this.displayStart = VESA_PAGE1_START_Y[this.modeIndex] * this.width + VESA_PAGE1_START_X[this.modeIndex];
    }
    this.setBank(0);
  }

  vesaResetFlip() {
    this.isVesaFlipped = false;
    this.drawBankOffset = 0;
    this.displayStart = 0;
  }

  // ---- pages (186a:0f42 .. 14f3) ----

  getPage(n) {
    return this.pages.get(n) ?? null;
  }

  /** 186a:10e5: a page that does not exist yet is allocated and filled with 0. */
  setActivePage(n) {
    if (!this.pages.has(n)) {
      this.pages.set(n, new Uint8Array(SEGMENT_SIZE));
    }
    this.activePageNumber = n;
    this.active = this.pages.get(n);
  }

  freePage(n) {
    if (n === 0 || !this.pages.has(n)) {
      return;
    }
    if (n === this.activePageNumber) {
      this.setActivePage(0);
    }
    this.pages.delete(n);
  }

  /** 186a:121e */
  copyPage(src, dst) {
    this.requirePage(dst).set(this.requirePage(src).subarray(0, PAGE_SIZE));
  }

  /** 186a:131a: colour 0 is transparent. */
  copyPageTransparent(src, dst) {
    const from = this.requirePage(src);
    const to = this.requirePage(dst);
    for (let i = 0; i < PAGE_SIZE; i++) {
      if (from[i] !== 0) {
        to[i] = from[i];
      }
    }
  }

  requirePage(n) {
    const page = this.getPage(n);
    if (!page) {
      throw new Error(`Page ${n} is not exist.`);
    }
    return page;
  }

  /** 186a:144f / 148d */
  fillActive(color) {
    this.active.fill(color, 0, PAGE_SIZE);
  }

  /** 186a:14d1: the active page to A000:0000, 64000 bytes, no retrace wait. */
  present() {
    this.pages.get(0).set(this.active.subarray(0, PAGE_SIZE));
  }

  // ---- Borland Pascal RTL Random (1d81:46d4, 4677) ----

  nextRandom() {
    this.randSeed = (Math.imul(this.randSeed, 0x08088405) + 1) >>> 0;
    return this.randSeed;
  }

  /** Random(n): high 32 bits of seed*n. */
  random(n) {
    const seed = this.nextRandom();
    return Math.floor((seed * (n & 0xffff)) / 0x100000000);
  }
}

function clamp6(v) {
  return v < 0 ? 0 : v > 63 ? 63 : v;
}

export const f32 = Math.fround;

/** x87 rounding in the default mode: to nearest, ties to even (frndint, fistp, the RTL's Round). */
export function roundHalfEven(x) {
  const r = Math.round(x);
  if (Math.abs(x % 1) === 0.5 && r % 2 !== 0) {
    return r - 1;
  }
  return r;
}

/** A value rounded to Real48, Turbo Pascal's 6-byte real: 40 significant bits, ties to even. */
export function real48(x) {
  if (x === 0 || !Number.isFinite(x)) {
    return x;
  }
  const exponent = Math.floor(Math.log2(Math.abs(x)));
  const scale = 2 ** (39 - exponent);
  return roundHalfEven(x * scale) / scale;
}

/** Low 16 bits as a signed int16. */
export function int16(v) {
  return (v << 16) >> 16;
}
