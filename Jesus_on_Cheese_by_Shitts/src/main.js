// Boot: load the disk, start the audio thread, and run the demo from the audio clock.
// The audio worklet runs its own copy of the demo without drawing, so the music comes from the demo's own
// replay routines and Paula; this thread runs another copy and draws it. Both are deterministic, so they agree.
import { Screen } from './screen.js';
import { createRunner } from './demo.js';
import { FRAME_MS } from './machine.js';

const SEEK_STEP_MS = 5000;
/** Demo time is scheduled this far ahead on the audio clock, so the worklet has time to build its runner. */
const SCHEDULE_AHEAD_S = 0.15;
/**
 * A click is scheduled this far beyond the output latency: the audio thread mixes ahead of the picture by the
 * latency plus up to a frame, and a click it has already passed costs it a replay.
 */
const CLICK_MARGIN_MS = 60;
/** Key repeats within this time make one seek: every seek replays the demo from zero, on both threads. */
const SEEK_SETTLE_MS = 250;
const DISK_URL = 'assets/jesus-on-cheese.adf';

const overlay = document.getElementById('start');
const status = document.getElementById('status');
const hud = document.getElementById('hud');
const canvas = document.getElementById('screen');
const screen = new Screen(canvas);
const params = new URLSearchParams(location.hash.slice(1));
const isSilent = params.has('nosound');

let audio = null;
let worklet = null;
let disk = null;
let runner = null;
/** Frames at which the viewer pressed the left mouse button. */
let clicks = [];
/** Demo time 0, in seconds on the clock now() reads. */
let startedAt = 0;
/** Whether the worklet has had its 'start'. */
let hasStarted = false;

function outputLatency() {
  return audio ? audio.outputLatency || audio.baseLatency || 0 : 0;
}

/** Seconds on the audio clock, minus the output latency: the picture follows what the speaker plays. */
function clockSeconds() {
  if (!audio) {
    return performance.now() / 1000;
  }
  return audio.currentTime - outputLatency();
}

function showError(message) {
  hud.hidden = false;
  hud.textContent = message;
}

function now() {
  return (clockSeconds() - startedAt) * 1000;
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function startAudio() {
  audio = new AudioContext();
  if (!audio.audioWorklet) {
    throw new Error('this browser only plays it over https or from localhost');
  }
  // Inside the click that started it: some browsers forget the gesture across the module fetch below.
  const resuming = audio.resume();
  await audio.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
  worklet = new AudioWorkletNode(audio, 'paula', { numberOfInputs: 0, outputChannelCount: [2] });
  worklet.connect(audio.destination);
  worklet.port.onmessage = (event) => {
    if (event.data.type === 'error') {
      showError(`sound stopped: ${event.data.message.split('\n')[0]}`);
    }
  };
  worklet.onprocessorerror = () => showError('sound stopped');
  await resuming;
}

/** The demo is deterministic, so seeking is replaying it from zero without showing it. */
function seek(timeMs) {
  const target = Math.max(0, timeMs);
  clicks = clicks.filter((frame) => frame * FRAME_MS < target);
  runner = createRunner(disk, { clicks: [...clicks] });
  runner.advanceTo(target);
  if (!worklet) {
    startedAt = clockSeconds() - target / 1000;
    return;
  }
  // Both threads: demo ms = target + (currentTime - contextTime) * 1000.
  const contextTime = audio.currentTime + SCHEDULE_AHEAD_S;
  startedAt = contextTime - target / 1000;
  if (hasStarted) {
    worklet.port.postMessage({ type: 'seek', ms: target, clicks: [...clicks], contextTime });
  } else {
    worklet.port.postMessage({ type: 'start', adf: disk, startMs: target, clicks: [...clicks], contextTime });
    hasStarted = true;
  }
}

let pendingSeek = null;

/** Seek once the arrow keys have settled. */
function requestSeek(timeMs) {
  pendingSeek = { target: Math.max(0, timeMs), timer: pendingSeek?.timer };
  clearTimeout(pendingSeek.timer);
  pendingSeek.timer = setTimeout(() => {
    const { target } = pendingSeek;
    pendingSeek = null;
    seek(target);
  }, SEEK_SETTLE_MS);
}

function frame() {
  try {
    runner.advanceTo(Math.max(0, now()));
    screen.present(runner.m);
  } catch (error) {
    showError(`stopped: ${error.message}`);
    return;
  }
  if (params.has('hud')) {
    hud.textContent = `${(now() / 1000).toFixed(2)}s`;
  }
  requestAnimationFrame(frame);
}

/** A click on the picture is the left mouse button: it ends parts 1 and 2 early and restarts the end scroller. */
function pressLeftButton(event) {
  if (event.button !== 0) {
    return;
  }
  const leadFrames = Math.ceil((outputLatency() * 1000 + CLICK_MARGIN_MS) / FRAME_MS);
  const frameNumber = runner.m.frame + leadFrames;
  clicks.push(frameNumber);
  runner.m.clicks.push(frameNumber);
  worklet?.port.postMessage({ type: 'click', frame: frameNumber });
}

async function start() {
  overlay.remove();
  hud.hidden = !params.has('hud');
  if (!isSilent) {
    try {
      await startAudio();
    } catch (error) {
      audio = null;
      worklet = null;
      showError(`no sound: ${error.message}`);
    }
  }
  seek((Number(params.get('t')) || 0) * 1000);
  canvas.addEventListener('pointerdown', pressLeftButton);
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
    requestSeek((pendingSeek?.target ?? now()) + SEEK_STEP_MS);
  }
  if (event.key === 'ArrowLeft') {
    requestSeek((pendingSeek?.target ?? now()) - SEEK_STEP_MS);
  }
});

try {
  disk = await fetchBytes(DISK_URL);
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
