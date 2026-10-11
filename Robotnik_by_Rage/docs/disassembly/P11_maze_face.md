# P11 — demo part 11 (lab5 maze landscape + words) and demo part 13 (screaming face in liquid + shatter)

Notation: `T[]` = the 641-entry 8.8 sine table at 0x9025c (built by `0x11bc0`, see M_main_support.md §3.2);
`SIN(a) = T[a & 511]` (`0x11a7d`), `COS(a) = T[(a & 511) + 128]` (`0x11a70`, table 0x9045c). `>>` on signed
values is arithmetic (sar), `/` on signed values truncates toward zero (idiv). "frames" = `[0x91260]` (70.086 Hz
tick counter), "rows" = `[0x91264]` = frames*5/49 (unsigned). `syncIdx()` = `0x12204`. Back buffer `BB = 0xe4d40`,
VGA = `0xa0000`.

**Verification.** Both renderers were run in Unicorn from the real code, and I also wrote independent Python
versions of the pseudo-code below. The independent versions match the emulator **bit for bit**: part 11 at
dt = 0, 100, 500, 1500, and part 13 at dt = 0, 399, 1000, plus all of their tables. The emulator output matches the
capture `demo.avi` exactly: part 11 frame 17600 = dt 144 with 0 palette-index mismatches, and part 13 frame 24000
= dt 399 with 0 mismatches. The scripts are in `scratchpad/agents/P11/` (`reimpl11.py`, `reimpl13.py`,
`p11emu.py`, `p13.py`).

---------------------------------------------------------------------------------------------------------------

# Part 11 — "lab" landscape with words

The scene is a 256x256 height/texture map drawn as a perspective floor (a planar texture-mapped floor, *not* voxel
or raycast). Each pixel is "texture value + light-blob value". The light-blob lookup is perturbed by the map's
gradient, which gives a fake bump. The trick that makes the maze walls: a pixel whose texture nibble comes out as 0
copies the low nibble of the pixel **above it**, which extrudes wall faces downward. Over this, words are added
through a blend LUT. A sync-triggered LUT fade ends the part (flash to white, back to normal, then to black).

## Files

| file | size | layout |
|---|---|---|
| `lab5.raw` | 66304 | 0..767 palette (only bytes 0..47 = 16 base colours are used, see below), 768..66303 = 256x256 map `H[y*256+x]`, values 0..127 (0 = 24637 cells) |
| `lab2.lut` | 16384 | 64 rows x 256: `LUT[r*256 + c]`. Rows 0..31 brighten (row 0 = identity, row 31 = all 205 = white); rows 32..63 darken (row 32 = identity, rows ≥ ~48 = all 0). Loaded to 0xfd0a0 |
| `font.raw` | 12100 | big font, 21x14 cells, values 0..31 (see M_main_support.md, `0x1dcd0`/`0x1de4c`); loaded with add=0, shift=0 |

## init `0x1b860`

```
lab = loadFile("lab5.raw");                         // [0xd47a0]
G   = buildGradient(lab+0x300);                     // 0x1b7a0 -> [0xd47a8], 65536 words. Uses RAW heights.
L   = makeLightBlob();                              // lib 0x314c0(2.5,16,255,256.0,0,256,256) -> [0xd47a4], 64 KB
for (i=0;i<65536;i++) {                             // texture nibble + light high nibble
    b = lab[0x300+i];
    if (b) { b >>= 3; if (b <= 1) b = 1; lab[0x300+i] = b; }   // TEX in {0} U {1..15}; 0 stays 0 (= "wall/hole")
    L[i] &= 0xf0;
}
// palette: 16 light levels x 16 colours. Built from the ORIGINAL first 48 bytes:
for (k=1;k<16;k++) for (i=0;i<48;i++) pal[k*48+i] = min(pal[i] + 4*k, 63);
for (i=0;i<48;i++) pal[i] = (pal[i]*12) >> 4;       // level 0 = base*0.75 (done after the others)
setPalette(lab);                                    // 0x11af3, all 768 bytes
patchRenderer(TEX=lab+0x300, L, G);                 // 0x1022d self-modifies 0x102f0 (ecx=0x4000 ignored)
loadFilePart("lab2.lut", 0xfd0a0, 0, 0x4000);
loadFont("font.raw", 0, 0);                         // 0x1dcd0
```
Colour index = `light<<4 | tex`.

**`0x1b7a0 buildGradient(map)`** → word table `G[y*256+x]` (y, x = 0..255, wrapping):
```
lo = ((H[y][x] - H[(y-2)&255][x]) * 4) & 0xff;     // vertical difference, 2 apart
hi = ((H[y][x] - H[y][(x-2)&255]) * 4) & 0xff;     // horizontal difference
G[y*256+x] = lo | hi<<8;
```

**`0x314c0` light blob** (cdecl library helper, `(double exp, int lo, int hi, double scale, byte add, int N, int stride)`,
returns a malloc'd N*stride buffer). It was verified in the emulator and matches this exactly, corners included:
```
for y,x in 0..255: r = sqrt(((x-128.0)^2 + (y-128.0)^2) / 32768.0);
   v = (1-r > 0) ? trunc(256 * pow(1-r, 2.5)) : 0;   // pow of a negative/zero base also gives <=16 here
   L[y*256+x] = clamp(v, 16, 255);                    // then &0xf0 in init: centre 0xf0, outside the disc 0x10
```

## run `0x1b9fc(end=0x0f)`

```
while (syncIdx() <= 0x0f) ;                 // part starts once sync entry 15 (pos 0x15,row 0x0c) has passed
idx = syncIdx(); resetFramesFromRow();      // 0x121d4: frames = row*49/5 (row = 12 here -> frames 117)
start = frames; endIdx = 0x11; dt = 0; fade = 0;
while (idx <= endIdx) {
    camera(dt);                                         // 0x1055c
    floor(2*dt, (SIN(3*dt) >> 3) + 90);                 // 0x100a8 -> rows 0..159 of BB
    t = rows; w = t >> 3;
    if (4 <= w && w <= 24)
        bigTextCentered(WORDS[w], Y[(w-4)&7], BB, (8-(t&7))*4);   // 0x1de4c
    dt = frames - start;                                // NOTE: the next frame renders with this dt
    idx = syncIdx();
    if (fade == 0 && idx == endIdx) { fade = 64; fadeStart = frames; }
    if (fade) {
        fade = 64 - ((frames - fadeStart) >> 1); if (fade <= 0) fade = 0;   // unsigned shr
        row = (fade >= 32) ? fade - 32 : 63 - fade;       // LUT row: 64->32(id), 63->31(white) .. 32->0(id),
        for (i=0xa00;i<0xc800;i++) BB[i] = LUT[row*256 + BB[i]];   // 31->32(id) .. 0->63(black)
    }
    waitTick();                                         // 0x123b0
    if (dt < 76) { if (dt) memcpy(VGA + 0x1e00 + 0xbe00 - dt*640, BB + 0xa00, dt*640); }
    else memcpy(VGA + 0x1e00, BB + 0xa00, 0xbe00);     // BB rows 8..159 -> screen rows 24..175
    escCheck();                                         // 0x122f0 (its eax arg = 0x4600*n/dt is unused)
}
memzero(VGA, 64000); memzero(BB, 0x10000);
```
- **Display window**: back-buffer rows 8..159 (152 rows) go to screen rows 24..175. Screen rows 0..23 and 176..199
  are never written; they stay black. Back-buffer rows 0..7 are rendered but never shown. They still matter,
  because they feed the "copy from above" rule.
- **Intro reveal**: for dt < 76 the top `2*dt` rows of the image are copied to the bottom of the window (screen rows
  `176-2dt .. 175`), so the picture slides up from the bottom at 2 rows/tick. Capture: the first 2 rows appear at
  frame 17456 (249.06 s) and the window is full at 17531.
- **Timing of what is shown**: on screen tick n after the part start (n = 1, 2, …), the image is `render(dt=n-1)`,
  the text uses `t = floor((117 + n) * 5 / 49)`, and the reveal height is `min(2n,152)` rows. Capture: frame F
  shows dt = F − 17456, which was verified at F = 17600, 17900, 17950, 18200 and 18600, text included.
- **Fade**: when sync entry 16 (pos 0x19,row 8) passes, the first two ticks use row 32 (identity). Then comes a jump
  to row 31 (white), 32 ticks back to identity (row 0), then rows 32..63 (to black, all 0 from row ~48). If idx
  were still 0x11 when fade hits 0, it would restart at 64. In practice entry 17 (0x19,0x12) passes ~98 ticks after
  the fade starts, so the loop ends while the picture is black. Capture: white at 19293 (275.28 s), black from 19391
  (276.68 s), and the part ends there.

### Word table (`WORDS` = 0x81854, `Y` = 0x818b8)

`w = rows>>3`. Each word stays for 8 song rows. The glyph clamp `(8-(t&7))*4` = 32,28,…,4 makes it fade out over
those 8 rows. Glyph values above the clamp are clamped (font values are 0..31), and each pixel becomes
`BB = LUT[min(g,clamp)*256 + BB]`, so a word is an additive brighten.

| w | 4 | 5 | 6 | 7 | 8 | 9 | 10,11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20,21,22 | 23 | 24 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| text | robotnik | rage | punish | your | machine | the gathering 97 | " " | thanks to | midas | sahara surfers | sara | fia | you | us | them | punish | your | robotnik |

`Y[(w-4)&7]` = 20, 37, 55, 72, 90, 107, 125, 142 (back-buffer rows, so screen y = Y+16). x0 = `(320-21n)>>1`.
There is no clipping: "the gathering 97" (n=16) starts at x = −8 and wraps into the previous row's right edge. Text
is drawn into BB before the fade LUT, so the fade applies to it too.

## Camera `0x1055c(eax=dt, ebx=yaw, ecx=pitch)`, called with yaw = `COS(dt>>1) & 0x1ff`, pitch = `-42 & 0x1ff` = 470

Model (16.16 dwords at 0x10010, 5 vectors): `P=(0,0,70)`, `C1=(-160,-100,0)`, `C2=(-160,100,0)`,
`C3=(160,-100,0)`, `C4=(160,100,0)` (all <<16). For each vector v, writing to 0x1006c:
```
rot(v, a, i0, i1): c=COS(a), s=SIN(a);                // 0x104fc, products are 64-bit, >>8 keeps the low 32 bits
   o[i0] = (v[i0]*c >> 8) - (v[i1]*s >> 8);
   o[i1] = (v[i0]*s >> 8) + (v[i1]*c >> 8);  o[other] = v[other];
v = rot(v, pitch, Y, Z);   // offsets table 0x10050 = (4,8,0)
v = rot(v, yaw,   X, Y);   // offsets table 0x1004c = (0,4,8)
v.y += dt << 16;           // added to all 5; the corners lose it again below
```
So the yaw angle is a *cosine value used as an angle*. The camera flies +1 unit/tick along y.

## Floor setup `0x100a8(eax=2*dt, ebx=h)` → 200 row records → `0x102f0`

```
for k=1..4: C[k] -= P;                                  // corners relative to the eye
d1 = (C2-C1)/200, d2 = (C4-C3)/200  (per component, idiv)
HH = P.z * h                                             // 64-bit
A = C1; B = C3;
for r in 0..199:
   t  = HH / A.z;                                        // idiv (A.z never 0 in practice)
   u0 = (P.x>>8) - (int32)((t*A.x) >> 16);  v0 = (P.y>>8) - (int32)((t*A.y) >> 16);
   t2 = HH / B.z;
   u1 = (P.x>>8) - (int32)((t2*B.x) >> 16); v1 = (P.y>>8) - (int32)((t2*B.y) >> 16);
   rec[r].pos  = ((u0 + 0x8000) & 0xffff) | (v0 & 0xffff) << 16;   // 8.8 u in low word (+0x8000), 8.8 v in high
   rec[r].step = ((u1-u0)/320 & 0xffff) | ((v1-v0)/320 & 0xffff) << 16;
   A += d1; B += d2;
a  = (2*dt >> 1) & 511;                                  // = dt & 511
dx = (SIN(a) & 0xff) << 8 | ((COS(a >> 1) + 0x32) & 0xff);   // light offset, 16-bit
render(rec, dx);                                         // 0x102f0, only rec[0..159] are used
```

## Floor renderer `0x102f0` (self-modified inner loop): **exact pixel rule**

The screen is processed in 8x8 blocks: block-rows by = 0..19, blocks bx = 0..39, 8 lines, 8 pixels. The row
record `rec[y]` carries a 32-bit accumulator that is written back after each 8-pixel group, so it simply advances
left to right across the line. For each group of 8 pixels starting at `acc`:
```
a[k] = acc + k*step  (32-bit, k = 0..8; u overflow carries into v)
UACC = {1,2,2,4,4,6,6,8}           // !! the u byte comes from a later accumulator (instruction ordering quirk)
for k in 0..7:
   idx = (a[k] >> 16 & 0xff00) | (a[UACC[k]] >> 8 & 0xff);     // vInt*256 + uInt
   c   = TEX[idx];
   j   = (idx + G[idx]) & 0xffff;  j = (j + dx) & 0xffff;      // 16-bit adds, carry from low byte into high
   c   = (c + L[j]) & 0xff;
   if ((c & 0x0f) == 0) c = BB[pixel - 320] & 0x0f;           // pixel directly above, already drawn this frame
   BB[pixel] = c;
acc = a[8];
```
The `UACC` quirk is required for exactness: without it ~7000 pixels per frame differ. Row 0 reads its "above"
pixels from 0xe4c00..0xe4d3f. Nothing references that memory, so use 0. It can only affect hidden rows anyway.
Every pixel of rows 0..159 is rewritten each frame; BB is never cleared. Wall faces (copied pixels) keep only the
low nibble, so they use light level 0, the darkest palette block (base*0.75).

---------------------------------------------------------------------------------------------------------------

# Part 13 — screaming face, bump-lit, in rising liquid; then the screen shatters

Files (strings at 0x10e68/0x10e73): **`wa_pal.col`** (768-byte palette, set once) and **`wa_pic.raw`** (320x200 bytes).
In the picture, each byte is `group<<5 | shade`. The high 3 bits select a 32-colour ramp; the byte as a whole is
also used as a **height**. There is no palette fade in this part, and no use of the LFSR (it is seeded by 0x11c68,
but nothing reads it).

## init `0x1d7c0` (→ `0x11280`)

```
memzero(VGA, 64000);
base = malloc(0xbc700);
W   = base            ; 64000 B   [0x10e80]  liquid height per pixel (rebuilt every frame)
PIC = base+0x0fa00    ; 64000 B   [0x10e84]  wa_pic.raw
LIT = base+0x1f400    ; 65536 B   [0x10e88]  per-frame light, indexed pixel+320 (see 0x110ca)
LM  = base+0x2f400    ; 65536 B   [0x10e8c]  static light map
D   = base+0x3f400    ; 64000 dw  [0x10e90]  bump offsets
R2  = base+0x7dc00    ; 64000 w   [0x10e94]  ripple field 2: computed, NEVER used
R1  = base+0x9d000    ; 64000 w   [0x10e98]  ripple phase field
PAL = base+0xbc400    ; 768       [0x10e9c]
load wa_pal.col -> PAL; setPalette(PAL); load wa_pic.raw -> PIC;
// 0x10eb3 bump offsets (int8 differences; PIC[64000..64319] read past the end = first bytes of LIT, uninitialised)
for i<64000: D[i] = 8*(int8)(PIC[i]-PIC[i+1]) + 2560*(int8)(PIC[i]-PIC[i+320]);
// 0x10f46 (FPU round-to-nearest after fninit)
R1[y*320+x] = 255 - round(sqrt(((y-20)^2 + (x-160)^2) << 7));     // int16, centre (160,20)
R2[y*320+x] = 255 - round(sqrt(((y-180)^2 + (x-300)^2) << 9));    // unused
// 0x1d7c0 light map, y = -100..99, x = 0..319:
r = sqrt(((x-160.0)^2 + y^2) / 51200.0);
LM[(y+100)*320+x] = clamp((1-r > 0) ? trunc(30*pow(1-r, 4.5)) : 0, 0, 27);
LM[64000+k] = LM[k], k<1536;                    // pad for 16-bit wrap
```

## run `0x1da10(end=0x18)`

```
while (syncIdx() <= 0x18) escCheck();        // starts after sync entry 24 (pos 0x27,row 0)
resetFramesFromRow(); start = frames;
while (syncIdx() <= 0x19) {                  // until entry 25 (pos 0x2a,row 0x18): 1176 ticks in the capture
    dt = frames - start;
    liquid(dt);  light(dt);  compose();  escCheck();
}
shatter(...);   // see below
```
There is no wait in the loop. It draws straight to VGA as fast as it can; the image depends only on `dt`, so
render once per tick. Capture: dt = F − 23601 (first frame 23601 = 336.74 s; the last face frame is about 24776).
In DOSBox the face updates only every ~2 ticks near the end (CPU bound), but the dt mapping holds.

**`0x10ff0 liquid(edx=dt)`** (eax is unused):
```
E = 2*clamp(COS(dt), -250, 250) + 1024;
for p<64000: W[p] = ((COS((R1[p] + 8*dt) & 511) + E) >> 3) & 0xff;   // 33..222; ring waves from (160,20); level bobs
```
**`0x110ca light(edi=off)`**, `off = (SIN(dt+100) >> 3)*320 + (SIN(COS(dt+100)) >> 2)`:
```
for i<64000: LIT[i+320] = LM[(i + off + D[i]) & 0xffff];        // note the +320 (one row down)
```
**`0x11152 compose()`**: processes pixel pairs p = 1920, 1922, …, 62398 (screen rows 6..194). Rows 0..5 and
195..199 stay black.
```
if (W[p] > PIC[p]) {                       // unsigned; tested on the first pixel of the pair only -> liquid
    oA = ((int8)(W[p]  -W[p+1]) >> 1) + (int8)(W[p]  -W[p+320])*320;
    oB = ((int8)(W[p+1]-W[p+2]) >> 1) + (int8)(W[p+1]-W[p+321])*320;
    lo = ((PIC[p+oA]   & 0xe0) + LIT[p+oA])   & 0xff;               // refracted picture ramp + light
    hi = ((PIC[p+1+oB] & 0xe0) + LIT[p+1+oB]) & 0xff;
    word = ((hi<<8 | lo) + 0x0404) & 0xffff;                        // liquid is 4 shades brighter
} else {
    word = ((PIC[p+1]<<8 | PIC[p]) & 0xe0e0) + (LIT[p+1]<<8 | LIT[p]);   // 16-bit add
}
VGA[p] = word & 0xff; VGA[p+1] = word >> 8;
```
Because LIT ≤ 27, the colour stays inside its 32-shade ramp (≤ +31) and no carries happen. In practice: shade =
light, the ramp comes from the picture, and the face is lit by a moving spot whose position is perturbed by the
picture's own slope (a bump map). Where the liquid level W is above the picture height, you see refracted, brighter
liquid.

## End: screen shatter (shared transition, also used by parts 3/5 at 0x243a6 and part 15 at 0x1dc1d)

`0x16f20(eax=0x8c, edx=mode 0, ecx=0x10000)` → `0x17138(endIdx = 0x1a)` → `0x169d0` (free) → `memzero(VGA, 0x10000)`
(edi/ecx are still 0xa0000/0x10000). The deinit `0x1d9e0` frees `base`.

**Setup `0x16f20`**:
```
[0x81240]=0x8c (explosion speed, mode!=0 only); D=[0x89f18]=0x100000; tris=0; srand(1)   // 0x43437
[0x89dcc]=BB, [0x106b58]=VGA (0x3a810); 0x76a3c(320,200,BB,0xa0040)  // rasteriser target setup (engine)
T1 = malloc(64K), T2 = malloc(64K): for row<200: T1[row*256+k]=VGA[row*320+k], T2[row*256+k]=VGA[row*320+64+k], k<256
grid 15 rows x 20 cols, n = r*20+c (r outer, c inner):
   gx[n] = c*320/19;  if (c!=0 && c!=19) gx[n] += rand()%7 - rand()%7;
   gy[n] = r*200/14;  if (r!=0 && r!=5)  gy[n] += rand()%6 - rand()%6;     // sic: row 5, not 14, is left unjittered
for q in 0..279, q%20 != 19:   (0x16c04: 266 quads -> 532 triangles, each with its own 3 vertices)
   tex = (gx[q] > 128) ? T2 : T1;  ushift = (gx[q] > 128) ? 64 : 0;
   tri (q, q+1, q+21) then tri (q, q+20, q+21):
     vertex = { pos = ((gx-160)<<10, (gy-100)<<10, 0), u = gx - ushift, v = gy }
     tri = { tex, 3 vertex ids, vel=0, ang=0, angvel=0 }
for each tri (0x169e4, mode 0):
   c = centroid (integer /3 of the 3 positions)
   vel.x = rand()&31; vel.z = rand()&63; vel.y = rand()%5 + ((2*c.y + 0x4b000) >> 5);   // 3200..16000: falls
   angvel.x,y,z = rand()%15 - 7 (three calls in that order)
   // mode != 0 (other parts): vel = 0x8c*(c - [0x81234..3c]) / |(c-o)>>8|, angvel = rand%11-5, rand%13-6, rand%11-5
```
`rand` = Watcom `0x43413`: `seed = seed*0x41c64e6d + 0x3039; return (seed>>16) & 0x7fff`.

**Per tick `0x17138`**: `while (syncIdx() <= 0x1a) { step(); waitTick(); memcpy(VGA, BB, 64000); memzero(BB, 64000); escCheck(); }`
followed by `memzero(VGA,64000)`. With the capture's song, that is ~157 ticks (entry 26 = pos 0x2b,row 8). The pieces
leave the screen after ~1.3 s.

`step()` = `0x168e8`: for every tri `0x16650`, then project all vertices (`0x435e8`), then draw each tri in creation
order (`0x43654` edge setup + `0x764a2` span fill with `tri.tex`, 256-byte texture rows):
```
0x16650(tri): c = centroid(pos) (/3 trunc); for v: v.pos -= c;
   rotate3(v, ang.x, ang.y, ang.z) -> v.rot (unshifted);      // 0x43450
   ang = (ang + angvel) & 0x3ff;
   for v: v.rot = (v.rot >> 10) + c;  v.pos += c + vel;
0x43450 matrix (sin/cos = static tables 0x71054/0x71454 = round(1024*sin(2*pi*i/1024)), 1280 dwords;
   A=ang.x, B=ang.y, C=ang.z; sX=sin[X], cX=sin[X+256]):
   m0=((cB*cC*cA>>10) - sC*sA)>>10   m1=((cB*cC*sA>>10) + sC*cA)>>10   m2=(-cC*sB)>>10
   m3=((-sC*cB)*cA>>10 - cC*sA)>>10  m4=(cC*cA + ((-sC*cB)*sA>>10))>>10 m5=(sC*sB)>>10
   m6=(cA*sB)>>10                    m7=(sA*sB)>>10                    m8=cB
   rot.x = x*m0+y*m1+z*m2; rot.y = x*m3+y*m4+z*m5; rot.z = x*m6+y*m7+z*m8   (32-bit)
0x435e8(verts, n, 160, 100): if (rot.z > -D) { sx = (rot.x<<10)/(rot.z+D) + 160; sy = (rot.y<<10)/(rot.z+D) + 100; }
                             // else the old sx,sy are kept
```
Vertex record = 64 bytes at 0x95f18: +0 pos xyz, +0xc rot xyz, +0x18 sx, +0x1c sy, +0x20 v, +0x24 u.
Triangle record = 52 bytes at 0xb5318: +0 tex, +4/+8/+0xc vertex ids, +0x10 vel, +0x1c ang, +0x28 angvel.
The triangle filler draws both orientations; there is no back-face cull. Its sub-pixel and edge rules are the
engine's textured-triangle routine (not re-derived here; see the engine notes for 0x439cc/0x764a2).

Capture: the shatter's first frame is 24783 (353.61 s). DOSBox ran it at only ~1 physics step per 2–3 ticks
(CPU bound, since each step waits for the next tick after a slow draw), so the capture's pieces fall ~2.5x slower
than the code's 70 Hz rate. The screen is black from ~24874, and the part ends ~24934.

---------------------------------------------------------------------------------------------------------------

## Open questions / caveats
- Part 11: the 320 bytes above BB (0xe4c00..) feed row 0's "copy from above". I assumed 0, and the emulator and
  capture agree on all visible rows.
- Part 13: `PIC[64000..64319]` (bump offsets of the last row) and `LIT[0..319]` are uninitialised heap. I assumed
  0, which matched the capture at the tested frames. Only extreme refraction offsets could reach them.
- Shatter: BB is not cleared before the first step. Parts 11/12 leave BB = whatever part 12 left. If it isn't
  zero, the first shatter frame shows it. The exact rasterisation of 0x43654/0x439cc/0x764a2 is left to the
  engine notes. The step rate needs a choice: the code says 70 Hz, the reference video shows ~25–35 Hz.
