// Boot: fetch the demo's files and the music, then drive the demo from the music's clock.
import { Screen } from './screen.js';
import { createDemo, finishLoading, seekTo } from './demo.js';
import { createAssets } from './engine/pictures.js';
import { TICKS_PER_SECOND } from './machine.js';
import { DEMO_FILES, MUSIC_URL } from './manifest.js';

const SEEK_STEP_SECONDS = 5;
/** currentTime falling back by more than this means the module wrapped around, not a seek of ours. */
const LOOP_DETECT_SECONDS = 1;

const overlay = document.getElementById('start');
const status = document.getElementById('status');
const hud = document.getElementById('hud');
const canvas = document.getElementById('screen');
const audio = new Audio();
audio.loop = true;

let assets;
let demo;
let screen;

/**
 * Seconds since the music started. The module is shorter than the demo and loops, as MIDAS loops
 * it, so the clock counts the laps.
 */
const clock = {
  laps: 0,
  lastTime: 0,
  now() {
    const time = audio.currentTime;
    if (time < this.lastTime - LOOP_DETECT_SECONDS) {
      this.laps++;
    }
    this.lastTime = time;
    // A lap is only ever counted after the music has played to its end, so its length is known by then.
    return this.laps === 0 ? time : this.laps * musicLength() + time;
  },
  set(seconds) {
    const length = musicLength();
    this.laps = Number.isFinite(length) ? Math.floor(seconds / length) : 0;
    this.lastTime = this.laps === 0 ? seconds : seconds - this.laps * length;
    audio.currentTime = this.lastTime;
  },
};

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function loadAssets() {
  let loaded = 0;
  const entries = await Promise.all(DEMO_FILES.map(async (path) => {
    const bytes = await fetchBytes(path);
    loaded++;
    status.textContent = `loading ${Math.round((loaded * 100) / DEMO_FILES.length)}%`;
    return [path, bytes];
  }));
  return createAssets(new Map(entries));
}

/**
 * The whole file goes into a blob, so seeking works on static hosts without HTTP range support.
 * Nothing waits for the audio element here: browsers may not decode media in a tab until it is played.
 */
async function loadMusic() {
  const bytes = await fetchBytes(MUSIC_URL);
  audio.src = URL.createObjectURL(new Blob([bytes], { type: 'audio/ogg' }));
}

/** Length of the music in seconds. Unknown until the browser has read the file's header. */
function musicLength() {
  return Number.isFinite(audio.duration) ? audio.duration : Infinity;
}

function reportPlaybackError(error) {
  hud.hidden = false;
  hud.textContent = `music: ${error.message}`;
}

function present() {
  screen.present(demo.machine.front, demo.machine.dac);
}

/** Parts never run backwards and keep state, so going back means starting over and jumping forward. */
function seek(seconds) {
  const target = Math.max(0, seconds);
  if (target * TICKS_PER_SECOND < demo.machine.ticks || demo.isOver) {
    demo = createDemo(assets);
    finishLoading(demo);
    audio.play().catch(reportPlaybackError);
  }
  clock.set(target);
  seekTo(demo, Math.floor(target * TICKS_PER_SECOND));
}

function playFrame() {
  if (demo.isOver) {
    audio.pause();
    present();
    return;
  }
  const seconds = clock.now();
  demo.machine.ticks = Math.floor(seconds * TICKS_PER_SECOND);
  demo.step();
  present();
  if (!hud.hidden && !hud.textContent.startsWith('music:')) {
    hud.textContent = `${seconds.toFixed(2)}s`;
  }
  requestAnimationFrame(playFrame);
}

/** The loading screen, one log line per frame, as the original shows it while it loads. */
function loadFrame() {
  if (!demo.machine.isMusicStarted) {
    demo.step();
    present();
    requestAnimationFrame(loadFrame);
    return;
  }
  audio.play().catch(reportPlaybackError);
  const startSeconds = Number(location.hash.match(/t=([\d.]+)/)?.[1] ?? 0);
  if (startSeconds > 0) {
    seek(startSeconds);
  }
  requestAnimationFrame(playFrame);
}

function start() {
  overlay.remove();
  hud.hidden = !location.hash.includes('hud');
  demo = createDemo(assets);
  screen = new Screen(canvas, demo.machine.width, demo.machine.height);
  requestAnimationFrame(loadFrame);
}

addEventListener('keydown', (event) => {
  if (event.key === 'f' || event.key === 'F') {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }
  if (!demo || !demo.machine.isMusicStarted) {
    return;
  }
  if (event.key === 'ArrowRight') {
    seek(clock.now() + SEEK_STEP_SECONDS);
  }
  if (event.key === 'ArrowLeft') {
    seek(clock.now() - SEEK_STEP_SECONDS);
  }
});

try {
  [assets] = await Promise.all([loadAssets(), loadMusic()]);
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
