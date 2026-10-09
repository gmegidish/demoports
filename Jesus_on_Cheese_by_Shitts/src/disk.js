// The disk: no filesystem. The boot block reads byte ranges with trackdisk.device, straight into chip RAM.

/** Bytes in one track of one side: 11 sectors of 512. */
export const TRACK_BYTES = 0x1600;

/** `DoIO` with CMD_READ: `length` bytes from disk offset `offset` to chip address `address`. */
export function readDisk(m, adf, offset, length, address) {
  m.mem.set(adf.subarray(offset, offset + length), address);
}

/** How many track-sides trackdisk has to read for a byte range: it always reads whole tracks. */
export function tracksTouched(offset, length) {
  return Math.ceil((offset + length) / TRACK_BYTES) - Math.floor(offset / TRACK_BYTES);
}
