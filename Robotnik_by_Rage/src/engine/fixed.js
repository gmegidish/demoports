// 32-bit integer and x87 single-precision arithmetic as the engine's compiled code does it.
// Every integer in the original is a 32-bit register: products wrap (imul), divisions truncate
// toward zero (idiv), `>>` is sar. Main sets the x87 precision control to 24 bits (M notes 0x11a39),
// so every float multiply/add rounds to float32 (`f32`). Float->int conversions go through __CHP
// 0x44160 (truncate toward zero).

export const imul = Math.imul;
export const f32 = Math.fround;

/** x86 idiv with a sign-extended (cdq) 32-bit dividend: truncates toward zero. */
export function idiv(a, b) {
  return (a / b) | 0;
}

/**
 * idiv with a 64-bit dividend (edx:eax built by shld/shl): `n` may exceed 32 bits; it must be an
 * exact integer in a double. The quotient is corrected so that double rounding never moves it.
 */
export function idiv64(n, d) {
  let q = Math.trunc(n / d);
  const r = n - q * d;
  if (r !== 0 && Math.sign(r) !== Math.sign(n)) {
    q += Math.sign(n) === Math.sign(d) ? -1 : 1;
  } else if (Math.abs(r) >= Math.abs(d)) {
    q += Math.sign(n) === Math.sign(d) ? 1 : -1;
  }
  return q | 0;
}

/** 0x44160 (__CHP) + fistp: float to int, truncated toward zero, wrapped to 32 bits. */
export function trunc(x) {
  return Math.trunc(x) | 0;
}

/** Sign-extend the low 16 bits. */
export function sext16(x) {
  return (x << 16) >> 16;
}
