// pklite.js: unpacker for the PKLITE 1.12 stub of RED.EXE (Razor 1911, 1994).
// "PKLITE Copr. 1990-92", MZ word 0x1c = 0x310c: version 1.12 with the "large" and "extra" flags,
// i.e. the variable-length codes run up to 24 bytes + an escape byte, offsets reach 13 bits, and
// every literal is XORed with the bit counter.
// Addresses below are stub addresses as executed (CS = PSP, entry IP 0100). 0122..0128 copy the
// stub's second half (0144..038f) high and continue there at offset 0000, so the copy's offset X is
// stub address 0144 + X; the code reads its tables as cs:[bx + X].
//
// unpackRed(exeBytes) -> { image, relocations, entry: {cs, ip}, stack: {ss, sp} }
//   image:       the decompressed program (0x8b1ff bytes), as loaded at segment 0; the stub adds
//                the load segment at every relocation, so with load segment 0 nothing changes
//   relocations: linear offsets (from the image start) of the 16-bit words the stub relocates
//   entry/stack: relative to the load segment (the four words after the relocation table)

const MZ_SIGNATURE = 0x5a4d;
const MZ_LAST_PAGE_BYTES = 0x02;
const MZ_PAGE_COUNT = 0x04;
const MZ_HEADER_PARAGRAPHS = 0x08;
const PKLITE_INFO = 0x1c;
const PKLITE_SIGNATURE_OFFSET = 0x1e;
const PKLITE_SIGNATURE = 'PKLITE';
const PKLITE_FLAG_EXTRA = 0x1000;
const PKLITE_FLAG_LARGE = 0x2000;

const STUB_BASE = 0x100;                    // stub address of load module offset 0 (CS = PSP)
const PSP_PARAGRAPHS = 0x10;
const STUB_PACKED_START_ADD = 0x148;        // 0148: add bx, imm8 (83 c3 xx): packed data paragraph, PSP-relative
const STUB_COPY_BASE = 0x144;               // 0144: copied to offset 0000 and run there
// "mov reg8, cs:[bx + table]" (2e 8a xx imm16) of the code tables
const STUB_LENGTH_TABLE_MOV = 0x205;        // 0205: lengths 4..10
const STUB_LARGE_LENGTH_TABLE_MOV = 0x2a4;  // 02a4: lengths 11..15 and the escape
const STUB_LARGER_LENGTH_TABLE_MOV = 0x307; // 0307: lengths 16..24
const STUB_OFFSET_TABLE_MOV = 0x238;        // 0238: offset high bytes 1..13

const BITS_PER_CONTROL_WORD = 16;
const ESCAPE_LENGTH = 0x19;                 // 02a9: length 0x19 + next byte
const ESCAPE_SEGMENT_STEP = 0xfe;           // 02b7: renormalise es:di / ds:si, no output
const ESCAPE_END_OF_STREAM = 0xff;          // 02e2
const SHORT_MATCH_LENGTH = 2;               // 020e: one-byte offset, no offset code
const LONG_OFFSET_CLEAR_BIT = 0xdf;         // 0279: 6-bit code 101110..111111 -> high byte 0e..1f
const RELOC_END = 0xffff;                   // 031a
const RELOC_SEGMENT_STEP_PARAGRAPHS = 0x0fff; // 0329

function readWord(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function parseMzHeader(exeBytes) {
  if (readWord(exeBytes, 0) !== MZ_SIGNATURE) {
    throw new Error('not an MZ executable');
  }
  const signature = String.fromCharCode(...exeBytes.subarray(PKLITE_SIGNATURE_OFFSET, PKLITE_SIGNATURE_OFFSET + 6));
  if (signature !== PKLITE_SIGNATURE) {
    throw new Error(`packer signature is "${signature}", expected "${PKLITE_SIGNATURE}"`);
  }
  const info = readWord(exeBytes, PKLITE_INFO);
  if ((info & (PKLITE_FLAG_EXTRA | PKLITE_FLAG_LARGE)) !== (PKLITE_FLAG_EXTRA | PKLITE_FLAG_LARGE)) {
    throw new Error(`unsupported PKLITE variant ${info.toString(16)} (only large + extra)`);
  }
  const lastPageBytes = readWord(exeBytes, MZ_LAST_PAGE_BYTES);
  const pageCount = readWord(exeBytes, MZ_PAGE_COUNT);
  const headerSize = readWord(exeBytes, MZ_HEADER_PARAGRAPHS) * 16;
  const fileImageEnd = lastPageBytes === 0 ? pageCount * 512 : (pageCount - 1) * 512 + lastPageBytes;
  return exeBytes.subarray(headerSize, fileImageEnd);
}

/** Reads the table a "mov reg8, cs:[bx + table]" at stub address `at` indexes, from the load module. */
function stubTable(loadModule, at) {
  const tableInCopy = readWord(loadModule, at - STUB_BASE + 3);
  return loadModule.subarray(STUB_COPY_BASE + tableInCopy - STUB_BASE);
}

function parseStub(loadModule) {
  const packedParagraph = loadModule[STUB_PACKED_START_ADD - STUB_BASE + 2];
  return {
    packed: loadModule.subarray((packedParagraph - PSP_PARAGRAPHS) * 16),
    lengthTable: stubTable(loadModule, STUB_LENGTH_TABLE_MOV),
    largeLengthTable: stubTable(loadModule, STUB_LARGE_LENGTH_TABLE_MOV),
    largerLengthTable: stubTable(loadModule, STUB_LARGER_LENGTH_TABLE_MOV),
    offsetTable: stubTable(loadModule, STUB_OFFSET_TABLE_MOV),
  };
}

// Bit reader of 01c4.. (shr bp, 1 / dec dx / jz reload): a 16-bit control word consumed LSB first,
// the next one fetched right after the 16th bit is taken. dl, the bits left after the read
// (16 after a reload), is the key the literals are XORed with (01c1).
function createBitReader(packed) {
  let position = 2;
  let controlWord = readWord(packed, 0);
  let bitsLeft = BITS_PER_CONTROL_WORD;
  return {
    get position() {
      return position;
    },
    get bitsLeft() {
      return bitsLeft;
    },
    readBit() {
      const bit = controlWord & 1;
      controlWord >>= 1;
      bitsLeft -= 1;
      if (bitsLeft === 0) {
        controlWord = readWord(packed, position);
        position += 2;
        bitsLeft = BITS_PER_CONTROL_WORD;
      }
      return bit;
    },
    /** rcl bx, 1 with the next bit. */
    shiftIn(value) {
      return (value << 1) | this.readBit();
    },
    readByte() {
      const value = packed[position];
      position += 1;
      return value;
    },
    readWord() {
      const value = readWord(packed, position);
      position += 2;
      return value;
    },
  };
}

// 0281..0307: codes 01101..01111 continue with 1-2 more bits; 0x19 escapes to a byte.
// Returns the match length, or the escape byte (fe/ff) as a negative number.
function readLargeLength(reader, tables, code) {
  let index = reader.shiftIn(code & 3);
  if (index >= 5) {
    index = reader.shiftIn(index);
  }
  if (index > 12) {                       // 02e9
    index = reader.shiftIn(index & 3);
    if (index >= 5) {
      index = reader.shiftIn(index);
    }
    return tables.largerLengthTable[index];
  }
  const length = tables.largeLengthTable[index];
  if (length !== ESCAPE_LENGTH) {
    return length;
  }
  const extra = reader.readByte();        // 02b1
  return extra >= ESCAPE_SEGMENT_STEP ? -extra : ESCAPE_LENGTH + extra;
}

// 01cb..0205: the length code, bits read MSB first into bx.
function readLength(reader, tables) {
  let code = reader.shiftIn(reader.shiftIn(0));
  if (code >= 2) {                        // 01e0: 1x -> 2, 3
    return code;
  }
  code = reader.shiftIn(code);
  if (code !== 0) {
    code = reader.shiftIn(code);
    if (code >= 5) {
      code = reader.shiftIn(code);
      if (code > 12) {                // 0203
        return readLargeLength(reader, tables, code);
      }
    }
  }
  return tables.lengthTable[code];        // 0205
}

// 020c..023d: high byte of the offset (none for length 2), then the low byte.
function readDistance(reader, tables, length) {
  let high = 0;
  if (length !== SHORT_MATCH_LENGTH && reader.readBit() === 0) {
    let code = reader.shiftIn(reader.shiftIn(reader.shiftIn(0)));
    if (code >= 2) {
      code = reader.shiftIn(code);
      if (code >= 8) {
        code = reader.shiftIn(code);
        if (code >= 0x17) {
          code = reader.shiftIn(code);
        }
      }
    }
    high = code >= 0x17 ? code & LONG_OFFSET_CLEAR_BIT : tables.offsetTable[code];
  }
  return (high << 8) | reader.readByte();
}

// Decompressor 0183..030f. Returns the output and where the stream continues (the relocation table).
function decompress(packed, tables) {
  const output = [];
  const reader = createBitReader(packed);
  for (;;) {
    if (reader.readBit() === 0) {       // 01c0: literal, xor al, dl
      output.push(reader.readByte() ^ reader.bitsLeft);
      continue;
    }
    const length = readLength(reader, tables);
    if (length === -ESCAPE_END_OF_STREAM) {
      break;
    }
    if (length === -ESCAPE_SEGMENT_STEP) {
      continue;
    }
    const from = output.length - readDistance(reader, tables, length);
    for (let index = 0; index < length; index++) {  // 0246: rep movsb, overlap allowed
      output.push(output[from + index]);
    }
  }
  return { image: Uint8Array.from(output), end: reader.position };
}

// 030f..0351: groups of (count, count offsets) in segments 0, 0fff, 1ffe, ...; count ffff ends the
// table; then ss, sp, cs, ip relative to the load segment.
function readRelocationsAndEntry(packed, position) {
  const relocations = [];
  let at = position;
  let segment = 0;
  const next = () => {
    const value = readWord(packed, at);
    at += 2;
    return value;
  };
  for (let count = next(); count !== RELOC_END; count = next()) {
    if (count === 0) {
      continue;
    }
    for (let index = 0; index < count; index++) {
      relocations.push(segment * 16 + next());
    }
    segment += RELOC_SEGMENT_STEP_PARAGRAPHS;
  }
  const stack = { ss: next(), sp: next() };
  const entry = { cs: next(), ip: next() };
  return { relocations, entry, stack };
}

export function unpackRed(exeBytes) {
  const loadModule = parseMzHeader(exeBytes);
  const { packed, ...tables } = parseStub(loadModule);
  const { image, end } = decompress(packed, tables);
  return { image, ...readRelocationsAndEntry(packed, end) };
}
