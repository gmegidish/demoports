// The disk: an 880 KB track-loaded floppy with no filesystem.
// The boot block reads $ba00 bytes from offset $400 and the code moves itself to $2000.
// That loader then reads $ce667 bytes from offset $bd80 to $d980, in one go: music, then every part.

const LOADER_ADDRESS = 0x2000;
const LOADER_OFFSET = 0x400;
const LOADER_BYTES = 0xba00;
const DEMO_ADDRESS = 0xd980;
const DEMO_OFFSET = 0xbd80;
const DEMO_BYTES = 0xce667;

export function loadDisk(m, adf) {
  m.mem.set(adf.subarray(LOADER_OFFSET, LOADER_OFFSET + LOADER_BYTES), LOADER_ADDRESS);
  m.mem.set(adf.subarray(DEMO_OFFSET, DEMO_OFFSET + DEMO_BYTES), DEMO_ADDRESS);
}

/**
 * Two parts are crunched and unpack themselves when called.
 * ponytail: the unpacked bytes are shipped next to the disk (tools/decrunch.py made them by running the
 * original decruncher); port the decruncher to drop these two files.
 */
export function decrunch(m, entry) {
  m.mem.set(m.unpacked[entry], entry);
}
