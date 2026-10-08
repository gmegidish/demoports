// Boot: fetch the executable, the ROM font and the soundtrack, then run the demo on the soundtrack's clock.
import { Screen, renderFrame } from './screen.js';
import { createDemo } from './demo.js';

const SEEK_STEP_SECONDS = 5;
/** How long one browser frame may spend catching up with the music. */
const FRAME_BUDGET_MS = 12;

const overlay = document.getElementById('start');
const status = document.getElementById('status');
const hud = document.getElementById('hud');
const screen = new Screen(document.getElementById('screen'));
const audio = new Audio();

let files;
let romFont;
let demo;

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** The whole file goes into a blob, so seeking works on static hosts without range requests. */
async function loadSoundtrack() {
  const bytes = await fetchBytes('assets/soundtrack.ogg');
  audio.src = URL.createObjectURL(new Blob([bytes], { type: 'audio/ogg' }));
}

/** The soundtrack is the clock. */
const soundtrackClock = {
  get seconds() {
    return audio.currentTime;
  },
  set seconds(value) {
    audio.currentTime = value;
  },
  get isPaused() {
    return audio.paused;
  },
  get isAtEnd() {
    return audio.ended;
  },
  pause() {
    audio.pause();
  },
  resume() {
    if (isPlaybackBlocked) {
      return;
    }
    audio.play().catch(reportPlaybackError);
  },
};

/** `#nosound`: the wall clock instead, for automated checks where a browser refuses to play audio. */
const silentClock = {
  base: 0,
  startedAt: null,
  get seconds() {
    return this.startedAt === null ? this.base : this.base + (performance.now() - this.startedAt) / 1000;
  },
  set seconds(value) {
    this.base = value;
    if (this.startedAt !== null) {
      this.startedAt = performance.now();
    }
  },
  get isPaused() {
    return this.startedAt === null;
  },
  isAtEnd: false,
  pause() {
    this.base = this.seconds;
    this.startedAt = null;
  },
  resume() {
    this.startedAt = performance.now();
  },
};

const clock = location.hash.includes('nosound') ? silentClock : soundtrackClock;

/** Effects keep state from frame to frame, so every start or seek replays the demo from its beginning. */
function newDemoAt() {
  const next = createDemo(files);
  next.machine.romFont = romFont;
  return next;
}

/** Forward seeks continue; backward seeks replay from the start (playFrame catches up with the clock). */
function seek(seconds) {
  const target = Math.min(Math.max(0, seconds), audio.duration || seconds);
  if (target < demo.machine.time) {
    demo = newDemoAt();
    isExitScreenShown = false;
  }
  clock.seconds = target;
}

/** Set when the browser refuses to play the music; cleared by the next click or key press. */
let isPlaybackBlocked = false;
let playbackError = null;

function reportPlaybackError(error) {
  if (error.name === 'AbortError') {
    return;
  }
  isPlaybackBlocked = true;
  playbackError = error.message;
  hud.hidden = false;
  hud.textContent = `music: ${error.message} (click or press a key)`;
}

function allowPlaybackAgain() {
  isPlaybackBlocked = false;
}

addEventListener('pointerdown', allowPlaybackAgain);

function playFrame() {
  requestAnimationFrame(playFrame);
  if (demo.machine.hasFailed) {
    return;
  }
  try {
    step();
  } catch (error) {
    demo.machine.hasFailed = true;
    hud.hidden = false;
    hud.textContent = `error: ${error.message}`;
  }
}

let isExitScreenShown = false;

function step() {
  const target = clock.seconds;
  const deadline = performance.now() + FRAME_BUDGET_MS;
  demo.runUntil(target, () => performance.now() > deadline);
  const isBehind = demo.machine.time < target - 0.1 && !demo.machine.isOver;
  if (isBehind && !clock.isPaused) {
    clock.pause();
  } else if (!isBehind && clock.isPaused && !clock.isAtEnd) {
    clock.resume();
  }
  // The exit text screen does not change: draw it once.
  if (!(demo.machine.isOver && isExitScreenShown)) {
    screen.present(renderFrame(demo.machine));
    isExitScreenShown = demo.machine.isOver;
  }
  if (!hud.hidden && playbackError === null) {
    hud.textContent = `${target.toFixed(2)} s · machine ${demo.machine.time.toFixed(2)} s${clock.isPaused ? ' · paused' : ''}`;
  }
}

function start() {
  overlay.remove();
  hud.hidden = !location.hash.includes('hud');
  const requested = Number(location.hash.match(/t=([\d.]+)/)?.[1] ?? 0);
  const startSeconds = Math.min(requested, audio.duration || requested);
  demo = newDemoAt();
  clock.seconds = startSeconds;
  clock.resume();
  requestAnimationFrame(playFrame);
}

addEventListener('keydown', (event) => {
  allowPlaybackAgain();
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  if (event.key === 'f' || event.key === 'F') {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }
  if (!demo) {
    return;
  }
  if (event.key === 'ArrowRight') {
    seek(clock.seconds + SEEK_STEP_SECONDS);
  }
  if (event.key === 'ArrowLeft') {
    seek(clock.seconds - SEEK_STEP_SECONDS);
  }
});

let isLoaded = false;
let isStartRequested = false;

/** A click while loading is remembered: the demo starts as soon as everything has arrived. */
function requestStart() {
  if (isStartRequested) {
    return;
  }
  isStartRequested = true;
  if (isLoaded) {
    start();
  } else {
    // Unlocks audio inside the click, so that the start after loading may still play it (Safari).
    audio.play().then(() => audio.pause()).catch(() => {});
    status.textContent = 'loading, starting when ready';
  }
}

overlay.addEventListener('click', requestStart);
overlay.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    requestStart();
  }
});

try {
  const [exe, avi, fli, font] = await Promise.all([
    fetchBytes('CONTROL.EXE'),
    fetchBytes('DEMO.AVI'),
    fetchBytes('DEMO.FLI'),
    fetchBytes('assets/vga8x16.bin'),
    loadSoundtrack(),
  ]);
  files = { exe, avi, fli };
  romFont = font;
  isLoaded = true;
  status.textContent = 'click to start';
  if (isStartRequested) {
    start();
  }
} catch (error) {
  status.textContent = `failed to load — ${error.message}`;
}
