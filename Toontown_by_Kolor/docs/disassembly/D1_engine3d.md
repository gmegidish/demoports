# D1: the 3D engine (parts 8 and 9) and part 9, the star in the tunnel

Port: `src/engine3d.js` (engine), `src/raster3d.js` (triangle fillers, also 0x107b7b), `src/parts/star.js` (part 9).

## Engine globals

| address | what |
|---|---|
| 0x170f1c | object array (0x52 bytes each), malloc'd by 0x10900c |
| 0x170f6c | object count |
| 0x170f44 | z-buffer, 320 x 200 signed words (0x1f400 bytes) |
| 0x128528 | z-buffer clear value (word, set by 0x10b356; 0x7d00 in both parts) |
| 0x170f20..28 | light direction, normalised to length 256 (0x10b278) |
| 0x170f2c..34 | light in the current object's frame (0x10b055) |
| 0x170f38..40 | view direction (0, 0, -256) at 0x12851c in the object's frame, for culling |
| 0x170f48..68 | rotation matrix, 9 dwords 16.16 (0x109f7c) |
| 0x170f6c..84, 0x170f78..84, 0x170f88/8c, 0x170f90/94, 0x170f98..d4 | filler scratch (edge lists, counters, edge and gradient values); kept in JS locals, every value is written before it is read in each call |

Object layout: see the comment at the top of `src/engine3d.js` (+0x00 vertices ... +0x4e second texture).
Projected vertex (24 bytes): x, y, z, shade, u, v.

## Routines

- 0x108ff4: prints "Error: %s" and exits (allocation failures; not ported).
- 0x10900c(count): z-buffer, objects, all disabled (+0x20 = 1). 0x109083 / 0x109efc: frees (no-ops).
- 0x109097(obj, flag): +0x20.
- 0x1090b2(obj, offset): object from TOONTOWN.DAT: skip 2, s16 vertex count, vertices (3 x s16), s16 face count,
  skip 1 byte, faces (3 x u16), face normals (3 x s16), vertex normals (3 x s16). The star is at 0xab89c.
- 0x109725(obj): part 8's box, 12 vertices (the four side faces have their own vertices for the texture
  coordinates), 12 faces, u/v preset in the projected array (2..253, 2..159), face normals by cross products.
- 0x109f7c(a, b, c): rotation matrix from degrees (pi taken as 3.141592), each element trunc(x * 65536).
  Five products go through float32 locals (sin a, sin a sin c, cos c sin a, -sin c); ported with Math.fround.
- 0x10a0dc: rotate + translate (32-bit imul sums, >> 16). 0x10a1b4: rotate only.
- 0x10a25b: x' = (x << 9) / z + 160, y' = 100 - (y << 9) / z (no division when z = 0).
- 0x10a2d5: trunc(sqrt(x^2 + y^2 + z^2)).
- 0x10a4d6: vertex shade = max(base, ((n . L) >> 8) * scale >> 8 + base), unrotated normals, light in object frame.
- 0x10a57d / 0x10a5e4: environment mapping u = (nx >> 1) + 128, v = 128 - (ny >> 1) from rotated / unrotated
  normals.
- 0x10a30f + 0x10a392 (face depth sort, quicksort): used only by the sorted modes 8 and 9, not ported.
- 0x10af2c(obj, mode, scale, base; stack: texture, extra): +0x48/+0x49/+0x4a/+0x4e and the draw routine
  (jump table at 0x10aefc). Modes: 1 0x10a649 (lines, 0x10b4eb/0x10b360), 2 0x10a6bd (0x10b54a),
  3 0x10a913 (0x10bfdc), 4 0x10aaa5 (0x10ccaf, env map), 5 0x10ab76 + 0x10a5e4, 6 0x10ac93 + 0x10a5e4,
  7 none, 8 0x10a7c6 (sorted, 0x10bb11), 9 0x10a9c6 (sorted, 0x10c685), **10 0x10ad4b**, **11 0x10ac24**,
  **12 0x10ae23**. Only 10 (part 9's star), 11 (part 8's box) and 12 (part 8's star) are used; the port throws
  for the others.
- 0x10b055(dst): clear z-buffer; per enabled object: matrix, 0x10a0dc, 0x10a25b, light and view in the object's
  frame (vector times transposed matrix, >> 16), call [+0x24](obj, dst).
- 0x10ac24 (mode 11): all faces, 0x10ccaf with the projected u/v.
- 0x10ad4b (mode 10) / 0x10ae23 (mode 12): rotate normals, env-map u/v, shades, then faces whose
  (face normal . view) >> 8 > 0 (unrotated face normals, view in object frame) through 0x10d497 / 0x10dd95.
- 0x10b21a(obj, x, y, z; stack a, b, c): position, angles (+0x30 = first stack argument popped, i.e. the last
  pushed). 0x10b278(x, y, z): light. 0x10b2ce(obj; stack float): vertices *= factor, truncated. 0x10b356: z clear.

## The fillers (src/raster3d.js)

0x10ccaf, 0x10d497, 0x10dd95 and part 9's 0x107b7b are one algorithm: sort by y (three compare-swaps,
a > b strictly), reject if top > 199, bottom < 0 or height 0; t = ((ymid - ytop) << 16) / h;
w = ((xtop - xmid) << 16) + t * (xbot - xtop), reject w = 0; w < 0 means the long edge is the left one ("A",
which carries u, v, z, shade; "B" carries x only). w is then clamped to <= -0x1000 or >= 0x1000. Gradients
are (((a_top - a_mid) << 16) + t * (a_bot - a_top)) * 65536 / w (48-bit dividend), u and v then >> 8, z and shade
not. Edges: 16.16 values, steps = (delta << 16) / dy; an edge list with two edges skips a flat first edge; when
an edge runs out, the next one starts without a step; a flat next edge ends the triangle.
Per span: left = xA >> 16, right = xB >> 16, u = uA >> 8, v = vA >> 8; when left < 0 only u and v are moved
(z and shade keep their edge values); texel = tex[((u >> 8) & 0xff) + (v & 0xff00)].

| filler | pixel | z | skip left > | right clamp | lines | other |
|---|---|---|---|---|---|---|
| 0x10ccaf | texel | yes | 320 | > 320 -> 320 | >= 0 | returns at the first line > 199 |
| 0x10d497 | [0x15cfb4 + texel*256 + (s>>16)] | yes | 320 | > 320 -> 319 | 0..199 | |
| 0x10dd95 | [0x12c6a4 + texel*256 + (s>>16)] | yes | 319 | > 319 -> 319 | 1..198 | |
| 0x107b7b | [0x15cfb4 + texel*256 + (s>>16)] | no | 320 | > 320 -> 320 | 0..199 | stack frame vertices |

z test: draw when the z-buffer word (signed) > z >> 16, then write z >> 16.

## Part 9 (0x1087bc, eax = 0x24)

- setPalette(0x15ccb0); 16 x 0x10871d; malloc(64000) cleared and never used (left out); 0x10900c(1),
  0x1090b2(0, 0xab89c), enable, scale 0.75, z clear 0x7d00, mode 10 with scale 0xff, base 0, texture
  [0x15cfb0] (also the tunnel's), light (0, 0, -11).
- 0x107b5c is a static initializer (Watcom XI table at 0x12ba52), not called by main: malloc(0x40) x 2 into
  [0x1706f8] / [0x1706fc], the bend histories. The port allocates them at the part's start.
- Frame: 0x10832c(scroll u = low byte of [0x1706e8], scroll v = low byte of [0x1706ec]) draws the tunnel into
  [0x12bd80]: rings k = 1..15 of radius 250 k / 16 (fistp word: round to even) around (160 + Hx[k], 100 + Hy[k]),
  16 segments j = 1..16 at angle j * float32(pi/8); quad (k, j) = triangles (v0 v1 v2), (v0 v2 v3); u = 64 j +
  scroll u, v = 64 k + scroll v, shade 12 k + 12 outside, 12 k inside. x87 detail: the angle is stored as a float32
  but the cosines of v0 and v1 take the unrounded product.
  Then the star: z = trunc(cos(swing) * 478 + 682), y = trunc(cos(5 wobble mod 360) * 40),
  x = trunc(sin(3 wobble mod 360) * 50), angles (spin, (spin + 90) mod 360, spin); 0x10b055 into [0x12bd80].
- After the copy, per retrace passed: phase [0x1706f0] += 0.07, [0x1706e8] += 5, [0x1706ec] -= 4, spin += 2,
  swing += 4, wobble += 1; then spin, swing mod 360 and **one** 0x10871d per rendered frame:
  Hx[15] = trunc((sin p + cos p / 5) * 25), Hy[15] = trunc((cos p + sin p / 5) * 25), then both arrays shift down.
  So the tunnel's bend depends on the render rate: in the recording (a frame every 4..7 retraces) consecutive
  rings are 4..7 retraces apart; the port renders every retrace, so its tunnel bends about 5 times less.
- Loop until 0x24 <= position. At the end: frees (not ported).

## Verification

- Recording: part 9 shows its palette at frame 11387 and its first picture at 11392 (in the port with
  `--part p09_1087bc` the part starts at 9962 since part 8 is still a skip). A scratch harness replayed
  `startStar` / `renderStar` / `advanceStar` on the recording's own schedule (a render at every frame where the
  recorded picture changes, the counters advanced by the frames between them, part start = frame 11388): all 299
  new pictures from 11392 to 12804 are pixel-exact (0 differing pixels); 12808 is the next part.
- Fillers 0x10ccaf / 0x10d497 / 0x10dd95 and the whole of 0x10b055: 120 random poses (modes 10, 11, 12; the box
  and the star; near, partly off-screen and culled cases) run through the original code in Unicorn on the port's
  memory: screen and z-buffer identical in every case.
