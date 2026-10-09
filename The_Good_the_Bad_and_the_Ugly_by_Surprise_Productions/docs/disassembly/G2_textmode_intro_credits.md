# G2: Textmode cube (11d6 + 08d8:196e), Intro (08d8:275d), Credits (0db5:07b0)

Slice G2 of the GBU.EXE disassembly. Addresses are `SEG:OFF` in the unpacked image (`re/img.bin`, segment 0
based). "tick" means one timer IRQ, which happens once per VGA retrace (70.086 Hz). `0731:00a3` = "wait for the
next tick" (it zeroes the counter `0731:[4]` and spins until the counter is nonzero, so it returns with counter = 1).
`08d8:157e` (far) = `cx = 0731:[4]` (number of ticks since the last 00a3), also stored in `08d8:[0x157c]`.
Global frame numbers `g` are capture frame indexes (capat.py: `T = g / 70.086`).

Verified by simulation: `work/G2/eng3d.py` is a Python model of the 08d8 polygon engine described in §3. Driven
with the parameters below, it reproduces the capture **pixel for pixel**:
- cube: frames 4, 5, 50, 120, 121, 200, 201, 330, 400, 441 and 442 (`work/G2/cubesim.py`), with 0 differing pixels.
- intro chess plane: iterations 60, 100, 200, 300 and 360 (`work/G2/chesssim.py`), with 0 differing pixels.

Port the engine from §3 (or from eng3d.py), not from the assembly.

## Summary (what is seen, in order)

| demo time | frames g | what | code |
|---|---|---|---|
| before 0 (video0001, 720x400 text) | — | the DOS prompt screen fades over 70 retraces to gray (20,20,20) on black; DAC 63 (bright white) is not faded | 11d6:000a, part 1 |
| 0.000 | 1 | one transitional frame: half-height, garbled gray text in the lower half (a DOSBox mode-switch artefact) | 11d6:000a, part 2 |
| 0.014–0.04 | 2–3 | black | |
| 0.04–6.3 | 4–442 | two small blue rotating cubes side by side (640x400 16-colour mode, but drawn with a 40-byte stride); they come closer for 120 frames, hold for 200, move away for 120. A gray 8x2 "cursor" appears at (128..135, 377..378) on every other frame | 08d8:196e |
| 6.3–7.3 | 443–512 | the last image fades to black (70 steps) | 11d6:032c |
| 7.3–8.33 | 512–583 | black: GUS detection, MOD load, mode 13h, timer installation (other slices) | main |
| 8.33–10.2 | 584–715 | black, 320x400 (waits until the tick counter exceeds 130) | intro |
| 10.2–15.5 | 716–1085 | a 3D checkerboard plane (one bitplane, XOR-filled) flies in from the left and spins | intro phase A |
| 15.5–17.9 | 1086–1255 | the "Surprise!" logo over a chessboard (mode X picture chesspl5): fades in from white, holds, then fades to yellow while it scrolls and stretches vertically | intro phase B |
| 17.9–22.2 | 1256–~1555 | yellow square, then pyramid (object 053e), spins and moves; fades to white | intro phase C |
| 22.2–26.5 | ~1556–1855 | "PRESENTS" (mode X picture): fades from white, holds 120 ticks, fades to black | intro phase D |
| 26.5–27.9 | 1856–1959 | black (waits for music sync event 1) | |
| 27.95–28.3 | 1960–1983 | GBU heads logo slides in from the right (27 steps, 3 bytes per tick) | intro phase E |
| 28.3–32.7 | 1984–2296 | white flash, 40-step fade to the logo palette, hold until 200 ticks, 70-step fade to black | |
| 32.9–49 | 2302–~3430 | Credits: 16x16 font, 5 pages (THE CREDITS / CODING / GRAPHICS / MUSIC / DESIGN), each morphing into the next as flying pixels (64 frames) | 0db5:07b0 |

## 1. Textmode routines (Peci): 11d6:000a and 11d6:032c

Variables in cs = 11d6: `[0]` cursor VRAM offset, `[2]` cursor height, `[4]` blink flag (byte, initial 0),
`[5]` cursor colour (map mask), `[6]` font buffer segment (alloc 0x400 paragraphs), `[8]` palette buffer
segment (alloc 0x24 paragraphs). Palette data at `11d6:0323` (9 bytes: `0,0,50, 0,0,40, 0,0,30`).

### 11d6:000a: text screen to 640x400 planar
```
alloc [6]=0x400 paras, [8]=0x24 paras
buf = [8]:0
read DAC: out 3c7,0 ; 0xc0 bytes (colours 0..63) -> buf[0..0xbf]
buf[0xc0..0xc2] = 0 ; buf[0xc3..0x17f] = 0x14 (20)          // target: colour 0 black, others gray 20
fade(0749:0192 with ax=63 colours, si=0 (from), di=0xc0 (to), bp=0x180 (work), dl=70 steps, bx=0 (first DAC))
   = for k=1..70: for i<63*3: w[i] = from[i] + idiv8( imul8(int8(to[i]-from[i]), k), 70 ) (8-bit, truncated)
                   wait for retrace start (3da bit3: wait while set, then until set); DAC 0..62 = w  (0299:0076)
int10 ah=3 -> dl=col, ch/cl = cursor start/end (DOSBox: 6/7); dh is then overwritten with 0x64 (a bug)
[5] = b800:[dl + 100*160 + 1] & 15   // reads text page 3; DOSBox fills b800 with 0x0720, so [5]=7
[0] = ((1600+ch)*80) & 0xffff        // = 0xF5E0 for ch=6 (col is not used)
[2] = cl-ch+1                        // = 2
wait retrace start; cli
 SR0=1, SR2=4, SR4=7, SR0=3 ; GC4=2, GC5=0, GC6=4   (standard "access font plane 2")
copy a000:0..0x1fff (font, 256 chars x 32 bytes) -> [6]:0
SR2=0xf; clear a000:8000..fcff (32000 bytes, all planes)
for row 0..24, col 0..79 (bp = 2*(row*80+col)):
   GC4=1; attr = plane1[bp]&15 ; SR2 = attr ? 8 : 0      // plane 3 only, foreground != 0
   GC4=0; ch = plane0[bp]; copy font[ch*32 + 0..15] -> a000:[0x8000 + row*1280 + line*80 + col]
wait retrace start
SR1 |= 0x20 (blank); misc out (3cc) &= 0xf3 -> 3c2 (25 MHz clock); SR0=1, SR1=0x01 (8-dot, unblanked), SR0=3
CRTC start = 0x8000 ; SR1 &= ~0x20
wait retrace start; SR1 |= 0x20
GC6 = 5 (graphics, A000 64K); AC10 = (read 3c1 & 0xb7) | 1 (DOSBox gives 0x01); CRTC17 = 0xE3 (byte mode);
CRTC9 &= 0xe0 (0x40: 1 scanline per row -> 400 lines); SR1 &= ~0x20
GC5 = write mode 1; SR2=0xf; copy a000:8000 -> a000:0, 0x7d00 bytes (latch copy, all planes)
GC5 = write mode 0; CRTC start = 0; GC5 = write mode 1
blink loop, which runs only once (bp starts at 1):
   wait retrace start; bp-- (=0, so continue)
   [4]==0 -> [4]=0xff; save the cursor (cx=[2] bytes from a000:[0] stride 80 -> a000:ffdc, latch copy)
          GC5 = write mode 0; for each line: SR2=0xf, write 0; SR2=[5], write 0xff; di += 80
GC5 = write mode 0; free [6],[8]; DAC 1..3 = (0,0,50),(0,0,40),(0,0,30)  (0299:0076 si=0x323 di=1 cx=3)
```
Resulting mode: **640x400, 16 colours, planar, 80 bytes/line**, 70 Hz, 4 planes, CRTC start 0, AC palette
unchanged from text mode 3. The cursor (colour 7, gray because DAC 7 was faded to 20) is at VRAM 0xF5E0 and
0xF630, i.e. rows 377–378, x 128..135 **of the page at 0x8000**.

Observation: from frame 2 on, the converted text (plane 3) is never visible again; only the cursor is. Frame 1
is a garbled half-height view of the gray text. I could not explain either from the register writes (colour 8 →
AC 0x38 → DAC 56 = gray should show). It looks like a DOSBox artefact of switching modes mid-frame and/or of the
writes made while still in text mode. **For the port:** frame 1 = the capture image (or black; the port has no DOS
screen), frames 2–3 black, then the cube as below, with plane 3 empty. UNCLEAR: the exact cause.

### 11d6:032c: fade to black
Read DAC 0..63 into a buffer, target 0xc0.. = 0 (all black), then the same 0749:0192 fade (63 colours, 70 steps,
one retrace each, k=1..70). Free. Measured: steps applied at frames 443..512 (the image is black from 512).

### 0749:0192 (generic fade helper; module 0749 belongs to the water effect)
Inputs: ds:si from, ds:di to, ds:bp work buffer, ax = colour count, dl = steps, bx = first DAC index. dh runs
1..dl. Each step: `0299:0023` interpolation, then wait for retrace start (3da), then `0299:0076` (sets the DAC
from ds:si, cx colours from index di; it also blanks the screen through SR1 bit 5 while writing; ignore that).

`0299:0023` (interpolation, also used directly by the intro): for cx*3 bytes:
`out = from + (int8)( (int16)(int8)(to-from) * (int8)dh / (int8)dl )` (imul/idiv on 8 bits, truncation toward
zero; `ah` is cleared and `from` is added as a 16-bit value, then the low byte is stored).

## 2. 08d8:196e: the textmode cube

```
[0x914]=100 (y centre)  [0x1461]=0x0302 (clear mask = planes 0,1)  [0xa3]=30000 (D)  [0x8e]=160 (x centre)
[0x1578]=0  [0x157a]=0  [0x92]=2 (y*2 projection)  05ca:[0] = 2 (planes)
120 x frame(dz=225) ; 200 x frame(0) ; 120 x frame(-225)       // [0x157a]
then [0x92]=0, [0xe61]=0xa000, 05ca:[0]=4, [0x1461]=0x0f02
frame (08d8:15db):
  14e6: CRTC start=[0x1413]; wait retrace start (3da); [0x1413]^=0x8000; [0xe61]^=0x800 (a000<->a800)
  1417: clear the previous bbox in the back page (§3.6)
  1514: prev bbox = bbox; bbox = (miny 1000, maxy 0, minx 1000, maxx 0)
  128d: draw object 05ca (§3)
  1535: a97+=2, a99+=4, a95+=2 (each mod 0x5a0)
  [0x8e] += [0x1578] (0); [0xa3] -= [0x157a]
```
Initial angles (image values): a95 = `[0x95]` = 0, a97 = `[0x97]` = 220, a99 = `[0x99]` = 0. Initial
`[0x1413]=0`, `[0xe61]=0xa000`. The engine writes 40-byte lines into pages 0x0000/0x8000 while the CRTC shows
80-byte lines. So display row r = buffer lines 2r (x 0..319) and 2r+1 (x 320..639). That gives the two half-size
cubes (y is doubled by mode 2, so both copies look the same). Colours: DAC1 (0,0,50), DAC2 (0,0,40),
DAC3 (0,0,30), DAC7 (20,20,20) cursor. The spike triangles of object 05ca use plane bit 4 and are not drawn
(only 2 planes).

Timing (measured and confirmed by the simulation): iteration k (k = 1..440) is displayed at frame g = k+3. The
page of iteration 440 is never shown; frame 442 (iteration 439, page 0x8000) stays on screen during the fade.
D for the draw of iteration k: 30000−225(k−1) for k≤120, 3000 for 121..320, 3000+225(k−321) for 321..440.

**State left for other slices (08d8:1625 and others):** a95 = 880, a97 = 1100, a99 = 320, [0xa3] = 30000,
[0x1413] = 0, 05ca:[0] = 4, [0x92] = 0, [0x1461] = 0x0f02, plus the bbox variables.

## 3. The 08d8 polygon engine (generic, shared with all the 08d8 3D effects)

The routines 07cb, 0926, 097f, 0ad3, 0b24, 0b70, 0e00/0ecc, 0f93, 0fe1, 1184, 128d, 13f7, 1417, 14a9, 14e6,
1514, 1535, 157e and 200a are generic helpers. The variables are all in cs = 08d8:
- `0x8e` x centre, `0x90` ymax (199), `0x914` y centre
- `0x92` y mode, `0x95/0x97/0x99` angles in bytes (0..0x59e, even), `0xa3` distance D
- `0xa7/0xa9/0xab/0xad` plane bbox: miny, maxy, minx, maxx
- `0xaf/0xb1/0xb3/0xb5` frame bbox: miny, maxy, minx, maxx
- `0xb7/0xb9/0xbb/0xbd` previous frame bbox
- `0x1413` back page offset, `0xe61` fill segment, `0x1461` clear map mask, `0x128c` fill enable (=1)

The object data is in the image segment given in es (see below). The XOR buffer is the resource **scr_data**,
whose segment is at 08d8:[0] (loaded by main 0429):
- 0..0x1f3f: 320x200 1-bpp buffer, 40 bytes/line, initially 0
- 0x1f41: masks `80 40 20 10 08 04 02 01`
- 0x1f49: fill table with state off, `T0[b]`
- 0x2049: fill table with state on, `T1[b]`

Verified: `T_s[b]` = bit i (MSB first) of the running parity of b's bits from bit 7 down to bit i, XOR s. In
other words, a prefix-XOR fill.

### 3.1 Object format (es:0)
- `[0]` planes, `[2]` face count, `[4]` face list, `[6]` edge buffer, `[8]` vertex count, `[0xa]` projected buffer
- vertices at 0xc: (x, y, z) words
- face: `colour word (bl = plane bits, bh = XOR applied when back-facing; bh=0: back face skipped), edge count,
  edges = (ptrA, ptrB)` pointers to projected entries (6 bytes: sx, sy, depth)
- edge buffer: `count word` then 9-byte entries `[colour byte][Ax][Ay][Bx][By]`

Objects: 05ca cube+spikes, 0512 chess plane, 053e pyramid; also 0555/0586/05a1 (other slices). Dump them with
`work/G2/obj.py`.

### 3.2 Projection 07cb (self-modifying code; exact)
`SIN` = 900 signed words at 08d8:00c1 (720 per circle, about 32767·sin; use the table verbatim). For angle a in
bytes: `sin = SIN[a/2]`, `cos = SIN[a/2+180]`. Here (s1,c1) come from a97, (s2,c2) from a99, (s3,c3) from a95,
and `hi(a,b) = (a*b) >> 16` (floor). All results wrap to 16 bits.
```
x2=2x y2=2y z2=2z
T1 = 2*(hi(z2,c1)+hi(x2,s1));  U = 2*(hi(x2,c1)-hi(z2,s1))
V  = 2*(hi(U,s2)+hi(y2,c2));   W = hi(U,c2)-hi(y2,s2)
X  = hi(V,c3)+hi(T1,s3);       Y = hi(T1,c3)-hi(V,s3)
den = -400 - D + Y
sx = idiv(W*-400, den) + [0x8e]
p  = idiv(X*-400, den)       (idiv: 32/16, truncate toward 0)
sy = mode0: p+[0x914] | mode1: idiv(2p,3)+0x42 | mode2: 2p+[0x914]
store (sx, sy, Y)
```

### 3.3 Faces / edges (128d)
For each face: R = ptr of edge0.A, Q = edge0.B, P = edge1.B. `cross = (P.y−R.y)(Q.x−R.x) − (Q.y−R.y)(P.x−R.x)`
(32-bit). If cross < 0: skip the face when bh == 0, else bl ^= bh. For each edge, order the endpoints so that
A.y > B.y (if the y are equal: A.x < B.x, otherwise swap only the x). Search the edge buffer for the same
(Ax, Ay, Bx, By): if found, `colour ^= bl`, else append. Then for each plane p < [0] (bl = 1<<p): set the map mask
to bl, plane bbox = (max −1000, min 1000), line counter [0xad1] = 0; draw every edge with (colour & bl) through
13f7. Then, if [0xad1] != 0, fill (0e00); then merge the plane bbox into the frame bbox (0fe1: max/min).

### 3.4 Clip 0b70 + line 097f + left edge 0ad3 (13f7)
See `eng3d.py` (`clip_and_draw`, `xline`). Main points:
- **Outcodes:** bit 0 x<0, bit 2 x>319, bit 1 y<0, bit 3 y>ymax.
- **Both points outside on the same side:** call 0b24, which sets plane bbox minx=0 / miny=0 / maxx=319 /
  maxy=ymax if either point has the corresponding bit. If both points are left (and not both above or below,
  and y1 != y2), set the left-edge flag [0x9b] with the y range clamp(min y)..clamp(max y). Do not draw the line.
- **Otherwise, clip point 1, then point 2,** in this order: left, right, top, bottom. Use
  `ax = Δ·(edge−coord) / Δother` with 16x16→32 imul and idiv (skip the division if the divisor is 0). The left
  clip of either point sets [0x9b] = 1, [0x9c] = clamp(original y), [0x9e] = the clipped y.
  - Quirk: on the right clip of point 2 with divisor 0, bp is not set to 319.
- Finally clamp all four coordinates.
- Update the plane bbox (0f93): maxy = max(maxy, y1); miny = min(miny, y2); x the same using the ordered pair.
- **XOR line:** skip it if y1 == y2. Start at the bottom endpoint (larger y) and go up. XOR exactly dy pixels: the
  bottom endpoint is included, the top endpoint is excluded, one pixel per row.
  - Vertical lines and exact diagonals step every row.
  - y-major (Bresenham): `e += 2|dx|; if e > dy: e -= 2dy, x step`.
  - x-major: one XOR at the start, then per x step `e += 2dy; if e > |dx|: row up, (count reaches dy → stop),
    e -= 2|dx|, XOR`.
- **Left edge (0ad3, when [0x9b]):** XOR 0x80 into byte column 0 for rows a+1..c, where (a, c) = the sorted
  [0x9c]/[0x9e] clamped to 0..ymax. Then [0xad1]++.

### 3.5 Fill 0e00
Rows miny..maxy, byte columns minx>>3 .. maxx>>3, VRAM segment [0xe61] (same offsets as the buffer). Per row the
state starts at 0. Scan the bytes:
- zero bytes: skipped when state=0, written 0xff when state=1;
- each nonzero byte, and the last byte of the row: written `T_state[b]`; state ^= parity(b); the buffer byte is
  cleared.

Bytes skipped while the state is 0 keep their old VRAM content. 0ecc is an identical copy at other addresses.

### 3.6 Clear 1417
Uses the *previous* frame bbox (b7..bd):
```
w0 = minx>>4; w1 = maxx>>4; if w1 < 20: w1++; n = w1-w0
if n <= 0: return
rows = maxy - miny + 1   (return if maxy < miny)
for each row: write 2n zero bytes at [0x1413] + y*40 + 2*w0
```
Use map mask [0x1461] and stride 40. On a page flip, b7..bd describe the page drawn one frame ago (the other
page), so leftovers depend on this exact rule. Emulate it.

### 3.7 Page flip variants
- 14e6 (cube): start = page, 3da retrace wait, toggle 0x8000 / a800.
- 14a9 (intro): start = page, **0731:00a3 tick wait**, then CRTC9 = (CRTC9 & 0x60) | ([0x92]+1), then toggle
  `[0x1413] ^= 0x1f40` and `[0xe61] ^= 0x1f4` (pages 0 / 0x1f40, 8000 bytes each).

## 4. 08d8:275d: the Intro (Erik / Maestro)

Mode on entry: main called 0299:01cc. That is a 320x200 planar 16-colour mode: AC10=1, GC5=0, SR1=9, SR4=6,
CRTC table 0299:01b3 (`2d 27 28 90 2b 80 bf 1f 00 c0 .. 9c 2e 8f 14 00 96 b9 e3 ff`), i.e. 40 bytes/line, double
scan, start 0. AC palette = identity (0299:005e), AC11 = 0xff, DAC 255 = 0. Mode X (for the pictures) =
0299:0175: AC10=0x41, GC5=0x40, SR1=1, SR4=6, CRTC table 0299:015c (80 bytes/line, R9=0xc0).

Resources (08d8 variables):
- `[0x2637]` chesspl5, `[0x2649]` presents, `[0x2653]` heads5g, `[0x265d]` intropal
- `[0x2635]` = 256000-byte work buffer
- `[0x265f]` = 0xf5 paragraphs palette work area: 0x000 intropal palette A (presents), 0x300 intropal palette B
  (heads), 0x600 black×256, 0x900 white (63)×256, 0xc00 fade output

Pictures are packed with **0299:0000**. Decoder: until bx (output byte count) is 0: read c.
- c ≤ 0x7f: copy c+1 literal bytes;
- otherwise: write the next byte (0x101 − c) times.

64000 bytes = a chunky 320x200 picture. **272d** puts it into mode X at VRAM 0x3e80: plane p offset i =
src[4i+p], i < 16000.

Fade palettes in 02bf (inside module 0299):
- 02bf:01c2 white × 50
- 02bf:0258 = chess palette (50 colours, same as the start of intropal)
- 02bf:0096 yellow (63,60,0) × 50
- 02bf:02f1 4 colours (0,0,0), (63,60,0), (63,50,0), (63,55,0)
- work buffer 02bf:012c

```
load, alloc, palette area as above
RLE chesspl5 -> buf; AC11=0xff; DAC1=(25,25,29); 272d; free chesspl5
CRTC9 = (CRTC9&0x60)|0 = 0x40   -> 400 lines (capture 320x400, g=584)
[0xa3]=400 [0x8e]=-200 a95=0x1d6 a97=0 a99=0x50 [0x2006]=0 [0x1578]=2 [0x2002]=0 [0x2004]=2
0731:013c; wait until 0731:[4] > 130   (counter counts from the timer installation in main 0498)
Phase A (chess plane, object 0512, 1 plane, bh=100 so both sides are drawn; 6 overlapping strips XOR into a checkerboard):
  loop: 14a9; 1417; 1514; bbox reset; 128d(0512)
        if [0x2633] >= 370: break          ([0x2633] initial 0)
        t = counter; [0x2633] += t; repeat t: 1535 (a97+=2, a99+=4, a95+=2); [0x8e] += 1
  Iteration k is shown at g = 715+k (verified by simulation); runs ~370 iterations (g 716..1085).
Phase B: wait tick; DAC 0..49 = white; 0299:0175 (mode X); CRTC start = 0x3e80
  30 steps k=0..29: interp(white 01c2 -> chess 0258, k/30, 50 colours); wait tick; DAC 0..49
  wait until counter >= 67
  70 steps k=0..69: interp(chess 0258 -> yellow 0096, k/70); wait tick;
      CRTC start = [0x26af] (init 0x3e80); [0x26af] += 80;
      [0x26ae] = min([0x26ae]+1, 0x3e) (init 2); CRTC9 = (CRTC9&0x60) | (([0x26ae]>>1)&0x1f)
      DAC 0..49
Phase C: 0299:01cc (planar 16-colour again; CRTC9 = 0xc0); AC11=0xff
  [0x8e]=160 D=300 a95=0x438 a97=0 a99=0; all speeds 0; cx=10; 2663
  DAC 0..3 = 02bf:02f1
  cx+=120: 2663 with a97+=6, D+=9 per tick
  cx+=20 each: [0x1578]=-2, -4, -6 (a97+=6, D+=9)
  10 x { cx = prev+10; [0x1578]=-8; a97 += 6; D += bx } with bx = 9,5,1,...,-27
  cx+=3: [0x1578]=0, [0x2002]=8, D += -31 ; 2663
  26b3 (cx+=40): like 2663, but each iteration first sets DAC 0..3 = interp(02f1 -> white 01c2, (40-cx)/40)
    after the 14a9 tick
Phase D: DAC 0..254 = white; clear a000:0..0x3e7f (all planes); tick; 0299:0175
  RLE presents; 272d; start = 0x3e80
  70 steps: white -> palette A (100 colours); wait counter >= 120; 80 steps: palette A -> black
Phase E: clear a000:0..0x7cff; DAC all black (0000:002b)
  RLE heads5g; copy plane p, row y, byte i: a000:[0x50 + y*160 + i] = src[(y*80+i)*4+p]
  start = 0; CRTC13 = 0x50 (160 bytes/line); tick; DAC 0..254 = palette B
  wait until 008e:18a4 (music sync counter 008e:[0x11cc], incremented by MOD effect 8xx) != 0
  27 x { tick; start = 2,5,8,...,80 }
  40 steps: white -> palette B (255 colours); wait counter > 200; 70 steps: B -> black; free all; retf
```

**2663 (generic 3D loop):** `while cx > 0: 14a9; 1417; 1514; reset; 128d(053e); t = counter; repeat t: 200a;
cx -= t`. It returns cx ≤ 0; the caller adds the next duration to it.

**200a:** a95 += [0x1578], a97 += [0x2002], a99 += [0x2004] (each mod 0x5a0), [0xa3] += [0x2006],
[0x914] += [0x2008] (=0).

Note: the step loops advance the animation by the number of elapsed ticks (catch-up). In the recording t = 1
every frame (verified for phase A).

**Music sync:** the heads slide waits for the first 8xx effect (G1 songsim: order 1, row 61, tick 1372).
Measured: the slide starts at g≈1960, the white flash is at 1984, the fade ends at ~2023. The hold ends at 2226
and the fade reaches black at 2296.

## 5. 0db5:07b0: Credits (Antibyte)

Mode: 0299:01cc planar 320x200 16 colours (set by main 04ab).

Data in cs = 0db5:
- 0..0x13f: x→bit mask table (0x80 ror x)
- 0x140..: y*40 for y < 96 (both built by 037a)
- `[0x200]` = resource **ugur**
- `[0x202]` = 0xffd-paragraph work segment
- `[0x20c]` page flag, `[0x318]` text pointer (init 0x20d)
- text at 0x20d:
  `"\n\n     THE CREDITS:\0CODING:\n\n      RICK DANGEROUS\n            ANTIBYTE\n                PECI\n                    \0GRAPHICS:\n\n             MAESTRO\n               J.O.E\0MUSIC:\n\n                FRED\0DESIGN:\n\n             MAESTRO\n      RICK DANGEROUS\n            ANTIBYTE\xff"`
- palette source 0x34a (16 colours): even colours = 0, odd colours 1,3,..,15 =
  (0,0,0), (52,52,60), (44,44,56), (32,32,48), (32,32,44), (28,28,40), (24,24,36), (20,20,32)
- `[0x708..0x70e]` 4 segments of 0xf00 paragraphs (16 frames of 3840 bytes each)

ugur layout:
- 0..0xbff: font, chars 0x20.., 32 bytes per char = 16 rows × 2 bytes (MSB = left)
- 0xc00, 0x1b00, 0x2a00: 3 × 3840 bytes = planes 1, 2, 3 of a 320x96 gradient

Visible colour = 1 + 2·gradient where the text (plane 0) is set, and black elsewhere.

```
alloc; SR2=5; clear a000:0..0x1f3f; SR2=1; ds=[0x202]
tick; 037a (DAC 0..15 = 0x31a = zeros; build tables)
0710: planes 1,2,3 <- ugur gradient at a000:0x820 (rows 52..147); GC4=0; SR2=1
3b1: render page into [0x202]:(flag?0xf00:0); flag = ~flag; copy 3840 bytes -> a000:0x820 (plane 0)
0758: 64 steps bl=1..64: pal = (src*bl)>>6; tick; DAC 0..15
tick; wait counter > 90
4 x {
   06ae: list1 = set pixels of the current page (046a: raster order, x 0..319, y 0..95, records (x word, y byte, 0))
         render the next page (3b1); list2 = its pixels into [0x708]:0
         04b7: M = max(N1,N2); the shorter list is extended or indexed by ping-pong
               (list1 extended: reverse from the end, then forward, ...;
                list2 indexed: forward, then reverse, ...)
               pos_i = old_i*64 (x and y); vel_i = old_i - new_i (pixels)
         0422 clear the 4 segments; 0635: for f = 1..64: pos -= vel; plot (pos>>6) OR into frame f
   wait counter > 200      (counted from the last tick, so it includes the compute time)
   64 x { tick; copy frame n -> a000:0x820 plane 0 }
}
wait counter > 210; 0784: 64 steps bl=63..0 fade; free; retf
```
3b1 rendering: the text is drawn into a cleared 320x96 1-bpp buffer.
- `\n` advances 16 rows and returns to x = 0;
- other chars draw a 16x16 glyph and advance x by 16 px;
- `\0` ends the page;
- `\xff` restarts the text at 0x20d.

The morph's last frame equals the new page exactly.

Measured:
- fade-in 2302..2366, page 1 held until 2566
- transitions: 64 frames each, then ~200 ticks per page
- last fade ends ≈ g 3430 (≈49 s)

## Shared with other slices
- **08d8 generic helpers:** listed in §3. They are used by 08d8:1625/16de, 2dc1 (glentz chess cube), 25f4 and
  others. Object segments 0555, 0586, 05a1 belong to the other 08d8 effects.
- **Angle state:** the angles left by 196e carry into later 08d8 effects.
- **0299 helpers:** 0299:0000 (RLE), 0023 (interpolation), 0076 (set DAC), 0175/01cc (modes), 005e (AC
  identity), 020a (AC11 + DAC 255) — G1. 0000:002b = DAC all black. 0749:0192 = fade helper.
- **Music:** the intro reads the music sync counter 008e:[0x11cc] (008e:18a4). The cube's sibling 08d8:193b
  (18d4) waits for sync ≥ 5. This contradicts the brief ("no effect reads the music position").
