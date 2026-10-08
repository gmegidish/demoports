# C2: shared graphics routines 0x1ad47..0x1c602, the "code" at 0x0f8c0..0x1ad47, and the RGB-scanline video mode

All addresses are code32 offsets. "peek" = initial value in the image.

## Summary

- **0x0f8c0..0x1ad47 is not code. It is data: the two per-tick timelines (dword tables of scene-function
  pointers).** The "17,000-instruction function at 0x10000" (and 0x0f8c0, 0x0fa00, 0x0fff0) is
  capstone decoding of repeated dwords such as `a4 3f 05 00`. Nothing needs porting except the run tables below.
  - Timeline 2 (second section, ISR 0x1b7a4): `fn = dword[0xf2d0 + 4*tick]` for tick < 0x2260. It covers
    0xf2d0..0x17c50 (0x2260 entries), and 0x17c50..0x17ce0 holds 36 more copies of 0x56012 that are never used.
    0xf2d0..0xf8c0 sits before my slice but is listed below for completeness.
  - Timeline 1 (first section, ISR 0x1b800): `fn = dword[0x17ce0 + 4*tick]` for tick < 0xc15.
  - The font block (glyph headers and pixels) is at 0x63a0..0xf2c3, just before timeline 2 (see 0x1bafa).
- **Timer (answers the brief's question):** there are two ISRs. Both run at 30 Hz (divisor [0x1b705] = 39772), and
  each install (0x1b75f, 0x1b724) **resets the tick [0x1b707] to 0**. Section 1 runs until tick 0xa7c (2684) and
  section 2 until tick 0x21fc (8700). Total 11384 ticks / 30 = **379.47 s, which equals the recording length**.
  The recording also places the section-2 RGB video's frame 0 at 173.9 s ≈ 2684/30 + 2531/30 = 173.83 s, so there is
  no measurable gap at the section switch.
  ISR 2 (0x1b7a4) differs from ISR 1: table 0xf2d0, limit 0x2260, and it calls 0x53ed8 each tick when byte
  [0x1b7ff] == 0 (scene function 0x54e78 sets it to 0).
- Graphics routines: unchained ("mode-X") plane writers (0x1ad47, 0x1ae5d dead, 0x1c0c1), CRTC start (0x1af37),
  the RGB delta-video player (0x1afc4/0x1af4e), the nibble-RLE decoder (0x1c34d, with self-modified length),
  the picture decoder (0x1c504 with the bit-packed sub-decoder 0x1c558), the proportional font (0x1bab5/0x1bafa,
  0x1bb5c/0x1bbac), text-scroller drivers (0x1bddc, 0x1be99, 0x1c086), darken LUT passes (0x1c2a7, 0x1c2c2,
  0x1c2f8, 0x1c2dd dead), the 2x upscaler (0x1c314), the loader 0x1b27d, and the timer install/remove helpers.
- **No RIX decoder is in this slice.** "RIX3" at 0x1b252 is a leftover header template whose fields are reused as
  variables ([0x1b256] = A000 pointer, [0x1b25a] = 64 KB buffer). **0x1c504 decodes pictures stored in DEMO.AVI,
  not DEMO.FLI frames:** its callers pass avi-table entries 2 and 11. Check: both decode to exactly 64000 bytes,
  ending 1 byte before the next table entry. Entry 2 is the "COMA / we are nothing but gray mass" photo of
  children; entry 11 is the devil drawing "MIKSI HELVETISSÄ…".
- **RGB mode (0x54e0b): on DOSBox, and on any VGA that mirrors CRTC ports, CRTC 9 ends up as 6, not 0.** See the
  section near the end. The recording is a faithful copy of what DOSBox showed (57 memory lines, each 7 scanlines
  tall). It is not just a capture artifact.

Routines called from this slice: 0x28623 (planar-to-320 upscaler, another slice), 0x1c34d, 0x1af4e, 0x1ad47,
0x1c0c1, 0x1bab5, 0x1bafa, 0x1bbac, 0x1c558, 0x4be4 (music, eax=4), 0x53ed8 (from ISR 2), extender helpers 0x2b9,
0x2b2c, 0x2bdc, 0x2c4d, 0x2b69, [0x2c], 0x346, 0x388, 0x52a0a, 0x538a8, 0x286ce (inits in 0x1b27d).

## Global variables in this slice

| addr | size | name | peek | notes |
|---|---|---|---|---|
| 0x1ad24 | d | pageOfs | **0x7fd0** | mode-X back-page offset. 0x54ec3/0x54f64 XOR it with 0x7d00, so it alternates 0x7fd0 ↔ 0x02d0. It lives inside timeline 1's tail (never reached). |
| 0x1ad28 | d | lineSel | 0 | 0 / 0x50 / 0xa0: which of the 3 memory lines of a video row (R/G/B) |
| 0x1ad2c | b | palAdd | 0 | 0x00 / 0x40 / 0x80 added to pixels (R/G/B palette ramp) |
| 0x1ad2d, 0x1ad31 | d | streamG, streamB | 0 | green/blue video stream pointers (red stream is [0x2897c]) |
| 0x1b0f8 | 20 d | fliTab | | DEMO.FLI offsets; base added at load |
| 0x1b170 | 30 d | aviTab | | DEMO.AVI offsets; base added at load (values below) |
| 0x1b256 | d | vga | | 0xa0000 - [0x18] |
| 0x1b25a | d | buf64k | | 0x10000 alloc, used as a 256x256 texture |
| 0x1b25e, 0x1b262 | d | bufA, bufB | | 0xfa00 allocs (bufB used as 160x100) |
| 0x1b3bd | 200 d | rowPtr | | rowPtr[y] = [0x5606e] + 320*y |
| 0x1b6f5 | d | oldVec | | saved IRQ0 vector (0x346 result) |
| 0x1b705 | w | pitDiv | 39772 | 30.0 Hz |
| 0x1b707 | d | tick | | |
| 0x1b7ff | b | isr2NoCall | | ISR 2 calls 0x53ed8 when it is 0 |
| 0x1b882 | b | fontBase | 0 | colour base for 0x1bab5 |
| 0x1b887 | 136 d | glyphTab | | chars 0x0f..0x96 |
| 0x1baa7 | d | textPtr | 0 | current string |
| 0x1bab1 | d | letterGap | 1 | extra advance after every glyph |
| 0x1baf6 | d | glyphAdv | | scratch |
| 0x1bdd4 | d | scrollOfs | 0 | string offset for the scrollers (step 0x10) |
| 0x1bdd8 | d | textDst | 0x6a4a | plane offset for 0x1c0c1 |
| 0x1c0bd | d | textLen | 0xfa0 | bytes per plane for 0x1c0c1 |
| 0x1c313 | b | upAdd | 0 | added by 0x1c314 |
| 0x1c349 | d | rleCount | | 0x1c34d output counter |
| 0x1c3e2 | d | rleLimit | 0xea0 | **the imm32 of `cmp [0x1c349], imm` at 0x1c3dc (self-modifying)** |
| 0x1c3ed | b | bitClock | | 0x1c558 |
| 0x1c3ee | 128 b | pkPal | 0 | 0x1c558 local palette; **persists between calls and pictures** |
| 0x1c4ee | w | pkBits | | |
| 0x1c4f0 | b | pkMask | | |
| 0x1c4f1 | 8 w | pow2 | 2,4,8,16,32,64,128,256 | |
| 0x1c501 | b | pkN | | |
| 0x1c502 | w | opCount | | 0x1c504 |
| 0x28980 | d | vidReq | 0 | requested frame (set from 0x28989 by scene fns) |
| 0x28985 | d | vidLast | 0xffffead7 | last decoded frame (another slice's video also uses it) |
| 0x28989 | d | vidNext | 0 | |
| 0x2897c | d | streamR | | |
| 0x28b88/8c/90/94 | d | planeR/G/B, deltaBuf | 0x28b98/0x295e8/0x2a038/0x2aad8 | 0xa50 bytes apart |
| 0x2861f | d | upRows | 0x30 | rows for 0x28623 (0x1afc4 sets 0x21) |

aviTab after relocation (add the AVI load address): idx 0:0, 1:0x1030a, 2:0x20614, 3:0x2867a, 4:0x6db24,
5:0x79f1d, 6:0xa8d1d, 7:0xd8a1d, 8:0xe8a1d, 9:0x140dd9, 10:0x1510e3, 11:0x1613ed, 12:0x1650ec, 13:0x16ee09,
14:0x17ee09, 15:0x1c4d8c, 16:0x20d94c, 17:0x259e28, 18:0x26a132, 19:0x27a43c, 20:0x285eaf, 21:0x290db5,
22:0x29b5ff, 23:0x2a19c6, 24:0x2a6e60, 25..29:0. Entry 0 is 0, so it becomes the AVI base itself (the RIX3 image).

## Timelines (the "code" at 0x0f8c0..0x1ad47)

Timeline 1, base 0x17ce0 (section 1, tick → function):
```
   0.. 246 522f9   247.. 445 523f2   446.. 543 5247a   544.. 638 524b2   639.. 736 524ea
 737..1048 52522  1049..1458 525f2  1459..1922 5269e  1923..2154 52744  2155..2619 527de
2620..3083 5288c  3084 522f9  3085..3088 0 (would crash; never reached: main leaves at 2684)
```
Timeline 2, base 0xf2d0 (section 2):
```
   0.. 212 53f8b   213.. 319 53fe9   320.. 403 53fa4   404.. 426 5409a   427.. 483 540e7
 484.. 532 540f3   533.. 590 540ff   591.. 639 5410b   640.. 697 54117   698.. 746 54123
 747.. 804 5412f   805.. 853 5413b   854..1067 542d0  1068..1274 543bf  1275..1708 544c0
1709..1922 54575  1923..2136 5466a  2137..2243 54777  2244..2349 54911  2350..2456 54777
2457..2530 55bc7  2531..3632 54e78  3633..3739 54f41  3740..3846 55032  3847..3953 55202
3954..4024 55032  4025..4296 55202  4297..4523 552ae  4524..4665 5537c  4666..4808 5540a
4809..4899 55529  4900..5093 555fb  5094..5235 556cf  5236..5378 5578d  5379..5451 5584b
5452..5770 55c35  5771..5984 55d31  5985..6197 55e12  6198..6518 5540a  6519..6732 55ef6
6733..7159 55f77  7160..7907 55ef6  7908..8799 56012
```
For a port, store these as run lists. Recording time of section-2 tick T ≈ 89.47 + T/30 s.

## Loader / timer helpers (0x1b27d..0x1b873)

**0x1b27d init**
```
vga = 0xa0000 - [0x18]                        // [0x1b256]
memset([0x5606e], 0, 0xfa00)
avi = load("demo.avi"); for i<30: aviTab[i] += avi
fli = load("demo.fli"); for i<20: fliTab[i] += fli
[0x529f4] = alloc(0x40000); call 0x52a0a
[0x53811] = alloc(0x4e200); call 0x538a8      // noise buffer used by 0x53815
for y<200: rowPtr[y] = [0x5606e] + 320*y      // 0x1b3bd
[0x1b25a] = alloc(0x10000); [0x1b25e] = alloc(0xfa00); [0x1b262] = alloc(0xfa00)
memset([0x1b25a], 0, 0xbd00*4)   // 0x2f400 bytes into a 64 KB block: overruns into the next allocs (harmless in a port: clear all three)
call 0x286ce
```
**0x1b75f / 0x1b724** install ISR 0x1b800 / 0x1b7a4 on IRQ0 (bl=0, [0x2c]). They save the old vector via 0x346
(edi=0x1b6df) into [0x1b6f5], program the PIT (mode 0x36, divisor [0x1b705]) and set tick=0.
**0x1b84d** installs a dummy EOI-only handler 0x1b79a, restores the vector (0x388) and sets the PIT divisor to 0 (18.2 Hz).

**ISR 1 0x1b800**: `tick++; if (tick < 0xc15) tl1[tick](); 0x4be4(4); phase=(phase+0xc1c)%0x3e800 (with reset to 0 when >= 0x3e800)`.
**ISR 2 0x1b7a4**: `tick++; if (tick < 0x2260) call dword[0xf2d0+4*tick]; 0x4be4(4); if (!byte[0x1b7ff]) 0x53ed8(); phase as above`.
The tick is incremented before indexing, so entry 0 is never called. [0x5380c] is the noise phase.

## Mode-X plane writers

Port I/O: `out 3c4, ax=0x0m02` sets the map mask to plane bitmask m (1, 2, 4, 8 → planes 0..3).
Pixel x of a mode-X line is plane x&3, byte x>>2.

**0x1ad47 writeVideoComponent()**. In: [0x5606e] = 320-wide source (rows of 320 bytes), pageOfs, lineSel, palAdd.
```
for p in 0..3:                                   // map mask 1<<p
  dst = vga + lineSel + pageOfs
  for r in 0..0x83 (132 rows):
    for b in 0..79: plane[p][dst + b] = (src[r*320 + 4*b + p] + palAdd) & 0xff
    dst += 0x50 + 0xa0                           // 240 bytes = 3 memory lines per video row
```
So memory line `3*r + k` (k = lineSel/80: 0=R, 1=G, 2=B) holds video row r of component k. The layout in
memory is 80 bytes per line: line L starts at pageOfs + 80*L.

**0x1ae5d** (unreferenced, dead): the same pattern for 0xc6 = 198 rows from [0x56072], with no palAdd, dst stride
0x50+0x50 = 160 (every other line), at vga + pageOfs.

**0x1c0c1 textOverlay()**. Copies [0x56072] (320 wide) into the planes as one linear run, skipping zeros:
```
for p in 0..3:
  dst = vga + textDst + pageOfs
  for i in 0..textLen-1:  v = buf56072[4*i + p]; if (v) plane[p][dst + i] = v
```
textLen = 0xfa0 = 4000 bytes, so 50 consecutive 80-byte lines. textDst = 0x6a4a = line 340, byte 10 (x = 40).
Because the copy is linear, source row y column c maps to memory line 340+y, column 10+c for c < 70, and to
line 341+y, column c-70 for c >= 70 (the last 70 px of each row wrap onto the next line).
The text rows sit on consecutive single scanlines, unlike the video's 3-line rows. 0x1c086 sets textDst = 0x2bcf
(line 140, byte 15) for its caller.

**0x1af37 setStart()**: `out 3d4: (0x0c, pageOfs>>8), (0x0d, pageOfs&0xff)`. There is no retrace wait. The VGA
latches the start address at vertical retrace, so the flip takes effect on the next frame.

## RGB delta video: 0x1afc4 / 0x1af4e (called by effect 0x54ec3)

Stream format (DEMO.AVI, 3 streams = R, G, B; for this effect avi idx 14, 15, 16 = 0x17ee09, 0x1c4d8c, 0x20d94c):
`dword N (=209); dword keyOfs (=0x350); dword deltaOfs[N]` (offsets relative to the stream start). Every
payload is 0x1c34d-RLE of a 78x33 image (0xa0e = 2574 bytes, one byte per pixel, values 0..15).

**0x1afc4 videoStep()**
```
rleLimit = 0xa0e   (patches the cmp at 0x1c3dc);   upRows = 0x21 (33)
if (vidReq == vidLast) goto display      // jmp 0x1af4e (its ret returns to the caller)
vidLast = vidReq
if (vidReq == 0) {
   rle(streamR + d[streamR+4] -> planeR); rle(streamG+.. -> planeG); rle(streamB+.. -> planeB)
   display()                              // 0x1af4e; then FALL THROUGH (delta 0 is applied too)
}
for (S,P) in (streamR,planeR),(streamG,planeG),(streamB,planeB):
   rle(S + dword[S + 8 + 4*vidReq] -> deltaBuf)
   for i<0xa0e: P[i] = (P[i] - deltaBuf[i]) & 0xff          // 8-bit wrap; delta bytes 0..15 or 0xf0..0xff (= -16..-1)
display()
vidNext++; if (vidNext >= dword[streamR]) vidNext--          // freeze on frame N-1
```
**0x1af4e display()** for comp k in 0,1,2: `0x28623(esi=plane_k, edi=[0x5606e])` (78x33 → 320x132,
4x upscale with [0x20602]=2 shift; other slice); then lineSel=0x50*k, palAdd=0x40*k, call 0x1ad47.

The RLE overshoots: one run can pass 0xa0e (measured up to 3159 bytes for these streams). A spill from the R
keyframe lands in planeG and is overwritten when G is decoded; a spill from deltaBuf runs past 0x2b564.
In a port, decode into a large scratch buffer.

Frame pacing (scene fn 0x54e78 each tick, section-2 ticks 2531..3632): `byte[0x53f8a] += 0xc8; on carry
vidReq = vidNext`. That caps playback at 23.4 fps, and frames never skip (vidNext grows by exactly 1 per decode).
**In the recording the video plays at ≈14.3 frames/s** (least-squares fit of the best-matching decoded frame
against recorded rows at 0.4 s steps: frame ≈ 14.31*(t - 173.90)). So it was CPU-bound in DOSBox. It reaches frame
208 at ≈188.5 s and freezes there until the noise effect at ≈213 s. To match the recording, use
`frame = min(208, floor((t - 173.90) * 14.3))`.
Verified: decoding all 209 frames gives a real video of people in a supermarket; values stay in 0..15 except
a handful of wrapped pixels (≤ 3 per plane, original artifacts).

Effect 0x54f64 (ticks 3633..3739) re-displays the frozen planes with noise: 0x28623, then 0x53815 (patched by
0x54f64: `mov ecx` imm at 0x53822 := 0xa640 = 133 rows, and the `add [edi], 0xc0` imm at 0x53840 := 0, so values
are clamped to 0x3f and nothing is added), then 0x1ad47 per component. The recording confirms the R/G/B order is
kept during the noise.

## RLE decoder 0x1c34d (nibble RLE, used by the video)

In: esi = src, edi = dst. Out: esi/edi advanced. Stops when total >= rleLimit (unsigned; it may overshoot).
```
count = 0
do {
  b = *src++
  if (!(b & 0x80)) {
     n = (((b & 3) << 8) | *src++) + 1
     v = (b & 0x40) ? (((b & 0x3c) >> 2) | 0xf0) : (b >> 2)     // b>>2 is 0..15 here
  } else if (b & 0x40) { v = (b & 0x20) >> 5; n = (b & 0x1f) + 1 }   // 0 or 1, short run
  else                 { v = (b & 0x3c) >> 2; n = (b & 3) + 1 }
  fill(dst, v, n); count += n
} while (count < rleLimit)
```
rleLimit values: 0xa0e (this video), 0xea0 (0x28999), 0x3e80 (0x28b2a).

## Picture decoder 0x1c504 (+ bit-packed runs 0x1c558)

In: esi = src, edi = dst. Out: ecx = bytes written, esi past the data. Callers: 0x53fb0 (avi idx 2 → [0x5606e])
and 0x54043 (avi idx 11 → [0x5606e]). Each decodes one complete 320x200 picture.
```
ops = u16(src); src += 2                        // runs ops+1 times (dec word / jns)
repeat ops+1 times:
  b = *src++;  n = b & 0x3f
  if b < 0x40:   v = *src++;          write v n times            (n = 0 still consumes v)
  elif b < 0x80: w = u16(src); src+=2; write the 2 bytes (lo, hi) n times
  elif b < 0xc0: copy n literal bytes
  else:          packedRun(n)                   // 0x1c558; n must be >= 1 (n = 0 would loop ~2^32 times)
```
**0x1c558 packedRun(n)**:
```
h = *src++
if (h < 0x80) { copy h bytes src -> pkPal[0..h-1]; src += h }   // else: reuse the previous pkPal
K = h & 0x7f
pow = first of [2,4,8,..,256] with pow >= K;  bits = log2(pow) (1..8);  mask = pow - 1
end = src + ceil(n*bits/8)
bit stream LSB-first starting at src: for i<n: idx = next `bits` bits; write pkPal[idx]
src = end
```
The exact original mechanics: dx = u16 at src; every `bits` shifts of dx>>1, a byte counter adds 0x20; on carry
(every 8 shifts) dh = next byte. This equals an LSB-first bit reader. The read-ahead is discarded because esi is
reset to `end`. pkPal is static at 0x1c3ee and is never cleared, so a picture can rely on the previous run's palette.

## Font (0x1bab5, 0x1bafa, 0x1bb5c, 0x1bbac)

Glyph table at 0x1b887: `glyphPtr(ch) = dword[0x1b887 + 4*(ch - 0x0f)]` for ch = 0x0f..0x96. Each pointer is
an offset into the font block, which starts at 0x63a0:
`w = u16[ptr+0x63a0]; h = u16[ptr+0x63a2]; pixels = bytes at ptr+0x63a4, w*h, row-major, values 0..15, 0 =
transparent`. Glyphs with w = 0 (space, 0x0f..0x20, # % ' < = > @ [ \ ] ^ _ { | } ~) draw nothing and advance 8.
Defined glyphs: ! " $ & ( ) * + , - . / 0-9 : ; ? A-Z ` a-z, plus 0x82 0x83 0x85 0x86 0x88-0x8f 0x93-0x96 (CP437
accents). Heights are 25 (31 for descenders and brackets). To extract: loop over the 136 entries and read from the
image. The block ends at 0xf2c3.

**0x1bab5 drawString320(edi = dst in a 320-wide buffer)**: textPtr = string, fontBase = colour base.
```
i = 0; line = edi
loop: x = line
  for (;;) { c = s[i++]
     if (c == 0) return
     if (c == 13) break
     x += drawGlyph320(c, x) + letterGap }       // letterGap [0x1bab1] = 1
  line += 0x1900                                  // 20 rows of 320
  if (s[i] == 13) { i++; line += 0x640 }          // CR CR: 5 more rows
  goto loop
drawGlyph320 (0x1bafa): adv = 8; if w: { adv = w; for r<h: for c<w: v = pix; if v: dst[r*320+c] = ((v<<2) + fontBase) & 0xff }; return adv
```
**0x1bb5c drawString256()**: the same as 0x1bab5, but dst = [0x1b25a] + 2 (a 256-wide buffer). A newline
adds 0x1900 (25 rows of 256) and a second CR adds 0x500 (5 rows). **drawGlyph256 (0x1bbac)** is opaque (it writes
0s too), writes `v<<2` with no base, and uses row stride 0x100.

**Scroller drivers** (all: fontBase = 0xc0, draw at [0x56072] row 0, then textOverlay 0x1c0c1):
- 0x1bddc: string = 0x1bc04 + scrollOfs. The table has 27 strings of 16 bytes ("    dies like  ", "   generations ",
  "     before    ", "", "  system slays ", "   every tiny  ", "    personal   ", "    features   ", "  in the mass  ",
  "", " ones that dont", "     fit in    ", " will be forced", "   to fit in   ", "     or get    ", "     erased    ",
  "", "system is mean ", "", "system is in us", "", "as sad as it is", "", "     we are    ", "   the system  ", "",…).
  Read them from 0x1bc04..0x1bdd4. scrollOfs advances by 0x10 each time byte[0x54e77] += 0x1e carries
  (every 256/30 ticks ≈ 0.284 s) and wraps at 0x1b0 (27 strings).
- 0x1be99 (called from 0x55367): string = 0x1be09 + scrollOfs. The strings there are 18 bytes each:
  " you are alone.. ", "    a number     ", "  alone & angry  ", "   7256106103    ", "    a number     ", blanks.
- 0x1c086 (called from 0x55513): textDst = 0x2bcf, then string = 0x1bec6 + scrollOfs. These strings are 16 bytes:
  "    system     ", " does not care ", "    system     ", "   destroys    ", …, "    system     ", " is like a CNCD", "    system     ", "dominates again", blanks.
  Read them from 0x1bec6..0x1c086.
  These two drivers sit in data gaps the listing missed: 0x1be99..0x1bec5 and 0x1c086..0x1c0bc.

## LUT / scale helpers

- 0x1c2a7: `for i<0xfa00: buf5606e[i] = LUT[buf5606e[i]]`. 0x1c2c2 does the same on [0x56072], 0x1c2f8 on
  [0x1b262] for 0x3e80 bytes, and 0x1c2dd (unreferenced) on [0x1b25e] for 0xfa00 bytes.
  LUT at 0x1c1a7 (≈ 0.83*v, a darken step), verbatim:
  `0,0,0,1,2,3,4,5,6,7,8,9,10,11,12,12,13,14,15,16,17,18,18,19,20,21,22,23,23,24,25,26,27,27,28,29,30,31,32,33,33,34,35,36,37,38,38,39,40,41,42,43,43,44,45,46,47,48,48,49,50,51,52,52,53,54,55,56,57,57,58,59,60,61,62,62,63,64,65,66,67,68,68,69,70,71,72,73,73,74,75,76,77,78,78,79,80,81,82,83,83,84,85,86,87,88,88,89,90,91,92,93,93,94,95,96,97,97,98,99,100,101,102,102,103,104,105,106,107,107,108,109,110,111,112,112,113,114,115,116,117,117,118,119,120,121,122,122,123,124,125,126,127,127,128,129,130,131,132,133,133,134,135,136,137,138,138,139,140,141,142,143,143,144,145,146,147,148,148,149,150,151,152,153,153,154,155,156,157,158,158,159,160,161,162,163,163,164,165,166,167,168,168,169,170,171,172,173,173,174,175,176,177,178,178,179,180,181,182,183,183,184,185,186,187,188,188,189,190,191,192,192,193,194,195,196,197,197,198,199,200,201,202,202,203,204,205,206,207,207,208,209,210,211,212,212`
  (no simple formula found; store it as data).
- 0x1c314 up2x(edi = dst 320 wide): `src = [0x1b262]` (160x100). For y<100, x<160:
  `v = (src[y*160+x] + upAdd) & 0xff`; write v to the 2x2 block dst[(2y)*320+2x .. +1] and dst[(2y+1)*320+2x .. +1].

## The RGB-scanline mode (0x54e0b) and what is on screen

**0x54e0b setRGBMode()** (called once, the first time 0x54ec3 runs; 0x54ec3 also sets vidNext = vidReq = 0):
```
out 3c6, 0            // PEL mask = 0 (blank)
SEQ[4] = 0x06         // chain-4 off, odd/even off -> unchained
CRTC[0x14] = 0x00     // dword mode off
CRTC[0x17] = 0xe3     // byte mode
CRTC[9] = 0x00        // out 3d4, ax=0x0009
out 3d3, ax=0x4006    // byte 0x06 -> port 0x3d3, byte 0x40 -> port 0x3d4   (!)
SEQ[2] = 0x0f; clear 0x4000 dwords at A000 (all 4 planes, 256 KB)
DAC[0..191] = 0x240 bytes from 0x54b0b (6-bit); out 3c6, 0xff
```
Palette 0x54b0b: entries 64c+k for c = 0 (R), 1 (G), 2 (B) and k = 0..63:
k < 48 gives a pure primary ramp `[0,1,2,3,4,6,7,8,10,11,12,14,15,17,18,19,21,22,23,25,26,27,29,30,31,33,34,35,37,38,40,41,42,44,45,46,48,49,50,52,53,54,56,57,59,60,61,63][k]`
in channel c, with the other two channels 0. k >= 48 holds channel c at 63 and sets the other two channels to
`[3,7,11,15,19,23,27,30,34,38,42,46,50,54,58,63][k-48]` (a tint toward white).
DAC entries 192..255 are not touched; section 2 starts with a grey ramp there (main 0x5611f), and the scroller text uses them.

**The `out 3d3` line.** On DOSBox (which mirrors the CRTC data register at the odd ports 3d1/3d3/3d5/3d7)
and on VGA cards that decode the CRTC ports incompletely, port 3d3 = CRTC data, and the selected index is still
9. **So CRTC[9] = 6: each memory line is shown for 7 scanlines.** The next byte, 0x40 to 3d4, only selects a
non-existent index. On a VGA that ignores 3d3, CRTC[9] stays 0 (400 single scanlines). The intent was probably
"400 lines". GUESS: the author mistyped 3d4 as 3d3, meaning CRTC[6] (vertical total) = 0x40, which would be broken anyway.

The recording shows exactly the 7-line case:
- Solid bands 3–4 rows tall (7 scanlines of 400 = 3.5 rows of 200), in the order R, G, B, R, …
- 57 bands fill the screen, and the colours climb smoothly down a column.
- The video signature matches decoded frames (correlation 0.7–0.85).
- No text is visible.

**What each memory line holds** (page base = pageOfs, line L = bytes pageOfs + 80L .. +79, 4 planes → 320 px):
- line 3r+0: red of video row r (palette 0..63), line 3r+1: green (64..127), line 3r+2: blue (128..191), r = 0..131
- lines 396..399: whatever was there (cleared to 0 by the mode set, never written; the next page starts 400 lines later)
- lines 340..389 (from byte 10): non-zero scroller pixels, palette 0xc0 + 4*v (v = 1..15), overwriting video lines 340..389.
  Glyphs are 25 rows tall, so the text covers lines 340..364 (+ wrap).

**What a CRT shows:**
- (a) **DOSBox / mirroring VGA (= the recording, so the port should reproduce this):**
  - Only memory lines 0..56 are visible. Each line is 7 scanlines tall, and line 57 contributes 1 scanline.
  - In 320x200 terms: output row y shows memory line floor(y*2/7), i.e. line L covers rows 3.5L..3.5L+3.5. A port
    can render 400 rows with 7 per line, then halve.
  - The picture is the top 19 video rows (≈ source rows 0..4.7 of 33, magnified) as thick red/green/blue stripes.
  - Each stripe's brightness along x follows the matching colour component of that video row.
  - The scroller text and lower 85% of the video are never visible. Port it as palette indices: line content
    → palette above.
- (b) **VGA that ignores 3d3 (the intended design):**
  - 400 single scanlines: 396 lines of R/G/B triplets.
  - Seen from a distance, the triplets blend into a full-colour 320x132 image stretched over the full height (each
    image row 3/400 of the screen, ≈ 1.5 rows of a 200-line frame), with fine visible scanline striping.
  - Bright values (k ≥ 48) whiten each line, so highlights look white.
  - The scroller words appear at 1/2 the usual text height across scanlines 340..389, shifted 40 px right, in the
    DAC 192..255 colours (grey ramp).

Note: the scene timing quoted for the RGB video is from timeline 2: 0x54e78 runs over ticks 2531..3632
(≈173.8–210.6 s), followed by 0x54f41/0x54f64 noise over ticks 3633..3739. Recording check: at ≈213–215 s the
noise grows (byte[0x53810] starts at 0x40 and drops by 200/256 per tick in 0x54f41), and "system divines" follows
at ≈216 s.

## Checked against the recording / data

- The 0x1c504 decode of avi idx 2 and 11 gives 64000 bytes each and recognisable pictures (children/COMA,
  devil sketch).
- The 0x1c34d + delta decode of streams 14/15/16 gives a coherent 209-frame video.
- The recording's frame ↔ decoded-frame match gives 14.3 fps, starting 173.9 s.
- The band geometry gives CRTC9 = 6 (above).
- Scripts: scratchpad/c2work/{rgbvid.py, match.py, match2.py, fli.py}.
