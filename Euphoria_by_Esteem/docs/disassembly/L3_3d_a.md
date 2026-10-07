# L3_3d_a: segment 1342, 1342:0000 to 1342:2000 (the 3D engine unit, first half)

The last function, 1342:1e1a (face shading), starts at 1e1a and ends at 1342:208f, so it is documented in full here.

## Summary

This half of the 3D unit holds:
- the float rotation matrix (Euler angles in degrees, float32 sin/cos products) and the perspective projection;
- `TPoint`/`TPixel`: a point object with "work" (transformed) and "pos" (model) coordinates, plus screen coordinates, velocity and colour;
- `TMesh`: a BP7 object holding a singly linked list of point objects, an embedded origin point and pivot point, and the translate, scale and rotate methods (some permanent, some only to the "work" coordinates);
- `TLine` (a 2-point mesh drawn as a 2D line);
- `TWireMesh` (a mesh plus a TCollection of TLines, with deduplicated shared vertices);
- `TFace` (a 3- or 4-vertex polygon): constructor, vertex set, depth (z sum) for sorting, and flat shading from an integer normal dotted with a light vector;
- small helper records (Edge, Plane) and a cosine-of-angle helper used by lighting code later in the segment.

No .ASC parsing or procedural mesh builders are in this range. The cube/mesh generators are at 1342:2d43 and 1342:3018 (they create TPixel and TFace objects), and the parser is probably near 1342:209b through 1342:287c. Those belong to the other slice.

All "float" below means **IEEE single (float32)**: every `fstp dword` rounds to float32. Intermediate products and sums inside one expression run at x87 extended precision and are rounded only when stored. For bit-faithful JS, compute an expression in doubles and apply `Math.fround` at each store I mark with `f32(...)`. Doubles are close enough to extended for this.

### External calls
| addr | meaning |
|---|---|
| 1d81:32ba / 32bf | Sin / Cos (ST0 -> ST0, extended) |
| 1d81:32b6 | Sqrt |
| 1d81:31e5 | Real48 (DX:BX:AX) -> ST0 |
| 1d81:320f | ST0 -> Real48 |
| 1d81:3d77 | Move(src, dst, count) |
| 1d81:3d8f | longint multiply (DX:AX * BX:CX), 32-bit wrap |
| 1d81:3dcc | longint div (DX:AX / BX:CX), truncation toward 0 |
| 1d81:028a / 029f | GetMem / FreeMem |
| 1d81:32d3 | constructor prologue (allocates if Self=nil, stores VMT word at Self+0) |
| 1d81:3317 | destructor epilogue (FreeMem if the destructor was called with free flag) |
| 1813:0000 | TObject.Init (Objects unit): zero-fills the whole object after the VMT word (size from VMT minus 2) |
| 1813:0031 | TObject.Done |
| 1813:0101 | TCollection.Init(ALimit, ADelta) |
| 1813:0172 | TCollection.At(index) -> pointer |
| 1813:0248 | TCollection.DeleteAll |
| TCollection VMT+0x1c | Insert(item) |
| 186a:1634 | PutPixel(x:int, y:int, c:byte). Clipped to x in [DS:5bfa..DS:5bfe], y in [DS:5bfc..DS:5c00] (inclusive, signed). Writes byte to `bufferPtr(DS:5c22) + rowOfs[y] + x`, where rowOfs is the dword table at DS:9122 (low word used) |
| 186a:1a2a | DrawBigDot(x, y, c): a small multi-line "ball" sprite built from horizontal spans (186a:1995) using colours c, c+1, ... (see the 186a notes) |
| 186a:185f | Line(x1, y1, x2, y2, c) |
| near `call 0` (1342:0000) | RoundS(x: single): longint. Not translated by the listing (still raw 8087-emulator INT 35h/37h bytes): `fld dword [bp+4]; frndint; fistp dword [bp-4]; return DX:AX`. This is round-to-nearest-even (default FPU control word) and is used everywhere for screen coordinates. JS: `roundHalfEven(x)`, then truncate to the size the caller needs (usually the low 16 bits). |

### Globals (DS offsets)
| DS | type | name / meaning |
|---|---|---|
| 238a | float32 = 0.01745329238474369 | DEG2RAD (initialised data) |
| 5548 | int16 | `persp_D`, the viewer distance. Set by 1342:0271. BSS, so 0 until set |
| 5a8d | byte | `freeItemsOnDone` flag, used by TMesh.Done |
| 5a9e..5ac1 | 9 x float32 | rotation matrix `M[0..8]`, row-major (M0 5a9e, M1 5aa2, M2 5aa6, M3 5aaa, M4 5aae, M5 5ab2, M6 5ab6, M7 5aba, M8 5abe) |
| 5bf4 / 5bf6 | int16 | screen centre X / Y. Set in 0b1a:0163 (60,35) and 186a:0200/0289 (per video mode) |
| 5d94 | byte | background colour used for erasing pixels. Set to 0 at 186a:3be2 |
| 5657 / 565b / 565f | longint (int32) | light vector Lx / Ly / Lz for TFace.Shade. **No write to these addresses was found anywhere in the listing** (no direct store, push or lea of 0x5657). If they really are never written they stay 0, so every face gets colour = minColor (see 1e1a). Whoever reads the other 1342 slice and the parts should confirm |
| 911e / 9120 | word, word | zeroed by the TFace constructor. They form a far pointer used by 186a (polygon/span code at 186a:2e5c, 338f...). GUESS: the polygon-filler span-list pointer |

### VMTs (DS) and object sizes
Standard BP7 VMT: +0 size, +2 -size, +4 DMT, +6 0, then method pointers from +8 (far).

| VMT | size | +8 | +0xC | object |
|---|---|---|---|---|
| 238e | 0x1a | 1813:0031 Done | none | TPoint |
| 239a | 0x2c | Done | 1342:06bd Draw (PutPixel) | TPixel |
| 23aa | 0x2c | Done | 1342:0786 Draw (BigDot) | TBigPixel (TPixel with another Draw) |
| 23ba | 0x62 | 1342:0b62 Done | 1342:0bff DoneFree | TLine (TMesh descendant) |
| 23ca | 0x67 | 1342:1ab6 Done | 1342:1af5 DoneFree | TWireMesh |
| 23da | 0x7c | 0b62 | 0bff | TFace (polygon) |
| 23ea | 0x94 | 1342:2906 | 1342:29cf | (other slice; TMesh with faces, used by most parts) |
| 23fa | 0xa0 | 1342:368e | 29cf | (other slice) |
| 240a | 0x2c | Done | 1342:3846 | another TPixel kind (other slice) |
| 241a | 0x61 | 0b62, 0bff, +0x10 377c, +0x14 37be, +0x18 37fe | | (other slice) |
| 2436 | 0x5b | 0b62, 0bff, 40c4, 37be, 37fe | | (other slice) |
| 2452 | 0x9a | 0b62, 0bff | | (other slice) |
| 2462 | 0x34 | Done | 1342:4378 | (other slice) |
| 2474 | 0x0c | | | TCollection (Objects unit) |

There is no separate VMT for the bare TMesh. TMesh is only used as an ancestor, and TLine and TFace reuse its Done methods.

## Record layouts (offsets in bytes, all little-endian)

### TPoint (size 0x1a, VMT 238e)
```
+0x00 word   VMT
+0x02 f32 wx, +0x06 f32 wy, +0x0a f32 wz   "work" coords: transformed/rotated coords, the ones projected
+0x0e f32 px, +0x12 f32 py, +0x16 f32 pz   "pos" coords: model/base position
```
### TPixel (size 0x2c, VMT 239a or 23aa) = TPoint +
```
+0x1a int16 sx, +0x1c int16 sy   last projected screen coords (only updated when visible)
+0x1e f32 vx, +0x22 f32 vy, +0x26 f32 vz   velocity
+0x2a word color (only the low byte is used)
```
### List node (heap, 8 bytes, GetMem(8))
```
+0 far ptr item   (a TPoint/TPixel, or for other users any object)
+4 far ptr next
```
### TMesh (base, no own VMT; descendants are 0x62 and up)
```
+0x00 word   VMT
+0x02 farptr head node
+0x06 farptr tail node
+0x0a TPoint origin (embedded, VMT 238e): origin.work at +0x0c/+0x10/+0x14, origin.pos at +0x18/+0x1c/+0x20
+0x24 TPoint pivot  (embedded):           pivot.work at +0x26/+0x2a/+0x2e, pivot.pos at +0x32/+0x36/+0x3a
+0x3e int16 count (items in the list)
+0x40 word  = 0 at init     (meaning unknown in this range)
+0x42 word  = 0xff at init  (meaning unknown in this range)
+0x44 int16 angX, +0x46 int16 angY, +0x48 int16 angZ   last rotation angles, rounded (1342:1742)
+0x4a f32 velX, +0x4e f32 velY, +0x52 f32 velZ        last translation, re-applied by 16da
+0x56..0x58  unused here
```
### TLine (size 0x62, VMT 23ba) = TMesh +
```
+0x59 int16 sx1, +0x5b int16 sy1, +0x5d int16 sx2, +0x5f int16 sy2   projected screen coords
+0x61 byte color
list: head.item = endpoint 1, tail.item = endpoint 2 (two nodes)
```
### TWireMesh (size 0x67, VMT 23ca) = TMesh +
```
+0x59 TCollection lines: +0x59 VMT, +0x5b Items ptr, +0x5f Count (int16), +0x61 Limit, +0x63 Delta
+0x66 byte color
list: unique vertices (TPixel), shared with the lines
```
### TFace (size 0x7c, VMT 23da) = TMesh +
```
+0x59 farptr v1, +0x5d v2, +0x61 v3, +0x65 v4   (vertex i at +0x55 + 4*i, i = 1..4; triangles have v4 == v3)
+0x69 f32 depth  (sum of work.z)
+0x6d byte depthLocked: if != 0, ComputeDepth does nothing. Set to 0 by the constructor
+0x6e farptr extraA, +0x72 farptr extraB   (set by 1d6d; meaning outside this range. GUESS: neighbour faces or a texture/edge object)
+0x76 unused here
+0x77 int16 color (current flat-shade colour)
+0x79 byte minColor, +0x7a byte maxColor
+0x7b byte flag (first constructor arg; meaning outside this range, GUESS: draw mode/type)
list: vertex pointers appended in order (3 or 4 nodes), count at +0x3e
```
### Edge record (0x2c bytes, no VMT; built by 080e)
```
+0x00 farptr p1, +0x04 farptr p2   (TPoint pointers)
+0x08 f32[3] A = work coords of the endpoint with the smaller x (p1 when p2.wx > p1.wx, else p2)
+0x14 f32[3] B = work coords of the other endpoint
+0x20 f32[3] dir = B - A
```
### Plane record (0x34 bytes, no VMT; built by 08fe)
```
+0x00 f32[3] P0 = p0.work
+0x0c f32[3] U = p1.work - p0.work
+0x18 f32[3] V = p2.work - p0.work
+0x24 f32[3] N = U x V
+0x30 f32    d = P0 . N
```

## Functions

Argument notation: `[bp+N]` is the stack slot. Far procs: the first Pascal argument is at the highest offset. "self" is at [bp+6].

### 1342:0000 RoundS(x: single [bp+4]): longint (near)
Described in the external call table: `frndint` + `fistp dword`, round half to even.

### 1342:0019 SetRotation(ax [bp+0xe], ay [bp+0xa], az [bp+6]: single), far, retf 0xc
```
a = f32(ax*DEG2RAD); b = f32(ay*DEG2RAD); c = f32(az*DEG2RAD)   // DEG2RAD = f32 DS:238a = 0.017453292...
s1=f32(sin a) s2=f32(sin b) s3=f32(sin c) c1=f32(cos a) c2=f32(cos b) c3=f32(cos c)
t1=f32(s1*s2) t2=f32(c1*c2) t3=f32(s1*c2) t4=f32(c1*s2)
M0 = f32(c2*c3)
M1 = s3
M2 = f32(-s2*c3)
M3 = f32(t1 - t2*s3)
M4 = f32(c1*c3)
M5 = f32(t4*s3 + t3)
M6 = f32(t3*s3 + t4)
M7 = f32(-s1*c3)
M8 = f32(t2 - t1*s3)
```
Writes DS:5a9e..5abe. Also called from 0bcf:154c.

### 1342:0179 RotatePoint(var x [bp+0xe], var y [bp+0xa], var z [bp+6]: single), retf 0xc
Uses the original x, y, z for all three rows:
```
x' = f32((M0*x + M2*z) + M1*y)
y' = f32((M3*x + M5*z) + M4*y)
z' = f32((M6*x + M8*z) + M7*y)
```
(The addition order comes from the faddp sequence and only matters at the extended-precision level.)

### 1342:020e Perspective(var x [bp+0xe], var y [bp+0xa]: single; z [bp+6]: single): boolean, retf 0xc
```
if (float(persp_D) > z) {               // persp_D = int16 DS:5548
   f = f32(persp_D / (persp_D - z))
   x = f32(x*f); y = f32(y*f); return true
} else return false                     // x, y untouched
```
So the camera looks down -z: points with z >= D are culled. Larger z means closer (scale grows as z approaches D).

### 1342:0271 SetPerspective(D: int16 [bp+6]), retf 2: `DS:5548 = D`. Called from 1342:4547.

### 1342:0282 ZeroVec(var x [bp+0xe], var y [bp+0xa], var z [bp+6]), retf 0xc: all three = 0.0 (cs:027e = 0.0). No callers.

### 1342:02be AddAngles(var ax [bp+0x1a], var ay [bp+0x16], var az [bp+0x12]; dx [bp+0xe], dy [bp+0xa], dz [bp+6]: single), retf 0x18
For each of the three (a, d) pairs, in the order x, y, z:
```
a = f32(a + d)
if (a > 360.0) a = f32(a - 360.0)
if (a < 0.0)   a = f32(360.0 - a)   // sic: this yields 360 + |a|, not a + 360. Keep it for faithfulness
```
Constants: cs:02b6 = 360.0, cs:02ba = 0.0 (float32). No callers in the listing.

### 1342:03ef MakeVec(x [bp+0x12], y [bp+0xe], z [bp+0xa]: single; var v [bp+6]: Vec3), retf 0x10
`v[0]=x; v[1]=y; v[2]=z` (float32 at +0, +4, +8). Called from 1342:33ad.

### 1342:0419 TPoint.Init(x [bp+0x14], y [bp+0x10], z [bp+0xc]: single), constructor (VMT word [bp+0xa], self [bp+6]), retf 0x12
`TObject.Init` (zero-fills), then `SetPos(x, y, z)`. Returns self.

### 1342:0456 PosEqual(a [bp+0xa], b [bp+6]: ^TPoint): boolean, retf 8
Returns true when `a.px==b.px && a.py==b.py && a.pz==b.pz` (exact float compare of the **pos** fields +0xe/+0x12/+0x16).

### 1342:04bf TPoint.SetPos(x [bp+0x12], y [bp+0xe], z [bp+0xa]; self), retf 0x10
`pos = (x, y, z); work = pos` (Move of 12 bytes from +0xe to +2).

### 1342:0500 TPoint.MovePos(dx, dy, dz; self), retf 0x10
`pos += d` (each f32); `work = pos`.

### 1342:0550 TPoint.RotateAround(cx [bp+0x1e], cy [bp+0x1a], cz [bp+0x16], ax [bp+0x12], ay [bp+0xe], az [bp+0xa]; self), retf 0x1c
```
work = f32(pos - c)     // per component
SetRotation(ax, ay, az)
RotatePoint(work.x, work.y, work.z)
SetPos(f32(c.x + work.x), f32(c.y + work.y), f32(c.z + work.z))   // permanent: pos and work both become the rotated point
```

### 1342:0604 TPixel.Init(x [bp+0x16], y [bp+0x12], z [bp+0xe]: single; color: byte [bp+0xc]), constructor (VMT [bp+0xa], self [bp+6]), retf 0x14
`TPoint.Init(x, y, z)`, then `+0x2a = color` (zero-extended word). Returns self.
Typical call: `new TPixel(x, y, z, color)` with VMT 239a.

### 1342:0643 TPixel.SetVelocity(vx, vy, vz; self), retf 0x10: +0x1e/+0x22/+0x26.
### 1342:066e TPixel.Step(self), retf 4: `SetPos(f32(px+vx), f32(py+vy), f32(pz+vz))`.

### 1342:06bd TPixel.Draw(self), VMT+0xc of 239a, retf 4
```
x = wx; y = wy
if (Perspective(x, y, wz)) {
   sx = int16(RoundS(x) + int16(DS:5bf4))   // longint add, low word kept
   sy = int16(RoundS(y) + int16(DS:5bf6))
   PutPixel(sx, sy, color & 0xff)           // 186a:1634, clipped
}
```
### 1342:0786 TBigPixel.Draw(self), VMT+0xc of 23aa
Same as 06bd, but calls 186a:1a2a DrawBigDot(sx, sy, color).

### 1342:0745 TPixel.Erase(self), retf 4: `PutPixel(sx, sy, DS:5d94)`. Uses the stored sx/sy, so the pixel last drawn is erased.
### 1342:0760 TPixel.EraseAndDraw(self): `PutPixel(sx, sy, DS:5d94)`, then virtual Draw (VMT+0xc).

### 1342:080e EdgeInit(p1 [bp+0xe], p2 [bp+0xa]: ^TPoint; var e [bp+6]: Edge), retf 0xc
```
e.p1 = p1; e.p2 = p2
if (p2.wx > p1.wx) { e.A = p1.work; e.B = p2.work } else { e.A = p2.work; e.B = p1.work }
e.dir = f32(e.B - e.A)
```
Called from 1342:22df and 1342:4301.

### 1342:08fe PlaneInit(p0 [bp+0x12], p1 [bp+0xe], p2 [bp+0xa]: ^TPoint; var pl [bp+6]: Plane), retf 0x10
```
P0 = p0.work; U = f32(p1.work - p0.work); V = f32(p2.work - p0.work)
N.x = f32(U.y*V.z - U.z*V.y)
N.y = f32(U.z*V.x - U.x*V.z)
N.z = f32(U.x*V.y - U.y*V.x)
d   = f32(P0.x*N.x + P0.y*N.y + P0.z*N.z)
```
Called from 1342:3435 and 345b.

### 1342:0a3a CosAngle(e: Edge (passed by reference [bp+0xa], 0x2c bytes copied locally); pl [bp+6]: ^Plane): single, retf 8
```
dot = f32(N.x*e.dir.x + N.y*e.dir.y + N.z*e.dir.z)
ln  = f32(sqrt(N.x^2 + N.y^2 + N.z^2))
le  = f32(sqrt(dir.x^2 + dir.y^2 + dir.z^2))
return f32(dot / (ln*le))      // no zero check: division by zero gives Inf/NaN on the FPU (exceptions masked)
```
Despite the name of the first argument, only `e.dir` (record offsets +0x20..+0x28) is read, so any 0x2c-byte record with a vector at +0x20 works. Caller 1342:2306 passes a record at DS:5664 (probably a light direction). Caller 1342:22ed takes fabs() of the result.

### 1342:0afa TMesh.Init, constructor (VMT [bp+0xa], self [bp+6]), retf 6
```
TObject.Init (zero all)
+0x40 = 0; +0x42 = 0xff
origin(+0x0a).Init(0, 0, 0) with VMT 238e
pivot (+0x24).Init(0, 0, 0) with VMT 238e
```
### 1342:0b62 TMesh.Done (destructor, VMT+8) (free flag [bp+0xa], self [bp+6]), retf 6
```
pivot.Done(0); origin.Done(0)          // virtual VMT+8
node = head
while (node) {
  if (DS:5a8d != 0) node.item.Done(1)  // virtual, dispose item
  next = node.next; FreeMem(node, 8); node = next
}
TObject.Done; destructor epilogue
```
### 1342:0bff TMesh.DoneFree (VMT+0xc), retf 6: `DS:5a8d = 1; self.Done(0)` (virtual), then epilogue. The flag is left at 1.

### 1342:0c20 TMesh.Append(item [bp+0xa]: pointer; self), retf 8
`node = GetMem(8); node.item = item; node.next = nil; if (head == nil) head = node else tail.next = node; tail = node; count++`.

### 1342:0c99 TMesh.AddUnique(var item [bp+0xa]: ^TPoint; self), retf 8
```
if (head == nil) { Append(item); return }
for (node = head; node; node = node.next)
   if (PosEqual(item, node.item)) { found = node; break }
if (!found) Append(item)
else if (found.item != item) { item.Done(1) /* dispose the duplicate */; item = found.item }
```
This is how wire meshes share vertices: a duplicate (same pos) is disposed and replaced by the existing vertex.

### 1342:0d74 NextNode(var node [bp+0xa]; self [bp+6] unused): boolean, retf 8
`if (node) node = node.next; return node != nil`. No callers by name (1342:2ce4 calls it).

### 1342:0db6 TMesh.MoveTo(x [bp+0x12], y [bp+0xe], z [bp+0xa]; self), retf 0x10
```
d = f32((x,y,z) - origin.work)            // origin.work at +0x0c/+0x10/+0x14
origin.SetPos(x, y, z)
for each item: item.pos = f32(item.pos + d); item.work = item.pos
pivot.SetPos(f32(pivot.work.x + d.x), ...)  // pivot.work at +0x26/+0x2a/+0x2e
```
### 1342:0ed1 TMesh.Translate(dx, dy, dz; self), retf 0x10
```
origin.SetPos(f32(origin.work + d))
for each item: item.pos = f32(item.pos + d); item.work = item.pos
pivot.SetPos(f32(pivot.work + d))
SetVelocity(dx, dy, dz)   // 1761: remembers d in +0x4a/+0x4e/+0x52
```
### 1342:1004 TMesh.SetPivot(x, y, z; self): `pivot.SetPos(x, y, z)`.
### 1342:102a TMesh.PivotToOrigin(self): `pivot.SetPos(origin.work)`.
### 1342:1056 TMesh.MoveToPivot(self): `MoveTo(pivot.work.x, pivot.work.y, pivot.work.z)`.
### 1342:1082 TMesh.Center(self), retf 4
```
sx = sy = sz = 0.0 (f32, cs:107e)
for each item: sx = f32(sx + item.wx); sy = f32(sy + item.wy); sz = f32(sz + item.wz)
sx = f32(sx / count); ...                  // count = int16 +0x3e; count 0 gives NaN
origin.SetPos(sx, sy, sz); pivot.SetPos(sx, sy, sz)
```
### 1342:1184 TMesh.ScaleUniform(s: single [bp+0xa]; self), retf 8
Converts s to Real48 (exact for f32 values) and calls `Scale(s, s, s)`.

### 1342:11b8 TMesh.Scale(sx [bp+0x16], sy [bp+0x10], sz [bp+0xa]: Real48; self), retf 0x16 (permanent)
```
for each item:
   d = f32(item.pos - pivot.work)
   item.SetPos(f32(sx*d.x + pivot.work.x), f32(sy*d.y + pivot.work.y), f32(sz*d.z + pivot.work.z))
origin: same formula using origin.pos (+0x18/+0x1c/+0x20), then origin.SetPos(...)
```
### 1342:1377 TMesh.ScaleWork(sx, sy, sz: Real48; self), retf 0x16 (non-permanent)
`for each item: item.work = f32(s*(item.pos - pivot.work) + pivot.work)` (with d stored as f32 first). Pos is unchanged and the origin is not touched.

### 1342:1466 TMesh.RotateWork(ax [bp+0x12], ay [bp+0xe], az [bp+0xa]: single; self), retf 0x10 (non-permanent, the per-frame transform)
```
SetRotation(ax, ay, az)
for each item:
   item.work = f32(item.pos - pivot.work)
   RotatePoint(item.work)
   item.work = f32(pivot.work + item.work)
```
Called from 1342:4236 and the parts.

### 1342:1566 TMesh.Rotate(ax, ay, az: single; self), retf 0x10 (permanent)
```
SetAngles(RoundS(ax), RoundS(ay), RoundS(az))     // 1742: low words into +0x44/+0x46/+0x48
SetRotation(ax, ay, az)
for each item: as RotateWork, then item.pos = item.work (Move 12 bytes from +2 to +0xe)
origin.RotateAround(pivot.work.x, pivot.work.y, pivot.work.z, ax, ay, az)   // 0550 on +0x0a
```
### 1342:16da TMesh.StepTranslate(self): `Translate(velX, velY, velZ)` (+0x4a/+0x4e/+0x52).
### 1342:1702 TMesh.StepRotate(self): `Rotate(float(angX), float(angY), float(angZ))` (int16 +0x44/+0x46/+0x48 via fild, then f32).
### 1342:1742 TMesh.SetAngles(a [bp+0xe], b [bp+0xc], c [bp+0xa]: int16; self), retf 0xa: +0x44=a, +0x46=b, +0x48=c.
### 1342:1761 TMesh.SetVelocity(vx, vy, vz: single; self), retf 0x10: +0x4a/+0x4e/+0x52.

### 1342:178c TMesh.GetItem(n: word [bp+0xa]; self): pointer, retf 6 (1-based)
```
if (n == 0) return nil                    // unsigned test (jbe 0)
i = 1; node = head
while (node && i != n) { i++; node = node.next }
if (i == n) return node.item             // sic: with head == nil and n == 1 this reads through a nil pointer
return nil
```
Callers: 0000:4fcd, 0000:6f53.

### 1342:1808 TLine.Init(x1 [bp+0x18], y1 [bp+0x16], z1 [bp+0x14], x2 [bp+0x12], y2 [bp+0x10], z2 [bp+0xe]: int16; color: byte [bp+0xc]), constructor (VMT [bp+0xa], self), retf 0x14
```
TMesh.Init
p = new TPixel(float(x1), float(y1), float(z1), color = self.+0x61)  // VMT 239a; +0x61 is still 0 here (zeroed), so the point colour is 0
Append(p)
p = new TPixel(float(x2), float(y2), float(z2), self.+0x61); Append(p)
+0x61 = color
```
### 1342:18e3 TLine.SetEndpoints(p1 [bp+0xe], p2 [bp+0xa]: ^TPixel; self), retf 0xc
`head.item.Done(1); tail.item.Done(1)` (dispose the line's own points), then `head.item = p1; tail.item = p2`.

### 1342:193c TLine.Draw(self), retf 4
```
a = head.item; b = tail.item
x1 = a.wx; y1 = a.wy; v1 = Perspective(x1, y1, a.wz)
x2 = b.wx; y2 = b.wy; v2 = Perspective(x2, y2, b.wz)
+0x59 = RoundS(x1) + cx; +0x5b = RoundS(y1) + cy; +0x5d = RoundS(x2) + cx; +0x5f = RoundS(y2) + cy  // int16 wrap; cx, cy = DS:5bf4, 5bf6
if (v1 && v2) Line(+0x59, +0x5b, +0x5d, +0x5f, color +0x61)   // 186a:185f
```
The screen coordinates are recomputed even when a point is culled (then the unprojected x/y are used), but the line is only drawn when both ends are visible. No near-plane clipping.

### 1342:1a74 TWireMesh.Init(limit: int16 [bp+0xe]; color: byte [bp+0xc]), constructor (VMT [bp+0xa], self), retf 0xa
`TMesh.Init; lines(+0x59).Init(ALimit=limit, ADelta=10)` with TCollection VMT 2474; `+0x66 = color`. Called from 0000:1e70.

### 1342:1ab6 TWireMesh.Done (VMT+8)
`lines.DeleteAll; lines.Done(0); DS:5a8d = 0; TMesh.Done(0)`. The lines and the vertices are not disposed: DeleteAll removes the lines without freeing them, and the flag is 0.

### 1342:1af5 TWireMesh.DoneFree (VMT+0xc)
`DS:5a8d = 0; lines.Done(0)` (TCollection.Done frees every TLine through its Done; with the flag 0 the shared vertices survive), then `DS:5a8d = 1; TMesh.Done(0)` (frees the vertices).

### 1342:1b2b TWireMesh.AddLine(x1 [bp+0x14], y1 [bp+0x12], z1 [bp+0x10], x2 [bp+0xe], y2 [bp+0xc], z2 [bp+0xa]: int16; self): ^TLine, retf 0x10
```
line = new TLine(0,0,0, 0,0,0, color +0x66)            // VMT 23ba
p1 = new TPixel(float(x1), float(y1), float(z1), color +0x66)  // VMT 239a
p2 = new TPixel(float(x2), float(y2), float(z2), color +0x66)
AddUnique(&p1); AddUnique(&p2)                        // dedupe against existing vertices by pos
line.SetEndpoints(p1, p2)
lines.Insert(line)                                    // TCollection virtual +0x1c
return line
```
Called from 0000:1f1e. Note that the TLine's own list nodes point at the shared vertices, while the mesh's list owns them. Transforming the TWireMesh (RotateWork etc.) moves the shared vertices, so the lines follow.

### 1342:1c3f TWireMesh.DrawLines(self), retf 4
`for (i = 0; i <= lines.Count - 1; i++) TLine(lines.At(i)).Draw()` (Count is the int16 at +0x5f, signed loop). Called from 0000:23d8.

### 1342:1c84 TFace.Init(flag [bp+0x12], minColor [bp+0x10], maxColor [bp+0xe], color [bp+0xc]: byte), constructor (VMT [bp+0xa], self), retf 0xe
```
TMesh.Init
+0x79 = minColor; +0x7a = maxColor; +0x77 = color (word, zero-extended)
+0x6d = 0; +0x7b = flag
DS:911e = 0; DS:9120 = 0      // global far pointer reset (see globals)
```
Callers: 1342:2f58, 1342:2fc9 (mesh generators in the other slice). VMT 23da.

### 1342:1cd4 TFace.SetVertices(v1 [bp+0x16], v2 [bp+0x12], v3 [bp+0xe], v4 [bp+0xa]: ^TPoint; self), retf 0x14
```
+0x59 = v1; +0x5d = v2; +0x61 = v3; +0x65 = v4
n = (v3 == v4 /* full far pointer compare */) ? 3 : 4
for (i = 1; i <= n; i++) Append(*(ptr*)(self + 0x55 + 4*i))
```
Callers: 1342:2f7f, 2ff0.

### 1342:1d6d TFace.SetExtra(a [bp+0xe], b [bp+0xa]: pointer; self), retf 0xc: `+0x6e = a; +0x72 = b`. Called many times from 0000:6978..6f1a, 0e5a:20e5.., 1342:2af9, 2d33.

### 1342:1d97 TFace.ComputeDepth(self), retf 4 (called from 1342:3562, the sort)
```
if (+0x6d != 0) return
depth(+0x69) = 0.0                  // cs:1d93 = 0.0
for (i = 1; i <= count /*+0x3e, signed*/; i++) depth = f32(depth + vert[i].wz)   // vert[i] = ptr at +0x55+4i
if (count < 4) depth = f32(depth + v3.wz)     // triangles count v3 twice, so all faces sum 4 z values
```
Larger depth means nearer to the viewer (Perspective treats z toward +D as closer). The sort direction is in the other slice.

### 1342:1e1a TFace.Shade(self), retf 4 (called from 1342:26ab), flat shading with integer math
```
u = f32(v2.work - v1.work)    // [bp-0x18..-0x20]
w = f32(v3.work - v1.work)    // [bp-0x24..-0x2c]
nx = RoundS(f32(u.y*w.z - u.z*w.y))    // int32
ny = RoundS(f32(u.z*w.x - u.x*w.z))
nz = RoundS(f32(u.x*w.y - u.y*w.x))
dot = (nz*Lz + ny*Ly + nx*Lx) / 1024     // int32 multiply/add with wraparound; division truncates toward 0. Lx/Ly/Lz = int32 DS:5657/565b/565f
len2 = nx*nx + ny*ny + nz*nz              // int32, wraps (a large normal can go negative and give a NaN sqrt)
len = RoundS(f32(sqrt(len2 as signed int32)))
if (len != 0) {
   c = int32(abs(int16(maxColor - minColor)) * dot) / len    // trunc toward 0
   c = int16(c)                         // low word kept
   if (c < 0) c = -c                    // the sign of the dot is discarded: back-lit faces shade like front-lit ones
   c = c + minColor
   if (maxColor < c) c = maxColor       // signed compare
   color(+0x77) = c
} else color(+0x77) = minColor
```
Remember the open question about the light vector globals: no writes to them were found.

## Notes for the port
- Transformations come in two kinds. The **permanent** ones change pos and work: Translate, MoveTo, Scale, Rotate, RotateAround. The **per-frame** ones change only work: RotateWork, ScaleWork. Drawing always projects `work`.
- Projection: `scale = D/(D - z)`, `screen = RoundHalfEven(x*scale) + centre`, int16. The y axis is not flipped (screen y = +y), and z must be `< D` to be visible.
- Each `new` of a TPixel or TFace is a heap object. In JS, plain objects with fields named as above are enough. Keep the list order (append order), because AddUnique and GetItem depend on it, and so does any draw order that iterates the list.
