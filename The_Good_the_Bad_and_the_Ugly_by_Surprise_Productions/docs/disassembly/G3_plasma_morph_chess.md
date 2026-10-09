# G3: Plasma, Cyclic-Plasma, Morphing-Line-figures, Chess-effect

Slice G3 of the GBU.EXE disassembly ("The Good, The Bad & The Ugly", Surprise! Productions, 1993).
Addresses are `SEG:OFF` in the unpacked image rebased to segment 0 (`re/img.bin`). Overlay offsets are from the start
of the resource `mutamcde`. "Frame" means one VGA retrace (70.086 Hz), and frame numbers are global capture frames
(`capat.py --frame G`, demo time = G / 70.086). Sections marked GUESS are guesses. Sections marked UNCLEAR are open questions.

## Summary

| # | Effect (NFO credit) | Entry | Mode | Frames in recording | Ends when |
|---|---|---|---|---|---|
| 1 | Plasma (Erik): horizontal sine plasma with raster-split rows, colour cycling, fade-in | `0cf9:01dd` | 256 colours, unchained, 4 scanlines per row (100 rows); CRTC offset reprogrammed every row | drawing 52.6–53.1 s; loop from about frame 3719; first light frame 3731 (53.23 s); last frame 5145 (73.41 s) | music sync count = 3 |
| 2 | Cyclic-Plasma (Erik): three moving radial "ring" fields summed | `0cc5:0139` | the same 256-colour unchained mode, 4 scanlines per row, 80 bytes per row, double-buffered | white from 5146; fade-in from white over 70 frames; fade-out over 280 frames; last frame 6482 (92.49 s) | music sync count ≥ 4, then a 280-step fade to black |
| 3 | Morphing-Line-figures (Peci): an 11×11 wireframe grid that morphs, rotates and zooms in a black box | `0d2e:0010` + overlay `mutamcde` | 16 colours, planar, 320×200 (`0299:01cc`); 4-generation motion trail through the colour-select register | 6484 … 7685 (92.5–109.6 s), exactly 1200 iterations at 1 frame each | 1200 frames |
| 4 | Chess-effect (Erik): XOR-filled star "chessboard" between two moving centres, 4-frame motion trail | `08d8:18d4` | the same 16-colour planar mode | black 7686–7688; slides in from 7689; last frame 8666 (123.65 s); white 8667–8669 | music sync count ≥ 5 |

The main script calls these in order: `05a3 lcall 0cf9:01dd`, `05a8 CRTC[0x13]=0x28`, `05af 0731:013c` (reinstall the
retrace timer), `05b4 lcall 0cc5:0139`, `05b9` clear `a000:0000..fffd` on all 4 planes, `05d0 lcall 0299:01cc`
(16-colour mode), `05d5 lcall 0d2e:0010`, `05da` clear `a000:0000..5dbf` on all planes, `05f0 lcall 08d8:18d4`, and
then `05f5 lcall 0749:01cc` (Water, not in this slice).

### Routines in this slice

- Plasma (`0cf9`): `01dd` main, `0165` init, `008d` plasma render, `0120` pixel colour, `00f8` planar pixel put,
  `0036` palette fade-table build, `0192` wait for 4 hblank starts.
- Cyclic-Plasma (`0cc5`): `0139` main, `0036` table step.
- Morph (`0d2e:0010` caller). Overlay functions: `AH=0` (`1fd7`), `AH=1` (`1d2b`), `AH=2` (`1ff4`). Overlay
  helpers: `0013` set DAC, `1cb6` set colour select, `1cc0` P54S on, `1ce9` plane select, `1d52` page flip,
  `1d8a` morph, `1df7` rotate/project, `1f89` draw grid, `1a98` line (OR).
- Chess (`08d8`): `18d4` main, `1846` frame draw, `1706` table step, `097f` XOR edge line, `0ecc` XOR-fill and blit,
  `179c` scroll/colour-select step, `17f6` exit step.
- Shared helpers:
  - `0299:0023`: palette interpolation (used by Plasma and Cyclic).
  - `0299:0076`: DAC upload with screen blanked (Plasma, Cyclic, Chess).
  - `0299:0175`: 256-colour unchained mode (Plasma).
  - `0299:01cc`: 16-colour planar mode (main script before Morph).
  - `0299:009c`: P54S on (Chess; the overlay has its own copy at `1cc0`).
  - `0299:0227`: line compare (Chess).
  - `0731:00a3`: wait for the next timer tick.
  - `0731:0158`: restore the BIOS timer (Plasma).
  - `08d8:157e`: read the frame counter (Cyclic, Morph).
  - `008e:18a4`: music sync counter (Plasma, Cyclic, Chess).
  - `008e:1f63`: music tick (called directly by Plasma).

## The music sync counter (008e:18a4) — this slice DOES read the music

`008e:18a4` returns `ax = word cs:[008e:11cc]`. That word is incremented only by the MOD effect `8xx`: the handler at
`008e:1e8e` is entry 8 of the effect jump table at `008e:11ab`. The table is `1d0f 1d92 1dc8 1e00 1d0e×4 1e8e 1d0e 1ea0 1d0e 1efa 1f12 1d0e 1f2f`.
The handler runs on tick 0 of a row (the row-read tick), and once per channel that holds an `8xx` in that row. It clears
the effect slot so that it counts only once. The initial value is 0.

In "Beastsong" (MOD at GBU.EXE+0x9c40) the `8xx` effects are, in play order:

| count | order | pattern | row | channel | ticks from song start* |
|---|---|---|---|---|---|
| 1 | 1 | 0 | 61 | 1 | 1372 |
| 2 | 3 | 1 | 57 | 1 | 2736 |
| 3 | 7 | 5 | 0 | 0 | 4573 |
| 4 | 8 | 14 | 32 | 1 | 5629 |
| 5 | 12 | 10 | 0 | 0 | 8093 |
| 6 | 17 | 22 | 0 | 1 | 11613 |

\*These values were computed with the player rules I read:
- The speed byte `008e:1268` starts at 8 (row 0 of order 0 lasts 8 ticks).
- `Fxx` with xx ≤ 0x1f sets speed = xx + 3, so the song's `F08` gives 11 ticks per row. See handler `1f2f`.
- `D00` sets row = 63 (`1f12`).
- The song restarts at order 11.

The tick rate is one tick per retrace, except inside the Plasma, which calls the tick itself once per loop iteration.

Checks against the recording:
- Count 4 starts the Cyclic fade-out at about frame 6202, which gives a music start at about frame 572.
- Count 5 ends the Chess at frame 8666, which gives about frame 572.
- Count 3 ends the Plasma at frame 5145. With 1 tick per frame through the Plasma this also gives about frame 572.
- Count 2 (about frame 3308) falls before the Plasma loop starts, so the Plasma does not wait.

UNCLEAR: the Plasma's measured iteration rate is about 1.0097 iterations per frame (see below). That rate would end the
Plasma about 14 frames earlier than observed. The music slice should settle exactly when the song starts and how the
ticks run. For the port, the rule is "exit when the sync count reaches N", driven by the port's music player.

## Shared helpers

```
0299:0023  palInterp(ds:si = src bytes, ds:di = dst bytes, ds:bp = out, cx = colours, dh = step, dl = steps)
  for i in 0 .. 3*cx-1:
      s = src[si++]; d = dst[di++]                      // unsigned bytes
      q = trunc_toward_zero( int8(d - s) * int8(dh) / int8(dl) )  // imul dh ; idiv dl ; quotient in al
      out[bp++] = (s + q) & 0xff
  // bp, si, di are left advanced (callers rely on bp continuing)

0299:0076  dacUpload(ds:si, di = first colour, cx = colours)
  SEQ[1] |= 0x20 (screen off); out 3c8,di; 3*cx bytes to 3c9; SEQ[1] &= ~0x20

0299:0175  mode "320x200 256c unchained" (no BIOS call; registers only):
  ATTR[0x10]=0x41; GC[5]=0x40; SEQ[1]=0x01; SEQ[4]=0x06; CRTC[0x11]&=0x7f;
  CRTC[0..0x18] = 5f 4f 50 82 54 80 bf 1f 00 c0 00 00 00 00 00 00 9c 8e 8f 28 00 96 b9 e3 ff ; sti
  -> byte mode, offset 0x28 (80 bytes/row), CRTC9=0xc0 (scan-double, 2 scanlines/row => 200 rows)

0299:01cc  mode "320x200 16c planar":
  ATTR[0x10]=0x01; GC[5]=0x00; SEQ[1]=0x09 (dot clock /2); SEQ[4]=0x06;
  CRTC = 2d 27 28 90 2b 80 bf 1f 00 c0 00 00 00 00 00 00 9c 2e 8f 14 00 96 b9 e3 ff
  -> 40 bytes/row (offset 0x14), 2 scanlines/row, 200 rows, 8000 bytes/page, pixel = 4 bitplanes, bit 7 = left pixel
  Attribute palette registers are the identity (0299:005e, called once by main at 0483).

0299:009c  ATTR[0x10] |= 0x80  (P54S: DAC index = (ColorSelect[1:0] << 4) | palreg[pixel] )
0299:0227  line compare = bx: CRTC[0x18]=bl, CRTC[7].bit4 = bx.bit8, CRTC[9].bit6 = bx.bit9
0731:00a3  waitTick(): sti; frameCnt(0731:[4]) = 0; while (frameCnt == 0) {}   // waits for the NEXT retrace
08d8:157e  cx = frameCnt (0731:[4]); also stored at 08d8:[157c]
0731:0158  wait vretrace start (3da bit3 0->1); PIT ch0 = 0 (18.2 Hz); restore saved BIOS int 8. Music now only
           ticks when someone calls 008e:1f63.
```

Note on `waitTick` and `157e`: `00a3` clears the counter when it starts. So `157e`, called right after a wait, returns
1, unless another tick has already arrived. Called before the wait, it returns 1 plus the number of retraces that
passed since the previous wait returned.

---

## 1. Plasma — 0cf9:01dd

Resources:
- `cs:[0]` = `kp3_sin` (1024 bytes, an unsigned sine table 0..255; [0]=255, [256]=128, [512]=0).
- `cs:[2]` = `kp3_sin2` (7450 bytes; tables below).

kp3_sin2 layout (word = little-endian uint16):
- `0x0000..0x11f7`: row offset table `T[]`, 2300 words with values 2..78 (centre 40). Reads run past the end up to
  word index 2398, into `0x11f8..0x12bd`, which holds 99 more words of the same curve.
- `0x156e..0x1955`: start address table `SA[]`, 500 words. All are multiples of 240, in the range 0..40560.
- `0x1a20..`: target palette, 256×3 six-bit values. Only 762 bytes are in the file; the last 6 bytes would be past
  the end, but they are never displayed (see below).

Variables in segment 0cf9 (initial values):
- `[14]`=0: SA index in bytes.
- `[16]`=0: T index in bytes.
- `[18]`=0, `[1a]`=0x10f (271 rows), `[1e]`=1, `[20]`=0, `[22]`=4, `[24]`=0, `[26]`=0: render parameters.
- `[1c]`: segment of the 0xe11-paragraph fade buffer.
- `[8b]`=0: fade offset.
- `[1da]`=0: colour-cycle offset.
- `[1dc]`=0: fade divider.
- `[f4]`=0x0102: plane-put state (`cl`=2 is the map-mask index, `ch` is the plane bit).

### Init 0165 and render 008d/0120/00f8 (runs before the mode change; not visible)

```
es = a000; ds = kp3_sin; di = 400 (0x190)
// the code reduces to (all other parameters are 0):
for y in 0..270:
  for x in 0..959:
    v = ((sin[(x + y) & 1023] + sin[0] + sin[(4*y) & 1023]) & 0x7f) + 1     // sin[0] = 255; v in 1..128
    plane x&3, byte address 400 + 240*y + (x>>2)  = v
// i.e. a 960x271 virtual screen, 240 bytes per row, starting at byte 400, unchained (pixel x on plane x&3).
// Pixel put 00f8: OUT 3c4 = (planeBit<<8)|2 for every pixel; after plane 8 comes plane 1 and di+1.
```

General form, for reference: `bp = sin[bx&0x3ff] + sin[c2&0x3ff] + sin[c3&0x3ff] + dx + [34]`, where `bx` = y*[1e]
+ x, `c2` += [20] for each pixel starting at [26]*[20], `c3` = y*[22], and `dx` += [24] for each pixel. Only the low 7
bits are used, so the garbage in `ah` that enters `bp` does not matter.

Then `0036` builds the fade buffer (segment `B`, 0xe110 bytes):
```
B[0xd500..0xd7ff] = target palette (kp3_sin2+0x1a20, 0x300 bytes); B[0..0x2ff] = 0
bp = 0x300
for dh in 0..69: palInterp(src=B+0, dst=B+0xd500, out=B+bp, cx=256, dh, dl=70)   // bp advances 0x300 per call
=> palette m at B[0x300*m]: m=0 zeros; m=1..70: target*(m-1)/70 (trunc); m=71: target
```

### Main 01dd

```
init (0165 above); CRTC start = 0; mode 0299:0175; CRTC[9] = (CRTC[9] & 0xe0) | 1   // 0xc1: 4 scanlines per row => 100 rows
ds = kp3_sin2
while musicSync() < 2: {}            // already >= 2 in the recording (count 2 came at about frame 3308)
0731:0158 (music now ticked only by this loop); wait vretrace start (3da bit3 0->1)
loop:                                 // iteration n = 0,1,2,...
  cli
  CRTC start (0c/0d) = SA[n % 500]            // word kp3_sin2[0x156e + [14]]
  dacUpload(B + [8b] + [1da], first colour 1, 128 colours)   // screen blanked during the upload
  [1da] = ([1da] + 12) mod 0x180              // colour cycle: 4 colours per iteration
  if [8b] <= 0xd200: if (++[1dc] & 3) == 0: [8b] += 0x300     // fade step every 4 iterations, up to 0xd500
  008e:1f63 (music tick; it ends with sti)
  [14] = ([14] + 2) mod 0x3e8
  CRTC[0x13] = 0xa0
  i0 = [16]/2 ; prev = 40                     // di = 0x28
  SEQ[1] |= 0x20 (screen off)
  for j in 0..98:
      t = T[i0 + j]
      CRTC[0x13] = (0x78 + t - prev) & 0xff;  prev = t
      wait 4 hblank starts (0192: 4 x {while(3da&1); while(!(3da&1))})
      if j == 0: SEQ[1] &= ~0x20 (screen on)
  [16] = ([16] + 4) mod 0x11f8
  CRTC[0x13] = 0xa0
  if musicSync() == 3: retf               // back in main: CRTC[0x13]=0x28
```

So in iteration n:
- DAC colour v (1..128) = `pal_m[(4*(n mod 32)) + v - 1]`, where `m = min(floor(n/4), 71)`. Because of the fade-table
  layout, `m <= 1` is black. Colour 0 is never set. The highest palette entry read is 251, so the 6 missing file bytes
  never show.
- Row r of the iteration (4 scanlines each) has a start byte address that telescopes. Row 0 = `SA`. Row r≥1 =
  `SA + 240*r + 2*(T[i0+r-1] - 40)`. In virtual-screen terms that is virtual row `SA/240 + r - 2` and byte column
  `2*T[i0+r-1]`, i.e. pixel column `8*T`. Row 0 is virtual row `SA/240 - 2`, pixel column 320. When SA = 0, row 0
  shows bytes 0..79, which are never written and so are black (seen at frames 4080–4104 and 4575–4599).
- Addresses wrap at 64 KB.

### What the recording shows (DOSBox timing — essential for a faithful port)

The loop is NOT locked to the vertical retrace. One iteration waits for 99×4 = 396 hblank edges. A frame has 400
edges: the vertical blank counts as one blank period, so the edge after line 399 merges with it. The music tick and the
palette upload usually fit inside one line.

As a result:
- The iteration phase drifts up the screen by 4 scanlines every frame (2 lines in the 200-line capture).
- On iterations where the music player reads a new row (every 11th tick), 2 more edges are lost. That frame drifts by
  only 2 scanlines.
- Every frame shows a tear:
  - the rows above it belong to iteration n-1: its offsets, its palette, and the start address latched at the frame
    start;
  - then a black band of about 4 scanlines (the screen-off of the new iteration);
  - then the rows of iteration n with its palette.
- The rows below the band keep accumulating offsets from the rows above. Only the start address resets, once per frame.
- About once every 103.5 frames two iterations fall in one frame (the band at both the top and the bottom).
  Over the effect, iterations ≈ frames × 1.0097.

Measured:
- Band positions for every iteration n = 12..1282 (frames 3731..5100) are in `work/G3/its.json` as pairs
  `[n, X]`, where `X = 400*frame + scanline_before_band`.
- The derived iteration lengths are in `work/G3/plasma_timing.json`: 396 edges 1162 times, 398 edges 101 times
  (about every 11th iteration), plus a few 394/400 measurement pairs.

A line model reproduces many frames to under 2/255 mean error. Here X is the edge after which the band starts (lines
X+1..X+4 are black), and w (0 or 2) is the number of lost edges:
```
offset writes of iteration n:  0xa0 at X_n ; o_1..o_99 at X_n + w_n + 4*j ; X_{n+1} = X_n + w_n + 396
row start for scanline s (s % 4 == 0): addr += 2*offset written at an edge <= frame_base + s - 2
frame start address = SA of the last iteration whose X <= frame_base - 1
palette: lines after X_n + w_n + 4 use palette(n), lines above use palette(n-1)
```
Python reference: `work/G3/model3.py` (render) and `work/G3/plasma_sim.py` (virtual screen and tables).

About half of the frames have an extra 0xa0 row (+320 bytes) at the band, or a one-row shift, that I could not
predict. It comes from sub-line DOSBox timing: whether the CRTC row latch happens before or after the CPU writes
`o_1` / `0xa0`. I would not try to model that.

Suggested port:
- Run one iteration per 396 edges, plus 2 extra on music row ticks. Keep the edge clock across frames.
- Render each frame line by line with the model above.
- Optionally drive X from `its.json` to match the recording's tear positions exactly.

The first lit frame is 3731 (iteration 12, first non-black fade level). The loop starts at about frame 3719.

---

## 2. Cyclic-Plasma — 0cc5:0139

Resources:
- `cs:[2]` = `p75_data` (1664 bytes):
  - `0x000..0x17f`: 128-colour palette.
  - `0x180..0x3ff`: X table, 320 words, values 0..79.
  - `0x400..0x67f`: Y table, 320 words, values 0..99.
- `cs:[0]` = `plasma` (64000 bytes = 320×200). The left half is a 160×200 radial field. The right half is the same
  field sampled half a pixel to the right.

Variables (initial values):
- `[24]=0`, `[26]=0xa0`, `[28]=0xa0`, `[2a]=0xa0`, `[2c]=0x50`, `[2e]=0x28`: byte indices into the tables.
- `[18] [1a] [1c]`: X1..X3. `[1e] [20] [22]`: Y1*320..Y3*320.
- `[30]=0`: page.
- `[134]`: segment of the 0x64-paragraph palette work buffer.
- `[136]`=1: state. `[137]`=0: fade step. `[138]`=0: fade divider.

```
step36():   // read the current value, then advance
  X1=Xt[[24]], [24]+=4; Y1=Yt[[26]]*320, [26]+=4; X2=Xt[[28]], [28]+=4; Y2=Yt[[2a]]*320, [2a]+=6;
  X3=Xt[[2c]], [2c]+=2; Y3=Yt[[2e]]*320, [2e]+=4;  all indices mod 0x280; Xt = word p75[0x180+i], Yt = word p75[0x400+i]

main:
  DAC 0..255 = (63,63,63)  (768 x 0x3f)
  buf[0..0x17f] = p75 palette; buf[0x180..0x2ff] = 0x3f; buf[0x300..0x47f] = 0
  CRTC[9] = (CRTC[9] & 0xe0) | 1   (4 scanlines per row, 100 rows; offset 0x28 = 80 bytes per row, set by main)
  step36()
  loop:
    CRTC start = [30]
    if state==1: palInterp(src=buf+0x180 (white), dst=buf+0 (p75), out=buf+0x480, 128 colours, dh=[137], dl=70)
    if state==2: palInterp(src=buf+0 (p75), dst=buf+0x300 (black), out=buf+0x480, 128, dh=[137], 70)
    waitTick()
    dacUpload(buf+0x480, first 0, 128); dacUpload(buf+0x480, first 128, 128)   // colour c shows pal[c & 127]
    [30] ^= 0x3e80                       // draw into the other page (pages at 0 and 0x3e80)
    MAP MASK = 3 (planes 0,1):  for r in 0..99, k in 0..79:
        byte[[30] + 80r + k] = P[Y1+X1+320r+k] + P[Y2+X2+320r+k] + P[Y3+X3+320r+k]   (8-bit wrap)
    MAP MASK = 0xc (planes 2,3): same with +160 on all three source addresses
    (int 21h/0Bh: a key ends the effect; the port ignores this)
    cx = 157e()                         // ticks since the wait = 1 in the recording
    repeat cx times:
        step36()
        if state==1 or (state==2 and (++[138] & 3)==0): if [137] < 70: [137]++
    if musicSync() >= 4:
        if state==1: state=2, [137]=0
        if [137]==70: retf
```

So pixels 4k and 4k+1 get the planes-0/1 byte, and pixels 4k+2 and 4k+3 get the planes-2/3 byte. Rows are 4
scanlines each, 100 rows.

Verified on frames 5500 and 5800 (mean error 1.4/255): frame g shows the page drawn with the table state after
`n = g - 5147` calls of step36. The tables repeat with period 320.

Timeline:
- 5146: all white (DAC = 0x3f; the plasma page is still displayed).
- 5148: first plasma frame (n=1).
- Fade-in from white: 70 frames, `[137]` = 0..70.
- Count 4 at about frame 6202.
- Fade to black: 280 frames, one step every 4 iterations.
- Last frame 6482.

---

## 3. Morphing-Line-figures — 0d2e:0010 + overlay mutamcde

### Caller 0d2e:0010

`cs:[0..3]` is a far pointer to `mutamcde:0000`; `cs:[4]` = the overlay segment; `cs:[e]` = 1.

```
ovl(AH=0); waitTick(); ovl(AH=0)
remaining = 1200
do { ovl(AH=2, cx=[e]); waitTick(); [e] = 157e() /* = 1 */; ovl(AH=1); remaining -= [e] } while (remaining > 0)
```

The recording runs exactly 1200 iterations at 1 frame each: frames 6484..7685. Frame 6483 is a single frame of the
mode switch.

### Overlay entry (offset 0): AH=0 → 1fd7, AH=1 → 1d2b, other → 1ff4 (AH=2)

```
AH=0 (1fd7): DAC 0..63 = overlay[0x1be2..0x1ca1]; P54S on (1cc0); es = 0xa400.  (es is a register that persists
             between calls: it is the page drawn next)
  The palette is the same as cheffect's, as gray levels (r=g=b):
  blk0: 0 62 15 63 31 63 31 63 47 63 47 63 47 63 47 63
  blk1: 0 47 63 63 15 47 63 63 31 47 63 63 31 47 63 63
  blk2: 0 31 47 47 63 63 63 63 15 31 47 47 63 63 63 63
  blk3: 0 15 31 31 47 47 47 47 63 63 63 63 63 63 63 63
  (block k: plane k bit -> 63, plane k-1 -> 47, k-2 -> 31, k-3 -> 15, max of these; idx1 in block 0 is 62)

AH=1 (1d2b): if (--[1ce8]) == 0 { [1ce7] = ([1ce7]+1) & 3; [1ce8] = 2 }; ColorSelect (ATTR 0x34) = [1ce7]
             initial [1ce7]=0, [1ce8]=3  -> select 0 for the first 2 calls, then changes every 2 calls

AH=2 (1ff4, cx = frames to advance):
  planeSel (1ce9): [1cd6] = ~[1cd6] (initial 0); if it becomes 0xff:
      MAP MASK = [1cd4]; GC[4] read map = [1cd5]; [1cd4] <<= 1; [1cd5]++; if [1cd4] == 0x10: [1cd4]=1, [1cd5]=0
      (initial [1cd4]=1, [1cd5]=0; so the plane changes on calls 1,3,5,... and stays for 2 calls)
  repeat cx times:
      [1ff2]++ ; if [1ff2] <= 0x70: D -= 16 ; if [1ff2] >= 1000: D += 16    // D = imm16 at 1f58, initial 0x800
      morph (1d8a); rotateProject (1df7)
  clear the box: es:[0x261 + 40*r + k] = 0 for r 0..172, k 0..21   (x 72..247, y 15..187; current plane only)
  drawGrid (1f89)
  flip (1d52): if [1a68]==0x8000 { es=0xa800; start=0x4000 } else { es=0xa400; start=0x8000 }; [1a68]=start;
               CRTC start = start          // shows the page just drawn; initial [1a68]=0x8000
```

### Data in the overlay (int16 words)

- Grid point i = 0..120 (11×11, row-major):
  - `C[i]` = word `0x824+2i`: x, values -50..50 step 10.
  - `A[i]` = word `0x916+2i`: y, values -50..50.
  - `B[i]` = word `0xa08+2i`: z, the morph output, initially all 0.
- Height fields `H_k` at `0xafa + k*0xf2`, k = 0..7, 121 words each. `H_0` = `H_7` = initial B. The others peak at 40,
  64, 40, 50, 40, 0.
- Sine table: word `0x24 + a`, Q15, 512 entries (`a` = even byte offset 0..0x3fe). Cosine = word `0x124 + a`.
- Masks:
  - `1a76`: 80 40 20 10 08 04 02 01.
  - `1a7e` (left span): ff 7f 3f 1f 0f 07 03 01.
  - `1a86` (right span): 80 c0 e0 f0 f8 fc fe ff.

```
morph (1d8a): vars [128a]=0 (steps left), [128c]=100 (hold), [128e]=0xa08 (source block)
  if [128a] != 0:
      [128a]--; t = 50 - [128a]
      for i: B[i] = S0[i] + trunc((S1[i]-S0[i]) * t / 50)       // S0 = word [128e]+2i, S1 = word [128e]+0xf2+2i
  else if (--[128c]) == 0:
      [128c]=100; [128a]=50; [128e] += 0xf2; if [128e]==0x1198: [128e]=0xafa
  => 100-frame hold, then morph H0->H1 over 50 frames, hold 100, H1->H2, ... H6->H7, then H0->H1 again (150-frame cycle)

rotateProject (1df7): r1=[1292], r2=[1294], r3=[1296] (initially 0)
  r3 -= 2; r1 -= 4; r2 += 4; if r2 > 0x3fe: [1290] = ~[1290] (unused); r1,r2,r3 &= 0x3fe
  m(a,b) = (int32(a)*int32(b)) >> 15  (arithmetic; low 16 bits kept)
  for i in 0..120:
     y1 = m(A,cos r1) - m(B,sin r1);  z1 = m(A,sin r1) + m(B,cos r1)
     x2 = m(C,cos r2) - m(z1,sin r2); z2 = m(C,sin r2) + m(z1,cos r2)
     X  = m(x2,cos r3) - m(y1,sin r3); Y = m(x2,sin r3) + m(y1,cos r3)
     d  = z2 - D  (16-bit)
     sx[i] = trunc(X*256 / d) + 160 ; sy[i] = trunc(Y*256 / d) + 100     // idiv; stored as (sx,sy) at 0x1298+4i
  (D: 0x800 -> 0x100 over frames 1..112 (zoom in), constant, then +16 per frame from frame 1000 (zoom out to a dot))

drawGrid (1f89): for row 0..10, col 0..9: line(p[11*row+col], p[11*row+col+1]);
                 for row 0..9, col 0..10: line(p[11*row+col], p[11*row+col+11])

line (1a98) (x1=si, y1=cx, x2=bp, y2=dx), OR-plot into es (40 bytes/row), 1 pixel wide:
  if x1==x2: vertical: from min(y) to max(y) inclusive, or mask[x&7] at byte x>>3
  if x1 > x2: swap the end points; ddx = x2-x1; step = +40; ddy = y2-y1; if ddy<0 { ddy=-ddy; step=-40 }
  ddy == 0: horizontal span x1..x2 on row y1 (left mask 1a7e[x1&7], right mask 1a86[x2&7], 0xff between;
            same byte -> left & right)
  ddy == ddx: diagonal, ddx+1 pixels, x+1 and y+step each
  ddy > ddx: y-major: err=0; repeat ddy times { plot; y+=step; err += 2ddx; if err > ddy { x++; err -= 2ddy } }; plot
  ddy < ddx: x-major: plot (x1,y1); for ddx steps { x++; err += 2ddy; if err > ddx { err -= 2ddx; y+=step } ; plot }
             (the asm collects bits of a row in ah and ORs them in when the byte or row changes; same pixels)
```

### What the recording shows

- The background outside the box is not black. It is the Plasma's (0cf9) virtual screen at addresses 0x4000 and
  0x8000, read as 4 bitplanes. Rendering it gives a zero-variance match per nibble at frame 6490 (see
  `work/G3/noise_4000.png`).
- This is a DOSBox artefact. The main script's clear (05b9) and the Cyclic-Plasma pages were written in the
  256-colour mode. DOSBox's 16-colour renderer does not see those writes, but it does see the Plasma pixels, which were
  written while the credits' 16-colour mode was still active (0165 runs before 0cf9 sets its mode). On real hardware
  this area would be black.
- To match the recording, fill the 4 planes of both pages with the Plasma virtual-screen bytes. The plane byte at
  address a = the 0cf9 pixel at that address and plane.
- The overlay draws only into the box and the current plane.
- The grid exactness was not checked pixel by pixel. The timing was: exactly 1200 frames.

---

## 4. Chess-effect — 08d8:18d4

Resources:
- `cs:[18]` = `cheffect` (832 bytes):
  - `0x000..0x27f`: 320 words, values 20..179.
  - `0x280..0x33f`: 64-colour palette, the same as the Morph palette.
- `cs:[0]` = `scr_data` (8521 bytes), used as a work buffer:
  - `0..0x1f3f`: 1-bit XOR buffer (40×200), all zero in the file and left zero after each fill.
  - `0x1f41`: bit table 80 40 20 10 08 04 02 01.
  - `0x1f49`: 256-byte prefix-XOR table `PF[b]`. Output bit k (MSB first) = XOR of the input bits from bit 7 down to
    bit k.
  - `0x2049`: `~PF[b]`.

Variables (08d8):
- `[2d]=0x64`, `[2f]=0x32`, `[31]=0xa0`, `[33]=0x50`: table indices.
- `[25] [27]`: centre 1 (x, y). `[29] [2b]`: centre 2 (x, y).
- `[1796]=1`: map mask. `[1797]=0`: colour select.
- `[1798]=0x3e80`: CRTC start. `[179a]=0`: line compare.
- `[ab]/[ad]/[a7]/[a9]` = 8 / 0x137 / 8 / 0xbf: fill window (x 8..311, y 8..191).
- The immediate at `0f2d` is set to 0xa1f4, so the fill writes to `a000:1f40 + offset`.

```
main 18d4:
  dacUpload(cheffect+0x280, first 0, 64)
  P54S on (0299:009c); MAP MASK=0xf; a000:0000..1f3f = 0xff (all planes) ; waitTick()
  [23]=0; imm 0f2d = 0xa1f4; window = (8,0x137,8,0xbf)
  do { frame(); step179c() } while musicSync() < 5
  [179a]=0; do { frame(); step17f6() } while [179a] != 0     // runs once: line compare 0
  waitTick(); line compare = 0; retf

frame (1846):
  MAP MASK = [1796]; [1796] <<= 1; if [1796] >= 0x10: [1796] = 1      // plane k%4 for iteration k
  1706: x1 = W[[2d]], y1 = W[[2f]], x2 = W[[31]] + 100, y2 = W[[33]] (W = cheffect words);
        [2d]+=4, [2f]+=6, [31]+=6, [33]+=4 (mod 0x280)
  for each of the 22 border points (y,x): (8,8) (8,51) (8,94) (8,137) (8,180) (8,223) (8,266) (8,310)
        (190, same 8 x) (53,8) (98,8) (143,8) (53,310) (98,310) (143,310):   xorEdge(y, x, y1, x1)
  same 22 points to (y2, x2)
  fill (0ecc) with window x 8..311, y 8..191; then reset the window to these same values

xorEdge (097f) (y1=di, x1=si, y2=dx, x2=bp): XOR one pixel per row into the buffer (edge list for even-odd fill)
  if y1==y2 return; make y1 the larger y (swap the points); dy = y1-y2; sgn = sign(x2-x1); adx = |x2-x1|
  adx == 0:  for i in 0..dy-1: xor (x1, y1-i)
  adx == dy: for i in 0..dy-1: xor (x1+sgn*i, y1-i)
  adx > dy:  xor(x1,y1); err=0; h=dy; loop { x += sgn; err += 2dy; if err > adx { y--; if --h == 0 break;
                                                                      err -= 2adx; xor(x,y) } }
  adx < dy:  err=0; for i in 0..dy-1 { xor(x,y); y--; err += 2adx; if err > dy { err -= 2dy; x += sgn } }
  (pixel (x,y): buffer[y*40 + (x>>3)] ^= 0x80 >> (x&7); rows y2+1..y1 get exactly one pixel)

fill (0ecc): for y in 8..191: p = 0
   for col in 1..38: b = buf[y*40+col]; screen[0x1f40 + y*40 + col] (current plane) = p ? ~PF[b] : PF[b];
                     p ^= parity(b); buf[y*40+col] = 0
   (the asm skips runs of zero bytes with repe scasb, filling them with 0x00/0xff; it uses self-modified
    immediates at 0f87 (rows left) and 0f8b (40 - row bytes))

step179c: cx = frameCnt (1 + retraces passed while drawing; 1 in the recording); waitTick();
  CRTC start = [1798]; ColorSelect = [1797]; [1797] = ([1797]+1) & 3
  [1798] -= 0xa0 * cx; if [1798] <= 0x1f40 (unsigned): [1798] = 0x1f40
step17f6: same, but writes line compare = [179a] instead of the start address and subtracts 12*cx from [179a]
  (signed; clamped to 0)
```

Display:
- The image lives at bytes 0x1f40..0x3e7f. The start address goes from 0x3e80 down to 0x1f40 in steps of 160 bytes
  (4 rows) per iteration, so the image slides down from the top in 50 frames. Before that, the area above it shows
  zeroed memory (black).
- The 8-pixel border (x <8, >311 and rows <8, >191) is never written and stays black.
- Pixel nibble = the 4 planes = the 4 latest generations. Colour select k makes the plane k%4 written in iteration k
  white (63). Older generations are 47, 31 and 15.
- At the end, line compare 0 shows memory from address 0, which is all 0xff: index 15 is white in every block.
  The recording shows 3 white frames, 8667–8669, then the Water effect.

Verified exactly (mean error 1.26/255 = 6-bit rounding) on frame 8000:
- Captured frame g shows colour select `k = g - 7685` (mod 4) with the planes of iterations k-2, k-1, k, k+1.
- So in the recording the next plane has already been drawn when the frame is captured.
- Port: frame g = select (g-7685)&3, planes from iterations g-7687 .. g-7684.
- Table positions for iteration j = initial + j steps.

Timeline:
- Morph ends at 7685; 7686–7688 are black; the first lit frame is 7689.
- The loop runs 1 iteration per frame until count 5, at frame 8666.
- White frames 8667–8669.
- Python reference: `work/G3/chess.py` (it reproduces the frame exactly).

## Files

- `work/G3/plasma_sim.py`: Plasma virtual screen and tables.
- `work/G3/model3.py` + `linesim.py`: the Plasma line model.
- `work/G3/its.json`: measured Plasma band positions.
- `work/G3/cyc.py`: Cyclic frame generator (verified).
- `work/G3/chess.py`: Chess generator (verified).
- `work/G3/mod8.py`: `8xx` sync-point finder.
