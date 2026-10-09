// The blitter: area mode (copy, cookie-cut, fill) and line mode, as the hardware does them.
// Scenes set the registers in m.blt and write BLTSIZE by calling blit(m, size).

const WRAP = 0x7fffe;

function minterm(lf, a, b, c) {
  let d = 0;
  if (lf & 0x80) { d |= a & b & c; }
  if (lf & 0x40) { d |= a & b & ~c; }
  if (lf & 0x20) { d |= a & ~b & c; }
  if (lf & 0x10) { d |= a & ~b & ~c; }
  if (lf & 0x08) { d |= ~a & b & c; }
  if (lf & 0x04) { d |= ~a & b & ~c; }
  if (lf & 0x02) { d |= ~a & ~b & c; }
  if (lf & 0x01) { d |= ~a & ~b & ~c; }
  return d & 0xffff;
}

/** Area fill of one word, right to left. Returns the filled word; the carry continues in `state.carry`. */
function fillWord(word, isInclusive, state) {
  let out = word;
  let carry = state.carry;
  for (let bit = 1; bit < 0x10000; bit <<= 1) {
    if (carry) {
      out = isInclusive ? out | bit : out ^ bit;
    }
    if (word & bit) {
      carry ^= 1;
    }
  }
  state.carry = carry;
  return out & 0xffff;
}

function blitLine(m, rows) {
  const b = m.blt;
  const view = m.view;
  const lf = b.con0 & 0xff;
  let shift = b.con0 >> 12;
  let sign = (b.con1 & 0x40) !== 0;
  let pattern = b.bdat;
  const patternShift = b.con1 >> 12;
  pattern = ((pattern >> patternShift) | (pattern << (16 - patternShift))) & 0xffff;
  let isOneDot = false;
  let address = b.cpt;
  let accumulator = (b.apt << 16) >> 16;

  const incX = () => { if (++shift === 16) { shift = 0; address += 2; } };
  const decX = () => { if (shift-- === 0) { shift = 15; address -= 2; } };
  const incY = () => { address += b.cmod; isOneDot = false; };
  const decY = () => { address -= b.cmod; isOneDot = false; };

  for (let i = 0; i < rows; i++) {
    address &= WRAP;
    let a = (b.adat & b.afwm) >> shift;
    if ((b.con1 & 0x02) && isOneDot) {
      a = 0;
    }
    isOneDot = true;
    const bHold = pattern & 1 ? 0xffff : 0;
    const c = b.con0 & 0x200 ? view.getUint16(address) : b.cdat;
    pattern = ((pattern << 1) | (pattern >> 15)) & 0xffff;
    if (b.con0 & 0x100) {
      view.setUint16(address, minterm(lf, a, bHold, c));
    }
    if (!sign) {
      if (b.con1 & 0x10) {
        if (b.con1 & 0x08) { decY(); } else { incY(); }
      } else if (b.con1 & 0x08) { decX(); } else { incX(); }
    }
    if (b.con1 & 0x10) {
      if (b.con1 & 0x04) { decX(); } else { incX(); }
    } else if (b.con1 & 0x04) { decY(); } else { incY(); }
    if (b.con0 & 0x800) {
      accumulator = ((accumulator + (sign ? b.bmod : b.amod)) << 16) >> 16;
    }
    sign = accumulator < 0;
  }
  b.cpt = address & WRAP;
  b.dpt = b.cpt;
  b.apt = (b.apt & 0xffff0000) | (accumulator & 0xffff);
}

/** Write BLTSIZE: height in the top 10 bits, width in words in the low 6. Zero means 1024 or 64. */
export function blit(m, size) {
  const b = m.blt;
  const rows = (size >> 6) || 1024;
  const words = (size & 0x3f) || 64;
  if (b.con1 & 1) {
    blitLine(m, rows);
    return;
  }
  const view = m.view;
  const lf = b.con0 & 0xff;
  const aShift = b.con0 >> 12;
  const bShift = b.con1 >> 12;
  const useA = (b.con0 & 0x800) !== 0;
  const useB = (b.con0 & 0x400) !== 0;
  const useC = (b.con0 & 0x200) !== 0;
  const useD = (b.con0 & 0x100) !== 0;
  const isDescending = (b.con1 & 0x02) !== 0;
  const isFill = (b.con1 & 0x18) !== 0;
  const isInclusive = (b.con1 & 0x08) !== 0;
  const step = isDescending ? -2 : 2;
  const modSign = isDescending ? -1 : 1;
  const fill = { carry: 0 };
  let aPrev = 0;
  let bPrev = 0;
  for (let row = 0; row < rows; row++) {
    fill.carry = (b.con1 >> 2) & 1;
    for (let word = 0; word < words; word++) {
      if (useA) {
        b.adat = view.getUint16(b.apt & WRAP);
        b.apt += step;
      }
      let aNew = b.adat;
      if (word === 0) { aNew &= b.afwm; }
      if (word === words - 1) { aNew &= b.alwm; }
      if (useB) {
        b.bdat = view.getUint16(b.bpt & WRAP);
        b.bpt += step;
      }
      const bNew = b.bdat;
      if (useC) {
        b.cdat = view.getUint16(b.cpt & WRAP);
        b.cpt += step;
      }
      let a;
      let bb;
      if (isDescending) {
        a = ((aNew << aShift) | (aPrev >> (16 - aShift))) & 0xffff;
        bb = ((bNew << bShift) | (bPrev >> (16 - bShift))) & 0xffff;
      } else {
        a = (((aPrev << 16) | aNew) >>> aShift) & 0xffff;
        bb = (((bPrev << 16) | bNew) >>> bShift) & 0xffff;
      }
      aPrev = aNew;
      bPrev = bNew;
      let d = minterm(lf, a, bb, b.cdat);
      if (isFill) {
        d = fillWord(d, isInclusive, fill);
      }
      if (useD) {
        view.setUint16(b.dpt & WRAP, d);
        b.dpt += step;
      }
    }
    if (useA) { b.apt += modSign * b.amod; }
    if (useB) { b.bpt += modSign * b.bmod; }
    if (useC) { b.cpt += modSign * b.cmod; }
    if (useD) { b.dpt += modSign * b.dmod; }
  }
}

const POINTER_REGS = { 0x48: 'cpt', 0x4c: 'bpt', 0x50: 'apt', 0x54: 'dpt' };
const WORD_REGS = {
  0x40: 'con0', 0x42: 'con1', 0x44: 'afwm', 0x46: 'alwm',
  0x70: 'cdat', 0x72: 'bdat', 0x74: 'adat',
};
const MODULO_REGS = { 0x60: 'cmod', 0x62: 'bmod', 0x64: 'amod', 0x66: 'dmod' };

/** A word write to a blitter register, $dff040-$dff074. Writing BLTSIZE ($58) starts the blit. */
export function blitterWrite(m, reg, value) {
  const b = m.blt;
  const pointerHigh = POINTER_REGS[reg];
  const pointerLow = POINTER_REGS[reg - 2];
  if (pointerHigh) {
    b[pointerHigh] = ((value & 7) << 16) | (b[pointerHigh] & 0xffff);
  } else if (pointerLow) {
    b[pointerLow] = (b[pointerLow] & 0xffff0000) | (value & 0xfffe);
  } else if (WORD_REGS[reg]) {
    b[WORD_REGS[reg]] = value;
  } else if (MODULO_REGS[reg]) {
    // Bit 0 of the modulos is not wired, as for the pointers.
    b[MODULO_REGS[reg]] = ((value & 0xfffe) << 16) >> 16;
  } else if (reg === 0x58) {
    blit(m, value);
  }
}
