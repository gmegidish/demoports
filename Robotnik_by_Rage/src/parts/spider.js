// Intro part 0: a textured spider walks through a brown cave, a spotlight comes on and follows it,
// a "RAGE" cube drops on it (blood on the floor), and the last picture tumbles away on a quad.
// Ports init 0x21674 (mode 0, playback), run 0x20b8c(0) with its end transition 0x27e28 and deinit
// 0x21604. See docs/disassembly/P0_spider.md; the drawing routines of its own are in spiderdraw.js.
//
// The loop never waits for the timer: it renders as fast as the CPU allows and reads the frame
// counter once per pass. The recordings (spider.rec, light.rec, camera.rec) and the cube's fall
// advance by the ticks between passes, but the walk cycle (+speed*200 per pass) and the camera's and
// the light's low-pass filters ((old + new) >> 1 per pass) advance per pass, so the picture depends
// on when DOSBox finished each pass. PASS_TICKS is that schedule, measured in demo.avi.

import { syncAdvance, entryTime, songTime, TICKS_PER_SECOND, setDac, SCREEN_BYTES } from '../machine.js';
import { loadFont, drawSmallText } from '../font.js';
import {
  LoadObject, CreateWorld, AddObject, ComputeBounds, SetRenderMode, SetObjPos, SetObjAngleX, SetObjAngleY,
  SetObjAngleZ, GetObjPos, ScalePoints, ScaleKeys, AnimateTree, AnimLength, RenderWorld, staticObject,
  staticMaterial, setTreeDraw, drawRoutine, clearPhongMaps, readChannelRecording, createRecordPlayer,
  advanceRecordPlayer, lerpRecord, makeQuadratic, cameraQuadratics, createOrbitState, orbitCamera, FLAG,
} from '../engine/index.js';
import { flyAway } from './flyaway.js';
import { buildBlendTable, stampLight, stampBlood, recordMarker, drawLightCone, NO_STAMP } from './spiderdraw.js';

const PALETTE_BYTES = 768;

/** Static objects of the data segment and the runtime materials (bss) init 0x21674 fills. */
const FLOOR = 0x82a74;
const WALLS = 0x82b28;
const PLANE = 0x82bdc;
const LIGHT = 0x83080;
const CUBE = 0x82f60;
const MARKER = 0x831a0;
const MARKER_MATERIAL = 0xde740;
const WALL_MATERIAL = 0xde770;
const FLOOR_MATERIAL = 0xde7a0;
const PLANE_MATERIAL = 0xde7d0;
const CUBE_MATERIAL = 0xde800;
const LIGHT_MATERIAL = 0xde830;
const CAVE = 0x38440;
const RECORD_PLANE = 0x32788;
const RECORD_LIGHT = 0x32714;
const CUBE_TEXTURE = 0x36890;
const SPIDER_POLYGON = 0x3315c;
/** The cave's depth cue: z << 1 before 0x7fff - z picks the blend row. */
const CAVE_DEPTH_SHIFT = 1;

const STAR_BYTES = 0x1000;
const SHADE_BASE = 0x80;
const WORLD_SIZES = [30, 1900, 2700, 2700];
const RENDER_MODE = 3;
/** 0x1dcd0("font.raw", 0x40, 1): glyph values 0x40..0x7e = blend rows 64..126 (brighten 0..62). */
const FONT_ADD = 0x40;
const FONT_SHIFT = 1;
const TEXTS = [['robotnik', 2, 2], ['rage 1997', 225, 2], ['punish your machine', 125, 190]];

/** Init positions (1/256 world units): light at (800, 1000, 500), cube and marker parked at y 6000. */
const LIGHT_START = [800, 1000, 500];
const PARKED = [0, 6000, 0];
/** SetObjAngleX(spider, 0xc00) stands the model up. */
const SPIDER_PITCH = 0xc00;

/** Sync entries (relative to the first): 1 the light comes on, 2 the cube falls, 3 the part ends. */
const LIGHT_ENTRY = 1;
const CUBE_ENTRY = 2;
const LAST_ENTRY = 3;
const FLY_AWAY_END = 4;
const SPIDER_CHANNELS = 4;
const LIGHT_CHANNELS = 2;
const CAMERA_CHANNELS = 4;
const SPIDER = { ANGLE: 0, X: 1, Z: 2, SPEED: 3 };
/** spider.rec angle: 512 per turn; the engine's: 4096. */
const SPIDER_ANGLE_ZERO = 0x100;
const SPIDER_ANGLE_SHIFT = 3;
const WALK_STEP = 200;

/** The spot on the floor map (256x256) and the 3D light / marker from the light position L. */
const FLOOR_SPOT_V = 0xe4;
const LIGHT_X_SCALE = 4;
const LIGHT_X_OFFSET = 0x800;
const LIGHT_HEIGHT = 1000;
const LIGHT_Z_CENTRE = 0x80;
const MARKER_SCALE = 0x27;
const MARKER_X_CENTRE = 0x80;
const MARKER_Z_CENTRE = 0x60;
const FLOOR_Y = -100;

/** The cube starts at y 3000 and falls 80 per tick to the floor (-100), 600 left / 400 behind the spider. */
const CUBE_START_Y = 3000;
const CUBE_FALL_PER_TICK = 80;
const CUBE_LEFT = 600;
const CUBE_BEHIND = 400;
const BLOOD = { NONE: 0, DUE: 1, DONE: 2 };

/** 0x27e28 = 0x28038 with (8, 0, 16) per tick and (32, 0, 8) angle units per tick. */
const FLY_VELOCITY = [8, 0, 16];
const FLY_SPIN = [32, 0, 8];
const RENDERED_PASSES = 2;

/**
 * The ticks between passes in demo.avi (a digit per pass, 311 passes + the last one's copy): the
 * first pass reads the frame counter 1 tick after the first entry, pass k reads it PASS_TICKS[0..k]
 * ticks after, and its picture reaches VGA when the next pass starts. Measured from the frames the
 * recording changes on (each copy tears across one captured frame); with it every pass's picture is
 * pixel-exact (>= 99.9%) against the recording frame that shows it. DOSBox slowed down from ~17 to
 * ~14 passes per second as the spider came closer and the light cone grew.
 */
const PASS_TICKS = '1353544445444544444444444344444444344444444444444444445444444454444444454444444545454454545454545454'
  + '5454545455455454554554545545554555454454454454545454544545454545545455555555556455554545445454454545'
  + '4554555545555555555555545555455545554554554554554554554554554555455455455545545556455554545454545454'
  + '454545454454';
const TICKS_AFTER_TABLE = 5;
/** A pass starts within the tick before the counter value it reads: half a tick, on average. */
const PASS_START_BEFORE_COUNTER = 0.5;

const passElapsed = (() => {
  const elapsed = [];
  let sum = 0;
  for (const digit of PASS_TICKS) {
    sum += Number(digit);
    elapsed.push(sum);
  }
  return elapsed;
})();

/** [0x91260] - t0 as pass `k` reads it. */
export function passCounter(k) {
  const last = passElapsed.length - 1;
  return k <= last ? passElapsed[k] : passElapsed[last] + (k - last) * TICKS_AFTER_TABLE;
}

/** Ticks after the first entry from which pass k's picture is on screen (the tick the next pass reads). */
export function passShown(k) {
  return passCounter(k + 1) - 1;
}

function loadScene(demo) {
  const { image, archive } = demo;
  const floor = staticObject(image, FLOOR);
  const walls = staticObject(image, WALLS);
  floor.child = walls;
  walls.child = staticObject(image, PLANE);
  const light = staticObject(image, LIGHT);
  const cube = staticObject(image, CUBE);
  cube.flags |= FLAG.HIDDEN;
  const marker = staticObject(image, MARKER);

  const shade = archive.read('shade.raw').map((b) => (b >> 1) + SHADE_BASE);
  const star = archive.read('sp_star.raw').map((b) => b >> 1);
  const textures = {
    floor: shade,
    walls: shade.slice(),
    star,
    blood: archive.read('sp_blod.raw'),
    ray: archive.read('sp_ray.raw'),
    cube: archive.read('sp_pic1.raw'),
  };
  const spider = LoadObject(archive, 'spider.eob');
  const world = CreateWorld(...WORLD_SIZES);
  useMaterial(image, MARKER_MATERIAL, null, recordMarker);
  useMaterial(image, WALL_MATERIAL, textures.walls, drawRoutine(CAVE), CAVE_DEPTH_SHIFT);
  useMaterial(image, FLOOR_MATERIAL, textures.floor, drawRoutine(CAVE), CAVE_DEPTH_SHIFT);
  useMaterial(image, PLANE_MATERIAL, null, drawRoutine(RECORD_PLANE));
  useMaterial(image, CUBE_MATERIAL, textures.cube, drawRoutine(CUBE_TEXTURE));
  const lightMaterial = useMaterial(image, LIGHT_MATERIAL, textures.ray, drawRoutine(RECORD_LIGHT));
  setTreeDraw(spider, drawRoutine(SPIDER_POLYGON));

  SetObjPos(floor, 0, 0, 0);
  setAngles(floor, 0);
  SetObjPos(light, ...LIGHT_START);
  SetObjPos(cube, ...PARKED);
  SetObjPos(marker, ...PARKED);
  SetObjPos(spider, 0, 0, 0);
  SetObjAngleX(spider, SPIDER_PITCH);
  SetObjAngleY(spider, 0);
  SetObjAngleZ(spider, 0);
  for (const object of [spider, floor, light, cube, marker]) {
    AddObject(world, object);
  }
  ScalePoints(spider, 1);
  ScalePoints(spider, 1);
  ScaleKeys(spider, 1);
  ComputeBounds(world);
  SetRenderMode(world, RENDER_MODE);
  return { world, spider, light, cube, marker, textures, lightMaterial };
}

function setAngles(object, angle) {
  SetObjAngleX(object, angle);
  SetObjAngleY(object, angle);
  SetObjAngleZ(object, angle);
}

/** A runtime material: +0x10 texture, +0x28 depth shift, +0x2c routine (the rest stays 0). */
function useMaterial(image, address, texture, draw, depthShift = 0) {
  const material = staticMaterial(image, address);
  material.texture = texture;
  material.depthShift = depthShift;
  material.draw = draw;
  return material;
}

/** The loop's own state: the locals of 0x20b8c and the players [0xde710..0xde738]. */
function createLoopState(demo, scene) {
  const { archive } = demo;
  const camera = readChannelRecording(archive.read('camera.rec'), CAMERA_CHANNELS);
  const first = (c) => camera.values[c];
  const second = (c) => camera.values[CAMERA_CHANNELS + c];
  return {
    pass: 0,
    syncIndex: LIGHT_ENTRY - 1,
    previousElapsed: 0,
    walk: 0,
    walkLength: AnimLength(scene.spider),
    cubeY: CUBE_START_Y,
    blood: BLOOD.NONE,
    spot: [0, 0],
    stamp: { x: NO_STAMP, y: NO_STAMP },
    orbit: createOrbitState(),
    camera,
    cameraQuads: Array.from({ length: CAMERA_CHANNELS }, (_, c) => makeQuadratic(first(c), first(c), second(c))),
    cameraPlayer: createRecordPlayer(),
    spiderRecord: readChannelRecording(archive.read('spider.rec'), SPIDER_CHANNELS),
    spiderPlayer: createRecordPlayer(),
    lightRecord: readChannelRecording(archive.read('light.rec'), LIGHT_CHANNELS),
    lightPlayer: createRecordPlayer(),
  };
}

/** The light comes on (entry 1 seen after entry 0): the cone routine, the light player from record 0. */
function switchLightOn(scene, loop) {
  scene.lightMaterial.draw = drawLightCone;
  loop.lightPlayer = createRecordPlayer();
  loop.spot = [loop.lightRecord.values[0], loop.lightRecord.values[1]];
}

function placeSpider(scene, loop) {
  const s = lerpRecord(loop.spiderRecord, loop.spiderPlayer);
  SetObjAngleY(scene.spider, (SPIDER_ANGLE_ZERO - s[SPIDER.ANGLE]) << SPIDER_ANGLE_SHIFT);
  SetObjPos(scene.spider, s[SPIDER.X], 0, s[SPIDER.Z]);
  return s[SPIDER.SPEED];
}

/** The spot follows light.rec through a low-pass; the floor map gets the light (or once, the blood). */
function moveLight(scene, loop) {
  const v = lerpRecord(loop.lightRecord, loop.lightPlayer);
  const [x, y] = [(loop.spot[0] + v[0]) >> 1, (loop.spot[1] + v[1]) >> 1];
  loop.spot = [x, y];
  const { floor, star, blood } = scene.textures;
  if (loop.blood === BLOOD.NONE) {
    stampLight(loop.stamp, star, floor, x, FLOOR_SPOT_V - y);
  } else if (loop.blood === BLOOD.DUE) {
    stampBlood(blood, floor, x, FLOOR_SPOT_V - y);
    loop.blood = BLOOD.DONE;
  }
  SetObjPos(scene.light, (x << LIGHT_X_SCALE) - LIGHT_X_OFFSET, LIGHT_HEIGHT, (LIGHT_Z_CENTRE - y) << LIGHT_X_SCALE);
  SetObjPos(scene.marker, (x - MARKER_X_CENTRE) * MARKER_SCALE, FLOOR_Y, (MARKER_Z_CENTRE - y) * MARKER_SCALE);
}

function dropCube(scene, loop, dt) {
  loop.cubeY -= dt * CUBE_FALL_PER_TICK;
  if (loop.cubeY < FLOOR_Y) {
    loop.cubeY = FLOOR_Y;
    if (loop.blood === BLOOD.NONE) {
      loop.blood = BLOOD.DUE;
    }
  }
  const [x, , z] = GetObjPos(scene.spider);
  SetObjPos(scene.cube, x - CUBE_LEFT, loop.cubeY, z - CUBE_BEHIND);
  scene.cube.flags &= ~FLAG.HIDDEN;
}

/** speed * 200 per pass, wrapped into the animation's length. */
function walk(scene, loop, speed) {
  let t = loop.walk + speed * WALK_STEP;
  while (t >= loop.walkLength) {
    t -= loop.walkLength;
  }
  while (t < 0) {
    t += loop.walkLength;
  }
  loop.walk = t;
  AnimateTree(scene.spider, t);
}

/**
 * The state half of one pass of 0x20b8c: `elapsed` = [0x91260] - t0 as the pass reads it, `index` =
 * the sync entries passed (relative to the part's first). Everything before RenderWorld.
 */
export function updatePass(scene, loop, elapsed, index) {
  const previous = loop.syncIndex;
  loop.syncIndex = index;
  if (previous === LIGHT_ENTRY && index === LIGHT_ENTRY + 1) {
    switchLightOn(scene, loop);
  }
  const dt = elapsed - loop.previousElapsed;
  loop.previousElapsed = elapsed;
  loop.pass++;
  const speed = placeSpider(scene, loop);
  if (index > LIGHT_ENTRY) {
    moveLight(scene, loop);
  }
  if (index > CUBE_ENTRY) {
    dropCube(scene, loop, dt);
  }
  walk(scene, loop, speed);
  orbitCamera(loop.orbit, scene.spider, loop.cameraPlayer, loop.cameraQuads, scene.world, 1);
  return dt;
}

/** The end of a pass: the three players move on by the pass's ticks (the camera rebuilds its curves). */
export function advancePlayers(loop, dt) {
  advanceRecordPlayer(loop.lightPlayer, dt);
  advanceRecordPlayer(loop.spiderPlayer, dt);
  advanceRecordPlayer(loop.cameraPlayer, dt, (index) => {
    loop.cameraQuads = cameraQuadratics(loop.camera, index);
  });
}

/** The drawing half: the world and the three texts into the back buffer, to VGA, back buffer cleared. */
export function drawPass(demo, scene, marker) {
  const back = demo.offscreen;
  const table = demo.blendTable;
  RenderWorld(scene.world, { target: back, colourTable: table, marker });
  for (const [text, x, y] of TEXTS) {
    drawSmallText(scene.font, back, text, x, y, table);
  }
  demo.machine.front.set(back.subarray(0, SCREEN_BYTES));
  back.fill(0);
}

/** Ticks since the part's first entry, continuous, at the machine's current time. */
function ticksSinceStart(m, firstSync) {
  return (songTime(m) - entryTime(m, firstSync)) * TICKS_PER_SECOND;
}

/** The sync entries passed (relative to `firstSync`) at `ticks` after the first one. */
function entriesPassedAt(entryTicks, ticks) {
  return entryTicks.filter((t) => t <= ticks).length;
}

/**
 * Every pass whose picture is due by `now` (ticks since the first entry): pass k
 * reads passCounter(k) (the sync entries as passed half a tick before) and shows from passShown(k). Only the last RENDERED_PASSES of a batch are drawn
 * (more than one only after a jump; drawing the one before keeps the light and plane the routines
 * record one frame ahead). Returns true after the pass that saw the last entry passed.
 */
function playDuePasses(demo, state, entryTicks, now) {
  const { scene, loop } = state;
  let due = 0;
  while (passShown(loop.pass + due) <= now) {
    due++;
  }
  for (let k = 0; k < due; k++) {
    const elapsed = passCounter(loop.pass);
    const index = 1 + entriesPassedAt(entryTicks, elapsed - PASS_START_BEFORE_COUNTER);
    const dt = updatePass(scene, loop, elapsed, index);
    if (k >= due - RENDERED_PASSES) {
      drawPass(demo, scene, state.marker);
    }
    advancePlayers(loop, dt);
    if (index > LAST_ENTRY) {
      return true;
    }
  }
  return false;
}

export const spider = {
  /** 0x21674(0): scene, textures, blend table, palette, the brightening font. */
  init(demo) {
    const scene = loadScene(demo);
    buildBlendTable(demo.blendTable);
    setDac(demo.machine, demo.archive.read('sp_pal.col').subarray(0, PALETTE_BYTES));
    scene.font = loadFont(demo.archive.read('font.raw'), FONT_ADD, FONT_SHIFT);
    return { scene, loop: createLoopState(demo, scene), marker: [0, 0, 0] };
  },

  /**
   * 0x20b8c(0): after the first entry, the passes of PASS_TICKS; a pass's picture shows from the
   * start of the next. The pass that sees entry 3 passed is the last; then FlyAway 0x27e28.
   */
  *run(demo, state, firstSync) {
    const m = demo.machine;
    while (syncAdvance(m) <= firstSync) {
      yield;
    }
    const entryTicks = [1, 2, 3].map((k) => (entryTime(m, firstSync + k) - entryTime(m, firstSync)) * TICKS_PER_SECOND);
    let isLast = false;
    while (!isLast) {
      isLast = playDuePasses(demo, state, entryTicks, ticksSinceStart(m, firstSync));
      yield;
    }
    yield* flyAway(demo, firstSync + FLY_AWAY_END, FLY_VELOCITY, FLY_SPIN);
  },

  /** 0x21604: VGA cleared, the phong maps forgotten. */
  deinit(demo) {
    demo.machine.front.fill(0);
    clearPhongMaps();
  },
};
