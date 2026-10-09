// The morphing lines' line drawer: the overlay 'mutamcde' at offset 1a98 (OR-plots one-pixel lines into the current
// plane of the 16-colour page at es; 40 bytes per row). docs/disassembly/G3_plasma_morph_chess.md, section 3.
//
// Video memory is written through vga.read / vga.write: `or es:[di], al` loads the latches from the read-map plane
// (set to the drawn plane by the overlay) and writes back with the map mask.

/** Overlay tables: the pixel bit for x & 7, the left span mask (bits x & 7 .. 7), the right span mask (0 .. x & 7). */
const PIXEL_BITS = 0x1a76;
const LEFT_MASKS = 0x1a7e;
const RIGHT_MASKS = 0x1a86;
const ROW_BYTES = 0x28;
const WORD = 0xffff;

/**
 * @typedef {object} Plotter
 * @property {import('../vga.js').Vga} vga
 * @property {Uint8Array} mem the machine memory
 * @property {number} overlay linear address of the overlay (its tables)
 * @property {number} page video memory offset of the page drawn (es - a000h, in bytes)
 */

const signed16 = (v) => ((v & WORD) << 16) >> 16;

/** `or es:[di], value`. */
function orByte(plotter, di, value) {
  const address = (plotter.page + (di & WORD)) & WORD;
  const old = plotter.vga.read(address);
  plotter.vga.write(address, old | value);
}

/** `stosb` of `value`. */
function storeByte(plotter, di, value) {
  plotter.vga.write((plotter.page + (di & WORD)) & WORD, value);
}

/** 1b3e: x1 == x2. */
function drawVertical(plotter, x, y1, y2) {
  let top = y1;
  let bottom = y2;
  if (signed16(bottom) < signed16(top)) {
    [top, bottom] = [bottom, top];
  }
  const count = (bottom - top) & WORD;
  const bit = plotter.mem[plotter.overlay + PIXEL_BITS + (x & 7)];
  let di = ((x & WORD) >> 3) + ((top * 40) & WORD);
  for (let i = 0; i < count; i++) {
    orByte(plotter, di, bit);
    di += ROW_BYTES;
  }
  orByte(plotter, di, bit);
}

/** 1b74: y1 == y2, x1 < x2 (unsigned). */
function drawHorizontal(plotter, x1, x2, y) {
  const mem = plotter.mem;
  let left = mem[plotter.overlay + LEFT_MASKS + (x1 & 7)];
  const right = mem[plotter.overlay + RIGHT_MASKS + (x2 & 7)];
  const firstByte = (x1 & WORD) >> 3;
  const lastByte = (x2 & WORD) >> 3;
  let di = firstByte + ((y * 40) & WORD);
  const span = (lastByte - firstByte) & WORD;
  if (span === 0) {
    left &= right;
    orByte(plotter, di, left);
    return;
  }
  orByte(plotter, di, left);
  di++;
  for (let i = 0; i < span - 1; i++) {
    storeByte(plotter, di, 0xff);
    di++;
  }
  orByte(plotter, di, right);
}

/** 1a98: a line from (x1, y1) to (x2, y2), all 16-bit words. */
export function drawLine(plotter, x1In, y1In, x2In, y2In) {
  let x1 = x1In & WORD;
  let y1 = y1In & WORD;
  let x2 = x2In & WORD;
  let y2 = y2In & WORD;
  if (x1 === x2) {
    drawVertical(plotter, x1, y1, y2);
    return;
  }
  if (x1 > x2) {
    [x1, x2] = [x2, x1];
    [y1, y2] = [y2, y1];
  }
  const dx = (x2 - x1) & WORD;
  let dy = signed16(y2 - y1);
  let step = ROW_BYTES;
  if (dy === 0) {
    drawHorizontal(plotter, x1, x2, y1);
    return;
  }
  if (dy < 0) {
    dy = -dy;
    step = -ROW_BYTES;
  }
  let al = plotter.mem[plotter.overlay + PIXEL_BITS + (x1 & 7)];
  let di = (x1 >> 3) + ((y1 * 40) & WORD);
  const sdx = signed16(dx);
  if (dy === sdx) {
    // 1bc4: diagonal.
    for (let i = 0; i <= dx; i++) {
      orByte(plotter, di, al);
      di += step;
      al >>= 1;
      if (al === 0) {
        al = 0x80;
        di++;
      }
    }
    return;
  }
  if (dy > sdx) {
    // 1b0a: y-major, one pixel per row.
    let error = 0;
    for (let i = 0; i < dy; i++) {
      orByte(plotter, di, al);
      di += step;
      error += 2 * sdx;
      if (error > dy) {
        al >>= 1;
        if (al === 0) {
          al = 0x80;
          di++;
        }
        error -= 2 * dy;
      }
    }
    orByte(plotter, di, al);
    return;
  }
  // 1acb: x-major; the pixels of a row are collected in ah and ORed in when the byte or the row changes.
  let ah = al;
  let error = 0;
  for (let i = 0; i < dx; i++) {
    al >>= 1;
    if (al === 0) {
      orByte(plotter, di, ah);
      al = 0x80;
      ah = 0;
      di++;
    }
    error += 2 * dy;
    if (error > sdx) {
      error -= 2 * sdx;
      orByte(plotter, di, ah);
      ah = al;
      di += step;
    } else {
      ah |= al;
    }
  }
  orByte(plotter, di, ah);
}
