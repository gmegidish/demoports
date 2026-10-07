# L2 gfx (b): segment 186a, 186a:1d02 .. end of segment (186a:3c9c)

Second half of the graphics unit. It holds the polygon rasterisers used by the 3D engine (seg 1342,
object draw routine around 1342:2650..2879), the "phong" lookup-table builder, the texture-mapper
(column-based affine mapper with per-column edge tables), keyboard/IRQ helpers, and the unit's init
and exit code.

Some code in this range is NOT in euph.lst (the recursive disassembler missed it). I disassembled it
myself (`$S/gfxb/gdis.py SEG START END`, a linear capstone dump of img.bin):
- 186a:2084 and 186a:20fa: span routines (pointer targets loaded at 186a:2559/2567).
- 186a:3aaa: the Pascal string "EMS Error: To run this demo u need at least 1700Kb free EMS memory."
- 186a:3b43: exit helper. 186a:3c64: ExitProc handler.
- Also (first-half address, but called by 1d02 via the span pointer): 186a:16c1 and 186a:16fa, two
  span routines. They are described in the appendix because the first-half listing does not have them either.

## Conventions shared by everything here

Globals (DS offsets), from the code in this slice and the first half:
- `5bf0` W: screen width (word). `5bf2` H: screen height.
- `5bfa` clipXmin, `5bfc` clipYmin, `5bfe` clipXmax, `5c00` clipYmax (signed words; inclusive bounds, set
  by 186a:02f3(x0,y0,x1,y1). The default is 0,0,W-1,H-1).
- `5c22` (far ptr) dest: the current draw page (offset word at 5c22, segment at 5c24). Set by 186a:10e5(page).
- `9122 + 4*y` rowOff[y]: a longint table holding y*W (built by 186a:03ae for y = 0..H). Only its LOW WORD is used
  (`mov di,[di-0x6ede]`), so pixel address = (dest.off + rowOff[y] + x) & 0xffff. Linear, 1 byte per pixel.
- `911a` (far code ptr) spanFn: the current horizontal span routine (set by 186a:1620(ptr)). The default
  is 186a:1689 (solid fill).
- `911e`/`9120` (far ptr) texPtr: the current texture (offset word / segment word).
- `9118` (word) gradStep: used by the span 16c1 (appendix). Parts set it.
- `90bc..0x9116` litTab[0..90] (bytes): the lighting table built by 186a:26a6.
- `9da6 + 2*y` modeXRow[y] = y*80 (words, y = 0..250), built by 186a:3a48.
- `5c02` (byte) modeX flag: 1 means the texture mapper writes to planar mode-X VRAM via 2e90.
- `5d82` (far ptr) mode-X draw page (A000:0000 at init; `5d86` = A000:4000 is the other page).
- `9f88`(ptr) / `9f8c`(ptr) edge buffer for the plain texture mapper. `9f90`/`9f94` edge buffer for the lit texture mapper.
- `9f98` texMinX, `9f9a` texMaxX (signed words).
- `9fa4` (byte) zbufMode: always 0 (only written at init, 186a:3bed). So the z-buffer gouraud span 20fa is dead code.
- `9fa8`, `9faa`, `9fae`: scratch words/dwords used by the span routines.

Register convention of every horizontal span routine called through `spanFn` or directly:
`DI` = y, `SI` = x start, `CX` = pixel count, `ES:BX` = dest (loaded from 5c22), `AL` = colour
(gouraud: `AX` = left value, `DX` = right value; phong: `EAX` = left 16.16, `EDX` = right 16.16).
Each routine does `if (y < clipYmin || y > clipYmax) return;` itself.

Polygon vertex array ("P") used by all polygon routines: records of 8 bytes, 1-based index i at P+8*(i-1):
`+0 x (int16)`, `+2 y (int16)`, `+4 c (int16: colour / intensity / angle / shade, depending on the routine)`, `+6` unused here.
The engine passes DS:0x5ac2 (4 records; for a triangle the engine copies record 3 into record 4 first, 1342:2675).

## External calls made from this slice

- 1d81:028a GetMem(size) -> DX:AX; 1d81:029f FreeMem(ptr,size)
- 1d81:3e95 longint shl (DX:AX << CX); 1d81:3dcc longint div (signed, truncates toward 0)
- 1d81:31e5 Real48 -> ST0; 1d81:320f ST0 -> Real48; 1d81:3275 Round (nearest-even) -> DX:AX; 1d81:32bf Cos
- 1d81:0116 Halt
- 1d81:40cf / 40f9 / 41a4 / 4164: set operations (load the 32-byte set at DS:5d5a, make the set [1], union, store).
  Net effect: `set5d5a := set5d5a + [1]` (GUESS from the call shapes; not graphics).
- 1d45:0142 Power(base: Real, expo: Real): Real (math unit). If base == 0 it returns 0. Otherwise it returns
  exp(expo*ln|base|) (Real48), with the sign fixed for a negative base and an integer exponent. A negative
  base with a non-integer exponent raises runtime error 207.
- 186a:0312 PointInClip(x,y): bool (1 if clipXmin<=x<=clipXmax and clipYmin<=y<=clipYmax)
- 186a:033d (register proc) clip a horizontal span: SI = x, CX = len -> AH = 0 if fully clipped (see appendix)
- 186a:1071 PagePtr(page:byte): far ptr (virtual screen page n: page 0 = A000:0000, others from the heap or EMS)
- 186a:10e5 SetDrawPage(page); 186a:1620 SetSpanFn(ptr); 186a:02f3 SetClip(x0,y0,x1,y1)
- 186a:0000 fatal error (prints a string and halts); 186a:05b9, 186a:1ab1, 186a:0078: first-half init helpers
- 1c34:0009 / 00a5 / 01b7 / 031b: EMS unit (detect / free pages / map page / free handle)

---------------------------------------------------------------------------------------------------

## 186a:1d02 FlatPoly(var P; n:int; cycLo:byte; cycHi:byte; color:byte) far, `retf 0xc`

Stack: P = far ptr [bp+0xe], n = [bp+0xc], cycLo = [bp+0xa], cycHi = [bp+8], color = [bp+6].
Called from 1342:2789/27b0/27e4/281e with P = DS:5ac2, n = obj[0x3e], cycLo = obj[0x79] (or 0),
cycHi = obj[0x7a] (or 0), color = obj[0x77].
The engine sets spanFn around the call: draw mode 0 and 1 use the current spanFn (normally 1689 solid).
Mode 2 sets spanFn = 186a:16c1 (gradient span) and restores 1689 afterwards. Mode 4 sets spanFn = 186a:16fa
(additive span) and restores 1689 afterwards.

The edge buffer is GetMem(32): at most 4 edges of 8 bytes, `{ x: int32 16.16, dx: int32 16.16 }`. So n <= 4.

```js
function FlatPoly(P, n, cycLo, cycHi, color) {
  let minY = P[1].y, maxY = P[1].y;
  for (let i = 2; i <= n; i++) { if (P[i].y < minY) minY = P[i].y; if (P[i].y > maxY) maxY = P[i].y; }
  if (minY > clipYmax) return;
  if (maxY < clipYmin) return;
  const E = new Array(n+1);                 // E[i] = edge between vertex j (= previous vertex) and vertex i
  let cycDir = 0;                           // local byte [bp-0x1d], 0 at entry
  let j = n;
  for (let i = 1; i <= n; i++) {
    let dx = P[i].x - P[j].x;               // int32 (16-bit operands sign-extended)
    let dy = P[i].y - P[j].y;
    let x;
    if (dy < 0) { dx = -dx; dy = -dy; x = P[i].x; }   // start at the upper vertex
    else        { x = P[j].x; }
    E[i] = { x: (x << 16) | 0, dx: dy !== 0 ? Math.trunc((dx << 16) / dy) | 0 : 0 };
    j++; if (j > n) j = 1;
  }
  for (let y = minY; y <= maxY; y++) {      // NOT clipped to clipYmin/clipYmax; all edges still step
    let xl = 32000, xr = -32000;            // 0x7d00 / 0x8300
    // edges are visited in the order cx = n, n-1, ..., 1; edge cx joins vertex cx and vertex si,
    // si = cx-1 (si = n when cx = 1)
    for (let cx = n, si = n - 1; cx >= 1; cx--) {
      const a = P[cx].y, b = P[si].y;
      if (a !== b && ((y >= a && y <= b) || (y >= b && y <= a))) {   // both ends inclusive
        const ix = E[cx].x >> 16;           // high word, signed = floor
        if (ix <= xl) xl = ix;
        if (ix >= xr) xr = ix;
        E[cx].x = (E[cx].x + E[cx].dx) | 0;
      }
      si--; if (si === 0) si = n;
    }
    if (xl < clipXmin) xl = clipXmin;
    if (xr > clipXmax) xr = clipXmax;
    if (xl <= xr) {
      const al = color;                     // the span uses the colour BEFORE the cycle update
      if (cycHi !== 0) {
        if (color <= cycLo) cycDir = 0;     // unsigned byte compares
        else if (color >= cycHi) cycDir = 1;
        if (cycDir) { color = (color - 1) & 255; if (color === 0) color = 255; }
        else        { color = (color + 1) & 255; if (color === 0) color = 1; }
      }
      spanFn(/*DI*/y, /*SI*/xl, /*CX*/xr - xl + 1, /*AL*/al, dest);
    }
  }
  // FreeMem(E, 32)
}
```
Notes:
- The edge x starts at exactly the vertex x (<<16, no +0.5) and the left/right edge pixel is the floor of the
  16.16 value BEFORE that scanline's step. The span covers xl..xr inclusive.
- Horizontal edges (a == b) are skipped entirely. At a shared vertex both edges contribute (both ends inclusive).
- The colour cycling: on every drawn scanline the colour moves one step toward cycHi, bounces at cycHi and
  goes down to cycLo. The value 0 is skipped (0 -> 255 going down, 0 -> 1 going up). `color` is the value
  parameter, so the cycle restarts on every call.

---------------------------------------------------------------------------------------------------

## 186a:21bf GouraudPoly(var P; n:int; bias:int; unused1; unused2) far, `retf 0xc`

Stack: P [bp+0xe], n [bp+0xc], bias [bp+0xa], [bp+8] and [bp+6] unused. Called only from 1342:2704
(object draw mode with `obj[0x7b] & 0x18 == 0x10`) with P = DS:5ac2, n = obj[0x3e], 0, 0, 0 (so bias = 0).
Vertex field +4 = colour (intensity) c.

Edge buffer: GetMem(0x40): up to 4 edges of 16 bytes `{x 16.16, dx 16.16, c 16.16, dc 16.16}`.

```js
function GouraudPoly(P, n, bias) {
  // visibility pre-check: ALWAYS tests vertices 1..4, whatever n is
  let any = false;
  for (let i = 1; i <= 4; i++) if (PointInClip(P[i].x, P[i].y)) any = true;
  if (!any) return;                         // polygon dropped if no vertex is inside the clip rect
  /* minY/maxY and the early-outs exactly as in FlatPoly */
  let j = n;
  for (let i = 1; i <= n; i++) {
    let dx = P[i].x - P[j].x, dy = P[i].y - P[j].y, dc = P[i].c - P[j].c;  // int32
    let x, c;
    if (dy < 0) { dx = -dx; dy = -dy; dc = -dc; x = P[i].x; c = P[i].c; }
    else        { x = P[j].x; c = P[j].c; }
    if (dy !== 0) { dx = Math.trunc((dx << 16) / dy); dc = Math.trunc((dc << 16) / dy); }
    // if dy == 0 the raw dx, dc are stored (unused: horizontal edges are skipped)
    E[i] = { x: x << 16, dx, c: c << 16, dc };
    j++; if (j > n) j = 1;
  }
  const span = (zbufMode /*DS:9fa4*/ !== 0) ? Span_20fa : Span_2084;   // always Span_2084 in practice
  for (let y = minY; y <= maxY; y++) {
    let xl = 32000, xr = -32000, cl = 0, cr = 0;
    for (cx = n, si = n-1; ...same edge walk as FlatPoly...) {
      if (edge active as in FlatPoly) {
        const ix = E[cx].x >> 16, ic = E[cx].c >> 16;  // high words (signed)
        if (ix <= xl) { xl = ix; cl = ic; }
        if (ix >= xr) { xr = ix; cr = ic; }
        E[cx].x += E[cx].dx; E[cx].c += E[cx].dc;      // 32-bit wrap
      }
    }
    if (xl < clipXmin) xl = clipXmin;       // the colours are NOT adjusted for the clipped part
    if (xr > clipXmax) xr = clipXmax;
    if (xl <= xr) span(y, xl, xr - xl + 1, (cl + bias) & 0xffff, (cr + bias) & 0xffff);
  }
  // FreeMem(E, 0x40)
}
```

### 186a:2084 Span_2084: gouraud span with a clamp to [10,255]
In: DI = y, SI = x, CX = len (>= 1), ES:BX = dest, AX = c0 (int16), DX = c1 (int16).
```
if (y < clipYmin || y > clipYmax) return;
di = (rowOff[y].lo + x + BX) & 0xffff;
diff  = (c1 - c0) & 0xffff;                          // 16-bit subtract
step  = trunc( int32(sign16(diff) << 16) / len )     // shl eax,16 ; cdq ; idiv ecx (ecx = len, zero-extended)
stepI = step >>> 16  (16-bit, i.e. the high word in two's complement)
stepF = step & 0xffff
ESI   = (stepF << 16) | 1                            // high word = fraction step, low word = +1 pixel
ax = c0
loop len times:
   if      (sign16(ax) < 10)  pixel = 10            // BL = 0x0a
   else if (sign16(ax) > 255) pixel = 255           // BH = 0xff
   else                       pixel = ax & 0xff
   ES:[di] = pixel
   {EDI += ESI} : di += 1; ediHi += stepF; carry = (ediHi overflowed 16 bits)
   ax = (ax + stepI + carry) & 0xffff               // adc ax,dx
```
EDI HIGH WORD: it is never initialised. It is the fractional accumulator, and it carries over from the
previous call of this routine (or of any code that touches EDI's high half; nothing else in the recognised
program code does). For an exact port keep one global `ediHi` (start it at 0, GUESS) that persists
across spans. Using a fresh 0 per span would differ by at most +-1 colour step at a few pixels.
The ramp goes from c0 toward c1 but reaches only c0 + (len-1)/len*(c1-c0), because it divides by len, not len-1.
If (di + 1) overflows 16 bits the carry goes into ediHi (only possible when the dest offset is near 0xffff).

### 186a:20fa Span_20fa (dead code: only reachable when DS:9fa4 != 0, which never happens)
A "max-buffer" gouraud span: it picks the far ptr at DS:9f9c (pixel offset < 32000) or DS:9fa0
(>= 32000, offset - 32000) as a 16-bit-per-pixel buffer and draws the pixel only if the value >= the stored one.
It has a bug (it reads [9fa8]/[9fae] after `lds`, i.e. from the wrong segment). Do not port it.

---------------------------------------------------------------------------------------------------

## 186a:2774 PhongPoly(var P; n:int) far, `retf 6`

Stack: P [bp+8], n [bp+6]. Called from 1342:2765 (mode `obj[0x7b]&0x18 == 0x18`, low bits != 3).
Vertex +4 = c, an index into litTab (0..90; GUESS: angle in degrees between the normal and the light).
The structure is the same as GouraudPoly (the 4-vertex PointInClip pre-check, the same edge setup with
16-byte edges, GetMem(0x40), the same scan), with these differences:
- per scanline it keeps the FULL 32-bit c accumulator of the chosen left/right edge:
  `if (ix <= xl) { xl = ix; L = E.c (int32) }`, `if (ix >= xr) { xr = ix; R = E.c }`.
  L and R ([bp-0x20], [bp-0x24]) are NOT reset per scanline (harmless: a span is drawn only when edges were found).
- no bias. After the clamp to the clip rect (again without adjusting L/R), it calls 186a:2170 directly (not spanFn) with
  DI = y, SI = xl, CX = xr-xl+1, ES:BX = dest, EAX = L, EDX = R.

### 186a:2170 Span_Phong
```
if (y < clipYmin || y > clipYmax) return;
di = (rowOff[y].lo + x + BX) & 0xffff;
step = trunc( int32(R - L) / len )        // 32-bit sub; cdq; idiv ecx (ecx = len)
acc = L                                   // int32 16.16
loop len times:
   idx = (acc >>> 16) & 0xffff            // unsigned 16-bit
   ES:[di] = DS:[(0x90bc + idx) & 0xffff] // litTab[idx]; idx > 90 reads the variables after the table
   acc = (acc + step) | 0; di++
```
(DS:9faa is used as scratch.) The value is truncated, not rounded, and it divides by len.

---------------------------------------------------------------------------------------------------

## 186a:26a6 BuildLitTab(amb, dif, spe, expo: Real) far, `retf 0x18`

Stack (Real48 args, three words each): amb = [bp+0x18..0x1c], dif = [bp+0x12..0x16],
spe = [bp+0xc..0x10], expo = [bp+6..0xa].
Callers: 1342:350f passes obj float32 fields (amb=obj[0x82], dif=obj[0x86], spe=obj[0x8a], expo=obj[0x8e]),
each converted float32 -> Real48. 1342:4539 passes amb=0, dif=0, spe=255.0, expo=1.0 (Real48 immediates
0x88/0/0x7f00 = 255.0 and 0x81/0/0 = 1.0), which gives table[i] = round(255*cos(i deg)).
```
for (i = 0; i <= 90; i++) {
   a  = f32( cos( i * PI_ext / 180.0 ) )    // cs:2694 = 3.14159265358979 (float80), cs:269e = 180.0 (float32)
                                            // the product is formed in extended precision, then cos, then stored float32
   p  = f32( Power( toReal48(a), expo ) )   // a is converted float32 -> Real48 first; the Real48 result -> float32
   v  = f32( amb + dif*a + spe*p )          // Real48 values loaded exactly, extended-precision arithmetic, stored as float32
   if (v > 255.0) v = 255.0                 // cs:26a2 = 255.0 (float32)
   litTab[i] = Round(v) & 0xff              // DS:0x90bc + i ; Round = nearest, ties to even
}
```
There is no lower clamp: a negative v gives Round(v)&0xff (wraps). The table has 91 entries (DS:90bc..9116).

---------------------------------------------------------------------------------------------------

## Texture mapper (affine, COLUMN-oriented)

A textured quad is rasterised in two passes:
1. Each of the 4 edges is walked along X (x is the major axis, whatever the slope). For every column x in
   [xa, xb) the edge's y and (u,v) (and shade) are written into a per-column edge record. The first edge to
   reach a column fills slot 1 and later edges overwrite slot 2.
2. Every column minX..maxX-1 is drawn as a VERTICAL span from the smaller y to the larger y.

Texture addressing: `texel = texSeg:[(texOff + v*256 + u) & 0xffff]`, where texOff = PagePtr(T.page).off + T.off
(DS:911e) and texSeg = PagePtr(T.page).seg (DS:9120). The texture lives in a 320x200 virtual page but is
indexed with a stride of 256. Colour 0 is transparent (that pixel is not written).

Texture descriptor T (7 bytes, made by 186a:39d3): `+0 w (word)`, `+2 h (word)`, `+4 page (byte)`,
`+5 off (word) = v0*256 + u0`.

### 186a:39d3 NewTexture(page:byte; u0, v0, w, h: int): pointer  far, `retf 0xa`
Stack: page [bp+0xe], u0 [bp+0xc], v0 [bp+0xa], w [bp+8], h [bp+6]. GetMem(7), then 3a14 fills it.
Returns the pointer in DX:AX. Example: 0b1a:033a NewTexture(2, 0, 0, 0xc0, 0x96) = 192x150 from page 2.
### 186a:3a14 FillTexture(T; page; u0; v0; w; h) far, `retf 0xe`
T[0] = w, T[2] = h, T[4] = page, word T[5] = (v0 << 8) + u0 (16-bit).

### 186a:3343 TexQuad(var Q; T: ptr; unused:int) far, `retf 0xa`
### 186a:34d7 TexQuadMirror(var Q; T; unused) far, `retf 0xa`
Stack: Q [bp+0xc] (vertex array, DS:5ac2), T [bp+8] (far ptr), [bp+6] unused (always 0).
Called from 1342:2852 (T = obj[0x6e..0x70], used when obj[0x76] == 0) and from 1342:286b
(TexQuadMirror with T = obj[0x72..0x74], used when obj[0x76] != 0). These are the front/back textures; the back one is
mirrored in u.
```
if (T == nil) return;
SZ = 0x9fc (2556);
buf = GetMem(3*SZ = 7668); DS:9f88 = buf; DS:9f8c = buf + SZ (offset add, same segment) = edgeTab
tex = PagePtr(T.page); DS:911e = tex.off + T.off; DS:9120 = tex.seg
ClearEdges_2c1a();                         // 7668 bytes := words 0x8000 (i.e. bytes 00 80 00 80 ...)
texMinX = 32000; texMaxX = -32000;         // DS:9f98 / DS:9f9a
w1 = T.w - 1; h1 = T.h - 1;
V1=Q[1],V2=Q[2],V3=Q[3],V4=Q[4]   (x at +0, y at +2)
TexQuad:        Edge(V1,0,0 , V4,0,h1);  Edge(V4,0,h1 , V3,w1,h1);  Edge(V3,w1,h1 , V2,w1,0);  Edge(V2,w1,0 , V1,0,0)
                i.e. V1=(0,0) V2=(w1,0) V3=(w1,h1) V4=(0,h1)
TexQuadMirror:  Edge(V2,0,0 , V3,0,h1); Edge(V3,0,h1 , V4,w1,h1); Edge(V4,w1,h1 , V1,w1,0); Edge(V1,w1,0 , V2,0,0)
                i.e. V1=(w1,0) V2=(0,0) V3=(0,h1) V4=(w1,h1)
   (the call order matters: the first edge to reach a column takes slot 1)
if (texMinX > clipXmax) return;            // NOTE: returns WITHOUT FreeMem (leak, faithful but irrelevant)
if (texMaxX < clipXmin) return;            // same
if (texMinX != texMaxX) {
   if (modeX /*DS:5c02*/) DrawCols_ModeX_2e90(texMinX, texMaxX - texMinX);
   else                   DrawCols_2d20(texMinX, texMaxX - texMinX);
}
FreeMem(buf, 7668);
```
Edge table: 8 bytes per column at edgeTab + 8*x (16-bit offset arithmetic):
`+0 y1 (int16)`, `+2 u1 (byte)`, `+3 v1 (byte)`, `+4 u2`, `+5 v2`, `+6 y2 (int16)`. "Empty" means word +0 == 0x8000.
After the clear, an untouched record holds y1 = y2 = -32768, u1 = u2 = 0x00, v1 = v2 = 0x80.
The valid x range is -319..638 (the 2556 bytes before edgeTab absorb negative x). Outside that range the
original writes outside the buffer (heap corruption). A port should ignore such writes (GUESS).

### 186a:2c1a ClearEdges (near): ES:DI = [9f88]; 0x77d (1917) dwords of 0x80008000 (7668 bytes).

### 186a:2c2c TexEdge (near, `ret 0x10`): register-less; 8 word args
Stack: A1 = [bp+0x12], A2 = [bp+0x10], A3 = [bp+0xe], A4 = [bp+0xc], A5 = [bp+0xa], A6 = [bp+8],
A7 = [bp+6], A8 = [bp+4]. The point P = (A1,A2) has u = A6, v = A8. The point R = (A3,A4) has u = A5, v = A7.
(The callers push P.x, P.y, R.x, R.y, uR, uP, vR, vP. In the table above `Edge(P,uP,vP, R,uR,vR)`.)
```
// make S = start (smaller x), E = end
if (R.x <= P.x) { S = R (uS = A5, vS = A7); E = P (uE = A6, vE = A8); }
else            { S = P (uS = A6, vS = A8); E = R (uE = A5, vE = A7); }
if (S.x < texMinX) texMinX = S.x;
if (E.x > texMaxX) texMaxX = E.x;
n = E.x - S.x;  if (n == 0) return;                  // 16-bit; n > 0
yStep  = trunc( int32(sign16(E.y - S.y + 1) << 16) / n )   // NOTE the +1 (also when E.y < S.y)
yStepF = yStep & 0xffff; yStepI = (yStep >>> 16) & 0xffff
du = trunc( int32(sign16(uE - uS)) << 8 / n ) & 0xffff     // 8.8, low word kept
dv = trunc( int32(sign16(vE - vS)) << 8 / n ) & 0xffff
yI = S.y; yF = 0; U = uS << 8 (byte uS in AH, AL = 0); V = vS << 8   // 16-bit regs
rec = edgeTab + 8*S.x
repeat n times:                                      // columns S.x .. E.x-1 (E.x itself NOT written)
   if (word rec[0] == 0x8000) { rec.y1 = yI; rec.u1 = U >> 8; rec.v1 = V >> 8; }
   else                       { rec.y2 = yI; rec.u2 = U >> 8; rec.v2 = V >> 8; }
   rec += 8
   t = yF + yStepF; yF = t & 0xffff; yI = (yI + yStepI + (t >> 16)) & 0xffff   // add bx / adc cx
   U = (U + du) & 0xffff; V = (V + dv) & 0xffff
```
(It uses `lds` to the edge segment. Callers pass u in 0..w1 and v in 0..h1.)

### 186a:2d20 DrawCols_2d20 (near, `ret 4`): stack x0 = [bp+6], count = [bp+4]
Linear destination (DS:5c22), stride W (DS:5bf0).
```
for (x = x0; count > 0; x++, count--) {
  rec = edgeTab[x]
  if (!(x > clipXmin)) continue;            // NOTE: strictly greater -> column clipXmin never drawn
  if (!(x < clipXmax)) continue;            // NOTE: column clipXmax never drawn
  // pick top/bottom (if y2 > y1 swap); equal -> top = y2 record
  if (rec.y2 > rec.y1) { top = rec.y1; uT = rec.u1; vT = rec.v1; bot = rec.y2; uB = rec.u2; vB = rec.v2; }
  else                 { top = rec.y2; uT = rec.u2; vT = rec.v2; bot = rec.y1; uB = rec.u1; vB = rec.v1; }
  if (!(top < clipYmax)) continue;
  if (!(bot > clipYmin)) continue;
  len = bot - top;  if (len == 0) continue;
  di = dest.off + x + rowOff[top].lo        // 16-bit
  du = trunc( int32((uB - uT) << 16) / len )  // uB,uT bytes (0..255) -> signed 16.16
  dv = trunc( int32((vB - vT) << 16) / len )
  duF = du & 0xffff; duI = (du >>> 16) & 0xffff;  dvF = dv & 0xffff; dvI = (dv >>> 16) & 0xffff
  // packed registers (this exact arithmetic matters):
  EAX = duF << 16                           // low word 0
  ESI = (dvF << 16) | duI
  DL  = dvI & 0xff
  EBX = (vT << 8) | uT                      // high word (v fraction accumulator) = 0
  ECXhi = 0                                 // u fraction accumulator (ECX high word)
  if (top < clipYmin) {
     k = clipYmin - top; len -= k;
     repeat k times: STEP()
     di = dest.off + x                      // NOTE: row 0, NOT rowOff[clipYmin] (correct only when clipYmin==0)
  }
  if (bot > clipYmax) len -= (bot - clipYmax);
  BX = (BX + texOff) & 0xffff               // DS:911e is added to the low word of EBX AFTER the clip pre-steps
  repeat len times:
     STEP()                                 // step BEFORE the fetch: the first pixel uses uT+du, vT+dv
     c = texSeg:[BX]
     if (c != 0) dest[di] = c
     di = (di + W) & 0xffff
}
STEP():
   t  = ECXhi + duF;          c1 = t >>> 16;  ECXhi = t & 0xffff         // add ecx,eax
   s  = EBX + ESI + c1;       c2 = s >= 2**32 ? 1 : 0;  EBX = s >>> 0    // adc ebx,esi (32-bit)
   BH = (BH + DL + c2) & 0xff                                            // adc bh,dl (only bits 8..15 change)
```
So, effectively: u (in BL) gets the integer part of du plus the carry of the u fraction. The u overflow/underflow
carries into v (BH), and a negative duI (0xffxx) also adds 0xff to BH plus a carry into the v fraction.
This is the classic packed "v:u" 8.8 trick. Emulate it bit-exactly as written; do not reimplement it as separate u,v.
Rows drawn: top..bot-1 (the bottom pixel is excluded). After clipping: max(top,clipYmin)..min(bot,clipYmax)-1.

### 186a:2e90 DrawCols_ModeX_2e90 (near, `ret 4`): planar mode-X version of 2d20
The differences from 2d20:
- dest = far ptr DS:5d82 (mode-X page in A000), row stride 80 bytes, row offsets from modeXRow[] (DS:9da6).
- the x clip is INCLUSIVE here: skip if x < clipXmin or x > clipXmax.
- per column: `out 3c4h, ax` with AL = 2, AH = 1 << (x & 3) (Sequencer Map Mask = plane x&3), and
  di = 5d82.off + (x sar 2) + modeXRow[top]. The top clip resets di = 5d82.off + (x sar 2) (row 0 again).
  di += 80 per pixel.
- the column pointer advances: x++ and, if (x & 3) == 0 after the increment, di++.
- The texture fetch, STEP and the transparency test are identical.
For the port: pixel (x,y) lands in mode-X page memory at plane x&3, offset y*80 + (x>>2).

### 186a:366b LitTexQuad(var Q; T) far, `retf 8`   and   186a:381f LitTexQuadMirror(var Q; T) far, `retf 8`
Stack: Q [bp+0xa], T [bp+6]. Called from 1342:273b (T = obj[0x6e..0x70], obj[0x76] == 0) and from 1342:2752
(mirror, T = obj[0x72..0x74]), when `obj[0x7b]&0x18 == 0x18` and `obj[0x7b]&7 == 3`.
Same as TexQuad, but with a per-vertex shade s = vertex word +4 (Q[4], Q[0xc], Q[0x14], Q[0x1c]):
```
SZ = 0xc80 (3200); buf = GetMem(9600); DS:9f90 = buf; DS:9f94 = buf + 3200 = litEdgeTab
DS:911e/9120 = texture as above; ClearLitEdges_301f()   // 0x960 (2400) dwords of 0x80008000 = 9600 bytes
texMinX = 32000; texMaxX = -32000; w1 = T.w-1; h1 = T.h-1
LitTexQuad:       LEdge(V1,0,0,s1 , V4,0,h1,s4); LEdge(V4,0,h1,s4 , V3,w1,h1,s3);
                  LEdge(V3,w1,h1,s3 , V2,w1,0,s2); LEdge(V2,w1,0,s2 , V1,0,0,s1)
LitTexQuadMirror: LEdge(V2,0,0,s2 , V3,0,h1,s3); LEdge(V3,0,h1,s3 , V4,w1,h1,s4);
                  LEdge(V4,w1,h1,s4 , V1,w1,0,s1); LEdge(V1,w1,0,s1 , V2,0,0,s2)
if (texMinX > clipXmax || texMaxX < clipXmin) return;   // no FreeMem (leak)
if (texMinX != texMaxX) DrawLitCols_316b(texMinX, texMaxX - texMinX);   // no mode-X variant
FreeMem(buf, 9600)
```
Lit edge record: 10 bytes at litEdgeTab + 10*x: `+0 y1, +2 u1, +3 v1, +4 u2, +5 v2, +6 y2, +8 s1, +9 s2`.

### 186a:3031 LitTexEdge (near, `ret 0x14`): 10 word args
A1 = [bp+0x16] .. A10 = [bp+4]. P = (A1,A2) has u = A6, v = A8, s = A9. R = (A3,A4) has u = A5, v = A7, s = A10.
(The callers push P.x,P.y,R.x,R.y,uR,uP,vR,vP,sP,sR.) Same algorithm as TexEdge, plus:
- sS<<8 (8.8) start, ds = trunc(int32(sE - sS) << 8 / n) & 0xffff; the stored shade = the high byte.
- the record pointer `si = litEdgeTab.off + 10*S.x` (16-bit). A record is written ONLY if `si <= 0x2580`
  (unsigned; 9600). With the buffer offset at 0 (GUESS) this keeps x in -320..640 and drops anything to the left
  (wrap) or right of that. The x = 640 record overflows the buffer by 10 bytes, so ignore it.
- the order of the writes and the slot logic are as in TexEdge (slot 1 if word +0 == 0x8000, else slot 2; the steps
  happen even for skipped records).

### 186a:316b DrawLitCols_316b (near, `ret 4`): x0 = [bp+6], count = [bp+4]
As 2d20 (linear dest, x clip exclusive at both ends, the same top/bottom selection, the same row-0 bug after the top
clip, STEP before the fetch), plus a shade ramp:
```
sT, sB = shade of the top / bottom record (s1/s2 follow the same swap as y/u/v)
dS = trunc( int32(sB - sT) << 8 / len ) & 0xffff      // [bp-0x1a]
S  = (sT << 8) & 0xffff                              // [bp-0x1c]
top clip: each pre-step also does S = (S + dS) & 0xffff
texture via FS = DS:9120 (DS untouched)
per pixel:
   STEP(); c = texSeg:[BX]
   S = (S + dS) & 0xffff                             // shade steps before use too
   t = c + DS:[0x90bc + (S >>> 8)]                   // litTab[S>>8]; unsigned byte add
   if (t > 255) t = 255                              // jae / mov dh,0ffh
   if (t != 0) dest[di] = t                          // transparent only if texel+light == 0
   di += W
```
litTab has only 91 entries, so a shade above 90 reads the variables that follow (DS:9117 onward: 9118 gradStep, 911a spanFn...).
Shade values from the engine should therefore stay in 0..90 (GUESS).

---------------------------------------------------------------------------------------------------

## Miscellaneous

### 186a:3a48 BuildModeXRows (near): `for i = 0..250: word DS:[0x9da6 + 2*i] = i*80`.
### 186a:3a6c MaskKeyboardIRQ (far): `out 21h, 2` (the PIC mask: only IRQ1 masked). Called by main 0000:a3e0.
### 186a:3a75 UnmaskIRQs (far): `out 21h, 0`. Called at 0000:a619.
### 186a:3a7e PollKey(): byte (far; 37 callers in every part)
```
sc = in(0x60)                 // raw keyboard scancode
if (sc == 1) Halt(0)          // ESC make code -> quit immediately (the following DS:9fa5 = 0 is unreachable)
DS:9fa6 = sc                  // last scancode
return byte DS:a3ac           // some flag (not set in this slice; see other notes)
```
For the port: pressing ESC ends the demo; otherwise this has no visual effect.

### 186a:3aee InitEMS (near)
```
DS:5c1c (emsOK) = (1c34:0009(&DS:5c04) != 0 && 1c34:00a5(&DS:5c04) > 0)   // EMS present and pages free
if (emsOK) { DS:5c1e = 1c34:00a5(&DS:5c04);                               // free 16K pages
             if (DS:5c1e < 0x67 /*103 pages*/) FatalError_186a_0000("EMS Error: To run this demo u need at least 1700Kb free EMS memory.") }
else DS:255e = 0
```
### 186a:3b43 ReleaseEMS (near, not in the listing): `if (emsOK) 1c34:031b(&DS:5c04)` (free the EMS handle).

### 186a:3b59 GfxInit (near): unit initialisation
```
DS:6398 = 0; call 186a:05b9; DS:5c03 = (186a:1ab1() != 0)      // first-half helpers (GUESS: VESA detection)
DS:5d7a = A000:0000 (seg from DS:2614 = 0xa000); DS:5d7e = B800:0000 (DS:2618 = 0xb800)
DS:5c2a (page table entry 0) = A000:0000
DS:5d8a = GetMem(0xfa2 = 4002)             // text-screen save buffer (80*25*2 + 2)
DS:5c26 = A000:0000
SetDrawPage(0)                             // 186a:10e5
W = DS:252c, H = DS:252e (mode-0 values, 320x200)  -> DS:5bf0 / DS:5bf2
SetClip(0, 0, W-1, H-1)                    // 186a:02f3
DS:5d94 = 0; DS:9118 (gradStep) = 1; DS:9fa4 (zbufMode) = 0; longint DS:63ac = 0; DS:5c02 (modeX) = 0
SetSpanFn(186a:1689)                       // solid span
DS:5d86 = A000:4000; DS:5d82 = A000:0000; DS:5d92 = 0
set DS:5d5a := set DS:5d5a + [1]           // RTL set ops, GUESS
call 186a:0078 (first half); BuildModeXRows(); InitEMS()
```
### 186a:3c7a unit entry (far): DS:9fb0 = ExitProc (DS:25fc); ExitProc = 186a:3c64; GfxInit().
### 186a:3c64 unit ExitProc (far, not in the listing): ExitProc = DS:9fb0; ReleaseEMS().

---------------------------------------------------------------------------------------------------

## Appendix: span routines at 186a:16c1 / 186a:16fa (first-half addresses, not in euph.lst; used via spanFn by FlatPoly)

Both start like 1689: `if (y<clipYmin||y>clipYmax) return; 186a:033d clip; if (AH==0 || CX<1) return;`.
186a:033d (SI = x, CX = len, AH = 1 means visible):
```
if (x < clipXmin) { if (x + len < clipXmin) AH = 0; len -= (clipXmin - x); x = clipXmin; }
if (x > clipXmax) AH = 0;
else if (x + len > clipXmax) len = clipXmax - x + 1;
```
They then compute `di = y*320 + x + BX` (HARD-CODED 320, they do not use rowOff).
- **186a:16c1 GradSpan** (draw mode 2): `AX = (color << 8) | color; DX = gradStep (DS:9118)`;
  per pixel: `dest[di++] = AX >> 8; AX = (AX - DX) & 0xffff`. This is a colour ramp in 8.8 going DOWN by gradStep/256
  per pixel. The initial fraction byte equals the colour value.
- **186a:16fa AddSpan** (draw mode 4): per pixel `dest[di] = (dest[di] + color) & 0xff; di++` (wrapping add).
- (186a:1689 SolidSpan, the default: uses rowOff[y]; fills CX bytes with AL.)
