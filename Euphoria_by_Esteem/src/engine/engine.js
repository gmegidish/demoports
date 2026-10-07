// The 3D unit's globals (segment 1342 data): projection, rotation matrix, lights, the screen polygon.
import { f32, int16 } from '../machine.js';
import { buildLitTable, solidSpan } from '../raster.js';
import { roundS } from './points.js';
import { LightDir, Light } from './objects.js';

/** DS:238a */
const DEG2RAD = f32(0.017453292519943295);
const DEFAULT_PERSPECTIVE = 200;

/** The unit's globals, one per machine. */
export class Engine3d {
  constructor(m) {
    this.m = m;
    this.perspective = DEFAULT_PERSPECTIVE;
    this.matrix = new Float32Array(9);
    /** DS:5aba: the screen polygon, pts[1..4] = {x, y, c}. */
    this.pts = [null, { x: 0, y: 0, c: 0 }, { x: 0, y: 0, c: 0 }, { x: 0, y: 0, c: 0 }, { x: 0, y: 0, c: 0 }];
    this.isWindingFlipped = false;
    this.lights = [null];
    this.starMode = 1;
    this.starMin = 0;
    this.starMax = 0;
    this.noSort = false;
    this.faceColor = 0;
    /** DS:911a: the span routine of flat fills (186a:1620 sets it). Types 2 and 4 reset it to solid. */
    this.spanHook = solidSpan;
    this.lightDir = new LightDir(this, 0, 0, 0, 0, 0, -1);
    this.addLight(new Light(this, 0, 0, 200, 500, 255));
    buildLitTable(m, 0, 0, 255, 1);
  }

  /** 1342:0019: the rotation matrix from Euler angles in degrees. */
  setRotation(ax, ay, az) {
    const a = f32(ax * DEG2RAD);
    const b = f32(ay * DEG2RAD);
    const c = f32(az * DEG2RAD);
    const s1 = f32(Math.sin(a));
    const s2 = f32(Math.sin(b));
    const s3 = f32(Math.sin(c));
    const c1 = f32(Math.cos(a));
    const c2 = f32(Math.cos(b));
    const c3 = f32(Math.cos(c));
    const t1 = f32(s1 * s2);
    const t2 = f32(c1 * c2);
    const t3 = f32(s1 * c2);
    const t4 = f32(c1 * s2);
    const M = this.matrix;
    M[0] = c2 * c3;
    M[1] = s3;
    M[2] = -s2 * c3;
    M[3] = t1 - t2 * s3;
    M[4] = c1 * c3;
    M[5] = t4 * s3 + t3;
    M[6] = t3 * s3 + t4;
    M[7] = -s1 * c3;
    M[8] = t2 - t1 * s3;
  }

  /** 1342:0179, on a {x, y, z} triple. */
  rotate(v) {
    const M = this.matrix;
    const { x, y, z } = v;
    v.x = f32(M[0] * x + M[2] * z + M[1] * y);
    v.y = f32(M[3] * x + M[5] * z + M[4] * y);
    v.z = f32(M[6] * x + M[8] * z + M[7] * y);
  }

  /** 1342:020e: null when z >= D, else the scaled x, y (float32). */
  project(x, y, z) {
    const D = this.perspective;
    if (!(D > z)) {
      return null;
    }
    const f = f32(D / (D - z));
    return { x: f32(x * f), y: f32(y * f) };
  }

  screenX(x) {
    return int16(roundS(x) + this.m.centerX);
  }

  screenY(y) {
    return int16(roundS(y) + this.m.centerY);
  }

  /** 1342:4400 */
  addLight(light) {
    this.lights.push(light);
  }

  /** 1342:4427 */
  freeLights() {
    this.lights = [null];
  }

  get lightCount() {
    return this.lights.length - 1;
  }
}
