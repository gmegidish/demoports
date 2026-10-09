// Boot: fetch the executable, the data files and the soundtrack, then run the demo on the soundtrack's clock.
import { Screen, renderFrame } from './screen.js'
import { createDemo } from './demo.js'

const SEEK_STEP_SECONDS = 5
// how long one browser frame may spend catching up with the music
const FRAME_BUDGET_MS = 12
const DATA_FILES = [
  'ADEPT.LBM', 'CLOUDS.LBM', 'ENDPIGS.LBM', 'JASON.LBM', 'JOACHIM.LBM', 'MELON.LBM', 'OUTSIDE.LBM',
  'PAL1.LBM', 'PAL2.LBM', 'PAL3.BBM', 'PANORAMA.LBM', 'ROOM.LBM', 'SITTING.LBM',
  'TEXT1.LBM', 'TEXT2.LBM', 'TEXT3.LBM', 'TEXT4.LBM', 'TEXT5.LBM',
  'TEXTURE2.LBM', 'TEXTURE3.LBM', 'TEXTURE4.LBM', 'TEXTURE5.LBM', 'TEXTURE6.LBM', 'TITLEPIG.LBM',
  'TUNNEL1.MAP', 'TUNNEL1.SHD', 'TUNNEL2.MAP', 'TUNNEL2.SHD', 'TUNNEL3.MAP', 'TUNNEL3.SHD', 'TUNNEL4.MAP', 'TUNNEL4.SHD',
  'WIPE1.LBM', 'WIPE2.LBM', 'WIPE4.LBM',
]

const overlay = document.getElementById('start')
const status = document.getElementById('status')
const hud = document.getElementById('hud')
const screen = new Screen(document.getElementById('screen'))
const audio = new Audio()

let files
let demo

async function fetchBytes(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

// the whole file goes into a blob, so seeking works on static hosts without range requests
async function loadSoundtrack() {
  const bytes = await fetchBytes('assets/soundtrack.ogg')
  audio.src = URL.createObjectURL(new Blob([bytes], { type: 'audio/ogg' }))
}

async function loadFiles() {
  const names = ['OUTSIDE.EXE', ...DATA_FILES]
  const contents = await Promise.all(names.map((name) => fetchBytes(name === 'OUTSIDE.EXE' ? name : `DATA/${name}`)))
  return Object.fromEntries(names.map((name, i) => [name, contents[i]]))
}

// the soundtrack is the clock
const soundtrackClock = {
  get seconds() {
    return audio.currentTime
  },
  set seconds(value) {
    audio.currentTime = value
  },
  get isPaused() {
    return audio.paused
  },
  pause() {
    audio.pause()
  },
  resume() {
    if (isPlaybackBlocked) {
      return
    }
    audio.play().then(clearPlaybackError, reportPlaybackError)
  },
}

// #nosound: the wall clock instead, for automated checks where a browser refuses to play audio
const silentClock = {
  base: 0,
  startedAt: null,
  get seconds() {
    return this.startedAt === null ? this.base : this.base + (performance.now() - this.startedAt) / 1000
  },
  set seconds(value) {
    this.base = value
    if (this.startedAt !== null) {
      this.startedAt = performance.now()
    }
  },
  get isPaused() {
    return this.startedAt === null
  },
  pause() {
    this.base = this.seconds
    this.startedAt = null
  },
  resume() {
    this.startedAt = performance.now()
  },
}

const clock = location.hash.includes('nosound') ? silentClock : soundtrackClock

// the parts keep state from frame to frame, so a backward seek replays the demo from its beginning
function seek(seconds) {
  const target = Math.max(0, Math.min(seconds, audio.duration || seconds))
  if (target < demo.time) {
    demo = createDemo(files)
  }
  clock.seconds = target
}

// set when the browser refuses to play the music; cleared by the next click or key press
let isPlaybackBlocked = false
let playbackError = null

function reportPlaybackError(error) {
  if (error.name === 'AbortError') {
    return
  }
  isPlaybackBlocked = true
  playbackError = error.message
  hud.hidden = false
  hud.textContent = `music: ${error.message} (click or press a key)`
}

function clearPlaybackError() {
  if (playbackError !== null) {
    playbackError = null
    hud.hidden = !location.hash.includes('hud')
  }
}

function allowPlaybackAgain() {
  isPlaybackBlocked = false
}

addEventListener('pointerdown', allowPlaybackAgain)

let hasFailed = false

function playFrame() {
  requestAnimationFrame(playFrame)
  if (hasFailed) {
    return
  }
  try {
    step()
  } catch (error) {
    hasFailed = true
    hud.hidden = false
    hud.textContent = `error: ${error.message}`
  }
}

function step() {
  const target = clock.seconds
  const deadline = performance.now() + FRAME_BUDGET_MS
  demo.runUntil(target, () => performance.now() > deadline)
  // the soundtrack loops after "THE END"; the picture never changes again, so the demo just stays ahead
  const isBehind = demo.time < target - 0.1
  if (isBehind && !clock.isPaused) {
    clock.pause()
  } else if (!isBehind && clock.isPaused) {
    clock.resume()
  }
  screen.present(renderFrame(demo.machine))
  if (!hud.hidden && playbackError === null) {
    hud.textContent = `${target.toFixed(2)} s · tick ${demo.tick} · ${demo.part}${clock.isPaused ? ' · paused' : ''}`
  }
}

function start() {
  try {
    demo = createDemo(files)
  } catch (error) {
    status.textContent = `failed to start — ${error.message}`
    return
  }
  overlay.remove()
  hud.hidden = !location.hash.includes('hud')
  const requested = Number(location.hash.match(/t=([\d.]+)/)?.[1] ?? 0)
  audio.loop = true
  clock.seconds = Math.min(requested, audio.duration || requested)
  clock.resume()
  requestAnimationFrame(playFrame)
}

addEventListener('keydown', (event) => {
  allowPlaybackAgain()
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return
  }
  if (event.key === 'f' || event.key === 'F') {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      document.documentElement.requestFullscreen().catch(() => {})
    }
  }
  if (!demo) {
    return
  }
  if (event.key === 'ArrowRight') {
    seek(clock.seconds + SEEK_STEP_SECONDS)
  }
  if (event.key === 'ArrowLeft') {
    seek(clock.seconds - SEEK_STEP_SECONDS)
  }
})

let isLoaded = false
let isStartRequested = false

// a click while loading is remembered: the demo starts as soon as everything has arrived
function requestStart() {
  if (isStartRequested) {
    return
  }
  isStartRequested = true
  if (isLoaded) {
    start()
  } else {
    // unlocks audio inside the click, so that the start after loading may still play it (Safari)
    audio.play().then(() => audio.pause()).catch(() => {})
    status.textContent = 'loading, starting when ready'
  }
}

overlay.addEventListener('click', requestStart)
overlay.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    requestStart()
  }
})

try {
  const [loaded] = await Promise.all([loadFiles(), loadSoundtrack()])
  files = loaded
  isLoaded = true
  status.textContent = 'click to start'
  if (isStartRequested) {
    start()
  }
} catch (error) {
  status.textContent = `failed to load — ${error.message}`
}
