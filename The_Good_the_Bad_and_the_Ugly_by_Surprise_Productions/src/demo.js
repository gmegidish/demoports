// The main script (0000:03b1..08d7, docs/disassembly/G1_framework.md section 2) and the frame loop.
//
// Time is the soundtrack's time, which is the reference recording's time: 0 is the recording's first frame, the
// switch from the DOS text screen to 640x400 graphics just after the start key. The frame loop steps one vertical
// retrace at a time (70.086 Hz in every mode the demo uses). At each retrace the timer interrupt runs (the frame
// counter and the music player, as the timer module 0731 has installed them), then the demo's code runs until it
// waits for the next retrace: an effect is a generator and `yield` is that wait.
import { Vga } from './vga.js';
import { Machine, linear, waitTick } from './machine.js';
import { openGbu } from './gbu.js';
import { createSong } from './song.js';
import * as lib from './library.js';
import { EFFECTS } from './parts/index.js';

/** The MOD (inc\b2.mod) in GBU.EXE. */
const MOD_FILE_OFFSET = 0x9c40;
/**
 * Retraces between the end of the text part's fade and the mode set before the music: GUS detect, MOD load and
 * sample upload (008e:170e, 008e:1942). I/O bound, measured in the recording (frames ~511..549).
 */
const GUS_LOAD_RETRACES = 39;
/**
 * 0731:000a measures the frame length 16 times, two retraces each, but its first wait ends at the retrace that
 * also ends 0299:00f5's: 31 more retraces. Checked on the intro, which then matches the recording frame for frame
 * (with 32 every intro frame is the recording's previous one).
 */
const PIT_MEASURE_RETRACES = 31;
/** 0000:086d: the music fades out in 64 steps of 3 ticks. */
const FADE_STEPS = 0x40;
const SEQUENCER_INDEX = 0x3c4;
const CRTC_INDEX = 0x3d4;

/** 008e:04b3: resource named at ds:dx, its new segment stored at ds:di. */
function load(m, ds, dx, di) {
  m.loadResource(linear(ds, dx), linear(ds, di));
}

/** 008e:0063: frees the block whose segment is at ds:di. */
function free(m, ds, di) {
  m.freeFrom(linear(ds, di));
}

/** `rep stosw` of `words` zero words at a000:0000 with the map mask on all four planes. */
function clearVideo(m, words) {
  m.vga.out16(SEQUENCER_INDEX, 0x0f02);
  for (let offset = 0; offset < words * 2; offset++) {
    m.vga.write(offset, 0);
  }
}

/** The main script from 0000:0444 (the text part, after the start key) to the end screen. */
function* mainScript(m, ending) {
  const vga = m.vga;
  load(m, 0x08d8, 0x0002, 0x0000); // 0434 'scr_data'
  load(m, 0x08d8, 0x000c, 0x000a); // 043f 'screen2'
  yield* EFFECTS.textToGraphics(m); // 0444 11d6:000a
  yield* EFFECTS.blueCubes(m); // 0449 08d8:196e
  yield* EFFECTS.fadeTextPart(m); // 044e 11d6:032c
  for (let i = 0; i < GUS_LOAD_RETRACES; i++) {
    yield; // 045b 008e:170e GUS detect, 0465 008e:1942 MOD load
  }
  yield* lib.setModeX(m); // 0479 0299:00f5
  lib.setBlackBorder(vga); // 047e 0299:020a
  lib.setIdentityAttributes(vga); // 0483 0299:005e
  for (let i = 0; i < PIT_MEASURE_RETRACES; i++) {
    yield; // 048d 0731:000a
  }
  yield; // 0498 0731:013c waits for the retrace start, then the retrace timer runs the music
  m.setTimer('retrace');
  lib.setEgaPlanar(vga); // 049d 0299:01cc
  yield* EFFECTS.intro(m); // 04a2 08d8:275d
  lib.setDacBlack(vga); // 04a7 0000:002b
  lib.setEgaPlanar(vga); // 04ab
  load(m, 0x0db5, 0x0204, 0x0200); // 04ba 'ugur'
  yield* EFFECTS.credits(m); // 04bf 0db5:07b0
  free(m, 0x0db5, 0x0200);
  load(m, 0x0777, 0x000a, 0x0000); // 04db 'p3_sin'
  load(m, 0x0777, 0x0012, 0x0002); // 04e6 'p3_chess'
  load(m, 0x0777, 0x001a, 0x0006); // 04f1 'p3_zoom'
  load(m, 0x0777, 0x0022, 0x0008); // 04fc 'p3_outf'
  load(m, 0x0777, 0x002a, 0x0004); // 0507 'chess'
  load(m, 0x08d8, 0x001a, 0x0018); // 0517 'cheffect'
  load(m, 0x0cc5, 0x0004, 0x0002); // 0527 'p75_data'
  load(m, 0x0cc5, 0x000c, 0x0000); // 0532 'plasma'
  load(m, 0x0cf9, 0x0004, 0x0000); // 0542 'kp3_sin'
  load(m, 0x0cf9, 0x000c, 0x0002); // 054d 'kp3_sin2'
  load(m, 0x0d2e, 0x0006, 0x0004); // 055d 'mutamcde'
  load(m, 0x0749, 0x0007, 0x0017); // 056d 'watr_dat'
  load(m, 0x0749, 0x000f, 0x0019); // 0578 'watr_pic'
  load(m, 0x08a8, 0x000e, 0x001e); // 0588 'wave_sin'
  load(m, 0x08a8, 0x0016, 0x0020); // 0593 'wave_ran'
  load(m, 0x08a8, 0x0002, 0x000a); // 059e 'wave'
  yield* EFFECTS.plasma(m); // 05a3 0cf9:01dd
  vga.out16(CRTC_INDEX, 0x2813); // 05a8
  yield; // 05af 0731:013c
  m.setTimer('retrace');
  yield* EFFECTS.cyclicPlasma(m); // 05b4 0cc5:0139
  clearVideo(m, 0x7fff); // 05b9
  lib.setEgaPlanar(vga); // 05d0
  yield* EFFECTS.morphingLines(m); // 05d5 0d2e:0010
  clearVideo(m, 0x2ee0); // 05da
  yield* EFFECTS.chessEffect(m); // 05f0 08d8:18d4
  yield* EFFECTS.water(m); // 05f5 0749:01cc
  free(m, 0x0749, 0x0019);
  free(m, 0x0749, 0x0017);
  free(m, 0x0749, 0x0112);
  free(m, 0x0cc5, 0x0002);
  free(m, 0x0cc5, 0x0000);
  free(m, 0x0cc5, 0x0134);
  free(m, 0x0d2e, 0x0004);
  free(m, 0x0cf9, 0x0000);
  free(m, 0x0cf9, 0x0002);
  free(m, 0x0cf9, 0x001c);
  lib.setEgaPlanar(vga); // 065e
  lib.setDac(m, 0, 0x10, linear(0x08d8, 0x1479)); // 0670 0299:0076
  yield; // 0675 0731:013c
  m.setTimer('retrace');
  yield* EFFECTS.glentzVector(m); // 067f 08d8:1625, 0684 08d8:16de
  yield* waitTick(m); // 0689 0731:00a3
  lib.setDacBlack(vga); // 068e
  lib.setUnchained256(vga); // 0692 0299:0175
  yield* EFFECTS.pictureWobbler(m); // 0697 08a8:01f2
  yield; // 069c waits for the retrace start
  lib.setDacWhite100(vga); // 06a9 0000:001b
  lib.setEgaPlanar(vga); // 06ac
  m.tickMusic(); // 06b1 008e:1f63
  lib.setBlackBorder(vga); // 06b6
  yield* EFFECTS.chessZoomer(m); // 06c0 0777:0995
  yield; // 06c5 0731:013c
  m.setTimer('retrace');
  yield* EFFECTS.glentzChessCube(m); // 06ca 08d8:2dc1
  lib.setEgaPlanar(vga); // 06cf
  yield* EFFECTS.greetings(m); // 06d4 0eb3:27e8, 28ab, 27d5
  load(m, 0x0e40, 0x0006, 0x0004); // 06ed 'dot_data'
  yield* EFFECTS.dotTunnel(m); // 06f2 0e40:063b
  free(m, 0x0e40, 0x0004);
  yield* EFFECTS.motorcycleToDoor(m); // 0703..072c
  for (const di of [0x54, 0x00, 0x02, 0x06, 0x08, 0x04]) {
    free(m, 0x0777, di);
  }
  for (const di of [0x0c, 0x0a, 0x4a, 0x1e, 0x20]) {
    free(m, 0x08a8, di);
  }
  free(m, 0x08d8, 0x0018);
  yield; // 07a0 0731:013c
  m.setTimer('retrace');
  vga.setMode13(); // 07a5 int 10h ax=13h
  yield* EFFECTS.pictureZoomer(m); // 07aa 0d97:013c
  for (const di of [0x12, 0x08, 0x16, 0x38, 0x3a, 0x3c, 0x3e]) {
    free(m, 0x0d97, di);
  }
  free(m, 0x08d8, 0x000a);
  yield* EFFECTS.fractalZoomer(m); // 07f8 0d34:04e1
  for (const di of [0x08, 0x62, 0x64]) {
    free(m, 0x0d34, di);
  }
  lib.setEgaPlanar(vga); // 0819
  clearVideo(m, 0x1f40); // 081e
  yield* EFFECTS.glentzCubes(m); // 0835 08d8:25f4, 083a 08d8:16de
  lib.setEgaPlanar(vga); // 083f
  clearVideo(m, 0x7d00); // 0844
  yield* EFFECTS.dotsCubes(m); // 085b 126e:13ea
  free(m, 0x08d8, 0x0000);
  for (let step = FADE_STEPS; step >= 1; step--) {
    yield* waitTick(m); // 0871
    yield* waitTick(m); // 087d (the volume cap 008e:2068 between them is silent here)
    yield* waitTick(m); // 0882
  }
  // 088a: mode 3, music and timer off, the 'ending' screen to b800, cursor row 0x17.
  vga.setMode3();
  m.setTimer('bios');
  vga.textScreen.set(ending.subarray(0, vga.textScreen.length));
}

/**
 * The demo on soundtrack time, from GBU.EXE.
 * @param {Uint8Array} exe GBU.EXE, unmodified
 * @param {Uint8Array} font the VGA BIOS 8x16 font (assets/vgafont.bin)
 */
export function createDemo(exe, font) {
  const { image, resources } = openGbu(exe);
  const vga = new Vga();
  vga.font = font;
  vga.setMode3(); // the DOS screen the demo starts from: its timings until the text part's mode switch
  const m = new Machine(image, resources, vga);
  m.song = createSong(exe.subarray(MOD_FILE_OFFSET));
  const state = {
    vga,
    machine: m,
    time: 0,
    isOver: false,
    hasFailed: false,
  };
  const main = mainScript(m, resources.get('ending'));

  function* retraces() {
    for (;;) {
      vga.beginFrame();
      m.timerInterrupt();
      if (main.next().done) {
        return;
      }
      yield;
    }
  }

  const frames = retraces();
  return {
    state,
    get time() {
      return state.time;
    },
    /** Runs exactly one retrace (tools). */
    step() {
      if (!state.isOver) {
        state.time += 1 / vga.refreshRate;
        if (frames.next().done) {
          state.isOver = true;
        }
      }
    },
    /** Runs retraces until the time reaches `seconds` (or isOutOfTime says stop for this browser frame). */
    runUntil(seconds, isOutOfTime = () => false) {
      while (!state.isOver && state.time + 1 / vga.refreshRate <= seconds && !isOutOfTime()) {
        state.time += 1 / vga.refreshRate;
        if (frames.next().done) {
          state.isOver = true;
        }
      }
    },
  };
}
