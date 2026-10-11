// Recordings (E1 §5): the 12-byte camera recordings (*.rec of parts 3, 5, 9, 10, 12, 14) and their
// player 0x2789c; part 0's three 16-frames-per-record formats (camera.rec: quadratic segments
// 0x26d44 + low-pass + orbit 0x26e1c; spider.rec / light.rec: linear) with their players; and
// teeth.rap (36 4-bit frames, unpacked by 0x49028, ping-ponged by the skull parts).
// Time is counted in frames of the 70.086 Hz timer since the part started.

import { f32, idiv, trunc } from './fixed.js';
import { SetCameraPos, SetCameraAngles, GetObjPos } from './world.js';

const CAM_RECORD_SHORTS = 6;
export const FRAMES_PER_RECORD = 16;
const FRACTION_MASK = 15;
const PI = 3.141592653589793;
const ONE_OVER_2048 = 0.00048828125;

// --- 12-byte camera recordings --------------------------------------------------------------------

/** {x, y, z, ax, ay, az} shorts per record. */
export function readCameraRecording(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = Math.floor(bytes.byteLength / (2 * CAM_RECORD_SHORTS));
  return Int16Array.from({ length: count * CAM_RECORD_SHORTS }, (_, i) => view.getInt16(2 * i, true));
}

export function cameraRecordCount(records) {
  return records.length / CAM_RECORD_SHORTS;
}

/** 0x2789c: SetCameraPos then SetCameraAngles from record `index` (no interpolation). */
export function playCameraRecord(world, records, index) {
  const at = index * CAM_RECORD_SHORTS;
  SetCameraPos(world, records[at], records[at + 1], records[at + 2]);
  SetCameraAngles(world, [records[at + 3], records[at + 4], records[at + 5]]);
}

// --- part 0: records of `channels` ints, one per 16 frames -------------------------------------------

/** camera.rec / spider.rec: 4 ints per record; light.rec: 2. */
export function readChannelRecording(bytes, channels) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = Math.floor(bytes.byteLength / (4 * channels));
  return { channels, count, values: Int32Array.from({ length: count * channels }, (_, i) => view.getInt32(4 * i, true)) };
}

function channelValue(recording, index, channel) {
  return recording.values[index * recording.channels + channel];
}

/** A player's accumulator / record index / fraction ([0xde710..] camera, [0xde720..] light, [0xde730..] spider). */
export function createRecordPlayer() {
  return { acc: 0, index: 0, frac: 0 };
}

/**
 * After a frame is drawn: acc += dt; each full 16 frames moves to the next record (calling
 * onNextRecord, which the camera player uses to rebuild its quadratics); frac = acc & 15.
 */
export function advanceRecordPlayer(player, dt, onNextRecord = () => {}) {
  player.acc += dt;
  while (player.acc >= FRAMES_PER_RECORD) {
    onNextRecord(player.index);
    player.index++;
    player.acc -= FRAMES_PER_RECORD;
  }
  player.frac = player.acc & FRACTION_MASK;
}

/** lerp16 (spider.rec, light.rec): (rec[i].c*(16-f) + rec[i+1].c*f) >> 4 for every channel. */
export function lerpRecord(recording, player) {
  const { index, frac } = player;
  return Int32Array.from({ length: recording.channels }, (_, c) =>
    (Math.imul(channelValue(recording, index, c), FRAMES_PER_RECORD - frac)
      + Math.imul(channelValue(recording, index + 1, c), frac)) >> 4);
}

/**
 * 0x26d44 MakeQuad(p0, p1, p2, n): f(s) = (a*s + b)*s + c through p0 (s=-1), p1 (0), p2 (1);
 * evaluated at s = frac*d. Single precision as the x87 runs (24 bits).
 */
export function makeQuadratic(p0, p1, p2, n = FRAMES_PER_RECORD) {
  const b = f32((p2 - p0) * 0.5);
  return { a: f32(f32(p2 - b) - p1), b, c: p1, d: f32(1 / n) };
}

/** The quadratic at a fraction (frames into the segment), truncated toward zero. */
export function evaluateQuadratic(q, frac) {
  const s = f32(frac * q.d);
  return trunc(f32(f32(f32(f32(q.a * s) + q.b) * s) + q.c));
}

/** camera.rec segment idx: quadratics of the 4 channels through records idx, idx+1, idx+2. */
export function cameraQuadratics(recording, first) {
  return Array.from({ length: recording.channels }, (_, c) => makeQuadratic(
    channelValue(recording, first, c), channelValue(recording, first + 1, c), channelValue(recording, first + 2, c)));
}

/** Part 0's camera state at the start: pitch, yaw, roll, distance. */
export function createOrbitState() {
  return Int32Array.of(0, 0, 0, 0x251c);
}

/**
 * 0x26e1c OrbitCamera(state, object, player, quads, world, divisor): low-pass each channel
 * towards its quadratic (state = (state + q(frac)) >> 1), then put the camera at distance
 * state[3]/divisor behind the object, pitched by state[0] about X and turned by state[1] about Y
 * around it, looking with angles (state[0], state[1], state[2]).
 */
export function orbitCamera(state, object, player, quads, world, divisor = 1) {
  for (let c = 0; c < 4; c++) {
    state[c] = (state[c] + evaluateQuadratic(quads[c], player.frac)) >> 1;
  }
  const [px, py, pz] = GetObjPos(object);
  let x = px;
  let y = py;
  let z = (pz + idiv(-state[3], divisor)) | 0;
  const pitch = f32(f32(state[0] * PI) * ONE_OVER_2048);
  {
    const dy = y - py;
    const dz = z - pz;
    const sin = Math.sin(pitch);
    const cos = Math.cos(pitch);
    y = trunc(f32(py + f32(f32(dy * cos) - f32(dz * sin))));
    z = trunc(f32(pz + f32(f32(dy * sin) + f32(dz * cos))));
  }
  const yaw = f32(f32(state[1] * PI) * ONE_OVER_2048);
  {
    const dx = x - px;
    const dz = z - pz;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    x = trunc(f32(px + f32(f32(dx * cos) + f32(dz * sin))));
    z = trunc(f32(pz + f32(f32(dz * cos) + f32(-dx * sin))));
  }
  SetCameraAngles(world, [state[0], state[1], state[2]]);
  SetCameraPos(world, x, y, z);
}

// --- teeth.rap -------------------------------------------------------------------------------------

export const FILM_FRAME_BYTES = 0x1400;
export const FILM_FRAMES = 36;
const FRAMES_PER_FILM_STEP = 3;
const FILM_CYCLE = 72;

/** 0x49028: one 4-bit packed frame into 0x2800 texels (low nibble first). */
export function unpackFilmFrame(rap, frame, out) {
  const base = frame * FILM_FRAME_BYTES;
  for (let k = 0; k < FILM_FRAME_BYTES; k++) {
    const b = rap[base + k];
    out[2 * k] = b & 15;
    out[2 * k + 1] = b >> 4;
  }
  return out;
}

/** The skull parts' frame choice: (frames >> 3) % 72 played forwards then backwards (0..35..0). */
export function filmFrameAt(frames) {
  const f = (frames >> FRAMES_PER_FILM_STEP) % FILM_CYCLE;
  return f > FILM_FRAMES - 1 ? FILM_CYCLE - 1 - f : f;
}
