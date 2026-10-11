// Part 7's two sphere maps, built by 0x1fd38 while the "waiting for robotnik" screen is up.
// Both are 256x256 entries of a byte pair (u, v): byte 0 is the longitude u, byte 1 the latitude v.
//  - the view map ([0xdc700]): which texel of the ball each pixel of a 256x256 window shows, ray cast
//    onto a sphere of radius 140 seen from z = -768 with focal length 384; (0,0) where the ray misses.
//  - the turn map ([0xdc6fc]): the same sphere re-parameterised by a quarter turn, so looking (u,v)
//    up in it twice, with an offset added to u each time, spins the ball about two axes.
// Double precision reproduces the original's tables (a handful of turn-map entries that land within
// 1e-7 of a half differ by one, as they do between FPUs).

import { roundHalfEven } from '../fpu.js';

const SIZE = 256;
const HALF = 128;
/** The truncated pi of the double at 0x8db3c. */
const PI = 3.14159265;
/** 0x8db1c: rows are stretched by 1.15, which makes the ball a little taller than wide. */
const ROW_STRETCH = 1.15;
/** 0x8db64..0x8db7c: |eye|^2 - r^2 terms of the ray/sphere intersection, eye at -768, focal 384. */
const FOCAL_SQUARED = 147456;
const LINEAR_TERM = -294912;
const CONSTANT_TERM = 570224;
const FOCAL = 384;
const EYE_DISTANCE = 768;
/** 0x8db2c = 127 / pi and 0x8db34 = 255 / pi. */
const LONGITUDE_SCALE = 40.42535559153412;
const LATITUDE_SCALE = 81.16902106961575;

function toByte(angle, scale) {
  return (roundHalfEven(angle * scale) + HALF) & 0xff;
}

/** First half of 0x1fd38: the ray-cast view of the ball. */
function buildViewMap() {
  const map = new Uint8Array(SIZE * SIZE * 2);
  let k = 0;
  for (let ty = -HALF; ty < HALF; ty++) {
    const y = ty * ROW_STRETCH;
    const rowTerm = Math.trunc(y * y + FOCAL_SQUARED);
    for (let tx = -HALF; tx < HALF; tx++, k += 2) {
      const a = tx * tx + rowTerm;
      const b = LINEAR_TERM / a;
      const c = CONSTANT_TERM / a;
      if (b * b < c) {
        continue;
      }
      const t = -b - Math.sqrt(b * b - c);
      const px = t * tx;
      const py = t * y;
      const pz = t * FOCAL - EYE_DISTANCE;
      map[k] = toByte(Math.atan2(-pz, px), LONGITUDE_SCALE);
      map[k + 1] = toByte(Math.asin(py / Math.sqrt(px * px + py * py + pz * pz)), LATITUDE_SCALE);
    }
  }
  return map;
}

/** Second half of 0x1fd38: the quarter-turned parameterisation. */
function buildTurnMap() {
  const map = new Uint8Array(SIZE * SIZE * 2);
  let k = 0;
  for (let i = 0; i < SIZE; i++) {
    const latitude = (i - HALF) * PI * (1 / 256);
    const sinLatitude = Math.sin(latitude);
    const cosLatitude = Math.cos(latitude);
    for (let j = 0; j < SIZE; j++, k += 2) {
      const longitude = (j - HALF) * PI * (1 / 128);
      const q = -cosLatitude * Math.sin(longitude);
      const z = Math.cos(longitude) * cosLatitude;
      map[k] = toByte(Math.atan2(cosLatitude * Math.sin(longitude), sinLatitude), 128 / PI);
      map[k + 1] = toByte(Math.asin(z / Math.sqrt(z * z + sinLatitude * sinLatitude + q * q)), 256 / PI);
    }
  }
  return map;
}

/**
 * 0x1fd38 precalcPart7Maps. The turn map gets 256 spare zero entries: the ray test reads one row
 * past its end when a lookup carries into v = 256 (the original reads whatever follows the block).
 * @returns {{view: Uint8Array, turn: Uint8Array}}
 */
export function buildBallMaps() {
  const turn = new Uint8Array((SIZE * SIZE + SIZE) * 2);
  turn.set(buildTurnMap());
  return { view: buildViewMap(), turn };
}
