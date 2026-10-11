# P10 — the cloth room ("vectors / burn / flesh")

Part 10 of the sequencer: `init 0x13128(eax=mode)` / `run 0x1366c(endIdx=0xc)` / `deinit 0x139fc`.
Capture: 225.1–249.2 s of `demo.avi`. Timeline (capture seconds, measured):

| t (s) | what | code |
|---|---|---|
| 225.1–225.4 | last frame of part 9 held (init is loading files) | `0x13128` |
| 225.4–229.05 | **intro**: a 320x200 quad, front = grab of part 9's last frame, back = `cl_pic.raw`, tumbles away and comes back, 256 ticks | `0x28168` |
| 229.05–229.55 | `cl_pic.raw` drawn flat, palette switches to `cl_pal.col`, waits for sync point 12 | `0x13128` tail, `0x1366c` head |
| 229.55–247.5 | **main loop**: octagonal room, cloth draped over an invisible 8x8 "table", recorded camera, 6 rotating light flares, word overlays at 236.3 / 238.5 / 240.8 | `0x1366c` |
| 247.5–249.2 | **outro**: grab of the last frame on a quad that tilts and slides away | `0x28038` |

Everything here was read from the listing. The cloth simulator `0x14730` was run in unicorn against a
Python model over 40 steps. Positions and velocities matched bit for bit, max diff 0
(`agents/P10/simtest.py`). Engine conventions (matrices, angles, object/world structs, camera API)
are in `E1_engine_data.md`. Span routines and the raster pipeline are E2's. Shared helpers are in
`M_main_support.md`. Unless marked 0x, numbers are decimal.

---------------------------------------------------------------------------------------------------

## 1. Globals

| addr | holds |
|---|---|
| `[0x92298]` | edit/record mode flag. It is set to 1 only if init's `eax == 4`. A normal run passes something else, so it stays 0 |
| `[0x922ac]` | Cloth* (the simulator object, 0x341c bytes, §3) |
| `[0x922b0]` | World* (camera) |
| `[0x922b4]` | = 0x80b00, the cloth mesh object and root of the scene tree |
| `[0x928a8]`,`[0x928ac]`,`[0x928b0]`,`[0x949d8]` | cloth object's points / polygons / face normals / corner normals (copies of obj+0xc,+0x14,+0x1c,+0x24) |
| `[0x922b8]` | `cl_cloth.raw` (65536 B, 256x256 texture, no palette header) |
| `[0x922bc]` | env/shade map (32 KB, 128x128, stride 256) built by `0x314c0` |
| `[0x922c0]` | `cl_walls.raw` (65536 B, 256x256, no header) |
| `[0x922c4]` | `cl_floor.raw` (768 B palette + 256x256). The texture used is +0x300 |
| `[0x922c8]`,`[0x922cc]`,`[0x922d0]` | `vectors.raw`, `burns.raw`, `flesh.raw` (768 B palette + 320x200). Pixels are **doubled in place** at load |
| `[0x923a8]` | `su_star.raw` (64x64 = 4096 B), remapped in place to `(v>>1)+0x40` |
| `[0x922a8]` | camera recording buffer (`cl_cam1.rec`) |
| `[0x9229c]` | recording control: +0 index (= elapsed ticks), +4 cursor, +0xc buffer (= `[0x922a8]`). `[0x922a0]`,`[0x922a4]` = 0 |
| `[0x922d4]` | 1 = wind forces enabled. Always set to 1 |
| `[0x93dd8]` | float[256][3] scratch: per-vertex normal sums |
| `[0x928b4]` | float[450][3] scratch: face normals (float) |
| `[0x949dc]` | counter: +1 per simulation step (not read) |
| `0xfd0a0` | the global 64 KB blend table `L[row*256+col]` (§6) |
| `[0x89dcc]` = 0xe4d40 | back buffer (`0x3a810`). `[0x106b58]` = 0xa0000 |

## 2. Init `0x13128(eax=mode)`

Locals are set first: cloth parameters k0=1.0, k1=0.1, k2=0.1, step=0.99, mass=2.0, grav=0.0015,
drag=0.02. Also a double 1.0 at `[esp+0x33c]`; its high dword is the "1.875" the listing annotates at
0x13190.

```
[0x922b4] = 0x80b00;  if (mode == 4) [0x92298] = 1
AllocArrays(0x80b00)             // 0x244f0: 256 pts, 450 polys, 450 face normals, 256 corner normals
[0x928ac]=obj+0x14; [0x928a8]=obj+0xc; [0x928b0]=obj+0x1c; [0x949d8]=obj+0x24; [0x922d4]=1
BuildCloth()                     // 0x13a60, §3.1 (creates [0x922ac], polygons)
cloth.k0..drag = the locals above      // setters 0x1576c..0x157cc (one float field each, §3)
L[0..255] (row 0 of 0xfd0a0) = i for i<0x40 or i>=0x80, 0 for 0x40..0x7f     // the shadow row (§6)
[0x922bc] = ShadeTable(gamma=1.0, lo=0x30, hi=0x7f, scale=128.0, base=0, N=0x80, stride=0x100)
            // 0x314c0 called directly (no cache), E1 §1.5 formula: v = trunc(pow(1-r,1.0)*128),
            // clamped to [0x30,0x7f]: 127 in the centre, falling linearly with r, 0x30 from r>=0.625 out
cl_cloth, cl_walls, cl_floor, vectors, burns, flesh = loadFile(...)    // 0x2cf98
for each of vectors/burns/flesh: for (i=0x300; i<0xfd00; i++) p[i] = (u8)(p[i]*2)
            // all 64000 pixels: 0..31 -> 0..62
cloth material 0x92848 (runtime material, E1 §3.2):
    +0x04=0, word +0x08=0, +0x0c=0xfd0a0, +0x10=cl_cloth, +0x14=[0x922bc], +0x18=0,
    +0x1c=256, +0x20=256, +0x24=0xff, +0x28=0, +0x2c=0x33170
floor material 0x922d8:  +0x10 = cl_floor+0x300, +0x2c = 0x36890
wall material  0x92308:  +0x10 = cl_walls,       +0x2c = 0x36890
plane material 0x92338:  +0x2c = 0x32788
light material 0x92368:  +0x28 = 1, +0x2c = 0x32714
flare material 0x92398:  +0x10 = su_star, +0x28 = 1, +0x2c = 0x31b64
su_star = loadFile("su_star.raw"); for i<4096: s[i] = (s[i]>>1) + 0x40     // 0..127 -> 0x40..0x7f
SetObjPos(0x80b00, 0,0,0); SetObjAngleX(0x80b00, 0xfc00 /* -1024 */); SetObjAngleZ(0x80b00, 0)
InitFloorPolys(0x8077c)          // 0x12f00, §4
InitWallPolys(0x808e4)           // 0x12fd4, §4
link the scene as a CHILD chain (E1: +4 = first child, so each object inherits the previous one's matrix):
    0x80b00 cloth -> 0x8077c floor -> 0x80830 shadow plane -> 0x80998 light -> 0x808e4 walls -> 0x80a4c flares
SetObjAngleX(0x8077c, 0x400)     // +90 deg cancels the cloth's -90: floor and everything below sit in world space
if edit: [0x922a8]=malloc(65536); hide flag 0x1000 on the walls 0x808e4; cloth and floor span routines = 0x331b4
else:    [0x922a8] = loadFile("cl_cam1.rec")
PictureIntro(cl_pic = loadFile("cl_pic.raw"))     // 0x28168, §8; ends with cl_pic shown on VGA
free(cl_pic)
pal = cl_pal.col (768 bytes, into a stack buffer by 0x2ceb0); SetPalette(pal)  // 0x11af3: port 0x3c8=0, 768 x outsb to 0x3c9, no vsync wait
w = [0x922b0] = CreateWorld(30, 0x76c, 0xa8c, 0xa8c)
SetCameraPos(w,0,0,0); SetCameraAngles(w,{0,0,0}); CameraMoveLocalZ(w,-500)  // overwritten by the first recorded frame
AddObject(w, 0x80b00); ComputeBounds(w); SetRenderMode(w,3); SetDefaultTargets()   // 0x3a810
```

The intro (§8) runs with whatever palette part 9 left, i.e. `cy_pal.col`. That palette differs from
`cl_pal.col` in 139 of 768 bytes (ramps 3 and 7). `cl_pal` is loaded only after the spin, while
`cl_pic` is already on screen. The visible colour shift is small.

## 3. The cloth simulator (`Cloth`, 0x341c bytes, `new` = 0x3bf94, ctor `0x14390`)

A 16x16 mass-spring grid. All values are float32. Arrays are [row][col] with element (r,c) at
`r*0xc0 + c*0xc`.

| off | type | meaning |
|---|---|---|
| 0x0000 | vec3f[16][16] | `next`: new positions written by a step |
| 0x0c00 | vec3f[16][16] | `pos`: current positions |
| 0x1800 | vec3f[16][16] | `vel` |
| 0x2400 | vec3f[16][16] | `ext`: external force per particle (wind) |
| 0x3000 | int[16][16] | `pinned` (non-zero = fixed) |
| 0x3400 | float | k0: structural stiffness, rest 1 (ctor 1.0) |
| 0x3404 | float | k1: bend stiffness (distance-2 springs, rest 2) (ctor 0.1) |
| 0x3408 | float | k2: shear stiffness (diagonals, rest √2) (ctor 0.1) |
| 0x340c | float | step: scales the acceleration and the velocity (ctor 0.5, part sets 0.99) |
| 0x3410 | float | mass (ctor 3.0, part sets 2.0) |
| 0x3414 | float | gravity added to local +z (ctor 0.0015) |
| 0x3418 | float | drag: velocity damping (ctor 0.025, part sets 0.02) |

Constructor: `pos[r][c] = ((float)(c-8), (float)(r-8), 0)`, vel = ext = 0, pinned = 0.
Accessors: `0x145b4` returns 16 (grid size). `0x14584(cl, c=edx, r=ebx)` returns `&pos[r][c]`.
`0x145cc(cl, c=edx, r=ebx, v=ecx)` sets `pinned[r][c]=v`. `0x145dc(cl,c,r,&vec)` sets `pos[r][c]`.
`0x15814(cl, c=edx, r=ebx, &vec)` sets `ext[r][c]`.

### 3.1 `0x13a60 BuildCloth()`: the heightfield and the mesh
`cl_heigh.raw` holds 256 bytes, a 16x16 grid indexed `[r*16+c]`. It is all 0x20 (space) except rows
4..11, cols 4..11, which are 0x1f.

```
[0x922ac] = cl = new Cloth                       // 0x341c bytes, ctor 0x14390
for r<16, c<16: if (h[r*16+c] != 0x20) {
    pinned[r][c] = 1
    pos[r][c] = (c-8, r-8, (float)((32.0 - h) / 20.0))     // h=0x1f -> 0.05f
}
```
So the central 8x8 block, (r,c) in 4..11, is pinned 0.05 "above" the rest (local +z is down, see
§3.3). The other 192 particles start in the same plane at z=0 and fall around the invisible table.
This is all the heightfield does.

Polygons (`obj+0x14`, 450 = 15·15·2 triangles, 0x30 each, see E1 §1.3). For a in 0..14 (outer), b in
0..14 (inner), with `V(r,c) = r*16+c` and `T(n) = (n*255) >> 4`:
```
tri 1: +0=0, +4=0, +8=-1, verts V(b,a), V(b,a+1), V(b+1,a)
       uv (T(a),T(b)), (T(a+1),T(b)), (T(a),T(b+1))
tri 2: +0=0, +4=0, +8=-1, verts V(b,a+1), V(b+1,a+1), V(b+1,a)
       uv (T(a+1),T(b)), (T(a+1),T(b+1)), (T(a),T(b+1))
then a 451st record with +0 = -1 (terminator used by 0x13df0)
```
The first texture coordinate follows the column, the second the row. Range 0..239 (T(15)=239), so
the last 16 texels of `cl_cloth` in each direction are never used. `+8 = -1` means "no face-normal
index" (E2's meaning).

### 3.2 `0x14730 Step(cl)`: one explicit step (verified bit-exact)
Jacobi style: all forces are computed from `pos` into `next`, then `pos = next`. Every arrow below
is a float32 store, so round to float32 there (`Math.fround`). Intermediates are x87 extended;
modelling them as doubles reproduced the emulator exactly.

```
SPR = { (-1,0,k0,1), (+1,0,k0,1), (0,-1,k0,1), (0,+1,k0,1),          // (dr, dc, k, rest), in this order
        (-2,0,k1,2), (+2,0,k1,2), (0,-2,k1,2), (0,+2,k1,2),
        (-1,-1,k2,R2), (+1,-1,k2,R2), (-1,+1,k2,R2), (+1,+1,k2,R2) }  // R2 = sqrt(2.0) kept as a double
[0x949dc]++
for r in 0..15: for c in 0..15:
    if pinned[r][c]: next[r][c] = pos[r][c]; continue
    next[r][c] = pos[r][c];  F = (0,0,0)
    for (dr,dc,k,rest) in SPR:
        r2=r+dr; c2=c+dc; if (r2,c2) outside 0..15: skip        // 0x14658 returns 0 and d=0
        d   <- pos[r2][c2] - pos[r][c]                          // per component
        len <- sqrt(d.y*d.y + d.x*d.x + d.z*d.z)                // this summation order
        n   <- d / len                                          // per component
        s    = (len - rest) * k                                 // not stored
        F   <- F + (n*s <- )                                    // each product stored, then added and stored
    F <- F + ext[r][c]
    F <- F - (vel*drag <-)
    F <- F / mass
    F.z <- F.z + grav
    F <- F * step
    vel[r][c] <- vel[r][c] + F
    next[r][c] <- next[r][c] + (vel[r][c]*step <-)
pos = next (all 256)
```
Hooke springs pull toward the rest length. Drag acts as a force before the mass divide. The
"step" factor 0.99 multiplies both the acceleration and the velocity used for the position. There is
no collision: the cloth hangs from the pinned block only.

### 3.3 `0x13df0 UpdateCloth(ticks=eax)`: run the sim and refresh the mesh
```
n = (ticks + 1) >> 1                   // sar; ticks=0 -> 0 steps, 1/2 -> 1, 3/4 -> 2, 5 -> 3
repeat n: Step(cl)
for r<16, c<16:                         // vertex index r*16+c
    sum[r*16+c] = (0,0,0)               // 0x93dd8
    p = pos[r][c]
    pts[r*16+c] = ( rnd(p.x*512*0.0625), rnd(p.y*512*0.0625), rnd(p.z*512*0.0625) )
        // = p*32, rounded to nearest-even (x87 default RC; fistp of the double)
for each polygon f (until +0 == -1):
    A,B,C = pts of its 3 vertices (ints);  e1 = B-A, e2 = C-A  (int → float32)
    N = e1 × e2   (Nx = e1y*e2z - e1z*e2y, Ny = e1z*e2x - e1x*e2z, Nz = e1x*e2y - e1y*e2x, stored float32)
    fnf[f] = N (0x928b4);  fn[f] = (rnd(Nx*255), rnd(Ny*255), rnd(Nz*255))   // NOT normalised (~|N|=1024*255)
for each polygon f: for each of its 3 vertices v: sum[v] <- sum[v] + fnf[f]   (float32, component-wise)
for v = 255 down to 0:
    L = sqrt(sum.y^2 + sum.x^2 + sum.z^2);  q = sum / L  (all three stored back into sum as float32)
    cn[v] = (rnd(qx_ext*255), rnd(q.y*255), rnd(q.z*255))   // x uses the unrounded extended quotient,
                                                            // y and z are reloaded from the float32 store
ComputeObjBounds(0x80b00)               // 0x3c18c (E1)
```
Mesh units: grid spacing 1.0 becomes 32 int units, so the cloth spans x,y in -256..224. The pinned
block is at z = rnd(1.6) = 2. In the scene the cloth object carries `AngleX = 0xfc00` (−90°). With
E1's RotX (`y' = c·y − s·z, z' = s·y + c·z`, s=−1) the mapping is `world = (x, z, −y)`. Local +z
(gravity) therefore becomes world +y, toward the floor at y=180. Local −y (grid row 0) becomes +z.
The pinned table top is at world y≈2, about 178 units above the floor. Hanging edges reach about
128 units below it.

## 4. Static scene objects (data segment, Object layout per E1 §3.1, K = identity)

| obj | pts (addr) | polys (addr) | flags +0x84 | material | role |
|---|---|---|---|---|---|
| 0x80b00 | 256 (alloc) | 450 (alloc) | 0x246 | 0x92848 | cloth |
| 0x8077c | 9 (0x8047c) | 8 (0x923c8, built) | 0x440 | 0x922d8 | octagonal floor |
| 0x80830 | 3 (0x80548) | 1 (0x8056c) | 0x446 | 0x92338 | shadow receiver plane (sets the plane, draws nothing) |
| 0x80998 | 1 (0x80470) | 1 (0x805cc) | 0x4c4 | 0x92368 | light point (sets the light position, draws nothing) |
| 0x808e4 | 17 (0x8047c) | 16 (0x92548, built) | 0x440 | 0x92308 | octagonal walls |
| 0x80a4c | 6 (0x80428) | 6 (0x8062c) | 0x88c | 0x92398 | 6 flare sprites |

Point data (int domain):
```
0x8047c room: 0:(0,180,0)
  floor ring 1..8: (-400,180,-800) (400,180,-800) (800,180,-400) (800,180,400)
                   (400,180,800) (-400,180,800) (-800,180,400) (-800,180,-400)
  top ring 9..16: the same x,z at y=-350
0x80548 plane: (-3000,180,-3000) (3000,180,-3000) (0,180,5000)   poly: +0=0, verts 0,2,1, uv all 0
0x80470 light: (0,-500,0)                                          poly: +0=1, verts 0,0,0
0x80428 flares: (-350,-80,-700) (350,-80,-700) (700,-80,0) (350,-80,700) (-350,-80,700) (-700,-80,0)
                                                                   poly i: +0=1, verts i,i,i
```
Polygon `+0 = 1` marks point sprites/markers. In `.eob` files it is always 0.

`0x12f00 InitFloorPolys(obj)`. For k in 0..7, polygon k gets: +0=0, +4=0, +8=-1, verts
`0, k+1, ((k+1)&7)+1`. UVs: centre (128,128). Each ring vertex P gets
`((P.x+800)*4/25, (P.z+800)*4/25)` (signed idiv). Values are 0, 64, 192 and **256** (for x or z =
800). Texture wrap/clamp of 256 is E2's.

`0x12fd4 InitWallPolys(obj)`. For segment k in 0..7, with `n=(k+1)&7`, `u0 = (k&1) ? 128 : 0`:
```
poly 2k  : verts k+1, k+9, n+9   uv (u0,0), (u0,127), (u0+127,127)
poly 2k+1: verts k+1, n+9, n+1   uv (u0,0), (u0+127,127), (u0+127,127)    // sic: bottom-right gets v=127, not 0
```
(+0=0, +4=0, +8=-1.) Even segments use texels u 0..127 and odd segments 128..255, rows 0..127. The
second triangle's degenerate v is in the original and must be kept for a pixel-exact port.

Hierarchy and transforms: everything below the floor inherits `Rx(−90°)·Rx(+90°) = I`, so all
non-cloth points are world coordinates. The only animated transform is the flares'
`AngleY = (short)(−5·elapsed)` (4096/turn, so 0.0855 turn/s clockwise seen from above). The flares
ride a ring of radius 700–783 at y=−80.

Span routines, all E2's (named by behaviour from a short read):
- `0x33170` (cloth) = `0x328a0` then `0x35860`. `0x328a0` projects the triangle from the light point
  (`[0x106310..18]`) onto the plane (`[0x1062f0..0x106308]`) and darkens the covered back-buffer
  pixels through `L` row 0 (`p = L[p]`, i.e. 0x40..0x7f become 0, others unchanged). That draws the
  black shadow on the floor. The span loop writes `count+1` pixels (`dec ecx; jge`). Then `0x35860`
  draws the textured triangle with the env map `[0x922bc]` (indexed by corner normals) through `L`.
- `0x36890` (floor, walls): textured triangle.
- `0x32788` (plane): computes the plane equation of its triangle into `0x1062f0` (n.x, n.y, n.z as
  doubles, and d at `0x106308`). It draws nothing.
- `0x32714` (light): stores the transformed point (`+0`,`+4`,`+8` of the vertex record) into
  `0x106310/14/18`. It draws nothing.
- `0x31b64` (flares): for a projected point with z>50, half-size `h = (0x10000/z) >> [mat+0x28](=1)`,
  texel step `0x4000/(2h)` (8.8). It draws the 64x64 `su_star` (values 0x40..0x7f) over the square
  `[x-h, x+h) × [y-h, y+h)` clipped to the screen, as `p = L[star*256 + p]`, i.e. an additive glow (§6).
- `0x331b4`: edit-mode only (flat/wire).

## 5. Run `0x1366c(endIdx=0xc)`: main loop

```
UpdateCloth(1)                                   // one step before anything is drawn
while (SyncIdx() <= endIdx) EscCheck();          // 0x12204 / 0x122b8: wait for sync point 12 = (pos 17,row 0)
ResyncFrames();                                  // 0x121d4: [0x91260] = row*49/5
start = [0x91260];  idx = SyncIdx();  elapsed = 0;  acc = 0;  wt = 0.0f
while (idx <= endIdx+1) {                        // until sync point 13 = (pos 21,row 0) is passed
    dt      = [0x91260] - elapsed - start        // ticks since the previous iteration
    elapsed = [0x91260] - start
    acc += 0x4600;  idx = SyncIdx();  EscCheck2(acc / max(elapsed,1))   // 0x122f0: ESC only, arg unused
    [0x9229c] = elapsed
    PlayCamera(w, &rec)                          // 0x2789c, E1 §5.1: rec[elapsed] -> SetCameraPos + SetCameraAngles
    if (elapsed > 90) UpdateCloth(dt)            // the cloth hangs still for the first 1.28 s
    SetObjAngleY(0x80a4c, (short)(-elapsed*5))   // flares
    RenderWorld(w)                               // into back buffer 0xe4d40
    rows = [0x91264];  word = rows >> 4;  sh = (rows & 15) - 2;  if (sh <= 0) sh = 0
    if (word == 3 || word == 4 || word == 5)     // 3 vectors, 4 burns, 5 flesh  ([0x922bc + word*4])
        shadeShifted(src = wordpic+0x300, dst = backbuf, cl = sh, ch = 0x40)     // 0x119e0, §6
    copy backbuf -> VGA (64000 bytes), clearing backbuf to 0 as it goes
    if ([0x922d4] == 1) {                        // wind for the NEXT step: four corner particles, local z only
        ext[0][0]   = (0,0, f(sin(wt*1.4)*0.06))
        ext[0][15]  = (0,0, f(sin(wt*1.3)*0.04))
        ext[15][0]  = (0,0, f(sin(wt*1.9)*0.04))
        ext[15][15] = (0,0, f(sin(wt    )*0.06))
    }
    wt = f(elapsed * 0.02)                       // float32
}
if edit: save the recording ("cl_cam1.rec" via 0x27874)
free(rec)
FallAway(endIdx = 0xd+2 = 0xf, vx=0, vy=-2, vz=0, ax=15, ay=0, az=0)   // 0x28038, §8.2
clear VGA (64000) and back buffer (65536);  delete cl            // 0x11a5f, 0x3bf88
```
- **Time base.** `[0x91260]` counts 70.086 Hz ticks. `[0x91264] = [0x91260]*5/49` counts music rows
  (0.14 s each). Both are re-based by `ResyncFrames` to the row at which the wait loop exited. That is
  row 0 of pattern 17 in practice, so `rows` = rows since the main loop started (patterns are 32 rows,
  4 of them = 17.9 s).
- **Camera.** It comes from `cl_cam1.rec` (1823 records, E1 §5.1), index = elapsed ticks. The index
  is never clamped, and about 1257 ticks are used. There is no interpolation. Frame 0 is
  pos (0,−369,−13), angles (3095,0,0): above the room, looking straight down at the flat cloth.
- **Sim rate depends on frame rate.** Steps per iteration are `(dt+1)>>1`. At one iteration per tick
  that gives 70 steps/s. In the capture an iteration takes about 4–5 ticks (frames repeat 4–5 times),
  which gives 2–3 steps per iteration, about 35–42 steps/s. So the cloth in the capture falls at about
  half the speed a fast PC would show. To match the capture, run the loop at about 14 Hz with dt≈5,
  or step `(dt+1)>>1` per rendered frame with the real dt. Camera, flares, wind phase and overlays
  depend only on ticks.
- **Wind.** Only the four corners are pushed, along local z (world vertical), with the
  previous iteration's `wt`. On the first iteration `wt=0`, so all are 0.
- **End.** The loop exits on the first iteration that sees sync point 13. That iteration is still
  fully drawn.

### Word overlays
`vectors.raw`, `burns.raw`, `flesh.raw` are full-screen 320x200 images. The text sits at
(19..232, 20..188), (9..265, 12..178) and (11..281, 17..153), with a typewriter-text background.
Pixels are 0..31, stored doubled (0..62). Rows 48–63 since the start show "vectors", 64–79 "burn",
80–95 "flesh". In capture time that is 236.27, 238.51 and 240.75 s, verified: "vectors" first
appears between 236.2 and 236.3. Within each 16-row window the shift is 0 for rows 0–2, then
1, 2, 3, … per row (0.14 s each):
```
dst[i] = L[ ((src2[i] >> sh) + 0x40) * 256 + dst[i] ]      for i < 64000     (0x119e0)
```
A value of 62 is gone after shift 6, so a word is visible for about 9 rows (1.26 s): 3 rows at full
strength, then decaying.

## 6. The blend table `L = 0xfd0a0` as part 10 sees it

Part 10 writes only row 0. Rows 1..127 are left over from **part 9's init** (`0x1e420`, called at
0x1f50e as the last table write before part 10), which fills rows 0..127:
```
for s in 0..127: for c in 0..255:
    k = c >> 5; j = c & 31                               // palette = 8 ramps of 32 colours
    add = (k < 3) ? (s >> 2) - 16 : (s / 3) - 21         // s/3 truncated
    L[s*256 + c] = 32*k + clamp(j + add, 0, 31)
```
(Each case of the 8-way jump table at 0x1e400 is `clamp(var,0,31) + 32k`. The variables are
`s/4 - 0x10 - 32k + c` for k=0..2 and `s/3 - 0x15 - 32k + c` for k=3..7, so the formula above is
exact.) Rows 0x40..0x7e brighten each colour within its ramp by `(s-64)>>2` for ramps 0–2 and by
`floor(s/3)-21` for ramps 3–7 (0 at s=64, saturating at the ramp top). The word overlay (rows
0x40..0x7e) and the flares (rows 0x40..0x7f) are additive glows. Row 0, overwritten by part 10 in
init, is the shadow row: identity, except colours 0x40..0x7f map to 0. The cloth/env-map filler
(`0x35860`, `L` from material +0x0c, env 0x30..0x7f) also indexes rows 0x30..0x7f; how it forms the
row/column is E2's. A port must rebuild this table in part 10's init, or keep part 9's, because
part 10 does not build rows 1..127 itself.

`cl_pal.col` ramps (6-bit RGB at j=0/16/31): 0 grey (0,0,0)→(34,32,32)→(63,63,63); 1 pinkish
(5,0,4)→(52,33,32)→white; 2 mauve grey; 3 warm grey; 4 gold (6,6,0)→(51,37,0)→white; 5 brown→(63,53,47);
6 grey; 7 dark red (0,0,0)→(3,1,0)→(54,3,0).

## 7. Deinit `0x139fc`
`free(su_star); FreeArrays(0x80b00)` (0x24564), `DestroyWorld([0x922b0])`, then free cl_cloth,
cl_walls, cl_floor, vectors, burns, flesh, and the env map `[0x922bc]`. The screen is already black
(run cleared it).

## 8. Transitions (shared demo helpers; the quad world is `0x27cac`, see P0 §8)

`0x27cac(withBack)` grabs the current VGA screen into a 256x256 texture `[0xe3cf4]` (scale `0x1d1a0`).
It creates a world `[0xe3cf0]` with the quad `0x835b8`: points (±160, ±100, 0); polys (0,1,2) and
(1,3,2); uv (0,0),(255,0),(0,255),(255,255) for points 0..3; material 0xe2c90 = grab, span 0x36890.
The camera is at angles 0, `CameraMoveLocalZ(-256)`, so the quad exactly fills the screen.
Back buffer = 0xe4d40.

If `withBack`, three more things happen. The quad's child is set to `0x8366c`: same points,
reversed winding (0,2,1),(1,2,3), same per-vertex uv, material 0xe2cc0 = `[0x83464]`, span 0x36890.
`ClearFlags(quad tree, 4)` runs: flags 0xc4→0xc0. Probably this enables back-face culling, so each side shows only from its own side (guess; E2). That clear is
permanent, because the objects are static data.

### 8.1 `0x28168 PictureIntro(pic)`: 225.4–229.05 s
```
[0x83464] = malloc(65536); scale(320x200 pic -> 256x256)      // the back face
QuadWorld(1)                                                  // front = grab of part 9's last frame
t0 = [0x91260]
do {
    t = [0x91260] - t0
    SetObjPos(quad, 0, 0, 4*S[t & 511])        // S = sine table 0x9025c (M §3.2, peak 257): z 0 -> 1028 (t=128) -> 0 (t=256)
    SetObjAngleX(quad, (short)(t*24))          // 4096/turn: 1.5 turns over the intro
    SetObjAngleZ(quad, (short)(t*16))          // exactly 1 turn
    RenderWorld([0xe3cf0]); copy backbuf -> VGA, clear backbuf; EscCheck()
} while (t < 256)                              // the last frame drawn has t >= 256, i.e. z≈0 and both angles ≈ whole turns
copy pic (64000 bytes) -> VGA                  // 0x11d43: the flat cl_pic
free([0xe3cf4]); free([0x83464]); DestroyWorld([0xe3cf0])
```
The loop does not wait for a tick and renders as fast as possible. The capture shows one distinct
frame per tick during the spin.

### 8.2 `0x28038 FallAway(endIdx, vx=edx, vy=ebx, vz=ecx, stack: ax, ay, az)`: 247.5–249.2 s
Part 10 calls it with (0xf, 0, −2, 0, 15, 0, 0).
```
QuadWorld(0)                       // grab of the final room frame (overlays are not active then)
t0 = [0x91260]
while (SyncIdx() <= endIdx) {      // until sync point 15 = (pos 21,row 12)
    t = [0x91260] - t0
    SetObjPos(quad, vx*t, vy*t, vz*t)                       // (0, -2t, 0)
    SetObjAngleX/Y/Z(quad, (short)(ax*t), (short)(ay*t), (short)(az*t))   // X: 15/tick
    RenderWorld; copy backbuf -> VGA, clear; EscCheck()
}
free([0xe3cf4]); free([0x83464]) /* already freed by the intro: double free */; DestroyWorld
```
The grab slides down the screen and tilts away. It is edge-on after 1024/15 ≈ 68 ticks
(capture 248.45). From then on the front face is culled. The child `0x8366c` is still linked from
the intro, and its texture pointer `[0x83464]` is the intro's freed buffer. Its back face would
become visible after 68 ticks, but in the capture nothing shows: the screen is black from 248.5
until part 11. A port should draw nothing after the quad turns edge-on.

## 9. Porting checklist
1. Init: load files, double the word pixels, remap su_star, build the env map (radial 0x30..0x7f, pow
   exponent 1), set `L` rows 0..127 as in §6, build cloth (§3.1), floor and wall polys (§4).
2. Intro: grab the previous frame and spin it with `cl_pic` on the back for 256 ticks, using the
   previous palette. Then show `cl_pic` and set `cl_pal`. Wait for sync point 12.
3. Main loop per iteration: camera from rec[elapsed]; sim `(dt+1)>>1` steps if elapsed>90; mesh +
   normals; flares' AngleY = −5·elapsed; render (shadow → cloth; floor, walls, flares as E2 sorts
   them); word overlay; present; clear; set wind.
4. Outro: grab, slide/tilt for 68 ticks, then black until sync point 15.

## Open questions
- Exactly how `0x35860` indexes the env map with the corner normals and how it forms the `L` row
  from env value and texel (E2). Likewise the draw order of the shadow-plane, light and flare callbacks
  inside E2's sort. That decides whether the shadow uses this frame's light/plane or the previous
  one's (they are static here, so it only matters for the first frame).
- The floor UV value 256 at ring vertices with |x| or |z| = 800 (wrap vs clamp in `0x36890`).
- The overlay timing assumes the wait loop exits at row 0. A slow machine could exit a row late, and
  `ResyncFrames` would then shift all rows by one.
