// x87 conversions the parts rely on when they turn float results into integers.

/** fistp in the default rounding mode: to the nearest integer, halves to even. */
export function roundHalfEven(x) {
  const r = Math.round(x);
  if (r - x === 0.5 && r % 2 !== 0) {
    return r - 1;
  }
  return r;
}
