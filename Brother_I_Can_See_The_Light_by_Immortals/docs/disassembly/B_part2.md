# Slice B, part 2: loader 0x12b34 and part 0x12cc2 ("kaleidoscope" + flares)

Part 2 is the second part in main's order. It runs from music **position 6 row 0** to the first
frame that sees **position 10**: 38.4 s to 64.0 s in song time. It has two phases:

| phase | runs while | song time (nominal) | what is drawn |
|---|---|---|---|
| A | `position <= 7` | pos 6 r0 .. pos 8 r0 (38.4 s .. 51.2 s) | a 41x26 grid of 8x8-pixel cells, texture `2d3.gif`, u/v from a polar formula driven by music time: swirls, a radial kaleidoscope, and a mosaic once every 3.2 s |
| B | `position <= 9` | pos 8 r0 .. pos 10 r0 (51.2 s .. 64.0 s) | the same grid, plus 30 additive "flare" sprites (`sflare.gif` scaled to 36x36) moving on 30 random 2D splines |

Each phase begins with a 1-second fade from white. The first frame of each phase is **black**
because of a DAC wrap (see 0x10fb8). The song runs at speed 2 and BPM 100 for its whole length:
one row is 0.05 s, one 128-row pattern is 6.4 s, and none of positions 0..10 has an Fxx, Bxx or Dxx
effect. I checked this by parsing BICSTL.XM.

The note covers every function part 2 calls in 0x10000..0x18000 except the engine ones, which are
SAME as Kahn and are only cited: 0x12b34, 0x12cc2, 0x11fa1, 0x11ac1, 0x10fb8, 0x10908, 0x107d0, and the
table builder 0x11909, which another loader runs but which part 2 needs. The cited functions are
0x13c28, 0x15ca1, 0x176c4, 0x1f024 (a near match, the diff is below), 0x1e1e4, 0x1e2a8, 0x1ed84,
0x1f66e and 0x199b2.

**Not part of part 2: 0x11b41, 0x11e2c, 0x120e6 (and 0x11a3c).** `callers.json` and the code agree:
0x11b41 and 0x120e6 are called only by 0x122b0 (part 4), and 0x11e2c only by 0x122b0 and 0x130f7
(part 6). 0x11a3c is called only by 0x11e2c. They use the same grid array 0x58578 and texture pointer
0x5d8c8, so they belong to the part-4/part-6 reader. A short identification is at the end. Part 2
calls exactly one grid renderer, 0x11fa1, and through it 0x11ac1.

---------------------------------------------------------------------------------------------------

## Globals

| addr | type | meaning |
|---|---|---|
| 0x5db38 | u8* | 64K-aligned 256x256 texture `2d3.gif` (8-bit indices) |
| 0x5d8d0 | u8* | 64K-aligned 256x256 texture `sflare.gif` |
| 0x5db3c | u8* | malloc'd 768-byte 6-bit palette. Written twice by the loader (2d3, then sflare; the first copy leaks). The two GIF files have **identical** palettes (checked with Pillow), so it does not matter which one wins |
| 0x5db40 | u8* | 64K-aligned 64K **additive** blend table, built from the sflare palette (0x10908) |
| 0x5db44 | float[5] | five zeros (static data): the TCB/ease template copied for every spline key |
| 0x5d8d4 | spline[30] | 30 spline headers of 0x12 bytes each (0x5d8d4..0x5daf0). Kahn layout: +0 u32 key count, +4 u32 cursor, +8 u32 length, +0xc u16 loop flag, +0xe keys*. All BSS zero before the loader, so **loop = 0** |
| 0x54dec | u32 | rand() seed, initial value **1** (Kahn 0x55fe8). The loader's two calls are the only calls to rand in the whole EXE (`grep "call 0x1f66e"` gives 2 hits), so the sequence is fixed |
| 0x5c818 | float[41][26] | grid angle table A[i][j] (built by 0x11909) |
| 0x5b770 | float[41][26] | grid radius table B[i][j] (built by 0x11909) |
| 0x58578 | struct{i32 u; i32 v; i32 w;}[41][26] | grid points, 12 bytes each, row stride 0x138 (26*12). Part 2 writes u (+0) and v (+4) and never touches +8 (part 4 uses it) |
| 0x5d8c0 / 0x5d8c4 | float | sin(a) and cos(a) of the current frame (float32) |
| 0x5d8c8 | u8* | texture used by 0x11ac1. Part 2 sets it to [0x5db38] (2d3) |
| 0x5308c, 0x53018, 0x52010 | | raster_setup state: blend table pointer, destination buffer, row offset table (Kahn 0x53e8c, 0x53e18, 0x52e10) |
| 0x5846c | u32 | tick counter 0 (100 Hz). Part 2 zeroes it at the start of each phase. Used for the fades and the flare spline time |
| 0x58470 | u32 | tick counter 1 (100 Hz). Never zeroed by any part (only when the music starts), so it is **music time**. Drives the grid animation |
| 0x584ac | u32 | song position from the last 0x10e50 poll |

Helpers (all SAME as Kahn unless noted):
- 0x10794() -> eax = a new 64K-aligned 64K block (Kahn 0x10734).
- 0x1936c(eax = file name, edx = dest, ebx = u8** palette out, cl = mode) is the GIF loader
  (nearest Kahn 0x1f114). It decodes into a temporary buffer [0x5dbf4] and stores the GIF palette, as
  `byte >> 2` (6-bit, see 0x18a6c), in the 768-byte buffer [0x5dbf0]. **Mode 1** copies w*h bytes
  of indices to `dest`; modes 2/3/4 convert to 16/24/32-bit and are not used here. It then sets
  `*palOut = malloc(0x300)`, copies [0x5dbf0] into it and frees the temporary buffer. [0x5dbf0]
  keeps the palette of the **last** GIF decoded. A failed decode is fatal ("PIX global error, file : ").
- 0x1067c(eax = pal) sets all 256 DAC entries. 0x106dc(eax = buf) copies 64000 bytes to the screen.
- 0x10e50() polls MIDAS into 0x584ac (position), 0x584b0, 0x584b4 (row), 0x584b8.
- 0x1866c(al = index, dl = r, bl = g, cl = b) sets one DAC entry: `out 3c8h, index; out 3c9h, r, g, b`.
  The DAC keeps only the low 6 bits of each value.
- 0x199b2 = Kahn 0x1f318. Before `fistp` it **truncates toward zero** (it sets RC = chop around
  `frndint`). Every float-to-int conversion in this slice uses it, so every `trunc()` below is this
  helper.

---------------------------------------------------------------------------------------------------

## 0x12b34 `load_part2()`: no args, no return value

```c
u8 *t = new64k();                                   // 0x10794
[0x5db38] = t;
gif_load("2d3.gif" /*0x50504*/, t, &[0x5db3c], 1);   // 0x1936c, mode 1

// 30 random 2D splines with 10 keys each
for (spline *s = 0x5d8d4; s != 0x5d8d4 + 0x21c; s += 0x12) {   // 30 headers
    spline_alloc(s, 10);                             // 0x1e1e4 = Kahn 0x2fce4: keys = malloc(10*0x56), cur = 0, count = 10
    float tcb[5]; memcpy(tcb, 0x5db44, 20);          // all 0.0f: tension, continuity, bias, ease to, ease from
    for (u16 i = 0; i < 10; i++) {
        int y = abs(rand() % 280) - 40;              // FIRST rand. 0x118 = 280; signed idiv, then abs (a no-op, rand >= 0)
        int x = abs(rand() % 400) - 40;              // SECOND rand. 0x190 = 400
        spline_add_key(s, (float)x, (float)y, /*z*/ 0.0f, /*frame*/ i, tcb);   // 0x1e2a8 = Kahn 0x2fda8
    }                                                // x in -40..359, y in -40..239, both exact integers in float32
    spline_tangents(s);                              // 0x1ed84 = Kahn 0x308fc (TCB all 0, loop 0)
}

u8 *f = new64k();  [0x5d8d0] = f;
gif_load("sflare.gif" /*0x5050c*/, f, &[0x5db3c], 1);   // overwrites [0x5db3c] (same palette)

u8 *tab = new64k();  [0x5db40] = tab;
build_additive_table(tab);                           // 0x10908, from [0x5dbf0] = the sflare palette
```
`rand()` is 0x1f66e = Kahn 0x2fbc9: `seed = seed*0x41C64E6D + 0x3039 (mod 2^32); return (seed >> 16) & 0x7FFF;`
with the seed at 0x54dec starting at 1. The keys this produces, as (x, y) for frames 0..9 (z is always 0):

```
 0  (118,-2) (275,-7) (-13,211) (179,10) (46,212) (327,189) (20,84) (303,-15) (343,129) (326,177)
 1  (138,46) (271,15) (14,127) (305,191) (96,-38) (65,-36) (62,74) (227,171) (13,114) (256,81)
 2  (348,148) (103,125) (166,207) (163,45) (-6,42) (80,233) (-37,44) (78,82) (87,-18) (305,57)
 3  (343,159) (254,231) (219,150) (117,-32) (66,189) (350,6) (76,218) (22,-26) (-15,-4) (294,61)
 4  (-18,103) (296,-7) (339,200) (-39,191) (221,16) (-35,0) (4,169) (53,-5) (99,-6) (81,208)
 5  (331,122) (277,194) (-25,182) (13,66) (334,226) (208,211) (-6,-7) (70,33) (170,68) (9,160)
 6  (122,36) (157,206) (270,193) (159,71) (65,46) (142,85) (160,170) (125,172) (340,200) (164,199)
 7  (35,-15) (25,5) (231,94) (257,136) (57,23) (247,19) (309,3) (216,105) (61,173) (117,93)
 8  (27,59) (358,-27) (71,6) (126,206) (348,16) (-14,238) (347,33) (-23,11) (348,72) (243,151)
 9  (104,162) (345,8) (119,3) (136,1) (138,15) (45,163) (249,184) (271,33) (186,141) (256,205)
10  (230,63) (289,110) (60,19) (168,167) (17,5) (34,-18) (-18,11) (184,-8) (-25,-26) (36,7)
11  (125,198) (336,26) (211,132) (323,208) (193,231) (266,12) (234,51) (104,88) (334,109) (349,31)
12  (95,95) (200,164) (195,212) (252,59) (350,-30) (228,-5) (349,51) (262,201) (146,50) (40,211)
13  (147,221) (150,209) (193,126) (223,228) (-39,201) (146,219) (189,134) (267,162) (352,-12) (350,185)
14  (35,209) (351,189) (2,28) (135,-7) (302,199) (152,114) (73,29) (42,197) (355,-9) (29,74)
15  (39,190) (94,149) (324,32) (-11,80) (92,235) (116,25) (239,163) (-33,28) (117,19) (347,34)
16  (-18,140) (169,29) (-7,129) (192,136) (23,39) (236,89) (61,237) (200,-29) (75,103) (-20,69)
17  (224,177) (103,-36) (89,22) (203,146) (285,167) (-6,43) (202,122) (-28,155) (270,144) (286,105)
18  (245,228) (210,218) (325,196) (153,86) (171,-39) (9,58) (291,127) (334,50) (-7,100) (138,108)
19  (275,64) (252,205) (299,-32) (162,165) (94,-22) (222,98) (261,104) (249,204) (262,221) (218,213)
20  (123,208) (212,47) (269,115) (115,235) (248,-5) (117,93) (-18,118) (105,88) (-40,174) (265,91)
21  (161,71) (-26,48) (225,177) (-25,129) (137,150) (97,9) (259,139) (277,91) (39,167) (157,126)
22  (301,5) (309,67) (-25,185) (313,-4) (90,-4) (-30,28) (-32,39) (159,62) (206,-31) (101,118)
23  (86,121) (7,178) (60,67) (356,39) (345,26) (116,91) (49,-7) (272,71) (117,106) (212,176)
24  (344,210) (-11,113) (242,19) (337,202) (262,-32) (172,102) (339,-35) (4,216) (125,110) (25,59)
25  (201,-27) (319,124) (171,-40) (95,184) (80,-16) (81,229) (331,33) (330,9) (47,154) (277,133)
26  (0,228) (50,55) (266,59) (257,106) (303,-18) (252,127) (322,6) (344,159) (4,32) (58,15)
27  (97,194) (42,226) (106,224) (25,-18) (352,28) (321,30) (277,119) (64,34) (307,225) (340,25)
28  (25,98) (101,-30) (57,119) (70,37) (227,187) (233,36) (207,3) (325,177) (45,-9) (297,86)
29  (221,41) (126,-10) (205,239) (-2,127) (261,-7) (-26,76) (212,138) (124,237) (25,6) (192,85)
```
Port: Kahn `track.js`: `createTrack()`, then `addKey(t, i, [x, y, 0], [0,0,0,0,0])` ten times, then
`prepareTangents(t)`. I verified exactly this against the capture (see Checks).

### 0x10908 `build_additive_table(eax = table)`
Brother's version of Kahn 0x10770. The palette comes from **[0x5dbf0]** (the last GIF's palette, 6-bit).
```c
for (i = 0; i < 256; i++)
    for (j = i; j < 256; j++) {                       // upper triangle, mirrored
        r = min(pal[3i]   + pal[3j],   63);           // u8 adds (max 126, no wrap), then clamp to 0x3f
        g = min(pal[3i+1] + pal[3j+1], 63);
        b = min(pal[3i+2] + pal[3j+2], 63);
        c = nearest_color(r, g, b, pal);              // 0x107d0
        table[(j << 8) | i] = c;                      // the ASM stores [i*256 + j] first, then [j*256 + i]
        table[(i << 8) | j] = c;
    }
```
### 0x107d0 `nearest_color(al = r, dl = g, bl = b, ecx = pal) -> al`
```c
best = 192 /*0xc0*/;  idx = <uninitialised stack slot>;
for (k = 0; k < 256; k++) {
    d = abs(pal[3k] - r) + abs(pal[3k+1] - g) + abs(pal[3k+2] - b);   // L1 distance, int
    if (d < best) { best = d; idx = k; }              // strict <: the FIRST minimum wins
}
return (u8)idx;
```
The largest possible L1 distance in the 6-bit cube is 189 < 192, so some index is always found and
the uninitialised value is never returned.

---------------------------------------------------------------------------------------------------

## 0x11909 `build_grid_tables()`: the second loader in main's list, no args

Builds A (0x5c818) and B (0x5b770), 41 x 26 float32 each, index `[i][j]` at byte offset `i*0x68 + j*4`.
`i` (0..40) is the screen **x** cell index and `j` (0..25) the screen **y** index (see 0x11fa1).
```c
for (i = 0; i <= 40; i++) {
    int dx = 20 - i;                                  // integer: +20 at the left edge, -20 at the right
    for (j = 0; j <= 25; j++) {
        double dy = 12.5 - j;                         // 12.5 is float64 (0x50428)
        B[i][j] = (float)(sqrt(dy*dy + (double)(dx*dx) + 1.0) * 8.17);   // 8.17 float64 (0x50420); x87 fsqrt
        float fdx = (float)dx, fdy = (float)dy;       // both exact
        if (fdy >= 0) {                               // tested as "0 > dy"; dy is never 0
            if (fdx == 0) ang = 1.5707964f;           // bits 0x3fc90fdb
            if (fdx > 0)  ang = atan(fdy / fdx);                      // fpatan(st1 = dy/dx, st0 = 1)
            if (fdx < 0)  ang = atan(fdy / fdx) + PI_A;
        } else {
            if (fdx == 0) ang = 4.712389f;            // bits 0x4096cbe4
            if (fdx < 0)  ang = atan(fdy / fdx) + PI_A;
            if (fdx > 0)  ang = atan(fdy / fdx) + TWO_PI_A;
        }
        A[i][j] = (float)ang;
    }
}
```
`PI_A` = float64 at 0x50430 = **3.141592687** (bits 0x400921fb58c02462, NOT Math.PI) and `TWO_PI_A` =
float64 at 0x50438 = **6.283185374** (0x401921fb58c02462). `fdy / fdx` is float32 / float32 at x87
precision. The result is atan2(dy, dx) mapped into [0, 2π), with the slightly-off π constants.
Sample values: A[0][0] = 0.5585993, B[0][0] = 192.86220; A[20][12] = 1.5707964, B[20][12] = 9.134337;
A[20][13] = 4.712389; A[40][25] = 3.7001920; A[10][5] = 0.6435011, B[10][5] = 102.45128.

---------------------------------------------------------------------------------------------------

## 0x12cc2 `part2()`: no args

```c
[0x5d8c8] = [0x5db38];                                    // grid texture = 2d3.gif
raster_setup(320 /*[0x58424]*/, 200 /*[0x58428]*/, [0x58440], [0x5db40]);   // 0x176c4 = Kahn 0x13cfe
                                                          // dst = work buffer 0x58440, blend table = additive

// ---------------- phase A ----------------
int fadingA = 1;                                          // [ebp-0xc]
[0x5846c] = 0;
while ([0x584ac] <= 7) {                                  // unsigned compare, position from the PREVIOUS poll
    poll_music();                                         // 0x10e50
    fade_step(&fadingA);                                  // see below, uses [0x5846c]
    compute_grid();                                       // see below, uses [0x58470]
    draw_grid();                                          // 0x11fa1
    present([0x58440]);                                   // 0x106dc
}

// ---------------- phase B ----------------
[0x5846c] = 0;
int fadingB = 1;                                          // [ebp-0x10]
while ([0x584ac] <= 9) {
    poll_music();
    fade_step(&fadingB);
    compute_grid();
    draw_grid();                                          // 0x11fa1
    float t = (float)((double)[0x5846c] * 0.007);         // fild qword (u32 zero-extended), 0.007 float64 (0x50543), stored f32
    for (spline *s = 0x5d8d4; s != 0x5d8d4 + 0x21c; s += 0x12) {      // 30 flares, in order
        vec3 p;  spline_eval(s, t, &p);                   // 0x1f024 ~ Kahn 0x30ba4 (see below); only p.x, p.y used
        int x0 = trunc(p.x + -18.0f), y0 = trunc(p.y + -18.0f);       // -18.0, 18.0 float32 (0x5054f, 0x50553)
        int x1 = trunc(p.x +  18.0f), y1 = trunc(p.y +  18.0f);       // 0x199b2 = toward zero
        sprite_scaled_blend((y0 << 16) + x0, (y1 << 16) + x1,          // 0x13c28 = Kahn 0x10f60
                            [0x5d8d0] /*sflare*/, [0x58440]);        // 32-bit adds: a negative x borrows from y
    }
    present([0x58440]);
}
return;
```
The buffer is **not cleared**. It does not need to be, because 0x11fa1 covers all 320x200 pixels every frame.
Each flare is the whole 256x256 sflare texture shrunk into the inclusive-exclusive box
x0..x1 = 36x36, mixed through the additive table (sflare's background index 225 is black (0,0,0), so
it adds nothing). Kahn `raster.js drawScaledSprite(target, texture, table, corner0, corner1)` matches
exactly.

### fade_step (inlined twice: 0x12d14..0x12d61 and 0x12ea7..0x12ef4)
```c
float f = (float)(1.0 - (double)[0x5846c] * 0.01);      // 0.01 float64 (0x50527); stored f32
if (f < 0)            { set_palette([0x5db3c]); *fading = 0; }   // 0x1067c; exact palette from now on
else if (*fading)       fade_from_white(f, [0x5db3c]);           // 0x10fb8
```
(`fcomp`: 0 against f. The `jbe` keeps the fade path for f >= 0.) The fade lasts 100 ticks = 1 s. Once
f < 0 the palette is written once and never again in this phase.

### 0x10fb8 `fade_from_white(stack: float f, u8 *pal)`, `ret 8`
The first stack argument (pushed last) is f.
```c
for (i = 0; i < 256; i++) {
    b = (u8)trunc((double)(64 - pal[3i+2]) * f + pal[3i+2]);   // int32 fild * f32, + int16 fild; chop
    g = (u8)trunc((double)(64 - pal[3i+1]) * f + pal[3i+1]);   // computed in the order b, g, r
    r = (u8)trunc((double)(64 - pal[3i  ]) * f + pal[3i  ]);
    dac_set(i, r, g, b);                                       // 0x1866c
}
```
Note **64 (0x40), not 63**. At f = 1.0 (tick counter still 0) every channel is 64, and the DAC keeps
6 bits, so **64 becomes 0: the first frame(s) of each phase are black**, not white. The capture shows
this (Checks). A port should write `value & 63`. For f slightly below 1 the values are 63.x, which
truncates to 63 (white).

### compute_grid (inlined twice: 0x12d66..0x12e5e and 0x12ef9..0x12ff1)
```c
double a = (double)[0x58470] * 0.0098;                   // 0.0098 float64 (0x5052f); fild qword of the u32
[0x5d8c0] = s = (float)sin(a);                           // x87 fsin / fcos on the extended value
[0x5d8c4] = c = (float)cos(a);
for (i = 0; i <= 40; i++)                                // grid "rows" = screen x cells, stride 0x138
    for (j = 0; j <= 25; j++) {                          // 26 points, 12 bytes each
        long double ang = s - A[i][j];                   // f32 - f32 at x87 precision
        long double X = (long double)B[i][j] * cos(ang) * 4.0 * s;    // 4.0 float64 (0x50537)
        long double Y = (long double)B[i][j] * sin(ang) * 4.0 * s;
        grid[i][j].u = trunc(X + (512.0f * s + 256.0f));               // 512.0f (0x5053f), 256.0f (0x5054b)
        grid[i][j].v = trunc(Y + (512.0f * c + 256.0f));
    }
```
The exact x87 evaluation order: X = ((B*cos)*4)*s and `tmp = s*512 + 256`, then `X + tmp`; the same for Y
with c. Everything stays on the FPU stack, nothing is rounded to f32 in between, and the int32 result goes
through the truncating 0x199b2. In JS, plain doubles in this order reproduce it (verified exactly, see
Checks). The image is a polar mapping around the screen centre (cell (20, 12.5)). The zoom is
proportional to `s = sin(a)`. With a = music_ticks * 0.0098 its period is 2π/0.0098 = 641.1 ticks
(6.41 s), so **sin crosses zero every 320.6 ticks (3.2 s)**. At those moments all u, v collapse
towards (512s+256, 512c+256), which gives the flat 8x8 **mosaic** frames seen in the capture at
~45 s and ~61 s. The angle offset `s - A` makes the picture swirl back and forth by ±1 radian.

### 0x11fa1 `draw_grid()`: no args
40 x 25 cells of 8x8 pixels, each cell two affine triangles with **inclusive** corners 0..7. Kahn's
tri_affine_tex draws both edges inclusive, so the cells tile 320x200 exactly with no gaps or overlaps.
```c
for (i = 0; i < 40; i++) {                    // x cells; X = 8*i
    for (j = 0; j < 25; j++) {                // y cells; Y = 8*j   (inner loop)
        X = 8*i;  Y = 8*j;
        P00 = grid[i][j];  P01 = grid[i][j+1];  P10 = grid[i+1][j];  P11 = grid[i+1][j+1];
        // u,v are passed as the LOW 16 BITS of the int32s (movsx word), ranges here are within ±1600 anyway
        tri(X, Y,   X,   Y+7, X+7, Y+7,   P00.u, P00.v,  P01.u, P01.v,  P11.u, P11.v);   // 0x11ac1, lower-left half
        tri(X, Y,   X+7, Y,   X+7, Y+7,   P00.u, P00.v,  P10.u, P10.v,  P11.u, P11.v);   // 0x11ac1, upper-right half
    }
}
```
Draw order: for each x column of cells, top to bottom, the lower-left triangle first, then the upper-right.
The order is irrelevant because the triangles do not overlap. The loop ends through the shared epilogue at
0x12c2f (`jge 0x12c2f` is a jump into the previous function's `leave/ret`; it simply returns).

### 0x11ac1 `tri(eax = x0, edx = y0, ebx = x1, ecx = y1, stack: x2, y2, u0, v0, u1, v1, u2, v2)`, `ret 0x20`
Brother's copy of Kahn wrapper sub_152e0 (similarity 0.86). It builds the 0x1c-byte parameter block on
the stack, `{ u32 tex = [0x5d8c8]; {i16 x,y,u,v} v0, v1, v2 }`, and calls 0x15ca1 (= Kahn 0x12962
`tri_affine_tex`, OPAQUE). Port: `fillAffineTriangle(target, tex, {x,y,u:u&0xffff,v:v&0xffff} x3,
AFFINE_OPAQUE)` from Kahn `raster.js`. The destination is [0x53018] = 0x58440 from raster_setup.
It is called only from 0x11fa1 (so it is not shared with part 1).

### 0x1f024 `spline_eval(eax = spline, stack: float frame, vec3 *out)`, `ret 8`: near match of Kahn 0x30ba4
Identical in every instruction except the Hermite basis block (0x1f15f..0x1f1ba). The only numeric
difference:
- Kahn: `h2 = -2*u3 + (float)(3*u2)` (3u² rounded to float32 first).
- Brother: `h2 = 3*u2 - 2*u3`, all extended (3.0f at 0x50b98, 2.0f at 0x50b9c). `h1 = (2*u3 - (float)(3*u2)) + 1`,
  `h3 = u + (u3 - 2*u2)` and `h4 = u3 - u2` are as in Kahn. The h's are stored f32 for the y and z
  components, as in Kahn.

The difference is far below one pixel. The Kahn `track.js evaluate()` (all doubles) gave a
pixel-exact match with the capture. The rest is Kahn 0x30ba4 unchanged, with the cursor semantics of
Kahn I_pipeline.md §4.4. The cursor at +4 advances at most one key per call and only forward.
Splines are non-looping, and after the last key the spline holds the last key's value. In phase B t
grows by 0.007 per tick. The phase lasts about 1280 ticks, so t ends near 8.96 < 9 and the last key
is never reached in normal playback.

---------------------------------------------------------------------------------------------------

## Music sync and ESC

- Part 2 starts as soon as part 1 returns. Part 1 (0x1128f) waits at 0x11767 until `position > 5`, so part 2 starts at
  **position 6, row 0** (nominal 38.4 s; tick counter 1 measured ~3818..3820, see Checks).
- Phase A ends after the frame whose poll returned **position 8** (pattern 9, row 0; nominal 51.2 s).
  The loop tests the position at the top, from the previous poll, so one extra phase-A frame is drawn
  after position 8 is first seen.
- Phase B ends the same way on **position 10** (pattern 7, row 0; nominal 64.0 s). Then 0x12cc2
  returns and part 3 (0x13559) starts.
- No row-level sync inside the part: the rows are not read.
- Time sources: fades and the flare paths use counter 0 (0x5846c, zeroed at each phase start). The grid
  uses counter 1 (0x58470, music time, never zeroed), so the grid animation is continuous across A→B.
- **ESC does not end this part.** ESC adds 0x01000000 to counter 0 (README). Here that only makes f < 0
  (palette set at once) and, in phase B, makes t huge. The flare cursors then walk one key per frame
  (u > 1 extrapolation for up to 9 frames), and after that all 30 flares freeze at their frame-9 key
  (u = -1 "hold" path). The part still ends only on the music position.
- Inherits from previous parts: nothing. The palette is replaced by the fade, and the work buffer is
  fully overwritten every frame. It leaves behind: palette = 2d3/sflare palette, raster_setup pointing
  at 0x58440 with the additive table, and the grid array 0x58578 (part 4 overwrites it).

---------------------------------------------------------------------------------------------------

## Checks against the capture

All with capframe.py; the comparisons quantise the capture to 6 bits (`round(v*63/255)`).
1. **Phase A grid, pixel-exact.** I rendered compute_grid + draw_grid with the formulas above (JS
   doubles), Kahn `fillAffineTriangle` (OPAQUE) and 2d3.gif. With counter 1 = 4189 this matches the
   capture frame at T = 42.0 s on **100% of the 64000 pixels**. The best fits for other frames were
   T = 40.5 → 4039 and T = 48 → 4790: counter 1 ≈ 100*T − 11..15.
2. **Phase B grid + flares, pixel-exact.** At T = 56.0: grid with counter 1 = 5585, plus the 30
   flares (rand table above, Kahn `track.js`, `drawScaledSprite` with the additive table built as in
   0x10908/0x107d0) with counter 0 = 486. Rows 0..149 match **100%**. Rows 150..199 of that capture
   frame still show the previous frame (tearing in the capture: the copy to the screen is not
   synchronised with the frame grab), so I did not compare them. Swapping the two rand calls (x first)
   gives no fit at any t. This confirms y = first rand % 280 and x = second rand % 400.
3. **Mosaic frames.** At T = 45 and 61 the capture shows the flat 8x8 mosaic. That agrees with
   sin(counter1 * 0.0098) ≈ 0 near counter 1 ≈ 4488 and 6090.
4. **Phase starts and black frames.** The video frames at T = 38.315 and 38.33 are completely black, and
   38.345 is white. T = 51.095 and 51.11 are black, then white with flares at 51.125. The black frame is
   the 64 → 0 DAC wrap of fade_from_white at f = 1.0 (counter 0 = 0). The fades then run white → full
   colour over 1 s, as seen in the 38.4..39.2 s and 51.2..52 s sheets.
5. **Timing.** Phase B starts at counter 1 ≈ 5585 − 486 = 5099. The part starts at T ≈ 38.31, which is
   counter 1 ≈ 3818 by the fit in check 1. The part ends at T ≈ 63.8 (top of the screen already
   showing part 3's black/white first frame), which is counter 1 ≈ 6366. Nominal row times are 3840 /
   5120 / 6400 ticks, so **MIDAS reports a new position about 0.2 s (20-30 ticks) before the 100 Hz
   counter reaches the nominal time.** UNSURE why: probably MIDAS mixing ahead (the position belongs
   to the mixed buffer, not the audible sample), or the DOSBox timer rate. A port that derives the
   position from audio time should switch parts at row times − ~0.21 s to match the capture, or
   simply at the nominal row times (the difference is invisible apart from the first black frame).

---------------------------------------------------------------------------------------------------

## Functions in the requested list that part 2 does not use (for the part-4/part-6 reader)

Identified only, not documented:
- 0x11b41 (747 bytes, caller 0x122b0 only): per-point grid computation for part 4. It calls engine
  vector/matrix helpers 0x1dcd8, 0x1dd70, 0x1dbe4, 0x1da90 and 0x1e0fb. Constants: 270.0f, 2.0f,
  4.0f, -70000.0f, 0.2, 256.0, 0.31831 (1/π), 0.014. It writes u, v and the third field (+8) of the
  0x58578 points.
- 0x11e2c (callers 0x122b0, 0x130f7): grid renderer like 0x11fa1 that also reads the +8 field. It calls
  0x11a3c.
- 0x11a3c: like 0x11ac1, then draws the same triangle again with 0x169a2 (= Kahn 0x12fe1
  tri_shade_table) through the table [0x5d8cc].
- 0x120e6 (caller 0x122b0 only): a pass over the work buffer 0x58440 using the row table 0x58448.
