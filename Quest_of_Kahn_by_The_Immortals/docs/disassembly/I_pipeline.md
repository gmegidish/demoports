# I. 3D engine per-frame pipeline (KAHN.EXE)

Slice: sub_2c7a8, sub_2d150, sub_2f2f0, sub_2f43c, math 0x2fb78..0x31550, sub_23bc8, sub_23c48,
quaternion helpers 0x3ce38..0x3d230. All floats are float32 unless marked f64. x87 keeps extended
precision inside an expression; a value only becomes float32 when it is stored ("-> f32").

## 0. Big picture (read this first; several assumptions in the task text were wrong)

Per frame, a demo part does:

```
[0x5c994] (f32 frame) = (float)timer * [0x5c990] / (float)duration + (int)(u16)[0x5c98c]   // done by the PART, e.g. 0x144c1..0x144f3
sub_2f43c();      // no arguments. Evaluates all tracks at [0x5c994], builds matrices, transforms vertices/normals to VIEW space, env-map uv
sub_2c7a8();      // no arguments. Culls faces, computes sort key, radix-sorts face pointers. DRAWS NOTHING.
part_draw();      // per-part function (0x14348, 0x14783, 0x14eac, 0x16159, 0x161e0, 0x16686, 0x16b04, 0x170e0, 0x18332)
                  // walks the sorted list back to front and calls the polygon drawers by face flag
```

- sub_2c7a8 is "cull + depth sort", not "render". Face dispatch is in each part (table in section 6).
- Perspective projection and near-plane clipping (z = 1.0) are inside the polygon drawers
  (0x24b54 etc.), not in this slice. I quote the formula from 0x24e37 in section 5.
- There is NO lighting computation anywhere in this slice, and the drawers (0x23cf0..0x2c750) read no
  light data (the only 0x5c9xx globals they touch are 0x5c998, 0x5c99c, 0x5c9a0, 0x5c9a8). Light nodes
  are animated and transformed to view space (light+0x24) but nothing in the per-frame path reads
  that. The only "shading" input produced here is the env-map uv written into vertex+0x30/+0x34
  from the rotated vertex normal (objects with flags2 bit 2). No ambient, no clamping, no shade value.
- Rotation tracks are NOT slerp/squad. The loader pre-multiplies the axis-angle keys into absolute
  quaternions; at run time the 4 quaternion components are interpolated with the same TCB Hermite
  spline as positions, then the matrix builder divides by |q|^2 (so no normalisation is needed).
- No pivot is applied in this slice (no pivot field is read). If pivots exist they are baked by the loader.

## 1. Globals

| addr | type | meaning |
|---|---|---|
| 0x5c964 | ptr | render list head (scene+0). Item: see 2.7 |
| 0x5c96c | ptr | node list head (scene+4). Node: see 2.6 |
| 0x5c974 | ptr | scene+8 (not read in this slice) |
| 0x5c97c | ptr | scene+0xc (not read in this slice) |
| 0x5c980 | u32 | scene+0x14 (not read in this slice) |
| 0x5c984 | u32 | scene+0x10: capacity of the sort buffers (number of sortable faces) |
| 0x5c988 | ptr | active camera struct (scene+0x18). Parts overwrite it to switch cameras |
| 0x5c98c | u16 | scene+0x1c: first frame (added by the parts when computing the frame) |
| 0x5c98e | u16 | scene+0x1e (last frame, presumably; read once at 0x16e81 by a part) |
| 0x5c990 | f32 | scene+0x20: frame span multiplier used by the parts |
| 0x5c994 | f32 | CURRENT FRAME, the only input of sub_2f43c. Written by the parts |
| 0x5c998 | u16 | scene+0x24, read only by sub_27434 (sprite drawer; size) |
| 0x5c99c | f32 | projection scale X = (W*0.5)/tan(fov/2) |
| 0x5c9a0 | f32 | projection scale Y = (H*0.5/0.75)/tan(fov/2) |
| 0x5e0c8 | ptr | sort buffer A: u32[0x5c984] of face pointers. Holds the FINAL sorted list |
| 0x5e0cc | ptr | sort buffer B (scratch) |
| 0x5e0d0 | u32 | number of faces in the sorted list this frame |
| 0x5e0c0 | u32 | statistics: running total of visible faces (+= count each frame) |
| 0x5e0c4 | u32 | statistics: number of sub_2c7a8 calls |
| 0x5d0b0, 0x5d4b4, 0x5d8b8, 0x5dcbc | u32[257] each | radix histograms for key byte 0,1,2,3 (0x404 bytes each) |
| 0x5e0e0 | ptr | scene being loaded (loader) |
| 0x5e164 | ptr | 20-byte buffer: 5 floats T,C,B,easeTo,easeFrom of the key being loaded |
| 0x55fe8 | u32 | rand() seed, initial value 1 |
| 0x54730 | f32 | 1.0 = near plane z |
| 0x5472c | f32 | 0.75 = aspect constant |

Constants used: 0x51d1c f64 0.5; 0x51d24 f64 0.005555555555555555 (1/180); 0x51d2c f64 3.141592687
(NOT exact pi; bytes 62 24 c0 58 fb 21 09 40); the copies at 0x519af/0x519b7/0x519bf are identical;
0x51d34 f64 128.0; 0x51d3c f64 127.0; 0x51968 f64 49152.0; 0x51970 f64 16384.0.

## 2. Structures (offset: type meaning; every field touched in this slice)

### 2.1 Scene (0x2a bytes, allocated in sub_2f1bc), copied to globals by sub_2d150
```
+00 ptr  render list head            -> 0x5c964
+04 ptr  node list head              -> 0x5c96c
+08 ptr  ?                           -> 0x5c974
+0c ptr  ?                           -> 0x5c97c
+10 u32  sortable face count         -> 0x5c984
+14 u32  ?                           -> 0x5c980
+18 ptr  default camera              -> 0x5c988
+1c u16  first frame                 -> 0x5c98c
+1e u16  ?(last frame)               -> 0x5c98e
+20 f32  frame span                  -> 0x5c990
+24 u16  (2nd arg of the loader)     -> 0x5c998
+26 ptr  768-byte palette copy       (not used here)
```

### 2.2 Track header (0x12 bytes)
```
+00 u32  n      number of keys
+04 u32  cur    while loading: next key slot to fill; after sub_308fc: index of the current segment (cursor, persistent between frames)
+08 u32  len    frame number of the last key (set by sub_308fc)
+0c u16  loop   0 = no loop. Rotation loader (0x2e554): file flags&2 -> 0x00f0, then file flags&3 -> 0x0f00 (overrides)
+0e ptr  keys   n * 0x56 bytes
```
### 2.3 Key (0x56 bytes, unaligned)
```
+00 u16  frame
+02 f32  v[0]   (float tracks: the value; vec3: x; rotation: qx)
+06 f32  v[1]   (y / qy)
+0a f32  v[2]   (z / qz)
+0e f32  v[3]   (rotation: qw)
+12 u32  rotation only: trunc(angle*180.0*0.31831) = key angle in whole degrees. Not read in this slice
+16 ptr  morph only: target object
+1a f32  T tension
+1e f32  C continuity
+22 f32  B bias
+26 f32  easeTo
+2a f32  easeFrom
+2e f32[4] ds  incoming tangent (one per v[i])
+3e ..   (4 bytes unused)
+42 f32[4] dd  outgoing tangent
+52 ..   (4 bytes unused)
```
### 2.4 Object / mesh (node type 0 data, render item type 0 data)
```
+0c ptr  vertices (0x40 bytes each)
+10 ptr  faces (0x35 bytes each)
+14 u32  vertex count
+18 u32  face count
+1c u16  flags: bit0 (1) hidden?(cleared when a hide track is attached, 0x2cfc3); bit1 (2) hidden, toggled by the hide track;
               bit2 (4) skip; bit3 (8) has morph track (set at 0x2cfd0); bit4 (0x10) "do not draw" (set by parts, e.g. 0x14afe)
               transform is skipped if flags & 7; cull/sort is skipped if flags & 0x17
+1e u16  flags2: bit2 (4) = has vertex normals -> env-map uv generated each frame
+60 f32[3] position (track 0). After the hierarchy pass: WORLD position
+6c f32[4] rotation quaternion x,y,z,w (track 1), overwritten every frame
+80 f32[3] scale (track 2)
+8c f32[9] M = R * diag(scale). After the hierarchy pass: world matrix
+b0 f32[9] R = pure rotation of this object only (NOT multiplied by parents)
+d4 ptr  morph source A
+d8 ptr  morph source B
+dc f32  morph weight w (weight of A; B gets 1-w)
```
### 2.5 Vertex (0x40) and face (0x35)
```
vertex +00 f32[3] object-space position      face +00 ptr vertex 0
       +0c f32[3] object-space normal             +04 ptr vertex 1
       +18 f32[3] VIEW-space position             +08 ptr vertex 2
       +24 f32[2] view-rotated normal x,y         +0c f32[3] object-space normal
       +30 f32    u                               +18 f32[3] view-space normal (M-transformed, not renormalised)
       +34 f32    v                               +2c u32 sort key
                                                  +30 u8  flags (bit3 = two-sided/no backface cull; bits 0x02,0x10,0x20,0x40,0x80 pick the drawer)
                                                  +31 u32 (texture pointer, read by the drawers)
```
### 2.6 Node (list at 0x5c96c) and child link
```
+00 u16 type: 0 object, 1 camera, 2 camera target, 3 light
+02 u16 id (compared by sub_2cf78)
+04 ptr data (object / camera / camera (for a target) / light)
+08 ptr tracks: array of track pointers
          object: [0] position, [1] rotation, [2] scale, [3] hide (may be NULL), [4] morph (may be NULL)
          camera: [0] position, [1] roll, [2] fov
          target: [0] position       light: [0] position
+0c ptr first child
+10 ptr next sibling (used when walking a child list)
+14 ptr next node (global list)
```
Children are read with the same +00 type / +04 data layout, so a child is almost certainly a node.

Camera: `+10 f32[3] position, +1c f32[3] target, +28 f32 roll (radians; loader multiplies by 3.141592687/180), +2c f32 fov (degrees), +30 f32[9] view matrix`.
Light: `+0c f32[3] position, +24 f32[3] view-space position`.

### 2.7 Render list item (list at 0x5c964, packed)
```
+00 u16 type: 0 = mesh, 2 = sprite-like item
+02 ptr data
+06 ptr next
```
Type 2 data: `+4c` is an embedded pseudo-face: `[+4c]` ptr to a vertex (its view z at vertex+0x20 is used),
`+78` (= pseudo-face+0x2c) sort key, `+7c` flags byte, `+7d` texture. Drawn by sub_27434 (flag 0x80).

## 3. Small math (all register args; 3x3 matrices are 9 floats, row-major m[r*3+c], column vectors)

```
sub_23aa0(eax=a, edx=b, ebx=out)  out = a + b            (vec3)
sub_23ac4(eax=a, edx=b, ebx=out)  out = a - b
sub_23b6c(eax=a, edx=b) -> ST0    dot = a.y*b.y + a.x*b.x + a.z*b.z   (this summation order)
sub_23b8c(eax=a, edx=b, ebx=out)  out = (a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x)
sub_23c28(eax=a) -> ST0           sqrt(a.y*a.y + a.x*a.x + a.z*a.z)
sub_23c90(eax=src, edx=dst)       copy 12 bytes
sub_23cbc(stack x, y, z, out)     out = (x,y,z)   (ret 0x10)

sub_23bc8(eax=v)  normalize vec3 in place:
    l2 = (f32)(v.y*v.y + v.x*v.x + v.z*v.z);
    if (0 >= l2) return;               // left untouched
    k = 1 / sqrt(l2);  v.x *= k; v.y *= k; v.z *= k;

sub_23c48(eax=a, edx=b, stack: f32 s, f32 t, ptr out)   (ret 0xc)
    out[i] = a[i]*s + b[i]*t   for i = 0..2

sub_312b0(eax=M, edx=v, ebx=out)  out[r] = M[r][1]*v.y + M[r][0]*v.x + M[r][2]*v.z   r=0..2   (out must not alias v)
sub_31304(eax=M, edx=v, ebx=out)  same, rows 0 and 1 only (writes out[0], out[1])
sub_31340(eax=A, edx=B, ebx=out)  out = A * B   (out[r][c] = sum_k A[r][k]*B[k][c])
sub_31428(eax=M, edx=s)           M[r][c] *= s[c]   (scale COLUMNS: M = M * diag(s))
sub_31480(stack m0..m8, ptr out)  out[0..8] = m0..m8   (ret 0x28)
sub_314d4(eax=src, edx=dst)       copy 36 bytes
sub_31513  ST0=a, ST1=b -> ST0 = atan2(a, b)   (fxch; fpatan), pops one
sub_2fbfe  ST0=x -> asin(x) computed as atan2(x, sqrt(1 - x*x))
sub_1f318  ST0 = trunc(ST0) (control word forced to 0x1f..: round toward zero), always followed by fistp
sub_2fb70(eax) abs(int).  sub_2fb78(eax=size) = operator new (malloc, size 0 -> 1, new_handler loop)
sub_2fbc9() = rand(): seed = seed*0x41c64e6d + 0x3039; return (seed >> 16) & 0x7fff;   seed at 0x55fe8, initial 1
```

Quaternions (x,y,z,w at +0,+4,+8,+0xc):
```
sub_3ce10(eax=q)  q = (0,0,0,1)
sub_3d230(stack x,y,z,w, ptr out)  out = (x,y,z,w)  (ret 0x14)
sub_3d204(eax=src, edx=dst)  copy 0x14 bytes
sub_3cec4(eax=q)  axis-angle (x,y,z,angle) -> quaternion, in place:
    h = q.w * 0.5 (f64 const);  s = sin(h);  q = (q.x*s, q.y*s, q.z*s, cos(h))
sub_3d17c(eax=a, edx=b, ebx=out)  Hamilton product a*b:
    out.w = a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z
    out.x = a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y
    out.y = a.w*b.y + a.y*b.w + a.z*b.x - a.x*b.z
    out.z = a.w*b.z + a.z*b.w + a.x*b.y - a.y*b.x
sub_3ce38(eax=q)  "normalize" in place, BUT divides by the squared length (no sqrt):
    l2 = (f32)(y*y + x*x + z*z + w*w);
    if (0 >= l2) q = (0,0,0,1); else { k = 1/l2; q.x*=k; q.y*=k; q.z*=k; q.w*=k; }
sub_3cf08(eax=q, edx=out M)  quaternion -> matrix, scale-invariant:
    l2 = (f64)(y*y + x*x + z*z + w*w);
    s  = (l2 == 0) ? 1.0f : (f32)(2.0 / l2);
    ys = y*s; zs = s*z; xs = x*s;                                   // ys, zs stored f32
    M[0] = 1 - y*ys - z*zs;   M[1] = x*ys - w*zs;       M[2] = w*ys + x*zs;
    M[3] = x*ys + w*zs;       M[4] = 1 - xs*x - z*zs;   M[5] = y*zs - w*xs;
    M[6] = x*zs - w*ys;       M[7] = y*zs + w*xs;       M[8] = 1 - xs*x - y*ys;
```
Because sub_3ce38 leaves |q| = 1/|q_in| and sub_3cf08 uses s = 2/|q|^2, the matrix is always the
exact rotation of q/|q|. A port can simply do `normalize(q)` then the standard formula.

How rotation keys become quaternions (loader 0x2e554, for reference only): per key the file gives
angle, ax, ay, az; the loader builds `d = axisAngle(ax, az, ay, angle)` (y and z swapped),
`acc = d * acc` (sub_3d17c(a=d, b=acc), acc starts (0,0,0,1)), stores `sub_3ce38(acc)` as key v[0..3].
No sign flipping for shortest arc.

sub_31550(eax=scene) (loader time): for every render item of type 0: face normal
`n = normalize(cross(v1 - v0, v2 - v0))` -> face+0x0c; if obj.flags2 & 4: each vertex normal =
normalize(sum of the normals of all faces that reference the vertex), or (0,0,1) if none -> vertex+0x0c.

## 4. Keyframer

### 4.1 Adding keys (loader helpers). `tcb` points to 5 floats T,C,B,easeTo,easeFrom
All of them write key = keys[track.cur], copy tcb[0..4] to key+0x1a..+0x2a, zero key+0x2e..+0x3a and
key+0x42..+0x4e, then track.cur++.
```
sub_2fce4(eax=track, edx=n)   track.keys = malloc(n*0x56); track.cur = 0; track.n = n;
sub_2fd08(eax=track, stack: f32 v, u32 frame, ptr tcb)                 key.v = (v, 0, 0, 0)      ret 0xc
sub_2fda8(eax=track, stack: f32 x, y, z, u32 frame, ptr tcb)           key.v = (x, y, z, 0)      ret 0x14
sub_2fe48(eax=track, stack: f32 a, b, c, d, u32 e, u32 frame, ptr tcb) key.v = (a,b,c,d), key+0x12 = e   ret 0x1c
sub_2feec(eax=track, edx=morphObj, ebx=frame, ecx=tcb)                 key.v = 0, key+0x16 = morphObj
```
(sub_2fd08 leaves key+0x12/+0x16 unwritten, sub_2fda8 leaves +0x12 unwritten.)

### 4.2 sub_308fc(eax=track): prepare tangents (called once after all keys are added)
```
n = track.n;
track.len = keys[track.cur - 1].frame;            // cur == n here
if (n > 2) {
    for (i = 1; i < n-1; i++) sub_300f0(&keys[i-1], &keys[i], &keys[i+1]);
    if (track.loop & 0x0f00) {
        sub_3029c(&keys[n-2], &keys[0],   &keys[1], (float)track.len);   // first key, wrapping
        sub_3045c(&keys[n-2], &keys[n-1], &keys[1], (float)track.len);   // last key, wrapping
    } else {
        sub_30614(&keys[0],   &keys[1],   &keys[2]);                     // first key
        sub_30728(&keys[n-3], &keys[n-2], &keys[n-1]);                   // last key
    }
} else if (n == 2) {
    sub_30848(&keys[0], &keys[1]);
    sub_308a0(&keys[0], &keys[1]);
}
track.cur = 0;
```
n == 1: no tangents. Looping assumes keys[n-1] duplicates keys[0].

sub_3009c(stack: f32 p0, p1, p2, ptr outDs, ptr outDd, f32 a, b, c, d)  (ret 0x24)
```
*outDs = a*(p1 - p0) + b*(p2 - p1);
*outDd = c*(p1 - p0) + d*(p2 - p1);
```

sub_300f0(eax=k0 prev, edx=k1 cur, ebx=k2 next): middle key. Frames are u16 zero-extended, differences signed int.
```
T = k1.T; C = k1.C; B = k1.B;
h   = 0.5 * (1 - T);                          // 0.5 is f64
N   = 1 / ((float)(k2.frame - k0.frame) * 0.5);
r1  = (float)(k1.frame - k0.frame) * N;
r2  = (float)(k2.frame - k1.frame) * N;
aC  = fabs(C);                                // -> f32
adj1 = (r1 + aC) - aC*r1;
adj2 = (r2 + aC) - aC*r2;
// (1-C) is "1 - C", (1+C) is coded as "2.0 - (1 - C)", same for B
a = h*(1-C)*(1+B) * adj1;      // ds, weight of (p1-p0)
b = adj1 * (h*(1+C)*(1-B));    // ds, weight of (p2-p1)
c = h*(1+C)*(1+B) * adj2;      // dd, weight of (p1-p0)
d = adj2 * (h*(1-C)*(1-B));    // dd, weight of (p2-p1)
for (i = 0; i < 4; i++) sub_3009c(k0.v[i], k1.v[i], k2.v[i], &k1.ds[i], &k1.dd[i], a, b, c, d);   // a..d passed as f32
```
sub_3029c(eax=k0, edx=k1, ebx=k2, stack f32 X) (ret 4): identical, except
```
N  = 1 / (((float)(k2.frame - k0.frame) + X) * 0.5);
r1 = (X + (float)(k1.frame - k0.frame)) * N;
r2 = N * (float)(k2.frame - k1.frame);
```
sub_3045c(eax=k0, edx=k1, ebx=k2, stack f32 X) (ret 4): identical, except
```
N  = 1 / (((float)(k2.frame - k0.frame) + X) * 0.5);
r1 = (float)(k1.frame - k0.frame) * N;
r2 = N * ((float)(k2.frame - k1.frame) + X);
```
sub_30614(eax=k0, edx=k1, ebx=k2): first key of a non-looping track, writes k0.dd[0..3]
```
f = 0.25 - (float)(k1.frame - k0.frame) / ((float)(k2.frame - k0.frame) * 2.0f);     // 0.25 is f64
for i in 0..3:
    d20 = k2.v[i] - k0.v[i];  d10 = k1.v[i] - k0.v[i];
    k0.dd[i] = ((d20*f + ((d10 - d20*0.5f) * 3.0f) * 0.5f) + d20*0.5f) * (1 - k0.T);
```
sub_30728(eax=ka = keys[n-3], edx=kb = keys[n-2], ebx=kc = keys[n-1]): last key, writes kc.ds[0..3]
```
f = 0.25 - (float)(kc.frame - kb.frame) / ((float)(kc.frame - ka.frame) * 2.0f);
for i in 0..3:
    dca = kc.v[i] - ka.v[i];  dcb = kc.v[i] - kb.v[i];
    kc.ds[i] = ((dca*f + ((dcb - dca*0.5f) * 3.0f) * 0.5f) + dca*0.5f) * (1 - kc.T);
```
sub_30848(eax=k0, edx=k1): `k0.dd[i] = (1 - k0.T) * (k1.v[i] - k0.v[i])` for i = 0..2 ONLY (v[3] tangent stays 0)
sub_308a0(eax=k0, edx=k1): `k1.ds[i] = (1 - k1.T) * (k1.v[i] - k0.v[i])` for i = 0..2 ONLY
(so a 2-key rotation track interpolates qw linearly-with-zero-tangents, i.e. smoothstep-like: h1*w0 + h2*w1.)

### 4.3 sub_2ff94 ease(stack f32 u, f32 a, f32 b) -> ST0 (ret 0xc)
Called as `ease(u, cur.easeFrom (key+0x2a), next.easeTo (key+0x26))`.
```
s = a + b;                                  // tested as f64
if (s == 0.0) return u;
if (s > 1.0) { a = (f32)(a * (1/s_f32)); b = (f32)(b * (1/s_f32)); }     // s_f32 = float32 copy of s
k = (f32)(1 / ((2.0 - a) - b));             // 2.0 f64
if (u < a)        return u * ((k / a) * u);
if (1 - b > u)    return (u*2.0f - a) * k;  // (1-b) evaluated in f64
t = (f32)(1 - u);
return 1 - ((k / b) * t) * t;
```

### 4.4 Segment selection, shared verbatim by sub_30a14 / sub_30ba4 / sub_30da8 / sub_310b0
`frame` is the f32 stack argument; it is modified locally.
```
cur = &keys[track.cur];
if (track.loop != 0) {                                   // ANY non-zero value of the u16 at +0x0c
    q = trunc(frame / (float)track.len);                 // sub_1f318 + fistp, toward zero
    frame = (f32)(frame - (float)(q * track.len));       // integer multiply
    if ((float)cur.frame > frame) { track.cur = 0; cur = &keys[0]; }      // wrapped: restart the cursor
}
if (track.n - 1 > track.cur) {                           // signed compare
    nxt = &keys[track.cur + 1];
    if ((float)nxt.frame < frame) {                      // strictly less: advance by ONE key per call
        track.cur++; cur = nxt; nxt = &keys[track.cur + 1];
    }
}
if (track.n - 1 == track.cur) -> "at last key" result (hold the last key's value)
u = (frame - (float)cur.frame) / (float)(nxt.frame - cur.frame);          // -> f32. NOT clamped
u = ease(u, cur.easeFrom, nxt.easeTo);
```
Consequences that a port must reproduce (or consciously fix):
- The cursor only moves forward, by at most one key per evaluation, and is only reset by the loop
  wrap. If playback jumps forward several keys (ESC skip adds 0x01000000 to the timers), u > 1 and
  the spline extrapolates for a few frames until the cursor catches up. Time never runs backwards
  except by the loop wrap.
- Before the first key (frame < keys[0].frame) u is negative: the first segment is extrapolated,
  there is no clamp. After the last key the last key's value is held (non-looping tracks).
- n == 1: the single key's value is returned before any of the above.
- A NULL track pointer returns immediately and leaves the output untouched.

### 4.5 The evaluators
```
sub_30a14(eax=track, stack f32 frame, ptr out)  float track (roll, fov)                  ret 8
sub_30ba4(eax=track, stack f32 frame, ptr out)  vec3 track (position, scale)             ret 8
sub_30da8(eax=track, stack f32 frame, ptr out)  4-float track (rotation quaternion)      ret 8
```
After 4.4, with u2 = u*u, u3 = u2*u (products kept in extended precision, 3*u2 stored f32):
```
h2 = u3*(-2.0f) + u2*3.0f;          // weight of nxt.v
h1 = (2.0f*u3 - u2*3.0f) + 1;       // weight of cur.v
h3 = u + (u3 - u2*2.0f);            // weight of cur.dd
h4 = u3 - u2;                       // weight of nxt.ds
out[i] = ((h1*cur.v[i] + h2*nxt.v[i]) + h3*cur.dd[i]) + h4*nxt.ds[i];
```
i = 0 for sub_30a14, 0..2 for sub_30ba4, 0..3 for sub_30da8 (in the vec3/quat versions h1..h4 are
rounded to f32 before use for i >= 1; for i = 0 they are used at extended precision).

sub_30fe0(eax=track, stack f32 frame, ptr u16 flags) HIDE track (ret 8). `flags` = &object.flags (+0x1c)
```
if (!track) return;
if (track.loop != 0 && track.n <= track.cur) {           // cursor ran past the last key
    q = trunc(frame / (float)track.len);
    frame = (f32)(frame - (float)(q * track.len));
    if ((float)keys[track.cur].frame > frame) {          // NOTE: keys[n] is read out of bounds here
        track.cur = 0; goto toggle;
    }
}
if (track.cur >= track.n) return;
if ((float)keys[track.cur].frame > frame) return;
track.cur++;
toggle:
if (*flags & 2) *flags = 0;        // clears the WHOLE u16 (also bits 3 and 4!)
else            *flags |= 2;       // byte OR
```
One toggle per call at most; each key reached flips visibility. Bit 1 set = hidden.

sub_310b0(eax=track, stack f32 frame, ptr out) MORPH track (ret 8). out = &object+0xd4 (A ptr, B ptr, f32 w)
```
if (!track || track.n == 0) return;
... 4.4 segment selection (no n==1 shortcut, no ease) ...
if (track.n - 1 == track.cur) { out.A = keys[cur-1].morph; out.B = keys[cur].morph; out.w = 1.0f; }   // n==1 reads keys[-1]
else { out.A = keys[cur].morph; out.B = keys[cur+1].morph;
       out.w = 1 - (frame - (float)cur.frame) / (float)(nxt.frame - cur.frame); }
```
The consumer computes A*w + B*(1-w), so between keys it is a linear blend cur -> next; once the last
key is reached it shows keys[n-2]'s shape (A with w = 1), not the last key's. Coded like that.

Unreferenced helper at 0x2fc40 (no direct callers found): walks the node list and sets `cur = 0` on
every track (object: tracks 0,1,2 and 3,4 if non-NULL; camera: 0,1 and 2 if non-NULL; target/light: 0).

## 5. sub_2d150(eax=scene): make a scene current
```
copy scene fields to the globals (table in 2.1): 0x5c964, 0x5c96c, 0x5c984, 0x5c980, 0x5c988, 0x5c974, 0x5c97c,
    0x5c990 (f32), 0x5c98c, 0x5c98e, 0x5c998
sub_2c750():  free([0x5e0c8]) if non-NULL; free([0x5e0cc]) if non-NULL;
              [0x5e0c8] = malloc([0x5c984]*4); [0x5e0cc] = malloc([0x5c984]*4);
set_projection([0x5c988]);
```
set_projection(cam) (inlined here at 0x2d1ca and again in sub_2f43c at 0x2f4a9):
```
t = tan(((cam.fov * 0.5) * 0.005555555555555555) * 3.141592687);     // f64 constants, fptan
[0x5c99c] = (f32)(((float)W * 0.5) * (1 / t));                        // W = [0x59384] = 320  -> 160/t
[0x5c9a0] = (f32)((1 / t) * (((float)H * 0.5) / 0.75f));              // H = [0x59388] = 200  -> 133.333/t
```
So fov is the HORIZONTAL field of view in degrees and pixels are treated as 1 : (133.33/160) (= 5:6,
the 320x200 on 4:3 correction; the constant is 0.75 float32 at 0x5472c).

Projection as coded in the drawers (quoted from sub_24b54 at 0x24e37, not part of this slice):
```
iz = (f32)(1 / z);                                           // view-space z, near plane z = 1.0 (0x54730)
sx = (f32)(((x * [0x5c99c]) * iz + [0x5938c]) + 0.5);        // [0x5938c] = W*0.5 - 0.5 = 159.5
sy = (f32)(([0x59390] - (y * [0x5c9a0]) * iz) + 0.5);        // [0x59390] = H*0.5 - 0.5 = 99.5 ; view +y is up
```

## 6. sub_2f43c(): animate + transform (no args; frame = [0x5c994])

### Pass 1: evaluate tracks, for each node in list order (node = node.next at +0x14)
```
F = [0x5c994];  d = node.data;  t = node.tracks;
type 0 (object):
    sub_30ba4(t[0], F, &d.pos   /*+0x60*/);
    sub_30da8(t[1], F, &d.quat  /*+0x6c*/);
    sub_30ba4(t[2], F, &d.scale /*+0x80*/);
    if (t[3]) sub_30fe0(t[3], F, &d.flags /*+0x1c*/);
    if (t[4]) sub_310b0(t[4], F, &d.morphA /*+0xd4*/);
    sub_3ce38(&d.quat);                       // q /= |q|^2, in place
    sub_3cf08(&d.quat, &d.R /*+0xb0*/);
    copy d.R -> d.M /*+0x8c*/;
    sub_31428(&d.M, &d.scale);                // M = R * diag(scale)
type 1 (camera):
    sub_30ba4(t[0], F, &d.pos  /*+0x10*/);
    sub_30a14(t[1], F, &d.roll /*+0x28*/);
    sub_30a14(t[2], F, &d.fov  /*+0x2c*/);
    if (t[2]->n > 1) set_projection([0x5c988]);     // uses the ACTIVE camera's fov, whichever camera node this is.
                                                    // t[2] is dereferenced without a NULL check
type 2 (target):  sub_30ba4(t[0], F, &d.target /*+0x1c*/);     // d is the camera struct
type 3 (light):   sub_30ba4(t[0], F, &d.pos    /*+0x0c*/);
other types: skipped
```
Order inside a track call is irrelevant, but note the tracks' cursors are advanced here once per frame.

### Pass 2: hierarchy, for each node in list order
```
type 0 (object P = node.data): for each child c of node (c = first child at node+0x0c; c = c.next at +0x10):
    child type 0 (object C):  tmp = P.M * C.M;  C.M = tmp;                 // sub_31340(P.M, C.M, tmp)
                              v = P.M * C.pos;  C.pos = v + P.pos;
    child type 1 (camera):    cam.pos    = P.M * cam.pos    + P.pos;
    child type 2 (target):    cam.target = P.M * cam.target + P.pos;
    child type 3 (light):     light.pos  = P.M * light.pos  + P.pos;
type 1 (camera node): for each child with type 3:  light.pos = light.pos + cam.pos;     // translation only
other node types: nothing
```
A single pass in list order: it is only correct if parents precede their children in the node list
(a child processed after its parent picks up the parent's already-world matrix). C.R (+0xb0) is NOT
multiplied by the parent, so env-map normals of child objects ignore parent rotation.

### sub_2f2f0(eax=cam): camera matrix, called with the active camera [0x5c988]
```
d    = cam.target - cam.pos;
len  = sqrt(d.y*d.y + d.x*d.x + d.z*d.z);
a    = -atan2(d.x, d.z);            // fpatan(d.x / d.z) with quadrant, then negated
p    = asin(d.y / len);
r    = cam.roll;
sa=sin(a) ca=cos(a) sp=sin(p) cp=cos(p) sr=sin(r) cr=cos(r)       // cp, sp, sa*sp stored f32 before use
V[0] = cr*ca + sr*(sa*sp);   V[1] = cp*sr;   V[2] = sa*cr - (ca*sp)*sr;
V[3] = (sa*sp)*cr - ca*sr;   V[4] = cp*cr;   V[5] = (-ca*sp)*cr - sa*sr;
V[6] = -sa*cp;               V[7] = sp;      V[8] = ca*cp;
cam.V (+0x30) = V
```
Row 2 is the unit view direction, so view z = distance along the line of sight (positive in front),
view y is up, world up is +y (the loader swaps y/z of the 3DS data). len == 0 is not guarded.

### Pass 3: to view space, for each node in list order   (cam = [0x5c988], V = cam.V)
```
type 0 (object o): if (o.flags & 7) skip;
    MV = V * o.M;                    // sub_31340(V, o.M)
    NV = V * o.R;                    // sub_31340(V, o.R)
    T  = V * (o.pos - cam.pos);
    if (!(o.flags & 8)) {            // no morph
        for each vertex v:  v.view (+0x18) = MV * v.pos + T;
        for each face f:    f.nview (+0x18) = MV * f.normal (+0x0c);          // includes scale, not renormalised
        if (o.flags2 & 4) for each vertex v:
            (v.nx (+0x24), v.ny (+0x28)) = rows 0,1 of NV * v.normal (+0x0c);  // sub_31304
            v.u (+0x30) = (f32)(v.nx * 128.0 + 127.0);                         // f64 constants
            v.v (+0x34) = (f32)(v.ny * 128.0 + 127.0);
    } else {                         // morph: A = o.morphA, B = o.morphB, w = o.w, w1 = (f32)(1 - w)
        for each vertex i:  p = A.vert[i].pos*w + B.vert[i].pos*w1;        o.vert[i].view = MV * p + T;
        for each face i:    n = A.face[i].normal*w + B.face[i].normal*w1;  o.face[i].nview = MV * n;
        if (o.flags2 & 4) for each vertex i:
            n = A.vert[i].normal*w + B.vert[i].normal*w1;  (nx, ny) = rows 0,1 of NV * n;  u,v as above
    }
type 3 (light l):  l.view (+0x24) = V * (l.pos - cam.pos);        // result is not read by anything I can find
```
Counts and index order come from the object itself (o+0x14, o+0x18); A and B must have at least as
many vertices/faces. Env-map uv range is [-1, 255] for a unit normal (127 + 128*n), no clamp, no wrap here.
Objects without flags2 bit 2 keep whatever u,v the loader put in vertex+0x30/+0x34.

## 7. sub_2c7a8(): cull + depth sort (no args)

```
[0x5e0d0] = 0;
for (item = [0x5c964]; item; item = item.next /*+6*/) {
    if (item.type == 0) {
        o = item.data;
        if (o.flags & 0x17) continue;
        for (i = 0; i < o.nfaces; i++) {
            f = &o.faces[i];  a = f.v0; b = f.v1; c = f.v2;
            s.x = (f32)(a.view.x + b.view.x + c.view.x);   // same for y, z: SUM of the 3 view positions
            vis = (a.view.z > 1.0f) || (b.view.z > 1.0f) || (c.view.z > 1.0f);     // rejected only if ALL z <= 1.0
            if (!(f.flags & 8))                                                     // bit 3 = two-sided
                vis = vis && (dot(s, f.nview) > 0);        // sub_23b6c; strictly positive = front facing
            if (vis) {
                f.key (+0x2c) = trunc(s.z * 16384.0) + 0x1000000;      // i.e. average z * 49152
                sortA[[0x5e0d0]++] = f;
            }
        }
    } else if (item.type == 2) {
        d = item.data;  pf = d + 0x4c;  z = (*(vertex**)pf)->view.z (+0x20);
        if (z > 0) {                                        // compared as f64, strictly
            pf.key (+0x2c) = trunc(z * 49152.0) + 0x1000000;
            sortA[[0x5e0d0]++] = pf;
        }
    }
}
[0x5e0c4]++;  [0x5e0c0] += [0x5e0d0];
```
Backface test note: visible when dot(sum of view positions, view normal) > 0, i.e. the stored
normals point AWAY from the viewer for visible faces (consequence of cross(v1-v0, v2-v0) with the
loader's winding / axis swap). Do not "fix" the sign.

Sort: stable LSD radix sort on the u32 key, 4 passes of 8 bits, ascending:
```
memset 4 histograms (257 u32 each) to 0
for each entry: h0[(key & 0xff) + 1]++, h1[((key >> 8) & 0xff) + 1]++, h2[((key >> 16) & 0xff) + 1]++, h3[(key >> 24) + 1]++
for (i = 1; i <= 255; i++) hK[i] += hK[i-1]        // all four; hK[b] = start offset of bucket b
pass 1: for i in order: A -> B  by byte 0:  B[h0[b]++] = A[i]
pass 2: B -> A by byte 1;   pass 3: A -> B by byte 2;   pass 4: B -> A by byte 3
```
Result: [0x5e0c8][0 .. [0x5e0d0]-1] sorted by ascending key = NEAREST FIRST; equal keys keep list
order. Keys are compared as unsigned (a negative z sum below -1024 would wrap; not expected).
Any stable ascending sort on the integer key reproduces it.

Drawing order and dispatch (in the parts, outside this slice): every part loops
`for (i = [0x5e0d0]-1; i >= 0; i--) { f = sortA[i]; fl = f.flags (+0x30); ... }` = FARTHEST FIRST (painter).

| part draw code | dispatch (first match wins) |
|---|---|
| 0x14348, 0x16159, 0x161e0, 0x16b04, 0x170e0 | fl&0x02: sub_24b54(f, 0); else fl&0x40: sub_27670(f, 0); else nothing |
| 0x14783 | fl&0x10 or fl&0x20: sub_29510(f, 0, ebx=[0x594e8]); else sub_27670(f, 0) |
| 0x14eac | fl&0x10: sub_2b3c0(f, 0, ebx=[0x59518]); else fl&0x02: sub_24b54(f, 0); else fl&0x40: sub_27670(f, 0) |
| 0x16686 | fl&0x40: sub_27670(f, 0); else fl&0x02: sub_24b54(f, 0); else fl&0x80: sub_27434(f, edx=[0x593a0]) |
| 0x18332 | always sub_24b54(f, 0) |

Clipping helper used by the drawers, sub_24998(eax=va, edx=vb, ebx=vout, stack f32 zc) (ret 4), shows which
vertex fields the drawers consume: `t = (zc - vb.view.z) / (va.view.z - vb.view.z)`; vout.view.x/y, vout.u (+0x30)
and vout.v (+0x34) = vb + (va - vb)*t; vout.view.z = zc. Nothing else is interpolated, so there is no per-vertex shade.

## 8. Open questions
1. Lighting: I found no consumer of light+0x24 or of face.nview other than the backface test. If the
   drawers' reader finds a shade lookup, it is driven by u,v (+0x30/+0x34), not by a light. Confirm there.
2. Object flags bit0 and bit2 (+0x1c): only seen as masks (7 / 0x17) and at 0x2cfc3 (bit0 cleared when a
   hide track is attached). Their setters are in the loader.
3. scene+0x08, +0x0c, +0x14 (0x5c974, 0x5c97c, 0x5c980) are not used by this slice.
4. Key +0x12 (integer degrees of a rotation key) is stored but never read here.
5. Track loop word for non-rotation tracks: evaluation treats any non-zero as looping, tangent setup
   only `& 0x0f00`. For the rotation loader both coincide (final value is 0 or 0x0f00); other loaders unchecked.
6. sub_30fe0 reads keys[n] (one past the end) on looping hide tracks; morph with n == 1 reads keys[-1].
   A port needs a defined value there (the original reads whatever heap bytes follow).
7. 0x2fc40 (reset all track cursors) has no direct caller; possibly dead code. If scenes are replayed
   from frame 0 without it, non-looping tracks stay at their last key (cursor never rewinds).
8. The code at 0x17c93 / 0x17eb3 / sub_18193 (part-specific, in the 0x17322..0x18396 area) is a second copy
   of the transform / scene-activate logic (sub_18193 = sub_2d150 with a fixed projection
   tan(0.4276056712861111) and a palette set; 0x17eb3 walks 0x5c96c and uses sub_23c48/sub_312b0/sub_31304).
   Not covered here. Callers: sub_2f43c and sub_2d150 are called from 0x14477, 0x149ba, 0x15162, 0x162c2,
   0x16452, 0x1681a, 0x16cdd, 0x17322, 0x1d2d1; sub_2c7a8 from the same list except 0x1d2d1, plus 0x18396.
9. Camera roll sign/units: roll is used raw in sin/cos; the roll loader (0x2ecaf) multiplies the file value by
   3.141592687 * 0.005555555555555555, so radians. FOV stays in degrees.
