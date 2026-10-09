// The loader (exe0, H0_loader_music.md): after the setup screen it sets text mode retimed to 528 lines (59.60 Hz),
// starts the music and runs the five parts in order. Nothing happens on screen between parts: each inherits the
// VGA as the previous one left it.
//
// Time is the soundtrack's time (the recording's audio, which runs on real time like the original's mixer). The
// frame loop steps one vertical retrace at a time, at the rate the CRTC timing gives (vga.refreshRate). At each
// retrace the music IRQ increments the frame counter and calls the part's callback; then the part's main code
// runs until it waits for the next retrace. A part is a generator: `yield` = wait for the next retrace.
import { Vga } from './vga.js';
import { Machine } from './machine.js';
import { splitAppeal } from './appeal.js';
import { PARTS } from './parts/index.js';

/**
 * Song time minus soundtrack time at exe2's first instruction, fitted so that all eight of exe2's music cues fire on
 * the retrace they fire on in the recording (H0 has the music start a few ms before exe2; the capture's audio
 * starts a little after).
 */
const MUSIC_LEAD_SECONDS = -0.01;
/**
 * The soundtrack is four capture files' audio, each padded with silence to its video's length: the song did not
 * play through those pads. From exe3 on, the song is this much further behind the soundtrack, fitted on exe5's two
 * music cues (the zoom-out and the exit), which then fire on the recorded retrace.
 */
const RECORDING_GAP_SECONDS = 0.05;
/** int 0x80 fn 0x1d twice around a mode set: the song freezes and the audio is silent this long (H0). */
export const MUSIC_PAUSE_SECONDS = 0.023;

/** 0040:0490: mode 3, then the CRTC retimed to 480-line timings: 528 lines a frame. */
function setLoaderMode(vga) {
  vga.setMode3();
  vga.crtc[0x11] &= 0x7f;
  vga.misc |= 0xc0;
  const timings = [[0x06, 0x0e], [0x07, 0x3e], [0x09, 0x41], [0x10, 0xc5], [0x11, 0xac], [0x15, 0x9c], [0x16, 0x00]];
  for (const [index, value] of timings) {
    vga.crtc[index] = value;
  }
}

/** The demo on soundtrack time, from APPEAL.EXE. */
export function createDemo(exe) {
  const { programs } = splitAppeal(exe);
  const vga = new Vga();
  setLoaderMode(vga);
  const state = {
    vga,
    machine: null,
    time: 0,
    musicPausedSeconds: 0,
    partIndex: -1,
    isOver: false,
    hasFailed: false,
  };

  function songSeconds() {
    return state.time + MUSIC_LEAD_SECONDS - state.musicPausedSeconds;
  }

  function* runParts() {
    for (let i = 0; i < PARTS.length; i++) {
      const part = PARTS[i];
      for (let k = 0; k < part.loadRetraces; k++) {
        yield;
        vga.latchDisplay();
      }
      const m = new Machine(vga);
      m.loadImage(programs[part.program].image);
      // The song freezes; the retraces (and the recorded video) go on.
      m.pauseMusic = () => {
        state.musicPausedSeconds += MUSIC_PAUSE_SECONDS;
      };
      state.machine = m;
      state.partIndex = i;
      if (i === 1) {
        state.musicPausedSeconds += RECORDING_GAP_SECONDS;
      }
      m.songSeconds = songSeconds();
      const main = part.run(m);
      for (;;) {
        if (main.next().done) {
          break;
        }
        yield;
        vga.latchDisplay();
        m.songSeconds = songSeconds();
        m.frameCounter = (m.frameCounter + 1) & 0xffff;
        if (m.callback) {
          m.callback(m);
        }
      }
      if (m.exitCode === 1) {
        break;
      }
    }
    vga.setMode3();
    state.isOver = true;
  }

  const frames = runParts();
  return {
    state,
    get time() {
      return state.time;
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
