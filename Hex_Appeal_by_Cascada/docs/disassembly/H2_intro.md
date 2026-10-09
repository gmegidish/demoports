# exe2: the intro (wobbling texts, then the HEX APPEAL logo)

Source: `work/exe2.exe` (MZ, entry 0c48:14c7, SS:SP = 0000:0100, image 0x14843 bytes, no files opened).
The listing now includes the two routines the recursive descent had missed. To regenerate it, run
`hdis.py 2 0c48:8340 0c48:8302`. 0c48:8340 is the per-retrace callback, and 0c48:8302 is an unused split-screen helper.

All addresses are SEG:OFF in the image loaded at segment 0. `cs` = 0c48 (linear 0xc480). All variables live in
the code segment.

## Summary

What you see, in order (measured against recording exe2, video0016.avi, 3328 frames, one frame per retrace at 59.6 Hz):

1. The screen is black. The song starts at about recording frame 6 (a fit from the trigger times below).
2. Five purple, wobbling, two-line messages, one after another. Each one fades in, stays until the next music
   trigger, then fades out:
   "THOUGHT WE WERE / GONE FOREVER?", "IN THE SUMMER OF / 1993" (the digits use a blue ramp),
   "WE STRIKE WITH / ANOTHER PRODUCTION", "CASCADA / DEMO SECTION", "PRESENTS".
   The text is 320x32 pixels around screen row 90. Each row is shifted vertically by a sine table, so rows
   ripple up and down. Each column samples a source column chosen through a per-frame cosine warp, so text
   squeezes and stretches horizontally. Each column also gets a brightness offset: because the palette
   ramps from bright to black, adding to the colour index darkens the pixel. The "blur" is in the font itself
   (soft 16x16 glyphs). Fades are done by adding a common offset to every colour index, not by writing the DAC.
3. The screen goes black. The mode switches to unchained 320x200 with a 640-pixel-wide virtual screen. The
   "HEX" chrome picture (240x80) and an "APPEAL" sprite (232x24) slide in from the right with a decelerating
   pan and a vertical bounce, the sprite moving with twice the vertical parallax. They stay put, then slide
   out to the left on a music trigger. Then the part exits.

Video modes:
- Text phase: mode 13h (chained, linear a000:0000, 320 bytes per row). Routine 828f retimes it to 60 Hz
  (still 320x200, double-scanned).
- Logo phase: the same timing, unchained (mode X) by 82c8. The CRTC offset is 0x50 (160 bytes = 640 pixels
  per row). CRTC start and pel panning are set every retrace by the callback.

Main-loop structure (0c48:14f8 .. 1cd4):
- The loop does one iteration per "next frame-counter tick after the work is done". See Timing: in the
  recording, the text phase runs 8 iterations per 9 retraces, and the logo phase 1 per retrace.
- The callback 0c48:8340 is installed with int 80h fn 1Bh. Every retrace it sets the CRTC start and pel
  panning, and polls the music position against a trigger table. Triggers drive everything.

Routines:

| addr | name | role |
|---|---|---|
| 0c48:14c7 | `main` | init, main loop, state machine, exit |
| 0c48:1d0c | `drawAppealSprite` | erase the APPEAL sprite at its old position, latch-copy it to its new position (logo phase) |
| 0c48:1f20 | `renderWobbleText` | unrolled: builds the per-column warp by patching the drawing code, then draws 32 rows |
| 0c48:828f | `tweak60Hz` | CRTC/misc retiming of mode 13h |
| 0c48:82c8 | `unchain` | mode 13h to mode X |
| 0c48:82f2 | `setOffset` | CRTC 13h = ax>>3 |
| 0c48:8302 | `setLineCompare` | unused (CRTC 18h/7/9 line compare = ax*2) |
| 0c48:8340 | `retraceCallback` | far, called by the music system once per retrace |

## Data (all embedded in exe2's image; nothing is read from APPEAL.EXE)

| where (seg:off / linear) | size | what |
|---|---|---|
| 0010:0000 / 0x100 | 35 rows x 320 = 0x2bc0 | **text buffer** (chunky 320 wide). Rows 0..31 hold two 16-pixel text lines, initially all 0x2f. Row 33 (offset 0x2940) is the fade row, initially all 0x20. Row 34 (offset 0x2a80) is fade + per-column offset, initially all 0x20. Row 32 is unused (0x2f). |
| 02cc:0000 / 0x2cc0 | 49 glyphs x 256 = 0x3100 | **font** (Delsion): glyph g = 16x16 bytes, row-major, at 02cc:g*256. The values are palette indices: background 0x2f, letters 0x10..0x2b (purple ramp), digits 0x60..0x7f (blue ramp). |
| 02cc:3100 / 0x5dc0 | 768 | **text palette** (6-bit RGB). Indices 0..15 are black. 16..~45 are a purple ramp from bright (25,04,1d) to black. ~46..95 are black. 96..~126 are a blue-violet ramp from bright (1a,04,25) to black. 0xd9..0xfe are (0,0,1). 0xff is (3f,3f,3f). Read it from the image. |
| 060c:0000 / 0x60c0 | 240x80 = 0x4b00 | **HEX picture** (O'Hara), chunky, 240 bytes per row |
| 060c:4b00 / 0xabc0 | 768 | **logo palette** (6-bit) |
| 0aec:0000 / 0xaec0 | 232x24 = 0x15c0 | **APPEAL sprite**, chunky, 232 bytes per row, 0 = black |
| cs:0000 / 0xc480 | 256 words | `COS`: unsigned 16-bit curve. COS[0]=0x8000, falls to 0xffff at 64, back to 0x8000 at 128, 0 at 192, rising again (signed view: -32768 .. -1 .. -32768, 0 .. 32767). Used by the column warp. |
| cs:0200 | 32 words | `ROWY`: this frame's per-row y offsets (copied from YWAVE) |
| cs:0240 | 256 words, signed | `YWAVE`: row offsets in bytes, multiples of 320 (-1920..+1920, i.e. -6..+6 rows), a stepped sine |
| cs:0440 | 0x141 bytes | `LOGOY[0..320]`: 110, 109, 109, .. down to 0 (ease) |
| cs:0581 | 0x141 bytes | `LOGODX[0..320]`: 40, 40, 40, 39, .. down to 1 (step sizes) |
| cs:06c2 | 0xdc bytes | **text script** (below) |
| cs:079e | 256 bytes | `FONTIDX[ascii]` gives the glyph number |
| cs:0b59 | 320 bytes | `COLSHIFT[sx]`: per-source-column brightness offset 0..15, rebuilt every frame. Initially 0. |
| cs:14b5 | 9 x 2 bytes | **music trigger table** (below) |

FONTIDX (nonzero part): ' '→0x30 (blank glyph, all 0x2f), '!'→0x2e, '"'→0x21, '\''→0x20, ','→0x1c, '-'→0x23,
'.'→0x1d, '0'→0x2d, '1'..'9'→0x24..0x2c, ':'→0x1f, ';'→0x1e, '?'→0x2f, '@' and 'A'→0x00, 'B'..'Z'→0x01..0x19,
0x8e→0x1a, 0x99→0x1b, 0x9a→0x20. Everything else maps to 0x00.

Text script at cs:06c2. Each message is two lines of 20 characters. 0x0d starts the second line.
0x0e is followed by a little-endian word (stored in `cs:0b55` and never used; GUESS: an intended display time).
```
"  THOUGHT WE WERE   " 0d "   GONE FOREVER?    " 0e f4 01
"  IN THE SUMMER OF  " 0d "        1993        " 0e 40 01
"   WE STRIKE WITH   " 0d " ANOTHER PRODUCTION " 0e f4 01
"       CASCADA      " 0d "    DEMO  SECTION   " 0e 40 01
"      PRESENTS      " 0d "                    " 0e c8 00
```
(The script ends at offset 0xdc. Reaching it sets `LAST` = 1.)

Music trigger table at cs:14b5, as pairs (A,B). An entry fires when (order index + 1) >= A **and** (row + 1) >= B,
two independent unsigned byte compares (not a lexicographic order).
```
idx: 0      1      2     3     4      5      6     7      8
    (1,18) (2,18) (3,1) (4,1) (4,32) (4,60) (5,5) (5,52) (255,255)=never
```
In song terms these are order 0 row 17, order 1 row 17, order 2 row 0, order 3 row 0, order 3 row 31,
order 3 row 59, order 4 row 4, order 4 row 51. In rows from the song start: 17, 81, 128, 192, 223, 251, 260, 307.

## Global variables (cs:)

| addr | name | init | meaning |
|---|---|---|---|
| 0838 | rowCount | 0x20 | row loop counter in render |
| 083c | `C` (byte; 083d stays 0) | 0 | animation phase, +1 per iteration (mod 256) |
| 083e | – | 7 | +2 per iteration (byte). Loaded into di in the ROWY copy but unused (dead) |
| 0840 | prevTop | 0x7080 | previous frame's screen offset of row 0 |
| 0842 | blockOrg | 0x7080 | constant, 90*320 (never written) |
| 0844 | – | 0 | constant 0 (never written) |
| 0846 | `STATE` | 0 | 0 type, 1 fade-out / wait, 2 fade-in, 3 logo setup, 4 logo hidden, 5 slide in, 6 static, 7 slide out, 8 exit |
| 0848 | textPos | 0 | index into the script |
| 084a | textX | 0 | byte x in the buffer (+16 per glyph) |
| 084c | textY | 0 | buffer offset of the current line (0 or 0x1400) |
| 084e | `GO` | 0 | set by the callback on a text trigger, cleared when a fade-in completes |
| 0b51 | glyphSrc | 0 | glyph*256 |
| 0b53/0b54 | `FADE` (two equal bytes) | 0x20/0x20 | colour-index offset added to the text (0x20 = invisible, 0 = full) |
| 0b55 | param | 0 | word after 0x0e (unused) |
| 0b57 | `LAST` | 0 | 1 once the last message has been typed |
| 149f | – | 0 | +0x100 mod 0x400 per iteration, unused |
| 14a1 | `PANX` | 0 | CRTC x in pixels (logo phase) |
| 14a3 | `PANY` | 0 | CRTC y in lines |
| 14a5 | sprX | 0 (set to 0x16d) | APPEAL sprite x (never changes after setup: 365) |
| 14a7 | sprY | 0 (set to 0x136) | APPEAL sprite y |
| 14a9/14ab | oldX/oldY | 0/0 | position to erase |
| 14ad | `POS` | 0 | slide position 0..0x140 |
| 14b3 | trigIdx | 0 | next trigger entry |

## main (0c48:14c7)

```js
int80(0x1d);                 // toggle the retrace-synced timer off
int10(0x13);                 // mode 13h
tweak60Hz();                 // 828f
int80(0x1d);                 // toggle it on again
outDAC(0, textPalette /*02cc:3100*/, 768);   // 3c8=0, 768 bytes to 3c9, no retrace wait
int80(0x1b, ax=0x8340, cx=cs);               // install retraceCallback
for (;;) {                                   // 14f8
  const t = int80(0x19); while (int80(0x19) === t) {}   // wait for the next tick
  int80(0x1a);                                          // reset the frame counter (no other effect)
  if (STATE >= 4) drawAppealSprite();                   // 1d0c
  for (i = 0; i < 32; i++) ROWY[i] = YWAVE[(C + i) & 0xff];   // unrolled 1518..1885
  if (STATE <= 2) renderWobbleText();                    // 1f20
  if (STATE <= 2 && GO === 1) textStep();                // 189f..1a6d, below
  if (STATE === 3) logoSetup();                          // 1a7a..1bba, falls through to the C++ below
  else {
    if (STATE === 5) slideIn();                          // 1bc4
    if (STATE === 7) slideOut();                         // 1c35
  }
  C = (C + 1) & 0xff;  /* 083e += 2; 149f = (149f + 0x100) % 0x400 */
  if (STATE === 8) { code = 0; break; }
  if (inp(0x60) === 1) { code = 1; break; }              // ESC make code
}
int80(0x1c);                                // remove the callback
outpw(0x3c4, 0x0f02); memsetw(es:0, 0, 0x8000);  // clear all 4 planes / whole a000 (es = a000 here)
setOffset(0x140);                           // CRTC 13h = 0x28
out(0x3c0, 0x33); out(0x3c0, 0);            // pel panning 0 (no 3da read first; 'mov dx,3d4' is dead)
exit(code);                                 // int 21h/4Ch, al = 0 normal, 1 = ESC
```
Note: in the iteration where STATE becomes 3 (end of the last fade-out), logoSetup runs right away in the same iteration.

### textStep (state machine for STATE 0..2, only while GO == 1)

```js
if (STATE === 1) {                     // 19fa: fade OUT (offset grows)
  FADE++;                               // both bytes 0b53/0b54
  if (FADE >= 0x20) { STATE = 0; if (LAST === 1) STATE = 3; }
  fill(buf, 0x2940, FADE, 320);         // row 33 = FADE (rep stosw of the 2 equal bytes, 0xa0 words)
} else if (STATE === 2) {              // 1a37: fade IN
  FADE--;
  if (FADE === 0) { STATE = 1; GO = 0; }   // done; wait for the next trigger
  fill(buf, 0x2940, FADE, 320);
} else {                               // STATE 0: type one token per iteration (18c0)
  let b = script[textPos];
  if (b <= 0x0e) {
    textPos++; textY += 0x1400;
    if (b !== 0x0d) {                   // 0x0e: end of message
      param = word(script, textPos); textPos += 2;
      STATE = 2; textY = 0; textX = 0;
      LAST = (textPos >= 0xdc) ? 1 : 0;
      return;                           // nothing drawn this iteration
    }
    textX = 0; b = script[textPos];     // 0x0d: newline, then draw the next char in the SAME iteration
  }
  glyphSrc = FONTIDX[b] << 8; textPos++;
  for (r = 0; r < 16; r++) copy(buf, textY + textX + r*320, font, glyphSrc + r*16, 16);
  textX += 16;
}
```
Each message takes 41 typing iterations: 40 glyph draws (the 0x0d iteration also draws) plus one 0x0e
iteration. The typing is invisible because FADE is 0x20 while it happens (glyph+0x20 lands in black palette
entries). Then 32 fade-in iterations. On the next trigger: 32 fade-out iterations, then the next message is
typed. The first message has no fade-out, because FADE is already 0x20. New glyphs overwrite the old ones
(every line is exactly 20 glyphs = 320 pixels). Rows 0..31 of the buffer are never cleared otherwise.

## renderWobbleText (0c48:1f20 .. 828e)

Phase 1 is a self-modifying code generator (1f2e..7071, 320 unrolled blocks). For screen column p = 0..319, in order:
```js
k   = p < 160 ? 0xa0 - p : p - 159;           // 160..1 on the left, 1..160 on the right
bx  = ((k << 3) + 2*C) & 0x1ff;               // byte offset into COS: word index (4k + C) & 0xff
w   = COS[bx >> 1];                            // unsigned
dx  = (((M[p] * w) >>> 16) - M[p]) & 0xffff;  // mul (unsigned), sub with 16-bit wrap
h   = (dx * k) >>> 16;                         // mul bp=k, take dx
sx  = p < 160 ? (0x9f - h) & 0xffff : h + 0xa0;  // neg ax; add ax,9f   or   add ax,a0
SX[p] = sx;                                    // patched into the code: disp16 of 'mov al/ah,[bx+disp]'
COLSHIFT[sx] = (w >> 8) >> 4;                  // byte cs:[sx+0b59] = high byte of w >> 4 (0..15); later p wins
// second patched disp16 = sx + 0x2a80 (absolute address in row 34)
```
h is always 0..k-1, so sx is in 0..319. Identity (sx = p) happens when w = 0xffff. M[p] is the immediate of
`mov ax,M` (also used by `sub dx,M`). It is at code offset 0x1f31 + p*0x42 + 0x12 for p < 160, and
0x4874 + (p-160)*0x40 + 0x12 for p >= 160. Values, p = 0..319, hex:
```
199a 199b 199c 199d 199e 199f 19a0 19a1 19a2 19a3 19a4 19a5 19a6 19a7 19a8 19a9
19aa 19ab 19ac 19ae 19b0 19b2 19b4 19b6 19b8 19ba 19bc 19be 19c0 19c3 19c6 19c9
19cc 19cf 19d2 19d6 19da 19de 19e2 19e6 19eb 19f0 19f5 19fa 1a00 1a06 1a0c 1a13
1a1a 1a21 1a29 1a31 1a3a 1a43 1a4c 1a56 1a60 1a6b 1a77 1a83 1a90 1a9e 1aac 1abb
1acb 1adc 1aee 1b00 1b13 1b27 1b3c 1b53 1b6b 1b84 1b9e 1bba 1bd7 1bf6 1c16 1c38
1c5c 1c82 1caa 1cd4 1d00 1d2e 1d5f 1d92 1dc8 1e01 1e3d 1e7c 1ebe 1f04 1f4e 1f9b
1fec 2042 209c 20fb 215f 21c8 2237 22ac 2327 23a8 2430 24bf 2556 25f5 269c 274c
2805 28c8 2995 2a6d 2b50 2c3f 2d3b 2e44 2f5b 3081 31b6 32fb 3452 35bb 3737 38c7
3a6c 3c27 3df9 3fe4 41e8 4408 4644 489e 4b18 4db3 5072 5356 5660 5993 5cf2 607e
643a 6828 6c4b 70a6 753b 7a0e 7f22 847b 8a1c 9008 9644 9cd4 a3bd ab03 b2ab baba
c336 ba4a b1d6 a9d4 a23e 9b0e 943f 8dcc 87b0 81e6 7c6a 7738 724c 6da2 6937 6508
6111 5d50 59c1 5662 5330 502a 4d4c 4a95 4802 4592 4343 4113 3f01 3d0a 3b2e 396b
37c0 362b 34ac 3341 31e9 30a3 2f6e 2e49 2d34 2c2d 2b34 2a48 2969 2895 27cd 270f
265b 25b1 2510 2477 23e6 235d 22db 2260 21eb 217c 2113 20b0 2052 1ff9 1fa5 1f55
1f09 1ec1 1e7d 1e3d 1e00 1dc6 1d8f 1d5b 1d2a 1cfb 1ccf 1ca5 1c7d 1c58 1c34 1c12
1bf2 1bd4 1bb7 1b9c 1b82 1b6a 1b53 1b3d 1b28 1b14 1b02 1af0 1adf 1acf 1ac0 1ab2
1aa5 1a98 1a8c 1a81 1a76 1a6c 1a62 1a59 1a50 1a48 1a40 1a39 1a32 1a2b 1a25 1a1f
1a19 1a14 1a0f 1a0a 1a06 1a02 19fe 19fa 19f6 19f3 19f0 19ed 19ea 19e7 19e4 19e2
19e0 19de 19dc 19da 19d8 19d6 19d4 19d2 19d0 19cf 19ce 19cd 19cc 19cb 19ca 19c9
19c8 19c7 19c6 19c5 19c4 19c3 19c2 19c1 19c0 19bf 19be 19be 19be 19be 19be 19be
```
Phase 2 (7074..7760) builds row 34 = row 33 + COLSHIFT, as 160 word adds:
`word buf[0x2a80+2j] = word buf[0x2940+2j] + word COLSHIFT[2j]`. No carry can cross bytes (FADE <= 0x20,
COLSHIFT <= 15), so per byte: `buf[0x2a80+x] = FADE_row33[x] + COLSHIFT[x]`. Row 33 holds the FADE written by the
previous iteration's textStep, so the fade shows one iteration late.

Phase 3 (7763..828e) draws the 32 rows directly into the visible a000 (mode 13h, no double buffer):
```js
let top = ROWY[0] + 0x7080;
if (top > prevTop) clear(vram, top - 320, 640);                 // moved down: clear rows top-1 and top
else               clear(vram, ROWY[31] + 0x7080 + 0x2800, 640); // moved up or same: clear the 2 rows below row 31's slot
prevTop = top;                                                  // (unsigned compare, jbe)
for (r = 0; r < 32; r++) {
  const d = 0x7080 + r*320 + ROWY[r];          // bp = 0842 + 0844 (= 0x7080), + r*0x140; di = bp + ROWY[r]
  for (p = 0; p < 320; p++)
    vram[d + p] = (buf[r*320 + SX[p]] + buf[0x2a80 + SX[p]]) & 0xff;
}
```
Only those 640 bytes are cleared. When neighbouring ROWY values differ, a screen row can be skipped and
keeps stale pixels from earlier frames, so the port must keep a persistent 320x200 index buffer. Visible
area: rows 84..127.

Checked: a Python model of exactly this (palette 6-bit to 8-bit) matches recorded frames 600..602, 1700 and
2300, apart from tear lines. The best-matching C at frame 600 is 21. Tearing happens because the original
draws into the displayed page while it is being scanned.

## Logo phase

### logoSetup (STATE 3, 1a7a)
```js
in(0x3da); out(0x3c0, 0x00); out(0x3c0, 0x00);   // attribute index 0 without PAS: display off (also writes 0 to attr palette reg 0)
unchain();                                         // 82c8
setOffset(0x280);                                  // CRTC 13h = 0x50: 160 bytes per row
outpw(0x3c4, 0x0f02); clear a000:0000, 0x8000 words (all four planes, 64 KB each)
in(0x3da); out(0x3c0, 0x20); out(0x3c0, 0x20);    // PAS on: display on. Also writes 0x20 to attr palette reg 0;
                                                   // no visible effect in the recording (256-colour mode)
outDAC(0, logoPalette /*060c:4b00*/, 768);
// HEX picture: plane p (map mask 1<<p) gets bytes p, p+4, p+8, .. of the 240x80 chunky picture,
// 60 bytes per row, dest start 0x131a, row stride 160 (add di,0x64 after 60).
//   => VRAM pixel (x = 360 + col, y = 30 + row) = pic[row][col]   (0x131a = 30*160 + 90)
STATE = 4;
// APPEAL sprite: 4 pre-shifted copies, packed 59 bytes (0x3b) per row, 24 rows (0x588 bytes each),
// at VRAM 0xe678 + s*0x588, s = 0..3 (all of it past visible row 368).
//   copy s: source pixel (row, j) -> plane (j+s)&3, byte 0xe678 + s*0x588 + row*59 + ((j+s)>>2)
// (Loop: al = 0x11 rotated left once per plane, 'adc di,0' advances di when the mask wraps; one extra rol per copy.)
// Bytes not written stay 0.
PANY = 0x6e; sprX = 0x16d; sprY = 0x136; POS = 0;   // PANX stays 0
```
In state 4 the window (x 0..319, y 110..309) is empty, so the screen is black. drawAppealSprite still runs:
it erases at (0,0) and draws at (365,310), both off screen.

### drawAppealSprite (1d0c), each iteration while STATE >= 4
```js
outpw(0x3ce, 0x4005);  // write mode 0
outpw(0x3c4, 0x0f02);
for (r = 0; r < 24; r++) fill(vramAllPlanes, (oldX>>2) + oldY*160 + r*160, 0, 59);   // 0x3b bytes, then di += 0x65
outpw(0x3ce, 0x4105);  // write mode 1: latch copy, 4 planes per byte
src = 0xe678 + [0, 0x588, 0xb10, 0x1098][sprX & 3];
for (r = 0; r < 24; r++) copyLatched((sprX>>2) + sprY*160 + r*160, src + r*59, 59);
outpw(0x3ce, 0x4005);
```
Result: the sprite pixel (row, j) lands at VRAM (365 + j, sprY + row), byte-granular erase of 236 pixels.

### slideIn (STATE 5, 1bc4) / slideOut (STATE 7, 1c35)
```js
// slideIn
bx = POS; step = LOGODX[bx]; POS += step; PANX += step; PANY = LOGOY[bx];
if (POS >= 0x140) { PANX = 0x140; POS = 0x140; bx = 0x140; PANY = LOGOY[0x140] /*0*/; STATE = 6; }
oldX = sprX; oldY = sprY; sprY = LOGOY[bx]*2 + 0x73;
// slideOut
bx = POS; step = LOGODX[bx]; POS -= step; PANX += step; PANY = LOGOY[bx];
if ((int16)POS <= 0) { PANX = 0x280; POS = 0; bx = 0; PANY = LOGOY[0] /*110*/; STATE = 8; }
oldX = sprX; oldY = sprY; sprY = LOGOY[bx]*2 + 0x73;
```
The slide-in takes 76 iterations: PANX = 40, 72, 98, 119, .., 319, 320. The slide-out takes 80 iterations:
PANX 321 .. 611, then 640. The picture appears at screen (360-PANX, 30-PANY). The sprite appears at
(365-PANX, PANY+115). When static (PANX=320, PANY=0), the picture is at x 40..279, y 30..109, and the
sprite at x 45..276, y 115..138. Checked: the model of the static frame equals recorded frame 2900, up to
6-to-8-bit rounding. In the slide-out PANX goes past 320, so a scanline runs off the end of its 640-pixel
row into the next one. Emulate CRTC addressing: screen (x,y) reads VRAM byte
`(start + y*160 + ((x + pan) >> 2)) & 0xffff`, plane `(x + pan) & 3`, where
`start = (PANX>>2) + PANY*160` and `pan = PANX & 3`.

## retraceCallback (0c48:8340, far, once per retrace)
```js
start = (PANX >> 2) + PANY*160;               // PANY<<5 + PANY<<7
outpw(0x3d4, 0x0d | (start & 0xff) << 8); outpw(0x3d4, 0x0c | (start >> 8) << 8);
while (inp(0x3da) & 8) {}                      // wait for the end of vertical retrace (also resets the AC flip-flop)
out(0x3c0, 0x33); out(0x3c0, (PANX & 3) * 2);  // horizontal pel panning
ord = int80(0x0a) /* order+1 */; row = int80(0x0c) /* row+1 */;
if ((ord & 0xff) >= TRIG[trigIdx].A && (row & 0xff) >= TRIG[trigIdx].B) {
  if (STATE < 3) { trigIdx++; GO = 1; }
  else           { STATE++; trigIdx++; }
}
```
In the text phase PANX = PANY = 0, so the start is 0 and the panning is 0 (harmless in mode 13h).
Triggers 0..5 set GO. Trigger 6 fires in STATE 4 and makes it 5 (slide in). Trigger 7 fires in STATE 6 and
makes it 7 (slide out).

## Mode routines

- `tweak60Hz` 828f (cli):
  - CRTC 11h &= 0x7f (unprotect). Misc output (read 3cc) |= 0xc0, written to 3c2.
  - CRTC 06=0x0e, 07=0x3e, 09=0x41, 10=0xc5, 11=0xac, 15=0x9c, 16=0x00.
  - Result: vertical total 0x20e, display 0x18f+1 = 400 scanlines double-scanned = 200 lines, about 60 Hz.
- `unchain` 82c8:
  - CRTC 11h = 0x00 (outw 3d4,0x0011).
  - SEQ 4 &= 0xf6 (chain-4 off).
  - CRTC 14h &= 0xbf (dword mode off), CRTC 17h = 0xe3 (byte mode).
- `setOffset` 82f2: CRTC 13h = ax >> 3.
- `setLineCompare` 8302 (unused): line compare = ax*2, with bit 8 in CRTC 7 bit 4 and bit 9 in CRTC 9 bit 6.

## Timing

- Frame counter pacing: each iteration waits for the frame counter to change after its work is done, so an
  iteration takes at least one retrace.
  - Measured by fitting C to every recorded frame from 640 to 760: during the text phase C advances on 8 of
    every 9 retraces, a perfectly regular pattern (one retrace in nine has no new iteration). The heavy
    unrolled render overruns a retrace periodically in DOSBox.
  - During the logo slide it is exactly 1 iteration per retrace (76 slide-in steps over recorded frames 2753..2828).
  - Typing, fades, the wobble phase C and the slide all advance per iteration.
  - The triggers are checked per retrace.
  - To match the recording, run the text-phase iteration on 8 of 9 retraces. The logo phase runs every retrace.
- Music: trigger frames measured in the recording fit "song start ≈ frame 6, one row = 10.56 retraces
  (0.177 s)". So the rows run slower than speed 8 at 125 BPM would give (that is for the exe0 / music
  reader to explain).

Timeline (recording frame / seconds; Tn = trigger n):

| event | code condition | rows from song start | frame (s) |
|---|---|---|---|
| main loop starts, black | – | – | ≈ 67 (fit of C) |
| T0: type msg 1 (invisible) | trig (1,18) | 17 | ≈ 186 (3.1) |
| msg 1 fades in (first visible pixels) | STATE 2, FADE ≤ 0x1e | | 230 (3.86), full by ≈ 262 |
| T1: fade-out msg 1 → type msg 2 → fade in | (2,18) | 81 | ≈ 863 (14.5); black 895; visible 943 (15.8) |
| T2: msg 3 | (3,1) | 128 | ≈ 1360; black 1392; visible 1440 (24.2) |
| T3: msg 4 | (4,1) | 192 | ≈ 2037; black 2069; visible 2118 (35.5) |
| T4: msg 5 "PRESENTS" | (4,32) | 223 | ≈ 2363; black 2395; visible 2444 (41.0) |
| T5: fade-out → STATE 3 logo setup, black | (4,60) | 251 | ≈ 2658; black from 2690 (45.1) |
| T6: slide in (STATE 5), 76 steps | (5,5) | 260 | 2753 (46.2) → static at 2828 (47.4) |
| T7: slide out (STATE 7), 80 steps → STATE 8, exit | (5,52) | 307 | ≈ 3250 (54.5) → exit ≈ 3330 (recording ends 3327, 55.8) |

The gap from "fully black" to "visible again" is 48 frames: 41 typing iterations at 9/8 retraces each, plus
2 fade steps.

## Unclear / quirks

- The words after 0x0e (500, 320, 500, 320, 200) are stored but never used.
- The attribute-controller writes in logoSetup put 0 and then 0x20 into attribute palette register 0. In
  DOSBox's 256-colour mode this has no effect (the recorded background is black). Real hardware is not
  verified (GUESS: no effect).
- The 8-of-9 iteration rate is a property of DOSBox's speed, not of the code. On fast hardware the text
  phase would run 1 iteration per retrace.
- 083e, 149f and the 0b55 load at 1a52 are dead.
