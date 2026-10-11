# P7: "waiting for robotnik" screen, part 7 (ball with light rays), part 8 (sunset over water)

Scope: the code between the intro and the demo in the main sequencer `0x123f0` (0x12778..0x12913),
part 7 (`init 0x1fffc`, `run 0x20480(0)`, `deinit 0x20398`, plus its table builder `0x1fd38` that runs
during the loading screen) and part 8 (`init 0x106f5`, `run 0x286b4(5)`, `deinit 0x106e8`).

Verification status: everything marked **(verified)** was checked byte-exactly. I emulated the original
code in unicorn and compared it with a Python model. That covers: the sine table, both 0x1fd38 tables,
all of part 7's init output, the ball renderer, all ray/line routines, feedback, composite, all of
part 8's init buffers, water, sun, mountains, rocks, present, and the LFSR. The loading-screen text and
part 8's static sky/mountain rows were also matched pixel-exactly against the capture. The Python
models are in the scratchpad
(`.../scratchpad/agents/P7/p7.py`, `p8.py`, tests `t7.py`, `t7b.py`, `t8.py`). They are written to be
transliterated to JS.

Shared helpers are described in `M_main_support.md` (zoomBlit 0x10db7, scale 0x1d1a0, blurWrap 0x11b5d,
sine 0x11bc0, sync 0x12204). They are only summarised here.

Notation: `S[i]` = sine table at `0x9025c` (dword, period 512, amplitude ±257; `isin(a)=S[a&511]`,
`icos(a)=S[(a&511)+128]`, accessed through 0x11a7d / 0x11a70). `idiv` = C/x86 signed division that
truncates toward 0. `F` = frame counter `[0x91260]` (70 Hz). `SyncIdx()` = `0x12204`: it returns the
**number of demo sync entries already passed** (table 0x801b8, entry i = {pos,row}). So "idx ≥ n" means
entry n-1 has been reached.

---------------------------------------------------------------------------------------------------

## 0. Timeline (song bergborr.xm: speed 7, BPM 125, 64-row patterns → 0.14 s/row)

Demo sync entries used here (0x801b8): 0 (0,16) · 1 (1,0) · 2 (3,0) · 3 (3,24) · 4 (3,30) · 5 (3,32) ·
6 (6,0) · 7 (6,32) · 8 (6,48) · 9 (7,0).

In the capture the song starts at ≈124.64 s. Every event below matches the capture to ±0.1 s.

| capture s | song (pos,row) | event |
|---|---|---|
| 123.94–124.64 | – | "waiting for / robotnik..." text (while 0x1fd38 builds tables and the XM loads) |
| 124.64 | start | music starts. Screen black (part 7 init has cleared it and set la_pal). Part 7 waits for idx>0 |
| 126.88 | entry 0 (0,16) | part 7: zoom-in bounce of the first frame (77 frames), then the main loop |
| 133.6 | entry 1 (1,0) | rays stop growing and the centre freezes. The ball starts to swing and rotate |
| 151.5 | entry 2 (3,0) | ray count decreases by 4 per frame |
| 154.88 | entry 3 (3,24) | part 7 loop ends. The fly-away transition (0x28038) starts |
| 155.72 | entry 4 (3,30) | the transition ends. Part 7 deinit, then part 8 init (≈0.7 s precompute, screen black) |
| 156.45 | – | part 8 starts: palette fade-in over 256 frames (3.65 s) |
| 178.4 / 182.9 | entries 6 / 7 | part 8 "bounce" zoom on each sync change |
| 185.12 | entry 8 (6,48) | part 8 ends with a zoom into the centre (43 frames). Then part 9 init (black until 187.25) |

---------------------------------------------------------------------------------------------------

## 1. Between intro and demo: the "waiting for robotnik" screen (0x12778..0x128f3)

```
MIDAS stop + free intro module (0x2dae4, 0x2e0b0); free [0x11494] (0x221dc)
if ([esp+0x2c] != 0 || lastPart < 7) goto exit            // intro-only / end-part limit
LoadSmallFont("font.raw", add=0, shift=0)                   // 0x1dcd0
for i in 0..31: DAC[i] = (i,i,i)                            // 6-bit grey ramp. Entries 32..255 untouched
DrawSmallTextCentered("waiting for", y=170, dst=VGA)        // 0x1dff8
DrawSmallTextCentered("robotnik{{{", y=180, dst=VGA)        // '{' is the '.' glyph
FreeFont()                                                  // 0x1dda0
BuildBallTables()                                           // 0x1fd38 (part 7, §2.2). This is the slow part
load bergborr.xm (0x1c0a8), play (0x2d9cc), install timer callback 0x12280 (0x301c0)
[0x91284] = 0x801b8 (demo sync table); if (firstPart < 7) [0x91280] = 0
if ([0x91280] != 0) MIDAS set position to T[idx].pos (0x2f868)
memset(VGA, 0, 64000)
F = row*49/5 (unsigned)                                     // resync frame counter from the song row
```
The screen under the text is already black (part 6 ended black). Only the 10x7 glyph cells are written.

### 1.1 font.raw (12100 bytes) and the small font (verified against the capture)
`font.raw` = 550 rows × 22 bytes, values 0..31. The big font is at byte 0x2c + g*0x134 (22×14 per glyph,
not used here).
`0x1dcd0(eax=name, edx=add, ebx=shift)`: loads the file into [0x8193c] and sets every byte to
`(b<<shift)+add` (8-bit; here identity). Then it allocates [0x81940] = 0xbd1 bytes (275 rows × 11) and
builds a 2×2 box-filtered half-size font:
```
small[r*11+c] = (F[44r+2c] + F[44r+2c+1] + F[44r+2c+22] + F[44r+2c+23] + 2) >> 2     r<275, c<11
```
`0x1dff8(eax=str, edx=y, ebx=dst)` draws small text centred:
```
n = strlen(s);  x = (310 - 10*(n-1)) >> 1          // = (320-10n)/2 → 105 for 11 chars
for each char ch: if ch != ' ':
     g = ch >= 'a' ? ch-'a' : ch-0x14              // 'a'..'z' = 0..25, '{'=26 ('.'), '0'..'9' = 28..37
     copy rows 0..6, columns 0..9 of glyph (small + 0xb + g*0x4d, stride 11) opaquely (zeros too)
     to dst + (y+row)*320 + x
  x += 10
```

---------------------------------------------------------------------------------------------------

## 2. Part 7: ball with light rays

### 2.1 Files
- `la_ball.raw` (66304): bytes 0..0x2ff are a palette-like ramp and are **skipped**. Bytes
  0x300..0x102ff are a 256×256 texture (`tex[v*256+u]`, values 0..39). u = longitude, v = latitude.
- `la_pic.raw` (16000): 160×100 background, values 0..31.
- `la_pal.col` (768): 256×RGB, 6-bit. It is uploaded once in init. Part 7 has no palette fade.

### 2.2 `0x1fd38 BuildBallTables()` (runs during the loading screen) (verified)
Allocates 0x40000 bytes: `UV = [0xdc700]` (first 0x20000) and `ROT = [0xdc6fc]` (second 0x20000). Both
are 256×256 arrays of byte pairs `(u, v)` (byte 0 = u, byte 1 = v). They are freed in part 7's deinit.
The FPU constant π used here is the truncated **PI = 3.14159265** (double at 0x8db3c).
`trunc` = 0x44160 (frndint in chop mode), `atan2(y,x)` = 0x44193, `asin` = 0x45572,
`round` = fistp (round-half-even).

UV = ray-cast sphere, index `(ty+128)*256 + (tx+128)`, ty,tx in -128..127:
```
Y = ty*1.15;  K = trunc(Y*Y + 147456.0)               // integer
X = tx;  A = X*X + K;  B = -294912.0/A;  C = 570224.0/A   // eye at z=-768, focal 384, sphere r=140
if (B*B < C) { u=0; v=0 }                             // miss → (0,0). u==0 means "transparent"
else {
  t  = -B - sqrt(B*B - C)
  Px = t*X;  Py = t*Y;  Pz = t*384.0 - 768.0
  u = (round(atan2(-Pz, Px) * 40.42535559153412) + 128) & 255       // 40.425… = 127/PI
  v = (round(asin(Py / sqrt(Px²+Py²+Pz²)) * 81.16902106961575) + 128) & 255   // 255/PI
}
```
ROT = re-parameterisation of the sphere by a 90° turn. Index `i*256 + j` (i = v row, j = u column):
```
a = (i-128)*PI/256;  b = (j-128)*PI/128                 // a = latitude, b = longitude
Q = -cos(a)*sin(b);  z = cos(a)*cos(b)
u = (round(atan2(cos(a)*sin(b), sin(a)) * 128/PI) + 128) & 255
v = (round(asin(z / sqrt(z² + sin²(a) + Q²)) * 256/PI) + 128) & 255
```
In double precision the UV table matches the emulator exactly. ROT matches except 129 bytes: byte u at
columns j=64/192 (b = ±PI/2) for odd rows, plus one more. There u lands within 1e-7 of a .5 and differs
by ±1 depending on the FPU's sin/atan precision. Visually irrelevant. Ship the tables as binary assets
if you want them bit-identical to some reference.

### 2.3 `0x1fffc` init (verified)
```
memset(VGA,0,64000);  NRAYS=[0x820d4]=700
buf = malloc(0x720d0)
SP   = [0xdc708] = buf            // 256*256 dwords: projected sphere points (lo word sx, hi word sy)
B    = [0xdc6f8] = buf+0x40000    // 64 KB glow/feedback buffer; pixel (x,y) at B+0x280+y*320+x
TEX  = [0xdc6f4] = buf+0x50000    // 64 KB
BG   = [0xdc6f0] = buf+0x60000    // 64000 background
RAYS = [0xdc704] = buf+0x70000    // 700 × {int u, int v, int visible}

// sphere point table (integer sine table S)
for p in -128..127:                    // latitude
  c = icos(p);  s = idiv(isin(p)<<8, 468);  ys = s*334
  for a in -256..254 step 2:           // longitude
    x = idiv(icos(a)*c, 468);  z = idiv(-c*isin(a), 468)
    if (z > 0) sx = sy = -1
    else { sx = idiv(x*384, z+768) + 160;  sy = idiv(ys, z+768) + 100 }
    SP[(p+128)*256 + (a+256)/2] = {sx, sy}       // visible points: sx 89..231, sy 39..161

srand(1)    // Watcom: s = s*1103515245+12345; rand = (s>>16)&0x7fff
for k<700: RAYS[k].u = (rand()&0x7f) + 0x80;  r1=rand(); r2=rand();
           RAYS[k].v = ((r1&255)+(r2&255))>>1;  RAYS[k].visible = 1
// u in 128..255 = longitudes 0..π = always the front hemisphere. v is triangular-distributed.

load la_pic.raw (16000 B) → TEX;  TEX[i] >>= 1 for i<16000            // 0..15
scale(160x100 → 320x200, TEX → BG)  (0x1d1a0, nearest = pixel doubling)
blurWrap(BG, 320, 200) in place, 1 pass (0x11b5d)
load la_ball.raw offset 0x300, 65536 B → TEX
load la_pal.col → stack pal
TEX[0..255] = 0                                   // first texture row cleared
T1 = 0x90c5c[k] = min(k+5, 63)   k<256           // "+5"; T1[k+4] (address 0x90c60) = "+9"
T2 = 0x90d5c[k] = min(2k/3, 63)  k<256           // decay
T3 = 0xdb4f0[k] = min(k/5, 63)   k<512           // blur normalise
for i<65536: TEX[i] = TEX[i]==0 ? 0 : max(TEX[i]>>2, 2)    // 0 = hole, else 2..9
memset(0xe4d40, 0, 0x10000)        // FB: pixel (x,y) at 0xe4fc0+y*320+x (2 guard rows above)
memset(B, 0, 0x10000)
memset(VGA, 0, 64000);  set DAC from la_pal (0x11af3)
```
T1 index k+4 can reach 255+4 (= T2[3]). That never happens because pixels stay ≤ 63.

### 2.4 Per-frame building blocks (all verified)
Memory model: FB = the 64 KB block at 0xe4d40, pixel (x,y) at offset 0x280+y*320+x. **No clipping
anywhere.** Coordinates are linear offsets, so an x outside 0..319 wraps into the neighbouring row. Do
the same in the port: use a flat array with ≥2 spare rows above and below.

**plot_v(x,row)** (vertical 4-pixel brush): `FB[row-1]=T1[..]` (+5), `FB[row]=T1[..+4]` (+9),
`FB[row+1]` +9, `FB[row+2]` +5. All saturate at 63.
**plot_h(x,row)** (horizontal brush, built as a dword, so it is shifted one pixel right): read
`a=p[-1], b=p[0], c=p[1], d=p[2]`, then write `p[0]=T1[a], p[1]=T1[b+4], p[2]=T1[c+4], p[3]=T1[d]`.

**`0x1f868 thickSeg(x0,y0,x1,y1)`** (eax,edx,ebx,ecx). Draws from (x0,y0) up to but excluding (x1,y1):
```
dx=x1-x0; dy=y1-y0; if (!dx && !dy) return
if (|dx| > |dy|) { sl=idiv(dy<<8,|dx|); f=y0<<8; for (x=x0; x!=x1; x+=sgn(dx), f+=sl) plot_v(x, f>>8) }
else             { sl=idiv(dx<<8,|dy|); f=x0<<8; for (y=y0; y!=y1; y+=sgn(dy), f+=sl) plot_h(f>>8, y) }
```
(`>>` is arithmetic.)
**`0x1fa88 thinSeg(x0,y0,x1,y1)`**: the same split (x-major iff |dx|>|dy|). Every pixel gets one T1 (+5).
Through 0x1201f/0x1204e/0x1207d/0x120b7 the loops are **do-while with unsigned compares**: x-major
`do { px(x, f>>>8); f+=sl; x±=1 } while (x <u x1 / x >u x1)`; y-major the same on y. So the start pixel
is always drawn and the end pixel is not.

**`0x1f560 rayOut(x,y)`**: draws from the point **away** from the centre C=([0x820cc],[0x820d0]) to the
screen edge:
```
dx=x-Cx; dy=y-Cy; if (!dx && !dy) return
if (|dy| < |dx|) {                    // x-major; f = y<<8, sl = idiv(dy<<8,|dx|)
   dx>0 && dy>0 : while (x<318 && f<0xc700) { plot_v(x,f>>8); x++; f+=sl }
   dx>0 && dy<=0: while (x<318 && f>=0)     { ... x++ }
   dx<=0 && dy>0: while (x>0   && f<0xc700) { ... x-- }
   dx<=0 && dy<=0: while (x>0  && f>0)      { ... x-- }
} else {                              // y-major; f = x<<8, sl = idiv(dx<<8,|dy|); no x bound
   dy>0 : while (y<199) { plot_h(f>>8, y); y++; f+=sl }
   else : while (y>0)   { plot_h(f>>8, y); y--; f+=sl }
}
```

**`0x11fd9 drawBall(al=rotU, ah=rotV, ecx=dstOfs, edx=TEX, esi=UV, edi=ROT)`**:
```
d = 0xe4fe0 + dstOfs   (= FB pixel (32,0) + dstOfs);  s = UV + 0x3800  (UV row 28 = ty -100)
for r<200 { for c<256 {
   u = UV.u[s]; if (u) {
      i = UV.v[s]<<8 | (u+rotU)&255;      (u2,v2) = ROT[i]
      i = v2<<8 | (u2+rotV)&255;          (u3,v3) = ROT[i]
      p = TEX[v3<<8 | u3];  if (p > 1) *d = p      // 0 = hole stays transparent
   } s++; d++ } d += 64 }
```
So the ball is 256×200 at x=32..287, y=0..199, plus the offset (xo,yo) as `dstOfs = yo*320+xo`.

**`0x1fb50 raysInner(eax=0, edx=0, ebx=rotU, ecx=rotV, stack: xo, yo)`** (ret 8). For k < [0x820d4]:
```
(sx,sy) = SP[(v&255)<<8 | (u&255)]   (eax/edx would offset u/v by >>8; part 7 passes 0)
if (sy <= 0) { ray.visible = 0; continue }       // back side (sy=-1)
m = ((sx-32)&255) | ((sy<<8) + 0x1c00)           // UV entry seen at screen pixel (sx,sy) of an un-offset ball
(u0,v0) = UV[m];  i = v0<<8 | (u0+rotU)&255;  w = ROT[i] as u16 (u | v<<8)
i = w + (rotV & 255)          // NB: plain 16-bit add, it may carry into v and even exceed 0xffff
w = ROT[i] as u16;  ray.visible = (TEX[w] == 0)  // the ray's origin lies in a hole (eye/mouth)
x1 = sx+xo; y1 = sy+yo
visible ? thickSeg(C, (x1,y1)) : thinSeg(C, (x1,y1))
```
(i > 0xffff reads past the ROT table into whatever follows the 0x40000 allocation. That is very rare
(v=255). Clamp or pad with zeros.)

**raysOuter** (inline in run, 0x206a7..0x20728): for k < n with `visible`: `(sx,sy)=SP[...]` as above,
then `rayOut(sx+xo, sy+yo)`.

**feedback** (inline asm, 0x20522/0x2073b): for o in FB/B pixel rows 0..198 (offsets 0x280 ..
0x280+0xf8c0-1): `B[o] = T2[(FB[o] + B[o]) & 255]; FB[o] = 0`. Row 199 of FB is **never cleared**
and row 199 of B is never written. Both are harmless (see below).

**`0x11e4c composite(edi=dst, esi=B+0x280, edx=BG)`**: for i in 0..63679 (rows 0..198):
`dst[i] = T3[B[i] + B[i-320] + B[i-1] + B[i+1] + B[i+320]] + BG[i]`. Row −1 of B is 0 and row 199 of B
is the initial copy (0). Values: ≤ 63+15 = 78, so the high palette is unused. The dword add cannot carry
between bytes.

### 2.5 `0x20480 run(start=0)`
```
saveN = 700; [0x820d4] = 0; xo=yo=0; ACC_U=ACC_V=0 (24.8 fixed); b = 3*PI (9.42477795); a = 0
drawBall(rotU=0xc0, rotV=0, ofs=0)                    // first frame, no rays
memcpy(B, FB-block 0xe4d40, 0x10000)                  // B = FB (incl. guard rows)
feedback();  composite(dst=FB 0xe4fc0)                // FB = first image (glow of the ball + BG)
while (SyncIdx() <= start) EscCheck()                 // wait for entry 0 (0,16)
IntroZoom()                                           // 0x203ac, §2.6 (zooms FB onto VGA)
resync F from row (0x121d4);  R0 = [0x91264] (= F*5/49);  F0 = F
prevE = 0;  frames = 0
idx = SyncIdx();  if (idx > start+3) goto end
do {
   idx = SyncIdx(); EscCheck()
   dt = (F - F0) - prevE;  prevE = F - F0              // [0x78], [0x7c]
   rotU = (ACC_U>>8) - 64;  rotV = ACC_V>>8
   raysInner(rotU, rotV, xo, yo)                       // uses C and n = [0x820d4]
   drawBall(rotU&255, rotV&255, yo*320+xo)
   raysOuter(xo, yo)
   feedback();  composite(dst = VGA)                   // straight to A000. NO tick wait in this loop
   if (idx > start+1) {                                // phase 2: from entry 1 (1,0)
      b += dt*0.016;  h = b*0.5
      xo = round(cos(h)*24);  yo = round(32*cos(h)*sin(h))   // fistp, nearest-even; xo=yo=0 at start
      ACC_U += dt*75;  ACC_V += dt*31                  // spin ≈ 0.29 and 0.12 texel/frame
   } else {                                            // phase 1: centre swings, rays grow
      Cx = 160 + round(32*sin(a));  Cy = 100 + round(24*sin(a)*cos(a))   // a from the previous frame
      n  = min(([0x91264] - R0) * 20, saveN)           // +20 rays per song row
   }
   a = prevE * 0.016;  frames++                       // this iteration's elapsed; used by the next phase-1 step
   if (idx > start+2) n = max(n - dt*4, 0)             // from entry 2 (3,0): rays die out
} while (idx <= start+3)                               // ends at entry 3 (3,24)
end:
FlyAway(endIdx = start+4 = 4, pos/frame = (0, 0, 30), angle/frame = (15, 32, 0))   // 0x28038, §2.7
memset(VGA,0,64000)
```
Notes:
- C starts as (160,100) (data at 0x820cc). n is 0 in the first iteration. The centre is only updated in
  phase 1 and stays frozen afterwards, while the ball keeps swinging (xo,yo) and rotating. So in phase 2
  the rays leave from a fixed point, not from the ball's centre.
- Ray origins `SP` are fixed sphere points (never rotated). Only their visibility (`TEX` hole test)
  follows the rotation. So rays switch on and off as holes rotate past them.
- What you see on screen is *only* the composite: `glow(B) + BG`. The ball and rays are drawn into FB,
  folded into B with decay 2/3 (steady state B ≈ 2·FB, saturating at 63), blurred by a 5-tap cross /5,
  and added to the background. That gives the soft ball, the trails, and bright saturated beams.
- VGA row 199 is never written by the loop. It keeps what the last IntroZoom frame put there (FB row
  198 of the first image).
- Part 7 runs unthrottled (one composite per loop, no vsync). Porting it as one iteration per 70 Hz
  tick, with dt from the frame counter, reproduces the timing.
- Returned value (avg fps, `frames*17920/elapsed`) is discarded.

### 2.6 `0x203ac IntroZoom` (zoom bounce of the first frame)
```
F0 = F; t = 0
do {
   a  = idiv((768 - t) * ((isin(t+128) + 256) >> 2), 768)        // 128 → 0, bouncing
   x0 = max(a*320, 0);  x1 = min(0x14000 - a*320, 0x13f00)
   y0 = max(a*200, 0);  y1 = min(0xc800  - a*200, 0xc700)
   WaitTick()  (0x123b0)
   zoomBlit(x0>>8, y0>>8, x1>>8, y1>>8, src = FB 0xe4fc0, dst = VGA)
   t = (F - F0) * 10;  EscCheck()
} while (t <= 768)                                               // ≈ 77 frames
```
t=0: the whole screen is FB pixel (160,100). t=256: full view. t=512: about ×1.5 zoom again. t=768:
full view (x1=319, y1=199, so the zoom is very slightly shrinking).

### 2.7 `0x28038 FlyAway(eax=endIdx, edx=vx, ebx=vy, ecx=vz, stack: ax, ay, az)` (shared, ret 0xc)
This is the parameterised form of P0's `0x27e28` (see P0_spider.md §8 for the setup `0x27cac(0)`: the
current VGA is resampled to a 256×256 texture on a 320×200 quad 0x835b8 in world 0x83464, camera at
-256).
```
0x27cac(0); t0 = F; if (SyncIdx() > endIdx) skip
do { t = F - t0; idx = SyncIdx()
     SetObjPos(quad, vx*t, vy*t, vz*t)          // 0x39a2c
     SetObjAngleX(quad,(short)(ax*t)); SetObjAngleY(..,(short)(ay*t)); SetObjAngleZ(..,(short)(az*t))
     RenderWorld → 0xe4d40; copy 64000 bytes 0xe4d40 → VGA while clearing 0xe4d40; EscCheck()
} while (idx <= endIdx)
free texture, free [0x83464], destroy world
```
Part 7 call: `FlyAway(4, 0, 0, 30, 15, 32, 0)`. The picture recedes at 30 units/tick and tumbles about X
(15/tick) and Y (32/tick) for ≈0.84 s (capture 154.9–155.7). Other callers: 0x139ca (p10), 0x1b783
(p11), 0x23c99 (p3/5).

### 2.8 `0x20398` deinit
`free([0xdc708])` (the big buffer) and `free([0xdc700])` (the 0x1fd38 tables). The screen is left as the
fly-away left it, then cleared by run.

---------------------------------------------------------------------------------------------------

## 3. Part 8: sunset over water

### 3.1 Files (all verified by decoding)
| file | size | layout |
|---|---|---|
| su_pal.col | 768 | palette, 6-bit RGB |
| su_sky2.raw | 4000 | 80×50 sky, values 0..169 |
| su_moun2.raw | 10240 | 256×40 mountain mask, bytes 0x00 (mountain) / 0xff (see-through) |
| su_rock1.raw | 8192 | 256×32: four 64×32 rock masks side by side (sprite k at column 64k), 0x00/0xff |
| su_star.raw | 4096 | 64×64 sun glow, values 0..127 |
| su_wave.raw | 4096 | 64×64 wave height map, 0..255 |
| su_brigh.dat | 1024 | 256 little-endian int32 sun brightness curve, values 3..127 |

The file names sit in a table in the code segment at 0x1066c..0x106c0 (plain strings, referenced by
immediates `mov eax,0x1066c` etc.). The buffer pointers are at 0x106c4..0x106e4.

### 3.2 `0x106f5` init (verified)
`base = malloc(0x95700)`. Pointers:
`PAL=[0x106c4]=base`, `MOUN=[0x106c8]=+0x300`, `SK=[0x106cc]=+0x2b00` (64000, working sky/reflection
source), `PR=[0x106d0]=+0x12500` (64000, pristine copy. It lies **directly after SK** in memory, and the
water reads across that boundary), `W=[0x106d4]=+0x21f00` (64 KB), `D=[0x106d8]=+0x31f00` (256 KB),
`ROCK=[0x106dc]=+0x71f00`, `STAR=[0x106e0]=+0x73f00` (0x2000), `BRIGH=[0x106e4]=+0x75f00`.
```
load su_pal.col→PAL, su_moun2→MOUN, su_star→STAR[0..0xfff], su_rock1→ROCK, su_sky2→PR(temp), su_brigh→BRIGH
scale(80x50 → 320x100, PR → SK)  (nearest ×4);  8× blurWrap(SK, 320, 100) in place
for r<100: SK row (199-r) = SK row r                          // bottom half = mirrored sky
load su_wave.raw → PR (temp)
for c<65536: W[c] = wave[((c>>8)>>2)*64 + ((c&255)>>2)] >> 1   // 4× nearest upscale to 256×256, 0..127
15× blurWrap(W, 256, 256) in place
for c<65536 (y=c>>8, x=c&255):                                // displacement map
   dx = (int8)(W[c] - W[y*256+((x+1)&255)]) >> 1             // 8-bit difference, arithmetic >>1
   dy = (int8)(W[c] - W[((y+2)&255)*256+x]) >> 1
   D[c] = dx + dy*320                                         // range -3201..2880 (dx ±4, dy ±10)
memcpy(PR, SK, 64000)                                         // pristine copy
ADD = 0xfd0a0: ADD[s*256+c] = min(s+c, 255), s<128            // 0x1d2fc
for r<64: STAR[0x1000 + r*64 + i] = SK[(41+r)*320 + 194 + i]  // sky patch behind the sun (x 194..257, y 41..104)
```

### 3.3 Objects (rocks), at 0xe3d00: 4 × 16 bytes `{int x (22.10 fixed), int y, ptr sprite, int speed}`
- `0x11c68` seeds the LFSR at 0x11c64 with the timer accumulator `[0x9125c]`. That value is **not
  deterministic**, so any seed is fine for the port.
- `0x11c2b(cl=n)` returns n LFSR bits: `repeat n { fb=((s>>10)^(s>>15))&1; out=s&1; s=(s>>1)|(fb<<31);
  r=(r<<1)|out }` (verified).
- `0x10ca1 newObj(edi=obj, ecx=y, esi=sprite)`: `y; sprite; speed = 0x14a00/(210-y); x = bits(8)<<10`.
  run creates obj k (k<4) with y = 130+7k and sprite = ROCK + 64k.
- `0x10cca moveObj(eax=dt, esi=obj)`: `x -= dt*speed; if (x > 0x4fc00) x = 0x4fc00;
  if (x < -0xfc00) { x = 0x4fc00; r = bits(6); if (r > 38) r -= 38; y = 130 + r; speed = 0x14a00/(210-y) }`.
  Speed is 1.03 px/frame at y=130 and 1.96 px/frame at y=168 (parallax). Rocks leave on the left
  (x < −63) and re-enter at x=319.
- Clip (both draws): `X = x>>10; s0=0; w=64; if (X<0) { s0=-X; w+=X; X=0 } if (X>=256) w -= X-256`.
- `0x109d9 rockReflect(obj)`: draws the rock **upside down** into SK, with the source ANDed against the
  pristine sky: for c<32, i<w: `SK[(y+31-c)*320+X+i] = spr[c*256+s0+i] & PR[same]`.
- `0x10a72 rockDraw(obj)`: draws the rock upright into the 0xe4d40 image WB: for c<32:
  `WB[(y-32+c)*320+X+i] &= spr[c*256+s0+i]`. Only WB rows ≥ 100 ever reach the screen.

### 3.4 Per-frame routines (verified)
**`0x10af9 water(eax=T)`** (self-modifying: the 4 loads use SK as base). Writes WB rows 100..199:
```
s2 = ((T*128 mod 2^32) >> 8 >> 8) & 255          // = (T/2)>>8 as a byte
p = 0
for r = 100 down to 1:                           // r=100 is the horizon row (screen 100)
   q = 0x6e00 / (110 - r)                        // 2816 at the horizon … 258 at the bottom
   v = ((q - 256) & 255) << 8                    // wave row
   U = T - q*160
   for i<320:  u = (U>>8)&255
       o = p + 32000 + D[v|u] + D[v|((u - s2)&255)]
       WB[32000 + p] = (o < 64000) ? SK[o] : PR[o - 64000]    // bottom rows can reach PR's top rows
       U += q;  p++
```
Two copies of the same wave field, scrolled at different speeds, are summed. Each screen row samples
the reflection source at its own position plus the displacement (no vertical remap).

**`0x10d58 sun(eax=idx)`**: `a = 127 - BRIGH[idx & 255]`. Then for k<58, i<64:
`val = ADD[(max(STAR[k*64+i] - a, 0) << 8) | STAR[0x1000+k*64+i]]` (= min(sky + glow, 255)).
Rows k<19 go to **VGA** (x=194+i, y=41+k). Rows k≥19 go to **PR** at the same (x, 41+k) (rows 60..98).
Then the mountain pass picks them up.

**`0x10946 mountains(ecx=sc)`**: for k<40, i<320:
`b = MOUN[k*256 + ((sc + i) & 255)] & PR[(60+k)*320+i]`. Then `VGA[(60+k)*320+i] = b`,
`SK[(60+k)*320+i] = b`, `SK[(139-k)*320+i] = b` (mirror for the reflection). The mountain strip repeats
every 256 px.

**`0x10c4d present()`**: `VGA[32000..63999] = WB[32000..63999]` (WB = 0xe4d40 block, i.e. rows
100..199) and `SK[32000..63999] = PR[32000..63999]` (erases last frame's rock/mountain reflections).

### 3.5 `0x286b4 run(start=5)`
```
memset(VGA,0,64000);  seed LFSR;  create 4 rocks
fadeInit(PAL)    // 0x1d58c: DAC all black, keep PAL as dwords at 0xd5830
// (0x28712: `if (start >= (unsigned)0x12204)` compares with the *address* of SyncIdx. It is a
//  missing-call bug and the wait never happens.)
memcpy(VGA, SK, 32000)                     // sky rows 0..99. Rows 0..40 are never redrawn
cur = prev = SyncIdx();  base = F;  E = <uninitialised stack>;  last = start+3 = 8
if (cur > last) goto end
do {
   sc = (E >> 2) + 64                      // E of the previous iteration (garbage on the 1st frame)
   if (cur != prev) { t=F; Bounce(); base += F - t }      // 0x2850c; the bounce time is excluded
   EscCheck();  prev = cur;  cur = SyncIdx()
   dt = F - E - base;  E = F - base        // E = elapsed frames since part start
   for each rock: moveObj(dt); rockReflect()
   water(T = E * 0x2c0)                    // u scroll 2.75 texel/frame, 2nd layer half speed
   sun(sc & 255)
   for each rock: rockDraw()
   if (E <= 256) fade(E)                   // 0x1d5dc: DAC = PAL[i]*E >> 8
   WaitTick()                              // 0x123b0: this part is vsync-paced
   present()
   mountains(sc)                           // screen rows 60..99 + reflection rows 100..139 in SK
} while (cur <= last)                      // ends at entry 8 (6,48)
end:
memcpy(0xe4d40, VGA, 0x10000);  ZoomOut()  (0x285e8);  memset(0xe4d40, 0, 0x10000);  return 1
```
Order matters for exactness: the water uses the mountain reflection from the previous iteration. The sun
in PR rows 60..98 also shows up in the mountains and the reflection one iteration late. The rock
reflection uses this iteration's positions. The mountain scroll and the sun brightness both use
`sc = (E_prev>>2)+64`, which wraps every 1024 frames (14.6 s): the sun cycles through BRIGH (dim,
bright, dim, …). Confirmed: capture 170.0 s shows sc = 47 → E ≈ 957 → part start 156.35 s.

On the first frame `E` is uninitialised, so `sc` is garbage. The palette is still black then (fade(0)),
so use E=0.

**`0x2850c Bounce`** (on every sync change): `memcpy(0xe4d40, VGA, 0x10000)`, then
```
F0=F; t=0; do { a = isin(t) >> 2   (0..64)
   x0=max(a*320,0); x1=min(0x14000-a*320,0x13f00); y0=max(a*200,0); y1=min(0xc800-a*200,0xc700)
   WaitTick(); zoomBlit(x0>>8,y0>>8,x1>>8,y1>>8, src 0xe4d40, dst VGA)
   t = (F-F0)*6; EscCheck() } while (t <= 256)        // ≈ 43 frames, peak ×2 zoom at t=128 (rect 80..240 × 50..150)
memcpy(VGA, 0xe4d40, 0x10000)
```
**`0x285e8 ZoomOut`** (end): copies VGA to 0xe4d40. Then with `a = t = (F-F0)*3` (t ≤ 128, first frame
a=0) it uses the same rect formulas, zoomBlit and WaitTick. The view zooms linearly into pixel
(160,100) in ≈43 frames. The last frame stays on screen (part 9 init clears it at ≈185.56 s).

**`0x106e8` deinit**: `free(base)`.

### 3.6 Screen composition summary (part 8)
- rows 0..40: static sky (initial copy).
- rows 41..59, x 194..257: sun glow over the sky patch (each frame).
- rows 60..99: (sky + sun glow) AND the scrolling mountain mask.
- rows 100..199: water. Reflection source = mirrored sky, mirrored mountains (rows 100..139), flipped
  rocks. Upright rocks are ANDed on top. The top 2 rows of a rock at y=130 (rows 98..99) are lost.

---------------------------------------------------------------------------------------------------

## 4. Dead code seen in these ranges
- `0x11c75` (gap, never referenced): sqrt/sin bump-texture generator (listed under p7 in
  M_main_support, but nothing reaches it).
- `0x10d1b` (never referenced): counts non-zero SK pixels on a 16×16 grid (every 2nd pixel/row) starting
  at (210,73), clamps at 127. Probably an abandoned sun-occlusion test.

## 5. Open questions
- The ROT-table ±1 entries (§2.2) depend on FPU precision. The reference DOSBox FPU may also differ.
- The part 8 rock seed depends on the timer state. The exact rock layout in the capture is not
  reproducible without it. A seed could be searched by matching the capture (e.g. 170 s frame) if wanted.
- FlyAway's 3D projection details belong to the engine notes (E1/E2, P0 §8).
