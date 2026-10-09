// The ProTracker 2.x replay routine each part carries ("mt_init / mt_music / mt_end"), ported instruction by
// instruction. Parts call these exactly where the original does `jsr mt_init` / `jsr mt_music` / `jsr mt_end`.
//
// Like the original, the routine keeps ALL its state in chip RAM, at the addresses of the copy being run: the
// four channel structures, the sample-start table and the song variables. Part 2's oscilloscopes read the
// channel structures directly. Nothing is cached in JavaScript between calls.
//
// Two code variants (docs/disassembly/replayer.md):
//  - parts 1 and 3: the same code, relocated; channel structures $2c bytes apart; mt_init clears the first
//    long of every sample (ProTracker's "silent loop" for one-shot samples).
//  - part 2: channel structures $30 apart; mt_init does NOT clear the sample starts; mt_playvoice keeps a
//    "new sample on this row" word at +$2a of each channel (0 or 1).
// Everything else, including ProTracker 2.x's own quirks (the tone-portamento table stride of $4a, tremolo
// ramp reading the vibrato position, ...), is the same and is ported as it is.
//
// Verified against the original code run under a 68000 emulator: test/replayer.test.js.

import { r8, r16, r32, w8, w16, w32, s8, s16, LINE_MS, PAL_CLOCK } from './machine.js';
import { custom, custom32 } from './display.js';
import { setPaulaCursor, delayPaula, setLedFilter } from './paula.js';

/**
 * @typedef {object} Replayer  One copy of the replay routine: where its code (for reference) and data live.
 * @property {number} init         mt_init (reference only)
 * @property {number} music        mt_music (reference only)
 * @property {number} end          mt_end (reference only)
 * @property {number} module       the ProTracker module ("M.K." at +$438)
 * @property {number} channels     the first of the four channel structures (mt_chan1temp)
 * @property {number} channelBytes distance between channel structures
 * @property {number} sampleStarts 31 longs: where each sample's data starts (mt_SampleStarts)
 * @property {number} variables    mt_SongDataPtr; the song variables follow it (see VAR below)
 * @property {number} sampleInfos  32 longs: module + 12 + 30 n (written by mt_init, read by nobody)
 * @property {number} funkTable    mt_FunkTable, 16 bytes
 * @property {number} vibratoTable mt_VibratoTable, 32 bytes
 * @property {number} periodTable  mt_PeriodTable, 16 finetunes x 36 words
 * @property {boolean} isSampleStartCleared  mt_init does `clr.l (a2)` on every sample start
 * @property {boolean} hasTriggerFlag        mt_playvoice keeps the +$2a "sample triggered" word
 * @property {number} musicLine    the raster line at which the part calls mt_music (sub-frame audio timing)
 */

/** Part 1 ($a500): code $bbf6-$c752, data $c752-$cdc0, module "introbit". Called from the copper interrupt at line $c2. */
export const PART1_REPLAYER = {
  init: 0xbbf6, music: 0xbcac, end: 0xbc8a, module: 0xcdc0,
  channels: 0xcc02, channelBytes: 0x2c, sampleStarts: 0xccb2, variables: 0xcd2e, sampleInfos: 0xcd40,
  funkTable: 0xc752, vibratoTable: 0xc762, periodTable: 0xc782,
  isSampleStartCleared: true, hasTriggerFlag: false, musicLine: 0xc2,
};
/**
 * Part 2: the variant, code $65640-$661a4, module "happy-answer". mt_music ($656f4) is called from the tail of
 * the copper interrupt ($d96a) after waiting for line $e8.
 */
export const PART2_REPLAYER = {
  init: 0x65640, music: 0x656f4, end: 0x656d2, module: 0x66822,
  channels: 0x66654, channelBytes: 0x30, sampleStarts: 0x66714, variables: 0x66790, sampleInfos: 0x667a2,
  funkTable: 0x661a4, vibratoTable: 0x661b4, periodTable: 0x661d4,
  isSampleStartCleared: false, hasTriggerFlag: true, musicLine: 0xe8,
};
/**
 * Part 3: part 1's code moved up by $1f1e, module "in-the-bag" (not next to the code). mt_music ($dbca) is
 * called from the interrupt ($a824) after waiting for line $fd.
 */
export const PART3_REPLAYER = {
  init: 0xdb14, music: 0xdbca, end: 0xdba8, module: 0x112ee,
  channels: 0xeb20, channelBytes: 0x2c, sampleStarts: 0xebd0, variables: 0xec4c, sampleInfos: 0xec5e,
  funkTable: 0xe670, vibratoTable: 0xe680, periodTable: 0xe6a0,
  isSampleStartCleared: true, hasTriggerFlag: false, musicLine: 0xfd,
};

/** The song variables, as offsets from mt_SongDataPtr. */
const VAR = {
  songDataPtr: 0, speed: 4, counter: 5, songPos: 6, pBreakPos: 7, posJumpFlag: 8, pBreakFlag: 9,
  lowMask: 10, pattDelTime: 11, pattDelTime2: 12, patternPos: 14, dmaconTemp: 16,
};
/** A channel structure (mt_chanXtemp). */
const CH = {
  note: 0x00, cmd: 0x02, cmdLo: 0x03, start: 0x04, length: 0x08, loopStart: 0x0a, replen: 0x0e, period: 0x10,
  finetune: 0x12, volume: 0x13, dmaBit: 0x14, tonePortDirec: 0x16, tonePortSpeed: 0x17, wantedPeriod: 0x18,
  vibratoCmd: 0x1a, vibratoPos: 0x1b, tremoloCmd: 0x1c, tremoloPos: 0x1d, waveControl: 0x1e, glissFunk: 0x1f,
  sampleOffset: 0x20, pattPos: 0x21, loopCount: 0x22, funkOffset: 0x23, waveStart: 0x24, realLength: 0x28,
  triggered: 0x2a,
};
/** Module layout. */
const MOD = { sampleInfo: 0x0c, sampleRecord: 30, songLength: 0x3b6, positions: 0x3b8, patterns: 0x43c };
const SAMPLE = { length: 0, finetune: 2, volume: 3, repeat: 4, replen: 6 };
const PERIODS_PER_FINETUNE = 36;
const FINETUNE_ROW_BYTES = PERIODS_PER_FINETUNE * 2;
/** mt_SetTonePorta's row stride: `mulu #37*2` against a 36-entry table, ProTracker 2.x's own bug. */
const TONE_PORTA_ROW_BYTES = 0x4a;
const LAST_PERIOD_OFFSET = 0x46;
const PATTERN_BYTES = 0x400;
const ROW_BYTES = 0x10;
const PATTERN_END = 0x400;
const MAX_VOLUME = 0x40;
const MIN_PERIOD = 0x71;
const MAX_PERIOD = 0x358;
const AUDIO_REGS = 0xa0;
const AUDIO_CHANNEL_REGS = 0x10;
const AUD = { lc: 0, len: 4, per: 6, vol: 8 };
const DMACON = 0x96;
const DMA_SET = 0x8000;
/**
 * `move.w #$118,d0 / dbra d0,*`: the wait between DMACON off and on (and on and the loop registers). 281
 * taken dbras (10 cycles) and the fall-through (14) at 7.09 MHz, about 6 raster lines.
 */
const DMA_WAIT_CYCLES = 0x118 * 10 + 14 + 8;
const CPU_CLOCK = PAL_CLOCK * 2;
export const DMA_WAIT_MS = (DMA_WAIT_CYCLES * 1000) / CPU_CLOCK;

const byte = (v) => v & 0xff;
const word = (v) => v & 0xffff;

const getVar8 = (m, R, name) => r8(m, R.variables + VAR[name]);
const setVar8 = (m, R, name, value) => w8(m, R.variables + VAR[name], byte(value));
const getVar16 = (m, R, name) => r16(m, R.variables + VAR[name]);
const setVar16 = (m, R, name, value) => w16(m, R.variables + VAR[name], word(value));

/** A channel structure (a6) and its audio registers (a5, as an offset from $dff000). */
function channel(R, index) {
  return { a6: R.channels + index * R.channelBytes, a5: AUDIO_REGS + index * AUDIO_CHANNEL_REGS };
}

const c8 = (m, c, field) => r8(m, c.a6 + CH[field]);
const c16 = (m, c, field) => r16(m, c.a6 + CH[field]);
const c32 = (m, c, field) => r32(m, c.a6 + CH[field]);
const set8 = (m, c, field, value) => w8(m, c.a6 + CH[field], byte(value));
const set16 = (m, c, field, value) => w16(m, c.a6 + CH[field], word(value));
const set32 = (m, c, field, value) => w32(m, c.a6 + CH[field], value >>> 0);
const audio = (m, c, reg, value) => custom(m, c.a5 + AUD[reg], value);

// ---------------------------------------------------------------------------------------------------------
// mt_init, mt_end

/** mt_init: sample starts from the module, speed 6, LED filter off, volumes 0, song position 0. */
export function mtInit(m, R) {
  const module = R.module;
  w32(m, R.variables + VAR.songDataPtr, module);
  for (let i = 0; i < 32; i++) {
    w32(m, R.sampleInfos + i * 4, module + MOD.sampleInfo + i * MOD.sampleRecord);
  }
  // The highest pattern number in the position list (`cmp.b / ble`: a signed byte compare).
  let highest = 0;
  for (let i = 0; i < 128; i++) {
    const pattern = r8(m, module + MOD.positions + i);
    if (s8(pattern) > s8(highest)) {
      highest = pattern;
    }
  }
  let sample = module + MOD.patterns + (highest + 1) * PATTERN_BYTES;
  for (let i = 0; i < 31; i++) {
    if (R.isSampleStartCleared) {
      w32(m, sample, 0);
    }
    w32(m, R.sampleStarts + i * 4, sample);
    sample += r16(m, module + 0x2a + i * MOD.sampleRecord) * 2;
  }
  setVar8(m, R, 'speed', 6);
  setLedFilter(m, false);
  for (let i = 0; i < 4; i++) {
    audio(m, channel(R, i), 'vol', 0);
  }
  setVar8(m, R, 'songPos', 0);
  setVar8(m, R, 'counter', 0);
  setVar16(m, R, 'patternPos', 0);
}

/** mt_end: volumes 0, audio DMA off. */
export function mtEnd(m, R) {
  for (let i = 0; i < 4; i++) {
    audio(m, channel(R, i), 'vol', 0);
  }
  custom(m, DMACON, 0x000f);
}

// ---------------------------------------------------------------------------------------------------------
// mt_music

/** mt_music: one tick. A new row every `speed` ticks, the running effects on the others. */
export function mtMusic(m, R) {
  setPaulaCursor(m, R.musicLine * LINE_MS);
  setVar8(m, R, 'counter', getVar8(m, R, 'counter') + 1);
  if (getVar8(m, R, 'counter') < getVar8(m, R, 'speed')) {
    noNewAllChannels(m, R);
    checkPositionJump(m, R);
    return;
  }
  setVar8(m, R, 'counter', 0);
  if (getVar8(m, R, 'pattDelTime2')) {
    noNewAllChannels(m, R);
    afterRow(m, R);
    return;
  }
  getNewNote(m, R);
}

/** mt_NoNewAllChannels: the per-tick effects of each channel. */
function noNewAllChannels(m, R) {
  for (let i = 0; i < 4; i++) {
    checkEfx(m, R, channel(R, i));
  }
}

/** mt_GetNewNote: read one row of the current pattern, start the notes, then the DMA dance. */
function getNewNote(m, R) {
  const module = r32(m, R.variables + VAR.songDataPtr);
  const pattern = r8(m, module + MOD.positions + getVar8(m, R, 'songPos'));
  // `asl.l #8 / asl.l #2 / add.w mt_PatternPos,d1`: the add is a word add.
  let d1 = pattern << 10;
  d1 = (d1 & 0xffff0000) | word(d1 + getVar16(m, R, 'patternPos'));
  setVar16(m, R, 'dmaconTemp', 0);
  const patterns = module + MOD.patterns;
  for (let i = 0; i < 4; i++) {
    playVoice(m, R, channel(R, i), patterns + d1, module + MOD.sampleInfo);
    d1 += 4;
  }
  setDma(m, R);
}

/** mt_PlayVoice: one channel's note. `row` = a0+d1, `infos` = a3 (module + 12). */
function playVoice(m, R, c, row, infos) {
  if (c32(m, c, 'note') === 0) {
    audio(m, c, 'per', c16(m, c, 'period'));
  }
  set32(m, c, 'note', r32(m, row));
  const number = (c8(m, c, 'cmd') >> 4) | (c8(m, c, 'note') & 0xf0);
  if (R.hasTriggerFlag) {
    set16(m, c, 'triggered', 0);
  }
  if (number) {
    if (R.hasTriggerFlag) {
      set16(m, c, 'triggered', 1);
    }
    const info = infos + number * MOD.sampleRecord;
    set32(m, c, 'start', r32(m, R.sampleStarts + (number - 1) * 4));
    set16(m, c, 'length', r16(m, info + SAMPLE.length));
    set16(m, c, 'realLength', r16(m, info + SAMPLE.length));
    set8(m, c, 'finetune', r8(m, info + SAMPLE.finetune));
    set8(m, c, 'volume', r8(m, info + SAMPLE.volume));
    const repeat = r16(m, info + SAMPLE.repeat);
    if (repeat) {
      const loopStart = (c32(m, c, 'start') + word(repeat << 1)) >>> 0;
      set32(m, c, 'loopStart', loopStart);
      set32(m, c, 'waveStart', loopStart);
      set16(m, c, 'length', repeat + r16(m, info + SAMPLE.replen));
    } else {
      set32(m, c, 'loopStart', c32(m, c, 'start'));
      set32(m, c, 'waveStart', c32(m, c, 'start'));
    }
    set16(m, c, 'replen', r16(m, info + SAMPLE.replen));
    audio(m, c, 'vol', c8(m, c, 'volume'));
  }
  setRegisters(m, R, c);
}

/** mt_SetRegs ($be12): a note on this row starts the sample, unless a portamento or a note delay holds it. */
function setRegisters(m, R, c) {
  if ((c16(m, c, 'note') & 0xfff) === 0) {
    checkMoreEfx(m, R, c);
    return;
  }
  const command = c16(m, c, 'cmd') & 0xff0;
  if (command === 0xe50) {
    setFinetune(m, c);
  } else {
    const effect = c8(m, c, 'cmd') & 0xf;
    if (effect === 3 || effect === 5) {
      setTonePorta(m, R, c);
      checkMoreEfx(m, R, c);
      return;
    }
    if (effect === 9) {
      checkMoreEfx(m, R, c);
    }
  }
  setPeriod(m, R, c);
}

/** mt_SetPeriod ($be58): the note's period in the channel's finetune row, then DMA off and the sample. */
function setPeriod(m, R, c) {
  const note = c16(m, c, 'note') & 0xfff;
  let offset = 0;
  // `cmp.w (a1,d0.w),d1 / bhs`, 37 times (dbra from $24): finds the first period not above the note's.
  for (let count = 0; count <= 0x24; count++) {
    if (note >= r16(m, R.periodTable + offset)) {
      break;
    }
    offset += 2;
  }
  const row = R.periodTable + c8(m, c, 'finetune') * FINETUNE_ROW_BYTES;
  set16(m, c, 'period', r16(m, row + offset));
  if ((c16(m, c, 'cmd') & 0xff0) === 0xed0) {
    checkMoreEfx(m, R, c);
    return;
  }
  custom(m, DMACON, c16(m, c, 'dmaBit'));
  if (!(c8(m, c, 'waveControl') & 0x04)) {
    set8(m, c, 'vibratoPos', 0);
  }
  if (!(c8(m, c, 'waveControl') & 0x40)) {
    set8(m, c, 'tremoloPos', 0);
  }
  custom32(m, c.a5 + AUD.lc, c32(m, c, 'start'));
  audio(m, c, 'len', c16(m, c, 'length'));
  audio(m, c, 'per', c16(m, c, 'period'));
  setVar16(m, R, 'dmaconTemp', getVar16(m, R, 'dmaconTemp') | c16(m, c, 'dmaBit'));
  checkMoreEfx(m, R, c);
}

/** mt_SetDMA ($bedc): wait, the new channels' DMA on, wait, then their loop pointers (channel 4 first). */
function setDma(m, R) {
  delayPaula(m, DMA_WAIT_MS);
  custom(m, DMACON, getVar16(m, R, 'dmaconTemp') | DMA_SET);
  delayPaula(m, DMA_WAIT_MS);
  for (let i = 3; i >= 0; i--) {
    const c = channel(R, i);
    custom32(m, c.a5 + AUD.lc, c32(m, c, 'loopStart'));
    audio(m, c, 'len', c16(m, c, 'replen'));
  }
  afterRow(m, R);
}

/** mt_dskip ($bf40): next row; pattern delay; pattern break; the end of the pattern. */
function afterRow(m, R) {
  setVar16(m, R, 'patternPos', getVar16(m, R, 'patternPos') + ROW_BYTES);
  const delay = getVar8(m, R, 'pattDelTime');
  if (delay) {
    setVar8(m, R, 'pattDelTime2', delay);
    setVar8(m, R, 'pattDelTime', 0);
  }
  if (getVar8(m, R, 'pattDelTime2')) {
    setVar8(m, R, 'pattDelTime2', getVar8(m, R, 'pattDelTime2') - 1);
    if (getVar8(m, R, 'pattDelTime2')) {
      setVar16(m, R, 'patternPos', getVar16(m, R, 'patternPos') - ROW_BYTES);
    }
  }
  if (getVar8(m, R, 'pBreakFlag')) {
    setVar8(m, R, 'pBreakFlag', 0);
    const position = getVar8(m, R, 'pBreakPos');
    setVar8(m, R, 'pBreakPos', 0);
    setVar16(m, R, 'patternPos', position << 4);
  }
  if (getVar16(m, R, 'patternPos') >= PATTERN_END) {
    nextPosition(m, R);
  }
  checkPositionJump(m, R);
}

/** mt_NextPosition ($bfa0): the row to start at, and the next song position (from 0 after the last). */
function nextPosition(m, R) {
  setVar16(m, R, 'patternPos', getVar8(m, R, 'pBreakPos') << 4);
  setVar8(m, R, 'pBreakPos', 0);
  setVar8(m, R, 'posJumpFlag', 0);
  setVar8(m, R, 'songPos', (getVar8(m, R, 'songPos') + 1) & 0x7f);
  const module = r32(m, R.variables + VAR.songDataPtr);
  if (getVar8(m, R, 'songPos') >= r8(m, module + MOD.songLength)) {
    setVar8(m, R, 'songPos', 0);
  }
}

/** mt_NoNewPosYet ($bfdc): a position jump or pattern break asked for on this row. */
function checkPositionJump(m, R) {
  while (getVar8(m, R, 'posJumpFlag')) {
    nextPosition(m, R);
  }
}

// ---------------------------------------------------------------------------------------------------------
// The per-tick effects (mt_CheckEfx)

/** mt_CheckEfx ($bfe6). */
function checkEfx(m, R, c) {
  updateFunk(m, R, c);
  if ((c16(m, c, 'cmd') & 0xfff) === 0) {
    audio(m, c, 'per', c16(m, c, 'period'));
    return;
  }
  const effect = c8(m, c, 'cmd') & 0xf;
  switch (effect) {
    case 0x0: arpeggio(m, R, c); return;
    case 0x1: portaUp(m, R, c); return;
    case 0x2: portaDown(m, R, c); return;
    case 0x3: tonePortamento(m, R, c); return;
    case 0x4: vibrato(m, R, c); return;
    case 0x5: tonePortNoChange(m, R, c); volumeSlide(m, c); return;
    case 0x6: vibrato2(m, R, c); volumeSlide(m, c); return;
    case 0xe: eCommands(m, R, c); return;
    default: break;
  }
  audio(m, c, 'per', c16(m, c, 'period'));
  if (effect === 0x7) {
    tremolo(m, R, c);
  } else if (effect === 0xa) {
    volumeSlide(m, c);
  }
}

/** mt_Arpeggio ($c056): the note, +x, +y semitones on ticks 0, 1, 2 (mod 3). */
function arpeggio(m, R, c) {
  const phase = getVar8(m, R, 'counter') % 3;
  if (phase === 0) {
    audio(m, c, 'per', c16(m, c, 'period'));
    return;
  }
  const semitones = phase === 1 ? c8(m, c, 'cmdLo') >> 4 : c8(m, c, 'cmdLo') & 0xf;
  let table = R.periodTable + c8(m, c, 'finetune') * FINETUNE_ROW_BYTES;
  const period = c16(m, c, 'period');
  // `move.w (a0,d0.w),d2 / cmp.w (a0),d1 / bhs`: find the note, take the one `semitones` further on.
  for (let count = 0; count <= 0x24; count++) {
    const shifted = r16(m, table + semitones * 2);
    if (period >= r16(m, table)) {
      audio(m, c, 'per', shifted);
      return;
    }
    table += 2;
  }
}

/** mt_FinePortaUp ($c0ba): on tick 0 only, the low nibble only. */
function finePortaUp(m, R, c) {
  if (getVar8(m, R, 'counter')) {
    return;
  }
  setVar8(m, R, 'lowMask', 0x0f);
  portaUp(m, R, c);
}

/** mt_PortaUp ($c0ca): the period down, to $71 at the least. */
function portaUp(m, R, c) {
  const amount = c8(m, c, 'cmdLo') & getVar8(m, R, 'lowMask');
  setVar8(m, R, 'lowMask', 0xff);
  set16(m, c, 'period', c16(m, c, 'period') - amount);
  if ((c16(m, c, 'period') & 0xfff) < MIN_PERIOD) {
    set16(m, c, 'period', (c16(m, c, 'period') & 0xf000) | MIN_PERIOD);
  }
  audio(m, c, 'per', c16(m, c, 'period') & 0xfff);
}

/** mt_FinePortaDown ($c108). */
function finePortaDown(m, R, c) {
  if (getVar8(m, R, 'counter')) {
    return;
  }
  setVar8(m, R, 'lowMask', 0x0f);
  portaDown(m, R, c);
}

/** mt_PortaDown ($c11a): the period up, to $358 at the most. */
function portaDown(m, R, c) {
  const amount = c8(m, c, 'cmdLo') & getVar8(m, R, 'lowMask');
  setVar8(m, R, 'lowMask', 0xff);
  set16(m, c, 'period', c16(m, c, 'period') + amount);
  if ((c16(m, c, 'period') & 0xfff) >= MAX_PERIOD) {
    set16(m, c, 'period', (c16(m, c, 'period') & 0xf000) | MAX_PERIOD);
  }
  audio(m, c, 'per', c16(m, c, 'period') & 0xfff);
}

/** mt_SetTonePorta ($c158): the period to slide to, and which way. Rows are $4a apart here (sic). */
function setTonePorta(m, R, c) {
  const note = c16(m, c, 'note') & 0xfff;
  const table = R.periodTable + c8(m, c, 'finetune') * TONE_PORTA_ROW_BYTES;
  let offset = 0;
  while (note < r16(m, table + offset)) {
    offset += 2;
    if (offset >= TONE_PORTA_ROW_BYTES) {
      offset = LAST_PERIOD_OFFSET;
      break;
    }
  }
  if ((c8(m, c, 'finetune') & 0x08) && offset) {
    offset -= 2;
  }
  const wanted = r16(m, table + offset);
  set16(m, c, 'wantedPeriod', wanted);
  const period = c16(m, c, 'period');
  set8(m, c, 'tonePortDirec', 0);
  if (wanted === period) {
    set16(m, c, 'wantedPeriod', 0);
    return;
  }
  if (s16(wanted) < s16(period)) {
    set8(m, c, 'tonePortDirec', 1);
  }
}

/** mt_TonePortamento ($c1ba): a new speed if given (the command byte is then cleared in the structure). */
function tonePortamento(m, R, c) {
  const speed = c8(m, c, 'cmdLo');
  if (speed) {
    set8(m, c, 'tonePortSpeed', speed);
    set8(m, c, 'cmdLo', 0);
  }
  tonePortNoChange(m, R, c);
}

/** mt_TonePortNoChange ($c1c8): slide towards the wanted period; with glissando, round to a semitone. */
function tonePortNoChange(m, R, c) {
  if (c16(m, c, 'wantedPeriod') === 0) {
    return;
  }
  const speed = c8(m, c, 'tonePortSpeed');
  const wanted = s16(c16(m, c, 'wantedPeriod'));
  if (c8(m, c, 'tonePortDirec') === 0) {
    set16(m, c, 'period', c16(m, c, 'period') + speed);
    if (!(wanted > s16(c16(m, c, 'period')))) {
      set16(m, c, 'period', c16(m, c, 'wantedPeriod'));
      set16(m, c, 'wantedPeriod', 0);
    }
  } else {
    set16(m, c, 'period', c16(m, c, 'period') - speed);
    if (!(wanted < s16(c16(m, c, 'period')))) {
      set16(m, c, 'period', c16(m, c, 'wantedPeriod'));
      set16(m, c, 'wantedPeriod', 0);
    }
  }
  let period = c16(m, c, 'period');
  if (c8(m, c, 'glissFunk') & 0x0f) {
    const table = R.periodTable + c8(m, c, 'finetune') * FINETUNE_ROW_BYTES;
    let offset = 0;
    while (period < r16(m, table + offset)) {
      offset += 2;
      if (offset >= FINETUNE_ROW_BYTES) {
        offset = LAST_PERIOD_OFFSET;
        break;
      }
    }
    period = r16(m, table + offset);
  }
  audio(m, c, 'per', period);
}

/** The vibrato and tremolo depth for a position: sine table, ramp (which reads `rampPosition`) or square. */
function waveform(m, R, waveType, position, rampPosition) {
  const index = (position >> 2) & 0x1f;
  if (waveType === 0) {
    return r8(m, R.vibratoTable + index);
  }
  const ramp = byte(index << 3);
  if (waveType === 1) {
    return s8(rampPosition) >= 0 ? ramp : byte(0xff - ramp);
  }
  return 0xff;
}

/** A new speed (high nibble) and/or depth (low nibble) for a vibrato or tremolo, kept at `field`. */
function updateWaveCommand(m, c, field) {
  const parameter = c8(m, c, 'cmdLo');
  if (!parameter) {
    return;
  }
  let value = c8(m, c, field);
  if (parameter & 0x0f) {
    value = (value & 0xf0) | (parameter & 0x0f);
  }
  if (parameter & 0xf0) {
    value = (value & 0x0f) | (parameter & 0xf0);
  }
  set8(m, c, field, value);
}

/** mt_Vibrato ($c248). */
function vibrato(m, R, c) {
  updateWaveCommand(m, c, 'vibratoCmd');
  vibrato2(m, R, c);
}

/** mt_Vibrato2 ($c272): period +- depth x wave / 128, then the position moves on by the speed x 4. */
function vibrato2(m, R, c) {
  const position = c8(m, c, 'vibratoPos');
  const depth = waveform(m, R, c8(m, c, 'waveControl') & 3, position, position);
  const amount = ((depth * (c8(m, c, 'vibratoCmd') & 0xf)) & 0xffff) >> 7;
  const period = c16(m, c, 'period');
  audio(m, c, 'per', word(s8(position) >= 0 ? period + amount : period - amount));
  set8(m, c, 'vibratoPos', position + ((c8(m, c, 'vibratoCmd') >> 2) & 0x3c));
}

/** mt_Tremolo ($c2ee): volume +- depth x wave / 64, clamped to 0-64. Its ramp tests the VIBRATO position. */
function tremolo(m, R, c) {
  updateWaveCommand(m, c, 'tremoloCmd');
  const position = c8(m, c, 'tremoloPos');
  const depth = waveform(m, R, (c8(m, c, 'waveControl') >> 4) & 3, position, c8(m, c, 'vibratoPos'));
  const amount = ((depth * (c8(m, c, 'tremoloCmd') & 0xf)) & 0xffff) >> 6;
  const volume = c8(m, c, 'volume');
  let result = word(s8(position) >= 0 ? volume + amount : volume - amount);
  if (result & 0x8000) {
    result = 0;
  }
  if (result > MAX_VOLUME) {
    result = MAX_VOLUME;
  }
  audio(m, c, 'vol', result);
  set8(m, c, 'tremoloPos', position + ((c8(m, c, 'tremoloCmd') >> 2) & 0x3c));
}

/** mt_SampleOffset ($c398): start (offset x 256) bytes into the sample, or play 2 bytes if past its end. */
function sampleOffset(m, c) {
  const parameter = c8(m, c, 'cmdLo');
  if (parameter) {
    set8(m, c, 'sampleOffset', parameter);
  }
  const words = word(c8(m, c, 'sampleOffset') << 7);
  if (s16(words) >= s16(c16(m, c, 'length'))) {
    set16(m, c, 'length', 1);
    return;
  }
  set16(m, c, 'length', c16(m, c, 'length') - words);
  set32(m, c, 'start', c32(m, c, 'start') + word(words << 1));
}

/** mt_VolumeSlide ($c3c4): up by the high nibble, else down by the low one. */
function volumeSlide(m, c) {
  const up = c8(m, c, 'cmdLo') >> 4;
  if (up) {
    volumeSlideUp(m, c, up);
  } else {
    volumeSlideDown(m, c, c8(m, c, 'cmdLo') & 0xf);
  }
}

/** mt_VolSlideUp ($c3d0): `cmpi.b #$40 / bmi`, so a volume of $c0 or more is not clamped. */
function volumeSlideUp(m, c, amount) {
  set8(m, c, 'volume', c8(m, c, 'volume') + amount);
  if (!(byte(c8(m, c, 'volume') - MAX_VOLUME) & 0x80)) {
    set8(m, c, 'volume', MAX_VOLUME);
  }
  audio(m, c, 'vol', c8(m, c, 'volume'));
}

/** mt_VolSlideDown ($c3f6): to 0 at the least (`bpl`: a result of $80 or more counts as below 0). */
function volumeSlideDown(m, c, amount) {
  set8(m, c, 'volume', c8(m, c, 'volume') - amount);
  if (c8(m, c, 'volume') & 0x80) {
    set8(m, c, 'volume', 0);
  }
  audio(m, c, 'vol', c8(m, c, 'volume'));
}

/** mt_PositionJump ($c40a). */
function positionJump(m, R, c) {
  setVar8(m, R, 'songPos', c8(m, c, 'cmdLo') - 1);
  breakToRowZero(m, R);
}

/** mt_pj2 ($c416). */
function breakToRowZero(m, R) {
  setVar8(m, R, 'pBreakPos', 0);
  setVar8(m, R, 'posJumpFlag', 0xff);
}

/** mt_VolumeChange ($c424). */
function volumeChange(m, c) {
  const volume = Math.min(c8(m, c, 'cmdLo'), MAX_VOLUME);
  set8(m, c, 'volume', volume);
  audio(m, c, 'vol', volume);
}

/** mt_PatternBreak ($c43c): the parameter is decimal; above 63 means row 0. */
function patternBreak(m, R, c) {
  const parameter = c8(m, c, 'cmdLo');
  const row = byte((parameter >> 4) * 10 + (parameter & 0xf));
  if (row > 0x3f) {
    breakToRowZero(m, R);
    return;
  }
  setVar8(m, R, 'pBreakPos', row);
  setVar8(m, R, 'posJumpFlag', 0xff);
}

/** mt_SetSpeed ($c464): Fxx, ticks per row (no BPM in this version). F00 is ignored. */
function setSpeed(m, R, c) {
  const speed = c8(m, c, 'cmdLo');
  if (!speed) {
    return;
  }
  setVar8(m, R, 'counter', 0);
  setVar8(m, R, 'speed', speed);
}

/** mt_CheckMoreEfx ($c47a): the effects that act when the row is read. */
function checkMoreEfx(m, R, c) {
  updateFunk(m, R, c);
  switch (c8(m, c, 'cmd') & 0xf) {
    case 0x9: sampleOffset(m, c); break;
    case 0xb: positionJump(m, R, c); break;
    case 0xd: patternBreak(m, R, c); break;
    case 0xe: eCommands(m, R, c); break;
    case 0xf: setSpeed(m, R, c); break;
    case 0xc: volumeChange(m, c); break;
    default: break;
  }
}

/** mt_E_Commands ($c4b2). E8x does nothing. */
function eCommands(m, R, c) {
  const x = c8(m, c, 'cmdLo') >> 4;
  const y = c8(m, c, 'cmdLo') & 0xf;
  switch (x) {
    case 0x0: filterOnOff(m, y); break;
    case 0x1: finePortaUp(m, R, c); break;
    case 0x2: finePortaDown(m, R, c); break;
    case 0x3: set8(m, c, 'glissFunk', (c8(m, c, 'glissFunk') & 0xf0) | y); break;
    case 0x4: set8(m, c, 'waveControl', (c8(m, c, 'waveControl') & 0xf0) | y); break;
    case 0x5: setFinetune(m, c); break;
    case 0x6: jumpLoop(m, R, c); break;
    case 0x7: set8(m, c, 'waveControl', (c8(m, c, 'waveControl') & 0x0f) | (y << 4)); break;
    case 0x9: retrigNote(m, R, c); break;
    case 0xa: fineVolume(m, R, c, volumeSlideUp); break;
    case 0xb: fineVolume(m, R, c, volumeSlideDown); break;
    case 0xc: noteCut(m, R, c); break;
    case 0xd: noteDelay(m, R, c); break;
    case 0xe: patternDelay(m, R, c); break;
    case 0xf: funkIt(m, R, c); break;
    default: break;
  }
}

/** mt_FilterOnOff ($c52e): `andi.b #$fd,$bfe001 / or.b d0,$bfe001`, two writes: LED on, then as asked. */
function filterOnOff(m, y) {
  setLedFilter(m, true);
  setLedFilter(m, !(y & 1));
}

/** mt_SetFineTune ($c570). */
function setFinetune(m, c) {
  set8(m, c, 'finetune', c8(m, c, 'cmdLo') & 0xf);
}

/** mt_JumpLoop ($c57e): E60 marks the row, E6x jumps back to it x times. Tick 0 only. */
function jumpLoop(m, R, c) {
  if (getVar8(m, R, 'counter')) {
    return;
  }
  const count = c8(m, c, 'cmdLo') & 0xf;
  if (!count) {
    set8(m, c, 'pattPos', getVar16(m, R, 'patternPos') >> 4);
    return;
  }
  if (c8(m, c, 'loopCount')) {
    set8(m, c, 'loopCount', c8(m, c, 'loopCount') - 1);
    if (!c8(m, c, 'loopCount')) {
      return;
    }
  } else {
    set8(m, c, 'loopCount', count);
  }
  setVar8(m, R, 'pBreakPos', c8(m, c, 'pattPos'));
  setVar8(m, R, 'pBreakFlag', 0xff);
}

/** mt_RetrigNote ($c5d8): restart the sample every y ticks (on tick 0 only if the row has no note). */
function retrigNote(m, R, c) {
  const every = c8(m, c, 'cmdLo') & 0xf;
  if (!every) {
    return;
  }
  const counter = getVar8(m, R, 'counter');
  if (!counter && (c16(m, c, 'note') & 0xfff)) {
    return;
  }
  if (counter % every) {
    return;
  }
  doRetrig(m, c);
}

/** mt_DoRetrig ($c604): the whole DMA dance for one channel; ends with LEN and PER from +$e (a move.l). */
function doRetrig(m, c) {
  custom(m, DMACON, c16(m, c, 'dmaBit'));
  custom32(m, c.a5 + AUD.lc, c32(m, c, 'start'));
  audio(m, c, 'len', c16(m, c, 'length'));
  delayPaula(m, DMA_WAIT_MS);
  custom(m, DMACON, c16(m, c, 'dmaBit') | DMA_SET);
  delayPaula(m, DMA_WAIT_MS);
  custom32(m, c.a5 + AUD.lc, c32(m, c, 'loopStart'));
  custom32(m, c.a5 + AUD.len, c32(m, c, 'replen'));
}

/** mt_VolumeFineUp / mt_VolumeFineDown ($c642 / $c65a): tick 0 only. */
function fineVolume(m, R, c, slide) {
  if (getVar8(m, R, 'counter')) {
    return;
  }
  slide(m, c, c8(m, c, 'cmdLo') & 0xf);
}

/** mt_NoteCut ($c672): volume 0 on tick y. */
function noteCut(m, R, c) {
  if ((c8(m, c, 'cmdLo') & 0xf) !== getVar8(m, R, 'counter')) {
    return;
  }
  set8(m, c, 'volume', 0);
  audio(m, c, 'vol', 0);
}

/** mt_NoteDelay ($c690): start the row's note on tick y (only if the row has a note or sample: `tst.w (a6)`). */
function noteDelay(m, R, c) {
  if ((c8(m, c, 'cmdLo') & 0xf) !== getVar8(m, R, 'counter')) {
    return;
  }
  if (!c16(m, c, 'note')) {
    return;
  }
  doRetrig(m, c);
}

/** mt_PatternDelay ($c6b0): hold the row for y more rows. */
function patternDelay(m, R, c) {
  if (getVar8(m, R, 'counter') || getVar8(m, R, 'pattDelTime2')) {
    return;
  }
  setVar8(m, R, 'pattDelTime', (c8(m, c, 'cmdLo') & 0xf) + 1);
}

/** mt_FunkIt ($c6d8): EFx, the "invert loop" speed. */
function funkIt(m, R, c) {
  if (getVar8(m, R, 'counter')) {
    return;
  }
  const speed = byte((c8(m, c, 'cmdLo') & 0xf) << 4);
  set8(m, c, 'glissFunk', (c8(m, c, 'glissFunk') & 0x0f) | speed);
  if (!speed) {
    return;
  }
  updateFunk(m, R, c);
}

/** mt_UpdateFunk ($c6fc): every so often, invert one more byte of the sample's loop (in chip RAM). */
function updateFunk(m, R, c) {
  const speed = c8(m, c, 'glissFunk') >> 4;
  if (!speed) {
    return;
  }
  set8(m, c, 'funkOffset', c8(m, c, 'funkOffset') + r8(m, R.funkTable + speed));
  if (!(c8(m, c, 'funkOffset') & 0x80)) {
    return;
  }
  set8(m, c, 'funkOffset', 0);
  const loopEnd = (c32(m, c, 'loopStart') + c16(m, c, 'replen') * 2) >>> 0;
  let at = (c32(m, c, 'waveStart') + 1) >>> 0;
  if (at >= loopEnd) {
    at = c32(m, c, 'loopStart');
  }
  set32(m, c, 'waveStart', at);
  w8(m, at, byte(0xff - r8(m, at)));
}
