// Boot: load the original graphics file and the music, then run the demo generator from a clock.
import { Screen } from './screen.js';
import { createRunner } from './demo.js';

const SEEK_STEP_MS = 5000;
const GRAPHICS_URL = 'assets/NINJA2.000';
const MUSIC_URL = 'assets/music.ogg';
/** Debug knob: `#speed=2` runs the demo twice as fast against the same music. */
const SPEED = Number(location.hash.match(/speed=([\d.]+)/)?.[1] ?? 1);

const overlay = document.getElementById('start');
const status = document.getElementById('status');
const hud = document.getElementById('hud');
const screen = new Screen(document.getElementById('screen'));
const audio = new Audio();

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

async function loadGraphics() {
  return new Uint8Array(await fetchBytes(GRAPHICS_URL));
}

/**
 * The whole file goes into a blob, so seeking works on static hosts without HTTP range support.
 * Nothing waits for the audio element here: browsers may not decode media in a tab until it is played.
 */
async function loadMusic() {
  const blob = new Blob([await fetchBytes(MUSIC_URL)], { type: 'audio/ogg' });
  audio.src = URL.createObjectURL(blob);
}

/** Length of the music in seconds. Unknown until the browser has read the file's header. */
function musicLength() {
  return Number.isFinite(audio.duration) ? audio.duration : Infinity;
}

/**
 * Demo time in ms. The opening logos are silent and run on the wall clock. Once the demo reaches
 * PlayModule() the music is the clock. When the music ends it restarts as a soundtrack only.
 */
const clock = {
  wallDemoMs: 0,
  wallAt: 0,
  followsMusic: false,
  musicStartMs: 0,
  now() {
    if (this.followsMusic) {
      return this.musicStartMs + audio.currentTime * 1000 * SPEED;
    }
    return this.wallDemoMs + (performance.now() - this.wallAt) * SPEED;
  },
  restartAt(demoMs) {
    this.wallDemoMs = demoMs;
    this.wallAt = performance.now();
    this.followsMusic = false;
  },
};

let graphics;
let runner;
let isMusicStarted = false;

function reportPlaybackError(error) {
  hud.hidden = false;
  hud.textContent = `music: ${error.message}`;
}

function startMusic(timeMs, musicStartMs) {
  isMusicStarted = true;
  const offset = (timeMs - musicStartMs) / 1000 / SPEED;
  const isFirstPass = offset < musicLength();
  audio.currentTime = isFirstPass ? offset : offset % musicLength();
  audio.play().then(() => {
    if (isFirstPass) {
      clock.musicStartMs = musicStartMs;
      clock.followsMusic = true;
    }
  }, reportPlaybackError);
}

audio.addEventListener('ended', () => {
  clock.restartAt(clock.musicStartMs + audio.duration * 1000 * SPEED);
  audio.currentTime = 0;
  audio.play().catch(reportPlaybackError);
});

/** Scenes are deterministic, so seeking is replaying the demo from zero without showing it. */
function seek(timeMs) {
  const target = Math.max(0, timeMs);
  audio.pause();
  isMusicStarted = false;
  runner = createRunner(graphics);
  runner.advanceTo(target);
  clock.restartAt(target);
}

function frame() {
  const time = clock.now();
  runner.advanceTo(time);
  const musicStartMs = runner.m.musicStartMs;
  if (!isMusicStarted && musicStartMs !== null && time >= musicStartMs) {
    startMusic(time, musicStartMs);
  }
  screen.present(runner.m);
  if (!hud.hidden && !hud.textContent.startsWith('music:')) {
    hud.textContent = `${(time / 1000).toFixed(2)}s`;
  }
  requestAnimationFrame(frame);
}

function startTimeFromHash() {
  const match = location.hash.match(/t=([\d.]+)/);
  return match ? Number(match[1]) * 1000 : 0;
}

function start() {
  overlay.remove();
  hud.hidden = !location.hash.includes('hud');
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
    seek(clock.now() + SEEK_STEP_MS);
  }
  if (event.key === 'ArrowLeft') {
    seek(clock.now() - SEEK_STEP_MS);
  }
});

try {
  [graphics] = await Promise.all([loadGraphics(), loadMusic()]);
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
