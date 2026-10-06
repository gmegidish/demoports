# D_scenes3 — roller-coaster / end scroller (0x17530..0x1880d) and shadows part (0x1c37e..0x1d3b0)

Conventions used below
- `vec3` = 3 x float32 (x,y,z). `mat3` = 9 x float32, row-major (m[0..2] = row 0).
- All FP math is x87 (extended precision in registers); I say explicitly where a value is stored
  to float32 / float64 memory, because that is where precision is cut.
- Small helpers outside my range that I had to read to understand arguments (keep their names):
  - `sub_2fb78(eax=size)` = operator new (malloc with new-handler retry). Returns ptr.
  - `sub_2fbc9()` = `rand()`: `seed = seed*0x41C64E6D + 0x3039; return (seed>>16)&0x7FFF`. Seed is the dword at
    0x55fe8, initial value 1. **The only callers of rand in the whole EXE are the 5 call sites in this slice**
    (0x17556, 0x1756c, 0x1765c, 0x1768d, 0x176be), so the sequence is fully deterministic (tables below).
  - `sub_2fbfe` = asin(st0) (computed as atan2(x, sqrt(1-x*x))). `sub_31513` = atan2: called with st1 = first fld,
    st0 = second fld, returns atan2(st0_at_call, st1_at_call) (i.e. `fld A; fld B; call` gives atan2(B, A)).
  - `sub_2fb70(eax)` = abs(int).
  - `sub_23a6d(eax=dst, edx=src, ebx=n)` = memcpy.
  - `sub_23cbc(float x, float y, float z, vec3 *out)` (all 4 on stack) = set vector.
  - `sub_23aa0(eax=a, edx=b, ebx=out)`: out = a + b. `sub_23ac4(eax=a, edx=b, ebx=out)`: out = a - b.
  - `sub_23c90(eax=src, edx=dst)`: copy vec3. `sub_23c28(eax=v)`: returns |v| in st0.
  - `sub_23b44(eax=src, edx=dst)`: dst = -src. `sub_23b6c(eax=a, edx=b)`: dot(a,b) in st0.
  - `sub_23c48(eax=a, edx=b, stack: float fa, float fb, vec3 *out)`: out = a*fa + b*fb.
  - `sub_312b0(eax=M, edx=v, ebx=out)`: out = M·v (out[r] = M[3r]*v.x + M[3r+1]*v.y + M[3r+2]*v.z).
  - `sub_31304(eax=M, edx=v, ebx=out)`: same but only rows 0 and 1 are written (out[0], out[1]).
  - `sub_31340(eax=A, edx=B, ebx=out)`: out = A·B (mat3 product).
  - `sub_31480(m0..m8 floats, mat3 *out)` (all on stack, m0 is the first argument): fill a mat3.
  - `sub_311f8(eax=str)` = strdup.
  - `sub_2fce4(eax=spline, edx=n)`: `spline->keys = malloc(n*0x56); spline->cur = 0; spline->count = n`.
  - `sub_2fda8(eax=spline, stack: float x, float y, float z, int frame, float tcb[5])`: append a key (see struct below).
  - `sub_308fc(eax=spline)`: precompute tangents (other reader). `sub_30ba4(eax=spline, stack: float t, vec3 *out)`:
    evaluate position at "frame" t (other reader). NOTE it is stateful: it advances `spline->cur`.
  - `sub_14048(eax=dest buffer, edx=x, ebx=y, ecx=string, stack: colour byte)`: draw text (other reader; it first
    draws a drop shadow via sub_13f1d and wraps at the right screen edge).

---------------------------------------------------------------------------------------------------

# Part 1: roller-coaster tunnel + end scroller

## Globals of this part

| addr | type | meaning |
|---|---|---|
| 0x5c7fc | u32 | current text line index (BSS, starts 0) |
| 0x5c800 | char* | current text line pointer |
| 0x5c804 | u32 | text x (3..13) |
| 0x5c808 | u32 | text y (0..186) |
| 0x5c80c | vec3 | camera position |
| 0x5c818 | mat3 | camera matrix (world -> camera), 0x5c824..0x5c82c is row 1 |
| 0x5c83c | spline* | "spline B" used for the camera path (allocated by static initialiser sub_17530) |
| 0x5c858 | scene* | the hand-built roller scene (0x2a bytes) |
| 0x5c85c | u32 | never written anywhere (BSS, 0); subtracted from 0x593cc at the end -> no-op |
| 0x5c860 | u8[768]* | saved copy of the palette (0x5c9b0) taken at load time |
| 0x5c864 | u8[768]* | work palette for the fade-in |
| 0x5c868 | u8[65536]* | 50% average table (sub_108e4) |
| 0x5c86c | u8* 64K block | background picture `textures\roller2.gif` |
| 0x5c870 | u32 | loop counter of the palette fade (global used as a loop variable) |
| 0x5c974 | material* | engine "current material" global; here a 0x10-byte struct with texture at +8 |
| 0x53ec0 | char*[78] | text line table |
| 0x53ff8 | u32 | 0x4e = 78 = number of lines |
| 0x53ffc | u8 | 1 = "fade-in still running" flag |
| 0x593d4 | u32 | 100 (set at 0x10c41): ticks per second |

Engine globals written by sub_18193 (set current scene): 0x5c964, 0x5c96c, 0x5c974, 0x5c97c, 0x5c980, 0x5c984,
0x5c988, 0x5c98c, 0x5c98e, 0x5c990, 0x5c998, 0x5c99c, 0x5c9a0. 0x5c994 float = current frame/time.

## sub_17530 — static initialiser (pointer to it sits in the init table at data 0x58fea; runs before main)

```c
*(spline**)0x5c83c = sub_2fb78(0x12);     // spline B, uninitialised 0x12-byte struct
```

## sub_1754a — pick a random text position (no args)

```c
*(u32*)0x5c804 = (u32)rand() / 0xCCC + 3;   // unsigned div; rand 0..32767 -> 3..13      (x)
*(u32*)0x5c808 = (u32)rand() / 0xB0;        // -> 0..186                                  (y)
```

## sub_17582 — safe asin. arg: one float64 on the stack (ret 8). Returns st0.

```c
double safe_asin(double x) {
    if (x >= -1.0 && 1.0 >= x) return asin(x);      // sub_2fbfe
    return 0.234;                                    // float64 0x3FCDF3B645A1CAC1, exactly as written
}
```
(-1.0 is the float64 at 0x50bb4.)

## sub_175d1 — build the tunnel. No args. Returns eax = scene* (0x2a-byte struct).

### Structures written by hand (best evidence for engine layouts)

Spline header, 0x12 bytes (`sub_2fb78(0x12)`):
```
+0x00 u32  key count            (written by sub_2fce4)
+0x04 u32  current key index    (cache used by sub_30ba4; reset to 0 by hand here)
+0x08 u32  (loop period, only read by sub_30ba4 when +0x0c != 0; never written here)
+0x0c u16  loop flag            (written 0 here)
+0x0e ptr  keys                 (array of 0x56-byte keys)
```
Spline key, 0x56 bytes (as written by sub_2fda8):
```
+0x00 u16   frame number
+0x02 float x   +0x06 float y   +0x0a float z
+0x0e u32   0
+0x1a..0x2a 5 floats copied from the tcb[5] argument (tension, continuity, bias, ease-to, ease-from; all 0 here)
+0x2e,+0x32,+0x36,+0x3a = 0     +0x42,+0x46,+0x4a,+0x4e = 0   (tangent slots, filled by sub_308fc)
```
Object, 0xe0 bytes (memset 0 first):
```
+0x00 char* name            = strdup("Spline Object")
+0x04 u32   id              = 1000 (0x3e8)
+0x08 i32   parent          = -1
+0x0c vertex* vertices      = malloc(nverts * 64)
+0x10 face*  faces          = malloc(nfaces * 0x35)
+0x14 u32   nverts          = 3500 (0xdac)
+0x18 u32   nfaces          = (3500-8)*2 = 6984
+0x1c u16   flags A         = 0     (sub_17eb3: bits 0..2 != 0 -> object skipped; bit 3 -> morph object)
+0x1e u16   flags B         = 2     (bit 2 (value 4) = "has vertex normals / env-mapped"; not set here)
+0x60 vec3  position        = 0 (from memset)       (read by sub_17eb3 / sub_1ce47)
+0x8c mat3  rotation        = identity (sub_31480(1,0,0, 0,1,0, 0,0,1, obj+0x8c))
+0xb0 mat3  second matrix (normal matrix) = left all zero here (only used when flags B bit 2 set)
+0xd4 object* morph source A, +0xd8 object* morph source B, +0xdc float morph factor (read by sub_17eb3 only)
```
Vertex, 64 bytes:
```
+0x00 vec3 object-space position
+0x0c vec3 vertex normal (not written here)
+0x18 vec3 camera-space position (written by sub_17eb3)
+0x24 vec3 scratch: sub_17eb3 writes rotated normal x,y at +0x24,+0x28; sub_1ce47 writes WORLD position here
+0x30 float u    +0x34 float v      (texel units, 256 = one texture repeat)
+0x38 8 bytes not touched in this slice
```
Face, 0x35 (53) bytes, packed:
```
+0x00 vertex* v0   +0x04 vertex* v1   +0x08 vertex* v2
+0x0c vec3 face normal (object space; sub_31550 computes normalize(cross(v1-v0, v2-v0)))
+0x18 vec3 rotated face normal (camera space, written by sub_17eb3)
+0x24 4 bytes not touched here
+0x28 u16 "visible" flag (written by sub_1c78c / sub_1c893)
+0x2a u16 "faces up" flag (written by sub_1ce47 / sub_1c893)
+0x2c 4 bytes not touched here
+0x30 u8  render type = 2
+0x31 u8* texture (64K-aligned 256x256)
```
Scene, 0x2a bytes (memset 0), see also sub_18193:
```
+0x00 objnode* object list     -> 0xe-byte node {+0 u16 type=0 (mesh), +2 object* obj, +6 next=0}
+0x04 knode*  keyframer list   -> 0x1c-byte node {+0 u16 type=0, +2 u16 id=1000, +4 object* obj, ..., +0x14 next=0}
+0x08 material* = *(0x5c974)   (0x10-byte struct, +8 = texture pointer; other fields uninitialised)
everything else 0 (so +0x10 "face count" = 0, +0x26 palette = NULL)
```

### Pseudo-code

```c
scene *sub_175d1(void)
{
    spline *A = sub_2fb78(0x12);
    float tcbA[5] = {0,0,0,0,0};            // memset(esp+0x00, 0, 0x14)
    A->loop(+0xc) = 0;           sub_2fce4(A, 100);
    spline *B = *(spline**)0x5c83c;
    B->loop(+0xc) = 0;           sub_2fce4(B, 100);
    float tcbB[5] = {0,0,0,0,0};
    vec3 pos = {0,0,0};                      // sub_23cbc(0,0,0,&pos)

    // ---- 1. random walk: 100 control points, same keys in both splines
    for (int i = 0; i < 100; i++) {
        vec3 d;
        d.z = (float)(((0x4000 - rand()) * 12000) / 16384);   // int math, signed divide truncating toward 0
        d.y = (float)(((0x4000 - rand()) * 12000) / 16384);   // (0x2ee0 = 12000; result in -11999..12000)
        d.x = (float)(((0x4000 - rand()) * 12000) / 16384);   // ORDER of the three rand() calls: z, y, x
        pos = pos + d;                                         // float32 adds (values are exact integers)
        sub_2fda8(A, pos.x, pos.y, pos.z, /*frame*/ (u16)i, tcbA);
        sub_2fda8(B, pos.x, pos.y, pos.z, /*frame*/ (u16)i, tcbB);
    }
    sub_308fc(A);  sub_308fc(B);            // compute tangents

    // ---- 2. sample 5 points per segment -> 500 centre points
    vec3 *P = malloc(0x1770);               // 500 * 12 bytes; never freed
    for (int i = 0; i < 100; i++)
        for (int j = 0; j < 5; j++)
            sub_30ba4(A, (float)((double)j / 5.0f + (double)i), &P[i*5 + j]);   // t stored as float32
    A->cur(+4) = 0;

    // ---- 3. object
    object *o = sub_2fb78(0xe0); memset(o, 0, 0xe0);
    ... header fields as in the struct table above ...
    o->verts = malloc(o->nverts << 6);      // 3500 * 64 = 224000 bytes

    // ---- 4. rings of vertices
    vec3 centre;                             // esp+0x34, initialised (0,0,0)
    vec3 *p = P;                             // esp+0xa8
    int n = -1;                              // ecx  !!! starts at -1, see NOTE
    for (int i = 0; i < 100; i++) for (int j = 0; j < 5; j++) {
        vec3 d;                              // esp+0x40
        centre = *p;
        if ((i == 0 && j == 0) || (i == 99 && j == 4))
            d = (vec3){0.7f, 0.2f, 0.5f};    // first and last ring: fixed direction (p[-1]/p[+1] would be out of range)
        else
            d = p[+1] - p[-1];               // central difference of the sampled points
        p++;
        double len   = |d|;                                   // sqrt(x²+y²+z²), kept as float64
        double yaw   = -atan2(d.x, d.z);                      // float64   (fld d.z; fld d.x; call sub_31513; fchs)
        double pitch = safe_asin((double)(d.y / len));        // float64

        for (int k = 0; k <= 7; k++) {                        // 8 iterations per ring
            float ang = (float)(k * 6.283185374 / 7.0);       // both constants float64 (0x50be4, 0x50bec); stored float32
            vertex *vp = &o->verts[n];  n++;                  // position goes to index n BEFORE the increment
            float cy_ = (float)(sin((double)ang) * 200.0);    // "y" on the circle   (esp+0x44, float32)
            float cz_ = (float)(cos((double)ang) * 200.0);    // "z" on the circle   (esp+0x48, float32)
            // rotate (0, cy_, cz_) by pitch in the XY plane (x component of the circle is 0):
            float rx = (float)(0.0*cos(pitch) - sin(pitch)*(double)cy_);     // = -sin(pitch)*cy_   (float32)
            float ry = (float)(cos(pitch)*(double)cy_ + 0.0*sin(pitch));     // =  cos(pitch)*cy_   (float32)
            float rz = cz_;
            // rotate by yaw about Y and translate:
            vp->pos.x = (float)(((double)rz*cos(yaw) + centre.x) - (double)rx*sin(yaw));
            vp->pos.y = (float)(centre.y + ry);
            vp->pos.z = (float)(((double)rz*sin(yaw) + centre.z) + (double)rx*cos(yaw));
            // texture coordinates go to index n AFTER the increment (one vertex further!)
            o->verts[n].u = (float)(((i*5 + j) << 7));                        // ring index * 128
            o->verts[n].v = (float)((double)ang * 128.0f / 3.141592687);      // 128.0 float32 (0x50bfc), pi float64 (0x50c00)
                                                                              //   = k*256/7 -> 0, 36.57, ... 256
        }
        n--;                                                  // so every ring advances n by 7, not 8
    }
```
NOTE on the vertex indexing (faithful to the binary, it looks like an off-by-one in the original):
- ring r = i*5+j (0..499) writes positions for k=0..7 to vertex indices 7r-1 .. 7r+6 and u,v for k=0..7 to indices 7r .. 7r+7.
- net effect for vertex index 7r+m (m = 0..6):
  - u = r*128, v = m*256/7
  - position = ring r at angle index m+1 for m = 0..5; for m = 6 the k=7 position of ring r is overwritten by
    the k=0 position of ring r+1 (same angle 0 ≡ 2π but on the next ring). For the last ring (r=499) m=6 keeps ring 499, k=7.
- the very first position write goes to index -1 (12 bytes at verts-64, outside the allocation) and the last u,v
  write goes to index 3500 (verts+224000+0x30, outside the allocation). A port should just drop those two writes.
- the position of index 7r+m therefore lies at angle (m+1)*2π/7 while its v says m*256/7: the texture is rotated by
  one step around the tube; harmless.

```c
    // ---- 5. texture
    material *mat = sub_2fb78(0x10);  *(material**)0x5c974 = mat;       // not memset
    mat->tex(+8) = sub_10734();                                           // 64K block
    sub_1f07c(eax="TEXTURES//roller1.GIF", edx=mat->tex, ebx=0, ecx=0, stack 0);

    // ---- 6. faces: two triangles per quad between consecutive vertices and the next ring (+7)
    o->nfaces = (o->nverts - 8) * 2;                 // 6984
    o->faces  = malloc(o->nfaces * 0x35);
    int f = 0;
    for (int q = 0; q < (o->nfaces >> 1); q++) {     // q = 0..3491
        face *a = &o->faces[f++];
        a->v0 = &verts[q];   a->v1 = &verts[q+1];  a->v2 = &verts[q+7];  a->type(+0x30) = 2;  a->tex(+0x31) = mat->tex;
        face *b = &o->faces[f++];
        b->v0 = &verts[q+1]; b->v1 = &verts[q+8];  b->v2 = &verts[q+7];  b->type = 2;          b->tex = mat->tex;
    }
    // (q runs straight through the vertex array, so the quad from the last vertex of a ring (m=6) to m=0 of the
    //  next ring closes the tube as a continuous spiral strip: 7 quads per ring, 3492 quads.)
    B->cur(+4) = 0;

    // ---- 7. scene wrapper
    scene *s = sub_2fb78(0x2a); memset(s, 0, 0x2a);
    s->knodes(+4) = sub_2fb78(0x1c); memset(.., 0, 0x1c);
        s->knodes->obj(+4) = o;  s->knodes->type(+0, u16) = 0;  s->knodes->id(+2, u16) = 1000;
    s->objs(+0) = sub_2fb78(0xe); memset(.., 0, 0xe);
        s->objs->obj(+2) = o;    s->objs->type(+0, u16) = 0;
    s->material(+8) = *(material**)0x5c974;
    *(u32*)0x5c984 = o->nfaces;          // engine global "max faces"
    sub_2c750();                         // engine: (re)allocate the two face sort arrays 0x5e0c8 / 0x5e0cc, 4*[0x5c984] bytes each
    sub_31550(eax = s);                  // engine: compute face normals (face+0x0c) for every mesh in s
    for (int i = 0; i < o->nfaces; i++)
        face[i].normal = -face[i].normal;            // sub_23b44(face+0xc, face+0xc): flip, we are inside the tube
    return s;
}
```

### Spline control data (the 100 keys; frame = index; TCB/ease all 0), computed from the LCG with seed 1

These are the first 300 rand() values of the program. Format `index: (x, y, z)`; values are exact integers.
LCG state after these 300 calls: seed = 0x9945b8d5.

```
  0: (    4593,     7782,     -332)     1: (   12471,    -2960,    -1160)
  2: (   12596,     3606,    -6013)     3: (   15245,    13592,     2994)
  4: (    3643,    16758,     8340)     5: (     129,    10383,     7492)
  6: (   -7621,     3658,     1082)     7: (   -3174,      648,     9436)
  8: (   -3647,    -9364,    13110)     9: (  -10496,   -11926,    15482)
 10: (  -19292,   -20803,     5126)    11: (  -21257,   -27004,      939)
 12: (  -14063,   -23539,     3597)    13: (  -13188,   -21521,    -4248)
 14: (   -6291,   -12556,   -15747)    15: (   -4108,   -18254,   -26749)
 16: (  -15071,   -24442,   -33471)    17: (  -21237,   -20092,   -22145)
 18: (  -10279,   -22240,   -15977)    19: (     296,   -17899,   -26921)
 20: (   -1437,   -27859,   -25526)    21: (    4513,   -29533,   -16379)
 22: (    5065,   -23215,   -16280)    23: (    6818,   -32166,   -14026)
 24: (   17782,   -29333,   -10624)    25: (   13065,   -29869,    -2479)
 26: (    6504,   -27489,     7191)    27: (   12984,   -23717,    13315)
 28: (    3692,   -19026,    18166)    29: (    6125,   -22652,    29286)
 30: (   -4381,   -28233,    25056)    31: (  -15593,   -36356,    31457)
 32: (  -19770,   -34712,    24770)    33: (  -14488,   -26523,    17346)
 34: (  -20492,   -35262,    26098)    35: (  -15563,   -26621,    33106)
 36: (  -17076,   -19876,    25839)    37: (  -28831,   -12617,    20666)
 38: (  -34956,   -10952,    26665)    39: (  -46429,   -20426,    18004)
 40: (  -37481,   -18799,    20514)    41: (  -49145,   -12507,    21529)
 42: (  -42951,   -15008,    17862)    43: (  -32843,   -21966,    18945)
 44: (  -26741,   -13629,    19511)    45: (  -38456,   -16365,     8832)
 46: (  -44316,   -23557,     9377)    47: (  -44961,   -23075,    12240)
 48: (  -41294,   -25335,    21885)    49: (  -46357,   -32043,    30444)
 50: (  -36645,   -36952,    31736)    51: (  -42410,   -38183,    20629)
 52: (  -49169,   -41491,    18733)    53: (  -43957,   -36742,    26223)
 54: (  -45525,   -31772,    21808)    55: (  -44194,   -27130,    23765)
 56: (  -46753,   -26840,    22189)    57: (  -40896,   -17970,    24209)
 58: (  -31645,   -29419,    35351)    59: (  -28056,   -32939,    38277)
 60: (  -29626,   -29541,    37005)    61: (  -32390,   -21469,    37590)
 62: (  -27403,   -22781,    45458)    63: (  -35680,   -30822,    36527)
 64: (  -36653,   -33096,    27035)    65: (  -41224,   -36814,    34998)
 66: (  -48781,   -27375,    40666)    67: (  -45226,   -25534,    48073)
 68: (  -39530,   -16830,    39933)    69: (  -36654,   -16348,    47679)
 70: (  -33100,   -16413,    47564)    71: (  -33568,    -7308,    46951)
 72: (  -34932,   -12897,    44381)    73: (  -37115,   -20143,    48122)
 74: (  -38365,   -24238,    53716)    75: (  -47724,   -33542,    46783)
 76: (  -57500,   -40755,    57148)    77: (  -52732,   -32719,    53690)
 78: (  -60938,   -27563,    61699)    79: (  -53911,   -16436,    60828)
 80: (  -56826,   -13031,    72318)    81: (  -48514,   -14135,    71838)
 82: (  -37137,    -2935,    64078)    83: (  -25627,    -5726,    67003)
 84: (  -22622,   -15690,    63966)    85: (  -34195,   -13190,    58460)
 86: (  -27514,    -3886,    56126)    87: (  -33231,   -12781,    48947)
 88: (  -31272,   -18529,    60620)    89: (  -23668,   -11423,    63931)
 90: (  -15487,    -2196,    74100)    91: (  -22461,     8835,    67183)
 92: (  -15958,    11172,    64808)    93: (  -11924,     8430,    72420)
 94: (   -8998,    -2707,    69897)    95: (    1701,     2091,    77471)
 96: (   -7534,    13840,    86014)    97: (  -18468,    10819,    75022)
 98: (  -14899,    21880,    71878)    99: (   -7638,    31335,    80366)
```

## sub_17c93 — camera from spline. arg: one float32 `t` on the stack (ret 4).

```c
void sub_17c93(float t)
{
    spline *B = *(spline**)0x5c83c;
    vec3 *cam = (vec3*)0x5c80c;
    vec3 a;                                                 // local
    sub_30ba4(B, (float)((double)t + -0.1), cam);           // -0.1 float64 (0x50c08)
    u16 saved = (u16)B->cur;
    sub_30ba4(B, (float)((double)t + 0.45), &a);            // 0.45 float64 (0x50c10)
    if (B->cur != saved) B->cur = saved;                    // (saved is zero-extended)
    a = a - *cam;                                           // look direction = P(t+0.45) - P(t-0.1)
    float len = |a|;                                        // float32
    sub_30ba4(B, t, cam);                                   // camera position = P(t)

    float yaw   = (float)(-atan2(a.x, a.z));                // float32
    float pitch = (float)safe_asin((double)(a.y / len));    // float32
    float sy = sin(yaw), cy = cos(yaw);                     // each stored float32
    float sp = sin(pitch), cp = cos(pitch);
    float sr = sin(0.0) /* = 0 */, cr = cos(0.0) /* = 1 */; // roll is hard-wired to 0 but the terms are still computed

    mat3 *M = (mat3*)0x5c818;                               // via sub_31480, each element rounded to float32
    M[0] = cy*cr + (sy*sp)*sr;    M[1] = cp*sr;        M[2] = sy*cr - cy*sp*sr;
    M[3] = (sy*sp)*cr - cy*sr;    M[4] = cp*cr;        M[5] = -cy*sp*cr - sy*sr;
    M[6] = -sy*cp;                M[7] = sp;           M[8] = cy*cp;
    // with sr=0, cr=1:  [ cy, 0, sy ;  sy*sp, cp, -cy*sp ;  -sy*cp, sp, cy*cp ]

    vec3 up = { M[3]*500.0f, M[4]*500.0f, M[5]*500.0f };    // row 1 of M times 500 (float32 0x50c18)
    *cam = *cam + up;                                       // camera is pushed 500 units along its own Y axis
                                                            // (tube radius is 200, so the camera rides OUTSIDE/above the tube)
}
```

## sub_17eb3 — transform the current scene into camera space with the custom camera. No args.

Walks the keyframer node list at 0x5c96c (node: +0 u16 type, +4 object*, +0x14 next).

```c
for (node = *(knode**)0x5c96c; node; node = node->next(+0x14)) {
  if (node->type == 0) {                                   // mesh
    object *o = node->obj(+4);
    if (o->flagsA(+0x1c) & 7) continue;
    mat3 R  = CAM(0x5c818) · o->rot(+0x8c);                // sub_31340
    mat3 RN = CAM · o->mat2(+0xb0);
    vec3 T  = CAM · (o->pos(+0x60) - campos(0x5c80c));
    if (!(o->flagsA & 8)) {
        for each vertex v:  v->cam(+0x18) = R · v->pos(+0) + T;
        for each face f:    f->rnormal(+0x18) = R · f->normal(+0xc);
        if (o->flagsB(+0x1e) & 4)
            for each vertex v: {
                sub_31304(RN, &v->normal(+0xc), &v->scratch(+0x24));       // only x,y rows
                v->u = (float)(v->scratch.x * 128.0 + 127.0);              // float64 constants 0x50c1c, 0x50c24
                v->v = (float)(v->scratch.y * 128.0 + 127.0);
            }
    } else {                                               // morph between two other objects
        object *oa = o->[+0xd4], *ob = o->[+0xd8];  float f = o->[+0xdc];  float g = 1.0 - f;  // g stored float32
        for each vertex i:  tmp = oa->verts[i].pos * f + ob->verts[i].pos * g;  v->cam = R · tmp + T;
        for each face i:    tmp = oa->faces[i].normal * f + ob->faces[i].normal * g;  f->rnormal = R · tmp;
        if (o->flagsB & 4)
            for each vertex i: {
                tmp = oa->verts[i].normal * f + ob->verts[i].normal * g;
                sub_31304(RN, &tmp, &v->scratch);
                v->u = (float)(v->scratch.x * 127.0 + 127.5);              // NOTE different constants (0x50c24, 0x50c2c)
                v->v = (float)(v->scratch.y * 127.0 + 127.5);
            }
    }
  } else if (node->type == 3) {                            // light (or other positional node)
    obj = node->[+4];
    obj->[+0x24] (vec3) = CAM · (obj->[+0x0c] (vec3) - campos);
  }
}
```
For the roller scene only the first branch runs (one mesh, flagsA=0, flagsB=2).
This is very probably a copy of the engine's own transform with the camera taken from 0x5c80c/0x5c818.

## sub_18193 — make a scene current. eax = scene*.

```c
*(u32*)0x5c964 = s->[+0x00];   // object list
*(u32*)0x5c96c = s->[+0x04];   // keyframer node list
*(u32*)0x5c984 = s->[+0x10];   // (face count; the roller scene has 0 here! sub_175d1 set 0x5c984 = 6984 earlier
                               //  only for the sub_2c750 allocation, and this overwrites it with 0)
*(u32*)0x5c980 = s->[+0x14];
*(u32*)0x5c988 = s->[+0x18];
*(u32*)0x5c974 = s->[+0x08];   // material
*(u32*)0x5c97c = s->[+0x0c];
*(u16*)0x5c98c = s->[+0x1c] (u16);   // first frame
*(u16*)0x5c98e = s->[+0x1e] (u16);
*(u32*)0x5c990 = s->[+0x20];         // (float: frame count, see sub_1d2d1)
*(u16*)0x5c998 = s->[+0x24] (u16);
if (*(u32*)0x59394 == 1 && s->[+0x26] != NULL) sub_1061c(s->[+0x26]);   // set palette (NULL for the roller scene)

float tn = (float)tan(0.4276056712861111);          // float64 const 0x50c34 (= 24.5 degrees), result stored float32
*(float*)0x5c99c = (float)((double)width  * 0.5 / (double)tn);              // 320 -> ~351.1   (x projection scale)
*(float*)0x5c9a0 = (float)((double)height * 0.5 / 0.75f / (double)tn);      // 200 -> ~292.6   (y projection scale)
```
(0.75 is the float32 at 0x5472c; width/height are loaded as unsigned 64-bit ints.)

## sub_18286 — loader. No args.

```c
sub_1418c("building roller-coaster");
*(scene**)0x5c858 = sub_175d1();
*(u8**)0x5c860 = malloc(0x300);  memcpy(*(u8**)0x5c860, (u8*)0x5c9b0, 0x300);   // snapshot of the CURRENT palette
*(u8**)0x5c864 = malloc(0x300);                                                  // work palette
sub_1418c("transparecy table");
*(u8**)0x5c868 = sub_10734();  sub_108e4(eax = that);                            // 50% average table from current palette
*(u8**)0x5c86c = sub_10734();
sub_1f07c(eax="textures\\roller2.gif", edx=*(u8**)0x5c86c, ebx=1, ecx=0, stack 0);
```
Open point: the palette snapshot is taken after roller1.GIF was loaded with ebx=0 and before roller2.gif is loaded
with ebx=1. Whether the snapshot holds roller1's palette depends on what sub_1f07c's ebx/ecx/stack args mean
(other reader). The same order applies to the average table.

## sub_18310 — render one frame of the roller part. No args.

```c
memcpy(bufA /*0x593a0*/, *(u8**)0x5c86c, 64000);                 // background picture (first 64000 bytes of roller2)
for (int i = *(i32*)0x5e0d0 - 1; i >= 0; i--)                    // visible faces left by sub_2c7a8, drawn last-to-first
    sub_24b54(eax = (*(face***)0x5e0c8)[i], edx = 0);            // engine polygon drawer (draws into bufA presumably)
sub_106a0(eax = bufB /*0x593a4*/, edx = bufA, ebx = *(u8**)0x5c868);   // bufB[i] = avg[(bufA[i]<<8) | bufB[i]]
        // bufB is never cleared inside the loop -> 50% feedback = motion blur / trails
sub_14048(eax = bufB, edx = *(u32*)0x5c804 /*x*/, ebx = *(u32*)0x5c808 /*y*/, ecx = *(char**)0x5c800, stack 0x9d /*colour*/);
        // text is drawn into bufB AFTER the blend, so old text also fades out through the feedback
sub_1067c(bufB);                                                  // flip
```

## sub_18396 — run the roller part + end scroller. No args.

```c
sub_18193(*(scene**)0x5c858);
sub_10660(bufB /*0x593a4*/);                                      // clear
*(char**)0x5c800 = ((char**)0x53ec0)[*(u32*)0x5c7fc];             // index 0 at this point
sub_1754a();                                                      // random x,y
T1(0x593d0) = 0;  T0(0x593cc) = 0;

for (;;) {
    if (*(u32*)0x5c7fc >= 78 /* [0x53ff8] */) break;              // unsigned

    if (*(u8*)0x53ffc != 0) {                                     // fade in from white during the first second
        if (T0 < 100 /* [0x593d4] */) {
            for (i = 0; i < 768; i++)                              // counter is the global 0x5c870
                work[i] = 63 - ((63 - saved[i]) * T0) / 100;       // u32 math, unsigned div; saved=[0x5c860], work=[0x5c864]
            wait for vertical retrace (port 0x3da bit 3: wait until clear, then until set);
            sub_1061c(work);
        } else {
            wait for vertical retrace;
            sub_1061c(saved);
            *(u8*)0x53ffc = 0;
        }
    }

    *(float*)0x5c994 = (float)((double)(u64)T0 * 0.0045);         // float64 const at 0x50c83; spline "frame" = seconds*0.45
    sub_17c93(*(float*)0x5c994);                                  // camera
    sub_17eb3();                                                  // transform
    sub_2c7a8();                                                  // engine render/sort (fills 0x5e0c8 / 0x5e0d0)
    sub_18310();                                                  // draw + blur + text + flip

    if (T1 > 2*100) {                                             // every 2 seconds: next line  (code: if (200 >= T1) continue;)
        T1 -= 200;
        if (*(u32*)0x5c7fc < 78) (*(u32*)0x5c7fc)++;
        *(char**)0x5c800 = ((char**)0x53ec0)[*(u32*)0x5c7fc];     // for index 78 this reads the dword 0x53ff8 (=0x4e) as a
                                                                  // pointer, but the loop exits before it is drawn
        sub_1754a();                                              // new random position
    }
}
T0 -= *(u32*)0x5c85c;                                             // 0x5c85c is always 0 -> no-op
```
Timing summary: no frame limiter except the retrace wait during the fade; everything is driven by the 100 Hz counters.
T0 (0x593cc) runs freely for the whole part and drives the camera: spline parameter = T0 * 0.0045, i.e. 0.45 keys per
second. T1 (0x593d0) is the line timer (one line per 2 s, it keeps the remainder). 78 lines * 2 s = 156 s, so the camera
reaches t ≈ 70.2 of the 99 key intervals. ESC adds 0x01000000 to both timers: T1 then stays > 200 for a long time, so
the line index advances once per frame and the part ends after 78 more frames.
The line index 0x5c7fc is a global that is never reset.

### Text table (0x53ec0, 78 pointers; count at 0x53ff8) with the deterministic position of each line

Position = `(x, y)` as produced by sub_1754a from the LCG (continuing after the 300 calls of sub_175d1):
entry n uses rand calls 300+2n (x) and 301+2n (y). Colour is always 0x9d. Entry 28 really is one string (two source
literals were concatenated by a missing comma).

```
 0  0x50c8b  ( 3,  4)  "The Quest of Kahn"
 1  0x50c9d  (12,171)  "Thank you for your Time"
 2  0x50cb5  (12,161)  "An Immortals Production 1997"
 3  0x50cd2  ( 4, 31)  "This is the end-jumper"
 4  0x50ce9  ( 3,121)  "Sudden and un-censored messages"
 5  0x50d09  (10, 19)  "may appear, so bWARE"
 6  0x50d1e  ( 4, 17)  "Code by"
 7  0x50d26  ( 4,  4)  "Kombat"
 8  0x50d2d  (10,178)  "Rage"
 9  0x50d32  ( 3,120)  "Graphix by"
10  0x50d3d  ( 4, 79)  "Thor"
11  0x50d42  ( 6,  3)  "Music by"
12  0x50d4b  (11,141)  "Dark Spirit"
13  0x50d57  ( 8, 30)  "Party version Crashed, haha"
14  0x50d73  (10,163)  "It crashed on the party computer btw"
15  0x50d98  ( 7,162)  "push (Greets to...) pop"
16  0x50db0  (10, 43)  "Y.o.E"
17  0x50db6  ( 3,112)  "Cyborg (baaaaaaah)"
18  0x50dc9  (11, 93)  "w8, Y.o.e are good ppl"
19  0x50de0  ( 9,184)  "they deserve 2 greets"
20  0x50df6  ( 9, 92)  "B.s.P"
21  0x50dfc  ( 8,166)  "B.s.p are also very good ppl"
22  0x50e19  ( 3,164)  "10x to Miki/bsp who helped"
23  0x50e34  ( 4, 96)  "with the messages, wrath of kahn"
24  0x50e55  ( 8,  1)  "Magic Intros"
25  0x50e62  ( 6, 88)  "Falcor"
26  0x50e69  ( 4, 94)  "The tall guy from Falcor, call me"
27  0x50e8b  (10, 65)  "Spirit of Art"
28  0x50e99  ( 9,169)  "Cracky, Mos 10x for mental supportDemo Took 1 Week Of Hard Work"
29  0x50ed9  ( 9,131)  "Flood"
30  0x50edf  ( 7,  3)  "Flood demo rulez"
31  0x50ef0  ( 5,176)  "62m"
32  0x50ef4  ( 8, 36)  "yes, 62m will do a demo, some day"
33  0x50f16  ( 9, 23)  "Fissure"
34  0x50f1e  ( 5, 62)  "very nice ppl too"
35  0x50f30  (10,  7)  "10x NightShadow for all you help"
36  0x50f51  (12,140)  "TRiP"
37  0x50f56  (11,118)  "You are good at MK3, almost like me :)"
38  0x50f7d  ( 5,118)  "MunA Hunters"
39  0x50f8a  (11, 44)  "10x Civax 4 help in Finland"
40  0x50fa6  (10, 63)  "Embryo"
41  0x50fad  ( 3, 90)  "Original Design By Dark-Sprite"
42  0x50fcc  (11, 45)  "Emerge"
43  0x50fd3  ( 8, 92)  "NightD, U SUck"
44  0x50fe2  (11, 64)  "Yesh Li Pil KOr-im Lo BOBO"
45  0x50ffd  ( 4, 40)  "Bobobobobobobobobobobobobobo"
46  0x5101a  ( 4, 67)  "The Temple of Music"
47  0x5102e  ( 5, 81)  "who are u guys"
48  0x5103d  (11, 94)  "alePh naaL"
49  0x51048  (11, 76)  "Math Demo Rulez"
50  0x51058  (11,132)  "BNC"
51  0x5105c  ( 9,108)  "Adept/Paso/BSM"
52  0x5106b  (12, 85)  "We dont greet sick ppl"
53  0x51082  ( 8, 66)  "Borzom prodcuTions"
54  0x51095  ( 6,  1)  "now I understand the T joke"
55  0x510b1  (12, 80)  "Design Was Raped By Kombat And Thor"
56  0x510d5  ( 4, 29)  "Astroidea"
57  0x510df  ( 8,107)  "NoooN"
58  0x510e5  ( 6, 63)  "The Romanian guy who raped a sheep"
59  0x51108  ( 4, 81)  "U RULE (baaaaaah)"
60  0x5111a  ( 5, 37)  "Cubic and Seen"
61  0x51129  (10, 40)  "Gr8 ppl from Germany"
62  0x5113e  ( 4, 78)  "Orange"
63  0x51145  (10,154)  "I only know Wog"
64  0x51155  ( 5,  1)  "Yes this is the Warcraft 2 Font"
65  0x51175  ( 8, 64)  "Trauma"
66  0x5117c  ( 3,131)  "Kombat likes Nitro Music"
67  0x51195  ( 5, 65)  "10x Silvatar for font btw :)"
68  0x511b2  ( 8,161)  "DoomSDay"
69  0x511bb  ( 6, 14)  "Taat 1997"
70  0x511c5  ( 7, 70)  "If you dont know..."
71  0x511d9  ( 7,154)  "Taat means Tarzan Productions"
72  0x511f7  ( 3,168)  "Thor insists that we greet Deathstar"
73  0x5121c  ( 4,117)  "Just 4 Claudia"
74  0x5122b  ( 4, 43)  "uhh, hope u enjoyed Ritual"
75  0x51246  ( 9,120)  "See you at the Movement97"
76  0x51260  (11,156)  "10x for watching"
77  0x51271  ( 4, 39)  "IMMoRTaLS"
```

## sub_1853c — build the "shadow colour table" (brighten table). No args. (Called by sub_1d210.)

Input: `pal` = *(u8**)0x5c938 (768 bytes, 6-bit). Output: *(u8**)0x5c934 = sub_10734() (64K block),
`table[(i<<8) | j]` = palette index nearest to colour j brightened towards white by i*25%.

```c
u8 *tab = sub_10734();  *(u8**)0x5c934 = tab;
int best_index;                                   // esp+0x10, NOT reset between entries
for (int i = 0; i < 256; i++)
  for (int j = 0; j < 256; j++) {
    u8 *c = pal + j*3;
    int r = round((63 - c[0]) * 0.25 * (double)i + c[0]);      // sub_1f318 + fistp (current FPU rounding mode)
    int g = round((63 - c[1]) * 0.25 * (double)i + c[1]);
    int b = round((63 - c[2]) * 0.25 * (double)i + c[2]);
    if (r > 63) r = 63;  if (g > 63) g = 63;  if (b > 63) b = 63;      // no lower clamp needed
    int best = 0xc0;
    for (int k = 0; k < 256; k++) {
        int d = abs(pal[k*3] - r) + abs(pal[k*3+1] - g) + abs(pal[k*3+2] - b);
        if (d < best) { best = d; best_index = k; }             // strict <: first best match wins
    }
    tab[(i << 8) + j] = (u8)best_index;
  }
```
(For i >= 4 every colour saturates to white.) The table is consumed outside my slice (sub_1880d / sub_1a5be presumably).

## sub_186ef / sub_18766 / sub_187b8 — clip-edge interpolation helpers (8 / 12 / 12 callers, all outside my slice)

Args: eax = vertex A, edx = vertex B, ebx = output vertex, one float32 `plane` on the stack (ret 4).
They work on the camera-space position at vertex+0x18 and on u,v at +0x30/+0x34.

```c
// sub_186ef: intersect edge with z = plane
float t = (plane - B.cam.z) / (A.cam.z - B.cam.z);        // stored float32
out.cam.x = (A.cam.x - B.cam.x) * t + B.cam.x;
out.cam.y = (A.cam.y - B.cam.y) * t + B.cam.y;
out.cam.z = plane;                                         // copied bit-exact
out.u = (A.u - B.u) * t + B.u;
out.v = (A.v - B.v) * t + B.v;

// sub_18766: same with x:  t = (plane - B.cam.x)/(A.cam.x - B.cam.x); out.cam.z, out.cam.y interpolated; out.cam.x = plane; u,v as above
// sub_187b8: same with y:  t = (plane - B.cam.y)/(A.cam.y - B.cam.y); out.cam.z, out.cam.x interpolated; out.cam.y = plane; u,v as above
```
(18766 and 187b8 jump into the tail of 186ef at 0x1873f for the u,v part.)

---------------------------------------------------------------------------------------------------

# Part 2: shadows (scenes\cred.3ds)

## Globals

| addr | type | meaning |
|---|---|---|
| 0x5c934 | u8* 64K | brighten table built by sub_1853c |
| 0x5c938 | u8* | scene palette (scene+0x26) |
| 0x5c93c | scene* | cred.3ds scene |
| 0x5c940 | u32 | part length in ticks = 35*100 = 3500 |
| 0x5c944 | object* | "1prs"  (object A) |
| 0x5c948 | object* | "2prs"  (object B) |
| 0x5c94c | object* | "3prs"  (the receiver drawn first, e.g. floor) |
| 0x5c950 | u8* 64K | original texture `textures\shad.gif` |
| 0x5c954 | u8* 64K | texture used for 1prs |
| 0x5c958 | u8* 64K | texture used for 2prs |
| 0x5c95c | u8* 64K | texture used for 3prs |
| 0x5c960 | u8 | 1 if 2prs is above 1prs (2prs.pos.y > 1prs.pos.y) |

## sub_1c37e — flat-fill a triangle into a 256x256 texture (4 call sites, all in sub_1ce47)

Args: eax = dest (256x256, row stride 256), edx = x0, ebx = y0, ecx = x1, stack: y1, x2, y2, colour (byte). ret 0x10.
All ints, signed. Fixed point 20.12.

```c
void sub_1c37e(u8 *dst, int x0, int y0, int x1, int y1, int x2, int y2, u8 colour)
{
    bool clipped = false;
    if (y1 < y0) swap(x0,y0 <-> x1,y1);
    if (y2 < y0) swap(x0,y0 <-> x2,y2);
    if (y2 < y1) swap(x1,y1 <-> x2,y2);
    if (y2 < 0)   return;
    if (y0 > 255) return;
    if (x0 < 0 && x1 < 0 && x2 < 0) return;
    if (x0 > 255 && x1 > 255 && x2 > 255) return;

    int dxLong;                                           // uninitialised if y2 == y0 (then never used)
    if (y2 > y0) dxLong = ((x2 - x0) << 12) / (y2 - y0);  // idiv: signed, truncates toward zero
    int xl = x0 << 12;                                    // esi: x along the long edge 0->2
    int xs, dxs;

    if (y1 >= 0 && y0 != y1) {                            // ---- upper half
        xs  = x0 << 12;                                   // edi: x along edge 0->1
        dxs = ((x1 - x0) << 12) / (y1 - y0);
        int y = y0;
        if (y0 < 0) { xs -= dxs * y0; xl -= dxLong * y0; y = y0 = 0; }
        if (y1 >= 256) { y1 = 256; clipped = true; }
        for (; y <= y1 - 1; y++, xs += dxs, xl += dxLong)
            span(dst, y, xs >> 12, xl >> 12, colour);     // arithmetic shifts
    }
    // (when y0 == y1 the original runs a few compares with no effect and falls through with xl = x0<<12)

    if (clipped) return;
    if (y1 > 255) return;
    if (y1 == y2) return;                                 // so the last row of a flat-bottom triangle is never drawn
                                                          // ---- lower half
    xs  = x1 << 12;                                       // x1 as it was after sorting
    dxs = ((x2 - x1) << 12) / (y2 - y1);
    if (y1 < 0) { xs -= dxs * y1; xl -= dxLong * y0; y1 = 0; }   // (upper half was skipped in this case, y0 is still < 0)
    if (y2 > 255) y2 = 255;
    for (int y = y1; y <= y2; y++, xs += dxs, xl += dxLong)
        span(dst, y, xs >> 12, xl >> 12, colour);
}

static void span(u8 *dst, int y, int a, int b, u8 colour)   // inlined 4 times
{
    if (a > b) swap(a, b);
    if (a < 0) a = 0;
    if (b > 255) b = 255;
    if (a > 255 || b < 0) return;
    memset(dst + (y << 8) + a, colour, b - a + 1);          // sub_1d3b0; both end pixels inclusive
}
```

## sub_1c78c — per-face visibility for 1prs and 2prs. No args.

```c
for (object *o in { *(object**)0x5c944, *(object**)0x5c948 })      // two identical loops
    for (int i = 0; i < o->nfaces; i++) {                           // signed compare
        face *f = &o->faces[i];
        vec3 s = f->v0->cam + f->v1->cam + f->v2->cam;              // camera-space positions (vertex+0x18), float32 sums
        f->visible(+0x28, u16) = (dot(s, f->rnormal(+0x18)) > 0) ? 1 : 0;      // 0 >= dot -> 0
    }
```
(Camera-space data comes from the engine's sub_2f43c in this part.)

## sub_1ce47 — the shadow algorithm: build the three shadow textures. No args.

Light = directional, straight down the world Y axis. A "shadow map" is simply the receiver's texture with the
caster's triangles painted in colour 0, using world (x, z) directly as texel coordinates (texture = the world
square 0..255 x 0..255 in the XZ plane, 1 world unit = 1 texel).

```c
// 1. world-space positions and "faces up" flags for every mesh of the current scene
for (objnode *n = *(objnode**)0x5c964; n; n = n->next(+6))
    if (n->type(+0, u16) == 0) {
        object *o = n->obj(+2);
        for (i = 0; i < o->nverts; i++)                             // signed compare
            v[i].scratch(+0x24) = o->rot(+0x8c) · v[i].pos(+0) + o->pos(+0x60);      // WORLD position
        for (i = 0; i < o->nfaces; i++) {
            vec3 wn = o->rot · f[i].normal(+0xc);
            f[i].up(+0x2a, u16) = (wn.y > 0) ? 1 : 0;               // 0 >= wn.y -> 0
        }
    }

object *A = *(object**)0x5c944 /*1prs*/, *B = *(object**)0x5c948 /*2prs*/;
u8 *shad = [0x5c950], *texA = [0x5c954], *texB = [0x5c958], *texC = [0x5c95c];

#define PAINT(dst, o)                                                                    \
    for (i = o->nfaces - 1; i >= 0; i--) { face *f = &o->faces[i];                       \
        sub_1c37e(dst, round(f->v0->scratch.x), round(f->v0->scratch.z),                 \
                       round(f->v1->scratch.x), round(f->v1->scratch.z),                 \
                       round(f->v2->scratch.x), round(f->v2->scratch.z), 0); }
    // round = sub_1f318 + fistp (current FPU rounding mode); x = vertex+0x24, z = vertex+0x2c; ALL faces, no culling

if (B->pos.y(+0x64) > A->pos.y(+0x64)) {         // 2prs is the upper object
    *(u8*)0x5c960 = 1;
    memcpy(texB, shad, 65536);                   // upper object: clean texture
    memcpy(texA, texB, 65536);  PAINT(texA, B);  // 1prs receives the shadow of 2prs
    memcpy(texC, texA, 65536);  PAINT(texC, A);  // 3prs receives both shadows
} else {                                         // 1prs is the upper object (or equal)
    *(u8*)0x5c960 = 0;
    memcpy(texA, shad, 65536);
    memcpy(texB, texA, 65536);  PAINT(texB, A);  // 2prs receives the shadow of 1prs
    memcpy(texC, texB, 65536);  PAINT(texC, B);  // 3prs receives both
}
```
Notes: object positions compared are the object+0x60 vec (y at +0x64), i.e. the keyframed pivot, not the vertices.
Shadows are not self-shadowing, and 3prs is assumed to be below both. Shadow colour = palette index 0.

## sub_1c893 — draw the frame. No args.

All three objects are drawn with a planar top-down projection of their texture: u = world x + 8192, v = world z + 8192
(8192 = 32*256, keeps coordinates positive; same texel as world x,z modulo 256). The real u,v of the three vertices
are saved before and restored after each face.

```c
#define DRAW_SHADOWED(f, tex) {                                                          \
    float su0=f->v0->u, sv0=f->v0->v, su1=f->v1->u, sv1=f->v1->v, su2=f->v2->u, sv2=f->v2->v;  /* bit copies */ \
    f->v0->u = f->v0->scratch.x(+0x24) + 8192.0f;  f->v0->v = f->v0->scratch.z(+0x2c) + 8192.0f;              \
    f->v1->u = ...same for v1;  f->v1->v = ...;    f->v2->u = ...;  f->v2->v = ...;      /* float32 0x51362 */ \
    sub_1a5be(eax = f, edx = 0, ebx = tex);                                              \
    restore the six u,v values; }

object *A=[0x5c944], *B=[0x5c948], *C=[0x5c94c];
for (i = C->nfaces - 1; i >= 0; i--) {           // 3prs: every face, forced visible
    face *f = &C->faces[i];
    f->visible(+0x28) = 1;  f->up(+0x2a) = 0;
    sub_27670(eax = f, edx = 0);                 // engine polygon drawer (normal textured face, real u,v)
    DRAW_SHADOWED(f, [0x5c95c]);
}
if (*(u8*)0x5c960 == 0) {                        // 1prs is on top: draw 2prs first, then 1prs
    for (i = B->nfaces-1; i >= 0; i--) { f=&B->faces[i]; sub_1880d(eax=f, edx=0); DRAW_SHADOWED(f, [0x5c958]); }
    for (i = A->nfaces-1; i >= 0; i--) { f=&A->faces[i]; sub_1880d(eax=f, edx=0); DRAW_SHADOWED(f, [0x5c954]); }
} else {                                         // 2prs is on top: draw 1prs first, then 2prs
    for (i = A->nfaces-1; i >= 0; i--) { f=&A->faces[i]; sub_1880d(eax=f, edx=0); DRAW_SHADOWED(f, [0x5c954]); }
    for (i = B->nfaces-1; i >= 0; i--) { f=&B->faces[i]; sub_1880d(eax=f, edx=0); DRAW_SHADOWED(f, [0x5c958]); }
}
// faces are drawn in array order (reverse), with no depth sort; visibility is the per-face flag from sub_1c78c,
// presumably tested inside sub_1880d / sub_1a5be (other reader), together with the +0x2a "up" flag.

u8 *bufA = [0x593a0];
sub_14048(bufA, x=10, y=5,    "OK, Let me explain...",                    colour 4);   // 0x512bc
sub_14048(bufA, x=10, y=0x19, "Rage wrote some nice shadows",             colour 4);   // 0x512d2
sub_14048(bufA, x=10, y=0x2d, "But they didnt really fit the design",     colour 4);   // 0x512ef
sub_14048(bufA, x=10, y=0x41, "So, to make Eyal happy, here you go :)",   colour 4);   // 0x51314
sub_14048(bufA, x=10, y=0xb9, "P.S - The demo may crash after this :(",   colour 4);   // 0x5133b
sub_1067c(bufA);                                                                        // flip
```
bufA is not cleared in this function; either 3prs covers the screen or the polygon drawers/other code clear it
(open question).

## sub_1d210 — loader. No args.

```c
sub_1418c("scene - shadows");
scene *s = sub_2f1bc(eax = "scenes\\cred.3ds", edx = 9);   *(scene**)0x5c93c = s;
*(u8**)0x5c938 = s->[+0x26];                               // scene palette
sub_1418c("shadow color table");   sub_1853c();
sub_1418c("searching objects");
*(object**)0x5c944 = sub_2d0b8(eax = "1prs");
*(object**)0x5c948 = sub_2d0b8(eax = "2prs");
*(object**)0x5c94c = sub_2d0b8(eax = "3prs");
sub_1418c("texture memory");
[0x5c954] = sub_10734();  [0x5c958] = sub_10734();  [0x5c95c] = sub_10734();  [0x5c950] = sub_10734();   // this order
sub_1f07c(eax = "textures\\shad.gif", edx = [0x5c950], ebx = 0, ecx = 0, stack 0);
```
(The object lookup here is sub_2d0b8, not 0x2d014; it searches the list at [[0x5e0e0]].)

## sub_1d2d1 — run the shadows part. No args.

```c
sub_2d150(eax = *(scene**)0x5c93c);            // engine "set current scene"
sub_10660(*(u8**)0x5937c);                      // clear the VISIBLE screen
sub_1061c(*(u8**)0x5c938);                      // scene palette, no fade
T0(0x593cc) = 0;  T1(0x593d0) = 0;
*(u32*)0x5c940 = 35 * [0x593d4];                // 3500 ticks = 35 s

while (T0 < *(u32*)0x5c940) {                   // unsigned
    // frame = first + t * length / 3500
    *(float*)0x5c994 = (float)( (long double)(u64)T0 * *(float*)0x5c990 / (long double)(u64)3500
                                + (int)*(u16*)0x5c98c );        // 0x5c990 float (scene+0x20), 0x5c98c u16 (scene+0x1c)
    sub_2f43c();                                // engine: animate + transform
    sub_1c78c();                                // visibility flags
    sub_1ce47();                                // world positions + shadow textures
    sub_1c893();                                // draw + text + flip
}
T0 -= *(u32*)0x5c940;
(*(void(**)(int))(*(u32*)0x5ced8 + 0x58))(0);   // indirect call through a table at [0x5ced8], one stack arg 0, caller
                                                // cleans up (cdecl). Probably a MIDAS function (stop/fade music).
```
The whole 35 s map linearly onto the scene's keyframe range; nothing else is timed. sub_2c7a8 (the normal engine
renderer) is NOT called in this part.

---------------------------------------------------------------------------------------------------

# Open questions

1. sub_1f07c argument meaning (ebx=0/1, ecx, stack): decides which palette is snapshotted into 0x5c860 and used for the
   average table in sub_18286 (roller1 loaded with ebx=0 before the snapshot, roller2 with ebx=1 after it).
2. sub_18193 writes 0x5c984 = scene+0x10 = 0 for the hand-built scene. If sub_2c7a8 uses 0x5c984 as a face limit this
   matters; sub_175d1 had set it to 6984 only for sub_2c750's allocation.
3. sub_24b54(face, 0) is assumed to draw into bufA (0x593a0); the roller faces have type byte 2 at face+0x30.
4. The off-by-one vertex indexing in sub_175d1 (positions at n, u/v at n+1, writes at index -1 and 3500) is real in the
   binary; I verified the instruction order at 0x17920..0x17a64 twice but it should be eyeballed in a render.
5. The camera sits 500 units along its own +Y (row 1 of the matrix) from the spline while the tube radius is 200, so
   the camera flies outside the tube unless the engine's Y convention makes this "inside-looking" — check visually.
6. sub_1c893: what clears bufA between frames, and what sub_27670 / sub_1880d / sub_1a5be do with face+0x28 / +0x2a
   and the brighten table 0x5c934 (other readers).
7. The indirect call [[0x5ced8]+0x58](0) at the end of sub_1d2d1: target unknown (table filled at run time).
8. Rounding mode in effect for sub_1f318+fistp (shadow triangle coordinates, brighten table).
9. sub_30ba4 keeps a "current key" cache in spline+4; the port must evaluate with the same semantics (others' range),
   in particular for t < 0 at the start (t-0.1) and t beyond the last key.
