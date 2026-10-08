// WWPACK decompressor for CONTROL.EXE, read from the original stub.
// Addresses: stub:xxxx is the entry code (image segment 0), dec:xxxx is the
// decompressor after the stub moved it (CS 0x67ec under Unicorn) and fix:xxxx
// is the relocation code it unpacks (CS = load segment + 0x5707).
//
// The output is the memory image from the load segment, as DOS would leave it
// when the program starts at 0000:03d9, including the stub's leftovers: the
// moved stub, its recency table at SS:0 and the words left on its stack.

const PARAGRAPH = 16;
const MZ_SIGNATURE = 0x5a4d;
const PSP_PARAGRAPHS = 0x10;
const DEFAULT_LOAD_SEGMENT = 0x1010;
const MEMORY_SIZE = 0x80000;
const END_OF_SEGMENT_CODE = 0x1ff;
const RECENCY_TABLE_SIZE = 256;
const RECENCY_GENERATION_OFFSET = 0x102;
const RECENCY_GENERATION_RESET = 0xff;
const NORMALISED_OUTPUT_OFFSET = 0xc030;

// Return addresses the decompressor's calls leave on its stack.
const RETURN_AFTER_15_BIT_OFFSET = 0x010b; // call at dec:0108
const RETURN_AFTER_OFFSET_BITS = 0x0122; // call at dec:011f
const RETURN_AFTER_END_CODE_BIT = 0x019b; // call at dec:0198

function readWord(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function writeWord(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}

function readMzHeader(exeBytes) {
  if (exeBytes.length < 0x20 || readWord(exeBytes, 0) !== MZ_SIGNATURE) {
    throw new Error('not an MZ executable');
  }
  const lastPageBytes = readWord(exeBytes, 2);
  const pageCount = readWord(exeBytes, 4);
  return {
    headerBytes: readWord(exeBytes, 8) * PARAGRAPH,
    imageEnd: (pageCount - 1) * 512 + (lastPageBytes || 512),
    stackSegment: readWord(exeBytes, 0x0e),
    stackPointer: readWord(exeBytes, 0x10),
    entryOffset: readWord(exeBytes, 0x14),
    entrySegment: readWord(exeBytes, 0x16),
  };
}

function expectOpcode(bytes, offset, opcode) {
  if (bytes[offset] !== opcode) {
    throw new Error('unrecognised WWPACK stub at ' + offset.toString(16));
  }
}

// The operands the stub's entry code was assembled with (stub:0001..0044).
function readStubParameters(image, header) {
  const entry = header.entrySegment * PARAGRAPH + header.entryOffset;
  expectOpcode(image, entry + 0x00, 0xb8); // mov ax, moved paragraphs - 1
  expectOpcode(image, entry + 0x09, 0x81); // add cx, fix-up code segment
  expectOpcode(image, entry + 0x14, 0x83); // sub bx, decompressor paragraphs below SS
  expectOpcode(image, entry + 0x1d, 0xbe); // mov si, start of the moved block
  expectOpcode(image, entry + 0x36, 0xbe); // mov si, bit stream start in the moved block
  return {
    movedParagraphs: readWord(image, entry + 0x01) + 1,
    fixupSegment: readWord(image, entry + 0x0b),
    movedBlockStart: header.entrySegment * PARAGRAPH + readWord(image, entry + 0x1e),
    streamStartInBlock: readWord(image, entry + 0x37),
  };
}

// The operands of the relocation code (fix:000a..0057), which is part of the
// unpacked output.
function readFixupParameters(memory, fixupStart) {
  expectOpcode(memory, fixupStart + 0x0a, 0xbe); // mov si, relocation list
  expectOpcode(memory, fixupStart + 0x0d, 0xba); // mov dx, subtracted from the load segment
  expectOpcode(memory, fixupStart + 0x10, 0xbf); // mov di, first target
  expectOpcode(memory, fixupStart + 0x13, 0xb9); // mov cx, relocation count
  expectOpcode(memory, fixupStart + 0x47, 0xbc); // mov sp, program SP
  expectOpcode(memory, fixupStart + 0x4a, 0x81); // add dx, program SS
  expectOpcode(memory, fixupStart + 0x54, 0x68); // push program IP
  return {
    listStart: fixupStart + readWord(memory, fixupStart + 0x0b),
    segmentBias: readWord(memory, fixupStart + 0x0e),
    firstTarget: readWord(memory, fixupStart + 0x11),
    count: readWord(memory, fixupStart + 0x14),
    programStackPointer: readWord(memory, fixupStart + 0x48),
    programStackSegment: readWord(memory, fixupStart + 0x4c),
    programEntryOffset: readWord(memory, fixupStart + 0x55),
  };
}

// dec:000a (read CL bits) and dec:003d (read one bit): BP holds the bits MSB
// first, BH counts how many are left, and the next word is fetched as soon as
// BH reaches zero. Literal bytes come from the same stream (dec:004b movsb).
function createBitReader(memory, startOffset) {
  let position = startOffset;
  let bits = readWord(memory, position);
  let bitsLeft = 16;
  let bxAfterRead = 0;
  position += 2;

  function readBit() {
    const bit = (bits >> 15) & 1;
    bits = (bits << 1) & 0xffff;
    bitsLeft -= 1;
    if (bitsLeft === 0) {
      bits = readWord(memory, position);
      position += 2;
      bitsLeft = 16;
    }
    return bit;
  }

  // Also records BX as dec:000a leaves it: BH = bits left, BL = CL, except
  // after a refill in the middle, where BL is the low byte of the new bits.
  function readBits(count) {
    const bitsLeftBefore = bitsLeft;
    let value = 0;
    for (let i = 0; i < count; i++) {
      value = (value << 1) | readBit();
    }
    if (bitsLeftBefore >= count) {
      bxAfterRead = (bitsLeft << 8) | count;
    } else {
      const bitsFromNewWord = count - bitsLeftBefore;
      const newWord = readWord(memory, position - 2);
      bxAfterRead = (bitsLeft << 8) | ((newWord >> (16 - bitsFromNewWord)) & 0xff);
    }
    return value;
  }

  function readByte() {
    const value = memory[position];
    position += 1;
    return value;
  }

  return {
    readBit,
    readBits,
    readByte,
    position: () => position,
    bitRegister: () => bits,
    bxAfterRead: () => bxAfterRead,
  };
}

// dec:00ae: offset of a two-byte match (5, 6, 8 or 9 bits), or null for the
// end-of-segment code 0x1ff.
function readTwoByteMatchOffset(reader) {
  const selector = reader.readBits(2);
  const width = selector >= 2 ? selector + 6 : selector + 5;
  const base = selector >= 2 ? (1 << width) - 0x9f : (1 << width) - 0x1f;
  const value = reader.readBits(width);
  if (value === END_OF_SEGMENT_CODE) {
    return null;
  }
  return value + base;
}

// dec:00e6..0124: offset of a longer match, 5 to 13 bits or 15 bits + 0x3fe1.
// The selector is returned too, as it decides the last return address.
function readLongMatchOffset(reader) {
  const selector = reader.readBits(3);
  if (selector === 7) {
    return { selector, offset: reader.readBits(15) + 0x3fe1 };
  }
  let width = selector + 5;
  if (selector === 3) {
    width = 8 + reader.readBit();
  } else if (selector === 4) {
    width = 10 + reader.readBit();
  } else if (selector > 4) {
    width = selector + 7;
  }
  return { selector, offset: reader.readBits(width) + (1 << width) - 0x1f };
}

// dec:0130..0187: length of a match whose kind is 0.
function readMatchLength(reader) {
  if (reader.readBit() === 0) {
    return 4 + reader.readBit();
  }
  const threeBits = reader.readBits(3);
  if (threeBits !== 0) {
    return threeBits + 5;
  }
  const fourBits = reader.readBits(4);
  if (fourBits !== 0) {
    return fourBits + 12;
  }
  if (reader.readBit() === 1) {
    return reader.readBits(5) + 0x1c;
  }
  if (reader.readBit() === 1) {
    return reader.readBits(6) + 0x3c;
  }
  if (reader.readBit() === 1) {
    return reader.readBits(7) + 0x7c;
  }
  return reader.readBits(14);
}

// dec:0189: rep movsb, byte by byte so overlapping matches repeat.
function copyMatch(memory, output, offset, length) {
  for (let i = 0; i < length; i++) {
    memory[output + i] = memory[output - offset + i];
  }
}

// dec:0074..00ab: walk back through the output and return the (count + 1)th
// distinct byte value. The table at SS:0 marks seen values with the
// generation byte at SS:0x102; generation 0xff clears the table first.
// Returns whether the table was cleared.
function findRecentDistinctByte(memory, output, count, tableStart) {
  const generationAddress = tableStart + RECENCY_GENERATION_OFFSET;
  const isReset = memory[generationAddress] === RECENCY_GENERATION_RESET;
  if (isReset) {
    memory[generationAddress] = 1;
    memory.fill(0, tableStart, tableStart + RECENCY_TABLE_SIZE);
  }
  const generation = memory[generationAddress];
  let remaining = count;
  let position = output;
  let value = 0;
  while (remaining >= 0) {
    position -= 1;
    value = memory[position];
    if (memory[tableStart + value] !== generation) {
      memory[tableStart + value] = generation;
      remaining -= 1;
    }
  }
  memory[generationAddress] = generation + 1;
  return { value, isReset };
}

// Decompresses in place like the stub: the packed block sits below SS and the
// output grows from the load segment. Besides the bytes it returns what the
// decompressor last pushed, so its stack leftovers can be rebuilt.
function decompress(memory, layout) {
  const reader = createBitReader(memory, layout.streamStart);
  let output = 0;
  let inputSegmentBase = layout.movedStart;
  let outputSegmentBase = 0;
  let lastTableReset = null;
  let lastWordAtStack144 = null;
  for (;;) {
    // dec:004c: bit 0 = literal byte
    if (reader.readBit() === 0) {
      memory[output] = reader.readByte();
      output += 1;
      continue;
    }
    const kind = reader.readBits(2);
    if (kind === 3) {
      const offset = readTwoByteMatchOffset(reader);
      if (offset !== null) {
        copyMatch(memory, output, offset, 2);
        output += 2;
        continue;
      }
      // dec:0198: bit 0 = done, 1 = normalise DS:SI and ES:DI (dec:01a0)
      if (reader.readBit() === 0) {
        return { lastTableReset, lastWordAtStack144 };
      }
      inputSegmentBase += (reader.position() - inputSegmentBase) & ~0xf;
      outputSegmentBase += (output - outputSegmentBase - NORMALISED_OUTPUT_OFFSET) & ~0xf;
    } else if (kind === 2) {
      // dec:0064
      const count = reader.readBits(4);
      const found = findRecentDistinctByte(memory, output, count, layout.stackStart);
      if (found.isReset) {
        // dec:0083 pushaw, dec:0084 push es, dec:0085 push ss
        lastTableReset = {
          ax: 0x100 | count,
          cx: reader.bxAfterRead(),
          dx: output - outputSegmentBase,
          bx: 0,
          sp: 0x146,
          bp: reader.bitRegister(),
          si: reader.position() - inputSegmentBase,
          di: output - outputSegmentBase,
          es: layout.loadSegment + outputSegmentBase / PARAGRAPH,
        };
        lastWordAtStack144 = lastTableReset.ax;
      }
      memory[output] = found.value;
      output += 1;
    } else {
      // dec:00e3: kind 1 = three bytes, kind 0 = the length follows;
      // the offset is read with the flags pushed, so calls return via SP 0x144
      const { selector, offset } = readLongMatchOffset(reader);
      lastWordAtStack144 = selector === 7 ? RETURN_AFTER_15_BIT_OFFSET : RETURN_AFTER_OFFSET_BITS;
      const length = kind === 1 ? 3 : readMatchLength(reader);
      copyMatch(memory, output, offset, length);
      output += length;
    }
  }
}

// fix:000a..0042: add the load segment (minus the bias in DX) to each listed word. A list byte is
// the distance to the next target, 0 = a word distance follows, and
// 1 = move 64 KB on and read the next byte.
function applyRelocations(memory, fixup, loadSegment) {
  const relocationDelta = (loadSegment - fixup.segmentBias) & 0xffff;
  let listPosition = fixup.listStart;
  let segmentBase = -fixup.segmentBias * PARAGRAPH;
  let target = fixup.firstTarget;
  for (let i = 0; i < fixup.count; i++) {
    const address = segmentBase + target;
    writeWord(memory, address, readWord(memory, address) + relocationDelta);
    let distance = 0;
    while (distance === 0) {
      const code = memory[listPosition];
      listPosition += 1;
      if (code === 0) {
        distance = readWord(memory, listPosition);
        listPosition += 2;
      } else if (code === 1) {
        segmentBase += 0x10000;
      } else {
        distance = code;
      }
    }
    target += distance;
    if (target > 0xffff) {
      target &= 0xffff;
      segmentBase += 0x10000;
    }
  }
}

// What the stub leaves on its stack at SS:0x132..0x150, newest write last.
function writeStubStackLeftovers(memory, layout, history) {
  const stackWord = (offset, value) => {
    writeWord(memory, layout.stackStart + offset, value);
  };
  const pspSegment = layout.loadSegment - PSP_PARAGRAPHS;
  const reset = history.lastTableReset;
  if (reset !== null) {
    stackWord(0x132, layout.loadSegment + layout.stackSegment); // dec:0085 push ss
    stackWord(0x134, reset.es); // dec:0084 push es
    const pushawOrder = [reset.di, reset.si, reset.bp, reset.sp, reset.bx, reset.dx, reset.cx];
    pushawOrder.forEach((value, index) => {
      stackWord(0x136 + index * 2, value);
    });
  }
  if (history.lastWordAtStack144 !== null) {
    stackWord(0x144, history.lastWordAtStack144);
  }
  stackWord(0x146, RETURN_AFTER_END_CODE_BIT);
  stackWord(0x148, pspSegment); // stub:0011 push es, push es
  stackWord(0x14a, pspSegment);
  stackWord(0x14c, pspSegment); // fix:001e push es, push es
  stackWord(0x14e, pspSegment);
}

// fix:0046..0057: the program's stack gets the far return to its entry point.
function writeProgramEntryFrame(memory, fixup, loadSegment) {
  const stackTop = (fixup.programStackSegment * PARAGRAPH) + fixup.programStackPointer;
  writeWord(memory, stackTop - 2, loadSegment); // fix:0053 push bp
  writeWord(memory, stackTop - 4, fixup.programEntryOffset); // fix:0054 push 03d9
}

export function unpackWwpack(exeBytes, loadSegment = DEFAULT_LOAD_SEGMENT) {
  const header = readMzHeader(exeBytes);
  const image = exeBytes.subarray(header.headerBytes, header.imageEnd);
  const stub = readStubParameters(image, header);
  const memory = new Uint8Array(MEMORY_SIZE);
  memory.set(image, 0);

  // stub:001b..002f: move the stub and packed data up so they end at SS:0
  const stackStart = header.stackSegment * PARAGRAPH;
  const movedStart = stackStart - stub.movedParagraphs * PARAGRAPH;
  memory.copyWithin(movedStart, stub.movedBlockStart, stub.movedBlockStart + stackStart - movedStart);
  // stub:003c: generation 0xff makes the first table use clear the table
  memory[stackStart + RECENCY_GENERATION_OFFSET] = RECENCY_GENERATION_RESET;

  const layout = {
    loadSegment,
    stackSegment: header.stackSegment,
    stackStart,
    movedStart,
    streamStart: movedStart + stub.streamStartInBlock,
  };
  const history = decompress(memory, layout);
  writeStubStackLeftovers(memory, layout, history);

  const fixup = readFixupParameters(memory, stub.fixupSegment * PARAGRAPH);
  applyRelocations(memory, fixup, loadSegment);
  writeProgramEntryFrame(memory, fixup, loadSegment);
  return memory;
}
