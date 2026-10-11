// The effect tables main precalculates while loading (0x1005dc, 0x1005e1, 0x1006e5).
// Each is ported by the part that uses it; these call into those parts' modules.
import { buildRaysTables } from './parts/fakemode.js';
import { buildRingTables } from './parts/rings.js';
import { buildTunnelTable } from './parts/film.js';

/** 0x102e40: the table at [0x16f700] (part 0x103808). */
export function buildTables102e40(m) {
  buildTunnelTable(m);
}

/** 0x106024: the table at [0x170608] (part 0x10629f). */
export function buildTables106024(m) {
  buildRaysTables(m);
}

/** 0x108a58: the tables at [0x170704] and [0x170708] (part 0x108c6a). */
export function buildTables108a58(m) {
  buildRingTables(m);
}
