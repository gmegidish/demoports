// Boot: fetch the original executable, its module and the rendered music, then drive the demo
// from the music's clock.
import { Screen, renderFrame } from './screen.js';
import { createDemo, finishLoading, seekTo } from './demo.js';
import { readBundle, createAssets } from './bundle.js';

const SEEK_STEP_SECONDS = 5;
const EXE_URL = 'BROTHER.EXE';
const MODULE_URL = 'BICSTL.XM';
/** BICSTL.XM rendered with libopenmpt: what MIDAS played. */
const MUSIC_URL = 'assets/music.ogg';
const FONT_URL = 'assets/vga8x16.bin';

const overlay = document.getElementById('start');
const status = document.getElementById('status');
const hud = document.getElementById('hud');
const canvas = document.getElementById('screen');
const audio = new Audio();

let assets;
let module;
let font;
let demo;
let screen;

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * The whole file goes into a blob, so seeking works on static hosts without HTTP range support.
 * Nothing waits for the audio element here: browsers may not decode media in a tab until it is played.
 */
async function loadMusic() {
  const bytes = await fetchBytes(MUSIC_URL);
  audio.src = URL.createObjectURL(new Blob([bytes], { type: 'audio/ogg' }));
}

function reportPlaybackError(error) {
  hud.hidden = false;
  hud.textContent = `music: ${error.message}`;
}

function present() {
  screen.present(renderFrame(demo.machine, font));
}

/** Parts keep state and never run backwards, so going back means starting over and jumping forward. */
function seek(seconds) {
  const target = Math.max(0, seconds);
  if (target < demo.machine.time || demo.isOver) {
    demo = createDemo(assets, module);
    finishLoading(demo);
  }
  audio.currentTime = target;
  if (audio.paused) {
    audio.play().catch(reportPlaybackError);
  }
  seekTo(demo, target);
}

function playFrame() {
  const machine = demo.machine;
  machine.time = audio.currentTime;
  demo.step();
  audio.volume = Math.min(1, Math.max(0, machine.volume / machine.baseVolume));
  if (demo.isOver) {
    // main() stops the module before it prints "The End!".
    audio.pause();
  }
  present();
  if (!hud.hidden && !hud.textContent.startsWith('music:')) {
    hud.textContent = `${machine.time.toFixed(2)} s`;
  }
  requestAnimationFrame(playFrame);
}

/** The boot log in text mode, one line per frame, as main() prints it while it loads. */
function bootFrame() {
  if (!demo.machine.isMusicStarted) {
    demo.step();
    present();
    requestAnimationFrame(bootFrame);
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
  demo = createDemo(assets, module);
  screen = new Screen(canvas);
  requestAnimationFrame(bootFrame);
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
    seek(audio.currentTime + SEEK_STEP_SECONDS);
  }
  if (event.key === 'ArrowLeft') {
    seek(audio.currentTime - SEEK_STEP_SECONDS);
  }
});

try {
  let exe;
  [exe, module, font] = await Promise.all([fetchBytes(EXE_URL), fetchBytes(MODULE_URL), fetchBytes(FONT_URL), loadMusic()]);
  assets = createAssets(readBundle(exe));
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
