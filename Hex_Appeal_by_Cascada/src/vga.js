// The VGA, at register level: four 64 KB planes, the sequencer, graphics controller, CRTC, attribute controller
// and DAC. The parts program it with `out` instructions; they port one to one to out8/out16, and what the
// monitor shows (renderFrame in screen.js) follows from the registers, as on the real card.
//
// Chain-4 (mode 13h) addresses are stored the way DOSBox stores them: CPU address a is plane a & 3, offset a >> 2.
// So a mode 13h picture stays where it is when a part switches chain-4 off (exe2 does, and exe3 inherits it).

const PLANE_SIZE = 0x10000;
/** The horizontal rate of the 25 MHz dot clock: 25.175 MHz / 800 dots per line. */
export const LINES_PER_SECOND = 25175000 / 800;

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
    this.attributeIndex = 0;
    this.isAttributeData = false;
    this.dacWriteIndex = 0;
    this.dacReadIndex = 0;
    this.misc = 0;
    /** The text screen the demo exits to (mode 3), drawn with the ROM font. */
    this.isTextMode = false;
    this.textScreen = new Uint8Array(4000);
    /** What the CRTC latched at the last vertical retrace (latchDisplay): the frame shows these. */
    this.latchedStart = 0;
    this.latchedPanning = 0;
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
    const v = value & 0xff;
    switch (port) {
      case 0x3c0:
        if (this.isAttributeData) {
          this.attribute[this.attributeIndex & 0x1f] = v;
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
      case 0x3c9:
        this.dac[this.dacWriteIndex] = v & 63;
        this.dacWriteIndex = (this.dacWriteIndex + 1) % 768;
        break;
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

  /** int 10h ax=3: the 80x25 text screen, cleared. */
  setMode3() {
    this.isTextMode = true;
    for (let i = 0; i < 2000; i++) {
      this.textScreen[i * 2] = 0x20;
      this.textScreen[i * 2 + 1] = 0x07;
    }
  }

  clearPlanes() {
    for (const plane of this.planes) {
      plane.fill(0);
    }
  }

  /** Attribute registers 0..15 = 0..15 (what int 10h ax=1000h loops give, and mode 13h's default). */
  setAttributeIdentity(modeControl) {
    for (let i = 0; i < 16; i++) {
      this.attribute[i] = i;
    }
    this.attribute[0x10] = modeControl;
    this.attribute[0x12] = 0x0f;
    this.attribute[0x13] = 0;
    this.attribute[0x14] = 0;
  }
}
