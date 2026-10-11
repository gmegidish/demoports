// What main (0x10028d) allocates, loads and precalculates before mode 13h (0x100317, 0x1003a3..0x100826): the
// work buffer, PCX pictures from TOONTOWN.DAT with their palettes, a TGA, effect tables, and the 39 animation blocks.
import { buildTables102e40, buildTables106024, buildTables108a58 } from './tables.js';

/** [TOONTOWN.DAT offset, palette address, global that receives the picture], in load order. */
const PICTURES_BEFORE_TABLES = [
  [0x2a22f, 0x12c098, 0x15c6a4],
  [0x00000, 0x12c098, 0x12c094],
  [0xe0ff7, 0x12bd94, 0x12bd90],
  [0x281d3, 0x12c39c, 0x12c69c],
  [0x0c2e9, 0x12c39c, 0x12c6a0],
  [0x24292, 0x12c39c, 'A3'],
  [0x1d296, 0x12c39c, 0x12c398],
  [0x3b7bb, 0x15c6ac, 0x15c6a8],
  [0x3dd3a, 0x15c6ac, 'A0'],
  [0x52825, 0x15c9b0, 0x15c9ac],
  [0x8bb64, 0x15c9b0, 'A1'],
  [0x9bffb, 0x15ccb0, 'A2'],
  [0x9013e, 0x15ccb0, 0x15cfb0],
  [0xab233, 0x16cfbc, 0x16cfb8],
  [0xa029b, 0x16cfbc, 0x16cfb4],
  [0xaec9f, 0x16d2c4, 0x16d2bc],
  [0xaff29, 0x16d2c4, 0x16d2c0],
  [0xbc0b7, 0x16d8e0, 0x16dbe0],
  [0xb9baf, 0x16d8e0, 0x16d8dc],
];

const PICTURES_AFTER_TABLES = [
  [0xb8d02, 0x16d5dc, 0x16d5d8],
  [0xb0f40, 0x16d5dc, 0x16d5c4],
  [0xb2a23, 0x16d5dc, 0x16d5c8],
  [0xb40eb, 0x16d5dc, 0x16d5cc],
  [0xb79bc, 0x16d5dc, 0x16d5d4],
  [0xb5d3f, 0x16d5dc, 0x16d5d0],
  [0xe3202, 0x16dbe8, 0x16dee8],
  [0x121bde, 0x16dbe8, 0x16def0],
  [0xdef07, 0x16dbe8, 0x16dbe4],
];

/** 0x100317: the work buffer every part renders into (320x200x3 bytes for the -24 mode). */
const WORK_BUFFER = 0x12bd80;
const WORK_BUFFER_SIZE = 0x2ee00;

/** The TGA picture at this offset (0x1000bd) goes to 0x16deec. */
const TGA_OFFSET = 0xf2dcc;
const TGA_GLOBAL = 0x16deec;

/** The animation: 38 blocks between the offsets at 0x128474, and the last one from 0x12850c to here. */
const ANIMATION_OFFSETS = 0x128474;
const ANIMATION_BLOCKS = 0x16def4;
const ANIMATION_FRAMES = 39;
const ANIMATION_END = 0xdef07;
const ANIMATION_BLOCK_SIZE = 0xed8;

/**
 * Four 64 KB pictures copied to fixed addresses (0x100791..0x100804).
 * The pictures themselves are freed.
 */
const INTERLEAVED = [[0x12c6a4, 'A3'], [0x13c6a4, 'A0'], [0x14c6a4, 'A1'], [0x15cfb4, 'A2']];
const INTERLEAVED_SIZE = 0x10000;

function loadPictures(m, list, locals) {
  for (const [offset, palette, to] of list) {
    const block = m.loadPcx(offset, palette);
    if (typeof to === 'string') {
      locals[to] = block;
    } else {
      m.set32(to, block);
    }
  }
}

/**
 * 0x1000bd: a 24-bit TGA (18-byte header: width and height at 12 and 14), bottom-up, turned top-down by swapping
 * lines. Returns the block (width * height * 3 + 1 bytes).
 */
export function loadTga(m, offset) {
  const width = m.dat[offset + 12] | (m.dat[offset + 13] << 8);
  const height = m.dat[offset + 14] | (m.dat[offset + 15] << 8);
  const lineSize = width * 3;
  const block = m.malloc(width * height * 3 + 1);
  m.readDat(offset + 18, width * height * 3, block);
  for (let y = 0; y < height >> 1; y++) {
    const top = block + y * lineSize;
    const bottom = block + (height - 1 - y) * lineSize;
    for (let x = 0; x < lineSize; x++) {
      const t = m.mem[top + x];
      m.mem[top + x] = m.mem[bottom + x];
      m.mem[bottom + x] = t;
    }
  }
  return block;
}

function loadAnimation(m) {
  for (let i = 0; i < ANIMATION_FRAMES; i++) {
    const block = m.malloc(ANIMATION_BLOCK_SIZE);
    const from = m.u32(ANIMATION_OFFSETS + i * 4);
    const to = i === ANIMATION_FRAMES - 1 ? ANIMATION_END : m.u32(ANIMATION_OFFSETS + i * 4 + 4);
    m.set32(ANIMATION_BLOCKS + i * 4, block);
    m.readDat(from, to - from, block);
  }
}

/** @param {import('./machine.js').Machine} m */
export function loadData(m) {
  m.set32(WORK_BUFFER, m.malloc(WORK_BUFFER_SIZE));
  const locals = {};
  loadPictures(m, PICTURES_BEFORE_TABLES, locals);
  buildTables102e40(m);
  buildTables106024(m);
  loadPictures(m, PICTURES_AFTER_TABLES, locals);
  m.set32(TGA_GLOBAL, loadTga(m, TGA_OFFSET));
  buildTables108a58(m);
  loadAnimation(m);
  for (const [to, picture] of INTERLEAVED) {
    m.mem.copyWithin(to, locals[picture], locals[picture] + INTERLEAVED_SIZE);
  }
}
