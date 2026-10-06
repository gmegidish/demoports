# F_raster1 — KAHN.EXE 0x23bc8 .. 0x27514

Affine-textured ("flat texture, no shading") face pipeline of the 3D engine: near-plane clip,
projection, perspective-correct screen clip (float), conversion to an integer 2D triangle, integer
X-clip, and hand-off to the hand-written rasterizer `sub_12962` (NOT in this range). Plus a few
vec3 helpers and the billboard/sprite face drawer `sub_27434`.

**Corrections to the expectations in the task:**

- `sub_23cf0` is NOT a scan converter. It is an integer 2D triangle X-clipper (x against 0 and
  width-1) that splits the triangle and calls the real rasterizer `sub_12962` 0..3 times.
- `sub_24b54` contains NO inner loop. It is clip + project + emit. It ends at 0x25fc0 (not 0x27434).
- `0x25fc4 .. 0x27431` is an undisassembled, **dead** twin of `sub_24b54` (only called by itself;
  no call/pointer to it anywhere in code or data). Differences listed below.
- The actual span/texel loops live in `sub_12962` (0x12962..0x12fe0, hand-written asm, `pushal`,
  FPU gradient setup, self-contained Y clipping). Only its interface is summarised here.

`trunc()` below = `call 0x1f318` + `fistp`: sub_1f318 sets the FPU control word high byte to 0x1F
(RC = chop, PC = 64-bit), does `frndint`, restores CW. So every `call 0x1f318 ; fistp` is
**truncation toward zero**.

All `float` loads/stores are float32 unless stated. Intermediate x87 values are kept in registers
(extended) between a load and the next store; a port should apply `Math.fround` at every point
marked "store f32".

---------------------------------------------------------------------------------------------

## Structures

### Vertex (engine vertex, stride unknown from this slice, >= 0x38)

| off  | type    | meaning |
|------|---------|---------|
| 0x18 | float32 | view-space x (after transform, before projection) |
| 0x1c | float32 | view-space y (up is +y: projection does `cy - y*...`) |
| 0x20 | float32 | view-space z (depth, near plane is z = 1.0) |
| 0x30 | float32 | u, in texel units (0..255 for a 256-wide texture) |
| 0x34 | float32 | v, in texel units |

Evidence: 24998/24a0c/24ab0 and 24b54 read only these. Offsets 0..0x17 and 0x24..0x2f are not
touched in this slice.

`sub_24b54` makes **local copies** of vertices, 0x40 bytes each (4 of them at esp+0x00, +0x40,
+0x80, +0xC0), using the same field offsets, but there the meaning is *projected*:

| off  | type    | meaning in a projected (local) vertex |
|------|---------|----------|
| 0x18 | float32 | screen x (already includes +0.5 rounding bias) |
| 0x1c | float32 | screen y (already includes +0.5 rounding bias) |
| 0x20 | float32 | w = 1/z |
| 0x30 | float32 | u (texels, unchanged, NOT divided by z) |
| 0x34 | float32 | v |

### Face (packed, size 0x35 = 53 bytes; `imul ebx,esi,0x35` at 0x142b4/0x165c4)

| off  | type      | meaning |
|------|-----------|---------|
| 0x00 | Vertex*   | v[0] |
| 0x04 | Vertex*   | v[1] |
| 0x08 | Vertex*   | v[2] |
| 0x18 | float32[3]| face normal (used by callers: `sub_23b6c(&centroidSum, face+0x18)`) |
| 0x30 | uint8     | flags, used by the callers to choose the drawer (see Dispatch) |
| 0x31 | uint32    | texture pointer (64 KB-aligned 256x256 texture). Becomes dword 0 of the 2D triangle; in `sub_12962` it is stored to 0x53e10 and used as `ebx` base with `bl=u, bh=v` => texel = tex[(v<<8)|u] |

The recursion in sub_24b54 passes a fake 12-byte "face" (only the 3 vertex pointers) — fields
0x18/0x30/0x31 are never read when mode != 0.

### Tri2D (the block at 0x5cfb8, 28 bytes) — input of sub_23cf0 and sub_12962

| addr     | off | type   | meaning |
|----------|-----|--------|---------|
| 0x5cfb8  | 0   | uint32 | texture pointer (= face+0x31) |
| 0x5cfbc  | 4   | int16  | x0 |
| 0x5cfbe  | 6   | int16  | y0 |
| 0x5cfc0  | 8   | int16  | u0 |
| 0x5cfc2  | 10  | int16  | v0 |
| 0x5cfc4  | 12  | int16 x1, 0x5cfc6 y1, 0x5cfc8 u1, 0x5cfca v1 |
| 0x5cfcc  | 20  | int16 x2, 0x5cfce y2, 0x5cfd0 u2, 0x5cfd2 v2 |

Vertex i is at `tri + 4 + 8*i`. (sub_23cf0 reads the words as `dword[tri+8i+2] >> 16` etc., i.e.
sign-extended int16. sub_12962 reads `dword[tri+4+8i]` as the sort key `(y<<16)|(x&0xffff)`.)

The dead twin uses an identical block at 0x5cfd4..0x5cfef.

---------------------------------------------------------------------------------------------

## Globals used

| addr    | type    | meaning | written by |
|---------|---------|---------|------------|
| 0x59384 | int32   | screen width (320) | – |
| 0x59388 | int32   | screen height (200) | – |
| 0x5938c | float32 | cx = width*0.5-0.5 (159.5) | – |
| 0x59390 | float32 | cy = height*0.5-0.5 (99.5) | – |
| 0x5c998 | uint16  | billboard half-size in world units (read by sub_27434); copied from scene struct +0x24 at 0x18204 (another writer at one more place, `mov [0x5c998],ax`) | outside |
| 0x5c99c | float32 | sx, horizontal projection scale = (width*0.5) / tan(0.427606) ; set at 0x18222..0x18253 (tan result stored f32, then widened; dbl 0.427606 at 0x50c34) | outside |
| 0x5c9a0 | float32 | sy, vertical projection scale = (height*0.5 / 0.75f) / tan(0.427606) ; 0x18259..0x18279 | outside |
| 0x5c9a8 | float32 | "w threshold" for doing float screen clipping. **Never written anywhere** (only 12 reads: 6 in sub_24b54, 6 in the dead twin; no other occurrence of the address in code) => BSS => always 0.0 | nobody |
| 0x5cfb8..0x5cfd3 | Tri2D | output triangle of sub_24b54 | sub_24b54 |
| 0x5cfd4..0x5cfef | Tri2D | output triangle of dead twin 0x25fc4 | dead |
| 0x54730 | float32 const | 1.0 (near plane z) | const |
| 0x51900 | float64 const | 0.5 | const |
| 0x51908 | float64 const | -0.5 | const |
| 0x51910 / 0x51918 | float64 | 0.5 / -0.5 (twin's copies) | const |
| 0x593a0 | ptr | work buffer A (passed by caller of sub_27434 as edx) | – |

Constant dump (peek.py): `54730: 1` (f32), `5472c: 0.75` (f32), `51900: 0.5`, `51908: -0.5`,
`51910: 0.5`, `51918: -0.5` (f64). No lookup tables are read in this slice.

---------------------------------------------------------------------------------------------

## Small vec3 helpers (0x23bc8 .. 0x23ce3)

vec3 = float32[3].

### sub_23bc8 — vec3_normalize(eax = v) (in place, returns nothing)
```
float len2 = v[1]*v[1] + v[0]*v[0] + v[2]*v[2];   // store f32
if (0.0 < len2) {                                 // skipped when 0 >= len2
    inv = 1.0 / sqrt(len2);                       // kept in x87 register (not rounded to f32)
    v[0] = v[0]*inv; v[1] = v[1]*inv; v[2] = v[2]*inv;   // store f32
}
```

### sub_23c28 — vec3_length(eax = v) -> ST0
`return sqrt(v[1]*v[1] + v[0]*v[0] + v[2]*v[2]);` (not rounded to f32 before sqrt)

### sub_23c48 — vec3_lincomb(eax = A, edx = B, stack: float a, float b, vec3* out) ; ret 0xC
```
out[0] = A[0]*a + B[0]*b;  out[1] = A[1]*a + B[1]*b;  out[2] = A[2]*a + B[2]*b;
```
(stack slots in ascending address order: a, b, out.) Callers: 0x17eb3, 0x2f43c.

### sub_23c90 — vec3_copy(eax = src, edx = dst): copies 12 bytes.

### sub_23cbc — vec3_set(stack: float x, float y, float z, vec3* out) ; ret 0x10
`out[0]=x; out[1]=y; out[2]=z;` (bit copies; eax input is ignored).

---------------------------------------------------------------------------------------------

## Clipping helpers

All three: `eax = A`, `edx = B`, `ebx = Out` (Vertex*), one float on the stack = plane position,
`ret 4`. Out may alias A or B (all inputs are loaded before the aliasing field is overwritten;
verified for the aliasing patterns actually used). Out gets only fields 0x18,0x1c,0x20,0x30,0x34.

### sub_24998 — clip_edge_nearZ(A, B, Out, float zc)   (view space, linear)
```
t      = (zc - B.z) / (A.z - B.z);          // x87 register, not rounded
Out.x  = B.x + (A.x - B.x)*t;               // computed as (A.x-B.x)*t + B.x ; store f32
Out.y  = B.y + (A.y - B.y)*t;               // (A.y-B.y)*t + B.y
Out.z  = zc;                                // bit copy of the argument
Out.u  = B.u + (A.u - B.u)*t;               // (A.u-B.u)*t + B.u
Out.v  = B.v + (A.v - B.v)*t;
```
Callers: sub_24b54 (and sub_2b3c0, another slice).

### sub_24a0c — clip_edge_screenX(A, B, Out, float xc)   (projected vertices, perspective-correct u,v)
Here field 0x20 is w = 1/z.
```
t      = (xc - B.x) / (A.x - B.x);
w      = B.w + (A.w - B.w)*t;               // (A.w-B.w)*t + B.w
Out.w  = w;                                 // store f32 (the unrounded register value keeps being used below)
Out.x  = xc;                                // bit copy
Out.y  = B.y + (A.y - B.y)*t;               // (A.y-B.y)*t + B.y
inv    = 1.0 / w;
Out.u  = (B.u*B.w + (A.u*A.w - B.u*B.w)*t) * inv;   // i.e. interpolate u*w linearly, divide by w
Out.v  = (B.v*B.w + (A.v*A.w - B.v*B.w)*t) * inv;
```

### sub_24ab0 — clip_edge_screenY(A, B, Out, float yc)
Identical to sub_24a0c with x and y swapped:
```
t = (yc - B.y)/(A.y - B.y);  w = B.w + (A.w-B.w)*t;  Out.w = w;  Out.y = yc;
Out.x = B.x + (A.x-B.x)*t;   Out.u, Out.v as above.
```

---------------------------------------------------------------------------------------------

## sub_24b54 — draw_face_affine_textured(eax = Face* face, dl = mode)   0x24b54..0x25fc0

No return value. Stack frame 0x16c, recursive (calls itself with mode 1, 2, 3).

mode (dl, kept at [esp+0x168]):
- 0: external entry. Vertices are in view space. Does: set texture, near clip, project, X clip, Y clip, emit.
- 1: vertices already projected (x, y, w). Does X clip, Y clip, emit.
- 2: Y clip, emit.
- 3: emit only.

All external callers pass mode 0.

Locals: `vp[3]` ([esp+0x138]) vertex pointers, `pp[3]` ([esp+0x144]) = vp[i]+0x18 (always kept in
sync, so I only write `vp`), `loc[4]` 0x40-byte local vertices (loc[3] at esp+0xC0 is the "extra"
vertex), `o[3]` index permutation bytes ([esp+0x160]), `code[3]` ([esp+0x164]), `tmpface[3]`
([esp+0x100], three Vertex* for the recursive call), `clip` float ([esp+0x158]).

```
project(dst, src):                    // "store f32" after each line
    dst.w = 1.0 / src.z;                                   // field 0x20
    dst.x = (src.x * sx * dst.w + cx) + 0.5;               // sx=[0x5c99c], cx=[0x5938c]; uses the f32-rounded dst.w
    dst.y = (cy - src.y * sy * dst.w) + 0.5;               // sy=[0x5c9a0], cy=[0x59390]
    // multiplication order: (coord * scale) * w ; 0.5 is the double at 0x51900
    // with 320x200: dst.x = x*sx/z + 160.0 ; dst.y = 100.0 - y*sy/z

draw_face_affine_textured(face, mode):
    vp[0..2] = face->v[0..2];

    if (mode == 0) {
        *(u32*)0x5cfb8 = face->tex;                        // face+0x31 ; persists for the recursive calls

        if (vp[0].z < 1.0 || vp[1].z < 1.0 || vp[2].z < 1.0) {      // 1.0 = f32 at 0x54730
            // ---- near clip. Sort indices by z ascending into o[0] (nearest) .. o[2] (farthest)
            z0=vp[0].z; z1=vp[1].z; z2=vp[2].z;
            if (z0 < z1) {                                  // (!(z0 >= z1))
                if (z0 > z2)        o = [2,0,1];
                else if (z1 > z2)   o = [0,2,1];
                else                o = [0,1,2];
            } else {
                if (z0 < z2)        o = [1,0,2];
                else if (z1 > z2)   o = [2,1,0];
                else                o = [1,2,0];
            }
            if (vp[o[2]].z <= 1.0) return;                  // everything at/behind the near plane

            if (vp[o[1]].z < 1.0) {
                // two vertices behind (o0, o1), o2 in front
                clip_edge_nearZ(A=vp[o[2]], B=vp[o[1]], Out=&loc[o[1]], 1.0);
                clip_edge_nearZ(A=vp[o[2]], B=vp[o[0]], Out=&loc[o[0]], 1.0);
                vp[o[1]] = &loc[o[1]];  vp[o[0]] = &loc[o[0]];
                project(&loc[o[2]], vp[o[2]]);  loc[o[2]].u = vp[o[2]].u;  loc[o[2]].v = vp[o[2]].v;
                vp[o[2]] = &loc[o[2]];
                for (k = 0; k < 2; k++) project(vp[o[k]], vp[o[k]]);     // in place (z==1.0 -> w==1.0)
            } else {
                // one vertex behind (o0); o1, o2 in front -> quad -> 2 triangles
                clip_edge_nearZ(A=vp[o[0]], B=vp[o[1]], Out=&loc[3],    1.0);   // on edge o0-o1
                clip_edge_nearZ(A=vp[o[0]], B=vp[o[2]], Out=&loc[o[0]], 1.0);   // on edge o0-o2
                loc[o[1]].u = vp[o[1]].u; loc[o[1]].v = vp[o[1]].v;
                project(&loc[o[1]], vp[o[1]]);  vp[o[1]] = &loc[o[1]];
                project(&loc[3], &loc[3]);                  // in place
                project(&loc[o[0]], &loc[o[0]]);            // in place
                vp[o[0]] = &loc[o[0]];
                tmpface = { &loc[o[1]], &loc[3], &loc[o[0]] };
                draw_face_affine_textured(tmpface, 1);      // first half of the quad
                project(&loc[o[2]], vp[o[2]]);  loc[o[2]].u = vp[o[2]].u; loc[o[2]].v = vp[o[2]].v;
                vp[o[2]] = &loc[o[2]];
                // remaining triangle = (loc[0], loc[1], loc[2]) i.e. (new o0, o1, o2)
            }
        } else {
            for (i = 0; i < 3; i++) {                       // 0x251aa
                project(&loc[i], vp[i]);  loc[i].u = vp[i].u;  loc[i].v = vp[i].v;
                vp[i] = &loc[i];
            }
        }
    }

    // ---------------- X clip (0x2522e) ----------------
    if (mode < 2 && (vp[0].w > T || vp[1].w > T || vp[2].w > T)) {      // T = [0x5c9a8] == 0.0 => always true
        W = (float)width;                                   // via fild qword, unsigned 32 -> exact
        nout = 0;
        for (i = 0; i < 3; i++) {
            x = vp[i].x;
            if (x < 0.0)        { code[i] = 1; nout++; }    // "0 > x"
            else if (!(W > x))  { code[i] = 2; nout++; }    // x >= width
            else                  code[i] = 0;
        }
        sum = (code[0]+code[1]+code[2]-3) & 0xff;           // == 0 for {0,1,2} (one left, one right, one in)
                                                            // (also 0 for 1,1,1 but that is rejected below)
        if (nout == 3 || (nout == 2 && sum != 0)) {
            // at least two vertices are outside on the SAME side
            e01 = (code[0]==code[1]);  e02 = (code[0]==code[2]);
            if (e01 && e02) return;                         // all three outside on the same side
            if (e01)      o = [2,0,1];
            else if (e02) o = [1,0,2];
            else          o = [0,1,2];                      // o[0] = odd one out, o[1],o[2] = the same-side pair
            clip = (code[o[1]] == 1) ? 0.0f : (float)(width - 0.5);     // (double)width + (-0.5) -> f32 = 319.5
            clip_edge_screenX(A=vp[o[0]], B=vp[o[1]], Out=&loc[o[1]], clip);
            clip_edge_screenX(A=vp[o[0]], B=vp[o[2]], Out=&loc[o[2]], clip);
            vp[o[1]] = &loc[o[1]];  vp[o[2]] = &loc[o[2]];
            if (nout == 3) { code[o[1]] = 0; code[o[2]] = 0; nout = 1; }   // o[0] is outside on the other side
            // (sum is NOT recomputed)
        }
        if (nout == 2 && sum == 0) {
            // one left, one right, one inside
            if (code[0] != 0) o = (code[1] == 0) ? [0,1,2] : [0,2,1];
            else              o = [1,0,2];
            // o[0] = an outside vertex, o[1] = the inside vertex, o[2] = the other outside vertex
            clip = (code[o[0]] == 1) ? 0.0f : (float)(width - 0.5);
            clip_edge_screenX(A=vp[o[0]], B=vp[o[1]], Out=&loc[3],    clip);
            clip_edge_screenX(A=vp[o[0]], B=vp[o[2]], Out=&loc[o[0]], clip);
            vp[o[0]] = &loc[o[0]];
            tmpface = { &loc[3], &loc[o[0]], vp[o[1]] };
            draw_face_affine_textured(tmpface, 2);
            code[o[0]] = 0;  nout = 1;
        }
        if (nout == 1) {
            if (code[0] != 0)      o = [0,1,2];
            else if (code[1] != 0) o = [1,0,2];
            else                   o = [2,0,1];             // o[0] = the outside vertex
            clip = (code[o[0]] == 1) ? 0.0f : (float)(width - 0.5);
            clip_edge_screenX(A=vp[o[0]], B=vp[o[1]], Out=&loc[3],    clip);
            clip_edge_screenX(A=vp[o[0]], B=vp[o[2]], Out=&loc[o[0]], clip);
            vp[o[0]] = &loc[o[0]];
            tmpface = { &loc[3], &loc[o[0]], vp[o[1]] };
            draw_face_affine_textured(tmpface, 2);
            // remaining triangle: (vp[0], vp[1], vp[2]) with vp[o[0]] replaced
        }
    }

    // ---------------- Y clip (0x25816) ----------------
    // Exactly the same code with: mode < 3, vp[i].y instead of .x, height [0x59388] instead of width,
    // clip_edge_screenY instead of clip_edge_screenX, clip = 0.0f or (float)(height - 0.5) = 199.5,
    // and the recursive calls use mode 3. (Same permutations, same "return if all on one side".)

    // ---------------- emit (0x25dfe) ----------------
    for (i = 0; i < 3; i++) {
        tri.x[i] = (int16) trunc(vp[i].x);                  // x already has +0.5 in it
        tri.y[i] = (int16) trunc(vp[i].y);
        tri.u[i] = (int16) trunc(vp[i].u + 0.5);
        tri.v[i] = (int16) trunc(vp[i].v + 0.5);
    }                                                       // tri = Tri2D at 0x5cfb8 (tex set in mode 0)
    sub_23cf0(eax = 0x5cfb8);
```

Notes / things a port must keep:

- **Projection**: `xs = x*sx/z + cx + 0.5`, `ys = cy - y*sy/z + 0.5`; the pixel coordinate is
  `trunc(xs)`, i.e. round-half-up of the true coordinate for non-negative values. No sub-pixel or
  sub-texel correction exists in this drawer: after this point everything is int16.
- **Near plane** z = 1.0 in view space. "Needs near clip" is `z < 1.0` for any vertex; rejected when
  the farthest z `<= 1.0`.
- **Screen clip planes (float)**: left x = 0.0, right x = width-0.5 (319.5), top y = 0.0, bottom
  y = height-0.5 (199.5). Outcodes: `x < 0` left, `x >= width` right (so 319.5 <= x < 320 is
  "inside", truncates to 319); same for y with height. After clipping, int x is 0..319, y 0..199.
- u,v on new vertices are perspective-correct (interpolating u*w, v*w, w), but the triangle itself
  is then rasterized **affinely** (int16 u,v at the vertices).
- The float clip is gated by `any w > [0x5c9a8]`. Since 0x5c9a8 is never written (0.0) and w = 1/z > 0,
  it always runs. If it did not run, sub_23cf0 (int X clip) + sub_12962's own Y clipping would cover.
- A triangle that is entirely outside on one side is dropped only when all three outcodes are equal;
  there is no back-face culling and no degenerate check here (sub_12962 rejects zero-height ones).
- In mode 1/2 the `vp[]` point into the *parent's* locals; clip outputs always go to the callee's own
  `loc[]`, the parent's vertices are never modified by the child.
- Order of drawing sub-triangles: the split-off triangle (recursive call) is drawn first, then the
  remainder. Overlap matters only for shared edge pixels.

### Dead twin at 0x25fc4..0x27431 (call it sub_25fc4)
Instruction-for-instruction identical to sub_24b54 (diffed after normalising relative targets) except:
- Tri2D block is 0x5cfd4..0x5cfef instead of 0x5cfb8..0x5cfd3;
- uses the duplicate constants 0x51910 (0.5) / 0x51918 (-0.5);
- recursion calls 0x25fc4;
- final call is `sub_11e8c(eax = 0x5cfd4)` instead of `sub_23cf0(0x5cfb8)` (0x11e8c lies inside the
  hand-asm block that funclist.txt attributes to sub_119c2; it is not a listed function start).
Nothing calls 0x25fc4 except itself (searched all E8 rel32 targets and all 32-bit immediates in
code and data). A port can ignore it.

---------------------------------------------------------------------------------------------

## sub_23cf0 — tri2d_clipX_and_draw(eax = Tri2D* tri)   0x23cf0..0x24996

Clips the int16 triangle against x = 0 and x = width-1, modifying `tri` in place, and calls
`sub_12962(eax = tri)` once per resulting triangle (0, 1, 2 or 3 calls). No return value.
Only caller: sub_24b54. (Given the float clip above always runs, in practice all x are already in
0..319 and this function just falls through to one `sub_12962(tri)` call. The code below is still
exact.)

Vertex i: `x_i,y_i,u_i,v_i` = int16 at tri+4+8i, +6, +8, +10 (sign-extended to int32 for the math).
A "vertex slot" below is the 8 bytes at tri+4+8i.

```
lerp(base, other, t)  := base + trunc((float)(other - base) * t)      // int32 diff -> x87, * f32 t, chop; result stored as int16
// every t below is computed as int/int in x87 and STORED AS float32 before use.

W1 = (int16)(width - 1);
nL = nR = 0;
for (i = 0; i < 3; i++) {
    if (x_i < 0)                        { code[i] = 1; nL++; }
    else if ((unsigned)x_i >= width)    { code[i] = 2; nR++; }
    else                                  code[i] = 0;
}
if (nL + nR == 0) { sub_12962(tri); return; }
if (nL == 3 || nR == 3) return;

perm():                                       // used by cases A and B: a = odd one out
    if (code[0] == code[1])      (a,b,c) = (2,0,1);
    else if (code[0] == code[2]) (a,b,c) = (1,0,2);
    else                         (a,b,c) = (0,1,2);

if (nL == 0 || nR == 0) {
    // ---- case A: outside vertices are all on one side
    if (nR == 0) { edge = 0;  nOut = nL; } else { edge = W1; nOut = nR; }
    perm();
    t1 = (float)(x_a - edge) / (float)(x_a - x_b);
    P1 = { edge, lerp(y_a,y_b,t1), lerp(u_a,u_b,t1), lerp(v_a,v_b,t1) };
    t2 = (float)(x_a - edge) / (float)(x_a - x_c);
    P2 = { edge, lerp(y_a,y_c,t2), lerp(u_a,u_c,t2), lerp(v_a,v_c,t2) };
    if (nOut == 2) {                          // a is the only inside vertex
        slot[b] = P1;  slot[c] = P2;  sub_12962(tri);
    } else {                                  // a is the only outside vertex -> quad
        slot[a] = P1;  sub_12962(tri);        // (P1, b, c)
        slot[b] = P2;  sub_12962(tri);        // (P1, P2, c)
    }
}
else if (nL != nR) {
    // ---- case B: two on one side, one on the other (nothing inside)
    if (nL == 2) { edgeP = 0;  edgeL = W1; } else { edgeP = W1; edgeL = 0; }   // P = pair side, L = lone side
    perm();                                   // a = lone vertex
    t1 = (float)(x_a - edgeP) / (float)(x_a - x_b);
    P1 = { edgeP, lerp(y_a,y_b,t1), lerp(u_a,u_b,t1), lerp(v_a,v_b,t1) };
    t2 = (float)(x_a - edgeP) / (float)(x_a - x_c);
    P2 = { edgeP, lerp(y_a,y_c,t2), lerp(u_a,u_c,t2), lerp(v_a,v_c,t2) };
    slot[b] = P1;  slot[c] = P2;
    // second pass, a against its own side, using the UPDATED b and c (x_b == x_c == edgeP now)
    t3 = (float)(x_a - edgeL) / (float)(x_a - x_b);
    Q1 = { edgeL, lerp(y_a,y_b,t3), lerp(u_a,u_b,t3), lerp(v_a,v_b,t3) };
    t4 = (float)(x_a - edgeL) / (float)(x_a - x_c);
    Q2 = { edgeL, lerp(y_a,y_c,t4), lerp(u_a,u_c,t4), lerp(v_a,v_c,t4) };
    slot[a] = Q1;  sub_12962(tri);            // (Q1, P1, P2)
    slot[b] = Q2;  sub_12962(tri);            // (Q1, Q2, P2)
}
else {
    // ---- case C: one left (L), one inside (I), one right (R)  -> pentagon -> 3 triangles
    I = first i with code[i]==0;  L = first with code==1;  R = first with code==2;
    // all coordinates below are the ORIGINAL ones (read before any slot is overwritten)
    t1 = (float)x_L / (float)(x_L - x_I);
    P1 = { 0,  lerp(y_L,y_I,t1), lerp(u_L,u_I,t1), lerp(v_L,v_I,t1) };     // L-I edge at x=0
    t2 = (float)x_L / (float)(x_L - x_R);
    P2 = { 0,  lerp(y_L,y_R,t2), lerp(u_L,u_R,t2), lerp(v_L,v_R,t2) };     // L-R edge at x=0
    t3 = (float)(x_R - W1) / (float)(x_R - x_I);
    P3 = { W1, lerp(y_R,y_I,t3), lerp(u_R,u_I,t3), lerp(v_R,v_I,t3) };     // R-I edge at x=W1
    t4 = (float)(x_R - W1) / (float)(x_R - x_L);
    P4 = { W1, lerp(y_R,y_L,t4), lerp(u_R,u_L,t4), lerp(v_R,v_L,t4) };     // R-L edge at x=W1
    slot[L] = P1;  slot[R] = P3;  sub_12962(tri);     // (P1, I,  P3)
    slot[I] = P4;                 sub_12962(tri);     // (P1, P4, P3)
    slot[R] = P2;                 sub_12962(tri);     // (P1, P4, P2)
}
```
Globals: reads 0x59384 (width) only. Sub-triangles keep `tri->tex`.

### What sub_12962 is (outside this slice — interface only, from a skim)
`sub_12962(eax = Tri2D*)`, hand-written asm at 0x12962..0x12fe0 (`pushal` … `popal; ret`).
- stores `tri->tex` to 0x53e10; sorts the three vertices by the dword key `(y<<16)|x`;
- rejects when two keys compare equal in its sort, when max key < 0, or when min key >= 0xC80000
  (y >= 200 hard-coded); so it clips in Y itself;
- gradients via x87 (`1/(…)` cross product), edge steps via `idiv` in 16.16;
- inner loop (0x12f00) writes two pixels per iteration: `al=[ebx]; … ah=[ebx]; mov [edi],ax` with
  `ebx = tex | (v<<8) | u` (bl = u integer, bh = v integer, fractions in esi/edx with carry via
  `adc`), i.e. **plain 8-bit texel copy: dst = tex[(v&255)<<8 | (u&255)]**, no shade/lookup table, no
  transparency; row offsets come from the table at 0x52e10 (`add edi,[ebx+0x52e10]`).
Exact fill convention / fixed-point formats must come from whoever documents 0x12962.
Its other caller is 0x15353 (inside sub_152e0).

---------------------------------------------------------------------------------------------

## sub_27434 — draw_face_billboard(eax = Face* face, edx = dest buffer)   0x27434..0x27512

A screen-aligned scaled sprite centred on `face->v[0]`; only vertex 0 of the face is used. No near
clip / visibility test here (z is used as is; z <= 0 would misbehave).

```
v   = face->v[0];                     // view-space position at +0x18,+0x1c,+0x20
r   = (float)(uint16) *(u16*)0x5c998; // half-size in world units
kx  = sx * (1.0 / v.z);               // sx=[0x5c99c]  (1/z first, then * sx)   -- x87 registers, no f32 rounding
ky  = sy * (1.0 / v.z);               // sy=[0x5c9a0]
x1  = trunc((v.x - r) * kx + cx);     // cx=[0x5938c]
y1  = trunc(cy - (v.y + r) * ky);     // cy=[0x59390]
x2  = trunc((v.x + r) * kx + cx);
y2  = trunc(cy - (v.y - r) * ky);
sub_10f60(eax = (y1 << 16) + x1,      // top-left      (plain 32-bit add, so a negative x borrows from y)
          edx = (y2 << 16) + x2,      // bottom-right
          ebx = face->tex,            // face+0x31
          ecx = dest buffer);         // the caller's edx
```
No +0.5 bias here (unlike sub_24b54's projection). sub_10f60 is outside this slice (scaled sprite
blitter presumably). Only caller: sub_16658 ("hitcar" part) with edx = [0x593a0] (work buffer A).

---------------------------------------------------------------------------------------------

## Dispatch (how callers choose between the drawers)

Every part's render function first clears/prepares work buffer A, draws one "background" object
through a per-part helper (sub_14294, sub_1467c, sub_14d9c, sub_16084, sub_165a4, sub_16a18,
sub_16ff4), then walks the **global sorted face list**: `Face** list = *(Face***)0x5e0c8`,
`int count = *(int*)0x5e0d0`, iterating **from index count-1 down to 0**, and dispatches on the
face flag byte `face[0x30]`. The drawer is always called with `eax = face, edx = 0` (mode 0).

| part render fn | dispatch (first matching test wins) |
|---|---|
| 0x14348 | `&0x02` -> sub_24b54 ; else `&0x40` -> sub_27670 |
| 0x14730 | `&0x10` or `&0x20` -> sub_29510(face, 0, ebx=[0x594e8]) ; else -> sub_27670 (unconditionally) |
| 0x14e4f | `&0x10` -> sub_2b3c0(face, 0, ebx=[0x59518]) ; else `&0x02` -> sub_24b54 ; else `&0x40` -> sub_27670 |
| 0x16138, 0x161bf | `&0x02` -> sub_24b54 ; else `&0x40` -> sub_27670 |
| 0x16658 (hitcar) | `&0x40` -> sub_27670 ; else `&0x02` -> sub_24b54 ; else `&0x80` -> sub_27434(face, edx=[0x593a0]) |
| 0x16acc | `&0x02` -> sub_24b54 ; else `&0x40` -> sub_27670 |
| 0x170a8 | `&0x02` -> sub_24b54 ; else `&0x40` -> sub_27670 |
| 0x18310 | every face -> sub_24b54 (no flag test), after `sub_23a6d([0x593a0], [0x5c86c], 0xfa00)` (copy of a 64000-byte background) |

So: flag 0x02 = plain affine textured face (this slice), 0x40 = sub_27670's type, 0x10/0x20 = the
types of sub_29510 / sub_2b3c0 (these take an extra pointer in ebx, per-part global — probably a
lookup/second texture), 0x80 = billboard sprite. Faces with none of the tested bits are skipped.

The per-part "background object" helpers (e.g. sub_14294, sub_165a4; identical bodies) do, for
`obj` in eax (`obj+0x10` = Face array, `obj+0x18` = face count, stride 0x35), from last face to first:
```
s = v0.pos + v1.pos + v2.pos                 (view space, f32 each component)
if (v0.z > 1.0 || v1.z > 1.0 || v2.z > 1.0)
    if (sub_23b6c(eax=&s, edx=&face->normal) > 0.0)      // skip when 0 >= result
        sub_27670(eax = face, edx = 0);
```
(those helpers are outside this slice; listed only because they show that sub_27670 is also used
unsorted and that culling is done by the caller, not by the drawers.)

---------------------------------------------------------------------------------------------

## Open questions

1. `sub_12962` (the real rasterizer behind flag-0x02 faces) is outside 0x23bc8..0x27514 and is only
   summarised above. Fill convention, 16.16 edge stepping, gradient rounding and the 2-pixel inner
   loop need a full read of 0x12962..0x12fe0 (and the row table at 0x52e10).
2. 0x5c9a8 is assumed 0.0 (no writer found by address search; a write through a computed pointer
   or a memset over 0x5c98c.. cannot be 100% excluded, but with 0.0 the float clip always runs,
   and with any other value the result only differs in which clipper does the work).
3. FPU precision control at run time (53 vs 64 bit) is not known from this slice; the pseudo-code
   marks where values are rounded to float32 by stores. Differences would be sub-ulp.
4. Vertex struct fields outside 0x18..0x23 and 0x30..0x37, and the Face fields 0x0c..0x17, 0x24..0x2f,
   are not touched here.
5. sub_10f60 (sprite blit used by sub_27434) and the second writer of 0x5c998 are outside the slice.
6. Whether sub_11e8c (target of the dead twin) is reachable some other way was not investigated.
