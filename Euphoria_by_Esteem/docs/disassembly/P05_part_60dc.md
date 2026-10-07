# P05: part 0000:60dc (295.35 s .. 400.40 s) and 0e5a:0596

## Summary

Part 0000:60dc has two sub-scenes:

1. **0b1a:01f7, the "time-delay echo" scene.** L5_units.md documents it. It runs from the part start until its own clock reaches T0+4500 ticks, so about 295.35 s to about 340.4 s. It builds its object with **0e5a:0596** (documented fully below): a 38x38x38 box with 6 flat-shaded faces.
2. **The "flying textured cube" scene.** It is inline in 60dc and lasts 58 s plus a 1 s fade (about 341 s to about 400 s).
   - **Background:** 39.pcx (pillars), copied every frame.
   - **Cube:** a cube of side 90. Each side is split into 2x2 textured quads, so there are 24 quads and 26 shared vertices. Each side shows the whole 256x200 checkerboard from 30.pcx: its four quads show its four 128x100 quarters.
   - **Motion:** the cube rotates about a pivot at (0,-10,-100) at time-based angular speeds. Its model position slides in from x = -500 during the first 5 s, wobbles with frame-counted sines, and flies out to +x after 53.4 s. Each vertex also jitters by a per-vertex random sine whose amplitude ramps up and then oscillates (the cube "wobbles/deforms").
   - **First 5 s:** a foreground pillar (40.pcx) is laid over the cube with colour 0 transparent, so the cube emerges from behind it.
   - **End:** after the loop, the palette fades to black over (5900 - elapsed) ticks and the screen is cleared.

I checked against the capture with `capframe.py --sheet 336 400 4`, `338 350 1` and `394 400.5 0.5`:
- The background is the pillars.
- The cube is the blue/white checker. It first appears at the left edge behind the foreground pillar at about 341-342 s and later flies around at varying depth.
- The last cube is visible at about 395 s.
- The palette fade is visible at about 399.5 s, and the screen is black at 400 s.
- Every capture frame from 350 s on differs from the previous one, so the loop runs at 70 fps or more. The loop has no vsync (see the porting notes).

## External calls (in call order)

| call | what |
|---|---|
| 0b1a:01f7 | echo sub-scene (L5 "0b1a part body"). Uses 0e5a:0596 (below) |
| 0000:0000 | sceneReset (near, documented below) |
| 186a:04b4 / 04be | lockPalette / unlockPalette (L1) |
| 186a:02f3 | setClip (L1) |
| 0e30:0223 | loadPCX(dest page, N). N is 1-based, so file = res/(N-1).pcx (L5). It sets the active page and calls setColor for all 256 entries |
| 186a:1522 | remapRange(page, lo, hi, shift) (L1) |
| 1d81:3d77 | Move(src, dst, count) |
| 186a:13ea | repackPage(page, w, rows) (L1) |
| 186a:053b | setPaletteRange(first, last, pal) (L1) |
| 186a:13d4 / 13df | setActivePage(1) / freePage(1) (L1) |
| 186a:39d3 | NewTexture(page, u0, v0, w, h) (L2) |
| 1342:03ef | MakeVec(x, y, z, var v) (L3) |
| 1342:287c | TPolyObject.Init (L4) |
| 1342:3018 | TPolyObject.AddQuad(a, b, c, d) (L4) |
| 1342:2d43 | TPolyObject.AddWall (L4), from 0e5a:0596 |
| 1342:1d6d | TFace.SetExtra(texA, texB) (L3) |
| 186a:047d | setColor (L1) |
| 1d81:4677 | Random(n) |
| 1342:178c | TMesh.GetItem(n), 1-based (L3) |
| 1342:0db6 | TMesh.MoveTo (L3) |
| 1cbc:00a7 / 00ce | timer mark(var t) / elapsed(var t) (BRIEF) |
| 186a:3a7e | PollKey (L2). ESC halts. It returns byte DS:a3ac |
| 186a:121e / 131a | copyPage / copyPageTransparent (L1) |
| 186a:10e5 | setActivePage (L1) |
| 1d81:32ba / 32bf / 3275 | Sin / Cos / Round (half-even) |
| 1d81:3d8f | longint multiply |
| 1342:04bf | TPoint.SetPos (L3) |
| 1342:1466 | TMesh.RotateWork(ax, ay, az) in degrees (L3) |
| 1342:3518 | TPolyObject.Draw (L4) |
| 186a:14d1 | present: copy the active page to A000, no vsync (L1) |
| 1d81:029f | FreeMem |
| VMT+0x0c of TPolyObject (1342:29cf) | DoneFree, called with flag 1 (dispose) |
| 186a:114d | freePage (L1) |
| 186a:08bc | timedFade (L1) |
| 186a:146e | clearScreen (L1) |
| 1d81:32d3 | constructor prologue (in 0e5a:0596) |

## Globals used

| DS | type | name |
|---|---|---|
| a38c | int32 | T0: the part clock mark. Set by 0b1a:01f7 and again by sceneReset |
| a394 | int32 | T1: the rotation clock mark (set just before the loop) |
| a3a4/a3a6 | int32 | `et` = elapsed(T0), refreshed each frame. Later reused for the fade duration |
| a3a8/a3aa | int32 | `rt` = elapsed(T1) (rotation time) |
| a3ac | byte | abort flag (PollKey returns it). sceneReset sets it to 0 |
| 255e | byte | EMS page base (100 with EMS, 0 without). Pages 255e+2, +3, +4 = 102, 103, 104 (EMS) or 2, 3, 4 |
| 5bf0/5bf2 | int16 | screen W/H (320/200) |
| 5d98 | pal | shadow palette |
| 554a/554e/5552 | f32 | 3 floats zeroed by sceneReset (the rotation-angle accumulator A1/A2/A3 in L5) |
| 55f6 | TLightDir | static light object, reset by sceneReset |

## 0000:0000 sceneReset() (near, no args). Called by 60dc after the echo scene

```
mark(&T0 /*DS:a38c*/)
byte DS:a3ac = 0
setClip(0, 0, W-1, H-1)
SetPerspective(200)                         // 1342:0271, DS:5548 = 200
ZeroVec(&DS:554a, &DS:554e, &DS:5552)       // 1342:0282: all = 0.0
TLightDir(DS:55f6).Update(0.0, 0.0, 0.0)    // 1342:421b: light back to default (0,0,-1024)
```

## 0000:60dc partCube() (near, no args, no return). Locals: frame `enter 0x96c`

### Locals (bp-relative)

| bp- | type | meaning |
|---|---|---|
| 0x960 | pal[256] (0x600 bytes) | saved palette (39.pcx, remapped) |
| 0x35f | byte | `ampOsc`: amplitude is in oscillation mode |
| 0x35e | int16 | `amp` (jitter amplitude) |
| 0x35c / 0x35a | int16 | texH = 100 / texW = 128 |
| 0x358 | int16 | s = 45 (half cube side) |
| 0x356/0x352/0x34e | f32 | temp copy of base[i].z / .y / .x |
| 0x34a / 0x346 | f32 | Y / X (the per-frame model offset) |
| 0x342 + 12*i | f32[3] | base[i] = (x, y, z), i = 1..26. **Slot i = 0 is reused** as scalars: `C` = bp-0x342 (= base[0].x), `B` = bp-0x33e, `A` = bp-0x33a |
| 0x200 + 2*i | int16 | rnd[i], i = 1..26 (phase counters) |
| 0x1ce + 4*i | ptr | vtx[i] = mesh vertex i (TPixel) |
| 0x162,0x15e,0x15a,0x156 | ptr | tex3, tex2, tex1, tex0 |
| 0x152 | int16 | `cnt` (cos counter) |
| 0x150 | int16 | loop i |
| 0x14e | int16 | loop i during setup, then `fr` (frame counter) |
| 0x14c..0x140 | ptr | the last 4 faces returned by AddQuad |
| 0x13c | ptr | cube (TPolyObject) |
| 0x138..0x0c | Vec3 (12 bytes) | the 26 vertex positions (see the table) |
| 0x964..0x96c | int32 | FPU scratch |

### Code constants (cs:, float32)
6094 = 0.0, 6098 = 500.0, 609c = -500.0, 60a0 = -80.0, 60a4 = 5340.0, 60a8 = 470.0, 60ac = 400.0,
60b0 = 30.0, 60b4 = 40.0, 60b8 = 80.0, 60bc = 2.0, 60c0 = 5.0, 60c4 = 6.0, 60c8 = 20.0, 60cc = 15.0,
60d0 = 2200.0, 60d4 = 800.0, 60d8 = 1600.0.

### Setup

```
0b1a:01f7()                                  // echo scene (L5). Returns at about T0+4500
sceneReset()                                 // 0000:0000
lockPalette()                                // all setColor calls below only update the shadow palette
setClip(0, 0, W-1, H)                        // QUIRK: bottom = H = 200 (not H-1). See the porting notes
P = DS:255e                                  // 100 with EMS
loadPCX(P+4, 0x29)                           // res/40.pcx (foreground pillar, black = 0 elsewhere) into page 104
remapRange(P+4, 1, 0x68 /*104*/, 0x96 /*150*/)   // pixels 1..104 -> 151..254, palette rotated in [1..254] by +150
loadPCX(P+3, 0x28)                           // res/39.pcx (pillar hall background) into page 103. Palette overwritten
remapRange(P+3, 1, 104, 150)
savedPal = Move(shadow DS:5d98, 0x600 bytes)
loadPCX(P+2, 0x1f)                           // res/30.pcx (checker texture) into page 102. Palette overwritten
repackPage(P+2, 0x100 /*256*/, 0xc8 /*200*/) // to 256-byte stride for the texture mapper
setPaletteRange(0x65 /*101*/, 0xff, savedPal)   // entries 101..255 from the remapped 39.pcx palette, 0..100 stay from 30.pcx
setActivePage(1)                             // 13d4: page 1, allocated and filled with 0 if new
texW = 128; texH = 100
tex0 = NewTexture(P+2,   0,   0, 128, 100)
tex1 = NewTexture(P+2, 128,   0, 128, 100)
tex2 = NewTexture(P+2,   0, 100, 128, 100)
tex3 = NewTexture(P+2, 128, 100, 128, 100)
s = 45
26 x MakeVec(...)                            // the table below. Each coordinate is an exact float32 of -45, 0 or 45
cube = new TPolyObject.Init(limit 4, flags 0x43, minColor 0x64 /*100*/, maxColor 0xc8 /*200*/)   // VMT 23ea
// flags 0x43: type 3 (texture), mode 0 (no shading), 0x40 double-sided. Bit 0x100 is clear, so vertices are shared (AddUnique)
for each of the 6 sides (4 quads each, in the order of the table):
    f[k] = cube.AddQuad(a, b, c, d)          // k = 0..3
    f[0].SetExtra(tex0, tex0); f[1].SetExtra(tex1, tex1); f[2].SetExtra(tex2, tex2); f[3].SetExtra(tex3, tex3)
setColor(0, 0, 0, 0)
for (i = 1; i <= 26; i++) {
    rnd[i]  = Random(50)                     // 0..49. Randomize was called at startup, so it differs per run
    vtx[i]  = cube.GetItem(i)
    base[i] = (vtx[i].wx, vtx[i].wy, vtx[i].wz)   // fields +2/+6/+0xa (work == pos at this time)
}
A = 0.0; B = 0.0; C = 0.0                    // (base[0] slot) C is never written again: always 0.0
amp = 0; cnt = 0; fr = 0; ampOsc = false
unlockPalette()                              // the whole palette goes to the DAC at once
cube.MoveTo(0.0, -10.0, -100.0)              // pushes 0x00000000, 0xC1200000, 0xC2C80000
mark(&T1 /*DS:a394*/)
```
MoveTo moves the origin, pivot and vertices by (0,-10,-100). The vertex positions are overwritten by SetPos on the first frame from `base[]` (captured BEFORE MoveTo), so the lasting effect is **pivot = (0,-10,-100)**. The cube's model centre is near (X, Y, 0) and RotateWork turns it about that pivot, so the cube swings around a point 100 units behind it.

### Vertex positions (s = 45). P-number = order of the MakeVec calls

| P | bp- | (x,y,z) | P | bp- | (x,y,z) | P | bp- | (x,y,z) |
|---|---|---|---|---|---|---|---|---|
| 1 | 138 | (-s,-s, s) | 10 | cc | (-s,-s,-s) | 19 | 60 | (-s,-s,0) |
| 2 | 12c | (0,-s, s) | 11 | c0 | (0,-s,-s) | 20 | 54 | (-s,0,0) |
| 3 | 120 | (s,-s, s) | 12 | b4 | (s,-s,-s) | 21 | 48 | (-s,s,0) |
| 4 | 114 | (-s,0, s) | 13 | a8 | (-s,0,-s) | 22 | 3c | (s,-s,0) |
| 5 | 108 | (0,0, s) | 14 | 9c | (0,0,-s) | 23 | 30 | (s,0,0) |
| 6 | fc | (s,0, s) | 15 | 90 | (s,0,-s) | 24 | 24 | (s,s,0) |
| 7 | f0 | (-s,s, s) | 16 | 84 | (-s,s,-s) | 25 | 18 | (0,-s,0) |
| 8 | e4 | (0,s, s) | 17 | 78 | (0,s,-s) | 26 | 0c | (0,s,0) |
| 9 | d8 | (s,s, s) | 18 | 6c | (s,s,-s) | | | |

### Faces: AddQuad(a,b,c,d) in this order. Texture = tex(k mod 4)

TexQuad maps a->(0,0), b->(127,0), c->(127,99), d->(0,99) of the 128x100 sub-rectangle (L2).

| face | tex | a | b | c | d |
|---|---|---|---|---|---|
| 1 | 0 | P1 | P2 | P5 | P4 |
| 2 | 1 | P2 | P3 | P6 | P5 |
| 3 | 2 | P4 | P5 | P8 | P7 |
| 4 | 3 | P5 | P6 | P9 | P8 |
| 5 | 0 | P3 | P22 | P23 | P6 |
| 6 | 1 | P22 | P12 | P15 | P23 |
| 7 | 2 | P6 | P23 | P24 | P9 |
| 8 | 3 | P23 | P15 | P18 | P24 |
| 9 | 0 | P12 | P11 | P14 | P15 |
| 10 | 1 | P11 | P10 | P13 | P14 |
| 11 | 2 | P15 | P14 | P17 | P18 |
| 12 | 3 | P14 | P13 | P16 | P17 |
| 13 | 0 | P10 | P19 | P20 | P13 |
| 14 | 1 | P19 | P1 | P4 | P20 |
| 15 | 2 | P13 | P20 | P21 | P16 |
| 16 | 3 | P20 | P4 | P7 | P21 |
| 17 | 0 | P10 | P11 | P25 | P19 |
| 18 | 1 | P11 | P12 | P22 | P25 |
| 19 | 2 | P19 | P25 | P2 | P1 |
| 20 | 3 | P25 | P22 | P3 | P2 |
| 21 | 0 | P7 | P8 | P26 | P21 |
| 22 | 1 | P8 | P9 | P24 | P26 |
| 23 | 2 | P21 | P26 | P17 | P16 |
| 24 | 3 | P26 | P24 | P18 | P17 |

The sides are z=+s (faces 1-4), x=+s (5-8), z=-s (9-12), x=-s (13-16), y=-s (17-20) and y=+s (21-24).

Face colours are 100..123 (minColor + k), unused because these faces are textured.

**Mesh vertex order** (GetItem 1..26 = first appearance while the faces are added, v1..v4 per face, duplicates merged by exact position):
1 (-s,-s,s), 2 (0,-s,s), 3 (0,0,s), 4 (-s,0,s), 5 (s,-s,s), 6 (s,0,s), 7 (0,s,s), 8 (-s,s,s), 9 (s,s,s),
10 (s,-s,0), 11 (s,0,0), 12 (s,-s,-s), 13 (s,0,-s), 14 (s,s,0), 15 (s,s,-s), 16 (0,-s,-s), 17 (0,0,-s),
18 (-s,-s,-s), 19 (-s,0,-s), 20 (0,s,-s), 21 (-s,s,-s), 22 (-s,-s,0), 23 (-s,0,0), 24 (-s,s,0), 25 (0,-s,0), 26 (0,s,0).
This only matters for pairing rnd[i] with a vertex, and rnd is random anyway.

### Main loop (one iteration = one frame, no retrace wait)

```
do {
  fr++                                         // int16. The first frame has fr = 1
  et = elapsed(&T0)                            // int32 -> DS:a3a4
  PollKey(); if (DS:a3ac != 0) break
  copyPage(P+3, 1)                             // background 39.pcx
  setActivePage(1)
  if (et < 500) {                              // signed 32-bit
     A = f32( (et*500) / 500.0 + (-500.0) )    // longint mul, fild, extended math -> = et - 500
     B = f32( (et*80)  / 500.0 + (-80.0) )     // = et*0.16 - 80
     if (A > 0.0) A = 0.0
     if (B > 0.0) B = 0.0
  }
  // NOTE: when et >= 500, A and B keep the values of the LAST frame with et < 500 (slightly below 0, e.g. -2.0 and -0.32)
  if ((ext)et > 5340.0)
     A = f32( (et - 5340.0) * 470.0 / 400.0 )  // fly out to +x (at et = 5800, A = 540.5)
  X = f32( sin(fr / 30.0) * 40.0 + A )         // radians, extended math
  Y = f32( sin(fr / 30.0) * 80.0 + B )
  for (i = 1; i <= 26; i++) {
     nx = f32( (X + base[i].x) + sin(rnd[i] / 2.0) * amp )      // amp = int16 via fild
     ny = f32( (Y + base[i].y) + sin(rnd[i] / 5.0) * amp )
     nz = f32( (C + base[i].z) + sin(rnd[i] / 6.0) * amp )      // C == 0.0
     vtx[i].SetPos(nx, ny, nz)                 // pos and work
     rnd[i]++                                  // int16
  }
  if (et > 500) {                              // signed 32-bit
     if (ampOsc) { amp = Round(cos(cnt / 20.0) * 15.0); cnt++ }   // half-even, low word
     else {
        if (fr % 30 == 0) amp++                // signed idiv remainder
        if (amp > 14) ampOsc = true
     }
  }
  rt = elapsed(&T1)                            // int32 -> DS:a3a8
  cube.RotateWork( f32((rt*360) / 2200.0), f32((rt*360) / 800.0), f32((rt*360) / 1600.0) )   // degrees. Longint mul, fild, fdiv
  cube.Draw()                                  // depth sort + textured quads into page 1
  if (et < 500) copyPageTransparent(P+4, 1)    // foreground pillar over the cube, colour 0 transparent
  present()                                    // page 1 -> A000:0000, 64000 bytes
} while (et < 5800)                            // 0x16a8, signed 32-bit, using this frame's et
```
- The amp ramp goes 0 -> 15, one step every 30 frames after et > 500, so it takes about 450 frames. Then amp = round(15*cos(cnt/20)), period 2π*20 ≈ 126 frames.
- The wobble X/Y has a period of 2π*30 ≈ 188.5 frames.
- Rotation periods: x 22 s, y 8 s, z 16 s (time-based).

### Teardown

```
FreeMem(tex0, 7); FreeMem(tex1, 7); FreeMem(tex2, 7); FreeMem(tex3, 7)
cube->DoneFree(1)            // virtual VMT+0x0c (1342:29cf)
freePage(1)                  // 13df. Page 1 was active, so active = page 0 (screen)
freePage(P+2); freePage(P+3); freePage(P+4)
d = 0x170c /*5900*/ - elapsed(&T0)          // int32, stored in DS:a3a4
timedFade(0, 255, -1, -1, -1, steps = 64, duration = d)   // fade the last shown frame to black, normally about 1 s
clearScreen()                // A000:0000 = 0
return                        // main then waits until tick 40040
```
If the loop exits early because DS:a3ac is set, d is larger and the fade is longer. If d <= 0, timedFade divides by a duration <= 0 (FPU inf/NaN). This does not happen in a normal run.

## 0e5a:0596 TBox.Init(sx, sy, sz: int16; flags: word; minColor, maxColor: byte) constructor, far, `retf 0x12`

Stack: sx [bp+0x16], sy [bp+0x14], sz [bp+0x12], flags [bp+0x10], minColor [bp+0xe] (byte), maxColor [bp+0xc] (byte), VMT word [bp+0xa], self far ptr [bp+6]. Returns self in DX:AX (nil if allocation failed).

Only caller: 0b1a:0323 with `(sx=0x26, sy=0x26, sz=0x26, flags=9, minColor=0x65 (101), maxColor=0x95 (149), VMT=0x0c7e, self=nil)`, that is `new(TBox, Init(38,38,38, 9, 101, 149))`.

VMT DS:0c7e: size 0x94, -0x94, 0, 0, +8 = 1342:2906 (Done), +0xc = 1342:29cf (DoneFree). It is the same layout and the same methods as TPolyObject (VMT 23ea). So it is a TPolyObject descendant with no new fields: "TBox".

```
if (!ctorPrologue_1d81_32d3()) return self     // allocation failed -> nil
TPolyObject.Init(self, limit = 6, flags, minColor, maxColor)   // VMT arg 0 (inherited call, VMT already set by the prologue)
hx = sx div 2; hy = sy div 2; hz = sz div 2   // signed idiv by 2 (truncates toward 0). 38 -> 19
// six walls (1342:2d43 AddWall(axis, p1..p6)). Each value is converted exactly to float32 (fild of int16 or of an int32 from -h)
AddWall('Z', -hx, -hy,  hx, -hy, -hz,  hz)   // y = -hy side: v1(-hx,-hy,-hz) v2( hx,-hy,-hz) v3( hx,-hy, hz) v4(-hx,-hy, hz)
AddWall('Z',  hx,  hy,  hx, -hy,  hz, -hz)   // x = +hx side: v1( hx, hy, hz) v2( hx,-hy, hz) v3( hx,-hy,-hz) v4( hx, hy,-hz)
AddWall('Z',  hx,  hy, -hx,  hy, -hz,  hz)   // y = +hy side: v1( hx, hy,-hz) v2(-hx, hy,-hz) v3(-hx, hy, hz) v4( hx, hy, hz)
AddWall('Z', -hx,  hy, -hx, -hy, -hz,  hz)   // x = -hx side: v1(-hx, hy,-hz) v2(-hx,-hy,-hz) v3(-hx,-hy, hz) v4(-hx, hy, hz)
AddWall('X', -hy,  hz,  hy,  hz, -hx,  hx)   // z = +hz side: v1(-hx,-hy, hz) v2( hx,-hy, hz) v3( hx, hy, hz) v4(-hx, hy, hz)
AddWall('X',  hy, -hz, -hy, -hz, -hx,  hx)   // z = -hz side: v1(-hx, hy,-hz) v2( hx, hy,-hz) v3( hx,-hy,-hz) v4(-hx,-hy,-hz)
return self
```
- The axis chars are 0x5a 'Z' (four walls) and 0x58 'X' (two walls). The v1..v4 columns use the L4 AddWall formulas.
- The AddWall return values are ignored.
- Faces get colours minColor+0 .. minColor+5 (101..106 in the only use), from the mesh colour counter with step 1.
- Vertices are shared (flags 9 has no 0x100 bit), giving 8 vertices.
- flags 9 = mode 0x08 (Shade) + type 1 (flat poly clamped to [minColor, maxColor]), single-sided (no 0x40).
- The echo scene later sets each face's flags byte to 3 (textured) after t > 1500 (L5), and it attaches textures with 1342:2a90.

## Porting notes

- **Frame-rate dependence.** The loop has no vsync and no frame pacing, so it runs as fast as the machine can go. The capture shows a new image on every 70 Hz frame, so the original ran at 70 fps or more.
  - fr, rnd[i]++ and the amp ramp/oscillation are per frame. The rotation and the slide-in/out are time-based.
  - Recommended: step one iteration per 70 Hz display frame. GUESS: the true rate is unknown, and higher rates only speed up the wobble/jitter.
- **A/B freeze.** For et >= 500, A and B keep the values from the last frame with et < 500. They do NOT snap to 0. To be faithful, keep A/B as persistent state updated only in that branch. A is overwritten again for et > 5340. B never changes after 500.
- **Clip bottom = 200.** setClip(0,0,319,200) lets the rasterisers touch row 200, which is offset 64000..64319 of page 1, past its 64000-byte buffer (lineOfs has H+1 entries).
  - Port: give page 1 an extra row, or clamp to 199. Row 200 is never presented.
  - The texture mapper's vertical spans clip with clipYmax = 200 (L2).
- Pages: use separate buffers for "page 1" (draw target), "102" (texture, 256 stride after repack), "103" (background) and "104" (overlay). The EMS/conventional choice (DS:255e) does not change the output.
- Palette: final DAC = 30.pcx entries 0..100 (only 0..100 matter for the texture), then entry 0 = black, then entries 101..255 = the remapped 39.pcx palette. remapRange/rotatePalette on a locked palette only change the shadow (L1). Implement remapRange exactly as in L1 and the result follows.
- Random: rnd[i] = Random(50) per vertex. RandSeed comes from Randomize, so a port may use any seeded PRNG.
