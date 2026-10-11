// Boot: fetch RED.EXE, the VGA font and the soundtrack, then run the demo on the soundtrack's clock.
import { Screen, renderFrame, isCursorBlinkOn } from './screen.js';
import { createDemo } from './demo.js';
import { unpackRed } from './pklite.js';

const SEEK_STEP_SECONDS = 5;
/** How long one browser frame may spend catching up with the music. */
const FRAME_BUDGET_MS = 12;

const overlay = document.getElementById('start');
const status = document.getElementById('status');
const hud = document.getElementById('hud');
const screen = new Screen(document.getElementById('screen'));
const audio = new Audio();

let image;
let font;
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

/** Parts keep state from frame to frame, so the start and every backward seek run the demo from its beginning. */
function newDemo() {
  return createDemo(image, font);
}

/** Forward seeks continue; backward seeks replay from the start (playFrame catches up with the clock). */
function seek(seconds) {
  if (seconds > clock.seconds && clock.isAtEnd) {
    return; // the end screen: nothing further to seek to
  }
  const target = Math.min(Math.max(0, seconds), audio.duration || seconds);
  if (target < demo.time) {
    demo = newDemo();
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
  playbackError = null;
}

addEventListener('pointerdown', allowPlaybackAgain);

function playFrame() {
  requestAnimationFrame(playFrame);
  if (demo.state.hasFailed) {
    return;
  }
  try {
    step();
  } catch (error) {
    demo.state.hasFailed = true;
    hud.hidden = false;
    hud.textContent = `error: ${error.message}`;
  }
}

/** Wall time when the soundtrack ended: the end screen keeps running on the wall clock from there. */
let endedAt = null;

/** The soundtrack's time, continued by the wall clock once it has ended. */
function targetSeconds() {
  if (!clock.isAtEnd) {
    endedAt = null;
    return clock.seconds;
  }
  endedAt ??= { wall: performance.now(), seconds: clock.seconds };
  return endedAt.seconds + (performance.now() - endedAt.wall) / 1000;
}

/** On the end screen: the cursor blink last drawn (null while the demo runs: every frame is drawn). */
let shownCursorBlink = null;

function step() {
  const target = targetSeconds();
  const deadline = performance.now() + FRAME_BUDGET_MS;
  demo.runUntil(target, () => performance.now() > deadline);
  const isBehind = demo.time < target - 0.1 && !demo.state.isOver;
  if (isBehind && !clock.isPaused) {
    clock.pause();
  } else if (!isBehind && clock.isPaused && !clock.isAtEnd) {
    clock.resume();
  }
  // The end screen only changes when the cursor blinks.
  const cursorBlink = isCursorBlinkOn(demo.state.vga);
  if (!demo.state.isOver || cursorBlink !== shownCursorBlink) {
    screen.present(renderFrame(demo.state.vga));
    shownCursorBlink = demo.state.isOver ? cursorBlink : null;
  }
  if (!hud.hidden && playbackError === null) {
    hud.textContent = `${target.toFixed(2)} s · machine ${demo.time.toFixed(2)} s${clock.isPaused ? ' · paused' : ''}`;
  }
}

function start() {
  overlay.remove();
  hud.hidden = !location.hash.includes('hud');
  const requested = Number(location.hash.match(/t=([\d.]+)/)?.[1] ?? 0);
  const startSeconds = Math.min(requested, audio.duration || requested);
  demo = newDemo();
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
  let exe;
  [exe, font] = await Promise.all([fetchBytes('RED.EXE'), fetchBytes('assets/vgafont.bin'), loadSoundtrack()]);
  ({ image } = unpackRed(exe));
  isLoaded = true;
  status.textContent = 'click to start';
  if (isStartRequested) {
    start();
  }
} catch (error) {
  status.textContent = `failed to load — ${error.message}`;
}
