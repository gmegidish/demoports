// The beam clock of the parallax bars (0777:0829). Unlike the other loops of module 0777, the bars loop is not
// locked to the frame: it waits "until 3da bit 0 = 1" before each bar and "while bit 0 = 1" after it, and in DOSBox
// (the reference recording) display enable still pulses on line 400, the vertical blank holding bit 0 at 1 only
// from line 401. A loop pass (200 iterations, the music tick, the frame code) therefore takes 399 horizontal blanks
// plus the vertical blank: about one line less than a frame. During the palette fade (whose DAC upload with the
// screen off costs about a line) the loop stays locked; afterwards the bars roll up the screen by about a line per
// frame, the music ticks that start notes costing half a line per note. This clock follows the beam in scanlines,
// maps every register or video memory access of the loop to the scanline it shows from (vga.hblank) and yields at
// each vertical retrace. Costs fitted to the recording (exact for frames 13879..14407).
// docs/disassembly/G5_chesszoom_bars_eb3.md, "Part B".

const FRAME_LINES = 449;
const DISPLAY_LINES = 400;
/** The retrace (CRTC 10h = 19ch): the frame loop's yield point. */
const RETRACE_LINE = 412;
/** Within a scanline: display until this fraction, horizontal blank (3da bit 0 = 1) after. */
const HBLANK_START = 0.8;
/**
 * 3da bit 0 stays 1 without horizontal pulses from line 401 to the end of the frame (DOSBox: the vertical blank
 * starts one line after the last displayed line 399): t in [401, 412) before the retrace, [-37, 0) after it.
 */
const BLANK_FROM = DISPLAY_LINES + 1;
const INPUT_STATUS = 0x3da;
/**
 * DOSBox draws line L half way through the display of line L + 1: a write until then still shows on line L (the
 * measured rule of module 0777: a write after w hblank waits shows from scanline w - 1).
 */
const DRAW_DELAY = 0.5;
/** A wait for display enable that waited through the vertical blank returns this far into line 0. */
const DISPLAY_RESUME = 0.4;

/** Time costs in scanlines (fitted to the recording, frames 13879..14968). */
export const BEAM_COSTS = {
  /** One bar byte group (latch read and 3 or 4 port writes and memory writes). */
  barDraw: 0.1,
  /** 0777:0269, 0659 and 0249 after the loop. */
  loopEnd: 0.3,
  /** 008e:1f63 on a tick that reads no row. */
  music: 0.2,
  /** Extra per note started by a tick that reads a row. */
  perNote: 0.5,
  /** 0777:07b1's two DAC uploads while the fade runs. */
  fade: 1.0,
};

/** Lines 401..448 (before the retrace: 401..411; after it, -37..-1). */
function isVerticalBlank(line) {
  return line < 0 || line >= BLANK_FROM;
}

/** The cost of the next 008e:1f63 call: a tick that reads a row costs more for each note it starts. */
export function musicTickCost(m) {
  const song = m.song;
  if (song !== null && song.tickInRow === 0) {
    return BEAM_COSTS.music + BEAM_COSTS.perNote * song.notesInNextRow();
  }
  return BEAM_COSTS.music;
}

/** A music tick that outlasts the time DOSBox takes to draw the line after the last hblank wait (line 399). */
export function isMusicTickSlow(m) {
  return musicTickCost(m) >= DRAW_DELAY;
}

export class BeamClock {
  /**
   * @param {import('../vga.js').Vga} vga
   * @param {number} time scanlines since the top of the current frame's display
   */
  constructor(vga, time) {
    this.vga = vga;
    this.time = time;
  }

  /** Makes the beam model draw the lines this moment has passed, before a register or memory access. */
  mark() {
    const vga = this.vga;
    const line = Math.floor(this.time - DRAW_DELAY);
    if (line < 0) {
      return;
    }
    const target = Math.min(line, DISPLAY_LINES) + 1;
    if (vga.hblankWaits < target) {
      vga.hblank(target - vga.hblankWaits);
    }
  }

  /** Time passes; yields at each vertical retrace crossed. */
  *spend(lines) {
    this.time += lines;
    yield* this.settle();
  }

  *settle() {
    while (this.time >= RETRACE_LINE) {
      this.mark();
      yield;
      this.time -= FRAME_LINES;
    }
  }

  /** Wait until 3da bit 0 = 1 (a horizontal blank, or the vertical blank). */
  *waitBlank() {
    this.vga.in8(INPUT_STATUS);
    const line = Math.floor(this.time);
    if (isVerticalBlank(line) || this.time - line >= HBLANK_START) {
      return;
    }
    this.time = line + HBLANK_START;
    yield* this.settle();
  }

  /** Wait while 3da bit 0 = 1 (until display). */
  *waitDisplay() {
    this.vga.in8(INPUT_STATUS);
    const line = Math.floor(this.time);
    if (isVerticalBlank(line)) {
      yield* this.untilDisplay();
      return;
    }
    if (this.time - line < HBLANK_START) {
      return;
    }
    if (isVerticalBlank(line + 1)) {
      yield* this.untilDisplay();
      return;
    }
    this.time = line + 1;
    yield* this.settle();
  }

  /** Through the vertical blank to line 0 of the next frame. */
  *untilDisplay() {
    if (this.time >= 0) {
      this.time = RETRACE_LINE;
      yield* this.settle();
    }
    this.time = DISPLAY_RESUME;
  }
}
