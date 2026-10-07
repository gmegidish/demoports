// The 3D unit (segment 1342), part 2: faces, their shading and filling. Notes: docs/disassembly/L3_3d_a.md, L4_3d_b.md.
import { f32, int16 } from '../machine.js';
import { darkenActivePage } from '../gfx.js';
import { flatPoly, gouraudPoly, phongPoly, textureQuad, gradientSpan, additiveSpan, solidSpan } from '../raster.js';
import { Mesh, roundS, FILL_FLAT, FILL_RANGE, FILL_GRADIENT, FILL_TEXTURE, FILL_ADDITIVE, SHADE_FLAT, SHADE_GOURAUD, SHADE_ANGLE, FACE_DOUBLE_SIDED, FACE_ALWAYS_DRAW } from './points.js';

export class Face extends Mesh {
  constructor(engine, flags, minColor, maxColor, color) {
    super(engine);
    this.v = [null, null, null, null, null];
    this.depth = 0;
    this.isDepthLocked = false;
    this.texA = null;
    this.texB = null;
    this.side = 0;
    this.color = color;
    this.minColor = minColor;
    this.maxColor = maxColor;
    this.flags = flags;
  }

  /** 1342:1cd4 */
  setVertices(v1, v2, v3, v4) {
    this.v = [null, v1, v2, v3, v4];
    this.items = v3 === v4 ? [v1, v2, v3] : [v1, v2, v3, v4];
  }

  /** 1342:1d6d */
  setExtra(texA, texB) {
    this.texA = texA;
    this.texB = texB;
  }

  /** 1342:1d97: the sum of 4 work z values (triangles count v3 twice). */
  computeDepth() {
    if (this.isDepthLocked) {
      return;
    }
    let depth = 0;
    for (let i = 1; i <= this.count; i++) {
      depth = f32(depth + this.v[i].wz);
    }
    if (this.count < 4) {
      depth = f32(depth + this.v[3].wz);
    }
    this.depth = depth;
  }

  /** 1342:1e1a: flat shading from an integer normal and the light vector (DS:5657). */
  shadeFlat() {
    const { v } = this;
    const L = this.engine.lightDir.vector;
    const u = [f32(v[2].wx - v[1].wx), f32(v[2].wy - v[1].wy), f32(v[2].wz - v[1].wz)];
    const w = [f32(v[3].wx - v[1].wx), f32(v[3].wy - v[1].wy), f32(v[3].wz - v[1].wz)];
    const nx = roundS(f32(u[1] * w[2] - u[2] * w[1])) | 0;
    const ny = roundS(f32(u[2] * w[0] - u[0] * w[2])) | 0;
    const nz = roundS(f32(u[0] * w[1] - u[1] * w[0])) | 0;
    const dot = Math.trunc(((Math.imul(nz, L.z) + Math.imul(ny, L.y) + Math.imul(nx, L.x)) | 0) / 1024);
    const len2 = (Math.imul(nx, nx) + Math.imul(ny, ny) + Math.imul(nz, nz)) | 0;
    const len = roundS(f32(Math.sqrt(len2)));
    if (len !== 0 && !Number.isNaN(len)) {
      let c = int16(Math.trunc(Math.imul(Math.abs(int16(this.maxColor - this.minColor)), dot) / len));
      if (c < 0) {
        c = -c;
      }
      c += this.minColor;
      if (this.maxColor < c) {
        c = this.maxColor;
      }
      this.color = c;
    } else {
      this.color = this.minColor;
    }
  }

  /** 1342:209b: gouraud from the point lights minColor..maxColor, cached per vertex per frame. */
  shadeGouraud() {
    const e = this.engine;
    const count = e.lightCount;
    if (count === 0 || this.minColor > count || this.maxColor > count) {
      return;
    }
    for (let i = 1; i <= this.count; i++) {
      const vert = this.v[i];
      if (vert.color === 0) {
        let sum = 0;
        for (let j = this.minColor; j <= this.maxColor; j++) {
          const L = e.lights[j];
          const dx = f32(L.wx - vert.wx);
          const dy = f32(L.wy - vert.wy);
          const dz = f32(L.wz - vert.wz);
          const d2 = f32(dx * dx + dy * dy + dz * dz);
          const t = f32(255 - (d2 * d2) / (L.falloff + 1));
          if (t > 0) {
            sum = f32(sum + t);
          }
        }
        vert.color = int16(roundS(sum));
      }
      e.pts[i].c = vert.color;
    }
  }

  /** 1342:2275: the angle (degrees, 0..90) between the vertex normal and the light. */
  shadeAngle() {
    const e = this.engine;
    for (let i = 1; i <= this.count; i++) {
      const vert = this.v[i];
      const normal = { x: vert.vx, y: vert.vy, z: vert.vz };
      let c;
      if (e.lightCount > 0) {
        c = Math.abs(cosAngle(edgeBetween(e.lights[1], vert).dir, normal));
      } else {
        c = cosAngle(e.lightDir.edge.dir, normal);
      }
      if (this.flags & FACE_DOUBLE_SIDED) {
        c = Math.abs(c);
      } else if (c < 0) {
        c = 0;
      }
      if (c === 1) {
        c = f32(c - 1e-7);
      }
      const angle = 90 - (Math.atan(c / Math.sqrt(1 - c * c)) * 57.29577951308232);
      e.pts[i].c = int16(roundS(f32(angle)));
    }
  }

  /** 1342:23b0: also picks the side (texA/texB) of a double-sided textured face. */
  isFrontFacing() {
    const e = this.engine;
    const P = e.pts;
    this.side = 0;
    const cross = (a, b, c) => {
      const A = Math.imul(int16(P[c].y - P[b].y), int16(P[a].x - P[b].x));
      const B = Math.imul(int16(P[c].x - P[b].x), int16(P[a].y - P[b].y));
      return (A - B) | 0;
    };
    if (!(this.flags & FACE_DOUBLE_SIDED)) {
      const d = P[1].x === P[2].x && P[1].y === P[2].y ? cross(2, 3, 4) : cross(1, 2, 3);
      return d < 0 ? !e.isWindingFlipped : e.isWindingFlipped;
    }
    if ((this.flags & 7) === FILL_TEXTURE && this.texA !== this.texB) {
      this.side = cross(1, 2, 3) < 0 ? 0 : 1;
    }
    return true;
  }

  /** 1342:251d */
  draw() {
    const e = this.engine;
    const m = e.m;
    const P = e.pts;
    if (this.isDepthLocked) {
      this.isDepthLocked = false;
      return;
    }
    let isAnyInside = false;
    for (let i = 1; i <= this.count; i++) {
      const vert = this.v[i];
      const p = e.project(vert.wx, vert.wy, vert.wz);
      if (!p) {
        return;
      }
      P[i].x = e.screenX(p.x);
      P[i].y = e.screenY(p.y);
      P[i].c = 0;
      const c = m.clip;
      if (P[i].x >= c.left && P[i].x <= c.right && P[i].y >= c.top && P[i].y <= c.bottom) {
        isAnyInside = true;
      }
    }
    if ((isAnyInside || this.flags & FACE_ALWAYS_DRAW) && this.isFrontFacing()) {
      this.fill();
    }
    this.isDepthLocked = false;
  }

  fill() {
    const e = this.engine;
    const m = e.m;
    const P = e.pts;
    const n = this.count;
    e.faceColor = this.color & 0xff;
    if (n === 3) {
      P[4].x = P[3].x;
      P[4].y = P[3].y;
      P[4].c = P[3].c;
    }
    const mode = this.flags & 0x18;
    const type = this.flags & 7;
    if (mode === SHADE_FLAT) {
      this.shadeFlat();
      if (type === FILL_TEXTURE) {
        const saved = m.activePageNumber;
        m.copyPage(3, 2);
        m.setActivePage(2);
        darkenActivePage(m, (255 - this.color) & 0xff);
        m.setActivePage(saved);
      }
    }
    if (mode === SHADE_GOURAUD) {
      this.shadeGouraud();
      gouraudPoly(m, P, n, 0);
      return;
    }
    if (mode === SHADE_ANGLE) {
      this.shadeAngle();
      if (type === FILL_TEXTURE) {
        textureQuad(m, P, this.side === 0 ? this.texA : this.texB, { isMirrored: this.side !== 0, isLit: true });
      } else {
        phongPoly(m, P, n);
      }
      return;
    }
    const c = this.color & 0xff;
    switch (type) {
      case FILL_FLAT:
        flatPoly(m, P, n, 0, 0, c, e.spanHook);
        break;
      case FILL_RANGE:
        flatPoly(m, P, n, this.minColor, this.maxColor, c, e.spanHook);
        break;
      case FILL_GRADIENT:
        flatPoly(m, P, n, this.minColor, this.maxColor, c, gradientSpan);
        e.spanHook = solidSpan;
        break;
      case FILL_ADDITIVE:
        flatPoly(m, P, n, 0, 0, c, additiveSpan);
        e.spanHook = solidSpan;
        break;
      case FILL_TEXTURE:
        textureQuad(m, P, this.side === 0 ? this.texA : this.texB, { isMirrored: this.side !== 0 });
        break;
      default:
        break;
    }
  }
}

/** 1342:080e: the work-coordinate segment ordered by x; only `dir` is used afterwards. */
export function edgeBetween(p1, p2) {
  const [A, B] = p2.wx > p1.wx ? [p1, p2] : [p2, p1];
  return { dir: { x: f32(B.wx - A.wx), y: f32(B.wy - A.wy), z: f32(B.wz - A.wz) } };
}

/** 1342:0a3a: cos of the angle between a direction and a normal; no zero check. */
function cosAngle(dir, n) {
  const dot = f32(n.x * dir.x + n.y * dir.y + n.z * dir.z);
  const ln = f32(Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z));
  const le = f32(Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z));
  return f32(dot / (ln * le));
}

/** 1342:08fe: N = (p1 - p0) x (p2 - p0), work coordinates. */
export function planeNormal(p0, p1, p2) {
  const U = [f32(p1.wx - p0.wx), f32(p1.wy - p0.wy), f32(p1.wz - p0.wz)];
  const V = [f32(p2.wx - p0.wx), f32(p2.wy - p0.wy), f32(p2.wz - p0.wz)];
  return {
    x: f32(U[1] * V[2] - U[2] * V[1]),
    y: f32(U[2] * V[0] - U[0] * V[2]),
    z: f32(U[0] * V[1] - U[1] * V[0]),
  };
}
