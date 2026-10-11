// The 3D engine (src/engine) against the original: test/fixtures/engine.json holds CRC32s of what
// ROBOTNIK.EXE's own engine drew in unicorn (tools/re/engine_fixtures.py) for the same scenes, the
// same pseudo-random poses and the same colour table / background patterns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { demoFiles } from './helpers.js';
import {
  LoadObject, CreateWorld, AddObject, ComputeBounds, SetRenderMode, SetCameraPos, SetCameraAngles,
  CameraPitchLocal, CameraMoveLocalZ, CameraMoveLocalY, SetObjPos, SetObjAngles, ScalePoints,
  ScaleKeys, AnimateTree, AnimLength, RenderWorld, objectsOf, drawRoutine, createPolygon, createObject,
  VERTEX_INTS, SLOT_INTS, setTreeDraw, createTriangleEngine, createTriangleVertices, setTriangleTarget,
  setupTriangle, fillTriangleSpans, rotateVertices, projectVertices, triangleSineTable,
  RenderWorldProjected, drawProjected, createProjectorState, readChannelRecording, cameraQuadratics,
  createOrbitState, createRecordPlayer, orbitCamera, advanceRecordPlayer, unpackFilmFrame,
  createQuadWorld, SetObjAngleX, SetObjAngleY, SetObjAngleZ,
} from '../src/engine/index.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/engine.json', import.meta.url), 'utf8'));
const SCREEN_BYTES = 64000;
const COLOUR_TABLE_BYTES = 0x8000;

/** xorshift32, the same stream as engine_fixtures.py. */
function createRandom(seed) {
  let s = seed >>> 0;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
  return { next, int: (lo, hi) => lo + (next() % (hi - lo + 1)) };
}

function colourTablePattern() {
  return Uint8Array.from({ length: COLOUR_TABLE_BYTES }, (_, i) => Number((BigInt(i) * 2654435761n) & 0xffffffffn) >>> 24);
}

function backgroundPattern() {
  return Uint8Array.from({ length: SCREEN_BYTES }, (_, i) => ((i * 31) ^ (i >> 5)) & 255);
}

function renderedCrc(world, colourTable) {
  const target = backgroundPattern();
  RenderWorld(world, { target, colourTable });
  return crc32(target);
}

function phongMapCrcs(root) {
  return [...objectsOf(root)].flatMap((o) => o.materials.map((m) => (m.phongMap ? crc32(m.phongMap) : 0)));
}

function newWorld() {
  return CreateWorld(30, 0x76c, 0xa8c, 0xa8c);
}

function setUpLogoScene() {
  const world = newWorld();
  CameraPitchLocal(world, 0x400);
  CameraMoveLocalZ(world, -5000);
  CameraMoveLocalY(world, 3000);
  SetCameraPos(world, -2500, 1250, 2350);
  const logo = LoadObject(demoFiles().archive, 'logo.eob');
  SetObjPos(logo, 0, 0, 2000);
  AddObject(world, logo);
  ScalePoints(logo, 1);
  ScalePoints(logo, 1);
  ScaleKeys(logo, 1);
  ComputeBounds(world);
  SetRenderMode(world, 3);
  return { world, logo };
}

function renderPosedScene(name, { scales, keyScales, seed, poses, isFastPath = false, distance = [200, 900], draw = null }) {
  const world = newWorld();
  world.isFastPath = isFastPath;
  const object = LoadObject(demoFiles().archive, name);
  if (draw) {
    setTreeDraw(object, drawRoutine(draw));
  }
  AddObject(world, object);
  scales.forEach((s) => ScalePoints(object, s));
  keyScales.forEach((s) => ScaleKeys(object, s));
  ComputeBounds(world);
  SetRenderMode(world, 3);
  const length = AnimLength(object);
  const random = createRandom(seed);
  const colourTable = colourTablePattern();
  const frames = [];
  for (let i = 0; i < poses; i++) {
    const time = length ? random.int(0, length) : 0;
    const camera = [random.int(-100, 100), random.int(-100, 100), random.int(-100, 100)];
    const cameraAngles = [random.int(-200, 200), random.int(-200, 200), random.int(-400, 400)];
    const position = [random.int(-150, 150), random.int(-150, 150), random.int(...distance)];
    const angles = [random.int(0, 4095), random.int(0, 4095), random.int(0, 4095)];
    if (length) {
      AnimateTree(object, time);
    }
    SetObjPos(object, ...position);
    SetObjAngles(object, angles);
    SetCameraPos(world, ...camera);
    SetCameraAngles(world, cameraAngles);
    frames.push(renderedCrc(world, colourTable));
  }
  return { phongMaps: phongMapCrcs(object), frames };
}

function assertSameFrames(actual, expected) {
  const differing = actual.frames.map((crc, i) => (crc === expected.frames[i] ? null : i)).filter((i) => i !== null);
  assert.deepEqual(differing, [], 'frames that differ from the original');
}

const POSED_SCENES = {
  spider: ['spider.eob', { scales: [1, 1], keyScales: [1], seed: 11, poses: 12 }],
  spiderNear: ['spider.eob', { scales: [1, 1], keyScales: [1], seed: 12, poses: 12, distance: [-50, 250] }],
  skull: ['skull.eob', { scales: [1, 0x20], keyScales: [0x20], seed: 13, poses: 12, distance: [300, 1500] }],
  skullFast: ['skull.eob', { scales: [1, 0x20], keyScales: [0x20], seed: 14, poses: 12, isFastPath: true, distance: [300, 1500] }],
  robot: ['en_obj.eob', { scales: [1, 1], keyScales: [1], seed: 15, poses: 12, distance: [300, 1200] }],
  robotNear: ['en_obj.eob', { scales: [1, 1], keyScales: [1], seed: 16, poses: 12, distance: [-50, 300] }],
  skullPerspective: ['skull.eob', { scales: [1, 0x20], keyScales: [0x20], seed: 17, poses: 12, distance: [300, 1500], draw: 0x36890 }],
  spiderNearPhongFlat: ['spider.eob', { scales: [1, 1], keyScales: [1], seed: 18, poses: 24, distance: [-50, 250], draw: 0x44354 }],
};

test('the logo of part 1 is drawn as the original draws it along the camera path', () => {
  const { world, logo } = setUpLogoScene();
  const colourTable = colourTablePattern();
  for (const { elapsed, crc } of fixtures.logo.frames) {
    SetCameraPos(world, -2150 + 23 * elapsed, 1250, 2350 - 3 * elapsed);
    assert.equal(renderedCrc(world, colourTable), crc, `logo at elapsed frame ${elapsed}`);
  }
  assert.deepEqual(phongMapCrcs(logo), fixtures.logo.phongMaps);
});

for (const [key, [name, options]] of Object.entries(POSED_SCENES)) {
  test(`${key}: ${name} in random poses is drawn as the original draws it`, () => {
    const result = renderPosedScene(name, options);
    assert.deepEqual(result.phongMaps, fixtures[key].phongMaps, 'phong maps');
    assertSameFrames(result, fixtures[key]);
  });
}

// --- rasterisers on random polygons (each drawn on a fresh background; the routines' own tables
// persist from one polygon to the next, as in the original) ---

const BIG_COLOUR_TABLE_BYTES = 0x10000;

function bigColourTablePattern() {
  return Uint8Array.from({ length: BIG_COLOUR_TABLE_BYTES }, (_, i) => Number((BigInt(i) * 2654435761n) & 0xffffffffn) >>> 24);
}

function phongPattern() {
  return Uint8Array.from({ length: 0x10000 }, (_, i) => (Number((BigInt(i) * 40503n) & 0xffffffffn) >>> 8) & 127);
}

function randomPolygon(random, n) {
  const reach = [10, 100, 300][random.int(0, 2)];
  const vertices = [];
  for (let i = 0; i < n; i++) {
    const isOnScreen = random.int(0, 9) < 3;
    const [sx, sy] = isOnScreen ? [random.int(0, 319), random.int(0, 199)] : [random.int(-reach, 320 + reach), random.int(-reach, 200 + reach)];
    vertices.push([sx, sy, random.int(-256, 256), random.int(-256, 256), random.int(0, 255), random.int(0, 255)]);
  }
  if (random.int(0, 9) === 0) {
    vertices[1][1] = vertices[0][1];
  }
  const nz = random.int(-300, 300);
  const ambient = [0, 0x10, 0x40, 0x80, 0xff][random.int(0, 4)];
  const colourBase = random.int(0, 255);
  return { vertices, nz, ambient, colourBase };
}

function drawRandomPolygons(address, seed, sides, hasDepth = false) {
  const draw = drawRoutine(address);
  const random = createRandom(seed);
  const colourTable = bigColourTablePattern();
  const material = {
    texture: demoFiles().archive.read('skultxt.raw').subarray(0x300),
    phongMap: phongPattern(),
    textureWidth: 256,
    textureHeight: 256,
    ambient: 0,
    colourBase: 0,
  };
  const vertices = new Int32Array(8 * VERTEX_INTS);
  const faceNormals = new Int32Array(3);
  const crcs = [];
  for (let c = 0; c < fixtures.raster.flat.length; c++) {
    const n = sides[random.int(0, sides.length - 1)];
    const shape = randomPolygon(random, n);
    const depths = shape.vertices.map(() => (hasDepth ? random.int(20, 3000) : 100));
    const polygon = createPolygon();
    polygon.n = n;
    polygon.normal = 0;
    polygon.material = { ...material, ambient: shape.ambient, colourBase: shape.colourBase };
    shape.vertices.forEach(([sx, sy, nx, ny, u, v], i) => {
      vertices.set([0, 0, depths[i], nx, ny, 0, sx, sy, 1], i * VERTEX_INTS);
      polygon.slots.set([i, u, v], i * SLOT_INTS);
    });
    faceNormals[2] = shape.nz;
    const target = backgroundPattern();
    draw(polygon, { vertices, faceNormals, target, colourTable });
    crcs.push(crc32(target));
  }
  return crcs;
}

const RASTER_ROUTINES = {
  flat: [0x28b60, 21, [3, 3, 4, 5]],
  shadedByV: [0x29994, 22, [3]],
  phong: [0x2c118, 23, [3]],
  phongFlat: [0x44354, 24, [3, 3, 4]],
  texture: [0x331b4, 25, [3]],
  texturePhong: [0x35860, 26, [3]],
  perspective: [0x36890, 27, [3], true],
};

for (const [name, [address, seed, sides, hasDepth]] of Object.entries(RASTER_ROUTINES)) {
  test(`rasteriser 0x${address.toString(16)} (${name}) draws random polygons as the original does`, () => {
    const crcs = drawRandomPolygons(address, seed, sides, hasDepth);
    const differing = crcs.map((c, i) => (c === fixtures.raster[name][i] ? null : i)).filter((i) => i !== null);
    assert.deepEqual(differing, [], 'polygons drawn differently');
  });
}

// --- the triangle engine ---

function triangleTexturePattern() {
  return Uint8Array.from({ length: 0x20000 }, (_, i) => Number((BigInt(i) * 2246822519n) & 0xffffffffn) >>> 24);
}

function setRandomTriangle(random, vertices) {
  const reach = [10, 100, 250][random.int(0, 2)];
  for (let k = 0; k < 3; k++) {
    const isOnScreen = random.int(0, 9) < 4;
    const [sx, sy] = isOnScreen ? [random.int(0, 319), random.int(0, 199)] : [random.int(-reach, 320 + reach), random.int(-reach, 200 + reach)];
    const fields = [...Array.from({ length: 6 }, () => random.int(-1000, 1000)), sx, sy, random.int(0, 120), random.int(0, 255), random.int(-500, 500), random.int(-500, 500)];
    ['x', 'y', 'z', 'rx', 'ry', 'rz', 'sx', 'sy', 'row', 'column', 'extra0', 'extra1'].forEach((field, i) => {
      vertices[field][k] = fields[i];
    });
  }
}

function triangleEngineGlobals(engine) {
  return [engine.top, engine.bottom, engine.minX, engine.maxX, engine.yMin, engine.yMax];
}

function rowTablesBytes(engine) {
  const rows = 202;
  const out = new Int32Array(6 + 2 * rows * 8);
  out.set(triangleEngineGlobals(engine));
  [engine.right, engine.left].forEach((table, t) => {
    for (let y = 0; y < rows; y++) {
      out.set([table.x[y], table.a4[y], table.row[y], table.column[y], table.a10[y], table.a14[y]], 6 + (t * rows + y) * 8);
    }
  });
  return new Uint8Array(out.buffer);
}

function drawRandomTriangles(seed, isSided) {
  const engine = createTriangleEngine(triangleSineTable(demoFiles().image));
  const texture = triangleTexturePattern();
  const vertices = createTriangleVertices(3);
  const random = createRandom(seed);
  const crcs = [];
  for (let c = 0; c < fixtures.triangles.length; c++) {
    setRandomTriangle(random, vertices);
    if (isSided) {
      setupTriangle(engine, vertices, 0, 1, 2, true);
      crcs.push(crc32(rowTablesBytes(engine)));
      continue;
    }
    const target = backgroundPattern();
    setTriangleTarget(engine, target);
    setupTriangle(engine, vertices, 0, 1, 2);
    fillTriangleSpans(engine, texture);
    const bytes = new Uint8Array(SCREEN_BYTES + 8);
    bytes.set(target);
    bytes.set(new Uint8Array(Int32Array.of(engine.top, engine.bottom).buffer), SCREEN_BYTES);
    crcs.push(crc32(bytes));
  }
  return crcs;
}

test('the triangle engine (0x43654, 0x439cc, 0x764a2) draws random triangles as the original does', () => {
  const crcs = drawRandomTriangles(31, false);
  assert.deepEqual(crcs.map((c, i) => (c === fixtures.triangles[i] ? null : i)).filter((i) => i !== null), []);
});

test("part 12's triangle setup (0x437c4, 0x43cf8) fills the row tables as the original does", () => {
  const crcs = drawRandomTriangles(32, true);
  assert.deepEqual(crcs.map((c, i) => (c === fixtures.sidedTriangles[i] ? null : i)).filter((i) => i !== null), []);
});

test('the triangle engine rotates (0x43450) and projects (0x435e8) as the original does', () => {
  const engine = createTriangleEngine(triangleSineTable(demoFiles().image));
  const random = createRandom(33);
  const vertices = createTriangleVertices(16);
  const fields = ['x', 'y', 'z', 'rx', 'ry', 'rz', 'sx', 'sy', 'row', 'column', 'extra0', 'extra1'];
  const crcs = fixtures.rotateProject.map(() => {
    for (let k = 0; k < 16; k++) {
      vertices.x[k] = random.int(-0x8000, 0x8000);
      vertices.y[k] = random.int(-0x8000, 0x8000);
      vertices.z[k] = random.int(-0x8000, 0x8000);
    }
    const [a, b, c] = [random.int(0, 1023), random.int(0, 1023), random.int(0, 1023)];
    engine.eyeDistance = random.int(0x1000, 0x400000);
    rotateVertices(engine, vertices, 0, 16, a, b, c);
    projectVertices(engine, vertices, 0, 16, 160, 100);
    const records = new Int32Array(16 * 16);
    for (let k = 0; k < 16; k++) {
      fields.forEach((field, i) => {
        records[k * 16 + i] = vertices[field][k];
      });
    }
    return crc32(new Uint8Array(records.buffer));
  });
  assert.deepEqual(crcs, fixtures.rotateProject);
});

// --- the projector of the skull parts ---

function lightMapPattern() {
  return Uint32Array.from({ length: 0x10000 }, (_, i) => (i * 7919) % 0x2800);
}

function filmPattern() {
  return Uint8Array.from({ length: 0x2800 }, (_, i) => ((i * 37) >> 3) & 63);
}

test('the projector renderer (0x457f0) draws the skull and its light depth as the original does', () => {
  const view = newWorld();
  const light = CreateWorld(30, 0x76c, 0xa8c, 0xa8c);
  view.isFastPath = true;
  const skull = LoadObject(demoFiles().archive, 'skull.eob');
  AddObject(view, skull);
  ScalePoints(skull, 1);
  ScalePoints(skull, 0x20);
  ScaleKeys(skull, 0x20);
  ComputeBounds(view);
  SetRenderMode(view, 3);
  SetRenderMode(light, 3);
  setTreeDraw(skull, drawProjected);
  const projector = createProjectorState();
  projector.lightMap.set(lightMapPattern());
  projector.film.set(filmPattern());
  const colourTable = colourTablePattern();
  const random = createRandom(41);
  const crcs = fixtures.projector.map((_, frameId) => {
    projector.frameId = frameId & 255;
    SetObjPos(skull, random.int(-150, 150), random.int(-150, 150), random.int(400, 1500));
    SetObjAngles(skull, [random.int(0, 4095), random.int(0, 4095), random.int(0, 4095)]);
    const camera = [random.int(-100, 100), random.int(-100, 100), random.int(-100, 100)];
    const cameraAngles = [random.int(-100, 100), random.int(-100, 100), random.int(-400, 400)];
    SetCameraPos(view, ...camera);
    SetCameraAngles(view, cameraAngles);
    SetCameraPos(light, ...camera.map((c) => c + random.int(-200, 200)));
    SetCameraAngles(light, cameraAngles.map((a) => a + random.int(-60, 60)));
    const target = backgroundPattern();
    RenderWorldProjected(view, light, { target, colourTable, projector });
    const bytes = new Uint8Array(SCREEN_BYTES + 0x40000);
    bytes.set(target);
    bytes.set(new Uint8Array(projector.depth.buffer), SCREEN_BYTES);
    return crc32(bytes);
  });
  assert.deepEqual(crcs.map((c, i) => (c === fixtures.projector[i] ? null : i)).filter((i) => i !== null), []);
});

// --- recordings ---

test("part 0's orbit camera (camera.rec, 0x26d44, 0x26e1c) moves the camera as the original does", () => {
  const world = newWorld();
  const spider = createObject();
  const recording = readChannelRecording(demoFiles().archive.read('camera.rec'), 4);
  let quads = cameraQuadratics(recording, 0);
  const state = createOrbitState();
  const player = createRecordPlayer();
  const random = createRandom(51);
  const crcs = fixtures.orbitCamera.map(() => {
    SetObjPos(spider, random.int(-3000, 3000), 0, random.int(-3000, 3000));
    orbitCamera(state, spider, player, quads, world, 1);
    const bytes = new Uint8Array(16 + 0x12 + 0x60);
    bytes.set(new Uint8Array(Int32Array.from(state).buffer));
    bytes.set(new Uint8Array(Int32Array.from(world.cameraPosition).buffer), 16);
    bytes.set(new Uint8Array(Int16Array.from(world.cameraAngles).buffer), 28);
    bytes.set(new Uint8Array(Float32Array.from([...world.view, ...world.cameraToWorld]).buffer), 34);
    advanceRecordPlayer(player, random.int(1, 3), (index) => {
      quads = cameraQuadratics(recording, index);
    });
    return crc32(bytes);
  });
  const differing = crcs.map((c, i) => (c === fixtures.orbitCamera[i] ? null : i)).filter((i) => i !== null);
  assert.deepEqual(differing, []);
});

test('teeth.rap frames unpack (0x49028) as the original unpacks them', () => {
  const rap = demoFiles().archive.read('teeth.rap');
  const out = new Uint8Array(0x2800);
  assert.deepEqual(fixtures.film.map((_, frame) => crc32(unpackFilmFrame(rap, frame, out))), fixtures.film);
});

// --- the transitions' quad ---

test('the fly-away quad (0x27cac, perspective mapper 0x36890 on both faces) is drawn as the original draws it', () => {
  const screen = backgroundPattern();
  const back = Uint8Array.from({ length: 0x10000 }, (_, i) => ((i * 13) ^ (i >> 8)) & 255);
  const { world, quad } = createQuadWorld(demoFiles().image, screen, back);
  const colourTable = colourTablePattern();
  const random = createRandom(61);
  const crcs = fixtures.quad.map(() => {
    SetObjPos(quad, random.int(-300, 300), random.int(-300, 300), random.int(-200, 1200));
    SetObjAngleX(quad, random.int(0, 4095));
    SetObjAngleY(quad, random.int(0, 4095));
    SetObjAngleZ(quad, random.int(0, 4095));
    return renderedCrc(world, colourTable);
  });
  assert.deepEqual(crcs.map((c, i) => (c === fixtures.quad[i] ? null : i)).filter((i) => i !== null), []);
});
