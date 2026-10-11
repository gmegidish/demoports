# D2: part 8, "Kaleidoskop" (0x1019b1)

Port: `src/parts/kaleidoscope.js` (`kaleidoskop(m, 0x1c, 0x20)`). main (0x100918) calls it with eax = 0x1c and
edx = 0x20. Recording frames ~8549..11390.

| Address | What |
|---|---|
| 0x1019b1 | the part |
| 0x101274 | static initialiser (an entry of Watcom's XI table in the unpacked image at 0x22ba4a, priority 0x40: runs before main): `[0x16e0ac]` = malloc(0x30) (three triangle corners), `[0x16e0b0]` = malloc(0x10000) (the height map). The port's main does not run it: the part allocates them when they are 0. |
| 0x101293 | kaleidoscope on the 320x200 buffer (args: eax = destination, stack: turn, mirror (floats)) |
| 0x1014be | the same into a 256-wide texture, centre 128,80 |
| 0x102442 | affine texture-mapped triangle, 320 bytes a row (eax, edx, ebx = corners, ecx = destination, stack: 256x256 texture) |
| 0x102796 | the same, 256 bytes a row, rows 0..160, columns 0..255 |
| 0x1023af / 0x10235c | left edge (x, u, v) / right edge (x) setup, from the edge lists at 0x16f3b4.. / 0x16f3c0.. (counters 0x16f3d0 / 0x16f3d4) |
| 0x1016d9 | bump map of the 320 buffer: rows 1..198, columns 1..318 (eax = light x, edx = light y) |
| 0x1017d7 | bump map of the texture: rows 1..169, columns 1..254, 256 bytes a row (eax = texture, ebx = light y, edx = light x) |
| 0x1018de | eax steps of fading 0x16f0b8 toward 0x12c39c (each component -1 while above) |
| 0x101914 | the DAC from eax (same as 0x100a1e) |
| 0x10193a | nearest colour of the palette at eax to (dl, bl, cl), first of equals |
| 0x100a79 | blit skipping 0 (eax = x, ebx = y, ecx = width, edx = rows, esi, edi) |
| 0x100bb1 | fill ecx bytes at edi with the qword at 0x100ba9 (0) |
| 0x12c6a4 | 64 KB shade table: colour * 256 + light -> colour (a PCX main copies there; also read by the engine's 0x10dd95) |

## Setup

- malloc 0x10000 (`[esp+0x4c]`, the 256-wide texture; never cleared: rows 161..170 are only ever touched by the
  bump mapping) and three 0xfa00 noise buffers A, B, C. The colours nearest to grey 0, 0x1b, 0x2b in 0x12c39c;
  each pixel `r = rand() % 3` (0x114f3f, Watcom LCG, seed at 0x129bec) gives A = grey[r], B = grey[r+1],
  C = grey[r+2] (mod 3).
- 0x16f0b8 = 0x3f (white) x 768, wait a retrace, set it. (A 320x70 copy of the "Kaleidoskop" text into a
  malloc(0x5780) block is never read; not ported.)
- `[0x16e0b4]` = malloc(0x4000): `L[y * 128 + x] = (x * y) >> 6`.
- 0x16e0b8[i] = trunc(100 - sin(i 2pi / 511) 40), 0x16e8b8[i] = trunc(160 - cos(i 2pi / 511) 80), i < 512.
  Read as light y = 0x16e0b8[t & 511], light x = 0x16e8b8[2t & 511].
- Clear `[0x12bd80]` and the VGA.

## Kaleidoscope (0x101293)

Twelve triangles k = 0..11 with corners (160,100 | u,v = 158,158), at angle turn + k pi/6 and turn + (k+1) pi/6,
380 out (`trunc(cos a * 380 + 160)`, `trunc(sin a * 380 + 100)`). Texture corners `trunc(cos m * 127.5)`,
`trunc(sin m * 127.5)` for two mirror angles m1 (first corner, starts as `mirror`) and m2 (second, starts as
`turn`), which swap after every even k: neighbours are mirror images. Each triangle is drawn twice: colour
picture `[0x12c398]` into the destination, height picture `[0x12c6a0]` into `[0x16e0b0]`.

The filler: corners sorted by y; slope = ((mid.y - top.y) << 16) / (bottom.y - top.y + 1); the span width at
the middle row w = slope (bottom.x - top.x) + ((top.x - mid.x) << 16), 0 = nothing; w < 0: the long edge is the
left one; w clamped to <= -0x10000 or >= 0x1000. du/dx = ((64-bit) du << 16) / w >> 8 (8.8), texel
`tex[((u & 0xff00) >> 8) + (v & 0xff00)]`. Rows start at top.y, an edge's count is its height (bottom row not
drawn); a row is drawn when x_left <= 0x149 (0xff) and x_right >= 0, x_right clamped to 320 (255) inclusive (the
320 version can write column 320, i.e. the next row's first pixel), x_left < 0 stepped to 0, y >= 0; the walk
returns past row 199 (160).

## Bump map (0x1016d9 / 0x1017d7)

For each pixel: `nx = max(0, 127 - |(H[p+1] - H[p-1]) - (x - lightX)|)`, `ny = max(0, 127 - |(H[p+w] - H[p-w]) -
(y - lightY)|)`, `D[p] = T[D[p] * 256 + L[nx * 128 + ny]]` (T = 0x12c6a4). In place.

## Frame loop 1 (until position 0x1c)

kaleidoscope(buffer) - blit "Kaleidoskop" (`[0x12c69c]`, 200x50) to row 150 of the **height map** - bump map -
readPlayStatus - wait - if position is the part's first: set palette 0x16f0b8 - copy rows 1..198, columns 2..317
to the screen (the border stays black) - per retrace passed: `[0x16e09c]` -= 2 while > 1 (part 6's black-out
level, unused here), turn += 0.01f, t++, mirror += 0.005f (floats) - if still the first position: fade
passed / 2 steps.

Quirk: the fade advances only with 2+ retraces per frame. On a fast machine (one retrace per frame) the palette
never leaves white, and once the position changes it is never set again: the whole part would be white. The
recording took 8 retraces a frame (4 steps). The port keeps the odd retrace for the next frame (accumulates),
which gives the recording's palettes exactly.

## The 3D object (until 0x20)

Setup (engine, src/engine3d.js): 0x10900c(1), 0x109725(0) (a box 320x200x200 with u,v 2..253 x 2..159),
0x10af2c(0, mode 11, scale 0x64 (ebx left from 0x109725), base 0, texture = the 256-wide kaleidoscope),
0x109097(0, 0), 0x10b278(0, 0, -11), 0x10b21a(0, 0,0,0x200, 0,0,0), 0x10b356(0x375).

Loop 2a (until 0x1f), degrees d from 90 (`[esp+0x6c]`):
0x10b21a(0, x = trunc(cos d * 40), y = trunc(cos d * 60), z = trunc(cos(2d mod 360) * 300 + 752), d, d, d) -
noise buffer A to the buffer (0x100bcc) - kaleidoscope into the texture (0x1014be) - bump map it (0x1017d7) -
blit "Kolor ru Kolor" (`[0x16def0]`, 320x50, ecx left from 0x1017d7) to row 150 - 0x10b055(buffer) -
readPlayStatus, wait, copy - per retrace: angles and t as before, d++, but d-- too while the position is still
0x1c and the row < 15 (the box holds still) - d > 360: d -= 360 - noise: at a new position (A,B,C) = (B,C,A) and
remember the row; whenever row > that row + 2 rotate again (so after two rows it changes every frame).

Then: 0x109efc(0), 0x1090b2(0, 0xab89c) (the star), 0x109097(0, 0), 0x10b2ce(0, 1.0f), 0x10af2c(0, mode 12,
scale 0xff, base 0, `[0x12c398]`), 0x10b278(0, 0, -11). Loop 2b (until 0x20) as 2a without the hold. The
kaleidoscope is still drawn into the texture every frame. End: 0x109efc, 0x109083, frees (including
`free(0x12c6a4)`, a static address: a bug, harmless under the port).

## Notes for the port

- The noise depends on rand's seed, which part 7 (0x108e64, 3 calls per rendered frame) advances by a
  frame-rate-dependent amount. Fitted to the recording: 807 calls (269 part-7 frames) -> seed 0x86134d60; the part
  sets that seed. Which of A/B/C is shown depends on how many frames were rendered (the port: every retrace).
- The x87 and doubles differ for the object's place at d = 135, 150, 315, 330 (z) and 300 (x, y): on a real x87
  z is one less. The recording has the doubles' values (DOSBox's FPU computes in doubles): verified at recording
  frames 10451 and 10825, which only match without the x87 correction. (Part 6's 300-degree x87 exception in
  plasma.js may have the same issue.)

## Verification (`tools/re/compare.mjs --rate 1.0085 --part p08_1019b1`)

Fresh recording frames, port frame = recording frame + shift (render latency/setup time in DOSBox):

- Loop 1, 0 differing pixels: 8565, 8573, 8581, 8677, 8773, 8866, 8898, 8962, 9048, 9102, 9139, 9227, 9303, 9319,
  9406, 9413, 9499, 9586, 9677, 9764, 9853, 9902, 9938, 9960 (shift -16 or -15; -15/-14 in a whole run).
- Loop 2a while the box holds still, 0 differing pixels including the noise: 9988..10048 every fresh frame
  (shift -18).
- Loop 2b, 0 differing pixels (shift +1..+3): 11059, 11078, 11085, 11092, 11099, 11106, 11114, and 11065, 11071,
  11122, 11145, 11184, 11256, 11300, 11344 except for the noise's rotation (the background grey of a pixel is one
  of its other two values).
- Loop 2a after the hold: the box's angle runs 17 retraces ahead of the texture's animation compared with the
  port (the hold ends at row 15 of position 0x1c, a music event, ~17 retraces earlier relative to the frame
  counter than the port's music clock puts it), so no port frame has both. With the angle moved by 17 (a test
  hack), 10092, 10107, 10257, 10272, 10286, 10451, 10466, 10614, 10630, 10644, 10703, 10810, 10825, 10972, 10988,
  11002 match except for the noise's rotation.
- 9978 (the first box frame) has no port equivalent: the switch at position 0x1c happens at a different render
  latency.
