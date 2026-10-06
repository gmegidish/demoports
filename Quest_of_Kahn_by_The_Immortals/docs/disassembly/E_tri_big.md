# E — the two big triangle functions: sub_1880d and sub_1a5be (code 0x1880d..0x1c37e)

Both functions are the same C source compiled twice with a different "span filler" at the end:

| function | name | filler called at the end | parameter block | what a pixel is |
|---|---|---|---|---|
| `sub_1880d` (0x1880d, 7601 bytes) | `drawTriTextured(face, mode)` | `sub_1255b` (asm, 0x1255b) | 0x5c874 | `dst = texel` |
| `sub_1a5be` (0x1a5be, 7616 bytes) | `drawTriTexturedThroughTable(face, mode, tex)` | `sub_119c2` (asm, 0x119c2) | 0x5c8d4 | `dst = table[texel*256 + dst]` |

**Important finding:** neither function contains an inner loop. They only do: near-plane clip,
perspective projection, X clip, Y clip (clipping is done by splitting and *recursing*), vertex sort,
gradient setup, edge setup, and then call an assembly rasterizer that lives outside this slice
(`sub_1255b` / `sub_119c2`, in 0x119c2..0x12961). Because the fill convention is decided inside those
rasterizers, they are documented here too (section 6 and 7), read from the listing.

There is exactly ONE inner-loop variant per function: perspective-correct texture mapping with a
perspective divide every 16 pixels and linear 8.8 interpolation in between. No Gouraud, no z-buffer.

Callers (from `callers.json` and the listing): each function calls itself 5 times (clip recursion); the only
external caller is `sub_1c893` (0x1c893), 5 call sites of `sub_1a5be` (0x1c965, 0x1ca6e, 0x1cb6a, 0x1cc6b,
0x1cd67) and 4 of `sub_1880d` (0x1c9d8, 0x1cad4, 0x1cbd5, 0x1ccd1). All external calls pass `edx = 0`.

Helper: `rnd` below never appears; every float-to-int in the two C functions is
`call 0x1f318; fistp` and 0x1f318 forces the control word high byte to 0x1f (round = chop) around a
`frndint`. So **`T(x)` = truncate toward zero** everywhere in sections 2-5. Inside the asm rasterizers the
`fistp` instructions use the *current* FPU rounding mode (not 0x1f318): written `RI(x)` below
(round-to-nearest-even unless the program changed the control word; I did not find a change in my slice).

Capstone's FPU mnemonics were checked against the opcode bytes: `de f1` = `st1 = st0/st1`,
`de f9` = `st1 = st1/st0`, `de e9` = `st1 = st1-st0`, `d8 2d` = `st0 = m32-st0`, `d8 bc` = `st0 = m32/st0`.
The formulas below already take this into account.

---------------------------------------------------------------------------------------------------

## 1. Data structures

### Face (0x35 = 53 bytes each; `imul ecx, esi, 0x35` in the caller sub_1c893)

| offset | type | meaning | evidence |
|---|---|---|---|
| +0x00 | Vertex* | vertex 0 | 0x1882b |
| +0x04 | Vertex* | vertex 1 | 0x18834 |
| +0x08 | Vertex* | vertex 2 | 0x1883e |
| +0x28 | int16 | "visible" flag. If 0 the face is skipped (only tested when mode==0) | 0x18887 / 0x1a637. The caller writes 1 here at 0x1c8bf |
| +0x2a | int16 | not read here (caller sets it to 0 at 0x1c8c5) | |
| +0x31 | uint8* (unaligned dword) | texture pointer, 256x256 bytes, **must be 64 KB aligned** (low 16 bits are replaced by v:u). Only read by sub_1880d, only when mode==0 | 0x18892 |

When the function recurses it passes a fake 12-byte face on its stack (3 vertex pointers only); with
mode != 0 nothing but the 3 pointers is read.

### Vertex (size unknown here, at least 0x38; temporaries are 0x40 bytes)

| offset | type | meaning on entry (mode 0) | meaning after projection (temporaries / mode>=1) |
|---|---|---|---|
| +0x18 | float32 | camera-space X | screen x (float, already includes +0.5) |
| +0x1c | float32 | camera-space Y (up is positive) | screen y (float, already includes +0.5) |
| +0x20 | float32 | camera-space Z (forward, near plane at 1.0) | 1/Z |
| +0x30 | float32 | texture u, in texels (256.0 = one full texture width) | u/Z |
| +0x34 | float32 | texture v, in texels | v/Z |
| +0x24, +0x2c | float32 | not read here. The caller sub_1c893 copies `[+0x24]+8192.0` to +0x30 and `[+0x2c]+8192.0` to +0x34 before the sub_1a5be call and restores u,v afterwards (looks like an environment-map pass: normal x/z as texture coordinates) | |

The original vertices are **never modified** by these functions: projection always writes to a
0x40-byte temporary on the stack and repoints the local vertex pointer to it.

### Local variables (same layout in both functions unless noted)

```
tmp[0..2]   esp+0x000, 0x040, 0x080   three 0x40-byte temporary vertices (same field offsets as Vertex)
tmp3        esp+0x0c0                 fourth temporary vertex
face2[3]    esp+0x100                 fake face for the recursive call
P[0..2]     esp+0x138                 Vertex* (base pointers; used for +0x30/+0x34)
V[0..2]     esp+0x144                 = P[i]+0x18 (pointer to x,y,z); always kept in sync with P[i]
a0,a1,a2    esp+0x1a0,1a1,1a2         bytes: a permutation of 0,1,2
code[0..2]  esp+0x1a4,1a5,1a6         bytes: outcodes
mode        esp+0x1a8                 byte (dl)
```
(Inside a `push float` ... `call` sequence esp is 4 lower, so the listing shows these +4.)

---------------------------------------------------------------------------------------------------

## 2. Globals

Read-only inputs:

| address | type | meaning |
|---|---|---|
| 0x59384 | u32 | screen width (320) |
| 0x59388 | u32 | screen height (200) |
| 0x5938c | float32 | centre x = w*0.5-0.5 = 159.5 |
| 0x59390 | float32 | centre y = h*0.5-0.5 = 99.5 |
| 0x593a8 | u32* | pointer to row-offset table, `rowtab[y] = y*320` (dword entries) |
| 0x5c99c | float32 | X projection scale `SX`. Written at 0x18253: `(width*0.5) / (double)(float)tan(0.427606)` ≈ 351.0876 |
| 0x5c9a0 | float32 | Y projection scale `SY`. Written at 0x18279: `(height*0.5) / 0.75f / (double)(float)tan(0.427606)` ≈ 292.5730 |
| 0x5c934 | u8* | (sub_1a5be only) pointer to a 64 KB, 64 KB-aligned 256x256 lookup table, allocated and filled by sub_1853c (outside this slice) |
| 0x53e18 | u8* | (rasterizers) base address of the render target; set by sub_13cfe(ebx=buffer) at 0x13d05 |

Constants: 0x54730 float32 1.0 (near plane); 0x51284 / 0x512a0 double 0.5; 0x5128c / 0x512a8 double -0.5;
0x51294 / 0x512b0 float32 16.0; 0x51298 / 0x512b4 float32 256.0; 0x5129c / 0x512b8 float32 65536.0;
0x54000 float32 0.0625 (shared by both). (First address is the one used by sub_1880d, second by sub_1a5be.)

Rasterizer parameter block. sub_1880d uses the block at **0x5c874**, sub_1a5be an identical block at
**0x5c8d4**. Field = block + offset:

| off | 1880d addr | 1a5be addr | type | name used below | meaning |
|---|---|---|---|---|---|
| 0x00 | 0x5c874 | 0x5c8d4 | u32 | `tex` | 1880d: `face[+0x31]`. 1a5be: `texArg + (table >> 16)` (see section 5) |
| 0x04 | 0x5c878 | 0x5c8d8 | i32 | `leftOfs` | byte offset in the frame buffer of the left edge on the first scanline |
| 0x08 | 0x5c87c | 0x5c8dc | i32 | `rightOfs` | same for the right edge |
| 0x0c | 0x5c880 | 0x5c8e0 | i32 16.16 | `leftStepTop` | left edge step per scanline, upper part. Includes +320.0 (one row) |
| 0x10 | 0x5c884 | 0x5c8e4 | i32 16.16 | `leftStepBot` | left edge step, lower part |
| 0x14 | 0x5c888 | 0x5c8e8 | i32 16.16 | `rightStepTop` | |
| 0x18 | 0x5c88c | 0x5c8ec | i32 16.16 | `rightStepBot` | |
| 0x1c | 0x5c890 | 0x5c8f0 | f32 | `dZdx16` | d(1/Z)/dx * 16 |
| 0x20 | 0x5c894 | 0x5c8f4 | f32 | `dUdx16` | d(u/Z)/dx * 16 * 256 |
| 0x24 | 0x5c898 | 0x5c8f8 | f32 | `dVdx16` | d(v/Z)/dx * 16 * 256 |
| 0x28 | 0x5c89c | 0x5c8fc | f32 | `dZleftTop` | change of 1/Z per scanline along the left edge, upper part |
| 0x2c | 0x5c8a0 | 0x5c900 | f32 | `dZleftBot` | lower part |
| 0x30 | 0x5c8a4 | 0x5c904 | f32 | `dUleftTop` | same for u/Z*256 |
| 0x34 | 0x5c8a8 | 0x5c908 | f32 | `dUleftBot` | |
| 0x38 | 0x5c8ac | 0x5c90c | f32 | `dVleftTop` | same for v/Z*256 |
| 0x3c | 0x5c8b0 | 0x5c910 | f32 | `dVleftBot` | |
| 0x40 | 0x5c8b4 | 0x5c914 | f32 | `Z0` | 1/Z at the top vertex |
| 0x44 | 0x5c8b8 | 0x5c918 | f32 | `U0` | u/Z*256 at the top vertex |
| 0x48 | 0x5c8bc | 0x5c91c | f32 | `V0` | v/Z*256 at the top vertex |
| 0x4c | 0x5c8c0 | 0x5c920 | i16 | `h01` | number of scanlines of the upper part |
| 0x4e | 0x5c8c2 | 0x5c922 | i16 | `h12` | y2 - y1 |
| 0x50 | 0x5c8c4 | 0x5c924 | u8 | `gradValid` | 0 = gradients must be computed; set to 0 by a mode-0 call, set to 1 once computed. Not read by the rasterizer |
| 0x54 | 0x5c8c8 | 0x5c928 | f32 | `dZdy` | d(1/Z)/dy (not x16). Not read by the rasterizer |
| 0x58 | 0x5c8cc | 0x5c92c | f32 | `dUdy` | d(u/Z)/dy * 256 |
| 0x5c | 0x5c8d0 | 0x5c930 | f32 | `dVdy` | d(v/Z)/dy * 256 |

(The code reads `dword [0x5c8be] sar 16` and `dword [0x5c8c0] sar 16`: these are just sign-extended reads
of the int16 fields h01 and h12.)

---------------------------------------------------------------------------------------------------

## 3. Helpers just before the slice (called only from these two functions)

All three: `eax = Vertex* A`, `edx = Vertex* B`, `ebx = Vertex* OUT`, one float32 on the stack `plane`
(`ret 4`). They interpolate on the line B->A. `OUT` may be the same memory as `B` (reads happen before
writes for every field, t is computed first). t is stored as float32 before use.

```c
// sub_186ef  clipZ(A, B, OUT, plane)      -- used before projection (z is camera Z)
t = (float)((plane - B.z) / (A.z - B.z));
OUT.x = (A.x - B.x) * t + B.x;
OUT.y = (A.y - B.y) * t + B.y;
OUT.z = plane;                       // bit copy
OUT.u = (A.u - B.u) * t + B.u;       // +0x30
OUT.v = (A.v - B.v) * t + B.v;       // +0x34

// sub_18766  clipX(A, B, OUT, plane)      -- after projection (z = 1/Z, u = u/Z, v = v/Z)
t = (float)((plane - B.x) / (A.x - B.x));
OUT.z = (A.z - B.z) * t + B.z;
OUT.y = (A.y - B.y) * t + B.y;
OUT.x = plane;
OUT.u, OUT.v as above (shared tail at 0x1873f)

// sub_187b8  clipY(A, B, OUT, plane)
t = (float)((plane - B.y) / (A.y - B.y));
OUT.z = (A.z - B.z) * t + B.z;
OUT.x = (A.x - B.x) * t + B.x;
OUT.y = plane;
OUT.u, OUT.v as above
```
Each result is stored as float32 (`fstp dword`); the arithmetic in between is x87 (extended) precision.
For a JS port: compute in doubles and `Math.fround` at every store.

---------------------------------------------------------------------------------------------------

## 4. sub_1880d — `drawTriTextured(eax = Face* face, dl = mode)`; returns nothing

`mode`: 0 = full pipeline (external callers). 1 = vertices are already projected, do X clip + Y clip.
2 = skip X clip too. 3 = skip Y clip too. Modes 1..3 are only used by the recursion.

```c
void drawTriTextured(Face *face, uint8 mode)
{
    P[i] = face->v[i];  V[i] = &P[i]->x;            // i = 0..2

    if (mode == 0) {
        if (face->w28 == 0) return;
        blk.tex       = face->d31;                  // 0x5c874
        blk.gradValid = 0;                          // 0x5c8c4
        nearClipAndProject();                       // 4.1
    }
    if (mode < 2) clipAxis(X);                      // 4.2
    if (mode < 3) clipAxis(Y);                      // 4.2
    sortSetupAndDraw();                             // 4.3 .. 4.5
}
```

### 4.1 Near-plane clip + projection (0x188a2..0x18f6b), mode 0 only

`project(src -> dst)` (src = camera-space x,y,z,u,v; dst = a temporary):
```c
dst.z = (float)(1.0 / src.z);                                             // 1/Z, stored float32 first
dst.x = (float)(src.x * SX[0x5c99c] * dst.z + cx[0x5938c] + 0.5);         // 0.5 is a double constant
dst.y = (float)(cy[0x59390] - src.y * SY[0x5c9a0] * dst.z + 0.5);
dst.u = (float)(src.u * dst.z);
dst.v = (float)(src.v * dst.z);
```
Order of operations exactly as written (left to right; `cy - (y*SY*invz)` then `+0.5`). With the known
values: `x = X*351.0876/Z + 160.0`, `y = 100.0 - Y*292.573/Z` (but compute it in the order above).
The "+0.5" means that a later truncation `T(x)` is a round-to-nearest of the true pixel-centre coordinate.

```c
nearClipAndProject():
    z[i] = V[i]->z
    if (!(z[0] < 1.0f || z[1] < 1.0f || z[2] < 1.0f)) {
        // no clipping (0x18ede)
        for (i = 0; i < 3; i++) { project(*P[i] -> tmp[i]); P[i] = &tmp[i]; V[i] = &tmp[i].x; }
        return;
    }
    // sort indices by z: a0 = smallest z, a1 = middle, a2 = largest (0x188e5..0x189ea)
    if (z0 < z1) {
        if (z0 > z2)      { a0=2; a1=0; a2=1; }
        else { a0=0; if (z1 > z2) { a1=2; a2=1; } else { a1=1; a2=2; } }
    } else {
        if (z0 < z2)      { a0=1; a1=0; a2=2; }
        else { a2=0; if (z1 > z2) { a0=2; a1=1; } else { a0=1; a1=2; } }
    }
    if (z[a2] <= 1.0f) return;                       // whole face behind the plane: nothing drawn

    if (z[a1] < 1.0f) {
        // two vertices behind: one smaller triangle (0x18a36)
        clipZ(A=P[a2], B=P[a1], OUT=&tmp[a1], 1.0f);
        clipZ(A=P[a2], B=P[a0], OUT=&tmp[a0], 1.0f);
        P[a1] = &tmp[a1]; P[a0] = &tmp[a0];          // (V[] follow)
        project(*P[a2] -> tmp[a2]); P[a2] = &tmp[a2];
        project(tmp[a0] -> tmp[a0]);                 // in place, in the order a0 then a1
        project(tmp[a1] -> tmp[a1]);
    } else {
        // only a0 behind: quad = two triangles (0x18c23)
        clipZ(A=P[a0], B=P[a1], OUT=&tmp3,     1.0f);
        clipZ(A=P[a0], B=P[a2], OUT=&tmp[a0],  1.0f);
        project(*P[a1] -> tmp[a1]); P[a1] = &tmp[a1];
        project(tmp3 -> tmp3);                       // in place
        project(tmp[a0] -> tmp[a0]); P[a0] = &tmp[a0];
        face2 = { &tmp[a1], &tmp3, &tmp[a0] };
        drawTriTextured(face2, 1);                   // 0x18e49  (drawn FIRST)
        project(*P[a2] -> tmp[a2]); P[a2] = &tmp[a2];
        // the current triangle is now (tmp[a0] = point on a0-a2, a1, a2), each at index a0,a1,a2
    }
```
Comparisons are x87 `fcomp` + `jb/jae/jbe`; NaN is not expected.
In-place `project` reads x,y,z,u,v of the temporary then overwrites z first (z=1/z), then x, y, u, v using
the new z — equivalent to the formula above.

### 4.2 Screen-edge clip, one axis at a time (X: 0x18f83..0x194ef, Y: 0x19506..0x19a7a)

Identical code for both axes with these substitutions:

| | X pass (mode < 2) | Y pass (mode < 3) |
|---|---|---|
| coordinate `c(i)` | `V[i]->x` | `V[i]->y` |
| size `N` | width [0x59384] | height [0x59388] |
| clip helper | `clipX` = sub_18766 | `clipY` = sub_187b8 |
| mode passed to the recursive call | 2 | 3 |

```c
clipAxis():
    n = 0;                                            // cl: number of vertices outside
    for (i = 0; i < 3; i++) {
        if (0.0 > c(i))                  { code[i] = 1; n++; }      // off the low side  (c < 0)
        else if (!((float)N > c(i)))     { code[i] = 2; n++; }      // off the high side (c >= N)
        else                               code[i] = 0;
    }
    s = (uint8)(code[0] + code[1] + code[2] - 3);     // ch; s == 0 with n == 2 means codes are {0,1,2}

    // --- stage A (0x1901b): the two "same side" vertices are clipped towards the third one
    if (n == 3 || (n == 2 && s != 0)) {
        e01 = (code[0] == code[1]);  e02 = (code[0] == code[2]);
        if (e01 && e02) return;                       // all three off the same side: nothing drawn
        if (e01)      { a0 = 2; a1 = 0; a2 = 1; }
        else if (e02) { a0 = 1; a1 = 0; a2 = 2; }
        else          { a0 = 0; a1 = 1; a2 = 2; }     // a0 = the odd one, a1 and a2 share a code
        plane = (code[a1] == 1) ? 0.0f : (float)((double)N - 0.5);    // 319.5 or 199.5
        clip(A=P[a0], B=P[a1], OUT=&tmp[a1], plane);
        clip(A=P[a0], B=P[a2], OUT=&tmp[a2], plane);
        P[a1] = &tmp[a1]; P[a2] = &tmp[a2];
        if (n == 3) { n = 1; code[a1] = 0; code[a2] = 0; }     // a0 is still outside (other side)
        // if n was 2: n stays 2 and s != 0, so stages B and C are skipped
    }

    // --- stage B (0x191ee): one inside, one off each side
    if (n == 2 && s == 0) {
        if (code[0] != 0) { a0 = 0; if (code[1] == 0) { a1 = 1; a2 = 2; } else { a1 = 2; a2 = 1; } }
        else              { a0 = 1; a1 = 0; a2 = 2; }
        // a0 = first outside vertex, a1 = the inside vertex, a2 = the other outside vertex
        plane = (code[a0] == 1) ? 0.0f : (float)((double)N - 0.5);
        clip(A=P[a0], B=P[a1], OUT=&tmp3,     plane);
        clip(A=P[a0], B=P[a2], OUT=&tmp[a0],  plane);
        P[a0] = &tmp[a0];
        face2 = { &tmp3, &tmp[a0], P[a1] };
        drawTriTextured(face2, axisMode);             // 2 for X, 3 for Y
        code[a0] = 0; n = 1;                          // falls into stage C for a2
    }

    // --- stage C (0x1937d): exactly one vertex outside
    if (n == 1) {
        if (code[0] != 0)      { a0 = 0; a1 = 1; a2 = 2; }
        else if (code[1] != 0) { a0 = 1; a1 = 0; a2 = 2; }
        else                   { a0 = 2; a1 = 0; a2 = 1; }
        plane = (code[a0] == 1) ? 0.0f : (float)((double)N - 0.5);
        clip(A=P[a0], B=P[a1], OUT=&tmp3,     plane);
        clip(A=P[a0], B=P[a2], OUT=&tmp[a0],  plane);
        P[a0] = &tmp[a0];
        face2 = { &tmp3, &tmp[a0], P[a1] };
        drawTriTextured(face2, axisMode);
        // current triangle continues as (tmp[a0], P[a1], P[a2])
    }
```
Notes:
- The clip planes are `0.0` and `N - 0.5` (319.5 / 199.5), but the *outside test* is `c < 0` or `c >= N`.
  So a vertex with 319.5 < x < 320 is not clipped; `T(x)` is then 319, still on screen.
- Clipped coordinates are exactly `0.0` or `N-0.5` so `T()` gives 0 or N-1.
- Stage B's recursive triangle `(tmp3, tmp[a0], a1)` can still stick out of the opposite side; it is
  nevertheless drawn with the axis' clip skipped. **Uncertain whether this can really overflow**:
  tmp3 and tmp[a0] are on the plane of a0's side and a1 is inside, so geometrically it cannot; I believe it is
  safe.
- Sub-triangles are always drawn before the remaining triangle.

### 4.3 Vertex sort (0x19a7f..0x19e0d)

All comparisons are on **truncated integer** coordinates `iy(i) = T(V[i]->y)`, `ix(i) = T(V[i]->x)`.
`swap(i,j)` exchanges both V[i],V[j] and P[i],P[j].

```c
    d = (int16)(iy(1) - iy(0));  blk.h01 = d;
    if (d < 0) swap(0,1);
    else if (d == 0) { e = ix(1) - ix(0); if (e < 0) swap(0,1); else if (e == 0) return; }

    d2 = (int16)(iy(2) - iy(0)); blk.h12 = d2;
    if (d2 < 0) swap(0,2);
    else if (d2 == 0) {
        if (blk.h01 == 0) return;                 // h01 here = the value stored 3 lines above (pre-swap d)
        e = ix(2) - ix(0); if (e < 0) swap(0,2); else if (e == 0) return;
    }

    d3 = (int16)(iy(2) - iy(1)); blk.h12 = d3;
    if (d3 < 0) swap(1,2);
    else if (d3 == 0) { e = ix(2) - ix(1); if (e < 0) swap(1,2); else if (e == 0) return; }

    blk.h01 = (int16)(iy(1) - iy(0));     // >= 0
    blk.h12 = (int16)(iy(2) - iy(1));     // >= 0
```
Result: V0 = top, V1 = middle, V2 = bottom by integer y; vertices on the same integer row are ordered by
integer x (left first). Triangles with two vertices on the same integer pixel, or with all three on one
row, are dropped. `h01 + h12 > 0` is guaranteed after this.

### 4.4 Plane gradients (0x19e20..0x1a0af) — only if `blk.gradValid == 0`

Uses the **float** (sub-pixel) vertex positions, not the truncated ones. All named temporaries are stored
as float32; products/sums are evaluated in x87 precision and rounded to float32 at each store.

```c
    dy2 = V2.y - V0.y;   dx1 = V1.x - V0.x;
    dy1 = V1.y - V0.y;   dx2 = V2.x - V0.x;
    area = (float)(dx1*dy2 - dx2*dy1);
    if ((bits(area) & 0x7fffffff) == 0) return;          // +0 or -0: nothing drawn (gradValid stays 0)
    inv  = (float)(1.0 / area);
    k16  = (float)(inv * 16.0f);

    dz1 = V1.z - V0.z;  dz2 = V2.z - V0.z;               // z here is 1/Z
    blk.dZdx16 = (float)((dy2*dz1 - dy1*dz2) * k16);
    blk.dZdy   = (float)((dz1*dx2 - dz2*dx1) * (-inv));

    inv  = (float)(inv * 256.0f);
    k16  = (float)(k16 * 256.0f);                        // = 4096/area

    du1 = P1.u - P0.u;  du2 = P2.u - P0.u;               // u here is u/Z
    dv1 = P1.v - P0.v;  dv2 = P2.v - P0.v;
    blk.dUdx16 = (float)((dy2*du1 - dy1*du2) * k16);
    blk.dVdx16 = (float)((dy2*dv1 - dy1*dv2) * k16);
    ninv = (float)(-inv);
    blk.dVdy   = (float)((dv1*dx2 - dv2*dx1) * ninv);
    blk.dUdy   = (float)((du1*dx2 - du2*dx1) * ninv);
    blk.gradValid = 1;
```
`gradValid` is cleared only by a mode-0 call. Consequence: when a face is split by clipping, the first
sub-triangle that reaches this point computes the gradients (from its own three vertices) and all later
pieces of the same face **reuse** them (they are the same plane, so mathematically identical; numerically
they come from the first piece). If the first piece is dropped by the sort/area tests the next one computes
them.

### 4.5 Edge setup (0x1a0b6..0x1a5ad) — always

No sub-pixel correction of any kind: the interpolants start with the exact values of the top vertex and the
edges start at its truncated x; edge slopes are computed from truncated integer coordinates.

```c
    blk.Z0 = V0.z;                                       // bit copy of 1/Z
    blk.U0 = (float)(P0.u * 256.0f);
    blk.V0 = (float)(P0.v * 256.0f);

    x0  = T(V0.x);
    dxa = (float)(T(V1.x) - x0);                         // integer differences converted to float
    dxb = (float)(T(V2.x) - x0);
    h01 = blk.h01;  h12 = blk.h12;                       // signed 16-bit
    H    = (float)(h01 + h12);
    invH = (float)(1.0 / (h01 + h12));
    W    = (float)width;                                 // 320.0
    longStep = T((dxb * invH + W) * 65536.0f);           // 16.16, long edge V0->V2, "+320" = next row
    dxc  = (float)(dxb - dxa);                           // = T(V2.x) - T(V1.x)
    row  = rowtab[T(V0.y)];                              // y*320

    #define LEFTGRAD(dx, h, invh, outZ, outU, outV)                              \
        { s = (float)(dx * 0.0625f);                                             \
          outZ = (float)((s*blk.dZdx16 + h*blk.dZdy) * invh);                    \
          outU = (float)((s*blk.dUdx16 + h*blk.dUdy) * invh);                    \
          outV = (float)((s*blk.dVdx16 + h*blk.dVdy) * invh); }
    // i.e. per-scanline change along an edge = grad_x * (dx/h) + grad_y

    if (h01 != 0) {
        blk.leftOfs = blk.rightOfs = x0 + row;
        f01 = (float)h01;  inv01 = (float)(1.0 / h01);
        step01 = T((dxa * inv01 + W) * 65536.0f);
        if (longStep < step01) {                         // signed compare: long edge is the LEFT edge
            blk.leftStepTop  = longStep;
            blk.leftStepBot  = longStep;
            blk.rightStepTop = step01;
            if (h12 != 0) blk.rightStepBot = T((dxc / (float)h12 + W) * 65536.0f);   // true divide here
            LEFTGRAD(dxb, H, invH, blk.dZleftTop, blk.dUleftTop, blk.dVleftTop);
            blk.dZleftBot = blk.dZleftTop; blk.dUleftBot = blk.dUleftTop; blk.dVleftBot = blk.dVleftTop;
        } else {                                         // long edge is the RIGHT edge (also when equal)
            blk.rightStepBot = longStep;
            blk.leftStepTop  = step01;
            blk.rightStepTop = longStep;
            LEFTGRAD(dxa, f01, inv01, blk.dZleftTop, blk.dUleftTop, blk.dVleftTop);
            if (h12 != 0) {
                f12 = (float)h12;  inv12 = (float)(1.0 / h12);
                blk.leftStepBot = T((dxc * inv12 + W) * 65536.0f);                   // multiply by reciprocal here
                LEFTGRAD(dxc, f12, inv12, blk.dZleftBot, blk.dUleftBot, blk.dVleftBot);
            }
            // if h12 == 0: leftStepBot and the *Bot gradients keep stale values (never used)
        }
    } else {                                             // flat top: V0 is top-left, V1 is top-right
        blk.leftOfs  = x0 + row;
        blk.rightOfs = row + T(V1.x);
        blk.leftStepBot = blk.leftStepTop = longStep;
        blk.rightStepBot = T((dxc / (float)h12 + W) * 65536.0f);
        // rightStepTop and the *Top-only fields are stale (upper part has 0 lines)
        LEFTGRAD(dxb, H, invH, blk.dZleftTop, ...);  and copy Top -> Bot   (same code as above, 0x1a4fd)
    }

    if (blk.h12 == 0) blk.h01++;                         // flat bottom: the upper part also draws the last row
    sub_1255b(&blk);                                     // eax = 0x5c874
```
`T((slope + 320.0) * 65536)`: the argument is always positive (|slope| < 320), so the truncation is a
floor of the biased value. Float32 rounding happens at `dx*invh` operands only (dxa etc. are exact small
integers, `inv*` are float32 reciprocals); the sum and the multiply by 65536 are done in x87 precision
before truncation.

---------------------------------------------------------------------------------------------------

## 5. sub_1a5be — `drawTriTexturedThroughTable(eax = Face* face, dl = mode, ebx = uint8* tex)`

Exact differences from sub_1880d (I normalised both listings and diffed them; everything not listed is
instruction-for-instruction the same apart from register allocation and stack-slot numbering):

1. Third argument `ebx` = texture pointer (64 KB aligned 256x256). `face[+0x31]` is **not** read.
   In mode 0 (0x1a642):
   ```c
   blk2.tex = tex + ((uint32)[0x5c934] >> 16);     // 0x5c8d4.  [0x5c934] = 64K-aligned table pointer
   blk2.gradValid = 0;                             // 0x5c924
   ```
   i.e. the high 16 bits are the texture's 64K "segment" and the low 16 bits are the table's 64K "segment".
   The rasterizer unpacks it: `texBase = blk2.tex & 0xffff0000`, `tableBase = (blk2.tex & 0xffff) << 16`.
   `face[+0x28]` is still tested in mode 0.
2. All five recursive calls are to sub_1a5be itself with `ebx = 0` (ignored because mode != 0).
3. Uses its own parameter block at 0x5c8d4 (same layout, table in section 2) and its own copies of the
   constants (0x512a0, 0x512a8, 0x512b0, 0x512b4, 0x512b8); values identical.
4. Ends with `sub_119c2(eax = 0x5c8d4)` instead of `sub_1255b(eax = 0x5c874)`.

Clipping, projection, sort, gradient and edge setup are identical, including all rounding.
The gradient section multiplies `inv` and `k16` by 256 in the same way (order of the two statements
swapped, no effect).

Call sites in sub_1c893 pass `ebx = [0x5c95c]` (0x1c95b) or `[0x5c958]` (0x1ca64) etc.; u,v are
temporarily replaced by `vertex[+0x24] + 8192.0` and `vertex[+0x2c] + 8192.0` (see section 1).

---------------------------------------------------------------------------------------------------

## 6. sub_1255b — the span rasterizer used by sub_1880d (outside the slice; documented because it defines the fill rule)

`eax = block pointer`. Pure asm, `pushal/popal`, leaves the FPU stack balanced. Working variables live at
0x53e10..0x53e7f (private to the rasterizers; several of them overlap on purpose).

### 6.1 Fill convention (the short version)

- Scanlines: the upper part draws `h01` lines starting at `T(V0.y)`, then the lower part draws `h12 + 1`
  lines. With the `h01++` fix-up for flat-bottom triangles, **every triangle covers rows
  `T(y0) .. T(y2)` inclusive** (top and bottom rows both drawn).
- Each scanline draws the pixels `L .. R` **inclusive**, `n = R - L + 1` pixels, where L and R are the
  integer parts of two 16.16 accumulators that both start at `x0 + 0.5` (flat top: `x0+0.5` and `x1+0.5`)
  on row `T(y0)` and are advanced by `leftStep` / `rightStep` after each row.
  (They are really frame-buffer offsets: the step contains +320 so the same add moves to the next row.)
- So there is **no top-left rule**: adjacent triangles overdraw each other on shared edges, and both the
  first and the last pixel/row are plotted. Since vertex x,y already contain +0.5 and are truncated, the
  vertices land on round-to-nearest pixels.
- No sub-pixel/sub-texel prestep: the texture coordinate used for pixel L of a row is the left-edge
  interpolant itself (which started as the top vertex's exact u,v and is stepped per row with the
  integer-slope gradient of 4.5).

### 6.2 Exact algorithm

```c
void sub_1255b(Block *b)
{
    // FPU state kept across the whole function: dZ16 = b->dZdx16, dU16 = b->dUdx16, dV16 = b->dVdx16
    float Z = b->Z0, U = b->U0, V = b->V0;              // [0x53e68], [0x53e6c], [0x53e70]  (float32 storage)
    long double w = 1.0 / Z;                            // 1/(1/Z) = Z_camera at the left edge
    uint8 *tex = (uint8*)(b->tex & 0xffff0000);         // low 16 bits get replaced by (v<<8)|u
    int32 left  = [0x53e18] + b->leftOfs;               // pointer to pixel L
    int32 right = [0x53e18] + b->rightOfs;              // pointer to pixel R
    uint16 lfrac = 0x8000, rfrac = 0x8000;              // esi = 0x80008000
    int32 lstep = b->leftStepTop, rstep = b->rightStepTop;
    float dZl = b->dZleftTop, dUl = b->dUleftTop, dVl = b->dVleftTop;

    int lines = (int16)b->h01;                          // upper part: `lines` rows
    int part = 0;
    for (;;) {
        if (part == 0) { if (lines <= 0) goto lower; }  // (dec cx; jl)
        while (lines-- > 0)  drawRow();                 // see below; upper part runs h01 times
      lower:
        if (part == 1 || (int16)b->h12 <= 0) break;
        part = 1;
        lstep = b->leftStepBot;  rstep = b->rightStepBot;
        dZl = b->dZleftBot; dUl = b->dUleftBot; dVl = b->dVleftBot;
        lines = (int16)b->h12 + 1;                      // lower part runs h12+1 times (counter h12..0)
    }
}

drawRow():
    // perspective-correct coordinates at the span start, 24.8 fixed point, texel = bits 8..15
    int32 vi = RI(V * w);                               // [0x53e30]
    int32 ui = RI(U * w);                               // [0x53e33]
    float Un = (float)(U + dU16);                       // [0x53e78] u/Z*256 16 pixels further right
    float Vn = (float)(V + dV16);                       // [0x53e7c]
    float Zn = (float)(Z + dZ16);                       // [0x53e74]
    long double wn = 1.0 / (Z + dZ16);                  // divide uses the unrounded sum

    int32 n = right - left + 1;                         // only the low 16 bits are used
    uint8 *dst = (uint8*)left;

    // split n into full 16-pixel spans and a remainder of 1..16
    uint16 n16 = (uint16)n;
    int8  full = (int8)((n16 >> 4) & 0xff);
    int   rem  = n16 & 15;
    if (rem == 0) { rem = 16; full--; }
    // `full` 16-pixel spans, then `rem` pixels.  n=1..16 -> full=0;  n=17 -> full=1, rem=1; ...
    // QUIRK: n == 0 gives full = -1, rem = 16  -> 16 pixels ARE drawn.  n < 0 similar garbage (see 6.4).

    for (; full > 0; full--) {
        int32 vi2 = RI(Vn * wn);  Vn = (float)(Vn + dV16);
        int32 ui2 = RI(Un * wn);  Un = (float)(Un + dU16);
        wn_next = 1.0 / (Zn + dZ16);  Zn = (float)(Zn + dZ16);
        affine16(dst, 16, ui, vi, ui2, vi2);  dst += 16;
        ui = ui2; vi = vi2; wn = wn_next;
    }
    // last (partial) span: end point is still computed a full 16 pixels ahead, step = delta/16
    {
        int32 vi2 = RI(Vn * wn);
        int32 ui2 = RI(Un * wn);
        affine16(dst, rem, ui, vi, ui2, vi2);
    }

    // step the left-edge interpolants to the next row
    U = (float)(U + dUl);  V = (float)(V + dVl);
    w = 1.0 / (Z + dZl);   Z = (float)(Z + dZl);        // divide uses the unrounded sum

    // step the edges: 16.16 add, integer part moves the pointer (includes +320 per row)
    t = lfrac + (lstep & 0xffff);  lfrac = t & 0xffff;  left  += (lstep >> 16 /*signed*/) + (t >> 16);
    t = rfrac + (rstep & 0xffff);  rfrac = t & 0xffff;  right += (rstep >> 16 /*signed*/) + (t >> 16);
```
(The real code computes the next row's `w` before drawing the last span; order has no effect.)

`affine16(dst, count, ui, vi, ui2, vi2)` — the inner loop (0x126f4..0x127d0 unrolled x16, 0x12837..0x12897
for the tail). Bit-exact description:

```c
    uint32 du   = (uint32)(ui2 - ui);                   // 32-bit wrap
    uint16 ustep = (du >> 4) & 0xffff;                  // 8.8: int = bits 12..19 of du, frac = bits 4..11
    uint16 vstep = (uint16)((int16)(uint16)(vi2 - vi) >> 4);   // 16-bit difference, ARITHMETIC shift, 8.8
    uint16 uacc = ui & 0xffff;                          // 8.8, texel column = high byte
    uint16 vacc = vi & 0xffff;                          // 8.8, texel row    = high byte
    for (k = 0; k < count; k++) {
        dst[k] = tex[((vacc >> 8) << 8) | (uacc >> 8)]; // direct copy of the texel, no table, no transparency
        uacc += ustep;  vacc += vstep;                  // both wrap mod 65536 -> texture repeats (256x256)
    }
```
- Pixel k of a span samples at `start + k*step`; pixel 0 uses the exact perspective value. Each 16-pixel
  span restarts from an exactly computed value (no error accumulation across spans).
- Texel address: `tex + 256*row + column`, row from v, column from u. u, v wrap modulo 256 texels.
- Pixels are stored two at a time as a 16-bit word (even/odd pair) and a final single byte; equivalent
  to byte writes.
- Tiny cross-talk, only needed for bit-exactness: the code keeps `vacc` in the low 16 bits of EDX and the
  u fraction in the top byte of EDX, with bits 16..23 holding bits 16..23 of `vi` as junk; `add edx, ebp`
  adds `vstep` (not sign-extended) to the low 16 bits and the u-fraction step to the top byte. A carry out
  of `vacc` increments the junk byte, and if the junk byte overflows (it starts at `(vi >> 16) & 0xff`)
  the carry reaches the u fraction (+1/256 texel once). This can only happen when `(vi>>16)&0xff` is
  within 16 of 0xff, i.e. v texel coordinate in [61440, 65535] mod 65536 — e.g. slightly negative v.
  To emulate exactly: `edx = (ufrac<<24) | (((vi>>16)&0xff)<<16) | vacc; ebp = ((ustep&0xff)<<24) | vstep;`
  per pixel `edx = (edx + ebp) mod 2^32; carry = overflow; ucol = (ucol + (ustep>>8) + carry) & 0xff;
  vrow = (edx >> 8) & 0xff` (fetch happens before the update).

### 6.3 Fixed-point formats summary

| quantity | format |
|---|---|
| edge x / frame-buffer offset | 16.16, fraction starts at 0x8000 (0.5), step includes 320<<16 |
| 1/Z, u/Z*256, v/Z*256 along the left edge and across | float32 accumulators, stepped per row (`d?left`) and per 16 pixels (`d?dx16`) |
| u, v at span ends | 24.8 integers from `RI((u/Z*256) * (1/(1/Z)))` |
| u, v inside a span | 8.8, step = (end-start)/16 |

### 6.4 Quirks worth knowing for a faithful port

- `n == 0` (R one pixel left of L) draws 16 pixels; `n < 0` draws `((n&15) or 16)` pixels. L > R can only
  come from rounding of the two truncated 16.16 slopes on sliver triangles near the bottom vertex. I did
  not prove it happens in the demo. sub_119c2 handles `n == 0` correctly (draws nothing), see below.
- Only the low 16 bits of `n` are used and the full-span count is an 8-bit signed value: fine for 320 wide.
- No clipping in the rasterizer; everything relies on section 4.2.

---------------------------------------------------------------------------------------------------

## 7. sub_119c2 — the span rasterizer used by sub_1a5be (0x119c2..0x11e8b)

Same structure as sub_1255b, same FPU sequence, same line counts (h01 rows, then h12+1 rows), same
inclusive `L..R` spans, same 16-pixel subdivision and the same `affine16` stepping. Differences:

1. Unpacks `b->tex` (stored to 0x53e12 so that the dword at 0x53e10 becomes `table_hi16 << 16`):
   `texBase = b->tex & 0xffff0000`, `table = (b->tex & 0xffff) << 16`.
2. Per-pixel write is a read-modify-write through the 64 KB table:
   ```c
   dst[k] = table[(texel << 8) | dst[k]];        // texel = tex[(vrow<<8)|ucol], row index = TEXEL, column = old screen pixel
   ```
   Destination pixels are read as a 16-bit word before the pair is written; equivalent to per-byte.
3. The left fraction accumulator starts at 0x8001 instead of 0x8000 (`esi = 0x80008001`), the right one at
   0x8000. (Pointer bookkeeping differs — `edi = L`, `eax = R+1` — but `n = R - L + 1` is the same.)
4. Remainder logic: when `(n & 15) == 0` and `(n >> 4) == 0` (i.e. n == 0) the remainder stays 0 and
   nothing is drawn; otherwise identical (`rem = 16, full--`). Negative n still draws garbage.
5. In the unrolled loop the u column update is `adc bx, si` (16-bit) followed by `mov bh, dh`; the carry
   into bh is overwritten, so it is equivalent to the 8-bit update of sub_1255b. Same cross-talk note as 6.2.

Table at [0x5c934] (built by sub_1853c at 0x1853c, outside this slice; quick read only, **verify with
that slice's owner**): `table[level*256 + c]` = index of the palette entry (palette pointer at
[0x5c938], 3 bytes/entry, 6-bit) nearest (sum of absolute differences, initial best distance 0xc0) to
`min(63, T(c_rgb + (63 - c_rgb) * 0.25 * level))` per channel — i.e. "brighten colour c towards white by
level". Because sub_119c2 indexes it with `texel` as `level` and the existing screen pixel as `c`, the
sub_1a5be pass adds an (environment-map) highlight on top of what sub_1880d has already drawn.

---------------------------------------------------------------------------------------------------

## 8. Open questions / things not verified

- FPU rounding mode in effect for the rasterizers' `fistp` (`RI`): assumed round-to-nearest-even; the
  C code never changes it permanently (0x1f318 restores the control word). x87 precision-control setting
  (53 vs 64 bit) is also unknown; float32 stores are marked explicitly above, so using JS doubles +
  `Math.fround` at the stores reproduces everything except possibly last-bit differences in `RI`/`T` ties.
- Vertex struct fields other than +0x18..+0x20, +0x24, +0x2c, +0x30, +0x34 and its total size; face fields
  other than +0, +4, +8, +0x28, +0x2a, +0x31.
- Whether `L > R` (section 6.4) ever occurs with the demo's data.
- Semantics of the sub_1853c table and of [0x5c958]/[0x5c95c] textures (other slices).
- Stage B recursion with the axis clip skipped (4.2 note) — believed safe, not proven.
