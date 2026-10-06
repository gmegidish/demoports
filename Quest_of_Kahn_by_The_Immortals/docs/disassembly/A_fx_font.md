# Slice A: 0x10f60 .. 0x14239 — software rasteriser (hand-written asm) + bitmap font / loader text

The initial guess ("2D effects / wobbler") is wrong. This range is the demo's **hand-written assembly
rasteriser module** (no Watcom stack-check prologue, `pushal/popal`, self-contained globals at
0x52e10..0x53e93) followed by four small C functions for the bitmap font and the loader log.

| addr | size | name | live? | what |
|---|---|---|---|---|
| 0x10f60 | 0x29d | `sprite_scaled_blend` | live (1 call, sub_27434 @0x27506) | axis-aligned scaled 256x256 texture blit through the 64K blend table, clipped |
| 0x111fd | 0x29c | `sprite_scaled_blend_alt` | **dead** (no call/pointer anywhere) | same, blend table address taken from `bx` instead of 0x53e8c |
| 0x11499 | 0x529 | `tri_flat_ff` | **dead** | flat triangle fill with byte 0xFF, has x clipping |
| 0x119c2 | 0x4ca | `trap_persp_tex_blend` | live (0x1c36e in sub_1a5be, 0x2b3b1 in sub_29510) | perspective-correct textured trapezoid, 16-px subdivision, through blend table |
| 0x11e8c | 0x6cf | `tri_affine_tex_keyed` | live (0x27424, inside sub_24b54; the lister lost that part of sub_24b54, see Open questions) | affine textured triangle, texel 0 = transparent |
| 0x1255b | 0x407 | `trap_persp_tex` | live (0x1a5ad in sub_1880d, 0x29503 in sub_27670) | perspective-correct textured trapezoid, opaque |
| 0x12962 | 0x67f | `tri_affine_tex` | live (0x15353 in sub_152e0; 0x24015, 0x244bc, 0x24964, 0x24975, 0x24985 in sub_23cf0) | affine textured triangle, opaque |
| 0x12fe1 | 0x682 | `tri_shade_table` | live (0x2c73c in sub_2b3c0) | triangle that remaps the destination through a table with an interpolated 8-bit parameter (`dst = tab[dst][s]`) |
| 0x13663 | 0x69b | `tri_affine_tex_to_texture` | **dead** | like 0x12962 but renders into a 256x256 texture |
| 0x13cfe | 0x20 | `raster_setup` | live (main @0x10128, sub_1681a @0x16856) | sets target buffer, blend table, builds row-offset table |
| 0x13d20 | 0x1fd | `font_load` | live (main) | loads TEXTURES\STANDARD.AFT |
| 0x13f1d | 0x12b | `font_draw` | live (only from 0x14048) | draw string, one colour |
| 0x14048 | 0x144 | `font_draw_shadowed` | live (25 call sites) | draw string with a colour-0 drop shadow |
| 0x1418c | 0xad | `loader_log` | live (36 call sites) | scroll an 8-line log and repaint it over the loading picture |

`funclist.txt`/`kahn.lst` do not contain 0x111fd, 0x11499, 0x11e8c, 0x13663 (the lister only followed
calls it saw); I disassembled them directly from `obj1.bin`.

## Verification status (important)

I wrote Python reference models of every live rasteriser routine and compared them **byte for byte
against the real machine code executed in the Unicorn emulator** (code + data objects mapped at their
real addresses, FPU control word 0x127F):

| routine | model file (`$S/re/A/`) | test | result |
|---|---|---|---|
| 0x12962 / 0x11e8c / 0x12fe1 | `model_tri.py` | `test_tri.py` (3 seeds x 700 random triangles x 3 variants, y from -60..260, x in 0..319, 8- and 16-bit u/v), `test_tri2.py` (900 collinear / near-degenerate) | 0 mismatches |
| 0x119c2 / 0x1255b | `model_span.py` | `test_span.py` (2200 random trapezoids, both parts, widths -1..100) | 0 mismatches |
| 0x10f60 | `model_sprite.py` | `test_sprite.py` (600 random) + `test_sprite2.py` (400 edge cases at the clip limits) | 0 mismatches |

The pseudo-code below is a transcription of those models. If the prose and a model ever disagree,
the model is right. Harness: `$S/re/A/emu.py`. Not emulated: the font/log functions (simple compiled C,
read by hand; the file format was checked against the real file) and the dead routines.

Limits of the verification: triangles were only tested with all x in 0..319 (the routines have **no
x clipping**, see below), trapezoids only with sane inputs.

## FPU facts that matter here

- Runtime control word is **0x127F** (`fldcw [0x579f0]` at 0x3d27b): round-to-nearest-even, 53-bit
  precision. So every `fistp` in this module is `Math.round`-half-even of a double, and all FPU
  arithmetic is ordinary IEEE double arithmetic (JS numbers reproduce it exactly); values stored with
  `fstp dword` are `Math.fround`ed, values kept on the FPU stack are not.
- Side finding, outside my slice: helper **0x1f318 is not "round per current mode"**. It forces the
  control-word high byte to 0x1F (RC=11) around `frndint`, i.e. it **truncates toward zero** (C cast).
- `fistp` of NaN/inf/out-of-range stores 0x8000 (word) / 0x80000000 (dword).
- The Watcom start-up at 0x3d279 does `fninit; fldcw; fldz x4`. The triangle set-up needs 6 free FPU
  registers and the trapezoid fillers 6 as well, so the FPU stack must be empty when these are called
  (not checked where the four zeros get dropped).

## Globals of the rasteriser module (all in the data object)

| addr | type | meaning |
|---|---|---|
| 0x52e10 | u32[rows] | row offset table: `rowtab[i] = i*pitch` (built by 0x13cfe; 200 entries used) |
| 0x53e10 | u32 | per-call "texture pointer" (triangles: copy of struct[0]; 0x119c2 writes struct[0] at 0x53e12 so that the dword at 0x53e10 becomes the blend-table base, see there) |
| 0x53e14 | u16 | triangles: du/dx (8.8). Trapezoids: dword = second-part left step |
| 0x53e16 | u16 | triangles: dv/dx (8.8) |
| 0x53e18 | u32 | default destination buffer pointer (set by 0x13cfe) |
| 0x53e1c..0x53e4f | | scratch: edge steps, counters (see each routine) |
| 0x53e50..0x53e7f | float32[12] | trapezoid perspective scratch |
| 0x53e80,82,84 | u16 | sprite: du, (w-2), dv |
| 0x53e88, 0x53e8a | u16 | sprite: v start, u start (8.8) |
| 0x53e8c | u32 | pointer to the 64K blend table used by 0x10f60 (set by 0x13cfe) |
| 0x53e90 | u32 | sprite: row skip |

All initial values are 0 (`peek 53e10`), nothing here is a static data table.

---

## 0x13cfe `raster_setup(eax = pitch, edx = rows, ebx = dst buffer, ecx = blend table)`

```c
[0x53e8c] = ecx;            // blend table for sprite_scaled_blend
[0x53e18] = ebx;            // destination buffer for every triangle/trapezoid routine
for (i = 0; i < edx; i++) rowtab[i] /*0x52e10*/ = i * eax;      // do-while: edx must be >= 1
```
Callers: main `raster_setup(320 [0x59384], 200 [0x59388], workA [0x593a0], 0)`; sub_1681a at 0x16856
`raster_setup(320, 200, workA, [0x5c794])` — [0x5c794] is the 64K blend table that part's sprites use.

Everything else in the module hard-codes 320 and 200 (0x140, 0xc8/0xc7, 0x1400000) regardless.

---

## 0x10f60 `sprite_scaled_blend(eax = p0, edx = p1, ebx = texture, ecx = dst buffer)`

Draws the whole 256x256 texture scaled into the rectangle p0..p1, blended through the table at
[0x53e8c]. `p0 = (y0 << 16) + x0`, `p1 = (y1 << 16) + x1` as built by the caller with a 32-bit add —
so **a negative x borrows from the y field**; the routine works on the two 16-bit halves of that sum.
`ebx` must be 64K-aligned (its low word is used as the initial u and v, i.e. 0).

Caller sub_27434 (0x27506): `ebx = [obj+0x31]`, `ecx` = its own second argument (edx), corners from
truncated floats.

```c
x0 = (int16)p0;  y0 = (int16)(p0 >> 16);      // halves of the packed sums, NOT the caller's originals
x1 = (int16)p1;  y1 = (int16)(p1 >> 16);
if (x0 >= 320 || x1 < 0 || (int32)p0 >= 0x00c80000 || (int32)p1 < 0) return;
d = p1 - p0;  w = (int16)d;  h = (int16)(d >> 16);     // 32-bit subtract, then halves
if (w < 2) return;   du = (0x10000 / w) & 0xffff;      // unsigned 8.8 texel step
if (h < 2) return;   dv = (0x10000 / h) & 0xffff;
q = 0;                                                  // offset into dst
if ((int32)p0 < 0) { h += y0; v = ((-y0) * dv) & 0xffff; } else { v = 0; q += rowtab[y0]; }
if ((int32)(p1 - 0x00c70000) >= 0) h -= (uint32)(p1 - 0x00c70000) >> 16;   // y1 >= 199: h -= y1-199
if (x0 < 0)         { w += x0; u = ((-x0) * du) & 0xffff; } else { u = 0; q += x0; }
if (x1 - 319 >= 0)  w -= x1 - 319;
// rows: do { ... } while (--h > 0)  => max(h,1) rows; a clipped rectangle never reaches row 199 /
// column 319 unless w or h collapsed (see the quirk)
n = w - 2;
for (row = 0; row < max(h, 1); row++) {
    npx = (n >= 0) ? w : ((n & 1) ? 3 : 2);
    uu = u;
    for (i = 0; i < npx; i++) {
        t = tex[((v >> 8) << 8) | (uu >> 8)];
        d = dst[q + i];
        dst[q + i] = (i & 1) ? table[(d << 8) | t]      // odd pixel of a pair
                             : table[(t << 8) | d];     // even pixel (and the last one of an odd width)
        uu = (uu + du) & 0xffff;
    }
    q += (n >= 0) ? 320 : npx + 320 - w;                // quirk, see below
    v = (v + dv) & 0xffff;
}
```
- The index order alternates per pixel (`table[texel][dst]` for even pixels, `table[dst][texel]` for
  odd ones). For a symmetric table (additive, average) this is invisible; keep it for exactness.
- Quirk (verified): when clipping leaves `w` of 0 or 1 (x1 is 0/1, or x0 is 318/319) the routine still
  writes 2 or 3 pixels per row and advances by 322-w / 323-w bytes per row, i.e. it draws a short
  sheared streak. Same idea vertically: clipped `h == 0` still draws one row.
- u, v are 8.8 and wrap at 256 (cannot exceed 255.x here anyway).

### 0x111fd (dead)
Byte-identical except for three instructions: the table pointer is `edx = ebx << 16` instead of
`[0x53e8c]`, so `ebx` would be `(texture & 0xffff0000) | (table >> 16)` (the convention 0x119c2 uses).
Never called.

---

## 0x119c2 `trap_persp_tex_blend(eax = S)` and 0x1255b `trap_persp_tex(eax = S)`

Fill a trapezoid pair (the two halves of a triangle; **the caller has already done the edge set-up and
all clipping**) with a perspective-correct texture. Perspective is evaluated exactly every 16 pixels
(double-precision `1/(1/z)`), with linear 8.8 interpolation in between.

### Parameter block S (0x50 bytes), same for both
```
+00 u32   0x1255b: texture pointer (64K aligned, low word ignored)
          0x119c2: (texture & 0xffff0000) | (blendTable >> 16)   // both 64K aligned
+04 i32   L0: byte offset of the left end of the first scanline in the dst buffer (y*320 + x)
+08 i32   R0: byte offset of the right end of the first scanline (inclusive)
+0c i32   left edge step per scanline, part 1, 16.16, must already include +320.0 (0x01400000)
+10 i32   left edge step, part 2
+14 i32   right edge step, part 1 (16.16, incl. +320.0)
+18 i32   right edge step, part 2
+1c f32   A = step of 1/z per 16 pixels in x
+20 f32   B = step of u/z per 16 pixels in x
+24 f32   C = step of v/z per 16 pixels in x
+28 f32   step of 1/z per scanline along the left edge, part 1
+2c f32   same, part 2
+30 f32   step of u/z per scanline, part 1
+34 f32   same, part 2
+38 f32   step of v/z per scanline, part 1
+3c f32   same, part 2
+40 f32   1/z at the left end of the first scanline
+44 f32   u/z there
+48 f32   v/z there
+4c i16   rows1: number of scanlines of part 1 (<= 0: none)
+4e i16   rows2: part 2 draws rows2 + 1 scanlines if rows2 > 0, else nothing
```
u and v are in 8.8 texel units (u = 256 * texel column); only bits 8..15 select the texel
(`tex[(vInt << 8) | uInt]`, 256x256, wrapping). Destination base is [0x53e18].
Evidence: field copies at 0x119c3..0x11a5f / 0x1255c..0x125f2.

### Pseudo-code (0x119c2 = `blend`, 0x1255b = `!blend`)
```c
A = S.f1c; B = S.f20; C = S.f24;                    // float32 values
ooz = S.f40; uoz = S.f44; voz = S.f48;              // float32, live in 0x53e68/6c/70
dooz = S.f28; duoz = S.f30; dvoz = S.f38;
lstep = S.i0c; rstep = S.i14;
if (blend) { L = S.i04;     R = S.i08 + 1; lfrac = 0x8001; }
else       { L = S.i04 - 2; R = S.i08 - 1; lfrac = 0x8000; }   // first pixel is written at L+2
rfrac = 0x8000;                                     // 16-bit fraction accumulators
Z = 1.0 / ooz;                                      // double; stays on the FPU stack between scanlines

scanline():
    V0 = fist32(voz * Z);  U0 = fist32(uoz * Z);    // double multiply, round-half-even to int32
    uoz_n = fround(uoz + B);  voz_n = fround(voz + C);
    t = ooz + A;  ooz_n = fround(t);  Z = 1.0 / t;  // NOTE: divides the UNROUNDED double sum
    width = (R - L) & 0xffffffff;                   // = S.i08 - S.i04 + 1 on the first line, both variants
    ch = (width >> 4) & 0xff;  rem = width & 15;
    if (blend) { if (rem == 0) { ch = (ch - 1) & 0xff; if ((int8)ch >= 0) rem = 16; } }
    else       { if (rem == 0) { rem = 16; ch = (ch - 1) & 0xff; } }
    blocks = (int8)(ch - 1) + 1;                    // number of full 16-pixel blocks (<= 0: none)
    q = blend ? L : L + 2;                          // dst offset of the next pixel
    for (b = 0; b < blocks; b++) {
        V1 = fist32(voz_n * Z);  voz_n = fround(voz_n + C);
        U1 = fist32(uoz_n * Z);  uoz_n = fround(uoz_n + B);
        t = ooz_n + A;  ooz_n = fround(t);  Znext = 1.0 / t;
        run(U0, V0, U1, V1, 16);
        U0 = U1; V0 = V1; Z = Znext;
    }
    V1 = fist32(voz_n * Z);  U1 = fist32(uoz_n * Z);          // always a full 16-px step ahead
    uoz = fround(uoz + duoz);  voz = fround(voz + dvoz);      // next scanline start
    t = ooz + dooz;  ooz = fround(t);  Z = 1.0 / t;
    run(U0, V0, U1, V1, rem);
    f = lfrac + (lstep & 0xffff);  lfrac = f & 0xffff;  L += (int16)(lstep >> 16) + (f >> 16);
    f = rfrac + (rstep & 0xffff);  rfrac = f & 0xffff;  R += (int16)(rstep >> 16) + (f >> 16);

run(U0, V0, U1, V1, n):                             // linear 8.8 stepping, all registers 32 bit
    edx  = (V0 & 0x00ffffff) | ((U0 & 0xff) << 24); // dh = v texel, dl = v fraction, top byte = u fraction
    dU   = (U1 - U0) & 0xffffffff;
    dV   = ((int16)(V1 - V0)) >> 4;                 // low 16 bits of the difference, arithmetic shift
    ebp  = (((dU >> 4) & 0xff) << 24) | (dV & 0xffff);
    uInt = (dU >> 12) & 0xff;
    bl   = (U0 >> 8) & 0xff;
    repeat n times:
        texel = tex[(((edx >> 8) & 0xff) << 8) | bl];
        dst[q] = blend ? table[(texel << 8) | dst[q]] : texel;   q++;
        edx += ebp;  carry = edx >> 32;  edx &= 0xffffffff;
        bl = (bl + uInt + carry) & 0xff;

for (i = 0; i < rows1; i++) scanline();
if (rows2 > 0) {
    lstep = S.i10; rstep = S.i18; dooz = S.f2c; duoz = S.f34; dvoz = S.f3c;
    for (i = 0; i < rows2 + 1; i++) scanline();     // yes, rows2 + 1 (loop counter is not pre-decremented)
}
```
Notes
- `edx` must really be kept as a 32-bit value: bits 16..23 hold V's bits 16..23 and collect the
  carries of the 16-bit v additions; when that byte overflows it bumps the u fraction by 1/256.
  The model does this and matches the code exactly.
- Exactness of the float sequence matters for bit-identical texel selection: `ooz`, `uoz`, `voz` and
  their `_n` copies are float32 in memory, each sum is done in double and rounded to float32 when
  stored, but the reciprocal uses the double sum before rounding.
- Width 0 (`R == L`, i.e. S.i08 == S.i04 - 1): 0x119c2 draws nothing; **0x1255b draws 16 pixels**
  (missing the `ch < 0` test at 0x1269b). Negative widths draw garbage in both (not guarded).
- 0x119c2: the table base is the dword at 0x53e10 = `(S[0] & 0xffff) << 16 | word[0x53e10]`; the low
  word at 0x53e10 is whatever the last triangle call left there, which is 0 as long as textures and
  tables are 64K-aligned (they are, 0x10734).
- Exact differences 0x1255b vs 0x119c2: no table lookup; `L-2`/`R-1` pre-decrement style; `lfrac`
  starts at 0x8000 instead of 0x8001; the zero-width behaviour above. Nothing else.
- Both leave the FPU stack as they found it (4 temporaries popped at the end).

---

## Triangles: 0x12962 `tri_affine_tex`, 0x11e8c `tri_affine_tex_keyed`, 0x12fe1 `tri_shade_table` (eax = T)

The three share one set-up, instruction for instruction (only difference: one `inc` in the flat-bottom
case, noted below). They take three vertices, sort them, clip in **y only**, and draw with affine
(linear) u,v. There is **no x clipping**: x is read as an unsigned 16-bit value and added to the buffer
pointer, so the callers must supply 0 <= x <= 319.

### Parameter block T (0x1c bytes)
```
+00 u32   0x12962 / 0x11e8c: texture pointer (64K aligned; texel = tex[(v << 8) | u])
          0x12fe1:           64K table pointer (pixel = tab[(dst << 8) | s])
+04 vertex 0:  i16 x, i16 y, u16 u, u16 v
+0c vertex 1
+14 vertex 2
```
Only the **low byte** of u and v is the starting texel coordinate of a vertex; the differences between
vertices are taken on the full 16-bit words (so u may run 0..256+ across a triangle and wraps mod 256
when sampled). For 0x12fe1 `u` is the 8-bit table parameter `s` and `v` is ignored (it is still
interpolated).

Wrapper sub_152e0 (0x152e0): `(eax=x0, edx=y0, ebx=x1, ecx=y1, stack: x2, y2, u0, v0, u1, v1, u2, v2)`
builds T on its stack with `T[0] = [0x59540]` and calls 0x12962.

### Pseudo-code (`variant` = OPAQUE 0x12962, KEYED 0x11e8c, SHADE 0x12fe1)
```c
key(v) = (int32)(((v.y & 0xffff) << 16) | (v.x & 0xffff));       // y major, x minor, signed compare
if (any two vertices have the same key) return;
T, M, B = vertices sorted by key ascending;                      // top, middle, bottom
if (key(B) < 0) return;                 // whole triangle above the screen (y < 0)
if (key(T) >= 0x00c80000) return;       // top y >= 200
if (B.y == T.y) return;

dxb = (int16)(B.x - T.x);  dxm = (int16)(M.x - T.x);
dyb = (int16)(B.y - T.y);  dym = (int16)(M.y - T.y);  dy2 = dyb - dym;
dub = (int16)(B.u - T.u);  dum = (int16)(M.u - T.u);             // 16-bit word differences
dvb = (int16)(B.v - T.v);  dvm = (int16)(M.v - T.v);

// constant horizontal gradients, 8.8, computed in double:
D    = dxb*dym - dxm*dyb;               // exact
invD = 1.0 / D;
dudx = fist16((dub*256*dym - dum*256*dyb) * invD) & 0xffff;      // round-half-even; 0x8000 if D == 0
dvdx = fist16((dvb*256*dym - dvm*256*dyb) * invD) & 0xffff;

slope_long = trunc(dxb * 65536 / dyb);                           // idiv: truncates toward zero
edge(du, dv, dy):                                                // per-scanline 8.8 steps along an edge
    return [ ((trunc(du*65536/dy) & 0xffffffff) >>> 8) & 0xffff,
             ((trunc(dv*65536/dy) & 0xffffffff) >>> 8) & 0xffff ];

wacc = 0;                               // span width accumulator, 16.16, 32-bit wrapping
if (dym == 0) { wacc = (dxm & 0xffff) << 16; rows1 = 0; slope_tm = 0; leftmid = false; }   // flat top
else          { slope_tm = trunc(dxm*65536/dym); rows1 = dym; leftmid = slope_tm < slope_long; }

if (leftmid) {                          // M is on the left: left edge T->M then M->B, right edge T->B
    wstep1 = slope_long - slope_tm;     lstep1 = slope_tm + 0x01400000;
    [du1, dv1] = edge(dum, dvm, dym);
    if (dy2 == 0) { if (variant != SHADE) rows1 += 1;  rows2 = 0; }       // flat bottom
    else {
        slope_mb = trunc((int16)(B.x - M.x) * 65536 / dy2);
        wstep2 = slope_long - slope_mb;  lstep2 = slope_mb + 0x01400000;
        [du2, dv2] = edge((int16)(B.u - M.u), (int16)(B.v - M.v), dy2);
        rows2 = dy2 + 1;
    }
} else {                                // M on the right: left edge is the long edge T->B throughout
    wstep1 = slope_tm - slope_long;
    [du1, dv1] = [du2, dv2] = edge(dub, dvb, dyb);
    slope_mb = trunc((int16)(B.x - M.x) * 65536 / dy2);                   // dy2 != 0 here always
    wstep2 = slope_mb - slope_long;  rows2 = dy2 + 1;
    lstep1 = lstep2 = slope_long + 0x01400000;
}
// (all *step values are kept mod 2^32)

if (B.y >= 200) {                       // bottom clip: last drawn row is 199
    rows2 = (int16)(rows2 - (B.y - 199));
    if (rows2 < 0) { rows1 = (int16)(rows1 + rows2); rows2 = 0; }
}

u = T.u & 0xff;  v = T.v & 0xff;  vfx = 0;
if (T.y >= 0) { p = (T.x & 0xffff) + rowtab[T.y];  lfrac = 0x8000; }
else {                                  // top clip
    n = -T.y;
    if (rows1 - n >= 0) {               // start row 0 lies in part 1
        rows1 -= n;
        prod = n * (int32)(lstep1 - 0x01400000);            // 16.16, exact
        f = (prod & 0xffff) + 0x8000;
        p = (T.x & 0xffff) + (prod >> 16) + (f >> 16);  lfrac = f & 0xffff;   // >> is floor
        u = (((u << 8) + n*du1) & 0xffff) >> 8;
        v = (((v << 8) + n*dv1) & 0xffff) >> 8;
        wacc = (wacc + n*wstep1) & 0xffffffff;
    } else {                            // part 1 is entirely above the screen
        m = n - rows1;  rows2 = (int16)(rows2 + rows1 - n);
        if (lstep1 == lstep2) {         // i.e. the "M on the right" layout: keep walking the long edge
            prod = n * (int32)(lstep1 - 0x01400000);  f = (prod & 0xffff) + 0x8000;
            p = (T.x & 0xffff) + (prod >> 16) + (f >> 16);  lfrac = f & 0xffff;
            u = (u + (((n*du1) & 0xffff) >> 8)) & 0xff;     // fractions dropped here
            v = (v + (((n*dv1) & 0xffff) >> 8)) & 0xff;
        } else {                        // restart from M along M->B
            prod = m * (int32)(lstep2 - 0x01400000);  f = (prod & 0xffff) + 0x8000;
            p = (M.x & 0xffff) + (prod >> 16) + (f >> 16);  lfrac = f & 0xffff;
            e = (((M.v & 0xff) << 16) | (M.u & 0xff))       // one 32-bit add, carries propagate
              + ((((m*dv2) & 0xffff) << 8) | (((m*du2) & 0xffff) >> 8));
            u = e & 0xff;  v = (e >> 16) & 0xff;  vfx = (e >> 24) & 0xff;   // vfx is 0 or 1
        }
        wacc = (-(wstep2 * (rows2 & 0xffff))) & 0xffffffff; // width measured back from the bottom vertex
        rows1 = 0;
    }
}
ufrac = 0x80;  v16 = (v << 8) | 0x80 | vfx;                 // u fraction, v as 8.8; both start at .5
wacc += (variant == OPAQUE) ? 1 : (variant == KEYED) ? 0 : 0xffff0001;   // mod 2^32
ebp   = ((dudx & 0xff) << 24) | dvdx;   duInt = (dudx >> 8) & 0xff;

rows(count, lstep, wstep, du, dv):
    repeat count times:
        tot = (int32)(wacc + lfrac);    N = tot >> 16;                    // arithmetic shift
        npx = (variant == SHADE) ? (tot < 0 ? 0 : N + 1) : max(N, 0) + 1;
        edx = (ufrac << 24) | v16;  bl = u;                               // 32-bit, as in run() above
        for (i = 0; i < npx; i++) {
            if (variant == SHADE)      dst[p+i] = tab[(dst[p+i] << 8) | bl];
            else { t = tex[(((edx >> 8) & 0xff) << 8) | bl];
                   if (variant == OPAQUE || t != 0) dst[p+i] = t; }
            edx += ebp;  carry = edx >> 32;  edx &= 0xffffffff;
            bl = (bl + duInt + carry) & 0xff;
        }
        f = lfrac + (lstep & 0xffff);  lfrac = f & 0xffff;
        p += (lstep >>> 16) + (f >> 16);                    // integer step taken as UNSIGNED 16 bit
        e = ((ufrac << 24) | v16) + (((du & 0xff) << 24) | dv);           // left-edge u,v step
        carry = e >> 32;  ufrac = (e >> 24) & 0xff;  v16 = e & 0xffff;
        u = (u + (du >> 8) + carry) & 0xff;
        wacc = (wacc + wstep) & 0xffffffff;

if (rows1 > 0) rows(rows1, lstep1, wstep1, du1, dv1);
if (rows2 > 0) rows(rows2, lstep2, wstep2, du2, dv2);       // p, lfrac, u, v, wacc carry over
```
Notes
- Coverage: OPAQUE/KEYED draw `floor(width)+1` pixels per row and include the bottom row (both edges
  inclusive, at least 1 pixel per row even for negative widths). SHADE draws one pixel less per row,
  nothing for negative widths, and no extra row on a flat bottom — so adjacent SHADE triangles do not
  double-blend shared edges.
- The same 32-bit `edx` carry subtlety as in `run()` applies (bits 16..23 start at 0 each row).
- In SHADE the v part of `edx` is computed but unused.
- State at 0x53e10 is left equal to T[0]; nothing else persists that matters.
- Where each piece lives (0x12962 numbering): sort 0x12979..0x129bf; gradients 0x129fa..0x12ad6;
  edge set-up 0x12adc..0x12c71; bottom clip 0x12c7c; top clip 0x12ccf..0x12e3d; row loop 0x12ec3;
  switch to part 2 0x12f79.
- Differences between the three (complete list):
  - 0x12e83 `add eax,1` (OPAQUE) / 0x123ad `add eax,0` (KEYED) / 0x134fb `add eax,0xffff0001` (SHADE)
  - flat-bottom `inc word [0x53e3c]` present at 0x12b7d and 0x120a7, absent in 0x12fe1 (0x131f6)
  - inner loops: plain store / skip zero texels (0x12416..0x124a4) / `tab[dst][s]` with the
    `tot < 0` row skip (0x13558..0x135ad)

### 0x13663 (dead) `tri_affine_tex_to_texture`
Same as 0x12962 (OPAQUE, `add eax,1`, with the flat-bottom `inc`) with these changes: T[0] is
`(srcTexture & 0xffff0000) | (dstTexture >> 16)`; destination pitch 256 (`0x01000000` instead of
`0x01400000`, row offset `y << 8`), clip limits 256/255 instead of 200/199; [0x53e18] is saved and
restored around the call. No caller exists.

### 0x11499 (dead) `tri_flat_ff`
`eax` -> `{u32 dstBuffer; {i16 x, i16 y} v[3]}`. Sorts the vertices (x biased by +16000 during the
sort), fills the triangle with byte 0xFF using `rep stosd`, with a per-scanline x-clipped path when
any x is outside 0..319. Shares the 0x53e1c.. scratch layout. No caller exists; not documented further.

---

## Font

### On-disk format of TEXTURES\STANDARD.AFT (from 0x13d20, checked against the real 2627-byte file)
```
offset 0   u8  cellW   = 12
offset 1   u8  cellH   = 13
offset 2   u8  bpp     = 1          (bits per pixel; code handles any divisor of 8)
offset 3   cellW*cellH*128*bpp/8 bytes of pixel data = 2496 bytes
           one continuous LSB-first bit stream, NOT padded per row or per glyph:
           pixel index k (0 .. cellW*cellH*128-1) = (data[k >> 3] >> (k & 7)) & 1   (for bpp = 1)
           glyph c, row r, column x  ->  k = c*cellW*cellH + r*cellW + x
offset 2499  u8 width[128]          advance/visible width of each glyph in pixels
total 3 + 2496 + 128 = 2627 bytes   (matches the file exactly; nothing follows)
```
128 glyphs indexed by ASCII code. Decoding the real file with this layout gives clean glyphs
('A', 'g', 'W', '1' checked); all pixel values are 0/1.

For bpp > 1 the loader's rule is: split each byte into bits LSB first, pixel j of the byte =
`sum(bit[bpp*j + i] << i)`, `8/bpp` pixels per byte.

Width table as stored in the file (index = character code):
```
  0: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
 16: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
 32: 8 2 3 2 2 7 2 2 3 3 7 5 2 4 2 5      ' ' ! " # $ % & ' ( ) * + , - . /
 48: 5 2 5 5 6 5 6 5 5 5 2 2 4 4 4 5      0 1 2 3 4 5 6 7 8 9 : ; < = > ?
 64: 2 8 7 6 7 6 6 6 7 3 6 9 6 9 7 6      @ A B C D E F G H I J K L M N O
 80: 6 7 8 5 7 7 7 12 7 9 6 2 5 2 2 6     P Q R S T U V W X Y Z [ \ ] ^ _
 96: 2 6 6 5 6 5 5 7 7 3 3 7 3 10 7 6     ` a b c d e f g h i j k l m n o
112: 6 7 5 5 4 7 7 10 6 6 5 3 2 3 2 2     p q r s t u v w x y z { | } ~ DEL
```
(Width 2 = glyph not present. After loading, the loader does `width[0x20]--`, so space is **7**.)

### In-memory font state (0x594a8, 13 bytes)
```
0x594a8  u8*  glyphs   malloc(cellW*128*cellH) = 19968 bytes, one byte per pixel (0/1)
0x594ac  u8*  width    malloc(128)
0x594b0  u8   cellW (12)
0x594b1  u8   cellH (13)
0x594b2  u8   bpp (1)
0x594b3  u16  cellW*cellH (156) = bytes per glyph
```

### 0x13d20 `font_load(eax = filename)`
```c
fp = sub_23599(filename, "rb" /*0x50338*/);                 // fopen
sub_2364d(&w, 1, 1, fp); sub_2364d(&h, 1, 1, fp); sub_2364d(&bpp, 1, 1, fp);   // fread(ptr,1,1,fp)
ppb = 8 / bpp;                                              // pixels per byte
[0x594b0] = w; [0x594b1] = h; [0x594b3] = (u16)(w*h); [0x594b2] = bpp;
glyphs = sub_23828(w*128*h);  width = sub_23828(128);       // malloc
for (k = 0; k < h*128*w; k += ppb) {
    fread(&b, 1, 1, fp);
    for (i = 0; i < 8; i++) bit[i] = (b >> i) & 1;
    for (j = 0; j < ppb; j++) { px = 0; for (i = 0; i < bpp; i++) px += bit[bpp*j + i] << i;  glyphs[k + j] = px; }
}
for (i = 0; i < 128; i++) fread(&width[i], 1, 1, fp);
width[0x20]--;
sub_2390b(fp);                                              // fclose
```
No error handling (a missing file crashes). Called once from main: `font_load("textures\standard.aft")`.

### 0x13f1d `font_draw(eax = dst buffer, edx = x, ebx = y, ecx = string, stack[0] = colour)`, `ret 4`
```c
idx = 0;                                   // u8 index: strings longer than 255 chars wrap
rowoff = rowtab[y];                        // 0x593a8 table (y*320), NOT 0x52e10
for (;;) {
    c = (u8)str[idx];  if (c == 0) return;
    cw = width[c];
    idx++;
    src = c * [0x594b3];                   // offset into glyphs
    d   = rowoff + x;
    for (r = 0; r < cellH; r++, src += cellW, d += [0x59384] /*320*/)
        for (i = 0; i < cw; i++)           // only the first width[c] columns are drawn
            if (glyphs[src + i] != 0) dst[d + i] = colour;
    x += cw + 2;                           // 2 pixels letter spacing
    if ((u32)(x + width[(u8)str[idx]]) > (u32)([0x59384] - 1)) {   // next glyph would cross x = 319
        y += cellH + 2;  rowoff = rowtab[y];  x = 0;               // wrap to column 0, 15 px lower
    }
}
```
No clipping, no bounds check on `c >= 128` (reads past both tables). The wrap test also runs for the
terminating 0 (width[0] = 2).

### 0x14048 `font_draw_shadowed(eax = dst, edx = x, ebx = y, ecx = string, stack[0] = colour)`, `ret 4`
```c
font_draw(dst, x + 1, y + 1, string, 0);
font_draw(dst, x,     y + 1, string, 0);
font_draw(dst, x,     y,     string, colour);     // third pass is an inlined copy of font_draw
```
(The shadow at x+1 can wrap one glyph earlier than the text on very long lines; that is what the code does.)
Call sites: 0x147ed, 0x14830, 0x14851, 0x14883, 0x14f23, 0x14f66, 0x14fab, 0x14fd7, 0x161ac, 0x1670c,
0x1672d, 0x16b79, 0x16b9a, 0x16bdf, 0x17157, 0x1719c, 0x171d9, 0x1720b, 0x18383, 0x1cdc4, 0x1cddf,
0x1cdfa, 0x1ce15, 0x1ce30, and 0x1421e (loader_log).

### 0x1418c `loader_log(eax = message)`
State: [0x594b8] -> 0xF0 bytes = 8 lines x 30 bytes (allocated and zeroed by sub_14239, which also
loads "textures\loading.gif" into work buffer B [0x593a4]).
```c
for (i = 1; i < 8; i++) strcpy(line[i-1], line[i]);     // sub_23a4e(eax = dst, edx = src); line[i] = base + i*30
strcpy(line[7] /* base + 0xd2 */, message);             // no length check: messages must be < 30 chars
sub_23a6d([0x593a0], [0x593a4], 0xfa00);                // memcpy(workA, workB, 64000): restore the picture
for (i = 0; i < 8; i++)
    font_draw_shadowed([0x593a0], 30, i*16 + 46, line[i], 0x1c /*colour 28*/);
sub_1067c([0x593a0]);                                   // flip workA to the screen
```
So the newest message is the bottom line (y = 158), older ones scroll up (y = 46, 62, ... 158).

---

## Open questions

1. `sub_24b54` (0x24b54, 10464 bytes): `kahn.lst` stops at 0x25fc0, yet the code up to 0x27434 is live
   and contains the only call of 0x11e8c (0x27424, parameter block at 0x5cfd4). Whoever owns that range
   has to disassemble 0x25fc0..0x27434 from `obj1.bin` (my `$S/mydis.py START END` does it).
2. The sprite blend table [0x53e8c] is 0 after main's `raster_setup` and only becomes [0x5c794] when
   part sub_1681a starts (0x1683f). What kind of table 0x5c794 is (additive? average?) belongs to that
   slice. If sub_27434 were ever reached before sub_1681a, it would read through a null table pointer;
   and parts after sub_1681a keep using the 0x5c794 table.
3. FPU stack depth: start-up leaves four `fldz` values on the stack; these routines need six free
   registers. Not traced where the stack is emptied.
4. Callers must guarantee 0 <= x <= 319 for the three triangle routines and sane spans for the two
   trapezoid routines (none of them clips in x). I did not verify that the callers do; if they do not,
   the original writes outside the 64000-byte buffer and a port needs a guard.
5. Trapezoid block field names (+1c..+48) are inferred from how the filler uses them; the two callers
   (sub_1880d/sub_1a5be and sub_27670/sub_29510) should confirm, in particular why part 2 is given
   `rows2` meaning "rows2 + 1 scanlines".
6. The font/log functions were read, not emulated. Risk is low (plain compiled C), and the AFT layout
   was confirmed on the real file.
