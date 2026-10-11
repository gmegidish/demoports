# P12 — "hy_" tunnel ring with the chrome pod (demo part 12)

Sequencer: `init 0x19ae0(eax = rVal)` / `run 0x1a850(eax = 0x12)` / `deinit 0x1a528`.
Capture: part starts about **278.3 s** (t = 0, see §5), fall-away ends about 336.5 s.

Depends on: E1 (object/world API, recordings), E2 (renderer, flags, rasterisers, `0x437c4`/`0x43cf8`),
M (sync, sine table 0x9025c, row table 0x90e5c), P9 (`0x34f6c`), P10 §8.2 / P0 §8 (`0x28038`/`0x27cac`).

**Verification.** I ran the real init and run code in unicorn (scratch `agents/P12/run_part.py`) with
these stubs: malloc/free, archive loads, sync index from the song times in M §4.5, and the timer advanced
7 ticks per loop. The renders match the capture frame for frame (camera, segment culling, door/iris
animation, the chrome sphere's reflection and lightning, the bump-mapped "flesh", the grey bowl).
For this to work the harness must (a) build the row table `0x90e5c` (`t[i] = min(i,200)*320`, M §1.1)
and (b) flush unicorn's translation cache when code is written, because `0x4fee4` patches the immediate
of the inner loop at `0x4ff25`. `gen.py` in the same folder rebuilds all four procedural meshes from
the formulas in §2. It matches the emulated memory exactly: every vertex and every face field, the
float-computed ones included. `chk_norm.py` does the same for the normals.

-------------------------------------------------------------------------------------------------

## 1. What is on screen

There are no `.eob` files. **All geometry is built in code** (§2), except the pod's two spikes, which
are static data in obj3.

* **Tunnel ring.** Six copies of one procedural **tunnel segment** (`T`, 98 points, 176 triangles). It
  is an octagonal tube 3584 long with a bulging profile and ends bent by ±30°. It has an iris "door"
  at each end and a hatch in its side. The six copies sit on a circle of radius ≈6168 in the XZ plane,
  60° apart, and form a closed torus (a "necklace" seen from outside).
* **Pod.** It is placed at the centre of the segment nearest the camera:
  * **pod root** `0x81588`: static, 14 points / 12 faces. Two grey cones (spikes) along ±Y.
  * **sphere** `0x816f0` (child of the pod): a 9-ring lathe of radius 256. Its middle bands are drawn
    with material 6, a live environment render × the lightning light map (§4). Its two end caps are
    grey phong.
  * **"bucket" tube** `0x8163c` (child of the sphere): an 8-ring lathe. Its middle band is material 0
    (`0x19160`, bump/height-mapped "flesh", §6). The other bands are a grey phong bowl.
* **Timeline** (sync entries, demo table, M §4.5; video ≈ song + 124.0 s):

| s passes | entry (pos,row) | song t | video | t (frames) | event |
|---|---|---|---|---|---|
| > 0x12 | 18 (25,30) | 154.28 | 278.3 | 0 | phase A starts (outside view of the ring) |
| 0x13→0x14 | 19 (27,16) | 161.28 | 285.3 | ≈490 | hatch on all segments opens; when its countdown drops below 0x60 (≈160 frames later) phase B starts (camera inside) |
| 0x14→0x15 | 20 (32,4) | 182.00 | 306.0 | ≈1943 | sphere hidden, flesh tube shown; −Z iris opens/closes; env pass stops |
| 0x15→0x16 | 21 (33,0) | 185.92 | 309.9 | ≈2218 | +Z iris opens/closes |
| > 0x16 | 22 (38,16) | 210.56 | 334.6 | ≈3944 | loop ends → fall-away `0x28038` |
| > 0x17 | 23 (38,30) | 212.52 | 336.5 | | fall-away ends, deinit |

The palette is `hy_pal.col`, set once in init. There are **no palette fades** in this part; the end
transition is the geometric fall-away.

-------------------------------------------------------------------------------------------------

## 2. Data files, buffers and procedural meshes

### 2.1 Files (`work/res/`)

| file | size | format | use |
|---|---|---|---|
| hy_pal.col | 768 | 6-bit RGB ×256. 8 ramps of 32: grey, blue-grey, pink, brown-grey, teal, red-orange, olive, black→dark red | VGA DAC (`0x11af3`, all 256 from index 0) |
| hy_txt1.raw | 16384 | 128x128 (green/pink flesh) | doubled (nearest, `0x1d1a0`) → 256x256 `[0xd3760]` = material 0 colour |
| hy_door.raw | 4096 | 64x64 | copied into rows 0..63, columns 0..63 of the zeroed 256x64 `[0xd375c]` (stride 256) = material 5 |
| hy_txt2.raw | 32768 | 256x128 | `[0xd3778]` 256x256: the file, then rows 0..127 copied again to rows 128..255 = material 1 |
| hy_txt3.raw | 65536 | 256x256 (grey tunnel wall) | `[0xd3764]` = material 3 |
| hy_bukt.raw | 32768 | 256x128 **signed** heights | `[0xd377c]` = material 0 height map H, and the source of the bump table |
| cy_mirr.raw | 16000 | 160x100, values 8..127 | doubled → 320x200 `[0xd1cdc]` (64 KB alloc) = material 6 light map (the same file P9 uses) |
| hy_cam.rec | 67248 | 5604 × 12-byte CamRec (E1 §5.1) | camera, indexed by t |

### 2.2 Tables built in init

* **Shade table `0xfd0a0`** (128 rows × 256, `0x17490`), `row = 0..127, k = 0..255`:
  `T[row*256+k] = (k & 0xe0) + clamp((k & 31) + (row>>2) − 16, 4, 31)`. The clamp is *if >31 → 31;
  then if ≤4 → 4*. Row 64 is identity (except k&31 < 4 → 4). Lower rows are darker, higher rows
  brighter, and the result stays inside the colour's 32-ramp.
* **Lightning LUTs** (dwords, only the low byte is used, `0x17490`): `L1 = 0xd1d58`, `L2 = 0xd2158`.
  For p = 64..127: `L1[p] = min(p+32, 127)`, `L2[p] = min(p+52, 127)`. All other entries stay 0 (bss).
* **Bump table `[0xd3758]`** (256x256 dwords, init loop 0x19c9e). With `h(y,x)` = signed byte
  `bukt[y*256+x]`:
  `B[y*256+x] = ((h(y,x) − h(y,(x+2)&255)) << 9) + 2*(h(y,x) − h((y+2)&255,x))`.
  y runs 0..255, but the file has only 128 rows. **Rows 128..255 read past the 32 KB buffer** into
  the heap (the next block is the fresh `[0xd3788]` allocation, contents undefined; the emulator has
  zeros there). The renderer only indexes rows ≤ 127 (§6), so only `B` rows 126/127 (whose dy term
  reads h rows 128/129) depend on it. A port can use 0 for those rows.
* **Phong maps** (`0x314c0`, E2 §5.1 formula; args gamma, lo, hi, scale, base, N, pitch):
  * `[0xd374c]` = (0.9, 0, 127, 128.0, 0, **N=256**, 256): material 0's light map, 256x256 fully
    written.
  * `[0xd1c1c]` = (2.0, 0, 31, 32.0, 0, 128, 256): material 2.
  * `[0xd1c7c]` = (2.0, 0, 7, 8.0, 0, 128, 256): material 4.
* **Lightning path tables** (start of run, i = 0..255, sin/cos = `0x11a7d`/`0x11a70`, 512 per turn,
  amplitude 256, M §3.2):
  `D1350[i] = (sin(32i) >> 6) + 0x50`, `D0F50[i] = ((cos(6i)*sin(8i)) >> 13) + 0x50` (arithmetic
  shifts). `D0C30[i] = D1750[i] = 0`.

### 2.3 Runtime materials (7 × 0x30 at `0xd1ba8`, shared by every object: obj+0xa0 = 7, +0xa4 = 0xd1ba8)
Fields not listed are 0 (bss), so +0xc and +8 are 0 everywhere.

| # | +0x10 tex | +0x14 map | +0x18 | other | draw fn (+0x2c) | used by |
|---|---|---|---|---|---|---|
| 0 | txt1×2 `[d3760]` | phong256 `[d374c]` | bukt H `[d377c]` | | **0x19160** (this part, §6) | tube band 3 (16 tris) |
| 1 | txt2 `[d3778]` | – | | +0x28 = 3 | 0x36890 (perspective texture, E2/P9) | segment bands 0 and 6, bent ends |
| 2 | – | `[d1c1c]` | | +4 = 0, +8 = 0 | 0x2c118 (phong, untextured) | sphere end bands, tube bowl |
| 3 | txt3 `[d3764]` | – | | | 0x36890 | segment bands 1..5 |
| 4 | – | `[d1c7c]` | | +4 = 0xf, +8 = 0 | 0x44354 (phong + flat term) | pod spikes |
| 5 | door `[d375c]` | – | | | 0x36890 | iris faces |
| 6 | env render `[d3788]` | light map `[d1cdc]` | | | **0x34f6c** (P9 §5) | sphere bands 1..6 |

Record mode (`rVal == 5`) and the env pass (§4) switch materials 1 and 3 to `0x331b4` (affine).

### 2.4 Lathe helpers and normals
* Directions: `dir_j = (cos(64j), sin(64j))`, j = 0..7 (amplitude 256; cos(0) = 257).
* `0x17584(obj, double L=256)` builds **corner normals**. For each vertex, sum over every face that
  contains it of the face normal from `0x24b4c`: `c = CrossVec3i(B−A, C−A)` (E1: each component
  `>>8`), `n = trunc(c * 256.0 / |c|)` (x87, single precision). Then normalise:
  `vn = trunc(sum * L / |sum|)`. Faces 0..nFaces−1, vertex matched on any of A, B, C.
* `0x24d58(obj, double L)` builds **face normals**. Face i: `+8 = i`;
  `fn[i] = trunc(normalize_f32(cross_f32(B−A, C−A)) * L)` (`0x247d4`).
* All lathe faces of band b (between rings b and b+1), j = 0..7, j1 = (j+1)&7, `R_b[j] = 8b+j`:
  `f(2·(8b+j)) = (R_b[j], R_b[j1], R_b+1[j1])`, `f(+1) = (R_b[j], R_b+1[j1], R_b+1[j])` with UVs
  listed per mesh.

### 2.5 Sphere `0x816f0` (`0x17ae0`): 72 points, 128 faces
```
ring k = 0..8: s = sin(32k); if (s < 20) s = 20;  z = −256 + 64k
   P[8k+j] = ((dir_j.x*s)>>8, (dir_j.y*s)>>8, z)
band b = 0..7: mat = (1<=b<=6) ? 6 : 2;  normal index −1;  U0 = 33(b−1), U1 = 33b
   even: uv (32j,U0) (32(j+1),U0) (32(j+1),U1)    odd: uv (32j,U0) (32(j+1),U1) (32j,U1)
corner normals: 0x17584(256.0)       flags 0x1208 (hidden at start)
```
(u = 32j is the column, v = 33(b−1) the row of the 320x200 env image, through P9's 32-column window.)

### 2.6 Tube `0x8163c` (`0x177a0`): 64 points, 112 faces
```
Z[8] = {−255,−213,−171,−128,128,171,213,255}   (dword table 0x17470)
ring k: s = sin(0x10+0x20k)  (k==4 uses sin(0x70) — same value)
   P[8k+j] = ((dir_j.x*s)>>8, (dir_j.y*s)>>8, Z[k])
band b = 0..6: mat = (b==3) ? 0 : 2;  normal index = face index
   even: uv (64j,2) (64(j+1),2) (64(j+1),125)      odd: (64j,2) (64(j+1),125) (64j,125)
corner normals 0x17584(256.0);  face normals 0x24d58(65536.0)   flags 0x120c (hidden)
```

### 2.7 Pod root `0x81588` (static; points 0x81270, faces 0x81318)
Points: `0:(0,−260,0)`, `1..6:(−64,−1790,−128) (64,−1790,−128) (128,−1790,0) (64,−1790,128)
(−64,−1790,128) (−128,−1790,0)`, `7:(0,260,0)`, `8..13:` the same hexagon at y = +1790.
Faces (material 4, normal index i, uv (0,0),(255,0),(0,255)):
`f0..5 = (0, k+1, k)` for k = 1..6 with wrap: (0,2,1) (0,3,2) (0,4,3) (0,5,4) (0,6,5) (0,1,6);
`f6..11 = (7, 8+k, 9+k)`: (7,8,9) (7,9,10) (7,10,11) (7,11,12) (7,12,13) (7,13,9)
(**sic**: the last face reuses 9, not 8).
Init: `0x17584(256.0)` corner normals, `0x24d58(256.0)` face normals. Flags 0x1208.
Hierarchy: `pod.+4 = sphere`, `sphere.+4 = tube` (written by init).

### 2.8 Tunnel segment (`0x17e04` on a malloc'd copy of the template `0x817a4`): 98 points, 176 faces
Raw build, then `ScalePoints(seg, 0x200)` doubles every point (`c = (c*0x200)>>8`):
```
raw ring r = 0..7: s = sin(0x10+0x20r); z = −0x380 + 0x100r
   P[8r+j] = ((2*dir_j.x*s)>>7, (2*dir_j.y*s)>>7, z)
θ = 0.5230874486690036 (double const 0x8d8bc)
k = 0..7 (x87, single precision; trunc):
   (x,y,z) = P[k];      z −= 910:  P[64+k] = ( trunc(x*cos θ), y, trunc(z − x*sin θ) )
   (x,y,z) = P[56+k];   z += 910:  P[72+k] = ( trunc(x*cos θ), y, trunc(z + x*sin θ) )
P[96] = P[10]; P[97] = P[19];   then ScalePoints ×2
after scaling (init): P[80+k] = (0,0,−0x700), P[88+k] = (0,0,+0x700)   (closed irises, §5)
```
Faces (normal index = face index; no normals are built; flags 0x208):
```
V(j,d) = (((j>5||j<2) ? j+d : 8−j−d) << 6) & 255          (0x1777c)
band b = 0..6, j: mat = (1<=b<=5) ? 3 : 1;  U0 = 0x33(b−1), U1 = 0x33b
   even: (A, R_b[j1], R_b+1[j1])  A = (b==1&&j==2) ? 96 : R_b[j];   uv (U0,V(j,0)) (U0,V(j,1)) (U1,V(j,1))
   odd : (R_b[j], B, R_b+1[j])    B = (b==1&&j==2) ? 97 : R_b+1[j1]; uv (U0,V(j,0)) (U1,V(j,1)) (U1,V(j,0))
faces 112..143, j = 0..7 (4 each, mat 1):
   (j, 64+j, j1)        uv (32j,0) (32j,64) (32(j+1),0)
   (64+j, 64+j1, j1)    uv (32j,64) (32(j+1),64) (32(j+1),0)
   (56+j, 56+j1, 72+j1) uv (32j,0) (32(j+1),0) (32(j+1),64)
   (56+j, 72+j1, 72+j)  uv (32j,0) (32(j+1),64) (32j,64)
faces 144..175, irises (mat 5): Q_j = (32+(cos(64j)>>3), 32+(sin(64j)>>3))
   for (base,cap) in (0,80),(56,88), j:  (base+j, cap+j, base+j1) uv Q_j (32,32) Q_j1
                                          (base+j, base+j1, cap+j) uv Q_j Q_j1 (32,32)
```
The **hatch** is the quad 10-11-19-18 (faces 20 and 21, which use 96 and 97). Each iris is a
double-sided fan of 8 triangles to the 8 points 80..87 (−Z) or 88..95 (+Z). While those 8 points
sit on the axis the iris is closed.

All 6 segments **share** the point/face arrays (clones copy the 0xb4 header). Animating points of
"segment best" therefore animates all six.

-------------------------------------------------------------------------------------------------

## 3. Init `0x19ae0(eax = rVal)`

```
rec = (rVal == 5)                                   // [0x8125c]: camera-record/debug mode
alloc: [d377c]=32K bukt, [d3788]=64K env target, [d3778]=64K txt2, [d3760]=64K txt1x2,
       [d375c]=16K door (zeroed), [d3768]=128K; [d3774]=[d3768]+0x8000 = 64K bump scratch (zeroed)
[0x89f54]=0xff, [0x89f50]=0              // triangle-engine row clip 0..255 (E2 §6) for 0x437c4.
                                          // Not restored by deinit (later triangle-engine parts beware)
load files / build tables (§2.1, §2.2); SetPalette(hy_pal)
w = CreateWorld(30, 0x76c, 0xa8c, 0xa8c)                         // [d3780]
pod: 0x17584(256.0), 0x24d58(256.0); pod.+4 = sphere; build sphere; sphere.+4 = tube; build tube
AddObject(w, pod); SetObjAngles(pod,(0,0,0)); SetObjPos(pod, 0xc00,0,0)   // overwritten in phase B
seg0 = copy of 0x817a4 → [d1d40]; 0x17e04(seg0); ScalePoints(seg0, 0x200)
SetObjPos(seg0, cos(0)*24, 0, sin(0)*24) = (6168,0,0); SetObjAngles(seg0,(0,0,0)); AddObject(w,seg0)
for k = 1..5:  e = 0x5555*k;  a = e>>8                       // a = 85,170,255,341,426 (512/turn)
    [d1d40+4k] = Clone(w, seg0, pos=(cos(a)*24, 0, sin(a)*24),
                        ang = GetObjAngles(seg0) + (0, (short)−(e>>5), 0))   // 0x19794
    // ay = −682,−1365,−2047,−2730,−3413 (4096/turn)
segmentCentre[i] → 0xd1cf8 + 12i (GetObjPos of the 6; unused afterwards)
materials (§2.3); [d1cdc] = cy_mirr doubled
if rec: materials 1,3 → 0x331b4
ComputeBounds(w); SetRenderMode(w, 3)
SetCameraAngles(w,(−256,0,0)); SetCameraPos(w, 0,4000,−12000)        // = hy_cam[0]
for k=0..7: P[80+k] = lerp((0,0,−0x700), P[k], sin(0)=0); P[88+k] = lerp((0,0,0x700), P[56+k], 0)
[0x81260]=8, [0x89f18]=0x400, [0x89f24]=0x400, [0x8126c]=[0x81268]=[0x81264]=0   // unused here
SetDefaultTargets()                                  // [0x89dcc]=0xe4d40 back buffer
[d2564] = rec ? malloc(0x20000) : load("hy_cam.rec")
```
`Clone 0x19794(w, src, pos, ang)`: malloc 0xb4, copy the header (mesh arrays shared), SetObjPos,
SetObjAngles, AddObject. `lerp 0x189e8(A, B, f) = ((A*(256−f) + B*f) >> 8)` per component
(32-bit imul, sar). Note `sin` reaches 257 (Taylor table), so f = 257 overshoots slightly.

-------------------------------------------------------------------------------------------------

## 4. The chrome sphere: environment pass + lightning light map

**Environment pass** (each phase-B frame before entry 20, flag `[esp+0x188]`). Both the billboard
and the env render happen before the main render:
```
C = GetCameraPos(w); P = GetObjPos(seg[best])            // P = pod centre
A = round( atan2(C.z−P.z, C.x−P.x) * 2048.0 / π )        // fpatan, double consts, fistp (nearest)
SetObjAngles(sphere, (0x400, (short)(0x578 − A), 0))     // billboard: sphere faces the camera
save = [0x89dcc]; camPos = GetCameraPos; camAng = GetCameraAnglesS
SetCameraPos(w, P); SetCameraAngles(w, (camAng.x, camAng.y, 0))   // roll dropped
mat1.fn = mat3.fn = 0x331b4;  [0x89dcc] = [d3788];  RenderWorld(w)    // into the env buffer, no clear
if (!rec) mat1.fn = mat3.fn = 0x36890
[0x89dcc] = save; SetCameraPos(w, camPos); SetCameraAngles(w, camAng)
```
So `[d3788]` holds a 320x200 view from the pod centre in the camera's direction (sphere/pod included
as the engine draws them). The sphere's fixed UVs (§2.5) wrap that image around the camera-facing
sphere. It reads as a chrome/glass reflection.

**Drawing** (`0x34f6c`, P9 §5, affine, spans `0x4fef6/0x4ff39`): `off = rowTab[v] + u + 0x20`,
`pixel = SHADE[mirr[off]*256 + env[off]]`. The light map value selects the shade row: 64 = neutral,
values above 64 brighten, values below 64 darken.

**Lightning** (`0x1a654(buf = [d1cdc], t_prev)`, called first in every phase-B iteration with the
*previous* iteration's t). It draws a wandering vertical 3-pixel bright streak into the light map:
```
for i = 0..199:                                  // row i of the 320x200 light map
    row = buf + 320*i
    *(u32*)(row + D0C30[i]) = D1750[i]           // restore the 4 bytes saved last time
    o = D0F50[(2*t+i) & 255] + D1350[(t+i) & 255] // ≈ 146..172
    D0C30[i] = o; D1750[i] = *(u32*)(row + o)    // save
    row[o] = L1[row[o]]; row[o+1] = L2[row[o+1]]; row[o+2] = L1[row[o+2]]
```
On the first call the "restore" writes 0 to columns 0..3 of every row. These are never sampled
(the 0x20 window). Light map pixels < 64 under the streak become 0 (darkest).

-------------------------------------------------------------------------------------------------

## 5. Run `0x1a850(eax = end = 0x12)`

Time base: `frame` = `[0x91260]` (70.086 Hz ticks, E1/M). This part does **not** resync the frame
counter. t = ticks since phase A started. There is no tick wait: it renders as fast as it can, and
every display frame uses the current t (several frames can share a t, or ticks can be skipped).
`sync()` = `0x12204` (M). `killCheck` = `0x122b8/0x122f0`.

```
build lightning tables (§2.2); d2558 = {0,0,0}; d2558.+0xc = [d2564] (camera ctl, E1 §5.1)
while (sync() <= end) killCheck();
SetupTriTarget(320, 200, [0x89dcc])     // 0x76a3c: obj2 row table at 0x70849 (not used by this part)
s = sync(); t0 = frame; t = 0; doorC = 0; phaseA = 1
// ---------------- phase A: outside the ring (pod/sphere/tube hidden, all 6 segments drawn)
while (phaseA) {
    dt = frame − t − t0;  t = frame − t0;  sPrev = s;  s = sync();  ctl.index = t
    PlayCamRec(w, &ctl)                  // 0x2789c: SetCameraPos(rec[t].xyz), SetCameraAngles(rec[t].ang)
    RenderWorld(w); copy 64000 bytes back buffer → VGA and zero the back buffer
    killCheck(t)
    if (!doorC && sPrev == end+1 && s == end+2) { all 6 segs flags |= 4; doorC = 0x100 }   // entry 19
    if (doorC) {
        c = max(doorC − dt, 0); doorC = c; f = sin(c)
        P[96] = lerp(P[10], P[11], f); P[97] = lerp(P[19], P[18], f)     // hatch opens
        if (c < 0x60) { P[96] = P[10]; P[97] = P[19]; segs flags &= ~4; phaseA = 0 }   // snap shut
    }
}
// ---------------- phase B: inside
pod.flags &= ~0x1000; sphere.flags &= ~0x1000; all 6 segs flags |= 0x20
envOn = 1; irisPlus = irisMinus = 0; evt21 = evt20 = 0
while (s <= end+4) {                         // tested at the top (s from the previous iteration) and the bottom
    Lightning([d1cdc], t)                    // old t
    dt = frame − t − t0;  t = frame − t0;  [0xd3748] = 0x40 (unused)
    sPrev = s; s = sync(); ctl.index = t; PlayCamRec(w, &ctl)
    C = GetCameraPos(w)
    best = argmax_i dot(segPos_i, C)        // DotVec3i, strict '>' so the lowest index wins ties, start i=0
    second = argmax_{i≠best} dot(...)        // start −2^30, strict '>'
    SetObjPos(pod, segPos_best)
    for i: seg_i hidden (0x1000) unless i == best || i == second
    SetObjAngles(pod, GetObjAngles(seg_best))
    SetObjAngles(tube, (0x400, (short)(t<<2), 0))
    if (!evt21 && sPrev == end+3 && s == end+4) { irisPlus = 0x100; evt21 = 1 }      // entry 21
    if (irisPlus) { c = max(irisPlus − dt, 0); irisPlus = c
                    for k: P[88+k] = lerp((0,0,0x700), P[56+k], sin(c)); evt21 = c }
    if (!evt20 && sPrev == end+2 && s == end+3) {                                      // entry 20
        sphere.flags |= 0x1000; SetObjAngles(sphere,(0,0,0)); tube.flags &= ~0x1000
        irisMinus = 0x100; evt20 = 1; envOn = 0 }
    if (irisMinus) { c = max(irisMinus − dt, 0); irisMinus = c
                     for k: P[80+k] = lerp((0,0,−0x700), P[k], sin(c)); evt20 = c }
    if (envOn) EnvironmentPass()             // §4
    RenderWorld(w); memcpy(VGA, back buffer, 64000)   // 0x11d43, back buffer NOT cleared
    killCheck(t)
}
if (rec) write hy_cam.rec (0x27874)
free([d2564])
FallAway(end+5 = 0x17, v = (0,−4,0), a = (0,0,10))   // 0x28038: grab VGA → quad, slides down
                                                      // 4 units/tick and spins Z 10/tick until sync()>0x17
```
* The iris countdowns open each iris (sin rises 0→257 at c=128) and close it again (sin→0 at c=0).
  One cycle takes 256 ticks ≈ 3.65 s. A countdown starts again only on its own sync edge (never in
  practice).
* The sphere's billboard stops updating at entry 20 (its angles are reset to 0 there). Because the
  tube is the sphere's child, the tube's orientation is then `pod · Rz0·Ry(4t)·Rx(90°)` (E1 §2).
* Flags (E2 §1.4): 4 = no backface cull (hatch animation), 0x20 = inverted backface test (seen from
  inside), 0x1000 = hidden (children still visited).

**Record mode** (`rVal == 5`, debug): 0x118b2/0x118b3 key flags (keyboard ISR 0x1190d) select a
keyboard fly-camera (`0x268a8`, `0x26af8`, `0x254a4`, `0x25898`). The pose is recorded with `0x277e4`
into a 128 KB buffer and written to hy_cam.rec. The release does not need this.

-------------------------------------------------------------------------------------------------

## 6. Material 0: bump/height-mapped "flesh" `0x19160(eax = poly)` (+ `0x18c5c`)

This is a per-triangle routine (E2 polygon record §1.3: slots at +8, +0x80 material, +0x84 →
camera-space face normal N, ×65536 here; +0x88 sort key). Vertex records are E2 §1.2 (sx, sy, z,
corner nx/ny ×256). It draws the triangle as a 2.5D height field: texels are extruded into "spikes"
along the screen direction of the face normal. The extrusion happens in a rotated 256x256 scratch
image, which is then mapped back onto the screen as two transparent textured triangles.
`SIN/COS` = obj2 `0x71054/0x71454` (1024/turn, ×1024, E2 §5.3). `SHADE` = 0xfd0a0.

```
0x19160(P):
  N = *P.+0x84
  if (|N.x| < 0x4000 && |N.y| < 0x4000 && N.z > 0) return        // facing away
  v0,v1,v2 = vertex[P.slot[k].index]
  minx/maxx/miny/maxy of sx,sy;  if (minx>319 || maxx<0 || miny>199 || maxy<0) return
  cx = (maxx+minx+1)>>1;  cy = (miny+maxy+1)>>1
  w = maxx−minx; h = maxy−miny
  (sh1, sh2) = (w>256||h>256) ? (8,12) : (w>128||h>128) ? (9,11) : (10,10)  // [0x81258],[0x81254]
  ang = round(atan2(N.y, N.x) * 512/π) & 0x3ff                  // fistp, nearest
  rc = 1 << (sh2−1)                                             // used for BOTH directions
  for k in 0..2 → record Vk (0x40 bytes at 0xd2568 + 0x40k):
      dx = v.sx − cx; dy = v.sy − cy
      Vk.x(+0x18) = ((dx*COS[ang] − dy*SIN[ang] + rc) >> sh2) + 0x80
      Vk.y(+0x1c) = ((dx*SIN[ang] + dy*COS[ang] + rc) >> sh2) + 0x80
      Vk.z(+0x14) = v.z;  Vk.u(+0x20) = slot.u;  Vk.v(+0x24) = slot.v
      Vk.pu(+0x28) = (v.nx + 0x100) >> 1;  Vk.pv(+0x2c) = (v.ny + 0x100) >> 1
  z = P.+0x88 ? P.+0x88 : 1
  a = (N.x<<2) / z;  b = (−(N.y<<2)) / z                       // C division
  spike = (a*COS[ang] − b*SIN[ang]) >> sh2                      // [0xd2680]
  Extrude(H=mat.+0x18, C=mat.+0x10, Ph=mat.+0x14)               // 0x18c5c, always returns 1
  for k in 0..3 (V0..V3 corners set by Extrude):               // inverse rotation
      Vk.y = ((COS[ang]*Vk.u − SIN[ang]*Vk.v + rc) >> sh1) + cy
      Vk.x = ((SIN[ang]*Vk.u + COS[ang]*Vk.v + rc) >> sh1) + cx
      Vk.u += 0x80; Vk.v += 0x80
  TexTriT(V0,V1,V2, scratch); TexTriT(V0,V2,V3, scratch)       // 0x33ae0
```
`TexTriT 0x33ae0` is the E2 "triangle template" affine mapper with colour 0 **transparent** (spans
`0x4fdf7/0x4fe29`, E2 §4.4 note). It uses record `+0x18/+0x1c` screen coordinates, `+0x20` = texture
row, `+0x24` = column, and a 256x256 texture.

```
Extrude 0x18c5c(H, C, Ph):
  k = spike / 6;  lut[i] = i*k (i = 0..255)
  ScanConvert(V0, V1, V2, 0x43cf8)   // 0x437c4 (E2 §6): left edges → table 0x11683c (x−1),
          // right → 0x11283c (x+1), 32-byte rows {x, z, u, v, pu, pv}<<8 (x plain int);
          // rows [y0=f40, y1=f44) in [0x89f40],[0x89f44]; vertex-x min/max → [0x89f48]/[0x89f4c];
          // row clip [0x89f50]=0 .. [0x89f54]=255
  mid = (f40+f44)>>1
  if (Left[mid].z <= Right[mid].z) { S = Left; E = Right } else { S = Right; E = Left }
  maxEnd = 0
  for row = f40 .. f44−1:
      s = S[row]; e = E[row]
      dX = ((e.x − s.x) << 8) >> 6
      u=s.u; v=s.v; pu=s.pu; pv=s.pv
      du=(e.u−u)>>6; dv=(e.v−v)>>6; dpu=(e.pu−pu)>>6; dpv=(e.pv−pv)>>6
      x0 = clamp(s.x, 0, 255)
      for x = f48 .. x0−1: scratch[row*256 + x] = 0          // f48 may be < 0 (writes previous row)
      X = x0 << 8
      repeat 64 times:
          idx = (v & 0xff00) + (u >> 8)                      // u not masked: spills into later rows
          end = clamp(((lut[H[idx] (unsigned byte)] + X) >> 8) + 1, 0, 255)
          cur = s.x                                          // running "furthest" (this row's S entry)
          if (end > cur) {
              cur = clamp(cur, 0, 255); s.x = end
              p = (((pv & 0xff00) | ((pu >> 8) & 0xff)) + B[idx]) & 0xffff    // 16-bit add
              pix = SHADE[Ph[p]*256 + C[idx]]
              for x = end down to cur: scratch[row*256 + x] = pix
          }
          X += dX; u += du; v += dv; pu += dpu; pv += dpv
      maxEnd = max(maxEnd, s.x)
  V0.u = f40−0x7f; V0.v = f48−0x80;   V1.u = f44−0x81; V1.v = V0.v
  V2.u = V1.u;     V2.v = maxEnd−0x80; V3.u = V0.u;   V3.v = V2.v
  for row = f40 .. f44−1: for x = S[row].x .. maxEnd: scratch[row*256 + x] = 0   // clears the tip pixel too
```
In the spike lookup the height byte is read **unsigned** (`mov al,[H+idx]; and eax,0xff`), so
`lut[H[idx]]` = 0..255·k. The bump table (§2.2) uses the **signed** value of the same bytes.
scratch = `[d3774]` (64 KB, zeroed once at init, never fully cleared). Tube band 3 has v = 2..125
and u = 0..512, so all H/C/B reads stay in rows ≤ 127.

-------------------------------------------------------------------------------------------------

## 7. Deinit `0x1a528`
`DestroyWorld(w)`. For each of the 6 segments: `0x24564` (free its points/faces/normals; the arrays
are shared, so they are freed 6 times) and free the header. `0x24564` on the tube and on the
sphere. Free bukt, env buffer, txt2, txt1x2, txt3, door, phong256, `[d3768]`, bump table, the two
small phong maps, and the light map. The screen is not cleared (the fall-away left it black/partial).
`[0x89f54]/[0x89f50]` stay 255/0.

-------------------------------------------------------------------------------------------------

## 8. Porting checklist
1. Build the meshes exactly as §2 (integer formulas, trunc), the 6 clones, the materials, the
   tables, and SHADE (17490).
2. Phase A: camera = hy_cam[t]; draw the 6 segments (inverted cull off); clear each frame; the
   hatch animation on entry 19; switch to phase B when its countdown drops below 0x60.
3. Phase B per frame, in this order: lightning(prev t) → camera → nearest/second segment, pod pose
   and visibility → tube spin → iris events → (env pass + billboard) → render → present (no clear).
4. Material 6 = P9's `0x34f6c` fetch through the 32-column window. Material 0 = §6.
5. On sync > 0x16: fall-away of the last VGA frame (P10 §8.2 with v=(0,−4,0), az=10/tick).

## Open questions
* The real contents of heap memory past `hy_bukt` (bump table rows 126/127 only) are unknowable.
  Use 0.
* Material 1 `+0x28 = 3` (other parts use 1 with 0x36890). Its meaning belongs to E2/P9's 0x36890 notes.
* §6 was transcribed from the code and checked only through whole-frame emulation, which matches the
  capture. No independent re-implementation was run yet.
