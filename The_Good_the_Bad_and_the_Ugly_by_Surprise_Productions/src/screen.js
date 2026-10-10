// What the monitor shows, from the VGA registers: the CRTC start address, row offset, line compare and lines per
// row, the attribute controller's pel panning and colour mode, and the DAC. 256-colour modes (mode 13h and its
// unchained variants) read plane x & 3 at offset x >> 2; the 16-colour mode (exe4's 640x400) combines one bit of
// each plane. The text mode the demo exits to is 720x400: 9-dot cells of the 8x16 ROM font.
const PLANE_MASK = 0xffff;
/** Sequencer register 1 bit 5: the screen is blanked (0299:0076 sets it while it writes the DAC). */
const SCREEN_OFF = 0x20;
/** CRTC register 9 bit 7: double scan. */
const DOUBLE_SCAN = 0x80;
/** Sequencer register 1 bit 3: dot clock / 2. */
const DOT_CLOCK_HALF = 0x08;

/** 6-bit DAC value to 8 bits, rounded, as the reference recording (DOSBox) does it. */
export function dacTo8(v) {
  return Math.round(((v & 63) * 255) / 63);
}

function paletteColours(vga) {
  const colours = new Uint32Array(256);
  const dac = vga.dac;
  for (let i = 0; i < 256; i++) {
    const index = (i & vga.dacMask) * 3;
    colours[i] = 0xff000000 | (dacTo8(dac[index + 2]) << 16) | (dacTo8(dac[index + 1]) << 8) | dacTo8(dac[index]);
  }
  return colours;
}

/**
 * The scan of one frame: rows are drawn top to bottom from the registers as they are when the row is drawn. A whole
 * frame is drawn at once (renderFrame), or row by row as the beam passes (vga.js, for the raster effects that
 * rewrite registers or video memory between scanlines).
 */
export class FrameScan {
  constructor(vga) {
    this.vga = vga;
    // Sequencer clocking mode bit 3 halves the dot clock: 320 pixels (0299:01cc's EGA planar mode).
    this.width = vga.is256Colours || (vga.sequencer[1] & DOT_CLOCK_HALF) ? 320 : 640;
    // Output lines, as DOSBox draws and captures them: a double-scanned mode (CRTC 9 bit 7) draws one line per two
    // scanlines; so does a mode whose row is an even number of scanlines (mode 13h's max scan line 1). A row of
    // video memory then covers `linesPerRow` output lines (2 in the plasmas' 4-scanline rows, 1 elsewhere).
    const scanlinesPerRow = vga.linesPerRow;
    const isDoubleScan = (vga.crtc[9] & DOUBLE_SCAN) !== 0;
    // A 256-colour mode whose row is an odd number (> 1) of scanlines (the intro's stretch, CRTC 9 = 42h..5fh) keeps
    // DOSBox's two scanlines per output line: DOSBox does not resize for those writes (G2). In a 256-colour mode
    // with two scanlines per line, rows end by counting scanlines against the live maximum scan line, so a CRTC 9
    // write between hblank waits takes effect from that line (identical to linesPerRow when it does not change).
    const isOddStretch = vga.is256Colours && scanlinesPerRow > 1 && scanlinesPerRow % 2 === 1;
    this.scanlinesPerLine = isDoubleScan || scanlinesPerRow % 2 === 0 || isOddStretch ? 2 : 1;
    this.isCountingScanlines = vga.is256Colours && this.scanlinesPerLine === 2;
    this.scanlineInRow = 0;
    this.linesPerRow = Math.max(1, Math.floor(scanlinesPerRow / this.scanlinesPerLine));
    this.height = Math.floor(vga.displayedLines / this.scanlinesPerLine);
    this.rgba = new Uint8ClampedArray(this.width * this.height * 4);
    this.pixels = new Uint32Array(this.rgba.buffer);
    this.linesDrawn = 0;
    this.lineInRow = 0;
    this.address = vga.latchedStart;
    this.isPastCompare = false;
    this.colours = null;
  }

  /** Draws whole rows of video memory up to (not including) `endRow`. */
  drawRowsTo(endRow, isPaletteChanged = true) {
    this.drawLinesTo(endRow * this.linesPerRow, isPaletteChanged);
  }

  /**
   * Draws output lines up to (not including) `endLine`, each from the registers as they are now; the row address
   * advances by the offset register after the last line of a row. `isPaletteChanged` recomputes the DAC colours.
   */
  drawLinesTo(endLine, isPaletteChanged = true) {
    const vga = this.vga;
    const last = Math.min(endLine, this.height);
    if (this.linesDrawn >= last) {
      return;
    }
    if (isPaletteChanged || this.colours === null) {
      this.colours = paletteColours(vga);
    }
    for (let line = this.linesDrawn; line < last; line++) {
      // DOSBox (vga_draw.cpp): split_line = (line_compare + 1) / lines_scaled; the split starts at that output line.
      if (!this.isPastCompare && line >= Math.floor((vga.lineCompare + 1) / this.scanlinesPerLine)) {
        this.isPastCompare = true;
        this.address = 0;
        this.lineInRow = 0;
        this.scanlineInRow = 0;
      }
      if ((vga.sequencer[1] & SCREEN_OFF) || vga.isAttributeBlanked) {
        this.pixels.fill(0xff000000, line * this.width, (line + 1) * this.width);
      } else if (vga.is256Colours) {
        this.drawRow256(line);
      } else {
        this.drawRow16(line);
      }
      if (this.isCountingScanlines) {
        const scanlinesPerRow = vga.linesPerRow;
        for (let scanline = 0; scanline < this.scanlinesPerLine; scanline++) {
          this.scanlineInRow++;
          if (this.scanlineInRow >= scanlinesPerRow) {
            this.scanlineInRow = 0;
            this.address = (this.address + vga.rowBytes) & PLANE_MASK;
          }
        }
        continue;
      }
      this.lineInRow++;
      if (this.lineInRow >= this.linesPerRow) {
        this.lineInRow = 0;
        this.address = (this.address + vga.rowBytes) & PLANE_MASK;
      }
    }
    this.linesDrawn = last;
  }

  drawRow256(row) {
    const { vga, colours, pixels, width } = this;
    const shift = this.isPastCompare ? 0 : (vga.latchedPanning >> 1) & 3;
    const at = row * width;
    for (let x = 0; x < width; x++) {
      const px = x + shift;
      pixels[at + x] = colours[vga.planes[px & 3][(this.address + (px >> 2)) & PLANE_MASK]];
    }
  }

  /** 16 colours: attribute palette, then the colour select register (0x14) and P54S (mode control bit 7). */
  drawRow16(row) {
    const { vga, colours, pixels, width } = this;
    const [p0, p1, p2, p3] = vga.planes;
    const attribute = vga.attribute;
    const colourSelect = attribute[0x14];
    const isP54S = (attribute[0x10] & 0x80) !== 0;
    const high = (colourSelect & 0x0c) << 4;
    const at = row * width;
    // Pel panning (attribute 13h, latched at the retrace) shifts the row left by 0..7 pixels.
    const panning = this.isPastCompare ? 0 : vga.latchedPanning & 7;
    for (let x = 0; x < width; x++) {
      const px = x + panning;
      const offset = (this.address + (px >> 3)) & PLANE_MASK;
      const bit = 7 - (px & 7);
      const index = ((p0[offset] >> bit) & 1) | (((p1[offset] >> bit) & 1) << 1) | (((p2[offset] >> bit) & 1) << 2) | (((p3[offset] >> bit) & 1) << 3);
      const entry = attribute[index & attribute[0x12]] & 0x3f;
      const dac = isP54S ? high | ((colourSelect & 3) << 4) | (entry & 0x0f) : high | entry;
      pixels[at + x] = colours[dac];
    }
  }

  get frame() {
    return { width: this.width, height: this.height, rgba: this.rgba };
  }
}

const TEXT_COLUMNS = 80;
const TEXT_ROWS = 25;
const CELL_WIDTH = 9;
const CELL_HEIGHT = 16;
/** Line-drawing characters c0..df repeat their eighth dot in the ninth column. */
const isLineGraphic = (character) => character >= 0xc0 && character <= 0xdf;

/** Mode 3: attribute bits 0-3 foreground, 4-6 background (bit 7 = blink, not shown blinking). */
function renderText(vga, colours) {
  const width = TEXT_COLUMNS * CELL_WIDTH;
  const height = TEXT_ROWS * CELL_HEIGHT;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const pixels = new Uint32Array(rgba.buffer);
  const colourOf = (index) => colours[vga.attribute[index & 15] & 0x3f];
  for (let row = 0; row < TEXT_ROWS; row++) {
    for (let column = 0; column < TEXT_COLUMNS; column++) {
      const cell = (row * TEXT_COLUMNS + column) * 2;
      const character = vga.textScreen[cell];
      const attribute = vga.textScreen[cell + 1];
      const foreground = colourOf(attribute);
      const background = colourOf((attribute >> 4) & 7);
      for (let line = 0; line < CELL_HEIGHT; line++) {
        const bits = vga.font[character * CELL_HEIGHT + line];
        const ninth = isLineGraphic(character) ? bits & 1 : 0;
        const at = (row * CELL_HEIGHT + line) * width + column * CELL_WIDTH;
        for (let dot = 0; dot < 8; dot++) {
          pixels[at + dot] = (bits >> (7 - dot)) & 1 ? foreground : background;
        }
        pixels[at + 8] = ninth ? foreground : background;
      }
    }
  }
  return { width, height, rgba };
}

/** { width, height, rgba }. */
export function renderFrame(vga) {
  const colours = paletteColours(vga);
  if (vga.isTextMode) {
    return renderText(vga, colours);
  }
  if (vga.beamScan) {
    // A raster frame in progress: the code has run until its next retrace wait, so the rows not drawn yet show
    // the registers as they are now, which is what beginFrame would draw them with.
    vga.beamScan.drawRowsTo(vga.beamScan.height);
    return vga.beamScan.frame;
  }
  const scan = new FrameScan(vga);
  scan.drawRowsTo(scan.height);
  return scan.frame;
}

export class Screen {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
  }

  present(frame) {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.canvas.width = frame.width;
      this.canvas.height = frame.height;
    }
    this.context.putImageData(new ImageData(frame.rgba, frame.width, frame.height), 0, 0);
  }
}
