# P02: parts 0000:143e (flag picture, ESTEEM, "present") and 0000:1dab (EUPHORIA + starburst), helper 0000:1d08

Library names are from L1..L5 and P01 (PartInit = 0000:0000, loadPCX = 0e30:0223, LoadASC = 0e5a:01ab,
blur / blurDecay / buildBlendTable / blendPages = 179b:002f / 0097 / 0276 / 0110, timer mark / elapsed / waitUntil =
1cbc:00a7 / 00ce / 00f3). The 0e5a helpers 0068 GetWord, 011e SkipColon, 015a StrToInt and 01ab LoadASC are fully
described in L5 ("0e5a shared helpers"), and I checked that reading against the code. They are not repeated here.

## Summary

**0000:143e** (one near proc, no args, no nested procs, `enter 0x1e`)
1. **640x480 picture.** It switches to VESA 640x480 without clearing video memory and shows the hidden VESA page,
   where preload 0000:0697 put res/25.pcx (Israeli flag with "MOVEMENT '95"). It fades in from white over part
   ticks 0..100, holds, then fades to black over part ticks 370..600. It is back in mode 13h at about tick 600.
   **The reference capture does NOT show the flag.** The 640x480 frames are a uniform colour: palette index 0 of
   25.pcx, (0,0,101) in 8-bit RGB, going through the same white -> colour -> black fade. Rows 360..479 are one
   6-bit step darker during the fade. So the VRAM content was lost in the capture (GUESS: the emulator cleared VRAM
   on the mode-13h set in 0697). It is the port owner's choice: show 25.pcx (what the code intends) or a solid
   colour 0 (what the capture shows). See "Picture phase" below.
2. **Line wipe** (tick 700): a blue palette is set up and three horizontal lines are drawn directly on the
   mode-13h screen. Rows 99 and 101 grow from opposite sides in 1/3 s, then row 100 grows from both ends in 1/3 s.
3. **ESTEEM** (res/15.asc, 3D extruded text, 700 flat-shaded triangles) for 20 s. Each frame is drawn into page 1,
   blended into a feedback page with a 128x128 blend table (motion trail), blurred in place, and presented.
   - It starts edge-on as a thin line.
   - It thickens (y scale 0..40).
   - It tumbles -450 degrees about X while sinking.
   - It then swings into place facing the viewer.
4. **"present"** (res/16.asc) from part tick 3050. It rotates 0..180 degrees about X for 7 s with a trail (no blur), then the trail
   fades. The music volume fades to 0 over part ticks 3800..3900. The part ends at part tick 3900.
   There is no "blue gem" in this part. The brief's "EUPHORIA logo / blue gem" are in 1dab: a moon
   landscape, the EUPHORIA logo revealed left to right, and a glowing starburst of 120 random 3D lines.

**0000:1dab** (near proc, no args, `enter 0x86`): 25 s of part time.
- Two static pages: a moon landscape (res/27.pcx, blurred 4 times) and the EUPHORIA logo (res/26.pcx, colours
  8..11 moved to 251..254).
- A TWireMesh "starburst" (120 rays from a shared centre, white colour 254):
  - it flies left to right, rotating every frame;
  - it bursts to full size at 3.8..4.0 s;
  - it reveals EUPHORIA behind it (an OR-copy of the logo columns 0..x);
  - it flies back to the centre, collapses, re-expands, and the palette goes to white.
- Every frame works on page 1, which is never cleared:
  1. OR the logo in.
  2. Draw the lines.
  3. blurDecay(1) (a glow with decay).
  4. max-blend the landscape in.
  5. present().

**0000:1d08** orRevealColumns(src, dst, w): ORs the first `4*((min(w,319)>>2)+1)` columns of a 320x200 page into another.

### Timing correction to the brief's table (checked against the capture)
- 143e starts at about 46.12 s (the first line pixels appear at 53.12 s = part tick 700).
- It loops until **part tick 3900**, so 143e ends at about **85.15 s**, not 82.25 s. Main's `waitUntil(a384, 8225)`
  has already passed by then.
- 1dab runs from about **85.25 s** (first visible pixels at 85.30 s) to about **110.3 s** (white until 110.2 s, the next part at 110.4 s).
- The main-loop waits are lower bounds only. Each part runs on its own part clock (`DS:a38c`, reset by PartInit).

### Frame rate (no retrace wait anywhere in these loops; present() = 186a:14d1 without vsync)
Per-frame effects depend on the loop speed:
- the trail blend and blur;
- in 1dab, the 20-frame fade-in, the +4/frame white-out and Rotate(4,3,5) per frame.

Measured in the capture (70 Hz video):
- ESTEEM loop: about **20 fps** (41 distinct frames in 2 s).
- "present" loop: about **40 fps** (80 in 2 s).
- 1dab: about **47 fps** (the 20-step fade-in, +3 per frame, took about 28-30 capture frames).

The port should run these loops at those rates (or at a fixed rate and accept some differences).

## External calls (address -> meaning)

| call | meaning (source) |
|---|---|
| 0000:0000 | PartInit: mark(a38c), a3ac=0, setClip full screen, SetPerspective(200), ZeroVec(554a,554e,5552), LightDir.Update(0,0,0) (P01) |
| 186a:0229 | setModeNoClear(idx) (L1) |
| 186a:01a7 | setMode(idx) (L1) |
| 186a:07cf | addPalette(first,last,dr,dg,db) (L1) |
| 186a:04b4 / 04be / 04d1 | lockPalette / unlockPalette / setPalette(pal) (L1) |
| 186a:08bc | timedFade(first,last,dr,dg,db,steps,duration) (L1) |
| 186a:062a | gradient(a,b,r1,g1,b1,r2,g2,b2) (L1) |
| 186a:047d | setColor(i,r,g,b) (L1) |
| 186a:02e3 | setBorderColor(c) (L1) |
| 186a:1baf | setDisplayStart(x,y) (L1) |
| 186a:02f3 | setClip(x1,y1,x2,y2) (L1) |
| 186a:10e5 / 1071 / 114d | setActivePage / getPage / freePage (L1) |
| 186a:144f / 146e / 148d | clearActive / clearScreen / fillActive(c) (L1) |
| 186a:14d1 | present() (copy the active page to A000, no vsync) (L1) |
| 186a:14f3 | maxBlend(src, dst) (L1) |
| 186a:1522 | remapRange(page, lo, hi, shift) (L1) |
| 186a:185f | line(x1,y1,x2,y2,c) clipped (L1) |
| 186a:1634 | putPixel(x,y,c) (L1) |
| 186a:3a7e | PollKey(): ESC halts; returns byte DS:a3ac (L2) |
| 1342:0271 | SetPerspective(D) (L3) |
| 1342:0282 | ZeroVec(var x,y,z) (L3) |
| 1342:287c | TPolyObject.Init(limit, flags, minColor, maxColor) (L4) |
| 1342:1184 / 11b8 / 1377 | TMesh.ScaleUniform(f32) / Scale(Real48 x3, permanent) / ScaleWork(Real48 x3) (L3) |
| 1342:0ed1 / 0db6 / 1004 / 1082 | TMesh.Translate / MoveTo / SetPivot / Center (L3) |
| 1342:1466 / 1566 | TMesh.RotateWork / Rotate (permanent) (L3) |
| 1342:3518 | TPolyObject.Draw (L4) |
| 1342:1a74 / 1b2b / 1c3f | TWireMesh.Init / AddLine / DrawLines (L3) |
| VMT+0xc (`lcall [di+0xc]`) | DoneFree (TPolyObject 29cf with flag 1; TWireMesh 1af5 with flag 0, a stack object) (L3/L4) |
| 0e5a:01ab | LoadASC(resN 1-based, var mesh) (L5) |
| 0e30:0223 | loadPCX(page, resN 1-based); **side effect: the page becomes the active page**; sets the palette from the file (L5) |
| 179b:0276 / 0110 / 002f / 0097 | buildBlendTable(var T, k) / blendPages(srcPage, dstPage, var T) / blur() / blurDecay(d) (L5) |
| 1cbc:00a7 / 00ce / 00f3 | mark(var t) / elapsed(var t) / waitUntil(var t, Real48 ticks) (brief) |
| 0d6d:0333(v) | BWSB music volume. Called with 0xFF it returns the current volume in AL (GUESS: 0xFF = query, BWSB convention). Otherwise it sets the volume |
| 1d81:028a / 029f | GetMem / FreeMem |
| 1d81:3d8f | longint multiply |
| 1d81:3275 | Round (half-even) |
| 1d81:320f / 31e5 | ST0 -> Real48 / Real48 -> ST0 |
| 1d81:4677 | Random(n) |

## Globals used

| DS | type | meaning |
|---|---|---|
| a38c | int32 timer stamp | part start (set by PartInit). "P" below = elapsed(a38c) |
| a394 | int32 timer stamp | phase start, local to a loop. "T" in 143e loops = elapsed(a394) |
| a3a4/a3a6 | int32 | scratch "T" (the last elapsed value). Also used as a timedFade duration |
| a3ac | byte | key/abort flag. PartInit sets it to 0, 143e sets it to 0 again at 146b |
| 255e | byte | 100 with EMS, 0 without. Pages used: `1`, `X2 = [255e]+2`, `X3 = [255e]+3` |
| 2688 | {r,g,b:int16}[256] | the 25.pcx palette saved by preload 0697 (BSS) |
| 5c2e/5c30 | far ptr | page pointer table entry 1 (DS:5c2a + 4*1) = page 1 buffer |
| 554a/554e/5552 | f32 | "global angles" zeroed by PartInit. 143e zeroes them again; 1dab uses them as scale scratch |
| 54e5 | byte | 1 = music disabled (no fade code when 1) |
| 5a8f | byte | star draw mode: 1dab sets 2 (not used in 1dab; it persists for later parts) |
| 9118 | int16 | gradStep / streak length: 1dab sets 30 (not used in 1dab; it persists) |

## 0000:143e part_logos (near, no args), `enter 0x1e`

Locals:
| bp- | type | name |
|---|---|---|
| 0xc | far ptr | esteem (TPolyObject) |
| 0x10 | far ptr | present (TPolyObject) |
| 8 | far ptr | tab (16384-byte blend table, GetMem(0x4000)) |
| 0x16..0x12 | Real48 | thickFlag (0.0 until the permanent thickening is done, then 1.0) |
| 0x1a | int32 | vol0 (music volume at the start of the "present" phase) |
| 0x1e | int32 | FPU scratch |

Constants (code segment):
| addr | type | value |
|---|---|---|
| cs:1408 | f80 | 33.333333333333336 (=100/3) |
| cs:1412 | f32 | 5.0 |
| cs:1416 | f32 | 0.0 |
| cs:141a | f80 | 0.04 |
| cs:1424 | f32 | 1400.0 |
| cs:1428 | f32 | 200.0 |
| cs:142c | f32 | -56.0 |
| cs:1430 | f80 | 3.88888 (exactly the double 3.88888) |
| cs:143a | f32 | 100.0 |

On entry: mode 13h, palette = the previous part's palette +64 in the shadow (0cd6 ends with addPalette(0,255,64,64,64): white).

### Picture phase
```
PartInit()                                  // P = 0 now; clip 0,0,319,199; D = 200
setModeNoClear(2)                           // VESA 101h 640x480, VRAM kept; W,H = 640,480; centre 320,240
addPalette(0,255, 64,64,64)                 // shadow += 64 again (DAC clamps: white)
lockPalette()
setDisplayStart(0, 512)                     // show scanlines 512..991 = the hidden page with 25.pcx
[a3ac] = 0
setPalette(DS:2688)                         // locked: only the shadow is set (= 25.pcx palette)
addPalette(0,255, 64,64,64)                 // shadow = pic + 64 (locked, no DAC write)
unlockPalette()                             // DAC = clamp(pic+64)
dur = 100 - elapsed(a38c)                   // int32
timedFade(0,255, -1,-1,-1, 64, dur)         // busy loop: pic+64 -> pic, ends at P ~= 100
```
Port of the picture: show res/25.pcx 640x480 with its own palette, fading from `pal+64` to `pal`.
- The fade offset at time el is `Round(-el*64/dur)`, added to each component of the 6-bit palette and clamped to 0..63.
- In the capture, every pixel is index 0 instead (see the summary).

### Setup (runs right after the fade-in, at P ~= 100)
```
SetPerspective(150)
esteem = new TPolyObject(limit 700, flags 0x108, minColor 30, maxColor 70)   // VMT 23ea
     // face flags 0x08: flat fill, flat Lambert shading (1e1a), back-face culled; 0x100: no vertex dedup
LoadASC(0x10, &esteem)                       // res/15.asc "ESTEEM": 362 vertices, 700 triangles
esteem.ScaleUniform(0.6f)                    // f32 0x3f19999a = 0.6000000238418579
esteem.Translate(0, 20.0, 0)
esteem.Scale(0.9, 0.02, 1.0)                 // Real48 immediates: 0.8999999999996362, 0.020000000000010232, 1.0
                                             // about pivot (0,20,0)
esteem.Center()                              // origin = pivot = centroid of the work coords
esteem.MoveTo(-12.0, 0, 0)
tab = GetMem(0x4000)
buildBlendTable(tab, 50)                     // tab[new*128+old] = trunc((15*new + 50*old)/64)
setActivePage(1);  clearActive()
setActivePage(X2); clearActive()             // X2 = [255e]+2: the feedback/trail page
ZeroVec(554a,554e,5552)
setActivePage(0)                             // draw straight to A000 (the screen)
waitUntil(a38c, 370.0)                       // Real48 0x89/0/0x3900 = 370
dur = 600 - elapsed(a38c)
timedFade(0,255, -1,-1,-1, 64, dur)          // pic -> pic-64 (black) by P ~= 600
setDisplayStart(0,0)
setMode(0)                                   // mode 13h (BIOS clear); W,H = 320,200; centre 160,100; clip full
waitUntil(a38c, 700.0)                       // Real48 0x8a/0/0x2f00 = 700
gradient(0,  30,  0,0,0,    0,0,63)          // black -> blue
gradient(30, 63,  0,0,63,   63,63,63)        // blue -> white
gradient(63, 255, 63,63,63, 63,63,63)        // white (b pushed as -1 = 255)
```
ESTEEM model after setup:
- x is about -146..121, y is about -0.25..0.25 (thickness 0.49), z is -30..30 (letter height).
- It is centred at x = -12.
- The letters lie in the XZ plane, so seen from the camera (looking along -z) the object is a horizontal line at y = 0.

### Line wipe (drawn directly to the screen, page 0; no present, no vsync; colour 30 = (0,0,63), colour 50 = (38,38,63))
```
mark(a394)
do {
  T = elapsed(a394)                                   // int32 -> [a3a4]
  X = Round( (int32)(T*320) / 33.333333333333336 )    // extended divide, round half-even, low word
  line(0, 99, X, 99, 30)
  line(320 - X, 101, 320, 101, 30)                    // 16-bit subtract
} while (!(33.333333333333336 < T))                   // i.e. loop while T <= 33.33 (fcompp/jb)
mark(a394)
do {
  T = elapsed(a394)
  X = Round( (int32)(T*160) / 33.333333333333336 )
  line(0, 100, X, 100, 50)
  line(320 - X, 100, 320, 100, 50)
} while (T <= 33.333...)
setActivePage(X2)                                     // the trail page gets the 3 full lines
line(0,99,320,99,30); line(0,100,320,100,50); line(0,101,320,101,30)
```
I checked this against the capture: at 53.2 s row 99 covers x 0..77 and row 101 covers x 243..319 (9.6 px/tick).

### ESTEEM loop (20 s)
```
thickFlag = 0.0 (Real48)
mark(a394)
do {
  T = elapsed(a394)                                  // int32 [a3a4]
  PollKey(); if ([a3ac] != 0) break
  setActivePage(1); clearActive()
  if (T < 200)                                       // signed 32-bit
     esteem.ScaleWork(1.0, Real48(f(T)/5.0f), 1.0)   // y thickness x(T/5); work only
  else if (thickFlag == 0.0) {
     thickFlag = 1.0
     esteem.Scale(1.0, 40.0, 1.0)                    // permanent (Real48 0x86/0/0x2000 = 40)
  }
  if (T > 200 && T <= 1600) {
     esteem.MoveTo(-12.0, f32( (int32)(-(T-200)) * 0.04 ), 0)   // fild, extended 0.04 multiply, stored f32
     esteem.SetPivot(0, -8.0, 0)
     esteem.RotateWork(f32( (int32)(-(T-200)*450) / 1400.0f ), 0, 0)   // 0 .. -450 degrees about X
  } else if (T > 1600 && T < 1800) {
     esteem.MoveTo(-12.0, f32( (int32)((T-1600)*50) / 200.0f + (-56.0f) ), 0)   // y -56 -> -6
     esteem.SetPivot(0, -8.0, 0)
     esteem.RotateWork(-90.0, 0, 0)
  }
  // T in [1800, 2000): nothing; work keeps the last rotation (MoveTo would have reset it)
  esteem.Draw()                                      // into page 1
  blendPages(1, X2, tab)                             // X2[i] = tab[(page1[i]<<7) | X2[i]]
  setActivePage(X2)
  blur()                                             // in place on X2 (the feedback page)
  putPixel(319, 199, 0)                              // kill the pixel that blur read from beyond the page
  present()                                          // X2 -> screen
} while (T < 2000)                                   // signed 32-bit
esteem.DoneFree()                                    // VMT+0xc, flag 1
```
Notes:
- Comparisons are on the int32 T: `T < 200` means `hi < 0 || (hi == 0 && lo < 200 unsigned)`, and so on.
  The `T > 200 && T <= 1600` and `T > 1600 && T < 1800` bounds are exact as written (T = 200 gets neither branch, only Draw).
- With T in (0,200] the object is not rotated: it is seen edge-on, a line that thickens (the capture shows a dashed line at 53.9 s).
- The blend table with k = 50 sums to 65/64, so a static colour v converges to `15v/14` (at most 75 for v = 70), always < 128.
- The trail page X2 starts with the three wipe lines, which fade out through the blend and blur.

### "present" setup and loop
```
present = new TPolyObject(limit 300, flags 0x348, minColor 40, maxColor 63)
     // face flags 0x48: flat fill, flat Lambert, double-sided; 0x100 no dedup; 0x200 no depth sort
LoadASC(0x11, &present)                      // res/16.asc "Object01" = "present": 278 vertices, 270 triangles
present.ScaleUniform(0.6f)
present.Translate(0, 20.0, 0)
present.Rotate(-90.0, 0, 0)                  // permanent, about pivot (0,20,0)
present.Rotate(-90.0, 0, 0)                  // again: -180 total
present.Center()
present.MoveTo(0, -5.0, 0)
buildBlendTable(tab, 60)                     // tab[new*128+old] = trunc((5*new + 60*old)/64)
waitUntil(a38c, 3050.0)                      // Real48 0x8c/0/0x3ea0
mark(a394)
if ([54e5] == 0) vol0 = (int32)(0d6d:0333(0xFF) & 0xFF)     // current music volume (GUESS: the query form)
do {
  T = elapsed(a394)
  PollKey(); if ([a3ac] != 0) break
  setActivePage(1); clearActive()
  if (T <= 700) {                            // signed 32-bit
     present.RotateWork(f32(T / 3.88888), 0, 0)    // fild T / extended 3.88888, stored f32: 0..180 degrees
     present.Draw()
  }
  blendPages(1, X2, tab)                     // the trail continues from the end state of ESTEEM
  setActivePage(X2)
  present()                                  // NO blur, NO putPixel here
  if ([54e5] == 0) {
     P = elapsed(a38c)
     if (P >= 3800) {                        // 0xed8, signed 32
        P2 = elapsed(a38c)                   // read again
        v = Round( (int32)((3900 - P2) * vol0) / 100.0f )
        0d6d:0333(v & 0xFFFF)                // set the volume (low byte). If P2 > 3900, v = -1 -> 0xFF = a query, harmless
     }
  }
} while (elapsed(a38c) <= 3900)              // the part clock, read again
clearScreen()                                // A000 := 0
FreeMem(tab, 0x4000)
present.DoneFree()
freePage(X2); freePage(1)
```
- The model is flat in XZ, rotated by 180 degrees, so at T = 0 it is a line.
- At T = 350 (90 degrees) it faces the viewer; at T = 700 (180 degrees) it is edge-on again.
- After T = 700 page 1 stays empty, so X2 decays: `trunc(60*old/64)` per frame.
- I checked the capture: "present" appears at about 76.7 s, is upright at about 80 s, and is a faint line at 84 s.

## 0000:1d08 orRevealColumns(src [bp+0xa] far ptr, dst [bp+6] far ptr, w [bp+4] word) near, `ret 0xa`
Not nested. The caller pushes src, dst, w.
```
if (w == 0) return
cx = w; if (cx >= 320) cx = 319              // unsigned
skip = (320 - cx) & 0x1fc                    // computed, NEVER used
n = (cx >> 2) + 1                            // dwords per row
for (row = 0; row < 200; row++)
  for (k = 0; k < n; k++)                    // byte offsets row*320 + 4k .. +3
     dst32[row*80 + k] |= src32[row*80 + k]  // bitwise OR of 4 pixels
```
Columns 0 .. 4n-1 are ORed (w = 1..3 gives 4 columns; w = 300 gives 304 columns).

## 0000:1dab part_euphoria (near, no args), `enter 0x86`

Locals:
| bp- | type | name |
|---|---|---|
| 0x78 | TWireMesh (0x67 bytes, static on the stack, VMT 23ca) | wire. `[bp-0x6c]` = wire+0x0c = origin.work.x |
| 0xc | int32 | size = 70 |
| 4 | int32 | i: the AddLine loop counter, then the fade-in frame counter |
| 0x7a | word | revealW |
| 0x7b | byte | burstDone |
| 0x82..0x86 | | FPU scratch |

Constants (code segment):
| addr | type | value |
|---|---|---|
| cs:1d5d | f32 | 1182.0 |
| cs:1d61 | f32 | -280.0 |
| cs:1d65 | f32 | -160.0 |
| cs:1d69 | f32 | 380.0 |
| cs:1d6d | f80 | 0.2 |
| cs:1d77 | f32 | 1542.0 |
| cs:1d7b | f80 | 2.57 |
| cs:1d85 | f32 | 140.0 |
| cs:1d89 | f32 | 50.0 |
| cs:1d8d | f32 | 1.0 |
| cs:1d91 | f32 | 0.0 |
| cs:1d95 | f80 | 0.001 |
| cs:1d9f | f32 | 2252.0 |
| cs:1da3 | f32 | 30.0 |
| cs:1da7 | f32 | 2304.0 |

"P" = elapsed(a38c) = part ticks; all the timing here uses the part clock.

### Setup
```
PartInit()                                   // D = 200, clip 0,0,319,199
setClip(2, 0, W-1, H-1)                      // left clip 2 (only the line drawing is clipped by this)
setActivePage(1)                             // allocated; it stays as it is (black from the previous part / zero-filled when new)
loadPCX(X3, 0x1c)                            // res/27.pcx moon landscape -> page X3 = [255e]+3; X3 becomes active
blur(); blur(); blur(); blur()               // on X3
loadPCX(X2, 0x1b)                            // res/26.pcx EUPHORIA logo (indices 0..11) -> X2; X2 becomes active
remapRange(X2, 8, 12, 243)                   // pixels 8..12 -> 251..255; rotatePalette(8, 255, 243)
setActivePage(1)
gradient(0,   200, 0,0,0,    0,50,63)        // black -> cyan (b pushed as -0x38 = 200)
gradient(200, 249, 0,50,63,  63,63,63)       // cyan -> white (-7 = 249)
gradient(249, 254, 63,63,63, 63,63,63)       // white (-2 = 254)
size = 70
wire.Init(limit 120, color 254)              // 1342:1a74, VMT 23ca, self = &[bp-0x78]
for (i = 1; i <= 120; i++) {                 // int32 counter
   r1 = Random(140) - 70                     // Random(low word of size*2); result as int16 (-70..69)
   r2 = Random(140) - 70
   r3 = Random(140) - 70                     // evaluation order r1, r2, r3 (push order)
   wire.AddLine(0,0,0, r1,r2,r3)             // all rays share the vertex (0,0,0) (AddUnique dedup)
}
wire.ScaleUniform(0.01f)                     // f32 0x3c23d70a = 0.009999999776482582 -> rays of length <= ~1.2
wire.Translate(-320.0, 0, 0)                 // origin = pivot = (-320,0,0)
[5a8f] = 2; [9118] = 30                      // global state for later parts (unused here)
setColor(255, 0,0,0)
setBorderColor(255)
addPalette(0, 254, -60,-60,-60)              // shadow 0..254 -= 60: all black
revealW = 0; i = 0 (int32); burstDone = 0
```
- Randomness: BP Random (LCG). The seed depends on Randomize/earlier calls, so the exact ray directions cannot be matched to the capture. Any 120 rays with integer components in -70..69 will do.
- Resource numbers are 1-based. I checked them: 0x10 = 15.asc "ESTEEM", 0x11 = 16.asc ("present"), 0x1b = 26.pcx EUPHORIA,
  0x1c = 27.pcx moon landscape.
- Palette entry 255:
  - remapRange's rotatePalette sets it to 26.pcx's colour 12;
  - setColor(255,0,0,0) then makes it black;
  - it is the border colour.
- The 26.pcx and 27.pcx palettes are irrelevant: the gradients overwrite 0..254.

### Main loop
```
do {
  P = elapsed(a38c)                          // [a3a4]
  if (PollKey() != 0) break                  // AL = [a3ac]
  setActivePage(1)                           // page 1 is NEVER cleared: it is a feedback buffer
  orRevealColumns(getPage(X2), page[1] (DS:5c2e), revealW)    // uses LAST frame's revealW
  if (i < 20) { addPalette(0, 254, 3,3,3); i++ }              // 20-frame fade-in (frame-count based)
  wire.Rotate(4.0, 3.0, 5.0)                 // PERMANENT, every frame, about the pivot
  if (P > 0 && P < 1182.0) {
     wire.MoveTo(f32( (int32)(P*420) / 1182.0f + (-280.0f) ), 0, 0)    // x: -280 -> +140
     if (wire.origin.wx > -160.0 && revealW < 300)                      // f32 compare; unsigned word compare
        revealW = (word)(Round(wire.origin.wx) + 160)                   // round half-even
  }
  if (P > 380.0 && P < 400) {                // the burst: grows 0..95x
     s = Real48( (P - 380.0f) / 0.2 )        // fild, f32 subtract, extended divide
     wire.ScaleWork(s, s, s)
  }
  if (P >= 400 && burstDone == 0) { wire.ScaleUniform(100.0f); burstDone = 1 }   // permanent: rays up to ~120
  if (P > 1182.0) {
     if (P <= 1542.0)
        wire.MoveTo(f32( 140.0f - (P - 1182.0f) / 2.57 ), 0, 0)         // back to x ~= 0
     else if (P < 1900) {                                                // collapse
        g554a = f32(1.0f - (P - 1542.0f) / 50.0f); same for g554e, g5552 // DS:554a/554e/5552
        each: if (g < 0.0f) g = f32(0.001 (f80))
        wire.ScaleWork(Real48(g554a), Real48(g554e), Real48(g5552))
     } else if (P <= 2252.0)
        wire.ScaleWork(0.001, 0.001, 0.001)  // Real48 0x8d77/0x6e97/0x0312 = 0.0009999999999994458
     else if (P < 2400) {                    // re-expand 0 -> ~4.9x
        s = Real48( (P - 2252.0f) / 30.0f ); wire.ScaleWork(s, s, s)
     }
     if (P > 2304.0) addPalette(0, 254, 4,4,4)    // white-out, +4 per frame
  }
  wire.DrawLines()                           // TLine.Draw each: line(..., 254), clip x >= 2
  blurDecay(1)                               // on page 1
  maxBlend(getPage(X3), getPage(1))          // page1 = max(landscape, page1)
  present()                                  // page 1 -> screen
} while (P < 2500)                           // signed 32-bit, P from the top of the iteration
fillActive(254); present()                   // full white (the shadow for 254 is far above 63 by now)
freePage(X3); freePage(X2); freePage(1)
wire.DoneFree(0)                             // VMT+0xc with flag 0 (a stack object)
setColor(0, 0,0,0); setBorderColor(0)
```
Order of transforms within one frame:
1. Rotate sets pos and work.
2. MoveTo sets work = pos.
3. ScaleWork changes work only, so it must come after them.

When no ScaleWork branch runs (P <= 380, or 400 <= P <= 1542, or P >= 2400), the drawn geometry is the permanent pos.

Details:
- The ScaleWork pivot is wire.pivot.work, which MoveTo moves together with the origin (both start at (-320,0,0)).
- The reveal: when the starburst's centre passes x = -160, the logo is ORed into page 1 for columns
  `0 .. 4*((revealW>>2)+1)-1`. revealW follows `Round(x)+160` and stops updating once it is >= 300
  (at most about 300 at x = 139.6).
  - The OR uses the logo indices 1..7 (dark) and 251..254 (white).
  - Because page 1 keeps its contents and is blurred and decayed by 1 per frame, the logo glows cyan.
- The landscape is max-blended back every frame, so it stays sharp underneath its own glow.

Capture checks:
- 85.30 s: first pixels.
- 85.65 s: the fade-in is complete (about 30 capture frames).
- 86 s: the landscape and moon.
- 92-100 s: the starburst crosses and EUPHORIA is revealed.
- 109-110.2 s: all white.

## Port checklist / quirks
- 143e: the 640x480 picture phase (VESA) versus the capture (solid index 0). See the summary.
- Two busy-wait fades (timedFade) block for their whole duration. The port must keep animating the palette over P 0..100 and 370..600.
- All the part-relative times use the part clock P (a38c). The loops in 143e use their own phase clock T (a394).
- The trail effect: page X2 = blendTable[page1][X2], then blur() in place (ESTEEM only), then present X2.
- blur() reads one byte past the page (P[64000]). That is why putPixel(319,199,0) follows it.
- 1d08 ORs whole dwords; its `skip` value is dead.
- 1dab's per-frame effects depend on the frame rate (about 47 fps in the capture):
  - the fade-in counter;
  - Rotate(4,3,5);
  - the +4 white-out;
  - the blurDecay glow.
