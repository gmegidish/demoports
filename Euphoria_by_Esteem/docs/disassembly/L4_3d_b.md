# L4_3d_b: segment 1342, 1342:2000 to the end (1342:458b), the 3D engine unit, second half

Read this together with `L3_3d_a.md`, which covers 1342:0000-2000. That file defines TPoint, TPixel, TMesh (the base with the vertex linked list), TFace, Edge, Plane, RoundS, Perspective, RotateWork and so on. I reuse its names. The tail of 1342:1e1a (TFace.Shade, flat shading) runs past 2000 but is documented there.

**Correction to L3_3d_a:** the light vector globals `DS:5657/565b/565f` are written. They are fields +0x61/+0x65/+0x69 of the static `TLightDir` object at `DS:55f6`, filled by 1342:421b (see below). With the default light direction they hold (0, 0, -1024).

## Summary

This half holds:
- **TFace drawing** (1342:251d): it projects the face's vertices into a global 4-entry screen polygon buffer, culls (off-screen and backface), computes per-vertex or per-face shading in one of four shading modes, then calls one of the polygon fillers in segment 186a.
- **TPolyObject** (VMT 23ea, size 0x94): a TMesh holding a TCollection of TFaces. It has a running colour counter and texture pointers, plus the procedural builders: an extruded "wall" quad (2d43), a quad from 4 points (3018), a triangle (3129), a quad from 4 TPixels (2fa7), and AddFace (2c6c) with vertex dedup. It also has the per-frame draw (3518): depth, quicksort, vertex normals, then draw every face.
- **TGroup** (VMT 23fa, size 0xa0): a TPolyObject that merges the faces and vertices of other TPolyObjects, so they are sorted together.
- **Starfield** (VMT 241a, size 0x61) with TStar points (VMT 240a; Draw = 1342:3846): three draw modes (dot, plus-shape, streak line).
- **Explosion** (VMT 2436, size 0x5b): random particles with velocities that fade after 50 frames.
- **TLightDir** (VMT 2452, size 0x9a): a 2-point TMesh whose direction gives the global flat-shading light vector. A static instance lives at DS:55f6.
- **TLight** (VMT 2462, size 0x34): a point light (TPixel + radius) used by Gouraud mode 0x10, plus the light list (DS:568c) and its add/free functions.
- **Unit init** (1342:4540): perspective D = 200, screen centre, default light direction, one default point light, and the default Phong table.

**No .ASC (3D Studio ASCII) parsing is in this range.** The callers of the face builders that look like a loader or procedural generator are in segment **0e5a** (0e5a:01ab..2500 call 287c, 2d43, 3129, 2bff, 2c11, 1c84, 0604, 1cd4, 2c6c). Look there for the .ASC parser.

All floats are **float32** unless noted, and every `fstp dword` rounds to f32 (see L3_3d_a for the f32() convention). `RoundS(x)` = 1342:0000 = round half to even, to a longint.

### External calls made from this range

| call | meaning |
|---|---|
| 1342:0000 (near `call 0`) | RoundS(single): longint, round half to even |
| 1342:020e | Perspective(var x, var y; z): boolean. Valid if z < D; then x,y *= D/(D-z) |
| 1342:0271 | SetPerspective(D) -> DS:5548 |
| 1342:03ef | MakeVec(x,y,z, var v) |
| 1342:04bf / 0500 | TPoint.SetPos(x,y,z) / MovePos(dx,dy,dz) (pos, then work = pos) |
| 1342:0604 | TPixel.Init(x,y,z: single; color: byte) constructor |
| 1342:0643 / 066e | TPixel.SetVelocity / Step (pos += vel) |
| 1342:0745 | TPixel.Erase (putPixel(sx,sy,DS:5d94)) |
| 1342:0760 | TPixel.Erase then virtual Draw |
| 1342:080e | EdgeInit(p1, p2, var edge) |
| 1342:08fe | PlaneInit(p0, p1, p2, var plane) (N = (p1-p0) x (p2-p0)) |
| 1342:0a3a | CosAngle(edge, plane): f32 = N.dir/(abs N * abs dir) |
| 1342:0afa / 0b62 | TMesh.Init / TMesh.Done |
| 1342:0c20 | TMesh.Append(item) (vertex list, count +0x3e) |
| 1342:0c99 | TMesh.AddUnique(var item) (dedup by pos; disposes the duplicate) |
| 1342:0d74 | NextNode(var node): boolean |
| 1342:1466 | TMesh.RotateWork(ax, ay, az) |
| 1342:1c84 | TFace.Init(flags, minColor, maxColor, color) |
| 1342:1cd4 | TFace.SetVertices(v1..v4) |
| 1342:1d6d | TFace.SetExtra(texA, texB) -> +0x6e, +0x72 |
| 1342:1d97 | TFace.ComputeDepth (+0x69 = sum of work.z, triangles count v3 twice) |
| 1342:1e1a | TFace.Shade (flat, integer light vector) |
| 1813:0101 / 0172 / 0215 / 0248 | TCollection.Init(limit, delta) / At(i) / AtPut(i, item) / DeleteAll |
| TCollection VMT+0x1c | Insert(item) (appends, for a plain TCollection) |
| 1d81:028a / 029f | GetMem / FreeMem |
| 1d81:3d77 | Move(src, dst, n) |
| 1d81:3d8f / 3dcc | longint mul / div (div truncates toward 0) |
| 1d81:4677 | Random(n) (BP LCG) |
| 1d81:31e5 / 320f | Real48 -> ST0 / ST0 -> Real48 |
| 1d45:0103 | ArcCosDeg(x: Real48): Real48 = 90.0 - ArcSinDeg(x). ArcSinDeg (1d45:0094) = ArcTan(x / Sqrt(1 - x*x)) * 57.29577951308232 (extended constant at 1d45:0000). x = 1 divides by zero, hence the 1e-7 guard in 2275 |
| 186a:1634 | putPixel(x, y, c) (clipped) |
| 186a:185f | line(x1, y1, x2, y2, c) (clipped) |
| 186a:1a2a | drawDot(x, y, c) (small ball sprite) |
| 186a:1620 | setHLineHook(p). Hooks used here: 186a:1689 = solid clipped hline (default); 186a:16c1 = **gradient hline**: writes colour byte AH, then `AX -= word[DS:9118]` per pixel (8.8 fixed-point step, so the colour decreases by [9118]/256 per pixel); 186a:16fa = **additive hline**: `dst = (dst + c) & 255` |
| 186a:10e5 | setActivePage(n) |
| 186a:121e | copyPage(src, dst) |
| 179b:0000 | darkenActivePage(v: byte): for each of the 32000 words of the active page: if word != 0 { lo = max(lo - v, 0); hi = max(hi - v, 0) } (unsigned saturating; a zero word is skipped) |
| 186a:1d02 | polygon fill (pts, n, a, b, color). Called with (0,0,color) for flat and (minColor,maxColor,color) for type 1/2. Outside this slice |
| 186a:21bf | Gouraud polygon (pts, n, 0, 0, 0): uses pts[i].c |
| 186a:2774 | Phong/"angle" polygon (pts, n): pts[i].c = angle 0..90, looked up in the table DS:90bc |
| 186a:3343 / 34d7 | textured polygon (pts, texture, 0): front side texA / back side texB |
| 186a:366b / 381f | textured + angle-shaded polygon (pts, texture): front texA / back texB |
| 186a:26a6 | BuildPhongTable(a, b, c, e: Real48): for ang = 0..90: `cs = f32(cos(ang*pi/180))` (pi as extended, /180.0 f32); `v = f32(a + b*cs + c*Power(cs, e))` (1d45:0142 = Power, GUESS); `if (v > 255.0) v = 255.0`; `byte[DS:90bc + ang] = Round(v)` (1d81:3275, half even). There is no lower clamp |

## Globals (DS offsets) used in this slice

| DS | type | meaning |
|---|---|---|
| 5548 | int16 | perspective distance D (200 after unit init) |
| 551c | TPixel (0x2c bytes, static) | initialised to (0,0,0), colour 15, VMT 239a, by unit init. Use unknown (GUESS: a reference point) |
| 55f6 | TLightDir (0x9a bytes, static, VMT 2452) | global light-direction object. Its fields are the globals below |
| 5657 / 565b / 565f | int32 | Lx, Ly, Lz = TLightDir+0x61/+0x65/+0x69: `RoundS(f32((B.work - A.work) * 1024.0))`. Used by TFace.Shade (1e1a) |
| 5664 | Edge (0x2c) | TLightDir+0x6e: Edge(A, B). Its `dir` (DS:5684/5688/568c) is the light direction for angle shading when there are no point lights |
| 568c + 4*i | far ptr TLight | `lights[i]`, i = 1..count. Slot 0 (DS:568c) overlaps edge.dir.z and is never used as a light |
| 5a8c | byte | light count (0 at start, 1 after unit init) |
| 5a8d | byte | "dispose items on Done" flag (see L3_3d_a) |
| 5a8f | byte | star draw mode: 0 dot, 1 plus (default, set by unit init), else streak |
| 5a90 / 5a92 | int16 | star brightness min / max (set by Starfield.Init) |
| 5a94 / 5a98 | far ptr TPixel | two TPixels at (0, 0, D) colour 0, created by 4467. No use in this slice (GUESS: camera/eye points) |
| 5a9c | byte | winding flip for backface culling (0/1); set per mesh from flags bit 0x400 |
| 5aba + 8*i | record {x, y, c, pad: int16} | **screen polygon buffer** `pts[i]`, i = 1..4 (pts[1] = DS:5ac2, pts[2] = 5aca, pts[3] = 5ad2, pts[4] = 5ada). x,y = screen coords, c = per-vertex shade value. The pad word is never written here. 186a fillers receive `&pts[1]` = DS:5ac2. (Index 0 would overlap the rotation matrix M7/M8 and is not used) |
| 5bf4 / 5bf6 | int16 | screen centre x / y |
| 5bfa / 5bfc / 5bfe / 5c00 | int16 | clip rectangle left / top / right / bottom (inclusive) |
| 5c20 | byte | active page number |
| 5d93 | byte | colour of the face being drawn (low byte of face +0x77), stored before the filler calls. Read by 186a (GUESS: used by the fillers) |
| 9118 | int16 | shared parameter: per-pixel colour step (8.8) for the gradient hline hook 186a:16c1, and the streak length in star mode 2. Set by the parts |
| 911e / 9120 | far ptr | zeroed by TFace.Init. AddFace (2c6c) copies the mesh textures into the face only when this is non-nil (see 2c6c) |
| 90bc | byte[91] | Phong/angle table: shade colour for angle 0..90 degrees (built by 186a:26a6) |
| 9fa4 | byte | if non-zero, DrawMesh skips depth computation and sorting for every mesh (GUESS: global "no sort" switch) |

## VMTs and record layouts

VMT table (DS), standard BP7 layout: +0 size, +2 -size, +4 0, +6 0, then methods from +8.

| VMT | size | +8 | +0xC | +0x10 | +0x14 | +0x18 | object |
|---|---|---|---|---|---|---|---|
| 239a | 0x2c | 1813:0031 | 06bd Draw (putPixel) | | | | TPixel |
| 23aa | 0x2c | 1813:0031 | 0786 Draw (drawDot) | | | | TBigPixel |
| 23da | 0x7c | 0b62 | 0bff | | | | TFace |
| 23ea | 0x94 | 2906 Done | 29cf DoneFree | | | | **TPolyObject** |
| 23fa | 0xa0 | 368e Done | 29cf | | | | **TGroup** |
| 240a | 0x2c | 1813:0031 | 3846 Draw | | | | **TStar** |
| 241a | 0x61 | 0b62 | 0bff | 377c DrawAll | 37be EraseAll | 37fe EraseDrawAll | **TStarfield** |
| 2436 | 0x5b | 0b62 | 0bff | 40c4 Draw | 37be | 37fe | **TExplosion** |
| 2452 | 0x9a | 0b62 | 0bff | | | | **TLightDir** |
| 2462 | 0x34 | 1813:0031 | 4378 Draw (drawDot) | | | | **TLight** |
| 2474 | 0x0c | | | | | | TCollection |

### TFace (size 0x7c), full layout (fields this slice adds to L3_3d_a)
```
+0x00..0x58  TMesh base (VMT, head/tail of the vertex list, origin, pivot, +0x3e int16 n = vertex count 3 or 4)
+0x59 far ptr v1, +0x5d v2, +0x61 v3, +0x65 v4    vertex i at +0x55+4*i (i = 1..4). Triangles: v4 == v3, n = 3
+0x69 f32   depth (sum of work.z, 4 terms)
+0x6d byte  skip flag: if != 0, ComputeDepth keeps the old depth and DrawFace skips the face once (then clears it to 0)
+0x6e far ptr texA (front texture), +0x72 far ptr texB (back texture). Heap blocks of 7 bytes (they are FreeMem'd with size 7). Format outside this slice
+0x76 byte  side selector, set by the backface test for double-sided textured faces: 0 = use texA, 1 = use texB
+0x77 int16 colour (flat colour; Shade overwrites it in mode 8). Only the low byte reaches the filler (DS:5d93)
+0x79 byte  minColor (for mode 0x10: first light index)
+0x7a byte  maxColor (for mode 0x10: last light index)
+0x7b byte  flags:
            bits 0..2 (flags & 7) = fill type: 0 flat, 1 flat with min/max range, 2 gradient hline (hook 16c1),
                                    3 textured, 4 additive/translucent (hook 16fa)
            bits 3..4 (flags & 0x18) = shading: 0x00 none, 0x08 flat Lambert (1e1a), 0x10 Gouraud from point lights (209b),
                                    0x18 Phong-like per-vertex angle (2275)
            bit 6 (0x40) = double-sided (no backface cull; absolute value of the cosine)
            bit 7 (0x80) = draw even when no vertex is inside the clip rectangle
```
### Vertex fields used by shading (TPixel, VMT 239a)
```
+0x02/+0x06/+0x0a f32 work x,y,z     (projected)
+0x1a/+0x1c       int16 sx, sy (screen; written by Draw methods, NOT by DrawFace)
+0x1e/+0x22/+0x26 f32 accumulated vertex normal (CalcVertexNormals 3377). In L3_3d_a this is the "velocity" of a TPixel. Same storage, different use
+0x2a int16       Gouraud light cache for mode 0x10 (0 = recompute). For plain pixels it is the colour
```
### TPolyObject (size 0x94, VMT 23ea) = TMesh +
```
+0x59 TCollection faces   (+0x59 VMT 2474, +0x5b Items far ptr, +0x5f int16 Count, +0x61 Limit, +0x63 Delta)
+0x65 TCollection aux     (limit 1, delta 0; only created and freed here, never filled in this slice)
+0x71 far ptr texA, +0x75 far ptr texB (mesh-wide textures)
+0x79..0x7d unused here
+0x7e byte minColor  (copied to every new face's +0x79)
+0x7f byte maxColor  (copied to every new face's +0x7a)
+0x80 byte nextColor (colour given to the next face added; starts = minColor)
+0x81 byte colorStep (added to nextColor after each AddFace, 8-bit wrap; starts at 1)
+0x82 f32 phongA, +0x86 f32 phongB, +0x8a f32 phongC, +0x8e f32 phongE   (BuildPhongTable params, mode 0x18)
+0x92 word flags:
        low byte  = face flags given to every new face (+0x7b)
        0x0018    = shading mode, also tested by DrawMesh (0x18: vertex normals each frame; 0x10: clear the Gouraud cache)
        0x0100    = no vertex dedup in AddFace (Append instead of AddUnique)
        0x0200    = no depth sort
        0x0400    = flip backface winding (DS:5a9c = 1)
list (head +2, count +0x3e) = the vertices (TPixel), unique unless 0x100
```
### TGroup (size 0xa0, VMT 23fa) = TPolyObject +
```
+0x94 TCollection members (limit 1, delta 0) - the TPolyObjects merged into it
```
### TStarfield (size 0x61, VMT 241a) = TMesh +
```
+0x40 int16 minBright, +0x42 int16 maxBright (base fields, overwritten)
+0x59..0x5e unused
+0x5f int16 speed (z step per Move)
list = TStars
```
### TExplosion (size 0x5b, VMT 2436) = TMesh +
```
+0x59 word frame counter (unsigned compare with 50)
list = TPixel/TBigPixel particles (pos, velocity +0x1e.., colour +0x2a)
```
### TLightDir (size 0x9a, VMT 2452) = TMesh +
```
+0x59 far ptr A (first TPixel), +0x5d far ptr B (second TPixel)   (also list items 1 and 2)
+0x61 int32 Lx, +0x65 int32 Ly, +0x69 int32 Lz   = RoundS(f32((B.work - A.work)*1024.0))
+0x6d byte (0 from the zero-fill; used as the colour of A and B at construction)
+0x6e Edge (0x2c bytes) = EdgeInit(A, B)   (dir at +0x8e/+0x92/+0x96)
```
### TLight (size 0x34, VMT 2462) = TPixel +
```
+0x02.. work pos (used by Gouraud), +0x2a colour (Draw)
+0x2c f32 radius
+0x30 f32 falloff = f32(radius * 20000.0)
```
### 12-byte vector (by-reference args of 3018/3129)
`+0 f32 x, +4 f32 y, +8 f32 z`

## Functions

Notation: far procs, `self` at [bp+6], the first Pascal argument at the highest offset.

### 1342:209b TFace.ShadeGouraud(self), retf 4 (mode 0x10)
```
cnt = byte DS:5a8c
if (cnt == 0 || face.minColor(+0x79) > cnt || face.maxColor(+0x7a) > cnt) return   // byte, unsigned compares
for (i = 1; i <= n(+0x3e); i++) {               // signed int16 loop
  v = vert[i]
  if (v.+0x2a == 0) {                          // int16 cache
    sum = 0.0                                  // cs:208f = 0.0 (f32)
    for (j = minColor; j <= maxColor; j++) {   // int16 loop, skipped if min > max
      L = lights[j]                            // far ptr DS:568c + 4*j
      dx = f32(L.wx - v.wx); dy = f32(L.wy - v.wy); dz = f32(L.wz - v.wz)
      d2 = f32(dx*dx + dy*dy + dz*dz)
      t  = f32(255.0 - (d2*d2) / (L.falloff(+0x30) + 1.0))   // cs:2097 = 255.0, cs:2093 = 1.0; d2*d2, the sum and the division in extended
      if (t > 0.0) sum = f32(sum + t)
    }
    v.+0x2a = int16(RoundS(sum))               // no clamp to 255
  }
  pts[i].c = v.+0x2a                           // DS:5abe + 8*i
}
```
The cache is cleared once per frame by DrawMesh (mode 0x10), so shared vertices are lit once. The value is not clamped here. A vertex near a light can exceed 255, and an unlit vertex keeps 0 and is recomputed by the next face that uses it.

### 1342:2275 TFace.ShadeAngle(self), retf 4 (mode 0x18)
```
for (i = 1; i <= n; i++) {
  pl.N = vert[i].normal (+0x1e, 12 bytes copied)       // local Plane, only N is used
  if (byte DS:5a8c > 0) {
     EdgeInit(lights[1], vert[i], e)                   // only light 1 (DS:5690)
     c = abs(CosAngle(e, pl))
  } else {
     c = CosAngle(edge at DS:5664 /*light dir edge*/, pl)   // no abs
  }
  if (face.flags & 0x40) c = abs(c)
  else if (c < 0.0) c = 0.0                            // cs:2263 = 0.0
  if (c == 1.0) c = f32(c - 1e-7)                      // cs:2267 = 1.0 (f32); 1e-7 extended at cs:226b
  ang = ArcCosDeg(Real48(c))                           // 1d45:0103, Real48 in and out
  pts[i].c = int16(RoundS(f32(ang)))                   // 0..90 (degrees)
}
```
The filler maps the angle through the table DS:90bc. With the defaults (the light dir edge points along +z, see 4467), a vertex normal facing +z gets angle 0, so table[0] = 255 is the brightest.

### 1342:23b0 TFace.IsFrontFacing(self): boolean, retf 4
It uses pts[1..4] (already projected). Each difference is an int16 subtraction (wraps), sign-extended to int32, then a 32-bit multiply.
```
face.+0x76 = 0
if (!(flags & 0x40)) {                     // single-sided
  if (pts[1].x == pts[2].x && pts[1].y == pts[2].y) {    // degenerate first edge: use 2,3,4
     A = (pts[4].y - pts[3].y) * (pts[2].x - pts[3].x)
     B = (pts[4].x - pts[3].x) * (pts[2].y - pts[3].y)
  } else {
     A = (pts[3].y - pts[2].y) * (pts[1].x - pts[2].x)
     B = (pts[3].x - pts[2].x) * (pts[1].y - pts[2].y)
  }
  if (A - B < 0) return (DS:5a9c == 0)    // 1 or 0
  else           return DS:5a9c           // byte as-is (0 or 1)
}
// double-sided
if ((flags & 7) == 3 && texA(+0x6e) != texB(+0x72)) {    // full far pointer compare
  A = (pts[3].y - pts[2].y) * (pts[1].x - pts[2].x)
  B = (pts[3].x - pts[2].x) * (pts[1].y - pts[2].y)
  face.+0x76 = (A - B < 0) ? 0 : 1
}
return true
```

### 1342:251d TFace.Draw(self), retf 4: the main face renderer
```
if (face.+0x6d != 0) { face.+0x6d = 0; return }
anyInside = false
for (i = 1; i <= n; i++) {                       // int16
  x = vert[i].wx; y = vert[i].wy
  if (!Perspective(x, y, vert[i].wz)) return     // a vertex at or behind the eye plane drops the whole face (+0x6d is not touched)
  pts[i].x = int16(RoundS(x) + cx)               // cx = DS:5bf4; longint add, low word
  pts[i].y = int16(RoundS(y) + cy)               // cy = DS:5bf6
  pts[i].c = 0
  if (clipL <= pts[i].x <= clipR && clipT <= pts[i].y <= clipB) anyInside = true   // signed, DS:5bfa/5bfe/5bfc/5c00
}
if (!anyInside && !(flags & 0x80)) goto done
if (!IsFrontFacing()) goto done
DS:5d93 = low byte of face.+0x77
if (n == 3) pts[4] = pts[3]                      // Move 8 bytes DS:5ad2 -> DS:5ada
mode = flags & 0x18; type = flags & 7
if (mode == 0x08) {
  Shade()                                        // 1e1a: sets +0x77 (DS:5d93 was stored BEFORE this, so it holds the old colour)
  if (type == 3) {                               // darken the texture by the shade
    saved = DS:5c20
    copyPage(3, 2)                               // 186a:121e(src=3, dst=2)
    setActivePage(2)
    darkenActivePage(255 - face.+0x77)           // 179b:0000, byte value
    setActivePage(saved)
  }
  // falls through to the type switch below
}
if (mode == 0x10) { ShadeGouraud(); GouraudPoly(&pts[1], n, 0, 0, 0); goto done }        // 186a:21bf
if (mode == 0x18) {
  ShadeAngle()
  if (type == 3) {
    if (face.+0x76 == 0) TexAnglePoly(&pts[1], texA)    // 186a:366b
    else                 TexAnglePoly2(&pts[1], texB)   // 186a:381f
  } else AnglePoly(&pts[1], n)                          // 186a:2774
  goto done
}
// mode 0 or 8:
c = low byte of face.+0x77                              // re-read, so mode 8 uses the new shade here
switch (type) {
  case 0: Poly(&pts[1], n, 0, 0, c)                          // 186a:1d02
  case 1: Poly(&pts[1], n, minColor, maxColor, c)
  case 2: setHLineHook(186a:16c1); Poly(&pts[1], n, minColor, maxColor, c); setHLineHook(186a:1689)
  case 4: setHLineHook(186a:16fa); Poly(&pts[1], n, 0, 0, c);               setHLineHook(186a:1689)
  case 3: if (face.+0x76 == 0) TexPoly(&pts[1], texA, 0)    // 186a:3343
          else                 TexPoly2(&pts[1], texB, 0)   // 186a:34d7
  default (5..7): nothing
}
done: face.+0x6d = 0
```
Notes:
- The textured fillers get no per-vertex u/v from here. The texture coordinates must be implied by the vertex order (pts[1..4] = texture corners). For triangles, pts[4] = pts[3]. GUESS, to confirm in the 186a notes.
- In mode 8 with type 3, the darkening rewrites page 2 from page 3 **for every face**. The texture pointers presumably point into page 2.
- DS:5d93 is set before Shade, so in mode 8 DS:5d93 holds the previous colour value while the explicit argument `c` holds the new one.

### 1342:287c TPolyObject.Init(limit: int16 [bp+0x12]; flags: word [bp+0x10]; minColor: byte [bp+0xe]; maxColor: byte [bp+0xc]), constructor (VMT [bp+0xa], self), retf 0xe
```
TMesh.Init
faces(+0x59).Init(limit, 10)       // TCollection VMT 2474
aux(+0x65).Init(1, 0)
+0x7e = minColor; +0x7f = maxColor; +0x92 = flags
+0x81 = 1; +0x80 = minColor
texA(+0x71) = nil; texB(+0x75) = nil
```
16 callers (the parts in seg 0 and the builders in 0e5a). VMT is 23ea when called through `new`.

### 1342:2906 TPolyObject.Done(free) (VMT+8), retf 6
Frees the textures: if texA == texB, FreeMem(texA, 7) when non-nil. Otherwise each non-nil one is freed with size 7. Then `aux.DeleteAll; aux.Done(0); faces.DeleteAll; faces.Done(0)`, `DS:5a8d = 0`, `TMesh.Done(0)` (frees the list nodes, not the vertices), then the epilogue. Faces are **not** freed.

### 1342:29cf TPolyObject.DoneFree (VMT+0xc), retf 6
Same texture freeing. Then `aux.DeleteAll; aux.Done(0); DS:5a8d = 0; faces.Done(0)` (TCollection.Done frees every face with its Done; with the flag 0 a face does not dispose its vertex pointers), then `DS:5a8d = 1; TMesh.Done(0)` (disposes the vertices). Memory management only; the port can ignore it.

### 1342:2a90 TPolyObject.SetTextures(texA [bp+0xe], texB [bp+0xa]: pointer; self), retf 0xc
`+0x71 = texA; +0x75 = texB; for (i = 0; i <= faces.Count-1; i++) faces.At(i).SetExtra(texA, texB)`. Caller 0b1a:0359.

### 1342:2b08 TPolyObject.FreeFaceTextures(self), retf 4
For each face i = 0..Count-1:
```
if (f.texA != mesh.texA && f.texA != mesh.texB) FreeMem(f.texA, 7)
if (f.texA != f.texB && f.texB != mesh.texA && f.texB != mesh.texB) FreeMem(f.texB, 7)
```
The pointers are not cleared. Callers: 0000:13d3, 37a2, 4e4a, 4e55.

### 1342:2bff TPolyObject.SetColorStep(step: byte [bp+0xa]; self), retf 6: `+0x81 = step`. Callers in 0e5a.
### 1342:2c11 TPolyObject.NextColor(self), retf 4: `+0x80 = (+0x80 + +0x81) & 255`.
### 1342:2c32 TPolyObject.SetPhong(a [bp+0x16], b [bp+0x12], c [bp+0xe], e [bp+0xa]: single; self), retf 0x14: `+0x82=a; +0x86=b; +0x8a=c; +0x8e=e`.
Callers: 0000:0996, 30d5, 7501, 7ed5, 0a69:070c.

### 1342:2c6c TPolyObject.AddFace(face [bp+0xa]; self), retf 8
```
node = face.head(+2); idx = 1
do {
  if (mesh.flags & 0x100) mesh.Append(node.item)          // 0c20
  else                    mesh.AddUnique(&node.item)      // 0c99: may dispose node.item and replace it by an existing equal-pos vertex
  face.vert[idx] = node.item                              // +0x55 + 4*idx
  idx++
} while (NextNode(&node))                                 // 0d74
faces.Insert(face)                                         // VMT+0x1c, appends
face.+0x77 = mesh.+0x80 (zero-extended)
if (far ptr DS:911e != nil) face.SetExtra(mesh.texA, mesh.texB)
mesh.NextColor()                                           // +0x80 += +0x81
```
DS:911e is zeroed by every TFace.Init. All the builders below call AddFace right after TFace.Init, so for them the textures are NOT copied here. Textures reach faces through SetTextures (2a90) or a direct SetExtra.

Face colours: the k-th face added (0-based) gets colour `(minColor + k*step) & 255` (step = +0x81, default 1).

### 1342:2d43 TPolyObject.AddWall(axis: char [bp+0x22]; p1 [bp+0x1e], p2 [bp+0x1a], p3 [bp+0x16], p4 [bp+0x12], p5 [bp+0xe], p6 [bp+0xa]: single; self): ^TFace, retf 0x1e
It creates 4 TPixels (GetMem 0x2c each, VMT 239a, colour 0) in this order: v1, v4, v3, v2 are filled as follows.
```
'Z' or 'z':  v1 = (p1, p2, p5)  v2 = (p3, p4, p5)  v3 = (p3, p4, p6)  v4 = (p1, p2, p6)
'Y' or 'y':  v1 = (p1, p5, p2)  v2 = (p3, p5, p4)  v3 = (p3, p6, p4)  v4 = (p1, p6, p2)
'X' only:    v1 = (p5, p1, p2)  v2 = (p6, p1, p2)  v3 = (p6, p3, p4)  v4 = (p5, p3, p4)
             (the code compares with 0x58 twice, so lowercase 'x' is not accepted)
other:       the four vertices stay uninitialised (garbage). Do not rely on it
```
So (p1,p2) to (p3,p4) is a 2D segment in the plane perpendicular to `axis`, extruded along the axis from p5 to p6.
Construction order of the TPixels: v1 first, then v4, v3, v2 for Z; v1, v2, v3, v4 for Y and X. This only matters for heap addresses, not the result.
```
f = new TFace(flags = low byte of mesh.+0x92, minColor = mesh.+0x7e, maxColor = mesh.+0x7f, color = 0)   // VMT 23da
f.SetVertices(v1, v2, v3, v4)          // 4 distinct pointers, so n = 4
mesh.AddFace(f)
return f
```
19 callers: 0000:2929 and 18 in 0e5a (procedural box/room builders).

### 1342:2fa7 TPolyObject.AddQuadV(v1 [bp+0x16], v2 [bp+0x12], v3 [bp+0xe], v4 [bp+0xa]: ^TPixel; self): ^TFace, retf 0x14
`f = new TFace(flags low byte of +0x92, +0x7e, +0x7f, 0); f.SetVertices(v1, v2, v3, v4); AddFace(f); return f`. If v3 == v4 it is a triangle.

### 1342:3018 TPolyObject.AddQuad(const a [bp+0x16], b [bp+0x12], c [bp+0xe], d [bp+0xa]: Vec3; self): ^TFace, retf 0x14
It copies the four 12-byte vectors, creates 4 TPixels (VMT 239a, colour 0) at a, b, c, d (allocated in the order a, b, c, d), and returns `AddQuadV(pa, pb, pc, pd)`. 23 callers, all in 0000:68d4..6e7f.

### 1342:3129 TPolyObject.AddTri(const a [bp+0x12], b [bp+0xe], c [bp+0xa]: Vec3; self): ^TFace, retf 0x10
Creates 3 TPixels at a, b, c and returns `AddQuadV(pa, pb, pc, pc)` (n = 3). Callers 0000:26fd and 12 in 0e5a.

### 1342:320e TPolyObject.SortFaces(lo [bp+0xc], hi [bp+0xa]: int16; self), retf 8: recursive quicksort, ascending by face depth (+0x69)
```
i = lo; j = hi
pivot = faces.At((lo + hi) >>> 1).depth          // 16-bit unsigned shift
do {
  while (faces.At(i).depth < pivot) i++
  while (pivot < faces.At(j).depth) j--
  if (i <= j) {
    if (i != j && faces.At(i).depth != faces.At(j).depth) { swap faces[i] and faces[j] }   // AtPut(i, Fj); AtPut(j, Fi)
    i++; j--
  }
} while (i <= j)
if (lo < j) SortFaces(lo, j)
if (i < hi) SortFaces(i, hi)
```
The compares are exact f32 compares, signed int16 indices. The result is **ascending depth = farthest first** (depth is the sum of z, more negative = farther), so drawing in index order is the painter's algorithm. The exact permutation for equal depths depends on this algorithm. Port it literally if frame-exact output matters.

### 1342:3377 TPolyObject.CalcVertexNormals(self), retf 4 (mode 0x18)
```
for each vertex v in the mesh list: v.normal(+0x1e) = (0, 0, 0)
for (i = 0; i <= faces.Count-1; i++) {
  f = faces.At(i)
  if (f.v1 != f.v2) PlaneInit(f.v1, f.v2, f.v3, pl)    // N = (v2-v1) x (v3-v1), work coords
  else              PlaneInit(f.v2, f.v3, f.v4, pl)
  for each vertex v in f's own vertex list (head +2): v.normal = f32(v.normal + pl.N)   // per component
}
BuildPhongTable(Real48(+0x82), Real48(+0x86), Real48(+0x8a), Real48(+0x8e))   // 186a:26a6
```
The normals are not normalised; CosAngle normalises. Since vertices are shared (dedup), a normal is the area-weighted sum over the adjacent faces. The Phong table is rebuilt every frame from this mesh's parameters.

### 1342:3518 TPolyObject.Draw(self), retf 4: per-frame draw, 28 callers (every 3D part)
```
if (!(flags & 0x200) && byte DS:9fa4 == 0) {
  for (i = 0; i <= Count-1; i++) faces.At(i).ComputeDepth()   // 1d97
  SortFaces(0, Count-1)
}
DS:5a9c = (flags & 0x400) ? 1 : 0
if ((flags & 0x18) == 0x18) CalcVertexNormals()
else if ((flags & 0x18) == 0x10) for each vertex in the mesh list (count +0x3e): v.+0x2a = 0
for (i = 0; i <= Count-1; i++) faces.At(i).Draw()            // 251d
```
Note: shading per face uses the face's own flags (+0x7b). The mesh's +0x92 bits 0x18 only decide the per-frame preparation. Usual sequence in a part: transform (RotateWork etc., L3_3d_a), then Draw, then present the page.

### 1342:364d TGroup.Init(limit: int16 [bp+0xc]), constructor (VMT [bp+0xa], self), retf 8
`TPolyObject.Init(limit, flags = 0x100, minColor = 0, maxColor = 0); members(+0x94).Init(1, 0)`. Callers 0000:8e9f, 1117:2121.

### 1342:368e TGroup.Done (VMT+8): `members.Done(0)` (frees the member objects), then `TPolyObject.DoneFree(self)` (29cf).

### 1342:36ba TGroup.AddMesh(m [bp+0xa]: ^TPolyObject; self), retf 8
```
for (i = 0; i <= m.faces.Count-1; i++) {
  f = m.faces.At(i)
  self.faces.Insert(f)
  f.flags(+0x7b) = (f.flags | self.+0x92) & 0xff
}
for each vertex v in m's list: self.Append(v)        // no dedup
members.Insert(m)
```
After this, drawing the group sorts all the faces of all the members together. The members are still transformed individually (their vertices are shared). Callers 0000:912e, 1117:2275.

### 1342:377c TMesh.DrawAll (VMT+0x10 of TStarfield), retf 4: for each list item: virtual Draw (VMT+0xc).
### 1342:37be TMesh.EraseAll (VMT+0x14), retf 4: for each item: TPixel.Erase (0745), which putPixels DS:5d94 at the stored sx, sy.
### 1342:37fe TMesh.EraseDrawAll (VMT+0x18), retf 4: for each item: 0760 (erase, then virtual Draw).

### 1342:3846 TStar.Draw(self) (VMT+0xc of 240a), retf 4
```
if (self.+0x2a <= 0) return                          // signed int16: inactive star
b = int16(RoundS(wz) / 2 + 255)                      // longint div by 2 truncates toward 0; low word. wz < 0, so b = 255 - |z|/2
mode = byte DS:5a8f
if (mode == 0 || mode == 1) {
  x = wx; y = wy
  if (!Perspective(x, y, wz)) return
  b = clamp(b, int16 DS:5a90, int16 DS:5a92)        // min first, then max, signed
  sx = int16(RoundS(x) + cx); sy = int16(RoundS(y) + cy); store in +0x1a/+0x1c
  putPixel(sx, sy, b & 255)
  if (mode == 1 && wz > -200.0) {                    // cs:383e = -200.0
    b2 = b / 2                                       // signed idiv, truncates
    if (b2 < DS:5a90) b2 = DS:5a90                   // no upper clamp
    putPixel(sx-1, sy, b2); putPixel(sx+1, sy, b2); putPixel(sx, sy-1, b2); putPixel(sx, sy+1, b2)   // this order
  }
} else {                                             // streak mode
  b = clamp(b, DS:5a90, DS:5a92)
  t = int16(DS:9118 - 500)                           // 16-bit wrap, then to float
  zz = (float(t) < wz) ? f32(wz - float(DS:9118)) : -500.0      // cs:3842 = -500.0
  tz = int16(RoundS(zz))
  x = wx; y = wy; Perspective(x, y, float(tz))       // result ignored (x, y stay unscaled when it fails)
  x0 = int16(RoundS(x) + cx); y0 = int16(RoundS(y) + cy)
  tz2 = int16(RoundS(wz))
  x = wx; y = wy; Perspective(x, y, float(tz2))      // result ignored
  +0x1a = int16(RoundS(x) + cx); +0x1c = int16(RoundS(y) + cy)
  line(+0x1a, +0x1c, x0, y0, b & 255)                // 186a:185f, clipped
}
```
In streak mode the star's own z is rounded to an integer before projection. The tail point is DS:9118 units farther away, with its z clamped to at least -500.

### 1342:3bc4 TStarfield.Init(count [bp+0x10], minB [bp+0xe], maxB [bp+0xc]: int16), constructor (VMT [bp+0xa], self), retf 0xc
```
TMesh.Init
+0x40 = minB; +0x42 = maxB; DS:5a90 = minB; DS:5a92 = maxB
for (i = 1; i <= count; i++) {
  rx = Random(500); ry = Random(500); rz = Random(500)            // in this order, each 0..499
  s = new TStar(f32(rx - 250.0), f32(ry - 250.0), -float(rz), color = 255)   // TPixel.Init with VMT 240a; cs:3bc0 = 250.0
  Append(s)
}
```
Caller 0000:41eb. The positions depend on Random (seeded by Randomize, so they differ per run).

### 1342:3ce1 TStarfield.Move(speed: int16 [bp+0xa]; self), retf 6
```
if (speed < 0x7ff8) +0x5f = speed            // 0x7ff8 and above = "keep speed, stop respawning"
for each star s:
  s.MovePos(0, 0, float(+0x5f))              // pos.z += speed; work = pos
  if (+0x5f > 0) {
    onScreen = (0 <= s.sx <= 320) && (0 <= s.sy <= 200) && !(float(D) < s.wz)   // sx/sy from the LAST draw; hard-coded 320x200, inclusive
    if (!onScreen) {
      if (speed < 0x7ff8) s.SetPos(f32(Random(500) - 250.0), f32(Random(500) - 250.0), -500.0)   // x first; cs:3cd9 = 250.0
      else { s.SetPos(-100.0, -100.0, 0.0); s.+0x2a = 0 }                                       // deactivate
    }
  } else {
    if (s.wz < -500.0) s.SetPos(f32(Random(500) - 250.0), f32(Random(500) - 250.0), 100.0)      // cs:3cdd = -500.0
  }
```
8 callers (0000:3a39..4ddc). The test uses `speed`, the argument, not +0x5f, when choosing between respawn and deactivate.

### 1342:3ec7 TExplosion.Init(count: int16 [bp+0xc]), constructor (VMT [bp+0xa], self), retf 8
```
TMesh.Init; +0x59 = 0
for (i = 1; i <= count; i++) {
  x = f32((Random(200) - 100) / 40.0)       // int32 then extended division by f32 40.0 (cs:3ebf)
  y = f32((Random(200) - 100) / 40.0)
  z = f32((Random(200) - 100) / 40.0)
  if (Random(30) == 0) p = new TBigPixel(x, y, z, 252)    // VMT 23aa (drawDot)
  else                 p = new TPixel(x, y, z, 252)       // VMT 239a (putPixel)
  vx = f32((Random(20000) - 10000) / 2000.0)              // cs:3ec3 = 2000.0
  vy = ...; vz = ...                                      // same, in this order
  p.SetVelocity(vx, vy, vz)
  Append(p)
}
```
Random call order per particle: 3 x Random(200), Random(30), 3 x Random(20000). Caller 0000:41fd.

### 1342:4080 TExplosion.Step(self), retf 4: `+0x59++` (16-bit), then for each particle: `p.Step()` (066e: pos += velocity, work = pos). Caller 0000:454c.

### 1342:40c4 TExplosion.Draw (VMT+0x10 of 2436), retf 4
```
if (+0x59 < 50) DrawAll()                  // unsigned compare, 0x32
else for each particle p:
  if (p.+0x2a > 100) { p.+0x2a -= 5; p.Draw() }   // signed; the colour drops 252, 247, ... and the particle disappears at <= 100
```
The draw projects `work`. Callers must have applied any RotateWork/Translate themselves.

### 1342:412a TLightDir.Init(x1 [bp+0x16], y1 [bp+0x14], z1 [bp+0x12], x2 [bp+0x10], y2 [bp+0xe], z2 [bp+0xc]: int16), constructor (VMT [bp+0xa], self), retf 0x12
```
TMesh.Init (zero-fills, so +0x6d = 0)
A = new TPixel(float(x1), float(y1), float(z1), color = +0x6d) ; +0x59 = A
B = new TPixel(float(x2), float(y2), float(z2), color = +0x6d) ; +0x5d = B
Append(A); Append(B)
Update(0.0, 0.0, 0.0)                        // 421b
```
Only called from 4467 (the static instance at DS:55f6, VMT 2452).

### 1342:421b TLightDir.Update(ax [bp+0x12], ay [bp+0xe], az [bp+0xa]: single; self), retf 0x10
```
RotateWork(ax, ay, az)                       // 1466: rotates A and B (work) about the pivot (0,0,0 unless changed)
A = head.item; B = tail.item
+0x61 = RoundS(f32((B.wx - A.wx) * 1024.0))  // int32, cs:4217 = 1024.0
+0x65 = RoundS(f32((B.wy - A.wy) * 1024.0))
+0x69 = RoundS(f32((B.wz - A.wz) * 1024.0))
EdgeInit(A, B, edge at +0x6e)
```
For the static object this sets DS:5657/565b/565f (Lx, Ly, Lz) and the edge at DS:5664. Callers: 0000:0052 (with 0,0,0), 0000:306e, 0a69:0678, 0a69:0956 (the parts that rotate the light).
**Default light** (A = (0,0,0), B = (0,0,-1), no rotation): L = (0, 0, -1024). Edge: B.wx > A.wx is false, so edge.A = B, edge.B = A, and dir = (0, 0, +1). Note that the edge direction is always ordered by x (EdgeInit), so after a rotation it can point opposite to L. Port EdgeInit literally.

### 1342:4308 TLight.Init(x [bp+0x1a], y [bp+0x16], z [bp+0x12], radius [bp+0xe]: single; color: byte [bp+0xc]), constructor (VMT [bp+0xa], self), retf 0x18
`TPixel.Init(x, y, z, color); SetRadius(radius)`. Callers 0000:022e, 0000:7e47.
### 1342:4352 TLight.SetRadius(r: single [bp+0xa]; self), retf 8: `+0x2c = r; +0x30 = f32(r * 20000.0)` (cs:434e = 20000.0).
### 1342:4378 TLight.Draw (VMT+0xc of 2462), retf 4
`x = wx; y = wy; Perspective(x, y, wz)` (the result is IGNORED: the branch jumps to the next instruction either way); `+0x1a = int16(RoundS(x) + cx); +0x1c = int16(RoundS(y) + cy); drawDot(+0x1a, +0x1c, +0x2a & 255)` (186a:1a2a).

### 1342:4400 AddLight(l: ^TLight [bp+6]), retf 4
`DS:5a8c++` (byte); `lights[DS:5a8c] = l` (DS:568c + 4*count). No bound check. The returned AL is an uninitialised local (ignore it). Callers 0000:0235, 0000:7e4e.

### 1342:4427 FreeLights(), retf 0
`for (i = 1; i <= DS:5a8c; i++) lights[i].Done(1)` (virtual +8, dispose), then `DS:5a8c = 0`. Callers 0000:020c, 3057, 7e27, 0a69:06ce.

### 1342:4467 InitDefaultScene() (near, called only by 4540)
```
TLightDir.Init(DS:55f6, VMT 2452, 0,0,0, 0,0,-1)       // static light-direction object -> L = (0,0,-1024)
FreeLights()
l = new TLight(x = 0.0, y = 0.0, z = 200.0, radius = 500.0, color = 255)    // VMT 2462; falloff = 1.0e7
AddLight(l)                                           // light count = 1
DS:5a94 = new TPixel(0, 0, float(D), 0)               // VMT 239a; D = 200 here
DS:5a98 = new TPixel(0, 0, float(D), 0)
BuildPhongTable(0.0, 0.0, 255.0, 1.0)                 // Real48 immediates: (0,0,0), (0,0,0), (ax=0x88,bx=0,dx=0x7f00) = 255.0, (ax=0x81) = 1.0
```
Default Phong table: `table[ang] = RoundHalfEven(255*cos(ang deg))` for ang = 0..90 (with Power(c, 1) = c).

### 1342:4540 Unit init (far, called from main at 0000:a657)
```
SetPerspective(200)                                   // DS:5548 = 200
DS:5bf4 = DS:5bf0 div 2; DS:5bf6 = DS:5bf2 div 2      // signed idiv; the video mode setter recomputes these later
TPixel.Init(DS:551c, VMT 239a, 0.0, 0.0, 0.0, color 15)
DS:5a8f = 1                                           // star mode: plus-shaped
DS:5a9c = 0
InitDefaultScene()
```

## Porting notes

- Per frame, for a TPolyObject: transform the vertices (`work`), then `Draw` (3518). Draw computes the depth (sum of z), quicksorts ascending (farthest first), prepares the shading (normals, or clears the Gouraud cache), then draws each face. Each face: project, cull if any vertex has z >= D, cull if no vertex is inside the clip rectangle (unless flag 0x80), cull backfaces by the sign of a 2D cross product (int32 math, flip with mesh flag 0x400), shade, fill.
- The colour of each face is fixed when it is added (minColor + index*step), unless mode 8 (flat Lambert) overwrites it each frame with `minColor + |(maxColor-minColor)*dot/1024| / len`, clamped to maxColor (see 1e1a in L3_3d_a). With the default light, dot = -nz, so the brightness depends on |nz|.
- Mode 0x18 shading: angle between the vertex normal and the light edge direction (or the vector to light 1 if there are lights), in integer degrees 0..90, then `table[angle]` (DS:90bc). The table comes from the mesh's 4 Phong floats every frame.
- Mode 0x10 shading: per vertex, the sum of `255 - d^4/(20000*r + 1)` over the lights minColor..maxColor (the face's min/max bytes are reused as light indices), cached per vertex per frame.
- Screen coordinates: `RoundHalfEven(x * D/(D - z)) + centre`, kept as int16.
- The polygon buffer passed to the 186a fillers is `pts[1..4]` = 4 records of {x, y, c, unused} int16 at DS:5ac2. Triangles duplicate pts[3] into pts[4].
- The .ASC loader and the procedural object builders that call 2d43/3129/2c6c are in segment 0e5a, outside this slice.
