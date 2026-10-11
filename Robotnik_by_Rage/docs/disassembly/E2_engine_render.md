# E2 — 3D engine: render pipeline (ROBOTNIK.EXE)

Scope: everything from "a world with objects and a camera" to bytes in the 320x200 8-bit back
buffer. Data structures as loaded from `.eob`/`.rec` (field meanings of the files, material
build, key-frame animation) are E1's (`E1_engine_data.md`); here only the fields the renderer reads
are listed, by offset.

**Verification.** Every rasteriser marked *[verified]* below was run in unicorn (whole image
loaded, function called with synthetic polygons) against a Python re-implementation of the
pseudo-code in this file, on 1500–3000 random triangles each (on/off screen, degenerate, flat
top/bottom, 3- and 4-gons where applicable): **0 differing pixels / 0 differing buffer words**.
Scripts: scratchpad `agents/E2/` (`emu.py` harness, `t_*.py` tests, `tmpl.py` generic template).

Notation: all integers are 32-bit two's complement and **wrap** (every `imul` is a 32-bit
multiply). `a / b` = x86 `idiv` = truncation toward zero. `a >> n` = `sar` (floor). `>>>` =
logical shift. `trunc()` for float→int: every float→int in this engine goes through `0x44160`,
which does `frndint` with RC=chop, i.e. **truncation toward zero**.

---------------------------------------------------------------------------------------------------

## 0. Global state

| addr | meaning |
|---|---|
| `[0x106330]` | CurrentWorld (set only during a render call) |
| `[0x89dd0]` | transformed-vertex buffer (world+0x2c), records of 0x24 bytes (§1.2) |
| `[0x89dd4]` | transformed face-normal buffer (world+0x34), records of 12 bytes |
| `[0x89dd8]` | polygon buffer (world+0x30), records of 0xa4 bytes (§1.3) |
| `[0x89ddc]` | sort buffer (world+0x38), 8-byte `{int polyIndex; int key;}` |
| `[0x89df8]`,`[0x89dfc]` | screen centre cx, cy (world+0x20/+0x24; **159, 99** at world creation `0x39e68`) |
| `[0x106c90]` | number of vertices in the vertex buffer this frame (running index) |
| `[0x106c88]` | number of face normals this frame |
| `[0x106c8c]` | number of polygons this frame |
| `[0x89e04]` | head of the global render list (objects added with `0x3a590`, LIFO) |
| `[0x89dcc]` | destination pixel buffer (back buffer, `0xe4d40`, 320 bytes/row) — set by `0x3a810` (also `[0x106b58]=0xa0000`) |
| `0xfd0a0` | 256-byte-wide colour/shade table filled by each part (§5.2) |
| `[0x89dec]`,`[0x89df0]` | min-ever of nearest key / max-ever of farthest key (statistics, never read) |
| `[0x89e58..0x89e68]` | copies of world+4..+0x14 made by the render entry; never read |

Matrix stack used by the float helpers: `[0x8bbb0]` = "current" 3x4 float matrix, `[0x8bbb4]` =
scratch; the two point into `0x11a8b0`/`0x11a8e0` and are swapped after each product.

## 1. Structures (fields read by the renderer)

### 1.1 World (0xbc bytes, `0x39e68 CreateWorld(eax=nMat?, edx=maxVerts, ebx=maxPolys, ecx=maxFaceNormals)`)
| off | |
|---|---|
| +0x00 | ptr runtime materials (0x30 each) used when an object has no own table |
| +0x1c | byte projection type; must be 1 (else `0x3dd08` asserts "doobj.c" line 0x58d; `0x3dc10` does nothing) |
| +0x20,+0x24 | screen centre (159, 99) |
| +0x28 | byte sort type: 0 or 1 (identical); anything else → fatal "Error! Unknown sort type!" |
| +0x29 | byte clip/cull mode 0..3 (1 at creation, all parts set 3) — §2.4 |
| +0x2c/+0x30/+0x34/+0x38 | buffers (verts maxVerts*0x24, polys maxPolys*0xa4, face normals maxFN*12, sort maxPolys*8) |
| +0x3c | float[12] world→camera matrix (= inverse of +0x6c) |
| +0x6c | float[12] camera→world matrix |
| +0x9c | far distance (100000) |
| +0xa0 | bit0: "scan method" (span renderer) — never set in this demo (§2.9) |
| +0xb8 | "fast path" flag: 0 normally; 1 in part 9 (cy) and on the skull world (parts 3/5) — §2.5 |

### 1.2 Vertex record (0x24 bytes, `[0x89dd0] + i*0x24`)
`+0 x, +4 y, +8 z` camera space (ints, 1 unit = 1/256 of the float scale), `+0xc nx, +0x10 ny,
+0x14 nz` camera-space corner normal (only some components are written, §2.2), `+0x18 sx, +0x1c sy`
projected screen coordinates (ints), `+0x20` projected flag (0 = not yet projected).

### 1.3 Polygon record (0xa4 bytes)
| off | |
|---|---|
| +0x00 | byte flags: bit0 = "point" face (face type 1) |
| +0x04 | n vertices (3; up to 5 after near clipping) |
| +0x08 + 0x18*k | slot k: `+0 vertex index, +4 u, +8 v`, `+0xc,+0x10,+0x14` extra (projector s, t, w in §8; else unused) |
| +0x80 | runtime material (0x30 bytes, §1.5) |
| +0x84 | ptr to the camera-space face normal (12 bytes) or 0 when the face has normal index −1 |
| +0x88 | sort key |
| +0x8c | owning object |
| +0x90 | projector flags (§8 only) |

### 1.4 Object fields used (see E1 §3.1 for the rest)
`+0 next, +4 first child, +8 nPts, +0xc pts (int x,y,z), +0x10 nFaces, +0x14 faces (0x30 each:
+0 type (1 = point), +4 material index, +8 face-normal index or −1, +0xc/+0x10/+0x14 vertex
indices, +0x18..+0x2c u0,v0,u1,v1,u2,v2), +0x18 nFaceNormals, +0x1c face normals (int xyz),
+0x20 nCornerNormals (must equal nPts, assert gfx3.c), +0x24 corner normals (int xyz),
+0x28 int[12] 8.8 local matrix K, +0x58/+0x5c/+0x60 position, +0x64/+0x66/+0x68 u16 angles
(4096 = 2π), +0x6c..+0x80 bbox minx,maxx,miny,maxy,minz,maxz (computed once by `0x3c18c`, also
centre +0x88..+0x90 and radius +0x94), +0x84 u32 flags, +0xa0/+0xa4 own material count/table,
+0xb0 (projector pass: first projector-vertex index).`

Flag bits (dword +0x84; "byte +0x85" = bits 8..15):

| bit | effect |
|---|---|
| 0x02 | face normals: only nz is computed (`0x3ae94`) |
| 0x04 | no backface culling |
| 0x08 | sort key = average z of the 3 vertices (`0x3d0c4`) |
| 0x10 | rescale u,v by the material texture size before drawing (§2.8) |
| 0x20 | invert the backface test (`cross = −cross`) |
| 0x40 | sort key = max z (`0x3d0c4`, `0x3d468`) |
| 0x80 | never bbox-culled |
| 0x100 (byte85 bit0) | corner normals: only nz computed |
| 0x200 (bit1) | corner normals: only nx, ny computed (all shipped objects: 0x2xx) |
| 0x400 (bit2) | sort key += 0x1000000 (drawn earlier = further back) |
| 0x800 (bit3) | sort key −= 0x1000000 (drawn later = on top) |
| 0x1000 (bit4) | object hidden (transformed, but no polygons) |
| 0x2000 (bit5) | drop polygons with key ≥ world+0x9c (far cut) |
| 0x4000 (bit6) | face normals transformed *with* translation (`0x3acfc`) instead of rotation only |

Shipped values: spider/skull 0x20e, en_obj 0x20a, logo 0x246.

### 1.5 Runtime material (0x30) — fields read by rasterisers
`+4` ambient-ish byte factor `a = ((256−diffuse)*spec)>>8`, `+8` (s16) base colour,
`+0xc` shade table (0xfd0a0), `+0x10` texture (256 wide), `+0x14` phong map (§5.1),
`+0x1c/+0x20` texture width/height, `+0x2c` draw function. Draw-function choice (`0x418b4`, see
E1 §1.5): untextured: flat `0x28b60`; flag2 (shaded) → `0x2c118` if diffuse==256 else `0x44354`;
textured: `0x331b4` (flag1), shaded+flag1 → `0x35860`. Other routines (`0x29710`, `0x29994`,
`0x2a9fc`, `0x2b1a4`, flag 8/4 materials) are never selected by the shipped data (§4.7).

---------------------------------------------------------------------------------------------------

## 2. Frame pipeline

### 2.1 Entry `0x3a4e0 RenderWorld(eax=world)` → `0x3c710`
Copies world buffers/centre into the globals of §0, sets CurrentWorld, calls `0x3c710`:
```
counts (verts, faceNormals, polys) = 0
if !CurrentWorld: fatal "No CurrentWorld specified!"
if world+0xa0 bit0: 0x51628()                       // dead in this demo
for (o = [0x89e04]; o; o = o->next) {               // render list (LIFO of AddObject)
    float m[12] = world+0x3c;                        // camera matrix copy
    DoObject(o, m)            // 0x3c81c; m becomes o's object→camera matrix
    for each child c of o: DoTree(c, m)              // 0x3c7d8: siblings via +0, children via +4,
}                                                    //   every sibling gets a copy of the parent's m
if (mode==2||mode==3) && world+0xb8==0: NearClip() 0x3dad8; ProjectPolys() 0x3dc10
Sort() 0x3dab0
Draw() 0x3dd98
```

### 2.2 `0x3c81c DoObject(eax=obj, edx=float m[12])`
Float 3x4 matrices: element `e[c*3+r]`; a point maps as
`x' = e0*x + e3*y + e6*z + e9`, `y' = e1*x + e4*y + e7*z + e10`, `z' = e2*x + e5*y + e8*z + e11`.
`0x50914(A,B,out)`: `out = A∘B` (apply B first), each element `= (A·B products summed in x87
extended, order a[row,0]... as listed) → stored float32`. `0x50c30(A)`: current = A ∘ current.
```
if angles (+0x64,+0x66,+0x68) all 0:  cur = float(K)          // K/256 (0x51000, exact)
else:
   cur = I
   cur = Rx(a64) ∘ cur;  cur = Ry(a66) ∘ cur;  cur = Rz(a68) ∘ cur   // 0x50c74/0x50cc8/0x50d18
   cur = float(K) ∘ cur
   with angle_rad = (float32)( (double)(u16)a * 6.283185307179586 * (1/4096) )
cur.e9  += (float32)(pos.x/256.0); cur.e10 += pos.y/256; cur.e11 += pos.z/256   // 0x50d6c (float adds)
cur = m ∘ cur;  m = cur                      // object→camera; children inherit it
M = int matrix: M[i] = trunc(cur.e[i] * 256)                      // 0x50f34, 8.8 fixed
if !(flags & 0x1000):
   if BBoxCulled(obj, M) (0x3cae0) return
   v0 = TransformPoints(obj, M)          // 0x3a878, returns first vertex index of this object
   f0 = (flags&2) ? FaceNormalsZ (0x3ae94) : (flags&0x4000) ? FaceNormalsT (0x3acfc) : FaceNormals (0x3add4)
   if mode not in {2,3}: ProjectAll(v0)  // 0x3dd08
   if world+0xb8: BuildPolysFast(obj, v0, f0) (0x3d468) else BuildPolys(obj, v0, f0) (0x3d0c4)
```
Rotation matrices (s=sin, c=cos of the float32 angle, computed by `fsin/fcos`, stored float32):
Rx: e4=c, e5=s, e7=−s, e8=c (`y'=cy−sz, z'=sy+cz`); Ry: e0=c, e2=−s, e6=s, e8=c (`x'=cx+sz,
z'=−sx+cz`); Rz: e0=c, e1=s, e3=−s, e4=c (`x'=cx−sy, y'=sx+cy`). Identity elsewhere.
Precision note: element = round_to_float32(sum of 3 float32×float32 products in 80-bit). Doing
the sum in JS doubles and rounding with `Math.fround` reproduces this except in astronomically
rare ties; the only integer that matters is `trunc(e*256)`.

Camera helpers (`world+0x6c` is the camera's own transform, `+0x3c` its inverse via `0x50a44`:
transpose of the rotation, translation `−Rᵀt`): `0x3a66c(world, a)` rotates the camera about its
local X by `a*2π/4096` (`+0x6c = +0x6c ∘ Rx`), `0x3a714/0x3a764/0x3a7b4(world, d)` move it along
local X/Y/Z by `d/256`; each then recomputes `+0x3c = inverse(+0x6c)`.

### 2.3 Integer transforms (`0x3a878` gfx3.c, `0x3add4`, `0x3acfc`, `0x3ae94`)
With the 8.8 matrix M (indices as above):
```
P(x,y,z) = ( ((M0*x + M3*y + M6*z) >> 8) + M9,
             ((M1*x + M4*y + M7*z) >> 8) + M10,
             ((M2*x + M5*y + M8*z) >> 8) + M11 )
R(x,y,z) = ( (M0*x+M3*y+M6*z)>>8, (M1*x+M4*y+M7*z)>>8, (M2*x+M5*y+M8*z)>>8 )   // no translation
```
(sum first, one `sar 8`.) `0x3a878`: for each point i: vertex[v0+i].xyz = P(pt), `.+0x20 = 0`,
and if the object has corner normals: byte85 bit0 → only `.nz = R(n).z`; bit1 → only
`.nx,.ny`; else all three. Returns v0 (old `[0x106c90]`), which then advances by nPts.
Face normals → `[0x89dd4]` records: `0x3add4` R(n) (all 3), `0x3acfc` P(n), `0x3ae94` only
`.z = R(n).z` (x,y left stale).

### 2.4 Bounding-box cull `0x3cae0` and outcodes `0x3d7f4`
The 8 bbox corners (all combinations of +0x6c/0x70, +0x74/0x78, +0x7c/0x80) are transformed with
P() and classified (`0x3d7f4(x,y,z)`):
```
bit0 (1): z < 50                       bit1 (2): 190*z < 512*y   (above top)
bit2 (4): −190*z > 512*y (below)       bit4 (0x10): 310*z < 512*x (right)
bit3 (8): −310*z > 512*x (left)        bit5 (0x20): z > world+0x9c
```
(i.e. a ±155 x ±95 pixel frustum around the centre with focal 256.) Culled if: obj flag 0x80 →
never; mode 3 or 2 → AND of the 8 codes ≠ 0; mode 1 → (OR & 1) or AND ≠ 0; mode 0 → OR ≠ 0.

### 2.5 Building polygons
**`0x3d0c4` (normal path).** Bias `b = +0x1000000` if byte85 bit2, else `−0x1000000` if bit3,
else 0. For each face f (in file order), poly = polys[count]:
`flags=0, obj, normal ptr (or 0 if f.normal==−1)`;
- type 1 (point): `flags|=1, n=3`, all three slot indices = v0+f.v0; key = z(v) + b.
- else `n=3`, slots = (v0+f.vk, f.uk, f.vk); key = **only if** obj flag 0x08: `(z0+z1+z2)/3 + b`,
  else if 0x40: `max(z0,z1,z2) + b`; else left untouched (stale; all shipped objects set one).
- if byte85 bit5 and key ≥ world+0x9c: polygon discarded (count not incremented).
- material = obj+0xa0 ? obj+0xa4 + 0x30*f.mat : world+0 + 0x30*f.mat; count++.

**`0x3d468` (world+0xb8 path; part 9, skull world).** No near clipping; projects immediately.
- point: key = z; if vertex not projected: `sx = 160 + ((x<<8)/z)`, `sy = 100 − ((y<<8)/z)` —
  computed with a 64-bit dividend whose high dword is `x>>>24` (logical), so only correct for
  0 ≤ x < 2^23 (negative x would fault) — and it uses the fixed centre 160/100.
- triangle: rejected unless all three z > 5. Unprojected vertices get
  `sx = cx + (x<<8)/z, sy = cy − (y<<8)/z` (`+0x20=1`). Backface (§2.7) unless obj flag 4
  (flag 0x20 negates); rejected if `cross < −1`. u,v copied, normal ptr, key = obj flag 0x40 ?
  max z : (z0+z1+z2)/3 (no bias, no far cut).

**Projection (`0x3dd08` all of an object's vertices; `0x3dc10` vertices of all polygons not yet
projected; `0x4663c` same as 0x3dc10):** `sx = cx + (x<<8)/z`, `sy = cy − (y<<8)/z`, flag=1;
in `0x3dc10/0x4663c` a vertex with z==0 gets `sx=x, sy=y`. (`0x3dd08` divides unconditionally.)
`x<<8` is a 32-bit shift. Focal length = 256 px.

### 2.6 Near-plane clipping `0x3dad8` (modes 2/3, world+0xb8==0)
Every polygon i (in buffer order) is copied/clipped into a slot one position lower: output of
poly 0 lands in slot `count` and is finally moved to slot `count−1`; poly k (k≥1) lands in slot
k−1. (So the buffer order before sorting is `1,2,…,count−1,0` — matters only for ties, §2.8.)
Copies flags, n, +0x80..+0x8c; a point copies slot 0 only; others are clipped by
`0x3e4e4(n, src, dst, dist=0x3e074)` and `n = result` (may be 0..5).

`0x3e4e4` *[verified]*: Sutherland–Hodgman against `d(slot) = vertex.z − 50` (inside: d ≥ 0).
```
for i in 0..n-1:  prev = i-1 (wrap), next = i+1 (wrap)
  if d[i] >= 0: out += slot[i]                              // copies the whole 0x18 slot
  else:
    if d[prev] >= 0: emit(edge prev,i)
    if d[next] >= 0: emit(edge i,next)
emit(edge a,b): P = the slot with the smaller vertex index (P=b if idx equal for (prev,i) / P=a
                for (i,next)... exactly: for (prev,i): P = prev if idx[i] > idx[prev] else i;
                for (i,next): P = i if idx[i] < idx[next] else next); Q = the other
   t = (d[P] << 10) / (d[P] − d[Q]);  if d[P]==d[Q]: t = (P is the inside one) ? 0 : 0x400
   new vertex V = vertices[count++]:  V.k = P.k + (((Q.k − P.k) * t) >> 10) for x,y,z,nx,ny,nz;
                                       V.+0x20 = 0
   out slot = { idx = V, u = P.u + (((Q.u−P.u)*t)>>10), v likewise }   (slot +0xc..+0x14 untouched)
```

### 2.7 Backface test `0x3cfe0(slots)`
A, B, C = vertices of slots 0, 1, 2:
`cross = (A.sx−C.sx)*(B.sy−C.sy) − (A.sy−C.sy)*(B.sx−C.sx)`; obj flag 0x20 → `cross = −cross`;
obj flag 4 → `cross = 10000`. Visible iff `cross ≥ −1`. (Visible triangles are clockwise on
screen, y down.)

### 2.8 Sort `0x3dab0`→`0x3da00` and draw `0x3dd98`
Sort *[verified]*: array `a[k] = {k, poly[k].key}`, then `0x51e10(a, 0, count−1)`: Hoare quicksort,
**descending** (far first):
```
qs(l, r): while r > l: i=l; j=r; p = a[(l+r)>>1].key
            do { while p < a[i].key: i++;  while p > a[j].key: j--;
                 if i <= j: swap(a[i],a[j]); i++; j-- } while i <= j
            qs(l, j); l = i
```
Draw (`world+0xa0` bit0 clear — always):
```
for k in 0..count-1:  p = polys[a[k].index]
  if p.flags & 1: p.mat.draw(p); continue                   // point faces
  if obj flag 0x10: for each slot: u = (u*mat+0x1c)>>8; v = ((256−v)*mat+0x20)>>8;
                    clamp u to [0, W−1], v to [0, H−1]        (modifies the record)
  if p.n == 3:
     if world+0xb8 || backface visible: p.mat.draw(p)
  elif p.n > 3:          // fan: (0,1,2),(0,2,3),(0,3,4)
     p.n = 3; repeat n−2 times: { if world+0xb8 || visible(p): draw(p);
                                  slot1..slot4 ← slot2..slot5 (shift down) }
```
### 2.9 Span ("scan-method") renderer `0x51628/0x5168c/0x51a6c` — dead code
Only reached when world+0xa0 bit0 is set, which never happens; its init pointers `[0x8bbb8]`,
`[0x8bbbc]` are never set (would fatal "Scan-method not initiated"). It builds an edge pool
(0xbe rows, 16.8 edge records) and printf()s every scanline — debug code. Not needed for the port.

---------------------------------------------------------------------------------------------------

## 3. Rasteriser conventions (all library rasterisers)
Called as `draw(eax = poly)`; read `vertex.sx/sy/nx/ny`, `slot.u/v`, the material and the face
normal. Pixel buffer = `[0x89dcc]` (row = y*320) except `0x490a7/0x4911c` which hard-code 0xe4d40.
Texture/phong lookup from a packed or 8.8 pair (u, v): `index = ((v>>8)&255)*256 + ((u>>8)&255)`
— 256x256 tiles, both coordinates wrap at 256.

**The "triangle template".** `0x331b4`, `0x35860`, `0x45d78`, `0x46d48` (in `0x46d08`) and `0x47ed0`
are the same compiled C template with different interpolants and span routines (`2c118` is a
close relative, §4.2). Generic form *[verified for all five]*:
```
sort vertices by sy into T (top), M (mid), B (bottom):
  v0,v1,v2 = slots 0,1,2
  if v1.sy > v0.sy: (v1.sy < v2.sy) ? (0,1,2) : (v2.sy > v0.sy) ? (0,2,1) : (2,0,1)
  else:             (v0.sy < v2.sy) ? (1,0,2) : (v2.sy > v1.sy) ? (1,2,0) : (2,1,0)      // (T,M,B)
if T.y >= YREJ || B.y < 0: return;  dyL = B.y − T.y; if dyL <= 0: return
[routine-specific bbox test]
t     = ((M.y−T.y) << 8) / dyL
width = ((t*(B.x−T.x)) >> 8) − (M.x−T.x);       if width == 0: return    // <0: long edge on the left
for each interpolant a (values aT,aM,aB in their fixed format):
   dadx  = (((aB−aT) >> 8) * t − (aM−aT)) / width
   dadyL = (aB−aT) / dyL                       // along the long edge T→B
   packed pair (u,v 8.8): dx = ((dvdx<<16) | (dudx & 0xffff)), dyL = ((dvdyL<<16) + dudyL),
                          start = (vT<<16) + uT   (all mod 2^32)
dxL = ((B.x−T.x)<<16)/dyL;  xL = T.x<<16; y = T.y; A = start values
if M.y != T.y && M.y >= 0:                      // upper half
   dxS = ((M.x−T.x)<<16)/(M.y−T.y); xS = T.x<<16
   if T.y < 0: A −= dadyL*T.y; xL = (T.x<<16) − dxL*T.y; xS = (T.x<<16) − dxS*T.y; y = 0
   for (; y < min(M.y, YCAP); y++) { span(y, xL>>16, xS>>16, A); xL+=dxL; xS+=dxS; A+=dadyL }
elif M.y != T.y:                                // whole upper half above the screen
   y = M.y; A += dadyL*(M.y−T.y)                // NB: xL is NOT advanced here
xS = M.x<<16; yend = min(B.y, YCAP); if y >= yend: return
dxS = ((B.x−M.x)<<16)/(B.y−M.y)
if y < 0: xL −= dxL*T.y; xS −= dxS*M.y; A −= dadyL*y; y = 0
for (; y < yend; y++) { span(y, xL>>16, xS>>16, A); xL+=dxL; xS+=dxS; A+=dadyL }
```
(When the upper half was skipped because M.y<0, `xL` is still T.x<<16 and the `y<0` fix-up
`xL −= dxL*T.y` lands on y=0 exactly; in every other case y ≥ 0 there.) `span(y, xLong, xShort)`:
if width < 0 the long edge is the left end (`xl = xLong, xr = xShort`), else the right end. `YCAP`
= 201 for screen rasterisers, so **row 200 is written** (past the 64000-byte buffer, into the bytes
after 0xe4d40+64000) — the port can drop it. Values at the span start are the long-edge values
(no sub-pixel correction), clipped spans advance them by `dx * pixels skipped`.

---------------------------------------------------------------------------------------------------

## 4. Library rasterisers

### 4.1 `0x28b60` flat (untextured, unshaded) *[verified, 3- and 4-gons, offscreen]*
Edge-table rasteriser (any n). Global row table at `0xf59e0`, 0x98 bytes/row: `+0 left, +0xc right`;
`[0x83894] minY`, `[0x83898] maxY`.
```
reset (0x2895c): clamp minY>=0, maxY<=199 (if >=200 → 199); rows minY..maxY (incl.) ← left=right=0x7fff;
                 minY=199, maxY=0          (startup values 0/199 ⇒ table always clean)
for i: edge(v[i], v[i+1]) and edge(v[n−1], v[0])        // 0x289e8
edge(x0,y0,x1,y1): if y0==y1 return; order so y0<y1
   if y0 < 0: x0 += ((((−y0)<<8)/(y1−y0)) * (x1−x0)) >> 8;  y0 = 0
   dy = y1 − y0 (with the original y1);  if y1 > 200: y1 = 200;  if y1 <= y0 return
   minY = min(minY,y0); maxY = max(maxY,y1)
   s = ((x1−x0)<<8)/dy;  x = x0<<8
   for y in y0..y1−1: xi = x>>8; if xi < left[y]: right[y] = left[y]; left[y] = xi
                                 else right[y] = xi;      x += s
colour = mat+0xc [ min(|n.z|/2, 127)*256 + (s16)mat+8 ]       // n = face normal (+0x84)
for y in minY..maxY−1: fill x = max(left,0) .. min(right,320)−1
```
Top-inclusive/bottom-exclusive, left-inclusive/right-exclusive, x not rounded (floor of 8.8).

### 4.2 `0x2c118` phong, untextured (diffuse == 256) *[verified]*
Triangles only. Interpolates the env-map coordinates `pu = (nx+256)>>2`, `pv = (ny+256)>>2`
(vertex corner normals, 0..128) in 8.8; colour = `map[(pv>>8)*256 + (pu>>8)]`, map = mat+0x14
(§5.1; the map already contains the base colour). Same T/M/B sort as §3, but its own loop:
```
reject: B.y < 0 || T.y >= 201 || dyL <= 0
t = ((M.y−T.y)<<8)/dyL;  W = t*(B.x−T.x) + ((T.x−M.x)<<8)   (8.8!);  if W==0 return
dudx = (((t*(puB−puT)) + ((puT−puM)<<8)) << 8) / W     (same for v)
long edge: x=T.x<<8 (8.8), u=puT<<8, v=pvT<<8; dx=((B.x<<8)−x)/dyL; du=((puB<<8)−u)/dyL; dv likewise
short: xs = T.x<<8, upper dxs = ((M.x−T.x)<<8)/(M.y−T.y); lower xs=M.x<<8, dxs=((B.x−M.x)<<8)/(B.y−M.y)
y = T.y; upper half only if M.y != T.y: while y < M.y && y < 200 { if y>=0 span; step all }
lower half if B.y > M.y: while y < min(B.y,200) { if y>=0 span; step }       (no y<0 pre-step:
                                                                               rows <0 are just stepped)
span(xl = long>>8, xs = short>>8):
  W > 0 (long edge right): du' = −dudx; if xs<0: xs=0; if xl >= 321: u += du'*(xl−320), xl = 320
        draw x = xl−1 down to xs (xl−xs pixels), stepping u += du', v += dv'
  W < 0 (long edge left):  if xl < 0: u += dudx*(−xl), xl = 0;  if xs >= 321: xs = 320
        draw x = xl .. xs−1
```
(Byte `[0x838a4] = (|n.z| * mat+4)>>8` is computed but unused here.)

### 4.3 `0x44354` phong + flat term (diffuse != 256), any n *[verified, incl. persistent table]*
Edge-table renderer with constant gradients:
```
u_i = (nx_i + 256) >>> 2, v_i = (ny_i + 256) >>> 2  (i = 0..n, vertex n = vertex 0)
minY = min sy, maxY = max sy (over i=0..n); if minY>=200 return; minY=max(minY,0); if maxY<0 return;
maxY = min(maxY,199); if minY >= maxY return
edges i→i+1 (i=0..n−1) into the row table at 0xf4d60 (16 bytes/row: +0 xLeft 16.16,
+4 xRight 16.16, +8 packed uv at the left edge); the table is NOT cleared between polygons:
  dy>0 (going down) → right edge: s = ((x1−x0)<<16)/dy; x = (x0<<16) + 0x8000
     if y0 > 199 skip; if y0 < 0: cnt = dy + y0 (skip if <=0), x += (−y0)*s, row 0
     if y1 not in 0..199: if y1 < 0 skip; cnt = cnt − y1 + 199 (skip if <=0)
     write rows y0..y0+cnt (cnt+1 rows, i.e. both endpoints)
  dy<0 (going up)   → left edge, walked from y0 upward: |dy|, s = ((x1−x0)<<16)/|dy|, x = x0<<16 (no +0x8000)
     uv = ((v0<<8)&0xffff)<<16 | ((u0<<8)&0xffff); duv = ((dv&0xffff)<<16)|(du&0xffff),
     du = ((u1−u0)<<8)/|dy| (dv same)    — packed add: a carry out of u spills into v
     if y0 not in 0..199: if y0<0 skip; k = y0−199; cnt −= k (skip if <=0); uv += duv*k; x += s*k; row 199
     if y1 >= 200 skip; if y1 < 0: cnt += 1 + y1 (skip if <=0)
     write rows y0 down to y0−cnt (cnt+1 rows) {xLeft=x, uv}
gradient from vertices 0,1,2:  A = (x0−x2)*(y1−y2) − (x1−x2)*(y0−y2); if A==0 return
   dudx = (((u0−u2)*(y1−y2) − (u1−u2)*(y0−y2)) << 16) / A    (64-bit dividend)  — 16.16; dvdx same
   duv = (((dvdx<<8) & 0xffff0000) | ((dudx>>>8) & 0xffff))
s = (|n.z| * mat+4) >> 8  (low byte), S4 = s*0x01010101
for y in minY..maxY (inclusive):
   xr = xRight>>16; if xr < 0 || xLeft >= 320<<16: skip; if xr >= 320: xr = 319   (column 319 never drawn when clipped)
   xl = xLeft>>16; uv = row.uv; if xl < 0: uv −= xl*duv, xl = 0;  cnt = xr − xl; if cnt <= 0 skip
   pixels x = xl..xr−1: c_k = map[((uv>>>24)&255)*256 + ((uv>>8)&255)], uv += duv
   output: if cnt < 7: each byte (c+s)&255
           else: bytes until (x&3)==0 one by one ((c+s)&255); then groups of 4 as a little-endian
                 dword (c0|c1<<8|c2<<16|c3<<24) + S4 (mod 2^32 — carries ripple into the next
                 pixel); remaining (cnt mod 4 after alignment) one by one
```
`0x44521` is the same without the `+s` (unused).

### 4.4 `0x331b4` affine texture *[verified]*
Template §3, YREJ = YCAP = 201. Extra reject: `max(Tx,Mx,Bx) < 0 || min(...) >= 320`.
Interpolant: packed (u,v) from slot u,v (texture coordinates, 0..255) ×256. Texture = mat+0x10.
```
span (long left: xl=long, xr=short | long right: xr=long, xl=short):
  require xl < 320 && xr > 0
  long left : if xl<0: uv −= xl*duv, xl=0;  xr = min(xr,319); n = xr−xl; if n<=0 return
              x = xl..xr  (n+1 pixels, both ends)    uv += duv
  long right: if xr>319: uv += (319−xr)*duv, xr=319; xl = max(xl,0); n = xr−xl; if n<=0 return
              x = xr down to xl (n+1 pixels)         uv −= duv
pixel = tex[((uv>>>24)&255)*256 + ((uv>>8)&255)]       // inner loops 0x4fd9b / 0x4fdc9
```
(`0x4fdf7/0x4fe29` are colour-0-transparent copies; `0x4fd3b/0x4fd6b` shade an existing pixel via
0xfd0a0 — not used by the library materials.)

### 4.5 `0x35860` texture × phong *[verified]*
Template §3, YCAP 201, no bbox reject. Two packed interpolants: texture (u,v) from the slots and
phong (pu,pv) = `((n+256)>>2)<<8` from the corner normals. Shade row
`R = (|n.z * mat+4|) & 0x7f00` (n = face normal; note: no `>>8`, masked).
```
pixel = 0xfd0a0[ R + map[pu,pv]*256 + tex[u,v] ]       // map = mat+0x14, tex = mat+0x10
span: same clip rules as 4.4 but the n<=0 early-out does not exist:
      x = xl..xr inclusive (also when xl == xr: one pixel); nothing if xr < xl
inner loops 0x50002 (→) / 0x50049 (←); self-modified by 0x4ffc4/0x4ffe3:
      +0x50028/0x5006f = phong map, +0x50031/0x50078 = texture, +0x5003a/0x50081 = 0xfd0a0+R
```

### 4.6 Point faces
Drawn by the same material function with all three slots on the same vertex: every rasteriser
draws nothing for such a degenerate triangle (zero height), so points are invisible unless a part
installs its own function.

### 4.7 Unused library rasterisers
`0x29710` (shaded, flag 8, table 0x1050cc), `0x29994` (textured flag 8), `0x2a9fc` (shaded
textured flag 4), `0x2b1a4` (textured flag 4): edge-table renderers built on `0x2895c/0x28c50`
(0xf59e0 table) with `[0x8a058]`; not selected by any shipped material, not referenced by parts.

---------------------------------------------------------------------------------------------------

## 5. Tables

### 5.1 Phong / environment map `0x316c4` (cached) → `0x314c0` *[verified, all 7 shipped parameter sets]*
Called by the material builder for flag-2 materials with
`(exp = disk+0x10c (double), lo = 0, hi = ((spec*diffuse)>>8) − 1, scale = diffuse*spec/256.0,
colour = disk+0x118, N = 0x80, pitch = 0x100)`; identical parameter sets return the same map
(list at `[0x84c6c]`). Map = malloc(N*pitch) = 32 KB: only x,y in 0..127 are written (columns
128..255 and row 128 are uninitialised heap; reachable only when |n| = 256 exactly).
```
r = N*0.5 = 64
for y in 0..127, x in 0..127:
    s = sqrt(((x−r)² + (y−r)²) / (2r²))                 // 0 at centre, 1 at the corners
    k = trunc( pow(1 − s, exp) * scale )                 // double precision is exact enough
    k = min(k, hi); k = max(k, lo)
    map[y*256 + x] = (k + colour) & 255
```
Shipped: exp 2.0 or 8.0; (diffuse,spec) = (256,127)→max 126, (256,128)→127, (256,32)→31,
(128,32)→15, (128,128, exp 8)→63, diffuse 0 → all `colour`.

### 5.2 `0xfd0a0` colour table
`table[row*256 + c]`: for textured-phong (`0x35860`) row = light (phong map value + R/256), c =
texel; for flat (`0x28b60`) row = |nz|/2, c = base colour; projector paths row = projected
intensity. Contents are written by each part's init (e.g. `0x209a0` for part 0, `0x13275`,
`0x1e6ac`, `0x235ca`, …) — see the part notes.

### 5.3 Sine table for the triangle engine (obj2 `0x71054`)
1280 dwords: `SIN[i] = round(1024*sin(2πi/1024))`; `cos(i) = SIN[i+256]` (`0x71454`). Angles are
0..1023 per turn.

---------------------------------------------------------------------------------------------------

## 6. Small "triangle engine" (parts 13, 15, 5: shards/particles; part 12 setup)
Vertex record 0x40 bytes: `+0 x,+4 y,+8 z` model; `+0xc,+0x10,+0x14` rotated (×1024);
`+0x18 sx, +0x1c sy`; `+0x20 u (texture row), +0x24 v (texture column)`; (`+0x28,+0x2c` extra
interpolants for `0x43cf8`).

**`0x43450 Rotate(eax=verts, edx=n, ebx=a, ecx=b, [esp+4]=c)`** *[verified]* (angles 0..1023):
```
sa,ca = SIN[a],SIN[a+256]; sb,cb; sc,cc likewise
m0 = (((cb*cc*ca)>>10) − sc*sa) >> 10      m1 = (((cb*cc*sa)>>10) + sc*ca) >> 10   m2 = (−cc*sb) >> 10
m3 = (((−sc*cb*ca)>>10) − cc*sa) >> 10     m4 = (cc*ca + ((−sc*cb*sa)>>10)) >> 10  m5 = (sc*sb) >> 10
m6 = (ca*sb) >> 10                         m7 = (sa*sb) >> 10                      m8 = cb
rx = x*m0+y*m1+z*m2;  ry = x*m3+y*m4+z*m5;  rz = x*m6+y*m7+z*m8      (no shift, ×1024 scale)
```
**`0x435e8 Project(eax=verts, edx=n, ebx=cx, ecx=cy)`** *[verified]*: `D = [0x89f18]` (default
0x200000, parts set it): if `rz > −D`: `sx = ((rx<<10) / (rz+D)) + cx`, `sy = ((ry<<10)/(rz+D)) +
cy` (32-bit shift, **y not negated**); else sx/sy left unchanged.

**`0x43654 SetupTri(eax=v0, edx=v1, ebx=v2, ecx=edgeFn)`** + `0x439cc` edges + `0x764a2` spans
*[verified together]*. Two row tables of 32-byte records: A = `0x11283c` (right ends), B =
`0x11683c` (left ends): `+0 x (int), +8 u (8.8), +0xc v (8.8)`. Globals `[0x89f40]` first row, `[0x89f44]`
last row, `[0x89f50]` yMin (0), `[0x89f54]` yMax (200; part 12 changes both), `[0x89f48]/[0x89f4c]`
min/max x (unused by the span routine).
```
SetupTri:
  if for all 3 vertices (unsigned)sx >= 320 && !((unsigned)sy < yMax): return     // NO reset!
  reset 0x43960: for y in [f40, f44): A[y].x = 0x82d48b00 (neg), B[y].x = 0x7d2b7500;
                 f44 = 0; f40 = 200
  top = first index with the strictly smallest sy (starting at 0), bot = first strictly largest
  mid = 3 − top − bot; if mid not in 0..2 (all sy equal): return
  c0 = (top.y−mid.y)*(top.x−bot.x); c1 = (top.y−bot.y)*(top.x−mid.x)
  if c1 > c0: edge(A,top,mid); edge(A,mid,bot); edge(B,top,bot)
  else:       edge(B,top,mid); edge(B,mid,bot); edge(A,top,bot)
edge(T,P,Q) 0x439cc:  order P.y <= Q.y; dy = Q.y−P.y; if dy==0 || P.y > 200 || Q.y < 0: return
  dx=((Q.x−P.x)<<8)/dy; du=((Q.u−P.u)<<8)/dy; dv=((Q.v−P.v)<<8)/dy; x=P.x<<8; u=P.u<<8; v=P.v<<8
  y0=P.y, y1=Q.y
  if y0 < yMin: k=y0−yMin; x−=dx*k; u−=du*k; v−=dv*k; y0 = 0 (sic); f40 = 0   elif y0 < f40: f40 = y0
  if y1 > yMax: f44 = yMax; y1 = yMax   elif y1 > f44: f44 = y1
  for y in y0..y1−1: T[y] = {x>>8, u, v}; step
Span 0x764a2(eax=texture), self-modifying (patches the texture base into the `mov al,[ebx+…]`
displacement at 0x765b9 and the row address into the `mov [edi+…],al` displacement at 0x765c1):
  if f40 >= f44: return
  for y in f40..f44 (inclusive):
    xa = A[y].x; xb = B[y].x; if xa < 0 || xb >= 320: continue; w = xa − xb; if w <= 0: continue
    du = sext16((B.u − A.u)/w); dv = sext16((B.v − A.v)/w); u = A.u; v = A.v
    if xa > 320: u += sext16((xa−320)*du); v += sext16((xa−320)*dv); xa = 319   // off by one; xa==320 is NOT clipped
    if xb <= 0: xb = 0
    for x = xa down to xb (inclusive):
        pix[base + rowtab[y] + x] = tex[(u & 0xffffff00) | ((v>>8) & 255)];  u += du; v += dv
```
Consequences: a trivially rejected triangle leaves the tables and f40/f44 untouched, so the caller's
following `0x764a2` **redraws the previous triangle's spans with the new texture**; a span with
`xa == 320` writes one pixel at x=320 (= next row x=0). The texture is addressed by `u` without a
mask (u>>8 = row of a 256-wide texture), v wraps at 256.
**`0x76a3c(eax=pitch, edx=rows≤512, ebx=base or 0→0xa0000)`**: `[0x70010]=base`,
`rowtab[i] (0x70849) = i*pitch`. Variants in obj2 not called by obj1: `0x765e1` (same, colour 0
transparent), `0x7672e` (no right clip, 16-bit `idiv di`), `0x76460`; plus VGA helpers
(`0x76850` vsync loop, palette I/O `0x768b6..0x76929`, line/pixel `0x76948..`).

**`0x437c4` (part 12)**: as 0x43654 but passes a side (+1 for A, −1 for B) to the edge function
(`0x43cf8` there). `0x43cf8(eax=side, edx=table, ebx/ecx=verts)`: rows are extended by one at both
ends and the x start is pushed outward by one pixel:
```
order P.y<=Q.y; if Q.y==P.y return; y0 = P.y−1; y1 = Q.y+1; n = y1−y0
if y0 >= 200 || y1 < 0 return
start x = (P.x + side)<<8; dx = ((Q.x−P.x)<<8)/n; five more interpolants, each a=P.f<<8,
da = ((Q.f−P.f)<<8)/n for f in +0x14,+0x20,+0x24,+0x28,+0x2c
yMin/yMax clip and f40/f44 update as in 0x439cc
record: +0 x>>8, +4 f14, +8 f20, +0xc f24, +0x10 f28, +0x14 f2c
```
(part 12 draws the spans itself.)

---------------------------------------------------------------------------------------------------

## 7. Matrix/maths helpers used here
`0x50ad0` identity; `0x50bdc` cur=I; `0x50c00(A)` cur=A; `0x50c30(A)` cur=A∘cur;
`0x50c5c(dst)` dst=cur; `0x50c74/0x50cc8/0x50d18(float angle)` cur = Rx/Ry/Rz ∘ cur;
`0x50d6c(fx,fy,fz)` cur.t += (fx,fy,fz) (float adds); `0x50d9c` cur = inverse(cur) (`0x50a44`);
`0x50f34(src,dst)` int[i] = trunc(src[i]*256); `0x51000(src,dst)` float[i] = int[i]/256;
`0x513a0` angle interpolation helper (keys, E1); `0x44160` trunc; `0x44193` atan2;
`0x45542/0x45572` acos/asin; `0x44e36` pow (Watcom, integer exponents by squaring);
`0x43413` rand (`seed = seed*0x41c64e6d + 0x3039; return (seed>>>16)&0x7fff`, seed `[0x89f14]`),
`0x43437` srand. Not rendering (listed in the brief's range): `0x433b0` load object (E1),
`0x41c50` build materials (E1), `0x44f9c/0x44fc0` open(), `0x4520e` lseek, `0x4534c/0x4536c` file
read, `0x456a4/0x456c4/0x456f0` mouse set/get x/get y, `0x49028` 4-bit unpack (E1 §5.3).

---------------------------------------------------------------------------------------------------

## 8. Projector / shadow renderer (skull parts 3 & 5): `0x457f0(eax=A, edx=B)`
A = the viewing world (its camera draws the screen), B = the projector (light) world. The render
list is the global one (same objects).

**Pass 1** (`0x45930`, CurrentWorld = a stack copy of A whose camera matrices (+0x3c,+0x6c) and
vertex buffer (+0x2c) come from B; poly/normal/sort buffers are A's; `[0x8a054]` = B):
for every object tree (`0x459f0`, same matrix composition as §2.2 with B's camera):
```
obj+0xb0 = v0 = TransformProjector(obj, M)              // 0x45c54, into B's vertex buffer:
    P() as §2.3, +0x20 = 1; if z != 0: w = 0x100000 / z; vertex.+8 = w;
         sx = ((x*w) >> 11) + 128;  sy = 80 − ((y*w) >> 11)          (focal 512)
    else: +8 = 0x100000, sx = x, sy = y
face normals 0x3add4 (rotation only, projector space)
if !(flags & 0x1000): for each face (0x45b38):
    face+0 := 0                                         // the face TYPE field is reused as flags!
    if all three projector z > 0 (vertex +8 now holds w, test is on w > 0):
        fill a scratch poly record; if n.z > 1: face+0 = Depth(poly) | (n.x<=0 ? 4:0) | (n.y<=0 ? 8:0)
        poly count++ (scratch only)
```
`0x45d78 Depth(poly)` *[verified, incl. return flags]*: template §3 with YREJ = YCAP = **199**, bbox
reject (`maxX<0 || minX>319` → return 0), zero width → return 3. Flag 2 if `maxX>318 || minX<1 ||
B.y>198 || T.y<1`. One scalar interpolant `w12 = w<<12`; start value
`(wT<<12 & 0xffffff) | (frameId<<24)` with frameId = `[0x11a87c]` (incremented by the part).
Buffer `WB = [0x11a878]`, 320 dwords per row:
```
span: long left: skip if xl > 319 || xr < 0; if xl<0: w −= xl*dwdx, xl=0; xr=min(xr,319)
                 x from xl, max(xr−xl,0)+1 pixels (always at least one), w += dwdx
      long right: skip if xl > 319 || xr < 0; if xr>319: w += (319−xr)*dwdx, xr=319; xl=max(xl,0)
                 x from xr down, max(xr−xl,0)+1 pixels, w −= dwdx
      per pixel: if WB[y*320+x] < w (unsigned): WB[...] = w;   flag |= 1 for every span processed
```
**Pass 2** (`0x4671c`, CurrentWorld = A, normal buffers): like `0x3c710` but objects go through
`0x46818` (= §2.2 with: bbox cull, `0x3a878`, face normals `0x3ae94` if flag 2 else `0x3add4`,
project if mode∉{2,3}, then `0x46994`), modes 2/3 only project (`0x4663c`, **no near clipping**),
then the normal sort and draw (§2.8; the skull world has +0xb8=1 → no screen backface test).
`0x46994` builds a polygon for a face only if all three camera z > 0 and face-normal z ≥ 0:
slots `(v0+f.vk, f.uk, f.vk, s = projV.sx<<16, t = projV.sy<<16, w = projV.w<<12)` with projV =
B.vertices[obj+0xb0 + f.vk]; key = z0+z1+z2 (sum); +0x90 = face+0 (pass-1 flags); material as usual.

Material draw function `0x46d08` (installed by the part): `(flags & 3) == 0` → `0x331b4` (plain);
`flags & 2` → `0x47ed0` (slow, per-pixel bounds); else → fast path `0x46d48`. Both *[verified]*:
template §3, YCAP 201, no bbox reject; interpolants
```
(u,v) packed: slot u,v <<8 if mat+0x10 (texture) != 0, else phong coords ((n+256)>>2)<<8 and the
              "texture" becomes mat+0x14
s, t (16.16 projector coords), w (projector depth <<12)
start biases: s += (flags&4) ? 0xffff : −0x8000;   t += (flags&8) ? −0x8000 : 0x10000
              w0 = ((wT + bias) & 0xffffff) | frameId<<24, with
              dwdy = ((wT−wB)*(Mx−Bx) − (wM−wB)*(Tx−Bx)) / ((Ty−By)*(Mx−Bx) − (My−By)*(Tx−Bx))
                     (0 denominator → dwdy = 0; all products wrap at 32 bits!)
              bias = ((|dwdx| + |dwdy|) << 2) + 0xf0
span clip as 4.4 (n <= 0 → nothing; else n+1 pixels); inner loops 0x490a7/0x4911c (fast) and
0x491e3/0x492a0 (slow), self-modified by 0x49065/0x49086/0x49191/0x491ba with
WB=[0x11a878], X=[0x11a880] (dword table), PT=[0x11a870] (projected texture, teeth.rap frame),
TEX = texture (or phong map)
pixel(uv, s, t, w):
   texel = TEX[((uv>>>24)&255)*256 + ((uv>>8)&255)]
   fast: idx = ((t>>>16)*320 + (s>>>16)) & 0xffff
   slow: if t<0 || t>0xc70000 || s<0 || s>0x13f0000 (signed): return texel
         idx = (t>>>16)*320 + (s>>>16)
   if w < WB[idx] (unsigned): return texel                       // in shadow / not lit
   return 0xfd0a0[ PT[X[idx]] * 256 + texel ]                     // lit by the projector
```
(The part owns WB clearing/frameId, X and PT; see the part 3/5 notes.)

---------------------------------------------------------------------------------------------------

## 9. Quirks a pixel-exact port must keep
1. Screen centre 159,99; projection `(x<<8)/z` truncating toward zero; y flipped.
2. Near plane z=50 by clipping (modes 2/3) with the index-ordered edge interpolation of §2.6.
3. Descending Hoare quicksort with the middle pivot and the pre-sort buffer order of §2.6 (tie
   order between equal keys depends on both).
4. Backface keep threshold `cross >= −1`.
5. Flat filler draws `[left, right)`, template texture fillers draw `[xl, xr]` both inclusive
   (but nothing when xl == xr, except `0x35860`), right clip to 319, rows up to 200.
6. `0x44354`: carry between neighbouring pixels in the aligned 4-pixel groups; column 319 never
   drawn when the polygon is clipped on the right; the row table persists between polygons.
7. Packed u/v: u's carry/borrow propagates into v (e.g. negative du).
8. Triangle engine: rejected triangles redraw the previous triangle's spans.
9. Projector path: 16-bit wrap of the fast-path buffer index, depth bias, s/t half-texel biases.

## 10. Open questions
- `0x3d468` point projection with the logical-shift dividend: only safe for 0 ≤ x < 2^23; whether
  any point faces exist in the worlds with +0xb8 set was not checked (none in the shipped .eob
  scan of face types, but parts can build objects).
- x87 vs double: matrix elements are float32 results of 80-bit sums; expected identical in a JS
  port except in vanishingly rare ties (not emulated: unicorn's `fsin` is host-libm based).
- `0x3d0c4` leaves the sort key stale when an object has neither flag 0x08 nor 0x40 (no shipped
  object does).
