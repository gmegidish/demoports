// Intro parts 3 and 5 ("shadow"): a skull hangs in a bowl-shaped room; a slide projector flying on
// its own recorded path throws an animated film of a mouth (teeth.rap) onto everything, and the skull
// casts a real shadow. Part 5 adds the spinning drill that bores into the skull, with dark damage
// growing around the hole. Ports run 0x2381c (part 3) and 0x23de8 (part 5) with init 0x23264
// (skullscene.js) and deinit 0x24464 (nothing visible); part 3 ends with the screen flying away
// (0x27f30 on the engine's quad world), part 5 with the shared triangle shatter (src/shatter.js)
// that reveals music.raw. See docs/disassembly/P3_skull.md.
//
// Frame rate: the main loops never wait for the timer. A pass reads the tick counter, renders both
// projector passes and copies the frame to VGA, so what shows depends on how long DOSBox took per pass.
// Everything is a function of the tick a pass read, except the drill's advance (added once per pass,
// see advanceDrill) and where the skull stops sinking (the last pass at or before t = 500). The port
// therefore replays the passes on the schedule measured in demo.avi (PART3_PASS_TICKS,
// PART5_PASS_TICKS), applies the per-pass updates for every pass, and renders the pass the screen shows.

import { frame, syncAdvance, entryFrame, setDac } from '../machine.js';
import {
  RenderWorldProjected, RenderWorld, createQuadWorld, playCameraRecord, cameraRecordCount, unpackFilmFrame,
  filmFrameAt, SetObjAngleY, SetObjZ, GetObjZ, GetObjPos, SetObjPos, SetObjAngleX, setTreeFlags,
} from '../engine/index.js';
import { createShatter, runShatter, PART_13_PACE } from '../shatter.js';
import { createSkullScene } from './skullscene.js';

const HIDDEN = 0x1000;
const VARIANT_PART3 = 1;
const VARIANT_PART5 = 2;

/**
 * How many ticks each pass of the main loop took in demo.avi, one digit per pass from the loop's
 * start: the tick every pass read, recovered by matching each picture the recording shows against
 * the port's renders at every tick (the matches are pixel-exact). Later passes repeat the last digit.
 */
export const PART3_PASS_TICKS = '43444344444443444444454454545454544554554555545555545555545555555555555555556556656666656666'
  + '666766667667676676676676666765666566565556555555555555555656556656565665666666666666666566565655656565565555655555545554'
  + '554554554555545555555';
export const PART5_PASS_TICKS = '67777789898889888988888887878777776767676676676677677777778777777776777677677676776776777787'
  + '77878889888887878878878878878878778777777676765655655565556566666766767';

/**
 * The loops end at the first pass that starts after the next sync entry has passed: in demo.avi,
 * the pass at 1215 of part 3 (the last one shown read 1210) and the pass at 1146 of part 5 (last
 * shown 1139). Like the pass schedules these are measured ticks, used as they are. On the machine's
 * clock the song reaches those entries at 1216.7 and 1138.2 ticks: DOSBox's MIDAS reported them a
 * few ticks off either way (jitter, not the recording's clock skew), and the measured ends keep the
 * last picture the one the recording shatters and flies away.
 */
const PART3_LOOP = { passTicks: PART3_PASS_TICKS, lastPassBefore: 1213 };
const PART5_LOOP = { passTicks: PART5_PASS_TICKS, lastPassBefore: 1143 };

/** Part 3: the skull sinks from z = -8000 to its file position over the first 500 ticks. */
const SINK_TICKS = 500;
const SINK_PER_TICK = 16;
/** The drill turns by -64 per tick (4096 per turn). */
const SPIN_SHIFT = 6;
/** Part 5: the drill bit moves along its axis by floor(-t/8) per pass while t < 700. */
const DRILL_TICKS = 700;
const DRILL_SHIFT = 3;
/** Part 5: from t = 250 the damage threshold falls by one per 4 ticks from 127, down to 1. */
const DAMAGE_FROM = 250;
const DAMAGE_SHIFT = 2;
const DAMAGE_TOP = 127;
const DAMAGE_FLOOR = 1;
const DAMAGE_SIZE = 64;
/** Damage texel (row 35 + 2by, column 64 + 2bx) of the skull texture, 2x2 texels per map cell. */
const DAMAGE_ORIGIN = 0x2340;
const DAMAGE_ROW = 0x200;
const DAMAGE_COLOUR = 0xf0;
const TEXTURE_ROW = 256;
/** [0x11a87c]: the light buffer tags its values with the pass number, 0..255. */
const LAST_TAG = 255;
/** 0x27f30: per tick of the fly-away, x -8, y +4, z +16, angles X and Y +16. */
const FLY_X = -8;
const FLY_Y = 4;
const FLY_Z = 16;
const FLY_TURN = 16;
/** Part 5's end: 0x16f20(speed 0x78, mode 1), then 0x171a8 over music.raw. */
const SHATTER_SPEED = 0x78;
const SHATTER_MODE = 1;

function* waitForEntry(demo, entry) {
  while (syncAdvance(demo.machine) <= entry) {
    yield;
  }
}

/**
 * The loop's passes: pass k starts at starts[k] ticks after the loop started (it reads t = starts[k])
 * and shows at starts[k+1]. Passes run while they start before `endTick` (the sync entry that ends
 * the loop); the loop leaves at the start of the first pass that doesn't.
 */
export function passSchedule(passTicks, endTick) {
  const starts = [0];
  for (let k = 0; starts[k] < endTick; k++) {
    starts.push(starts[k] + Number(passTicks[Math.min(k, passTicks.length - 1)]));
  }
  return starts;
}

/** 0x2789c for both paths, the film frame, the drill's spin. */
function poseScene(scene, t) {
  const index = (records) => Math.min(t, cameraRecordCount(records) - 1);
  playCameraRecord(scene.projectorWorld, scene.projectorPath, index(scene.projectorPath));
  playCameraRecord(scene.camera, scene.cameraPath, index(scene.cameraPath));
  unpackFilmFrame(scene.rap, filmFrameAt(t), scene.projector.film);
  const spin = (-t) << SPIN_SHIFT;
  SetObjAngleY(scene.bit, spin);
  SetObjAngleY(scene.box, spin);
}

/** Part 3: SetObjZ while t <= 500, so the skull stops where the last such pass put it. */
function sinkSkull(scene, t) {
  if (t <= SINK_TICKS) {
    SetObjZ(scene.skull, scene.skullZ - (SINK_TICKS - t) * SINK_PER_TICK);
  }
}

/** Part 5 (5.3): per pass, not per tick. */
function advanceDrill(scene, t) {
  if (t < DRILL_TICKS) {
    const [x, y, z] = GetObjPos(scene.bit);
    SetObjPos(scene.bit, x, y + ((-t) >> DRILL_SHIFT), z);
  }
}

/** Part 5 (5.2): permanent dark cracks in the skull texture where the damage map exceeds the threshold. */
export function damageSkull(texture, damageMap, t) {
  const threshold = Math.max(DAMAGE_TOP - ((t - DAMAGE_FROM) >> DAMAGE_SHIFT), DAMAGE_FLOOR);
  for (let by = 0; by < DAMAGE_SIZE; by++) {
    for (let bx = 0; bx < DAMAGE_SIZE; bx++) {
      if (damageMap[by * DAMAGE_SIZE + bx] > threshold) {
        const at = DAMAGE_ORIGIN + by * DAMAGE_ROW + bx * 2;
        texture[at] = DAMAGE_COLOUR;
        texture[at + 1] = DAMAGE_COLOUR;
        texture[at + TEXTURE_ROW] = DAMAGE_COLOUR;
        texture[at + TEXTURE_ROW + 1] = DAMAGE_COLOUR;
      }
    }
  }
}

/** The per-pass updates of one pass that reads tick t, in the loop's order. */
export function stepPass(scene, variant, t) {
  if (variant === VARIANT_PART3) {
    sinkSkull(scene, t);
    return;
  }
  advanceDrill(scene, t);
  if (t > DAMAGE_FROM) {
    damageSkull(scene.skullTexture, scene.damageMap, t);
  }
}

/** 4.1: the next tag (clearing the light buffer when it wraps), back buffer -> VGA, clear back. */
function nextTag(projector) {
  projector.frameId++;
  if (projector.frameId > LAST_TAG) {
    projector.frameId = 0;
    projector.depth.fill(0);
  }
}

export function renderPass(demo, scene, t) {
  poseScene(scene, t);
  RenderWorldProjected(scene.camera, scene.projectorWorld,
    { target: demo.offscreen, colourTable: scene.colourMap, projector: scene.projector });
  demo.machine.front.set(demo.offscreen);
  demo.offscreen.fill(0);
}

/**
 * The main loop of 0x2381c / 0x23de8 from the entry until the next one has passed, on the measured
 * schedule. Returns the frame at which the loop leaves (what VGA shows then is its last pass).
 */
function* skullLoop(demo, scene, variant, { passTicks, lastPassBefore }, firstSync) {
  const m = demo.machine;
  yield* waitForEntry(demo, firstSync);
  const start = entryFrame(m, firstSync);
  const starts = passSchedule(passTicks, lastPassBefore);
  const exitTick = starts[starts.length - 1];
  let stepped = 0;
  let shown = -1;
  for (;;) {
    const now = frame(m) - start;
    let due = shown;
    while (due + 1 < starts.length - 1 && starts[due + 2] <= now) {
      due++;
    }
    for (; stepped <= due; stepped++) {
      stepPass(scene, variant, starts[stepped]);
      if (stepped > 0) {
        nextTag(scene.projector);
      }
    }
    if (due > shown) {
      renderPass(demo, scene, starts[due]);
      shown = due;
    }
    if (now >= exitTick) {
      return start + exitTick;
    }
    yield;
  }
}

/**
 * 0x27f30 ScreenFlyAway(0xc): the last frame on a quad that moves left, up and away while it turns
 * about X and Y, one render per tick, until entry `lastEntry` has passed. Leaves the back buffer clear.
 */
function* flyAway(demo, scene, flyStart, lastEntry) {
  const m = demo.machine;
  const { world, quad } = createQuadWorld(demo.image, m.front);
  // After a jump past the end, VGA still gets the last frame (part 4 draws over it).
  const lastFrame = entryFrame(m, lastEntry + 1) - 1;
  for (;;) {
    const t = Math.max(Math.min(frame(m), lastFrame) - flyStart, 0);
    SetObjPos(quad, FLY_X * t, FLY_Y * t, FLY_Z * t);
    SetObjAngleX(quad, FLY_TURN * t);
    SetObjAngleY(quad, FLY_TURN * t);
    RenderWorld(world, { target: demo.offscreen, colourTable: scene.colourMap });
    m.front.set(demo.offscreen);
    demo.offscreen.fill(0);
    if (syncAdvance(m) > lastEntry) {
      return;
    }
    yield;
  }
}

export function initSkull(demo, variant) {
  const scene = createSkullScene(demo, variant);
  setDac(demo.machine, scene.palette);
  scene.skullZ = GetObjZ(scene.skull);
  return scene;
}

/** Part 3: init 0x23264(1), run 0x2381c(0xa), deinit 0x24464. */
export const skullShadow = {
  init: (demo) => initSkull(demo, VARIANT_PART3),
  *run(demo, scene, firstSync) {
    scene.bit.flags |= HIDDEN;
    setTreeFlags(scene.box, HIDDEN);
    const flyStart = yield* skullLoop(demo, scene, VARIANT_PART3, PART3_LOOP, firstSync);
    yield* flyAway(demo, scene, flyStart, firstSync + 2);
  },
};

/** Part 5: init 0x23264(2), run 0x23de8(0xf), deinit 0x24464. */
export const skullDrill = {
  init: (demo) => initSkull(demo, VARIANT_PART5),
  *run(demo, scene, firstSync) {
    const shatterStart = yield* skullLoop(demo, scene, VARIANT_PART5, PART5_LOOP, firstSync);
    const m = demo.machine;
    if (syncAdvance(m) > firstSync + 2) {
      // Jumped past the shatter: its pieces have all flown off, music.raw is left on screen.
      m.front.set(scene.picture);
      return;
    }
    const shatter = createShatter(demo.image, m.front, { speed: SHATTER_SPEED, mode: SHATTER_MODE });
    yield* runShatter(demo, shatter, {
      lastIndex: firstSync + 2, background: scene.picture, pace: PART_13_PACE, startFrame: shatterStart,
    });
  },
};
