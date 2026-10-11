# E1 — 3D engine: data side (object files, animation, scene structs, recordings)

Scope: what ROBOTNIK.EXE does with `*.eob`, `*.rec`, `teeth.rap`, the in-memory object / world
structures, the public engine API the parts call, and all matrix math up to the point where an
object's final 3x4 matrix is handed to the transform/raster pipeline (E2: `0x3cae0`, `0x3a878`,
`0x3add4`/`0x3acfc`/`0x3ae94`, `0x3d0c4`/`0x3d468`, edge pool, obj2 asm).

Verified with Python parsers in the scratch dir (`agents/E1/eob.py`, `hier.py`, `keys.py`, `rec.py`):
every `.eob` is consumed to the last byte, keyframe matrices match the Euler formula below exactly,
child keyframes are parent-relative, face-normal winding matches, camera recordings give smooth paths.

Conventions used below
- `int` = 32-bit signed, `short` = 16-bit signed. All multi-byte values little-endian.
- **trunc(x)** = what `0x44160` does: `frndint` with RC=chop, i.e. C `(int)x` (round toward zero).
- Angles: engine angles are integers, **4096 units = 2π** (`a*π/2048` or `a*2π/4096`).
- **Matrix layout** (12 floats or 12 ints, "M[0..11]"): column-major 3x4.
  `M[0..2]` = image of X axis, `M[3..5]` = Y axis, `M[6..8]` = Z axis, `M[9..11]` = translation.
  `p' = M[0..2]*x + M[3..5]*y + M[6..8]*z + M[9..11]` (i.e. `M[row + 3*col]`).
- Fixed point: the "int" coordinate domain is the float domain × 256 (`0x51000` int→float = ×1/256,
  `0x50f34` float→int = trunc(×256)). Rotation parts of int matrices are therefore 8.8 (256 = 1.0).

---------------------------------------------------------------------------------------------------

## 1. `.eob` object file format

The `.eob` files are **raw dumps of the in-memory structures** of the Imagine-TDDD-derived library
(the real IFF TDDD parser `readtddd.c` code at 0x3e7f8..0x418b3 is present but unreachable — dead
code). Pointer fields inside the dumped structs contain stale 1996 heap addresses (e.g. 0x5a1868);
the loader only tests them for zero/non-zero.

Loader: `0x24688 LoadObject(name)` = `obj = 0x433b0(name); 0x41c50(obj); return obj`.
`0x433b0` opens the file through the archive (`0x2cfe0` fopen("rb"), `0x2d064` fread,
`0x2d03c` fclose); fatal "Can't load object" if missing; any short read → fatal "load error"
(`0x4301c`). `[0x89ec0]` = verbose flag (prints "Read Object", ... with `0x31170`; parts set it to
1 or 0 — no effect on data).

### 1.1 File layout (recursive, pre-order)

```
ObjectRecord:                      (read by 0x432b0 / 0x43378)
  0x000  u8   header[0xb4]          raw Object struct (see §3.1), allocated 0xb4 bytes, zeroed then filled
         VectorLongCollection  points        -> hdr+0x08 count, hdr+0x0c ptr
         DefPolygonCollection  polygons      -> hdr+0x10 count, hdr+0x14 ptr
         VectorLongCollection  face normals  -> hdr+0x18 count, hdr+0x1c ptr
         VectorLongCollection  corner normals-> hdr+0x20 count, hdr+0x24 ptr ("CornerNormal_Collection")
         MaterialCollection    materials     -> hdr+0x98 count, hdr+0x9c ptr
         if (hdr+0xac != 0) Keyframe list   -> hdr+0xac  (linked list, read until Next==0)
  if (hdr+0x00 != 0) ObjectRecord  -> hdr+0x00  (= NEXT SIBLING; read first)
  if (hdr+0x04 != 0) ObjectRecord  -> hdr+0x04  (= FIRST CHILD)
```

Collections (`0x4304c` vectors, `0x430fc` polygons, `0x431b8` materials):

```
  u32 n                      if n==0 the ptr is set to 0 and nothing else is read
  n * elemSize bytes         elemSize: vector 12, polygon 0x30, material 0x11c
```

Keyframe list (`0x43260`): 0x44-byte records back-to-back; each record's first dword (`Next`)
non-zero means "another keyframe follows". The last one has Next==0.

Every other header field is kept exactly as stored in the file (matrix, flags, ...); `+0xa0/+0xa4`
are overwritten by the material post-pass (§1.5).

### 1.2 Point (12 bytes) — `int x, y, z`

16.16 fixed in the model's units as exported (spider body spans about -121..89 after /65536).
Parts rescale them after loading (§1.7).

### 1.3 Polygon (DefPolygon, 0x30 bytes) — always a triangle

| off | type | meaning |
|---|---|---|
| 0x00 | int | 0 in every file (runtime use: E2) |
| 0x04 | int | material index (into the runtime material array, hdr+0xa4) |
| 0x08 | int | face-normal index (into face-normal collection; coplanar faces share one) |
| 0x0c,0x10,0x14 | int | vertex indices A, B, C |
| 0x18,0x1c | int | texture u,v at A |
| 0x20,0x24 | int | texture u,v at B |
| 0x28,0x2c | int | texture u,v at C |

Texture coords are texel units of a 256-wide texture (seen ranges: u -63..63 for logo,
0..255 for skull; v -27..252) — wrap handling is E2's. Untextured polys have zero u/v.
Verified: face normal has the direction of `(B-A) x (C-A)` in object space (all faces of all files).

### 1.4 Normals (12 bytes) — `int nx, ny, nz`

Unit vectors × 255 (|n| = 253.3..255.0 — truncated). Face normals: count = hdr+0x18;
corner (per-vertex, Gouraud) normals: count must equal point count
(`gfx3.c` asserts `obj->CornerNormal_Collection.n == obj->Point_Collection.n`, 0x3a8e7).
Normals are NOT touched by the point rescale.

### 1.5 Material (disk, 0x11c bytes) and runtime material (0x30 bytes)

Disk material:

| off | type | meaning |
|---|---|---|
| 0x000 | u32 | flags: bit0 = texture-mapped, bit1 = "phong" shade table, bit2 = other map type, bit3 = special (uses table 0x1050cc) |
| 0x004 | char[256] | texture path, e.g. `E:\tomoons2\skultxt.pic`, empty = none |
| 0x104 | int | texture width (must be 256 — assert `dm[i].texture_width==256`) |
| 0x108 | int | texture height |
| 0x10c | float | shade exponent (2.0 in all files) |
| 0x110 | int | 256 in all files |
| 0x114 | int | number of shades (127, 128 or 32 seen) |
| 0x118 | int | base colour index (0 in all files) |

Flags seen: 0 (flat), 1 (texture), 2 (shaded), 3 (shaded+texture), 8, 9 (logo).

`0x418b4 BuildMaterials(obj)` (called for every object of the tree by `0x41c50`, which recurses
sibling (+0) and child (+4)): `obj+0xa0 = obj+0x98` (count), `obj+0xa4 = calloc(n*0x30)`, and for each
disk material `d` → runtime material `m`:

```
table = 0
if (d.flags & 2)
    table = m[+0x14] = ShadeTable(gamma=d.f10c, lo=0, hi=(d.i114*d.i110>>8)-1,
                                  scale=(double)(d.i114*d.i110)/256, base=d.i118, N=0x80, stride=0x100)
m[+0x1c]=0x80; m[+0x20]=0x80; m[+0x24]=0xff; m[+0x10]=0; m[+0x14]=table
m[+0x0c]=0xfd0a0                     // pointer to a global colour/shade table (E2)
m.word[+0x08]=(short)d.i118          // base colour
m[+0x04]=((256-d.i110)*d.i114)>>8    // 0 for all files
// span routine (E2 owns them)
if table: m[+0x2c] = (d.flags&8) ? (m[+0xc]=0x1050cc, 0x29710) : (d.i110!=256 ? 0x44354 : 0x2c118)
else      m[+0x2c] = 0x28b60
if d.name[0]:
    // [0x89ec4]==1 always: name -> _splitpath (0x52878) -> _makepath(no drive, dir "", fname, "raw")
    // [0x89ec8]==0, so the directory is dropped: "E:\tomoons2\skultxt.pic" -> "skultxt.raw"
    raw = archive_load(name)  (0x2cf98)  ; fatal "brush read error3" if missing
    assert(d.width==256)
    m[+0x1c]=d.width; m[+0x20]=d.height; m.word[+8]=0x37; m[+0xc]=0xfd0a0
    m[+0x10]=raw+0x300               // .raw texture = 768-byte palette + width*height pixels
    if table: m[+0x2c] = (d.flags&4)?0x2a9fc : (d.flags&1)?0x35860 : (warn "unknown map type", unchanged)
    else:     m[+0x2c] = (d.flags&8)?(m[+0xc]=0x1050cc,0x29994) : (d.flags&4)?0x2b1a4 : (d.flags&1)?0x331b4
                         : fatal "unknown mapping"
```

(The non-`.raw` branch, `[0x89ec4]==0`, reads an IFF ILBM "brush" via `0x537a4` and asserts
`bh.width==256`; unused.) Texture files referenced: shade.raw (logo; 65536 bytes, so pixel data
starts 0x300 into it), skultxt, teethtxt (256x32), drill1, drillarm, pattrn2, pattrn, torso2 (256x96),
neck — sizes all equal 0x300 + w*h.

Demo-side helpers that override span routines: `0x2469c(obj, fn)` sets `+0x2c=fn` in all runtime
materials of one object; `0x246d0(obj, fn)` the same for the whole tree (sibling+child recursion);
`0x24720(obj, mat)` makes the object use a single runtime material `mat` (`+0xa0=1, +0xa4=mat`,
every polygon `+4 = 0`).

**ShadeTable** (`0x316c4`, cached by its 9 parameters in a linked list at `[0x84c6c]`; cache cleared by
`0x315f0`; generator `0x314c0`): a 128x128 byte radial table (stride 256, 32 KB allocation):

```
h = N*0.5 (=64.0); denom = h*h*2
for j in 0..N-1: for i in 0..N-1:
    r = sqrt(((i-h)^2 + (j-h)^2) / denom)        // 0 at centre, 1 at edge midpoints, 1.414 corners
    v = trunc(pow(1-r, gamma) * scale)           // C pow(): (1-r)<0 with gamma=2.0 gives a positive value
    v = min(v, hi); v = max(v, lo)
    table[j*stride + i] = (u8)(v + base)
```
With the file values: gamma 2, scale = shades, hi = shades-1, base 0. (How it is indexed — by
normals — is E2's.)

### 1.6 Keyframe (0x44 bytes)

| off | type | meaning |
|---|---|---|
| 0x00 | ptr | Next (0 = last) |
| 0x04 | int | frame number (0, 10, 20, 30 for spider; 0..60 for en_obj) |
| 0x08..0x28 | float[9] | 3x3 rotation, column-major (= Rz·Ry·Rx of the angles below; not used by the code) |
| 0x2c,0x30,0x34 | float | position (parent-relative, model units — same scale as point/65536) |
| 0x38,0x3c,0x40 | float | Euler angles rx, ry, rz in radians |

Verified: the stored 3x3 equals `Rz(rz)·Ry(ry)·Rx(rx)` to float precision for every key; positions
are relative to the parent object's frame (spider: the knee joint obj#12 sits at y=-168 in the frame of
the femur obj#11 whose mesh spans y -163..0).

### 1.7 Object tree and rescaling per part

`+0x00` = next sibling, `+0x04` = first child (renderer `0x3c710` and every recursive helper use this
meaning). The file root normally has no sibling. Example trees (parser output):

- spider.eob: 51 objects, 1 root (body, 28 pts) → 9 children (8 leg bases + head axis); each leg is
  axis → femur(26 pts) → axis → tibia → axis → foot, i.e. depth 6. All objects have 4 keys (frames
  0,10,20,30). Note mesh-less "axis" objects (npts=0) still carry a material and keys.
- logo.eob: 1 object, 332 pts/332 tris, 2 materials, no keys.
- skull.eob: 5 objects (skull 423 pts/743 tris, children: 506-pt, 201-pt, 10-pt, 16-pt), no keys.
- en_obj.eob: 33 objects, 7 keys each (frames 0..60).

Parts rescale right after loading (`ScalePoints` = `0x39ad0`, `ScaleKeys` = `0x39bfc`, §4):

| part | object (global) | ScalePoints calls | ScaleKeys | effective point scale |
|---|---|---|---|---|
| 0 | spider [0xdf894] | 1, 1 | 1 | p>>16 (int = model units), keys pos /256 |
| 1 | logo [0xdf894] | 1, 1 | 1 | same |
| 3/5 | skull [0xe1c70] | 1, 0x20 | 0x20 | (p>>8)*32>>8 |
| 9 | en_obj [0x81954] | 1, 1 | 1 | |
| 14 | en_obj [0x95ae4] | 1, 1, 0xc0 | 1, 0xc0 | |
| 14 | skull [0x95af0] | 1, 3 | 3 | |
| 14 | static obj (ecx=0x80dec) [0x95ae8] | 0x200 | 0x200 | |
| 12 | copy of static obj 0x817a4 [0xd1d40] | 0x200 | – | |

After `ScaleKeys(s)` the float key position becomes `pos*s/256`, so after `0x50f34` (×256) the
int translation is `pos*s` — the same int domain as points scaled by `s/256` twice (`p*s*s/65536`
when s=1 → `p>>16`). In short: in the int domain points and translations agree.

---------------------------------------------------------------------------------------------------

## 2. Keyframe animation math (object.c)

### `0x39e08 AnimateTree(obj, time)` — eax=obj, edx=time
Post-order: `AnimateTree(obj->next(+0)); AnimateTree(obj->child(+4)); AnimateObject(obj,time)`.
(Null obj → return.)

### `0x39e30 int AnimLength(obj)` — eax=obj
Returns 0 if no keys, else `lastKey.frame << 8` (spider: 30<<8 = 7680).

### `0x39d50 AnimateObject(obj, time)` — eax=obj, edx=time (frame*256)
```
k = obj->keys (+0xac); if (!k) return;
while (k && k->Next) {                         // find segment
    if (time >= k->frame<<8 && time <= k->Next->frame<<8) break;
    k = k->Next;
}
assert(k && k->Next)                           // "object.c" line 0x1cc: time out of range aborts
float t = (float)(time - (k->frame<<8)) / (float)((k->Next->frame - k->frame) << 8);
float M[12]; InterpKeys(k, k->Next, t, M);     // 0x39ca8
FloatToFixedMatrix(M, &obj->mat /* +0x28 */);  // 0x50f34: obj->mat[i] = trunc(M[i]*256)
```
Callers must keep `time` in [firstFrame*256, lastFrame*256] (part 0 wraps it modulo AnimLength).

### `0x39ca8 InterpKeys(A, B, float t, float *out)` — eax=A, edx=B, stack: t, out (ret 8)
```
rx = LerpAngle(A->rx(+0x38), B->rx, t); ry = LerpAngle(A->ry(+0x3c), B->ry, t); rz = LerpAngle(A->rz(+0x40), B->rz, t)
LoadIdentity(); RotX(rx); RotY(ry); RotZ(rz);        // each pre-multiplies → cur = Rz·Ry·Rx
StoreMatrix(out);
out[9..11] = Lerp3(A->pos, B->pos, t)                 // 0x396e8: a + (b-a)*t, float
```

### `0x513a0 float LerpAngle(float a, float b, float t)` — cdecl-ish, args on stack (ret 0xc)
Shortest-path interpolation quantised to 4096 steps per turn and t to 1/256:
```
ia = trunc(a*2048/π) & 0xfff;  ib = trunc(b*2048/π) & 0xfff;  it = trunc(t*256)
d = (ib - ia) & 0xfff
if (d < 0x800) r = ia + (it*d >> 8)
else           r = ia - (it*((0x1000-d)&0xfff) >> 8)
r &= 0xfff
return r * π/2048            // (float on FPU stack)
```
(`a*2048/π` is computed as `a*2048*0.31831` — the constant at 0x8f67d is 1/π as a double.)

### Matrix stack (0x50ad0..0x50f80) — float 3x4, "cur" = `[0x8bbb0]`, scratch = `[0x8bbb4]`
| addr | name | behaviour |
|---|---|---|
| 0x50ad0 | SetIdentity(eax=m) | |
| 0x50bdc | LoadIdentity() | cur=0x11a8b0, tmp=0x11a8e0, cur=I |
| 0x50c00 | LoadMatrix(eax=m) | cur = copy of m |
| 0x50c5c | StoreMatrix(eax=m) | m = cur |
| 0x50c30 | PreMul(eax=A) | cur = A·cur |
| 0x50914 | MatMul(eax=A, edx=B, ebx=out) | out = A·B (3x4 affine: out.t = A.R·B.t + A.t) |
| 0x50c74 | RotX(float a) (stack) | cur = Rx(a)·cur; Rx: y'=c·y−s·z, z'=s·y+c·z |
| 0x50cc8 | RotY(float a) | cur = Ry(a)·cur; x'=c·x+s·z, z'=−s·x+c·z |
| 0x50d18 | RotZ(float a) | cur = Rz(a)·cur; x'=c·x−s·y, y'=s·x+c·y |
| 0x50d6c | Translate(float x,y,z) | cur.t += (x,y,z)  (= T·cur) |
| 0x50d9c | Invert() | cur = rigid inverse (Rᵀ, −Rᵀt) via 0x50a44 |
| 0x50f34 | FloatToFixedMatrix(eax=f, edx=i) | i[k] = trunc(f[k]*256) |
| 0x51000 | FixedToFloatMatrix(eax=i, edx=f) | f[k] = i[k]/256 |

### Final object matrix (in renderer `0x3c710` → `0x3c81c`, before E2's code)
The renderer walks the **global** object list `[0x89e04]` (see §3.3). For each list entry, with
`P` = the world's view matrix (world+0x3c), and recursively for children with `P` = parent's result:
```
if (obj->ax==0 && obj->ay==0 && obj->az==0)   // words +0x64,+0x66,+0x68
    cur = Float(obj->mat)                      // K, from file header or AnimateObject
else {
    cur = I; RotX(ax*2π/4096); RotY(ay*2π/4096); RotZ(az*2π/4096);   // angles read as UNSIGNED words
    cur = Float(obj->mat) · cur                // K · Rz·Ry·Rx
}
Translate(obj->x/256, obj->y/256, obj->z/256)  // ints +0x58,+0x5c,+0x60
cur = P · cur                                  // this is also the P passed to obj's children
M8_8 = FloatToFixedMatrix(cur)                 // handed to E2: cull 0x3cae0, transform 0x3a878, ...
```
So `objectToView = View · Parent... · T(pos/256) · K · Rz(az)·Ry(ay)·Rx(ax)`.
Objects with `(+0x84 & 0x1000)` (byte +0x85 bit 4) are skipped (hidden) — but their children are
still visited by the list walk.

---------------------------------------------------------------------------------------------------

## 3. In-memory structures

### 3.1 Object (0xb4 bytes; same layout in the file header and in the static objects at 0x82a74 etc.)

| off | type | meaning |
|---|---|---|
| 0x00 | Object* | next sibling. **Also the world-list link**: `AddObject` overwrites it (§3.3) |
| 0x04 | Object* | first child |
| 0x08 / 0x0c | int / int(*)[3] | point count / points |
| 0x10 / 0x14 | int / Polygon* | polygon count / polygons (0x30 each) |
| 0x18 / 0x1c | int / int(*)[3] | face-normal count / face normals |
| 0x20 / 0x24 | int / int(*)[3] | corner-normal count / corner normals |
| 0x28..0x57 | int[12] | K: local 3x4 matrix, 8.8 rotation, int-domain translation at +0x4c,+0x50,+0x54. Initial value from file (the export's rest pose; it differs from key 0 rotation-wise, so animated objects must be animated before first draw) |
| 0x58,0x5c,0x60 | int | extra position (int domain), set by SetObjPos; 0 in files |
| 0x64,0x66,0x68 | short | extra angles ax, ay, az (4096/turn), set by SetObjAngle*; 0 in files |
| 0x6c,0x70 | int | bbox min x, max x (object space, computed by 0x3c18c) |
| 0x74,0x78 | int | bbox min y, max y |
| 0x7c,0x80 | int | bbox min z, max z |
| 0x84 | u32 | render flags (files: 0x20e spider/skull, 0x246 logo, 0x20a en_obj). bit 0x1000 = hidden. Others (0x2, 0x4, 0x80, 0x4000...) select E2 paths. Demo helpers: `0x27798(obj,bits)` ORs bits into the whole tree, `0x277bc(obj,bits)` clears them |
| 0x88,0x8c,0x90 | int | bbox centre ((min+max)/2, C signed division) |
| 0x94 | int | bounding radius: max over the 8 corners of trunc(sqrt(dx²+dy²+dz²)) — 32-bit `imul`, wraps for huge coords |
| 0x98 / 0x9c | int / ptr | disk material count / disk materials (0x11c each) |
| 0xa0 / 0xa4 | int / ptr | runtime material count / runtime materials (0x30 each) |
| 0xa8 | – | 0 in files, not used here |
| 0xac | Keyframe* | key list, 0 = not animated |
| 0xb0 | – | 0 in files, not used here |

### 3.2 Runtime material (0x30 bytes)
`+0x04` int, `+0x08` short colour base (0x37 if textured), `+0x0c` ptr global table (0xfd0a0 or
0x1050cc), `+0x10` texture pixels, `+0x14` shade table, `+0x1c` tex width, `+0x20` tex height,
`+0x24` 0xff, `+0x2c` span routine. Details/semantics: E2.

### 3.3 World / camera (0xbc bytes, `0x39e68 CreateWorld`)

| off | type | meaning |
|---|---|---|
| 0x04,0x08,0x0c | int | camera position (int domain) |
| 0x10,0x12,0x14 | short | camera angles ax (pitch), ay (yaw), az (roll), 4096/turn |
| 0x18 | int | 0x100 (not used by the render entry) |
| 0x1c | byte | 1 |
| 0x20, 0x24 | int | screen centre x=159, y=99 (also copied to [0x89df8],[0x89dfc]) |
| 0x28 | byte | 0 |
| 0x29 | byte | render mode, 1 at creation; every part sets 3 via `0x3a5b4` (mode 2/3 → extra passes 0x3dad8/0x3dc10 and bbox culling; E2) |
| 0x2c | ptr | calloc(maxVerts*36) – transformed-vertex buffer → [0x89dd0] |
| 0x30 | ptr | calloc(maxPolys*164) → [0x89dd8] |
| 0x34 | ptr | calloc(arg4*12) → [0x89dd4] |
| 0x38 | ptr | calloc(maxPolys*8) → [0x89ddc] |
| 0x3c..0x6b | float[12] | view matrix (world → camera) |
| 0x6c..0x9b | float[12] | camera → world (inverse of the above) |
| 0x90,0x94,0x98 | float | = translation column of the +0x6c matrix = camera position / 256 |
| 0x9c | int | 100000 |
| 0xa0 | bit0 | if set, CreateWorld/DestroyWorld/render call 0x5160c/0x51628 (edge-pool alloc; E2). Cleared at creation |
| 0xa4 | int | arg1 (30 in every call) |
| 0xa8,0xac | int | arg3 (maxPolys) |
| 0xb0 | int | arg4 |
| 0xb4 | int | arg3*4 |
| 0xb8 | int | 0; non-zero selects the 0x3d468 draw path (E2) |

Note on +0x90: the camera→world matrix occupies +0x6c..+0x9b, so its translation column is exactly
+0x90/+0x94/+0x98 — "camera position / 256" *is* the translation of the camera→world matrix.
`SetCameraPos` writes it directly into that slot, then re-inverts (see below).

`0x39e68 World* CreateWorld(a1=eax, maxVerts=edx, maxPolys=ebx, a4=ecx)`: `[0x84c80]++`;
calloc 0xbc; fields as above; `cur=I → +0x3c`, `Invert → +0x6c`; **clears the global object list**
(`[0x89e00]=[0x89e04]=0`); `0x3c438` copies {1,0,0,0,0,0} to globals 0x106c68..0x106c7c.
All parts call it with (30, 0x76c=1900, 0xa8c=2700, 0xa8c), part 14 with (0x3c, 0xed8, ...).

`0x39fd8 DestroyWorld(w)`: `[0x84c80]--`, free +0x2c,+0x30,+0x34,+0x38 (zeroing them), if
`+0xa0 & 1` call 0x5160c and clear the bit, free w. Does **not** clear the object list.

The object list is **global**, not per world: `[0x89e04]` = head, linked through `obj+0x00`.
`[0x89e00]` is a fake "object" whose `+4` field is the head (used by 0x3a598).

---------------------------------------------------------------------------------------------------

## 4. Public engine API (calls made by the parts)

Register args unless stated. "by value vec" = struct pushed on the stack (callee pops).
Functions that "return a vec" write it to `[esi]` and return esi in eax.

| addr | name / signature | behaviour |
|---|---|---|
| 0x433b0 | Object* LoadObjectTree(char *name) | §1.1; no materials post-pass |
| 0x41c50 | BuildMaterialsTree(Object*) | §1.5 for obj, its siblings and children |
| 0x24688 | Object* LoadObject(name) | demo wrapper: 0x433b0 + 0x41c50 |
| 0x39e68 | World* CreateWorld(a1, maxVerts, maxPolys, a4) | §3.3 |
| 0x39fd8 | DestroyWorld(World*) | §3.3 |
| 0x3a590 | AddObject(World *w (ignored), Object *o=edx) | → 0x3c02c: `o->next(+0) = [0x89e04]; [0x89e04] = o`. Overwrites +0; files' roots have +0 = 0 so nothing is lost. Objects added later are drawn first |
| 0x3a598 | ComputeBounds(World* ignored) | → 0x3c418(0x89e00): for every object reachable from the list (siblings+children, recursive) compute bbox/centre/radius (§3.1, 0x3c18c). Must be called after rescaling. Objects without points get all-zero bbox |
| 0x3a5b4 | SetRenderMode(World*, mode=dl) | `w+0x29 = dl` (parts: 3) |
| 0x3a4e0 | RenderWorld(World*) | copies cam pos to [0x89e58..60], angles to [0x89e64..68], buffers to [0x89dd0/d8/d4/dc], centre to [0x89df8/fc], CurrentWorld [0x106330]=w, calls 0x3c710 (the per-object loop of §2, then E2), CurrentWorld=0 |
| 0x457f0 | RenderWorldProjected(World *proj, World *cam=edx) | skull/shadow parts: pass 1 with a copy of `proj` using `cam`'s matrices/buffers/centre (0x45930), pass 2 with `proj` (0x4671c). E2 |
| 0x3a810 | int SetDefaultTargets() | `[0x106b58]=0xa0000` (VGA), `[0x89dcc]=0xe4d40` (back buffer); returns 1 |
| 0x3a114 | SetCameraPos(World*, int x, y, z) (stack, ret 0xc) | `w+4..+0xc = x,y,z`; `w+0x90.. = x/256, y/256, z/256` (float); `LoadMatrix(w+0x6c)` (which now contains the new translation); `Invert`; `Store → w+0x3c`. I.e. moves the camera keeping its orientation |
| 0x3a2bc | SetCameraAngles(World*, short ang[3] by value, ret 8) | `w+0x10.. = ax,ay,az`; `cur=I; Translate(-w+0x90,-w+0x94,-w+0x98); RotY(-ay·π/2048); RotX(-ax·π/2048); RotZ(-az·π/2048)` → **view = Rz(−az)·Rx(−ax)·Ry(−ay)·T(−pos)**, store → +0x3c, Invert → +0x6c |
| 0x3a178 | vec3i GetCameraPos(World*) | (trunc(+0x90*256), trunc(+0x94*256), trunc(+0x98*256)) |
| 0x3a250 | vec3i GetCameraAngles(World*) | sign-extended words +0x10,+0x12,+0x14 |
| 0x3a288 | vec3s GetCameraAnglesS(World*) | the three words |
| 0x3a66c | CameraPitchLocal(World*, short a=dx) | cur=I; RotX(a·2π/4096); `cur = (w+0x6c)·cur`; store +0x6c; Invert → +0x3c. (Does not update the ints +0x4.. or the angles +0x10..; the move variants below do change +0x90.. since that is the matrix translation) |
| 0x3a714 | CameraMoveLocalZ(World*, int d) | as above with Translate(0,0,d/256): move along the camera's own Z |
| 0x3a764 | CameraMoveLocalX(World*, int d) | Translate(d/256,0,0) |
| 0x3a7b4 | CameraMoveLocalY(World*, int d) | Translate(0,d/256,0) |
| 0x39a2c | SetObjPos(Object*, int x, y, z) (stack, ret 0xc) | +0x58,+0x5c,+0x60 |
| 0x39a58 | SetObjZ(Object*, int z=edx) | +0x60 |
| 0x39a64 | int GetObjZ(Object*) | +0x60 |
| 0x39b04 | vec3i GetObjPos(Object*) | +0x58.. |
| 0x39a70 / 0x39a78 / 0x39a80 | SetObjAngleX/Y/Z(Object*, short dx) | word +0x64 / +0x66 / +0x68 |
| 0x39b30 | SetObjAngles(Object*, short ang[3] by value, ret 8) | +0x64,+0x66,+0x68 |
| 0x39b50 | vec3s GetObjAngles(Object*) | |
| 0x39ad0 | ScalePoints(Object*, int s=edx) | recursive (self, then +0 then +4 chain): every point component `c = (c*s) >> 8` (32-bit imul, arithmetic shift) via 0x3c140. Normals untouched |
| 0x39bfc | ScaleKeys(Object*, int s=edx) | recursive (+0 subtree, +4 subtree, then self): `+0x4c,+0x50,+0x54 = (v*s)>>8`; every key pos `*= s/256.0` (float). Not +0x58 |
| 0x39e08 / 0x39e30 / 0x39d50 | AnimateTree / AnimLength / AnimateObject | §2 |
| 0x39210 | vec3s MakeVec3s(ax, dx, bx) | |
| 0x39234 | vec3i MakeVec3i(eax, edx, ebx) | |
| 0x39258 | vec3i CopyVec3i(vec by value) (ret 0xc) | |
| 0x39288 | vec3s AddVec3s(a, b by value) (ret 0x10) | 16-bit adds |
| 0x392cc | vec3i AddVec3i(a, b by value) (ret 0x18) | |
| 0x39398 | vec3i SubVec3i(a, b) | a−b |
| 0x394fc | int DotVec3i(a, b) | a·b, no shift |
| 0x39524 | vec3i CrossVec3i(a, b) | x=(ay·bz−az·by)>>8, y=(−(ax·bz−az·bx))>>8, z=(ax·by−ay·bx)>>8 |
| 0x393dc | vec3f SubVec3f(a, b) | |
| 0x39594 | vec3f CrossVec3f(a, b) | standard a×b |
| 0x396e8 | vec3f LerpVec3f(a, b, float t) (ret 0x1c) | a + (b−a)·t |

Typical part setup (part 0, `0x21674`):
```
spider = LoadObject("spider.eob"); w = CreateWorld(30, 0x76c, 0xa8c, 0xa8c)
SetObjPos/SetObjAngle* on four static billboard objects; AddObject(w, each)
ScalePoints(spider,1); ScalePoints(spider,1); ScaleKeys(spider,1)
ComputeBounds(w); SetRenderMode(w,3)
```
Per frame: set object pos/angles, `AnimateTree(root, t)`, camera (SetCameraAngles + SetCameraPos,
or a recording, §5), `RenderWorld(w)`.

Order subtlety: `SetCameraPos` alone only replaces the translation of +0x6c and re-inverts, while
`SetCameraAngles` rebuilds everything from +0x90 and the angles. The recording player calls
Pos then Angles (exact). Part 0's orbit camera calls Angles then Pos — the result is the same final
matrices (Angles uses the previous position, then Pos overwrites the translation slot of +0x6c and
re-inverts), i.e. exact as well.

---------------------------------------------------------------------------------------------------

## 5. Recordings: `.rec` and `teeth.rap`

All `.rec` files are raw arrays written by the demo's own recorder (record mode is selected by the
flags `[0x820e4]`, `[0x820e8]`, `[0x820ec]`, `[0x8326c]`, `[0x83270]`... and writes the buffer with
`0x1e174` (`0x27874`) or byte-appends with `0x26dd0`); in the release they are only played back.
Time base everywhere: **frames of the 70.086 Hz timer** `[0x91260]` (re-derived from the music row at
part starts), measured from the part's own start.

### 5.1 12-byte camera recordings
Files: cl_cam1 (part 10, 1823 recs = 26.0 s), sh_cam1/sh_proj1 (part 3, 1697), sh_cam2 (part 5,
1193), sh_proj2 (part 5, 1192), cy_cam1 (part 9, 2761), hy_cam (part 12, 5604 = 80 s),
end_cam (part 14, 2646).

```
struct CamRec { short x, y, z;      // camera position, int domain (truncated to 16 bits when recorded)
                short ax, ay, az; } // camera angles, 4096 per turn (values may exceed ±4096 – multiple turns)
```
Player `0x2789c(World *w, Ctl *c)` (Ctl: `+0` index, `+4` record cursor, `+0xc` buffer):
```
r = &buf[c->index]
SetCameraPos(w, r->x, r->y, r->z)          // sign-extended
SetCameraAngles(w, {r->ax, r->ay, r->az})
```
No interpolation: index = frames elapsed since the part started (e.g. part 10: `[0x9229c] =
[0x91260] - start`; skull part: `[0xe0c50]`/`[0xe0c40] = [esp+0x64]` for the camera world
`[0xe1c80]` and the projector world `[0xe1c64]`). The recorder `0x277e4` fills every index from the
last written one up to the current one with the current pose (so recordings have no gaps).
Sample values (python): cl_cam1 frame 0 pos (0,-369,-13) ang (3095,0,0); hy_cam frame 0
(0,4000,-12000) ang (-255,0,0), frame 70 (0,3999,-11999) ang (-60,0,0).

### 5.2 Part 0 (spider) recordings — 16 "ticks" (frames) per record
dt each loop iteration = `[0x91260]` − previous value (frames). Three independent players with
accumulator/index/fraction globals; each one, *after* the frame is drawn, does
`acc += dt; while (acc >= 16) { ...; idx++; acc -= 16 } frac = acc & 15`.

**camera.rec** — 98 × `int ch[4]` = {pitch, yaw, roll, distance}; state init {0,0,0,0x251c}.
Quadratic segment through three records (`0x26d44 MakeQuad(p0,p1,p2,n=16)`, doubles):
```
B = (p2-p0)*0.5;  A = (p2 - B) - p1;  C = p1;  D = 1/16      // f(0)=p1, f(1)=p2, f'(0)=B
f(frac) = ((A*s) + B)*s + C, s = frac*D
```
At part start splines are built from rec[0..2]; on every 16-frame boundary they are rebuilt from
`rec[idx], rec[idx+1], rec[idx+2]` and then `idx++` (idx starts at 0, so the first segment is
played twice). Each frame (`0x26e1c`): for c in 0..3: `state[c] = (state[c] + trunc(f_c(frac))) >> 1`
(a 2-tap low-pass, arithmetic shift). Then an orbit camera around the spider position P (GetObjPos):
```
C = (P.x, P.y, P.z - state[3]/1)                 // divisor = 1 (stack arg)
a = state[0]*π/2048:  dy=C.y-P.y, dz=C.z-P.z;  C.y = trunc(P.y + dy·cos a − dz·sin a);  C.z = trunc(P.z + dy·sin a + dz·cos a)
b = state[1]*π/2048:  dx=C.x-P.x, dz=C.z-P.z;  C.x = trunc(P.x + dx·cos b + dz·sin b);  C.z = trunc(P.z − dx·sin b + dz·cos b)
SetCameraAngles(w, {(short)state[0], (short)state[1], (short)state[2]});  SetCameraPos(w, C.x, C.y, C.z)
```
(python sample, dt=1: t=0 {0,0,0,9444}, t=140 {158,0,0,4662}, t=420 {185,1304,111,3427}.)

**spider.rec** — 98 × `int ch[4]`, linear: `v_c = (rec[i].c*(16-frac) + rec[i+1].c*frac) >> 4`
(globals idx `[0xde734]`, frac `[0xde738]`, acc `[0xde730]`). Use (`0x20ece`..):
`SetObjAngleY(spider, (short)((0x100 - ch0) << 3))`, `SetObjPos(spider, ch1, 0, ch2)`,
animation clock `T += ch3*200` **per loop iteration** (not scaled by dt), wrapped into
[0, AnimLength) and `AnimateTree(spider, T)`. First records: (256,0,0,0).

**light.rec** — 80 × `int (x, y)`, linear like spider.rec (`[0xde724]` idx, `[0xde728]` frac,
`[0xde720]` acc) then low-passed: `L.x = (L.x + v.x) >> 1`, same for y; L initialised to rec[0]
when the trigger sync point is reached. (160,105), (156,109), ... — a 0..255 texture-space spot
position used by the cave light (passed to 0x317f8 / 0x31934 with the cave material's table and
texture, and to place the two flare objects at `(L.x*16-0x800, 1000, (0x80-L.y)*16)` and
`((L.x-0x80)*0x27, -100, (0x60-L.y)*0x27)`); only active in a window of the part's sync table —
see the part-0 notes.

### 5.3 `teeth.rap` (skull parts 3/5)
184320 bytes = **36 frames × 5120 bytes**. Each frame is 4-bit packed: `0x49028(src=esi, dst=edi)`
expands 0x1400 bytes to 0x2800: for each source byte b → `dst[2k] = b & 15, dst[2k+1] = b >> 4`.
Destination `[0x11a870]` (10240 texels of intensity 0..15). Frame selection each loop iteration:
```
f = (frames >> 3) % 72;  if (f > 35) f = 71 - f;      // ping-pong 0..35..0, 8 frames per step
if (f != previous) unpack(rap + f*0x1400)
```
The expanded map is consumed by the projector span routines 0x490a7/0x4911c (patched by 0x49065
with `[0x11a870]`, `[0x11a878]`, `[0x11a880]`) as the high byte into the shade table 0xfd0a0 — E2 / skull
part.

---------------------------------------------------------------------------------------------------

## 6. Verification snippets (python, scratch `agents/E1/`)

```
spider.eob: consumed 123456/123456, 51 objects; body 28 pts 45 tris bbox x -121.24..89.20 y -70.37..70.37 z -15.50..68.77 (/65536)
logo.eob  : 1 object 332 pts 332 tris, bbox x -1274.7..1114.1
skull.eob : 5 objects (423/506/201/10/16 pts)
en_obj.eob: 33 objects, 7 keys each, last frame 60
key matrix == Rz·Ry·Rx(euler): max diff 0.0 for all checked keys
face normal sign == (B-A)x(C-A): 45/45, 332/332, 743/743, 12/12
```

## Open questions / notes for E2 and part agents
- Meaning of object flag bits other than 0x1000 (hidden), and of world `+0x18`, `+0x1c`, `+0x28`,
  `+0xa4` (=30), `+0x9c` (=100000; probably far plane) — all consumed by E2's code.
- Polygon `+0x00` is always 0 in files; runtime meaning (if any) is E2's.
- The header K matrix of animated objects is the export's rest pose and differs from key 0; it is
  only visible if an animated object is drawn before its first AnimateTree call.
- The static objects (0x82a74, 0x82f60, 0x83080, 0x831a0, 0x80dec, 0x817a4...) are built into the
  data segment with the same Object layout (pointers into obj3); part agents should dump them with
  `peek.py` when porting those parts.
