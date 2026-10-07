// 0000:4ebc, 132.70 s: three crystal gems fly in, spin, bounce to the music and deform, each drawn on
// its own page; the pages are averaged. Notes: docs/disassembly/P03_parts_0a69_4ebc.md "Part B".
import { f32, int16 } from '../machine.js';
import { gradient } from '../gfx.js';
import { averagePages } from '../effects.js';
import { PolyObject } from '../engine3d.js';
import { partInit, elapsed, frame, fps } from './common.js';
import { channelVu } from '../vu.js';

const FRAME_SECONDS = fps(70);
const PART_TICKS = 4000;

/** 0e5a:1074: an elongated octagonal crystal, 18 faces, centred on its own centroid. */
function buildGem(engine, flags, minC, maxC) {
  const g = new PolyObject(engine, flags, minC, maxC);
  const P = [[2, 0, 0], [0, 3, 0], [1, 3, 1], [3, 3, 1], [4, 3, 0], [0, 6, 0], [1, 6, 1], [3, 6, 1], [4, 6, 0], [2, 9, 0]];
  const quad = (a, b, c, d) => g.addQuad(P[a], P[b], P[c], P[d]);
  const tri = (a, b, c) => g.addTri(P[a], P[b], P[c]);
  quad(1, 2, 6, 5);
  quad(2, 3, 7, 6);
  quad(3, 4, 8, 7);
  tri(0, 2, 1);
  tri(0, 3, 2);
  tri(0, 4, 3);
  tri(9, 5, 6);
  tri(9, 6, 7);
  tri(9, 7, 8);
  for (let k = 1; k <= 8; k++) {
    P[k] = [P[k][0], P[k][1], -P[k][2]];
  }
  quad(1, 5, 6, 2);
  quad(2, 6, 7, 3);
  quad(3, 7, 8, 4);
  tri(0, 1, 2);
  tri(0, 2, 3);
  tri(0, 3, 4);
  tri(9, 6, 5);
  tri(9, 7, 6);
  tri(9, 8, 7);
  g.scaleUniform(20);
  g.center();
  g.pivotToOrigin();
  g.moveTo(0, 0, 0);
  return g;
}

function gemScale(idx) {
  return f32(1 / ((3 - idx) / 4 + 1) + 0.3);
}

/** The timed deformation windows; the counters are shared by the three gems. */
function deform(V, el, s, c) {
  const move = (v, dx, dy, dz) => V[v].movePos(dx, dy, dz);
  const s2 = f32(2 * s);
  const n2 = f32(-2 * s);
  const ns = f32(-s);
  if (el > 1000 && el < 1320 && c[1] < 110) {
    move(9, 0, s2, 0);
    move(10, 0, n2, 0);
    c[1]++;
  }
  if (el > 1500 && el < 1800 && c[2] < 90) {
    c[2]++;
    for (const v of [2, 3, 5, 6]) {
      move(v, 0, 0, s);
    }
    for (const v of [11, 12, 13, 14]) {
      move(v, 0, 0, ns);
    }
  }
  const squeeze = () => {
    move(1, s, 0, 0);
    move(4, s, 0, 0);
    move(7, ns, 0, 0);
    move(8, ns, 0, 0);
  };
  if (el > 1800 && el < 2000 && c[3] < 50) {
    squeeze();
    c[3]++;
  }
  if (el > 2000 && el < 2200 && c[4] < 60) {
    move(9, 0, n2, 0);
    move(10, 0, s2, 0);
    c[4]++;
  }
  if (el > 2200 && el < 2300 && c[5] < 20) {
    squeeze();
    c[5]++;
  }
  if (el > 2300 && el < 2500 && c[6] < 60) {
    for (const v of [1, 2, 5, 7, 12, 14, 9]) {
      move(v, 0, s, 0);
    }
    for (const v of [4, 3, 6, 8, 11, 13, 10]) {
      move(v, 0, ns, 0);
    }
    c[6]++;
  }
  if (el > 2500 && el < 2800 && c[7] < 80) {
    move(9, 0, s, 0);
    move(10, 0, ns, 0);
    c[7]++;
  }
  if (el > 2800 && el < 3000 && c[8] < 40) {
    move(1, n2, n2, 0);
    move(2, ns, n2, 0);
    move(5, s, n2, 0);
    move(7, s2, n2, 0);
    move(12, ns, n2, 0);
    move(14, s, n2, 0);
    move(9, 0, n2, 0);
    move(4, n2, s2, 0);
    move(3, ns, s2, 0);
    move(6, s, s2, 0);
    move(8, s2, s2, 0);
    move(11, ns, s2, 0);
    move(13, s, s2, 0);
    move(10, 0, s2, 0);
    c[8]++;
  }
}

function flight(gem, el) {
  if (el <= 300) {
    gem[1].moveTo(f32((el * 250) / 300 - 250), f32((el * 100) / 300 - 100), -50);
    gem[2].moveTo(f32(250 - (el * 250) / 300), f32((el * 100) / 300 - 100), -50);
    gem[3].moveTo(0, f32(250 - (el * 250) / 300), -50);
  } else if (el <= 800) {
    const z = f32(((el - 400) * 50) / 400 - 50);
    for (let i = 1; i <= 3; i++) {
      gem[i].moveTo(0, 0, z);
    }
  } else if (el > 3500 && el < 4000) {
    gem[1].moveTo(f32(((3500 - el) * 250) / 500), f32(((3500 - el) * 100) / 500), 0);
    gem[2].moveTo(f32(((el - 3500) * 250) / 500), f32(((3500 - el) * 100) / 500), 0);
    gem[3].moveTo(0, f32(((el - 3500) * 250) / 500), 0);
  }
}

export function* gemsPart(m) {
  const partStart = partInit(m);
  m.setActivePage(1);
  gradient(m, 0, 40, 0, 0, 0, 0, 0, 63);
  gradient(m, 40, 63, 0, 0, 63, 40, 40, 63);
  gradient(m, 63, 80, 40, 40, 63, 63, 63, 63);
  gradient(m, 100, 250, 0, 0, 0, 63, 63, 63);
  m.gradStep = 0xffec;
  const gem = [];
  const verts = [];
  for (let k = 0; k <= 2; k++) {
    const g = buildGem(m.engine, 0x0a, 30, 63);
    gem[3 - k] = g;
    g.scaleUniform(f32(1 / (k / 4 + 1) + 0.3));
    verts[3 - k] = [null, ...g.items];
  }
  m.setActivePage(2);
  m.setActivePage(3);
  m.setActivePage(1);
  let pulse = channelVu(m, 5);
  let cur = pulse;
  let prev = -10;
  let changed = 0;
  const counters = new Array(9).fill(0);
  let el;
  do {
    el = elapsed(m, partStart);
    cur = channelVu(m, 5) - 18;
    if (prev !== cur) {
      changed++;
    }
    if (changed > 0) {
      changed = 0;
      if (pulse < cur) {
        pulse = cur;
      }
    }
    prev = cur;
    if (pulse > 0) {
      pulse--;
    }
    m.fillActive(0);
    flight(gem, el);
    for (let idx = 1; idx <= 3; idx++) {
      deform(verts[idx], el, gemScale(idx), counters);
      m.setActivePage(idx);
      m.fillActive(0);
      gem[idx].translate(0, int16(9 - 2 * pulse), 0);
      gem[idx].rotateWork(f32((el * 360) / 800), f32((el * 360) / 600), f32((el * 360) / 500));
      gem[idx].draw();
      gem[idx].translate(0, int16(2 * pulse - 9), 0);
    }
    averagePages(m, 2, 1);
    averagePages(m, 3, 2);
    m.setActivePage(3);
    m.present();
    yield* frame(m, FRAME_SECONDS);
  } while (el < PART_TICKS);
  m.freePage(3);
  m.freePage(2);
  m.freePage(1);
  m.gradStep = 1;
}
