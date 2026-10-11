# P14 — Part 14 (end scene), part 15 (end pictures) and program exit

Scope:
- Part 14: init `0x15ab4(rVal)`, run `0x16180(0x1b)`, deinit `0x164d8`.
- Part 15: init `0x1d898()`, run `0x1db88(0x20)`, deinit `0x1d9e8`.
- What the sequencer does after part 15 (`0x12a77..0x12adb`) until the program exits.

Library names (≥0x39000) follow `E1_engine_data.md` §4. Shared helpers below 0x39000 follow
`M_main_support.md`. Triangle rasteriser and span routines (`0x43654`, `0x439cc`, `0x764a2`, `0x76a3c`, span
fns `0x38440`, `0x331b4`, `0x36890`) belong to E2 and are only named here.

Notation: `F` = `[0x91260]` (70.086 Hz tick counter), `syncAdvance()` = `0x12204`, `resyncFrame()` =
`0x121d4`, `killCheck()` = `0x122b8`/`0x122f0` (ESC → exit), `waitTick()` = `0x123b0`. `BACK` = back
buffer `0xe4d40` (= `[0x89dcc]` after `SetDefaultTargets 0x3a810`), `VGA` = `0xa0000`.

## 0. Timeline (default run, no /r /p)

Sync entries are from M §4.5 (song seconds). The capture offset is **capture = song + 123.84 s**. I measured
it from the first shatter frame (entry 35 → 394.88 s) and the first fly-in frame (entry 32 → 385.92 s). Both
agree to within one frame.

| entry | pos,row | song s | capture s | event |
|---|---|---|---|---|
| 27 | 43,16 | 232.96 | 356.80 | part 14 starts rendering. For the first ~0.5 s the camera recording looks into the black void, and the floor shows from ~357.3 |
| 28 | 45,30 | 243.88 | 367.72 | word overlay "rage" (rage.raw), 95 frames |
| 29 | 46,30 | 248.36 | 372.20 | word overlay "punished" |
| 30 | 47,30 | 252.84 | 376.68 | word overlay "robotnik" |
| 31 | 49,24 | 260.96 | 384.80 | part 14 loop ends. The last frame stays on VGA (frozen) |
| 32 | 50,0 | 262.08 | 385.92 | part 15: the screen flips over to "punish" (155 frames = 2.21 s), then the palette changes |
| 33 | 50,16 | 264.32 | 388.16 | flip to "your" (2.21 s), then immediately flip to "machine" (2.21 s, ends ~392.6) |
| 34 | 51,0 | 266.56 | – | not tested by part 15 |
| 35 | 52,0 | 271.04 | 394.88 | "machine" shatters into 532 triangles that fly at the viewer. The background is endlogo |
| 36 | 52,16 | 273.28 | 397.12 | fade of endlogo to black (≈129 ticks, black at ~398.8) |
| 37 | 52,50 | 278.04 | 401.88 | part 15 returns, music stops, text mode (the capture ends at 401.8) |

Main wraps part 14 with the leak collector (`if [0x80054]: 0x2d2d0()` before init, `0x2d2f0()` after
deinit; M §2). Part 15 has no wrapper.

---------------------------------------------------------------------------------------------------

## 1. Part 14 data and objects

### 1.1 Globals

| addr | content |
|---|---|
| 0x80bcc | recordMode = (rVal == 7). Default 0 = playback |
| 0x89ec0 | set to 0 at init start |
| 0x95b00 | ShadeTable from the generator `0x314c0` (gamma 2.0, lo 0, hi 31, scale 3.0, base 0, N 0x80, stride 0x100). **Never read**, so a port can skip it. Leaked (the /c collector frees it) |
| 0x95ae4 | en_obj.eob (robot, 33 objects) |
| 0x95af0 | skull.eob (5 objects: 0 skull, 1 = child of 0, 3 = child of 1, 4 = child of 3, 2 = sibling of 1) |
| 0x95ae0 | static object at 0x81170: the "RAGE" box |
| 0x95ae8 | static object at 0x80dec: the floor |
| 0x95b04 | World* |
| 0x949f0 | shade.raw (65536 B), converted in place: `b = (b>>2) + 0xa0` |
| 0x94a20 | copy of the converted shade (0xa0..0xb0) + blood stamp (floor material 1) |
| 0x94a80 | another copy of the converted shade, `b -= 0xa0` → 0..16 (texture for skull obj 1) |
| 0x94ac0 | sp_pic1.raw (8192 B = 256x32), converted: `b<0x80 ? b>>3 : ((b-0x80)>>3)+0x20` |
| 0x95aec | drill1.raw (0x300 palette + 256x256). Pixels used unchanged |
| 0x95b08 | 32x256 "add-light" table for the word overlay (§1.4) |
| 0x95af4/af8/afc | rage.raw / punished.raw / robotnik.raw (64000 B each, 320x200 intensity 0..31) |
| 0x8193c/0x81940 | font.raw loaded with `loadFont(add 0, shift 1)` (M §3.8). **Never used by part 14**, freed in deinit |
| 0x94aa0.. | camera-player Ctl: +0 frame index, +4 record cursor, +8 unused, +0xc (=0x94aac) buffer |

### 1.2 Runtime materials (0x30 bytes each, layout E1 §3.2). The structs are in bss and zero except these fields

| addr | used by | +0x10 texture | +0x28 | +0x2c span fn |
|---|---|---|---|---|
| 0x949e0 | floor polys with mat 0 | [0x949f0] converted shade | 1 | 0x38440 |
| 0x94a10 | floor polys with mat 1 | [0x94a20] shade copy + blood | 1 | 0x38440 |
| 0x94a40 | skull obj 3 (`24720`) | drill1.raw+0x300 | – | 0x331b4 |
| 0x94a70 | skull obj 1 (`24720`) | [0x94a80] shade 0..16 | – | 0x331b4 |
| 0x94ab0 | box | [0x94ac0] sp_pic1 | 1 | 0x38440 |

The static objects point at these through `obj+0xa4` (0x80e90 → 0x949e0, 0x81214 → 0x94ab0).
`0x24720(obj, mat)` (E1): `obj+0xa0=1, obj+0xa4=mat`, every polygon `+4 = 0`.

### 1.3 Static objects (obj3 data, Object layout E1 §3.1)

**Floor 0x80dec**: 9 points at 0x80bd0, 8 polys at 0x80c3c, flags 0x460, 2 materials (0x949e0).
Points (before ScalePoints(0x200), which doubles them). Point 1 really has x=600, which looks like a typo
in the original. Keep it:
```
0 (-6000,-100,-6000) 1 (600,-100,-6000) 2 (6000,-100,-6000)
3 (-6000,-100,0)     4 (0,-100,0)       5 (6000,-100,0)
6 (-6000,-100,6000)  7 (0,-100,6000)    8 (6000,-100,6000)
```
Polys `{+4 mat, A,B,C, uA,vA,uB,vB,uC,vC}` (+0=0, +8=-1):
```
{0, 0,1,3, 0,0,255,0,0,255}      {0, 1,4,3, 255,0,255,255,0,255}
{1, 1,2,5, 255,0,0,0,0,255}      {1, 1,5,4, 255,0,0,255,255,255}
{0, 3,4,7, 0,255,255,255,255,0}  {0, 3,7,6, 0,255,255,0,0,0}
{0, 4,5,7, 255,255,0,255,255,0}  {0, 5,8,7, 0,255,0,0,255,0}
```
**Box 0x81170**: 8 points at 0x80ea0, 12 polys at 0x80f00, flags 0x0a, 1 material (0x94ab0). Not rescaled.
```
points: (0,0,0) (0,0,1000) (1400,0,1000) (1400,0,0) (0,1000,0) (0,1000,1000) (1400,1000,1000) (1400,1000,0)
polys (all mat 0):
{0,3,1, 64,2,127,2,64,29}   {1,3,2, 64,29,127,2,127,29}  {4,5,7, 64,2,64,29,127,2}
{5,6,7, 64,29,127,29,127,2} {0,7,3, 2,2,63,29,63,2}      {0,4,7, 2,2,2,29,63,29}
{1,6,5, 63,2,2,29,63,29}    {1,2,6, 63,2,2,0,2,29}       {2,3,6, 95,2,64,2,95,29}
{3,7,6, 64,2,64,29,95,29}   {0,1,5, 64,2,95,2,95,29}     {0,5,4, 64,2,95,29,64,29}
```

### 1.4 Colour tables built at init

**0xfd0a0, 128 rows x 256 (`0x15890`)**. This is the global shade table that the engine's span routines
index (material `+0xc`):
```
for r in 0..127: c = r>>2
  for b in 0..255: v = (b&31) + c - 16;  v = v>31 ? 31 : (v<=0 ? 0 : v);  T[r*256+b] = (b&0xe0) + v
```
(row 64 = identity. Lower rows darken and higher rows brighten, always inside b's 32-entry ramp.)

**[0x95b08], 32 rows x 256 (same function, second loop)**:
```
for r in 0..31: for b: L[r*256+b] = (b&0xe0) + min((b&31) + (r>>1), 31)
```

### 1.5 Texture stamps
- `0x23d64(dst=skull material[1].texture, src=sh_blod.raw (64x64), thr=max(ebx,1)=1)`. This is skull obj 0,
  material 1 (skultxt.raw+0x300, 256 wide). For r,c in 0..63: if `src[r*64+c] > 1`, write 0xf0 to the 2x2 block at
  texel (x = 64+2c, y = 35+2r) (i.e. `dst + 0x2340 + r*0x200 + 2c`, bytes +0, +1, +0x100, +0x101).
- `0x31934(src=sp_blod.raw (64x64), dst=[0x94a20], cx=0xdf, cy=0xdf)`: for y in cy-32..cy+31, x in
  cx-32..cx+31 (src advances 1 per x; a whole row of 64 is skipped when y is outside 0..255; a texel is skipped
  when x is outside 0..255): `if src==0xff: dst[y*256+x] = 0xff`. That puts blood (colour 0xff) into texels
  191..254 x 191..254 of floor material 1.

### 1.6 Cylindrical UVs `0x15a00(obj)` (applied to skull obj 3 and skull obj 1, on the *unscaled* 16.16 points)
For each polygon and each corner k (point P = pts[idx_k]):
`u_k = angle(P.z, P.x) >> 2` (M §3.4 `0x11d72(eax=P.z, ebx=P.x)`, 0..1024 → 0..256, arithmetic shift),
`v_k = (P.y >> 4) & 0xff`. Stored at poly +0x18/+0x1c (A), +0x20/+0x24 (B), +0x28/+0x2c (C).

---------------------------------------------------------------------------------------------------

## 2. Part 14 init `0x15ab4(eax=rVal)`

In order:
```
[0x80bcc] = (rVal==7); [0x89ec0] = 0
[0x95b00] = 0x314c0(...)                       // unused shade table
en = LoadObject("en_obj.eob"); sk = LoadObject("skull.eob")
box = 0x81170; floor = 0x80dec
ClearFlagsTree(sk, 4)  (0x277bc); SetFlagsTree(sk, 0x20) (0x27798)
cylUV(sk.child.child)  (obj 3);  cylUV(sk.child) (obj 1)          // 0x15a00, §1.6
UseMaterial(sk.child.child, 0x94a40); UseMaterial(sk.child, 0x94a70)
load + convert shade.raw → [0x949f0]; [0x94a20] = copy;           // §1.1
material fields 0x94a08=1, 0x94a0c=0x38440, 0x94a38=1, 0x94a3c=0x38440
load + convert sp_pic1.raw → [0x94ac0]; 0x94ad8=1, 0x94adc=0x38440
[0x95aec] = load drill1.raw
stamp sh_blod into the skull texture (§1.5); free sh_blod
0x94a6c = 0x331b4; 0x94a50 = drill1+0x300
[0x94a80] = copy of [0x949f0] minus 0xa0; 0x94a9c = 0x331b4
ScalePoints(sk,1); ScalePoints(sk,3); ScaleKeys(sk,3)
ScalePoints(en,1); ScalePoints(en,1); ScaleKeys(en,1); ScalePoints(en,0xc0); ScaleKeys(en,0xc0)
ScalePoints(floor,0x200); ScaleKeys(floor,0x200)
w = CreateWorld(0x3c, 0xed8, 0x1518, 0x1518) → [0x95b04]
SetObjPos(sk, -800, 0, 500)
SetObjPos(sk.child /*obj1*/, 0, -350, 0)
SetObjAngles(sk, (-824, -800, 0))
SetObjPos(box, 1200, -200, -1800);  SetObjAngles(box, (0,0,0))
SetObjPos(floor, 0, 0, 0);          SetObjAngles(floor, (0,0,0))
SetObjPos(en, -2000, 0, 1500);      SetObjAngles(en, (-700, 0, -1024))
AddObject(w, sk); AddObject(w, en); AddObject(w, floor); AddObject(w, box)
ComputeBounds(w); SetRenderMode(w, 3); SetDefaultTargets()
read end_pal.col (0x300 bytes from offset 0) to the stack; set the DAC (0x11af3: index 0, 768 6-bit values)
loadFont("font.raw", add 0, shift 1)                 // unused here
[0x95b08] = malloc(0x2000); build 0xfd0a0 and [0x95b08]  (0x15890, §1.4)
AnimateTree(en, 0x1700)                              // pose = key time 23.0 (frames*256). Never animated again
en.flags(+0x84) |= 0x1000                            // hide the en_obj root object itself (not recursive)
SetFlagsTree(en.child.child.child.child.child, 0x1000)   // obj 29 and its subtree (29,30,31,32) hidden
SetObjAngles(en.child.child.child /*obj 3*/, (0, 0, -400))
sp_blod stamp (§1.5); free sp_blod
[0x94aac] = recordMode ? malloc(0x10000) : loadFile("end_cam.rec")
SetCameraPos(w, 3000, 8000, -10000); SetCameraAngles(w, (128, 2048, -1000))   // overwritten by playback frame 0
[0x95af4] = rage.raw; [0x95af8] = punished.raw; [0x95afc] = robotnik.raw
```
"x.child" = `+4` and siblings = `+0` (E1 §1.7). en_obj object numbers are pre-order file indices
(E1's parser): 0 → child 1 → child 2 → child 3 → first child 4 → child 29.

## 3. Part 14 run `0x16180(n=0x1b)`

```
Ctl.index = Ctl.cursor = Ctl[+8] = 0
(record-path setup: GetCameraPos/Angles, 0x25e7c orbit maths. Pure, no effect in playback)
while (syncAdvance() <= n) killCheck();       // wait for entry 27
idx = syncAdvance(); resyncFrame(); T0 = F
prevE = 0; wordIdx = -1; overlay = 0
while (idx <= n+4) {                           // until entry 31 is reached
    d = F - prevE - T0                         // ticks since the previous frame (first frame: ≈0)
    prevE = F - T0                             // elapsed ticks since part start
    prevIdx = idx; idx = syncAdvance()
    Ctl.index = prevE
    if recordMode: free-camera controls (0x189e8/0x18a50/0x25a5c) + record 0x277e4
    else          PlayCamera(w, &Ctl)          // 0x2789c: rec[prevE] → SetCameraPos + SetCameraAngles (E1 §5.1)
    RenderWorld(w)                             // into BACK
    if (idx != prevIdx && idx >= n+2 && idx <= n+4 && overlay == 0) { overlay = d + 95; wordIdx++; }
    if (overlay) {
        r = overlay - d; if (r <= 0) r = 0; overlay = r
        lvl = (2*r)/3; if (lvl > 31) lvl = 63 - lvl          // 0 →31 (r=47/48) → 0, triangle
        addLight(word[wordIdx], BACK, [0x95b08], lvl)        // 0x11a02
    }
    copy BACK → VGA (64000 B) and zero BACK (dword loop 0x1644b)
    killCheck()
}
if recordMode: write end_cam.rec (0x27874)
copy VGA → BACK (64000 B, 0x11d43)   // BACK = last frame (no visible effect)
free [0x94aac]
```
- **No frame wait**: the loop renders as fast as it can. All motion comes from `prevE` (camera index =
  elapsed ticks, no interpolation, no bounds check: 2646 records = 37.7 s, and the part uses ~1962).
- Words: wordIdx 0,1,2 = rage, punished, robotnik. They are triggered when idx becomes 0x1d, 0x1e, 0x1f, i.e.
  when entries 28, 29, 30 are reached. The level is 0 on the trigger frame (r=95 → 63 → 0). It peaks at 31 after
  47 ticks and is back at 0 after 95 ticks (1.36 s). In the capture "rage" appears at 367.8, is full at about
  368.4 and is gone by 369.1.
- `0x11a02 addLight(esi=src, edi=dst, ebx=L, dl=lvl)`: for i in 0..63999:
  `a = min(src[i], lvl); dst[i] = L[a*256 + dst[i]]`. The result is +⌊a/2⌋ shades (max +15) inside each
  pixel's 32-colour ramp, clamped at the ramp top. The word images hold values 0..31, mostly 0.
- The loop exits after rendering the frame in which idx reached 0x20 (entry 31). That frame stays on screen
  until part 15's first flip starts (1.12 s).

## 4. Part 14 deinit `0x164d8`
Frees [0x949f0], [0x94ac0], [0x94a20], [0x95aec], [0x95b08], [0x94a80], [0x95af4], [0x95af8], [0x95afc].
Then `0x315f0` (`[0x84c6c]=0`: forget the ShadeTable cache list, no free) and freeFont (0x1dda0). The world
and the objects are not destroyed (the /c collector frees them).

---------------------------------------------------------------------------------------------------

## 5. Part 15 init `0x1d898`

```
[0xd8a3c] = punish.raw; [0xd8a34] = your.raw; [0xd8a38] = machine.raw; [0xd8a30] = endlogo.raw
   // each: 0x300 bytes palette (ignored) + 320x200 pixels
for i in 0..63999 (pixels at +0x300):
    punish[i]  = (punish[i]  + 0xc0) & 0xff      // 0..29 → 0xc0..0xdd
    your[i]    = (your[i]    + 0x80) & 0xff      // 0..29 → 0x80..0x9d
    machine[i] = min(machine[i] + 5, 31) + 0xa0  // 0..31 → 0xa5..0xbf
endlogo pixels are used unchanged (0..95)
PAL (0xd7730, 768 B) = en_pal.col bytes 0..0x2ff      (the file is 769 bytes; the last byte is ignored)
PAL[0x240..0x29f]    = end_pal.col bytes 0x240..0x29f   // colours 0xc0..0xdf taken from part 14's palette
fade table 0xfd0a0, 128 rows:  for k in 0..127: s = (127-k)>>2
    for b: T[k*256+b] = (b&0xe0) + max((b&31) - s, 0)          // row 127 = identity, row 0 = -31
```
Colours 0xc0..0xdf are identical in part 14's DAC (end_pal) and in PAL. So "punish" (0xc0..0xdd) looks the
same before and after the palette switch.

## 6. Part 15 run `0x1db88(n=0x20)`

```
while (syncAdvance() <= n)   killCheck();     // entry 32
flipTo(punish+0x300, 0x20, 0, 0x60)            // 0x282a0, §6.1
setDAC(PAL)                                     // 0x11af3 — only now (esi survives 0x282a0)
while (syncAdvance() <= n+1) killCheck();      // entry 33
flipTo(your+0x300,    0x40, 0x20, 0)
flipTo(machine+0x300, 0x20, 0,    0x20)
shatterInit(speed=0x8c, mode=1)                 // 0x16f20, §6.2 — samples VGA (= machine)
while (syncAdvance() <= n+3) killCheck();      // entry 35   ("machine" stays still for ~2.3 s)
shatterRun(until=n+4, bg=endlogo+0x300)         // 0x171a8, §6.3
shatterFree()                                   // 0x169d0: free [0x95f10], [0x95f14]
// fade (all the loop does is remap BACK, which now holds endlogo)
T0 = F; prevE = 0; k = 127
do { d = F - prevE - T0; prevE = F - T0; waitTick();
     for i: VGA[i] = T[k*256 + BACK[i]]
     k -= d; killCheck(); } while (k >= 0)
// k=127 is shown twice (d=0 on the first pass), then about one row per tick: ≈129 ticks ≈ 1.84 s
// (rows ≤7 are already almost black, so the capture shows black from ~398.8)
memset(VGA, 0, 64000)
while (syncAdvance() <= n+5) killCheck();      // entry 37
return
```

### 6.1 `0x282a0 flipTo(eax=pic320x200, edx=kx, ebx=ky, ecx=kz)`: the current screen flips over to show pic

```
tex = [0x83464] = malloc(0x10000)
scale(pic 320x200 → tex 256x256)              // 0x1d1a0 (M §3.5)
mirrorRows(tex, w=256, h=256)                 // 0x1d648: reverse each row in place
setupFlip(1)                                  // 0x27cac, below
resyncFrame(); T0 = F
do {
    t = ((F - T0) * 0x1400) / 49              // signed; 104.49 per tick
    SetObjPos(front, 0, 0, S[(t>>6) & 511])   // M §3.2 sine (8.8, peak 257): pushed away to ~2x distance and back
    SetObjAngles(front, ((short)((kx*t)>>8), (short)((ky*t)>>8), (short)((kz*t)>>8)))   // 4096 per turn
    RenderWorld([0xe3cf0])                    // → BACK
    copy BACK → VGA and zero BACK
    killCheck()
} while (t < 0x3f00)                          // the frame with t ≥ 0x3f00 is still drawn; ≈155 ticks = 2.21 s
copy pic (320x200, unscaled) → VGA            // exact final image
free [0xe3cf4]; free [0x83464]; DestroyWorld([0xe3cf0])
```
There is no tick wait, so this is time-based only. At t=0x3f00 the angles are 63·k: punish (2016, 0, 6048)
≈ (177°, 0, 171.6°), your (4032, 2016, 0) ≈ (354°, 177°, 0), machine (2016, 0, 2016) ≈ (177°, 0, 177°).
So the plane ends nearly face-on, showing its back side, and the cut to the exact picture is almost
invisible.

**`0x27cac setupFlip(eax=withBack)`** (shared with other parts):
```
front = [0xe3cf8] = 0x835b8 (static object)
snap  = [0xe3cf4] = malloc(0x10000); scale(VGA 320x200 → snap 256x256)    // current screen, not mirrored
if (withBack) {
    front.child(+4) = 0x8366c                     // back plane, a child of front (inherits its transform)
    ClearFlagsTree(front, 4)                      // flags 0xc4/0xc0 → 0xc0
    mat 0xe2cc0: +0x10 = [0x83464] (new pic, mirrored), +0x28 = 1, +0x2c = 0x36890
}
mat 0xe2c90: +0x10 = snap, +0x28 = 1, +0x2c = 0x36890
w = [0xe3cf0] = CreateWorld(0x1e, 0x76c, 0xa8c, 0xa8c)
SetObjPos(front, 0,0,0); SetObjAngleX/Y/Z(front, 0)
SetCameraAngles(w, (0,0,0)); CameraMoveLocalZ(w, -256)
AddObject(w, front); ComputeBounds(w); SetRenderMode(w, 3)
[0x89dcc] = BACK; [0x106b58] = VGA
```
Static planes (identical points at 0x83468: (-160,100,0) (160,100,0) (-160,-100,0) (160,-100,0)):
- front 0x835b8 (flags 0xc4, materials 0xe2c90): polys {A,B,C,uv} = {0,1,2, 0,0,255,0,0,255},
  {1,3,2, 255,0,255,255,0,255}
- back 0x8366c (flags 0xc0, materials 0xe2cc0): {0,2,1, 0,0,0,255,255,0}, {1,2,3, 255,0,0,255,255,255}
  (opposite winding. With flag 4 cleared, presumably only the side facing the camera is drawn. Hence the mirrored
  texture for the back).

The plane is 320x200 at camera distance 256, so at t=0 it fills the screen and the first frame matches the
frozen part-14 frame.

### 6.2 `0x16f20 shatterInit(eax=speed, edx=mode)` (shared with parts 5 and 13)
Globals: `[0x81240]` speed (data default 0x96, set to 0x8c here), `[0x89f18]` focal F (data 0x200000, set to
0x100000), `[0x81244]` z of new vertices, `[0x81230]` triangle count, centre `[0x81234..3c]` =
(0, 0, 0xfa000) (data, never written here).
```
[0x81240]=speed; F=0x100000; [0x81244]=0; count=0
srand(1)                                         // 0x43437; rand() = 0x43413 (Watcom LCG: s=s*0x41c64e6d+0x3039; (s>>16)&0x7fff)
SetDefaultTargets(); 0x76a3c(320, 200, BACK)     // init E2's triangle filler
texL = [0x95f10] = malloc(0x10000); texR = [0x95f14] = malloc(0x10000)
for y in 0..199: texL[y*256 .. +256] = VGA[y*320 + 0 ..]; texR[y*256 .. +256] = VGA[y*320 + 64 ..]
                 // rows 200..255 are left uninitialised
grid 15 rows x 20 cols, index i = r*20 + c:
for r in 0..14: for c in 0..19:
    X[i] = (c*320)/19;  if (c != 0 && c != 19) X[i] += rand()%7 - rand()%7     // X at 0xce958
    Y[i] = (r*200)/14;  if (r != 0 && r != 5)  Y[i] += rand()%6 - rand()%6     // Y at 0xcf2b8  (sic: 5, not 14)
for i in 0..279: if (i % 20 != 19) makeQuad(i)   // 0x16c04 → 266 quads, 532 triangles, 1596 vertices
[0x81244] = -F                                   // not used afterwards by part 15
for j in 0..count-1: launch(j, mode)             // 0x169e4
```
`rand()%k` is a C signed remainder of a non-negative value. The order of rand calls is exactly as listed
(X pair then Y pair per grid point, then 3 per triangle in launch).

Vertex (64 B at `0x95f18 + 64*k`): +0 x, +4 y, +8 z (rest position, <<10), +0xc/+0x10/+0x14 rx,ry,rz (current
world position, <<10), +0x18 sx, +0x1c sy (screen ints), +0x20 texture row, +0x24 texture column.
Triangle (0x34 B at `0xb5318 + 0x34*j`): +0 texture, +4/+8/+0xc vertex indices (= 3j, 3j+1, 3j+2),
+0x10/+0x14/+0x18 velocity, +0x1c/+0x20/+0x24 angles ax,ay,az (1024/turn), +0x28/+0x2c/+0x30 angular velocity.

**`0x16c04 makeQuad(i)`** — two triangles with their own vertices. `h = (X[i] > 128)`, the same for both:
```
tri A: corners i, i+1, i+21;   tri B: corners i, i+20, i+21
vertex from grid point g: x=(X[g]-160)<<10, y=(Y[g]-100)<<10, z=[0x81244] (=0), row=Y[g], col=X[g]-64*h
tex = h ? texR : texL;  velocity, angles = 0   (angular velocity set by launch)
```
**`0x169e4 launch(j, mode)`**:
```
C = (sum of the 3 vertex x)/3, same for y, z     // signed truncating division
dx=C.x-0, dy=C.y-0, dz=C.z-0xfa000
dist = trunc(sqrt((dx>>8)^2 + (dy>>8)^2 + (dz>>8)^2))     // int32 squares, x87 sqrt, chop
mode≠0: vel = (dx*speed/dist, dy*speed/dist, dz*speed/dist)   // signed idiv; |vel| ≈ 140*256 per step, mostly −z (toward the viewer)
        angVel = (rand()%11-5, rand()%13-6, rand()%11-5)
mode=0: vel = (rand()&31, rand()%5 + ((2*C.y + 0x4b000) >> 5), rand()&63)
        angVel = (rand()%15-7, rand()%15-7, rand()%15-7)
```
### 6.3 `0x171a8 shatterRun(eax=untilIdx, edx=background)`
```
while (syncAdvance() <= untilIdx) {
    shatterFrame()                       // 0x168e8 → draws into BACK
    waitTick()
    copy BACK → VGA, then copy background (320x200) → BACK   // so the background shows from the 2nd frame on (the 1st frame's background is BACK = black)
    killCheck()
}
```
**`0x168e8 shatterFrame()`**:
```
for j < count: stepTri(j)                                  // 0x16650
project(0x95f18, 3*count, cx=160, cy=100)                  // 0x435e8
for j < count: 0x43654(&V[3j], &V[3j+1], &V[3j+2], edgeFn=0x439cc); 0x764a2(tri[j].tex)   // E2 affine textured triangle, no z, no culling, drawn in index order
```
**`0x16650 stepTri(j)`**:
```
C = centroid of V[3j..3j+2] (rest positions, /3 truncating)
for k: V[k].xyz -= C
rotate(&V[3j], 3, ax, ay, az)            // 0x43450, uses the angles before the increment
ax = (ax + wx) & 0x3ff; ay = (ay + wy) & 0x3ff; az = (az + wz) & 0x3ff
for k: V[k].r = (V[k].r >> 10) + C       // each component
       V[k].xyz += vel + C               // rest position translated by vel
```
**`0x43450 rotate(eax=verts, edx=n, ebx=a, ecx=b, stack=c)`** (ret 4). sinT = dword table 0x71054 (static in
obj2, 1280 entries, `sinT[i] = round(1024*sin(2πi/1024))`), cosT[i] = sinT[i+256] (0x71454). `sa=sinT[a]`,
`ca=cosT[a]`, `sb,cb` for b, `sc,cc` for c. All products int32, `>>` arithmetic:
```
m0=(((cb*cc)*ca>>10) - sc*sa)>>10   m1=(((cb*cc)*sa>>10) + sc*ca)>>10   m2=(-cc*sb)>>10
m3=(((-sc*cb)*ca>>10) - cc*sa)>>10  m4=(cc*ca + ((-sc*cb)*sa>>10))>>10  m5=(sc*sb)>>10
m6=(ca*sb)>>10                      m7=(sa*sb)>>10                      m8=cb
r.x = x*m0 + y*m1 + z*m2;  r.y = x*m3 + y*m4 + z*m5;  r.z = x*m6 + y*m7 + z*m8      // stored unshifted
```
**`0x435e8 project(eax=verts, edx=n, ebx=cx, ecx=cy)`**: for each vertex, only if `rz > -F`:
`sx = (rx<<10)/(rz+F) + cx; sy = (ry<<10)/(rz+F) + cy` (signed idiv, 32-bit shl). Otherwise sx,sy keep their
old values. At rz=0 one unit (1<<10) is one pixel. The shards reach rz ≈ -F after about 29 steps, by which
time their screen coordinates are huge and they are rejected or clipped by the rasteriser.

**Speed is per drawn frame**, not per tick: one step per loop. In the capture the screen changes every
2nd tick (35 fps). The shards are gone after ~29 changes, 394.88 → 395.74. A port should step at 35 Hz to
match.

## 7. Part 15 deinit `0x1d9e8`
Frees punish, your, machine, endlogo.

---------------------------------------------------------------------------------------------------

## 8. After the last part (`0x12a77..0x12adb`) and program exit

```
t1 = [0x9125c]
midasStopModule(module)        // 0x2dae4
err = gmpFreeModule(module)    // 0x2e0b0; if (err) midasError(err)  (0x2d4f0: "MIDAS Error: ...", exit)
midasClose()                   // 0x2d74c
restoreKeyboard()              // 0x118fc: DOS int 21h ax=2509h with the saved vector at 0x118b4
setMode(3)                     // 0x11a92: int 10h ax=3 → 80x25 colour text, screen cleared by the BIOS
return (t1 - t0) / 0x12331a    // seconds of the demo half; ret 0xc; ignored by main
```
main then does `0x11a58` (restore the x87 control word) and `0x2cc8c` (free the archive directory `[0x838ac]`,
close the archive file `[0x838b0]`), and returns to the Watcom runtime, which exits to DOS. **Nothing is
printed**: the "exit screen" is the empty text-mode screen that the BIOS mode set produces, followed by the
DOS prompt. (The only other texts are the ESC path's "killed." and the help/MIDAS messages.) The DOSBox
capture stops at the mode switch, 401.8 s.

For the port: after part 15 returns (entry 37, ≈5 s after the fade finished, with a black screen), stop the
music. Then end, or show a blank screen.

---------------------------------------------------------------------------------------------------

## 9. Library / helper calls used (by behaviour)

| addr | name | note |
|---|---|---|
| 0x24688 | LoadObject | E1 |
| 0x277bc / 0x27798 | ClearFlagsTree / SetFlagsTree (`+0x84`, recursive over +0 and +4) | |
| 0x24720 | UseMaterial(obj, mat) | |
| 0x23d64 | stamp 64x64 mask ×2 as 0xf0 | §1.5 |
| 0x31934 | stamp 64x64 mask (==0xff) | §1.5 |
| 0x314c0 | ShadeTable generator | E1 §1.5 (result unused here) |
| 0x315f0 | forget ShadeTable cache | |
| 0x39ad0 / 0x39bfc | ScalePoints / ScaleKeys | |
| 0x39e68 / 0x39fd8 | CreateWorld / DestroyWorld | |
| 0x39210 / 0x39234 | MakeVec3s / MakeVec3i | |
| 0x39a2c / 0x39b30 / 0x39a70/78/80 | SetObjPos / SetObjAngles / SetObjAngleX/Y/Z | |
| 0x39e08 | AnimateTree | |
| 0x3a590 / 0x3a598 / 0x3a5b4 | AddObject / ComputeBounds / SetRenderMode | |
| 0x3a810 | SetDefaultTargets (BACK 0xe4d40, VGA) | |
| 0x3a114 / 0x3a2bc / 0x3a178 / 0x3a288 / 0x3a714 | SetCameraPos / SetCameraAngles / GetCameraPos / GetCameraAnglesS / CameraMoveLocalZ | |
| 0x3a4e0 | RenderWorld | E2 |
| 0x2789c / 0x277e4 / 0x27874 | play / record / save camera recording | E1 §5.1 |
| 0x2cf98 / 0x2ceb0 | loadFile / readFilePart(name, dst, offset, size) | |
| 0x43413 / 0x43437 | rand / srand (Watcom) | seed at 0x89f14 |
| 0x43450 / 0x435e8 | rotate / project vertex arrays | §6.3 |
| 0x43654 + 0x439cc, 0x764a2, 0x76a3c | triangle edge setup, span fill, filler init | E2 |
| 0x44160 | x87 round with chop (truncate) | |

## 10. Verification and open points
- Checked against the capture: part 14 words at 367.7/372.2/376.7, frozen frame 384.8–385.9, flips
  385.92 / 388.16 / ~390.4, shatter 394.88 (35 fps, ~29 steps), fade 397.12–~398.9, end 401.8. The
  offset 123.84 s is consistent with all of them.
- Not emulated: the exact output of the E2 span routines (0x38440 with material `+0x28 = 1`, 0x331b4,
  0x36890) and how they use 0xfd0a0. That is E2's documentation.
- Object flag meanings other than 0x1000 (hidden): skull gets bit 4 cleared and 0x20 set, and the flip
  planes get bit 4 cleared (my guess: 4 = double-sided). E2.
- en_obj objects hidden: the root (obj 0, 12 pts) and the subtree of obj 29 (34+318+23+20 pts), per E1's
  pre-order numbering. This should be cross-checked visually against the capture (the robot lies in
  pieces).
