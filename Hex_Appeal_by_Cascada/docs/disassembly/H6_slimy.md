# exe6: the "slimy panner" end scroller (Iceman; font and marble by O'Hara)

## Summary

What is seen: a grey marble checkerboard, wobbling like jelly, that keeps scrolling upwards. Chrome-and-gold letters with
a dark drop shadow are part of the board and scroll up with it, wobbling the same way. The text is the end text, the
credits, the greetings, and "CASCADA / DEMO / SECTION / N / EVOLUTION / 42". The part fades in from black over 64
frames. When the last text line has been written into the board, picture and music fade out together over 64 frames.
Then the program exits and the demo is over.

- **Video mode**: exe6 does not set a mode. It inherits the mode exe5 set: BIOS mode 13h (320x200, 256 colours,
  chained, A000:0000, 320 bytes per line) with exe5's 60 Hz CRTC tweak. exe6 has no CRTC writes, no page flipping
  and no retrace polling. It draws straight into A000 (so the picture can tear) and writes only the DAC (3c8/3c9).
- **Structure**: a per-retrace callback (int 0x80 fn 0x1b) runs the palette fade. Every second retrace it also
  writes one new board row (tiles plus one pixel row of text) into a circular off-screen buffer and scrolls by one row.
  It also advances 5 phase counters. The main loop copies the phases and draws the warped 320x200 view
  from the buffer into VRAM, as fast as the frame limiter lets it.
- **Timing**: everything is counted in callbacks, which run once per retrace (59.6 Hz). Nothing is synced to the music.
  The text table has 156 lines of 25 pixel rows, and one row is written every 2 callbacks. When the main text runs out
  (callback 7792), the fade-out starts. The level reaches 0 at callback 7856, and then the part exits.
  7856 / 59.6 = 131.8 s.
- **In the recording** (video0019, shared with exe5): callback 1 = video frame **4691** (78.708 s; frame n is at
  n / 59.5999 s). The first non-black frame is 4693 (fade level 2). Frame 4754 is the first fully faded-in frame.
  Fade-out: frame 12483 (level 64, see the bug below) to 12545. Frame 12546 is black, which is callback 7856, the exit.
  In general, **video frame f shows the state right after callback c = f - 4690**.
- **Checked**: I wrote a Python model of the code below (buffer, text, warp, fade, cadence), at
  `scratchpad/h6/model.py` with `cmp.py` / `cmp2.py`. Its frames match the recording **pixel for pixel (100.0 %)** at
  frames 4692-4697, 4700, 4720, 4753-4755, 4800, 6001, 8000, 10001, 12000, 12400, 12403, 12482-12484, 12500, 12530,
  12545 and 12546. The DAC 6-bit to 8-bit conversion in this DOSBox capture is `round(v*255/63)` =
  `(v*255+31)/63|0`.

### Routines

| address | name | role |
|---|---|---|
| 0000:0000 | `main` | memory, palette, initial board, install callback, main loop, exit |
| 0000:0257 | `slimyCallback` (far, retf) | per-retrace: fade, every 2nd call `writeRow` + scroll, phase increments |
| 0000:33b2 | `parseText` | converts the ASCII text into the line table at cs:2342 (run once at start) |
| 0000:3444 | `writeRow` | writes one board row (tiles, shadow text row, text row) and its mirror copy |
| 0000:39a8 | `renderWarp` | patches 320 column offsets into the unrolled loop, then draws 200 warped lines to A000 |
| 0000:4411 | `devKeys` | **dead code** (never called): arrow/Home/PgUp/End/PgDn change the amplitudes 3988/3986/3984 |
| 0000:486a, 48b1, 48f5, 48fa | `unrealSetup` & helpers | **dead code** (never called): GDT / flat-real-mode setup (exe0 already did this) |

The only code missing from the first listing was the callback, which hdis had already decoded as the fall-through
after `int 21h/4Ch`, and the two dead blocks. I regenerated `work/exe6.lst` with the extra entries
`0000:0257 0000:4411 0000:486a`. There are no jump tables and no interrupt handlers. **Self-modifying code**:
`renderWarp` patches the disp32 fields of its own unrolled inner loop (below).

## Image layout (load segment 0; one code/data segment cs = 0000)

MZ: CS:IP = 0000:0000. Image 0xdeb8 bytes. All variables are in cs.

| linear | size | contents |
|---|---|---|
| 0x0000-0x1828 | | code: main, callback (with its 768x unrolled fade) |
| 0x1829-0x1d3e | | scroll text: ASCII, each line ends with 0x00, the whole text ends with 0xff (at 0x1d3e) |
| 0x1d40 | 0x300 | `fadePal`: palette sent to the DAC by the callback. Initially all 0 |
| 0x2040 | 0x300 | `srcPal`: target palette, filled by main. Initially 0 |
| 0x2340 | w | `rowDiv` = 2: callback divider |
| 0x2342 | ... | line table built by `parseText` (initially 0). Ends at 0x2d6c (0xffff marker) |
| 0x33ae | w | `parseHdr` = 0x2342 (parser: address of the current line header) |
| 0x33b0 | w | `parseCount` = 0 (parser: number of chars in the current line) |
| 0x3342 | 53 b + 0 | charset string: `ABCDEFGHIJKLMNOPQRSTUVWXYZ` 8F 8E 99 (Å Ä Ö) `1234567890!" #$*/=?.,:-+` then 0x00 |
| 0x3378 | 53 b | advance width per char index (pixels; the pen moves width+1) |
| 0x3434 | w | `mainPtr` = 0x2342: text line being written |
| 0x3436 | w | `mainRowOff` = 0x60 (= 4 glyph rows x 24): byte offset of the glyph row to write next |
| 0x3438 | w | `shadowPtr` = 0x2342 |
| 0x343a | w | `shadowRowOff` = 0 |
| 0x343c | d | `tileRowOff` = 0: byte offset of the next tile row (0, 50, ..., 2050) |
| 0x3440 | w | `lag` = 0: frame limiter (see main loop) |
| 0x3442 | b | `tileFlip` = 0: 0 = row is A,B,A,B...; 1 = B,A,B,A... |
| 0x397e | w | `fadeState` = 1 (0 none, 1 fade in, 2 fade out) |
| 0x3980 | w | `fadeLevel` = 0 (0..64) |
| 0x3982 | w | `done` = 0 |
| 0x3984 | w | `amp1Max` = 300 (0x12c) |
| 0x3986 | w | `amp2Max` = 150 (0x96) |
| 0x3988 | w | 0: unused (only the dead devKeys touches it) |
| 0x398a / 0x398c | w | `amp1` / `amp2`: computed by renderWarp |
| 0x398e,90,92,94,96 | w | snapshot copies of the phases (made by main before each render) |
| 0x3998 | w | `phCol` = 0, +12 per callback (column wave phase) |
| 0x399a | w | `phRow` = 0, +6 per callback (line wave phase) |
| 0x399c | w | `phUnused` = 0, +2 per callback (copied to 3992 and loaded into si, but never used) |
| 0x399e | w | `phAmp1` = **1234** (0x4d2), +4 per callback |
| 0x39a0 | w | `phAmp2` = 0, +1 per callback |
| 0x39a2 | d | `scroll` = 0: byte offset of the top row of the ring (multiple of 400, < 0x1b580) |
| 0x39a6 | w | `bufSeg`: segment of the allocated buffer |
| 0x3aa1-0x4400 | | unrolled draw loop with patched disp32 fields |
| 0x446a | 0x400 | `SIN[512]`: signed words, cosine shape, SIN[0] = 32767, SIN[256] = -32767. It is close to `round(32767*cos(2*pi*i/512))`, but 142 entries differ by 1, so **read it from the image** |
| 0x4967 | 0x300 | main palette (6-bit RGB, 256 entries; entries 0..15 black, 16..47 used by the font) |
| 0x4e50 (seg 04e5) | 53 x 600 | font: 53 glyphs, each 24 wide x 25 rows, 1 byte per pixel, 0 = transparent, values 0x10..0x2f. Glyph g is at 0x4e50 + g*600. Zero padding up to 0xcb50 |
| 0xcb50 (seg 0cb5) | 0x300 | second palette. Only bytes 0x240..0x2ff (entries 0xc0..0xff, at linear 0xcd90) are used: two grey ramps |
| 0xce50 (seg 0ce5) | 2100 | marble tile A (dark): 50 x 42, row-major, values 230..242 |
| 0xd684 | 2100 | marble tile B (light): 50 x 42, values 234..246. Ends at the image end 0xdeb8 |

Nothing is read from APPEAL.EXE and nothing is compressed. Everything is raw data in the image.

### Palettes

Before fading, the DAC target is `srcPal` = the 0x4967 palette with entries 0xc0..0xff replaced by 0xcd90..0xce4f.
- 16..31: gold ramp (50,45,7) (48,40,5) (46,36,4) (44,32,2) (42,28,1) (40,24,0) (36,21,0) (32,18,0) (29,15,0) (26,13,0)
  (23,11,0) (20,9,0) (16,5,0) (13,2,0) (9,0,0) (6,0,0)
- 32..47: chrome ramp (53,53,55) (49,49,52) (46,46,49) (43,43,47) (40,40,44) (37,37,41) (34,35,39) (30,31,35) (26,27,32)
  (23,24,29) (19,21,26) (16,18,23) (13,15,19) (11,12,16) (8,9,13) (6,7,10)
- 0xc0..0xdf (grey, r=g=b; shadows are 0xc6..0xd6): 0,1,1,2,3,3,4,5,5,6,6,7,8,8,9,10,10,11,12,12,13,14,14,15,16,16,17,17,18,19,19,20
- 0xe0..0xff (grey, r=g=b; marble is 0xe6..0xf6): 0,1,3,4,6,7,9,11,12,14,15,16,18,19,21,22,24,26,27,29,30,32,33,34,36,37,39,41,42,44,45,47
- The other entries of 0x4967 (48..143, 179..191) are non-zero but never drawn.

## main (0000:0000)

```
DOS 4Ah: shrink to 0xe29 paragraphs.  DOS 48h: allocate 0x36b1 paragraphs -> bufSeg (on error: exit)
fill the buffer with zeros: 0xdac0 dwords = 0x36b00 bytes = 223488 = 2 x 280 rows x 400 bytes
parseText()                                   // bx = 0x36b1 here, but the parser does not need it (no '#' in the text)
srcPal[0..767] = img[0x4967..]; DAC[0..255] = img[0x4967..]   // full brightness, briefly (overwritten by callback 1)
srcPal[0x240..0x2ff] = img[0xcd90..]; DAC[0xc0..0xff] = same
initialBoard()                                // below
int80(0x1b, ax=0x0257, cx=cs)                 // install slimyCallback
int80(0x1a)                                   // reset frame counter
loop:
   c0 = int80(0x19); while (int80(0x19) == c0) {}        // wait at least one tick
   while (int80(0x19) <= lag) {}
   lag = int80(0x19) - 1                       // adaptive limiter: wait as long as the last render took
   int80(0x1a)                                 // reset counter
   snapshot: s90 = phRow; s8e = phCol; s92 = phUnused; s94 = phAmp1; s96 = phAmp2
   renderWarp()
   if (inb(0x60) == 1) fadeState = 2           // ESC: fade out and quit (not an abort code; this is the last part)
   if (done == 1) break
int80(0x1c); free bufSeg; int 21h/4Ch (al = left over, not meaningful)
```

**Cadence**: on a fast PC the render runs once per retrace. In the DOSBox recording, one render took between 1 and 2
retraces, so after the first frames `lag` = 1 and the screen is redrawn **every second retrace**. The snapshot is
taken right after an even-numbered callback. To match the recording: at callbacks 1..7 render after every callback;
from callback 8 on, render after every even callback (8, 10, 12, ...) and show that picture for 2 frames. Frame 4698
is torn (the top rows come from callback 8, the rest from callback 7), and a few later frames are torn too (e.g. 12402).
The port can ignore the tearing. `lag` is also set to 0 by the callback at the end of the fade-in (callback 64). That
does not change the steady 2-frame cadence.

### initialBoard (inline at 0000:0092)

The buffer is 400 bytes per row. Tiles are 50 x 42. A board row is 8 tiles: either `A B A B A B A B` ("AB") or
`B A B A ...` ("BA").

```
o = 0
for tr in 14..41: row BA, tile row tr          // 28 rows
for tr in 0..41:  row AB                        // 42
repeat 3 times: { for tr in 0..41 row BA; for tr in 0..41 row AB }   // 252
// 322 rows (0..321). Rows 280..321 = AB, tile rows 0..41, which is also what writeRow will write next.
```
`row X, tile row tr` writes `tile[tr*50 .. tr*50+49]` of the first tile, then of the second, 4 times (copied with
`rep movsw`, 25 words). The rest of the buffer stays 0, and it is never seen.

## slimyCallback (0000:0257, far, once per retrace)

```
if (fadeState != 0) {
   if (fadeState == 1) { fadeLevel++; if (fadeLevel >= 0x40) fadeState = 0 }
   if (fadeState == 2) {
      fadeLevel--;
      int80(9, ax = fadeLevel)            // exe0 fn 9: set master music volume [ef:9f56] (default 0x40)
      if (fadeLevel == 0) { fadeState = 0; done = 1 }   // ZF of the dec: int 0x80 returns with iret, so the flags come from the dec
   }
   DAC[0..255] = fadePal                   // 0x300 bytes: the palette computed in the PREVIOUS fading callback
   for i in 0..767: fadePal[i] = (srcPal[i] * (fadeLevel & 0xff)) >> 6     // mul bl; shr ax,6 (unrolled 768x)
   if (fadeLevel >= 0x40) lag = 0
}
if (--rowDiv == 0) {
   rowDiv = 2
   writeRow()
   scroll += 400; if (scroll >= 0x1b580) scroll = 0          // 0x1b580 = 280 rows
}
phAmp1 += 4; phAmp2 += 1; phRow += 6; phCol += 12; phUnused += 2      // 16-bit wrap
```

The palette lags one callback behind, which gives these quirks (all confirmed in the recording):
- Callback k of the fade-in shows level k-1. Callback 1 uploads zeros. Callback 64 uploads level 63 and computes
  level 64, but then fadeState = 0, so **the level-64 palette is never uploaded while the text scrolls**. The whole
  scroll runs at `(v*63)>>6` brightness (e.g. 55 -> 54; level 64 matches 0 % of the pixels).
- The first fade-out callback uploads that left-over level-64 palette (one slightly brighter frame, video frame 12483).
  Then 63, 62, ..., 1. Level 0 is computed but never uploaded. The screen is at level 1, which is black for every
  colour used (max value 55, and 55>>6 = 0).
- During the fade-out, the music master volume goes 63 -> 0 at the same rate.

## parseText (0000:33b2)

Builds a table of lines. Each line has a header word: low byte = x offset, high byte = number of chars. Then one word
per char: low byte = char index, high byte = advance width. The lines follow each other directly. The first header is
at 0x2342 and the table ends with 0xffff.

```
si = 0x1829; di = 0x2344; parseHdr = 0x2342; parseCount = 0
for (;;) {
   al = text[si++]
   if (al == 0xff) { word[di-2] = 0xffff; return }
   if (al == '#') { [bx] = '#'; [bx+1] = text[si++]; bx += 2; continue }   // never used: no '#' in the text
   if (al == 0) {
      sum = 0; for each of the parseCount chars: sum += width + 1       // 16-bit; a count of 0 would loop 65536x (never happens)
      header = ((400 - sum) >> 1) | (parseCount << 8)                   // centred in the 400-byte row; low byte only
      word[parseHdr] = header; parseHdr = di; di += 2; parseCount = 0
      continue
   }
   parseCount++
   idx = position of al in the charset string at 0x3342 (linear search; no bounds check)
   word[di] = idx | (width[0x3378 + idx] << 8); di += 2
}
```

Charset indices: A..Z = 0..25, Å Ä Ö = 26..28, `1`..`9` = 29..37, `0` = 38, `!` 39, `"` 40, space 41, `#` 42, `$` 43,
`*` 44, `/` 45, `=` 46, `?` 47, `.` 48, `,` 49, `:` 50, `-` 51, `+` 52. The glyph of the space (41) is empty.
Widths (0x3378, by index): 24 23 20 20 23 23 20 24 7 20 23 20 20 23 20 23 20 23 20 25 20 20 20 20 19 20 24 24 20 10 20
20 22 20 22 20 20 22 20 7 19 15 22 20 18 16 19 22 9 14 10 19 19.

Note: `writeRow` skips char words whose low byte is 0x23 (index 35 = '7'), a leftover of the '#' feature. The text
has no '7', so this never happens.

### The 156 text lines (x offset in the 400-wide buffer; the screen shows buffer columns 40..359, so centre = 200)

```
  0 ' '                  40 ' '                  80 'ORDER TO...'        120 ' '
  1 ' '                  41 'INTRO FONT'         81 ' '                  121 ' '
  2 ' '                  42 'AND CUBE LOGO'      82 'TRITON'             122 'MY MIND IS A'
  3 'SOONER THAN YOU'    43 'AND EEVI PIC'       83 'CODE BLASTERS'      123 'MESS NOW ANYWAY'
  4 'EXPECTED'           44 'BY DELSION'         84 'FUTURE CREW'        124 'SO I BETTER'
  5 'HEX APPEAL'         45 ' '                  85 'D C E'              125 'SIGN OFF...'
  6 'HAS REACHED'        46 ' '                  86 'SURPRISE!'          126 ' '
  7 'THE END'            47 'HEX APPEAL LOGO'    87 'EXTREME'            127 ' '
  8 ' '                  48 'CUBE GRAPHICS'      88 'WITAN'              128 'DON NOT MISS THE'
  9 ' '                  49 'THIS FONT'          89 'FRONTLINE'          129 'FORTHCOMING'
 10 'WE HOPE THAT YOU'   50 'AND MARBLE BY'      90 'VIBRANTS'           130 'PRODUCTIONS'
 11 'ENJOYED THIS'       51 'O HARA'             91 'IMPHOBIA'           131 'FROM CDS'
 12 'DEMO MORE THAN'     52 ' '                  92 'RENAISSANCE'        132 ' '
 13 'WE ENJOYED'         53 ' '                  93 'TWILIGHT ZONE'      133 ' '
 14 'CREATING IT...'     54 'SOUNDTRACK BY'      94 'SILENTS PC'         134 'SEE YOU LATER'
 15 ' '                  55 'ZODIAK'             95 'TRIUMWYRAT'         135 'SOMETIME'
 16 ' '                  56 ' '                  96 'MAJIC 12'           136 'SOMEPLACE'
 17 'GOSH, IS THIS'      57 ' '                  97 'E M F'              137 'WHY NOT'
 18 'WRITER SLIMY'       58 'COMPILED BY'        98 'SONIC PC'           138 ' '
 19 'OR WHAT?!?!'        59 'ROBBAN'             99 'T R B'              139 'TCC 94!'
 20 ' '                  60 ' '                 100 'IMPACT STUDIOS'     140 '...'
 21 ' '                  61 ' '                 101 'XOGRAPHY'           141 ' '
 22 'THE CREDITS:'       62 'SETUP BY JEFFE'    102 'EPICAL'             142 'CASCADA'
 23 ' '                  63 ' '                 103 'SYNERGY'            143 '011111001001'
 24 'INTRO BLUR'         64 ' '                 104 'YODEL'              144 '...'
 25 'BY ROBBAN'          65 'MUSICROUTINES'     105 'V L A'              145 ' '
 26 ' '                  66 'BY ROBBAN'         106 'ONYX'               146 ' '
 27 ' '                  67 ' '                 107 'VANGELISTEAM'       147 'CASCADA'
 28 'REALTIME IFS'       68 ' '                 108 '2000 AD'            148 'DEMO'
 29 'FRACTALS AND'       69 'SPECIAL CREDITS'   109 'AVALANCHE'          149 'SECTION'
 30 'TRANSFORMATION'     70 'TO ALEXANDRA'      110 'ACCESS DENIED'      150 'N'
 31 'AND MULTICUBE'      71 'FOR MAKING SURE'   111 'ULTRA FORCE'        151 'EVOLUTION'
 32 'EFFECTS BY'         72 'THAT JEFFE DOES'   112 'SKULL'              152 '42'
 33 'HELLRAISER'         73 'NOT FINISH'        113 ' '                  153 ' '
 34 ' '                  74 'THINGS OFF'        114 'AND ALL OUR'        154 ' '
 35 ' '                  75 ' '                 115 'OTHER FRIENDS'      155 ' '
 36 'TEXTURE CUBE'       76 ' '                 116 'AND FOES AROUND'
 37 'AND THIS SCROLL'    77 ' '                 117 'THE GLOBE!'
 38 'BY ICEMAN'          78 'GREETINGS IN'      118 'SORRY IF WE'
 39 ' '                  79 'PSEUDO RANDOM'     119 'FORGOT YOU!'
```
(The text says "TCC 94!", not "TEE 94"; "DON NOT" is in the original.) The port can build the table with this parser
from the image bytes. `scratchpad/h6/parse.py` does this and prints x offsets and widths.

## writeRow (0000:3444), every 2nd callback

`e = scroll` (32-bit). The buffer is addressed linearly with 32-bit offsets (unreal mode, ds/es = bufSeg).

```
// 1. tiles: one 400-byte row
for k in 0..3:
   first = tileFlip ? B : A; second = tileFlip ? A : B
   buf[e+100k .. +49]    = first [tileRowOff .. +49]
   buf[e+100k+50 .. +99] = second[tileRowOff .. +49]
tileRowOff += 50; if (tileRowOff == 0x834) { tileRowOff = 0; tileFlip ^= 1 }     // 42 rows per tile band

// 2. shadow pass: one glyph row of line shadowPtr, 4 px to the left, darkens the marble
drawTextRow(shadowPtr, shadowRowOff, e - 4, SHADOW)
shadowRowOff += 24
if (shadowRowOff == 600) { shadowRowOff = 0; next = shadowPtr + 2 + 2*count(shadowPtr);
                           shadowPtr = (word[next] == 0xffff) ? 0x2342 : next }      // wraps to the start

// 3. main pass: one glyph row of line mainPtr (4 glyph rows ahead of the shadow)
drawTextRow(mainPtr, mainRowOff, e, OPAQUE)
mainRowOff += 24
if (mainRowOff == 600) { mainRowOff = 0; next = mainPtr + 2 + 2*count(mainPtr);
                         if (word[next] == 0xffff) { mainPtr = 0x2342; fadeState = 2 }   // END -> fade out
                         else mainPtr = next }

// 4. mirror the finished row 280 rows further on (so the reader never has to wrap)
buf[e + 0x1b580 .. +399] = buf[e .. +399]

drawTextRow(ptr, rowOff, edi, mode):
   edi += byte[ptr]                 // x offset
   n = byte[ptr+1]; bx = ptr + 2
   repeat n times:
      while (byte[bx] == 0x23) bx += 2            // dead ('7')
      src = 0x4e50 + byte[bx]*600 + rowOff
      for i in 0..23:                              // unrolled
         v = img[src + i]
         if (v != 0) {
            a = (edi & 0xffff0000) | ((edi + i) & 0xffff)     // 'inc di' is 16-bit, see below
            if (mode == OPAQUE) buf[a] = v                     // font colours 0x10..0x2f
            else                buf[a] = (buf[a] - 0x20) & 0xff  // marble 0xe6..0xf6 -> shadow 0xc6..0xd6
         }
      edi += byte[bx+1] + 1          // advance width + 1 (from the saved 32-bit edi)
      bx += 2
```

Notes:
- Both passes draw on the freshly tiled row, the shadow first. So the letters cover their own shadow, and a shadow
  pixel always darkens a marble pixel. If two neighbouring glyphs had pixels on the same column, it would darken twice.
- On the same row, the shadow is glyph row r of a line and the text is glyph row r+4 (mainRowOff starts at 0x60). On
  screen the shadow is therefore **4 px left and 4 px lower** than the letters. The two pointers stay locked in step:
  the shadow pass is always 4 rows behind.
- 16-bit `inc di`: inside one glyph, the pixel address wraps at 64 KiB. Only the glyph that straddles buffer offset
  0x10000 (row 163, column 336) is affected. Its pixels past that point land at the start of the buffer, in row 0,
  which is never on screen at that time. One glyph row of one glyph loses a few pixels. It is harmless, but it costs
  nothing to copy (the model does).
- When the main text ends, the main pointer wraps to line 0 (which is blank). The shadow pass keeps drawing lines
  151..155 (blank at the end) during the fade-out.

## renderWarp (0000:39a8), main loop

```
amp1 = (SIN[(s94 & 0x3fe)>>1] * 300) >> 16      // imul 16x16, keep dx (signed high word): -150..149
amp2 = (SIN[(s96 & 0x3fe)>>1] * 150) >> 16      // -75..74
// column table: patched into the code as disp32 (two per 15-byte block at 0x3aa1 + 15*k, offsets +3 and +0xa)
base = scroll + 0x3ea8                          // 0x3ea8 = 16040 = 40 rows*400 + 40 columns
j = (s8e & 0x3fe) >> 1
for c in 0..319:
   colOff[c] = ((SIN[(j + c) & 511] * amp2) >> 16) * 400 + base + c     // 32-bit imul, sar 16 (floor); vertical shift -37..36 rows
// lines (es = A000, ds = bufSeg)
i = (s90 & 0x3fe) >> 1                          // si = (si & 0x3fe) + 5 each line == index + 2 (mod 512) per line
for y in 0..199:
   h = (amp1 * SIN[(i + 2*y) & 511]) >> 16      // imul 16x16 -> dx, sign-extended: horizontal shift -75..74
   for x in 0..319: VRAM[y*320 + x] = buf[colOff[x] + h + 400*y]
```
- All the shifts are arithmetic (`>> 16` of a signed product, i.e. floor). The source address is linear: a negative or
  large `h` simply reads the end of the previous row or the start of the next row (no clamping, no wrapping). The
  addresses always stay inside the buffer (min about 1165, max about 222033 < 223488).
- `scroll` is read once at the start, so the column table uses the scroll value at render time.
- Phases per callback: phCol +12 means the column wave index moves by 6 per callback (1 per column).
  phRow +6 means the line wave index moves by 3 per callback (2 per line).
  phAmp1 +4 means index +2: period 256 callbacks = 4.3 s, starting at index 617 & 511 = 105.
  phAmp2 +1 means index +1 every 2 callbacks: period 1024 callbacks = 17.2 s.
  `& 0x3fe` before indexing means an odd phase uses the even byte below it.

### Why the board stays seamless (ring buffer)

The buffer holds 2 x 280 rows. Physical row p (0..279) and p+280 always hold the same pixels (writeRow mirrors each
row; the initial board was filled continuously through row 321). The view at scroll s (in rows) reads rows
s+3 .. s+276, so it never needs a wrap. The row written at call k (scroll = k-1 at that time) is physical row
(k-1) mod 280 and its mirror. On screen it sits at y = 239 + k - s (before warping): it is drawn 40 rows below the
bottom edge, enters the screen 40 calls (80 frames) later, and moves up 1 pixel every 2 frames (29.8 px/s). It takes
400 frames to cross the screen. A port can keep the 223488-byte buffer and do exactly these copies, which is the
simplest exact method.

## Timeline (callback c; video frame = 4690 + c; T = frame / 59.5999 s in video0019)

| callback | event |
|---|---|
| 1 | callback installed. DAC set to black (the first frames of `fadePal`) |
| 2 | first writeRow (row 0 = tile row 0 AB band, text line 0 glyph row 4 / shadow row 0) |
| 3..64 | fade-in, level c-1 visible (frame 4693 = first non-black, frame 4754 = level 63) |
| 2k | writeRow call k. Main text line n, glyph row r is written at call k = 25n + r - 3 |
| 50n + 74 | top of text line n reaches the bottom edge of the screen (e.g. "SOONER THAN YOU", n = 3: callback 224 = frame 4914, 82.45 s) |
| 7792 | call 3896 writes the last row of line 155 -> fadeState = 2 (frame 12482). "EVOLUTION" and "42" are in the lower middle of the screen |
| 7793 | level-64 palette uploaded (frame 12483), music volume 63 |
| 7794..7855 | levels 63..2 (music volume 62..1 ... 0 at 7856) |
| 7856 | level 0 -> done = 1. The DAC shows level 1 = black (frame 12546). The main loop exits after its current render, and the demo ends |

ESC (port 0x60 == 1, checked once per main loop) starts the same fade-out at once, from the current level.
