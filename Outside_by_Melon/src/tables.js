// Tables the program builds at start-up.

// 0x13140: T[k] = trunc(sin(x_k) * 65536), x_0 = 0, x_{k+1} = x_k + 0.001533203125 (5120 dwords at 0x1f8424).
// The x87 sums in extended precision; doubles give the same table.
export function buildSineTable() {
  const table = new Int32Array(5120)
  let x = 0
  for (let k = 0; k < table.length; k++) {
    table[k] = Math.trunc(Math.sin(x) * 65536)
    x += 0.001533203125
  }
  return table
}

// 0x429b1 subtracts 0x80 from the 1024 dwords of the asm engine's two trig tables:
// S[i] = round(128 sin(2 pi i / 1024)), C[i] = round(-128 cos(2 pi i / 1024))
export function readTrigTables(mem) {
  const view = new DataView(mem.buffer)
  const S = new Int32Array(1024), C = new Int32Array(1024)
  for (let i = 0; i < 1024; i++) {
    S[i] = view.getInt32(0x4872e + 4 * i, true) - 0x80
    C[i] = view.getInt32(0x498ae + 4 * i, true) - 0x80
  }
  return { S, C }
}
