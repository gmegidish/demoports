// 0000:0073('THE END', 2), 709.65 s, then the music fade-out and the text screen of the exit procedure
// (0000:a2c1). Notes: docs/disassembly/P08_parts_7d84_0073.md.
import { f32 } from '../machine.js';
import { gradient, addPalette, timedFade, remapRange, maxBlend } from '../gfx.js';
import { fadePage } from '../effects.js';
import { loadPicture } from '../picture.js';
import { Light } from '../engine3d.js';
import { buildText3d } from '../text3d.js';
import { ATTRIBUTE_TO_DAC, TEXT_COLOURS } from '../textscreen.js';
import { partInit, mark, elapsed, frame, fps } from './common.js';

const FRAME_SECONDS = fps(70);
const SCRATCH_PAGE = 102;
const STYLE_COLOURS = [[63, 30, 0], [63, 0, 30], [0, 0, 50], [63, 0, 63], [0, 40, 63], [60, 63, 20]];
const LOOP_TICKS = 1100;
const FADE_OUT_END = 1500;
/** 0d27:03ef: the volume steps from 64 to 0, Delay(20) each. */
const MUSIC_FADE_SECONDS = 65 * 0.02;
const TEXT_FADE_TICKS = 200;

function shapeWord(word) {
  word.scaleUniform(f32(0.9));
  word.scale(0.8, 1, 3);
  word.center();
  word.rotate(-110, 0, 0);
}

/** 0000:0073 */
export function* endPart(m, text = 'THE END', style = 2) {
  const e = m.engine;
  const partStart = partInit(m);
  m.setActivePage(1);
  loadPicture(m, SCRATCH_PAGE, 0x25);
  const saved = m.palette.slice();
  remapRange(m, SCRATCH_PAGE, 0, 0xa6, 0x46);
  m.fillActive(0);
  m.setPalette(saved);
  e.perspective = 200;
  const c = STYLE_COLOURS[style];
  gradient(m, 0, 220, 0, 0, 0, ...c);
  gradient(m, 220, 255, ...c, 63, 63, 63);
  e.freeLights();
  e.addLight(new Light(e, -150, 0, 300, 600, 255));
  const space = text.indexOf(' ');
  const words = [];
  if (space >= 0) {
    words.push(buildText3d(e, text.slice(0, space), 5, 0x10, 1, 1));
    const second = buildText3d(e, text.slice(space + 1), 5, 0x10, 1, 1);
    shapeWord(second);
    words[0].translate(0, -30, 0);
    second.translate(0, 30, 0);
    words.push(second);
  } else {
    words.push(buildText3d(e, text, 5, 0x10, 1, 1));
  }
  shapeWord(words[0]);
  m.setActivePage(1);
  addPalette(m, 0, 255, -60, -60, -60);
  m.copyPage(SCRATCH_PAGE, 1);
  m.present();
  yield* timedFade(m, 0, 255, 1, 1, 1, 60, 200);
  const loopStart = mark(m);
  for (;;) {
    const t = elapsed(m, loopStart);
    if (t < 400) {
      e.lights[1].setPos(-150, 0, f32(300 - (t * 210) / 400));
    } else {
      e.lights[1].setPos(f32(((t - 400) * 600) / 1000 - 150), 0, 90);
    }
    fadePage(m, 5);
    m.fillActive(0);
    const rot = f32((t * 180) / 800 - 40);
    for (const word of words) {
      word.rotateWork(rot, 0, 0);
      word.draw();
    }
    maxBlend(m.getPage(SCRATCH_PAGE), m.getPage(1));
    m.present();
    yield* frame(m, FRAME_SECONDS);
    if (t > LOOP_TICKS) {
      break;
    }
  }
  m.freePage(SCRATCH_PAGE);
  m.freePage(1);
  yield* timedFade(m, 0, 255, -1, -1, -1, 64, FADE_OUT_END - elapsed(m, partStart));
  m.getPage(0).fill(0, 0, 64000);
}

/** main's music fade (0d27:03ef) and 0000:a616, then the exit procedure's text screen (0000:a2c1). */
export function* exitScreen(m) {
  yield m.time + MUSIC_FADE_SECONDS;
  m.getPage(0).fill(0, 0, 64000);
  m.setTextMode();
  m.textScreen = m.resources[42].slice(0, 4000);
  for (let i = 0; i < 16; i++) {
    m.setColor(ATTRIBUTE_TO_DAC[i], ...TEXT_COLOURS[i]);
  }
  addPalette(m, 0, 255, -64, -64, -64);
  yield* timedFade(m, 0, 255, 1, 1, 1, 64, TEXT_FADE_TICKS);
}
