// Unit 0ba7: Real48 sin/cos tables in whole degrees, -360..360 (0ba7:001c, 013c, 0192).
// Notes: L5_units.md "0ba7". Real48 keeps 40 bits of mantissa; doubles are used here.

function wrapDegrees(a) {
  while (a > 360) {
    a -= 360;
  }
  while (a < -360) {
    a += 360;
  }
  return a;
}

/** 0ba7:013c */
export function sinR(a) {
  return Math.sin((wrapDegrees(a) * Math.PI) / 180);
}

/** 0ba7:0192 */
export function cosR(a) {
  return Math.cos((wrapDegrees(a) * Math.PI) / 180);
}
