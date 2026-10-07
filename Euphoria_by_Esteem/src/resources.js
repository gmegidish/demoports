// The resource file appended to EUPHORIA.EXE: 50 little-endian dword sizes, then the items back to back.
const RESOURCE_BASE = 0x273f0;
const RESOURCE_COUNT = 50;

/** Splits the executable's appended resource file into its items (index 0..49, empty ones are zero-length). */
export function readResources(exe) {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const items = [];
  let offset = RESOURCE_BASE + RESOURCE_COUNT * 4;
  for (let i = 0; i < RESOURCE_COUNT; i++) {
    const size = view.getUint32(RESOURCE_BASE + i * 4, true);
    items.push(exe.subarray(offset, offset + size));
    offset += size;
  }
  return items;
}
