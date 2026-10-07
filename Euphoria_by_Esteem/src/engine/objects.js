// The 3D unit (segment 1342), part 3: polygon objects, groups, stars, explosions, lights. Notes: docs/disassembly/L4_3d_b.md.
import { f32, int16 } from '../machine.js';
import { putPixel, line, drawDot } from '../gfx.js';
import { buildLitTable } from '../raster.js';
import { Pixel, BigPixel, Mesh, roundS, SHADE_ANGLE, SHADE_GOURAUD, MESH_NO_DEDUP, MESH_NO_SORT, MESH_FLIP_WINDING } from './points.js';
import { Face, edgeBetween, planeNormal } from './face.js';

export class PolyObject extends Mesh {
  constructor(engine, flags, minColor, maxColor) {
    super(engine);
    this.faces = [];
    this.texA = null;
    this.texB = null;
    this.minColor = minColor;
    this.maxColor = maxColor;
    this.nextColor = minColor;
    this.colorStep = 1;
    this.phong = [0, 0, 0, 0];
    this.flags = flags;
  }

  /** 1342:2a90 */
  setTextures(texA, texB) {
    this.texA = texA;
    this.texB = texB;
    for (const face of this.faces) {
      face.setExtra(texA, texB);
    }
  }

  /** 1342:2bff */
  setColorStep(step) {
    this.colorStep = step;
  }

  /** 1342:2c32 */
  setPhong(a, b, c, e) {
    this.phong = [f32(a), f32(b), f32(c), f32(e)];
  }

  /** 1342:2c6c */
  addFace(face) {
    for (let i = 0; i < face.items.length; i++) {
      const kept = this.flags & MESH_NO_DEDUP ? (this.append(face.items[i]), face.items[i]) : this.addUnique(face.items[i]);
      face.items[i] = kept;
      face.v[i + 1] = kept;
    }
    if (face.items.length === 3) {
      face.v[4] = face.v[3];
    }
    this.faces.push(face);
    face.color = this.nextColor;
    this.nextColor = (this.nextColor + this.colorStep) & 0xff;
  }

  newFace() {
    return new Face(this.engine, this.flags & 0xff, this.minColor, this.maxColor, 0);
  }

  /** 1342:2d43: the segment (p1,p2)-(p3,p4) in the plane across `axis`, extruded from p5 to p6. */
  addWall(axis, p1, p2, p3, p4, p5, p6) {
    let corners;
    if (axis === 'Z' || axis === 'z') {
      corners = [[p1, p2, p5], [p3, p4, p5], [p3, p4, p6], [p1, p2, p6]];
    } else if (axis === 'Y' || axis === 'y') {
      corners = [[p1, p5, p2], [p3, p5, p4], [p3, p6, p4], [p1, p6, p2]];
    } else {
      corners = [[p5, p1, p2], [p6, p1, p2], [p6, p3, p4], [p5, p3, p4]];
    }
    const [v1, v2, v3, v4] = corners.map(([x, y, z]) => new Pixel(x, y, z, 0));
    return this.addQuadV(v1, v2, v3, v4);
  }

  /** 1342:2fa7 */
  addQuadV(v1, v2, v3, v4) {
    const face = this.newFace();
    face.setVertices(v1, v2, v3, v4);
    this.addFace(face);
    return face;
  }

  /** 1342:3018, vectors as [x, y, z]. */
  addQuad(a, b, c, d) {
    return this.addQuadV(...[a, b, c, d].map(([x, y, z]) => new Pixel(x, y, z, 0)));
  }

  /** 1342:3129 */
  addTri(a, b, c) {
    const [pa, pb, pc] = [a, b, c].map(([x, y, z]) => new Pixel(x, y, z, 0));
    return this.addQuadV(pa, pb, pc, pc);
  }

  /** 1342:320e: the original's quicksort, ascending depth (farthest first). */
  sortFaces(lo, hi) {
    const F = this.faces;
    let i = lo;
    let j = hi;
    const pivot = F[(lo + hi) >>> 1].depth;
    do {
      while (F[i].depth < pivot) {
        i++;
      }
      while (pivot < F[j].depth) {
        j--;
      }
      if (i <= j) {
        if (i !== j && F[i].depth !== F[j].depth) {
          [F[i], F[j]] = [F[j], F[i]];
        }
        i++;
        j--;
      }
    } while (i <= j);
    if (lo < j) {
      this.sortFaces(lo, j);
    }
    if (i < hi) {
      this.sortFaces(i, hi);
    }
  }

  /** 1342:3377: area-weighted vertex normals, then the lighting table from this object's parameters. */
  calcVertexNormals() {
    for (const v of this.items) {
      v.vx = 0;
      v.vy = 0;
      v.vz = 0;
    }
    for (const f of this.faces) {
      const N = f.v[1] !== f.v[2] ? planeNormal(f.v[1], f.v[2], f.v[3]) : planeNormal(f.v[2], f.v[3], f.v[4]);
      for (const v of f.items) {
        v.vx = f32(v.vx + N.x);
        v.vy = f32(v.vy + N.y);
        v.vz = f32(v.vz + N.z);
      }
    }
    buildLitTable(this.engine.m, ...this.phong);
  }

  /** 1342:3518 */
  draw() {
    const e = this.engine;
    if (!(this.flags & MESH_NO_SORT) && !e.noSort && this.faces.length > 0) {
      for (const f of this.faces) {
        f.computeDepth();
      }
      this.sortFaces(0, this.faces.length - 1);
    }
    e.isWindingFlipped = (this.flags & MESH_FLIP_WINDING) !== 0;
    if ((this.flags & 0x18) === SHADE_ANGLE) {
      this.calcVertexNormals();
    } else if ((this.flags & 0x18) === SHADE_GOURAUD) {
      for (const v of this.items) {
        v.color = 0;
      }
    }
    for (const f of this.faces) {
      f.draw();
    }
  }
}

/** TGroup (VMT 23fa): faces of several objects sorted together. */
export class Group extends PolyObject {
  constructor(engine) {
    super(engine, MESH_NO_DEDUP, 0, 0);
    this.members = [];
  }

  /** 1342:36ba */
  addMesh(mesh) {
    for (const f of mesh.faces) {
      this.faces.push(f);
      f.flags = (f.flags | this.flags) & 0xff;
    }
    for (const v of mesh.items) {
      this.append(v);
    }
    this.members.push(mesh);
  }
}

// ---- stars and explosions ----

/** TStar (VMT 240a) */
export class Star extends Pixel {
  /** 1342:3846 */
  draw(engine) {
    const m = engine.m;
    if (int16(this.color) <= 0) {
      return;
    }
    let b = int16(Math.trunc(roundS(this.wz) / 2) + 255);
    const clampB = (v) => Math.min(Math.max(v, engine.starMin), engine.starMax);
    if (engine.starMode === 0 || engine.starMode === 1) {
      const p = engine.project(this.wx, this.wy, this.wz);
      if (!p) {
        return;
      }
      b = clampB(b);
      this.sx = engine.screenX(p.x);
      this.sy = engine.screenY(p.y);
      putPixel(m, this.sx, this.sy, b & 0xff);
      if (engine.starMode === 1 && this.wz > -200) {
        const b2 = Math.max(Math.trunc(b / 2), engine.starMin) & 0xff;
        putPixel(m, this.sx - 1, this.sy, b2);
        putPixel(m, this.sx + 1, this.sy, b2);
        putPixel(m, this.sx, this.sy - 1, b2);
        putPixel(m, this.sx, this.sy + 1, b2);
      }
      return;
    }
    b = clampB(b);
    const t = int16(m.gradStep - 500);
    const zz = t < this.wz ? f32(this.wz - m.gradStep) : -500;
    const tail = engine.project(this.wx, this.wy, int16(roundS(zz))) ?? { x: this.wx, y: this.wy };
    const x0 = engine.screenX(tail.x);
    const y0 = engine.screenY(tail.y);
    const head = engine.project(this.wx, this.wy, int16(roundS(this.wz))) ?? { x: this.wx, y: this.wy };
    this.sx = engine.screenX(head.x);
    this.sy = engine.screenY(head.y);
    line(m, this.sx, this.sy, x0, y0, b & 0xff);
  }
}

const STAR_KEEP_SPEED = 0x7ff8;

/** TStarfield (VMT 241a) */
export class Starfield extends Mesh {
  /** 1342:3bc4 */
  constructor(engine, count, minBright, maxBright) {
    super(engine);
    const m = engine.m;
    engine.starMin = minBright;
    engine.starMax = maxBright;
    this.speed = 0;
    for (let i = 0; i < count; i++) {
      const rx = m.random(500);
      const ry = m.random(500);
      const rz = m.random(500);
      this.append(new Star(f32(rx - 250), f32(ry - 250), -rz, 255));
    }
  }

  /** 1342:3ce1 */
  move(speed) {
    const e = this.engine;
    const m = e.m;
    if (speed < STAR_KEEP_SPEED) {
      this.speed = speed;
    }
    for (const s of this.items) {
      s.movePos(0, 0, this.speed);
      if (this.speed > 0) {
        const isOnScreen = s.sx >= 0 && s.sx <= 320 && s.sy >= 0 && s.sy <= 200 && !(e.perspective < s.wz);
        if (!isOnScreen) {
          if (speed < STAR_KEEP_SPEED) {
            const x = f32(m.random(500) - 250);
            s.setPos(x, f32(m.random(500) - 250), -500);
          } else {
            s.setPos(-100, -100, 0);
            s.color = 0;
          }
        }
      } else if (s.wz < -500) {
        const x = f32(m.random(500) - 250);
        s.setPos(x, f32(m.random(500) - 250), 100);
      }
    }
  }
}

/** TExplosion (VMT 2436) */
export class Explosion extends Mesh {
  /** 1342:3ec7 */
  constructor(engine, count) {
    super(engine);
    const m = engine.m;
    this.frame = 0;
    for (let i = 0; i < count; i++) {
      const x = f32((m.random(200) - 100) / 40);
      const y = f32((m.random(200) - 100) / 40);
      const z = f32((m.random(200) - 100) / 40);
      const p = m.random(30) === 0 ? new BigPixel(x, y, z, 252) : new Pixel(x, y, z, 252);
      const vx = f32((m.random(20000) - 10000) / 2000);
      const vy = f32((m.random(20000) - 10000) / 2000);
      const vz = f32((m.random(20000) - 10000) / 2000);
      p.setVelocity(vx, vy, vz);
      this.append(p);
    }
  }

  /** 1342:4080 */
  step() {
    this.frame = (this.frame + 1) & 0xffff;
    for (const p of this.items) {
      p.step();
    }
  }

  /** 1342:40c4 */
  drawAll() {
    if (this.frame < 50) {
      super.drawAll();
      return;
    }
    for (const p of this.items) {
      if (int16(p.color) > 100) {
        p.color -= 5;
        p.draw(this.engine);
      }
    }
  }
}

// ---- lights ----

/** TLightDir (VMT 2452): the static light direction at DS:55f6. */
export class LightDir extends Mesh {
  constructor(engine, x1, y1, z1, x2, y2, z2) {
    super(engine);
    this.a = new Pixel(x1, y1, z1, 0);
    this.b = new Pixel(x2, y2, z2, 0);
    this.append(this.a);
    this.append(this.b);
    this.vector = { x: 0, y: 0, z: 0 };
    this.edge = null;
    this.update(0, 0, 0);
  }

  /** 1342:421b */
  update(ax, ay, az) {
    this.rotateWork(ax, ay, az);
    const { a, b } = this;
    this.vector = {
      x: roundS(f32((b.wx - a.wx) * 1024)) | 0,
      y: roundS(f32((b.wy - a.wy) * 1024)) | 0,
      z: roundS(f32((b.wz - a.wz) * 1024)) | 0,
    };
    this.edge = edgeBetween(a, b);
  }
}

/** TLight (VMT 2462): a point light for gouraud shading. */
export class Light extends Pixel {
  constructor(engine, x, y, z, radius, color) {
    super(x, y, z, color);
    this.setRadius(radius);
  }

  /** 1342:4352 */
  setRadius(r) {
    this.radius = f32(r);
    this.falloff = f32(r * 20000);
  }

  /** 1342:4378: the projection result is ignored. */
  draw(engine) {
    const p = engine.project(this.wx, this.wy, this.wz) ?? { x: this.wx, y: this.wy };
    this.sx = engine.screenX(p.x);
    this.sy = engine.screenY(p.y);
    drawDot(engine.m, this.sx, this.sy, this.color & 0xff);
  }
}
