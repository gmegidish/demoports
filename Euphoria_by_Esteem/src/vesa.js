// VESA drawing routines of the graphics unit (segment 186a) that write straight into banked video
// memory. Notes: docs/disassembly/P07_parts_8768_9178.md "186a:1c74 / 186a:1c8f".

const BANK_SIZE = 0x10000;

/** 186a:1b75 nextBank: the bank after the current one (absolute bank + 1). */
function nextBank(m) {
  m.setBank(((m.bank - m.drawBankOffset + 1) & 0xff));
}

/**
 * 186a:1c74 / 1c8f: a solid span in the banked VESA draw page, through the span hook (DS:911a).
 * The clip origin is added as a viewport offset; nothing is clipped (FlatPoly clamps x already).
 */
export function vesaSpan(m, y, x, len, color) {
  const x2 = x + len - 1;
  const xx = (x + m.clip.left) & 0xffff;
  const yy = (y + m.clip.top) & 0xffff;
  const offset = (Math.imul(m.width & 0xffff, yy) >>> 0) + xx;
  m.setBank((offset >>> 16) & 0xff);
  const di = offset & 0xffff;
  const n = x2 - x + 1;
  if (di + n <= 0xffff) {
    fillWindow(m, di, n, color);
    return;
  }
  const first = BANK_SIZE - di;
  fillWindow(m, di, first, color);
  nextBank(m);
  fillWindow(m, 0, n - first, color);
}

/** rep stosb into the 64 KB window A000 at the current bank. */
function fillWindow(m, offset, count, color) {
  if (count <= 0) {
    return;
  }
  const base = m.bank * BANK_SIZE;
  m.vram.fill(color, base + offset, base + offset + count);
}
