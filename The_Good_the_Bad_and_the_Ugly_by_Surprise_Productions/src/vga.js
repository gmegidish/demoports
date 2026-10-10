// The VGA, at register level: four 64 KB planes, the sequencer, graphics controller, CRTC, attribute controller
// and DAC. The parts program it with `out` instructions; they port one to one to out8/out16, and what the
// monitor shows (renderFrame in screen.js) follows from the registers, as on the real card.
//
// Chain-4 (mode 13h) addresses are stored the way DOSBox stores them: CPU address a is plane a & 3, offset a >> 2.
// So a mode 13h picture stays where it is when a part switches chain-4 off (exe2 does, and exe3 inherits it).

import { FrameScan } from './screen.js';

/** Graphics mode register (GC 5) bit 6: 256-colour shift; DOSBox's vga.mode is then M_VGA. */
const PLANE_SIZE = 0x10000;
/** Attribute index bit 5: palette address source (screen on, palette registers locked). */
const ATTRIBUTE_PAS = 0x20;
/** The horizontal rate of the 25 MHz dot clock: 25.175 MHz / 800 dots per line. */
export const LINES_PER_SECOND = 25175000 / 800;

/** The attribute controller's 16 entries in mode 3: EGA colours, brown (0x14) for 6. */
const TEXT_ATTRIBUTE_PALETTE = [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x14, 0x07, 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f];

/**
 * The VGA BIOS default palette that int 10h loads for mode 13h: 16 EGA colours, 16 greys, 9 blocks of a 24-step
 * hue circle (three intensities x three saturations), 8 blacks.
 */
const VGA_DEFAULT_PALETTE = (() => {
  const ega = [0x00, 0x00, 0x00, 0x00, 0x00, 0x2a, 0x00, 0x2a, 0x00, 0x00, 0x2a, 0x2a, 0x2a, 0x00, 0x00, 0x2a, 0x00, 0x2a,
    0x2a, 0x15, 0x00, 0x2a, 0x2a, 0x2a, 0x15, 0x15, 0x15, 0x15, 0x15, 0x3f, 0x15, 0x3f, 0x15, 0x15, 0x3f, 0x3f,
    0x3f, 0x15, 0x15, 0x3f, 0x15, 0x3f, 0x3f, 0x3f, 0x15, 0x3f, 0x3f, 0x3f];
  const greys = [0x00, 0x05, 0x08, 0x0b, 0x0e, 0x11, 0x14, 0x18, 0x1c, 0x20, 0x24, 0x28, 0x2d, 0x32, 0x38, 0x3f];
  // [high, low, three levels between low and high]
  const blocks = [[0x3f, 0x00, 0x10, 0x1f, 0x2f], [0x3f, 0x1f, 0x27, 0x2f, 0x37], [0x3f, 0x2d, 0x31, 0x36, 0x3a],
    [0x1c, 0x00, 0x07, 0x0e, 0x15], [0x1c, 0x0e, 0x11, 0x15, 0x18], [0x1c, 0x14, 0x16, 0x18, 0x1a],
    [0x10, 0x00, 0x04, 0x08, 0x0c], [0x10, 0x08, 0x0a, 0x0c, 0x0e], [0x10, 0x0b, 0x0c, 0x0d, 0x0f]];
  const palette = [...ega];
  greys.forEach((grey) => palette.push(grey, grey, grey));
  for (const [high, low, m1, m2, m3] of blocks) {
    const rising = [low, m1, m2, m3];
    const falling = [high, m3, m2, m1];
    for (let i = 0; i < 4; i++) { // blue to magenta
      palette.push(rising[i], low, high);
    }
    for (let i = 0; i < 4; i++) { // magenta to red
      palette.push(high, low, falling[i]);
    }
    for (let i = 0; i < 4; i++) { // red to yellow
      palette.push(high, rising[i], low);
    }
    for (let i = 0; i < 4; i++) { // yellow to green
      palette.push(falling[i], high, low);
    }
    for (let i = 0; i < 4; i++) { // green to cyan
      palette.push(low, high, rising[i]);
    }
    for (let i = 0; i < 4; i++) { // cyan to blue
      palette.push(low, falling[i], high);
    }
  }
  while (palette.length < 768) {
    palette.push(0);
  }
  return Uint8Array.from(palette);
})();

export class Vga {
  constructor() {
    this.planes = [0, 1, 2, 3].map(() => new Uint8Array(PLANE_SIZE));
    this.latches = new Uint8Array(4);
    this.sequencer = new Uint8Array(8);
    this.graphics = new Uint8Array(16);
    this.crtc = new Uint8Array(32);
    this.attribute = new Uint8Array(32);
    this.dac = new Uint8Array(768);
    this.dacMask = 0xff;
    this.sequencerIndex = 0;
    this.graphicsIndex = 0;
    this.crtcIndex = 0;
    /** The last attribute index write; bit 5 (PAS) clear blanks the screen and unlocks palette registers 0-15. */
    this.attributeIndex = ATTRIBUTE_PAS;
    this.isAttributeData = false;
    /** The DAC takes a colour when its third (blue) component is written, as DOSBox does. */
    this.dacPending = new Uint8Array(3);
    this.dacWriteIndex = 0;
    this.dacReadIndex = 0;
    this.misc = 0;
    /** The text screen the demo exits to (mode 3, the 'ending' ANSI at b800), drawn with the ROM font. */
    this.isTextMode = false;
    this.textScreen = new Uint8Array(4000);
    /** The VGA BIOS 8x16 font (assets/vgafont.bin), 16 bytes per character; set by whoever loads it. */
    this.font = new Uint8Array(4096);
    /** What the CRTC latched at the last vertical retrace (latchDisplay): the frame shows these. */
    this.latchedStart = 0;
    this.latchedPanning = 0;
    /**
     * The beam, for raster effects. A part that waits for horizontal retraces calls hblank() once per wait; then
     * every register write and video memory write first draws the rows the beam has passed with the state before
     * the write, as DOSBox does. Measured in the recording (G5 notes): a write made after w hblank waits shows
     * from scanline w - 1 on. Parts that never call hblank() are drawn whole, from the state at present time.
     * Direct writes to vga.planes bypass this: call syncBeam() before them in raster code.
     */
    this.hblankWaits = 0;
    this.beamScan = null;
    /** The last finished raster frame, shown instead of the registers' current state (null: not a raster frame). */
    this.beamFrame = null;
  }

  /** Vertical retrace: the frame being scanned is finished, the next one starts with the latched registers. */
  beginFrame() {
    // Every retrace wait of the demo polls 3da (the effects' retrace loops and the timer IRQ 0731:007a), which resets
    // the attribute controller's index/data flip-flop (G2: the chess zoomer's 3c0 writes rely on it).
    this.isAttributeData = false;
    if (this.beamScan) {
      this.beamScan.drawRowsTo(this.beamScan.height);
      this.beamFrame = this.beamScan.frame;
    } else {
      this.beamFrame = null;
    }
    this.beamScan = null;
    this.hblankWaits = 0;
    this.latchDisplay();
  }

  /** One `wait for horizontal retrace` (3da bit 0) of a raster effect. */
  hblank(count = 1) {
    this.isAttributeData = false; // a 3da read
    if (this.isTextMode) {
      return;
    }
    if (this.beamScan === null) {
      this.beamScan = new FrameScan(this);
    }
    this.hblankWaits += count;
  }

  /** Draws the rows the beam has passed before the state changes. */
  syncBeam() {
    const scan = this.beamScan;
    if (scan === null) {
      return;
    }
    const scanline = this.hblankWaits - 1;
    if (scanline > 0) {
      scan.drawLinesTo(Math.floor(scanline / scan.scanlinesPerLine));
    }
  }

  /**
   * At vertical retrace the CRTC takes the start address for the next frame and the attribute controller the pel
   * panning; writes after that (the parts' retrace callbacks) show one frame later, as in the recording.
   */
  latchDisplay() {
    this.latchedStart = this.startAddress;
    this.latchedPanning = this.attribute[0x13];
  }

  // ---- ports ----

  out8(port, value) {
    if (this.beamScan !== null) {
      this.syncBeam();
    }
    const v = value & 0xff;
    switch (port) {
      case 0x3c0:
        if (this.isAttributeData) {
          const index = this.attributeIndex & 0x1f;
          // Palette registers 0-15 can only be written while PAS is clear (DOSBox ignores them otherwise).
          if (index >= 0x10 || (this.attributeIndex & ATTRIBUTE_PAS) === 0) {
            this.attribute[index] = v;
          }
        } else {
          this.attributeIndex = v;
        }
        this.isAttributeData = !this.isAttributeData;
        break;
      case 0x3c2:
        this.misc = v;
        break;
      case 0x3c4:
        this.sequencerIndex = v & 7;
        break;
      case 0x3c5:
        this.sequencer[this.sequencerIndex] = v;
        break;
      case 0x3c6:
        this.dacMask = v;
        break;
      case 0x3c7:
        this.dacReadIndex = v * 3;
        break;
      case 0x3c8:
        this.dacWriteIndex = v * 3;
        break;
      case 0x3c9: {
        const component = this.dacWriteIndex % 3;
        this.dacPending[component] = v & 63;
        if (component === 2) {
          const entry = this.dacWriteIndex - 2;
          this.dac[entry] = this.dacPending[0];
          this.dac[entry + 1] = this.dacPending[1];
          this.dac[entry + 2] = this.dacPending[2];
        }
        this.dacWriteIndex = (this.dacWriteIndex + 1) % 768;
        break;
      }
      case 0x3ce:
        this.graphicsIndex = v & 15;
        break;
      case 0x3cf:
        this.graphics[this.graphicsIndex] = v;
        break;
      case 0x3d4:
        this.crtcIndex = v & 31;
        break;
      case 0x3d5:
        this.crtc[this.crtcIndex] = v;
        break;
      default:
        break;
    }
  }

  /** `out dx, ax`: al to dx, ah to dx + 1. */
  out16(port, value) {
    this.out8(port, value);
    this.out8(port + 1, value >> 8);
  }

  in8(port) {
    switch (port) {
      case 0x3c9: {
        const v = this.dac[this.dacReadIndex];
        this.dacReadIndex = (this.dacReadIndex + 1) % 768;
        return v;
      }
      case 0x3cc:
        return this.misc;
      case 0x3d5:
        return this.crtc[this.crtcIndex];
      case 0x3da:
        this.isAttributeData = false;
        // Callers only wait on retrace bits; time is handled by the frame loop (see demo.js).
        return 0x08;
      default:
        return 0;
    }
  }

  /** `out 3c8, first` then `count` 6-bit components from `bytes` at `at`. */
  dacLoad(first, bytes, at, count) {
    this.out8(0x3c8, first);
    for (let i = 0; i < count; i++) {
      this.out8(0x3c9, bytes[at + i]);
    }
  }

  // ---- video memory (CPU writes and reads at A000:offset) ----

  get isChain4() {
    return (this.sequencer[4] & 0x08) !== 0;
  }

  write(offset, value) {
    if (this.beamScan !== null) {
      this.syncBeam();
    }
    const address = offset & 0xffff;
    if (this.isChain4) {
      this.planes[address & 3][address >> 2] = value;
      return;
    }
    const mapMask = this.sequencer[2];
    const writeMode = this.graphics[5] & 3;
    for (let p = 0; p < 4; p++) {
      if (mapMask & (1 << p)) {
        this.planes[p][address] = writeMode === 1 ? this.latches[p] : this.writeMode0(p, value);
      }
    }
  }

  /** Write mode 0: set/reset, rotate is unused by the demo; the logical function and the bit mask apply. */
  writeMode0(plane, value) {
    const enableSetReset = this.graphics[1];
    let data = enableSetReset & (1 << plane) ? (this.graphics[0] & (1 << plane) ? 0xff : 0) : value;
    const latch = this.latches[plane];
    switch ((this.graphics[3] >> 3) & 3) {
      case 1:
        data &= latch;
        break;
      case 2:
        data |= latch;
        break;
      case 3:
        data ^= latch;
        break;
      default:
        break;
    }
    const bitMask = this.graphics[8];
    return (data & bitMask) | (latch & ~bitMask & 0xff);
  }

  /** A CPU read: loads the four latches and returns the read-map plane. */
  read(offset) {
    const address = offset & 0xffff;
    if (this.isChain4) {
      return this.planes[address & 3][address >> 2];
    }
    for (let p = 0; p < 4; p++) {
      this.latches[p] = this.planes[p][address];
    }
    return this.latches[this.graphics[4] & 3];
  }

  // ---- what the CRTC scans out ----

  get startAddress() {
    return (this.crtc[0x0c] << 8) | this.crtc[0x0d];
  }

  /** Bytes per row in a plane: the offset register counts words. */
  get rowBytes() {
    return this.crtc[0x13] * 2;
  }

  get verticalTotal() {
    const overflow = this.crtc[7];
    return this.crtc[6] | ((overflow & 0x01) << 8) | ((overflow & 0x20) << 4);
  }

  get displayedLines() {
    const overflow = this.crtc[7];
    return (this.crtc[0x12] | ((overflow & 0x02) << 7) | ((overflow & 0x40) << 3)) + 1;
  }

  get lineCompare() {
    return this.crtc[0x18] | ((this.crtc[7] & 0x10) << 4) | ((this.crtc[9] & 0x40) << 3);
  }

  /** Scan lines per row of video memory: the maximum scan line field, doubled by bit 7 (double scan). */
  get linesPerRow() {
    return ((this.crtc[9] & 0x1f) + 1) * (this.crtc[9] & 0x80 ? 2 : 1);
  }

  /** Attribute index bit 5 clear: the attribute controller outputs black (the palette is being written). */
  get isAttributeBlanked() {
    return (this.attributeIndex & ATTRIBUTE_PAS) === 0;
  }

  get is256Colours() {
    return (this.attribute[0x10] & 0x40) !== 0;
  }

  /** Vertical retraces per second: the line rate over the vertical total (CRTC 6 plus overflow bits, + 2). */
  get refreshRate() {
    return LINES_PER_SECOND / (this.verticalTotal + 2);
  }

  // ---- BIOS mode sets (int 10h ah=0): only the registers the demo then relies on ----

  /** int 10h ax=13h: 320x200x256, chain-4, video memory cleared, 70 Hz. */
  setMode13() {
    this.isTextMode = false;
    this.clearPlanes();
    this.sequencer.set([0x03, 0x01, 0x0f, 0x00, 0x0e]);
    this.graphics.set([0, 0, 0, 0, 0, 0x40, 0x05, 0x0f, 0xff]);
    this.crtc.set([0x5f, 0x4f, 0x50, 0x82, 0x54, 0x80, 0xbf, 0x1f, 0x00, 0x41, 0, 0, 0, 0, 0, 0,
      0x9c, 0x8e, 0x8f, 0x28, 0x40, 0x96, 0xb9, 0xa3, 0xff]);
    this.setAttributeIdentity(0x41);
    // The BIOS loads its default 256-colour palette at the mode set (G7: colour 0 is black after 07a5).
    this.dac.set(VGA_DEFAULT_PALETTE);
    this.dacMask = 0xff;
  }

  /** int 10h ax=12h: 640x480x16, planar, video memory cleared. */
  setMode12() {
    this.isTextMode = false;
    this.clearPlanes();
    this.sequencer.set([0x03, 0x01, 0x0f, 0x00, 0x06]);
    this.graphics.set([0, 0, 0, 0, 0, 0x00, 0x05, 0x0f, 0xff]);
    this.crtc.set([0x5f, 0x4f, 0x50, 0x82, 0x54, 0x80, 0x0b, 0x3e, 0x00, 0x40, 0, 0, 0, 0, 0, 0,
      0xea, 0x8c, 0xdf, 0x28, 0x00, 0xe7, 0x04, 0xe3, 0xff]);
    this.setAttributeIdentity(0x01);
  }

  /** int 10h ax=3: the 80x25 text screen, cleared, with the BIOS's 16-colour palette. */
  setMode3() {
    this.isTextMode = true;
    this.sequencer.set([0x03, 0x00, 0x03, 0x00, 0x02]);
    this.graphics.set([0, 0, 0, 0, 0, 0x10, 0x0e, 0x00, 0xff]);
    this.crtc.set([0x5f, 0x4f, 0x50, 0x82, 0x55, 0x81, 0xbf, 0x1f, 0x00, 0x4f, 0x0d, 0x0e, 0, 0, 0, 0,
      0x9c, 0x8e, 0x8f, 0x28, 0x1f, 0x96, 0xb9, 0xa3, 0xff]);
    for (let i = 0; i < 2000; i++) {
      this.textScreen[i * 2] = 0x20;
      this.textScreen[i * 2 + 1] = 0x07;
    }
    TEXT_ATTRIBUTE_PALETTE.forEach((value, i) => {
      this.attribute[i] = value;
    });
    this.attribute[0x10] = 0x0c;
    this.attribute[0x12] = 0x0f;
    this.attribute[0x13] = 0x08;
    this.attribute[0x14] = 0;
    this.attributeIndex = ATTRIBUTE_PAS;
    this.isAttributeData = false;
    this.dacMask = 0xff;
    for (let i = 0; i < 64; i++) {
      // The EGA colour of DAC entry i: bits 0-2 primary (2/3 intensity), bits 3-5 secondary (1/3).
      const level = (primaryBit, secondaryBit) => ((i >> primaryBit) & 1) * 42 + ((i >> secondaryBit) & 1) * 21;
      this.dac[i * 3] = level(2, 5);
      this.dac[i * 3 + 1] = level(1, 4);
      this.dac[i * 3 + 2] = level(0, 3);
    }
  }

  clearPlanes() {
    for (const plane of this.planes) {
      plane.fill(0);
    }
  }

  /** Attribute registers 0..15 = 0..15 (what int 10h ax=1000h loops give, and mode 13h's default). */
  setAttributeIdentity(modeControl) {
    this.attributeIndex = ATTRIBUTE_PAS;
    this.isAttributeData = false;
    for (let i = 0; i < 16; i++) {
      this.attribute[i] = i;
    }
    this.attribute[0x10] = modeControl;
    this.attribute[0x12] = 0x0f;
    this.attribute[0x13] = 0;
    this.attribute[0x14] = 0;
  }
}
