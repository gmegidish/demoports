// The port against the original running in DOSBox (see README: recording frame n is shown after timer tick n).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newDemo, runToTick, screenRgb, recordedFrame, countDifferentPixels } from './helpers.js'

// Each recorded frame and the tick whose picture it shows. The recording copies the frame buffer to the
// screen some ticks after the render started (slow renders, no retrace sync): that is the gap.
const EXACT_FRAMES = [
  { frame: 500, tick: 500, what: 'the title tunnel fading in' },
  { frame: 1100, tick: 1099, what: 'the title picture over the tunnel' },
  { frame: 4060, tick: 4058, what: 'the pig in the turning room' },
  { frame: 6000, tick: 6000, what: 'the pigs in the oval' },
  { frame: 7700, tick: 7699, what: '"MACK AND WALT" being wiped in' },
  { frame: 10200, tick: 10200, what: '"THE END"' },
]

// the white flashes of the part starts in the recording, within a tick
const PART_STARTS = [
  { part: 'credits', tick: 1217 },
  { part: 'pigpan', tick: 2688 },
  { part: 'text', variant: 0, tick: 3189 },
  { part: 'room', tick: 3911 },
  { part: 'text', variant: 1, tick: 4693 },
  { part: 'logo', variant: 0, tick: 5895 },
  { part: 'landscape', tick: 6395 },
  { part: 'logo', variant: 1, tick: 7197 },
]

test('frames of the original are reproduced pixel for pixel', () => {
  const demo = newDemo()
  for (const { frame, tick, what } of EXACT_FRAMES) {
    runToTick(demo, tick)
    assert.equal(countDifferentPixels(screenRgb(demo.machine), recordedFrame(frame)), 0, what)
  }
})

test('the parts start when they start in the original', () => {
  const demo = newDemo()
  for (const expected of PART_STARTS) {
    const isStarted = () => demo.part === expected.part && demo.variant === (expected.variant ?? 0)
    while (!isStarted()) {
      demo.step()
    }
    assert.ok(Math.abs(demo.tick - expected.tick) <= 1, `${expected.part} started at tick ${demo.tick}, expected ${expected.tick}`)
  }
})

test('the picture never changes after "THE END"', () => {
  const demo = newDemo()
  runToTick(demo, 10200)
  const theEnd = screenRgb(demo.machine)
  runToTick(demo, 20000)
  assert.equal(countDifferentPixels(screenRgb(demo.machine), theEnd), 0)
})
