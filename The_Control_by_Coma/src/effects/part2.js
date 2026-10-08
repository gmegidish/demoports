// The part-2 effects in mode 13h (ticks 0..2456, 3740..4296, 4809..4899, 6733..7159, 7908..): the COMA photo, the
// face drawing, the 160x100 video with its captions, the morph animations crossfaded with the rotozoomer, the
// starburst "What is wrong ?", the text rotozoomers, the map renderer, "Scream", the face anim and "END".
// Notes: C1 §7-§9, C2, C4, C5, C6. The 3D gear scenes (0x55be8, 0x55b6c, 0x55f1e) are in objects.js.
import {
  workBuffer,
  isFirstCall,
  clearW,
  toRamp,
  decay,
  feedbackAdd,
  grain,
  grainSaturate,
  lerpIntoW,
  upscale2x,
  blit,
  buildStarburstTexture,
  fillWithRampBase,
  setPaletteFromTexture,
} from '../helpers.js';
import {
  TEXTURE_BUFFER_POINTER,
  BUFFER_A_POINTER,
  ROTOZOOM_BUFFER_POINTER,
  SINE_BYTES,
  ANGLE_Z,
  TEXTURE_POINTER,
  RIX_PIXELS,
  GRAIN_LEVEL,
  GRAIN_COUNT,
  GRAIN_ADD,
  PALETTE_PULSE_OFF,
  LERP_T,
  UPSCALE_2X_ADD,
} from '../addresses.js';
import { aviItem, fliItem } from '../tables.js';
import { drawText, TEXT_POINTER, TEXT_COLOUR_BASE } from '../text.js';
import {
  MORPH_ITEM,
  UPSCALE_ROWS,
  UPSCALE_SHIFT,
  UPSCALE_ADD,
  SCROLLER_POSITION,
  resetAnimation,
  stepAnimation,
  redisplayAnimation,
} from '../morph.js';
import {
  decodePicture,
  drawVideoFrame,
  rotozoom,
  drawTextIntoTexture,
  renderMap,
  ZOOM_INDEX,
  TEXEL_SHIFT,
} from './part2routines.js';

/**
 * Passes of the main loop per second, fitted against the recording where a pass leaves a trace:
 * - map (0x55121 adds 1/1/3/2 per pass): the best-fitting per-pass offset drifts by +55/s at 70, stays within
 *   +-10 over 18 s at 125;
 * - crossfade and text rotozoom (one 0x1c2f8 trail decay per pass): least error at 28..33 and 32..35;
 * - 0x545bd: its feedback settles within a few passes, so any rate from 15 to 70 fits (30 = one per tick);
 * - the anims and videos only need more passes than frame requests (they then match the recording exactly;
 *   0x54507 at 9..10.5 passes/s falls behind); video 61 and face 44 are the recording's change counts (C6).
 */
const PASSES = {
  photo: 35,
  video: 61,
  crossfade: 31,
  animation: 35,
  starburst: 30,
  textRotozoom: 33,
  map: 125,
  faceAnimation: 44,
  end: 35,
};

const FRAME_ACCUMULATOR = 0x53f8a;
const FULL_GRAIN_COUNT = 0xfa00;
const GRAIN_RAMP_BASE = 0xc0;
const CAPTION_COLOUR_BASE = 0xc0;
const PIXELS = 0xfa00;
const ROTOZOOM_PIXELS = 0x3e80;
const PULSE = 0x542fc;
const RAMP_FIRST = 0xc0;

const FIRST_CALL = {
  photo: 0x53faf,
  crossfade: 0x54313,
  crowd: 0x544de,
  starburst: 0x545bc,
  bushes: 0x54688,
  systemDivines: 0x55059,
  systemDivinesModeSet: 0x5505a,
  nature: 0x55229,
  scream: 0x55528,
  face: 0x55fa3,
};

/** The 0x53fb0 first call writes 2, the others 1. */
const PHOTO_FLAG_VALUE = 2;
const PHOTO_GRAIN_LEVEL = 0x40;
const VIDEO_GRAIN_LEVEL = 8;
const SCREAM_GRAIN_LEVEL = 4;
const ROTOZOOM_ZOOM = 0x32;
const CROSSFADE_SHIFT = 3;
const CROWD_SHIFT = 2;
const ANIMATION_ROWS = 0x30;
const FACE_SHIFT = 3;
const BUSHES_LERP_T = 0x28;
const TEXT_TEXEL_SHIFT = 1;
const AVI_TEXEL_SHIFT = 3;

const ITEM = { photo: 2, faceDrawing: 11, crossfadeAnimation: 4, ringTexture: 7, crowd: 8, bushes: 12, digitTexture: 13 };
const MAP_ITEM = 6;
const NATURE_TEXTURE_ITEM = 17;
const SYSTEM_TEXTURE_ITEM = 18;
const FACE_ITEM = 19;

/** The rotozoom layers of 0x5486d / 0x54a2c: zoom index and angle dwords per layer. */
const ZOOM_A = 0x5475e;
const ZOOM_B = 0x54762;
const ANGLE_A = 0x54766;
const ANGLE_B = 0x5476a;

const TEXT = {
  control: 0x54009,
  captions: 0x54175,
  captionOffset: 0x5426f,
  weSeeNothing: 0x54300,
  weDoNotMove: 0x543d8,
  weAreMass: 0x544df,
  whatIsWrong: 0x5459c,
  andTheySaid: 0x54689,
  someDay: 0x5476e,
  someDayTexture: 0x547a5,
  weWillSee: 0x54a1e,
  weWillSeeTexture: 0x54938,
  systemDivines: 0x5505b,
  nature: 0x5522a,
  scream: 0x55559,
  end: 0x5601d,
};
const POSITION = { caption: 0x3e80, lowerLeft: 0x960a, bottom: 0xc805, scream: 0x3223, end: 0x5802 };

function text(m, destination, address, colourBase) {
  m.set32(TEXT_POINTER, address);
  if (colourBase !== undefined) {
    m.set8(TEXT_COLOUR_BASE, colourBase);
  }
  drawText(m, destination);
}

/** RESET_ANIM with the frame accumulator: the init of every animation effect. */
function restartAnimation(m) {
  m.set8(FRAME_ACCUMULATOR, 0);
  resetAnimation(m);
}

function selectAnimation(m, item, shift, add) {
  m.set32(MORPH_ITEM, item);
  m.set8(UPSCALE_SHIFT, shift);
  m.set8(UPSCALE_ADD, add);
}

/** int 10h ax=13h. */
function setMode13(m) {
  m.setMode13();
  m.borderColor = 0;
}

function loadGreyRamp(m) {
  m.dacGreyRamp(RAMP_FIRST);
}

/** blendT = [0x542fc] with its low byte replaced by sin8[[0x542fc]] >> 1. */
function pulseLerpT(m) {
  const pulse = m.u32(PULSE);
  return ((pulse & ~0xff) | (m.u8((SINE_BYTES + pulse) >>> 0) >> 1)) >>> 0;
}

// ---- the effects ----

/** 0x53fb0: the COMA photo (AVI[2]) decoded every pass, plus grain. */
function photo(m) {
  if (isFirstCall(m, FIRST_CALL.photo, PHOTO_FLAG_VALUE)) {
    m.set8(GRAIN_LEVEL, PHOTO_GRAIN_LEVEL);
  }
  decodePicture(m, aviItem(m, ITEM.photo), workBuffer(m));
  grain(m, workBuffer(m));
  blit(m, workBuffer(m));
}

/** 0x54043: the drawing AVI[11] inverted and dimmed to 0..31, grain, "the / CONTROL". */
function faceDrawing(m) {
  decodePicture(m, aviItem(m, ITEM.faceDrawing), workBuffer(m));
  const w = workBuffer(m);
  for (let i = 0; i < PIXELS; i++) {
    m.mem[w + i] = (~m.mem[w + i] & 0xff) >> 3;
  }
  grain(m, w);
  text(m, w, TEXT.control, CAPTION_COLOUR_BASE);
  blit(m, w);
}

/** 0x540ca: the video with light grain. */
function video(m) {
  m.set8(GRAIN_LEVEL, VIDEO_GRAIN_LEVEL);
  drawVideoFrame(m);
  grain(m, workBuffer(m));
  blit(m, workBuffer(m));
}

/** 0x54273: the video + the caption 0x54175 + [0x5426f] at row 50. */
function videoWithCaption(m) {
  drawVideoFrame(m);
  grain(m, workBuffer(m));
  text(m, workBuffer(m) + POSITION.caption, TEXT.captions + m.u32(TEXT.captionOffset), CAPTION_COLOUR_BASE);
  blit(m, workBuffer(m));
}

/** The ring texture AVI[7] rotozoomed into the trail buffer, doubled into bufA, crossfaded with the anim in W. */
function crossfadeWithRing(m) {
  m.set32(ZOOM_INDEX, ROTOZOOM_ZOOM);
  rotozoom(m, aviItem(m, ITEM.ringTexture));
  upscale2x(m, m.u32(BUFFER_A_POINTER));
  m.set32(LERP_T, pulseLerpT(m));
  lerpIntoW(m);
}

/** 0x54314: the gas-mask anim (AVI[4]) crossfaded with the rotozoomer, "We see nothing..". */
function weSeeNothing(m) {
  if (isFirstCall(m, FIRST_CALL.crossfade)) {
    restartAnimation(m);
    fillWithRampBase(m);
  }
  decay(m, m.u32(ROTOZOOM_BUFFER_POINTER), ROTOZOOM_PIXELS);
  selectAnimation(m, aviItem(m, ITEM.crossfadeAnimation), CROSSFADE_SHIFT, 0);
  stepAnimation(m);
  crossfadeWithRing(m);
  text(m, workBuffer(m), TEXT.weSeeNothing, CAPTION_COLOUR_BASE);
  blit(m, workBuffer(m));
}

/** 0x54456: the same with the anim frozen, "we do not move ...". */
function weDoNotMove(m) {
  decay(m, m.u32(ROTOZOOM_BUFFER_POINTER), ROTOZOOM_PIXELS);
  m.set8(UPSCALE_SHIFT, CROSSFADE_SHIFT);
  m.set8(UPSCALE_ADD, 0);
  redisplayAnimation(m);
  crossfadeWithRing(m);
  text(m, workBuffer(m), TEXT.weDoNotMove);
  blit(m, workBuffer(m));
}

/** 0x54507: the supermarket anim (AVI[8]) direct, "we are mass / under systems / CONTROL!". */
function weAreMass(m) {
  if (isFirstCall(m, FIRST_CALL.crowd)) {
    restartAnimation(m);
    fillWithRampBase(m);
  }
  selectAnimation(m, aviItem(m, ITEM.crowd), CROWD_SHIFT, GRAIN_RAMP_BASE);
  stepAnimation(m);
  text(m, workBuffer(m) + POSITION.lowerLeft, TEXT.weAreMass);
  blit(m, workBuffer(m));
}

/** 0x545bd: the starburst fed back in W itself (which keeps the +0xc0), grain from sin8 read past its end. */
function whatIsWrong(m) {
  if (isFirstCall(m, FIRST_CALL.starburst)) {
    restartAnimation(m);
    m.set32(PULSE, 0);
    fillWithRampBase(m);
    buildStarburstTexture(m);
  }
  const w = workBuffer(m);
  decay(m, w);
  feedbackAdd(m, w);
  m.set8(GRAIN_LEVEL, m.u8((SINE_BYTES + m.u32(PULSE)) >>> 0) >> 3);
  grainSaturate(m, w);
  toRamp(m, w, w);
  text(m, w, TEXT.whatIsWrong, CAPTION_COLOUR_BASE);
  blit(m, w);
}

/** 0x546b3: first call: one more starburst step, snapshot >> 2 into bufA; then the bushes anim at 41/64 over it. */
function andTheySaid(m) {
  if (isFirstCall(m, FIRST_CALL.bushes)) {
    const w = workBuffer(m);
    decay(m, w);
    feedbackAdd(m, w);
    const snapshot = m.u32(BUFFER_A_POINTER);
    for (let i = 0; i < PIXELS; i++) {
      m.mem[snapshot + i] = m.mem[w + i] >> 2;
    }
    restartAnimation(m);
  }
  selectAnimation(m, aviItem(m, ITEM.bushes), CROWD_SHIFT, 0);
  stepAnimation(m);
  m.set32(LERP_T, BUSHES_LERP_T);
  lerpIntoW(m);
  text(m, workBuffer(m) + POSITION.lowerLeft, TEXT.andTheySaid);
  blit(m, workBuffer(m));
}

/**
 * 0x5486d / 0x54a2c: a text drawn into the texture, rotozoomed (texels >> 1) with layer A, the digit texture
 * AVI[13] (>> 3) with layer B; the angles are stored as full dwords into [0x2d460], which the gear scenes inherit.
 */
function textRotozoom(textureText, caption) {
  return (m) => {
    decay(m, m.u32(ROTOZOOM_BUFFER_POINTER), ROTOZOOM_PIXELS);
    m.set32(TEXT_POINTER, textureText);
    drawTextIntoTexture(m);
    m.set8(TEXEL_SHIFT, TEXT_TEXEL_SHIFT);
    m.set32(ZOOM_INDEX, m.u32(ZOOM_A));
    m.set32(ANGLE_Z, m.u32(ANGLE_A));
    rotozoom(m, m.u32(TEXTURE_BUFFER_POINTER));
    m.set8(TEXEL_SHIFT, AVI_TEXEL_SHIFT);
    m.set32(ZOOM_INDEX, m.u32(ZOOM_B));
    m.set32(ANGLE_Z, m.u32(ANGLE_B));
    rotozoom(m, aviItem(m, ITEM.digitTexture));
    m.set8(UPSCALE_2X_ADD, 0);
    upscale2x(m, workBuffer(m));
    grain(m, workBuffer(m));
    text(m, workBuffer(m) + POSITION.bottom, caption);
    blit(m, workBuffer(m));
  };
}

/** The palette of the RIX item and the border colour 0xc0 (attribute register 0x11). */
function useMapTexture(m, item) {
  m.set32(TEXTURE_POINTER, aviItem(m, item) + RIX_PIXELS);
  setPaletteFromTexture(m);
  m.borderColor = GRAIN_RAMP_BASE;
}

function mapWithCaption(m, caption) {
  renderMap(m, aviItem(m, MAP_ITEM), workBuffer(m), m.u32(TEXTURE_POINTER));
  text(m, workBuffer(m) + POSITION.bottom, caption);
  blit(m, workBuffer(m));
}

/** 0x5506b: " system divines": the map with the RIX texture AVI[18]; the very first call sets mode 13h again. */
function systemDivines(m) {
  m.set8(FIRST_CALL.nature, 0);
  if (isFirstCall(m, FIRST_CALL.systemDivines)) {
    if (isFirstCall(m, FIRST_CALL.systemDivinesModeSet)) {
      setMode13(m);
      loadGreyRamp(m);
    }
    useMapTexture(m, SYSTEM_TEXTURE_ITEM);
  }
  mapWithCaption(m, TEXT.systemDivines);
}

/** 0x55232: " nature": the map with AVI[17]. */
function nature(m) {
  m.set8(FIRST_CALL.systemDivines, 0);
  if (isFirstCall(m, FIRST_CALL.nature)) {
    useMapTexture(m, NATURE_TEXTURE_ITEM);
  }
  mapWithCaption(m, TEXT.nature);
}

/** 0x5558a: back to mode 13h; the video + grain (0x53815's patches undone) + "Scream until / you are / FREE!". */
function scream(m) {
  if (isFirstCall(m, FIRST_CALL.scream)) {
    m.set32(SCROLLER_POSITION, 0);
    setMode13(m);
  }
  m.set8(GRAIN_LEVEL, SCREAM_GRAIN_LEVEL);
  drawVideoFrame(m);
  m.set32(GRAIN_COUNT, FULL_GRAIN_COUNT);
  m.set8(GRAIN_ADD, GRAIN_RAMP_BASE);
  grain(m, workBuffer(m));
  text(m, workBuffer(m) + POSITION.scream, TEXT.scream);
  blit(m, workBuffer(m));
}

/** 0x55fa4: the face photo anim FLI[19], 48 rows, (v << 3) + 0xc0, pulse on. */
function faceAnimation(m) {
  if (isFirstCall(m, FIRST_CALL.face)) {
    resetAnimation(m);
    m.set8(PALETTE_PULSE_OFF, 0);
    loadGreyRamp(m);
  }
  m.set32(MORPH_ITEM, fliItem(m, FACE_ITEM));
  m.set32(UPSCALE_ROWS, ANIMATION_ROWS);
  m.set8(UPSCALE_SHIFT, FACE_SHIFT);
  m.set8(UPSCALE_ADD, GRAIN_RAMP_BASE);
  stepAnimation(m);
  blit(m, workBuffer(m));
}

/** 0x56021: grey ramp, W cleared, "END". */
function end(m) {
  loadGreyRamp(m);
  clearW(m);
  text(m, workBuffer(m) + POSITION.end, TEXT.end, CAPTION_COLOUR_BASE);
  blit(m, workBuffer(m));
}

function effect(draw, passesPerSecond) {
  return { draw, passesPerSecond };
}

export const PART2_EFFECTS = {
  0x53fb0: effect(photo, PASSES.photo),
  0x54043: effect(faceDrawing, PASSES.photo),
  0x540ca: effect(video, PASSES.video),
  0x54273: effect(videoWithCaption, PASSES.video),
  0x54314: effect(weSeeNothing, PASSES.crossfade),
  0x54456: effect(weDoNotMove, PASSES.crossfade),
  0x54507: effect(weAreMass, PASSES.animation),
  0x545bd: effect(whatIsWrong, PASSES.starburst),
  0x546b3: effect(andTheySaid, PASSES.animation),
  0x5486d: effect(textRotozoom(TEXT.someDayTexture, TEXT.someDay), PASSES.textRotozoom),
  0x54a2c: effect(textRotozoom(TEXT.weWillSeeTexture, TEXT.weWillSee), PASSES.textRotozoom),
  0x5506b: effect(systemDivines, PASSES.map),
  0x55232: effect(nature, PASSES.map),
  0x5558a: effect(scream, PASSES.video),
  0x55fa4: effect(faceAnimation, PASSES.faceAnimation),
  0x56021: effect(end, PASSES.end),
};
