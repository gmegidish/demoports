# G8 — Two glentz cubes, Jelly cube, 3200-dots cubes, end fade (GBU.EXE, ~372.9 s .. 456.5 s)

Slice: `0000:0835 lcall 08d8:25f4`, `0000:083a lcall 08d8:16de`, `0000:085b lcall 126e:13ea`, fade-out loop `0000:086d..0888`.

Both effects were re-implemented as literal Python models (`work/G8/glentz.py`, `work/G8/dots.py`) from the
pseudo-code below, and compared with the recording frame by frame (MD5 of the full RGB frame):
**every frame of both effects matches the capture exactly** (glentz/jelly: effect frames 1..2735; dots: all 2949 frames
plus the static frames after it). So the pseudo-code, the constants and the timing below are verified, and no frame was
ever dropped (one animation step per retrace everywhere). DAC 6-bit -> 8-bit in the capture is `round(v*255/63)`.

## Summary (what is seen, in order)

| capture frame | demo time | what |
|---|---|---|
| 26118..26120 | 372.66 | black (main clears; first loop tick shows the cleared page 0) |
| 26121..28854 | 372.70..411.70 | **08d8:25f4**: phase 1 "two glentz cubes" (26121..28055), phase 2 "jelly cube + small bouncing cube" (28056..28755), phase 3 "jelly flies away" (28756..28854) |
| 28855 | 411.72 | black (08d8:16de clears both pages during this frame) |
| 28856 | 411.74 | 126e:13ea first tick, still black |
| 28857..31804 | 411.76..453.79 | **126e:13ea** "3200 dots cubes": A zoom-in + fade-in (..29159), B hold (..29299), C cubes separate (..29389), D morphing (..31390), E zoom-out + fade-out (..31804) |
| 31805..31995 | 453.80..456.51 | fade-out of the music; screen frozen on the last dots page with the last uploaded (almost black) palette |
| 31996 | 456.52 | transitional frame (mode 3 switch starts) |
| 31997.. | 456.54 | mode 3, end text (other slice) |

Video mode for everything here: **320x200 16-colour planar** (EGA-style bitplanes on top of mode 13h's DAC), set by
`0299:01cc` (called by main before both effects): AC mode reg 0x10 = 0x01, GC mode 5 = 0x00 (write mode 0), SEQ 1 =
0x09, SEQ 4 = 0x06, CRTC 0..0x18 from table 0299:01b3 = `2d 27 28 90 2b 80 bf 1f 00 c0 00 00 00 00 00 00 9c 2e 8f 14
00 96 b9 e3 ff` (reg 0x13 = 0x14 -> 40 bytes per row, reg 9 = 0xc0 double scan, 400 lines -> 200 rows). AC palette
regs 0..15 are left as mode 13h set them (identity), so pixel value 0..15 = DAC index. Each pixel's value is made of
one bit from each of the 4 planes (plane p = bit p); bit 7 of a byte is the leftmost pixel.

## Timing model (both effects)

- `0731:00a3` = wait for the next retrace tick (sets counter 0731:[4] = 0, spins until nonzero).
- `08d8:157e` (far, also called near with `push cs`) = `cx = 0731:[4]; 08d8:[157c] = cx` — number of ticks since the
  last 00a3 returned (1 if the frame's work fitted in one retrace — it always did in the recording).
- Capture frame for tick k shows video memory as it is *during* the frame that follows tick k (the effect's drawing
  goes to the hidden page, so the shown page is stable; the only visible consequence is the end of 25f4: the clear by
  16de right after the last tick shows as black on that tick's frame).

---------------------------------------------------------------------------------------------------------------

# Part 1 — 08d8:25f4 two glentz cubes / jelly cube

## The 3D engine of segment 08d8 (shared with G4 glentz vector and other 08d8 effects)

### Code-segment variables (08d8:xxxx) used here

| addr | name | value at our entry |
|---|---|---|
| [0000] | seg of resource `scr_data` (work buffer, loaded by main 0000:042e) | — |
| [008e] | screen centre x (added to projected x) | set 0xa0 by 25f4 |
| [0090] | max y = 199 (never written) | 199 |
| [0092] | y-projection mode; must be 0 (19f0 sets it 0) | 0 |
| [0095] [0097] [0099] | angles (byte offsets into the sine table, even, 0..0x59e) | 25f4: 0, 0xdc, 0 |
| [00a3] | distance (projection) | 25f4: 20000 |
| [00a5] | distance of the jelly | 170 (image), only our code changes it |
| [0914] | **immediate of `add ax,0x64` at 08d8:0913** = projected y centre (self-modified) | 100 (last set by 08d8:2e8a) |
| [0e61] | **immediate of `mov bx,0xa000` at 08d8:0e60** = segment of the page being drawn | 25f4: 0xa000 |
| [1413] | byte offset of the page being drawn (0 / 0x1f40) | 25f4: 0 |
| [00a7] [00a9] [00ab] [00ad] | per-plane bbox minY maxY minX maxX | — |
| [00ad1] (word at 0x0ad1) | count of edges drawn in this plane | — |
| [00af] [00b1] [00b3] [00b5] | frame bbox minY maxY minX maxX (accumulated) | — |
| [00b7] [00b9] [00bb] [00bd] | saved frame bbox (minY maxY minX maxX) used to clear the page 2 frames later | stale (harmless) |
| [009b] [009c] [009e] | "left border segment pending" flag and its two y's | 0 |
| [00a0] [00a2] | left border: byte offset 0, mask 0x80 (x = 0) | 0, 0x80 |
| [128c] | 1 = fill enabled in 128d (set 1 by 08d8:3153, G-other) | 1 |
| [1578] [2002] [2004] [2006] [2008] | per-step increments of [95] [97] [99] [a3] [914] | 249e sets 4, 8, 6; 25f4 sets [2006]=0; [2008]=0 (08d8:2e83) |

### Sine table
`08d8:00c1`, 900 signed words: `sin(i) = word[0xc1 + 2*i]`, i in 0..899, period 720 (i = angle/2), cos at
`+0x168` bytes. Values ~ 32767*sin(2*pi*i/720) but not reproducible by a simple formula (≈720 off-by-one entries):
**copy it from the image** (linear 0x8e41..0x95c8).

### Object format (segment = object, offsets from 0)
```
+0  planes   (number of bitplanes to raster, bit masks 1,2,4,8)
+2  nfaces   +4 faceptr
+6  edgeptr  (edge list: word count, then 9-byte entries {u8 colour, x1,y1,x2,y2})
+8  nverts   +0xa projptr (projected vertices: 6 bytes each = sx, sy, z)
+0xc vertices: nverts * (x, y, z) signed words
face: u16 colour (low byte bl = plane bits if front, high byte bh), u16 nedges, nedges * (ptrA, ptrB) pointers into projptr
```
Objects in the image (linear = seg*16): **05a1** (two cubes, 16 verts, 12 faces), **0586** (small cube, 8 verts),
**0555** (jelly, 11 verts + 27 generated curve points, 3 faces). Decoded (initial image):
```
05a1: planes 4, verts 0..7 = cube +-60 (v0(-60,-60,60) v1(60,-60,60) v2(60,60,60) v3(-60,60,60) v4..v7 same with z=-60),
      verts 8..15 = same cube. Faces (colour, vertex loops):
      cube0: c4:(0 1 2 3) c4:(5 4 7 6) c8:(4 5 1 0) c8:(2 6 7 3) cC:(1 5 6 2) cC:(0 3 7 4)
      cube1: c1:(8 9 10 11) c1:(13 12 15 14) c2:(12 13 9 8) c2:(10 14 15 11) c3:(9 13 14 10) c3:(8 11 15 12)
      all bh = 0. faceptr 0xcc, edgeptr 0x1bc, projptr 0x6c.
0586: planes 4, cube +-30, same 6 faces with colours 4,4,8,8,C,C. faceptr 0x6c edgeptr 0xe4 projptr 0x3c.
0555: planes 2, verts v0(-80,80,80) v1(80,80,80) v2(80,240,80) v3(-80,240,80) v4(-80,80,-80) v5(80,80,-80)
      v6(80,240,-80) v7(-80,240,-80) v8(-120,-80,120) v9(120,-80,120) v10(120,-80,-120); projptr 0x4e, faceptr 0x132,
      edgeptr 0x1de. Faces (projected-point indices, 11..37 are generated by 112a):
      c1: 0-20-21-...-28-19-18-...-11 (edges (0,20)(20,21)..(27,28)(28,19)(19,18)..(12,11))
      c3: (4 5 1 0)
      c2: 1-29-30-...-37-28-27-...-20
```
(the dumper is `work/G8/objdump.py`). Object 0x5a1/0x586/0x555 bytes are modified at run time by our code only.

### 08d8:07cb transform+project (self-modifying)
In: ds=es=object, si = vertex list (0xc), di = projptr, cx = nverts. Per vertex (`hi(a,b) = (a*b) >> 16` of the
signed 32-bit product, result taken as int16; all arithmetic 16-bit wrapping; `idiv` truncates toward zero):
```
S97=sin[a97/2] C97=sin[a97/2+180]; same for a99, a95 (patched into immediates 0841/0844/0871/0874/08a2/08a5)
X=2x Y=2y Z=2z
Z1 = 2*(hi(Z,C97) + hi(X,S97));   X1 = 2*(hi(X,C97) - hi(Z,S97))
Y1 = 2*(hi(X1,S99) + hi(Y,C99));  X2 =    hi(X1,C99) - hi(Y,S99)
Y2 =    hi(Y1,C95) + hi(Z1,S95);  Z2 =    hi(Z1,C95) - hi(Y1,S95)
d  = int16(-400 - [a3] + Z2)
sy = idiv(Y2 * -400, d) + [914]          // [92]==0 path
sx = idiv(X2 * -400, d) + [8e]
store sx, sy, Z2
```

### 08d8:0926 back-face test
P = proj[face.e0.A], Q = proj[face.e0.B], R = proj[face.e1.B];
`cross = (Qx-Px)*(Ry-Py) - (Qy-Py)*(Rx-Px)` (32-bit). Front (carry set) if cross >= 0.

### 08d8:128d render object (es = object)
```
edgelist.count = 0
07cb(verts)
for each face:
   col = face.colour; bl = col & 255; bh = col >> 8
   if !front(face): if bh == 0: skip face; else bl ^= bh
   for each edge (A,B): (x1,y1)=proj[A] (x2,y2)=proj[B]
       canonical order: if y1<y2 or (y1==y2 and !(x2>x1)) swap the endpoints   // larger y first
       if an entry with the same x1,y1,x2,y2 exists: entry.colour ^= bl   // shared edges of same-bit faces cancel
       else append {bl, x1,y1,x2,y2}
bl = 1; ds = work buffer
for plane p in 0..planes-1:
   SEQ map mask = bl
   maxX=-1000 minX=1000 maxY=-1000 minY=1000 ad1=0
   for each edge with (colour & bl): drawEdge(x1,y1,x2,y2)    // 13f7
   if [128c]==1: { if ad1 != 0: fill(p) /*0e00*/ ; accumBBox() /*0fe1*/ }
   bl <<= 1
```

### 08d8:13f7 drawEdge
```
if clip(...)  /*0b70*/ visible:
   0f93 bbox: if y1>=maxY maxY=y1; if y2<=minY minY=y2;
              if x1<=x2 { if x2>=maxX maxX=x2; if x1<=minX minX=x1 } else { if x1>=maxX maxX=x1; if x2<=minX minX=x2 }
   line(x1,y1,x2,y2) /*097f*/ ; ad1++
if [9b]==1: leftBorder() /*0ad3*/
```

### 08d8:0b70 clip (Cohen-Sutherland-like, x 0..319, y 0..[90]=199)
outcode bits: 1 x<0, 4 x>319, 2 y<0, 8 y>199; cl = code(p1), ch = code(p2).
- if (cl & ch): call 0b24 with cx=cl|ch<<8 → for any endpoint flag: bit1(either) minX=0, bit2 minY=0, bit4 maxX=319,
  bit8 maxY=199. Then if (cl&ch) has bit1 (both left) and not bit2/bit8 and y1!=y2: order so ya<yb,
  `[9b]=1, [9c]=max(ya,0), [9e]=min(yb,199)`. Edge is rejected (not drawn) in all these cases.
- if (cl|ch)==0: visible as is.
- else, with `md(a,m,d) = d ? trunc(a*m/d) (32-bit product) : int16(a*m)`, in this order, using current values:
  - p1: if cl&1: `[9b]=1; [9c]=clamp(y1,0,199); y1 += md(y2-y1, -x1, x2-x1); [9e]=y1; x1=0`
    if cl&4 && x1>319: `y1 += md(y2-y1, 319-x1, x2-x1); x1=319`
    if cl&2 && y1<0: `x1 += md(x2-x1, -y1, y2-y1); y1=0`
    if cl&8 && y1>199: `x1 += md(x2-x1, 199-y1, y2-y1); y1=199`
  - p2 (if ch): if ch&1: `[9b]=1; [9c]=clamp(y2,0,199); y2 += md(y2-y1, -x2, x2-x1); x2=0; [9e]=y2`
    if ch&4 && x2>319: `y2 += md(y2-y1, 319-x2, x2-x1); x2=319`
    if ch&2 && y2<0: `x2 += md(x2-x1, -y2, y2-y1); y2=0`
    if ch&8 && y2>199: `x2 += md(x2-x1, 199-y2, y2-y1); y2=199`
  - finally clamp x1,x2 to 0..319 and y1,y2 to 0..199; visible.

### 08d8:0ad3 leftBorder
`a=[9c] b=[9e]`; if a!=b: order a<b, a=max(a,0), b=min(b,199); if b-a>0: XOR 0x80 into work[r*40+0] for r = a+1..b;
ad1++. Always `[9b]=0`.

### 08d8:097f line (XOR, one pixel per row — for the parity fill)
```
if y1==y2 return; if y1<y2 swap endpoints        // now y1>y2, drawn upward from y1
dy=y1-y2; dxa=|x2-x1|; step = x2<x1 ? -1 : +1; x=x1; y=y1
xor(x,y) := work[y*40 + (x>>3)] ^= 0x80>>(x&7)   (mask table work[0x1f41..])
if dxa==0 or dxa==dy:  repeat dy: { xor(x,y); y--; if dxa: x+=step }
elif dxa>dy:  e=0; xor(x,y); rows=dy&255;
              loop { x+=step; e+=2*dy; if e>dxa { y--; if(--rows==0) return; e-=2*dxa; xor(x,y) } }
else:         e=0; repeat dy: { xor(x,y); y--; e+=2*dxa; if e>dy { e-=2*dy; x+=step } }
```
Rows y1 .. y2+1 get exactly one pixel; the row y2 does not.

### 08d8:0e00 fill (copy work buffer bbox to the VGA plane, XOR-parity fill)
```
rows = maxY-minY+1; if rows<=0 return
c0 = (minX & 0xffff)>>3; nb = ((maxX & 0xffff)>>3)+1-c0      (patched into 0ebf / 0ec3)
dest = linear([0e61]:0) — offsets in VGA equal offsets in work
for each row y=minY..maxY: off=y*40+c0; state=0; i=0
  while i<nb:
     j = first index >= i with work[off+j]!=0, or nb-1 if none
     if state: VGA[off+i .. off+j-1] = 0xff          // state 0: those bytes are NOT written
     b = work[off+j]; VGA[off+j] = (state ? T1 : T0)[b]; if popcount(b) odd: state ^= 1
     work[off+j] = 0; i = j+1
```
T0 = scr_data+0x1f49, T1 = scr_data+0x2049 (256 bytes each): `T_s[b]` = prefix-XOR fill of b starting in state s,
MSB first, a set bit toggles the state and that pixel takes the new state (verified: equals this formula for all 256).
`scr_data+0x1f41..48` = 80 40 20 10 08 04 02 01. Writes go to the single plane selected by the map mask.
Note: the last byte of every row is always written (with 0 when outside) — this matters only for 1184's growing bbox.
**The work buffer is persistent**; bits outside the bbox survive into the next plane/frame (reproduce literally).

### 08d8:0fe1 accumBBox
`if maxY>=b1 b1=maxY; if minY<=af af=minY; if maxX>=b5 b5=maxX; if minX<=b3 b3=minX`.

### 08d8:14a9 show + flip (once per frame)
CRTC start (0x0c/0x0d) = [1413]; `0731:00a3` (wait tick); CRTC 9 = (old & 0x60) | ([92]+1) (=1: 2 scanlines/row, same
picture); `[1413] ^= 0x1f40; [0e61] ^= 0x1f4`. Pages: offset 0 and 0x1f40 (8000 bytes = 320x200/8).

### 08d8:1417 clear back-page rectangle (all 4 planes, map mask 0xf)
```
bp=(bd & 0xffff)>>4; dxw=(bb & 0xffff)>>4; if bp<20 bp++; bp-=dxw; if bp<=0 return
if b9-b7 < 0 return; di = b7*40 + dxw*2 + [1413]
for r in 0..b9-b7: zero 2*bp bytes at di; di += 40
```
### 08d8:1514 = `bd=b5 b9=b1 b7=af bb=b3`; callers then set `b3=1000 b5=0 af=1000 b1=0`.

### 08d8:200a step angles
`a95+=[1578]; a97+=[2002]; a99+=[2004]; a3+=[2006]; [914]+=[2008]`; each angle: if (unsigned) >= 0x5a0 subtract 0x5a0.

### 08d8:1184 render jelly (es = 0x555) — like 128d except:
after 07cb calls **112a** (curve points); **no back-face test** (bh ignored); edges are built the same way; plane loop:
**no bbox/ad1 reset** (keeps whatever the previous plane/call left), and always `fill(p); accumBBox()` (no [128c] or
ad1 test). Uses SP as a scratch register inside cli (irrelevant).

### 08d8:112a / 1026 jelly side curves
112a: `curve(0x90, v0.sx, v0.sy, v3.sy, v8.sx)`, `curve(0xc6, v1.sx, v1.sy, v2.sy, v9.sx)`,
`curve(0xfc, v5.sx, v5.sy, v6.sy, v10.sx)` (projected values; dest = byte offset of point 11, 20, 29).
1026 curve(di, x0, ytop, ybot, xc) writes 9 points P0..P8 (6-byte stride, only x and y):
```
P8 = (x0, ybot); P0 = (x0, ytop); h = ybot-ytop
c=0; for k=1..7: c+=h; Pk.y = (c sar 3) + ytop
d = xc-x0; acc=0
for k=1..4: acc+=d; t=(acc sar 3)<<1; v=xc-x0-t
   q = k==1 ? v sar 3 : k==2 ? v sar 2 : k==3 ? (3v) sar 3 : v sar 1
   Pk.x = q + x0 + (acc sar 3);  P(8-k).x = Pk.x (k<4)
```
(all int16, sar = arithmetic shift).

## Effect routines

### 08d8:25f4 (far) entry
```
[8e]=160 [95]=0 [97]=0xdc [99]=0 [0e61]=0xa000 [1413]=0 [a3]=20000 [2006]=0
call 249e ; call 252a ; retf
```

### 08d8:249e phase 1: two glentz cubes (object 0x5a1)
Palette: 16 colours from 08d8:21c6 to DAC 0 via `0299:0076` (screen blanked during the write):
```
0:0,0,0 1:11,11,20 2:13,13,23 3:16,16,26 4:30,40,30 5:22,32,35 6:25,35,39 7:29,39,43
8:15,20,15 9:16,22,24 10:18,24,26 11:20,26,28 12:20,30,20 13:18,26,28 14:20,28,30 15:22,30,33
```
`[1578]=4 [2002]=8 [2004]=6`. State vars (image values): cnt=[21f7]=90 (byte), st=[21f6]=0, n=[21f8]=60 (word),
m=[21fc]=0, z=[249d]=0 (byte).
```
do {
  14a9; 1417; 1514; reset b; 128d(0x5a1)
  ticks = 157e
  repeat ticks:
     if (--cnt == 0) stateMachine()      // 21fd
     z++; if (z <= 100) a3 -= 198; else z--
     200a
} while (st < 12)
```
cube0 = verts 0..7 (offset 0xc), cube1 = verts 8..15 (offset 0x3c). Helpers on object 0x5a1:
- **206c setSize(a, cube)**: rewrite the 8 vertices to the ±a cube in the original order (v0(-a,-a,a) v1(a,-a,a)
  v2(a,a,a) v3(-a,a,a) v4(-a,-a,-a) v5(a,-a,-a) v6(a,a,-a) v7(-a,a,-a)).
- **20b2 moveY(a, cube)**: y of the 8 vertices += a.
- **20f2 grow(a, cube)**: x,y,z words -= a or += a with the fixed sign pattern
  `[+a,+a,-a, -a,+a,-a, -a,-a,-a, +a,-a,-a, +a,+a,+a, -a,+a,+a, -a,-a,+a, +a,-a,+a]` meaning
  `word -= a` for "+a", `word -= -a` for "-a" → each coordinate's magnitude grows by a (a=-1 shrinks).

**21fd stateMachine** (sets cnt for the next call):
```
st0: if n==80 {st=1; cnt=80} else {setSize(n,0); n++; cnt=5}       // uses n before the increment
st1: if n==40 {st=2; cnt=80} else {setSize(n,0); n--; cnt=5}
st2: if n==61 {st=3; cnt=80} else {setSize(n,0); n++; cnt=5}
st3: if m==100 {st=4; cnt=90} else {m++; moveY(1,0); moveY(-1,1); cnt=2}
st4: if m==0 {st=5; cnt=50} else {m--; moveY(-1,0); moveY(1,1); cnt=2}
st5: if a95==0 && a99==0 {[1578]=0; [2004]=0; cnt=1; st=6} else cnt=1
st6: if [914]==0 {st=7; cnt=1} else {[914]--; moveY(2,0); moveY(2,1); cnt=1}
st7: if n==81 {st=8; cnt=1} else {grow(1,0); grow(1,1); moveY(-1,0); moveY(-1,1); n++; cnt=1}
st8: if a97==100 {object.nverts (0x5a1:[8]) = 8; cnt=100; st=9} else cnt=1
       // cube1 is no longer transformed: its faces keep using the last projected verts 8..15 (frozen)
st9: if n==30 {cnt=1; st=10} else {grow(-1,0); moveY(-1,0); n--; cnt=1}
st10: if n==-130 {cnt=1; st=11; palette 16 colours from 08d8:2196} else {moveY(-1,0); n--; cnt=1}
st11: if n < -30 (signed) {moveY(6,0); n+=6; cnt=1} else {cnt=1; st=12}
```
Palette 2196: `0:0,0,0 1:11,11,20 2:13,13,23 3:16,16,26 4..7:30,40,30 8..11:15,20,15 12..15:20,30,20` (cube0 now
opaque over cube1). The palette write happens inside the step (after that frame's render); it shows from the next tick.

Timeline (effect frame k = loop tick k = capture 26119+k; render of iteration k uses the state after k-1 steps and
is shown at tick k+1): zoom-in from dist 20000 by 198/step for 100 steps (full size first shown at k=102, capture
26221); the state machine first runs at step 90; states entered at the step of tick: st1 190, st2 470, st3 655,
st4 935, st5 1225, st6 1441, st7 1542, st8 1563, st9 1606, st10 1757, st11 1918, st12 1936 → loop ends after
**1936 ticks** (last phase-1 tick = capture 28055).

### 08d8:252a phase 2/3: jelly
```
1ec8; 1fa8
cx = 700
do { 14a9; 1417; 1514; reset b; 128d(0x586); 1f59
     ticks = 157e
     repeat ticks: { a97 += 8 (wrap 0x5a0); 1ec8; 1fa8 }    // ([95],[99] are 0 here: st5 stopped them)
     cx -= ticks } while (cx > 0)
v = 50 ([2528]); cx += 100
do { 14a9; 1417; 1514; reset b                              // no 128d: small cube gone
     ticks = 157e
     repeat ticks: { 1f59; v += 5; 1ec8; a5 += v }
     cx -= ticks } while (cx > 0)
ret
```
- **1f59 drawJelly**: save [95][97][99][a3]; `[a3]=[a5]; [95]=0; [97]=0x64; [99]=0`; 1184(0x555); restore.
- **1ec8 jellyShape** (object 0x555): `idx = byte[08d8:1ab8 + i]` (i = [1a12], 0,2,..,0x13e, +2 per call wrap 0x140);
  `c = byte[08d8:1a17 + 2*idx] + 5` (8-bit add); `y = byte[08d8:1a16 + 2*idx] + 10`;
  v8.x=-c v8.z=c v9.x=c v9.z=c v10.x=c v10.z=-c; v0.y=v1.y=v4.y=v5.y=y;
  `a5 += sbyte[08d8:1eb7 + j]` (j = [1a14] 0..15 +1 per call), table = `-1 -1 -1 -1 0 0 1 1 1 1 1 1 0 0 -1 -1`.
  Tables: 1ab8 = 320 bytes (only even offsets used), 1a16 = byte pairs; read from the image (08d8:1a16..1bf7).
- **1fa8 smallBounce** (object 0x586): `t = word[08d8:1bf9 + k]` (k=[1fa6], step 4, wrap 0x280: 160 entries);
  `c=t+0x16, b=c+0x3c`; y of v0..v7 = c,c,b,b,c,c,b,b. Table read from the image (08d8:1bf9, 0x280 bytes).
- Initial [1a12]=[1a14]=[1fa6]=0, [a5]=170.

Timeline: phase 2 ticks 1937..2636 (capture 28056..28755), phase 3 ticks 2637..2736 (capture 28756..28855).
Planes: small cube colours 4/8/C (planes 2,3), jelly colours 1/3/2 (planes 0,1); palette 2196 makes the small cube
cover the jelly.

### 08d8:16de (far) end clear
Map mask 0xf; zero 0x1f40 words at a000:0000 (both pages, all planes); CRTC start = 0. Runs right after the last
tick (capture 28855 is already black).

Shared helpers (also used by G4 glentz vector 08d8:1625 / 158f / 15db): 07cb, 0926, 128d, 13f7, 0b70, 0b24, 097f,
0ad3, 0f93, 0e00, 0fe1, 13e2, 14a9, 1417, 1514, 157e, 200a(?), 0299:0076. Only ours: 249e, 21fd, 206c, 20b2, 20f2,
252a, 1ec8, 1fa8, 1f59, 1184, 112a, 1026, 25f4, 16de (16de is also called after 1625 at 0000:0684). 0ecc (variant
of 0e00 that writes zero runs too) is not used here.

---------------------------------------------------------------------------------------------------------------

# Part 2 — 126e:13ea 3200 dots cubes

Mode: as above (main calls 0299:01cc and clears 0x7d00 words all planes), then **CRTC 0x13 = 0x20 → 64 bytes per
row**; visible 320x200 = bytes 0..39 of each row. Pages at byte offset 0 and 0x6400 (es = 0xa000 / 0xa640). Only
planes 0 and 1 are used: cube 1 in plane 0, cube 2 in plane 1 → pixel = 0..3, DAC 0..3. Data segment ds = **120e**
(linear 0x120e0, 0x600 bytes below the code segment 126e).

### Variables (126e:xxxx unless "ds:")
| addr | meaning | initial |
|---|---|---|
| [0bec] | x separation (negated each 0deb call) | 0 |
| [0bee] | current distance | — |
| [0bf0] [0bf2] | distance of cube 1 / cube 2 | 4800, 4800 |
| [0bf4] [0bf6] | CRTC start / segment of the drawing page | 0, 0xa000 |
| [0bfe..0c02] | cube 1 local angle speeds | 4, 6, 2 |
| [0c04..0c08] | cube 1 local angles | 0 |
| [0c0a..0c0e] | cube 2 local angles | 0 |
| [0c10..0c14] | global angles | 0 |
| [0c16..0c1a] | global speeds | 0, 0, 0 |
| [0c1c..0c20] | cube 2 local speeds | 4, 6, 2 |
| [0c22..0c26] | current angles (scratch) | |
| [0c28..2d] | colour A = 63,31,47; colour B = 47,31,63 (bytes) | |
| [0c30] | frame counter (phase B / morph wait) | 140 |
| [0c32] | never written | 0 |
| [0c34] | morph steps left | 0 |
| [0c36] | z of cube 1 vertex 0 | |
| [0c38] [0c3a] | fade sub-counter (word), fade level (byte) | 1, 0 |
| [0c3b..0c46] | 4 DAC colours uploaded each frame (colour 0 never changes = 0,0,0) | all 0 |
| [01d8] | morph target list pointer | 0x1da |
| [0dea] | "0e21 reads source from ds" flag | 0 |
| 0026 / 0056 | cube 1 / cube 2 vertices, 8 x (x,y,z) words: (-50,50,50)(50,50,50)(50,-50,50)(-50,-50,50)(-50,50,-50)(50,50,-50)(50,-50,-50)(-50,-50,-50) | |
| 0000 | face list: count 6, entries (si,di,routine): (0x400,0x4c4,2) (0x500,0x5c4,2) (0x400,0x500,0) (0x440,0x540,0) (0x480,0x580,0) (0x4c0,0x5c0,0) | |
| 01ec | sine table 1280 words, sin(a)=word[0x1ec+a], cos = word[0x3ec+a], a = byte offset & 0x7fe (1024 steps/turn); = round(32767*sin) except 5 entries → copy from image | |
| ds:0000..013f | x → bit mask table (0x80>>(x&7)), built by 0d74 | |
| ds:0140/0170, 01a0/01d0 | morph deltas / accumulators (24 words each) for cube 1 / 2 | |
| ds:0200, 0230, 0260 | rotation input, rotated vertices, projected (x,y) pairs | |
| ds:0280.., ds:0340.. | palette ramps (64 x 3 bytes each) | |
| ds:0400..05ff | 8 edge point lists, 16 points (x,y) each, 0x40 bytes per edge | |

Morph target pairs at 126e:01da: (0x86,0xb6), (0xe6,0x146), (0x116,0x176), (0x1a6,0x1a6), then -1 (wrap). Vertex sets:
```
0x86 : (-50,50,50)(50,50,50)(50,-50,50)(-50,-50,50)(50,50,-50)(50,-50,-50)(-50,-50,-50)(-50,50,-50)
0xb6 : (-50,50,50)(50,50,50)(50,-50,50)(-50,-50,50)(50,-50,-50)(-50,-50,-50)(-50,50,-50)(50,50,-50)
0xe6 : (-50,50,50)(50,50,50)(50,-50,50)(-50,-50,50)(-20,20,-50)(20,20,-50)(20,-20,-50)(-20,-20,-50)
0x146: (-50,50,-50)(50,50,-50)(50,-50,50)(-50,-50,50)(-50,50,50)(50,50,50)(50,-50,-50)(-50,-50,-50)
0x116: (-50,50,50)(50,50,50)(50,-50,50)(-50,-50,50)(50,-50,-50)(50,50,-50)(-50,50,-50)(-50,-50,-50)
0x176: (50,50,-50)(50,50,50)(-50,50,-50)(-50,-50,50)(50,-50,50)(-50,50,50)(50,-50,-50)(-50,-50,-50)
0x1a6: the original cube
```

### 126e:13ea (far) main
```
map mask 0xf; es=a000; 0731:00a3 (tick T0)
0cb3 (CRTC offset 0x20 + ramps); ds=120e; 0d74 (mask table)
A: do { 137a; 1282; bf0-=16; bf2-=16 } while (bf0 != -48)                        // 303 frames
B: do { 137a } while (--c30 != 0)                                                 // 140 frames
   c1c,c1e,c20 = 8,2,6
C: do { 137a; bec++ } while (bec != 90)                                           // 90 frames
   c1a = 2; c30 = 350; cx = 2000
D: do { 137a; 11bb; 1300; cx -= 157e() } while (cx >= 0)                          // 2001 frames
   c16 = 2; c3a = 60; c38 = 1
E: do { 137a; 11bb; 1300; 1254; bf0+=16; bf2+=16 } while (c3a != 0)              // 414 frames
retf
```
Capture: T0 = 28856; 137a ticks 28857..; A ends 29159, B 29299, C 29389, D 31390, E 31804.

### 126e:137a one frame
```
0731:00a3
0d60: upload DAC 0..3 from 126e:0c3b via 0299:0076
1135: map mask 3; on the drawing page clear 40 bytes x 200 rows (stride 64)
GC4 (read map) = 0, map mask = 1
  0e21(src cs:0026, angles c04, speeds bfe)   // local rotation
  0deb                                      // separation + global rotation (angles c10, speeds c16)
  bee = bf0; c36 = ds:[0234]; 0dad; 0f7a
GC4 = 1, map mask = 2
  0e21(src cs:0056, angles c0a, speeds c1c); 0deb; bee = bf2; 0dad; 0f7a
1151: CRTC start = bf4; bf4 ^= 0x6400; bf6 ^= 0x640; es = bf6     // shows the page just drawn from the next tick
```
**0e21 rotate**: angles[k] = (angles[k] + speeds[k]) & 0x7fe → a1,a2,a3; copy 24 words from the source (cs:src if
[dea]==0 else ds:src) shifted left 5 to ds:0x200; `[dea]=0`. With `M(p) = int16((2*p) >> 16)` of the 32-bit sum p:
```
bf8 = M(x*C1 - y*S1);  bfa = M(y*C1 + x*S1)
bfc = M(z*C2 + bfa*S2);  y' = M(bfa*C2 - z*S2)
x' = M(bfc*S3 + bf8*C3); z' = M(bfc*C3 - bf8*S3) sar 5     → ds:0x230 (x',y',z')
```
**0deb**: `bec = -bec`; each vertex: `x = (x sar 5) - bec; y = y sar 5`; then falls into 0e21 with source ds:0x230,
angles c10, speeds c16 (`[dea]=1`). So the global angles advance twice per frame (once per cube; cube 2 uses the
second increment) and the cubes are offset by +bec / -bec.
**0dad project**: `d = z + bee + 500`; `sx = ((-idiv(x*-500, d)) sar 5) + 160`; `sy = (idiv(y*-500, d) sar 5) + 100`
→ ds:0x260 + 4i.
**0f7a**: edge lists (101b) for (v0→v1)@0x400, (v1,v2)@0x440, (v2,v3)@0x480, (v3,v0)@0x4c0, (v4,v5)@0x500,
(v5,v6)@0x540, (v6,v7)@0x580, (v7,v4)@0x5c0; then the 6 face-list entries via the jump table at 126e:1017
(`call word ptr cs:[bp+0x1017]`, bp 0 → 126e:1067, bp 2 → 126e:10ce).
**101b edge(A,B)**: `ddx = int16((A.x<<4) - (B.x<<4)) sar 4` (likewise ddy); `X = B.x<<4, Y = B.y<<4`; for k=1..16:
`X+=ddx; Y+=ddy; p_k = (X sar 4, Y sar 4)`; stored in reverse: list[j] = p_(16-j), j=0..15 (list[0] = A).
**plot(x, rowoff)**: `byte = (rowoff + (uint16(x) >> 3)) & 0xffff`; `VGA[page + byte] |= ds:[uint16(x)]` in the
selected plane (read map = same plane). If page + byte >= 0x10000 the write falls outside the VGA window (lost).
**1067 sides** (si=list P, di=list Q): for i 0..15: P=P[i], Q=Q[i]: plot(Q.x, int16(Q.y<<6)); then 16 steps
`X=Q.x<<4, Y=Q.y<<4, X+=dx16, Y+=dy16` (d computed as in 101b from P−Q), plot(X sar 4, (Y<<2) & 0xffc0) → 17 dots.
**10ce top/bottom** (si=list P, di=list base+4): for i 0..15: Q = word pair at di − 4(i+1) (i=0: edge(v3,v0)[0]=v3,
then walks back through the previous edge list: edge(v2,v3)[16−i]); same as 1067 but 15 steps → 16 dots.
Total 2 × 256 + 4 × 272 = 1600 dots per cube.
Out-of-range dots happen (x −49..362, y −19..220 in the run): x ≥ 320 lands in the invisible bytes 40..63 (mask read
from ds:0x140.. morph data, harmless); x < 0 reads its mask from ds:0xffxx (outside the program, treated as 0 in the
model = no dot — matches the recording); y < 0 or > 199 write outside the visible page. A port can simply skip dots
with x<0, x>319, y<0, y>199.

### Palette routines
- **0cb3 ramps**: for i=0..31 (bl = 60−i): `ds:0x280+3i = A*bl/60`, `ds:0x340+3i = B*bl/60` (signed 8-bit imul,
  idiv truncating); then entries 32..63 mirror 31..0 (`ds:0x2e0+3j = entry 31−j`, same at 0x3a0).
- **1282 fade-in** (A): `if (--c38) return; c38=7; c3a++; col1=A*c3a/60; col2=B*c3a/60; col3=(col1.r, col1.g,
  col2.b)` (c3e.., c41.., c44..). First step on the first frame; c3a reaches 44.
- **1300 depth palette** (D,E): `g=c14; i1=((g-0x200)&0x7fe)>>5; i2=((g+0x200)&0x7fe)>>5; col1=ramp1[i1];
  col2=ramp2[i2]; col3 = (c36 > ds:[0234] /*cube 2 v0 z*/) ? col2 : col1`.
- **1254 fade-out** (E): `if (--c38==0) {c38=7; c3a--}`; then the 9 bytes c3e..c46 *= c3a/60 (in place).
- Each palette computed after frame j's drawing is uploaded at the start of frame j+1, i.e. displayed with frame j's
  picture.

### 126e:11bb morph sequencer (D,E)
```
if c34: { for each cube: acc[k]+=delta[k]; vert[k] = acc[k] sar 7 (24 words); c34--; return }   // 1177
if c32==0: { if (--c30) return; c30=350 }
si=[1d8]; if word[si]==-1: si=0x1da
for cube 1 (target word[si]) and cube 2 (word[si+2]): acc[k] = vert[k]<<7; delta[k] = ((target[k]<<7) - acc[k]) sar 7
[1d8] = si+4; c34 = 128
```
Morphs start at phase-D frames 350, 828, 1306, 1784 and phase-E frame 261 (pair 1 again), 128 frames each.

## Fade-out in main (0000:086d..0888) and end
After 13ea: free `scr_data` (08d8:[0]). Then 64 times: `wait tick; music volume 008e:[1cbf] = counter (64..1);
wait tick; wait tick` — 192 ticks (capture 31805..31996). 008e:2068 just stores the volume; the player clamps every
channel volume to it (008e:1cc1: `vol = min(vol, [1cbf])`, then GUS reg 9 from table 008e:054d). Volume never reaches
0. No drawing and no palette upload in this time: the screen keeps the last dots page with the last uploaded palette
(nearly black, e.g. colour (0,0,1)). Then 0000:088a mode 3 (frame 31996 is a transitional half frame).

Music position: nothing in this slice reads 008e:1261/1263/1268.
