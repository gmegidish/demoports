# P0 — Intro part 0: the spider in the cave (init 0x21674, run 0x20b8c(0), deinit 0x21604)

Capture: `demo.avi` 4.68 s (first non-black frame) .. 24.6 s (main loop) .. 25.7 s (fly-away
transition) .. black (deinit clears VGA) .. part 1 at ~27 s.

What you see: a brown cave (floor + walls, depth-cued), a walking textured spider with a hard black
shadow, a spotlight that switches on at the start of song position 1 (a visible light cone plus a
bright disc on the floor that follows the light), small text "robotnik" / "rage 1997" / "punish your
machine" at the screen edges. At position 2 row 0x1c a "RAGE" cube drops on the spider: blood on the
floor. Finally the last frame is mapped onto a quad that tumbles away.

Notation: `T[row][col]` = the 64 KB table at `0xfd0a0` (row*256+col) built by `0x209a0`.
`B` = back buffer `0xe4d40` (320x200, `[0x89dcc]`), VGA = `0xa0000`.
All engine names/semantics (SetObjPos, RenderWorld, ...) are from `E1_engine_data.md`.

---------------------------------------------------------------------------------------------------

## 1. Palette and the blend table

`sp_pal.col` (768 bytes, 6-bit) is uploaded once in init with `0x11af3` (out 0x3c8/0x3c9, 768 bytes) —
**no fade in or out** in this part. Layout:
- 0..127: brown ramp, black → (63,38,27) — used by the **spider** (its shade tables are 0..127).
- 128..254: second brown ramp, black → near-white (58,57,57) — used by **the cave** (floor/walls) and
  the cube texture.
- 255: dark red (21,2,6) — **blood**.

`0x209a0 BuildBlendTable()` fills rows 0..127 of `T` (rows 128..255 stay 0 = bss):
```
for c in 0..127:  T[0][c] = c                                    // row 0, low half = identity
for s in 1..127:  for c in 0..127:
      v = c + s - 64;  T[s][c] = (s <= 64) ? max(v,0) : min(v,127)
for s in 0..127:  for c in 128..254:
      T[s][c] = (s <= 64) ? max(c - 2*(64-s), 128) : min(c + (s-64), 254)
for s in 0..127:  T[s][255] = 255
```
So row 64 = identity, rows > 64 brighten (+1/step), rows < 64 darken (low half -1/step, high half
-2/step). Row 0 maps every cave colour (128..254) to 128 (black) and leaves spider colours and blood
alone — this is the shadow row. (Verified by running 0x209a0 in unicorn.)

Uses of T in this part: cave rasterizer depth cue (row from depth), light cone (row = cone texel),
text (row = font texel), shadow (row 0).

---------------------------------------------------------------------------------------------------

## 2. Init `0x21674(mode)`

`mode` (eax, from the command line; 0 in a normal run): 1 → `[0x820e8]=1` record spider.rec,
2 → `[0x820e4]=1` record light.rec, 3 → `[0x820ec]=1` record camera (interactive). Record modes are
developer-only; this document describes mode 0 (playback), with notes where the code differs.

Steps in order:
1. Link the static cave objects: `[0xdf884]=0x82a74` (floor), `0x82a74.next=0x82b28` (walls),
   `0x82b28.next=0x82bdc` (shadow-plane triangle); `[0xdf888]=0x83080` (light/cone),
   `[0xdf86c]=0x82f60` (RAGE cube; `byte[0x82fe5] |= 0x10` = flag 0x1000 hidden),
   `[0xdf890]=0x831a0` (floor-spot marker).
2. Load: `shade.raw`→`[0xdf878]`, `[0xdf88c]=malloc(64K)`, `sp_star.raw`→`[0xdf874]`,
   `sp_blod.raw`→`[0xdf868]`, `sp_ray.raw`→`[0xdf870]`, `sp_pic1.raw`→`[0xdf87c]`.
3. `star[i] >>= 1` for i<4096 (0..127 → 0..63). `shade[i] = (shade[i]>>1) + 0x80` for i<65536
   (raw 2..67 → 0x81..0xa1). Copy the converted shade map to `[0xdf88c]` (`0x11d43` = memcpy edi←esi).
4. `[0x89ec0]=0`; spider = `LoadObject("spider.eob")` → `[0xdf894]`.
5. `w = CreateWorld(30, 0x76c, 0xa8c, 0xa8c)` → `[0xdf880]`.
6. Runtime materials (bss, 0x30 each; only these fields are set; +0x10 texture, +0x14 aux, +0x28 shift,
   +0x2c per-polygon routine):

| material | used by | +0x10 | +0x14 | +0x28 | +0x2c |
|---|---|---|---|---|---|
| 0xde740 | floor-spot marker 0x831a0 | – | – | 0 | 0x3274c (record screen pos) |
| 0xde770 | walls 0x82b28 | `[0xdf88c]` (copy of shade map) | star | 1 | 0x38440 (perspective tex + depth cue) |
| 0xde7a0 | floor 0x82a74 | `[0xdf878]` (shade map, gets the light) | star | 1 | 0x38440 |
| 0xde7d0 | plane triangle 0x82bdc | – | – | 0 | 0x32788 (store plane equation) |
| 0xde800 | cube 0x82f60 | sp_pic1 (256x32) | – | 0 | 0x36890 (E2 texture mapper) |
| 0xde830 | light 0x83080 | sp_ray (256x64) | – | 0 | 0x32714 (record light pos); 0x31d14 from sync 2 on |

   Spider: `0x246d0(spider, 0x3315c)` — every spider material's routine becomes
   `0x3315c(poly) { 0x328a0(poly) /*shadow*/; 0x2c118(poly) /*normal spider span routine*/ }`.
7. Positions/angles: floor `SetObjPos(0,0,0)`, angles 0. Light `SetObjPos(800,1000,0)`.
   Cube `(0,6000,0)`. Marker `(0,6000,0)`. Spider `(0,0,0)`, `SetObjAngleX(0xc00)` (stands the model
   up), Y=Z=0.
8. `AddObject(w, spider, floor-chain(0x82a74), light, cube, marker)` in that call order;
   `ScalePoints(spider,1)` twice, `ScaleKeys(spider,1)`; `ComputeBounds`; `SetRenderMode(w,3)`.
9. `[0x89dcc]=0xe4d40`, `[0x106b58]=0xa0000`; `0x209a0` (table §1); palette; font:
   `0x1dcd0("font.raw", add=0x40, shift=1)` (each byte `b = (b<<1)+0x40`, then a 2x2-averaged 11-wide
   copy `(a+b+c+d+2)>>2` — M_main_support.md).
10. Recordings (whole files, see E1 §5.2): `spider.rec`→`[0xde73c]`, `camera.rec`→`[0xde71c]`,
    `light.rec`→`[0xde72c]` (in a record mode the respective one is a zeroed 4 KB buffer).

### Static scene (int world units; y up)

- Floor 0x82a74: 9 points on a 3x3 grid at y=-100, x,z ∈ {-6000,0,6000} (point 1 is (600,-100,-6000) —
  a quirk), 8 triangles, UV 0..255 → the 256x256 shade map.
- Walls 0x82b28: 24 points (same floor ring, wall tops at y=800, apex (0,3000,0), a corridor x ∈
  ±600 running from z=-6000 to z=-10000), 32 triangles, UV u 0..255, v 0..63 on the walls' copy of the
  shade map.
- Plane triangle 0x82bdc: (-7000,-100,-7000), (7000,-100,-7000), (0,-100,10000); polygon (0,2,1).
  Never drawn; its routine only computes the floor plane (§5).
- Light 0x83080: one point (0,500,0), one 1-vertex polygon (flags 0x8c6).
- Marker 0x831a0: one point (0,0,0), one 1-vertex polygon (flags 0xc6).
- Cube 0x82f60: box x 0..1400, y 0..1000, z 0..1000, 12 triangles, UV (0..63, 0..31) → the left 64x32
  of sp_pic1 = the "RAGE" logo on every face (flags 0xa, hidden until it falls).

Polygon record (0x30): `+0x0c,+0x10,+0x14` vertex indices, `+0x18..+0x2c` u0,v0,u1,v1,u2,v2 (E1 §1.3).

Textures (dumped to PNG to check): shade.raw = dark streaky rock (also the walls); sp_star = soft
disc, 127 in the middle; sp_blod = 0/255 splat; sp_ray = 64x64 triangular soft cone in its top-left
corner on a flat 64 background (64 = neutral row of T), rest 64; sp_pic1 = 256x32 rock with "RAGE".

---------------------------------------------------------------------------------------------------

## 3. Run `0x20b8c(startIdx=0)` — frame loop

Sync table at `0x80058` (16-byte entries `{pos,row,...}`, E1/M). `0x12204` returns the number of
entries already passed: ≥1 at (0,0x20), 2 at (1,0), 3 at (2,0x1c), 4 at (2,0x2e), 5 at (2,0x38).
pullmax.xm: speed 7, BPM 125, 64-row patterns → 0.14 s/row. With the music starting ~0.2 s after
capture T=0 these are T ≈ 4.68, 9.16, 22.04, 24.56, 25.68 s — matching the capture.

Locals: `ang` (spider rotation, init 0), `cam[4]` = {0,0,0,0x251c} (camera state at esp+0x90), `cubeY`
= 3000, `blood` = 0, `L` = light spot (x,y), `animT` = 0, `animLen` = `AnimLength(spider)` (=30<<8).
Players: camera acc/idx/frac `[0xde710/14/18]`, light `[0xde720/24/28]`, spider `[0xde730/34/38]`, all 0.
Camera quadratics built from (rec[0],rec[0],rec[1]) (E1 §5.2).

```
while (SyncIdx() == 0) EscCheck();            // busy wait, part begins at sync 1
t0 = [0x91260]; prevElapsed = 0; frames = 0
idx = SyncIdx(); if (idx > 3) goto done
do {
  prev = idx; idx = SyncIdx()
  if (prev == 1 && idx == 2) {                  // spotlight switches on
      0x456a4(0xa0, 0x64)                       // see note (*)
      lightMat(0xde830).routine = 0x31d14       // cone renderer
      light player acc/idx/frac = 0;  L = (light.rec[0].x, light.rec[0].y)
  }
  EscCheck()                                    // 0x122b8: ESC → restore text mode, "killed.", exit
  elapsed = [0x91260] - t0;  dt = elapsed - prevElapsed;  prevElapsed = elapsed;  frames++

  // spider (spider.rec, linear, E1 §5.2)
  s = lerp16(spiderRec, idx_s, frac_s)          // {angle, x, z, speed}
  SetObjAngleY(spider, (short)((0x100 - s.angle) << 3))     // rec angle: 512/turn
  SetObjPos(spider, s.x, 0, s.z)

  if (idx >= 2) {                               // light active
      v = lerp16(lightRec, idx_l, frac_l)
      L.x = (L.x + v.x) >> 1;  L.y = (L.y + v.y) >> 1      // arithmetic shifts
      if (blood == 0)      LightStamp(star, floorMap, L.x, 0xe4 - L.y)    // 0x317f8
      else if (blood == 1) { BloodStamp(blood.raw, floorMap, L.x, 0xe4 - L.y); blood = 2 }  // 0x31934
      SetObjPos(light,  (L.x<<4) - 0x800, 1000, (0x80 - L.y) << 4)
      SetObjPos(marker, (L.x - 0x80)*0x27, -100, (0x60 - L.y)*0x27)
  }
  if (idx >= 3) {                               // the cube falls
      cubeY -= dt*80
      if (cubeY < -100) { cubeY = -100; if (blood == 0) blood = 1 }
      P = GetObjPos(spider)
      SetObjPos(cube, P.x - 600, cubeY, P.z - 400);  cube.flags &= ~0x1000   // visible
  }
  animT += s.speed * 200                        // per iteration, NOT scaled by dt
  wrap animT into [0, animLen);  AnimateTree(spider, animT)
  OrbitCamera(cam, spider, w)                   // 0x26e1c, E1 §5.2 (uses frac_c of last iteration)
  RenderWorld(w)                                // into B
  smallText("robotnik",            2,   2, B)
  smallText("rage 1997",         225,   2, B)
  smallText("punish your machine",125, 190, B)
  copy B → VGA (64000 bytes), clear B to 0       // no vsync wait, renders as fast as it can
  advance light, spider, camera players by dt (acc += dt; while acc>=16 {idx++; acc-=16; (camera:
      rebuild quadratics from rec[idx-1..idx+1])}; frac = acc & 15)
} while (idx <= 3)
done:
elapsed = [0x91260] - t0
free the three .rec buffers
FlyAway(endIdx = 4)                             // 0x27e28, §8
return frames*17920/elapsed                     // average fps*256, unused
```
(*) `0x456a4(x=0xa0, y=0x64)` = mouse driver "set cursor position" (INT 33h fn 4 via 0x455a0, only if a
mouse is present `[0x8a050]`); `0x456c4`/`0x456f0` = mouse x/y (fn 3). Only the light recorder uses
the mouse — no visible effect, skip in a port.

`lerp16(rec, i, f)` = per channel `(rec[i].c*(16-f) + rec[i+1].c*f) >> 4`.

Record-mode differences (dev only): light mode reads `L` from the mouse; spider mode drives the
spider from the keyboard table at 0x118a9.. and sin/cos tables `0x11a70`/`0x11a7d` (512 entries);
camera mode uses the interactive `0x250d0` instead of `0x26e1c`; each mode appends to its buffer with
`0x26dd0` every 16 ticks and writes the file (`0x1e174`) at the end.

**Frame pacing.** The loop never waits for a tick, so the rendered rate depends on CPU speed. In the
capture it is ~26–33 distinct frames/s (dt mostly 2 or 3 ticks). Recordings and the cube fall are
dt-based; the spider's walk cycle is per rendered frame (`speed*200` per frame; speed is 0 or 2 →
one 7680-unit cycle every ~19 frames ≈ 0.6 s at 30 fps). A port should render at ~30 fps with
dt = ticks since previous frame, or advance `animT` by `speed*200*dt/2.33` to stay frame-rate
independent.

---------------------------------------------------------------------------------------------------

## 4. Floor light and blood (`0x317f8`, `0x31934`)

Both write into the floor's 256x256 shade map (`floorMat.+0x10`, which is the floor texture itself —
values are palette indices 128..255).

`0x317f8 LightStamp(src=eax 64x64, dst=edx 256x256, x=ebx, y=ecx)` (last position in
`[0x84c78]/[0x84c7c]`, initially -1000/-1000 = "none"):
```
if (lastX != -1000)                      // remove the previous stamp
   for r in 0..63: Y = lastY-32+r; if 0<=Y<256: for c in 0..63: X = lastX-32+c; if 0<=X<256:
        dst[Y*256+X] -= src[r*64+c]      // byte arithmetic
for r in 0..63: Y = y-32+r; if 0<=Y<256: for c in 0..63: X = x-32+c; if 0<=X<256:
        dst[Y*256+X] += src[r*64+c]
lastX = x; lastY = y
```
star ≤ 63 and the map ≤ 0xa1, so no wrap: the spot raises the floor colour by up to 63 levels.

`0x31934 BloodStamp(src=eax, dst=edx, x=ebx, y=ecx)`: same 64x64 window (clipped) but
`if (src[r*64+c] == 0xff) dst[...] = 0xff`. Called once (the iteration after the cube lands).
After that `LightStamp` is never called again: the last light disc stays baked into the floor
under the blood, and the cone keeps following `L`.

Mapping: floor texel (u,v) = (L.x, 0xe4 - L.y). The 3D light is placed at
((L.x-128)*16, 1000(+500 point offset), (128-L.y)*16) and the marker on the floor at
((L.x-128)*39, -100, (96-L.y)*39); these constants are hand-tuned, copy them as is.

---------------------------------------------------------------------------------------------------

## 5. Per-polygon routines of this part (called by the engine's draw loop, `call [mat+0x2c]` at
0x3de82.., with eax = the projected polygon record: `+4` nverts, `+8 + 0x18*k` = vertex index of
corner k; vertex buffer `[0x89dd0]`, 36 bytes per vertex: `+0,+4,+8` camera-space x,y,z (int),
`+0x18,+0x1c` screen x,y)

Order dependency: these routines communicate through globals, so they rely on the engine's draw
order within a frame: the plane triangle (0x32788) and the light (0x32714/0x31d14) must run before
the spider polygons, and the marker (0x3274c) before the light. In the original this follows from
E2's sorting; a port can simply do it explicitly: plane → marker → (cave) → light cone → spider.
Otherwise the values from the previous frame are used (one-frame lag, barely visible).

### 0x32788 PlanePrep (plane triangle 0x82bdc)
With the camera-space corners v0, v1, v2 (polygon order): `n = (v1-v0) × (v2-v0)` (doubles,
unnormalised) → `[0x1062f0],[0x1062f8],[0x106300]`; `D = -(n·v1)` → `[0x106308]` (verified in
unicorn). It is just the floor plane y = -100 in camera space; a port can use the world plane
directly (the shadow formula is scale-invariant in n,D). Draws nothing.

### 0x3274c MarkerPos (marker 0x831a0)
`[0x10631c] = V.sx, [0x106320] = V.sy, [0x106324] = V.z` of its single vertex. Draws nothing.

### 0x32714 LightPos (light 0x83080, before sync 2)
`[0x106310],[0x106314],[0x106318] = V.x, V.y, V.z` (camera space). Draws nothing. So the spider
already casts a shadow from the light at world (800, 1500, 0) before the spotlight appears.

### 0x31d14 LightCone (light 0x83080, from sync 2 on)
```
A = (V.sx, V.sy) of the light's vertex;  z = V.z
if (mat.+0x28 == 1 || z <= 0) skip drawing
d = (marker.sx - A.x, marker.sy - A.y)                         // [0x10631c],[0x106320]
P1 = A + ((928*d.x - 432*d.y) >> 10,  (432*d.x + 928*d.y) >> 10)   // d rotated +25°, |.|≈1
P2 = A + ((928*d.x + 432*d.y) >> 10,  (928*d.y - 432*d.x) >> 10)   // d rotated -25°
UV (8.8): A (2,2), P1 (63,2), P2 (2,63)
fill triangle (A,P1,P2) with affine UV; per pixel  B[p] = T[ ray[v*256 + u] ][ B[p] ]
then [0x106310..18] = V.x, V.y, V.z                            // also feeds the shadow
```
(sar = arithmetic shifts; verified in unicorn.) The texel is 64 (neutral) outside the cone shape and
up to 124 inside, so the cone brightens what is already drawn by up to +60 levels, saturating at
127 (spider colours) / 254 (cave colours). Spans go through `0x4fd3b`/`0x4fd6b`
(left-to-right / right-to-left variants), same 16.16 edge walking as the shadow below.

### 0x3315c → 0x328a0 Shadow (every spider polygon, then 0x2c118 draws the polygon itself)
Projects the triangle from the light point `Lc` = `[0x106310..18]` (camera space) onto the plane
(n, D), then fills it darkening the frame buffer:
```
for each corner V (camera space):
    t = -(n·Lc + D) / (n·(V - Lc));   S = Lc + (V - Lc)*t
    sx = round(S.x*256/S.z) + 160;    sy = 100 - round(S.y*256/S.z)      // FPU round-to-nearest
sort by sy; skip if top sy >= 201 or bottom < 0
flat fill rows y in [ytop, ybottom) ∩ [0,200), x edges in 16.16 from vertex x<<16;
span pixels xl..xr inclusive, clipped to 0..319:   B[p] = T[0][B[p]]
```
(the formula matches the code to the pixel on random inputs in unicorn; focal 256 and centre
(160,100) are hard-coded here, the engine itself uses 159/99.) `T[0]` turns every cave colour into
128 (black) and leaves spider colours and blood untouched, so the shadow is a hard black silhouette
only on the floor/walls; overlapping triangles are idempotent. Shadows also fall on the walls'
pixels behind the floor plane projection (it is a screen-space darken).

### 0x38440 cave rasterizer (floor and walls) — E2 owns the details
Perspective-correct texture mapping (1/z interpolation, exact divide every 16 pixels, inner loop
`0x4fb6f`): `B[p] = T[row][ tex[(v&0xff)*256 + (u&0xff)] ]`, with
`row = high byte of (0x7fff - (z << mat.+0x28))` interpolated linearly over each 16-pixel run
(z = camera depth, shift = 1 here). So near floor is brightened (row up to 127), depth ≈ 8192 is
neutral, ≈ 16384 black, and beyond that the row wraps into ≥128 = all-zero rows → colour 0. This is
the "dark at distance, bright near the camera" look of the cave.

### 0x36890 (cube), 0x2c118 (spider) — standard engine span routines (E2).

---------------------------------------------------------------------------------------------------

## 6. Camera — `0x26e1c OrbitCamera` (and `0x26d44` quadratic setup)

Fully described in E1 §5.2 (I re-derived it independently and agree). Summary:
`0x26d44(p0=eax, p1=edx, p2=ebx, n=ecx=16, out=[stack])` stores doubles
`A=(p0+p2)/2 - p1, B=(p2-p0)/2, C=p1, D=1/n` (curve through p0 at s=-1, p1 at 0, p2 at 1; the
segment plays s∈[0,1)). Each frame `cam[c] = (cam[c] + trunc(((A*s)+B)*s + C)) >> 1`, `s = frac*D`.
camera.rec channels: pitch, yaw, roll (4096/turn), distance. Position:
```
P = GetObjPos(spider);  C = P + (0,0,-cam[3])
a = cam[0]*π/2048:  dy=C.y-P.y; dz=C.z-P.z; C.y=trunc(P.y+dy·cos a−dz·sin a); C.z=trunc(P.z+dz·cos a+dy·sin a)
b = cam[1]*π/2048:  dx=C.x-P.x; dz=C.z-P.z; C.x=trunc(P.x+dx·cos b+dz·sin b); C.z=trunc(P.z+dz·cos b−dx·sin b)
SetCameraAngles(w, {(short)cam[0], (short)cam[1], (short)cam[2]});  SetCameraPos(w, C)
```
(trunc = toward zero, `0x44160` sets RC=chop then frndint.) The opening shot: distance 9500 → 3428,
looking down the corridor at the spider (capture 5 s), later orbiting.

---------------------------------------------------------------------------------------------------

## 7. Text overlay (`0x1e09c smallText(str=eax, x=edx, y=ebx, dst=ecx)`)

Drawn into B after RenderWorld, so it is blended with the scene: for each char (advance 10 px;
space = skip): glyph index `g = c>='a' ? c-'a' : c-0x14` (digits → 28..37), glyph data
`font2[g*77 + 11 + r*11 + k]` for r 0..6, k 0..9 (font2 = the 11-wide half-size font, values
0x40..0x7e), `dst[(y+r)*320 + x + k] = T[glyph][dst]` → letters are the background brightened by
0..62 levels (white over the bright spot, dim over dark rock — visible in the capture).
Positions: "robotnik" (2,2), "rage 1997" (225,2), "punish your machine" (125,190).

---------------------------------------------------------------------------------------------------

## 8. Ending: `0x27e28 FlyAway(endIdx=4)` with setup `0x27cac(0)`

Setup:
```
quad = 0x835b8: points (±160, ±100, 0), 2 triangles, UV 0..255 (flags 0xc4), material 0xe2c90
tex = malloc(65536);  resample VGA 320x200 → tex 256x256 (0x1d1a0, nearest:
    xstep=(320<<16)/256, ystep=(200<<16)/256, tex[y*256+x] = vga[(fy>>16)*320 + (fx>>16)], fx,fy from 0)
w2 = CreateWorld(30,0x76c,0xa8c,0xa8c);  mat 0xe2c90: +0x10=tex, +0x28=1, +0x2c=0x36890
SetObjPos(quad,0,0,0), angles 0;  SetCameraAngles(w2,{0,0,0});  CameraMoveLocalZ(w2,-256)
AddObject(w2,quad); ComputeBounds; SetRenderMode(w2,3); [0x89dcc]=B; [0x106b58]=VGA
```
With focal 256 at distance 256 the quad exactly covers the screen (the last spider frame).
Loop (no tick wait):
```
t0 = [0x91260]
while (SyncIdx() <= 4) {          // until (pos 2,row 0x38)
    t = [0x91260] - t0
    SetObjPos(quad, t*8, 0, t*16);  SetObjAngleX(quad,(short)(t*32));  SetObjAngleZ(quad,(short)(t*8))
    RenderWorld(w2) → B;  copy B → VGA; clear B;  EscCheck()
}
free(tex); free([0x83464]); DestroyWorld(w2)
```
The picture tilts back around X (32 units/tick = 0.55 turn/s), spins slowly around Z and recedes
(z += 16/tick) for ~1.1 s (capture 24.6–25.7 s: a thin rotating strip at 26 s).

## 9. Deinit `0x21604`
Clear VGA (64000 bytes), `DestroyWorld(w)`, free spider root, shade, star, ray, floor-copy, [0xdf864]
(unused, 0), blood; free font buffers (`0x1dda0`); clear the shade-table cache (`0x315f0`).
(sp_pic1 is never freed.) Screen stays black until part 1.

---------------------------------------------------------------------------------------------------

## 10. Porting checklist (draw order per frame)
1. update spider/light/cube/anim/camera as in §3;
2. floor map: remove old spot, add new spot (or the blood stamp);
3. render cave (floor+walls with depth-cue), cube (once visible), spider with per-triangle shadow
   (shadow first, then triangle), light cone (after the floor point/marker is projected);
   engine painter's order per E2;
4. text ×3 through T; present; clear.

## Open questions
- Exact draw order of the light/marker/plane callbacks relative to the cave and spider within E2's
  sort (affects only whether the cone/shadow use this frame's or last frame's positions, and whether
  the cone is drawn over or under the spider).
- The depth-cue formula of 0x38440 (row = (0x7fff - (z<<1))>>8) is read from the inner loop setup;
  the z scale (raw camera z?) should be confirmed against E2's notes.
