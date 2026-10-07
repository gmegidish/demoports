# P03: parts 0a69:0620 (107.55 s .. 132.70 s) and 0000:4ebc (132.70 s .. 173.00 s)

Library names follow L1..L5 (L1 = 186a first half, L2 = 186a second half, L3/L4 = 1342 3D engine, L5 = other units).
All "f32(...)" = store rounded to IEEE single; expressions inside run in x87 extended (use doubles).
"el" below = the elapsed-ticks longint stored at DS:a3a4/a3a6 (10 ms ticks, signed int32).

## Summary

**Part A, 0a69:0620 "morphing sheet -> ball"** (about 22 s inside a 25.15 s slot).
- White screen, then a 21x15-vertex double-sided Phong-shaded sheet (280 quads) morphs over 10 s into a closed "lemon/ball" while it turns and approaches.
- Then for 11 s the ball (now single-sided, seam stitched) tumbles, wobbles in size, slides in x, under a moving light.
- Every frame is blurred (179b:002f) before it is shown.
- The palette is cyan: indexes 0..200 go black -> (0,50,63), and 200..255 go to white. The shade comes from the Phong table: 4 + 255*cos(angle), clamped to 255.

**Part B, 0000:4ebc "three gems"** (40 s).
- Three copies of a procedural 18-face crystal/gem (0e5a:1074), scaled 0.967 / 1.1 / 1.3, fly in from the top-left, top-right and bottom.
- They spin about all three axes and bounce vertically to the music: the VU meter of channel 5.
- Their vertices are deformed step by step in timed windows. At the end they fly back out.
- Each gem is drawn into its own page (1, 2, 3), and the pages are averaged (page2 = avg(1,2), page3 = avg(2,3)). Page 3 is shown, so gem 3 has weight 1/2 and gems 1 and 2 have weight 1/4. This gives the dark translucent outer rims seen in the capture.
- Faces use flat Lambert shading (mode 8) and a gradient span (type 2, gradStep DS:9118 = -20). The palette is blue -> white.

Checked against the capture (`capframe --sheet 107 133 1` and `132.5 174 1.5`):
- A: two white frames (109 s and 110 s; the flat sheet covers almost the whole screen at angle 0, so it is white). Then the bent cyan sheet closes into a lemon shape with a visible seam (111..118 s). Then a lemon that grows and shrinks a lot: a flat wide band at 124..125 s, tiny at 127..128 s, black from about 129.5 s.
- B: dark gems at the top-left, top-right and bottom at 134 s converge to the centre. Bright layered gems with darker rims follow, then dark gems leaving at about 171 s.
- The A sheet at 108 s still shows the previous part, so the capture clock is about 1 s off from the brief's table near this boundary (GUESS: it does not matter for the port, which uses main's wait ticks).

### External calls
| call | meaning (source) |
|---|---|
| 0000:0000 | partInit (documented below; shared by many parts) |
| 1cbc:00a7 / 00ce / 00f3 | timer mark / elapsed / waitUntil (BRIEF) |
| 186a:04b4 / 04be | lockPalette / unlockPalette (L1) |
| 186a:02f3 | setClip (L1) |
| 186a:062a | gradient (L1) |
| 186a:19bf | fillRect (L1) |
| 186a:10e5 / 0f42 / 114d / 13d4 / 13df | setActivePage / allocPage / freePage / setActivePage(1) / freePage(1) (L1) |
| 186a:144f / 146e / 14d1 | clearActive / clearScreen / present (L1); no retrace wait anywhere in this slice |
| 186a:3a7e | PollKey (L2; returns byte DS:a3ac; ESC halts) |
| 1342:0271 / 0282 | SetPerspective / ZeroVec (L3) |
| 1342:03ef | MakeVec (L3) |
| 1342:04bf / 0500 | TPoint.SetPos / MovePos (L3) |
| 1342:0604 | TPixel.Init (L3) |
| 1342:0c20 | TMesh.Append (L3) |
| 1342:0db6 / 0ed1 | TMesh.MoveTo / Translate (L3) |
| 1342:102a / 1082 | PivotToOrigin / Center (L3) |
| 1342:1184 / 11b8 | ScaleUniform / Scale (permanent) (L3) |
| 1342:1466 | RotateWork (L3) |
| 1342:178c | TMesh.GetItem (1-based) (L3) |
| 1342:1c84 / 1cd4 | TFace.Init / SetVertices (L3) |
| 1342:287c | TPolyObject.Init (L4) |
| 1342:2c32 | TPolyObject.SetPhong (L4) |
| 1342:3018 / 3129 | AddQuad / AddTri (L4) |
| 1342:3518 | TPolyObject.Draw (L4) |
| 1342:421b | TLightDir.Update on DS:55f6 (L4) |
| 1342:4427 | FreeLights (L4) |
| 1813:0172 | TCollection.At (L3) |
| TCollection VMT+0x1c | Insert |
| 0ba7:013c / 0192 | SinR(a:int16) / CosR(a:int16): Real48 table lookup in degrees (L5) |
| 179b:002f | blur() of the active page (L5) |
| 179b:018c | averagePages(dst, src) (L5) |
| 0d6d:0393(ch, v) | BWSB driver call (entry ES:[0x160], AL = v, BL = ch), byte result. Called as (5, 0xFF). GUESS: **ChannelVU(channel 5, 0xFF = read only)**: the current VU level of music channel 5. Not documented in L5 |
| 0a69:0008 | TBallSheet constructor (this slice, not in euph.lst; I disassembled it, see below) |
| 0a69:041c / 050a | morph / stitchSeam (this slice) |
| 0e5a:1074 | TGem constructor (this slice) |

### Globals touched
| DS | type | name |
|---|---|---|
| a38c | longint | T0: part start stamp (marked by partInit or by 0a69:0620 itself) |
| a394 | longint | T1: second-phase stamp (part A) |
| a3a4/a3a6 | int32 | el: last elapsed value (global, shared) |
| a3ac | byte | abort flag (set to 0 at part start; PollKey returns it) |
| 554a / 554e / 5552 | f32 | angX, angY, angZ (zeroed by ZeroVec) |
| 4670 | int16 | "skip the first present" flag. Part A sets it to 0, then 1 after frame 1, and **0x96 (150) at the end** (GUESS: read by a later part) |
| 466c / 466e | int16 | loop counters used as globals by part A's cleanup |
| 2c88 | far ptr [21][15] | gridRest[i][j] (rest/flat TPixels). Address = 0x2c88 + i*0x3c + j*4 |
| 3174 | far ptr [21][15] | grid[i][j] (mesh TPixels, the drawn ones). Address = 0x3174 + i*0x3c + j*4 |
| 3660 | Vec3 (3 x f32) [21][15] | morphVec[i][j]. Address = 0x3660 + i*0xb4 + j*0xc |
| 4524 | int16[21] | lonAngle[i] |
| 454e | int16[15] | latRadius[j] |
| 9118 | int16 | gradStep for span hook 16c1 (part B sets it to -20) |
| 54e5 | byte | no-music flag (if != 0, the VU is never read). GUESS name |

---------------------------------------------------------------------------------------------------

## 0000:0000 partInit() near
```
mark(&T0 /*DS:a38c*/); DS:a3ac = 0
setClip(0, 0, width-1, height-1)
SetPerspective(200)
ZeroVec(&angX, &angY, &angZ)                  // DS:554a/554e/5552 = 0.0
LightDir(DS:55f6).Update(0.0, 0.0, 0.0)      // light L = (0,0,-1024), edge dir (0,0,+1) (L4)
```

---------------------------------------------------------------------------------------------------

## Part A: 0a69:0620 morphSheetPart() far, retf 0. Locals: [bp-4] obj (far ptr), [bp-0x10..-0xc] t (Real48)

```
lockPalette()
mark(&T0)                                     // DS:a38c
DS:a3ac = 0
setClip(0, 0, width-1, height-1)
SetPerspective(200)
ZeroVec(&angX, &angY, &angZ)
LightDir.Update(0, 0, 0)
fillRect(0, 0, 320, 200, 0xFE)                // on the CURRENT active page (whatever the previous part left; GUESS page 0 = screen); palette locked
gradient(0,   200, 0,0,0,    0,50,63)         // stored only (locked)
gradient(200, 255, 0,50,63,  63,63,63)
unlockPalette()                               // sends the whole shadow palette to the DAC
fillRect(0, 0, 320, 200, 0xFF)                // white
FreeLights()                                  // light count 0 -> ShadeAngle uses the light-direction edge DS:5664
obj = new TBallSheet(spacing=14, amp=60, 20, 14, flags=0x118, minC=4, maxC=255)   // 0a69:0008, VMT DS:0112
obj.SetPhong(a=4.0, b=0.0, c=255.0, e=1.0)    // Phong table: table[ang] = min(255, Round(4 + 255*cos(ang deg)))
setActivePage(1)                              // allocates page 1 and clears it to 0 if new
DS:4670 = 0

// ---- loop 1: morph, 10 s ----
do {
  el = elapsed(&T0)                           // stored to DS:a3a4
  t = Real48( el / 1000.0 )                   // fild dword / f32 1000.0 (cs:05e6), then rounded to Real48
  if (t > 1.0) t = 1.0                        // compare with f32 cs:05ea; Real48 1.0 = (0x81,0,0)
  angY = f32(t * 250.0)                       // cs:05ee, DS:554e
  angZ = angY                                 // DS:5552
  if (PollKey() != 0) break                   // to the cleanup below (loop 2 is skipped too only if a3ac stays set)
  clearActive()
  obj.Draw()                                  // 1342:3518: draws the geometry computed in the PREVIOUS iteration
  obj.RotateWork(0.0, 0.0, f32(-angZ))        // no visible effect: morph() below overwrites every vertex's work
  morph(obj, t)                               // 0a69:041c
  obj.MoveTo(0.0, 0.0, f32(t * -66.0))        // cs:05f2 = -66.0; permanent, see the quirk below
  obj.RotateWork(angX /*0*/, angY, angZ)
  blur()                                      // 179b:002f on page 1
  if (DS:4670 == 1) present(); else DS:4670 = 1     // the first frame is not shown (the white screen stays)
} while (el < 1000)                           // signed 32-bit

// Note: break from PollKey jumps straight to "loop 2 setup" at 0a69:0878, NOT to the end.
// ---- loop 2 setup ----
mark(&T1)                                     // DS:a394
DS:4670 = 0
n = obj.faces.Count                           // int16 +0x5f
for (k = 0; k <= n-1; k++) obj.faces.At(k).flags(+0x7b) = 0x18   // drop 0x40: now single-sided (backface culled)
stitchSeam(obj)                               // 0a69:050a

// ---- loop 2: tumble, 11 s ----
do {
  el = elapsed(&T1)
  PollKey(); if (DS:a3ac != 0) break
  clearActive()
  obj.Draw()
  blur()
  present()                                   // always
  LightDir.Update( f32(sin(el/100.0) * 40.0), 0.0, f32(sin(el/30.0) * 30.0) )
        // sin = RTL Sin (radians, extended); el/100.0: fild dword / f32 (cs:05f6 = 100.0, cs:05fa = 40.0, cs:05fe = 30.0)
  a = int16(low16(el * 3))                    // longint multiply, low word, as signed int16
  obj.Scale( sx = Real48( CosR(a) * 0.2 + 1.0 ),   // 0.2 = extended cs:0602 (0x3ffc cccccccccccccccd), 1.0 = f32 cs:05ea
             sy = Real48( SinR(a) * 0.2 + 1.0 ),
             sz = 1.0 )                       // 1342:11b8 PERMANENT scale about pivot.work. Applied every frame, so it is cumulative (see the quirk)
  obj.MoveTo( f32( el/6.0 - SinR(int16(el div 4)) * 160.0 ),   // cs:060c = 6.0, cs:0610 = 160.0; el div 4 = longint div (trunc), low word
              0.0, -66.0 )                    // z: f32 bits 0xc2840000 = -66.0
  obj.RotateWork( f32(el/2.0 + angX), f32(el/3.0 + angY), f32(el/4.0 + angZ) )   // cs:0614/0618/061c = 2.0/3.0/4.0; angX/Y/Z keep their loop-1 final values (0, 250t, 250t)
} while (el < 1100)                           // 0x44c, signed 32-bit

// ---- cleanup (0a69:0a95) ----
DS:4670 = 0x96
obj.DoneFree()                                // virtual VMT+0xc with flag 1 (memory only)
for (j = 0; j <= 14; j++) for (i = 0; i <= 20; i++) gridRest[i][j].Done(1)   // counters DS:466e (j), DS:466c (i); memory only
freePage(1)
clearScreen()                                 // A000 = 0: black until the next part
waitUntil(&T0, Real48(0x8c,0,0x0980) = 2200.0 ticks)   // 22 s after the part start
```
Timing: loop 1 0..10 s, loop 2 10..about 21 s, then black until T0+22 s. Main then waits until the absolute tick 13270.

**Quirks to keep:**
1. The draw lags one iteration behind the transform (Draw comes before the transform in both loops).
2. MoveTo in loop 1: `d = (0,0,-66t) - origin.work`. The origin keeps the previous target, so each frame the freshly morphed vertices (morph resets pos from gridRest) are shifted by **only the frame's delta** -66*(t - t_prev), while the pivot accumulates the full -66t.
   - In practice the ball sits near z = 0 (plus the small delta), while the pivot (the rotation centre) moves to z = -66.
   - Port MoveTo, the pivot and the origin literally (L3).
3. Loop 2 Scale is permanent and multiplicative every frame. Its sizes depend on the frame rate (one multiply per frame). This is why the capture shows the ball becoming a wide band and then tiny.
   - Scale also moves the origin (L3), so the next MoveTo delta changes.
   - Exact frame-for-frame reproduction needs the same number of frames per tick as the original. GUESS: drive one iteration per rendered frame and accept drift.

### 0a69:0008 TBallSheet.Init (constructor) far, retf 0x14
Not in euph.lst. Disassembled with the 8087-emulator fixups applied (p03dis.py in the scratchpad).
Args: `[bp+0x18]` spacing (int16) = 14, `[bp+0x16]` amp = 60, `[bp+0x14]` = 20 (unused), `[bp+0x12]` = 14 (unused), `[bp+0x10]` flags = 0x118, `[bp+0xe]` minC = 4, `[bp+0xc]` maxC = 255, `[bp+0xa]` VMT (0x112), `[bp+6]` self (nil, so it allocates).

The object is a TPolyObject (L4), VMT DS:0112, size 0xd2. Its own fields:
- `+0x94` int16 amp
- `+0x96 + 4*j` far ptr seamFace[j], j = 0..13 (the faces of column i = 19)
```
TPolyObject.Init(limit=0x118 /*280*/, flags, minC, maxC)   // flags 0x118: 0x100 no dedup, 0x18 Phong per frame
self.+0x94 = amp
for (j = 0; j <= 14; j++)                     // [bp-8]
  for (i = 0; i <= 20; i++) {                 // [bp-6]
    x = float(int16((i-10)*spacing))          // 16-bit product, sign-extended (cwd), fild dword, then f32: -140..140
    y = float(int16((j-7)*spacing))           // -98..98
    grid[i][j]     = new TPixel(x, y, 0.0, color 0)   // VMT 239a
    gridRest[i][j] = new TPixel(x, y, 0.0, color 0)
    self.Append(grid[i][j])                   // mesh vertex order: j-major (j outer, i inner); gridRest is NOT in the mesh
  }
for (i = 0; i <= 20; i++) lonAngle[i] /*DS:4524*/ = int16( Round( i / 20.0 * 360.0 ) + 90 )     // cs:0000 = 20.0, cs:0004 = 360.0; Round half-even. 90, 108, ..., 450
for (j = 0; j <= 14; j++) latRadius[j] /*DS:454e*/ = int16( Round( SinR(int16(j*180 idiv 14)) * amp ) + 1 )
        // j*180 is a 16-bit imul, then 32/16 signed idiv by 14 (trunc): angles 0,12,25,38,51,64,77,90,102,115,128,141,154,167,180
        // SinR returns Real48; times fild(amp) in extended; Round half-even
for (j = 0; j <= 13; j++)                     // [bp-2]
  for (i = 0; i <= 19; i++) {                 // [bp-4]
    f = new TFace(flags=(flags+0x40)&0xff /*0x58: double-sided, Phong 0x18, type 0*/, minC, maxC, color 0)   // VMT 23da
    f.SetVertices(grid[i][j], grid[i+1][j], grid[i+1][j+1], grid[i][j+1])
    self.faces.Insert(f)                      // direct Insert, NOT AddFace: colour stays 0, no dedup
    if (i == 19) self.seamFace[j] = f
  }
for (j = 0; j <= 14; j++)
  for (i = 0; i <= 20; i++) {
    a = lonAngle[i]; r = latRadius[j]
    c = Real48( CosR(a) * float(r) )          // [bp-0x32]
    s = Real48( SinR(a) * float(r) )          // [bp-0x38]
    P = grid[i][j]
    dx = Real48( P.wx - c )                   // f32 field minus Real48
    dz = Real48( P.wz - s )                   // P.wz = 0
    MakeVec( f32(dx), 0.0, f32(-dz), &morphVec[i][j] )   // = (x - r*cos a, 0, r*sin a)
  }
return self
```
Faces 280 = 14 rows x 20 columns, inserted row by row (j outer).

### 0a69:041c morph(t: Real48 [bp+0xa..0xe]; self [bp+6] unused) far, retf 0xa
```
for (j = 0; j <= 14; j++)       // [bp-4]
  for (i = 0; i <= 20; i++) {   // [bp-2]
    Q = gridRest[i][j]; V = morphVec[i][j]
    grid[i][j].SetPos( f32(Q.wx - t*V.x), f32(Q.wy - t*V.y), f32(Q.wz - t*V.z) )   // pos and work
  }
```
At t = 0 this gives the flat sheet. At t = 1: `(r_j*cos(a_i), y_j, -r_j*sin(a_i))`, a lemon-shaped surface of revolution around the y axis.
- The radius `r_j = 60*sin(j*180/14)+1` and `y_j = (j-7)*14` (linear).
- The longitude a_i runs 90..450, so column 0 and column 20 coincide (the seam).

### 0a69:050a stitchSeam(self [bp+6]) far, retf 4
```
for (k = 0; k <= 13; k++) {
  f = self.seamFace[k]                        // the face (i=19, j=k)
  f.v2(+0x5d) = grid[0][k]; f.v3(+0x61) = grid[0][k+1]
  f.head.next.item       = f.v2               // 2nd node of the face's own vertex list
  f.head.next.next.item  = f.v3               // 3rd node
}
```
This closes the seam: the last column of faces now uses column 0 instead of column 20. Column 20 vertices stay in the mesh list (they are still transformed, but no face uses them).

---------------------------------------------------------------------------------------------------

## Part B: 0000:4ebc gemsPart() near, ret. Frame `enter 0x130`

Locals:
- `[bp-0x2c]`, `[bp-0x28]`, `[bp-0x24]` = gem[1], gem[2], gem[3] (`bp - 0x30 + 4*idx`)
- `verts[idx][v]` at `bp - 0x170 + idx*0x50 + v*4` (v = 1..14)
- `[bp-8]` pulse, `[bp-0xc]` cur, `[bp-0x10]` prev, `[bp-0xe]` changed
- `[bp-0x20]`..`[bp-0x12]` counters c1..c8 (bp-0x20 = c1, step 2 bytes)
- `[bp-0x120]` s (f32)
- `[bp-4]` loop index

Constants (f32 unless noted), cs:4e7a.. :
4.0, 1.0, 0.3 (extended at 4e82), 300.0, -250.0, -100.0, 250.0, 400.0, -50.0, 500.0, 1320.0, 2.0, -2.0, 800.0, 600.0.

```
partInit()                                    // 0000:0000: mark T0, clip, D = 200, angles 0, light (0,0,-1024)
setActivePage(1)                              // 186a:13d4
gradient(0,  40,  0,0,0,    0,0,63)           // not locked: the DAC is written immediately
gradient(40, 63,  0,0,63,   40,40,63)
gradient(63, 80,  40,40,63, 63,63,63)
gradient(100,250, 0,0,0,    63,63,63)         // 81..99 and 251..255 keep their old values
DS:9118 = -20 (0xffec)                        // gradient span: colour += 20/256 per pixel
for (k = 0; k <= 2; k++) {
  g = new TGem(flags=0x0a, minC=30, maxC=63)  // 0e5a:1074, VMT DS:0cae (size 0x94 = plain TPolyObject)
  gem[3-k] = g
  g.ScaleUniform( f32( 1.0 / (k/4.0 + 1.0) + 0.3 ) )   // k=0 -> 1.3, k=1 -> 1.1, k=2 -> 0.96666...; about pivot (0,0,0)
  for (v = 1; v <= g.count(+0x3e) /*14*/; v++) verts[3-k][v] = g.GetItem(v)
}
allocPage(2); allocPage(3)                    // not cleared (they are cleared every frame before use)
ZeroVec(&angX, &angY, &angZ)
pulse = 0; if (DS:54e5 == 0) pulse = ChannelVU(5, 0xFF)        // 0d6d:0393, byte zero-extended, NOT minus 18
cur = pulse; prev = -10; changed = 0; c1..c8 = 0

do {
  el = elapsed(&T0)
  if (PollKey() != 0) break
  if (DS:54e5 == 0) cur = int16(ChannelVU(5, 0xFF)) - 18
  if (prev != cur) changed++
  if (changed > 0) { changed = 0; if (pulse < cur) pulse = cur }    // signed
  prev = cur
  if (pulse > 0) pulse--
  clearActive()                               // page 3 (page 1 on the first frame); redundant

  // ---- global flight (MoveTo, permanent, about the origin) ----
  if (el <= 300) {                            // signed 32
    gem[1].MoveTo(f32(el*250/300.0 + -250.0), f32(el*100/300.0 + -100.0), -50.0)
    gem[2].MoveTo(f32(250.0 - el*250/300.0),  f32(el*100/300.0 + -100.0), -50.0)
    gem[3].MoveTo(0.0,                         f32(250.0 - el*250/300.0),  -50.0)
  } else if (el <= 800) {
    z = f32((el-400)*50 / 400.0 + -50.0)      // per gem, recomputed identically
    gem[1..3].MoveTo(0.0, 0.0, z)             // order 1, 2, 3
  } else if (el > 3500 && el < 4000) {
    gem[1].MoveTo(f32((3500-el)*250/500.0), f32((3500-el)*100/500.0), 0.0)
    gem[2].MoveTo(f32((el-3500)*250/500.0), f32((3500-el)*100/500.0), 0.0)
    gem[3].MoveTo(0.0, f32((el-3500)*250/500.0), 0.0)
  }
  // all products el*K are longint multiplies; then fild dword, divide by the f32 constant in extended, add, then f32

  for (idx = 1; idx <= 3; idx++) {
    s = f32( 1.0 / ((3-idx)/4.0 + 1.0) + 0.3 )   // = this gem's scale factor
    V = verts[idx]                            // 1-based, see the vertex table below
    // timed deformations: permanent MovePos(dx,dy,dz) (pos += d, work = pos). Counters are shared by the 3 gems,
    // so each counter grows by up to 3 per frame (the 3rd gem may miss the last step)
    if (el > 1000 && float(el) < 1320.0 && c1 < 110) { V9 += (0, 2s, 0); V10 += (0, -2s, 0); c1++ }
    if (el > 1500 && el < 1800 && c2 < 90)  { c2++; V2,V3,V5,V6 += (0,0,s); V11,V12,V13,V14 += (0,0,-s) }   // order 2,3,5,6,11,12,13,14
    if (el > 1800 && el < 2000 && c3 < 50)  { V1 += (s,0,0); V4 += (s,0,0); V7 += (-s,0,0); V8 += (-s,0,0); c3++ }
    if (el > 2000 && el < 2200 && c4 < 60)  { V9 += (0,-2s,0); V10 += (0,2s,0); c4++ }
    if (el > 2200 && el < 2300 && c5 < 20)  { V1 += (s,0,0); V4 += (s,0,0); V7 += (-s,0,0); V8 += (-s,0,0); c5++ }
    if (el > 2300 && el < 2500 && c6 < 60)  { V1,V2,V5,V7,V12,V14,V9 += (0,s,0); V4,V3,V6,V8,V11,V13,V10 += (0,-s,0); c6++ }   // this call order
    if (el > 2500 && el < 2800 && c7 < 80)  { V9 += (0,s,0); V10 += (0,-s,0); c7++ }
    if (el > 2800 && el < 3000 && c8 < 40)  {
       V1 += (-2s,-2s,0); V2 += (-s,-2s,0); V5 += (s,-2s,0); V7 += (2s,-2s,0); V12 += (-s,-2s,0); V14 += (s,-2s,0); V9 += (0,-2s,0)
       V4 += (-2s,2s,0);  V3 += (-s,2s,0);  V6 += (s,2s,0);  V8 += (2s,2s,0);  V11 += (-s,2s,0); V13 += (s,2s,0);  V10 += (0,2s,0)
       c8++ }
    // the counter compares are unsigned (jb/jae); el compares are signed 32-bit, strict (> and <) as written
    // 2s / -2s = f32(2.0*s) / f32(-2.0*s); -s = f32(-s)

    setActivePage(idx); clearActive()
    gem[idx].Translate(0.0, float(int16(9 - 2*pulse)), 0.0)          // permanent, moves pos, origin, pivot
    gem[idx].RotateWork( f32(el*360/800.0), f32(el*360/600.0), f32(el*360/500.0) )
    gem[idx].Draw()                                                  // 1342:3518
    gem[idx].Translate(0.0, float(int16(2*pulse - 9)), 0.0)          // undo
  }
  averagePages(dst=2, src=1)                  // 179b:018c: page2 = avg(page1, page2)
  averagePages(dst=3, src=2)                  // page3 = avg(page2, page3)
  setActivePage(3); present()                 // no retrace wait
} while (el < 4000)                           // signed

gem[1].DoneFree(); gem[2].DoneFree(); gem[3].DoneFree()   // VMT+0xc, flag 1
freePage(3); freePage(2); freePage(1); freePage(1)       // the last is 186a:13df (no-op)
```
Notes:
- Because the Translate pair surrounds the RotateWork, the bounce `9 - 2*pulse` is applied in screen-aligned y **after** rotation: the pivot moves too, so it is not rotated. Positive = down. Pulse 0 gives +9.
- The Translate pair is not exactly the identity in f32 (two roundings per vertex). Keep both calls if bit-exactness matters.
- The VU source: the port needs a stand-in for "VU of channel 5" (0..64 in BWSB, GUESS). For example, follow the channel-5 note-on volume of module 0xb or 0xc, decaying.
  - With no music (DS:54e5 != 0) pulse stays 0.
  - On the very first frame cur = raw VU (no -18), and prev = -10 forces "changed".
- Timeline (el ticks): 0..300 fly in. 300..800 z from -62.5 to 0 (a 12.5 jump at 300). Deformation windows 1000..3000. 3500..4000 fly out. Then the part returns at about 40 s.

### Gem vertex list order (needed for V1..V14)
The model is built by 0e5a:1074 (below). Unique vertices are appended in the order they first appear in face-vertex order (AddFace + AddUnique; -0.0 == +0.0 under FPU compare, so they dedupe). Before scaling:

| v | model (x,y,z) | after centring (x20, minus centroid (2, 4.5, 0)) |
|---|---|---|
| 1 | (0,3,0) | (-40,-30,0) |
| 2 | (1,3,1) | (-20,-30,20) |
| 3 | (1,6,1) | (-20,30,20) |
| 4 | (0,6,0) | (-40,30,0) |
| 5 | (3,3,1) | (20,-30,20) |
| 6 | (3,6,1) | (20,30,20) |
| 7 | (4,3,0) | (40,-30,0) |
| 8 | (4,6,0) | (40,30,0) |
| 9 | (2,0,0) | (0,-90,0)  tip |
| 10 | (2,9,0) | (0,90,0)  tip |
| 11 | (1,6,-1) | (-20,30,-20) |
| 12 | (1,3,-1) | (-20,-30,-20) |
| 13 | (3,6,-1) | (20,30,-20) |
| 14 | (3,3,-1) | (20,-30,-20) |

These are then multiplied by the per-gem ScaleUniform s (1.3 / 1.1 / 0.967) about (0,0,0). Check: window 3 moves v1,v4 (left column) by +s and v7,v8 (right) by -s, which squeezes the middle inward. That is consistent with this order.

---------------------------------------------------------------------------------------------------

## 0e5a:1074 TGem.Init (constructor) far, retf 0xc
Args: `[bp+0x10]` flags (word), `[bp+0xe]` minC (byte), `[bp+0xc]` maxC (byte), `[bp+0xa]` VMT, `[bp+6]` self. Returns self (DX:AX). The only caller is 0000:4f3a, with (0x0a, 30, 63, VMT 0x0cae).

Flags 0x0a means:
- shading mode 0x08: flat Lambert (TFace.Shade overwrites the colour every frame)
- fill type 2: gradient span hook 16c1 with (minC, maxC)
- dedup on; single-sided; depth sorted

```
TPolyObject.Init(limit=6, flags, minC, maxC)
// 10 local Vec3 (f32) via MakeVec, at bp-0x78 + 12*k:
P0=(2,0,0) P1=(0,3,0) P2=(1,3,1) P3=(3,3,1) P4=(4,3,0) P5=(0,6,0) P6=(1,6,1) P7=(3,6,1) P8=(4,6,0) P9=(2,9,0)
// front half (z >= 0)
AddQuad(P1,P2,P6,P5); AddQuad(P2,P3,P7,P6); AddQuad(P3,P4,P8,P7)
AddTri(P0,P2,P1); AddTri(P0,P3,P2); AddTri(P0,P4,P3)
AddTri(P9,P5,P6); AddTri(P9,P6,P7); AddTri(P9,P7,P8)
for (k = 2; k <= 9; k++) P[k-1].z = -P[k-1].z      // negates the z of P1..P8 (P1,P4,P5,P8 become -0.0)
// back half, reversed winding
AddQuad(P1,P5,P6,P2); AddQuad(P2,P6,P7,P3); AddQuad(P3,P7,P8,P4)
AddTri(P0,P1,P2); AddTri(P0,P2,P3); AddTri(P0,P3,P4)
AddTri(P9,P6,P5); AddTri(P9,P7,P6); AddTri(P9,P8,P7)
ScaleUniform(20.0)            // f32 bits 0x41a00000; about pivot (0,0,0)
Center()                      // centroid of the 14 unique vertices = (40, 90, 0) -> origin and pivot
PivotToOrigin()
MoveTo(0.0, 0.0, 0.0)         // shifts the vertices by -(40,90,0)
return self
```
- 18 faces in this insertion order. Face colours at add time are 30, 31, ..., 47 (minC + k), but mode 8 overwrites them every frame: `30 + |33*dot/1024| / len`, clamped to 63 (L3 TFace.Shade). The default light is (0,0,-1024).
- Each face is filled with FlatPoly using the gradient span: the colour starts at the shade and increases by 20/256 per pixel along x (L2/L4, DS:9118 = -20).
- The shape is an elongated octagonal crystal: 80 wide, 180 tall and 40 deep before the gem's own scale. The two tips are on the y axis.
