# C3 - effects A: 0x52343, 0x52441, 0x52577, 0x5264a (demo start, ticks 0..1458, about 0..48.6 s)

All addresses are code32 offsets. "tick" = timer counter [0x1b707] (30 Hz, see C1). Byte arithmetic wraps
mod 256 unless stated; "SF" = sign flag of an 8-bit result (bit 7), which the code uses as "negative".

## Summary

The first part of the demo is one shared background, the **red starburst**, drawn into a feedback buffer
(fade the buffer through a 256-byte decay table, then add a value computed from three precomputed 320x200
planes in DEMO.AVI and a 64 KB "plasma" table), converted to colours 0xC0..0xFF.

| ticks (scene fn, runs in the timer ISR each tick) | per-frame effect | what is seen |
|---|---|---|
| 0..246 (0x522f9) | 0x52343 | starburst alone, palette fades in from black |
| 247..445 (0x523f2) / 446..543 (0x5247a) / 544..638 (0x524b2) / 639..736 (0x524ea) | 0x52441 | starburst + text "coma" / "virne" / "groo" / "apatia" at (5,5) |
| 737..1048 (0x52522) | 0x52577 | starburst + env-mapped 3D **spiky star** (object at 0x4aed9) |
| 1049..1458 (0x525f2) | 0x5264a | starburst + env-mapped 3D **plant** (object at 0x40651) |

Not in this slice (other effects, but they reuse everything here): 0x526f0 (ticks 1459..1922, the red **crab**,
object 0x43bf9 via 0x51a38, same 3D engine), 0x5277b ("order ?"), 0x5282e ("NO order!"), 0x528b2. 0x51ace
(object 0x500d1, called from 0x55c2a later in the demo) switches the 3D engine to its second shading mode.

Recording check: time in the recording ~= tick/30 s for this part ("coma" first visible at 8.3 s, tick 247 =
8.23 s; it is gone at 24.6 s, tick 737 = 24.57 s). I re-implemented the 3D engine below in Python and rendered
the star at ticks 780/840/900 and the plant at ticks 1100/1250/1400; position, orientation, size, face order
and env-map colours match the recorded frames at tick/30 s by eye. A numpy re-implementation of the starburst
(ticks 150 and 240) also matches (see "Frame rate").

### Routines called (all documented below unless marked)

- scene fns (ISR, per tick): 0x522f9, 0x523f2, 0x5247a, 0x524b2, 0x524ea, 0x52522, 0x525f2; 0x5238e (palette 0xC0..0xFF)
- background: 0x522b5 (build 64K table), 0x5224c (add starburst), 0x1c2a7 / 0x1c2c2 (decay A / B, C2 library),
  0x523b2 (A->B convert), 0x523d2 (B->A convert)
- output: 0x52918 (A -> VGA), 0x5293b (B -> VGA), inline copy in 0x52343
- text: 0x1bab5 (C2 text renderer; interface summarised here)
- 3D: 0x53929 (texture palette), 0x5198e / 0x518e4 (object setup), 0x51c2f (transform), 0x2d540 / 0x2d464 /
  0x2d4d1 (rotate Z / X / Y), 0x2d5ad (project), 0x402d6 (cull, sort, draw), 0x2d61b (env-map uv),
  0x2dc83 (textured triangle filler)

## Buffers and globals

| addr | name | init | notes |
|---|---|---|---|
| [0x5606e] = 0x561b8 | bufA | BSS | 320x200 bytes, stride 320. Static. Triangle filler always draws here |
| [0x56072] = 0x65bb8 | bufB | BSS | bufA + 0xfa00, 320x200 |
| [0x1b256] | vga | | 0xa0000 - [0x18] (A000:0000) |
| [0x1b25a] | plasmaTab | alloc 0x10000 | 256x256 bytes, built by 0x522b5 |
| [0x1b184] | planes | DEMO.AVI + 0x79f1d | three raw 320x200 byte planes P0, P1, P2 (P1 at +0xfa00, P2 at +0x1f400). (DEMO.AVI is loaded whole; 0x1b170[i] = load address + offset; this is index 5) |
| [0x1b194] | texImg | DEMO.AVI + 0x140dd9 | RIX3 image ("RIX3", w=256, h=256, type 0xaf 0x00), then 768-byte 6-bit palette, then 65536 pixels (values 0..191). Index 9 |
| 0x1b3bd | rowAddr[200] | built in 0x1b27d | rowAddr[y] = bufA + 320*y |
| 0x1c1a7 | decayTab[256] | file | see Tables |
| 0x2ca18 / 0x2ce18 | SIN[256] / COS[256] | file | signed dwords, see Tables (COS directly follows SIN) |
| 0x2d218 / 0x2d318 | WAVE_S[256] / WAVE_C[256] | file | bytes, see Tables |
| 0x52189 | burstPal[192] | file | 64 RGB triples, 6-bit, for colours 0xC0..0xFF |
| 0x52185 | effectPtr | 0x52343 | current per-frame effect (main loop calls it) |
| 0x5224a | scrollA | 0 | byte, integer part; fraction byte 0x522f7 (0) |
| 0x5224b | scrollB | 0 | byte |
| 0x56077 | pulse | 0 | byte, integer part; fraction byte 0x522f8 (0) |
| 0x52249 | pulseVal | 0 | byte, WAVE_S[pulse] >> 1, recomputed each 0x5224c call |
| 0x522f5 | palFade | 0x40 | byte; fraction byte 0x522f6 (0) |
| 0x522f4 / 0x52576 / 0x52649 | init-once flags of 0x52343 / 0x52577 / 0x5264a | 0 | |
| 0x2d458 / 0x2d45c / 0x2d460 | angX / angY / angZ | 0 | dwords, used as table index 0..255 (scenes modify them with byte adds or dword stores, so the upper bytes stay 0) |
| 0x2d448 / 0x2d44c | offX / offY | 0 | signed dwords, screen offset added after projection |
| 0x2d450 | dist | 0 | signed dword, added to rotated z |
| 0x2d708 | texPtr | 0 | -> 256x256 texture pixels |
| 0x2d619 / 0x2d61a | envU0 / envV0 | 0 | bytes, texture quadrant offsets |
| 0x2e95d | envDist | 1000 | set to 20000 by every object setup |
| 0x2e965 | shadeMode | 0 | set to 1 only by 0x51ace (later in the demo), never reset |
| 0x2d6d9 | spanMode | 0 | never written -> always the opaque span path |
| 0x2d6da | orMask | 0 | written only in shadeMode 1; 0 for all effects in this slice |

## Per-tick scene functions (called from the timer ISR, so they are tick-driven)

Common part, `bgTick()`, present in every scene fn from 0x522f9 to 0x527de:

```
bgTick():
  t = 0x522f7 + 0xbe;  0x522f7 = t & 255;  scrollA = (scrollA + (t >> 8)) & 255   // add / adc
  scrollB = (scrollB + 1) & 255
  t = 0x522f8 + 0x64;  0x522f8 = t & 255;  pulse = (pulse + (t >> 8)) & 255
```
Since every scene from tick 0 to tick 2619 calls it once, after the call at tick T (n = T+1):
`scrollA = (n*0xbe >> 8) & 255, scrollB = n & 255, pulse = (n*0x64 >> 8) & 255`.

```
0x522f9 (ticks 0..246):
  effectPtr = 0x52343
  bgTick()
  t = 0x522f6 + 0x3c; 0x522f6 = t & 255
  palFade = palFade - (t >> 8)              // sbb byte
  if (palFade & 0x80) palFade = 0           // jns
  setBurstPalette()                         // 0x5238e, every tick
```
palFade after the call at tick T: max(0, 64 - ((T+1)*60 >> 8)); it is 7 after tick 246 and stays 7 (nobody else
writes it; the palette is not rewritten afterwards in this slice).

```
0x523f2: effectPtr = 0x52441; textPtr[0x1baa7] = "coma"  (0x5242a); bgTick()     // ticks 247..445
0x5247a: textPtr = "virne" (0x5242f); effectPtr = 0x52441; bgTick()               // ticks 446..543
0x524b2: textPtr = "groo"  (0x52435); effectPtr = 0x52441; bgTick()               // ticks 544..638
0x524ea: textPtr = "apatia"(0x5243a); effectPtr = 0x52441; bgTick()               // ticks 639..736

0x52522 (ticks 737..1048):
  effectPtr = 0x52577
  angY = (angY + 2) & 255     // byte adds on the low byte
  angZ = (angZ + 1) & 255
  angX = (angX + 0xff) & 255  // i.e. -1
  offX += 2                   // dword
  dist += 0x96                // dword (+150)
  bgTick()

0x525f2 (ticks 1049..1458):
  effectPtr = 0x5264a
  angX = 0x3a; angZ = 0x0c    // dword stores
  angY = (angY + 2) & 255
  dist += 0x3c                // +60
  offX += -1
  bgTick()
```

Closed forms (verified against the recording):
- star (0x52577): with n = T - 736 (calls so far) and m = T - 737 (ticks since the init frame):
  angX = (-n) & 255, angY = 2n & 255, angZ = n & 255, offX = -340 + 2m, offY = 0, dist = 14000 + 150m.
  (The init frame of 0x52577 overwrites offX/offY/dist, so the adds made before it are lost; in practice the
  first frame runs right after tick 737.)
- plant (0x5264a): angX = 0x3a, angZ = 0x0c, angY = (2*(T - 736)) & 255 (continues from the star scene;
  angY = 112 when tick 1049 starts), m = T - 1049: offX = 200 - m, offY = -20, dist = 9600 + 60m.

```
0x5238e setBurstPalette():
  out(0x3c8, 0xc0)
  for i in 0..191: v = burstPal[i] - palFade; if (v & 0x80) v = 0; out(0x3c9, v)   // colours 0xC0..0xFF
```

## The starburst background

### 0x522b5 buildPlasmaTab() (once, on the first frame of 0x52343)
```
byte 0x522b3 = 0                       // unused here
for idx in 0..65535:                   // bx; x = idx & 255 (bl), y = idx >> 8 (bh)
  a = WAVE_S[((2*x) & 255) ^ y]
  a = (a + WAVE_C[((2*y) & 255) ^ x]) & 255
  a = (a >> 1) - 0x60                  // 8-bit sub; SF -> 0
  plasmaTab[idx] = a < 0 ? 0 : a       // 0..31
```

### 0x5224c addStarburst(edi = dst, ebp = plasmaTab)
```
pulseVal = WAVE_S[pulse] >> 1
for k in 0..63999:                     // dst walks forward, the source walks BACKWARDS:
  p = 63999 - k                        // the planes are shown rotated 180 degrees
  a  = P0[p]
  lo = (a + scrollA) & 255;  hi = (a + scrollB) & 255
  t  = plasmaTab[hi*256 + lo]
  h  = (P2[p] - P1[p] + pulseVal) & 255
  r  = (t - h) & 255;  if (r & 0x80) r = 0          // jns: sign of the 8-bit result, not borrow
  dst[k] = min(255, dst[k] + r)                     // add, on carry 0xff
```
(GUESS from the data: P0 is an angle-like image around the centre, P1 rises towards the centre, P2 falls with
the radius; the porter just uses the raw planes.)

### Decay: 0x1c2a7 (bufA) / 0x1c2c2 (bufB) - C2 library
`for i in 0..63999: buf[i] = decayTab[buf[i]]` (all 64000 bytes).

### Conversions / copies
```
0x523b2: for i in 0..63999: bufB[i] = (bufA[i] >> 2) + 0xc0
0x523d2: for i in 0..63999: bufA[i] = (bufB[i] >> 2) + 0xc0
0x52918: copy bufA[0..0xf8c0) to VGA (dwords; 199 rows; row 199 of the screen is untouched - main filled it with 0xc0)
0x5293b: copy bufB[0..0xf8c0) to VGA
```

## Per-frame effects

```
0x52343 (starburst only):
  if (!flag522f4) { buildPlasmaTab(); flag522f4 = 1 }
  decay(bufA)                                    // 0x1c2a7
  addStarburst(bufA, plasmaTab)                  // 0x5224c
  for i in 0..0xf8bf: vga[i] = (bufA[i] >> 2) + 0xc0

0x52441 (starburst + name):
  decay(bufA); addStarburst(bufA, plasmaTab)
  bufB = convert(bufA)                           // 0x523b2, all 64000
  colourBase[0x1b882] = 0x80
  drawText(bufB + 0x645, textPtr)                // 0x1bab5: x = 5, y = 5
  copy bufB -> VGA                               // 0x5293b
```
bufA keeps the feedback without the text. drawText (C2): for each glyph pixel v != 0 writes
`((v << 2) + [0x1b882]) & 255`, so the text uses colours 0x80..0xBF, which main set to a grey ramp
(colour 0x80+i = (i,i,i)).

```
0x52577 (starburst + star object):
  if (!flag52576) {
    texPtr = texImg + 0x30a                      // skip 10-byte RIX header + 768-byte palette
    loadTexPalette()                             // 0x53929
    offY = 0; offX = -340 (0xfffffeac); dist = 14000 (0x36b0)
    copy bufA[0..0xf8c0) -> bufB (raw bytes, 0x3e30 dwords)  // the feedback moves to bufB
    flag52576 = 1
  }
  decay(bufB)                                    // 0x1c2c2
  addStarburst(bufB, plasmaTab)
  bufA = convert(bufB)                           // 0x523d2: background in colours 0xC0..0xFF
  drawObject_5198e()                             // into bufA, colours 0..191
  copy bufA -> VGA                               // 0x52918

0x5264a (starburst + plant):
  if (!flag52649) { offY = -20 (0xffffffec); offX = 200; dist = 9600 (0x2580); flag52649 = 1 }
  decay(bufB); addStarburst(bufB, plasmaTab); bufA = convert(bufB)
  drawObject_518e4()                             // same texture and palette as the star
  copy bufA -> VGA

0x53929 loadTexPalette(): out(0x3c8, 0); output 0x240 bytes from texPtr - 0x300  // colours 0..191 from the RIX palette (6-bit)
```

## 3D engine

### Object data (inside CONTROL.EXE, initialised data)

Header: `dword N (vertices), dword F (faces)`, then 10 consecutive blocks of signed dwords:
`vx[N], vnx[N], fnx[F], vy[N], vny[N], fny[F], vz[N], vnz[N], fnz[F], faces[F][3]` (vertex indices).

| setup fn | header | N | F | envU0 | envV0 | used by |
|---|---|---|---|---|---|---|
| 0x5198e | 0x4aed9 | 306 (0x132) | 568 (0x238) | 0x80 | 0x80 | 0x52577 star |
| 0x518e4 | 0x40651 | 198 (0xc6) | 374 (0x176) | 0x00 | 0x80 | 0x5264a plant |
| 0x51a38 | 0x43bf9 | 425 (0x1a9) | 800 (0x320) | 0x80 | 0x00 | 0x526f0 crab (not this slice) |
| 0x51ace | 0x500d1 | 96 (0x60) | 156 (0x9c) | - | - | later; also sets offX=offY=0, dist=12000, shadeMode=1 |

The setup fns store the block pointers into 0x518bc..0x518e0 (vx, vy, vz, vnx, vny, vnz, fnx, fny, fnz, faces);
counts into [0x51885]=N, [0x51889]=F; envDist = 20000; envU0/envV0 as above; [0x2d418]=[0x2d41c]=0 (518e4,
5198e only). **Quirk: the "vny" pointer is set to the vnz block (both 0x518cc and 0x518d0 = the vnz block),
so vertex normals are used as (vnx, vnz, vnz); the real vny block is never read.** Then they call 0x51c2f.

### Tables

- SIN[i] = round(2048*sin(2*pi*i/256)), COS[i] = round(2048*cos(2*pi*i/256)), i = 0..255 (checked: all 512
  entries match). 1.11 fixed point.

### Rotation (0x2d540, 0x2d464, 0x2d4d1); all products are 32-bit `imul` low halves (Math.imul), sums wrap, `>> 11` arithmetic
```
rotZ (0x2d540, a = angZ): x' = (x*COS[a] - y*SIN[a]) >> 11;  y' = (x*SIN[a] + y*COS[a]) >> 11
rotX (0x2d464, a = angX): y' = (y*COS[a] - z*SIN[a]) >> 11;  z' = (y*SIN[a] + z*COS[a]) >> 11
rotY (0x2d4d1, a = angY): x' = (x*COS[a] + z*SIN[a]) >> 11;  z' = ((-x)*SIN[a] + z*COS[a]) >> 11
rotate(v) = rotY(rotX(rotZ(v)))          // order Z, X, Y (each uses the original values of its pair)
```

### Projection 0x2d5ad
```
zz = z + dist;  d = zz + 600 (0x258);  if (d == 0) d = 1
sx = trunc((x << 8) / d) + offX + 160 + (x >= 0 ? 1 : 0)      // idiv truncates toward 0; cdq is done on x before the shift
sy = trunc((y << 8) / d) + offY + 100 + (y >= 0 ? 1 : 0)
```

### 0x51c2f transform
```
for i in 0..N-1:
  (x,y,z) = rotate(vx[i], vy[i], vz[i]); project
  SX[i]=sx (0x327ed); RX[i]=x (0x3378d); SY[i]=sy (0x3472d); RY[i]=y (0x356cd); ZD[i]=z+dist (0x3666d)
  (NX[i],NY[i],NZ[i]) = rotate(vnx[i], vnz[i], vnz[i])          // 0x2f90d, 0x308ad, 0x3184d (see quirk)
for f in 0..F-1:
  (FX[f],FY[f],FZ[f]) = rotate(fnx[f], fny[f], fnz[f])          // 0x385ad, 0x3954d, 0x3a4ed
call 0x402d6
```
Arrays hold 1000 entries each.

### 0x402d6 cull, sort, draw
```
count = 0                                         // [0x402d2]
for f in 0..F-1:
  v0 = faces[f][0]
  dot = imul(FX[f],RX[v0]) + imul(FY[f],RY[v0]) + imul(FZ[f],ZD[v0])   (32-bit wrap)
  if (dot >= 0) vis[count++] = {dot, faces[f][0], faces[f][1], faces[f][2]}   // 0x3b48d, 16 bytes each
for c in 0..count-1: depth[c] = ZD[vis[c].v0] + ZD[vis[c].v1] + ZD[vis[c].v2]  // 0x2e969 (1001 dwords)

// selection "sort" into order[] (0x3f30d), ascending depth, ties in ascending index:
prev = -0x7d0000; k = 0                            // [0x402b6]
do {
  best = 0x7d0000
  for c in 0..count-1: if (depth[c] < best && depth[c] > prev) { best = depth[c]; e = c }
  prev = best; order[k] = e                        // e keeps its old value if nothing qualified
  if (e < count-1)
    for c in e+1 .. count:                         // NB inclusive: reads depth[count] (stale from earlier frames)
      if (depth[c] == prev) order[++k] = c
  k++
} while (k < count)

// painter: far to near
i = count - 1
do {                                               // NB do-while: with count == 0 it draws order[-1] once (stale)
  t = vis[order[i]]
  for j in 0..2 (v = t.v0, t.v1, t.v2):
    vx_[j] = SX[v]; vy_[j] = SY[v]                // 0x2dbef[j], 0x2dbfb[j]
    if (shadeMode == 0):                          // all effects of this slice
      (u, w) = envUV(NX[v], NY[v], NZ[v])         // 0x2d61b
    else:                                         // shadeMode 1 (0x51ace only); hard-wired to object 0x500d1
      u = j == 0 ? ((vx500[v] >> 6) + 5) & 255 : ((vx500[v] >> 5) + 0x40) & 255   // vx500 = 0x500d9 block
      w = ((vy500[v] >> 5) + 0x40) & 255                                             // vy500 = 0x50649 block
    tu[j] = u; tv[j] = w                          // bytes 0x2dc1f[j], 0x2dc22[j]
  if (shadeMode != 0): orMask = min(15, t.dot >> 23) << 4    // dot is >= 0 here
  drawTriangle()                                  // 0x2dc83
} while (--i >= 0)
```
Edge cases above are faithful to the code but should not occur in practice (a stale depth equal to the minimum,
or no visible face).

### 0x2d61b envUV (sphere map into a 128x128 quadrant)
```
d = nz + envDist (20000); if (d == 0) d = 1
u = (((trunc((nx << 8) / d) + 0x80) & 255) >> 1) + envU0) & 255     // "add eax,0x80; shr al,1; add al,[0x2d619]": low byte only
v = (((trunc((ny << 8) / d) + 0x80) & 255) >> 1) + envV0) & 255
```
So the star samples texture quadrant u 128..255, v 128..255 and the plant u 0..127, v 128..255.

### 0x2dc83 drawTriangle (affine textured, into bufA via rowAddr, no z-buffer)

Inputs: 3 vertices (X, Y as signed dwords; U, V bytes), texPtr, spanMode (0), orMask.
```
// 1) sort the vertex indices by Y ascending; ties keep index order (stable). Same selection algorithm as above,
//    with bounds (-2000000, 2000000) instead of +-0x7d0000.
a, b, c = vertices in that order
if (a.Y >= 200) return                     // "jge 0x2a0" jumps to a ret in the runtime
EX[200] (0x2d72e, dwords), EU[200] (0x2da4e), EV[200] (0x2db16): edge tables

edgeStep(p, q):                            // 16.16 steps; idiv truncates toward 0
  dy = q.Y - p.Y
  sx = su = sv = 0
  if (dy != 0) { sx = trunc(((q.X-p.X) << 16) / dy); su = trunc(((q.U-p.U) << 16) / dy); sv = trunc(((q.V-p.V) << 16) / dy) }
  // value at step k: X = p.X + floor(k*sx / 65536); U = (p.U + floor(k*su / 65536)) & 255; same for V
  // (the code keeps a 16-bit fraction and adds the carry into the integer part - identical to a 16.16 accumulator)

walkEdge(p, q):                            // short edges a->b, then b->c
  if (p.Y > 199) skip
  yEnd = min(q.Y, 199); y = p.Y; k = 0
  do {                                     // do-while: at least one row even if p.Y == q.Y
    if (y >= 0) EX[y] = X(k)
    EU[y] = U(k); EV[y] = V(k)             // NB written for negative y too (harmless unless y < -800, see below)
    k++; y++
  } while (y < yEnd)

walkEdge(a, b); walkEdge(b, c)
// long edge a->c, drawing as it goes
yEnd = min(c.Y, 199); y = a.Y; k = 0
do {
  if (y >= 0) {
    xl = X_ac(k); ul = U_ac(k); vl = V_ac(k)
    n = EX[y] - xl
    if (n >= 0) { xs = xl; us = ul; vs = vl; ue = EU[y]; ve = EV[y] }
    else        { n = -n; xs = EX[y]; us = EU[y]; vs = EV[y]; ue = ul; ve = vl }
    du = dv = 0
    if (n != 0) { du = trunc(((ue-us) << 16) / n); dv = trunc(((ve-vs) << 16) / n) }
    cnt = max(n, 1)                        // "dec ecx; js; jne": n == 0 still draws one pixel; the pixel at xs+n is not drawn
    for j in 0..cnt-1:
      x = xs + j
      if (x >>> 0 < 320) {                 // unsigned compare: clips both sides; the pointer still advances
        u = (us + floor(j*du/65536)) & 255; v = (vs + floor(j*dv/65536)) & 255
        bufA[y*320 + x] = tex[v*256 + u] | orMask          // spanMode 0
      }
  }
  k++; y++
} while (y < yEnd)
```
Consequences: rows >= 199 are never drawn; there is no horizontal clipping other than the per-pixel test.
spanMode != 0 (never used): pixel = tex >> 2, written only if non-zero.
The EU/EV writes for negative y land below the tables (into EX for rows >= 150 and into EU); every row the
long edge reads afterwards has been rewritten, so this is harmless unless a vertex has y < -800 (then it would
hit the variables at 0x2d6xx). Keep EX/EU/EV as one contiguous byte array if you want to copy it exactly.

## Tables (verbatim)

WAVE_S (0x2d218) = round(127*|sin(pi*i/128)|), WAVE_C (0x2d318) = round(127*|cos(pi*i/128)|), i = 0..255
(both checked to match all 256 bytes).

decayTab (0x1c1a7), 256 bytes (no closed form found; roughly 0.83*i):
```
0,0,0,1,2,3,4,5,6,7,8,9,10,11,12,12,13,14,15,16,17,18,18,19,20,21,22,23,23,24,25,26,
27,27,28,29,30,31,32,33,33,34,35,36,37,38,38,39,40,41,42,43,43,44,45,46,47,48,48,49,50,51,52,52,
53,54,55,56,57,57,58,59,60,61,62,62,63,64,65,66,67,68,68,69,70,71,72,73,73,74,75,76,77,78,78,79,
80,81,82,83,83,84,85,86,87,88,88,89,90,91,92,93,93,94,95,96,97,97,98,99,100,101,102,102,103,104,105,106,
107,107,108,109,110,111,112,112,113,114,115,116,117,117,118,119,120,121,122,122,123,124,125,126,127,127,128,129,130,131,132,133,
133,134,135,136,137,138,138,139,140,141,142,143,143,144,145,146,147,148,148,149,150,151,152,153,153,154,155,156,157,158,158,159,
160,161,162,163,163,164,165,166,167,168,168,169,170,171,172,173,173,174,175,176,177,178,178,179,180,181,182,183,183,184,185,186,
187,188,188,189,190,191,192,192,193,194,195,196,197,197,198,199,200,201,202,202,203,204,205,206,207,207,208,209,210,211,212,212
```

burstPal (0x52189), 192 bytes = RGB for colours 0xC0..0xFF (6-bit):
```
0,0,0, 0,0,0, 1,0,0, 2,0,0, 3,0,1, 4,1,1, 5,1,1, 6,1,1, 7,1,2, 9,1,2, 10,2,3, 12,2,3, 14,2,4, 16,3,4, 18,3,5, 20,3,5,
22,4,5, 24,4,5, 26,4,6, 28,4,6, 30,4,6, 32,2,6, 34,2,6, 36,2,5, 38,2,5, 40,2,5, 42,2,5, 44,1,4, 46,1,4, 48,1,3, 50,1,3, 52,1,2,
55,1,1, 57,1,1, 59,0,1, 61,0,0, 63,0,0, 63,4,1, 63,9,3, 63,13,6, 63,18,8, 63,22,10, 63,26,13, 63,30,15, 63,34,18, 63,37,20, 63,41,22, 63,44,25,
63,46,27, 63,49,29, 63,51,32, 63,54,34, 63,55,36, 63,57,39, 63,59,41, 63,60,44, 63,61,46, 63,62,48, 63,63,51, 63,63,53, 63,63,55, 63,63,58, 63,63,60, 63,63,63
```

## Timing and frame rate

- All animation parameters (scrolls, pulse, palette fade, angles, offsets, distance) change **per tick** in the
  ISR; the effects only read them. Everything is a function of the tick number (closed forms above).
- The main loop calls the effect as fast as it can, with no retrace wait and no frame limiter (C1). The decay
  feedback therefore depends on how many frames run per tick. In the recording, the number of changed frames
  (70.086 Hz capture) is about 39 per second at 5 s and 40 s and about 30 per second at 27 s (star object),
  i.e. roughly 1 to 1.3 frames per tick (GUESS: DOSBox speed; tearing can affect this count). A simulation of
  the starburst with 1 and 1.3 frames per tick matches the recorded frames at ticks 150 and 240; with 2 frames
  per tick the rays are clearly too long and bright. Suggestion for the port: run 1 frame per tick (or
  about 1.3 on average) rather than 1 per display refresh.
- The scene fn for tick T runs before the frames drawn during tick T. The init blocks of 0x52577 / 0x5264a
  run on their first frame, i.e. right after the first tick of their scene.
