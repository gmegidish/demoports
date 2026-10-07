# P01: main program timeline (0000:a3ef), preload (0000:0697) and the intro part (0000:0cd6)

Slice: 0000:a3ef main, 0000:0697, 0000:0cd6 intro with its nested helpers 0000:06d4, 07a3, 094b, 0bcc.
Also documented because the intro needs it: 0000:0000 PartInit (called first by every part).

## Summary

- **main** resets the sound device a few times and starts music resource 0xb (= res/10.gdm,
  "Music 1 - Begin to Euphoria"). It resets the 100 Hz clock and runs the parts in order. After
  each part it busy-waits until an absolute tick. It changes the music at fixed points, and at the
  end runs the end part 0000:0073('THE END', 2), fades the music out and stops it.
- **0697** (before any music) is an invisible preload. It sets VESA 640x480 and decodes res/25.pcx
  into the hidden second VESA page. It saves the PCX palette to DS:2688 for part 143e, then goes
  back to mode 13h.
- **Intro 0cd6** (0 to 46.15 s), mode 13h, 320x200, linear pages:
  1. It loads the flag texture (res/24.pcx), the background (res/23.pcx) and the font
     (res/21.pcx + res/22.bin), and builds a 11x7-vertex, 10x6-face textured "flag" mesh.
  2. It shows the background and fades palette entries 0x21..0x7f in over the rest of the first
     second. The fade ends 20/63 darker than the PCX colours.
  3. At 3.00 s nine text lines (big font, centered) scroll up, about 1 px per 3.3 ticks. The
     scroll stops with "MOVEMENT'95" near mid-screen at about 18.7 s. That state holds until 27 s.
  4. From 27 s to 46 s, a waving Israeli flag (lit texture, Phong-like angle shading) flies in
     from the left, moves to the centre while rotating about Y, keeps rotating, then flies into
     the camera.
  5. At about 46.0 s the whole palette gets +64, so the screen goes white. Then everything is
     freed.
- Everything is driven by the 100 Hz clock (DS:a380). There is no retrace wait anywhere in the
  intro. Frames are drawn as fast as possible, except in the scroll phase, which is paced at
  3.3 ticks per frame.

## External calls (names from L1..L5)

| call | meaning |
|---|---|
| 0000:0000 | PartInit (below) |
| 0db3:004f / 0769 / 01bc / 00ad | Font.Init (VMT DS:0a76) / Font.Load(pcxRes, glyphRes) / Font.DrawCentered(cx, y, s) / Font.Done(free) |
| 0e30:0223 | loadPCX(dest, resN): 1-based resource; the page becomes the active page; it sets the palette (setColor, 8 bit >> 2) |
| 186a:13ea | repackPage(page, w, rows) |
| 186a:121e | copyPage(src, dst) |
| 186a:10e5 / 13d4 / 13df / 114d | setActivePage(n) / setActivePage(1) / freePage(1) / freePage(n) |
| 186a:148d | fillActive(c) |
| 186a:14d1 | present(): active page -> A000:0000, 64000 bytes, no vsync |
| 186a:02f3 | setClip(x1, y1, x2, y2), inclusive |
| 186a:062a | gradient(a, b, r1, g1, b1, r2, g2, b2) |
| 186a:07cf | addPalette(first, last, dr, dg, db) |
| 186a:08bc | timedFade(first, last, dr, dg, db, steps: longint, duration: longint) |
| 186a:3a7e | PollKey(): ESC -> Halt(0), else returns DS:a3ac. **DS:a3ac is never set non-zero anywhere** (only zeroed), so every "if PollKey() then exit" branch is dead |
| 186a:39d3 | NewTexture(page, u0, v0, w, h) |
| 186a:01a7 / 1c24 / 1c3b / 1bc5 | setMode / vesaResetFlip / vesaClearAll / vesaFlip |
| 1856:0000 | presetGradient(n) |
| 1342:287c / 2c32 / 2c6c / 3518 / 2b08 | TPolyObject.Init / SetPhong / AddFace / Draw / FreeFaceTextures |
| 1342:0604 | TPixel.Init(x, y, z, color) (VMT 239a) |
| 1342:1c84 / 1cd4 / 1d6d | TFace.Init(flags, minC, maxC, color) / SetVertices(v1..v4) / SetExtra(texA, texB) |
| 1342:1466 / 0db6 / 1056 / 04bf | TMesh.RotateWork(ax, ay, az) / MoveTo(x, y, z) / MoveToPivot / TPoint.SetPos(x, y, z) |
| 1342:0282 / 0271 / 421b | ZeroVec(var a, b, c) / SetPerspective(D) / TLightDir.Update(ax, ay, az) |
| 1cbc:0091 / 00a7 / 00ce / 00f3 | timer reset / mark(var t) / elapsed(var t) / waitUntil(var t, ticks: Real48) |
| 0d27:0106 | (re)initialise the sound device: if it is already initialised, stop the music and shut the driver down (0d27:0167), then init again. Skipped if musicOff (DS:54e5) |
| 0d27:02a8(n) | load module resource n (1-based, so 0xb = res/10.gdm) and start playing it, with loop on (0d6d:0319(1)). If DS:54e6 = 1, it starts at volume 0 (0d6d:0333(0)) and clears the flag |
| 0d27:0000 | DS:54e6 = 1: the next 02a8 starts muted |
| 0d6d:026a(n) | BWSB driver call, slot 0x110. GUESS: MusicOrder(n) (jump to order n). The slot order 0x110/0x11c/0x120 matches MusicOrder / MusicLoop / MusicVolume in the BWSB API |
| 0d27:03ef | fade out: `v = MusicVolume(0xff)` (GUESS: 0xff = query); `for (; ; v--) { MusicVolume(v); Delay(20 ms) /*1cd9:02a8*/; if (v == 0) break }`. Only if playing (DS:54e3) |
| 0d27:03cf | stop music (if playing) |
| 1d81:49cb | UpCase(ch) (ASCII a..z only); 1d81:3ed2 string store |
| 1d81:3275 | Round (half-even) -> int32; 1d81:320f ST0 -> Real48; 1d81:3d8f int32 mul; 1d81:3dcc int32 div/mod: quotient in DX:AX, **remainder in BX:CX** |
| 1d81:32ba | Sin (extended) |
| 1d81:3d77 | Move(src, dst, n) |

## Globals used

| DS | meaning |
|---|---|
| a380 (int32) | the 100 Hz tick counter (INT 8, PIT divisor 0x2e9b = 11931, 100.007 Hz) |
| a384 (8 bytes) | timer record "demoStart": set by 1cbc:0091 (reset). main's waitUntil target |
| a38c (8 bytes) | timer record "partStart" (PartInit marks it) |
| a394 (8 bytes) | timer record "flagStart" (intro only) |
| a3a4/a3a6 (int32) | scratch "el" = the last elapsed value (shared by all parts) |
| a3ac (byte) | skip flag. Always 0. If it were non-zero, waitUntil would return at once and PollKey would end loops |
| 255e (byte) | P = 100 with EMS, 0 without. The intro uses pages P+2 (102) and P+3 (103) |
| 554a / 554e / 5552 (f32) | global angle triple (ax, ay, az). The intro uses ay = DS:554e |
| 2688 (0x600 bytes) | palette of res/25.pcx saved by 0697 (r, g, b int16 x 256) |
| 54e5 (byte) | musicOff. Every music call in main is skipped when it is non-zero |
| 5d98 | shadow palette (L1) |

## Timer record and wait semantics (1cbc)

- `mark(t)`: `t.a = t.b = ticks` (two int32 copies).
- `elapsed(t) = ticks - t.a` (int32).
- `waitUntil(t, X: Real48)`: `if (DS:a3ac == 0) while (float(elapsed(t)) < X) {}`. It returns once
  elapsed >= X. elapsed is an integer, so a fractional X means elapsed >= ceil(X).

---------------------------------------------------------------------------------------------------

## 0000:a3ef main (near, no args). Local: `[bp-8]` an 8-byte timer record

The `if (!musicOff)` guard (DS:54e5 == 0) is on EVERY music call; it is omitted below.
The Real48 wait constants were decoded from the AX/BX/DX immediates. All are exact integers.
```
preload_0697()
SoundInit(); PlayModule(0xb)          // 0d27:0106, 0d27:02a8: res/10.gdm
SoundInit(); PlayModule(0xc)          // res/11.gdm
SoundInit(); PlayModule(0xb)          // res/10.gdm again. Net effect: Music 1 plays from its start
TimerReset()                          // 1cbc:0091: ticks = 0, mark(DS:a384) -> t = 0
intro_0cd6();             waitUntil(a384, 4615)
part_143e();              waitUntil(a384, 8225)
SoundInit(); PlayModule(0xc)          // res/11.gdm "Music 2" restarts at 82.25 s
part_1dab();              waitUntil(a384, 10755)
MusicOrder(4)                         // 0d6d:026a(4), GUESS (see table); at 107.55 s
part_0a69_0620();         waitUntil(a384, 13270)
part_4ebc();              waitUntil(a384, 17300)
mark(local)                           // [bp-8]; never read again (dead)
part_3f83();              waitUntil(a384, 29535)
SoundInit(); StartMuted() /*0d27:0000*/; PlayModule(0xd)   // res/12.gdm starts at volume 0, at 295.35 s
mark(local)                           // dead
part_60dc();              waitUntil(a384, 40040)
part_2aa9();              waitUntil(a384, 44345)
part_3050();              waitUntil(a384, 49740)
part_8768();              waitUntil(a384, 52750)
SoundInit(); PlayModule(0xe)          // res/13.gdm at 527.50 s
part_9178();              waitUntil(a384, 55460)
part_7d84();              waitUntil(a384, 61865)
part_9778();              waitUntil(a384, 70965)
endPart_0073('THE END' /*cs:a3e7, Pascal string*/, 2)
MusicFadeOut()                        // 0d27:03ef, (v+1) * 20 ms, no musicOff guard (it checks 'playing')
MusicStop()                           // 0d27:03cf
return
```
Waits in ticks / seconds: 4615 (46.15), 8225, 10755, 13270, 17300, 29535, 40040, 44345, 49740,
52750, 55460, 61865, 70965 (709.65). Raw Real48 immediates (AX, BX, DX):
(8d,0,1038), (8e,0,0084), (8e,0,280c), (8e,0,4f58), (8f,0,0728), (8f,0,66be), (90,0,1c68),
(90,0,2d39), (90,0,424c), (90,0,4e0e), (90,0,58a4), (90,0,71a9), (91,8000,0a9a).

After main returns, the program body calls 0000:a616: UnmaskIRQs (186a:3a75), clearScreen (186a:146e),
DS:2686 = 1. Then Halt -> exit proc 0000:a370 -> endScreen (text screen res/42.bin with a 2 s fade-in;
see L5).

---------------------------------------------------------------------------------------------------

## 0000:0697 preload_0697 (near, no args)
```
setMode(2)                 // VESA 101h, 640x480
vesaResetFlip()            // 186a:1c24: display start (0,0), bank offset 0
vesaClearAll()             // 186a:1c3b
vesaFlip()                 // 186a:1bc5: toggle -> 1: DRAW to page 1 (bank offset 5 = scanline 512), DISPLAY page 0 (black)
loadPCX(0, 0x1a)           // res/25.pcx, 640x480, wide path: written into the hidden page; palette -> DAC + shadow
Move(DS:5d98 -> DS:2688, 0x600)   // save the 25.pcx palette for part 143e
setMode(0)                 // back to mode 13h
```
Nothing is visible: the displayed VESA page is black. The point is to leave res/25.pcx in video
memory (scanlines 512..991) and its palette in DS:2688. For the port: decode 25.pcx and keep it and
its palette for part 143e.

---------------------------------------------------------------------------------------------------

## 0000:0000 PartInit (near, no args), called at the top of every part
```
mark(DS:a38c)                          // partStart
DS:a3ac = 0
setClip(0, 0, width-1, height-1)       // DS:5bf0/5bf2
SetPerspective(200)
ZeroVec(DS:554a, DS:554e, DS:5552)     // global angles = 0.0
LightDir.Update(0.0, 0.0, 0.0)         // 1342:421b on DS:55f6: restores the default light direction
```

---------------------------------------------------------------------------------------------------

## 0000:0cd6 intro (near, no args), `enter 0x86c`

### Locals (the nested helpers reach them through the parent BP)
| bp- | type | name |
|---|---|---|
| 4 | far ptr | mesh (TPolyObject) |
| 8 | far ptr | font |
| 0xc | far ptr | face (scratch in BuildFlag) |
| 0x10 | far ptr | tex (scratch in BuildFlag) |
| 0x12 | int16 | texW = 26 (set by BuildFlag) |
| 0x14 | int16 | texH = 33 |
| 0x1e | int16 | line (scroll frame counter) |
| 0x20 | int16 | y (scroll position) |
| 0x24 | int16 | phase (wave phase, degrees 0..359) |
| 0x28 | f32 | flagX (last MoveTo x from phase 3) |
| 0x2c | f32 | flagY |
| 0x30 | f32 | flagZ |
| 0x34 | f32 | zz (phase 5 z) |
| 0x268 | far ptr[11][7] | grid[j][i] at `bp-0x268 + j*0x1c + i*4`, j = 0..10 (x), i = 0..6 (y) |
| 0x868 | 0x600 bytes | palette copy, written once at the start of phase 5 and never read (dead) |

P = byte DS:255e (100 with EMS). Pages: TEX = P+3, BG = P+2, the font page (first free page >= 11),
and page 1 = the back buffer.

### Setup
```
PartInit()                                 // partStart = now (about tick 0, the timer was just reset)
font = new Font                            // 0db3:004f, VMT DS:0a76
loadPCX(P+3, 0x19)                         // res/24.pcx: the flag texture, 320x200, colours only 0x80 (white) and 0xC0 (blue)
repackPage(P+3, 256, 200)                  // rows become 256-byte stride (texture addressing v*256+u)
BuildFlag(P+3)                             // 094b
loadPCX(P+2, 0x18)                         // res/23.pcx: the background, colours 0x21..0x7f
font.Load(0x16, 0x17)                      // res/21.pcx (glyph picture, colours 0..0x1e) + res/22.bin (glyph table); sets the palette from 21.pcx
presetGradient(10)                         // colours 0x21..0x7f: (11,38,60)->(63,63,63)->(63,40,0)->(6,6,63) (see L5)
gradient(0x80, 0xC0, 0,0,0, 63,63,63)      // grey ramp
gradient(0xC0, 0xFF, 0,0,0, 0,0,63)        // blue ramp (overwrites 0xC0 with black)
setActivePage(1)                           // allocates page 1 (filled with 0)
setActivePage(P+2)
addPalette(0x21, 0x7f, -60, -60, -60)      // shadow = orig - 60 (DAC clamps to 0)
present()                                  // the background picture appears (almost black)
dur = 100 - elapsed(partStart)             // int32 into DS:a3a4; that is 100 ticks minus the loading time
timedFade(0x21, 0x7f, 1, 1, 1, steps = 40, duration = dur)   // busy loop until 1.00 s; offsets 0 -> +40
```
Final palette for 0x21..0x7f = **preset - 20** (clamped at 0 by the DAC; the shadow keeps the
negative values). Checked in the capture: the brightest background pixel is RGB 174 = 6-bit 43 = 63-20.
The last palette of entries 0..0x20 is from res/21.pcx, that of 0x80..0xff from the two gradients.
The flag texels (0x80 / 0xC0) plus the light 0..63 index the grey and blue ramps.
For the port: loading takes no time, so dur = 100 (a 1 s fade from tick 0 to 100).

### Phase 1: the scroller (3.00 s to 27.00 s)
```
setActivePage(1)
waitUntil(partStart, 300.0)                // Real48 (89,0,1600)
line = 200
do {
   el = elapsed(partStart)                                  // int32 -> DS:a3a4
   y = int16( 200 - Round( float(el - 300) / 5.04 ) )       // 5.04 extended (cs:0ca6); Round half-even; int32 then low word
   if (line < y) y = line                                   // signed int16 min
   copyPage(P+2, 1)                                         // background -> back buffer
   DrawText(y > -276 ? y : -276)                            // 07a3; 0xfeec = -276, signed
   present()
   line--
   waitUntil(partStart, Real48( float(201 - line) * 3.3 + 300.0 ))   // 3.3 extended (cs:0cb0), 300.0 f32 (cs:0cba)
} while (el <= 2700)                                         // signed int32, uses el from the top of this iteration
el = elapsed(partStart)
waitUntil(partStart, 2700.0)                                 // Real48 (8c,0,28c0)
copyPage(1, P+2)                                             // the last scroll frame becomes the new background
```
Effective motion: frame k (k = 0, 1, ...) has line = 200-k. It is drawn at tick 300 for k = 0, and at
tick ceil(300 + 3.3*(k+1)) for k >= 1 (note the 6.6-tick gap after the first frame). The time
term `200 - Round((el-300)/5.04)` is always larger, so on a fast machine **y = 200 - k**. It only
limits y when frames run late. y stops at -276 from k = 476 (about 18.7 s). At that point
"MOVEMENT'95" is drawn at y = 84. The loop exits after the first frame with el > 2700 (about 726 frames).
The waitUntil target is Real48. Use `elapsed >= target` with target computed in double (a 1e-9
tolerance makes the exact-integer cases like 333.0 safe).

### Phases 2 to 5: the flag (27.00 s to 46.0 s)
```
mesh.MoveToPivot()                         // pivot = (0,0,0) = origin: no-op
ZeroVec(DS:554a, DS:554e, DS:5552)
phase = 0
mark(DS:a394)                              // flagStart, about tick 2700
el2 = elapsed(flagStart)                   // DS:a3a4

// ---- phase 2: fly in from the left (el2 0..600) ----
do {
   copyPage(P+2, 1)
   x = f32( float(int32(el2 * 220)) / 600.0 + -380.0 )      // 600.0 (cs:0cbe), -380.0 (cs:0cc2), f32
   mesh.MoveTo(x, -100.0, -100.0)                           // pushed as f32 0xC2C80000
   WaveFlag(phase)                                          // 0bcc
   mesh.Draw()                                              // 1342:3518 into the active page 1
   present()
   el2 = elapsed(flagStart)
   phase = int16( (el2 * 3) mod 360 )                       // int32 mul, RTL div: REMAINDER
} while (el2 < 600)                                          // signed int32

// ---- phase 3: move to the centre, rotate 0 -> 90 deg about Y (el2 600..1200) ----
ZeroVec(DS:554a, DS:554e, DS:5552)
do {
   copyPage(P+2, 1)
   WaveFlag(phase)
   ay = f32( float(int32((el2 - 600) * 90)) / 600.0 )       // stored in DS:554e
   mesh.RotateWork(0.0, ay, 0.0)
   mesh.Draw(); present()
   el2 = elapsed(flagStart)
   phase = (el2 * 3) mod 360
   flagX = f32( float(int32((el2-600)*160)) / 600.0 + -160.0 )   // cs:0cc6 = -160.0
   flagY = f32( float(int32((el2-600)*100)) / 600.0 + -100.0 )   // cs:0cca = -100.0
   flagZ = f32( float(int32((el2-600)*50))  / 600.0 + -100.0 )
   mesh.MoveTo(flagX, flagY, flagZ)
} while (el2 <= 1200)

// ---- phase 4: keep rotating, 90 -> 180 deg (el2 1200..1800) ----
el2 = elapsed(flagStart)
do {
   copyPage(P+2, 1)
   WaveFlag(phase)
   ay = f32( float(int32((el2 - 600) * 90)) / 600.0 )       // DS:554e
   mesh.RotateWork(0.0, ay, 0.0)
   mesh.Draw(); present()
   el2 = elapsed(flagStart)
   phase = (el2 * 3) mod 360
} while (el2 <= 1800)                                         // the position stays at the last phase-3 MoveTo

// ---- phase 5: fly into the camera (el2 1800..1900) ----
Move(DS:5d98 -> local bp-0x868, 0x600)                        // dead
do {
   copyPage(P+2, 1)
   WaveFlag(phase)
   mesh.RotateWork(0.0, DS:554e, 0.0)                         // ay frozen at its last phase-4 value (about 180)
   mesh.Draw(); present()
   phase = (el2 * 3) mod 360                                  // el2 from the previous iteration (not re-read yet)
   d = el2 - 1800                                             // int32
   zz = f32( float(int32(d * 2 * d)) / 100.0 + flagZ )        // cs:0cce = 100.0; flagZ = the last phase-3 value (about -50)
   mesh.MoveTo(flagX, 0.0, zz)                                // note: y = 0.0, not flagY
   if (zz > 150.0) {                                          // cs:0cd2 = 150.0
      setActivePage(P+2); fillActive(1); setActivePage(1)     // background becomes solid colour 1
   }
   el2 = elapsed(flagStart)
} while (el2 <= 1900)

// ---- end ----
addPalette(0, 255, 64, 64, 64)            // everything white (the shadow keeps orig+64, unclamped)
font.Done(1)                              // 0db3:00ad: frees the font page
mesh.FreeFaceTextures(); mesh.DoneFree(1) // VMT+0xc
freePage(P+2); freePage(P+3); freePage(1)
```
Notes:
- Each MoveTo also moves the pivot, so RotateWork always rotates about the flag's own centre.
  RotateWork(0, ay, 0) means: `x' = cos(ay)*x - sin(ay)*z; z' = sin(ay)*x + cos(ay)*z` relative to
  the pivot (via the L3 matrix).
- The z > 150 fill can happen only on a frame where the previous el2 was exactly 1900
  (zz = 200 + flagZ, about 150.08). It is effectively never visible (not seen in the capture).
- The screen goes white at flagStart + 1900 ticks (about 46.0 s). main then waits until 46.15 s.
- Per frame the work is: copy BG (64000 bytes) -> page 1, wave, transform, draw 60 lit textured
  quads, present. There is no frame cap: on the original hardware it runs at whatever rate it can.

### Positions (perspective D = 200, centre 160,100)
- Phase 2: centre (x, -100, -100), scale 200/300. The flag is 150x90 world units = 100x60 px. Its
  top is near y = 3..63. It enters from the left around 28.8 s (capture: about 29.0 s). Capture at
  t = 32: the flag pixels span x 0..79 and y 0..64. Predicted right edge 74..83 (the wave makes it
  ragged): OK.
- Phase 3: from (-160, -100, -100) to (0, 0, -50), turning 0 -> 90 deg (edge-on at about 39 s).
- Phase 4: at about (0, 0, -50), turning 90 -> 180 deg (the back side faces the viewer).
- Phase 5: z = -50 + 0.02*d^2 -> 150 at d = 100. It grows to fill the screen; vertices with z >= 200 cull their faces.

---------------------------------------------------------------------------------------------------

## 0000:06d4 UpStr (nested in 0cd6; near, `ret 6`): function(s: string): string
Args: s far ptr [bp+6], parent BP [bp+4] (unused). Result pointer at [bp+0xa] (BP string-function
convention). It copies s into a local buffer and applies `UpCase` to chars 1..len (a..z -> A..Z only).
Then it stores the buffer into the result (max 255).

## 0000:07a3 DrawText(y: int16 [bp+6]) (nested; parent BP [bp+4]; `ret 4`)
```
setClip(0, 0, 320, 200)                   // note 320/200, not 319/199
for (s, dy) in TEXT: font.DrawCentered(160, int16(y + dy), UpStr(s))   // font = parent.local[-8]
setClip(-1, 0, 320, 200)                  // stays in force for the rest of the intro (also for the flag)
```
TEXT (cs: Pascal strings, upper-cased before drawing):
| cs | string | dy |
|---|---|---|
| 074a | `We are very` | 0 |
| 0756 | `glad to` | 35 |
| 075e | `present our` | 70 |
| 076a | `first demo` | 105 |
| 0775 | `for the` | 140 |
| 077d | `first` | 175 |
| 0783 | `israeli` | 210 |
| 078b | `demo compo.` | 245 |
| 0797 | `MOVEMENT'95` | 360 |

The font is res/22.bin. It has no glyph for '.': glyph (0,0,0,0). '.' is in the "advance = w-1"
set, so it advances by -1 and draws nothing (DrawChar returns at `gh <= 0`). Port DrawCentered
literally (L5). DrawChar clips only vertically: with this clip, rows 0..199 are drawn.

## 0000:094b BuildFlag(texPage: byte [bp+6]) (nested; parent BP [bp+4]; `ret 4`)
```
parent.texW(-0x12) = 26; parent.texH(-0x14) = 33
mesh = new TPolyObject(limit = 60, flags = 0x005B, minColor = 200 (0xC8), maxColor = 255)   // VMT 23ea -> parent[-4]
mesh.SetPhong(0.0, 0.0, 63.0, 1.0)        // f32 0x00000000, 0x00000000, 0x427C0000, 0x3F800000
                                          // -> litTab[a] = Round(63*cos(a deg)), a = 0..90, rebuilt each Draw
for (i = 0; i <= 6; i++)                  // rows (y), outer
  for (j = 0; j <= 10; j++)               // columns (x), inner
    grid[j][i] = new TPixel(f32((j-5)*15), f32((i-3)*15), 0.0, color 0)   // int16 mul, cdq, fild, f32. VMT 239a
for (i = 0; i <= 5; i++)
  for (j = 0; j <= 9; j++) {
    face = new TFace(flags = 0x5B, minColor = 0, maxColor = 0, color = 0)   // VMT 23da
    face.SetVertices(grid[j][i], grid[j+1][i], grid[j+1][i+1], grid[j][i+1])
    u0 = Round( float(int32(j*256)) / 10.0 )        // cs:0943 = 10.0 f32; half-even
    v0 = Round( float(int32(i*200)) / 6.0 )         // cs:0947 = 6.0 f32
    tex = NewTexture(texPage, u0, v0, w = 26, h = 33)
    face.SetExtra(tex, tex)                          // texA = texB = tex
    mesh.AddFace(face)
  }
```
- u0 for j = 0..9: 0, 26, 51, 77, 102, 128, 154, 179, 205, 230. v0 for i = 0..5: 0, 33, 67, 100, 133, 167.
- Each face samples a 26x33 window (the mapper uses w1 = 25, h1 = 32) at (u0, v0) of the repacked
  texture page. v1 -> (0,0) top-left, v2 -> (25,0), v3 -> (25,32), v4 -> (0,32). Model y = (i-3)*15
  grows downward on screen, so the flag appears upright and unmirrored when it faces the viewer.
- The flags 0x5B are: type 3 (textured), shading 0x18 (per-vertex angle; DrawMesh computes vertex
  normals each frame), 0x40 double-sided. The mesh word 0x005B has no 0x100, so AddUnique dedups the
  vertices; they are distinct, so nothing is disposed. There is no 0x200, so faces are depth-sorted.
  There is no 0x400.
- texA == texB, so IsFrontFacing never sets +0x76: every face, front or back, uses LitTexQuad
  (186a:366b), not the mirror version.
- Lighting: there is one light, the unit-init default TLight at (0, 0, 200). ShadeAngle uses the
  edge light1 -> vertex, |cos|, then the angle 0..90. Pixel = min(255, texel + litTab[shade]).
  This gives 0x80..0xBF (grey ramp) or 0xC0..0xFF (blue ramp).
- The face colours (+0x77 = 200 + k) are unused by this fill type.
- 77 vertices, 60 faces. Face order = creation order (i outer, j inner) before the per-frame quicksort.

## 0000:0bcc WaveFlag(phase: int16 [bp+6]) (nested; parent BP [bp+4]; `ret 4`): the wave formula
```
mesh.RotateWork(0.0, 0.0, 0.0)            // work = f32(pivot + f32(I * f32(pos - pivot))): resets work to (about) pos
for (i = 0; i <= 6; i++)
  for (j = 0; j <= 10; j++) {
    p = grid[j][i]
    a = int16(phase + i*25 + j*55)        // 16-bit, then cdq -> int32 (max 359+150+550 = 1059)
    w = Round( sin( float(a) * PI / 180.0 ) * 15.0 )    // PI extended cs:0bba = 3.141592653589793; 180.0 f32 (cs:0bc4); 15.0 f32 (cs:0bc8)
                                                        // fild, fmul ext, fdiv, sin, fmul, Round half-even -> int32 in -15..15
    p.SetPos(p.wx, p.wy, f32( float(w) + mesh.origin.work.z ))   // origin.work.z = f32 at mesh+0x14
  }
```
So **z(i, j) = originZ + RoundHalfEven(15 * sin((phase + 25*i + 55*j) deg))**. It is an integer
displacement. x and y come from the vertex's work after the zero rotation, so they stay equal to
pos, up to f32 rounding of `(pos - pivot) + pivot`. Use Math.fround to match bit-exactly: SetPos
writes it back each frame, so 1-ulp drift could accumulate. The phase is the caller's
`(el2*3) mod 360`: 3 degrees per tick (0.83 Hz). The wave travels in -i/-j as time grows.

---------------------------------------------------------------------------------------------------

## What I checked against the capture (capframe)
- 0 to 3.2 s: black at t = 0, the background fades in and is complete at about 1.0 s, then static.
  The fade ends at preset-20 (max RGB 174).
- The scroll starts at about 3.3 s at the bottom. t = 10: line 1 just above the top edge
  (predicted y = -12). t = 20: "MOVEMENT'95" stationary near y = 84 (predicted clamp -276 + 360).
- 26.6 to 28.3 s: only the background and MOVEMENT'95. The flag enters at the left edge at about
  29.0 s (predicted 28.8). t = 32 bounding box matches (see above).
- 33 to 45 s: the flag moves to the centre and rotates (edge-on near 39 s). 45 to 46.1 s: it zooms
  into the camera. 46.2 s: a full white frame. From 46.3 s: black (the next part). The capture
  appears about 0.1 to 0.2 s behind the predicted times (the white flash is predicted at about 46.0).
- Colours: 24.pcx uses only 0x80 and 0xC0. 23.pcx uses 0x21..0x7f. 21.pcx uses 0..0x1e. This
  matches the palette layout above.

## Uncertainties
- 0d6d:026a(4) = MusicOrder(4) is a GUESS from the BWSB jump-table order.
- 0d27:03ef assumes MusicVolume(0xff) returns the current volume (GUESS).
- Why main plays 0xb, then 0xc, then 0xb before the timer reset is unknown (probably warm-up or
  caching). The audible result is Music 1 from its start at t = 0.
