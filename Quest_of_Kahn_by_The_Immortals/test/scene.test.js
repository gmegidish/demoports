import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMachine } from '../src/machine.js';
import { loadScene, findMesh, FACE_PERSPECTIVE, FACE_AFFINE, FACE_ENVIRONMENT, FACE_TWO_SIDED, FACE_SPECIAL, WORLD_CAMERA } from '../src/engine/scene.js';
import { demoAssets } from './helpers.js';

const assets = demoAssets();

/** Frame range, sortable faces, lights and cameras of each scene, from the disassembly notes. */
const SCENES = {
  BADDY: { frames: [0, 90], faces: 672, lights: 0, cameras: 1 },
  BADDY2: { frames: [0, 90], faces: 672, lights: 0, cameras: 1 },
  BADGUY: { frames: [0, 550], faces: 3414, lights: 1, cameras: 4 },
  BRIDGE: { frames: [0, 780], faces: 2581, lights: 1, cameras: 4 },
  CREAT: { frames: [0, 570], faces: 1822, lights: 0, cameras: 1 },
  CRED: { frames: [0, 600], faces: 70, lights: 0, cameras: 1 },
  FIRSTS: { frames: [0, 500], faces: 294, lights: 0, cameras: 3 },
  HITCAR: { frames: [0, 630], faces: 2274, lights: 2, cameras: 3 },
  SECONDS: { frames: [0, 580], faces: 4698, lights: 0, cameras: 4 },
};

function load(name) {
  return loadScene(createMachine(), assets, `scenes\\${name}.3ds`, 10);
}

function camerasOf(scene) {
  return scene.world.filter((item) => item.type === WORLD_CAMERA);
}

function assertClose(actual, expected, tolerance = 1e-3) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} is not close to ${expected}`);
}

for (const [name, expected] of Object.entries(SCENES)) {
  test(`${name}.3DS loads with the expected frames, faces, lights and cameras`, () => {
    const scene = load(name);

    assert.deepEqual([scene.firstFrame, scene.lastFrame], expected.frames);
    assert.equal(scene.faceCount, expected.faces);
    assert.equal(scene.lightCount, expected.lights);
    assert.equal(camerasOf(scene).length, expected.cameras);
  });
}

test('vertices end up in object space with biased texel coordinates', () => {
  const plate = findMesh(load('CREAT'), 'objct-prs');

  assertClose(plate.position[0], -5397.6426, 0.01);
  assertClose(plate.position[1], -4559.6523, 0.01);
  assertClose(plate.position[2], -6.9058824, 0.01);
  assertClose(plate.uv[0], 6351.4805, 0.01);
  assertClose(plate.uv[1], 9605.262, 0.01);
});

test('object names decide how their faces are drawn, and case matters', () => {
  const steal = load('FIRSTS');

  assert.equal(findMesh(steal, 'pyr-cul').renderFlags, FACE_AFFINE | FACE_TWO_SIDED);
  assert.equal(findMesh(steal, 'Ceilig,Prs').renderFlags, FACE_AFFINE);
  assert.equal(findMesh(load('SECONDS'), 'cul-spc').renderFlags, FACE_AFFINE | FACE_TWO_SIDED | FACE_SPECIAL);
  assert.equal(findMesh(load('CREAT'), 'Objct-prs').renderFlags, FACE_PERSPECTIVE);
});

test('only environment-mapped meshes get vertex normals', () => {
  const plate = findMesh(load('CREAT'), 'Objct-prs');
  const mapped = findMesh(load('FIRSTS'), 'env-stone');

  assert.ok(mapped.renderFlags & FACE_ENVIRONMENT);

  assert.ok(plate.normal.every((component) => component === 0));
  assert.ok(mapped.normal.some((component) => component !== 0));
});

test('every face of every mesh has a texture, and the scene keeps the palette of its last material', () => {
  const scene = load('BRIDGE');

  for (const { object } of scene.world) {
    for (const face of object.faces ?? []) {
      assert.equal(face.texture.length, 0x10000);
    }
  }
  assert.equal(scene.palette.length, 768);
  assert.ok(scene.palette.every((component) => component < 64));
});

test('a mesh drawn by hand culls its back faces even when its name makes it two-sided', async () => {
  const { engine, activateScene, animate, isFaceVisible } = await import('../src/engine/frame.js');
  const scene = load('FIRSTS');
  const pyramid = findMesh(scene, 'pyr-cul');
  activateScene(scene);
  engine.frame = 200;
  animate();

  const seenByTheEngine = pyramid.faces.filter((face) => isFaceVisible(face)).length;
  const drawnByHand = pyramid.faces.filter((face) => isFaceVisible(face, false)).length;

  assert.ok(drawnByHand < seenByTheEngine);
});
