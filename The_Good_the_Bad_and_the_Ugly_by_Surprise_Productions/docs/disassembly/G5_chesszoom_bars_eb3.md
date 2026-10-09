# Slice G5: 0777:0995, 08d8:2dc1, 0eb3:27e8/28ab/27d5

## Summary (what is seen, in order)

| demo time (s) | capture frames | NFO effect | code | mode |
|---|---|---|---|---|
| 173.97-181.09 | 12193-12692 | intro of Chess-Paralax-zoomer: green-ball field (fade from white), chess grows down from the top, static chess | 0777:0601, 053b, 04fc | 320x400 16-colour planar, CRTC offset 0 (one row repeated on every line), Color Select changed per line |
| 181.09-198.04 | to 13880 | Chess-Paralax-zoomer | 0777:076d | same |
| 198.04-213.59 | to 14968 | Paralax-Bars-with-chessplane (bars drawn into the displayed row while the beam scans it) | 0777:0829 | same |
| 213.59-231.26 | to 16207 | Zooming-16x16-pictures (blue spheres), then the palette is swept to orange/teal and the 'chess' picture appears | 0777:1258, 1113 | same, row from p3_zoom, CS per line from p3_outf |
| 231.26-251.7 | 16208-17645 | Glentz-chess-cube | 08d8:2dc1 | 320x200 16-colour planar, double-buffered, 08d8 polygon engine |
| 251.96-269.42 | 17659-18882 | Greetings-scroller | 0eb3:27e8/28ab/27d5 | 320x200 16-colour planar, CRTC offset per line |

The slice plan in the brief was partly wrong. 0eb3 is the greetings scroller, not the Glentz cube. 08d8:2dc1 is
the Glentz-chess-cube. Module 0777 holds three NFO effects: zoomer, bars and spheres.

Timing:
- Module 0777: one loop iteration = one retrace, and the music is ticked by hand. The loop counts add up to the
  4015 frames of the 320x400 capture file (within 2 frames).
- 08d8:2dc1: one render per tick, with an animation step for each tick that has elapsed. Phase budgets total
  1450 ticks.
- 0eb3: one frame per 0731:00a3 tick. It ends when it reads the 0 byte after the text, after 1224 frames.

Shared state and helpers:
- 0777:0401/03d9 (the wobble indices cs:0032/0034) are also called by the wave effect 08a8. Their values at
  entry must be carried over.
- 08d8:2dc1 uses the common 08d8 polygon engine: everything below it except 2d48 is shared with the other 08d8
  effects.
- Video-lib helpers: 0299:0000 (RLE), 0023 (palette interpolation), 0076 (DAC upload), 009c/00c4/00d0/01cc.

The three parts follow:

# Module 0777: Chess-Paralax-zoomer, Paralax-Bars-with-chessplane, Zooming-16x16-pictures

Entry `lcall 0777:0995` (main script 0000:06c0). One far call runs **three** NFO effects back to back, all in
the same 320x400 16-colour planar mode, all driven by raster tricks (per-scanline register writes), not by
redrawing the screen:

| part | NFO name | routine | frames | demo time (capture) |
|---|---|---|---|---|
| A0 | (intro of zoomer) green-ball field, fades in from white | 0777:0601 | 250 | 173.97 .. 177.53 |
| A1 | chessboard grows down from the top | 0777:053b | 199 | 177.53 .. 180.37 |
| A2 | full chessboard, static | 0777:04fc | 50 | 180.37 .. 181.09 |
| A3 | Chess-Paralax-zoomer (squares zoom 40->160->2->160..., board scrolls) | 0777:076d (x2) | 1186+1 | 181.09 .. 198.04 |
| B | Paralax-Bars-with-chessplane (two sine bars "drawn by the beam" over the chess) | 0777:0829 (800 + 290) | 1090 | 198.04 .. 213.59 |
| C | Zooming-16x16-pictures (blue spheres) | 0777:1258 | 1000 | 213.59 .. 227.86 |
| C2 | spheres zoom back, palette swept to orange/teal, then the 'chess' picture | 0777:1113 | 240 | 227.86 .. 231.26 |

Recording check: capture file video0008 (320x400) runs frames 12193..16207 = 4015 frames; the sum of the
loop counts above is 4017 (1 + 250 + 199 + 50 + 1186 + 1 + 1090 + 1000 + 240): **every loop iteration is
exactly one video frame (one retrace, 70.086 Hz)**. Measured: frame 12193 (first 320x400 frame) = first frame
of 0601 (white, fading); the pattern is fully faded in at 12213 (20 frames, see [0x43a]); the grey chess
(DAC 0x16 -> RGB 89) first appears in 12443 = 12193 + 250 (start of 053b). The next capture file (320x200)
starts at frame 16208 = the end of 0777:1113 (mode switch to 0299:01cc).

The music is ticked **by hand** once per frame (`lcall 008e:1f63`) during all of this: 0995 restores the
BIOS timer (0731:0158) before the effects and only re-installs the retrace timer (0731:013c) at the very
end (0777:1220). Nothing in module 0777 reads the music position.

## Video mode and the raster tricks (read this first)

On entry the mode is the one set by main 0000:06ac `lcall 0299:01cc`: 16-colour planar (EGA-like) 320x200,
VGA registers: Attr mode control 0x01 (graphics, not 8-bit), GC5 = 0 (write mode 0), Seq1 = 0x09 (dot
clock/2, 8-dot), Seq4 = 0x06 (no chain-4, no odd/even), CRTC from table 0299:01b3:
`2d 27 28 90 2b 80 bf 1f 00 c0 00 00 00 00 00 00 9c 2e 8f 14 00 96 b9 e3 ff` (CRTC9 = 0xc0 = double scan,
max scan line 0; VDE = 0x18f -> 400 scanlines; offset 0x14 = 40 bytes per row; 0x17 = 0xe3 byte mode).
Main 0000:06b6 `0299:020a` also set overscan (attr 0x11) = 0xff and DAC 255 = (0,0,0).

0777:0995 then changes:
- CRTC 0x13 (offset) = 0 -> **every scanline displays the same 40-byte row**, the one at the CRTC start
  address. (0777:053b briefly sets it to 0x14 for one line, see there.)
- 0299:009c: Attr 0x10 |= 0x80 (P54S). 0299:00d0: CRTC 0x11 &= 0x7f. 0299:00c4: CRTC 9 &= 0x7f (double scan
  off) -> 400 visible scanlines, each a separate row fetch (but with offset 0 it is the same row).

**Pixel colour formula** (16-colour mode with P54S=1, attribute palette registers assumed identity 0..15 —
GUESS, nothing in this slice writes them; the result matches the recording):

```
pix  = (plane3bit<<3)|(plane2bit<<2)|(plane1bit<<1)|plane0bit      // 0..15, from the displayed row
DAC  = ((CS & 0x0f) << 4) | pix                                     // CS = Attr Color Select (index 0x14)
```
Writing CS: `out 3c0, 0x34` (index 0x14 with PAS bit 0x20) then `out 3c0, value` (helper 0777:02f0, bl =
value). Horizontal pel panning: `out 3c0,0x33; out 3c0,[0x48]; out 3c0,0x20` (helper 0777:042b) — shifts
the displayed row left by [0x48] pixels (0..7). The start address is CRTC 0x0c (high) / 0x0d (low), in bytes
of one plane.

So the screen = one row of planar data (40 bytes visible, starting at start address, pel-panned) repeated on
every scanline, recoloured per scanline by the Color Select register (16 blocks of 16 DAC entries). The
three effects are three ways of using that.

**Scanline timing helpers** (3da bit 0 = "display disabled": 1 during horizontal AND vertical blanking):
- `0777:02df` wait_hblank: `while (in(3da)&1) ; while (!(in(3da)&1)) ;` -> returns at the start of the next
  horizontal blank. Called during the vertical blank it returns at the end of the first displayed line,
  which makes all the loops self-synchronising to the top of the frame.
- `0777:02f0` set_CS(bl).
- loops run with `cli`.

How a port should model this: keep a VRAM model (4 planes x 64 KB) and for each of the 400 scanlines record
which CS / start / offset / pel value is in force and the VRAM state at that time; render line L from the
row it displays.

**Which scanline a write lands on (measured in the recording, DOSBox).** Count the hblank waits of the frame:
w = number of times "3da bit 0 became 1" has been waited for so far (w = 0 in the vertical blank). A register
or VRAM write made after w waits is visible from scanline max(0, w-1) on. Equivalently: a write made in the
hblank that follows display line L already shows on line L (DOSBox renders a line late). Checked: in 0601/053b/04fc (CS written after the first wait of each pair) the captured lines pair
up as (0,1),(2,3),...; in 076d (CS written before the waits) as (0),(1,2),(3,4),...; in 1258 (one CS per
line, the first written in the vertical retrace, the next after the first hblank) the rule makes line 0 show
byte 1 and line L byte L+1 (byte 0 is overwritten before it is seen) — the per-line colours of a capture
frame match the model DAC = 16*CS + pix exactly, but the one-line phase of the sequence was not checked. Use this rule everywhere in this module.

## Resources, segment variables (cs:)

Main 0000:04d0..0507 loads into 0777 (`lcall 008e:04b3`, name at ds:dx, segment stored at cs:[di]):
`[0]`=p3_sin (1299 B), `[2]`=p3_chess (4413 B), `[6]`=p3_zoom (32000 B), `[8]`=p3_outf (13300 B),
`[4]`=chess (5580 B). Names at 0777:000a.. (8 chars each). They are not freed in this slice.

| addr | init | meaning |
|---|---|---|
| cs:0032 w | 0 | p3_sin byte index for pel/palette wobble (0401), +3 per call. SHARED: the wave effect 08a8 also calls 0777:0401 every frame (08a8:01a0) |
| cs:0034 w | 190 | p3_sin byte index for vertical wobble (03d9), +2 per call. SHARED with 08a8:01ac |
| cs:0036 w | 0 | chess period P (in line pairs) |
| cs:0038 w | 600 | p3_sin byte index for 053b (chess growth) |
| cs:003a w | 1600 | row base address (row 40), the zoom row |
| cs:003c w | 0 | row base of the row being displayed (copy of 3a), used by the bars |
| cs:003e w | 250 | pause counter (frames) |
| cs:0040 w | 80 | d(row base)/frame (2 rows) |
| cs:0042 w | 2 | dP/frame |
| cs:0044 w | 40 | initial bp (phase) of the chess period for the frame; in part C: sequence period |
| cs:0046 w | 20 | horizontal scroll, bytes |
| cs:0048 b | 0 | horizontal scroll, pel (0..7) |
| cs:0049 w | 8 | initial di (0 or 8 = chess parity) for the frame |
| cs:004b w | 0 | horizontal scroll in pixels (=46*8+48), used by the bars |
| cs:004d w | 0 | written, never read |
| cs:004f w | 6400 | row base limit (row 160) |
| cs:0051 w | 0 | zoom phase counter |
| cs:0053 b | 0 | "zoomer done" flag |
| cs:0054 w | 0 | segment of the palette work buffer (allocated by 0895) |
| cs:0056 w | 0 | palette offset in the buffer |
| cs:0058 w | 0 | bar A sine index (bytes) |
| cs:005a w | 60 | bar B sine index (bytes) |
| cs:043a w | 0x80d4 | palette fade-in offset (white -> pattern) |
| cs:0638 b | 0x3b | fade-out steps left |
| cs:0655 w | 0x31f | p3_sin word index, horizontal scroll |
| cs:0657 w | 0x39b | p3_sin word index, vertical scroll |
| cs:07b0 b | 0 | bar palette fade direction (0 none, 0xff in, 1 out) |
| cs:0a2d w | 0 | part C: start offset of the current CS sequence in p3_outf |
| cs:0a2f w | 0 | part C: index into the p3_outf pointer table (bytes) |
| cs:0a31 w | 0 | part C: row offset in the p3_zoom picture (0..0x1ef0) |
| cs:0a33 w | 0x50 | part C: d(0a31) |
| cs:0a35 w | 2 | part C: d(period) |
| cs:0a37 w | 2 | part C: d(0a2f) |
| cs:0a92 b | 0 | part C: "freeze scroll" flag |
| cs:110f w | 0 | DAC index for the palette sweep |
| cs:1111 w | 0 | source offset for the palette sweep |

`DS` during the effect loops is p3_sin (0401/03d9 leave it there), except where noted. 05ee = the program's
main data segment (linear 0x5ee0 in img.bin).

### p3_sin (res/02_p3_sin, 1299 bytes)
- bytes 0..599: a sine 80 + 79.5*sin (values 0..159), only `&7` is used.
- bytes 600..798: 199 chess heights for 053b: `2,2,4,6,9,13,...,199,192,...` (bouncing up to 199, last 199).
- words at 0x31f..0x512 (250 words): 160 + 160*sin, values 0..319 (horizontal/vertical scroll).

## VRAM layout built by 0777:02fa (es = a000)

```
for plane p in 0..2: mapmask = 1<<p; fill a000:0000..0x3ecf (0x3ed0 bytes = 402 rows) with
      p0: 0x55, p1: 0x33, p2: 0x0f            // pixel x of every row has colour (x & 7) in planes 0-2
plane 3 (mapmask 8): fill 0..0x3ecf with 0
plane 3 row 0 (bytes 0..39): ff ff f0 | 0 0 0 0 | 0f ff ff ff ff f0 | 0 0 0 0 | 0f ff ff ff ff f0 | 0 0 0 0 |
      0f ff ff ff ff f0 | 0 0 0 0 | 0f ff ff                       // pixels 0..19 set, then 40 clear/40 set...
      (code: di=0: ff,ff,f0; 3x {di+=4; 0f, ff x4, f0}; di+=4; 0f, ff, ff)
plane 3 from byte 0x50 (row 2): RLE-decode p3_chess (0299:0000) for 0x3e80 = 16000 bytes (rows 2..401)
p3_zoom -> planes 0,1,2,3 at 0x3e80 (rows 400..599): plane p gets p3_zoom[p*8000 .. p*8000+7999] (raw)
chess  -> at 0x5dc0 (rows 600..799): for row 0..199: for plane p=0..3 (mapmask 1<<p): RLE-decode 40 bytes to
          0x5dc0 + 40*row (the RLE stream is continuous over the whole resource)
mapmask is left = 8 (plane 3) — matters for the very first bar write, see 0829.
```
The bit mask (GC 8) is assumed 0xff and set/reset/rotate/function zero (GUESS: not written here; 0299:01cc
only writes GC5).

RLE `lcall 0299:0000` (ds:si src, es:di dst, bx = byte count): `do { c=src++; if (c<=0x7f) { n=c+1; copy n
literal bytes } else { n=0x101-c; byte b=src++; store b n times } bx-=n } while (bx!=0)`.

p3_chess plane-3 rows (row r = 2 + decoded row): row r holds a 1-bit chess pattern of square width r pixels
for r = 2..161 (e.g. row 40: 20 set, 40 clear, 40 set...; row 41 the same; row 42: 5 set, 42 clear...),
then larger widths further down (only rows < 162 are used). Rows 0 and 1: row 0 = 40-px pattern above,
row 1 = plane 3 all 0. All rows 0..401 have the ramp 0..7 in planes 0-2.

So in parts A: plane 3 decides "chess square", planes 0-2 give the column x&7 inside each 8-pixel cell.
DAC block layout (A): for CS c in 0..7: DAC 16c+0..7 = ball colours, 16c+8..15 = grey (0x16,0x16,0x16);
for CS 8+c: DAC 16(8+c)+0..7 = grey, 16(8+c)+8..15 = ball colours. Toggling CS bit 3 (di = 0/8) swaps which
plane-3 value is grey -> the vertical chess parity. The ball itself is an 8x8 image stored as 8 palette
rows: scanline pair -> CS low 3 bits (row of the ball), pixel x&7 -> column.

## Palette work buffer (0777:0895)

Allocates 0x83d paragraphs (`lcall 008e:0014`, bx=0x83d, di=0x54 in cs) -> seg B = cs:[0x54]. Then (src DS =
05ee):
```
B[0x0000..0x017f] = 05ee:[0x0000..0x017f]      // ball pattern: 8 rows x 16 colours (each row = 8 colours twice)
B[0x5a00..0x5b7f] = 0
B[0x5b80..0x5b97] = 05ee:[0x13c4..0x13db]      // 8 bar colours (see part B)
B[0x6120..0x6137] = 0
B[0x62d4..0x6453] = 05ee:[0x0000..0x017f]      // second copy of the ball pattern
B[0x80d4..0x8253] = 0x3f                         // white
interp(A,Bsrc,out,count,dl): lcall 0299:0023 with ds=es=B, si=A, di=Bsrc, bp=out, cx=count colours, dh, dl:
   for i in 0..3*count-1: a=B[A+i]; b=B[Bsrc+i]; q = idiv8( (int8)(b-a) * dh , dl )  // imul dh (signed 8x8),
                          B[out++] = (a + q) & 0xff                                   // idiv dl, trunc to 0
dh=0..59: interp(0x0000, 0x5a00, 0x0180+0x180*dh, 128, 60)   // fade ball pattern -> black, 60 steps
dh=0..59: interp(0x5b80, 0x6120, 0x5b98+0x18*dh, 8, 60)      // fade bar colours -> black
dh=0..19: interp(0x62d4, 0x80d4, 0x6454+0x180*dh, 128, 20)   // fade ball pattern -> white, 20 steps
```
(The last step of each loop writes over its own "b" block in place; since each byte is read before it is
written the result is the same as reading the original zeros/whites.) Resulting blocks: B[0x180*(n+1)] = pattern
faded n/60 to black; B[0x5b80] = bar colours, B[0x5b98+0x18*n] = bar colours faded n/60; B[0x6454+0x180*n] =
pattern faded n/20 to white; B[0x80d4] = white.

## Routines of part A

### 0777:0995 — module entry (far)
```
lcall 0731:0120            // plain 70 Hz timer, music on IRQ, during the long setup
init_vram()                // 02fa
build_palette_buffer()     // 0895
lcall 0731:0158            // BIOS timer back: from now on the music is ticked by hand
CRTC 0x13 = 0              // out 3d4, 0x0013
wait_vretrace_start()      // 3da bit3: while(set); while(!set)
lcall 008e:1f63            // music tick
lcall 0299:009c (P54S on); lcall 0299:00d0; lcall 0299:00c4 (400 lines)   <- capture switches to 320x400 here
wait_vretrace_start(); lcall 008e:1f63
part_A0()   // 0601
grey_palette()   // 094c
part_A1()   // 053b
[0x46]=20; [0x48]=0
part_A2(50) // 04fc, cx=0x32
zoomer(); zoomer();   // 076d twice (the 2nd runs exactly one frame, the done flag is already set)
[0x7b0]=0xff; [0x56]=0x6120; bars(800)   // 0829, cx=0x320
[0x56]=0x5b80; [0x7b0]=1;    bars(290)   // cx=0x122
spheres()   // 1258 (it calls 1113 at its end)
ds = cs; retf
```

### 0777:094c — grey_palette
For bx = 8, 24, ..., 120 (8 times, +16): DAC[bx..bx+7] = (0x16,0x16,0x16). Then bx = 128, 144, ..., 240:
DAC[bx..bx+7] = (0x16,0x16,0x16). (`mov al,0x1e` is dead code.) No screen-off.

### 0777:043c — upload_ball_palette(bx)  (called by 04da / 053b)
```
seq[1] |= 0x20 (screen off: out 3c4,1; in 3c5; or 0x20; out)
k  = (bx - [0x48]) & 7
si = [0x56] + 3*k + [0x43a]
set_pel([0x48])                                  // 042b
ds = [0x54]; di = 0
8 times:  DAC[di..di+7] = B[si..si+23]  (lcall 0299:0076, cx=8); si += 24 (rep outsb) + 0x18; di += 16
di += 8 (-> 136); si -= 0x180
7 times:  DAC[di..di+7] = B[si..]; si += 48; di += 16      // DAC 136..143, 152.., ..., 232..239
DAC[248..254] = B[si..si+20]  (cx=7: colour 255 stays black)
seq[1] &= ~0x20 (screen on); ds = 05ee
if ([0x43a] > 0x62d4) { [0x43a] -= 0x180; if ([0x43a] <= 0x62d4) [0x43a] = 0 }   // unsigned
```
So ball row i (0..7) = 8 colours starting at colour k of the 16-colour row i of the selected palette block
(a horizontal rotation of the ball image). Note `lcall 0299:0076` also toggles seq[1] bit 5 itself (on, then
off): the screen is re-enabled at the end of each 8-colour upload. All uploads happen in the vertical blank.
[0x43a] sequence: 0x80d4 (white), 0x7f54, 0x7dd4, ..., 0x6454 (20 values: white..pattern), then 0. So the
first 21 frames of 0601 fade from white to the pattern (measured: 12193..12213).

### 0777:0401 / 0777:03d9 — wobble (far, `push cs; call`)
```
0401: ds=[0]; al = p3_sin[[0x32]]; [0x32]+=3; if ([0x32] >= 600) [0x32]=0; bx = al & 7
03d9: ds=[0]; al = p3_sin[[0x34]]; [0x34]+=2; if ([0x34] >= 600) [0x34]=0; bl = al & 7   (caller clears bh)
```
### 0777:04da — frame_palette: `bx = wobble_0401(); upload_ball_palette(bx); si = wobble_03d9()` (si 0..7).

### 0777:04ea — ball_lines(cx): `cx times { wait_hblank(); set_CS(si); wait_hblank(); si = (si+1)&7 }`

### 0777:0601 — part A0: green-ball field (250 frames)
```
start = 0x28 (row 1: plane 3 = 0, so only ball colours)
250 times { frame_palette(); music_tick(); cli; ball_lines(200) }
start = 0
```
Line timing (rule above): CS value n is on scanlines 2n and 2n+1, so CS(line) = (si0 + (line>>1)) & 7.

**State at entry (measured):** [0x32] and [0x34] are NOT the image values when 0777:0995 starts, because the
wave effect (08a8, previous slice) calls 0777:0401 and 0777:03d9 once per frame. Fitting the capture (frames
12290..12299 = 0601 frames 97..106, palette rotation k and the ball row on line 0) gives: at 0601 frame f
(f = capture frame - 12193) the index used is [0x32] = 3*(f+5) mod 600 and [0x34] = (190 + 2*(f+5)) mod 600,
i.e. the wave effect made N calls with N = 5 (mod 600). The port must carry these two counters over from the
wave effect (or start them at 15 and 200). The +3/+2 steps divide 600 exactly, so the wraps are plain mod.

### 0777:053b — part A1: the chessboard grows from the top (199 frames)
```
for frame in 0..198:
  music_tick()
  bx = wobble_0401(); upload_ball_palette(bx)
  v  = p3_sin[[0x38]]; [0x38]++                 // bytes 600..798
  cx = v                                        // number of chess line pairs this frame (2..199)
  bl = v % 40; q = v / 40                       // 8-bit div
  di = (q & 1) ? 0 : 8
  bp = bl; [0x36] = 40
  si = wobble_03d9()
  cli
  loop cx times:
     wait_hblank(); set_CS(si + di); bp--
     if (cx == 1) {                              // the last chess line pair
        CRTC13 = 0x14                            // one line with normal offset -> row address +40
        wait_hblank();                           // (3da bit0: wait 1->0 then 0->1)
        set_CS(si)                               // (si not yet incremented)
        CRTC13 = 0
     } else wait_hblank()
     if (bp <= 0 /*signed*/) { bp = [0x36]; di ^= 8 }
     si = (si+1) & 7
  if (200 - v > 0) ball_lines(200 - v)
[0x3a] stays 1600; at the end: start = [0x3a] (=1600, row 40); CRTC13 = 0
```
The start address is 0 during the whole of 053b (set at the end of 0601), so the top part shows row 0 (the
hand-made 40-pixel pattern) and, after the one line with offset 0x14, row 1 (plane 3 = 0: balls only). The
recording confirms: chess on top, uniform balls below, the boundary moving down per frame. Which scanline
first shows row 1: GUESS the line after the one during which offset was 0x14 (±1 line).

### 0777:04fc — part A2 (cx = 50 frames)
```
50 times { frame_palette(); music_tick(); di = 8; bp = [0x44] (=40); [0x36] = bp; cli
           200 times { wait_hblank(); set_CS(si+di); bp--; wait_hblank();
                       if (bp <= 0) { bp=[0x36]; di ^= 8 }; si=(si+1)&7 } }
```
Start = 1600 (row 40: 40-pixel squares, same phase as row 0), pel 0.

### 0777:076d — zoomer frame loop (part A3)
```
do {
  frame_palette(); music_tick()
  di = [0x49]; bp = [0x44]; cli
  200 times { set_CS(si+di); wait_hblank(); bp--; wait_hblank();
              if (bp <= 0) { bp = [0x36]; di ^= 8 }; si = (si+1)&7 }
  zoom_update()                                   // 0659, in the vertical blank
} while ([0x53] != 1)
```
Here CS is written BEFORE the waits: value 0 is on scanline 0, value n (n>=1) on scanlines 2n-1 and 2n
(rule above; matches the capture).

### 0777:0659 — zoom_update (also used by part B)
```
if ([0x51] == 3) fade_step()                 // 0639
ax = word p3_sin[[0x655]]                    // ds = p3_sin
[0x4b] = ax; [0x46] = ax >> 3; [0x48] = ax & 7
[0x655] += 2; if ([0x655] >= 0x513) [0x655] = 0x31f
move_rows()                                  // 06f6
[0x44] = [0x36]
if ([0x36] < 200) {
   ax = word p3_sin[[0x657]]; [0x4d] = ax
   [0x657] += 2; if ([0x657] >= 0x513) [0x657] = 0x31f
   q = ax / (u8)[0x36]; r = ax % (u8)[0x36]    // 8-bit div (no overflow: ax<=319, [0x36]>=2)
   [0x49] = (q & 1) ? 8 : 0
   [0x44] = r
} else [0x49] = 0
```
### 0777:06f6 — move_rows
```
[0x3c] = [0x3a]
start = [0x3a] + [0x46]                     // CRTC 0c/0d, takes effect next frame
if ([0x3e] != 0) { [0x3e]--; return }
[0x3a] += [0x40]; [0x36] += [0x42]; [0x44] = [0x36]
if ([0x36] <= 2 || [0x3a] >= [0x4f] /*6400*/) {           // unsigned
   [0x40] = -[0x40]; [0x42] = -[0x42]
   if ([0x3a] >= [0x4f]) { [0x51]++; [0x3e] = 250 }
}
```
### 0777:0639 — fade_step: `if ([0x638]==0) [0x53]=1; else { [0x56] += 0x180; [0x638]-- }` (59 steps of
the fade-to-black blocks, then done).

Zoomer timeline (simulated from the code, frames counted from the first 076d frame, each = 1 retrace):
- frames 1..250: pause ([0x3e]=250), row 40, period 40; only the scroll (horizontal pixels from words
  0x31f.., vertical phase from words 0x39b..) and the wobble/palette rotation move.
- 251..310: row and period grow by 2 per frame (squares 40 -> 160 px), at 310 [0x51]=1, pause 250.
- 561..718: shrink to period 2 (row 2) in 79 frames and grow back to 160 in 79; [0x51]=2 at 718, pause 250.
- 969..1126: same; [0x51]=3 at 1126, pause 250 starts; frames 1127..1185: fade_step (59 palette steps to
  black), frame 1186: done flag -> 076d returns; the second call runs one more frame (1187).
The square size on screen: horizontal r pixels (row r of plane 3), vertical P = r line pairs = 2r scanlines
(r of the 200-line geometry), i.e. square squares.

## Part B: 0777:0829 — Paralax-Bars-with-chessplane (cx frames)

```
do {
  set_pel([0x48])                      // 042b
  music_tick()
  push ds; bar_palette()               // 07b1
  ds = 05ee; es = a000
  di = [0x49]; bp = [0x44]
  save [0x58], [0x5a]
  cli
  200 times {
     bar_line_A(di)                    // 0296
     bar_line_B()                      // 02bd
     bp--; if (bp <= 0) { bp = [0x36]; di ^= 8 }
     si = (si+1)&7                     // unused here
  }
  restore [0x58], [0x5a]
  advance_bars()                       // 0269
  pop ds (= p3_sin); zoom_update()     // 0659: scroll + zoom continue (see below)
  clear_row()                          // 0249 (es = a000)
} while (--cx)
```
- **0296 bar_line_A(di)**: wait until 3da bit0 = 1 (hblank; immediate in the vertical blank);
  set_CS(di) (CS = 0 or 8 only: block 0 or block 8); `x = word 05ee:[0x1f4 + [0x58]]`; `[0x58] += 2`;
  draw_bar(x, src=05ee:0x190).
- **02bd bar_line_B**: wait until bit0 = 1; `x = word 05ee:[0x9c4 + [0x5a]]`; `[0x5a] += 6`;
  draw_bar(x, src=05ee:0x1ba).
- **0269 advance_bars**: `[0x58] += 12; if ([0x58] >= 0x500) [0x58] -= 0x500; [0x5a] += 18; if ([0x5a] >=
  0x500) [0x5a] -= 0x500`.
- **0249 clear_row**: GC8 (bit mask) = 0xff; mapmask = 7; zero 80 bytes at a000:[0x3c]; mapmask = 1.
  ([0x3c] was just updated by zoom_update to the row that the NEXT frame displays.)
- **022c draw_bar(x, si)** (the `jmp ax` jump table at 05ee:01e4 = 005c 0084 00ac 00ec 012c 016c 01ac 01ec,
  all in segment 0777):
  ```
  px = x + [0x4b]; di = [0x3c] + (px >> 3); c = px & 7
  jump to case c (each case first does `mov al, es:[di]` to load the latches, write mode 0)
  ```
  Each write = `plane[mapmask][addr] = (plane & ~bitmask) | (srcbyte & bitmask)` for every plane in mapmask.

  | case | src offset | byte di: bitmask, (mapmask <- src byte) in order | byte di+1 |
  |---|---|---|---|
  | 0 (005c) | +0x00 | 0xfe: (2<-s0) (4<-s1) (1<-s2); then wait display | — |
  | 1 (0084) | +0x03 | 0x7f: (2<-s0) (4<-s1) (1<-s2); then wait display | — |
  | 2 (00ac) | +0x06 | 0x3f: (MM<-s0) (2<-s1) (4<-s2); wait display | 0x80: (4<-s3) (2<-s4) (1<-s5) |
  | 3 (00ec) | +0x0c | 0x1f: same order | 0xc0: same order |
  | 4 (012c) | +0x12 | 0x0f | 0xe0 |
  | 5 (016c) | +0x18 | 0x07 | 0xf0 |
  | 6 (01ac) | +0x1e | 0x03 | 0xf8 |
  | 7 (01ec) | +0x24 | 0x01 | 0xfc |

  "MM" = the map mask left by the previous write: always 1 (plane 0; every case and 0249 end with
  mapmask 1) except for the very first bar of the very first frame of part B, where it is still 8 (plane 3,
  left by 02fa): that one write puts s0 into plane 3 of row [0x3c] (never cleared — 0249 clears planes 0-2
  only). "wait display" = `while (in(3da)&1);` (wait for display enable).

  The bar is 7 pixels wide at screen x (because [0x4b] = 8*[0x46]+[0x48] compensates the scroll). Source
  bytes 05ee:0190 (A) = `6c 82 54 | 36 41 2a | 15 1b 20 80 00 00 | 0a 0d 10 40 80 80 | 05 06 08 20 c0 40 |
  02 03 04 10 60 a0 | 01 01 02 08 b0 50 | 00 00 01 04 d8 a8`; 05ee:01ba (B) = `c6 ee ba | 63 77 5d |
  2e 31 3b 80 80 80 | 17 18 1d c0 c0 40 | 0b 0c 0e e0 60 a0 | 05 06 07 70 30 d0 | 02 03 03 b8 18 e8 |
  01 01 01 dc 8c 74`. Decoded colours of the 7 pixels: A = 4,3,2,1,2,3,4; B = 7,6,5,1,5,6,7 (colour 1 is
  white: the bright centre curve).
- The bar x tables (words, read from img.bin): A at 05ee:01f4.., period 640 words (0x500 bytes), values
  84..235; index reaches 0x4fe+398 so read up to 05ee:0884. B at 05ee:09c4.., values 60..259, index up to
  0x4fe+1194 -> up to 05ee:0e72.

**Racing the beam**: the displayed row is the row being drawn into, and it is only cleared once per frame,
so each scanline shows all bar pixels written so far in this frame: every bar leaves a vertical trail below
its curve (the "curtain" look in the recording). Ordering (rule above): iteration n's bar_line_A (CS and bar A) is done after 2n hblank waits, bar_line_B
after 2n+1; so CS value n is on lines 2n-1 and 2n (value 0 on line 0), bar A of iteration n is visible from
line max(0,2n-1), bar B from line 2n. The second byte of cases 2..7 is written after the wait for display
enable, before the next hblank wait: same w, so same first visible line (GUESS, not measured separately). Pixels with
plane 3 = 0 use DAC 0..7 (CS 0) or grey 128..135 (CS 8); plane 3 = 1: grey 8..15 / DAC 136..143.

- **07b1 bar_palette**: if [0x7b0] != 0: (screen off) DAC[0..7] = B[[0x56]..+23]; DAC[0x88..0x8f] = same;
  (screen on); if [0x7b0]==0xff { [0x56] -= 0x18; if ([0x56]==0x5b80) [0x7b0]=0 } else { [0x56] += 0x18;
  if ([0x56]==0x6138) [0x7b0]=0 }. First call of part B: 0x6120 (faded 59/60) -> 0x5b80 in 60 frames (fade
  in); second call: 0x5b80 -> 0x6120 then stops (fade out, 60 frames, last 230 frames stay at the faded
  palette 0x6120 = almost black). Bar colours 05ee:13c4 (6-bit RGB): `0,0,7 | 60,60,60 | 47,44,44 | 42,36,36
  | 19,16,16 | 28,28,39 | 7,7,29 | 2,2,17`.
- The other DAC blocks keep what part A left (ball blocks faded to 58/60). Only CS 0 and 8 are used here.
- The first frame of part B still shows the ramp of planes 0-2 in its row (not yet cleared).
- zoom_update keeps running: the pause from [0x51]=3 continues (188 more frames), then the zoom bounces on
  forever ([0x51] 4 at bar-frame 346, 5 at 754, ...; 0639 is no longer called since [0x51] != 3).

## Part C: 0777:1258 — Zooming-16x16-pictures (1000 frames) and 0777:1113 (240 frames)

The displayed row is now inside the p3_zoom picture (VRAM 0x3e80.., 16 colours, plane 3 used). Each row r
of p3_zoom is a horizontal strip of sphere columns 0..15 (pixel value = x inside the 16x16 sphere) at some
horizontal zoom; the vertical coordinate comes from CS (DAC = 16*CS + pix = the sphere bitmap stored in the
256-colour palette). p3_outf supplies the CS per scanline.

p3_outf (13300 bytes): words 0..99 (offset 0..0xc7) = offsets of 100 CS sequences inside the file (200, 232,
266, ...): sequence k has length 32+2k (bytes, values 0..14 = sphere row), i.e. the sphere row for each line
at vertical size 32+2k lines.

```
spheres (1258):
[0x44] = 32; [0x3e] = 250
1000 times {
   music_tick()
   if ([0x110f] <= 0xf0) { DAC[[0x110f]], DAC[[0x110f]+1] = cs:[0x0b3f + [0x1111]] (2 colours, 6 bytes,
                            lcall 0299:0076 with ds=cs); [0x1111] += 6; [0x110f] += 2 }
   zoom_c()       // 0a39
   scroll_c()     // 0a93 -> si, bp
   start = [0xa31] + [0x46] + 0x3e80           // CRTC 0c/0d
   wait_vretrace_start()                       // 3da bit3 0->1
   set_pel([0x48])
   ds = p3_outf; cli
   400 times { bl = p3_outf[si++]; while(!(in(3da)&1)); set_CS(bl); while(in(3da)&1);
               if (--bp == 0) { si = [0xa2d]; bp = [0x44] } }
}
spheres_end()     // 1113
```
CS for scanline L = byte L+1 of the loop by the timing rule (byte L by the code's intent; one-line phase unverified). The
start address written before the retrace wait takes effect this frame (GUESS: latched at retrace start).

```
zoom_c (0a39):
if ([0x3e] != 0) { [0x3e]--; return }
[0xa31] += [0xa33]; [0x44] += [0xa35]; [0xa2f] += [0xa37]
if ([0xa31] == 0x1ef0 || [0xa31] == 0) {
   if ([0xa31] == 0) [0x3e] = 1
   [0xa33] = -[0xa33]; [0xa37] = -[0xa37]; [0xa35] = -[0xa35] }

scroll_c (0a93):    (ds = p3_sin for the two table reads)
ax = word p3_sin[[0x655]]
if (!([0x655] == 0x32b && [0xa92] == 1)) { [0x655] += 2; if ([0x655] >= 0x513) [0x655] = 0x31f }
[0x46] = ax >> 3; [0x48] = ax & 7
ax = word p3_sin[[0x657]]
if (!([0x657] == 0x329 && [0xa92] == 1)) { [0x657] += 2; if ([0x657] >= 0x513) [0x657] = 0x31f }
r  = (2*ax) % [0x44]          // 16-bit div
bp = r
ax = word p3_outf[[0xa2f]]    // sequence start
si = ax; if (bp == 0) bp = [0x44]; else si += [0x44] - bp
[0xa2d] = ax
```
(So the sequence is rotated by 2*scroll lines; [0x655]/[0x657] continue from where parts A/B left them.)

Timeline of 1258 (frames from its start): 1..121 palette sweep from 0777:0b3f (256 colours; DAC 0..241 set,
2 per frame; before that the screen shows whatever the old DAC holds: the dark grey/black chess seen at
213.6..215.3 s); pause 250 frames (row 0, period 32: the smallest spheres); then 99 frames zoom in (row +2,
period +2 per frame, up to row 198 / period 230 / table entry 99), 99 frames zoom out, 1 frame pause, and so
on (turns at frames 349, 448, 547, 646, 746, 845, 945).

```
spheres_end (1113):
[0x110f] = 0; [0x1111] = 0
240 times {
   music_tick()
   if ([0x110f] <= 0xf0) { DAC[[0x110f]..+1] = cs:[0x0e3f + [0x1111]]; [0x1111] += 6; [0x110f] += 2 }
   if ([0xa2f] != 0xb4) zoom_c()             // stops at table entry 90 (period 212, row 180)
   [0xa92] = 1; scroll_c()                   // scroll freezes when the indices hit 0x32b / 0x329
   (same display as above: start, vretrace wait, pel, 400 CS lines)
}
start = 0x5dc0                                // the 'chess' picture
DAC[0..15] = 08d8:2d91 (16 colours: 0,0,0 0,0,0 42,31,17 52,43,28 51,39,21 61,52,35 63,47,24 63,59,39
             0,0,0 0,0,0 0,26,31 15,40,47 0,34,42 11,45,56 0,39,49 13,53,61)
lcall 0299:01cc                               // back to 320x200 double scan, P54S off   <- capture switch
start = 0x5dc0; music_tick(); in 3da; set_CS(0)
lcall 0731:013c                               // retrace timer (music on IRQ again)
GC5 = 1 (write mode 1); mapmask = 0xf; copy a000:5dc0..+7999 -> a000:0000 and -> a000:3e80 (latch copy,
all 4 planes); GC5 = 0
```
The 0x0e3f palette is the orange/teal chess colour set (0x2a,0x1f,0x11 / ...): the sweep recolours the
spheres into orange/teal bands (232..233 s in the recording) before the chess picture appears. The two
256-colour tables (0777:0b3f, 0777:0e3f, 0x300 bytes each, 6-bit) are read from img.bin (linear 0x82af and
0x85af).

After the return main calls 0731:013c (again) and 08d8:2dc1. VRAM then holds the 'chess' picture at 0,
0x3e80 and 0x5dc0, shown at 0x5dc0.

## Routine list (module 0777)

0995 entry · 02fa init_vram · 0895 build_palette_buffer · 094c grey_palette · 0601 part A0 · 053b part A1 ·
04fc part A2 · 076d zoomer loop · 0659 zoom_update · 06f6 move_rows · 0639 fade_step · 04da frame_palette ·
043c upload_ball_palette · 0401/03d9 wobble (far) · 04ea ball_lines · 042b set_pel · 02f0 set_CS · 02df
wait_hblank · 0829 bars loop · 07b1 bar_palette · 0296/02bd bar lines · 022c draw_bar + 8 cases 005c..01ec
· 0269 advance_bars · 0249 clear_row · 1258 spheres · 1113 spheres_end · 0a39 zoom_c · 0a93 scroll_c.
Data: 0000..005b variables, 0b3f/0e3f palettes, 0a2d..0a37 / 0a92 / 110f / 1111 variables.
External helpers: 0299:0000 (RLE), 0299:0023 (palette interpolation), 0299:0076 (DAC upload with screen
off), 0299:009c/00c4/00d0/01cc (mode bits), 008e:0014 (alloc), 008e:1f63 (music tick), 0731:0120/0158/013c.


# 08d8:2dc1: Glentz-chess-cube

Called from the main script at 0000:06ca, right after `lcall 0731:013c`, which installs the timer that fires once per retrace and plays the music. The main script calls `0299:01cc` after it returns.

## Summary

- **What you see** (recording, 320x200 file video0009 from frame 16208 = 231.26 s):
  1. 231.26–231.29: the 'chess' picture is still on screen. The previous effect displayed it at 0x5dc0.
  2. Frame 16210: for exactly one frame the screen shows junk. That is the old content of page 0x1f40 (vertical cyan/orange stripes, left over from the zoomer). See "Start state" below.
  3. From frame 16211: an orange/teal checkerboard fills the screen and turns in the image plane at 1 degree per tick for 300 ticks (~4.3 s).
  4. The view zooms out, which reveals a see-through ("glenz") cube made of checker-striped faces. The cube tumbles around two axes.
  5. In the last 120 ticks the cube slides down off the screen. The screen is black at 251.76–251.90 s. The greetings scroller (0eb3) starts drawing at frame ~17660 (251.98 s).
- **Video mode.** 320x200 16-colour planar (EGA-style). This is the mode left by `0299:01cc`: chain-4 off, odd/even off, 40 bytes per row, attribute mode control 0x01 (so P54S is off), write mode 0, bit mask 0xff.
  - Every frame, 08d8:14a9 rewrites CRTC 9 as `(old & 0x60) | 1`. That clears double-scan and sets "max scan line = 1", so each row is shown twice (400 scan lines). The look is unchanged.
  - Two pages: VRAM offset 0 (segment a000) and offset 0x1f40 (segment a1f4). The code flips between them every frame.
  - DAC 0..15 were loaded from 08d8:2d91 by 0777:11e5 (16 RGB triples, 6-bit; table below). The attribute palette registers are assumed to be the identity (GUESS: BIOS default, no code in the slice changes them).
- **Rendering.** A glenz polygon engine with XOR fill, shared by all 08d8 vector effects. Per frame:
  1. Rotate and project the 80 vertices.
  2. Back-face test, then build a deduplicated edge list. Each edge carries an XOR of plane bits.
  3. For each of the 4 bitplanes: XOR-draw the edges of that plane into a 1-bit-per-pixel off-screen buffer (resource `scr_data`), then XOR-fill the buffer into that VRAM plane of the back page and clear the buffer as it goes.
- **Timing.** Tick-based, frame-rate independent.
  - Each frame waits for one timer tick (= one retrace, 70.086 Hz), renders, then reads how many ticks passed since the wait began (`cx`). It runs the animation step 08d8:200a `cx` times.
  - Phase lengths are tick budgets: 300, +70, +50, +50, +30, +10, +10, +10, +800, +120 = 1450 ticks = 20.69 s. Any overshoot carries over into the next phase.
  - In the recording every frame took exactly 1 tick. I checked 3 runs of 40 consecutive frames (16300, 17000, 17400): no repeated frames. So the effect is one render per retrace, 1450 frames, from frame 16210 to ~17659. That matches the measured end (black, then the greetings at 17660).
  - The effect never reads the music position.

## Routines used (all in segment 08d8; offsets are cs-relative)

| addr | name | also used by (other 08d8 effects) |
|---|---|---|
| 2dc1 | `chessCubeMain` (far) | — |
| 2d48 | `runPhase(budget)` | (same pattern as 2663, 26b3, 158f) |
| 14a9 | `flipPageAndWaitTick` | 158f, 24c3, 2534, 25a9, 2663, 26b3, 2868 |
| 1417 | `clearOldBBox` | 158f, 15db, 24c6, 2537, 25ac, 2669, 26e8, 286b |
| 1514 | `saveBBox` | same callers |
| 128d | `renderObject` | 158f, 15db, 24ec, 255d, 268f, 270e, 2891, 2ecd.. (many) |
| 07cb | `transformVertices` (self-modifying) | 128d, 1184, 3d6b |
| 0926 | `faceVisible` | 128d, 1184 |
| 13f7 | `clipAndDrawEdge` | 128d, 1184 |
| 0b70 | `clipLine` | 13f7 |
| 0b24 | `bboxFromRejectCodes` | 0b70 |
| 0f93 | `growPlaneBBox` | 13f7 |
| 097f | `xorLine` (with sub-paths 0966, 09ae, 09d1, 0a0d, 0a44, 0a67, 0aa3) | 13f7 |
| 0ad3 | `xorLeftColumn` | 13f7 |
| 13e2 | `fillIfAny` | 128d |
| 0e00 | `xorFillToVram` (self-modifying) | 13e2, 1184 |
| 0fe1 | `growTotalBBox` | 128d, 1184 |
| 157e | `readTickCounter` (far, via push cs) | all phase loops |
| 200a | `animStep` | 2d48, 2663, 26b3, 2519 |

Not used by this effect: 1184/112a/1026 (a variant of 128d for other effects), 0ecc (a variant of e00), 14e6 (flip by 0x8000), 1535, 1ec8, 1f59, 1fa8, 206c, 20b2, 20f2.

## Global variables (08d8:xxxx, words unless noted; the "init" column is the value in the image)

| off | name | init / value in this effect |
|---|---|---|
| 0000 | seg of resource `scr_data` (loaded by main 0000:0434) | 1-bit buffer + tables |
| 008e | `centerX` | set to 0xa0 = 160 |
| 0090 | `maxY` | 0xc7 = 199 |
| 0092 b | `yMode` | 0 (set to 2 / 0 by 08d8:196e earlier; 0 here) |
| 0093 | saved sp (only 1184) | — |
| 0095 | `angC` (3rd rotation), byte index into the sine table, 0..0x59f | 0 |
| 0097 | `angA` (1st rotation) | 0 |
| 0099 | `angB` (2nd rotation) | 0 |
| 009b b | `leftClipFlag` | 0 |
| 009c, 009e | left-column y range | |
| 00a0 | left-column byte offset in the buffer | 0 |
| 00a2 b | left-column bit mask | 0x80 (pixel x=0) |
| 00a3 | `dist` (camera distance) | 0x96 = 150 |
| 00a7/00a9/00ab/00ad | per-plane bbox ymin/ymax/xmin/xmax | |
| 00af/00b1/00b3/00b5 | frame-total bbox ymin/ymax/xmin/xmax | |
| 00b7/00b9/00bb/00bd | saved total bbox (previous frame) ymin/ymax/xmin/xmax | |
| 00bf | span width in bytes (temp) | |
| 00c1 | sine table: 900 signed words, read from the image (linear 0x8e41..0x95c8) | sin with 720 steps per turn; index in bytes; cos = entry at byte index + 0x168 |
| 07c9 | temp | |
| 0914 | `centerY`: this is the immediate of `add ax,0x64` at 0913 | 100 |
| 0ad1 | edges drawn in the current plane | |
| 0e61 | VRAM segment for drawing: the immediate of `mov bx,0xa000` at 0e60 | a000/a1f4 |
| 128c b | "fill per plane" flag | 1 |
| 1413 | displayed-page offset | 0 / 0x1f40 |
| 1578 | per-tick increment of angC | set 0, later 2 |
| 157c | copy of the tick count | |
| 2002 | per-tick increment of angA | 0 |
| 2004 | per-tick increment of angB | 4 |
| 2006 | per-tick increment of dist | phases |
| 2008 | per-tick increment of centerY | 0, last phase 2 |
| 2661 | ticks taken by the current frame | |

Object (es = segment 0x463, linear 0x4630; from the image, not modified before this effect):

- word [0] = 4 (number of bitplanes to draw)
- [2] = 12 faces; [4] = 0x3cc (face list)
- [6] = 0x69c (edge list: count word, then 9-byte entries)
- [8] = 80 vertices; [0xa] = 0x1ec (projected-vertex array: 80 x {x, y, z} words)
- 0xc..0x1eb: source vertices {x, y, z} int16. Values ±70/±210/±350/±490 on the faces of a cube with half-size 490. Read them from the image.
- Faces: `{word color; word n; n x {word ptrA, word ptrB}}`. ptrA/ptrB are offsets of projected vertices.
  - Faces 0–5: color 0x0901 (front: plane bit 0x01; back: 0x01^0x09 = 0x08), 24 edges each = 6 quads = 3 stripes in one direction plus 3 in the other, each 140 units wide. XOR-filling these gives the checkerboard.
  - Faces 6/7: color 0x0002. Faces 8/9: 0x0004. Faces 10/11: 0x0006. These are the 6 solid cube sides (4 edges each), drawn only when facing the viewer.
- The edge list can hold more entries than the space before segment 0x512 (an intro object that is never used again). The port should use an unbounded list.

Resource `scr_data` (res/10_scr_data, 8521 bytes), segment cs:[0]:

- 0x0000..0x1f3f: the 1-bit-per-pixel work buffer, 200 rows x 40 bytes, all zero in the file. It is kept zero between uses.
- 0x1f41: 8 bytes `80 40 20 10 08 04 02 01` (pixel mask, MSB = leftmost).
- 0x1f49: 256-byte fill table T0, entered in state "outside".
- 0x2049: 256-byte fill table T1, entered in state "inside".
- Generator (verified against the file):

```js
// T[s][b]: walk bits 7..0; a set bit toggles the state BEFORE that pixel is output
function fillByte(b, s) {
  let out = 0;
  for (let i = 7; i >= 0; i--) {
    if ((b >> i) & 1) {
      s ^= 1;
    }
    out |= s << i;
  }
  return out;
}
```

DAC 0..15 (from 08d8:2d91, 6-bit):

```
0:(0,0,0)   1:(0,0,0)    2:(42,31,17)  3:(52,43,28)  4:(51,39,21)  5:(61,52,35)  6:(63,47,24)  7:(63,59,39)
8:(0,0,0)   9:(0,0,0)   10:(0,26,31)  11:(15,40,47) 12:(0,34,42)  13:(11,45,56) 14:(0,39,49)  15:(13,53,61)
```

## 2dc1 `chessCubeMain`

```js
angC = 0; angA = 0; angB = 0; centerX = 160; dist = 150;
incC = 0; incA = 0; incB = 4; incDist = 0;
let cx = 300;            cx = runPhase(cx);   // in-plane spin only (angB)
incDist = 10; cx += 70;  cx = runPhase(cx);   // zoom out
incDist = 10; incC = 2; cx += 50; cx = runPhase(cx);
incDist = 10; cx += 50;  cx = runPhase(cx);
incDist = 8;  cx += 30;  cx = runPhase(cx);
incDist = 6;  cx += 10;  cx = runPhase(cx);
incDist = 4;  cx += 10;  cx = runPhase(cx);
incDist = 2;  cx += 10;  cx = runPhase(cx);
incDist = 0;  cx += 800; cx = runPhase(cx);   // tumbling cube
cx += 120; incY = 2;     cx = runPhase(cx);   // cube slides down (centerY += 2 per tick)
incY = 0; centerY = 100;
return;  // retf
```

- `cx` carries the overshoot: runPhase returns budget minus ticks used, which is ≤ 0.
- Final dist = 150 + 700 + 500 + 500 + 240 + 60 + 40 + 20 = 2210.
- angC moves by 2 per tick from phase 3 on (tick 370). angB moves by 4 per tick all the time. angA stays 0.

## 2d48 `runPhase(budget)`

```js
do {
  flipPageAndWaitTick();          // 14a9
  clearOldBBox();                 // 1417
  saveBBox();                     // 1514 (es = 0x463)
  tot = { xmin: 1000, xmax: 0, ymin: 1000, ymax: 0 };   // b3, b5, af, b1
  renderObject();                 // 128d
  ticks = tickCounter;            // 157e: word 0731:0004, >= 1
  for (let i = 0; i < ticks; i++) {
    animStep();                   // 200a
  }
  budget -= ticks;
} while (budget > 0);             // signed
return budget;
```

`tickCounter` (0731:0004) is set to 0 inside 0731:00a3 (called from 14a9) and incremented by the retrace IRQ. So `ticks` counts the wait plus the render time: 1 when the frame fits in one retrace period.

## 200a `animStep` (one per tick)

```js
angC += incC; angA += incA; angB += incB;   // [1578], [2002], [2004]
dist += incDist; centerY += incY;            // [2006], [2008]; no wrap
for (const a of ['angA', 'angC', 'angB']) {
  if (a >= 0x5a0) {   // unsigned
    a -= 0x5a0;
  }
}
```

## 14a9 `flipPageAndWaitTick`

```js
CRTC[0x0c] = page >> 8; CRTC[0x0d] = page & 0xff;  // page = [1413]; latched at the next retrace
wait0731_00a3();                                    // tickCounter = 0; spin until it is nonzero
CRTC[9] = (CRTC[9] & 0x60) | (yMode + 1);           // yMode = 0 -> 1
page ^= 0x1f40;                                     // [1413] = page that will be drawn
drawSeg ^= 0x01f4;                                  // [0e61]: a000 <-> a1f4, i.e. offset 0 <-> 0x1f40
```

The page drawn in iteration n becomes visible at the retrace that ends iteration n+1's wait.

**Start state.** Stored image values are [1413] = 0 and [0e61] = a000. Earlier 08d8 effects flip them a timing-dependent number of times, but always as a consistent pair. The recording shows the junk page for one frame (16210), then clean renders. So at entry [1413] = 0x1f40 and [0e61] = a1f4 (GUESS from the recording): the first iteration displays page 0x1f40 (junk) and draws into page 0. For the port: show a junk frame or the previous picture for one frame. Also treat the stale saved bbox (from the previous effect) as full screen for the first two frames (GUESS: the recording shows no leftovers).

## 1417 `clearOldBBox` (back page, all 4 planes)

```js
let bp = savedXmax >> 4;              // [bd], unsigned shift
const dx = savedXmin >> 4;            // [bb]
if (bp < 20) {
  bp++;
}
bp -= dx;
if (bp <= 0) {
  return;                             // signed
}
let rows = savedYmax - savedYmin;     // [b9] - [b7]
if (rows < 0) {
  return;
}
rows++;
let di = savedYmin * 40 + 2 * dx + page;   // page = [1413], already flipped = back page
mapMask = 0x0f;
for (let r = 0; r < rows; r++) {
  for (let w = 0; w < bp; w++) {
    vramWriteWord(di, 0);             // seg a000
    di += 2;
  }
  di += 40 - 2 * bp;
}
```

## 1514 `saveBBox`

```js
savedXmax = totXmax;   // bd <- b5
savedYmax = totYmax;   // b9 <- b1
savedYmin = totYmin;   // b7 <- af
savedXmin = totXmin;   // bb <- b3
```

Because the pages alternate, the clear in frame n uses the bbox drawn in frame n-2, which was on the same page.

## 128d `renderObject` (ds = es = object)

```js
edgeList.count = 0;                                 // word at obj[obj[6]]
transformVertices(obj + 0xc, obj[8] /*80*/, obj[0xa] /*out*/);  // 07cb
let si = obj[4];
for (let f = 0; f < obj[2]; f++) {
  const vis = faceVisible(si);                      // 0926, CF
  let color = w(si); si += 2;                       // bl = low byte, bh = high byte
  if (!vis) {
    if (bh === 0) {
      si += 2 + 4 * w(si);                          // skip the face
      continue;
    }
    bl ^= bh;
  }
  const n = w(si); si += 2;
  for (let k = 0; k < n; k++) {
    const pa = w(si), pb = w(si + 2); si += 4;
    let x1 = proj[pa].x, y1 = proj[pa].y, x2 = proj[pb].x, y2 = proj[pb].y;
    // canonical order: y1 > y2, or (y1 == y2 and x1 <= x2); signed compares
    if (y1 < y2) {
      [x1, x2] = [x2, x1];
      [y1, y2] = [y2, y1];
    } else if (y1 === y2 && !(x2 > x1)) {
      [x1, x2] = [x2, x1];
    }
    const e = edgeList.find(e => e.x1 === x1 && e.y1 === y1 && e.x2 === x2 && e.y2 === y2);
    if (e) {
      e.color ^= bl;
    } else {
      edgeList.push({ color: bl, x1, y1, x2, y2 });  // byte + 4 words, appended
    }
  }
}
// draw, one bitplane at a time
let bit = 1;
for (let p = 0; p < obj[0] /*4*/; p++, bit <<= 1) {
  seqMapMask = bit;                       // out 3c4, index 2
  plane = { xmax: -1000, xmin: 1000, ymax: -1000, ymin: 1000 };   // ad, ab, a9, a7
  edgesDrawn = 0;                         // ad1
  for (const e of edgeList) {             // in list order
    if (e.color & bit) {
      clipAndDrawEdge(e.x1, e.y1, e.x2, e.y2);   // si, di, bp, dx
    }
  }
  if (fillPerPlane /*[128c] == 1*/) {
    if (edgesDrawn !== 0) {
      xorFillToVram();                    // 13e2 -> 0e00
    }
    growTotalBBox();                      // 0fe1
  }
}
```

## 07cb `transformVertices(src, count, dst)`

The code patches the immediates of its own instructions; the meaning is given here. `hi(a, b)` = high word of the signed 32-bit product = `(a * b) >> 16`, arithmetic (floor). All values are int16; `<<1` wraps at 16 bits (no overflow in practice). `S(i) = int16 sine table at 08d8:00c1 + i` (byte index).

```js
const s1 = S(angA), c1 = S(angA + 0x168);
const s2 = S(angB), c2 = S(angB + 0x168);
const s3 = S(angC), c3 = S(angC + 0x168);
for (const v of vertices) {                  // count = 80
  const X = v.x << 1, Y = v.y << 1, Z = v.z << 1;
  const A = (hi(Z, c1) + hi(X, s1)) << 1;
  const B = (hi(X, c1) - hi(Z, s1)) << 1;
  const C = (hi(B, s2) + hi(Y, c2)) << 1;
  const D = hi(B, c2) - hi(Y, s2);
  const E = hi(C, c3) + hi(A, s3);
  const F = hi(A, c3) - hi(C, s3);
  const div = -400 - dist + F;               // 16-bit
  const q = idiv32(E * -400, div);           // signed, truncates toward zero; 32-bit dividend
  const sx = idiv32(D * -400, div) + centerX;
  let sy;
  if (yMode === 0) {
    sy = q + centerY;                        // centerY = imm at 0914, normally 100
  } else if (yMode === 1) {
    sy = idiv32((q << 1), 3) + 0x42;         // cwd then idiv
  } else {
    sy = (q << 1) + centerY;
  }
  out.push(sx, sy, F);                       // 3 words to dst
}
```

- With angA = 0, A ≈ Z and B ≈ X, so angB turns the image plane (the opening spin) and angC tumbles the cube.
- With dist ≥ 150 and the vertex range used here, `div` stays negative and no divide overflow happens. The near face projects ~6x larger than the far face (div = -62 vs -1040 at dist 150). The 53-pixel checker squares seen at the start are the far face; the near face's stripes are much wider and are clipped.

## 0926 `faceVisible(face)` → CF

Let P0 = proj[w(face+4)], P1 = proj[w(face+6)] (first edge), P2 = proj[w(face+10)] (end of the second edge).

```js
const cross = (P2.y - P0.y) * (P1.x - P0.x) - (P1.y - P0.y) * (P2.x - P0.x);  // exact 32-bit
return cross >= 0;   // CF = 1 (visible) when not negative
```

## 13f7 `clipAndDrawEdge(x1=si, y1=di, x2=bp, y2=dx)`

```js
if (clipLine() /* ZF = 1 -> draw */) {
  growPlaneBBox(x1, y1, x2, y2);          // 0f93, clipped coordinates
  xorLine(x1, y1, x2, y2);                // 097f
  edgesDrawn++;                           // also counted for horizontal edges
}
if (leftClipFlag === 1) {
  xorLeftColumn();                        // 0ad3
}
```

## 0b70 `clipLine` (in/out: si, di, bp, dx; ZF = 1 means draw)

`max` = [0090] = 199. Outcodes: `cl` for point 1 and `ch` for point 2, each with bit0 x<0, bit1 y<0, bit2 x>319, bit3 y>max. Signed compares.

```js
const and = cl & ch;
if (and) {
  bboxFromRejectCodes(cl | (ch << 8));   // 0b24
  if (!(and & 1)) {
    return SKIP;                          // ZF = 0
  }
  if (and & 2 || and & 8) {
    return SKIP;
  }
  if (y1 === y2) {
    return SKIP;
  }
  let lo = y1, hi = y2;
  if (lo > hi) {
    [lo, hi] = [hi, lo];
  }
  leftClipFlag = 1;
  lcY0 = Math.max(lo, 0);                 // [9c]
  lcY1 = Math.min(hi, max);               // [9e]
  return SKIP;
}
if ((cl | ch) === 0) {
  return DRAW;
}
// "mul/div" below: t = (a * b) computed 32-bit, then idiv by the divisor;
// if the divisor is 0 the idiv is skipped and t = low 16 bits of a * b (quirk)
if (cl) {
  if (cl & 1) {                           // no re-check of x1 < 0
    leftClipFlag = 1;
    lcY0 = clamp(y1, 0, max);
    y1 += mulDiv(y2 - y1, -x1, x2 - x1);
    lcY1 = y1;                            // not clamped
    x1 = 0;
  }
  if ((cl & 4) && x1 > 319) {
    y1 += mulDiv(y2 - y1, 319 - x1, x2 - x1);
    x1 = 319;
  }
  if ((cl & 2) && y1 < 0) {
    x1 += mulDiv(x2 - x1, -y1, y2 - y1);
    y1 = 0;
  }
  if ((cl & 8) && y1 > max) {
    x1 += mulDiv(x2 - x1, max - y1, y2 - y1);
    y1 = max;
  }
}
if (ch) {
  if (ch & 1) {                           // no re-check of x2 < 0
    leftClipFlag = 1;
    lcY0 = clamp(y2, 0, max);
    y2 += mulDiv(y2 - y1, -x2, x2 - x1);
    lcY1 = y2;
    x2 = 0;
  }
  if ((ch & 4) && x2 > 319) {
    const d = x2 - x1;
    const t = mulDiv(y2 - y1, 319 - x2, d);
    if (d !== 0) {
      x2 = 319;                           // quirk: skipped when d == 0
    }
    y2 += t;
  }
  if ((ch & 2) && y2 < 0) {
    x2 += mulDiv(x2 - x1, -y2, y2 - y1);
    y2 = 0;
  }
  if ((ch & 8) && y2 > max) {
    x2 += mulDiv(x2 - x1, max - y2, y2 - y1);
    y2 = max;
  }
}
x1 = clamp(x1, 0, 319); x2 = clamp(x2, 0, 319);
y1 = clamp(y1, 0, max); y2 = clamp(y2, 0, max);
return DRAW;
```

Each case uses the coordinates as already updated by the earlier cases (sequential, as in the code).

## 0b24 `bboxFromRejectCodes(cx)`

```js
if (cx & 0x101) {
  plane.xmin = 0;
}
if (cx & 0x202) {
  plane.ymin = 0;
}
if (cx & 0x404) {
  plane.xmax = 319;
}
if (cx & 0x808) {
  plane.ymax = maxY;
}
```

## 0f93 `growPlaneBBox(si=x1, di=y1, bp=x2, dx=y2)`

The canonical order and clipping mean y1 ≥ y2.

```js
if (!(y1 < plane.ymax)) {
  plane.ymax = y1;
}
if (!(y2 > plane.ymin)) {
  plane.ymin = y2;
}
const lo = Math.min(x1, x2), hi = Math.max(x1, x2);   // via si <= bp test
if (!(hi < plane.xmax)) {
  plane.xmax = hi;
}
if (!(lo > plane.xmin)) {
  plane.xmin = lo;
}
```

## 0fe1 `growTotalBBox`

```js
if (plane.ymax >= tot.ymax) {
  tot.ymax = plane.ymax;
}
if (plane.ymin <= tot.ymin) {
  tot.ymin = plane.ymin;
}
if (plane.xmax >= tot.xmax) {
  tot.xmax = plane.xmax;
}
if (plane.xmin <= tot.xmin) {
  tot.xmin = plane.xmin;
}
```

## 097f `xorLine(si=x1, di=y1, bp=x2, dx=y2)` into the 1-bit buffer (ds = scr_data)

It plots one pixel per row, for the rows from the bottom y up to but not including the top y. That makes the fill parity correct.

```js
if (y1 === y2) {
  return;
}
if (!(y1 > y2)) {                       // unsigned compare
  [x1, x2] = [x2, x1];
  [y1, y2] = [y2, y1];
}
const dy = y1 - y2;
let di = y1 * 40;
let ddx = x2 - x1;                      // xTop - xBottom
let m = MASK[x1 & 7];                   // byte at 0x1f41 + (x & 7)
di += x1 >> 3;
const plot = () => {
  buf[di] ^= m;
};
const left = () => {
  m <<= 1;
  if (m & 0x100) {
    m = 1;
    di--;
  }
};
const right = () => {
  if (m & 1) {
    m = 0x80;
    di++;
  } else {
    m >>= 1;
  }
};
if (ddx === 0) {                                     // 0966
  for (let i = 0; i < dy; i++) {
    plot();
    di -= 40;
  }
  return;
}
const step = ddx < 0 ? left : right;
const adx = Math.abs(ddx);
if (adx === dy) {                                    // 09ae / 0a44
  for (let i = 0; i < dy; i++) {
    plot();
    di -= 40;
    step();
  }
} else if (adx > dy) {                               // 09d1 / 0a67 (x-major)
  let e = 0;
  let n = dy & 0xff;                                 // ah = dl
  plot();
  for (;;) {
    step();
    e += 2 * dy;
    if (e <= adx) {
      continue;                                      // signed
    }
    di -= 40;
    if (--n === 0) {
      return;
    }
    e -= 2 * adx;
    plot();
  }
} else {                                             // 0a0d / 0aa3 (y-major)
  let e = 0;
  for (let i = 0; i < dy; i++) {
    plot();
    di -= 40;
    e += 2 * adx;
    if (e > dy) {
      e -= 2 * dy;
      step();
    }
  }
}
```

The unused byte counter `cx` in the x-major paths is decremented but never tested.

## 0ad3 `xorLeftColumn`

```js
let a = lcY0, b = lcY1;                 // [9c], [9e]
if (a !== b) {
  if (a > b) {
    [a, b] = [b, a];                    // signed
  }
  if (a < 0) {
    a = 0;
  }
  if (b > maxY) {
    b = maxY;
  }
  let n = b - a;
  if (n !== 0) {
    let di = (a + 1) * 40 + 0;          // + [00a0] = 0
    for (; n > 0; n--) {
      buf[di] ^= 0x80;                  // [00a2]
      di += 40;
    }
    edgesDrawn++;
  }
}
leftClipFlag = 0;
```

## 0e00 `xorFillToVram` (self-modifying; ds = es = buffer at first)

```js
const rows = plane.ymax - plane.ymin + 1;
if (rows <= 0) {
  return;
}
const b0 = plane.xmin >> 3;                         // unsigned shifts
const width = (plane.xmax >> 3) + 1 - b0;           // [bf]
let di = plane.ymin * 40 + b0;
for (let r = 0; r < rows; r++) {                    // count patched into 0ebe
  let left = width, state = 0;                      // state = ah (0x00 or 0xff)
  while (true) {
    // repe scasb: find the first nonzero byte p in [di, di + left)
    let p = di;
    while (left > 0) {
      left--;
      if (buf[p++] !== 0) {
        break;
      }
    }
    // p is now one past the byte that stopped the scan (or the end; then that last byte was 0)
    const stop = p - 1;
    for (let k = di; k < stop; k++) {               // bytes that were zero
      if (state) {
        vram(drawSeg, k, 0xff);                     // written only when inside
      }
    }
    const b = buf[stop];
    const out = (state ? T1 : T0)[b];               // T1 = 0x2049, T0 = 0x1f49
    if (popcount(b) & 1) {
      state ^= 0xff;                                // jp not taken = odd parity
    }
    vram(drawSeg, stop, out);                       // this byte is always written
    buf[stop] = 0;
    di = stop + 1;
    if (left === 0) {
      break;
    }
  }
  di += 40 - width;                                 // patched into 0ec1
}
```

- VRAM writes go to segment `drawSeg` ([0e61], a000 or a1f4) at the same offset as the buffer. Only the current map-mask plane is written (write mode 0, bit mask 0xff).
- Zero bytes outside polygons are not written. They rely on 1417 having cleared the old bbox.
- The last byte of each row span is always written: with 0 if outside.

## 13e2 `fillIfAny`

```js
if (edgesDrawn !== 0) {
  xorFillToVram();
}
```

(The `cmp [ab],0x3e8` that comes first jumps to the next instruction either way: a no-op.)

## 157e `readTickCounter`

`cx = word 0731:0004; [157c] = cx;` Far routine, called as `push cs; call`.

## Timing measured

- 320x200 capture starts at frame 16208 (231.26 s).
- First flipped frame (junk page): 16210. First rendered frame: 16211.
- One tick per frame throughout (no repeated frames in 120 sampled).
- The cube starts sliding down at tick 1330 (≈ frame 17540, 250.3 s). It is gone by 17645 (251.76 s). The greetings appear at 17660 (= 16210 + 1450).

## Uncertain

- The page pair ([1413], [0e61]) at entry: inferred from the one junk frame.
- The stale saved bbox ([b7..bd]) at entry: left by the Glentz-vector effect; the port can clear the full screen for the first 2 frames.
- Attribute palette assumed to be the identity.


# Greetings scroller (Peci) — 0eb3:27e8, 0eb3:28ab, 0eb3:27d5

## Summary

Seen: after the Glentz chess cube, the screen goes black, then a line of 8-pixel-high text
("THE GREETINGS GO TO THESE GROUPS: CASCADA, DUST, ...") scrolls from right to left. It keeps
zooming: from a thin, small strip in the middle of the screen, to huge letters filling the
screen, and back. It is drawn in one colour that changes per raster line from dark purple
(R=10,G=0,B=20) at the top and bottom to green (10,63,20) in the middle.

How it is done: video RAM holds only 8 one-bit-per-pixel text lines (plane 0, rows 1..8 at
a000:0028). Every frame the CPU builds the next 8 lines (horizontal zoom: each of the 320 screen
pixels samples a texel of an 8-row "texture" through a per-zoom step table from resource `ugu`),
and while doing so, at every scanline it rewrites the CRTC Offset register (vertical zoom: which
VRAM line the next screen row shows) and DAC colour 1 (the gradient), both from resource `ugu2`.

Main script: `06cf lcall 0299:01cc` (sets 320x200 16-colour planar, double scan, CRTC start=0,
offset 0x14) → `06d4 lcall 0eb3:27e8` (init) → `06d9 lcall 0eb3:28ab` (runs until the text ends)
→ `06de lcall 0eb3:27d5` (frees the resources).

Routines: 0eb3:27e8 init, 0eb3:28ab main loop, 0eb3:27d5 free. Helpers called: 008e:04b3
(load resource), 008e:0063 (free), 0000:002b (DAC all black), 0731:00a3 (wait for the next tick).
Nothing else; the music runs in the retrace-synced timer IRQ (installed by main at 06c5,
0731:013c). No reads of the music position.

Verified: a Python reimplementation of the pseudo-code below (`work/G5/sim0eb3.py`) gives a
pixel-exact match (0 differing pixels) with captured frames G = 17660, 17859, 17959, 18359
(scroller frames 1, 200, 300, 700, with frame 0 = capture frame 17659).

## Video mode at entry (set by 0299:01cc just before)

- 16-colour planar (attribute mode control 0x01, so P54S off, colour select = 0), GC mode 0x00
  (write mode 0), seq clock 0x09 (320 pixels), memory mode 0x06; CRTC from table 0299:01b3:
  CRTC 9 = 0xc0 (double scan, max scan line 0 → 200 rows of 2 scanlines each), offset 0x13 =
  0x14 (40 bytes per row, byte mode), start address 0x0000, VDE 0x18f (400 scanlines).
- GC bit mask is 0xff (the last write, by 0777:0249 during the bars effect; 08d8 doesn't touch
  the GC). Set/reset is off (GUESS: never enabled). Attribute palette assumed identity (pixel 1 →
  DAC 1). DAC: all black (0000:002b), then only DAC 1 is written. Text pixels are value 1 (plane
  0 bit set, planes 1-3 zero in rows 0..9), background value 0 = black.

## Data

cs = segment 0eb3 (linear 0xeb30). Variables (initial values from the image):

| addr | name | init |
|---|---|---|
| cs:[0x0002] w | seg of `ugu2` (loaded) | — |
| cs:[0x000d] w | seg of `ugu` (loaded) | — |
| cs:0x0004 / cs:0x000f | resource names "ugu2    " / "ugu     " | |
| cs:0x0018..0x0157 | output line buffer, 8 lines x 40 bytes, 1 bpp | 0 |
| cs:[0x2718] w | texture write position `p` | 0x0158 |
| cs:[0x27cc] b | frames until next character `cnt` | 8 |
| cs:[0x27cd] w | text pointer | 0x271a |
| cs:[0x27cf] w | output pointer (scratch) | 0 |
| cs:[0x27d1] w | texture row pointer (scratch) | 0 |
| cs:[0x27d3] w | pointer into the frame table | 0x2bdd |

- **Font**: cs:0x1698..0x2717, 66 glyphs (chars 0x20..0x61), 64 bytes each, one byte per pixel,
  values 0x00 or 0xff. Glyph byte `row + 8*col` (row, col 0..7) — stored column-major.
- **Text**: cs:0x271a, 177 chars then a 0 byte (cs:0x27cb):
  `"THE GREETINGS GO TO THESE GROUPS:        CASCADA,  DUST,  IMPHOBIA,  XOGRAPHY,  INFINY,  VIBRANTS,  IMPACT,  AVALANCHE,  ANARCHY"`
  followed by 49 spaces (exact: read img.bin 0xeb30+0x271a until 0).
- **Texture** (in cs, initially all 0): 8 rows, row k at cs:0x2a8*k + x. Used columns
  0x158..0x3ef. It is a ring of 0x148 = 328 texels (41 characters) at 0x158..0x29f with a
  duplicate copy written 0x148 further on, so that a window of 328 texels can be read without
  wrapping.
- **Frame table**: cs:0x2bdd..0x3220, 401 pairs of words `(ugu2_offset, ugu_offset)`, one pair per
  frame, cyclic. ugu2_offset = 400*z2 (z2 = 0..98), ugu_offset = 320*z (z = 0..200). The pairs are
  z = 0,1,2..200,200,199..1 (zoom in then out, 401 frames = 5.72 s per cycle), z2 follows the same
  curve 0..98. Read it from the image.
- **`ugu`** (res/47_ugu, 64320 bytes) = 201 horizontal step tables of 320 signed bytes. Table z,
  byte x = texel step after screen pixel x. z=0: steps of 4 (one char = 2 pixels) ... z=200:
  total of 16 texels over 320 pixels. Tables 0..24 contain a -1 (0xff) where the 328-texel
  window would end (index 80 for z=0, 302 for z=24) followed by zeros: right of it the line is
  blank.
- **`ugu2`** (res/46_ugu2, 39600 bytes) = 99 vertical tables of 200 pairs `(offset, green)`:
  `offset` = value for CRTC reg 0x13 written for that screen row (0, 20, 40 or 60 = advance 0,
  1, 2 or 3 VRAM lines of 40 bytes after this row); `green` = 0..63 for DAC 1.

## 0eb3:27e8 — init (far)

```
ds = cs
load 'ugu'  -> cs:[0x0d] ; load 'ugu2' -> cs:[0x02]      // 008e:04b3
DAC[0..255] = 0 (0000:002b: out 3c8,0 ; 768 x out 3c9,0)
map mask = 0x0f ; a000:0000..0x018f = 0 (200 words: rows 0..9, all planes)
map mask = 0x01                                          // stays 1 for the whole effect
repeat 25: putChar(p, text[tp++]); p += 8                // p = cs:[0x2718], tp = cs:[0x27cd]
p -= 8                                                    // p = 0x218, tp = 0x2733
retf

putChar(p, c):                                            // used here and in the main loop
  g = 0x1698 + (c - 0x20) * 64
  for k in 0..7:                                          // texture row = glyph row
    d = p + 0x2a8 * k
    for j in 0..7: cs[d + j] = cs[g + k + 8*j]; cs[d + 0x148 + j] = cs[g + k + 8*j]
```
(The asm does it with stosw: 8 bytes at d, di += 0x140 → d+0x148, 8 bytes, di += 0x158 → next row.)

## 0eb3:28ab — main loop (far, returns when the text ends)

```
loop:                                    // one iteration per frame
  cli ; wait for next timer tick (0731:00a3; it does sti)   // tick = start of vertical retrace
  a000:0028..0x0167 = cs:0x18..0x157 (rep movsw 0xa0)       // plane 0 only: VRAM rows 1..8
  cs:0x18..0x157 = 0
  si = cs:[0x27d3]; bp = word cs[si]; cs:[0x27d3] += 2       // bp = ugu2 offset
  us = word cs[cs:[0x27d3]]                                  // ugu offset (re-read per line)
  row = 0                                                    // screen row 0..199 = iteration
  for k in 0..7:                                             // 8 text lines
    bx = p + 8 + 0x2a8*k                                     // window: p+8 .. p+0x14f
    di = 0x18 + 40*k ; si = us
    for c in 0..19:                                          // 2 screen rows per c
      wait until 3da bit0 == 0, then until bit0 == 1         // hblank after scanline 2*row
      CRTC[0x13] = ugu2[bp++]
      cs[di++] = sampleByte()
      out 3c8,1 ; out 3c9,10 ; out 3c9,ugu2[bp]              // R, G of colour 1
      wait until bit0 == 0, then until bit0 == 1             // hblank after scanline 2*row+1
      out 3c9,20 ; bp++                                      // B → colour 1 complete
      cs[di++] = sampleByte()
      row++ ... (each half above is one "row step", see note)
  repeat 40:                                                 // rows 160..199, no sampling
    wait hblank ; CRTC[0x13] = ugu2[bp++] ; out 3c8,1; out 3c9,10; out 3c9,ugu2[bp]
    wait hblank ; out 3c9,20 ; bp++
  cs:[0x27d3] += 2 ; if == 0x3221: = 0x2bdd
  if --cnt == 0:
    cnt = 8
    c = text[tp]; if c == 0: retf                            // END
    tp++ ; putChar(p, c)
  p++ ; if p == 0x2a0: p = 0x158
  goto loop

sampleByte():                // 8 pixels, MSB = leftmost; bx persists across the line
  v = 0
  for n in 0..7:
    t = cs[bx]; s = (int8) ugu[si++]
    if s < 0: bx = 0; s = 0; t = 0          // cs[0] is always 0, so the rest of the line is blank
    bx += s
    v |= t & (0x80 >> n)                    // texels are 0/0xff
  return v
```
Note on the rows: each pass through the `c` loop body consumes one (offset, green) pair per hblank
pair, i.e. exactly 2 scanlines = 1 double-scanned row. There are 8*20 + 40 = 200 passes = 200
rows = 400 scanlines per frame. Pair i is written during row i.

### What the screen shows (the model that matched the capture exactly)

- Row i (0..199) displays the 40 bytes of plane 0 (all planes, but only plane 0 is non-zero in
  rows 0..9) at address A_i: `A_0 = 0` (start address), `A_{i+1} = A_i + 2 * offset_i`. Rows 0
  and 9 of VRAM are blank; text lines are VRAM rows 1..8.
- Colour of text pixels in row i ≥ 1 = DAC 1 = (10, green_{i-1}, 20) (6-bit). Row 0 uses the
  previous frame's last value (it is always a blank row anyway).
- The VRAM text shown in frame f was built during frame f-1 (copied at the start of frame f).
  Frame 0 shows blank lines (buffer still zero).
- For z2 tables 0..7, A_i goes past VRAM row 9 into rows 10/11 (bytes 400..479), which are not
  cleared and hold leftovers of the previous (cube) effect. Treating them as 0 matched the
  capture.
- Horizontal: the 8 text lines are the 328-texel window starting at p+8 (oldest character on the
  left, newest at the right end), stepped through ugu table z. 1 texel scroll per frame, a new
  character every 8 frames. Characters are written at the current p, which is not a multiple of
  8 after the init (first new char at p = 0x21f), so a new char overwrites the last column of the
  previous one (mostly empty columns), and near the ring wrap (p > 0x298) the tail lands only in
  the duplicate area. Emulate the cs bytes literally (as in sim0eb3.py) to get this right.

## 0eb3:27d5 — free (far)
`ds = cs; free cs:[0x0d] (ugu); free cs:[0x02] (ugu2); retf`.

## Timing

- One frame per timer tick (retrace-synced; the IRQ also plays the music). The per-line work
  fits within a scanline, the 400 hblank waits end at the bottom of the display, and the
  end-of-frame work (char drawing every 8 frames) fits in the vertical blank.
- Frame count: 25 chars at init, then one per 8 frames; the 0 at text index 177 is read at the
  end of frame 8*(177-24)-1 = 1223 → **1224 frames (17.46 s)**, 3.05 cycles of the 401-frame
  zoom table.
- Recording (capture frame G, T = G/70.086): cube last visible G 17643 (251.73); black (DAC
  zeroed, resources loading) G 17644..17659; scroller frame 0 = G 17659 (251.96, blank), first
  text G 17660 (251.98, 3-row-high strip on rows 99..101, colour (10,0,20)); largest zoom (pair
  200) at frame 200 = G 17859 (254.82); text has scrolled out (trailing spaces) by about G 18810;
  last scroller frame G 18882 (269.42); next effect (dot tunnel) visible from G ~18888 (269.50).


## Port notes: DOSBox timing, measured while porting

These findings correct or extend the notes above.

- **Attribute flip-flop and PAS.** 0777:076d writes Color Select before its first wait of each frame. The flip-flop
  is then in the data state (0777:042b leaves it there), so `0x34` goes to palette register 0 and is ignored (PAS
  is set). `bl` then becomes the index with PAS clear, and the screen is blank until the next Color Select write.
  The recording shows this: in every zoomer frame, scanlines 399 and 0 are black. The port handles it in vga.js:
  palette registers 0..15 are locked while PAS is set, and an index write with PAS clear blanks the screen.
- **DAC writes take effect only with the blue component** (DOSBox). The greetings depend on this: row i shows the
  green of pair i-1.
- **Double-scanned rows** are drawn at their first scanline. In the greetings, the blue write after the second
  hblank of a row only shows from the next row.
- **The bars loop (0777:0829) is not locked to the frame.** Its waits are "until bit 0 = 1" then "while bit 0 =
  1". In DOSBox, display enable still pulses on line 400, and bit 0 stays at 1 only from line 401 to the end of
  the frame. As a result:
  - One pass of the loop costs 399 hblank lines plus the vertical blank. The music tick and the frame code are
    short: about 0.5 line, plus about 0.5 line per note on a tick that reads a row.
  - During the palette fade, the DAC upload with the screen off costs about 1 line, and the loop stays locked.
  - After the fade (from frame 13939), the bars roll up by about one line per frame, and lose 1 or 2 lines on
    ticks that read a row with 2 or 4 notes.
  - The frame code (start address, row clear, the next pass) then runs in the middle of the display.
  - The recording has 2 fewer frames than loop passes. The port models this with a scanline clock
    (src/parts/chessBeam.js). It is exact up to frame 14407. After that, when the end of the pass reaches line
    400, the recording is one line later than the model (unresolved).
- **The wobble indices cs:0032/0034 are shared with the wave effect 08a8.** The recording needs 605 calls by
  08a8 (one per two of its 1210 frames): [0x32] = 15 and [0x34] = 200 at 0777:0995.
- **The DOSBox capture switches resolution one frame late.** At 12192 the frame is still 320x200 and the white
  frame 0 of 0601 shows at 12193. At 16207 the frame is still 320x400 while the port is already 320x200.
