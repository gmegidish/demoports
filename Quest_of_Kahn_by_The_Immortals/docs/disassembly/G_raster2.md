# G_raster2 — KAHN.EXE 0x27514 .. 0x2c750: triangle clip / project / setup front-ends

## 0. Headline finding (read this first)

None of the three big functions contains a pixel loop. Each one is a C front-end that
near-clips, projects, screen-clips (by recursive subdivision), then fills a parameter block and
calls a hand-written assembly span rasteriser that lives OUTSIDE this slice:

| C front-end (this slice) | what it draws | param block | asm rasteriser (outside slice) |
|---|---|---|---|
| `sub_27670(face, stage)` | opaque perspective-correct textured triangle | global `0x5cff0` (0x50 bytes) | `sub_1255b(eax=0x5cff0)` |
| `sub_29510(face, stage, table)` | same, but each pixel goes through a 64K blend table with the destination (translucent texture) | global `0x5d050` (same layout) | `sub_119c2(eax=0x5d050)` |
| `sub_2b3c0(face, stage, table)` | Gouraud "table shade" triangle: one 8-bit value interpolated, `dst = table[dst<<8 \| c]` | 0x1c-byte block on the stack | `sub_12fe1(eax=block)` |

Because the brief asks for the inner loops, section 5 documents `sub_1255b` completely (it is
small) and section 6.3 / 7.4 give the parts of `sub_119c2` / `sub_12fe1` I read to pin the block
field meanings. Those three belong to whoever reads 0x10f60..0x13cfe; treat my notes on them as a
cross-check, not as the primary description (119c2 and 12fe1 were only partly read by me).

All float→int conversions written `trunc()` are `call 0x1f318` + `fistp` (0x1f318 sets RC=chop:
C-style `(int)` truncation toward zero). Plain `fistp` without the helper (only inside the asm
rasterisers) is round-to-nearest-even.

Verification method: straight-line FPU code was decoded with a symbolic x87 stack tracer
(`$S/re/g2/fpu.py START END`) rather than by eye; branch joins were re-checked by hand.

## 1. Structures (evidence = the code in this slice)

### Vertex (size ≥ 0x38; local copies are spaced 0x40 bytes)
```
+0x18 float x   camera-space x            (after projection: screen x, pixel units)
+0x1c float y   camera-space y            (after projection: screen y)
+0x20 float z   camera-space z (depth)    (after projection: 1/z)
+0x30 float u   texel units (0..256 = one texture width; 27670/29510: after projection u/z)
                 in sub_2b3c0: the shade value c (0..255 float), NOT divided by z
+0x34 float v   (27670/29510: after projection v/z).  sub_2b3c0 never reads it itself
                 (its clip helpers interpolate it, result unused)
```
"P" below = pointer to vertex+0x18 (so P.x=[+0], P.y=[+4], P.z=[+8]); "V" = vertex base.
Nothing else in the vertex is touched here. Original vertices are never written: all results go
to local copies.

### Face (0x35 = 53 bytes each; size from callers `imul reg, idx, 0x35`)
```
+0x00 Vertex* v[3]
+0x18 float[3]  (passed to sub_23b6c by callers together with sum of the 3 vertex positions:
                 face normal for the back-face test; not used in this slice)
+0x28 u16, +0x2a u16   written (1, 0) by caller sub_1c893 before drawing; not used here
+0x30 u8   flags: selects the drawer in the callers (section 8)
+0x31 u8*  texture pointer (UNALIGNED dword), 256x256, 64K-aligned  (27670 and 29510 only)
```
The functions also accept a fake "face" that is just 3 vertex pointers on the stack (the
recursion, with stage != 0, never reads +0x31).

### Object (from callers 0x14294 etc.): `+0x10` Face* array, `+0x18` int face count.

## 2. Globals

| addr | type | meaning |
|---|---|---|
| 0x59384 / 0x59388 | int | screen width 320 / height 200 |
| 0x5938c / 0x59390 | float | screen centre cx, cy (w*0.5-0.5, h*0.5-0.5) |
| 0x5c99c / 0x5c9a0 | float | projection scale x / y (written by 0x18253, 0x2d222, 0x2f505: camera setup, outside slice) |
| 0x593a8 | int* | row offset table (y*width) |
| 0x54730 | float32 const 1.0 | near plane z |
| 0x51920, 0x5193c, 0x51958 | float64 const 0.5 | (27670, 29510, 2b3c0 copies) |
| 0x51928, 0x51944, 0x51960 | float64 const -0.5 | |
| 0x51930, 0x5194c | float32 16.0 | |
| 0x51934, 0x51950 | float32 256.0 | |
| 0x51938, 0x51954 | float32 65536.0 | |
| 0x52bcc | float32 0.0625 | (shared by 27670 and 29510) |
| 0x5cff0..0x5d03f | block | rasteriser block of sub_27670 (section 4) |
| 0x5d040 | u8 | "gradients valid" flag for sub_27670 |
| 0x5d044 / 0x5d048 / 0x5d04c | float | d(1/z)/dy, d(256·u/z)/dy, d(256·v/z)/dy (per scanline at constant x) |
| 0x5d050..0x5d09f, 0x5d0a0, 0x5d0a4/a8/ac | | exact same things for sub_29510 (every address +0x60) |
| 0x53e18 | u8* | destination frame buffer base, used by the asm rasterisers (set by sub_13cfe, outside slice) |
| 0x53e10 | u8* | 64K table pointer used by 119c2 / 12fe1 |

## 3. Clip interpolators

All three: `eax = A (Vertex*)`, `edx = B (Vertex*)`, `ebx = out (Vertex*)`, one float32 on the
stack = plane value `c`; `ret 4`; no return value. All arithmetic float32 operands, x87 temporaries.
`out` may alias A or B (the code reads every input before overwriting it in the cases used).

### sub_27514  clip_edge_z(A, B, out, c)
```
t      = (c - B.z) / (A.z - B.z)
out.x  = (A.x - B.x) * t + B.x
out.y  = (A.y - B.y) * t + B.y
out.z  = c                       // copied bit-exact
out.u  = (A.u - B.u) * t + B.u
out.v  = (A.v - B.v) * t + B.v
```
### sub_27588  clip_edge_x(A, B, out, c)
```
t      = (c - B.x) / (A.x - B.x)
out.z  = (A.z - B.z) * t + B.z   // here z is already 1/z, u,v are u/z, v/z: all linear in screen space
out.y  = (A.y - B.y) * t + B.y
out.x  = c
out.u  = (A.u - B.u) * t + B.u
out.v  = (A.v - B.v) * t + B.v
```
### sub_275fc  clip_edge_y(A, B, out, c)
```
t      = (c - B.y) / (A.y - B.y)
out.z  = (A.z - B.z) * t + B.z
out.x  = (A.x - B.x) * t + B.x
out.y  = c
out.u, out.v as above
```
(Helpers used by sub_2b3c0, outside slice, for reference: `sub_24998` == sub_27514 exactly.
`sub_24a0c` (x) / `sub_24ab0` (y): `eax=A, edx=B, ebx=out`, `t=(c-B.x)/(A.x-B.x)`,
`out.z = (A.z-B.z)*t + B.z` (z is 1/z), other coordinate lerped, and the attributes are
interpolated perspective-correctly because they are NOT pre-divided:
`out.u = (B.u*B.z + (A.u*A.z - B.u*B.z)*t) * (1/out.z)`, same for `+0x34`.)

## 4. sub_27670  draw_textured_triangle(eax = Face* face, dl = u8 stage)

No return value. `stage`: 0 = top-level call (camera-space vertices); 1 = vertices already
projected, do X and Y clip; 2 = skip X clip; 3 = skip X and Y clip. Callers outside always pass 0;
1..3 only come from the recursion.

Locals: `tmp[0..2]` = three 0x40-byte vertex copies at esp+0, +0x40, +0x80; `tmp4` at esp+0xc0;
`sub[3]` (fake face, 3 Vertex*) at esp+0x100; `vp[3]` vertex pointers at esp+0x138.

```c
void draw_textured_triangle(Face *face, u8 stage)
{
    Vertex *vp[3] = { face->v[0], face->v[1], face->v[2] };
    Vertex tmp[3], tmp4;  Vertex *sub[3];

    if (stage == 0) {
        G5cff0 = face->tex;            // dword at face+0x31
        G5d040 = 0;                    // gradients not yet computed for this face

        // ---------- near plane z = 1.0 (float32 compares) ----------
        if (vp[0]->z >= 1 && vp[1]->z >= 1 && vp[2]->z >= 1) {
            for (i = 0; i < 3; i++) { project(&tmp[i], vp[i]); vp[i] = &tmp[i]; }
        } else {
            // order the indices by z: lo, mid, hi  (exact tie rules:)
            if (z0 < z1) {
                if (z0 > z2)      { lo=2; mid=0; hi=1; }
                else { lo=0; if (z1 > z2) { hi=1; mid=2; } else { hi=2; mid=1; } }
            } else {
                if (z0 < z2)      { lo=1; mid=0; hi=2; }
                else { hi=0; if (z1 > z2) { mid=1; lo=2; } else { mid=2; lo=1; } }
            }
            if (vp[hi]->z <= 1) return;                        // nothing in front
            if (vp[mid]->z < 1) {
                // two vertices behind: shrink to one triangle
                clip_edge_z(vp[hi], vp[mid], &tmp[mid], 1.0f);
                clip_edge_z(vp[hi], vp[lo],  &tmp[lo],  1.0f);
                vp[mid] = &tmp[mid]; vp[lo] = &tmp[lo];
                project(&tmp[hi], vp[hi]); vp[hi] = &tmp[hi];
                project_inplace(&tmp[lo]); project_inplace(&tmp[mid]);   // order: lo then mid
            } else {
                // one vertex behind: quad = extra triangle (drawn first, recursively) + this one
                clip_edge_z(vp[lo], vp[mid], &tmp4,    1.0f);
                clip_edge_z(vp[lo], vp[hi],  &tmp[lo], 1.0f);
                project(&tmp[mid], vp[mid]); vp[mid] = &tmp[mid];
                project_inplace(&tmp4); project_inplace(&tmp[lo]); vp[lo] = &tmp[lo];
                sub[0] = &tmp[mid]; sub[1] = &tmp4; sub[2] = &tmp[lo];
                draw_textured_triangle((Face*)sub, 1);
                project(&tmp[hi], vp[hi]); vp[hi] = &tmp[hi];
            }
        }
    }
    if (stage < 2) clip_axis(X);      // may return, may recurse with stage 2
    if (stage < 3) clip_axis(Y);      // may return, may recurse with stage 3
    setup_and_rasterise();            // section 4.3
}
```

### 4.1 Projection (identical formula in all places)
```
project(dst, src):                     // dst float32 fields
    dst.z = 1 / src.z                                  // stored float32 first, then reused
    dst.x = (src.x * G5c99c * dst.z + G5938c) + 0.5    // +0.5 is the float64 constant
    dst.y = (G59390 - src.y * G5c9a0 * dst.z) + 0.5    // y up in camera space, down on screen
    dst.u = src.u * dst.z
    dst.v = src.v * dst.z
project_inplace(p) = project(p, p)
```
Multiplication order is `(x * scale) * invz`. So screen x = cx + 0.5 + sx*x/z: with the centre
159.5 a point on the axis lands at 160.0. u, v become u/z, v/z; z becomes 1/z.

### 4.2 Screen clip, one axis (X shown; Y is the same code with `.y`, height 0x59388,
`clip_edge_y`, recursion stage 3)

```c
    // classify.  NOTE asymmetric limits: outside-right is x >= (float)width (320.0), but the
    // clip line is width-0.5 (319.5); outside-left is x < 0, clip line 0.0
    nout = 0;
    for (i = 0; i < 3; i++) {
        if (0 > vp[i]->x)                      { code[i] = 1; nout++; }
        else if (!((float)width > vp[i]->x))   { code[i] = 2; nout++; }
        else                                     code[i] = 0;
    }
    s = (s8)(code[0] + code[1] + code[2] - 3);
    #define LINE(k)  (code[k] == 1 ? 0.0f : (float)((double)width + -0.5))    // 0 or 319.5 (199.5 for Y)

    if (nout == 3 || (nout == 2 && s != 0)) {        // two (or three) vertices beyond the SAME line
        a = code[0] == code[1];  b = code[0] == code[2];
        if (a && b) return;                          // all three outside the same side
        if (a)      { odd = 2; p = 0; q = 1; }       // p,q = the two that share a code
        else if (b) { odd = 1; p = 0; q = 2; }
        else        { odd = 0; p = 1; q = 2; }
        c = LINE(p);
        clip_edge_x(vp[odd], vp[p], &tmp[p], c);     // B (and out) is the outside vertex
        clip_edge_x(vp[odd], vp[q], &tmp[q], c);
        vp[p] = &tmp[p]; vp[q] = &tmp[q];
        if (nout == 3) { code[p] = 0; code[q] = 0; nout = 1; }   // 'odd' is out on the other side
    }
    if (nout == 2 && s == 0) {                       // one left, one right, one inside
        if (code[0] != 0) { o = 0; if (code[1] == 0) { in = 1; o2 = 2; } else { in = 2; o2 = 1; } }
        else              { in = 0; o = 1; o2 = 2; }
        c = LINE(o);
        clip_edge_x(vp[o], vp[in], &tmp4,   c);
        clip_edge_x(vp[o], vp[o2], &tmp[o], c);
        vp[o] = &tmp[o];
        sub[0] = &tmp4; sub[1] = &tmp[o]; sub[2] = vp[in];
        draw_textured_triangle((Face*)sub, 2);       // (3 for the Y axis)
        code[o] = 0; nout = 1;
    }
    if (nout == 1) {                                 // exactly one vertex outside
        if (code[0] != 0)      { o = 0; a = 1; b = 2; }
        else if (code[1] != 0) { o = 1; a = 0; b = 2; }
        else                   { o = 2; a = 0; b = 1; }
        c = LINE(o);
        clip_edge_x(vp[o], vp[a], &tmp4,   c);
        clip_edge_x(vp[o], vp[b], &tmp[o], c);
        vp[o] = &tmp[o];
        sub[0] = &tmp4; sub[1] = &tmp[o]; sub[2] = vp[a];
        draw_textured_triangle((Face*)sub, 2);       // (3 for Y)
    }
```
Notes: `tmp[k]` is this invocation's own copy; in a recursive invocation `vp[]` initially point
into the caller's frame and get redirected to the callee's `tmp[]` as they are clipped. The
sub-triangle is always rasterised BEFORE the remaining main triangle. Recursion depth is at most
z(1) → x(2) → y(3).

### 4.3 Sort, gradients, edge setup

```c
    // ---- sort by (trunc y, then trunc x), 3 compare/swaps; reject triangles degenerate in integer coords
    d = (s16)(trunc(P1.y) - trunc(P0.y));  W5d03c = d;
    if (d < 0) swap(v0,v1);
    else if (d == 0) { e = trunc(P1.x) - trunc(P0.x); if (e < 0) swap(v0,v1); if (e == 0) return; }
    d = (s16)(trunc(P2.y) - trunc(P0.y));  W5d03e = d;
    if (d < 0) swap(v0,v2);
    else if (d == 0) {
        if (W5d03c == 0) return;       // tests the value stored by the FIRST compare (pre-swap):
                                       // = "all three on the same integer row"
        e = trunc(P2.x) - trunc(P0.x); if (e < 0) swap(v0,v2); if (e == 0) return;
    }
    d = (s16)(trunc(P2.y) - trunc(P1.y));
    if (d < 0) swap(v1,v2);
    else if (d == 0) { e = trunc(P2.x) - trunc(P1.x); if (e < 0) swap(v1,v2); if (e == 0) return; }
    // (swap exchanges both the Vertex* and the P pointer; nothing is copied)

    iy0 = trunc(P0.y); iy1 = trunc(P1.y); iy2 = trunc(P2.y);
    h1 = W5d03c = (s16)(iy1 - iy0);        // block+0x4c
    h2 = W5d03e = (s16)(iy2 - iy1);        // block+0x4e

    // ---- plane gradients: once per top-level face (flag survives the recursion), from the first
    //      sub-triangle that gets this far.  Uses the UNTRUNCATED float coordinates.
    if (G5d040 == 0) {
        dy02 = P2.y - P0.y;  dx01 = P1.x - P0.x;  dy01 = P1.y - P0.y;  dx02 = P2.x - P0.x;   // float32
        det  = dx01*dy02 - dx02*dy01;                         // float32
        if ((bits(det) & 0x7fffffff) == 0) return;            // +0 or -0
        inv    = 1 / det;                 // float32
        inv16  = (1/det) * 16.0f;         // float32 (x87 temp of 1/det times 16)
        G5d00c = (dy02*(P1.z-P0.z) - dy01*(P2.z-P0.z)) * inv16;              // d(1/z)/dx  * 16
        k4096  = inv16 * 256.0f;          // float32
        k256   = inv * 256.0f;            // float32;  nk256 = -k256 (float32)
        du01 = V1.u-V0.u; du02 = V2.u-V0.u; dv01 = V1.v-V0.v; dv02 = V2.v-V0.v;
        G5d010 = (dy02*du01 - dy01*du02) * k4096;             // d(u/z)/dx * 16 * 256
        G5d014 = (dy02*dv01 - dy01*dv02) * k4096;             // d(v/z)/dx * 16 * 256
        G5d044 = ((P1.z-P0.z)*dx02 - (P2.z-P0.z)*dx01) * (-inv);   // d(1/z)/dy
        G5d048 = (du01*dx02 - du02*dx01) * nk256;             // d(u/z)/dy * 256
        G5d04c = (dv01*dx02 - dv02*dx01) * nk256;             // d(v/z)/dy * 256
        G5d040 = 1;
    }

    // ---- start values at v0 (no sub-pixel / sub-texel prestep anywhere)
    ix0 = trunc(P0.x); ix1 = trunc(P1.x); ix2 = trunc(P2.x);
    G5d030 = P0.z;              // 1/z
    G5d034 = 256.0f * V0.u;     // 256*u/z
    G5d038 = V0.v * 256.0f;     // 256*v/z
    H    = h1 + h2;
    Wf   = (float)width;                          // 320.0: every edge slope also advances one row
    dxl  = (float)(ix2 - ix0);                    // long edge v0->v2
    dxs  = (float)(ix1 - ix0);                    // v0->v1
    dxb  = dxl - dxs;                             // v1->v2 (float32)
    rH   = (float32)(1.0 / H);
    sLong = trunc((dxl * rH + Wf) * 65536.0f);    // 16.16 address step per scanline

    #define EDGE_STEPS(dx, n, rn, Z, U, Vv)   /* attribute step per scanline along an edge   */ \
        { k = (float32)(dx * 0.0625f);                                                           \
          Z  = (k*G5d00c + n*G5d044) * rn;                                                       \
          U  = (k*G5d010 + n*G5d048) * rn;                                                       \
          Vv = (k*G5d014 + n*G5d04c) * rn; }      /* = grad_x*(dx/n) + grad_y                */

    if (h1 != 0) {
        r1     = (float32)(1.0 / h1);
        addr   = ix0 + rowtab[iy0];               // G593a8[iy0]
        G5cff4 = G5cff8 = addr;                   // left and right start at the same pixel
        sShort = trunc((dxs * r1 + Wf) * 65536.0f);
        if (sLong < sShort) {                     // signed compare: long edge is the LEFT edge
            G5cffc = sLong;  G5d000 = sLong;      // left slope: top, bottom
            G5d004 = sShort;                      // right slope top
            if (h2 != 0) G5d008 = trunc((dxb / (float)h2 + Wf) * 65536.0f);   // right slope bottom
                                                  // (left stale when h2 == 0; unused then)
            EDGE_STEPS(dxl, (float)H, rH, G5d01c, G5d024, G5d02c);            // bottom-section steps
            G5d018 = G5d01c; G5d020 = G5d024; G5d028 = G5d02c;                // top = same
        } else {                                  // long edge is the RIGHT edge
            EDGE_STEPS(dxs, (float)h1, r1, G5d018, G5d020, G5d028);           // left top = v0->v1
            G5d008 = sLong;  G5d004 = sLong;      // right bottom, right top
            G5cffc = sShort;                      // left top
            if (h2 != 0) {
                r2 = (float32)(1.0 / h2);
                EDGE_STEPS(dxb, (float)h2, r2, G5d01c, G5d024, G5d02c);       // left bottom = v1->v2
                G5d000 = trunc((dxb * r2 + Wf) * 65536.0f);                   // left slope bottom
            }
        }
    } else {                                      // flat top: v0 is left, v1 is right (sorted by x)
        EDGE_STEPS(dxl, (float)H, rH, G5d01c, G5d024, G5d02c);
        G5d018 = G5d01c; G5d020 = G5d024; G5d028 = G5d02c;
        G5cff4 = ix0 + rowtab[iy0];
        G5cff8 = rowtab[iy0] + ix1;
        G5d000 = G5cffc /* = sLong */;
        G5d008 = trunc((dxb / (float)h2 + Wf) * 65536.0f);
    }
    if (W5d03e == 0) W5d03c++;                    // flat bottom: the top loop draws the last row too
    sub_1255b(eax = 0x5cff0);
```
Precision notes for a port: every named local above is a float32 memory slot; products/sums
inside one expression are x87 temporaries. `rH`, `r1`, `r2` are rounded to float32 before being
multiplied by `dx`. `dxb / (float)h2` (two places) is a real division, the other slopes use the
float32 reciprocal. Using doubles everywhere will differ only in rare last-bit cases of the
truncated 16.16 slopes.

### 4.4 Parameter block (offsets from 0x5cff0; the block of sub_29510 at 0x5d050 is identical)
```
+0x00 u8*  texture (64K aligned).  sub_29510: low 16 bits carry the blend-table pointer >> 16
+0x04 int  left  start: rowtab[iy0] + x   (offset into the frame buffer [0x53e18])
+0x08 int  right start
+0x0c int  left  slope, top section     16.16, = (dx/dy + 320) * 65536
+0x10 int  left  slope, bottom section
+0x14 int  right slope, top section
+0x18 int  right slope, bottom section
+0x1c float d(1/z)/dx      * 16          (per 16-pixel span)
+0x20 float d(u/z)/dx      * 16 * 256
+0x24 float d(v/z)/dx      * 16 * 256
+0x28 float left-edge step per scanline of 1/z,      top section     +0x2c bottom section
+0x30 float left-edge step per scanline of 256*u/z,  top             +0x34 bottom
+0x38 float left-edge step per scanline of 256*v/z,  top             +0x3c bottom
+0x40 float 1/z at v0        +0x44 float 256*u/z at v0        +0x48 float 256*v/z at v0
+0x4c s16  rows in top section (h1, +1 if h2==0 in sub_27670)
+0x4e s16  h2 (bottom section draws h2+1 rows when h2 > 0)
```

## 5. sub_1255b (outside slice) — the opaque perspective span loop used by sub_27670

`eax = block`. `pushal/popal`, x87 stack balanced. Private state at 0x53e14..0x53e7f.

```c
    dz16 = b[0x1c]; du16 = b[0x20]; dv16 = b[0x24];
    iz = b[0x40]; uz = b[0x44]; vz = b[0x48];                // float32 running left-edge values
    tex = b[0];  dst = G53e18;
    left = b[4]; right = b[8];                               // integer pixel addresses (offsets)
    lfrac = 0x8000; rfrac = 0x8000;                          // u16 fractional accumulators
    lslope = b[0xc]; rslope = b[0x14]; izL = b[0x28]; uzL = b[0x30]; vzL = b[0x38];
    rows = (s16)b[0x4c];                                     // top section: 'rows' scanlines
    Z = 1.0 / iz;
    for (section = 0; section < 2; section++) {
        if (section == 1) {
            n = (s16)b[0x4e]; if (n <= 0) break;
            rows = n + 1;                                    // bottom section: h2 + 1 scanlines
            lslope = b[0x10]; rslope = b[0x18]; izL = b[0x2c]; uzL = b[0x34]; vzL = b[0x3c];
        }
        while (rows-- > 0) {
            V = rint(vz * Z);  U = rint(uz * Z);             // fistp, round to nearest; 8.8 texel coords
            uzn = uz + du16; vzn = vz + dv16; izn = iz + dz16;   // float32 stores
            Zn = 1.0 / izn;
            width = right - left + 1;                        // BOTH end pixels are drawn
            // span split: full 16-pixel pieces, then a tail of 1..16 pixels
            tail = width & 15; full = (s8)((width >> 4) & 0xff);
            if (tail == 0) { tail = 16; full--; }
            p = dst + left;
            while (full-- > 0) {
                Vn = rint(vzn * Zn); Un = rint(uzn * Zn);
                vzn += dv16; uzn += du16; izn += dz16; Zn = 1.0 / izn;   // float32 stores
                dU = (s16)((Un - U) >> 4);                   // bits 4..19 of the difference: 8.8 step
                dV = (s16)(((Vn - V) & 0xffff)) >> 4;        // low 16 bits, arithmetic shift: 8.8 step
                u = U & 0xffff; v = V & 0xffff;              // 16-bit wrapping accumulators
                for (i = 0; i < 16; i++) {
                    *p++ = tex[((v >> 8) & 0xff) << 8 | ((u >> 8) & 0xff)];   // tiles at 256
                    u += dU; v += dV;
                }
                U = Un; V = Vn;                              // exact resync every 16 pixels
            }
            Vn = rint(vzn * Zn); Un = rint(uzn * Zn);        // tail: step still = (next16 - cur)/16
            dU, dV, u, v as above;
            for (i = 0; i < tail; i++) { *p++ = tex[...]; u += dU; v += dV; }
            // next scanline
            uz += uzL; vz += vzL; iz += izL; Z = 1.0 / iz;   // float32 stores
            t = lfrac + (lslope & 0xffff); lfrac = t & 0xffff; left  += (lslope >> 16) + (t >> 16);
            t = rfrac + (rslope & 0xffff); rfrac = t & 0xffff; right += (rslope >> 16) + (t >> 16);
        }
    }
```
(`slope >> 16` is the sign-extended high word.) Implementation detail that can matter for
bit-exactness: U and V live in one 32-bit register as `[Ufrac:8][V bits16-23:8][Vint:8][Vfrac:8]`,
the add of the V step can carry out of bit 15 into the junk byte, and only when that byte
overflows too does it reach Ufrac. Ignoring that is the 16-bit-wrap model above.

Degenerate widths: the asm has no guard. `width == 0` (right == left-1) draws 16 pixels,
`width == -k` draws `(-k) & 15` (or 16) pixels. I did not prove this cannot happen at the bottom
tip where the truncated slopes converge; a port should probably clamp `width <= 0` to "draw
nothing" and compare against the original if tips look different.

### Fill convention of sub_27670 + sub_1255b, summarised
- Vertices are truncated to integer pixels (x and y, toward zero; values are >= 0 after clipping,
  and screen coords already include +0.5, so this is round-to-nearest of the true projection).
- Rows iy0 .. iy2 inclusive (top section iy0..iy1-1, bottom iy1..iy2; flat-bottom: iy0..iy1).
- Edge x at row iy0+k = floor(ix0 + 0.5 + sum of truncated 16.16 slopes); pixels left..right
  inclusive (so adjacent triangles overdraw their shared edge, harmless for opaque).
- Perspective correct, exact every 16 pixels counted from the left edge of each scanline, linear
  8.8 steps in between (step = floor(delta/16)).
- No sub-pixel or sub-texel correction: the attributes of v0 are used as-is at pixel (ix0, iy0)
  and stepped along the integer edge; gradients come from the unrounded float positions.
- Texel = tex[(V>>8 & 255)*256 + (U>>8 & 255)], U = round(256*u), no half-texel offset, wraps.
- No shading, no transparency, no z-buffer: plain byte copy.

## 6. sub_29510  draw_textured_triangle_blended(eax = Face*, dl = stage, ebx = u8* table)

Compiled from the same source as sub_27670 with one more parameter; a normalised diff of the two
listings shows only register allocation and address differences except for the points below.
(Honest limit: I verified control flow, calls, constants and all FPU stores by diff; I did not
re-derive each index-triple assignment in the clip code line by line.)

1. Third argument `ebx` = pointer to a 64K-aligned 256x256 lookup table. It is passed unchanged to
   every recursive call (`sub_29510(sub, 1|2|3, table)`).
2. At stage 0: `G5d050 = face->tex + ((u32)table >> 16)` — the table's high word is smuggled in
   the (zero) low word of the 64K-aligned texture pointer. Gradient flag is `0x5d0a0`.
3. All block globals are at +0x60: block `0x5d050..0x5d09f` (same layout as 4.4), heights
   `0x5d09c/0x5d09e`, y-gradients `0x5d0a4/0x5d0a8/0x5d0ac`. Constants come from the second copies
   (0x5193c.., same values). Clip helpers are the same three functions.
4. The tail differs:
   ```c
   // sub_27670:  if (h2 == 0) h1++;            sub_1255b(0x5cff0);
   // sub_29510:  G5d058 -= 1;  /* right start address - 1 */   sub_119c2(0x5d050);
   ```
   i.e. NO extra row for a flat bottom (with h2 == 0 only rows iy0..iy1-1 are drawn; with
   h2 > 0 rows iy0..iy2 as before), and the right edge is made exclusive (see below) so that
   pixels on shared edges are not blended twice.

### 6.3 sub_119c2 as far as read (0x119c2..0x11e8b; the function's listed size runs to 0x1255b —
the part after the `ret` at 0x11e8b was not read)
Same structure and same private variables as sub_1255b, with these differences:
- `mov [0x53e12], tex` makes the dword at 0x53e10 = `(tex & 0xffff) << 16 | (previous low word,
  assumed 0)` = the table pointer.
- fraction accumulators start at left 0x8001, right 0x8000.
- `width = (right + 1) - left` where `right` is the already-decremented block value, i.e.
  **pixels left .. right_edge-1** (one fewer than the opaque drawer). `width == 0` is handled
  (draws nothing); negative widths are not guarded.
- pixel: `dst[p] = table[(texel << 8) | dst[p]]` (texel in the high index byte, old screen pixel in
  the low byte).
- U/V stepping, 16-pixel subdivision, row counts (`h1` rows, then `h2+1` if `h2 > 0`) identical.

## 7. sub_2b3c0  draw_shade_triangle(eax = Face*, dl = stage, ebx = u8* table)

Same skeleton again (near clip → project → X clip → Y clip, same recursion with stages 1/2/3,
`table` passed through), but:

1. Does not touch the face beyond the 3 vertex pointers (no texture, no global block, no
   gradient flag).
2. Clip helpers: `sub_24998` (z, at 1.0), `sub_24a0c` (x), `sub_24ab0` (y) with the same
   (A, B, out, c) roles, same classification (`x < 0` / `x >= width`, lines 0.0 and
   width-0.5 / height-0.5 using constants 0x51958/0x51960).
3. Projection does NOT divide the attribute:
   ```
   dst.z = 1/src.z;  dst.x = (src.x*G5c99c*dst.z + G5938c) + 0.5;
   dst.y = (G59390 - src.y*G5c9a0*dst.z) + 0.5;   dst.c(+0x30) = src.c;      // +0x34 not copied
   ```
   (in-place projection of clipped copies leaves +0x30 alone). The screen-space clip helpers
   therefore interpolate c perspective-correctly (formula in section 3).
4. No sorting, no degenerate test, no gradient computation here. After clipping it builds a
   28-byte block on the stack and calls the rasteriser:
   ```c
   struct { u8 *table;                       // +0x00  = arg ebx
            struct { s16 x, y, c, pad; } v[3]; // +0x04, +0x0c, +0x14
          } blk;
   for (i = 0; i < 3; i++) {
       blk.v[i].x = (s16)trunc(P[i].x);
       blk.v[i].y = (s16)trunc(P[i].y);
       blk.v[i].c = (s16)trunc(V[i].c + 0.5);      // float32 + float64 0.5, then truncate
       // blk.v[i].pad (+0x0a, +0x12, +0x1a) is NOT written: uninitialised stack
   }
   sub_12fe1(eax = &blk);
   ```
   Vertices are passed in the face's original order (after clipping substitutions).

### 7.4 sub_12fe1 as far as read (outside slice; only entry and inner loop skimmed)
- stores `blk.table` to 0x53e10; sorts the three 8-byte vertices itself by the dword `y<<16 | x`;
  rejects equal vertices, `y_max < 0` and `y_min >= 200` (`cmp eax, 0xc80000`), and has its own
  top/bottom row clipping; integer (`idiv`) edge slopes with `+0x1400000` (= 320<<16) row advance.
- per vertex it reads the low BYTE of word +4 and the low BYTE of word +6 as two 8-bit
  attributes (`and esi, 0xff00ff`), i.e. it is a generic 2-attribute affine routine; sub_2b3c0
  only supplies the first one.
- inner loop pixel: `dst[p] = table[(dst[p] << 8) | c]` with c = the first attribute, stepped
  with an 8-bit fraction (`adc bl, cl`). NOTE the index order is the opposite of sub_119c2.
- The second (uninitialised) attribute is carried in the same registers as fractional/garbage
  bits. Whether it can leak a carry into c must be settled by the reader of sub_12fe1.

## 8. Dispatch in the callers (from callers.json + the call sites)

Two calling patterns:

(a) Whole objects, no sorting — `sub_14294`, `sub_1467c`, `sub_14d9c`, `sub_16084`, `sub_165a4`,
`sub_16a18`, `sub_16ff4` (all the same shape, checked on 0x14294 and 0x1467c):
```c
for (i = obj->nfaces - 1; i >= 0; i--) {             // obj+0x18, faces at obj+0x10, 0x35 bytes each
    f = &obj->faces[i];
    sum = P0 + P1 + P2 (xyz, camera space);
    if (!(P0.z > 1 || P1.z > 1 || P2.z > 1)) continue;         // all at/behind the near plane
    if (!(0 < sub_23b6c(&sum, &f->normal /* +0x18 */))) continue;   // back-face (st0 result vs 0)
    sub_27670(f, 0);
}
```
(`sub_1c893` instead walks `[0x5c94c]`'s faces, writes `f+0x28 = 1, f+0x2a = 0` and calls
`sub_27670(f, 0)` unconditionally, then reads the vertices' u,v — not analysed further.)

(b) Sorted face list — global `0x5e0c8` = Face** array, `0x5e0d0` = count, drawn from the LAST
entry to the first (painter's order prepared elsewhere), drawer chosen by the flag byte `face+0x30`:

| caller | test order on `face[0x30]` |
|---|---|
| sub_14730 (part 149ba?) | `0x10` or `0x20` → `sub_29510(f, 0, [0x594e8])`; else → `sub_27670(f, 0)` |
| sub_14e4f | `0x10` → `sub_2b3c0(f, 0, [0x59518])`; else `0x02` → `sub_24b54(f, 0)`; else `0x40` → `sub_27670(f, 0)`; else skipped |
| sub_16138, sub_161bf, sub_16acc, sub_170a8 | `0x02` → `sub_24b54(f, 0)`; else `0x40` → `sub_27670(f, 0)`; else skipped |
| sub_16658 | `0x40` → `sub_27670(f, 0)`; else `0x02` → `sub_24b54(f, 0)`; else `0x80` → `sub_27434(f, edx=[0x593a0])`; else skipped |

So, as far as this slice shows: flag `0x40` = perspective textured (sub_27670), `0x02` = the
drawer at 0x24b54 (other reader; it is the one sharing helpers 0x24998/0x24a0c/0x24ab0 with
sub_2b3c0, so its vertex +0x30/+0x34 are undivided), `0x10` = table-blended (textured blend in
one scene, shade triangle in another: the meaning is per scene), `0x20` = also blended in
sub_14730, `0x80` = sub_27434. The table pointers `[0x594e8]` and `[0x59518]` are scene globals
(presumably built by 0x10770 / 0x108e4 / 0x10a28).

## 9. Data tables

The slice reads no data tables, only the scalar constants listed in section 2
(peek: 0x51920 = 0.5 f64, 0x51928 = -0.5 f64, 0x51930 = 16.0, 0x51934 = 256.0, 0x51938 = 65536.0,
0x5193c = 0.5 f64, 0x51944 = -0.5 f64, 0x5194c = 16.0, 0x51950 = 256.0, 0x51954 = 65536.0,
0x51958 = 0.5 f64, 0x51960 = -0.5 f64, 0x52bcc = 0.0625, 0x54730 = 1.0).

## 10. Open questions

1. sub_119c2: bytes 0x11e8c..0x1255a (after its `ret`) not read; and the low word of 0x53e10 is
   assumed to be 0.
2. sub_12fe1: only skimmed. The uninitialised second attribute passed by sub_2b3c0, its exact
   row/pixel coverage and rounding need its own reader.
3. Zero/negative span widths in sub_1255b / sub_119c2 are unguarded (section 5); not proven
   unreachable.
4. sub_29510 / sub_2b3c0 clip code was verified against sub_27670 by normalised diff, not by an
   independent line-by-line derivation of each index assignment.
5. x87 precision control word is unknown here (Watcom default assumed); float32 store points are
   marked, intermediate precision could matter only for last-bit truncation of slopes.
6. sub_23b6c's return (dot product?) and the sign convention of the back-face test are from the
   caller's shape only.
7. Which demo part each caller in section 8 belongs to was not checked.
