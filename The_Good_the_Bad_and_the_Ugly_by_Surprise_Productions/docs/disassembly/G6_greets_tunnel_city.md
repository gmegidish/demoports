# G6: Greetings-scroller (pointer only), Dot-tunnel, Motorcycle, Transforming objects, Contour city, Rotating door

Slice: main script 0000:06d4 .. 0000:072c. All in capture file `video0009.avi` (320x200).

## Summary (what is seen, in order)

| demo time (s) | global frames | what | code |
|---|---|---|---|
| ~253.5 .. 268.4 | .. 18809 | Greetings scroller (big green font, Peci) | **0eb3:27e8 / 0eb3:28ab / 0eb3:27d5 (segment 0eb3 = slice G5)** |
| 268.4 .. 269.5 | 18810 .. 18886 | black: `dot_data` loads, tunnel precalc (CPU bound, 77 frames here; 74 in cap2) | 0e40:063b |
| 269.48 .. 293.58 | 18887 .. 20576 | Dot tunnel (Antibyte) | 0e40:063b |
| 293.6 | 20577 .. 20579 | black (loads citydata, citydat2, citydat3, bg2) | 08d8:396c, 08d8:3041 |
| 293.64 .. 296.02 | 20580 .. 20748 | Motorcycle picture (J.O.E): fade in 70 frames, hold 29 frames (CPU bound, about 10 in cap2), fade out 70 frames | 08d8:3041 |
| 296.06 .. 298.22 | 20749 .. 20750 black, 20751 .. 20901 | "Surprise!" pattern background scrolling diagonally, palette fades in | 08d8:346a (cx=0x96) |
| 298.23 .. 311.92 | 20902 .. 21861 | Transforming objects (star, X, circle... morphing outlines) over the pattern | 08d8:35f6 |
| 311.93 .. 312.77 | 21862 .. 21921 | grey band rises from the bottom (rows 199 -> 140) | 08d8:39d4 |
| 312.79 .. 324.40 | 21922 .. 22736 | Contour city (skyline rising/changing), 815 frames | 08d8:39d4 |
| 324.42 .. 325.13 | 22737 .. 22787 | city stays, pattern keeps scrolling | 08d8:346a (cx=0x32) |
| 325.14 .. 327.94 | 22788 .. 22984 | Rotating door: 20 lilac bars slide in from both sides while the whole thing rotates; second half: black/lilac only | 08d8:3e3a |
| 327.95 .. | 22985 .. 22988 black, 22989.. | next slice: picture zoomer (mode 13h, the three-characters picture) | (not mine) |

The "small picture of three characters" in the brief is NOT the rotating door: it is the start of the
picture-zoomer (mode 13h, after 0000:07a5). The rotating door is the lilac striped thing at 325..328 s.

Verification: I wrote two reference simulators straight from these notes
(`work/G6/simtun.py` + `runtun.py`, `work/G6/sim08.py` + `run08.py`, compare with `cmp.py`).
Both run one logic step per retrace and reproduce the recording **pixel-exactly**:
tunnel frames 18888..20576 (all checked samples 0 differing pixels), and every frame 20751..22984 of the
08d8 part (pattern, morph, band, city, door; 0 differing pixels in all 2234 frames), plus the motorcycle
fades. The only things not reproduced by logic are the CPU-bound gaps (tunnel precalc, motorcycle
hold), whose recorded lengths are given below.

Video mode for everything here: EGA-style **16-colour planar 320x200** built by 0299:01cc (the mode-13h
timings with Attribute Mode Control 0x01, Seq 1 = 0x09, Seq 4 = 0x06, GC5 = 0, CRTC from table
0299:01b3: offset reg 0x14 = 40 bytes per row, byte mode, double-scanned 200 lines, 70.086 Hz). Attribute
palette registers are identity (0..15) from the earlier BIOS mode 13h. A pixel's colour c (0..15) =
bit p from plane p at byte `start + y*rowbytes + (x>>3)`, bit `7-(x&7)`. DAC index = c, or, once
P54S (Attribute Mode Control bit 7) is set, `((colorSelect & 3) << 4) | c`.

6-bit DAC values appear in the capture as `round(v*255/63)` (checked).

Helpers used (shared marked *):
- 0731:00a3* wait tick, 0731:013c* / 0731:0158* timer install/restore (brief), 008e:1f63* music tick,
  008e:04b3*/0063*/0014* load/free/alloc.
- 0299:01cc* mode set (above), 0299:0076* set DAC (screen off while writing), 0299:0023* palette
  interpolation, 0299:009c* set P54S, 0000:002b* black palette.
- 0749:0153* palette fade with its own retrace waits (also used by the water effect).
- 08d8:157e* read frame counter (also called by 0e40).
- 08d8 3D/vector engine*: 07cb rotate+project, 0926 back-face test, 097f XOR line, 0ad3 left clip
  edge, 0b24/0b70 clipper, 0e00 / 0ecc XOR-fill blitters, 0f93 bbox, 128d object renderer, 13f7
  clipped line. These are shared with the other 08d8 vector effects (glentz etc.).
- 08d8:3161 page-cycle, 08d8:346a "show pages" loop: used by all four 08d8 effects of this slice.

---------------------------------------------------------------------------------------------------

## 1. Greetings scroller: 0eb3:27e8, 0eb3:28ab, 0eb3:27d5 (slice G5's segment; only a pointer)

Main has no separate call for it: `06d4 lcall 0eb3:27e8` loads `ugu` (-> 0eb3:[0xd]) and `ugu2`
(-> 0eb3:[2]), sets the black palette, clears 400 bytes of video memory and renders 25 characters of
text (pointer 0eb3:[0x27cd], 8x8 font at 0eb3:1698) into a buffer in its own segment at 0eb3:[0x2718];
`06d9 lcall 0eb3:28ab` is the scroller itself (per-scanline CRTC reg 0x13 writes, per-line DAC colour 1
writes = the green gradient, retrace polls on 3da bit 0); `06de lcall 0eb3:27d5` frees ugu/ugu2.
So the resources `ugu` and `ugu2` belong to the greetings and are G5's. I did not read it further.

One thing the greetings leave behind matters for the tunnel: the GC **Read Map Select register = 3**
(found by matching the tunnel's write-mode-3 artefact in the recording; I did not find the `out`
that sets it in the disassembled code, so it is in code reached only through a jump table).

---------------------------------------------------------------------------------------------------

## 2. Dot tunnel: 0e40:063b (Antibyte), resource `dot_data`

Main: `06e3..06ed` load `dot_data` -> segment stored at 0e40:[4]; `06f2 lcall 0e40:063b`;
`06f7..06fe` free it.

### What it is
64-dot rings (ellipses), each ring a precomputed "shape" (one of 300 depth steps, each slightly
rotated). A new ring appears every 12 frames at the far end (small, dim, single dots) with a centre
offset from a 70-entry wobble table; every frame every ring moves one depth step closer (bigger,
brighter, 2/3/4-pixel dots). 25 rings max. After 1401 frames no new rings come and the oldest ring
is removed every 12 frames until none is left.

### Video
16-colour planar mode as left by the greetings, but CRTC 0x13 (offset) = 0x20 -> **64 bytes per row**
(512-pixel virtual width, 320 visible). Double buffered: page 0 at a000:0000, page 1 at a000:9600
(CRTC start 0x0000 / 0x9600). Map mask 0x0f, **write mode 3** (GC5 = (GC5 & 0xfc) | 3), the colour
is the Set/Reset register (GC0), bit mask GC8 = 0xff.

Dots are plotted with `or es:[addr], reg8` where reg8 = 0x80 >> (x&7). In write mode 3 the byte
written by the CPU is `latch_read | reg8`; that whole byte is used as the bit mask and every masked
pixel gets the Set/Reset colour. The read returns plane **3** (Read Map Select = 3, see above). So:

```
plotDot(page, x, y, colour):          // x 0..511, y row; visible if y in 0..199 and x < 320
  byte = pixels x&~7 .. x|7 of row y
  for each pixel q in that byte: if (q == x || (pixel[q] & 8)) pixel[q] = colour
```
(pixels of colour 8..15 in the same byte are recoloured; this is visible in the recording and the
simulation with this rule is exact.)

Clear (0e40:0429): GC0 = 0, then 200 rows x 40 bytes of 0xffff words at stride 64 -> visible
320x200 of the current back page set to colour 0 (in write mode 3 with data 0xff).

Palette (0e40:005c): `0299:0076` DAC 0..15 from 0e40:002c (linear 0xe42c):
colour 0 = (0,0,0), colour i (1..13) = grey (0x0b+4i) on all three channels (0x0f, 0x13 .. 0x3f),
colours 14, 15 = (0,0,0).

### Data
- dot_data (7153 bytes) is all zero up to 0x1086 (work space), then:
  - 0x1086: X wobble, 70 signed words then 0x4142 ('BA') terminator
    (1 4 8 11 15 18 21 24 27 29 32 34 36 37 38 39 40 40 40 40 39 38 37 35 33 31 28 26 23 20 17 14 10 7 3
    -1 -4 -8 -11 -15 -18 -21 -24 -27 -29 -32 -34 -35 -37 -38 -39 -40 -40 -40 -40 -39 -38 -37 -35 -33 -31
    -29 -26 -23 -20 -17 -14 -10 -7 -3)
  - 0x1114: Y wobble, 70 words then 0x4142
    (1 3 6 8 10 12 14 16 18 20 21 22 23 24 25 26 26 26 26 26 25 24 23 22 21 20 18 16 14 12 10 8 6 4 1 -1 -3
    -6 -8 -10 -12 -14 -16 -18 -19 -21 -22 -23 -24 -25 -26 -26 -26 -26 -26 -25 -24 -24 -23 -21 -20 -18
    -17 -15 -13 -11 -8 -6 -4 -2)
  - 0x11a2: sine table, words, 1024 entries per circle, amplitude 32767 (`SIN[i] = word at 0x11a2+2i`);
    cosine = same table at +0x200 bytes (0x13a2). Read it from the resource (it is not exactly
    `round(32767 sin)`: 44 entries differ by 1).
- Colour/size table at 0e40:0536 (linear 0xe936), 2 bytes per ring (colour, size), ring index 0 =
  newest/farthest. Colour 0 = "keep the previous ring's colour". Size 0 = 1 pixel, 1 = 2 pixels
  (x, x+1), 2 = 3 pixels ((0,0),(1,0),(0,1)), 3 = 4 pixels (2x2):
  ```
  (1,0)(0,0)(2,0)(0,0)(3,0)(0,0)(4,0)(0,1)(5,1)(0,1)(6,1)(0,1)(7,1)(0,1)(8,2)(0,2)(9,2)(0,2)(10,2)(0,2)
  (11,2)(0,3)(12,3)(0,3)(13,3)  then zeros
  ```
  The table is patched at run time (see removeRing).

### Variables (segment 0e40, initial value from the image)
[0] [2] code blocks (allocated, 0xca3 paragraphs each), [4] dot_data seg, [0xe] ringCount = 0,
[0x10] countdown = 1, [0x12] Xptr = 0x1086, [0x14] Yptr = 0x1114, [0x16] slot ptr = 0x0bbe,
[0x18] z, [0x20..0x2a] angles/speeds, [0x534] colour ptr = 0x0536, [0x446] = 0 (CRTC start of the
page being drawn), [0x448] = 0xa000 (segment of the page being drawn), [0x639] temp.

### Precalc (0e40:023d .. 02ab, 00b5, 00f2, 0125, 01a7, 01c9)
The original compiles each of the 300 shapes into x86 code (`mov si,[di+2k]` + `or es:[si+disp16],reg8`
per dot, in two 51 760-byte blocks, far pointers at dot_data:0bbe + 4*shape). A port only needs the
dot coordinates:

```
H32(v) = high 16 bits of (v*2) as a 32-bit value, signed   // "shl ax,1 ; adc dx,dx" -> dx
rot(x, y, a):                     // 0e40:0125, a = byte offset into the sine table (even)
  S = SIN[a/2], C = SIN[a/2 + 256]
  x' = s16(((x*C - y*S) * 2) >> 16)  // 32-bit exact, arithmetic shift
  y' = s16(((x*S + y*C) * 2) >> 16)
circle[i] = rot(0, -2560, 0x20*i), i = 0..63         // -2560 = 0xffb0<<5
angle = 0; z = -290 (0xfede)
for shape = 0..299:
  angle = (angle + 2) & 0x7fe                         // 0e40:00f2
  for each circle point (x,y):
    (x,y) = rot(x, y, angle)
    x = trunc(x*5 / 4)                                // 0e40:01a7 (idiv)
    den = z + 500                                     // 210 .. 1705
    X = (-trunc(x*-500 / den)) >> 5 (arith) + 160     // neg BEFORE the shift
    Y = ( trunc(y*-500 / den)) >> 5 (arith) + 100
    shape[shape].push(X, Y)                           // order of points as generated
  z += 5
```
(The compiled code groups the dots by X&7; order within a ring does not matter because a ring has one
colour.) Address of a dot of ring (rx,ry) = `(ry+Y)*64 + ((rx+X) >> 3)` (16-bit wrap), bit `(rx+X)&7`
— i.e. simply pixel (rx+X, ry+Y) in the 512-wide page. Max |rx+X| keeps it inside the row, and rows
outside 0..199 fall into invisible memory (never cross into the other page's visible area), so the
port can just clip to 320x200.

### Rings
Ring records are 6 bytes at dot_data:0x96 - 6*i (i = 0 newest): x offset, y offset, shape*4.
```
addRing():                         // 0e40:049c, called once per logic step in phase 1
  if (--countdown) return; countdown = 12
  if (ringCount != 25) ringCount++
  for k = ringCount .. 1: R[k] = R[k-1]      // R[25] is a never-drawn copy
  R[0] = { x: Xtab[next], y: Ytab[next], s: 0x4ac }   // both tables advance together, wrap at 70
advance():                         // 0e40:0523
  for k < ringCount: R[k].s -= 4             // one depth step closer
removeRing():                      // 0e40:0470, phase 2
  if (--countdown) return; countdown = 12
  ringCount--; colPtr += 2
  if (byte[colPtr] == 0) byte[colPtr] = byte[colPtr-2]   // permanent patch of the table
drawRings():                       // 0e40:0576 (+ 040c, jump table 0e40:02c5, generated code)
  sr = current Set/Reset (0 after the clear)
  for k = 0 .. ringCount-1:
    (col, size) = table[colPtr + 2k]
    if (col) sr = col
    offsets = size==0 ? [(0,0)] : size==1 ? [(0,0),(1,0)] : size==2 ? [(0,0),(1,0),(0,1)]
                                : [(0,0),(1,0),(0,1),(1,1)]          // drawn in this order
    for (ox,oy) of offsets: for (X,Y) of shape[R[k].s/4]: plotDot(back, R[k].x+ox+X, R[k].y+oy+Y, sr)
```
0x4ac/4 = 299 = farthest shape. 25 rings x 12 frames = 300 = number of shapes, so the oldest ring
reaches shape 0 just as it would be dropped.

The jump table at 0e40:02c5 has 8 entries (0e40:02d5, 02fb, 0322, 0349, 0370, 0397, 03be, 03e5), one
per value of (rx & 7): each stores the 8 base addresses `[0x1076+2k] = base + ((k + (rx&7)) >= 8)`
and loads al,ah,bl,bh,cl,ch,dl,dh with `0x80 >> ((k + (rx&7)) & 7)`; `lcall ds:[si]` (0e40:0425)
then calls the compiled shape. Net effect = plotDot at (rx+X, ry+Y) as above.

### Flip (0e40:044a)
`start = [0x446]; [0x446] ^= 0x9600; [0x448] ^= 0x0960; es = [0x448]; CRTC 0x0c/0x0d = start`
(shows the page just drawn; the new page is drawn next; the CRTC start is latched at the next retrace).

### Main loop (0e40:063b)
```
map mask 0x0f; clear a000:0000..f9ff (64000 bytes, all planes)
alloc 2 x 0xca3 paragraphs (code blocks)
map mask 0x0f; GC5 = (GC5 & 0xfc) | 3           // write mode 3
wait tick (0731:00a3)
setPalette(); CRTC 0x13 = 0x20; build tables      // 0e40:005c
precalc()                                         // 0e40:023d  (CPU time: 77 ticks here)
addRing()
cx = 1400
do {                                              // phase 1: 1401 iterations at 1 tick each
  wait tick
  clear(back); addRing(); drawRings(); advance()
  n = ticks since the wait (08d8:157e; 1 if no overrun)
  repeat n-1 times { addRing(); advance() }       // catch up
  flip()
  cx -= n
} while (cx >= 0)
addRing()
loop {                                            // phase 2: ~290 iterations
  wait tick
  clear(back); drawRings(); advance(); flip()
  removeRing(); if (ringCount == 0) break
  n = ticks; repeat n-1 times { removeRing(); if (ringCount==0) goto end; advance() }
}
end: free code blocks; 0000:002b (all 256 DAC entries = 0); retf
```
It never reads the music position.

### Timing in the recording
- 18887: first ring visible. The first frame is drawn into page 0, which is already on screen, so it
  appears at 18887 (raster race) and again at 18888 after the flip. From then on, logic step k
  (k = 0, 1, ...) is shown at frame 18888 + k.
- New ring every 12 frames (18888..18899 one ring, 18900 two rings).
- Phase 1 = 1401 frames (18888..20288), phase 2 = 290 frames (20289..20578). The last two drawn frames
  are not seen: the black palette (0:2b) is set within frame 20577 -> last dots at 20576.
- No frame overran (all checked frames match with exactly one logic step per tick).

---------------------------------------------------------------------------------------------------

## 3. 08d8 part: shared machinery

### 3.1 Resources and loader: 08d8:396c / 08d8:39b1
```
396c: load 'citydata' -> [0x36ef] (64000 bytes = 200 frames x 320)
      load 'bg2     ' -> [0x370d] (24000 bytes = motorcycle, 3 planes x 8000)
      load 'citydat2' -> [0x36f9] (28800 = 90 frames)
      load 'citydat3' -> [0x3703] (51200 = 160 frames)
      ROW[i] = 40*i for i = 0..149, words at 08d8:370f
39b1: free [0x36ef], [0x36f9], [0x3703], then `mov si,0x3705` (bug: should be di=0x370d) and a 4th
      free with whatever di is -> bg2 is never freed. Irrelevant for the port.
```
Other resources named in the brief: `ugu`, `ugu2` = greetings (0eb3, G5); `xla02`, `try4c`,
`titcha08`, `0`..`10`, `frak2`, `zoompal` are named in segment 0 (0000:0b3a..0bba) and used by the
later effects, not by this slice.

### 3.2 Pages
The 64 KB of each plane hold 8 pages of 8000 bytes (40 x 200): page k at offset k*0x1f40
(segment 0xa000 + k*0x1f4); 7*0x1f40 = 0xdac0 is page 7.

```
cyclePage():                       // 08d8:3161 (far)
  ax = [0x303e]                     // page being left; returned
  [0x303e] += 0x1f40
  if ([0x303e] == 0xfa00) { [0x303e] = 0; [0x2ea8] = ~[0x2ea8] }
  [0x3040] = ([0x2ea8] == 0) ? 2 : 1
  return ax
setColorSelect():                  // inline everywhere: attribute reg 0x14 (written as 0x34)
  CS = ([0x3040] == 1) ? 1 : 0
```
Initial: [0x303e] = 0, [0x2ea8] = 0, [0x3040] = 0.
With P54S = 1 (set in 3041), DAC index = 16*CS + colour. So the screen cycles through the 8 pages
with palette half A (DAC 0..15) and then the same 8 pages with half B (DAC 16..31): a 16-frame
animation from 8 pages. The "Surprise" pattern is drawn in plane 0 for the 8 A frames and in plane 1
for the 8 B frames; the palettes make half A depend only on bit 0 and half B only on bit 1.

```
showPages(cx):                     // 08d8:346a (far), cx+1 iterations
  do {
    cyclePage()
    if ([0x3468]) {                // palette fade, initial [0x3468]=1, [0x3469]=0
      work = interp(PAL_32b8, PAL_3198, dh=[0x3469], dl=0x46, 32 colours)   // 0299:0023
      if (++[0x3469] == 0x47) [0x3468] = 0
    }
    CRTC start = [0x303e]
    wait tick
    if ([0x3468] == 1) DAC[0..31] = work            // 0299:0076
    setColorSelect()
  } while (--cx >= 0)              // "mov ax,1 ; sub cx,ax ; jns"
```
So dh = 0, 1, .., 0x45 are written on frames 1..70 (dh 0 and 1 are still black). The last step
(dh = 0x46 = full target) is computed but never written, because the flag is cleared first: the
palette stays at 69/70 of PAL_3198 (visible in the capture: (6,6,8) shows as
(5,5,7)). Only the first call (cx=0x96) fades; the second call (cx=0x32) only cycles pages.

### 3.3 Palette helpers
```
interp(src, dst, dh, dl, n):       // 0299:0023: for each of 3n bytes
  d = int8(dst - src)              // 8-bit difference
  q = trunc(d * int8(dh) / int8(dl))   // imul/idiv byte, 8-bit quotient
  out = (src + (q & 0xff)) & 0xff
fade0749(ax=n, si=src, di=dst, bp=work, dl=steps, bx=firstIndex):   // 0749:0153
  for dh = 1 .. dl:
    work = interp(src, dst, dh, dl, n)
    wait until 3da bit3 == 0, then until bit3 == 1   (start of vertical retrace)
    DAC[bx ..] = work (0299:0076)
    lcall 008e:1f63                   // music tick by hand (the BIOS timer is installed meanwhile)
```
0299:0076 sets Seq 1 bit 5 (screen off) while writing the DAC; no visible effect in the capture.

Palettes (08d8, 32 colours = 96 bytes unless noted; 6-bit RGB):
- 3198 (pattern, faded to): A: 0:(6,6,8) 1:(21,21,25) 2:(6,6,8) 3:(21,21,25) 4:(24,27,24)
  5:(51,54,51) 6:(24,27,24) 7:(51,54,51) 8..15: 0. B: 16:(6,6,8) 17:(6,6,8) 18:(21,21,25)
  19:(21,21,25) 20:(24,27,24) 21:(24,27,24) 22:(51,54,51) 23:(51,54,51) 24..31: 0.
  (decimal; hex in the image: 06 06 08, 15 15 19, 18 1b 18, 33 36 33)
- 31f8 (city): as 3198 but 5/7 = (26,29,26) (B: 22/23), and 8..15 / 24..31 = (50,50,60) lilac.
- 3258 (door, 2nd half): 0 = (0,0,0), 1..15 = (50,50,60); same for 16..31.
- 32b8: 32 black entries; 3378: work buffer (zeros).
- 3438 (motorcycle, 16 colours): (59,59,59)x2 (47,51,55)x2 (39,43,47)x2 (27,31,35)x2 (15,15,19)x2
  (0,0,0)x2 (59,0,0)x2 (59,39,39)x2. Each pair is equal, so plane 0 is invisible.

### 3.4 The vector engine (08d8, shared)

Variables (segment 08d8, values at the time these routines run): [0x8e] Xcentre = 160 (set by
08d8:2dc1), [0x90] maxY = 199, [0x92] Ymode = 0, imm word at [0x914] Ycentre = 100 (self-modified,
last set by 2dc1), [0x95] angleX, [0x97] angleY, [0x99] angleZ (byte offsets, even, < 0x5a0),
[0xa3] D (camera distance), [0xab] xmin, [0xad] xmax, [0xa7] ymin, [0xa9] ymax (bbox / fill rect),
[0x9b] leftEdgeFlag = 0, [0x9c] [0x9e] left-edge y range, [0xa0] = 0 and [0xa2] = 0x80 (left edge
column byte / mask), [0xad1] line counter, [0x128c] = 0 here, [0xe61] imm = segment for 0e00,
[0xf2d] imm = segment for 0ecc (left at 0xa1f4 = page 1 by 08d8:18d4).
Sine table: 900 signed words at 08d8:00c1 (linear 0x8e41), 720 entries per circle (0.5 degree),
amplitude 32767, cosine = +180 entries. Read it from the image (it is not exact).

Scratch bitmaps: 1 bit per pixel, 40 bytes per row, 200 rows, at offset 0 of `scr_data` (08d8:[0],
resource `scr_data`) or `screen2` (08d8:[0xa], resource `screen2`). Both resources are 8521 bytes:
8000 zero bytes, then at 0x1f40 the bytes `00 80 40 20 10 08 04 02 01` (bit mask table used by the line
drawer at ds:0x1f41), then two 256-byte fill tables T0 at 0x1f49 and T1 at 0x2049. **The tables
differ between the two resources and must be read from the resource actually used**: in scr_data,
T0[b] = prefix-XOR fill of b starting outside (bit 7 first), T1[b] = same starting inside; screen2
has different (edge-inclusive, partly odd) tables. The door uses screen2's, and the recording
confirms them.

```
H(v) = floor(v / 65536) as int16 (high word of a signed 32-bit product)
rotProject(src points (x,y,z), n) -> (X,Y,Z)       // 08d8:07cb (self-modifying)
  S1=SIN[aY/2] C1=SIN[aY/2+180]   (aY = [0x97])
  S2=SIN[aZ/2] C2=SIN[aZ/2+180]   (aZ = [0x99])
  S3=SIN[aX/2] C3=SIN[aX/2+180]   (aX = [0x95])
  x2=s16(2x) y2=s16(2y) z2=s16(2z)
  zr  = s16(2*s16(H(z2*C1) + H(x2*S1)))
  xr  = s16(2*s16(H(x2*C1) - H(z2*S1)))
  yr  = s16(2*s16(H(xr*S2) + H(y2*C2)))
  xr2 = s16(H(xr*C2) - H(y2*S2))           // not doubled
  Yf  = s16(H(yr*C3) + H(zr*S3))
  Zf  = s16(H(zr*C3) - H(yr*S3))
  den = s16(-400 - D + Zf)                 // D = [0xa3]
  Yp = idiv(Yf * -400, den); Xp = idiv(xr2 * -400, den)   // 32/16 signed, truncating
  X = Xp + [0x8e]
  Y = Ymode==0 ? Yp + imm[0x914] : Ymode==1 ? idiv(2*Yp,3) + 0x42 : 2*Yp + 0x64
  out (X, Y, Zf)
```

```
xorLine(buf, x1, y1, x2, y2):          // 08d8:097f; one pixel per row, for XOR filling
  if (y1 == y2) return                 // horizontal lines are not drawn
  if (!(y1 > y2 unsigned)) swap ends   // (x1,y1) = bottom end
  dy = y1 - y2; pos = y1*40 + (x1 >> 3); m = 0x80 >> (x1 & 7); d = x2 - x1
  stepX(): left (d<0): m <<= 1, on carry m = 0x01 and pos--; right: m >>= 1, on carry m = 0x80, pos++
  d == 0:      dy times { buf[pos] ^= m; pos -= 40 }
  |d| == dy:   dy times { buf[pos] ^= m; pos -= 40; stepX() }
  |d| >  dy:   buf[pos] ^= m; cnt = dy & 0xff; err = 0
               loop { stepX(); err += 2dy; if (err <= |d|) continue
                      pos -= 40; if (--cnt == 0) return; err -= 2|d|; buf[pos] ^= m }
  |d| <  dy:   err = 0; dy times { buf[pos] ^= m; pos -= 40; err += 2|d|
                                   if (err > dy) { err -= 2dy; stepX() } }
```
So rows y1 (bottom) .. y2+1 get one pixel each; the top row y2 is not plotted.

```
clipLine(x1,y1,x2,y2) -> draw?        // 08d8:0b70 (+0b24); screen 0..319 x 0..maxY
  c1 = (x1<0)|(x1>319)<<2|(y1<0)<<1|(y1>maxY)<<3 ; c2 likewise for (x2,y2)
  if (c1 & c2):
    extendBbox(c1|c2): left -> xmin=0, top -> ymin=0, right -> xmax=319, bottom -> ymax=maxY
    if ((c1&c2) & 1) and not ((c1&c2) & 0x0a) and y1 != y2:
      leftEdgeFlag = 1; lo=min(y1,y2), hi=max(y1,y2); [0x9c]=max(lo,0); [0x9e]=min(hi,maxY)
    return false
  if (!(c1|c2)) return true
  if (c1):
    if (c1&1)        { leftEdgeFlag=1; [0x9c]=clamp(y1,0,maxY);
                       y1 += idiv((y2-y1)*(-x1), x2-x1); [0x9e]=y1; x1=0 }
    if (c1&4 && x1>319)  { y1 += idiv((y2-y1)*(319-x1), x2-x1); x1=319 }
    if (c1&2 && y1<0)    { x1 += idiv((x2-x1)*(-y1), y2-y1); y1=0 }
    if (c1&8 && y1>maxY) { x1 += idiv((x2-x1)*(maxY-y1), y2-y1); y1=maxY }
    if (!c2) goto clamp
  if (c2&1)          { leftEdgeFlag=1; [0x9c]=clamp(y2,0,maxY);
                       y2 += idiv((y2-y1)*(-x2), x2-x1); [0x9e]=y2; x2=0 }
  if (c2&4 && x2>319)  { y2 += idiv((y2-y1)*(319-x2), x2-x1); x2=319 }    // x2=319 only if x2!=x1
  if (c2&2 && y2<0)    { x2 += idiv((x2-x1)*(-y2), y2-y1); y2=0 }
  if (c2&8 && y2>maxY) { x2 += idiv((x2-x1)*(maxY-y2), y2-y1); y2=maxY }
  clamp: clamp x1,x2 to 0..319 and y1,y2 to 0..maxY; return true
  (a zero divisor skips the idiv and adds the low word of the product instead)

bbox(x1,y1,x2,y2):                    // 08d8:0f93 — assumes y1 >= y2 (not true for the door!)
  if (y1 >= ymax) ymax = y1;  if (y2 <= ymin) ymin = y2
  if (x1 <= x2) { if (x2 >= xmax) xmax = x2; if (x1 <= xmin) xmin = x1 }
  else          { if (x1 >= xmax) xmax = x1; if (x2 <= xmin) xmin = x2 }

leftEdge(buf):                        // 08d8:0ad3: vertical XOR edge at x = 0 for lines clipped on the left
  a=[0x9c], b=[0x9e]; if (a != b) { if (a > b) swap; a=max(a,0); b=min(b,maxY)
    for row = a+1 .. b: buf[row*40 + 0] ^= 0x80; lineCount++ }
  leftEdgeFlag = 0

clippedLine(buf, x1,y1,x2,y2):        // 08d8:13f7
  if (clipLine(...)) { bbox(...); xorLine(buf, ...); lineCount++ }
  if (leftEdgeFlag) leftEdge(buf)
```

```
xorFill(buf, T0/T1 = buf's own tables, pageOffset, mapMask, xmin,xmax,ymin,ymax, opaque)
                                       // 08d8:0e00 (opaque=false), 08d8:0ecc (opaque=true)
  rows = ymax - ymin + 1; if (rows <= 0) return          // signed
  b0 = xmin >> 3; width = (xmax >> 3) + 1 - b0           // unsigned shifts
  for each row r = ymin .. : pos = r*40 + b0; state = 0
    for j = 0 .. width-1:
      v = buf[pos+j]
      if (v == 0 && j < width-1) { if (opaque || state) VRAM[pageOffset+pos+j] = state; continue }
      VRAM[pageOffset+pos+j] = state ? T1[v] : T0[v]     // always written (also for 0e00)
      if (popcount(v) odd) state ^= 0xff
      buf[pos+j] = 0                                     // the scratch is cleared as it is read
  (VRAM write = the byte goes to every plane enabled in mapMask; write mode 0)
```
Scratch bits outside the filled rectangle are never cleared and stay for the next user of that
buffer (this happens in the morph, see 3.6; the simulator keeps them and matches).

```
renderObject(obj):                    // 08d8:128d, es = object segment; only what this slice uses
  header words: [0]=nPlanes [2]=nFaces [4]=faces [6]=edgeBuf [8]=nVerts [0xa]=projected [0xc..]=verts(x,y,z)
  edgeBuf.count = 0
  projected[] = rotProject(verts)
  for each face f (record: word colour (bl=low, bh=high), word nEdges, nEdges x (ptrP, ptrQ)):
    front = backface(f)                // 08d8:0926 below
    bl = colour & 0xff
    if (!front) { if (bh == 0) skip face; bl ^= bh }
    for each edge (P,Q): (x1,y1)=P, (x2,y2)=Q
      if (y1 < y2) swap both ends; else if (y1 == y2 && !(x2 > x1)) swap x1,x2
      if an entry with the same x1,y1,x2,y2 exists: entry.colour ^= bl   // shared edges cancel
      else append {bl, x1, y1, x2, y2}
  bit = 1
  repeat nPlanes: map mask = bit; xmax=-1000 xmin=1000 ymax=-1000 ymin=1000; lineCount=0
    ds = scr_data; for each entry with colour & bit: clippedLine(scr_data, x1,y1,x2,y2)
    if ([0x128c] == 1) { fill... }     // 0 in this slice: no fill here
    bit <<= 1
backface(f):                          // 08d8:0926: C=e0.P, B=e0.Q, A=e1.Q (projected points)
  v = (A.y-C.y)*(B.x-C.x) - (B.y-C.y)*(A.x-C.x)    // 32-bit
  front = (v >= 0)
```

### 3.5 Motorcycle + building the pattern: 08d8:3041 (+ 2ecd, 2e92, 2ea9)
```
[0x95]=0 [0x97]=0x514 [0x99]=0x578 [0xa3]=0x4b0 [0xe61]=0xa000
black DAC (0:2b); mode (0299:01cc: AMC=0x01 i.e. P54S=0)
map mask 0x0f; clear a000:0000..f9ff (all 8 pages, all planes)
wait tick; DAC[0..15] = PAL_32b8 (black)
CRTC start = 0xdac0 (page 7)
copy bg2: plane1 <- bg2[0..7999], plane2 <- bg2[8000..15999], plane3 <- bg2[16000..23999], at 0xdac0
restore BIOS timer (0731:0158)
fade0749(16 colours, PAL_32b8 -> PAL_3438, 70 steps)      // fade in, 70 retraces
install retrace timer (0731:013c)
[0x2ea5] = 0x0102 (map mask plane 0); renderPattern(15)  // CPU bound: the "hold"
P54S = 1 (0299:009c)
restore BIOS timer; fade0749(16, PAL_3438 -> PAL_32b8, 70); retrace timer
CRTC start = 0
map mask 0x0e; clear page 7 (0xdac0, 8000 bytes) in planes 1..3
renderPattern(1)
[0x128c] = 1; [0xe61] = 0xa000
```
`renderPattern(n)` = 08d8:2ecd, n times:
```
obj = segment 03bf (image linear 0x3bf0): nPlanes=1, nFaces=1, faces at +1212, edgeBuf +1616,
      100 vertices at +0x0c, projected at +612. The face has colour 0x0801 and 100 edges
      (the "Surprise!" lettering as closed polygons).
MOVES = [(-900,+800),(900,0),(900,0),(200,-200),(-900,0),(-900,0),(200,-200),(900,0),(900,0),
         (200,-200),(-900,0),(-900,0),(-900,0),(200,-200),(900,0),(900,0),(200,-200),(-900,0),
         (-900,0),(-900,0),(200,-200),(900,0),(900,0)]            // 23 copies (8d8:2ed8..2fe9)
for (dx,dy) of MOVES: moveObj(dx,dy); renderObject(obj)        // XOR lines accumulate in scr_data
moveObj(-300, +400)                                              // net 0
map mask = [0x2ea5] >> 8
xorFill(scr_data, pageOffset = ([0xe61]-0xa000)*16, mask, 0,319,0,199, opaque=false)  // 0e00
// 08d8:2ea9:
pageCount++                        // [0x2ea7], initial 0
if (pageCount == 8) { [0x2ea5] = 0x0202 (plane 1); [0xe61] = 0xa000 } else [0xe61] += 0x1f4
d = 12 + (pageCount & 1); moveObj(+d, -d)                        // diagonal scroll per frame
moveObj(dx,dy) = 08d8:2e92: add dx to x and dy to y of the 100 vertices (permanent)
```
Result: renders 1..8 -> pages 0..7 plane 0, renders 9..15 -> pages 0..6 plane 1, render 16 (after
the motorcycle) -> page 7 plane 1. Projection with D = 1200 makes it a tilted plane of "Surprise!"
logos. While the motorcycle is shown, render 8 writes plane 0 of page 7, invisible because of the
paired palette.

Recording: fade in dh=1..70 at frames 20580..20649, hold 20650..20678 (29 frames = time of
renderPattern(15); about 10 frames in cap2), fade out dh=1..70 at 20679..20748, 20749..20750 black
(page 7 clear + renderPattern(1)), first showPages frame 20751.

### 3.6 Transforming objects: 08d8:346a(cx=0x96) then 08d8:35f6
showPages(0x96): 151 frames (20751..20901), pattern scrolling, palette fade (see 3.2).

35f6:
```
[0xab]=90 [0xad]=230 [0xa7]=40 [0xa9]=160 (fill rect); map mask 0x04 (plane 2)
F = [0xf2d]-0xa000 page (initially page 1, left over by 08d8:18d4)
for pair = 0 .. 15:                               // table 08d8:35ae: (A,B) offsets, 0xffff end
  t = 1
  repeat 60:
    for poly in (0, 52): for k = 0..50:           // 08d8:350b, 2 polylines x 51 segments
      i = poly + k
      a = (x,y,x',y') = points i, i+1 of shape A; b = same of shape B   // words at linear 0x2ef0+A+4i
      v[j] = a[j] + idiv((b[j]-a[j]) * t, 50)     // 16-bit
      xorLine(scr_data, v0, v1, v2, v3)           // no clipping, no bbox
    xorFill(scr_data, F, plane 2, 90,230,40,160, opaque=true)       // 0ecc
    n = ticks; repeat n: cyclePage()
    CRTC start = [0x303e]; F = [0x303e]
    wait tick; setColorSelect()
    t = min(t+1, 50)
```
Shapes: 8 shapes of 104 points (x,y screen coordinates, already centred at 160,100) at linear
0x2ef0 + 416*s (s = 0..7); shape 7 is all (160,100) (collapsed). Pair table (shape numbers):
7->0, 0->1, 1->2, 2->3, 3->4, 4->5, 5->6, 6->2, 2->4, 4->1, 1->6, 6->1, 1->0, 0->3, 3->7, 7->7.
So each morph takes 50 frames and rests 10.

Important timing detail: the shape is drawn into F = the page that became visible at the previous
tick, i.e. **into the page currently on screen**, early in the frame. DOSBox shows it in that same
frame (the recording matches only this way); see the frame model in section 5.

The shapes reach x 233 and rows 39 and 161, outside the fill rectangle: those scratch bits are never
cleared and stay in scr_data (the city uses the same buffer afterwards; the simulator keeps them and
matches).

### 3.7 Band + contour city: 08d8:39d4 (+ 3902, 383b, 3878, 38ea, 38bf)
```
DAC[0..31] = PAL_31f8 (immediately, 0299:0076)
map mask 0x04 (plane 2)
bp = 0x1ef0
repeat 30:
  showPages(1)                                      // 2 frames
  for page = 0..7: 80 bytes of 0xff at page*0x1f40 + bp   // rows bp/40 and bp/40+1, plane 2
  bp -= 0x50
// rows 198,199 first ... 140,141 last: the band rises 2 rows per 2 frames (60 frames)
cityPlay(citydat3, 160)     // 38ea
cityPlay(citydata, 200)     // twice (39d4 loop cx=2)
cityPlay(citydata, 200)
cityPlay(citydata, 165)     // 38bf
cityPlay(citydat2, 90)
cityPlay(res, frames): si = 0; c = frames-1; do { c -= cityFrame() } while (c >= 0)

cityFrame():                                        // 08d8:3902
  n = ticks; repeat n: ax = cyclePage()             // ax = page just left (no longer visible)
  CRTC start = [0x303e]; wait tick; setColorSelect()
  // 383b: plot the contour into scr_data
  for col = 0..39: zeros = 0
    for bit = 0..7: h = res[si++]
      if (h) scr[ROW[h] + col] |= 0x80 >> bit else zeros++
    if (zeros == 8) scr[col] = 0xff                 // marker in row 0: empty column byte
  // 3878: vertical XOR fill into page ax, plane 2, rows 0..139
  for col = 0..39:
    if (scr[col] == 0xff) { scr[col] = 0; VRAM[ax + col + 40r] = 0 for r = 0..139; continue }
    acc = 0
    for r = 0..139: v = scr[col + 40*(r+1)]; if (v) { acc ^= v; scr[col+40*(r+1)] = 0 }
                    VRAM[ax + col + 40r] = acc
  return n
```
Heights h are 0..138 in the data. A height h fills video rows h-1 .. 139 of that pixel column (the
fill reads scratch row r+1 for video row r); h = 0 = nothing. Scratch rows > 140 are never read or
cleared. The fill writes into the page that is not visible; it is seen 7 frames later when the
cycle comes back to it (each page carries its own city frame).

Recording: band 21862..21921, city 21922..22736 (815 frames), then showPages(0x32) 22737..22787.

### 3.8 Rotating door: 08d8:3e3a (+ 3d90, 3d3c, 3d5c)
```
map mask 0x08 (plane 3); [0xa3] = 0; save and zero [0x95],[0x97],[0x99]
cx = 0x61; do { doorFrame(); cx -= 1 } while (cx >= 0)          // 98 frames
wait tick                                                        // one extra frame, no page change
DAC[0..31] = PAL_3258; map mask 0x0f
cx = 0x61; do { doorFrame(); cx -= 1 } while (cx >= 0)          // 98 frames
restore the three angles; retf

doorFrame():                                     // 08d8:3d90 (157e is called but its result ignored)
  for i = 0..19:  pts[i].x += 4                  // 3d3c: left bars move right
  for i = 20..39: pts[i].x -= 4                  //       right bars move left
  P = rotProject(pts)                            // 3d5c (angles 0,0,[0x99]; D = 0; centre 160,100)
  [0x99] += 4; if ([0x99] >= 0x5a0) [0x99] -= 0x5a0   // 1 degree per frame, applied next frame
  ax = cyclePage(); CRTC start = [0x303e]; wait tick; setColorSelect()
  for e = 0..39: (a,b) = EDGES[e]; clippedLine(screen2, P[a].X, P[a].Y, P[b].X, P[b].Y)
  xorFill(screen2 (its own tables!), page ax, current map mask, xmin,xmax,ymin,ymax, opaque=true)  // 0ecc
```
Data: 40 points (x,y,z words) at 08d8:3a3c: 10 rectangles 375 x 40, left group x -575..-200,
y = -200,-120,-40,40,120 (+40 high), right group x 200..575, y = -160,-80,0,80,160; z = 0.
Edges: 40 word pairs at 08d8:3c6c = byte offsets (6 per point) into the projected array 08d8:3b2c;
each rectangle (4k, 4k+1, 4k+2, 4k+3) closed. The bbox starts from 35f6's (90,230,40,160) and only
grows (it is never reset here); remember bbox() assumes y1 >= y2, which these edges do not respect.

First half: lilac bars (plane 3 -> colours 8..15 lilac in PAL_31f8) over the pattern and city.
Second half: all four planes written inside the bbox: inside the bars colour 15, elsewhere colour 0,
with PAL_3258 (0 black, 1..15 lilac); outside the bbox the old picture shows lilac.
Recording: 22788..22885, extra tick 22886 (already with PAL_3258), 22887..22984.
The last frames are black (bars gone). Then 39b1 frees; black until the picture zoomer at 22989.

---------------------------------------------------------------------------------------------------

## 4. Timing and music
- All 08d8 effects: one step per tick (0731:00a3), with the 157e catch-up (`n = ticks; cycle n pages`)
  that never triggered in the recording. The door ignores it (always 1).
- Motorcycle fades: 0749:0153 polls 3da bit 3 itself and calls the music tick (BIOS timer installed
  during the fades); 70 retraces per fade.
- CPU-bound gaps (port should use the recorded lengths): tunnel precalc 77 black frames
  (18810..18886; 74 in cap2), motorcycle hold 29 frames (20650..20678).
- No routine in this slice reads the music position.

## 5. Port checklist
- Model 4 bitplanes x 64 KB; pages at multiples of 0x1f40 (08d8 part) / 0 and 0x9600 with 64-byte rows
  (tunnel).
- Frame model that reproduces every frame: a frame starts at a tick; its CRTC start is the value written
  before that tick, its colour select and DAC are the values written right after that tick (DAC
  writes done later in the frame, e.g. 39d4's palette right after the last morph tick, also count for
  that frame); its pixels are the VRAM contents just before the *next* tick (so drawing done into the
  visible page right after a tick shows in the same frame: the morph, the band rows, the tunnel's first
  frame).
- DAC index = P54S ? 16*CS + c : c. P54S is off during the motorcycle fade-in and on from the middle of
  the hold; the tunnel only needs DAC 0..15 (CS is 0 there).
- Keep the scratch buffers (scr_data, screen2) as persistent byte arrays including their table tails.
- Reference code: `work/G6/sim08.py` (08d8 part) and `work/G6/simtun.py` (tunnel).
