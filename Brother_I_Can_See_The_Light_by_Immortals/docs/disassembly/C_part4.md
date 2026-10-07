# Slice C, part 4: loader 0x1220a and part 0x122b0 ("raytraced tunnels", 1:29.3 to 1:54.7)

Functions in this note:

| addr | size | name | Kahn | status |
|---|---|---|---|---|
| 0x1220a | 0xa6 | `load_part4` (2d2/2d5/2d6.gif, three shade tables) | near 0x1d210 (0.78) | read |
| 0x11780 | 0x189 | `build_shade_table(eax = table, edx = palette)` | none | read; model == emulated code, 65536/65536 entries |
| 0x122b0 | 0x884 | `part4` (four phases) | none | read; the whole part is emulated and matches the capture pixel for pixel |
| 0x11b41 | 0x2eb | `trace_tunnel_point` (one grid point) | none | read; model == emulated code on 42,640 points |
| 0x11e2c | 0x175 | `draw_grid` (40x25 cells, 2000 triangles) | none | read; the call sequence matches the emulated code, 2000/2000 calls |
| 0x11a3c | 0x85 | `tri_tex_then_shade` (wrapper, builds the 0x1c-byte block) | like 0x152e0 | read |
| 0x120e6 | 0x124 | `sub_picture(eax = x, edx = y)`: a 1/3-scale copy of the buffer onto itself | none | read; model == emulated code, 308 cases |
| 0x1dfe4 | 0x117 | `euler_matrix(a, b, c, out)` | none (engine area) | read; model == emulated code, 300 random cases |
| 0x10fb8 | 0xc1 | `fade_from_white(float f, u8 *pal)` (shared by 6 parts) | none | read; model == emulated code |
| 0x1e0fb | 0x45 | `atan2` inline (`fpatan`) | | read |
| 0x15ca1 | | `tri_affine_tex` | **SAME** Kahn 0x12962 | not re-read |
| 0x169a2 | | shade-table triangle | **NOT SAME as Kahn 0x12fe1: two instructions differ**, see section 7 | diffed |
| 0x1dcd8, 0x1dd70, 0x1dbe4, 0x1da90 | | vec_set, mat×vec, normalize, vec_add | SAME Kahn 0x23cbc, 0x312b0, 0x23bc8, 0x23aa0 | read (short) |
| 0x10794 | | next 64K block | SAME Kahn 0x10734 | read |

## 0. How this was checked (read this first)

- I built a Unicorn harness (scratchpad `p4/emu.py`, `render.py`; session-local) that maps
  `obj1.bin`/`obj2.bin` at their addresses, runs the Watcom start-up's `fninit; fldcw [0x56a94]`
  (control word **0x127F**: 53-bit precision, round to nearest), loads the three GIFs with Pillow
  (raw indices, palette `>> 2`), builds the tables by running 0x11780, and then **runs 0x122b0
  itself**, with hooks on 0x10e50 (to feed position and the two tick counters), 0x1067c / 0x1866c
  (DAC writes) and 0x106dc (grab the frame).
- **Capture check.** For 9 capture frames spread over all four phases (frames 6400, 6500, 6650, 6900,
  7100, 7300, 7500, 7700, 7900, 8030) I searched for the tick values. Every frame matches the
  capture **pixel for pixel (100 % of 64000 pixels)**, with the 6-bit DAC values shown as
  `(v*255+31)/63`. Two frames (6500, 7700) match only above/below a horizontal line: these are
  torn frames (the copy to the screen is not synchronised to the retrace); each half matches
  an adjacent tick value exactly.
- **Pseudo-code check.** I wrote the pseudo-code below as a JavaScript model (scratchpad
  `p4/port.mjs`) that calls the Kahn port's `fillAffineTriangle` (with the two-line patch
  of section 7). On 49 (phase, ticks) cases, 9 taken from the capture fits and 40 random,
  its output is **identical to the emulated machine code, index for index**. The functions in that
  file are quoted in section 9; a porter can copy them.
- All FPU arithmetic is IEEE double (precision control 53 bits), so JS numbers reproduce it.
  Values stored with `fstp dword` are `Math.fround`ed; values left on the FPU stack are not. I mark
  float32 stores with `f32()`.
- `0x199b2` (= Kahn 0x1f318) sets RC = 11 around `frndint`, so every `call 0x199b2; fistp` in this
  slice **truncates toward zero** (C cast). Out-of-range or NaN stores 0x80000000.

## 1. 0x1220a: load_part4 (main's 5th loader)

```c
void load_part4(void) {
    tex2d2 = next_block64k();  load_texture("2d2.gif", tex2d2, &pal2d2, 1);   // [0x5db14], [0x5db20]
    tex2d5 = next_block64k();  load_texture("2d5.gif", tex2d5, &pal2d5, 1);   // [0x5db18], [0x5db24]
    tex2d6 = next_block64k();  load_texture("2d6.gif", tex2d6, &pal2d6, 1);   // [0x5db1c], [0x5db28]
    tab2d2 = next_block64k();  build_shade_table(tab2d2, pal2d2);              // [0x5db2c]
    tab2d5 = next_block64k();  build_shade_table(tab2d5, pal2d5);              // [0x5db30]
    tab2d6 = next_block64k();  build_shade_table(tab2d6, pal2d6);              // [0x5db34]
}
```
- `next_block64k` = 0x10794 (SAME Kahn 0x10734): returns `[0x58450]` and adds 0x10000 (64K-aligned
  blocks from the aligned buffer; fatal "Aligned Buffer too small." after 70 blocks).
- `load_texture` = 0x1936c(eax = name, edx = dest, ebx = `u8 **pal_out`, cl = bytes per pixel = 1).
  It is Kahn's 0x1f114 except that the third argument is no longer a "set the DAC" flag: at the
  end (0x19523..0x1953e) it does `*pal_out = malloc(0x300)` and copies the 768-byte palette into it.
  The palette is 6-bit (`byte >> 2`, 0x18a6c). It does not touch the DAC. The three files are 256x256
  GIF89a, 256 colours. Pillow's indices and `getpalette() >> 2` reproduce them; the emulated frames
  built from Pillow data match the capture exactly.
- Textures and tables are 64K-aligned, which the triangle code needs (it only keeps the high word).

## 2. 0x11780: build_shade_table(eax = table, edx = pal)

`table[(c << 8) | level]` = the palette index nearest to colour c darkened to level/63, for
level 0..63 (columns 64..255 of each row are never written: whatever is in the block).

```c
int best_index;                       // [ebp-0x24], NOT initialised and NOT reset per entry
for (int level = 0; level < 64; level++)          // outer loop
  for (int c = 0; c < 256; c++) {                 // inner loop
    int r = pal[3*c]   * level / 63;              // unsigned integer division (truncates)
    int g = pal[3*c+1] * level / 63;
    int b = pal[3*c+2] * level / 63;
    int best = 0xc0;                              // 192
    for (int k = 0; k < 256; k++) {
      int d = abs(pal[3*k]-r) + abs(pal[3*k+1]-g) + abs(pal[3*k+2]-b);
      if (d < best) { best = d; best_index = k; } // strict <: the first minimum wins
    }
    table[c*256 + level] = best_index;
  }
```
The uninitialised `best_index` never matters for these palettes: I checked that every lookup of
all three tables finds a distance < 192 (the largest best distance is 24 / 14 / 39 for 2d2 / 2d5 /
2d6). My numpy model equals the emulated function on all 65536 bytes.

## 3. 0x122b0: part4: overview and music sync

Four phases. Each one runs `while (position <= N)`. The test uses the position from the previous
`update_status` (0x10e50) call, so the frame that sees the new position is still drawn by the old
phase. Then the next phase starts. Nothing in this part tests the row.

| phase | runs while `[0x584ac]` <= | = XM order | pattern | XM time (my XM timing, 50 ms/row) | capture: first frame (white flash) | texture / shade table / palette | camera angles (a, b, c) | sub-pictures |
|---|---|---|---|---|---|---|---|---|
| 1 | 14 | 14 | 12 | 89.6 to 96.0 s | 89.276 s (frame 6257; black frame 6252) | 2d2 / tab2d2 / pal2d2 (orange) | (T, -0.6T, 0.2T) | none |
| 2 | 15 | 15 | 12 | 96.0 to 102.4 | 95.668 (frame 6705; black 6701) | 2d5 / tab2d5 / pal2d5 (pale green drops) | (0, 0.9T, -0.2T) | 3, one column, moving down |
| 3 | 16 | 16 | 13 | 102.4 to 108.8 | 102.074 (frame 7154) | 2d6 / tab2d6 / pal2d6 (dark green swirl) | (0, T, -0.2T) | 5, two rows, moving right / left |
| 4 | 17 | 17 | 13 | 108.8 to 115.2 | 108.395 (frame 7597/7598) | 2d2 / tab2d2 / pal2d2 again | (-1.2T, 0, -0.3T) | 8, three columns |
| (exit) | | 18 | 14 | 115.2 | next part's flash at 114.744 | | | |

- Every phase starts at **row 0** of its order. The part starts when part 3 (0x13559, `while pos <= 13`)
  sees order 14, and returns when position 18 (pattern 14, 64 rows) begins. The XM is speed 2,
  BPM 100: 0.05 s per row, 6.4 s per 128-row pattern, no tempo changes in these orders.
- The capture clock runs **0.32 to 0.46 s ahead of** my XM time at these boundaries (89.6 - 89.276,
  96.0 - 95.668, 102.4 - 102.074, 108.8 - 108.395, 115.2 - 114.744). MIDAS's reported position
  leads what this computation gives. Sync a port to the player's order/row, not to wall time.

### The two clocks

- `t` = **`[0x5846c]`** (100 Hz ticks), zeroed by this part at the start of **each phase**. It drives
  the fade and the sub-picture positions.
- `T` = **`[0x58470]`** (100 Hz ticks), **never reset by this part**. Part 3 sets it to 0 (0x136e0)
  on the frame where it sees row 0 of a new order, and its last frame is the one that sees order 14
  row 0. So `[0x58470]` counts from (almost exactly) the start of part 4. The capture fits confirm it:
  `[0x58470]` = 0 at capture time 89.263..89.32 s, i.e. at the phase-1 flash. It is **not**
  restarted at phases 2..4: phase 2 begins near T = 6.4 s, phase 3 near 12.8, phase 4 near 19.1,
  and the part ends near T = 25.5 s. The camera and the tunnel's forward motion use it.
  (UNSURE, fragile: if part 3 ever misses row 0 of order 14, `[0x58470]` would not be reset. In
  the capture it was. A port should just set T = 0 when part 4 starts.)
- Both are read as unsigned 32-bit (`fild qword` with the high dword 0) and scaled by the double
  0.01. Write `Td = ticks * 0.01` (double) and `T32 = f32(Td)`.
- ESC (adds 0x01000000 to `[0x5846c]`) does **not** skip anything here: the loops only test the
  position. It only makes the fade finish and pushes the sub-pictures off screen until the next phase.

### Per-phase pseudo-code (all four phases have this shape)

```c
// globals: 0x5d8c8 = current texture, 0x5d8cc = current shade table, 0x5daf0 = 3x3 float matrix,
//          0x58578 = grid[41][26] of {int u, v, s} (column-major: &grid[ix][iy] = 0x58578 + ix*0x138 + iy*12)
void phase(int N, u8 *tex, u8 *tab, u8 *pal, angles_fn, subpics_fn) {
    [0x5d8c8] = tex;  [0x5d8cc] = tab;
    [0x5846c] = 0;    fading = 1;
    while ([0x584ac] <= N) {                       // unsigned compare; stale value, see above
        update_status();                           // 0x10e50: position/row from MIDAS
        float f = f32(1.0 - [0x5846c] * 0.01);     // double math, stored float32
        if (f < 0) { set_palette(pal); fading = 0; }        // 0x1067c, once per phase
        else if (fading) fade_from_white(f, pal);           // 0x10fb8
        Td = [0x58470] * 0.01;  T32 = f32(Td);
        euler_matrix(angles_fn(Td, T32), 0x5daf0);          // 0x1dfe4
        for (ix = 0; ix <= 40; ix++)                        // x = 0, 8, ..., 320
            for (iy = 0; iy <= 25; iy++)                    // y = 0, 8, ..., 200
                trace_tunnel_point(8*ix, 8*iy, &grid[ix][iy].u, &grid[ix][iy].v, &grid[ix][iy].s, T32);  // 0x11b41
        draw_grid();                                        // 0x11e2c, into [0x58440]
        subpics_fn([0x5846c]);                              // 0..8 calls of 0x120e6
        copy_to_screen([0x58440]);                          // 0x106dc
    }
}
```

`fading` is `[ebp+0x1e]`, `[ebp+0x16]`, `[ebp+0x22]`, `[ebp+0x1a]` for phases 1..4. The order inside a
frame is exactly: status, palette, matrix, grid, triangles, sub-pictures, copy. The palette is
written **before** the new picture is drawn, so for one frame the old picture is shown with the new
DAC values (see the black frame below).

### Angles passed to euler_matrix (stack order a, b, c, out = 0x5daf0)

Mixed precision is deliberate. Some angles come from `T32` reloaded from memory, others from the
unrounded double `Td` still on the FPU stack.

| phase | a | b | c |
|---|---|---|---|
| 1 | `T32` | `f32(-T32 * 0.6)` | `f32(Td * 0.2)` |
| 2 | `0` | `f32(Td * 0.9)` | `f32(-T32 * 0.2)` |
| 3 | `0` | `T32` | `f32(-Td * 0.2)` |
| 4 | `f32(-Td * 1.2)` | `0` | `f32(-Td * 0.3)` |

The `T` argument of 0x11b41 is `T32` in every phase.

### Sub-picture calls, `x = eax`, `y = edx`, `t = [0x5846c]`, `trunc` = 0x199b2 + fistp

```
phase 1: none
phase 2: 3 times: sub_picture(150, trunc(t*0.45 - 66))                         // all at the same place
phase 3: A = (trunc(t*0.7 - 106), 30), B = (trunc(320 - t*0.7), 120)
         sub_picture A, B, A, B, A                                              // 5 calls
phase 4: a = trunc(t*0.45 - 66), b = trunc(200 - t*0.45)
         sub_picture (0,a), (107,b), (215,a), (0,a), (107,b), (215,a), (0,a), (107,b)   // 8 calls, NOT 9
```
`t` is re-read for every call (same value). Constants are float64: 0.45, -66, 0.7, -106, 320, 200.
Because each call copies a reduced copy of the **current** buffer, which already holds the earlier
sub-pictures, onto itself, repeating the calls gives the nested picture-in-picture
("recursive sub-pictures").

### Fade and the black frame

`fade_from_white(f, pal)` (0x10fb8, stack args `f` (float32) then `pal`, `ret 8`):
```c
for (i = 0; i < 256; i++) {
    r = (u8)trunc((64 - pal[3i])   * f + pal[3i]);     // the int is converted, times the float32 f, plus the int, in double
    g = (u8)trunc((64 - pal[3i+1]) * f + pal[3i+1]);
    b = (u8)trunc((64 - pal[3i+2]) * f + pal[3i+2]);
    set_dac(i, r, g, b);                                // 0x1866c: out 0x3c8 = i; 0x3c9 = r, g, b
}
```
(The three components are computed b, g, r in that order. That does not matter.) On the first frame of
each phase `t` = 0, so f = 1.0 and every component is exactly **64**, which the 6-bit DAC takes as
**0**: one **black** frame (capture frames 6252 and 6701 are fully black; 7149 and 7597 are
 torn, part black), then white
(63) fading to the texture palette over 1 s (f = 0 at t = 100; at t = 101 the palette is set directly).
A port must reproduce `& 0x3f`. Model == emulated function for t = 0..101.

## 4. 0x1dfe4: euler_matrix(stack: float a, float b, float c, float *m)  (`ret 0x10`)

Row-major 3x3, written to `m[0..8]`. Exact op order (verified, 300 random angle triples, 0 diffs):
```js
SA=sin(a) CA=cos(a) SB=sin(b) CB=cos(b) SC=sin(c) CC=cos(c)   // fsin/fcos, kept unrounded
sa=f32(SA) ca=f32(CA) sb=f32(SB) cb=f32(CB) sc=f32(SC)       // spilled copies
sbsc=f32(SB*sc)  sacc=f32(SA*CC)  cacc=f32(CA*CC)
m0=f32(sa*sbsc + cacc)   m1=f32(CB*sc)   m2=f32(sacc - ca*sbsc)
m3=f32(sacc*sb - ca*sc)  m4=f32(cb*CC)   m5=f32(-cacc*sb - sa*sc)
m6=f32(-sa*cb)           m7=sb           m8=f32(ca*cb)
```

## 5. 0x11b41: trace_tunnel_point(eax = X, edx = Y, ebx = int *u, ecx = int *v, stack: int *s, float T)  (`ret 8`)

A ray from the eye through screen point (X, Y), turned by the matrix and intersected with an
infinite cylinder of radius sqrt(70000) = 264.575 around the z axis. The eye is on the axis at
z = -270*T, so the camera flies down the tunnel at 270 units/s.

```js
D0 = (f32(X-160), f32(Y-100), 256.0)                      // vec_set 0x1dcd8
D  = [ f32((m[3r+1]*D0.y + m[3r]*D0.x) + m[3r+2]*D0.z) ]   // 0x1dd70 (Kahn 0x312b0), r = 0,1,2
l2 = f32((D.y*D.y + D.x*D.x) + D.z*D.z)                   // normalize, 0x1dbe4 (Kahn 0x23bc8)
if (l2 > 0) { inv = 1/sqrt(l2); D = (f32(D.x*inv), f32(D.y*inv), f32(D.z*inv)); }
O  = (0, 0, f32(-T * 270.0))                               // 270.0 is float32 const 0x50440
// quadratic |O.xy + t*D.xy|^2 = 70000, in this op order:
A  = D.x*D.x + D.y*D.y                    // (dx2 + dy2), double
Bh = O.y*D.y + O.x*D.x;  B = Bh*2.0       // = 0 here
C  = O.x*O.x + O.y*O.y                    // = 0 here
disc = f32(B*f32(B) - (A*4.0)*(C + -70000.0))
if (!(disc >= 0)) { *u = 0x80; *v = 0x80; return; }     // *s NOT written. Never happens: C < 0
s  = sqrt(disc);  inv = 1.0/(f32(A)*2.0)
t1 = f32((-f32(B) + s)*inv);  t2 = f32((-f32(B) - s)*inv)
tt = (t1 >= t2) ? t2 : t1                // the SMALLER root, which is negative: the hit is BEHIND the eye
P  = (f32(f32(D.x*tt) + 0), f32(f32(D.y*tt) + 0), f32(f32(D.z*tt) + O.z))   // vec_add 0x1da90
*u = trunc(|P.z| * 0.2)                                                      // 0.2 double
*v = trunc(|atan2(P.y, P.x) * 256.0 * 0.318309882798629|)                    // see note
*s = clamp(63 - trunc(|P.z - O.z| * 0.014), 0, 63)                           // 0.014 double; P.z, O.z float32
```
- Constant at 0x50460 is the double **0.318309882798629** (bytes `ef 46 27 6a 30 5f d4 3f`,
  0x3FD45F306A2746EF), **not** 1/pi. Using 1/pi changes v in about 1 point in 20,000.
- `atan2` is 0x1e0fb: `fxch; fpatan`, i.e. C `atan2(P.y, P.x)` in -pi..pi. If bit 0 of byte 0x56a7a
  is set, a software routine 0x39b30 is used instead; it is 0 in the image and the capture matches
  `fpatan`. Because of the `fabs`, v runs 0..256 and the texture is mirrored about angle 0.
- u is the distance along the tunnel (54 texels per second of T). It is typically hundreds to a few
  thousand and is only used as a 16-bit word (low byte + 16-bit differences) by the triangles.
  s is the depth of the hit along the view axis (dark far away, black in the middle of the tunnel).
- When a ray is exactly parallel to the axis (A = 0), inv = inf and the NaN gives u, v, s =
  0x80000000 (s then clamps to 0). This is theoretical: it needs D.x = D.y = 0 exactly.
- Model == emulated code: 42,640 points (40 random cameras x 41x26 grid), 0 differences.

## 6. 0x11e2c: draw_grid (no args; also called by part 0x130f7)

```c
for (ix = 0; ix < 40; ix++)
  for (iy = 0; iy < 25; iy++) {
    x0 = 8*ix;  y0 = 8*iy;
    A = grid[ix][iy];  B = grid[ix][iy+1];  C = grid[ix+1][iy];  R = grid[ix+1][iy+1];
    tri_tex_then_shade((x0, y0, A), (x0,   y0+7, B), (x0+7, y0+7, R));   // 0x11a3c
    tri_tex_then_shade((x0, y0, A), (x0+7, y0,   C), (x0+7, y0+7, R));
  }
```
- The vertices are at +0 and **+7** within the 8-pixel cell, but they take the u/v/s of the next grid
  point (+8). Each cell is drawn as exactly 8x8 pixels: I checked that the 2000 triangles cover all
  64000 pixels (no gaps, so the buffer never needs clearing) and that every pixel gets shaded.
- u, v, s reach the triangle as `(int16)` of the grid's int32 (`movsx word`).
- Order is column-major (ix outer). Within a cell: triangle 1 textured, then shaded, then
  triangle 2 textured, then shaded. Pixels on the shared diagonal are re-textured by triangle 2,
  then shaded again. Keep this order.
- Verified: on a random grid, the 2000 calls to 0x11a3c (positions, u, v, s, order) equal this
  pseudo-code.

**0x11a3c tri_tex_then_shade**(eax = x0, edx = y0, ebx = x1, ecx = y1, stack: x2, y2, u0, v0, s0, u1, v1, s1, u2, v2, s2; `ret 0x2c`):
builds the Kahn 0x1c-byte block on its stack, `{ [0x5d8c8], (x0,y0,u0,v0), (x1,y1,u1,v1), (x2,y2,u2,v2) }`,
calls **0x15ca1** (SAME Kahn 0x12962, `tri_affine_tex`, Kahn JS `fillAffineTriangle(..., AFFINE_OPAQUE)`,
texel = `tex[(v << 8) | u]`). Then it replaces the three u words by s0, s1, s2 and the pointer by
`[0x5d8cc]`, and calls **0x169a2**: `dst = tab[(dst << 8) | s]`, with v interpolated and ignored. The
triangle routines sort vertex pointers. They do not reorder the block, so overwriting the u fields
in place is safe. The rasteriser's target is `[0x53018]` = `[0x58440]` (set by 0x176c4 in part 3,
0x1358f, and in main).

## 7. 0x169a2 is NOT identical to Kahn 0x12fe1: two instructions differ

`funclist.txt` says "nearest kahn sub_12fe1 similarity 1.00". The rounding hides a real difference.
I diffed the instruction sequences (480 vs 479 lines):

1. **Flat-bottom triangles: Brother adds the extra row** (`inc word [0x5303c]` at 0x16bbd), like the
   textured variants 0x12962 / 0x11e8c. Kahn 0x12fe1 does not.
2. **Span-width start: Brother uses `add eax, 1`** (0x16ec3), like the opaque variant. Kahn 0x12fe1
   uses `add eax, 0xffff0001` (0x134fb).

Everything else, including the shade pixel-count rule and the table lookup, is the same. In the Kahn
port's `src/engine/raster.js`, `fillAffineTriangle`, the Brother shade variant is AFFINE_SHADE with
these two changes:
```js
// flat bottom (dyBottom === 0):        if (variant !== AFFINE_SHADE) rows1 += 1;   -> always rows1 += 1
// width initialisation:                AFFINE_SHADE: width + 0xffff0001            -> width + 1
// keep: pixels = total < 0 ? 0 : whole + 1;  target[o] = source[(target[o] << 8) | uTexel]
```
With exactly this patch, my JS model reproduces the emulated frames bit for bit. Without it, every
cell has unshaded/misshaded pixels on its row y0+7 and column x0+7 (a visible lighter grid). Give
the Brother variant its own constant; do not change Kahn's.

## 8. 0x120e6: sub_picture(eax = x, edx = y), in place on [0x58440]

Copies every 3rd pixel of every 3rd row of the whole buffer (a 107x67 grid, cropped to 106x66)
into the rectangle x..x+105, y..y+65, **in place** (source and destination are the same buffer),
clipped to the screen.
```c
if (y > 199 || x > 319 || x + 106 < 0 || y + 66 < 0) return;
ys = max(y, 0);  ye = min(y + 66, 200);
xs = max(x, 0);  xe = min(x + 106, 320);
for (j = ys; j < ye; j++) {
    srow = (j == ys) ? 0 : 3 * (j - y);     // BUG kept: when y < 0 the first drawn row reads source row 0
                                            // (instead of 3*(-y)); later rows are correct
    src  = srow*320 + 3*(xs - x);
    for (i = xs; i < xe; i++, src += 3)
        buf[j*320 + i] = buf[src];          // sequential, so it reads pixels written earlier in this call
}
```
The destination row step is 320 (`214`, `214 - x` or `x` bytes skipped after the span). The emulated
function equals this model on 308 cases, random and at all the clip edges, and on the 8-call
phase-4 sequence. Do it in place, in this order. A copy-then-blit gives different pictures,
because the source rows 3j overlap the rows being written.

## 9. Verified JS (from `port.mjs`; outputs equal the emulated machine code on 49 frames)

```js
const f = Math.fround;
const K = 0.318309882798629;
const cvt = (x) => { const t = Math.trunc(x);   // call 0x199b2; fistp dword
  return (Number.isFinite(t) && t >= -2147483648 && t <= 2147483647) ? t : -2147483648; };
function matrix(a, b, c) { /* section 4 */
  const SA = Math.sin(a), CA = Math.cos(a), SB = Math.sin(b), CB = Math.cos(b), SC = Math.sin(c), CC = Math.cos(c);
  const sa = f(SA), ca = f(CA), sb = f(SB), cb = f(CB), sc = f(SC);
  const sbsc = f(SB * sc), sacc = f(SA * CC), cacc = f(CA * CC);
  return [f(sa * sbsc + cacc), f(CB * sc), f(sacc - ca * sbsc),
          f(sacc * sb - ca * sc), f(cb * CC), f(-cacc * sb - sa * sc),
          f(-sa * cb), sb, f(ca * cb)];
}
function point(m, X, Y, T) {      /* section 5, with O.x = O.y = 0 folded in */
  const x = X - 160, y = Y - 100, z = 256;
  let D = [0, 1, 2].map((r) => f((m[3 * r + 1] * y + m[3 * r] * x) + m[3 * r + 2] * z));
  const l2 = f((D[1] * D[1] + D[0] * D[0]) + D[2] * D[2]);
  if (l2 > 0) { const inv = 1 / Math.sqrt(l2); D = D.map((d) => f(d * inv)); }
  const Oz = f(-T * 270);
  const A = D[0] * D[0] + D[1] * D[1];
  const disc = f(0 * f(0) - (A * 4) * (0 - 70000));
  if (!(disc >= 0)) { return null; }          // unreachable
  const s = Math.sqrt(disc), inv = 1 / (f(A) * 2);
  const t1 = f((-0 + s) * inv), t2 = f((-0 - s) * inv);
  const tt = t1 >= t2 ? t2 : t1;
  const P = [f(D[0] * tt), f(D[1] * tt), f(f(D[2] * tt) + Oz)];
  const u = cvt(Math.abs(P[2]) * 0.2);
  const v = cvt(Math.abs(Math.atan2(P[1], P[0]) * 256 * K));
  let sh = 63 - cvt(Math.abs(P[2] - Oz) * 0.014);
  sh = sh > 63 ? 63 : sh < 0 ? 0 : sh;
  return [u, v, sh];
}
// frame (phase 1..4; t70 = [0x58470], t6c = [0x5846c]); tex/tab per phase = 2d2, 2d5, 2d6, 2d2
const Td = t70 * 0.01, T = f(Td);
const ang = [[T, f(-T * 0.6), f(Td * 0.2)], [0, f(Td * 0.9), f(-T * 0.2)],
             [0, T, f(-Td * 0.2)], [f(-Td * 1.2), 0, f(-Td * 0.3)]][phase - 1];
const m = matrix(...ang);
// g[ix][iy] = point(m, 8*ix, 8*iy, T) for ix 0..40, iy 0..25
const s16 = (v) => (v << 16) >> 16;
const V = (x, y, p, w) => ({ x, y, u: s16(p[w]), v: s16(p[1]) });   // w = 0: texture pass, w = 2: shade pass
for (let ix = 0; ix < 40; ix++) for (let iy = 0; iy < 25; iy++) {
  const x0 = ix * 8, y0 = iy * 8, A = g[ix][iy], B = g[ix][iy + 1], C = g[ix + 1][iy], R = g[ix + 1][iy + 1];
  for (const [p1, P1] of [[[x0, y0 + 7], B], [[x0 + 7, y0], C]]) {
    fillAffineTriangle(buf, tex, V(x0, y0, A, 0), V(p1[0], p1[1], P1, 0), V(x0 + 7, y0 + 7, R, 0), AFFINE_OPAQUE);
    fillAffineTriangle(buf, tab, V(x0, y0, A, 2), V(p1[0], p1[1], P1, 2), V(x0 + 7, y0 + 7, R, 2), AFFINE_SHADE /* Brother-patched, section 7 */);
  }
}
// then the sub_picture calls of section 3 with t = t6c, then show buf with the current DAC.
```

## 10. Globals

| addr | type | meaning |
|---|---|---|
| 0x5db14 / 18 / 1c | u8* | textures 2d2 / 2d5 / 2d6 (64K blocks) |
| 0x5db20 / 24 / 28 | u8* | their 6-bit palettes (malloc'ed, 768 bytes) |
| 0x5db2c / 30 / 34 | u8* | their shade tables (64K blocks) |
| 0x5d8c8 | u8* | texture used by 0x11a3c (set per phase) |
| 0x5d8cc | u8* | shade table used by 0x11a3c (set per phase) |
| 0x5daf0 | float[9] | camera matrix (0x5daf0..0x5db13) |
| 0x58578 | {i32 u,v,s}[41][26] | grid, column stride 0x138, entry 12 bytes, end 0x5b770 |
| 0x5846c | u32 | per-phase ticks (zeroed at each phase start) |
| 0x58470 | u32 | ticks since part 3's last reset = since part 4 start (camera) |
| 0x584ac | u32 | song position (order) |
| 0x58440 | u8* | the work buffer drawn, sub-pictured and copied to the screen |
| 0x58448 | u32* | row-offset table (y*320) used by 0x120e6 |
| 0x56a7a | u8 | bit 0 selects a software atan2 (0 here) |

What this part takes from the previous one: the rasteriser target `[0x53018]` = `[0x58440]`
(set by part 3), `[0x58470]` reset by part 3, and the DAC (the first frame shows part 3's last
picture in black). Nothing else; every frame overwrites all 64000 pixels.

## 11. Other things noticed

- 0x11fa1 (texture-only twin of 0x11e2c, using 0x11ac1 = 0x11a3c without the shade pass, grid
  entries u,v only at +0/+4) and the second caller of 0x11e2c belong to part 0x130f7, not this one.
- The capture shows a new picture about every 4 retraces (5 to 6 ticks per frame). The animation
  depends only on the tick counters, so a port at any frame rate gives the same pictures for the
  same tick values.
