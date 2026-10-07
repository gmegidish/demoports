// The 3D unit (segment 1342), part 1: constants, points, meshes, lines. Notes: docs/disassembly/L3_3d_a.md.
// Every float field is float32; f32() marks each store.
import { f32, int16, roundHalfEven } from '../machine.js';
import { putPixel, line, drawDot } from '../gfx.js';

export const FILL_FLAT = 0;
export const FILL_RANGE = 1;
export const FILL_GRADIENT = 2;
export const FILL_TEXTURE = 3;
export const FILL_ADDITIVE = 4;
export const SHADE_NONE = 0x00;
export const SHADE_FLAT = 0x08;
export const SHADE_GOURAUD = 0x10;
export const SHADE_ANGLE = 0x18;
export const FACE_DOUBLE_SIDED = 0x40;
export const FACE_ALWAYS_DRAW = 0x80;
export const MESH_NO_DEDUP = 0x100;
export const MESH_NO_SORT = 0x200;
export const MESH_FLIP_WINDING = 0x400;

/** 1342:0000 RoundS: frndint + fistp, to a longint. */
export const roundS = roundHalfEven;

export class Pixel {
  constructor(x, y, z, color = 0) {
    this.wx = f32(x);
    this.wy = f32(y);
    this.wz = f32(z);
    this.px = this.wx;
    this.py = this.wy;
    this.pz = this.wz;
    this.sx = 0;
    this.sy = 0;
    /** Velocity, or the accumulated vertex normal when used as a mesh vertex. */
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    /** Colour, or the gouraud light cache of a mesh vertex. */
    this.color = color;
  }

  /** 1342:04bf */
  setPos(x, y, z) {
    this.px = f32(x);
    this.py = f32(y);
    this.pz = f32(z);
    this.wx = this.px;
    this.wy = this.py;
    this.wz = this.pz;
  }

  /** 1342:0500 */
  movePos(dx, dy, dz) {
    this.setPos(f32(this.px + dx), f32(this.py + dy), f32(this.pz + dz));
  }

  /** 1342:0643 */
  setVelocity(vx, vy, vz) {
    this.vx = f32(vx);
    this.vy = f32(vy);
    this.vz = f32(vz);
  }

  /** 1342:066e */
  step() {
    this.setPos(f32(this.px + this.vx), f32(this.py + this.vy), f32(this.pz + this.vz));
  }

  /** 1342:0550: rotation about a centre, permanent. */
  rotateAround(engine, cx, cy, cz, ax, ay, az) {
    const w = { x: f32(this.px - cx), y: f32(this.py - cy), z: f32(this.pz - cz) };
    engine.setRotation(ax, ay, az);
    engine.rotate(w);
    this.setPos(f32(cx + w.x), f32(cy + w.y), f32(cz + w.z));
  }

  /** 1342:06bd (VMT+0xc of TPixel) */
  draw(engine) {
    const p = engine.project(this.wx, this.wy, this.wz);
    if (p) {
      this.sx = engine.screenX(p.x);
      this.sy = engine.screenY(p.y);
      putPixel(engine.m, this.sx, this.sy, this.color & 0xff);
    }
  }

}

/** VMT 23aa: a TPixel drawn as the 4x4 dot. */
export class BigPixel extends Pixel {
  draw(engine) {
    const p = engine.project(this.wx, this.wy, this.wz);
    if (p) {
      this.sx = engine.screenX(p.x);
      this.sy = engine.screenY(p.y);
      drawDot(engine.m, this.sx, this.sy, this.color & 0xff);
    }
  }
}

function samePos(a, b) {
  return a.px === b.px && a.py === b.py && a.pz === b.pz;
}

// ---- meshes ----

/** TMesh: an ordered list of points, an origin and a pivot. */
export class Mesh {
  constructor(engine) {
    this.engine = engine;
    this.items = [];
    this.origin = new Pixel(0, 0, 0);
    this.pivot = new Pixel(0, 0, 0);
    this.angX = 0;
    this.angY = 0;
    this.angZ = 0;
    this.velX = 0;
    this.velY = 0;
    this.velZ = 0;
  }

  get count() {
    return this.items.length;
  }

  /** 1342:0c20 */
  append(item) {
    this.items.push(item);
  }

  /** 1342:0c99: returns the vertex kept, the existing one when one has the same pos. */
  addUnique(item) {
    const found = this.items.find((other) => samePos(item, other));
    if (!found) {
      this.items.push(item);
      return item;
    }
    return found;
  }

  /** 1342:178c, 1-based. */
  getItem(n) {
    return n >= 1 && n <= this.items.length ? this.items[n - 1] : null;
  }

  /** 1342:0db6 */
  moveTo(x, y, z) {
    const dx = f32(x - this.origin.wx);
    const dy = f32(y - this.origin.wy);
    const dz = f32(z - this.origin.wz);
    this.origin.setPos(x, y, z);
    for (const item of this.items) {
      item.movePos(dx, dy, dz);
    }
    this.pivot.setPos(f32(this.pivot.wx + dx), f32(this.pivot.wy + dy), f32(this.pivot.wz + dz));
  }

  /** 1342:0ed1 */
  translate(dx, dy, dz) {
    this.origin.setPos(f32(this.origin.wx + dx), f32(this.origin.wy + dy), f32(this.origin.wz + dz));
    for (const item of this.items) {
      item.movePos(dx, dy, dz);
    }
    this.pivot.setPos(f32(this.pivot.wx + dx), f32(this.pivot.wy + dy), f32(this.pivot.wz + dz));
    this.setVelocity(dx, dy, dz);
  }

  /** 1342:1004 */
  setPivot(x, y, z) {
    this.pivot.setPos(x, y, z);
  }

  /** 1342:102a */
  pivotToOrigin() {
    this.pivot.setPos(this.origin.wx, this.origin.wy, this.origin.wz);
  }

  /** 1342:1082: origin and pivot to the average of the work coordinates. */
  center() {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const item of this.items) {
      sx = f32(sx + item.wx);
      sy = f32(sy + item.wy);
      sz = f32(sz + item.wz);
    }
    const n = this.items.length;
    sx = f32(sx / n);
    sy = f32(sy / n);
    sz = f32(sz / n);
    this.origin.setPos(sx, sy, sz);
    this.pivot.setPos(sx, sy, sz);
  }

  /** 1342:1184 */
  scaleUniform(s) {
    this.scale(s, s, s);
  }

  /** 1342:11b8: permanent, about the pivot. */
  scale(sx, sy, sz) {
    const p = this.pivot;
    for (const item of this.items) {
      const dx = f32(item.px - p.wx);
      const dy = f32(item.py - p.wy);
      const dz = f32(item.pz - p.wz);
      item.setPos(f32(sx * dx + p.wx), f32(sy * dy + p.wy), f32(sz * dz + p.wz));
    }
    const o = this.origin;
    const dx = f32(o.px - p.wx);
    const dy = f32(o.py - p.wy);
    const dz = f32(o.pz - p.wz);
    o.setPos(f32(sx * dx + p.wx), f32(sy * dy + p.wy), f32(sz * dz + p.wz));
  }

  /** 1342:1377: work only. */
  scaleWork(sx, sy, sz) {
    const p = this.pivot;
    for (const item of this.items) {
      const dx = f32(item.px - p.wx);
      const dy = f32(item.py - p.wy);
      const dz = f32(item.pz - p.wz);
      item.wx = f32(sx * dx + p.wx);
      item.wy = f32(sy * dy + p.wy);
      item.wz = f32(sz * dz + p.wz);
    }
  }

  /** 1342:1466: work = pivot + R(pos - pivot), the per-frame transform. */
  rotateWork(ax, ay, az) {
    const e = this.engine;
    e.setRotation(ax, ay, az);
    const p = this.pivot;
    for (const item of this.items) {
      const w = { x: f32(item.px - p.wx), y: f32(item.py - p.wy), z: f32(item.pz - p.wz) };
      e.rotate(w);
      item.wx = f32(p.wx + w.x);
      item.wy = f32(p.wy + w.y);
      item.wz = f32(p.wz + w.z);
    }
  }

  /** 1342:1566: permanent. */
  rotate(ax, ay, az) {
    this.setAngles(int16(roundS(ax)), int16(roundS(ay)), int16(roundS(az)));
    this.rotateWork(ax, ay, az);
    for (const item of this.items) {
      item.px = item.wx;
      item.py = item.wy;
      item.pz = item.wz;
    }
    this.origin.rotateAround(this.engine, this.pivot.wx, this.pivot.wy, this.pivot.wz, ax, ay, az);
  }

  /** 1342:16da */
  stepTranslate() {
    this.translate(this.velX, this.velY, this.velZ);
  }

  /** 1342:1702 */
  stepRotate() {
    this.rotate(this.angX, this.angY, this.angZ);
  }

  /** 1342:1742 */
  setAngles(a, b, c) {
    this.angX = a;
    this.angY = b;
    this.angZ = c;
  }

  /** 1342:1761 */
  setVelocity(vx, vy, vz) {
    this.velX = f32(vx);
    this.velY = f32(vy);
    this.velZ = f32(vz);
  }

  /** 1342:377c (VMT+0x10) */
  drawAll() {
    for (const item of this.items) {
      item.draw(this.engine);
    }
  }

}

/** TLine (VMT 23ba): two points drawn as a clipped 2D line when both are in front. */
export class Line3d extends Mesh {
  constructor(engine, x1, y1, z1, x2, y2, z2, color) {
    super(engine);
    this.append(new Pixel(x1, y1, z1, 0));
    this.append(new Pixel(x2, y2, z2, 0));
    this.color = color;
    this.screen = [0, 0, 0, 0];
  }

  /** 1342:18e3 */
  setEndpoints(a, b) {
    this.items[0] = a;
    this.items[1] = b;
  }

  /** 1342:193c */
  draw() {
    const e = this.engine;
    const [a, b] = this.items;
    const pa = e.project(a.wx, a.wy, a.wz);
    const pb = e.project(b.wx, b.wy, b.wz);
    const qa = pa ?? { x: a.wx, y: a.wy };
    const qb = pb ?? { x: b.wx, y: b.wy };
    this.screen = [e.screenX(qa.x), e.screenY(qa.y), e.screenX(qb.x), e.screenY(qb.y)];
    if (pa && pb) {
      line(e.m, ...this.screen, this.color);
    }
  }
}

/** TWireMesh (VMT 23ca): lines sharing deduplicated vertices. */
export class WireMesh extends Mesh {
  constructor(engine, color) {
    super(engine);
    this.lines = [];
    this.color = color;
  }

  /** 1342:1b2b */
  addLine(x1, y1, z1, x2, y2, z2) {
    const l = new Line3d(this.engine, 0, 0, 0, 0, 0, 0, this.color);
    const p1 = this.addUnique(new Pixel(x1, y1, z1, this.color));
    const p2 = this.addUnique(new Pixel(x2, y2, z2, this.color));
    l.setEndpoints(p1, p2);
    this.lines.push(l);
    return l;
  }

  /** 1342:1c3f */
  drawLines() {
    for (const l of this.lines) {
      l.draw();
    }
  }
}
