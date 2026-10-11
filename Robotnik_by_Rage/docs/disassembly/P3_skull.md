# P3: intro parts 3 and 5, the skull in the bowl with the projected mouth ("shadow")

Scope: `0x23264` init (both parts), `0x2381c` part-3 run, `0x23de8` part-5 run, `0x24464` deinit, and
the demo-side helpers they reach below 0x2c000: the room-mesh generator `0x228bc`, the light colour map
`0x227d8`, the cylindrical UV mapper `0x231a4`, the projector-pass setup (`0x45930`/`0x4671c` driven by
`0x457f0`; the raster details belong to E2), the part-3 ending `0x27f30` (screen flies away), and the
part-5 ending `0x16f20`/`0x171a8`/`0x168e8`/`0x16650`/`0x169e4`/`0x16c04` (the triangle shatter that
reveals the "music" picture).

Engine calls are named as in `E1_engine_data.md` (SetObjPos, SetCameraPos, ...). Raster internals of the
projector passes (`0x45d78`, `0x46d08`, `0x47ed0`, `0x3dd98` ...) are E2's. This file gives the algorithm
and the exact demo-side constants, plus the per-pixel loop because it defines the effect.

Conventions: `t` = ticks of the 70.086 Hz timer since the part's main loop started
(`t = [0x91260] - [0x91260]@loopstart`). Int domain = float domain x 256 (E1). Angles: 4096 per turn.
C division truncates toward zero, `>>` is arithmetic.

Verified in the emulator (scratch `agents/P3/emu.py`): the colour map formula, the atan approximation
`0x11d72`, and the room mesh (`room.json` holds all points, polygons and normals of the generated room).
Timings checked against `demo.avi`.

---------------------------------------------------------------------------------------------------

## 1. What you see, and how it is made

A bowl-shaped room (barrel walls, grey wavy texture `sh_text.raw`) with two pillars. A skull hangs in
the middle. A second "camera", the **projector**, flies on its own recorded path and projects a
128x80 animated 16-level grey film of a mouth (`teeth.rap`, 36 frames, ping-pong) onto everything as
light. Surfaces the projector cannot see are left at their raw (dark) texture colour. The skull blocks
the light, so it **casts a real shadow** (shadow mapping). The view camera also flies on a recording.

- Part 3 (capture 52.08 s to 69.44 s): skull + jaw + room. The skull sinks into view during the first
  500 ticks. The drill objects exist but are hidden. Ending: the last frame becomes a texture on a quad
  that flies away (69.44 s to 70.56 s).
- Part 5 (89.60 s to 105.84 s): the same scene plus the spinning drill. The drill bit moves along its
  axis (frame-rate dependent, see 5.3). After t=250 dark "damage" spreads on the skull texture around
  the drill hole. Ending: the last frame shatters into 532 triangles that fly toward the viewer and
  reveal `music.raw` (105.84 s to 108.64 s). Part 6 then starts.

Each frame renders in two passes (`0x457f0 RenderWorldProjected(cam=[0xe1c64], proj=[0xe1c80])`):

1. **Light pass** from the projector: every visible, non-hidden object is transformed with the
   projector's matrices, projected with a fixed 256x160-ish projection (centre 128,80) into a
   320x200 **light depth buffer** `[0x11a878]` (u32 per pixel, keeps the max of `tag<<24 | 1/z`). Each
   face gets flags saying whether it is lit at all, and whether it crosses the light-buffer edges.
2. **Camera pass**: the normal painter's pipeline. Lit faces carry, per vertex, the projector-space
   (x, y, 1/z) from pass 1. The span routine (`0x46d08`, installed in every material) interpolates
   them affinely with the texture u,v. For each pixel it compares the pixel's light 1/z with the
   depth buffer. **Lit** pixel = `cmap[film[table[lightpixel]]*256 + texel]`. **In shadow**: just `texel`.
   Faces the projector does not see are drawn with the plain texture mapper `0x331b4`.

There is no fade and no palette animation. The palette is set once in init.

---------------------------------------------------------------------------------------------------

## 2. Files

| file | size | use |
|---|---|---|
| `skull.eob` | 139888 | object tree (E1 §1): #0 skull (423 pts, 743 tris, mat1 = `skultxt.raw`) → child #1 drill bit (506 pts) → child #3 drill box (10 pts, `drill1`) → child #4 drill arm (16 pts, `drillarm.raw`); #1's next sibling #2 = jaw (201 pts, `teethtxt.raw`). The materials' textures are loaded by the material builder (E1 §1.5) |
| `sh_pal.col` | 769 | palette, first 768 bytes (see 7) |
| `gl_pal.col` | 768 | part 5 only: its first 0x60 bytes (colours 0..31) are copied over palette entries 160..191 |
| `sh_text.raw` | 65536 | 256x256 wall texture, values 2..63. Init halves it, giving 1..31 |
| `drill1.raw` | 66304 | 768-byte palette (ignored) + 256x256 texture (values 0..116), used by drill box #3 |
| `teeth.rap` | 184320 | 36 frames x 0x1400 bytes, 4-bit packed 128x80 light film (E1 §5.3) |
| `sh_cam1.rec` / `sh_proj1.rec` | 20364 each | part 3 camera / projector path, 1697 x 12-byte records (E1 §5.1) |
| `sh_cam2.rec` / `sh_proj2.rec` | 14316 / 14304 | part 5 camera / projector path, 1193 / 1192 records |
| `sh_blod.raw` | 4096 | part 5 only: 64x64 damage-growth map, values 0..127 |
| `music.raw` | 64768 | part 5 only: pixels only (offset 0x300, 64000 bytes), the picture the shatter reveals |

Record index = `t` (one record per tick, no interpolation). Part 3 needs up to t≈1217 and part 5 up to
t≈1138, so the files are long enough. Clamp the index anyway.

---------------------------------------------------------------------------------------------------

## 3. Init `0x23264(eax=pVal, edx=variant)` (variant 1 = part 3, 2 = part 5)

`pVal` comes from the `/pN` switch and is 0 normally. `pVal==1` sets `[0x8326c]=1` (record the camera
path), `pVal==2` sets `[0x83270]=1` (record the projector path). These are debug recorders with a
keyboard free-fly (`0x254a4` / `0x25a5c`) that write `.rec` files at the end (`0x27874`). **The port
ignores them.** Everything below assumes both flags are 0.

```
// projector-pixel -> film-texel table (65536 dwords)
T = [0x11a880] = malloc(0x40000)
for row in 0..199: for col in 0..319: T[row*320+col] = ((2*row)/5)*128 + (2*col)/5     // 0..10239
T[64000..65535] = 0

[0x89ec0] = 0                                  // loader verbosity
skull = [0xe1c70] = LoadObject("skull.eob")    // E1 0x24688
load 0x300 bytes of sh_pal.col to pal
if (variant==2) load 0x60 bytes of gl_pal.col to pal+0x1e0     // colours 160..191
setPalette(pal)                                // 0x11af3, all 256 entries, 6-bit
ScalePoints(skull,1); ScalePoints(skull,0x20); ScaleKeys(skull,0x20)   // E1 table: p/2048
CylMap(#3 = skull->child->child)               // 0x231a4, see 3.2
CylMap(#1 = skull->child)
UseMaterial(#3, M1=0xe0be0)                    // 0x24720: single runtime material, all faces mat 0
UseMaterial(#1, M2=0xe0c10)
SetSpanFnTree(skull, 0x46d08)                  // 0x246d0: every runtime material of the tree
SetObjAngles(skull, {0, 0x800, 0x800})         // 180° about Y and about Z
ClearFlagsTree(skull, 2)                       // 0x277bc: clear render-flag bit 1 (0x20e -> 0x20c)
world = [0xe1c78] = 0x83328                    // static Object = the room (3.1)
room.child(+4) = [0x8332c] = skull             // skull hangs under the room
zalloc = [0x11a874] = malloc(0x40000); zbuf = [0x11a878] = zalloc + 0xc00; memset(zalloc,0,0x40000)
memset(0xe4d40, 0, 0x10000)                    // back buffer
BuildRoom(world)                               // 0x228bc, 3.1
cam  = [0xe1c64] = CreateWorld(30, 0x76c, 0xa8c, 0xa8c);  cam+0xb8 = 1
proj = [0xe1c80] = CreateWorld(30, 0x76c, 0xa8c, 0xa8c)
SetCameraPos(proj,0,0,0); SetCameraAngles(proj,{0,0,0}); CameraPitchLocal(proj,0x400); CameraMoveLocalZ(proj,-12000)
                                               // overwritten by the recording on the first frame
wall = [0xe1c68] = load("sh_text.raw")
skultex = skull.mat[1].tex                     // runtime material 1 (+0xa4 +0x30 +0x10)
for i in 0..65535:
    wall[i] >>= 1                              // 1..31
    v = skultex[i] - 4;  skultex[i] = (v > 192) ? v : 192     // signed compare; 192..219
drill = [0xe1c6c] = load("drill1.raw")
M0 = 0xe0bb0, M1 = 0xe0be0, M2 = 0xe0c10 (runtime materials, 0x30 bytes, E1 §3.2), all fields 0 except:
    +0x0c = 0xfd0a0 (colour map), +0x1c = +0x20 = 256 (tex w,h), +0x2c = 0x46d08 (span fn)
    M0.tex(+0x10) = wall   (room)         M1.tex = drill+0x300 (drill box)     M2.tex = wall (drill bit)
SetObjPos(world,0,0,0); SetObjAngleX(world,0x400); SetObjAngleY(world,0); SetObjAngleZ(world,0)
                                               // the room is turned 90° about X: its z axis becomes vertical
AddObject(cam, world); ComputeBounds(cam); SetRenderMode(cam,3); SetDefaultTargets()   // back buffer 0xe4d40
BuildColourMap()                               // 0x227d8, section 7
film = [0x11a870] = malloc(0x2800);  rap = [0xe1c74] = load("teeth.rap");  Unpack4(rap+0, film)  // frame 0
if (variant==1) { [0xe1c60] = [0xe1c7c] = 0 }
else {
    [0xe1c7c] = load("sh_blod.raw")
    pic = [0xe1c60] = malloc(0xfa00); load music.raw offset 0x300, 0xfa00 bytes -> pic
    for i in 0..63999: pic[i] += 0xa0          // byte wrap; picture colours 0..31 -> 160..191 (gl_pal)
    memset(pic, 0, 320); memset(pic+0xf780, 0, 640)   // row 0 and rows 198..199 black
}
camRec  [0xe0c4c] = load(variant==1 ? "sh_cam1.rec"  : "sh_cam2.rec")
projRec [0xe0c5c] = load(variant==1 ? "sh_proj1.rec" : "sh_proj2.rec")
```

Record controls: camera `0xe0c40 {+0 index, +4 cursor, +8, +0xc buf}`, projector `0xe0c50` (same
layout). `+0xc` points at the loaded file (`[0xe0c4c]` / `[0xe0c5c]`).

### 3.1 The room `0x228bc BuildRoom(obj=0x83328)`

The static Object at 0x83328 (E1 §3.1 layout) has in the data segment: 174 points, 288 polygons,
288 face normals, K = identity (0x100 on the diagonal), flags `+0x84 = 8`, 1 runtime material = M0.
`0x244f0` allocates the point / polygon / normal arrays. The trig is the 512-step 8.8 table
`S[]` (`sin(a) = S[a&511]`, `cos(a) = S[(a&511)+128]`, M doc §3.2, peak 257).

```
// bowl: 9 rings x 16 points, index 16*r + k
for r in 0..8:  s = sin(0x40 + 16*r);  z = -8192 + 2048*r
    for k in 0..15:  P[16r+k] = ( (cos(32k)*s) >> 2,  (sin(32k)*s) >> 2,  z )
// e.g. P[0] = (11629, 0, -8192), ring 4 radius 16512
// two pillars: 5 levels x 3 points; A = 0x22790 {(-5600,9600),(-4600,8200),(-3600,9600)},
//                                    B = 0x227b4 {(3600,9600),(4600,8200),(5600,9600)}
for j in 0..4: for i in 0..2:  P[144 + 3j + i] = (A[i].x, A[i].y, -8000 + 4000j)
for j in 0..4: for i in 0..2:  P[159 + 3j + i] = (B[i].x, B[i].y, -8000 + 4000j)

face f: +0 = 0, +4 = 0 (material), +8 = f (own normal), +0xc..+0x14 = vertices, +0x18..+0x2c = uv
bowl, f = 32r + 2k (r 0..7, k 0..15), k1 = (k+1)&15, vr = 33r - 33:
    f   : (16r+k, 16r+k1, 16(r+1)+k1)   uv (16k,vr) (16k+16,vr) (16k+16,vr+33)
    f+1 : (16r+k, 16(r+1)+k1, 16(r+1)+k) uv (16k,vr) (16k+16,vr+33) (16k,vr+33)
pillar A, f = 256 + 4j + 2i (j 0..3 levels, i 0..1 sides), p(j,i) = 144 + 3j + i:
    f   : (p(j,i), p(j+1,i+1), p(j,i+1))   uv (16i,33j) (16i+16,33j+33) (16i+16,33j)
    f+1 : (p(j,i), p(j+1,i), p(j+1,i+1))   uv (16i,33j) (16i,33j+33) (16i+16,33j+33)
pillar B: the same with base 159, faces 272..287.
```
Note the u at k=15 runs to 256 (not 0), and v of ring 0 starts at -33. Only two of the three pillar
sides are built: they are open prisms. Then `0x24cb0` computes face normal f for every face via
`0x247d4`. That is a float cross product of the edge vectors, normalised, times **65536.0**, truncated
to ints. The file objects use x255 normals. Exact values are in `room.json`, e.g. face 0 = (46436, 9949,
-45162), pillar faces (±53328, 38092, 0).

### 3.2 `0x231a4 CylMap(obj)` (cylindrical UVs around the object's Y axis)

For every face, for each of its 3 vertices `(x,y,z)` (already scaled):
`u = Ang(z, x) >> 2` (0..256), `v = y >> 3`. These are stored into face `+0x18/+0x1c`, `+0x20/+0x24`,
`+0x28/+0x2c`.
`0x11d72 Ang(a=eax, b=ebx)` is an octant-linear atan2. It returns 0..1024 (1024 = one turn),
measured from +a towards +b (verified: Ang(100,0)=0, (0,100)=256, (-100,0)=512, (0,-100)=768,
(100,50)=64, (50,100)=192):
```
if a>0:  if b>0:  r = a>=b ? (b<<7)/a        : 0x100 - (a<<7)/b
         if b<0:  r = a>=-b ? 0x400 - (-b<<7)/a : 0x300 + (a<<7)/(-b)
         if b==0: r = 0
if a<0:  A=-a; if b>=0: r = A>=b ? 0x200 - (b<<7)/A : 0x100 + (A<<7)/b
               else:    r = A>=-b ? 0x200 + (-b<<7)/A : 0x300 - (A<<7)/(-b)
if a==0: r = b>=0 ? 0x100 : 0x300
```

---------------------------------------------------------------------------------------------------

## 4. Part 3 run `0x2381c(eax=endIdx=0xa, edx=variant=1)`

```
#1.flags |= 0x1000;  OrFlagsTree(#3, 0x1000)       // hide drill bit, box, arm (0x27798 recursion)
camCtl = projCtl = {0,0,0,..}
z0 = GetObjZ(skull)                                // 0 (file value)
while (SyncIdx() <= endIdx) EscPauseCheck()       // "shadow waiting for sync": until entry 10 (pos 5,row 0x34) = 52.08 s
start = [0x91260];  tag = [0x11a87c] = 0;  prevFilm = 0
while (SyncIdx() <= endIdx+1) {                    // until entry 11 (pos 7,row 0x30) = 69.44 s
    t = [0x91260] - start
    EscCheck()                                     // 0x122f0 (its eax arg = loops*17920/t is an unused fps value)
    projCtl.index = t; PlayRec(proj, projCtl)      // 0x2789c: SetCameraPos(rec.xyz) then SetCameraAngles(rec.angles)
    camCtl.index  = t; PlayRec(cam,  camCtl)
    f = (t>>3) % 72;  if (f > 35) f = 71 - f       // ping-pong 0..35..0, 8 ticks per film frame
    if (f != prevFilm) Unpack4(rap + f*0x1400, film);  prevFilm = f
    a = (short)((-t) << 6)
    SetObjAngleY(#1, a); SetObjAngleY(#3, a)       // drill spin (hidden here)
    if (t <= 500) SetObjZ(skull, z0 - (500-t)*16)  // skull sinks in: z from -8000 to 0 over 7.1 s
    RenderWorldProjected(cam, proj)                // 0x457f0, section 6
    Present()                                      // 4.1
}
ScreenFlyAway(endIdx+2)                            // 0x27f30, section 8
```
`SetObjZ` is only called while t<=500. If no iteration lands exactly on t=500, the skull stops at
`-(500-t_last)*16`, a few units short. This depends on the frame rate.

### 4.1 Present + light-buffer tag (both parts)
```
tag++                                              // [0x11a87c]
if (tag <= 255) { copy back buffer 0xe4d40 -> VGA (64000 bytes); clear back buffer }
else            { tag = 0; clear zbuf (64000 dwords); copy back buffer -> VGA; clear back buffer }
```
The light depth buffer is never cleared per frame. Each value carries the frame number in its top byte
(`tag<<24`), so last frame's values always compare as "far". The port can simply clear the light
buffer to 0 every frame and use any tag. The result is identical. Back buffer cleared to 0 = black
background above the bowl.

---------------------------------------------------------------------------------------------------

## 5. Part 5 run `0x23de8(eax=endIdx=0xf, edx=2)`

No objects are hidden. The skull Z is not animated (it stays at 0).

```
skultex = skull.mat[1].tex
wait while SyncIdx() <= endIdx                     // until entry 15 (pos 0xa,row 0) = 89.60 s
start = [0x91260]; tag = 0; prevFilm = 0
while (SyncIdx() <= endIdx+1) {                    // until entry 16 (pos 0xb,row 0x34) = 105.84 s
    t = [0x91260] - start;  EscCheck()
    PlayRec(proj, projCtl[t]);  PlayRec(cam, camCtl[t])
    a = (short)((-t) << 6);  SetObjAngleY(#1, a); SetObjAngleY(#3, a)
    if (t < 700) { p = GetObjPos(#1); SetObjPos(#1, p.x, p.y + ((-t) >> 3), p.z) }   // 5.3
    film frame as in part 3
    if (t > 250) Damage(t)                         // 5.2
    RenderWorldProjected(cam, proj); Present()
}
duration = [0x91260] - start
Shatter(speed=0x78, mode=1)                         // 0x16f20
ShatterRun(endIdx+2, pic=[0xe1c60])                // 0x171a8, until entry 17 (pos 0xc,row 8) = 108.64 s
ShatterFree()                                      // 0x169d0
```

### 5.1 Drill spin
`#1` (bit) and `#3` (box, child of #1) both get angle Y = `-t*64` (4096/turn → 1.095 turns/s).
#3's K is a 180° Z rotation and its offset lies on the bit axis. So its own Ry(a) cancels the
inherited spin: the box stays still while the bit turns. This falls out of the E1 matrix chain.

### 5.2 Damage on the skull texture `Damage(t)` (permanent writes into `skultex`)
```
thr = 127 - ((t-250) >> 2);  if (thr <= 1) thr = 1          // reaches 1 at t=754
for by in 0..63: for bx in 0..63:
    if (blod[by*64+bx] > thr) {                              // blod bytes 0..127
        o = 0x2340 + by*0x200 + bx*2                         // texel (row 35+2by, col 64+2bx)
        skultex[o] = skultex[o+1] = skultex[o+256] = skultex[o+257] = 0xf0
    }
```
0xf0 is a near-black grey (10,10,10). When lit, the colour map turns it into up to 0xfe (20,20,20). So
dark cracks grow around the drill site over 7 s. The texture region is cols 64..191, rows 35..162 of
`skultxt`.

### 5.3 Drill advance: frame-rate dependent
Each loop iteration adds `floor(-t/8)` (int units, 1/256 of a world unit) to #1's local y. The sum
depends on how many iterations run before t=700. In `demo.avi` the main loop runs about every
**7.26 ticks** (≈9.6 fps; changes at t = 0, 7, 15, 22, 30, 38, 47, 55, 64, 72, ...). The total
displacement is then ≈ **-4400**. At 70 fps it would be -30888, which pushes the bit several skull
widths away. **To match the original, run this update on an emulated ~7-tick cadence (or replay the
capture's iteration ticks). Do not run it per rendered frame.** Everything else in parts 3/5 is driven
by `t` directly and does not depend on the frame rate.

---------------------------------------------------------------------------------------------------

## 6. The projected light / shadow (`0x457f0 RenderWorldProjected(eax=cam, edx=proj)`)

Pass 1 (`0x45930`) runs on a stack copy of `cam` whose view matrices (+0x3c..+0x9b) and vertex buffer
(+0x2c) are replaced by `proj`'s. `[0x8a054] = proj` lets pass 2 find the projector vertex buffer. It
walks the object list (room → skull tree). For every object:

1. Build the object matrix (same as the normal renderer, E1 §2) and transform its vertices with
   `0x45c54`. Each 0x24-byte vertex record goes to `proj.vbuf[base+i]`, and `obj+0xb0 = base`:
   ```
   x = (m0*X + m3*Y + m6*Z) >> 8 + m9;  y = (m1*X + m4*Y + m7*Z) >> 8 + m10;  z = (m2*X + m5*Y + m8*Z) >> 8 + m11
   if (z != 0) { iz = 0x100000 / z; sx = ((x*iz) >> 11) + 128; sy = 80 - ((y*iz) >> 11) }
   else        { iz = 0x100000;     sx = x;                    sy = y }
   rec: +0 x, +4 y, +8 iz, +0x18 sx, +0x1c sy, +0x20 = 1
   ```
   The projection centre (128,80) and scale are hard-coded. The `T` table maps light-buffer pixels
   (0..319, 0..199) onto the 128x80 film, so the film's optical centre is film pixel (51,32).
2. Transform the face normals (`0x3add4`, E2).
3. Unless hidden (`+0x84 & 0x1000`), rasterise every face into the light buffer (`0x45b38`):
   - `face+0 = 0` (flags).
   - Candidate if all three `iz > 0` and the projector-space face normal `.z > 1`.
   - For candidates `flags = 0x45d78(face)`, which rasterises the triangle into `zbuf[y*320+x]` (clip
     x 0..319, y 0..199) with value `(tag<<24) | (I & 0xffffff)`. `I` is `iz<<12` interpolated, and
     the larger value wins (unsigned). It returns 0 if the triangle is off-screen or empty, 3 if
     degenerate. Otherwise: bit0 = at least one span written, bit1 = the bbox touches the border
     (`maxx>318 || minx<1 || maxy>198 || miny<1`).
   - Then `flags |= 4 if normal.x <= 0`, `|= 8 if normal.y <= 0`, and store in `face+0`.

Pass 2 (`0x4671c`, the normal camera pass) builds a 0xa4-byte poly record for every visible face of
every non-hidden object (`0x46994`). Each vertex gets the texture u,v plus, from `proj.vbuf[obj+0xb0
+ vertex]`, `sx<<16`, `sy<<16`, `iz<<12`. Polys are sorted (painter's, E2) and drawn by the material's
span routine `0x46d08`, which picks a path from `face+0 & 3`:

- `0` → `0x331b4` plain affine texture (`pixel = texel`): unlit, back-facing to the light, outside
  the light buffer, or occluded everywhere.
- bit1 set → `0x47ed0` (per-pixel bounds check, inner loops `0x491e3`/`0x492a0`).
- else (bit0) → `0x46d08` fast path (inner loops `0x490a7` left-to-right / `0x4911c` right-to-left,
  patched by `0x49065`/`0x49086` with `zbuf`, `film`, `T`, texture).

All attributes are affine in screen space. Texture coords are packed in one register
`uv = (v 8.8)<<16 | (u 8.8)` and stepped by one 32-bit add. Per pixel (`0x490a7`, the colour map is
fixed at 0xfd0a0):
```
texel = tex[((uv >> 24) << 8) | ((uv >> 8) & 0xff)]
p     = (((ly >> 16) * 320) + (lx >> 16)) & 0xffff          // light-buffer pixel (lx, ly are 16.16)
if (L >= zbuf[p])  pixel = cmap[(film[T[p]] << 8) | texel]  // lit (unsigned compare)
else               pixel = texel                            // shadowed
uv += duv; lx += dlx; ly += dly; L += dL                    // L starts as (tag<<24)|(I & 0xffffff)
```
The bounds-checked loop (`0x491e3`) does the same, except when `ly < 0 || ly > 199<<16 || lx < 0 ||
lx > 319<<16`. Then `pixel = texel` and the light lookup is skipped. Because `zbuf` holds only this
frame's nearest surface as seen from the projector, a receiver further away fails the test → shadow.
Surfaces equal to themselves pass (small self-shadow acne along edges comes from the different
rasterisation of the two passes).

### Hidden objects
`+0x84 & 0x1000` objects (part 3: drill bit, box, arm) still get vertices and normals projected in both
passes, but produce no light-buffer writes and no polygons, so they are invisible and cast no shadow.

---------------------------------------------------------------------------------------------------

## 7. Palette and the light colour map `0x227d8` (verified)

`sh_pal.col` layout (6-bit RGB):

| colours | ramp |
|---|---|
| 0..63 | grey (i,i,i) |
| 64..95 | violet-grey, black → white (drill textures) |
| 96..127 | cool grey, black → white |
| 128..159 | brown-red → white |
| 160..191 | dark red / brown (part 5: replaced by gl_pal 0..31 for the music picture) |
| 192..223 | bone, black → (63,63,63) (skull, jaw) |
| 224..255 | dark grey 0..20 (0xf0 = 10) |

Colour map at 0xfd0a0, 16 rows (`film` levels 0..15) of 256:
```
for r in 0..15, c in 0..255:
    cmap[r*256+c] = c < 64 ? min(63, c + 3r)                       // grey ramp: +3 per level
                           : (c & 0xe0) | min(31, (c & 31) + ((3r) >> 1))   // 32-colour ramps: +1.5 per level
    if (c == 255) cmap[r*256+c] = min(that, 0xfe)
```
Row 0 is the identity (so film value 0 = "lit" looks the same as shadow). Walls are texels 1..31 (dark
grey) and go up to 76→63 when fully lit. The skull is 192..219 and saturates at 223. Colour 0xff is never
produced.

---------------------------------------------------------------------------------------------------

## 8. Part 3 ending `0x27f30 ScreenFlyAway(endIdx=0xc)`

Same machinery as P0 §8 (`0x27cac(0)` setup, documented there). Steps: VGA (= last skull frame)
resampled to a 256x256 texture, quad `0x835b8` (±160, ±100), material 0xe2c90 span 0x36890, its own
world (30, 0x76c, 0xa8c, 0xa8c), camera angles 0 and `CameraMoveLocalZ(-256)` → the quad exactly
covers the screen. Loop without tick wait, `t` from its own start:
```
while (SyncIdx() <= 0xc) {                       // until entry 12 (pos 7,row 0x38) = 70.56 s
    SetObjPos(quad, -8t, 4t, 16t)                // left, up(+y), away
    SetObjAngleX(quad, (short)(16t)); SetObjAngleY(quad, (short)(16t))
    RenderWorld(w2); copy back → VGA; clear back; EscCheck()
}
free tex, free [0x83464], DestroyWorld(w2)
```
The capture shows the picture shrinking and tumbling away in about 0.4 s (69.44 → 69.8 s), then black.
(`0x28038` is the generic version with per-axis multipliers, `pos=(8t,-t,8t)`, `ang=(12t,16t,0)`.
It is only reached if 0x2381c is called with variant≠1, which never happens.)

---------------------------------------------------------------------------------------------------

## 9. Part 5 ending: the triangle shatter

### 9.1 Setup `0x16f20(eax=speed=0x78, edx=mode=1)`
```
[0x81240] = speed (120); [0x89f18] = D = 0x100000 (projection distance); [0x81244] = 0; ntri [0x81230] = 0
srand(1)                                         // 0x43437; rand = 0x43413: s = s*0x41c64e6d+0x3039; (s>>16)&0x7fff
SetDefaultTargets(); SetTarget(back=0xe4d40, 320, 200)   // obj2 0x76a3c: row-offset table at 0x70849
texL = [0x95f10] = malloc(64K): row y (0..199) = VGA[y*320 + 0..255]      (stride 256)
texR = [0x95f14] = malloc(64K): row y         = VGA[y*320 + 64..319]
// grid 15 rows x 20 cols, vertex k = 20*row + col
for row in 0..14: for col in 0..19:
    X[k] = col*320/19;  if (col!=0 && col!=19) X[k] += rand()%7 - rand()%7    // first rand() is the minuend
    Y[k] = row*200/14;  if (row!=0 && row!=5)  Y[k] += rand()%6 - rand()%6    // (sic: row 5, and row 14 is jittered)
// arrays: X at 0xce958, Y at 0xcf2b8 (dwords)
for k in 0..279: if (k%20 != 19) MakeQuad(k)     // 0x16c04 -> 266 quads, 532 triangles
for i in 0..ntri-1: Launch(i, mode)              // 0x169e4
```
`MakeQuad(k)`: `sel = X[k] > 128` (signed), `tex = sel ? texR : texL`, `u = X - 64*sel`. Two triangles,
each with **its own 3 vertices** (vertex array 0x95f18, 64-byte records: `+0 x, +4 y, +8 z` in 16.10,
`+0xc/+0x10/+0x14` rotated copy, `+0x18 sx, +0x1c sy`, `+0x20 v, +0x24 u`):
```
vertex(k) = { x = (X[k]-160)<<10, y = (Y[k]-100)<<10, z = 0, v = Y[k], u = X[k] - 64*sel }
tri 2q   : vertices (k, k+1, k+21)
tri 2q+1 : vertices (k, k+20, k+21)
```
Triangle record (0xb5318, 0x34 bytes): `+0 tex, +4/+8/+0xc vertex idx (3i, 3i+1, 3i+2), +0x10/+0x14/+0x18
velocity, +0x1c/+0x20/+0x24 angles (0..1023), +0x28/+0x2c/+0x30 angular velocity`, all 0 at creation.

`Launch(i, mode=1)`: blast centre `E = (0, 0, 0xfa000)` (globals 0x81234/38/3c, data-segment
constants):
```
c = centroid (sum/3 per axis, C division);  d = c - E
dist = trunc(sqrt((d.x>>8)^2 + (d.y>>8)^2 + (d.z>>8)^2))
vel = (d.x*speed/dist, d.y*speed/dist, d.z*speed/dist)      // |vel| ≈ 120*256; mostly -z (toward viewer)
angvel = (rand()%11 - 5, rand()%13 - 6, rand()%11 - 5)
```
(`mode==0` is a gravity-like variant used elsewhere: vel.x = rand()&31, vel.z = rand()&63,
vel.y = rand()%5 + ((2*c.y + 0x4b000) >> 5), angvel = 3 x (rand()%15 - 7).)

### 9.2 Per frame `0x171a8 ShatterRun(endIdx=0x11, pic)`
```
while (SyncIdx() <= endIdx) {
    StepAndDraw()                                // 0x168e8
    WaitTick()                                   // 0x123b0
    copy back → VGA;  copy pic → back            // so the next frame draws over the music picture
    EscCheck()
}
```
The first frame's background is black (the back buffer was cleared by part 5's last Present). From the
second frame on it is `pic`. Motion is **per iteration**. The capture shows an iteration every 2-3 ticks
at first, then 1 tick. All triangles are gone after ~35 iterations (105.84 → ~106.75 s), then the music
picture stays.

`StepAndDraw`: for every triangle `Step(i)` (`0x16650`), then project all `3*ntri` vertices
(`0x435e8`), then draw every triangle (`0x43654` edge setup with edge function 0x439cc + span filler
obj2 `0x764a2(tex)`):
```
Step(i):
    c = centroid(+0,+4,+8)                        // sum/3, C division
    for its 3 vertices: v -= c
    R = rot(ang)                                  // 0x43450, below
    for its 3 vertices: v.r = R·v                 // into +0xc,+0x10,+0x14, no shift
    ang = (ang + angvel) & 0x3ff  (per axis)
    for its 3 vertices: v.r = (v.r >> 10) + c;   v += c + vel
Project(v):  if (v.rz > -D) { sx = (v.rx<<10)/(v.rz + D) + 160;  sy = (v.ry<<10)/(v.rz + D) + 100 }
             // else sx, sy keep their previous values (stale)
Draw(tri):   skip only if EVERY vertex has (unsigned) sx >= 320 AND sy >= 200 (a weak reject; the
             edge function then drops rows outside 0..199 and the span filler clips x)
             else affine texture fill, texel = tex[(v_int<<8) | u_int] (u, v interpolated 8.8 from the
             vertex u, v), no transparency, no backface culling, clip y 0..199, x 0..319
```
`0x43450 rot(ax, ay, az)` uses the 1024-entry tables `sin = 0x71054`, `cos = 0x71454` (value x1024,
e.g. sin[128] = 724). With `sa,ca` from ax, `sb,cb` from ay, `sc,cc` from az:
```
m0 = ((cb*cc*ca >> 10) - sc*sa) >> 10     m1 = ((cb*cc*sa >> 10) + sc*ca) >> 10     m2 = (-cc*sb) >> 10
m3 = ((-sc*cb*ca >> 10) - cc*sa) >> 10    m4 = (cc*ca + (-sc*cb*sa >> 10)) >> 10    m5 = (sc*sb) >> 10
m6 = (ca*sb) >> 10                        m7 = (sa*sb) >> 10                        m8 = cb
rx = x*m0 + y*m1 + z*m2;  ry = x*m3 + y*m4 + z*m5;  rz = x*m6 + y*m7 + z*m8
```
(`cb*cc` is kept unshifted before the multiply by ca/sa. Products are 32-bit.)
Edge stepping / span details of 0x43654, 0x439cc, 0x764a2: edge tables 0x11283c / 0x11683c, 32 bytes
per row (`+0 x, +8 v<<8, +0xc u<<8`). The span is drawn from the right edge leftwards, inclusive of
both ends, with 16-bit truncated u,v steps. Right clip: `x>319 → start += (x-320)*step, x = 319` (sic).
Left clip at 0. Treat this as E2's generic textured triangle.

`0x169d0` frees texL/texR.

---------------------------------------------------------------------------------------------------

## 10. Deinit `0x24464`
Frees everything (objects via 0x3b828 and 0x245a4 on the room tree, both worlds, wall, drill, film, zbuf,
rap, T, blod, pic) and clears the shade-table cache (`0x315f0`). There is no screen clear. Port: nothing
visible.

## 11. Globals

| addr | meaning |
|---|---|
| 0xe1c70 | skull tree root |
| 0xe1c78 | = 0x83328, the room object (scene root) |
| 0xe1c64 / 0xe1c80 | camera world / projector world |
| 0xe0c40 / 0xe0c50 | record controls (camera / projector), +0 = index = t |
| 0xe0c4c / 0xe0c5c | camera / projector record buffers |
| 0xe1c68, 0xe1c6c | sh_text (halved), drill1.raw |
| 0xe1c74, 0x11a870 | teeth.rap, unpacked film 128x80 |
| 0x11a874 / 0x11a878 | light depth buffer alloc / base (+0xc00), 320x200 u32 |
| 0x11a87c | frame tag 0..255 |
| 0x11a880 | T: light pixel → film texel |
| 0xe1c7c, 0xe1c60 | sh_blod (part 5), music picture +0xa0 (part 5) |
| 0xe0bb0/0xe0be0/0xe0c10 | runtime materials M0 room, M1 drill box, M2 drill bit |
| 0xfd0a0 | 16x256 light colour map |
| 0x8326c / 0x83270 | debug: record camera / projector |
| 0x95f10/0x95f14, 0x95f18, 0xb5318, 0xce958, 0xcf2b8, 0x81230..0x81244, 0x89f18 | shatter (section 9) |

## 12. Timeline check against demo.avi (capture time = song time here)
- 52.08 s part 3 main loop starts (first frame 52.1: room + projected mouth, skull not yet visible).
- ~59.2 s skull finished sinking (t=500).
- 69.44 s fly-away starts, gone by ~69.8 s; black until part 4.
- 89.60 s part 5 starts. 93.2 s damage begins. ~99.6 s drill stops advancing. 105.84 s shatter, done
  by ~106.75 s. Music picture until 108.64 s.
- Iteration rate in the capture: part 3 ≈ every 5-6 ticks, part 5 ≈ every 7 ticks (DOSBox speed). Only
  the drill advance (5.3), the skull's final z (4) and the shatter speed (9.2) depend on it.

## Open questions
- Raster rounding of pass 1 (`0x45d78`) and the span setup of `0x46d08`/`0x47ed0` (where the edges and
  gradients of uv, lx, ly, L come from, and what flag bits 4/8 select): E2.
- The order in which the camera pass draws (sort key `+0x88` = sum of camera iz): E2.
- The drill's per-iteration advance makes the original's look depend on machine speed. The ~7.26-tick
  cadence is measured from this capture, not from the code.
