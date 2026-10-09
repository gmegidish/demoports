// APPEAL.EXE is seven MZ programs back to back (loader, setup, five parts) and then the music and pictures
// (tools/re/split.py does the same split). A part's image is what follows its MZ header, loaded at segment 0:
// its relocations add 0, so the image is used as it is, and addresses match the listings.

const MZ_SIGNATURE = 0x5a4d;
const PROGRAM_COUNT = 7;

function u16(bytes, at) {
  return bytes[at] | (bytes[at + 1] << 8);
}

/** The seven programs as { start, size, image } (image = the load module, without the header). */
export function splitAppeal(exe) {
  const programs = [];
  let start = 0;
  for (let i = 0; i < PROGRAM_COUNT; i++) {
    if (u16(exe, start) !== MZ_SIGNATURE) {
      throw new Error(`APPEAL.EXE: no MZ header for program ${i} at ${start}`);
    }
    const lastPageBytes = u16(exe, start + 2);
    const pages = u16(exe, start + 4);
    const headerBytes = u16(exe, start + 8) * 16;
    const size = lastPageBytes ? (pages - 1) * 512 + lastPageBytes : pages * 512;
    programs.push({ start, size, image: exe.subarray(start + headerBytes, start + size) });
    start += size;
  }
  return { programs, tailStart: start };
}
