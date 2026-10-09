# exe3: cubes and stars, the Cascada logo, IFS fractals and dot morphs

APPEAL.EXE part 3 (`work/exe3.exe`, image loaded at segment 0; the MZ header is 0x200 bytes, so file offset in
exe3.exe = image linear + 0x200). Segments: code `0000` (0x0000..0x83c5), data `083c` (palette and logo; its first
6 bytes are the tail of the unrolled span filler), data `180d` (DS, all variables and tables).
Addresses below are `SEG:OFF`; a bare `[x]` means `180d:x` (linear 0x180d0 + x).
Code by Hellraiser, logo by O'Hara (the "DLS" signature in the picture is Delsion's).

## Summary

What is seen (recording exe3 = video0017.avi, 4874 frames at 59.6 Hz, 81.78 s; one recorded frame = one VGA
retrace = one callback; see "Recording check"):

| frame | time  | event |
|------:|------:|-------|
| 0     | 0.00  | black (both pages were just cleared) |
| 1     | 0.02  | 64 stars (3D dots, rotating, flying away) and a row of 7 small spinning teal cubes at y~280; colours 0x40..0x5f fade in from black (stars) |
| 1..218| 0..3.66 | the cubes come nearer (z 28000 -> 6200, -100 per retrace) and rise 1 pixel per retrace |
| 219   | 3.67  | cube phase over: stars erased, the Cascada logo is copied to the top 108 rows of both pages; its fire colours 0x21..0x36 fade in from black, +1 per frame for 55 frames (they stop at 54/63, never full brightness) |
| 274   | 4.60  | IFS phase: 900 dots per frame, a weighted blend of two IFS fractals (tree, fern, two Sierpinski variants), blend weight goes 0 -> 63 -> 0 every 80 retraces; 8 half-cycles |
| 878   | 14.73 | morph phase: 400 3D dots, a blend of two 400-point shapes (the last fern turned into 3D points, a box cloud, "Cascada!" in dots, a ring, a flat ellipse, a sphere, a flat circle, a single point), rotating about the Y axis |
| 4423  | 74.21 | logo (colours 0..55) fades to black, one step every 3 retraces |
| 4873  | 81.76 | part ends (exit code 0); ESC at any time ends with exit code 1 |

Video mode: exe3 does NOT set a mode. It inherits exe2's unchained 256-colour mode (exe2 does int 10h mode 13h, then
clears SEQ 4 chain-4, CRTC 0x14 dword bit, CRTC 0x17 = 0xe3; see exe2 0c48:82ca) and only writes CRTC 9 = 0x40
(max scan line 0, so each of the 400 lines is shown once): **320x400 unchained, 80 bytes per row, 4 planes**.
Two pages: page 0 = VRAM byte offset 0x0000..0x7cff (segment a000), page 1 = 0x7d00..0xf9ff (segment a7d0).
Pixel (x,y) on a page = plane (x & 3), byte offset `page + y*80 + (x >> 2)`.

Pacing: everything state-like is advanced by the per-retrace callback `0000:0204` (installed with int 0x80 fn 0x1b).
The main loop toggles the page flag, waits for the next retrace (int 0x80 fn 0x19 polling), resets the counter
(fn 0x1a), then draws one frame. The part never asks the music for its position (no fn 0x0a / 0x0c): the whole
timeline is retrace counts.

Routines:

| addr | name | called from |
|------|------|-------------|
| 0000:0000 | `main` | entry |
| 0000:0204 | `retrace_callback` (far, per retrace) | int 0x80 timer |
| 0000:04a6 | `draw_cubes` | main (cube phase) |
| 0000:06ad | `draw_ifs` | main (IFS phase) |
| 0000:07d9 / 0865 / 08f1 / 097d | `ifs_sierpinski` / `ifs_sierpinski2` / `ifs_fern` / `ifs_tree` (one IFS iteration each; called through the pointers [2286] / [2288]) | draw_ifs, make_fern_shape |
| 0000:0a09 | `seed_rng` | main |
| 0000:0a1f | `rand_mod(cx)` | draw_ifs, make_fern_shape |
| 0000:0b09 | `draw_morph` | main (morph phase) |
| 0000:0cb5 | `make_fern_shape` (once) | draw_morph |
| 0000:0d24 | `draw_stars` | main (cube phase) |
| 0000:0deb / 0e11 / 0e37 / 0e5d / 0e83 / 0ea9 | `erase_dots(list, page, count)` (64/64/401/401/900/900) | |
| 0000:0f11 | `rotate_project` | stars, cubes, morph |
| 0000:101d | `backface_test` | draw_cubes |
| 0000:1068 | `plot` (colour = self-modified immediate at cs:1093) | stars, IFS, morph |
| 0000:10c5 / 10dd | `clear_page0` / `clear_page1` | main |
| 0000:10f5 | `set_palette` | main |
| 0000:1110 | `fade_in_fire` (colours 0x21..0x36) | main |
| 0000:1169 | `fade_in_blues` (colours 0x40..0x5f) | main |
| 0000:11b8 | `fade_out_logo` (colours 0..55) | callback |
| 0000:1206 | `draw_logo` (both pages) | main |
| 0000:1335 | `fill_polygon` (+ unrolled edge stepper 146e..1c3e and unrolled span filler 1ca2..83c5) | main, draw_cubes |

Dead code (never referenced, ignore): 0a31, 0a9d (clear rectangles on odd segments), 0ecf, 0ef0, 1095, 10ad
(clear blocks), and 8 data words at 1325.

## Main loop — 0000:0000

```
ds = 0x180d
outw(0x3d4, 0x4009)                // CRTC 9 = 0x40: 400 visible lines
seed_rng()                         // 0a09
clear_page0(); clear_page1()       // 32000 bytes each, all planes, value 0
set_palette()                      // DAC 0.. from 083c:0007, 0x2ff bytes (colour 255's blue is not written)
fade_in_fire()                     // first call: DAC 0x21..0x36 := 0
install callback 0000:0204          // int 0x80 bx=0x1b ax=0x204 cx=cs
loop:                                                          // 0025
  f37 = (f37 + 1) & 1                                          // byte [f37], init 0 -> 1 on the first pass
  c = frames(); do a = frames() while a <= c                   // fn 0x19; waits for the next retrace
  [f2c] = a - 1 (unused); reset frame counter (fn 0x1a)
  fade_in_blues()                                              // 1169
  if [1157] != 1:                                              // ---- cube phase
     if f37 == 0: f34 = 0;      f32 = 0xa000; erase_dots(listA=[ec], page0, 64)    // 0deb
     else:        f34 = 0x7d00; f32 = 0xa7d0; erase_dots(listB=[7f4], page1, 64)  // 0e11
     polygon [1184] = { count 4, colour 0,
        (0,[1bcc]), (0x13f,[1bcc]), (0x13f,[1bce]+20), (0,[1bce]+20) }   // clear band, see fill_polygon
     fill_polygon(); draw_stars(); draw_cubes()
  if [1158] != 0:                                              // ---- logo phase (stays on during IFS)
     [f02..f12] (9 words) = 0; [f1e] = 300; [6] = 0; [8] = 1000; [a] = 0; [1f1a] = 0
     if [1158] != 2:                                           // first time only
        [1158] = 2
        erase_dots(listA, page0, 64); erase_dots(listB, page1, 64)
        zero 0x708 words at [ec] (both dot lists)
        draw_logo()
     fade_in_fire()
  if [1159] != 0:                                              // ---- IFS phase
     al = imm8 at cs:0196 (initial 0x64)                        // `mov al,0x64` at 0195
     if imm8 != 0x50: imm8 -= 1                                 // self-modifying: next frame uses one less
     cs:[1093] = al                                             // plot colour: 0x64,0x63,...,0x51,0x50,0x50,...
     draw_ifs()
  if [115b] == 8:                                              // ---- morph phase
     [1158] = 0; [1159] = 0
     [0] = [6]; [2] = [8]; [4] = [a]
     draw_morph()
  bp = 0
  if [f00] == 1: goto quit                                      // end flag, set by the callback
  word 0040:001c = word 0040:001a                               // flush the BIOS keyboard buffer
  bp = 1
  if inb(0x60) != 1: goto loop                                  // ESC scancode
quit:
  remove callback (fn 0x1c); exit(bp)                           // int 21h 4Ch: 0 = normal, 1 = ESC
```

Notes:
- The page flag f37 is toggled *before* the wait, and the callback shows page `f37` (start 0x7d00 if f37 == 1,
  else 0). So **the page being drawn is the page on screen** (the other page is the previous frame and is not
  shown). For the port: after each main-loop iteration, present the page just drawn.
- In the same iteration where draw_cubes ends the cube phase ([1157] = [1158] = 1), the logo block runs too.
- During the IFS phase the logo block still runs every frame (it resets [6],[8],[a] and calls fade_in_fire, which
  does nothing more after its end).
- In the iteration where [115b] becomes 8 the IFS is drawn and then the morph is drawn on the same page.

## The retrace callback — 0000:0204 (far, saves all registers)

```
cb():
  ds = 0x180d
  start = (f37 == 1) ? 0x7d00 : 0x0000
  outw(0x3d4, 0x0c | (start & 0xff00)); outw(0x3d4, 0x0d | (start << 8))     // CRTC start high, low
  if [1157] != 1:                                             // cube phase motion
     [c] += 1; [e] += 2; [10] += 1                            // star angles
     each: if (unsigned) v >= 2000 (0x7d0): v -= 1999 (0x7cf)
     [f20] += -35                                             // star z motion, consumed by draw_stars
     cs:[04a4] += 1                                           // cube screen-y offset (initial -81)
     [f22] += -100                                            // cube z motion, consumed by draw_cubes
  if [1159] != 0:                                             // IFS blend weight, every 2nd retrace
     [115a] ^= 1
     if [115a] == 0:
        [f28] = W41[[1f24]]                                   // W41 = byte table [1f2d], 41 entries
        if [1f24] == 21:
           [115b] += 1
           next_ifs_pair()                                    // see below
           goto inc                                           // (does not test 40)
        if [1f24] == 40:
           next_ifs_pair()
           [1f24] = 0; [f28] = W41[0]
     inc: [1f24] += 1                                         // byte
  if [115b] == 8:                                             // morph timeline
     [6] += 0; [8] += 6; [a] += 0; each wraps: if v >= 2000: v -= 1999
     [f2a] = W756[[82d4]]                                     // W756 = byte table [1f56], 756 entries
     if [82d4] == 392 (0x188):
        A = next_shape()                                      // patches the source displacement of shape A
     if [82d4] >= 755 (0x2f3):
        B = next_shape(); if the loaded value was 0: [f00] = 1
        [82d4] = 0; [f2a] = W756[0]
     [82d4] += 1
  if (signed) [82d6] >= 20:  [14] = 1; fade_out_logo()
  if [14] == 1: [12] += 1; if [12] >= 450 (0x1c2): [f00] = 1   // end of part
  retf
```

`next_ifs_pair()`: `[2286] = PAIRS[[1f25]]; [1f25] += 2; [2288] = PAIRS[[1f25]]; [1f25] += 2;`
if `[2286] == 0`: `[1f25] = 0` and load again (same four steps). PAIRS = word table [224a].

`next_shape()`: `v = SHAPES[[82d6]]; [82d6] += 2; if v == 0 { [82d6] = 0; v = SHAPES[0]; [82d6] = 2 }`; the value
is written into the code: for A into the displacements at cs:0b7e, 0b8f, 0ba0 (the `mov ax,[si+disp]` that read
x, y, z of shape A, initially 0x2c02); for B into cs:0b85, 0b96, 0ba7 (initially 0x518e). For B the "was 0" test
sets [f00] = 1 (never reached in practice, see timeline). SHAPES = word table [228a].

## Video helpers

### plot — 0000:1068
In: [f2e] = x, [f30] = y, [f32] = page segment (0xa000 or 0xa7d0), colour = immediate byte at cs:1093
(self-modified; initial 2). Out: di.
```
di = ((x >>> 2) + y*16 + y*64) & 0xffff        // x shifted unsigned; 16-bit wrap, no clipping
outw(0x3c4, 0x02 | ((1 << (x & 3)) << 8))      // map mask
write byte colour at segment f32 : di
```
There is no clipping here; callers clip (stars, IFS y) or not (morph). Model VRAM as 4 planes x 64 KB; with
segment a7d0 the address is 0x7d00 + di (anything >= 0x10000 would be outside the a000 window: dropped, GUESS; it
does not happen in the recording).

### erase_dots — 0deb, 0e11, 0e37, 0e5d, 0e83, 0ea9
Map mask 0x0f (all planes); for i in 0..count-1: write 0 at `page_segment : list[i]`, i.e. erase the whole 4-pixel
group. 0deb: list A [ec], page a000, 64. 0e11: list B [7f4], page a7d0, 64. 0e37: A, a000, 401. 0e5d: B, a7d0,
401. 0e83: A, a000, 900. 0ea9: B, a7d0, 900. Lists are word arrays of di values: list A at [ec] is for page 0,
list B at [7f4] for page 1, 900 words each ([ec] + 0x708 = [7f4], [7f4] + 0x708 = [efc]). Initial content of the
lists: every word is 42 (0x002a), so the first erases clear the 4-pixel group at byte 42 of row 0 (harmless).
Each draw routine stores the di of every dot it plots at `list[efc/2]` (list A if f37 == 0, B if f37 == 1) and
`[efc] += 2`; [efc] = 0 at the start of each draw. Entries beyond the count of this frame keep old values (they
are erased again, harmless).

### clear_page0 / clear_page1 — 10c5 / 10dd
Map mask 0x0f, 0x3e80 words of 0 at a000:0000 / a7d0:0000.

### draw_logo — 1206
For both pages (a000 then a7d0), for plane p = 0..3 (map mask 1,2,4,8):
`for di = 8 .. 0x21bf: page[di] (plane p) = byte 083c:(0x31b + p + 4*(di - 8))`.
That is: the logo is a raw linear 8-bit picture of 34528 bytes at `083c:031b` (linear 0x86db, exe3.exe file
offset 0x88db), 320 pixels per row, placed so that picture byte i lands at screen pixel `32 + i` in raster order
(x = (32+i) % 320, y = (32+i) / 320): rows 0..107 are fully covered except row 0 x 0..31; row 107 ends at x 319.
(The picture's own first 32 bytes are black, so this is the same as a 320x108 picture shifted by 32 pixels; it
renders correctly, checked against the recording.) No compression. Colours used: 0, 5..13, 15..24, 27, 33..45,
53, 54.

### set_palette — 10f5
`outb(0x3c8, 0); outsb 0x3c9 x 0x2ff from 083c:0007` (6-bit values; colour 255 gets only R, G).
The palette data is `083c:0007` (linear 0x83c7), 768 bytes. Some values: 0 = (0,0,0); 1..14 teal ramp
(0,30,37) .. (0,1,2); 0x21..0x36 fire: (63,63,63) (56,55,44) (49,48,29) (42,41,17) (36,34,7) (36,27,7) (36,21,7)
(36,15,7) (36,9,7) (29,7,5) (23,5,4) (17,4,3) (11,2,1) (5,1,0) (0,0,0) (0,0,24) (7,0,25) (16,1,27) (26,1,29)
(30,3,25) (32,4,19) (34,5,12); 0x3f = (0,0,0); 0x40 = (63,63,63) then a white-to-teal ramp down to
0x66 = (0,7,9). Read it from the image.

### fade_in_fire — 1110
```
[113f] += 1                                  // byte, initial 0
if [113f] == 0x38: [113f] -= 1; [1158] = 2; [1159] = 1; return      // starts the IFS phase
outb(0x3c8, 0x21); outsb 0x3c9 x 66 from [fbf]        // buffer, initial all 0
for i in 0..65: t = [fbf+i] + 1; if t <= PAL[0x21*3 + i] (byte 083c:006a+i): [fbf+i] = t
```
Called once at start and then once per main-loop iteration while [1158] != 0. Call n (n = 1..55) outputs
`min(n-1, target)`; the 56th call starts the IFS without outputting. So **DAC 0x21..0x36 end at min(target, 54)**
(white fire is (54,54,54); verified in the recording: max 219/255 = 54/63).

### fade_in_blues — 1169
Same scheme: counter [1142] (initial 0) up to 0xa4 (stop when it reaches 0xa4, after 163 outputs); outputs 0x60
bytes from buffer [107f] (initial 0) to DAC 0x40.., then steps each byte +1 toward **083c:00c4 + i** — that is
palette colour 0x3f onwards, one colour lower than the DAC index: DAC 0x40+k fades to PAL[0x3f+k] for k = 0..31.
(DAC 0x40 ends black, 0x41 white, ..., 0x5f = PAL[0x5e].) Called every main-loop iteration from the first one.
DAC 0x60.. keep the original palette.

### fade_out_logo — 11b8 (called by the callback)
```
[1141] += 1; if [1141] != 3: return
[1141] -= 3
if [1140] == 0xfa: return
[1140] += 1
for i in 0..0xa7: if PALDATA[i] != 0: PALDATA[i] -= 1      // in place, 083c:0007.. (colours 0..55)
outb(0x3c8,0); outsb 0x3c9 x 0xa8 from 083c:0007
```
One step every 3 retraces. It decrements the ORIGINAL palette values, so on the first steps the fire colours
0x21..0x36 jump from their capped 54 back up to (63-1), (63-2)... before going down (quirk). Colours 56..255 (all
dot colours of the morph) are not touched: the morph keeps running on a black screen without the logo.

## Random numbers — 0a09, 0a1f

```
seed_rng():  int 21h ah=2Ch (DOS time) -> ch hour, cl min, dh sec, dl 1/100 s
             dl = dl ^ dh ^ ch ^ cl; dl |= 1; dx &= 0x00fd
             [115e] = dx                               // one of 64 odd values 1..0xfd (bit 1 clear)
rand_mod(cx): [115e] = ([115e] * [115c]) & 0xffff      // [115c] = 5421 (0x152d); multiplicative LCG
             return [115e] % cx                         // unsigned; cx is always 99 (0x63) here
```
The seed comes from the clock, so the original is not reproducible; the port can use any value from the set,
e.g. 1 (GUESS). It only changes which random IFS map is picked per point.

## rotate_project — 0f11

In: [f02], [f08], [f0e] = x, y, z (int16); angles [0], [2], [4] (0..1999); translation [f18], [f1a], [f1c];
perspective [f1e]. Out: [f14] = screen x, [f16] = screen y, [f12] = rotated z + [f1c] (used for colour).
Tables: SIN = 2000 int16 at [82e0] (≈ round(32767 sin(2πi/2000)), up to ±3 off), COS = 2000 int16 at [9280]
(cosine, but **COS[0] = -32768**, an overflow of 32768 — every "angle 0" is a 180° turn). Read both from the
image (linear 0x203b0 and 0x21350).

`m(a, t)` = high word of the signed 32-bit product `int16(2*a) * t` (i.e. `floor(int16(2a)*t / 65536)`; `2*a`
wraps to 16 bits).
```
c = COS[[0]]; s = SIN[[0]]                     // around Z
  [f04] = m(x, c) - m(y, s)
  [f0a] = m(y, c) + m(x, s)
c = COS[[2]]; s = SIN[[2]]                     // around Y
  [f10] = m(z, c)     - m([f04], s)
  [f06] = m([f04], c) + m(z, s)
c = COS[[4]]; s = SIN[[4]]                     // around X
  [f12] = m([f10], c) - m([f0a], s)
  [f0c] = m([f0a], c) + m([f10], s)
[f06] += [f18]; [f0c] += [f1a]; [f12] += [f1c]           // all 16-bit
h = [f1e] >>> 1
[f14] = idiv(imul([f06], h), [f12] + h) + 160          // signed 32/16, quotient truncated toward 0
[f16] = idiv(imul([f0c], [f1e]), [f12] + [f1e]) + 200
```
(x uses half the perspective distance of y: the 2:1 pixel aspect of 320x400.) [f1e] = 300 throughout.

## Cube phase

### draw_stars — 0d24
```
[0] = [c]; [2] = [e]; [4] = [10]                    // star angles (callback: +1, +2, +1 per retrace)
[f18] = 0; [f1a] = 0; [f1c] = 0xa5a (2650)
[efc] = 0
for i in 0..63:                                    // STARS = 64 x (x,y,z) int16 at [5d48] (linear 0x1de18)
   x, y = STARS[i].x, .y
   z = STARS[i].z + [f20]                           // [f20] accumulated by the callback (-35 per retrace)
   if (signed) z >= 1800 (0x708): z -= 3600
   else if (signed) z <= -1800 (0xf8f8): z += 3600
   STARS[i].z = z                                   // stored back
   rotate_project(x, y, z)
   if (unsigned) [f14] > 319 or (unsigned) [f16] > 399: continue
   cs:[1093] = ((([f12] - [f1c] + 500) & 0xffff) >>> 7) + 0x4c   (low byte)
   plot([f14], [f16]); store di in the dot list of this page
[f20] = 0
```

### draw_cubes — 04a6
Data: 7 cubes. Per cube i (k = 3i):
- spin increments `INC[k..k+2]` = words [18]: 8,6,11 / 8,4,8 / 5,5,10 / 11,5,6 / 6,7,8 / 9,12,4 / 8,8,8
- current angles `ANG[k..k+2]` = words [42], initial 21,15,5 / 15,38,10 / 10,33,0 / 0,0,15 / 8,10,13 / 8,22,12 / 11,20,35
- position `POS[k..k+2]` = words [6c]: x = -5100, -3668, -2135, -500, 977, 2720, 4508; y = 0; z = 28000
- 8 vertices `VERT` at [f38]: (-500,500,500) (-500,500,-500) (500,500,-500) (500,500,500) (-500,-500,500)
  (-500,-500,-500) (500,-500,-500) (500,-500,500)
- 6 faces `FACE` at [f98] (4 vertex indices each): 0 1 2 3 / 4 7 6 5 / 3 2 6 7 / 1 0 4 5 / 0 3 7 4 / 2 1 5 6
- face colours `FCOL[1..42]` = bytes [97..c0]: 6 7 8 5 9 10 / 10 9 8 7 6 5 / 11 8 7 10 9 6 / 6 7 9 8 10 11 /
  10 6 9 7 8 11 / 8 7 9 10 11 6 / 6 7 8 9 10 11 (palette 5..11 = teal shades)

```
[f1e] = 300
for i in 0..6:                                   // z of every cube
   z = POS[3i+2] + [f22]
   if (unsigned) z <= 6200 (0x1838): z += [f22]; [1157] = 1; [1158] = 1    // phase end (z is lowered twice)
   POS[3i+2] = z
[f22] = 0
face_no = 0                                       // [fbe]
for i in 0..6:
   for a in 0..2:
      v = INC[3i+a] + ANG[3i+a]; if (unsigned) v >= 1999 (0x7cf): v -= 1999     // note: 1999 here, 2000 elsewhere
      ANG[3i+a] = v; angle[a] (= [0],[2],[4]) = v
   [f18], [f1a], [f1c] = POS[3i], POS[3i+1], POS[3i+2]
   for v in 0..7: rotate_project(VERT[v]); SX[v] = [f14]; SY[v] = [f16]       // words at [f68 + 4v]
   for f in 0..5:
      P0..P3 = FACE[f][0..3]
      face_no += 1
      ax = SX[P0]-SX[P1]; ay = SY[P0]-SY[P1]; bx = SX[P2]-SX[P1]; by = SY[P2]-SY[P1]   (16-bit)
      if (int32)ax*by - (int32)ay*bx > 0: continue                                  // backface_test 101d
      polygon [1184] = { count 4, colour FCOL[face_no],
         (SX[P0], SY[P0] - Y0), (SX[P1], SY[P1] - Y0), (SX[P2], SY[P2] - Y0), (SX[P3], SY[P3] - Y0) }
         where Y0 = word cs:[04a4] (initial -81, +1 per retrace in the callback)
      fill_polygon()
```
The cubes are drawn after the stars (they cover them). Each frame first clears a full-width band with a colour-0
polygon from rows [1bcc] to [1bce]+20 — [1bcc]/[1bce] are the min/max row of the **last polygon filled** (the last
visible face of cube 7, drawn on the other page one frame earlier); initially 0/0. Because the filler's spans are
right-exclusive, the band never clears column 319.

### fill_polygon — 1335 (with the unrolled code 146e..1c3e and 1ca2..83c5)
In: [1184] = byte n (points), byte colour; then n points (x, y) as int16. Page offset [f34] (0 or 0x7d00).
Tables: LEFT = 400 words at [1586], RIGHT = 400 words at [18a6] (indexed by row). Masks: LM = bytes [1bd2]
(= 15,14,12,8 repeating, 320 entries), RM = bytes [1d12] (= 0,1,3,7 repeating, 320 entries; RM[320..] reads
into the next table: [1e52] = 100, ...).
```
clampx(v) = v < 0 ? 0 : v >= 320 ? 319 : v;   clampy(v) = v < 0 ? 0 : v >= 400 ? 399 : v     // signed
x0, y0 = clamp(P[0]); ymin = ymax = y0          // [1bcc], [1bce]
for e in 0..n-1:                                 // edge P[e] -> P[(e+1) % n], both clamped
   (xa, ya) = clamp(P[e]); (xb, yb) = clamp(P[(e+1) % n])
   ymin = min(ymin, yb); ymax = max(ymax, yb)    // (unsigned compares; values are clamped)
   edge(xa, ya, xb, yb)
spans(ymin, ymax)

edge(xa, ya, xb, yb):
   if ya == yb: if xa > xb swap; LEFT[ya] = xa; RIGHT[ya] = xb; return
   if ya < yb: T = RIGHT; pre = 1                // going down -> right table
   else:       T = LEFT;  pre = 0                // going up   -> left table
   if xa > xb: swap (xa,ya) <-> (xb,yb)          // walk from the smaller x
   rows = |yb - ya| + 1; dir = sign(yb - ya)
   q = (xb - xa + 1) / rows   (unsigned div);  r = (xb - xa + 1) % rows
   frac = (r * 65536) / rows  (unsigned)         // step = q + frac/65536 (16.16)
   pos = xa << 16
   if pre: pos += step                           // 16.16 add, carry from the fraction into the integer
   for k in 0..rows-1: T[ya + dir*k] = pos >> 16 (16 bits); pos += step
```
(The code computes a rounding compare `cmp dx, bp` but the following `test` clears the carry, so it has no effect.)
```
spans(ymin, ymax):                               // GC bit mask 0xff, GC mode 0x40, SEQ index 2 selected
   for y in ymin..ymax:
      xl = LEFT[y]; xr = RIGHT[y]; base = y*80 + [f34]
      bl = xl >>> 2; br = xr >>> 2
      if bl >= br:   map mask = LM[xl] & RM[xr]; write colour at base + bl
      else:          map mask = LM[xl];  write at base + bl
                     map mask = 0x0f;    write bytes base+bl+1 .. base+br-1
                     map mask = RM[xr];  write at base + br
```
So a span covers pixels xl .. xr-1 (right end exclusive). The row step is the word [1182] = 80. The span code is
400 unrolled copies of 66 bytes; the filler jumps into it at `0x1ca2 + 66*(400 - rows)`; it ends at 83c2 with
`pop es; pop ds; popa; ret` (these 4 bytes are the first bytes of segment 083c).

## IFS phase

### The four IFS maps — 07d9, 0865, 08f1, 097d
Each function has its own persistent point (state) and coefficient tables; one call does one IFS step using the
shared random number [1180] (0..98), writes the new point to its state and to [1178] (x), [117a] (y), and returns
an x offset in bx. D = [1160] = 200.
```
ifs_step(F):
   dl = int8([1180])
   si = (dl <= T0) ? 0 : (dl <= T1) ? 1 : (dl <= T2) ? 2 : (dl <= T3) ? 3 : 4     // signed compares
   t1 = idiv(A[si]*X, D); t2 = idiv(B[si]*Y, D)                  // imul 16x16 -> 32, idiv -> 16, toward 0
   nx = t1 + t2 + E[si] + carry16(t1 + t2)                        // `add` then `adc`: the unsigned carry of
   t1 = idiv(C[si]*X, D); t2 = idiv(Dd[si]*Y, D)                  //  (t1 & 0xffff) + (t2 & 0xffff) is added
   ny = t1 + t2 + F[si] + carry16(t1 + t2)
   X = nx; Y = ny; [1178] = nx; [117a] = ny; return bx
```
The y uses the old X. (si is a map number here; the code uses si*2 as a byte offset into each word table.)
Tables (int16; tables of one function are consecutive, n words each), thresholds T (int8), state, bx:

| fn | name | A | B | C | D | E | F | T0..T3 | state (X,Y) init | bx |
|----|------|---|---|---|---|---|---|--------|-------|----|
| 07d9 | Sierpinski | 100,100,100 | 0,0,0 | 0,0,0 | 100,100,100 | 0,200,100 | 0,0,100 | 33,66,100,0 | [1168] (50,50) | 60 |
| 0865 | Sierpinski 2 | 67,67,133 | 0,0,0 | 0,0,0 | 67,67,133 | 0,200,100 | 0,0,100 | 33,66,100,0 | [116c] (0,0) | 50 |
| 08f1 | fern | 0,40,-30,170 | 0,-52,56,8 | 0,46,52,-8 | 32,44,48,170 | 0,0,0,0 | 0,40,40,40 | 2,9,16,100 | [1170] (0,0) | 140 |
| 097d | tree | 0,20,84,84 | 0,0,-84,84 | 0,0,84,-84 | 100,20,84,84 | 0,0,0,0 | 0,40,40,40 | 5,20,60,100 | [1174] (0,0) | 140 |

Table addresses: 07d9: A [1e52] (3 words each, B [1e58], C [1e5e], D [1e64], E [1e6a], F [1e70]), T [1e76];
0865: A [1e7b] (3 words each), T [1e9f]; 08f1: A [1ea4] (4 words each), T [1ed4]; 097d: A [1ed9] (4 words each),
T [1f09]. Since the random value is at most 98, map 4 (and map 3 of the 3-map functions) is never used.
(Simulated ranges, matching the recording: Sierpinski x 1..398 y 0..199; Sierpinski 2 x 0..300 y 0..284; fern
x -56..65 y 1..255; tree x -45..47 y 11..87. All y >= 0, so the unsigned blend below never misbehaves.)

### draw_ifs — 06ad
```
w = [f28]; [1f1a] = w                                  // 0..63, set by the callback
if f37: [f32] = 0xa7d0; erase_dots(B, page1, 900) else: [f32] = 0xa000; erase_dots(A, page0, 900)
[efc] = 0
repeat 900:
   [1180] = rand_mod(99)
   bx1 = call [2286];  x1 = sar([1178], 1) + bx1;  y1 = [117a]          // sar = arithmetic shift
   bx2 = call [2288];  x2 = sar([1178], 1) + bx2;  y2 = [117a]          // same random number for both
   X = (u16(x1)*w + (63 - w)*u16(x2)) / [1f1c]         // unsigned 32-bit products, unsigned div by 63
   Y = (u16(y1)*w + (63 - w)*u16(y2)) / [1f1c]
   sy = 0x163 - Y                                      // 355 - Y, 16-bit
   if (signed) sy > 400: continue
   plot(X, sy + 40); store di in this page's list      // colour = cs:[1093] set by main (0x64 -> 0x50)
```
Screen: x = x/2 + offset, y = 395 - y. Fern and tree hang from the bottom at x 112..172; Sierpinski fills
x 60..259, rows 196..395.

### IFS timeline (callback)
`W41` = bytes [1f2d]: 0 0 0 1 3 6 9 13 17 22 27 32 36 41 46 50 54 57 60 62 63 63 63 62 61 58 55 52 48 43 39 34 29
24 20 15 11 8 5 2 1. On every 2nd retrace step s = [1f24] goes 0,1,...,40, then 1..40 again (at 40 it resets to 0 and
is incremented to 1). [f28] = W41[s]: w = 63 shows fn [2286] alone, w = 0 shows fn [2288] alone.
PAIRS ([224a], pairs of words [2286],[2288]):

| # | first [2286] | second [2288] |
|---|---|---|
| initial | fern | tree |
| 0 | fern | tree |
| 1 | Sierpinski | tree |
| 2 | Sierpinski | Sierpinski 2 |
| 3 | fern | Sierpinski 2 |
| 4 | fern | tree |
| 5 | fern | tree |
| 6 | fern | Sierpinski 2 |
| 7 | Sierpinski | Sierpinski 2 |
| 8 | Sierpinski | tree |
| 9 | Sierpinski 2 | tree |
| 10 | Sierpinski 2 | fern |
| 11 | Sierpinski | fern |
| 12 | Sierpinski | tree |
| 13 | fern | tree |
| 14 | 0 (end marker -> back to pair 0) | |

A new pair is loaded at s = 21 (w = 63: the visible first function is kept) and at s = 40 (w = 1: the visible
second function is kept), so the switches are invisible. What is seen: tree -> fern -> tree -> Sierpinski ->
Sierpinski 2 -> fern -> tree -> fern -> Sierpinski 2 -> Sierpinski -> tree -> Sierpinski 2 -> fern -> Sierpinski ->
tree -> fern. At the 8th "s = 21" event (the 302nd processed callback = 604 retraces after the IFS started)
[115b] becomes 8: the morph phase starts, with [2286] = fern (pair 14 is the end marker, so pair 0 is reloaded).
The IFS points (each function's state) are never reset.

## Morph phase

### make_fern_shape — 0cb5 (first morph frame only, flag byte [82d8])
```
[82d4] = 230 (0xe6)
repeat 400:                                         // index [1f27] starts at 0
   [1180] = rand_mod(99); call [2286]              // the fern, continuing its IFS state
   x = int8([1178] & 0xff) * int8(byte [1162])     // imul byte: low byte only, [1162] = 16
   y = ([117a] * 16) & 0xffff                      // imul word [1162]
   SHAPE_A0[i] = (x - 650, 2400 - y, 0)            // into [2c02], 400 x (x,y,z) words
```
A flat fern of 400 random points (x about -1530..390, y about -1680..2400).

### draw_morph — 0b09
```
w = [f2a]; [1f1a] = w                               // 0..255 from the callback
if [82d8] != 1: [82d8] = 1; make_fern_shape()
if f37: [f32] = 0xa7d0; if [efe] < 2: erase_dots(B, page1, 900) else erase_dots(B, page1, 401)
else:   [f32] = 0xa000; same with list A on page 0
[efe] += 1                                          // the first 2 frames remove the 900 IFS dots
[f18] = 0; [f1a] = 0; [f1c] = 4500 (0x1194)          // angles [0],[2],[4] were set by main from [6],[8],[a]
for i in 0..399:                                    // blend, signed: imul, 32-bit add, idiv by [1f1e] = 255
   for c in x,y,z: OUT[i].c = idiv(A[i].c*w + (255 - w)*B[i].c, 255)     // OUT = [7974], 400 x 3 words
[efc] = 0
for i in 0..399:
   rotate_project(OUT[i])
   cs:[1093] = ((([f12] - [f1c] + 500) & 0xffff) >>> 7) + 0x4f    (low byte)
   plot([f14], [f16] + 45)                          // no clipping at all
   store di in this page's list
```
Rotation: [0] = [a] = 0 all the time, so with COS[0] = -32768 the Z and X "rotations" are flips: the effective
transform is (x, y, z) -> (-x, -y, z), then a rotation about Y by angle [8], then (y, z) -> (-y, -z); just run
rotate_project with the tables and the flips come out by themselves. [8] starts at 1000 and gains 6 per retrace (one
turn in 333 retraces); it never returns to exactly 0.
Colour: the relative depth z' = [f12] - 4500 is in about -1750..1750; z' >= -500 gives colours 0x4f..0x60 (farther =
darker), z' < -500 wraps (unsigned shift of a negative number, low byte kept) to 0x45..0x4e (near = brighter).
Recording check: no dot of the morph phase is below row 386, so no write left the page.

### Shapes and weights
400 points x (x, y, z) int16 each (2400 bytes), read from the image:

| addr | content |
|------|---------|
| [2c02] | generated: the fern (make_fern_shape), z = 0 |
| [3562] | random points on a sphere, radius ~1750 |
| [3ec6] | a ring of radius 1500 in a tilted plane (x,y,z all vary) |
| [482a] | a circle of radius 1500 in the xy plane |
| [518e] | random points in a box 3500 x 2500 x 3500 |
| [66ac] | a flat tilted ellipse (z = 0) |
| [7010] | "Cascada!" as a dot matrix, x -1860..1800, y 120..600, z = 0 |
| [22a2] | all zeros (a single point); overlaps the end of the SHAPES list |

SHAPES list ([228a]): 7010, 518e, 3ec6, 66ac, 3562, 482a, 66ac, 482a, 3ec6, 22a2, 0.
`W756` = 756 bytes at [1f56]: 255 for indices 0..206, a smooth ramp down to 0 at 370, 0 for 370..584, a smooth
ramp up to 255 at 748, 255 for 748..755. Read it from the image (linear 0x20026).

Timeline ([82d4] counts retraces; w = 255 shows A, w = 0 shows B):

| [82d4] / event | frame | A | B | seen |
|---|---|---|---|---|
| 230 (start) | 878 | fern [2c02] | box [518e] | fern turning into the box (ramp 230..369) |
| 392 | 1040 | "Cascada!" [7010] | box | box -> "Cascada!" (ramp 585..747) |
| 755 -> 0 | 1403 | "Cascada!" | box | "Cascada!" -> box |
| 392 | 1795 | ring [3ec6] | box | box -> ring |
| 755 | 2158 | ring | ellipse [66ac] | ring -> ellipse |
| 392 | 2550 | sphere [3562] | ellipse | ellipse -> sphere |
| 755 | 2913 | sphere | circle [482a] | sphere -> circle |
| 392 | 3305 | ellipse [66ac] | circle | circle -> ellipse |
| 755 | 3668 | ellipse | circle [482a] | ellipse -> circle |
| 392 | 4060 | ring [3ec6] | circle | circle -> ring |
| 755 | 4423 | ring | point [22a2] | [82d6] = 20: fade_out_logo starts, end counter starts; ring shrinks to a point |
| 392 | 4815 | (list end -> reloads "Cascada!", [82d6] = 2, fade_out_logo calls stop; w = 0 so unseen) | point | |
| [12] = 450 | 4872 (last frame 4873) | | | [f00] = 1, the main loop exits |

The A switches happen while w = 0 and the B switches while w = 255, so they are invisible.

## Variables (DS = 180d)

| addr | name | init |
|------|------|------|
| [0],[2],[4] | rotation angles used by rotate_project (Z, Y, X) | 0 |
| [6],[8],[a] | morph angles (+0, +6, +0 per retrace) | 0 (set 0,1000,0 by main) |
| [c],[e],[10] | star angles (+1,+2,+1) | 0 |
| [12] | end counter | 0 |
| [14] | end flag (counting) | 0 |
| [18],[42],[6c],[96] | cube spin, angles, positions, face colours | see draw_cubes |
| [ec],[7f4] | dot lists page 0 / page 1 (900 words each) | |
| [efc] | dot list write index (bytes) | 0 |
| [efe] | morph frame counter (erase 900 twice) | 0 |
| [f00] | quit flag | 0 |
| [f02..f16] | rotate_project in/out | |
| [f18],[f1a],[f1c] | translation | |
| [f1e] | perspective distance | 300 |
| [f20] | star z motion accumulator | 0 |
| [f22] | cube z motion accumulator | 0 |
| [f28] | IFS weight 0..63 | 0 |
| [f2a] | morph weight 0..255 | 0 |
| [f2e],[f30] | plot x, y | |
| [f32] | plot segment a000/a7d0 | a000 |
| [f34] | polygon page offset 0/7d00 | 0 |
| byte [f37] | page flag | 0 |
| [f38],[f68],[f88..fba],[f98],byte [fbc..fbe] | cube vertices, projected vertices, face scratch, faces, flags | |
| [fbf] (66 b), [107f] (96 b) | fade-in buffers | 0 |
| bytes [113f],[1140],[1141],[1142] | fade counters | 0 |
| bytes [1157],[1158],[1159],[115a],[115b] | phase flags: cubes done / logo / IFS / IFS half-rate toggle / IFS cycles | 0 |
| [115c] | LCG multiplier | 5421 |
| [115e] | LCG state | (clock) |
| [1160] | IFS divisor | 200 |
| [1162] | fern-shape scale | 16 |
| [1168..1177] | IFS states | see table |
| [1178],[117a] | IFS output | 1, 1 |
| [1180] | random 0..98 | 0 |
| [1182] | row stride | 80 |
| [1184..] | polygon (count, colour, points) | |
| [1bc6..1bd0] | filler scratch, [1bcc]/[1bce] = last polygon's min/max row | 0 |
| [1f1a],[1f1c],[1f1e] | blend weight, IFS divisor 63, morph divisor 255 | 0, 63, 255 |
| byte [1f24], [1f25] | IFS step, pair index | 0 |
| [1f27] | fern-shape index | 0 |
| [2286],[2288] | current IFS pair | 08f1, 097d |
| [82d4],[82d6], byte [82d8] | morph step, shape index, fern-shape-made flag | 0 |
| cs:[04a4] | cube y offset | -81 |
| cs:[0196] | IFS colour (self-modified immediate) | 0x64 |
| cs:[1093] | plot colour (self-modified immediate) | 2 |
| cs:0b7e/0b8f/0ba0, 0b85/0b96/0ba7 | morph shape A / B base (self-modified) | 2c02 / 518e |

## Recording check

- Frame-accurate measurements on video0017.avi (4874 frames): first stars at frame 1; cubes at rows 275..285 in
  frame 1 (computed: centre row 200 + 81 - 1 = 280, half size 500*300/28400 ≈ 5) and x ≈ 128..190 (computed
  133..184 centres); the logo appears at frame 219 (computed: (28000 - 6200)/100 = 218 callbacks); the fire
  reaches its maximum 219/255 = 54/63 at frame 273 (55 frames, one main-loop iteration per retrace); the first IFS
  dots at frame 274; the morph starts at frame 878 = 274 + 604 exactly as computed; the part's last frame is 4873
  = 878 + 525 + 4*755 + 450, as computed. The fern seen at frame 875 spans x 112..171, rows 143..392 (simulated
  fern: x 112..172, rows 140..394). The logo pixels never change after the fade-in until the fade-out (no dot
  damage).
- Every 9th recorded frame is an exact repeat of the previous one, in all three phases (e.g. 4, 13, 22, ...; 283,
  292, ...). Since the computed callback counts match the frame numbers, this is a capture/timer artifact; the
  port can ignore it (one callback and one main-loop iteration per 59.6 Hz frame).
- While the IFS/morph frames are drawn the page is on screen; the recording shows complete frames, so presenting
  the finished page each frame is faithful enough.
