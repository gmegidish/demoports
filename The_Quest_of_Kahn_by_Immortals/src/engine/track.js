// The keyframer: 3D Studio's tension/continuity/bias Hermite splines with ease in/out.
// KAHN.EXE 0x2fce4..0x310b0. Rotations are not slerped: the loader accumulates each key into an
// absolute quaternion and its four components go through the same spline as a position.

const f = Math.fround;
const COMPONENTS = 4;
/** Tangent setup treats a track as looping only with these bits set; evaluation with any bit. */
const LOOP_TANGENT_MASK = 0x0f00;

export const OBJECT_HIDDEN_BY_TRACK = 2;

/**
 * @typedef {object} Key
 * @property {number} frame
 * @property {Float32Array} v value: one float, a vector, or a quaternion (x, y, z, w)
 * @property {number} tension
 * @property {number} continuity
 * @property {number} bias
 * @property {number} easeTo
 * @property {number} easeFrom
 * @property {Float32Array} ds incoming tangent
 * @property {Float32Array} dd outgoing tangent
 * @property {object|null} morph morph tracks only: the target mesh
 */

/**
 * @typedef {object} Track
 * @property {Key[]} keys
 * @property {number} cursor index of the current segment; persists between frames and only moves forward
 * @property {number} length frame of the last key
 * @property {number} loop zero for a track that holds its last key
 */

/** @returns {Track} */
export function createTrack() {
  return { keys: [], cursor: 0, length: 0, loop: 0 };
}

/** tcb is the five floats 3D Studio stores per key: tension, continuity, bias, ease to, ease from. */
export function addKey(track, frame, values, tcb, morph = null) {
  const v = new Float32Array(COMPONENTS);
  v.set(values);
  track.keys.push({
    frame,
    v,
    tension: f(tcb[0]),
    continuity: f(tcb[1]),
    bias: f(tcb[2]),
    easeTo: f(tcb[3]),
    easeFrom: f(tcb[4]),
    ds: new Float32Array(COMPONENTS),
    dd: new Float32Array(COMPONENTS),
    morph,
  });
}

/**
 * Tangents of a key that has a neighbour on each side. 0x300f0; with a wrap length, 0x3029c
 * (the previous key is across the loop seam) and 0x3045c (the next key is).
 */
function setMiddleTangents(previous, key, next, wrapBefore, wrapAfter) {
  const half = 0.5 * (1 - key.tension);
  const normalizer = 1 / ((next.frame - previous.frame + wrapBefore + wrapAfter) * 0.5);
  const ratioIn = (key.frame - previous.frame + wrapBefore) * normalizer;
  const ratioOut = (next.frame - key.frame + wrapAfter) * normalizer;
  const absContinuity = f(Math.abs(key.continuity));
  const adjustIn = ratioIn + absContinuity - absContinuity * ratioIn;
  const adjustOut = ratioOut + absContinuity - absContinuity * ratioOut;
  const lessContinuity = 1 - key.continuity;
  const moreContinuity = 2.0 - lessContinuity;
  const lessBias = 1 - key.bias;
  const moreBias = 2.0 - lessBias;
  const a = f(half * lessContinuity * moreBias * adjustIn);
  const b = f(adjustIn * (half * moreContinuity * lessBias));
  const c = f(half * moreContinuity * moreBias * adjustOut);
  const d = f(adjustOut * (half * lessContinuity * lessBias));
  for (let i = 0; i < COMPONENTS; i++) {
    const before = key.v[i] - previous.v[i];
    const after = next.v[i] - key.v[i];
    key.ds[i] = a * before + b * after;
    key.dd[i] = c * before + d * after;
  }
}

/** Outgoing tangent of the first key of a track that does not loop. 0x30614. */
function setFirstTangent(first, second, third) {
  const factor = 0.25 - (second.frame - first.frame) / ((third.frame - first.frame) * 2);
  for (let i = 0; i < COMPONENTS; i++) {
    const toThird = third.v[i] - first.v[i];
    const toSecond = second.v[i] - first.v[i];
    first.dd[i] = (toThird * factor + (toSecond - toThird * 0.5) * 3 * 0.5 + toThird * 0.5) * (1 - first.tension);
  }
}

/** Incoming tangent of the last key of a track that does not loop. 0x30728. */
function setLastTangent(thirdLast, secondLast, last) {
  const factor = 0.25 - (last.frame - secondLast.frame) / ((last.frame - thirdLast.frame) * 2);
  for (let i = 0; i < COMPONENTS; i++) {
    const fromThirdLast = last.v[i] - thirdLast.v[i];
    const fromSecondLast = last.v[i] - secondLast.v[i];
    last.ds[i] = (fromThirdLast * factor + (fromSecondLast - fromThirdLast * 0.5) * 3 * 0.5 + fromThirdLast * 0.5) * (1 - last.tension);
  }
}

/**
 * A two-key track gets straight tangents on its first three components only, so the w of a
 * two-key rotation eases with zero tangents. 0x30848, 0x308a0.
 */
function setTwoKeyTangents(first, second) {
  for (let i = 0; i < 3; i++) {
    const delta = second.v[i] - first.v[i];
    first.dd[i] = (1 - first.tension) * delta;
    second.ds[i] = (1 - second.tension) * delta;
  }
}

/** Called once, after all keys are in. 0x308fc. */
export function prepareTangents(track) {
  const keys = track.keys;
  const count = keys.length;
  track.length = count > 0 ? keys[count - 1].frame : 0;
  if (count > 2) {
    for (let i = 1; i < count - 1; i++) {
      setMiddleTangents(keys[i - 1], keys[i], keys[i + 1], 0, 0);
    }
    if (track.loop & LOOP_TANGENT_MASK) {
      // A looping track ends on a copy of its first key.
      setMiddleTangents(keys[count - 2], keys[0], keys[1], track.length, 0);
      setMiddleTangents(keys[count - 2], keys[count - 1], keys[1], 0, track.length);
    } else {
      setFirstTangent(keys[0], keys[1], keys[2]);
      setLastTangent(keys[count - 3], keys[count - 2], keys[count - 1]);
    }
  } else if (count === 2) {
    setTwoKeyTangents(keys[0], keys[1]);
  }
  track.cursor = 0;
}

/** 3D Studio's ease curve: accelerate over the first `from`, decelerate over the last `to`. 0x2ff94. */
function ease(u, from, to) {
  const sum = from + to;
  if (sum === 0) {
    return u;
  }
  let a = from;
  let b = to;
  if (sum > 1) {
    const inverse = 1 / f(sum);
    a = f(a * inverse);
    b = f(b * inverse);
  }
  const k = f(1 / (2.0 - a - b));
  if (u < a) {
    return u * ((k / a) * u);
  }
  if (1 - b > u) {
    return (u * 2 - a) * k;
  }
  const t = f(1 - u);
  return 1 - (k / b) * t * t;
}

/** Frame within the track after looping, as the last call to selectSegment saw it. */
let localFrame = 0;

/**
 * Move the track's cursor for this frame and return the position inside the segment, or -1 when
 * the cursor sits on the last key. The cursor advances one key per call at most and rewinds only
 * when a loop wraps, so the position is not clamped: before the first key and right after a jump
 * in time the spline extrapolates.
 */
function selectSegment(track, frame) {
  const keys = track.keys;
  localFrame = frame;
  if (track.loop !== 0) {
    const laps = Math.trunc(frame / track.length);
    localFrame = f(frame - laps * track.length);
    if (keys[track.cursor].frame > localFrame) {
      track.cursor = 0;
    }
  }
  const last = keys.length - 1;
  if (last > track.cursor && keys[track.cursor + 1].frame < localFrame) {
    track.cursor++;
  }
  if (last === track.cursor) {
    return -1;
  }
  const current = keys[track.cursor];
  const next = keys[track.cursor + 1];
  return f((localFrame - current.frame) / (next.frame - current.frame));
}

/**
 * Evaluate a float, vector or quaternion track into out[at .. at + components).
 * A missing track leaves the output alone. 0x30a14, 0x30ba4, 0x30da8.
 */
export function evaluate(track, frame, out, at, components) {
  if (!track) {
    return;
  }
  const keys = track.keys;
  if (keys.length === 1) {
    for (let i = 0; i < components; i++) {
      out[at + i] = keys[0].v[i];
    }
    return;
  }
  let u = selectSegment(track, frame);
  const current = keys[track.cursor];
  if (u === -1) {
    for (let i = 0; i < components; i++) {
      out[at + i] = current.v[i];
    }
    return;
  }
  const next = keys[track.cursor + 1];
  u = ease(u, current.easeFrom, next.easeTo);
  const u2 = u * u;
  const u3 = u2 * u;
  const weightNext = u3 * -2 + u2 * 3;
  const weightCurrent = 2 * u3 - u2 * 3 + 1;
  const weightOut = u + (u3 - u2 * 2);
  const weightIn = u3 - u2;
  for (let i = 0; i < components; i++) {
    out[at + i] = weightCurrent * current.v[i] + weightNext * next.v[i] + weightOut * current.dd[i] + weightIn * next.ds[i];
  }
}

/**
 * Hide track: every key reached flips the mesh between shown and hidden, one flip per frame at most.
 * Un-hiding clears the whole flags word, as the original does. 0x30fe0.
 */
export function evaluateHide(track, frame, mesh) {
  if (!track) {
    return;
  }
  const keys = track.keys;
  // The original reads one key past the end on a looping track; that key never rewinds the cursor here.
  if (track.cursor >= keys.length || keys[track.cursor].frame > frame) {
    return;
  }
  track.cursor++;
  if (mesh.flags & OBJECT_HIDDEN_BY_TRACK) {
    mesh.flags = 0;
  } else {
    mesh.flags |= OBJECT_HIDDEN_BY_TRACK;
  }
}

/**
 * Morph track: picks the two shapes to blend and the weight of the first. On the last key the
 * original shows the shape before it at full weight. 0x310b0.
 */
export function evaluateMorph(track, frame, mesh) {
  if (!track || track.keys.length === 0) {
    return;
  }
  const keys = track.keys;
  const u = selectSegment(track, frame);
  if (u === -1) {
    mesh.morphFrom = keys[Math.max(track.cursor - 1, 0)].morph;
    mesh.morphTo = keys[track.cursor].morph;
    mesh.morphWeight = 1;
    return;
  }
  mesh.morphFrom = keys[track.cursor].morph;
  mesh.morphTo = keys[track.cursor + 1].morph;
  mesh.morphWeight = f(1 - u);
}

/** Put every cursor back on the first key, for replaying a scene from its start. */
export function rewind(track) {
  if (track) {
    track.cursor = 0;
  }
}
