// Frames of the original, recorded in DOSBox (see README), that the port reproduces pixel for pixel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDemo, runToFrame, screenRgb, recordedFrame, countDifferentPixels } from './helpers.js';

/**
 * One recorded frame in each effect, in order: the blue cubes, intro, credits, plasma, cyclic plasma, chess, glentz,
 * wobbler, chess zoomer, spheres, glentz chess cube, greetings, dot tunnel,
 * transforming objects, contour city, picture zoomer, fractal zoomer, glentz cubes, 3200 dots.
 */
const RECORDED_FRAMES = [300, 1500, 3000, 4405, 6000, 8300, 10500, 11300, 13200, 15500, 17000, 18300,
  19700, 21300, 22500, 23800, 25400, 27500, 30300];
/**
 * The recording's first frame in text mode, after the music fade: the 'ending' screen. DOSBox shows a mode
 * change one frame after the code makes it, so the port switches during the frame before.
 */
const END_SCREEN_FRAME = 31997;

test('every effect shows the recorded frame, pixel for pixel', () => {
  const demo = newDemo();
  let retraces = 0;
  for (const frame of RECORDED_FRAMES) {
    retraces = runToFrame(demo, frame, retraces);
    assert.equal(countDifferentPixels(screenRgb(demo), recordedFrame(frame)), 0, `at frame ${frame}`);
  }
});

test('the demo runs to the end screen on the recorded frame', () => {
  const demo = newDemo();
  runToFrame(demo, END_SCREEN_FRAME - 2, 0);
  assert.equal(demo.state.vga.isTextMode, false);
  demo.step();
  assert.equal(demo.state.vga.isTextMode, true);
  assert.equal(demo.state.isOver, true);
});

/** Where DOSBox shows something a VGA card does not, the port follows the card (README, "Like a VGA card"). */
const VGA_NOT_DOSBOX = [
  // The morphing lines: DOSBox shows stale video memory around the box; a VGA shows the cleared, black memory.
  { frame: 7200, portColour: [0, 0, 0] },
  // The water: DOSBox keeps old values for colours 60..62 written in a 16-colour mode; a VGA shows them white.
  { frame: 9500, portColour: [255, 255, 255] },
];

test('where DOSBox differs from a VGA card, the port shows what the card shows', () => {
  const demo = newDemo();
  let retraces = 0;
  for (const { frame, portColour } of VGA_NOT_DOSBOX) {
    retraces = runToFrame(demo, frame, retraces);
    const port = screenRgb(demo);
    const recorded = recordedFrame(frame);
    let differing = 0;
    for (let i = 0; i < port.length; i += 3) {
      if (port[i] !== recorded[i] || port[i + 1] !== recorded[i + 1] || port[i + 2] !== recorded[i + 2]) {
        differing++;
        assert.deepEqual([port[i], port[i + 1], port[i + 2]], portColour, `at frame ${frame}`);
      }
    }
    assert.ok(differing > 0, `frame ${frame} should differ from DOSBox`);
  }
});
