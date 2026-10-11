# P1 — intro part 1 ("presents" + 3D logo) and the "glod" credit parts 2, 4, 6

Scope: part 1 (`0x21db4` / `0x21f44(5)` / `0x2215c`) and the three credit screens that share one engine
("glod": `0x221e8` init, runs `0x22398` / `0x223e4` / `0x22430`, deinit `0x221c8`), plus every helper
below 0x2c000 they reach. Library (>= 0x39000) calls are named by behaviour only; their maths belongs to
E1/E2.

All screen coordinates are mode 13h, 320x200, offset = y*320 + x. "tick" = one MIDAS timer callback =
one 70.086 Hz display frame; `[0x91260]` = frame counter (increments once per tick).

Verified against `demo.avi`. Part 1 zoom is at 27.03-28.40 s (one update per frame). The logo flies at
31.14-33.66 s (about one render every 2 frames in the capture). Glodzoom starts at 34.23 s. The
"hardware" flash is at 40.40 s, and burning continues until about 50 s. A threshold-map simulation
(below) gives the burn silhouette shape seen at 44 s.

---------------------------------------------------------------------------------------------------

## 0. Shared building blocks

### Helper functions

| addr | args (Watcom regs) | behaviour |
|---|---|---|
| `0x1d190` | eax=size | `malloc` (jmp 0x2d434) |
| `0x1d198` | eax=ptr | `free` (jmp 0x2d464) |
| `0x2ceb0` | eax=name, edx=dst, ebx=file offset, ecx=byte count | read part of an archive file into dst |
| `0x2cf98` | eax=name | load whole archive file into a fresh malloc block, return ptr |
| `0x11af3` | esi=pal | upload 768 bytes to the VGA DAC (port 0x3c8 <- 0, `rep outsb` 0x300 to 0x3c9). 6-bit values. ecx ignored. |
| `0x11a5f` | edi=dst, ecx=bytes (multiple of 4) | memset 0 |
| `0x11d43` | esi=src, edi=dst, ecx=bytes (multiple of 16) | memcpy |
| `0x11ad0` | - | wait for the *start* of the next VGA vertical retrace (wait while bit3 of 0x3da set, then until set) |
| `0x123b0` | - | wait until `[0x9125c]` changes = wait for the next timer tick |
| `0x12204` | - | sync: refresh MIDAS position/row and return the sync index (see 0.2) |
| `0x122b8` | - | if ESC was pressed (`[0x118c4]`), stop music, restore int 9, text mode, print "killed.", exit(0) |
| `0x12330` | eax=debug string (unused), edx unused | same ESC check as 0x122b8, plus `while (lastScancode [0x118c0] == 0x19 /*'P'*/) {}` (pause key). The strings "glodzoom", "glod1 waiting for sync" etc. are never printed. |

### 0.1 Shade ("brighten towards white") tables: `0x1d340`, `0x1d254`

`0x1d340(eax=N levels, esi=pal[768], edi=out[N*256])`:
```c
out[0*256 + c] = c;                         // level 0 = identity
int step = 0x4000 / (N-1);                  // signed idiv, truncates. N=32 -> 528
int acc = 0;
for (lvl = 1; lvl < N; lvl++) {
    acc += step;  int add = acc >> 8;       // N=32: add = 2,4,6,8,10,12,14,16,18,20,22,24,26,28,30,33,
                                            //  35,37,39,41,43,45,47,49,51,53,55,57,59,61,63  (lvl 1..31)
    for (c = 0; c < 256; c++) {
        r = min(pal[3c]+add, 63); g = min(pal[3c+1]+add, 63); b = min(pal[3c+2]+add, 63);
        out[lvl*256 + c] = nearest(pal, r, g, b);
    }
}
```
`0x1d254(eax=pal, edx=r, ebx=g, ecx=b)`, which is `nearest`: the distance is
`d(i) = 7*|pal[i].g-g| + 2*|pal[i].r-r| + |pal[i].b-b|`. It returns the first i (0..255) with d==0.
Otherwise it returns the first index with the strictly smallest d (best initialised to d(0), index 0).

Two tables are built once at program start (main, `0x12132..0x12141`):

* `0x22180`: `[0x11494] = malloc(0x2000)`. It reads `gl_pal.col` (768 B) into `0xdf8a0`, then runs
  `0x1d340(32, 0xdf8a0, [0x11494])`. This is the 32-level brighten table of the glod palette. It is
  freed by `0x221dc` after the intro (main `0x127a6`).
* `0x21d7c("presents.raw")`: reads the first 0x300 bytes (palette) of presents.raw onto the stack, then runs
  `0x1d340(32, thatPal, 0xdc710)`. This is the 32-level brighten table of the presents palette.

`0xfd0a0` is the global "shade table" used by the renderer (and by `0x119e0`), 64 rows x 256.

### 0.2 Sync table (intro, at 0x80058, 16-byte entries {pos, row, index, 0})

`0x12204` returns `n` = number of entries already passed. Entry i is passed when
`(curPos > e.pos) || (curPos == e.pos && curRow >= e.row)`. "wait until 12204() > k" = "wait for entry k".

| idx | pos,row | used by |
|---|---|---|
| 5 | 3,0x00 | part 1: start "presents" zoom |
| 6 | 3,0x1e | part 1: start 3D logo |
| 7 | 3,0x30 | part 1: end |
| 8 | 3,0x34 | part 2: start glodzoom |
| 9 | 4,0x20 | part 2: "hardware" flash |
| 13 | 8,0x00 | part 4: start glodblack |
| 14 | 9,0x00 | part 4: "is" flash |
| 18 | 12,0x09 | part 6: start burning |
| 19 | 13,0x00 | part 6: "pain" flash |
| 20 | 13,0x38 | part 6: end |

(The other entries are 0,0x20 / 1,0 / 2,0x1c / 2,0x2e / 2,0x38 / 4,0x20... used by parts 0, 3, 5; entry 21 =
(100,0) is the sentinel.) The waits for the start entries are busy loops. They poll 0x122b8, or 0x12330
in glod, and never wait for a tick.

### 0.3 Scaled blit `0x10db7` (zoom)

`0x10db7(eax=x0, ebx=y0, edx=y1, ecx=x1, esi=src 320x200, edi=dst 320x200)`. Integer source
rectangle, nearest-neighbour, top-left sampling, no clipping:
```c
int32 dy = ((int64)(y1 - y0) << 16) / 200;    // idiv, truncates toward 0
int32 dx = ((int64)(x1 - x0) << 16) / 320;
uint32 fy = y0 << 16;
for (row = 0; row < 200; row++) {
    uint8 *s = src + (fy >> 16) * 320;          // fy>>16 is an UNSIGNED shift (shr)
    uint32 fx = x0 << 16;
    for (col = 0; col < 320; col++) { *dst++ = s[fx >> 16]; fx += dx; }   // shr as well
    fy += dy;
}
```
Negative x0/y0 would wrap to huge indices (out-of-bounds read). In practice they never go negative,
but clamp in a port.

---------------------------------------------------------------------------------------------------

## 1. Part 1: "presents" zoom + flying 3D "robotnik" logo

Files: `presents.raw` (768 B palette + 64000 B pixels, colours 32..63; palette[0..95] equals gl_pal),
`logo.eob` (25428 B, TDDD-derived object).

### Globals
* `[0xdf860]` = presents.raw block (pal at +0, pixels at +0x300)
* `[0xdf880]` = camera, `[0xdf894]` = logo object
* `[0x89dcc]` = renderer target buffer = `0xe4d40` (64000 B). `[0x106b58]` = 0xa0000 (library global; see E2)
* `[0x89ec0]` = 0 (object-loader flag, read by the eob loader at 0x43063..)

### Init `0x21db4`
```
[0x89ec0] = 0
0x21b2c: [0xdf860] = load("presents.raw"); set DAC from its palette (0x11af3)   // palette switches here
cam = 0x39e68(30, 1900, 2700, 2700)      // camera_create(eax=30 -> cam+0xa4, edx=1900 = pool size
                                         // (allocs 1900*36, *40, *12), ebx=2700 -> +0xa8/+0xac/+0xb4(*4),
                                         // ecx=2700 -> +0xb0). Meaning of 30/2700: see E1/E2.
0x3a66c(cam, 0x400)                      // camera orientation *= rotate about X by 0x400/4096*2pi = 90 deg
0x3a714(cam, -5000)                      // camera orientation matrix (+0x6c) translate (0,0,-5000/256)
0x3a7b4(cam, 3000)                       // ... translate (0, 3000/256, 0)
0x3a114(cam, x=-2500, y=1250, z=2350)    // camera_set_position (ints at +4/+8/+0xc, floats /256 at
                                         //  +0x90..+0x98; re-inverts +0x6c into +0x3c)
obj = 0x24688("logo.eob")                // = 0x433b0 load object tree + 0x41c50 per-node prepare
0x39a2c(obj, 0, 0, 2000)                 // object position (+0x58,+0x5c,+0x60)
0x39a70/78/80(obj, 0)                    // rotation angles x,y,z (words +0x64/+0x66/+0x68) = 0
0x3a590(cam, obj)                        // add object to the world list (head 0x89e04)
0x39ad0(obj, 1) twice                    // for every node: vertex[i].xyz = (v*1) >> 8 (arith.) -> i.e.
                                         //  vertices divided by 65536 overall (two floor steps)
0x39bfc(obj, 1)                          // recursively scale node fields +0x4c..+0x54 by 1/256 (int, >>8)
                                         //  and float vectors (+0xac list, +0x2c..+0x34) by 1/256
0x3a598(cam, 3)                          // compute bounding boxes of every world object (0x3c18c); 3 unused
0x3a5b4(cam, 0)                          // cam byte +0x29 = 0
[0x106b58] = 0xa0000; [0x89dcc] = 0xe4d40
for (j = 0; j < 64; j++) memcpy(0xfd0a0 + j*256, 0xdc710 + (j>>1)*256, 256);   // 64-level shade table
```

### Run `0x21f44(k=5)`
```c
while (sync() <= 5) esc_check();                 // wait for entry 5 (3,0)

// --- A: zoom out of the centre of presents.raw, 100 frames ---
int32 X0 = 160<<16, X1 = 160<<16, Y0 = 100<<16 /*[esp+0x34]*/, Y1 = 100<<16 /*[esp+0x28]*/;
int last = frame;
do {
    int d = (frame - last) << 8;  last = frame;      // first pass d = 0
    X0 -= d*409;  X1 += d*409;                       // 409/256 = 1.598 px per frame
    Y0 -= d<<8;   Y1 += d<<8;                        // 1 px per frame
    wait_tick();                                     // 0x123b0
    zoomblit(X0>>16, Y0>>16 /*top*/, Y1>>16 /*bottom*/, X1>>16, presents+0x300, 0xa0000);
    esc_check();
} while (Y0 > 0);                                    // 100 frames when one tick per pass
memcpy(screen, presents+0x300, 64000);               // exact final picture
```
The first frame is uniformly presents pixel (160,100). The last zoom frame (Y0=0) uses source
(0,0)-(319,200), so it is very slightly squeezed horizontally. The exact copy then replaces it.

```c
while (sync() <= 6) esc_check();                 // wait for entry 6 (3,0x1e)

// --- B: 3D logo over the picture, until entry 7 passed ---
int t0 = frame, prevEl = 0, camX = -2150 /*[esp+0x2c]*/, camZ = 2350 /*ebp*/;
for (;;) {                                       // test at top: if (sync() > 7) break;
    int dt = frame - prevEl - t0;  prevEl = frame - t0;
    int s  = sync();
    camX += 23*dt;  camZ -= 3*dt;                // -> camX = -2150 + 23*el, camZ = 2350 - 3*el (el = frames)
    camera_set_position(cam, camX, 1250, camZ);  // 0x3a114 (units 1/256)
    render_world(cam);                           // 0x3a4e0 -> draws into [0x89dcc] = 0xe4d40
    for (i = 63999 .. 0 step dword) { screen[i] = buf[i]; buf[i] = presents_pix[i]; }  // copy, then
                                                 //  restore the background for the next frame
    esc_check();
    if (s > 7) break;                            // (loop condition: continues while s <= 7)
}
memset(screen + 0, 0, 320);  memset(screen + 199*320, 0, 320);   // clear rows 0 and 199 only
```
The renderer draws the logo on top of whatever is in `0xe4d40`, so the background is presents.raw (the
first frame uses the buffer's previous content, with no visible glitch in the capture). The logo is
shaded through `0xfd0a0` (64 levels, the presents brighten table): high levels go to white, which gives
the white/silver look. The camera moves over about 176 frames: x from -2150/256 to about +1900/256 and
z from 2350/256 to about 1820/256, with y fixed at 1250/256. The logo "robotnik" sweeps right to left
across the picture. The capture shows a render roughly every 2nd frame. Motion is frame-based, so
render once per frame in a port.

At the end of B, `0xe4d40` holds the clean presents.raw pixels. **Part 2's glodzoom zooms into this
buffer.**

### Deinit `0x2215c`
`0x39fd8(cam)` frees the camera pools. Then `free(obj)` and `free(presents)`.

---------------------------------------------------------------------------------------------------

## 2. The "glod" credit engine (parts 2, 4, 6)

Main calls (register args eax, edx, ebx, ecx):

| part | init `0x221e8(picA, a, b, picB)` | run | deinit |
|---|---|---|---|
| 2 | ("coding.raw", 0, 1, "hardware.raw") | `0x22398(8)` | `0x221c8` |
| 4 | ("artwork.raw", 1, 2, "is.raw") | `0x223e4(0xd)` | `0x221c8` |
| 6 | ("music.raw", 2, 0, "pain.raw") | `0x22430(0x12)` | `0x221c8` |

`a` = gl_pat block used as the **zoom/reveal** threshold map (only used by parts 2 and 4). `b` = block used
as the **burn** threshold map.

### Files
* `gl_pal.col`: 768 B, the palette used by all three credit parts. Layout in 16-colour rows:
  0..31 = the picture ramp (picA uses only colours 0..31). Rows 2..12 (32..207) are 11 ramps of 16 for
  the burning edge: grey, dark red, red, ..., orange, yellow-brown, grey. Row 13 (208..223) is all black.
  Rows 14..15 (224..255) are a grey-to-white ramp.
* `coding/artwork/music.raw` (picA): 768 B palette (ignored) + 64000 B pixels, values 0..31.
* `hardware/is/pain.raw` (picB): same format. Pixels 0..31 are used as *brightness levels* (white text and
  a small grey font on black).
* `gl_pat.raw`: 12000 B = 3 blocks of 80x50 bytes (values 32..255). Block n is at offset 4000*n.
* `gl_smoke.dat`: 131072 B = 65536 little-endian u16. Entry i (only i < 63680 = rows 0..198 are used) is
  a source pixel index, so it is a per-pixel displacement field (a flow map). Typical displacement is
  -6..+6 px horizontally and -6..+5 rows vertically: 129 distinct (dx,dy) pairs. The maximum used value is
  63675 (row 198).

### Memory: one block of 0x6e200 bytes (keep this exact layout; the code over-reads across buffers)

| global | offset | size | content |
|---|---|---|---|
| `[0x1149c]` | +0x00000 | 64000 | **Pb**: burn threshold map (block b) |
| `[0x11498]` | +0x0fa00 | 64000 | gl_pat.raw during init, then **picA pixels** |
| `[0x114a0]` | +0x1f400 | 64000 | **A**: smoke intensity field |
| `[0x114a4]` | +0x2ee00 | 64000 | **B**: warped smoke (scratch) |
| `[0x114a8]` | +0x3e800 | 0x20000 | gl_smoke.dat |
| `[0x114ac]` | +0x5e800 | 64000 | **Pa**: zoom/reveal threshold map (block a) |

Also: `[0xe0ba0]` = picB file (malloc via 0x2cf98, pixels at +0x300). `[0x11494]` = gl_pal brighten
table (32x256). `0xdf8a0` = gl_pal palette. `0xe4d40` = off-screen 64000 B buffer.

### Init `0x221e8(picA, a, b, picB)`
```c
base = malloc(0x6e200); set the six pointers above;
read("gl_smoke.dat", -> [0x114a8], off 0, 0x20000);
read("gl_pat.raw",   -> [0x11498], off 0, 12000);
upscale80x50(gl_pat + 4000*a, Pa);  repeat 4: blur(Pa);        // 0x1d1a0, 0x11b5d
upscale80x50(gl_pat + 4000*b, Pb);  repeat 4: blur(Pb);
memset(A, 0, 0x1f400);                                         // clears A and B
read(picA, -> [0x11498], off 0x300, 64000);                    // pixels only, overwrites gl_pat
build_tables();                                                // 0x114bc
[0xe0ba0] = load(picB);
memcpy(0xfd0a0, [0x11494], 0x2000);                            // shade rows 0..31 = gl_pal brighten
```
`0x1d1a0(eax=srcW=80, edx=dstH=200, ebx=srcH=50, ecx=dstW=320, esi, edi)`: the generic nearest scaler.
It uses `sx = (80<<16)/320`, `sy = (50<<16)/200` (both 0x4000), so here
`dst[y*320+x] = src[(y>>2)*80 + (x>>2)]`.

`0x11b5d(ecx=w=320, ebx=h=200, esi=src, edi=dst)` is called with src == dst, **in place, sequential**.
It is a 2x2 box average with toroidal wrap, N = 64000:
```c
for (i = 0; i < N; i++) {
    d = i;        v  = s[d];
    d += 1;   if (d >= N) d -= N;   v += s[d];
    d += 320; if (d >= N) d -= N;   v += s[d];
    d -= 1;   if (d < 0)  d += N;   v += s[d];
    s[i] = (v + 2) >> 2;                 // 16-bit sum, no overflow
}
```
(Near the end, reads wrap to the already-rewritten start. Do it in place, in this order.)

`0x114bc` builds two tables:
```c
T1[64]  @0x11354: T1[i] = min(i + 3, 21);                         // smoke injection
T2[256] @0x11394: T2[i] = ((i & 3) ? i : max(i - 1, 0)) >> 2;     // = max(ceil(i/4) - 1, 0): decay
```

### Effect kernels

**`0x115ba` reveal (edx=e, esi=from, edi=to)**: rows 1..198 only (i = 320 .. 63679):
`screen[i] = (Pa[i] - 2*e < 0) ? to[i] : from[i];`

**`0x114ff` warp (esi=A, edi=B, ebx=smoke)**: `for (i = 0; i < 63680; i++) B[i] = A[smoke[i]];`
(B row 199 is never written and stays 0 from the init clear.)

**`0x1178c` diffuse (esi=B, edi=A)**: for j = 0 .. 63999:
`A[j + 2] = T2[(B[j] + B[j+1] + B[j+319] + B[j+320]) & 255];`
* The output is shifted by +2: A[k] averages the (r, c-2),(r, c-1),(r+1, c-3),(r+1, c-2) neighbourhood
  of B. So, besides the flow map, the smoke drifts right and up a little each step.
* It writes A[2 .. 64001]. **A[64000], A[64001] spill into B[0], B[1]** (harmless: B is rewritten
  next step). A[0], A[1] are never written (stay 0).
* For the last row it reads up to B[64319], which is past B into the first 0x140 bytes of
  gl_smoke.dat. Those only affect A[63682..], which nothing visible reads. A port may treat them as 0
  if it never reads A beyond 63681.

**`0x11540` burn compositor (edx=T, edi=A, esi=picA)**: self-modifying. `0x11535(dst-1)` patches the
store address (`0x9ffff` = screen, `0xe4d3f` = off-screen buffer `0xe4d40`). The threshold source is
patched to `[0x1149c]` = Pb, and the threshold offset to `T>>2`. It uses the brighten table `L =
[0x11494]` (32 rows).
```c
int t = T >> 2;  if (t < 0) t = 0;                  // sar
for (i = 320; i < 63680; i++) {                    // rows 1..198
    int    diff = Pb[i] - t;
    uint8  col  = picA[i];
    uint8  lvl  = A[i + 2];                        // smoke brightness (read before the write below)
    if (diff > 0) {
        if (diff > 12) col = (picA[i] >> 1) + 0xd0;               // burnt: row 13 = black
        else {
            A[i] = T1[A[i]];                                      // inject smoke at the burning edge
            col  = (picA[i] >> 1) + (((diff + 1) << 4) & 0xff);   // edge ramps, rows 2..13
        }
    }
    dst[i] = L[lvl*256 + col];                     // brighten by the smoke level (0..21)
}
```
`t` falls from 256 to 0. Pixels whose threshold exceeds `t` first pass through the 12 fire-coloured
edge ramps, then go black. Smoke (A, bounded to <= 21 by T1/T2) is injected along that edge, advected
by the flow map, diffused and decayed. It whitens whatever is under it, including the black.

**`0x119e0` overlay flash (esi=picB pixels, edi=buf, cl=s, ch=0)** over all 64000 bytes:
`buf[i] = shade[((picB[i] >> s) + 0) * 256 + buf[i]]` with `shade = 0xfd0a0` (rows 0..31 = gl_pal brighten).

### Burn loop `0x22604(k)` (k = start-sync + 1)
```c
memset(A, 0, 0x1f400);                              // A and B
int endF = frame + 0x400;
setdst(screen);                                     // 0x11535(0x9ffff)
int tFlash = frame, flash = 0, prevS = sync();
if (endF - frame < -0x28) return;                  // never
do {
    int s = sync();
    if (prevS == k && s == k + 1) { flash = 1; tFlash = frame; }   // entry k just passed
    prevS = s;
    int dtF  = frame - tFlash;
    int T    = endF - frame;                        // 1024 .. -40
    esc_check();
    warp(A -> B);  diffuse(B -> A);
    if (!flash) {
        setdst(screen); wait_tick();
        burn(T, A, picA);                           // straight to the screen, rows 1..198
    } else {
        int sh = (dtF - 16) / 5;  if (sh <= 0) sh = 0;   // C division (truncates)
        setdst(0xe4d40);
        burn(T, A, picA);                           // into the buffer rows 1..198
        overlay(picB, 0xe4d40, sh);                 // whole buffer
        memcpy(screen + 320, 0xe4d40 + 320, 198*320); // rows 1..198
        if (sh >= 5) flash = 0;                     // NOTE: no tick wait in this branch
    }
} while (T >= -0x28);
```
* Duration: 0x400 + 0x28 = 1064 frames = 15.18 s after the loop starts. `t = T>>2` reaches 0 at
  T < 4, then it is held at 0 for about 44 frames: the final state is mostly black with fading smoke.
* Flash: picB shows as full brightness levels (text goes white) for dtF 0..20 (sh 0). It then dims:
  sh 1 for dtF 21..25, 2 for 26..30, 3 for 31..35, 4 for 36..40. At dtF >= 41 sh = 5 (picB>>5 = 0, no
  effect) and flash ends. The capture agrees (brightness drops at about +23 and about +28..31 frames).
* Rate: the simulation advances one step per loop pass. In the normal branch a pass waits for a tick
  first. In the DOSBox capture the work takes slightly longer than one frame, so the screen updates
  in a "2 updates per 3 frames" rhythm (about 46.7 steps/s), in both branches. The burn threshold is
  frame-based. A port should take one smoke step per 70 Hz frame. To match the capture's smoke speed
  exactly, use 2 steps per 3 frames.

### Run part 2 `0x22398(k=8)`
```c
while (sync() <= 8) pause_check();       // entry 8 (3,0x34)
glodzoom();                              // 0x224a4, still with the presents palette (== gl_pal for 0..31)
set_dac(gl_pal /*0xdf8a0*/);
burn_loop(9);                            // flash at entry 9 (4,0x20) with hardware.raw
memset(screen, 0, 64000);
```
**`0x224a4` glodzoom**: zoom into the presents picture left in `0xe4d40` while revealing picA through Pa:
```c
tmp = malloc(64000);
int32 X0 = 0, X1 = 319<<16, Y0 = 0, Y1 = 199<<16;   int start = frame, last = frame;
do {
    pause_check();
    int e = max(frame - start, 0);
    int d = (frame - last) << 7;  last = frame;
    X0 += d*409;  X1 -= d*409;      // 0.799 px/frame
    Y0 += d<<8;   Y1 -= d<<8;       // 0.5 px/frame
    wait_vretrace();                // 0x11ad0 (real retrace, not the timer)
    zoomblit(X0>>16, Y0>>16, Y1>>16, X1>>16, 0xe4d40, tmp);
    reveal(e, tmp, picA);           // 0x115ba, rows 1..198: Pa[i] < 2e ? picA : zoomed presents
} while (e < 128);                  // last pass is all picA (Pa <= 255 < 256)
free(tmp);
```
After 128 frames the source rectangle is about (102,64)-(216,135). Capture: about 1 update per 2 frames.

### Run part 4 `0x223e4(k=0xd)`
```c
set_dac(gl_pal);
while (sync() <= 0xd) pause_check();     // entry 13 (8,0)
glodblack();                             // 0x225b0
burn_loop(0xe);                          // flash at entry 14 (9,0) with is.raw
memset(screen, 0, 64000);
```
**`0x225b0` glodblack**: `start = frame; do { pause_check(); e = max(frame-start, 0); wait_vretrace();
reveal(e, 0xe4d40, picA); } while (e < 128);`. This is the same Pa reveal, but from whatever is in
`0xe4d40` after part 3. It shows as black in the capture (71-73 s black, then artwork appears through
the Pa pattern).

### Run part 6 `0x22430(k=0x12)`
```c
wait_tick();
set_dac(gl_pal);
memcpy(screen + 320, picA + 320, 197*320);   // rows 1..197 only, immediately (no reveal transition)
while (sync() <= 0x12) pause_check();         // entry 18 (12,9)
burn_loop(0x13);                              // flash at entry 19 (13,0) with pain.raw
memset(screen, 0, 64000);
while (sync() <= 0x14) esc_check();           // hold black until entry 20 (13,0x38)
```
Row 198 keeps part 5's last pixels until the first burn frame (a minor glitch, invisible in practice).
The triangle-shatter transition seen at about 106 s belongs to **part 5** (it happens before part 6's
picture appears). It is not part of these functions.

### Deinit `0x221c8`
`free([0x1149c])` (the whole 0x6e200 block), `free([0xe0ba0])` (picB).

---------------------------------------------------------------------------------------------------

## 3. Rows 0 / 199

Every glod kernel touches rows 1..198 only. Part 1 clears rows 0 and 199 of the screen at its end, and
the burn loop's final `memset` clears all of it, so rows 0 and 199 are black throughout parts 2/4/6.

## 4. Open questions / caveats
* Library semantics (camera create parameters 30/2700, rotate/translate composition order, how
  `render_world` uses `0xfd0a0` and `[0x106b58]`) are left to E1/E2. The call sequence and constants
  above are exact.
* `0x39ad0` is called twice with scale 1 (each a `>>8`). This looks intentional (the eob is in 16.16).
  E1 should confirm the vertex format.
* The off-screen `0xe4d40` content at part 4 start comes from part 3's code (expected all 0 = black).
* The smoke speed in the original depends on CPU speed (one step per loop pass, see "Rate").
