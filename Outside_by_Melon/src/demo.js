// The timeline: the MIDAS timer callback 0x10060 runs the current part's tick once per vertical
// retrace; the main loop 0x10360 renders the current part as often as the machine allows.
import { createMachine, TICK_HZ } from './machine.js'
import { createEngine } from './engine3d.js'
import { createTitle } from './parts/title.js'
import { createRoom } from './parts/room.js'
import { createCredits } from './parts/credits.js'
import { createPigpan } from './parts/pigpan.js'
import { createText } from './parts/text.js'
import { createLogo } from './parts/logo.js'
import { createLandscape } from './parts/landscape.js'

// The timer runs the title's tick during the end of loading, 16 times before the title starts (0x12620).
export const TICKS_BEFORE_START = 16
// Measured on the recording: the music starts 3.6 ticks after the title, and MIDAS plays it slightly
// slower than openmpt renders it, so one second of the soundtrack is 70.1445 ticks.
const MUSIC_START_TICK = TICKS_BEFORE_START + 3.6
const TICKS_PER_SOUNDTRACK_SECOND = TICK_HZ * 1.000834

// The main loop does not wait for the retrace, so the state that advances per render (wipes, the
// star's light) depends on the machine's speed. These are the renders per tick of the recording.
const RENDERS_PER_TICK = {
  title: 1,
  credits: 0.5,
  pigpan: 1,
  text: 0.406,
  textWipingOut: 0.426,
  room: 0.5, // the 3D room takes about two frames
  logo: 1,
  logoTexts: 0.5, // waits for the retrace and misses the next one
  landscape: 1,
}

export function createDemo(files) {
  const m = createMachine(files)
  const e = createEngine()
  const demo = {
    machine: m,
    logoBuffer: new Uint8Array(64000), // 0x1fd744, allocated by text.C, shared with credits and logo
    tick: 0, // timer callbacks so far
    part: 'title',
    variant: 0,
    renderCredit: 0,
    // the soundtrack's time at this tick
    get time() {
      return (demo.tick - MUSIC_START_TICK) / TICKS_PER_SOUNDTRACK_SECOND
    },
    // a render function switching parts: the new part starts now, the old render finishes its frame
    switchTo(part, variant = 0) {
      demo.part = part
      demo.variant = variant
      parts[part].start(variant)
      demo.renderCredit = 0
    },
    // one timer callback, then the renders the main loop manages before the next one
    step() {
      demo.tick++
      parts[demo.part].tick()
      if (demo.tick < TICKS_BEFORE_START) {
        return
      }
      if (demo.tick === TICKS_BEFORE_START) {
        parts.title.start()
        demo.renderCredit = 1
      } else {
        demo.renderCredit += rendersPerTick()
      }
      if (demo.renderCredit >= 1) {
        demo.renderCredit -= 1
        parts[demo.part].render()
      }
    },
    // runs to the soundtrack's time
    runUntil(seconds, shouldYield = () => false) {
      while (demo.time < seconds && !shouldYield()) {
        demo.step()
      }
    },
  }
  const parts = {
    title: createTitle(m, demo),
    room: createRoom(m, e, demo),
    credits: createCredits(m, e, demo),
    pigpan: createPigpan(m, demo),
    text: createText(m, e, demo),
    logo: createLogo(m, demo),
    landscape: createLandscape(m, e, demo),
  }
  function rendersPerTick() {
    if (demo.part === 'text' && parts.text.isWipingOut) {
      return RENDERS_PER_TICK.textWipingOut
    }
    if (demo.part === 'logo' && demo.variant === 1) {
      return RENDERS_PER_TICK.logoTexts
    }
    return RENDERS_PER_TICK[demo.part]
  }
  return demo
}
