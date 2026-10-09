// mylz.js: unpacker for the "MyLZ" stub of GBU.EXE (Surprise! Productions, 1993).
// The stub is LZEXE 0.91 with its "LZ91" signature at MZ offset 0x1c replaced by "MyLZ".
// Addresses below are offsets inside the stub segment (packed file: CS 08be, IP 000e).
//
// unpackGbu(exeBytes) -> { image, relocations, entry: {cs, ip}, stack: {ss, sp} }
//   image:       memory from the load segment up to the stack segment (ss:0) after the stub ran,
//                relocations applied for load segment 0 (i.e. left as they are in the packed
//                stream). The decompressed program is 0x13b8c bytes; the last 4 bytes up to the
//                stack segment 13b9:0000 are leftovers of the packed copy (see memoryAfterStub).
//   relocations: linear offsets (from the image start) of the 16-bit words the stub adds the
//                load segment to
//   entry/stack: relative to the load segment (stub header words at 0000/0002 and 0006/0004)

const MZ_SIGNATURE = 0x5a4d;
const MZ_LAST_PAGE_BYTES = 0x02;
const MZ_PAGE_COUNT = 0x04;
const MZ_HEADER_PARAGRAPHS = 0x08;
const MZ_ENTRY_IP = 0x14;
const MZ_ENTRY_CS = 0x16;
const PACKER_SIGNATURE_OFFSET = 0x1c;
const PACKER_SIGNATURE = 'MyLZ';

// Stub header (stub segment offsets 0000..000d)
const STUB_ORIGINAL_IP = 0x00;
const STUB_ORIGINAL_CS = 0x02;
const STUB_ORIGINAL_SP = 0x04;
const STUB_ORIGINAL_SS = 0x06;
const STUB_PACKED_PARAGRAPHS = 0x08;     // paragraphs of packed data in front of the stub
const STUB_MOVE_PARAGRAPHS = 0x0a;       // 001c/002b..0058: stub and packed data are moved up by this
const STUB_CODE_ENTRY = 0x0e;
const STUB_RELOC_TABLE_MOV = 0xfe;       // "mov si, imm16" (be xx xx): start of the relocation table
const OPCODE_MOV_SI_IMM16 = 0xbe;

const BITS_PER_CONTROL_WORD = 16;
const SHORT_MATCH_BASE_LENGTH = 2;       // 0084..009f: 2-bit length + 2
const LONG_MATCH_BASE_LENGTH = 2;        // 00b7..00ba: 3-bit length + 2
const EXTENDED_MATCH_BASE_LENGTH = 1;    // 00cc..00ce: byte length + 1
const CODE_END_OF_STREAM = 0;            // 00c4
const CODE_SEGMENT_STEP = 1;             // 00c8: stub renormalises es:di / ds:si, no output
const RELOC_CODE_SEGMENT_STEP = 0;       // 0124..012f: word 0 -> next 0xfff paragraphs
const RELOC_CODE_END = 1;                // 0131..0134
const RELOC_SEGMENT_STEP_PARAGRAPHS = 0x0fff;

function readWord(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
}

function parseMzHeader(exeBytes) {
    if (readWord(exeBytes, 0) !== MZ_SIGNATURE) {
        throw new Error('not an MZ executable');
    }
    const lastPageBytes = readWord(exeBytes, MZ_LAST_PAGE_BYTES);
    const pageCount = readWord(exeBytes, MZ_PAGE_COUNT);
    const headerSize = readWord(exeBytes, MZ_HEADER_PARAGRAPHS) * 16;
    const fileImageEnd = lastPageBytes === 0 ? pageCount * 512 : (pageCount - 1) * 512 + lastPageBytes;
    const signature = String.fromCharCode(...exeBytes.subarray(PACKER_SIGNATURE_OFFSET, PACKER_SIGNATURE_OFFSET + 4));
    if (signature !== PACKER_SIGNATURE) {
        throw new Error(`packer signature is "${signature}", expected "${PACKER_SIGNATURE}"`);
    }
    return {
        loadModule: exeBytes.subarray(headerSize, fileImageEnd),
        stubIp: readWord(exeBytes, MZ_ENTRY_IP),
        stubCs: readWord(exeBytes, MZ_ENTRY_CS),
    };
}

function parseStub(loadModule, stubCs, stubIp) {
    const stubStart = stubCs * 16;
    if (stubIp !== STUB_CODE_ENTRY) {
        throw new Error(`unexpected stub entry ip ${stubIp.toString(16)}`);
    }
    const stub = loadModule.subarray(stubStart);
    if (stub[STUB_RELOC_TABLE_MOV] !== OPCODE_MOV_SI_IMM16) {
        throw new Error('unknown stub variant (no "mov si, table" at 00fe)');
    }
    return {
        stub,
        entry: { cs: readWord(stub, STUB_ORIGINAL_CS), ip: readWord(stub, STUB_ORIGINAL_IP) },
        stack: { ss: readWord(stub, STUB_ORIGINAL_SS), sp: readWord(stub, STUB_ORIGINAL_SP) },
        packedLength: readWord(stub, STUB_PACKED_PARAGRAPHS) * 16,
        movedPackedStart: readWord(stub, STUB_MOVE_PARAGRAPHS) * 16,
        relocTableOffset: readWord(stub, STUB_RELOC_TABLE_MOV + 1),
    };
}

// Bit reader of 005f..0084: a 16-bit control word consumed LSB first. The next control word is
// fetched right after the 16th bit is taken (dec dx / jnz), before any byte that follows in the stream.
function createBitReader(packed) {
    let position = 0;
    let controlWord = readWord(packed, 0);
    let bitsLeft = BITS_PER_CONTROL_WORD;
    position = 2;
    return {
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

// Decompressor 0063..00f4 (LZ77 with 8- or 13-bit backward offsets, overlapping byte copies).
function decompress(packed) {
    const output = [];
    const reader = createBitReader(packed);
    for (;;) {
        if (reader.readBit() === 1) {           // 0073: literal byte
            output.push(reader.readByte());
            continue;
        }
        let length;
        let distance;
        if (reader.readBit() === 0) {           // 0086: short match, offset -256..-1
            const high = reader.readBit();
            const low = reader.readBit();
            length = ((high << 1) | low) + SHORT_MATCH_BASE_LENGTH;
            distance = 0x100 - reader.readByte();   // bx = ff00 | byte
        } else {                                // 00a8: long match, 13-bit offset
            const word = reader.readWord();
            const offsetLow = word & 0xff;
            const offsetHigh = ((word >> 8) >> 3) | 0xe0;
            distance = 0x10000 - ((offsetHigh << 8) | offsetLow);
            const shortLength = (word >> 8) & 7;
            if (shortLength !== 0) {
                length = shortLength + LONG_MATCH_BASE_LENGTH;
            } else {
                const code = reader.readByte();     // 00c3
                if (code === CODE_END_OF_STREAM) {
                    break;
                }
                if (code === CODE_SEGMENT_STEP) {
                    continue;
                }
                length = code + EXTENDED_MATCH_BASE_LENGTH;
            }
        }
        const from = output.length - distance;   // 00bb: mov al, es:[bx+di]; stosb (overlap allowed)
        for (let index = 0; index < length; index++) {
            output.push(output[from + index]);
        }
    }
    return Uint8Array.from(output);
}

// Relocation table 0109..0134: bytes b != 0 advance the pointer by b, word w advances it by w
// (w = 0: next 0xfff paragraphs, w = 1: end). The stub adds the load segment at every stop.
function readRelocations(stub, tableOffset) {
    const relocations = [];
    let position = tableOffset;
    let segmentBase = 0;
    let offset = 0;
    for (;;) {
        let advance = stub[position];
        position += 1;
        if (advance === 0) {
            const word = readWord(stub, position);
            position += 2;
            if (word === RELOC_CODE_SEGMENT_STEP) {
                segmentBase += RELOC_SEGMENT_STEP_PARAGRAPHS * 16;
                continue;
            }
            if (word === RELOC_CODE_END) {
                break;
            }
            advance = word;
        }
        offset += advance;                       // 0110..011d: es:di normalised, linear address kept
        relocations.push(segmentBase + offset);
    }
    return relocations;
}

// Before decompressing, 002b..0058 copy the packed data up to load + movedPackedStart; the output
// (written from load:0000) overwrites that copy only up to its own end. Bytes between the end of the
// output and the stack segment therefore still hold packed bytes.
function memoryAfterStub(packed, decompressed, movedPackedStart, stackStart) {
    const memory = new Uint8Array(Math.max(stackStart, decompressed.length));
    memory.set(packed.subarray(0, Math.max(0, Math.min(packed.length, memory.length - movedPackedStart))), movedPackedStart);
    memory.set(decompressed, 0);
    return memory;
}

export function unpackGbu(exeBytes) {
    const { loadModule, stubIp, stubCs } = parseMzHeader(exeBytes);
    const { stub, entry, stack, packedLength, movedPackedStart, relocTableOffset } = parseStub(loadModule, stubCs, stubIp);
    const packed = loadModule.subarray(0, packedLength);
    const decompressed = decompress(packed);
    const image = memoryAfterStub(packed, decompressed, movedPackedStart, stack.ss * 16);
    const relocations = readRelocations(stub, relocTableOffset);
    return { image, relocations, entry, stack };
}
