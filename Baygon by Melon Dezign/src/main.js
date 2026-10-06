// Boot: load the disk image and the music, then run the demo generator from the audio clock.
import { Screen } from './screen.js';
import { createRunner } from './demo.js';
import { FRAME_MS } from './machine.js';

const SEEK_STEP_MS = 5000;
const DISK_URL = 'assets/baygon.adf';
/**
 * Both tunes are a single pattern. The main one plays rows 0-18 once, then rows 19-38 forever: the pattern
 * loops there (E60/E61/E62) are nested the way ProTracker's loop counter never gets out of. Row 19 is reached
 * after 656 ticks, and the cycle is 957 ticks, at 125 BPM (20 ms a tick). The end tune is one 115-tick pattern.
 * Loop points come from the patterns, not from the files, which the encoder pads a little.
 */
const TUNES = {
  main: { url: 'assets/music.ogg', loopStart: 13.12, loopEnd: 32.26 },
  end: { url: 'assets/music-end.ogg', loopStart: 0, loopEnd: 2.3 },
};
const UNPACKED_PARTS = [0xd3a68, 0xc96e8];
/**
 * The replay routine runs off the vertical blank, 49.92 times a second. The music file was rendered at
 * the nominal 50, so it is played back that much slower.
 */
const MUSIC_RATE = 1000 / FRAME_MS / 50;

const overlay = document.getElementById('start');
const status = document.getElementById('status');
const hud = document.getElementById('hud');
const screen = new Screen(document.getElementById('screen'));
const audio = new AudioContext();

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

async function loadUnpackedParts() {
  const entries = await Promise.all(UNPACKED_PARTS.map(async (entry) => {
    const bytes = await fetchBytes(`assets/part-${entry.toString(16)}.bin`);
    return [entry, new Uint8Array(bytes)];
  }));
  return Object.fromEntries(entries);
}

let disk;
let unpacked;
let runner;
/** Demo time 0 on the audio clock, in seconds. */
let startedAt = 0;

function now() {
  return (audio.currentTime - startedAt) * 1000;
}

function stopTune(tune) {
  tune.source?.stop();
  tune.source = null;
}

/** Where in the file a tune is, `seconds` after it started. */
function positionInTune(tune, seconds) {
  if (seconds < tune.loopEnd) {
    return seconds;
  }
  return tune.loopStart + ((seconds - tune.loopStart) % (tune.loopEnd - tune.loopStart));
}

/** Keep a tune in step with the demo: playing from `startMs` until `stopMs`, at `volume`. */
function followTune(tune, startMs, stopMs, volume) {
  const shouldPlay = startMs !== null && stopMs === null;
  if (!shouldPlay) {
    stopTune(tune);
    return;
  }
  if (!tune.source) {
    const offsetSeconds = ((now() - startMs) / 1000) * MUSIC_RATE;
    tune.gain = new GainNode(audio);
    tune.source = new AudioBufferSourceNode(audio, {
      buffer: tune.buffer, loop: true, loopStart: tune.loopStart, loopEnd: tune.loopEnd, playbackRate: MUSIC_RATE,
    });
    tune.source.connect(tune.gain).connect(audio.destination);
    tune.source.start(0, positionInTune(tune, Math.max(0, offsetSeconds)));
  }
  tune.gain.gain.value = volume;
}

/** Parts are deterministic, so seeking is replaying the demo from zero without showing it. */
function seek(timeMs) {
  const target = Math.max(0, timeMs);
  stopTune(TUNES.main);
  stopTune(TUNES.end);
  runner = createRunner(disk, unpacked);
  runner.advanceTo(target);
  startedAt = audio.currentTime - target / 1000;
}

function frame() {
  const time = now();
  runner.advanceTo(time);
  if (runner.isOver) {
    // The end part resets the Amiga, and the disk boots again.
    seek(0);
  }
  const m = runner.m;
  followTune(TUNES.main, m.musicStartMs, m.musicStopMs, m.musicVolume);
  followTune(TUNES.end, m.endMusicStartMs, m.endMusicStopMs, 1);
  screen.present(runner.m);
  if (!hud.hidden) {
    hud.textContent = `${(time / 1000).toFixed(2)}s`;
  }
  requestAnimationFrame(frame);
}

function startTimeFromHash() {
  const match = location.hash.match(/t=([\d.]+)/);
  return match ? Number(match[1]) * 1000 : 0;
}

async function start() {
  overlay.remove();
  hud.hidden = !location.hash.includes('hud');
  await audio.resume();
  seek(startTimeFromHash());
  requestAnimationFrame(frame);
}

addEventListener('keydown', (event) => {
  if (event.key === 'f' || event.key === 'F') {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }
  if (!runner) {
    return;
  }
  if (event.key === 'ArrowRight') {
    seek(now() + SEEK_STEP_MS);
  }
  if (event.key === 'ArrowLeft') {
    seek(now() - SEEK_STEP_MS);
  }
});

try {
  const loadTune = async (tune) => {
    tune.buffer = await audio.decodeAudioData(await fetchBytes(tune.url));
  };
  const [diskBytes, parts] = await Promise.all([fetchBytes(DISK_URL), loadUnpackedParts(), loadTune(TUNES.main), loadTune(TUNES.end)]);
  disk = new Uint8Array(diskBytes);
  unpacked = parts;
  status.textContent = 'click to start';
  overlay.addEventListener('click', start, { once: true });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      start();
    }
  }, { once: true });
} catch (error) {
  status.textContent = `failed to load — ${error.message}`;
}
