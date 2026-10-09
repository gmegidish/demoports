// What the monitor shows, from the VGA registers: the CRTC start address, row offset, line compare and lines per
// row, the attribute controller's pel panning and colour mode, and the DAC. 256-colour modes (mode 13h and its
// unchained variants) read plane x & 3 at offset x >> 2; the 16-colour mode (exe4's 640x400) combines one bit of
// each plane. The text mode the demo exits to is shown blank.
const PLANE_MASK = 0xffff;

/** 6-bit DAC value to 8 bits, rounded, as the reference recording (DOSBox) does it. */
export function dacTo8(v) {
  return Math.round(((v & 63) * 255) / 63);
}

function paletteColours(vga) {
  const colours = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const index = (i & vga.dacMask) * 3;
    colours[i] = 0xff000000 | (dacTo8(vga.dac[index + 2]) << 16) | (dacTo8(vga.dac[index + 1]) << 8) | dacTo8(vga.dac[index]);
  }
  return colours;
}

/** Start address of each displayed row: line compare restarts the scan at address 0. */
function rowAddresses(vga, rows) {
  const addresses = new Int32Array(rows);
  const linesPerRow = vga.linesPerRow;
  const lineCompare = vga.lineCompare;
  let address = vga.latchedStart;
  for (let row = 0; row < rows; row++) {
    if (row * linesPerRow > lineCompare) {
      address = (row - Math.floor(lineCompare / linesPerRow) - 1) * vga.rowBytes;
      addresses[row] = address;
      continue;
    }
    addresses[row] = address + row * vga.rowBytes;
  }
  return addresses;
}

function render256(vga, colours) {
  const width = 320;
  const height = Math.floor(vga.displayedLines / vga.linesPerRow);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const pixels = new Uint32Array(rgba.buffer);
  const panning = (vga.latchedPanning >> 1) & 3;
  const addresses = rowAddresses(vga, height);
  const isAfterCompare = (row) => row * vga.linesPerRow > vga.lineCompare;
  for (let y = 0; y < height; y++) {
    const shift = isAfterCompare(y) ? 0 : panning;
    for (let x = 0; x < width; x++) {
      const px = x + shift;
      pixels[y * width + x] = colours[vga.planes[px & 3][(addresses[y] + (px >> 2)) & PLANE_MASK]];
    }
  }
  return { width, height, rgba };
}

function render16(vga, colours) {
  const width = 640;
  const height = Math.floor(vga.displayedLines / vga.linesPerRow);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const pixels = new Uint32Array(rgba.buffer);
  const addresses = rowAddresses(vga, height);
  const [p0, p1, p2, p3] = vga.planes;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (addresses[y] + (x >> 3)) & PLANE_MASK;
      const bit = 7 - (x & 7);
      const attribute = ((p0[offset] >> bit) & 1) | (((p1[offset] >> bit) & 1) << 1) | (((p2[offset] >> bit) & 1) << 2) | (((p3[offset] >> bit) & 1) << 3);
      pixels[y * width + x] = colours[vga.attribute[attribute & vga.attribute[0x12]] & 0x3f];
    }
  }
  return { width, height, rgba };
}

/** { width, height, rgba }. */
export function renderFrame(vga) {
  if (vga.isTextMode) {
    const rgba = new Uint8ClampedArray(640 * 400 * 4);
    new Uint32Array(rgba.buffer).fill(0xff000000);
    return { width: 640, height: 400, rgba };
  }
  const colours = paletteColours(vga);
  return vga.is256Colours ? render256(vga, colours) : render16(vga, colours);
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
