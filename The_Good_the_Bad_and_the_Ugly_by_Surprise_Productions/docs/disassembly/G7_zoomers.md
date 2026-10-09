# G7: Picture-zoomer (0d97:013c) and Rotating-Fractal-zoomer (0d34:04e1)

Slice G7 of the GBU.EXE disassembly notes. Both effects run in plain **mode 13h** (320x200, chain-4, one
byte per pixel, stride 320, A000:0000, single page, no CRTC tweaks). Everything is drawn straight into the
visible page; nothing is double-buffered.

**Verified.** Two Python models of the pseudo-code below reproduce the recording **pixel for pixel**:
- `work/G7/simzoom.py`: picture zoomer, all 1171 frames.
- `work/G7/simfrak.py`: fractal zoomer, all 1408 frames, plus all 70 frames of the fade.

The only exception is one transition frame, which is explained below. Both models use the 6-bit to 8-bit
mapping `(v<<2)|(v>>4)`. Where these notes and the assembly listing disagree, the models are the reference:
they were checked against the recording.

## Summary (what is seen, in order)

Frame numbers are global capture frames (`capat.py --frame G`). t = G / 70.086.

| global frames | t (s) | what |
|---|---|---|
| 22981 | 327.90 | main sets mode 13h (black). 0d97:013c loads its files and sets mode 13h again. |
| 22989..23088 | 328.01..329.42 | **zoom 1**: `try4c` (3 warriors) grows from the centre, 1 step per frame (100 steps). |
| 23089..23248 | | hold (160 ticks) |
| 23249..23348 | 331.72.. | **zoom 2**: `xla02` (space ship) grows over try4c |
| 23509..23608 | 335.43.. | **zoom 3**: `titcha08` (green robot) grows over the ship |
| 23609..24379 | 336.86..347.84 | **wobble** of the robot: every scanline is drawn with its own horizontal scale from a 1-D table, and the table scrolls 3 bytes per frame. The first visible change is at 23703 (the bottom line). The picture is still again from 24376. |
| 24540..24639 | 350.14.. | **zoom 4**: `frak2` (Julia-set picture, the first fractal) grows over the robot |
| 24639 | 351.55 | top 87 lines = frak2; the rest is already black (0d34 init filling the screen with colour 0xff while the beam scans) |
| 24640..26047 | 351.57..371.64 | **rotating fractal zoomer**: an approx. 120x120 square rotates 90 degrees and zooms 2x into the fractal. It does this 11 times, once per picture `0`..`10`, 128 frames each. Picture p starts at frame 24640+128p. |
| 26049..26118 | 371.69..372.67 | palette fade to black (70 steps, one per retrace) |
| 26121 | | next effect (not G7) |

In the capture file video0009 (local frame = global - 16208), the zoom-1 start is local 6781.

Video mode: mode 13h throughout. Palette: 6-bit DAC writes. Timing is driven by the retrace timer
(0731:00a3 "wait tick" + 08d8:157e "read tick counter"). Each loop adds the elapsed ticks to its animation
position, so a slow frame skips steps instead of slowing down. At 60000 cycles no frame was ever skipped: one
step per retrace everywhere, which the models confirm. Neither effect reads the music position. The fade calls
the music tick itself (see 0749:0153).

### Routine list

| addr | name |
|---|---|
| 0d97:013c | PictureZoomer main |
| 0d97:00c8 | ZoomInPictures(cx = count) |
| 0d97:004d | LoadNextPicture |
| zoomcde2 overlay (seg in 0d97:[0xc6], called `lcall cs:[0xc4]`, AH = function) | 0: InitRowTable, 1: DrawZoomRect, 2: DrawWobble |
| zoomcde2 0x0013..0x7df3 | 100 generated span-scaler routines |
| 0d34:04e1 | FractalZoomer main |
| 0d34:0066 | FractalInit |
| frakcode overlay (seg in 0d34:[0x1da], offset 0x1a, called `lcall cs:[0x1d8]`) | 0: InitTables, 1: SetupFrame+Render, 2: Advance(cx) |
| 0749:0153 | FadePalette (with music tick); 0299:0023 is its interpolation |
| shared helpers | 0299:0000 RLE decode, 0299:0076 SetPalette, 0731:00a3 WaitTick, 08d8:157e GetTicks, 0731:0158 / 0731:013c timer switch, 008e:04b3 / 0063 / 0014 resource load / free / alloc |

---

## Shared helpers

**0731:00a3 WaitTick**: `ticks = 0; while (ticks == 0) {}`. `ticks` = word 0731:[4], incremented by the
retrace-synced IRQ 0 handler once per vertical retrace. After it returns, ticks == 1.

**08d8:157e GetTicks**: returns `cx = ticks` (0731:[4]) and also stores it at 08d8:[0x157c]. It does not
wait. Used right after drawing, it returns 1 plus the number of retraces that passed during the drawing.

**0299:0000 RleDecode(ds:si -> es:di, bx = byte count)**: si and di advance; the loop runs until bx == 0
exactly.
```
do { c = src[si++];
     if (c <= 0x7f) { n = c+1; bx -= n; copy n literal bytes }
     else           { n = 0x101 - c; bx -= n; v = src[si++]; write v n times }
} while (bx != 0)
```
(frakcode has an identical copy at overlay offset 0x9070, which is a near call.)

**0299:0076 SetPalette(di = first index, cx = count, ds:si = RGB bytes)**: blanks the screen (SR1 |= 0x20),
then `out 3c8,di`, writes 3*cx bytes to 3c9, then un-blanks (SR1 &= ~0x20). No retrace wait inside.

**0299:0023 PalInterp(cx = colours, ds:si = from, ds:di = to, ds:bp = out, dh = step, dl = steps)**: for each
of the 3*cx bytes:
`out = (from + trunc_toward_zero( int8(to - from) * dh / dl )) & 0xff` (imul dh, then idiv dl, 8-bit quotient).

**0749:0153 FadePalette(ax = colours, si = from, di = to, bp = work, dl = steps, bx = first DAC index)**:
```
for (dh = 1; dh <= dl; dh++) {
  PalInterp(ax colours, si, di, bp, dh, dl)
  wait while (in 3da & 8); wait until (in 3da & 8)      // start of the next vertical retrace
  SetPalette(first = bx, count = ax, from bp)
  lcall 008e:1f63                                        // one music-player tick
}
```
It is called with the BIOS timer restored (0731:0158), so the music advances exactly once per fade step
(= once per retrace).

---

## Effect 1: Picture-zoomer, 0d97:013c

### Data and variables (segment 0d97)
| addr | meaning | initial |
|---|---|---|
| 0d97:[0x00] | name "zoompal " | |
| 0d97:[0x08] | seg of zoomcde2 (copied to 0xc6) | |
| 0d97:[0x0a] | name "zoomcde2" | |
| 0d97:[0x12] | seg of zoompal | |
| 0d97:[0x14] | zoom step countdown | 0x64 |
| 0d97:[0x16] | seg of 64000-byte work buffer (alloc 0xfa0 paragraphs) | |
| 0d97:[0x18],[0x20],[0x28],[0x30] | names "try4c", "xla02", "titcha08", "frak2" | |
| 0d97:[0x38],[0x3a],[0x3c],[0x3e] | their segments (picture list, in this order) | |
| 0d97:[0x48] byte | palette half toggle (0 / 0x80) | 0 |
| 0d97:[0x49] word | pointer into the picture list | 0x0038 |
| 0d97:[0x4b] word | offset into zoompal | 0 |
| 0d97:[0xc4] dword | far pointer zoomcde2:0000 | |
| 0d97:[0x139] word | ticks of the previous wobble frame | |

### Resources
- `zoompal` (res/34, 3072 bytes): 4 blocks of 0x300. Picture k uses the **first 128 colours** (0x180 bytes)
  of block k (offset k*0x300).
- `try4c` (res/37), `xla02` (res/36), `titcha08` (res/38), `frak2` (res/39): 320x200 pictures, RLE (0299:0000)
  to exactly 64000 bytes. Pixel values are < 128.
- `zoomcde2` (res/35, 46843 bytes): **code overlay with generated code and tables**. It is not a normal
  program. There are only 3 hand-written entry functions; the rest is 100 unrolled span routines plus tables:

| zoomcde2 offset | content |
|---|---|
| 0x0000 | dispatcher: AH=0 -> 0xb667, AH=1 -> 0xb63c, else -> 0xb67c |
| 0x0013..0x7df3 | 100 generated routines, one per width index s=0..99. Each is `add di, x0` followed by W times `movsb` with `add si, n` / `inc si` between them (wide ones use `mov cx,n; rep movsb`), then `ret`. |
| 0xa568 | 100 words: entry address of span routine s |
| 0x7df4..0xa567 | 100 row lists: list s has 2(s+1) bytes = source row numbers |
| 0xa630 | 100 words: address of row list s |
| 0xa6f8 | 200 words: y*320 (filled by AH=0) |
| 0xa888 | **wobble table**, 3102 bytes, values 29..100 (the last 2 bytes are 0 and never read). The port reads it from the resource. |
| 0xb4a6 | 200 words: previous right edge per row, initially 0 |
| 0xb636 / 0xb638 / 0xb63a | row*2 / mirror base / wobble position (word, initially 0) |

**Span routine s** (s = 0..99), with the arguments si = source row start and di = destination row start:
```
W  = floor(16*(s+1)/5)          // 3, 6, 9, 12, 16, ... 316, 320
x0 = (320 - W) >> 1
for k in 0..W-1: dst[di + x0 + k] = src[si + srcx(s,k)]
on return: di = row start + x0 + W
srcx(s,k) = floor(k*320/W), except these 22 entries (the table was made with float rounding):
  W=28 : k21->239
  W=112: k21->59, k42->119, k77->219, k84->239
  W=224: k21->29, k42->59, k77->109, k84->119, k154->219, k161->229, k168->239, k175->249
  W=236: k177->239
  W=275: k55->63, k110->127, k220->255
  W=278: k139->159
```
**Row list s**: H = 2(s+1) entries, `row(s,k) = floor(k*200/H)`, except:
`H=24 k15->124; H=48 k30->124; H=70 k21->59, k42->119; H=96 k60->124; H=140 k21->29, k42->59, k77->109, k84->119; H=192 k120->124; H=194 k97->99`.

(Extracted by symbolic execution of every routine: `work/G7/spans.py`, with the result in
`work/G7/spans.json`. Both formulas were checked against all 100 routines and lists.)

### Overlay functions
```
AH=0 (b667) InitRowTable: for y in 0..199: rowTab[y] = y*320

AH=1 (b63c) DrawZoomRect(bx = 2*s, cx = rows, di = dest start; ds = source, es = A000):
  list = rowList[s]; span = spanRoutine[s]
  for k in 0..cx-1:
     si = rowTab[list[k]]; span(si -> di); di += 320   // di is saved and restored around each span call
  // on return: bp = the cx that was passed in (pop bp), di = restored to the input di

AH=2 (b67c) DrawWobble(cx = ticks; ds = source picture, es = A000):
  pos += 3*cx                             // word zoomcde2:[0xb63a]
  for r in 0..199:
     i  = wob[pos + 3*r] - 1              // byte table at 0xa888; values 1..100
     span i: draw source row r into screen row r (si = di = r*320)
     R  = r*320 + x0(i) + W(i)            // di after the span
     old = edge[r]                        // unsigned word compare
     if (old > R) {                       // the line got narrower: erase the leftovers on both sides
        n = old - R + 1
        edge[r] = R
        fill screen[R .. R+n-1] = 0       // right side; di ends at old+1
        d = (r*640 + 320) - (old + 1)     // = r*320 + (319 - (old - r*320))
        fill screen[d .. d+n-1] = 0       // left side (mirror)
     } else edge[r] = R
```
Watch the left side: it mirrors **old+1**, the value of di after the first `rep stosb`, and not R.
`edge[]` starts at 0, so nothing is erased until a line has first been drawn narrower than before.

### 0d97:013c PictureZoomer (main)
```
load zoompal -> [0x12]; load zoomcde2 -> [0x08]; [0xc6] = [0x08]
alloc 0xfa0 paragraphs -> [0x16]
load try4c -> [0x38], xla02 -> [0x3a], titcha08 -> [0x3c], frak2 -> [0x3e]
int 10h AX=0013h
overlay AH=0
ZoomInPictures(3)                  // try4c, xla02, titcha08
[0x139] = 0; remaining = 0x302 (770)
do {                               // wobble on the buffer (= titcha08 + 0x80)
   WaitTick()
   overlay AH=2 with cx = [0x139]  // the first call has cx = 0
   [0x139] = GetTicks()
   remaining -= [0x139]
} while (remaining >= 0)           // jns: 771 iterations at 1 tick each
ZoomInPictures(1)                  // frak2
retf                               // main then frees everything (0x12, 0x08, 0x16, 0x38..0x3e)
```

### 0d97:00c8 ZoomInPictures(cx)
```
for (n = cx; n > 0; n--) {
   WaitTick()
   LoadNextPicture()
   if (n != 3) { do cx = GetTicks(); while (cx < 0xa0) }   // hold the old picture: 160 ticks since the WaitTick above
   ds = buffer; es = A000
   bx = 0; cx = 2; di = 0x7bc0 (= row 99); [0x14] = 100
   for (;;) {
      WaitTick()
      overlay AH=1 (bx, cx, di)        // step s = bx/2: rect W(s) x 2(s+1), rows 99-s .. 100+s, centred
      cx = GetTicks()                  // after the overlay call bp = rows of this step
      repeat cx times {                // frame skip: one step per elapsed tick
         bp += 2; bx += 2; di -= 320
         if (--[0x14] == 0) goto done
      }
      cx = bp
   }
done:
   copy buffer[0..63999] -> A000:0   // full picture, same frame as step 99
}
```
The screen is never cleared: each picture grows over the previous one. That works because consecutive pictures
use different palette halves.

### 0d97:004d LoadNextPicture
```
RleDecode(picture[[0x49]] : 0 -> buffer:0, 64000 bytes)
[0x48] ^= 0x80; [0x49] += 2
for i in 0..63999: buffer[i] = (buffer[i] + [0x48]) & 0xff   // picture k: k=0 -> +0x80, k=1 -> +0, k=2 -> +0x80, k=3 -> +0
wait while (3da & 8); wait until (3da & 8)                   // start of retrace
SetPalette(first = [0x48], count = 128, zoompal + [0x4b]); [0x4b] += 0x300
```

### Timing in the recording, checked against the code
Zoom-1 step 0 is at global 22989. Steps run 1 per frame through 23088 (step 99, then the copy). The next
WaitTick is 23089. GetTicks reaches 160 at 23248, and step 0 of the next zoom is at 23249 (+260 frames). Zoom 3
starts at 23509. Wobble iteration 0 is at 23609 with cx=0; iteration j (j>=1) has pos = 3j. The first
non-100 table byte is at index 878, so row 199 first changes at j=94 (global 23703), which matches the
recording. The 771st iteration is 24379; zoom 4 starts at 24379+161 = 24540. Between the mode set (22981, a
black frame) and zoom-1 step 0 there are 8 frames. They are spent on file loading, the second mode set, the
decode, a retrace wait and two WaitTicks. A port can simply start zoom 1 eight frames after the previous effect
ends (the time taken by DOSBox file I/O is a GUESS).

The only mismatch is global 24639: zoom-4 step 99. The recording shows the top 87 lines of frak2 and black
below, because 0d34's init (screen fill with 0xff) runs during that frame's scan-out. A port can show either.

---

## Effect 2: Rotating-Fractal-zoomer, 0d34:04e1

`frakcode` (res/22, 37816 bytes) **is a code overlay**. Entry is offset 0x1a; offsets 0..0x19 are a data
header; 0x3e..0x9047 is data; the code is at 0x9070..0x93b7. It is a forward-mapping rotozoomer built on the
**three-shear rotation** (Paeth): shear x by tan(θ/2), shear y by sin θ, shear x again. Each source sample is
written to exactly one screen pixel, so the result has no holes.

### Resources
- `0`..`10` (res/23..33): 11 fractal pictures of 248x248, RLE (0299:0000 format) **row by row, 248 bytes per
  row** (no run crosses a row). Each picture is the 2x-magnified centre of the previous one.
- 0d34:[0x1de] (image linear 0xd51e, 768 bytes): the 256-colour palette (6-bit). Colour 255 is black.
- frakcode tables (read them from the file):

| offset | size | content |
|---|---|---|
| 0x00..0x14 | 11 words | segments of pictures 0..10 (written by 0d34:0066) |
| 0x16 / 0x18 | words | segments of texture buffers A / B (64 KB each) |
| 0x3e | 128 frames x 128 words | **step table** `ST[f][i]`: extra texel skip after sample i (both axes). `ST[f][0..3] = 0`, `ST[f][4]` = big skip (6..67), then 0/1 pattern, `ST[f][123]` = big skip, `ST[f][124..127] = 0`. |
| 0x803e | 128 words | `TA[f] = trunc(256*tan(f*π/512))` (0..252) |
| 0x8142 | 128 words | `TS[f] = trunc(256*sin(f*π/256))` |
| 0x8246 | 128 words | `TC[f] = trunc(256*cos(f*π/256))` (256..3) |
| 0x834a | words | X0[y]: start x of grid row (index = screen row) |
| 0x866a | words | YO[x]: 2*y offset per screen column |
| 0x898a | words | XS[y]: x shift per screen row |
| 0x8caa | 200 words | y*320 |
| 0x8e42 | 253 words | `RT[0] = 0`, `RT[r] = r*256 - 1` for r >= 1 (90a9 stores before its one-time `dec ax`). The 4 words before (0x8e3a..41) and after (0x903c..47) are 0. |
| 0x9048.. | variables | see below |

All of 0x834a..0x9047 is 0 in the file, and the tables keep their contents between frames. Only the ranges
written this frame are read.

Variables (words unless noted, initial values from the file): [0x9048] next picture to decode = **2**;
[0x904a] byte, buffer toggle = **2** (it alternates 2 / 0xfd); [0x904c] = 2*frame-in-picture = 0;
[0x906c] RLE source offset = 0; [0x906e] RLE dest offset = 0x404; [0x923b] = [0x923d] = f*0x100 = 0.
[0x9050] and [0x9064] are written or reserved but never read.

### 0d34:04e1 FractalZoomer (main)
```
load "frakcode" -> 0d34:[8]
FractalInit()
[0x1da] = [8]; [0x1d8] = 0x1a; overlay AH=0
[0x4e0] byte = 1; remaining = 0x580 (1408 = 11*128)
do {
   WaitTick()
   if ([0x4e0] == 1) {                        // byte counter: true on iterations 0, 256, 512, ... (same palette again)
      SetPalette(0, 256, 0d34:01de)
      in 3da; out 3c0, 0x11; out 3c0, 0xff; out 3c0, 0x20   // overscan colour = 255 (black)
   }
   overlay AH=1                               // set up the shear tables for frame f and render
   t = GetTicks(); [0x1dc] = t
   overlay AH=2 with cx = t                   // decode 2 rows + advance one frame, t times
   [0x4e0]++
   remaining -= t
} while (remaining > 0)                       // jg: 1408 iterations
free frakcode header segs 0..0x14 and frakcode
alloc 0x91 paragraphs; zero 0x900 bytes; copy the 0x300-byte palette 0d34:01de to its offset 0
0731:0158 (BIOS timer back; it waits for a retrace first)
FadePalette(ax = 255 colours, from = 0, to = 0x300 (all zero), work = 0x600, dl = 70, first = 0)
0731:013c (retrace timer back; it waits for a retrace)
free the block; retf
```

### 0d34:0066 FractalInit
```
for p in 0..10: load "p" (names at 0d34:[0x0a + 8p], space-padded) -> frakcode:[2p]
alloc 64 KB -> 0d34:[0x62] (= A), alloc 64 KB -> 0d34:[0x64] (= B)
fill A[0..0xfffe] = 0xff; fill B[0..0xfffe] = 0xff   // byte 0xffff is NOT filled
frakcode:[0x16] = A; frakcode:[0x18] = B
RLE-decode picture 0 into A: 248 rows of 248 bytes; row r goes to 0x404 + r*256 (= texel (4+r, 4)).
   So the texture is 256x256, the picture is at (4..251, 4..251), and the border is 0xff.
DAC colour 255 = (0,0,0)
fill A000:0..63999 with 0xff
ds = A (display buffer), es = A000
```
Texel 0xffff is never read: RT[0] = 0, so grid row j=2 reads the border at texel 0. (An earlier version of these notes had RT[0] = 0xffff; a DOSBox memory dump at this point shows the byte at 0xffff is 0 in the original, which would be visible, so the table was the error.)

### Overlay AH=0 InitTables
`for y in 0..199: T8caa[y] = y*320;  RT[0] = 0; for r in 1..252: RT[r] = r*256 - 1`.

### Overlay AH=1, part 1: SetupFrame (0x915a)
`mulhi(a,b) = ((a*b) >> 8) & 0xffff`, where a*b is a 32-bit unsigned product. All other arithmetic is 16-bit
unsigned unless marked signed.
```
f = [0x904c]/2;  A = TA[f]; S = TS[f]; C = TC[f]
hA  = mulhi(128, A)                    // = A>>1          [905a]
cnt = hA + 129                         //                 [904e]
v5c = mulhi(cnt, S)                    //                 [905c]
N   = ((128*C + 128*S) >> 8) + 1       // 32-bit sum      [9052]
sh  = (128*S) >> 8                     // = S>>1          [905e]
v62 = mulhi(N - sh, A)                 //                 [9062]
v60 = mulhi(A, sh)                     //                 [9060]
r0  = 100 - (N>>1)                     // first screen row; [9066] = 2*r0 (byte offset)
c0  = 160 - (N>>1)                     //                 [9068]

// 90c5: X0 for 128 screen rows starting at row r0
ax = c0; b = 0
for i in 0..127: X0[r0+i] = ax; b += 2*hA; if (int16(b) > 128) { b -= 256; ax++ }
// 90f1: YO for cnt screen columns starting at column c0 (values are 2*y)
ax = 2*sh; b = 0
for i in 0..cnt-1: YO[c0+i] = ax; b += 2*v5c; if (int16(b) > int16(cnt)) { ax -= 2; b -= 2*cnt }
// 9128: XS for N screen rows starting at row r0
ax = -v60; b = 0
for i in 0..N-1: XS[r0+i] = ax; b += 2*(v60 + v62); if (int16(b) > int16(N)) { b -= 2*N; ax++ }
```

### Overlay AH=1, part 2: Render (0x929e)
This part uses self-modifying code: the row byte offset is patched into `add di, imm` at 0x9301, and the outer
loop counter is kept in the `mov cx, imm` at 0x9333.
```
tex = ds (current display buffer); acc = -3 (word [906a])
for j in 0..126:                        // 127 grid rows
   y0  = r0 + j
   X   = X0[y0]
   acc = acc + 1 + ST[f][j]
   si  = RT[acc]                        // acc = -2, -1 read the 0 words before RT; acc >= 253 read the 0 words after it
   for k in 0..127:                     // 128 grid columns
      x  = X + k
      y  = YO[x]/2 + y0
      screen[(y*320 + x + XS[y]) & 0xffff] = tex[si]   // the offset is always < 64000
      si = (si + 1 + ST[f][k]) & 0xffff
```
So the texel of grid point (j,k) is `RT[acc_j] + c_k`, with `c_k = sum_{i<k} (1 + ST[f][i])` (16-bit wrap). In
every frame the first 4 and last 4 grid rows and columns sample the 0xff border. This black frame erases the
pixels left over from the previous frame. The screen is never cleared.

### Overlay AH=2 Advance(cx) (0x0032)
```
repeat cx times { DecodeStep(); NextFrame() }

DecodeStep (9241):
   if ([906e] >= 0xfa00) return
   dst = ([904a] == 2) ? B : A
   RLE-decode 2 rows of picture [9048]/2 from offset [906c]: each row is 248 bytes to dst:[906e], then [906e] += 8
// 123 calls reach 0x404 + 123*512 = 0xfa04 >= 0xfa00, so only rows 0..245 are decoded.
// Picture rows 246 and 247 (texture rows 250, 251) keep the old contents of that buffer:
// 0xff on its first use, and two pictures earlier after that. The port must keep both buffers persistent.

NextFrame (9398):
   [904c] += 2
   if ([904c] > 0xfe) {                 // after 128 frames: switch picture
      [904c] = 0; [923b] = [923d] = 0
      [9048] += 2; if ([9048] >= 0x16) [9048] = 0      // after picture 10, picture 0 is decoded again (never shown)
      ds = ([904a] == 2) ? B : A        // display the buffer that was just decoded
      [906c] = 0; [906e] = 0x404; [904a] = ~[904a]
   } else { [923b] += 0x100; [923d] += 0x100 }
```
Sequence: A holds picture 0 (shown in frames 0..127) while picture 1 is decoded into B. Then B is shown while
picture 2 is decoded into A, and so on.

### Timing in the recording
- Iteration i (i = 0..1407) is drawn at global 24640+i. At 60000 cycles there was always 1 tick per iteration,
  so f = i mod 128 and picture = i div 128. This was checked pixel-exact for all 1408 frames.
- After the loop: 0731:0158 waits for a retrace (26048). Fade step dh (1..70) is visible at global 26048+dh.
  dh=1 changes nothing because trunc(63/70) = 0. The screen is black at 26118. 0731:013c then waits one more
  retrace, and the next effect starts drawing at 26121.
- The music keeps playing during the fade, because FadePalette calls 008e:1f63 once per retrace.

---

## Shared helpers / cross-slice notes
- 0299:0000 (RLE), 0299:0076 (SetPalette with screen blank), 0731:00a3, 08d8:157e, 0731:0158/013c and
  0749:0153 + 0299:0023 (fade, also in the water module 0749) are shared with other slices.
- The picture zoomer **loads and frees `frak2`**: frak2 is its 4th picture, which leads into the fractal
  zoomer, whose picture `0` looks the same.
- The models are reference implementations: `work/G7/simzoom.py` and `work/G7/simfrak.py`. The
  span-routine extractor is `work/G7/spans.py`.
