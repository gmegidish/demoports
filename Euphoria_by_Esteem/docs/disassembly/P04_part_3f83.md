# P04: part 0000:3f83 (173.00 s .. ~296.0 s), helpers 0000:3921, 0000:37c3, and 0e5a:1cf5 (sphere builder)

## Summary

One long part in mode 13h (320x200, linear 8-bit, everything drawn into a 64000-byte page and copied to A000 by
`present()` 186a:14d1, no retrace wait anywhere in this slice). It has six sub-scenes, all built around the global
starfield object at DS:2620 (100 stars) and the in-place blur filters of unit 179b:

| # | code | part time (s) | abs. time (s) | what |
|---|---|---|---|---|
| S0 | 42a4 loop | 0 .. 7.5 | 173.0 .. 180.5 | dot starfield, palette fade-in from black (2 s), blur trails |
| S1a | 43db loop, el <= 500 | 7.5 .. 12.5 | 180.5 .. 185.5 | comet (TBigPixel) flies from bottom right to the centre, the 500-particle explosion cluster flies from top left to the centre |
| S1b | el 501..1499 | 12.5 .. 22.5 | 185.5 .. 195.5 | explosion expands (TExplosion.Step) and fades |
| S1c | el 1500..4399 | 22.5 .. 51.5 | 195.5 .. 224.5 | streak starfield (warp), step-fade to the blue palette, accelerating, blur |
| S1d | el 4400..4999 | 51.5 .. 57.5 | 224.5 .. 230.5 | fade to white (0.5 s), clear, fade back from white, blurDecay(1) |
| S2 | 4941 loop | 57.5 .. 62.5 | 230.5 .. 235.5 | warp dims, step-fade to the Jupiter palette, blurDecay(1) |
| S3 | 4a2f loop | 62.5 .. 80.5 | 235.5 .. 253.5 | textured sphere 1 (Jupiter, res item 28) flies at the camera (0..8 s), then sphere 2 (Earth, item 29) (10..18 s), over trailing streak stars |
| S4 | 4d9f loop | 80.5 .. 88.0 | 253.5 .. 261.0 | bright blue/white warp again (step-fade to palette A), blur |
| T | 0000:3921 | 0 .. 35 of its own clock | 261.0 .. ~296.0 | precompute (64 frames of warp), closing black borders (to 7 s), then the "cloud tunnel" (0000:37c3) built from item 31, fade to black and music volume fade |

The final helper re-runs PartInit, so its clock restarts at ~261.0. It ends at its own tick > 3500, i.e. about 296.0 s,
which is LATER than the 295.35 s at which main wants to start the next part (main's wait then returns at once).
The capture agrees: black from ~289.5, the next part's first pixels at ~296.5.

Checked against the capture (capframe): comet/explosion at 181..185 s (explosion cluster at screen (2,23) at 181.0 and
(12,23) at 181.5, matching x = -180+el*180/500 + 160); white flash peaking at 225.0 and black at 226; Jupiter at
242 s centred near (120,125) (computed (120,129)); Earth at 252 s near (215,85) (computed (218,83)), right side up;
tunnel first visible at ~269 s; all black at 290 s.

### External calls

| call | meaning |
|---|---|
| 0000:0000 | PartInit (see P01): mark(DS:a38c), a3ac = 0, setClip(0,0,319,199), SetPerspective(200), ZeroVec(554a,554e,5552), TLightDir.Update(DS:55f6,0,0,0) |
| 186a:01a7 | setMode(0) |
| 186a:062a | gradient(a, b, r1,g1,b1, r2,g2,b2) |
| 186a:04d1 | setPalette(pal) |
| 186a:07cf | addPalette(first, last, dr, dg, db) |
| 186a:0836 | setPaletteOffset(pal, first, last, dr, dg, db) |
| 186a:0a32 / 0ca0 / 0e4c | stepFadeInit(first, last, pal, steps) / stepFadeStep() / stepFadeFree() |
| 186a:1522 | remapRange(page, lo, hi, shift) |
| 186a:13ea | repackPage(page, w, rows) |
| 186a:10e5 / 13d4 | setActivePage(n) / setActivePage(1) |
| 186a:114d / 13df | freePage(n) / freePage(1) |
| 186a:121e | copyPage(src, dst) |
| 186a:1071 | getPage(n): far ptr |
| 186a:144f / 146e | clearActive() / clearScreen() |
| 186a:14d1 | present() (active page -> A000, rep movsd, no vsync) |
| 186a:19bf | fillRect(x1, y1, x2, y2, c) |
| 186a:02f3 | setClip(x1, y1, x2, y2) |
| 186a:39d3 | NewTexture(page, u0, v0, w, h) |
| 186a:3a7e | PollKey() (ESC halts; returns DS:a3ac, 0 here) |
| 0e30:0223 | loadPCX(page, N) (L5; N is 1-based: item N-1; the page becomes the active page; sets the PCX palette via setColor) |
| 179b:002f | blur() (L5) |
| 179b:0097 | blurDecay(d) (L5) |
| 1342:0271 | SetPerspective(D) |
| 1342:0604 | TPixel.Init(x, y, z, color) (used with VMT 23aa = TBigPixel) |
| 1342:04bf | TPoint.SetPos |
| 1342:0db6 / 0ed1 | TMesh.MoveTo / TMesh.Translate |
| 1342:1466 / 1566 | TMesh.RotateWork / TMesh.Rotate (permanent) |
| 1342:3518 | TPolyObject.Draw |
| 1342:287c | TPolyObject.Init |
| 1342:3018 | TPolyObject.AddQuad |
| 1342:1d6d | TFace.SetExtra(texA, texB) |
| 1342:2b08 | TPolyObject.FreeFaceTextures |
| 1342:3bc4 / 3ce1 | TStarfield.Init / TStarfield.Move(speed) ; VMT+0x10 = DrawAll (377c) ; VMT+0xc = DoneFree |
| 1342:3ec7 / 4080 | TExplosion.Init / Step ; VMT+0x10 = Draw (40c4) |
| 1cbc:00a7 / 00ce | mark(var t) / elapsed(var t): int32 ticks (10 ms) |
| 0d6d:0333 | setMusicVolume(v) (only if musicOff DS:54e5 == 0) |
| 1d81:3d77 / 4993 | Move ; 028a / 029f GetMem / FreeMem ; 3d8f longint mul ; 3275 Round (half even) ; 31e5 / 320f Real48 <-> ST0 ; 32ba / 32bf Sin / Cos ; 32d3 constructor prologue |

### Globals used

| DS | type | name |
|---|---|---|
| 255e | byte | pageBase: 100 with EMS, 0 without. Pages used: P2 = pageBase+2, P3 = pageBase+3, P4 = pageBase+4 |
| 2620 | TStarfield (static object, VMT 241a, 0x61 bytes) | `stars` |
| a38c | timer record | partStart (PartInit) |
| a394 | timer record | sceneStart |
| a3a4/a3a6 | int32 | `el` (scratch global: elapsed time of the current loop) |
| a3a8/a3aa | int32 | `tmp` (scratch global) |
| 5a8f | byte | star draw mode (0 dot, 1 plus, 2 streak) |
| 5a90 / 5a92 | int16 | star brightness min / max (clamp) |
| 9118 | int16 | streak length for star mode 2 |
| 5c2e/5c30 | far ptr | page[1] pointer (page table DS:5c2a + 4*1) |
| 5d98 | pal | shadow palette |
| 8578 / 8b1a | int16[721] | sinI / cosI (round(sin/cos(deg)*128)) |
| 9122 | int32[] | lineOfs (y*320) |
| 54e5 | byte | musicOff |

---

## 0000:3f83 Part5 (near, no args, `enter 0x1eee`)

Locals: palA [bp-0x1ed6], palB [bp-0x12d6], palC [bp-0x18d6], palD [bp-0x6d6], palF [bp-0xcd6] (0x600 bytes each,
copies of the shadow palette); sphere1 far ptr [bp-0x1eda]; sphere2 [bp-0x1ede]; explosion object [bp-0xaa]
(TExplosion, 0x5b bytes, on the stack); comet [bp-0xd6] (TBigPixel, on the stack); `speed` int32 [bp-8];
flags f1 [bp-0x1edf], f3 [bp-0x1ee1], f4 [bp-0x1ee2] (bytes); [bp-0x1ee0] unused; [bp-0x10] = 100 (unused);
[bp-0x34..-0x30], [bp-0x3a..-0x36], [bp-0x4c..-0x48] are zeroed but never used.

Float32 constants (code segment 0000): cs:3f4b 200.0, 3f4f 750.0, 3f53 500.0, 3f57 120.0, 3f5b 240.0, 3f5f -180.0,
3f63 6.25, 3f67 -80.0, 3f6b 50.0, 3f6f 4450.0, 3f73 1500.0, 3f77 800.0, 3f7b 10.0, 3f7f 140.0.

Notation: `R(x)` = Round half-even of an extended value -> int32 (1d81:3275), `f32()` = store as float32. Every
`el*K` product is a 32-bit int multiply (1d81:3d8f) loaded with `fild dword`, then divided by a float32 constant
in extended precision. `P2/P3/P4` = pageBase+2/3/4.

### Setup
```
setMode(0)
PartInit()                                          // partStart = now
// palette A (also the palette that is on screen until S0)
gradient(0, 120,   0,0,0,   0,0,63)
gradient(120, 200, 0,0,63,  63,63,63)
gradient(200, 255, 63,63,63, 0,0,63)
palA = shadow
loadPCX(P2, 0x1d)                                   // item 28 = Jupiter; P2 becomes active; PCX palette -> DAC + shadow
remapRange(P2, 1, 100, 155)                         // pixels 1..100 -> 156..255, palette entries rotated by 155 in [1..255]
gradient(0, 120,  0,0,0,   40,40,63)
gradient(120, 150, 40,40,63, 63,63,63)              // (byte)-0x6a = 150
palB = shadow                                       // 0..150 gradient, 151..255 = rotated PCX palette (Jupiter colours at 156..255)
loadPCX(P3, 0x1e)                                   // item 29 = Earth
remapRange(P3, 1, 100, 155)
gradient(0, 120,  0,0,0,   40,40,63)
gradient(120, 150, 40,40,63, 63,63,63)
palC = shadow                                       // same layout, Earth colours
repackPage(P2, 256, 200); repackPage(P3, 256, 200)  // both textures to stride 256 (texture mapper format)
sphere1 = new TSphere(radius 54.0, n 12, flags 0x203, page P2)   // 0e5a:1cf5, VMT DS:0cce; Real48 (0x86,0,0x5800) = 54.0
sphere2 = new TSphere(radius 60.0, n 12, flags 0x203, page P3)   // Real48 (0x86,0,0x7000) = 60.0
sphere2.Rotate(0.0, 0.0, 180.0)                     // permanent, about pivot (0,0,0): turns the Earth upright
setActivePage(1)                                    // page 1 was freed by the previous part -> newly allocated, zero-filled
SetPerspective(200)
setClip(2, 0, 319, 199)                             // NOTE: left clip x = 2 for the whole part (until 3921's PartInit)
gradient(0, 180, 0,0,0, 0,0,63); gradient(180, 255, 0,0,63, 63,63,63)
palD = shadow                                       // the "warp" palette
gradient(0, 120, 0,0,0, 0,0,63); gradient(120, 230, 0,0,63, 63,63,63); gradient(230, 255, 63,63,63, 63,63,63)
                                                    // palette E: this is now in the DAC (black->blue->white, white from 230)
TStarfield.Init(&stars /*DS:2620*/, VMT 241a, count 100, minB 0, maxB 255)   // Random() order as in L4
TExplosion.Init(&expl, VMT 2436, count 500)
TPixel.Init(&comet, VMT 23aa /*TBigPixel*/, 120.0, 245.0, 0.0, color 200)
speed = 10 (int32)
DS:5a8f = 0 (dot stars); DS:9118 = 0
f1 = f2 = f3 = f4 = 0
palF = shadow                                       // = palette E
el = elapsed(partStart)                             // value unused
```
The gradient byte args: `push -0x38` = 200, `push -1` = 255, `push -0x4c` = 180, `push -0x1a` = 230.

### S0: starfield fade-in (until partStart > 7.5 s)
```
mark(sceneStart)
do {
  el = elapsed(sceneStart)
  if (PollKey()) break                                          // -> S1 setup (43c6)
  if (el < 200) {                                               // signed int32
     o = int16( R(el*60 / 200.0) - 60 )                         // -60 .. 0
     setPaletteOffset(palF, 0, 255, o, o, o)
  }
  stars.Move(10); stars.DrawAll()
  blur()
  present()
} while (!(float(elapsed(partStart)) > 750.0))                  // fild int32, fcomp float32 750.0
```

### S1 (sceneStart, 50 s)
```
setPalette(palF)
mark(sceneStart)
do {
  el = elapsed(sceneStart)
  if (PollKey()) break                                          // -> 48fc
  stars.Move(int16(speed)); stars.DrawAll()                     // with the star mode/limits set on the PREVIOUS frame
  if (el < 1500) {
    if (el <= 500) {                                            // S1a
      cx = f32(120.0 - (el*120)/500.0); cy = f32(240.0 - (el*240)/500.0)
      comet.SetPos(cx, cy, 0.0); comet.Draw()                   // TBigPixel.Draw -> drawDot(sx, sy, 200) (colours 200,201,202)
      ex = f32((el*180)/500.0 + -180.0)
      ey = f32(((el*el) /*int32*/ / 6.25) / 500.0 + -80.0)
      expl.MoveTo(ex, ey, 0.0)
    } else {                                                    // S1b
      expl.Step()                                               // frame counter++ and pos += velocity
      DS:5a90 = 150                                             // star min brightness
    }
    expl.Draw()                                                 // VMT+0x10 = 1342:40c4
    blur()
  } else {                                                      // el >= 1500
    if (!f1) { stepFadeInit(0, 255, palD, 100); f1 = 1 }
    stepFadeStep()
    DS:5a8f = 2                                                 // streak stars from the next frame on
    tmp = el
    if (f4) {                                                   // S1d second half (el >= 4450 seen on an earlier frame)
      if (!f3) { clearActive(); f3 = 1; speed = 10; DS:9118 = 5; DS:5a90 = 60 }
      if (tmp > 4500) tmp = 4500
      if (el <= 4600) {
        o = int16( 64 - R(((tmp - 4500 + 50)*64) / 50.0) )     // 64 at tmp 4450 .. 0 at tmp 4500
        setPaletteOffset(palD, 0, 255, o, o, o)                 // white -> palD
      }
      blurDecay(1)
    } else if (el >= 4400) {                                    // S1d first half: fade to white
      o = int16( R(((el - 4400)*64) / 50.0) )
      setPaletteOffset(palD, 0, 255, o, o, o)
      if (float(el) >= 4450.0) { tmp = el; f4 = 1 }
      blur()
    } else {                                                    // S1c: warp ramp
      DS:5a90 = int16( R(((el-1800)*155) / 500.0) + 150 )
      DS:9118 = int16( R(((el-1800)*50) / 200.0) )
      speed   = R(((el-1800)*60) / 1500.0) + 10                 // int32
      if (speed < 10) speed = 10;  if (speed > 60) speed = 60    // signed int32
      if (DS:9118 < 0) DS:9118 = 0; if (DS:9118 > 50) DS:9118 = 50   // signed int16
      if (DS:5a90 < 0) DS:5a90 = 0; if (DS:5a90 > 255) DS:5a90 = 255
      blur()
    }
  }
  present()
} while (el < 5000)
```
Notes:
- S1a: the comet goes from (120,240) at el 0 to (0,0) at el 500 (z = 0, so screen = (x+160, y+100); it is
  off-screen until y < 100, about el 292). The explosion cluster goes from (-180,-80) to (0,0) on a parabola in y.
  They meet at the centre at el = 500, where the explosion starts (Step begins at el 501). The comet is not drawn
  after el 500; its trail decays through blur().
- The explosion particle layout comes from Random (L4 TExplosion.Init), so it differs per run.
- Before el 1500 the palette is palette E. The 100-step fade to palD starts at el 1500 (one step per frame).
- DS:9118 and DS:5a90 are negative for el < 1800 and get clamped to 0; speed stays 10 until el 1800.
- At el 4400..4450 the palette ramps to white (+64 offset, all entries clamp at 63). From the first frame with f4,
  page 1 is cleared once and the palette ramps back to palD between tmp 4450 and 4500, held for el <= 4600.

### S2 (5 s): dim the warp, fade to palette B
```
mark(sceneStart)
comet.Done(0)                 // VMT+8 (TObject.Done); memory only
expl.DoneFree(0)              // VMT+0xc; memory only
stepFadeInit(0, 255, palB, 50)
setActivePage(1)
DS:5a8f = 2
do {
  el = elapsed(sceneStart)
  if (PollKey()) break
  if (DS:5a90 > 30)  DS:5a90 -= 2          // 60 -> 30
  if (DS:5a92 > 150) DS:5a92 -= 2          // 255 -> 149
  stepFadeStep()
  stars.Move(int16(speed)); stars.DrawAll()
  blurDecay(1)
  present()
} while (el <= 500)
```

### S3 (18 s): the two spheres
```
mark(sceneStart)
sphere1.Translate(0.0, 0.0, -8000.0)       // float32 0xc5fa0000
sphere1.Rotate(0.0, -20.0, 0.0)            // permanent, about its pivot (now at its centre)
sphere2.Translate(0.0, 0.0, -7900.0)       // float32 0xc5f6e000
setActivePage(P4)                          // new page, zero-filled
copyPage(1, P4)
f1 = 0
do {
  el = elapsed(sceneStart)
  if (PollKey()) break
  setActivePage(P4)
  stars.Move(int16(speed)); stars.DrawAll()   // the stars live on P4, with their own decaying trails
  blurDecay(1)
  if (el < 800) {
    copyPage(P4, 1); setActivePage(1)
    tmp = 800 - el
    sphere1.MoveTo( f32((el*-70) / 800.0),
                    f32((el*50) / 800.0),
                    f32(200.0 - ((tmp*tmp)*10) / 800.0) )       // int32 products
    sphere1.RotateWork(0.0, f32((el*360) / 800.0 - 10.0), 0.0)
    sphere1.Draw()                                               // 1342:3518
  } else if (el > 1000 && el < 1800) {
    if (!f1) { setPalette(palC); f1 = 1 }
    copyPage(P4, 1); setActivePage(1)
    tmp = 1800 - el; if (tmp < 0) tmp = 0
    sphere2.MoveTo( f32(((el-1000)*100) / 800.0),
                    f32(((el-1000)*-30) / 800.0),
                    f32(200.0 - ((tmp*tmp)*10) / 800.0) )
    sphere2.RotateWork(0.0, f32(((el-1000)*360) / 800.0 - 140.0), 0.0)
    sphere2.Draw()
  }
  present()                                // shows page 1, or P4 directly when no sphere branch ran
} while (el < 1800)
```
- The sphere z goes from -7800 to 200 (= D) on a parabola, so the sphere rushes at the camera. At z >= 200 every
  face is culled (Perspective fails).
- During sphere 1 the palette is palB (Jupiter colours at 156..255; stars use 0..150). From el 1000 it is palC.

### S4 (until partStart >= 88 s)
```
stepFadeInit(0, 255, palA, 50)
setActivePage(1)
DS:5a8f = 2
do {
  el = elapsed(partStart)               // note: the PART clock
  if (PollKey()) break
  if (DS:5a90 < 200) DS:5a90 += 2       // 30 -> 200
  if (DS:5a92 < 255) DS:5a92 += 2       // 149 -> 255
  if (DS:9118 < 10)  DS:9118++          // streak length up to 10
  stepFadeStep()
  stars.Move(int16(speed)); stars.DrawAll()
  blur()
  present()
} while (elapsed(partStart) < 8800)     // re-read, unsigned/signed int32 compare
```
### Teardown
```
[bp-4] = 0 (unused)
stepFadeFree()
freePage(P4); freePage(P3); freePage(P2)
Part5_Tunnel()                          // 0000:3921
sphere1.FreeFaceTextures(); sphere2.FreeFaceTextures()
sphere1.DoneFree(1); sphere2.DoneFree(1)     // VMT+0xc, memory only
```
Star state handed to 3921: mode 2 (streak), DS:9118 = 10, DS:5a90 = 200, DS:5a92 = 255, page 1 active.

---

## 0e5a:1cf5 TSphere.Init(R: Real48; n: int16; flags: word; page: byte), constructor, `retf 0x12`

Stack: R = Real48 [bp+0x12] (ax), [bp+0x14] (bx), [bp+0x16] (dx); n = [bp+0x10]; flags = [bp+0xe];
page = byte [bp+0xc]; VMT = [bp+0xa] (DS:0cce: size 0x94, Done 1342:2906, DoneFree 1342:29cf, so a TPolyObject
with no new methods); self = [bp+6]. Returns self in DX:AX (allocated by the RTL prologue 1d81:32d3 when self = nil,
which is the case for both calls here). If the prologue fails (no memory) it returns at once.

Extended constants: cs:1ce1 = 2*pi = 6.283185307179586, cs:1ceb = pi = 3.141592653589793.

Locals (Real48 unless noted): dPhi [bp-0x26], ringR [bp-0xe], ringY [bp-0x14], prevR [bp-0x20], prevY [bp-0x1a],
a1 [bp-0x2c], a0 [bp-0x32]; int16: i [bp-2], j [bp-4], du [bp-0x6c], dv [bp-0x6e]; Vec3 (3 x float32):
V1 [bp-0x62], V2 [bp-0x4a], V3 [bp-0x56], V4 [bp-0x3e].

```js
TPolyObject.Init(self, limit = (n*n) & 0xffff, flags, minColor = 100, maxColor = 250)  // VMT arg 0
dPhi  = R48(2*PI / n)                       // fild n; fld 2pi; fdivrp -> 2pi/n
ringR = 0.0;  ringY = R                     // Real48
du = trunc(256 / n);  dv = trunc(200 / n)   // signed 16-bit idiv: n=12 -> du 21, dv 16
for (i = 1; i <= n; i++) {                  // latitude bands, from +y pole to -y pole
  prevR = ringR; prevY = ringY
  ringR = R48( R * sin((i*PI)/n) )          // all in extended, PI from cs:1ceb, then rounded to Real48
  ringY = R48( R * cos((i*PI)/n) )
  for (j = 1; j <= n; j++) {                // longitude
    a1 = R48(dPhi * j)
    a0 = R48(dPhi * (j-1))
    V1 = { x: f32(prevR*cos(a0)), y: f32(prevY), z: f32(prevR*sin(a0)) }   // MakeVec 1342:03ef
    V2 = { x: f32(ringR*cos(a1)), y: f32(ringY), z: f32(ringR*sin(a1)) }
    V3 = { x: f32(prevR*cos(a1)), y: f32(prevY), z: f32(prevR*sin(a1)) }
    V4 = { x: f32(ringR*cos(a0)), y: f32(ringY), z: f32(ringR*sin(a0)) }
    face = self.AddQuad(V1, V3, V2, V4)     // 1342:3018: vertex order (prev,a0) (prev,a1) (ring,a1) (ring,a0)
    tex  = NewTexture(page, u0 = ((j-1)*du) & 0xffff, v0 = ((i-1)*dv) & 0xffff, w = du, h = dv)
    face.SetExtra(tex, tex)                 // front and back texture the same
  }
}
return self
```
- The texture is a 256-stride page (repackPage to 256 first). Face (i, j) maps texels u0..u0+w-1, v0..v0+h-1:
  with TexQuad, vertex 1 = (0,0), 2 = (w-1,0), 3 = (w-1,h-1), 4 = (0,h-1). n = 12: u 0..251, v 0..191.
- Vertex dedup: AddFace (inside AddQuad) uses AddUnique (flags has no 0x100), so equal positions are merged. In band
  i = 1, V1 and V3 are both the pole (0, R, 0), so the face's v1 and v2 become the same TPixel (the face still has
  n = 4 and is drawn as a 4-point polygon with two equal points).
- flags 0x203: face flags byte 3 = textured, no shading, single-sided (backface culled, DS:5a9c = 0); 0x200 = no
  depth sort, so the faces are drawn in creation order (band 1 j 1..12, band 2 ...). Faces get colours 100, 101, ...
  (unused by type 3).
- With y down on screen, band 1 (+y) is at the BOTTOM of the screen, so the texture appears upside down unless the
  object is rotated. Sphere 2 gets Rotate(0,0,180) for that; sphere 1 (Jupiter) is not flipped.
- Float exactness: Real48 rounds every stored angle and ring value to a 40-bit mantissa; then the products are done in
  extended and stored as float32. Doubles + Math.fround give the same float32 values except in rare tie cases (GUESS).

---

## 0000:3921 Part5_Tunnel (near, no args, `enter 0x62c`)

Locals: savedPal [bp-0x61e]; buf far ptr [bp-0x1e] (GetMem 0x55f0); tabRad ptr [bp-0x1a]; tabAng ptr [bp-0x16];
tabMul ptr [bp-0x12]; xs [bp-4], ys [bp-6], ysStep [bp-8] = 2, fade [bp-0xc] (int16), twist [bp-0x620] (word),
m byte [bp-0x621], vol [bp-0x624].
Float constants (code seg 0000): cs:38ff 5.0, 3903 220.0, 3907 20.0 (float32), cs:390b 0.42 (extended),
3915 500.0, 3919 800.0, 391d 64.0 (float32).

### Tables and precompute (64 frames)
```
PartInit()                                    // partStart = now (~261.0 s); clip back to (0,0,319,199)
savedPal = shadow
loadPCX(P2, 0x20)                             // item 31 = cloud texture, stays 320-stride (NOT repacked)
setPalette(savedPal)                          // undo the PCX palette (palette A from S4 stays)
setActivePage(1)
buf    = GetMem(0x55f0)
tabRad = GetMem(0x4000)                       // byte [256][64]
tabAng = GetMem(0x282)                        // word [321]
tabMul = GetMem(0x2000)                       // word [64][64]
for (j = 0; j <= 63; j++) {                   // one frame per j
  for (i = 0; i <= 63; i++) tabMul[i*64 + j] = (i*j) & 0xffff
  for (k = 0; k <= 255; k++)
    tabRad[k*64 + j] = R( ((220.0 - k/5.0) * 20.0) / (j + 20) ) & 0xff   // extended math, int j+20 via fild dword
  if (PollKey()) break
  stars.Move(10); stars.DrawAll(); blur(); present()
}
for (k = 0; k <= 320; k++) tabAng[k] = trunc((k*9) / 8)   // 16-bit imul, signed idiv: degrees 0..360
Move(tabRad -> buf+0, 0x4000); Move(tabAng -> buf+0x4268, 0x282); Move(tabMul -> buf+0x4650, 0x2000)
FreeMem the three small blocks; tabRad = buf, tabAng = buf+0x4268, tabMul = buf+0x4650 (same segment)
```
tabRad[k][r] (k = texel value, r = depth 0..63) = round((220 - k/5) * 20 / (r+20)): 220 at k=0,r=0, ~41 at k=255,r=63.
The precompute is not timed: the original runs exactly 64 warp frames at whatever speed the CPU allowed (it was
roughly one second in the capture; the following phases are clock-based, so a port can run these 64 frames at 70 Hz).

### Closing borders (until partStart >= 7 s)
```
xs = 0; ys = 0; ysStep = 2; fade = 210; twist = 0
tmp = elapsed(partStart)                      // t0
do {
  el = elapsed(partStart)
  if (PollKey()) break                        // -> tunnel setup
  stars.Move(10); stars.DrawAll(); blur()
  m = R( ((el - tmp)*10) / (700 - tmp) ) & 0xff     // int32 operands, both via fild dword, fdivp
  if (m > 10) m = 10                          // unsigned byte
  fillRect(0, 200 - m, 319, 199, 0)           // bottom: m rows (m = 0 still paints row 199, see L1 fillRect)
  fillRect(0, 0, 319, 2*m, 0)                 // top: rows 0..2m
  fillRect(320 - 2*m, 0, 319, 199, 0)         // right: 2m columns (m = 0 paints column 319)
  fillRect(0, 0, m, 199, 0)                   // left: columns 0..m
  present()
} while (el < 700)
```
At m = 10 the borders equal the fixed borders of the tunnel phase.

### Tunnel loop (until partStart > 35 s)
```
mark(sceneStart)
do {
  el = elapsed(sceneStart)
  if (PollKey()) break
  setActivePage(1)
  if (fade < 50) clearActive()                       // signed int16
  if (fade > 30) { stars.Move(10); stars.DrawAll() } // streak stars, still mode 2
  if (el <= 500) {
    tmp = 500 - el
    if (tmp > 0) fade = int16( R( ((tmp*tmp) * 0.42) / 500.0 ) )   // int32 square, extended 0.42, float32 500
    else         fade = 0
    if (fade < 0) fade = 0
  }
  Tunnel(tex = getPage(P2), dst = page[1] /*DS:5c2e*/, xs, ys, fade, twist, tabRad, tabAng, tabMul)   // 0000:37c3
  blur()
  fillRect(0, 190, 319, 199, 0); fillRect(0, 0, 319, 20, 0)
  fillRect(300, 0, 319, 199, 0); fillRect(0, 0, 10, 199, 0)
  present()
  ys += ysStep                                       // 2 per frame
  if (el > 600)  xs++
  if (el > 900)  xs++
  if (el > 1200) xs++
  if (el > 1500) xs++                                // rotation speed 0..4 per frame
  if (xs > 320) xs -= 320;  if (xs < 0) xs += 320    // note > not >=: xs may be 320
  if (ys > 200) ys -= 200;  if (ys < 0) ys += 200
  if (el > 1400 && twist < 60) twist += 4            // unsigned compare; 15 frames to reach 60
  if (el > 2000) {
    setActivePage(P2)
    blurDecay(2)                                     // the TEXTURE itself smears and darkens each frame
    fade--                                           // becomes negative: the rings grow outward
    addPalette(0, 255, -1, -1, -1)                   // cumulative: black after ~64 frames
    vol = int16( R(64.0 - ((el - 2000)*64) / 800.0) ); if (vol < 0) vol = 0
    if (!musicOff /*DS:54e5*/) setMusicVolume(vol & 0xff)    // 0d6d:0333
  }
} while (elapsed(partStart) <= 3500)                 // re-read; ja 0xdac
clearScreen()
FreeMem(buf, 0x55f0)
DS:9118 = 1; DS:5a8f = 1                             // star defaults for later parts
stars.DoneFree(0)                                    // VMT+0xc
freePage(P2); freePage(1)
```
- fade starts at 210 (tmp 500: 250000*0.42/500 = 210): every radius is reduced by 210, so the tunnel starts as a small
  blob and opens up over 5 s. After el 500 the value stays at its last computed value (0 when the last frame had
  el = 500 exactly, otherwise usually 0 or 1).
- The palette is palette A (from S4). Tunnel colours are <= 240.
- addPalette starts at el > 2000 (about 288 s): one step per frame, so the image is black about 64 frames later. The
  remaining ~6 s until partStart > 3500 are black.

---

## 0000:37c3 Tunnel (near, `ret 0x1c`)

Args (near proc, last arg at [bp+4]):
| slot | name |
|---|---|
| [bp+0x1c]/[bp+0x1e] | tex: far ptr (loaded as FS:SI) = getPage(P2), 320-stride cloud picture |
| [bp+0x18]/[bp+0x1a] | dst: far ptr (ES:DI base) = page[1] |
| [bp+0x16] | xs (int16, 0..320) |
| [bp+0x14] | ys (int16, 0..200) |
| [bp+0x12] | fade (int16) |
| [bp+0x10] | twist (word, 0..60) |
| [bp+0xc]/[bp+0xe] | tabRad (offset; its segment loaded into GS and used for all three tables) |
| [bp+8]/[bp+0xa] | tabAng (offset) |
| [bp+4]/[bp+6] | tabMul (offset) |

```js
for (r = 60; r >= 1; r--) {                         // far rings first
  row = ys + r; if (row >= 200) row -= 200          // signed
  rowOfs = lineOfs[row] & 0xffff                    // = row*320
  for (c = 320; c >= 1; c--) {
    col = xs + c; if (col >= 320) col -= 320        // can still be 320 when xs = 320 (reads the next row's first byte)
    t = tex[(rowOfs + col) & 0xffff]                // byte (texel = height and brightness)
    v = tabRad[t*64 + r] - fade                     // 16-bit
    if (!(v > 0)) v = 0                             // signed
    colr = ((60 - r) * t) & 0xffff; colr >>= 5      // unsigned 16-bit mul, shr
    if (colr >= 240) colr = 240
    a = (tabMul[twist*64 + r] /* = twist*r */ >> 4) - c    // shr (unsigned), then signed
    if (!(a > 0)) a += 320                          // a in 1..320
    ang = tabAng[a]                                 // = (a*9)>>3 style trunc, 1..360 degrees
    x = (int16)((cosI[ang] * v) & 0xffff) >> 7      // imul word: only the LOW 16 bits of the product, then sar 7
    y = (int16)((sinI[ang] * v) & 0xffff) >> 7      // cosI = DS:8b1a, sinI = DS:8578
    x += 160; y += 100
    if (x < 0 || x > 309 || y < 0 || y > 192) continue   // signed
    p = (lineOfs[y] + dst.off + x) & 0xffff
    // 10x8 block, see the EAX note below
    for (k = 0; k < 8; k++, p += 320) { write 10 bytes at dst[p] }
  }
}
```
Product overflow: with fade negative (after el > 2000), v can exceed 256, and `cosI*v` (|cosI| <= 128) overflows
16 bits once |cos*v| > 32767. The original keeps only the low word, so the point wraps to a wrong position. Emulate
the int16 wrap (it happens in the last seconds, while the palette is already fading).

**Block bytes (the EAX high-word quirk).** The fill is
`mov ax,colr; mov ah,al; mov edx,eax; shrd eax,edx,16; stosd; stosd; stosw` per row. SHRD gives
`eax = (colr16 << 16) | eaxHi_old`, so each row of the block is
`[H, H, C, C, H, H, C, C, H, H]`, where C = colr and `H` (two bytes, low then high) = the high word EAX had before.
After a block, EAX's high word is C:C, so for every block except the first one of a call, H = the PREVIOUS block's
colour (both bytes). Nothing else in this routine touches the upper half of EAX. For the first block of a call, H is
whatever was left by the previous code in the frame:
- clearActive() (`xor eax,eax; rep stosd`) sets it to 0. It runs every frame once fade < 50.
- line() (186a:176d, used by streak stars while fade > 30) leaves the 32-bit idiv quotient of the last sloped line in
  EAX (high word = the integer part of that slope, GUESS: usually 0 or 0xFFFF).
- otherwise the previous frame's last block colour carries over (blur, fillRect, present do not touch EAX's upper half).
- An interrupt handler (timer, music) could also change it (unknown).
Port suggestion: keep a global `eaxHi`; set it to 0 in clearActive, and to `C*0x101` after each block; ignore the
line() case (GUESS: the visual difference is a few 2-pixel columns during the first 0.3 s, which blur() smooths).
The visible result: each block has 2-pixel stripes in the colour of the block drawn just before it.

Pixel layout: linear 320-wide page 1 (dst), no clipping beyond the x <= 309 / y <= 192 test. Blocks overlap; the last
written wins (order r = 60..1, c = 320..1, so near rings (small r, big radius) are drawn last).

---

## Porting notes
- All loops are clock-driven except the 64-frame precompute in 3921. The original frame rate (CPU-bound, no vsync)
  matters for per-frame steps: stepFadeStep (100 / 50 / 50 steps), the S2/S4 brightness ramps, the starfield speed,
  blur/blurDecay strength, twist (+4/frame), xs/ys (per frame), fade-- and addPalette(-1) in the tunnel. GUESS: run
  at 70 frames per second.
- Page usage: page 1 = main drawing page; P2 = Jupiter texture (stride 256) in S0..S3, then the cloud texture
  (stride 320) in 3921; P3 = Earth texture; P4 = star layer in S3. Page 1 starts zero-filled (newly allocated).
- Random is used by TStarfield.Init/Move and TExplosion.Init (Randomize at startup, so it differs per run).
- Star drawing relies on DS:5a8f / 5a90 / 5a92 / 9118, which this part changes many times (see each scene). The values
  are only read inside stars.DrawAll(), so the order "DrawAll, then update the globals" means changes apply on the
  next frame.
- setClip(2, 0, 319, 199) is active from the setup until 3921's PartInit: nothing is drawn by the clipped routines in
  columns 0..1 (blur still runs over them).
