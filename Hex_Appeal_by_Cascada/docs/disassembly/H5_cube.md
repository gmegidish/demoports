# exe5: the texture-mapped cube over a starfield

Credits (appeal.doc): texture code Iceman, texture pictures O'Hara, cube logo Delsion. The starfield code
(Hellraiser's "Stardriver" style) lives in the same program.

**Verification status.** Everything below was checked by a Python re-implementation of this part
(`scratchpad/h5/sim.py`, about 300 lines). With one main-loop iteration per retrace tick, it reproduces the recording
(video0019) **pixel for pixel**. The frames compared were sampled every 111 ticks from tick 0 to 4000, plus
4100 to 4687, and include the stars, the stale-star artefacts, the span bugs below and the zoom-out. Most samples
have 0 differing pixels.

The only differences:
- the 6-bit to 8-bit rounding of the palette (at most 1 level);
- occasional recording hiccups. Every few hundred ticks (around ticks 333, 1000, 1250, 1332, ...) one tick's frame
  is missing from the video and the neighbouring frame is shown twice; the shown frame then differs by about 50 star
  pixels. This is DOSBox or capture timing, not program logic; the port should simply run one iteration per tick.

Recording frame number = tick + 2. The recording's frames 0 and 1 are black, and tick 0 is the first callback after
the callback is installed.

## 1. Summary

What is seen, in order (times in seconds from the part's first frame in video0019):

1. 0.03 s: a tiny cube (a dot) at the screen centre (160,100). Stars appear at full brightness for one frame, go
   black, then fade in over 64 ticks (1.07 s).
2. 0.03 to 2.9 s: the cube "flies in". The perspective distance D drops by 200 per tick from 0x8a16 to 0x546
   (170 ticks). While D is still above 0x8000 (ticks 0 to 11), the 16-bit signed arithmetic makes the projection
   factor negative: the cube is mirrored and only about 2 px big. Near the wrap (ticks 12 to 14) a few frames show
   nothing.
3. 2.9 to 67.3 s: the cube rotates at full size (about 106 px across). It is drawn into an off-screen buffer and only
   a 200x170 window at (60,15) is copied to the screen, so the corners of the cube are cut by that window. Each
   face has its own texture, texture rotation and texture zoom:
   - face 0: the dragon;
   - faces 1 and 2: the eye (face 1 zooms in a sawtooth, face 2 rotates and pulses);
   - faces 3 and 5: the "CASCADA" logo, rotating;
   - face 4: a dark-grey face with the scroller "HEX APPEAL BY CASCADA" (24x24 font) written into its texture.
   A 64-star 3D starfield rotates on three axes behind (and through) the cube.
4. Tick 4010 (67.3 s): the music reaches order index 18, row 51, and the cube zooms out: D grows by 200 per tick
   from 0x546 to 0x8000 (158 ticks, 2.65 s).
5. Tick 4168 (69.97 s): the window is cleared on screen. From here on only the starfield runs.
6. Tick 4688 (78.7 s): the music reaches order index 19, row 51 (exit test patched, see section 9). The part exits
   without fading or clearing anything. exe6 follows immediately (its first frame is at 78.74 s).

**Video mode:** mode 13h (320x200, 256 colours, linear at A000:0000, one page, no page flipping) with CRTC tweaks
for a 60 Hz refresh (section 3). The port can treat it as a plain 320x200 chunky screen.

**Main loop** (section 4): wait for the next retrace tick. If the state is 0 or 1: copy the window from the
off-screen buffer to VRAM, clear the window in the buffer, transform the cube and draw the visible faces into the
buffer. Then the starfield: erase the old stars in VRAM and draw the new ones into VRAM and the buffer. Then test for
exit and ESC.

**Per-retrace callback** (installed with int 0x80 fn 0x1b at 0403:0d43, section 5): palette fade-in, all
animation counters, zoom state, the scroller column, and the music-position tests.

### Routines

| address | name | role |
|---|---|---|
| 0403:0000 | `start` | init, main loop, exit (with the unrolled clears inline) |
| 0403:0d43 | `frameCallback` | the per-retrace far callback (retf) |
| 0403:28df | `copyWindowToScreen` | 170 rows x 200 bytes, buffer 2c11:12fc to A000:12fc, stride 320 |
| 0403:3045 | `convertScrollText` | maps the text characters to font indices (in place) |
| 0403:30d8 | `readKey` | flushes the BIOS keyboard buffer, `in al,0x60` |
| 0403:30ee | `drawVisibleFaces` | backface test plus draw, for the 6 faces (falls through into 3106 at the end) |
| 0403:3106 | `faceFacing` | 2D cross product of the first 3 projected vertices; result in the flags |
| 0403:5314 | `drawTexturedQuad` | edge tables for x, u and v, then the affine spans |
| 0403:6eea | `faceTexCoords` | per face: rotates and scales the 4 texture-space points into u,v (self-modifying) |
| 0403:6fdc | `transformCube` | calls 6ff8, 703e, 719b |
| 0403:6ff8 | `cubeSinCos` | 3 angles to 6 table values |
| 0403:703e | `cubeMatrix` | builds the 3x3 rotation matrix |
| 0403:719b | `projectVertices` | rotates the 8 vertices and applies the perspective (D is patched into the code) |
| 0403:82ca | `starfield` | erases, moves, rotates, projects and plots the 64 stars |
| 0403:83ac | `eraseStars` | writes 0 to VRAM at the 64 remembered offsets |
| 0403:8401 | `plotStar` | plots one star into VRAM and the buffer, records its offset |
| 0403:843e | `rotateProjectStar` | 3-axis rotation plus projection of one star |

Segments (image loaded at segment 0; linear = seg*16 + off = offset in exe5.img; the offset in APPEAL.EXE is
linear + 0x6862b):

| seg | use |
|---|---|
| 0x0000 | data segment ("DS0"): star variables, star tables, palettes, sine tables (0x0000 to 0x402f) |
| 0x0403 | code segment, which also holds the cube data, the scroller text, the edge tables and the cube sine table |
| 0x0caf / 0x0cdf | palette of colours 0x00-0x1f at 0caf:0000 / dragon texture plane at 0cdf |
| 0x195f / 0x198f | palette of colours 0xc0-0xff at 195f:6840 (linear 0x1fe30) / eye texture plane at 198f |
| 0x1fef / 0x201f | palette of colours 0x40-0x7f at 1fef:64c0 (linear 0x263b0) / logo texture plane at 201f |
| 0x265f / 0x268f | palette of colours 0x80-0xbf at 265f:0000 / 24x24 font at 268f:0000 |
| 0x2c0b | palette of colours 0x20-0x3f (32 colours, the stars) |
| 0x2c11 | the off-screen 320x200 buffer (in the image, initially zero), 64000 bytes |
| allocated | 0x800 paragraphs (32 KB) for the scroller texture, segment kept at cs:[0x360a] |

## 2. Data

### Textures (pictures)

All pictures are embedded in the exe5 image. They are not read from APPEAL.EXE and not compressed. A texture is
simply a **64 KB window of memory**, 256 texels wide, addressed by `bx = (v_int << 8) | u_int`, where u and v wrap
at 8 bits. The four windows:

| face | texture seg (word at face+0xd0) | picture | palette range |
|---|---|---|---|
| 0 | 0x0cdf (linear 0x0cdf0) | dragon in rows 0..~199 (the eye starts at row 204) | 0x00-0x1f |
| 1, 2 | 0x198f (linear 0x198f0) | eye in rows 0..~100, then its palette, then the logo | 0xc0-0xff |
| 3, 5 | 0x201f (linear 0x201f0) | "CASCADA" logo, about 157x97 at rows 0..97 | 0x40-0x7f |
| 4 | allocated segment (cs:[0x360a]) | scroller texture, see below | 0x80-0xbf |

The windows overlap each other, and the windows of 0x198f and 0x201f run into the font (which has been changed at
run time) and into the frame buffer at linear 0x2c110. The safest port is to keep a copy of the exe5 image
(0x3bb10 bytes, or more, zero-padded), apply the two run-time patches below, and read texels at
`image[seg*16 + ((v<<8)|u)]`. In practice the u,v ranges stay inside the pictures, except face 2, whose v can reach
-3 (which wraps to rows 253-255 of 0x198f = font bytes).

Run-time patches made at start (0403:0067):
- `for i in 0..0x57bf: image[0x265f0 + 0x300 + i] = (image[...] + 0x80) & 0xff`. This adds 0x80 to the whole
  font (39 characters x 0x240 bytes), so the font uses colours 0x80-0xbf.
- `image[0x265f0..0x265f2] = 0x0a, 0x0a, 0x0a`: palette entry 0x80 = (10,10,10), the dark-grey background of the
  scroller face.

**The scroller texture**: 0x800 paragraphs from int 21h/48h, filled with 0x80 (`rep stosw 0x8080`, 0x4000
words). It is used as a 256x128 texture. Rows 128..255 would be whatever memory follows the allocation; the u,v
ranges of face 4 never reach them (v stays within 64 +- 62).

**The font** (268f:0000, linear 0x268f0): 39 glyphs of 24x24 bytes, glyph g at `g*0x240`, row r at `+r*24`.

**Scroll text** (cs:0x3079, linear 0x70a9): `"      HEX APPEAL BY CASCADA"` (6 spaces), terminated by 0xff.
`convertScrollText` replaces each character in place with its index in the character table at cs:0x309b,
`"ABCDEFGHIJKLMNOPQRSTUVWXYZ\x8f\x8e\x99 "` (A=0 .. Z=25, 0x8f=26, 0x8e=27, 0x99=28, space=29). The scan starts at
0x309b and loops forever if a character is missing (none is). Result:
`[29,29,29,29,29,29,7,4,23,29,0,15,15,4,0,11,29,1,24,29,2,0,18,2,0,3,0,0xff]`.
The width table at cs:0x30ba has 30 bytes, one per index:
`24,23,20,20,23,23,20,24,7,20,23,20,20,23,20,23,20,23,20,25,20,20,20,20,19,20,24,24,20,15`.
A width of 25 (T) reads one column into the next glyph; this is harmless, reproduce it by reading the font as a flat
array.

### Palettes

Target palette `TGT` at DS0:0x1ae3 (768 bytes, 6-bit), current palette `CUR` at DS0:0x1de3. At init each group is
copied into TGT at `index*3` and also written to the DAC (3c8/3c9):

| DAC index | count | source (linear) |
|---|---|---|
| 0x80 | 64 | 0x265f0 (after the first entry is set to 10,10,10) |
| 0x00 | 32 | 0x0caf0 |
| 0x40 | 64 | 0x263b0 |
| 0xc0 | 64 | 0x1fe30 |
| 0x20 | 32 | 0x2c0b0 |

(The order of the writes above is the program's order.) Then CUR = TGT (all 768 bytes). Entries not listed above
are never written. Only colours 0x20-0x3f are ever faded (section 5); they are used only by the stars. The fade-out
code (state 4) exists but state 4 is never set.

### Cube

- Vertices at cs:0x3162 (count at cs:0x3160 = 8), 3 signed words each: 0(-256,-256,-256) 1(256,-256,-256)
  2(256,256,-256) 3(-256,256,-256) 4(-256,-256,256) 5(256,-256,256) 6(256,256,256) 7(-256,256,256).
- 6 face records of 0xe6 bytes at cs:0x31a2 + k*0xe6 (k = 0..5). Field offsets from the start of the record
  (`F`):
  - `+0` texture angle (word);
  - `+2` angle speed (signed word);
  - `+4` pointer to 4 texture-space points (all faces: cs:0x3192 = (-64,-64),(64,-64),(64,64),(-64,64));
  - `+6` "facing" flag (written, never read);
  - `+8` texture scale (dword; the high word is 0 for all faces);
  - `+0xc` u offset (word);
  - `+0xe` v offset (word);
  - `+0xd0` texture segment;
  - `+0xd2` polygon: 5 pairs (pointer to the projected vertex, pointer to the texture point), the last pair equal to
    the first.
  - Projected vertex i is at cs:0x3708 + 12*i. Texture point j of face k is at cs:0x86c0 + 8*(4k + j). All faces
    use texture points j = 0,1,2,3 in that order.

| k | vertices | plane | angle0 | speed | scale0 | uoff | voff | texture | scale animated by |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 4,0,3,7 | x=-256 | 0 | 0 | 0xfde8 | 0x80 | 0x64 | 0x0cdf dragon | fixed |
| 1 | 6,2,1,5 | x=+256 | 0 | 0 | 0x8000 | 0x3c | 0x37 | 0x198f eye | S1 sawtooth (main) |
| 2 | 2,3,0,1 | z=-256 | 0 | 10 | 0xbb80 | 0x3c | 0x37 | 0x198f eye | P2 sine (main) |
| 3 | 5,4,7,6 | z=+256 | 0 | 9 | 0x8000 | 0x50 | 0x32 | 0x201f logo | P3 sine (main) |
| 4 | 1,0,4,5 | y=-256 | 0 | 3 | 0x8000 | 0x40 (scrolls) | 0x40 | scroller | P4 sine (callback) |
| 5 | 3,2,6,7 | y=+256 | 0 | -7 | 0x8000 | 0x50 | 0x32 | 0x201f logo | fixed |

### Sine tables

- `T[2048]`, the cube and texture table at cs:0x72ca (linear 0xb2fa): signed words, `T[i] ~ 32767*cos(2*pi*i/2048)`
  (T[0] = 32767). No simple rounding rule reproduces it exactly (round/trunc of 32767 or 32768 give 596+
  mismatches), so **read the 2048 words from the image**. It is always indexed by a byte offset `(x & 0xffe)`, that
  is entry `(x & 0xffe) >> 1`.
- Star tables in DS0: `COS[2000]` at 0x3090 (linear 0x3090) and `SIN[2000]` at 0x20f0, signed words, period 2000.
  `COS[0] = -32768` (an overflowed +32768); this entry is never used because the star angles never return to 0.
  `SIN[1000] = -1`. **Read them from the image** (no exact generator found).

### Stars

64 stars at DS0:0x081f, 3 signed words each (x, y, z), x,y in about +-1750 and z in [-1800,1800). Only z changes.
The "drawn offsets" table at DS0:0x000e has 64 words, initially all 0x002a. Other variables: see section 6.

## 3. Video setup (0403:0000)

```
int21 4Ah bx=0x3d09                 ; shrink the memory block
int80 bx=0x1d                       ; toggle the retrace timer off
int10 ax=0x13                       ; mode 13h
CRTC: reg 0x11 &= 0x7f (unprotect); misc out (3cc -> 3c2) |= 0xc0
CRTC 3d4: 06=0e 07=3e 09=41 10=c5 11=ac 15=9c 16=00
int80 bx=0x1d                       ; toggle the timer back on (re-sync to the new retrace)
```
This is the usual "mode 13h at 60 Hz" tweak: 400 visible scanlines (each row doubled) out of a vertical total of
0x20e, with 480-line sync polarity. It gives about 59.7 Hz (the recording measures 59.6 Hz). The display is still
320x200 linear, start address 0, one page.

Then: `convertScrollText`; allocate the 32 KB scroller texture and fill it with 0x80; patch the font; set the
palettes (section 2); CUR = TGT; install the callback (`int80 bx=0x1b ax=0x0d43 cx=cs`).

## 4. Main loop (0403:019d .. 0d2b)

```
loop:
  c = int80(0x19); while (int80(0x19) == c) {}   // wait for the next retrace tick
  int80(0x1a)                                     // reset the frame counter
  if (state <= 1) {                               // word compare, unsigned
    copyWindowToScreen()                          // last frame's buffer to VRAM
    angX = A0 & 0xffe; angY = A1 & 0xffe; angZ = A2 & 0xffe     // cs:728e/7290/7292
    face[2].scaleLo = ((u16(T[(P2 & 0xffe)>>1] + 0x7fff) >> 1) + 0x24a8) & 0xffff
    face[3].scaleLo = ((u16(T[(P3 & 0xffe)>>1] + 0x8000) >> 2) + 0x4000) & 0xffff
    face[1].scaleLo = S1
    clear the buffer window: 170 rows, from 2c11:0x12fc, 200 bytes each, stride 320  // x 60..259, y 15..184
    transformCube(); faceTexCoords(); drawVisibleFaces()
  }
  if (state == 2) { clear the same window in VRAM (A000); state = 3 }
  starfield()
  if (state == 5) exitCode = 0 -> exit
  readKey(): BIOS 40:1c = 40:1a (flush); al = in(0x60); if (al == 1) exitCode = 1 -> exit   // ESC make code
  goto loop
exit: int80(0x1c) (remove the callback); int21 49h es=cs:[0x360a]; int21 4Ch al=exitCode
```
- (P2 is cs:0x306f; the masked copies go to cs:0x306b/0x306d.) u16 means wrap to 16 bits; ">>" on a u16 is a
  logical shift.
- **One iteration per retrace tick.** The recording changes every retrace and matches the simulation exactly with
  1 iteration per tick. The animation itself is driven by the callback, so a slower machine would only drop frames.
- The cube shown on screen is one frame old: it is copied from the buffer before the new one is drawn. The stars are
  drawn directly into VRAM after the copy.
- Nothing is restored at exit (no mode change, no fade). The VRAM keeps the last stars.

## 5. Per-retrace callback (0403:0d43)

The order matters. All variables are words unless said otherwise; "+=" wraps at 16 bits.

```
// fade-in of DAC 0x20..0x3f (96 bytes)
if (fade <= 0x40) {                    // DS0:0x073a, init 0
  outDAC(0x20, CUR[0x60 .. 0xbf])      // 3c8=0x20, then 96 bytes to 3c9: outputs the PREVIOUS step
  for i in 0x60..0xbf: CUR[i] = ((TGT[i] * (fade & 0xff)) >> 6) & 0xff
  fade++
}
// The DAC shows: full brightness (init) -> tick 0 outputs CUR = full -> tick 1 outputs 0 -> ...
// -> tick 64 outputs TGT*63>>6. At fade = 0x41 it stops, so TGT*64>>6 is never output:
// the stars stay at 63/64 brightness for the whole part.
if (state == 4) { ... fade-out of all 768 entries, state = 5 when it reaches 0 ... }   // dead code

A0 += 2; A1 += 4; A2 += 6                              // cs:7294/7296/7298, init 0, 0x200, 0
S1 += 1000; if (S1 >= 50000) S1 = 100                  // cs:729a, init 0x8000, unsigned compare
P2 += 0x46; P3 += 0xa0                                 // cs:306f, cs:3071, init 0
for k in 0..5: face[k].angle += face[k].speed
bx = P4; P4 += 0x28                                    // cs:3075, init 0
face[4].scaleLo = ((u16(T[(bx & 0xffe)>>1] + 0x7fff) >> 1) + 0x3060) & 0xffff
if (state == 0) { D -= 200; if (D <= 0x546) D = 0x546 }               // unsigned; D = word at cs:71d2
if (state == 1) { D += 200; if (D >= 0x8000) { D = 0x8000; state = 2 } }   // unsigned
// scroller
col += 1                                               // cs:3073, init 0
face[4].uoff += 1; if (face[4].uoff >= 0xc0) { face[4].uoff -= 0x80; col = 0 }   // cs:3546, init 0x40
if (width == 0) {                                      // cs:3099, init 0
  while (text[tptr] == 0xff) tptr = 0                  // cs:3095 holds a pointer, init 0x3079
  g = text[tptr++]; width = WID[g]; src = (g * 0x240) & 0xffff   // cs:3097
}
for base in (0x3400, 0x3480):                          // row 52, columns col and col+128
  for r in 0..23: SCROLL[(base + col + r*256) & 0xffff] = FONT[src + r*24]
src += 1; width -= 1
// music
cl = int80(0x0a) (order+1), al = int80(0x0c) (row+1)   // byte compares, unsigned
if (cl >= 0x13 && al >= 0x34) {
  if (state < 1) state = 1
  else if (cl >= 0x14 && al_BUG >= 0x38) state = 5     // see section 9
}
// stars
s0 += 1; s1 += 2; s2 += 3                              // DS0:6/8/a, init 0
for each s: if (s >= 2000) s -= 1999                   // unsigned; note -1999, not -2000
starSpeed += -35                                       // DS0:0738, init 0
```
`state` is the word at DS0:0x080b (init 0). Values: 0 = fly-in or hold, 1 = zoom-out, 2 = clear the window,
3 = stars only, 5 = exit.

Timing facts (verified):
- The fly-in reaches D = 0x546 exactly after 170 ticks.
- The zoom-out takes 158 ticks: D = 0x546 + 157*200 = 32750, then the next step clamps to 0x8000 and sets state 2.
- In the recording state 1 starts at tick 4010 and the exit happens at tick 4688 (678 ticks = 11.37 s = 64 rows).

## 6. Cube transform

### cubeSinCos (6ff8)
`e = angle` already masked with 0xffe. The table byte offset is `(e*2) & 0xffe` (so the effective index is
`e & 0x7fe`):
```
a = T[((angX*2)&0xffe)>>1];  b = T[(((angX*2)&0xffe) - 0x400 & 0xffe)>>1]   // cs:7282, 7284 (cos, sin)
c = same for angY                                                       // cs:7286, 7288 -> c, d
e = same for angZ                                                       // cs:728a, 728c -> e, f
```

### cubeMatrix (703e)
All values are sign-extended to 32 bits, `*` is a 32-bit imul (wrapping), `>>` is an arithmetic shift, and "x2"
is `add r,r` (wrapping):
```
t  = ((c*b) x2) >> 16
Mxx(72a6) = ((e*a - t*f) x2) >> 16
Mxy(72b2) = ((-f*a - t*e) x2) >> 16
Mxz(72be) = ((d*b) x2) >> 16
t2 = ((c*a) x2) >> 16
Myx(72aa) = ((e*b + t2*f) x2) >> 16
Myy(72b6) = ((-f*b + t2*e) x2) >> 16
Myz(72c2) = ((-d*a) x2) >> 16
Mzx(72ae) = ((f*d) x2) >> 16
Mzy(72ba) = ((e*d) x2) >> 16
Mzz(72c6) = c
```

### projectVertices (719b), 8 vertices from cs:3162 to cs:3708 (12 bytes each)
```
zr = (x*Mzx + y*Mzy + z*Mzz) x2                 // 32-bit; stored at +8 (never used afterwards)
den = s16((zr >> 16) + D)                       // 16-bit add, so it wraps! D is the immediate at cs:71d2
k = trunc(0x008c0000 / den)                     // idiv cx: 32/16, the quotient must fit in 16 bits (it always does)
sx = (((((x*Mxx + y*Mxy + z*Mxz) x2) >> 16) * k) x2) + 0x00a00000                   // 16.16, +160
sy = ((((((x*Myx + y*Myy + z*Myz) x2) >> 16) * k) x2) * 0xd5 >> 8) + 0x00640000     // 16.16, +100, aspect 213/256
```
(The products are 32-bit wrapping imuls. The `* 0xd5` is `imul eax,eax,0xd5`, then `sar 8`.)
Fly-in detail: with D = 0x8a16 (negative as a signed word) k is about -300 and the cube is mirrored and tiny. When D
passes 0x8000 the 16-bit wrap of den flips some vertices; then k is about +280 and grows to about 6800 at D = 0x546.

## 7. Texture coordinates (faceTexCoords, 6eea) — self-modifying

For each face k (record `F`, output pointer `di` = cs:0x86c0 + 32k):
```
idx = F.angle & 0xffe
P = T[idx >> 1];  Q = T[((idx + 0x400) & 0xffe) >> 1]
scale = F.scale (dword); uo = F.uoff << 16; vo = F.voff << 16   // the low word of these immediates stays 0
for (x,y) in the 4 points (-64,-64),(64,-64),(64,64),(-64,64):
  r = int32(x*P - y*Q)    x2      // the 16x16 products are combined with sub/sbb into 32 bits
  u = bits16..47(int64(r) * scale) + uo        // (imul ecx: edx:eax; take (edx<<16)|(eax>>>16)), 32-bit add
  r = int32(y*P + x*Q)    x2
  v = bits16..47(int64(r) * scale) + vo
  store u, v (16.16)
```
Patched immediates: 0403:6f47 and 6f87 get P, 6f53 and 6f92 get Q, 6f66 and 6fa5 get scale, 6f7e gets uoff (high
word of the `add ecx,imm32` at 6f79), 6fbd gets voff.

## 8. Drawing the faces

### drawVisibleFaces (30ee) and faceFacing (3106)
```
for k in 0..5:
  v0,v1,v2 = the projected vertices of polygon entries 0,1,2; xi = s16(sx >> 16), yi = s16(sy >> 16)
  cross = s16(x1-x0)*s16(y2-y0) - s16(x2-x0)*s16(y1-y0)       // two 16x16->32 imuls, 32-bit sub
  F.flag = cross > 0 ? 1 : 0
  if (cross > 0) drawTexturedQuad(face k)
```
Quirk: there is no `ret` after the loop, so the code falls into 3106 once more with si = 0x37d8 (zeros). It only
writes a word at cs:0x370c (part of projected vertex 0, recomputed every frame), so it is harmless. Faces are drawn
in order 0..5 with no sorting; backface culling is enough for a convex cube.

### drawTexturedQuad (5314): affine mapping, no clipping
Tables in cs (256 dwords each, persistent): `L` 0x3b14, `R` 0x3f14 (x, 16.16); `UL` 0x4314, `UR` 0x4714;
`VL` 0x4b14, `VR` 0x4f14.
```
ds = F.texseg
ymin = 0x75300000; ymax = 0x8ad00000 (signed)          // immediates at 5353 and 5361, reset for every face
edges(X)  with the vertex y and the vertex x, into L/R, also updating ymin/ymax
edges(U)  with the vertex y and the point's u, into UL/UR
edges(V)  with the vertex y and the point's v, into VL/VR

edges: for i in 0..3: a = entry i, b = entry i+1
   ya = y(a), yb = y(b)   (16.16)
   [first pass only] if (ya <= ymin) ymin = ya; if (ya >= ymax) ymax = ya      // signed 32-bit
   ia = s16(ya >> 16); ib = s16(yb >> 16)
   if (ia == ib) continue
   if (ia > ib) { tab = Left;  bottom = a; top = b }     // L, UL or VL
   else         { tab = Right; bottom = b; top = a }     // R, UR or VR
   dy = ybot - ytop                         // 32-bit, > 0
   n = (dy >> 16) & 0xffff                  // integer part of dy (NOT int(ybot)-int(ytop))
   row = (ytop >> 16) & 0xffff
   slope = trunc((int64(vbot - vtop) << 16) / dy)        // idiv ecx; vbot/vtop = x, u or v at the ends
   val = vtop
   for j in 0..n: tab[row + j] = val; val += slope       // n+1 entries, unrolled code (jump into 200 stosd)
```
No sub-pixel correction. An `n` above 199 would jump outside the unrolled code; this never happens here.

Spans (60af), into es = 0x2c11 (the buffer):
```
y0 = s16(ymin >> 16); y1 = s16(ymax >> 16); cnt = y1 - y0; if (cnt <= 0) return
rowoff = (y0 * 320) & 0xffff                           // computed as (y0*4)*0x50
for j in 0..cnt-1:  r = y0 + j
  xl = s16(L[r] >> 16); xr = s16(R[r] >> 16)
  w = s16(xr - xl); if (w < 0) goto next              // only one winding draws
  n = w + 1
  di = (xl + rowoff) & 0xffff
  ul = UL[r] & 0xffff0000; ur = UR[r] & 0xffff0000    // the fractions are DROPPED
  du = (trunc(s32(ur - ul) / n) >> 8) & 0xffff        // idiv: (diff<<16)/(n<<16); then sar 8 -> 8.8
  cx = (ul >>> 8) & 0xffff                             // = (u_int & 0xff) << 8, the fraction is 0
  vl, vr the same -> dv; dx = (vl >>> 8) & 0xffff
  // the texel at (cx,dx) is tex[(dx & 0xff00) | (cx >> 8)]
  if (di & 1) {                                        // odd start: one byte, WITH A BUG
    bx = (dx & 0xff00) | (cx >> 8); cx += du; dx += dv
    t = tex[bx]
    buf[di++] = tex[(((bx & 0xff00) | t) + 0x0c) & 0xffff]   // mov bl,[bx]; mov al,[bx+0xc]
    if (--n == 0) goto next
  }
  pairs = n >> 1                                       // jump into 160 unrolled 21-byte pair blocks (61a4)
  if (pairs) {
    repeat pairs: p0 = texel; cx += du; dx += dv; bx = addr; p1 = tex[bx]; cx += du; dx += dv;
                  buf[di] = p0; buf[di+1] = p1; di += 2              // stosw
    dx = (dx - bx) & 0xffff      // BUG: 6 stray bytes after the unrolled block (0403:6ec4:
                                 // mov al,[si]; sub dx,bx; sbb si,cx) run every time;
                                 // bx = address of the last texel; si and al are reloaded later
  }
  if (n & 1) buf[di] = tex[(dx & 0xff00) | (cx >> 8)]  // last pixel, with the damaged dx when pairs > 0
next: rowoff += 320
```
Visible effect of the two bugs: odd-aligned left-edge pixels and odd-length right-edge pixels get wrong colours
(the ragged-edge speckle seen on the cube). Both are in the recording; reproduce them.

Steps: u,v are 8.8 in 16-bit registers with wrap; du,dv are signed 8.8. No clipping: rows 0..199 and any x are
written straight into the buffer. Only the 200x170 window is ever shown, and the parts outside the window are never
cleared (they do not matter).

## 9. Exit test and the bug (0403:2847 .. 288f)

```
2847  bx=0x0a; int 0x80; cx = ax          ; cl = order+1
284e  bx=0x0c; int 0x80                   ; al = row+1
2853  cmp cl,0x13 ; jb out
2858  cmp al,0x34 ; jb out
285c  push ds; mov ax,0 ;R ; mov ds,ax    ; <-- ax is overwritten with the data segment (load segment + 0)
2862  cmp word [0x80b],1 ; pop ds ; jae 2879
286a  ... mov word [0x80b],1 ; jmp out    ; first time: start the zoom-out
2879  cmp cl,0x14 ; jb out
287e  cmp al,0x38 ; jb out                ; al = LOW BYTE OF THE SEGMENT, not the row
2882  ... mov word [0x80b],5              ; exit
```
- **Intended:** zoom-out at order index 18, row 51 (order+1 >= 0x13 and row+1 >= 0x34); exit when order+1 >= 0x14
  and row+1 >= 0x38, that is order index 19, row 55.
- **Actual:** the exit fires on the first tick with order+1 >= 0x14 and row+1 >= 0x34 (the outer test still uses
  the real row) only if the low byte of the program's load segment is >= 0x38. Otherwise the part never ends (as in
  DOSBox). It also cannot fire before state >= 1.
- **Recording (patched compare `cmp al,0`):** exit at order index 19, row 51, exactly 64 rows after the zoom-out
  started. Measured: state 1 at tick 4010, exit at tick 4688, so 678 ticks = 11.37 s. **The port should use: exit
  when order+1 >= 0x14 and row+1 >= 0x34 (and state >= 1).**

**Note on the music speed (relevant to every part):** in this recording one row lasts about 0.1776 s, not 0.16 s.
The audio autocorrelation gives 1.413 s per 8 rows and 2.841 s per 16 rows, and 64 rows = 678 retraces = 11.37 s.
That is 10.59 retraces per row, so the player runs at about 45 ticks per second, not 50. The brief's 0.16 s per row
and 10.24 s per order do not fit this recording; please check in the exe0 notes how the player is clocked.

## 10. Starfield (82ca, 83ac, 8401, 843e)

```
starfield():
  eraseStars(): for i in 0..63: p = TAB[i] (DS0:0x0e + 2i); if (p != 0xffff) VRAM[p] = 0
  a0,a1,a2 = s0,s1,s2 (DS0:6,8,a copied to DS0:0,2,4)
  sp = starSpeed; starSpeed = 0                    // the sum of -35 per tick since the last frame
  idx = 0
  for each star (x,y,z):
    z = s16(z + sp)
    if (z >= 1800) z -= 3600                       // signed (jl)
    else if (z <= -1800) z += 3600                 // cmp 0xf8f8 ; jg
    store z
    h(v,c) = s16(hi16(s16(v*2) * c))               // shl ax,1 ; imul dx ; take dx
    c=COS[a0], s=SIN[a0]: X1 = h(x,c) - h(y,s);  Y1 = h(y,c) + h(x,s)
    c=COS[a1], s=SIN[a1]: Z2 = h(z,c) - h(X1,s); X2 = h(X1,c) + h(z,s)
    c=COS[a2], s=SIN[a2]: Z3 = h(Z2,c) - h(Y1,s); Y3 = h(Y1,c) + h(Z2,s)
    Z3 += 0x0a5a                                   // DS0:0732 (set to 0xa5a every frame); 0x72e/0x730 = 0
    sx = trunc(X2*225 / s16(Z3 + 225)) + 160       // dx = 450>>1 is used as BOTH multiplier and offset
    sy = trunc(Y3*450 / s16(Z3 + 450)) + 200       // 16-bit idiv (no overflow in this run)
    if (u16(sx) > 319) continue                    // not recorded: TAB keeps a STALE entry
    py = u16(sy) >> 1; if (py > 199) continue
    colour = (((u16(Z3 - 0xa5a + 0x1f4) >> 8) + 0x33) & 0xff)     // patched into 8426 and 8435
    di = sx + py*320
    if (VRAM[di] != 0) di = 0xffff
    else { VRAM[di] = colour; if (BUF[di] == 0) BUF[di] = colour }
    TAB[idx++] = di
```
- (All in-range sums and differences are 16-bit.) The variables are at DS0: 0x718 x, 0x71e y, 0x724 z, 0x71a X1,
  0x720 Y1, 0x726 Z2, 0x71c X2, 0x728 Z3, 0x722 Y3, 0x72a sx, 0x72c sy, 0x734 = 450 (constant), 0x736 sp,
  0x716 idx*2, 0x73c/0x73e x/py.
- Colours: near stars (Z3 < 0xa5a-500) fall to 0x28..0x32 (bright), far stars to 0x33..0x41 (darker). 0x40 and
  0x41 come from the logo palette.
- The stars are drawn into VRAM (visible at once) and into the buffer (so a star inside the window survives the
  next copy, unless the cube covers it).
- Artefacts to keep: (1) erasing writes 0 into VRAM even if the cube has been copied over that spot since, which
  makes black holes in the cube; (2) TAB entries past `idx` are stale and are erased again every frame;
  (3) a star is not drawn on a non-zero VRAM pixel.

## 11. Global variables (initial values from the image)

DS0 (segment 0):
- 0x0000/2/4: star angles used this frame;
- 0x0006/8/a: star angles (0);
- 0x000e: TAB[64] (0x002a each);
- 0x0716..0x072c: star temporaries;
- 0x0732: 0x1194, overwritten with 0x0a5a;
- 0x0734: 0x01c2 (450);
- 0x0736: 0;
- 0x0738 starSpeed: 0;
- 0x073a fade: 0;
- 0x0740: written 0xa000, unused;
- 0x080b state: 0;
- 0x081f stars;
- 0x1ae3 TGT;
- 0x1de3 CUR;
- 0x20f0 SIN;
- 0x3090 COS.

CS (0403):
- 0x3073 col: 0;
- 0x3075 P4: 0;
- 0x306f P2: 0;
- 0x3071 P3: 0;
- 0x3079 text;
- 0x3095 tptr: 0x3079;
- 0x3097 src: 0;
- 0x3099 width: 0;
- 0x3160 vertex count: 8;
- 0x3192 the texture-space points;
- 0x31a2 faces;
- 0x360a scroller segment (it is face 4's `+0xd0`);
- 0x3708 projected vertices;
- 0x3b14..0x5313 edge tables;
- 0x71d2 D: 0x8a16;
- 0x7282..0x728c sin/cos;
- 0x728e..0x7292 masked angles;
- 0x7294/96/98 A0/A1/A2: 0, 0x200, 0;
- 0x729a S1: 0x8000;
- 0x72a6..0x72c6 matrix;
- 0x72ca T;
- 0x86c0 texture coordinates.

## 12. Port checklist

- Each retrace: `callback(tick)`, then one main-loop iteration; then show VRAM with the DAC as set by the
  callback. Recording frame = tick + 2.
- Keep VRAM and the 64 KB buffer as persistent byte arrays. Keep the edge tables and the star TAB persistent.
- Emulate 16- and 32-bit wraps exactly. JS: use `Math.imul` and `|0` for 32 bits. For the u,v products with
  `scale` you need bits 16..47 of a 64-bit product: use BigInt, or split `scale` into 16-bit halves.
- Both span bugs, the star erase artefacts and the 63/64 fade end are part of the look.
- End: exit at order index 19, row 51 (the patched behaviour), about 11.4 s after the zoom-out began.
