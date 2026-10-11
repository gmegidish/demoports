// The sync tables: 16-byte entries {position, row, own index, 0} ending with position 100. A part
// waits for its first entry and steps on the following ones; see machine.syncAdvance.

export const INTRO_SYNC_TABLE = 0x80058;
export const DEMO_SYNC_TABLE = 0x801b8;
const ENTRY_BYTES = 16;
const SENTINEL_POSITION = 100;

export function readSyncTable(image, address) {
  const entries = [];
  for (let at = address; ; at += ENTRY_BYTES) {
    const entry = { position: image.u32(at), row: image.u32(at + 4) };
    entries.push(entry);
    if (entry.position === SENTINEL_POSITION) {
      return entries;
    }
  }
}
