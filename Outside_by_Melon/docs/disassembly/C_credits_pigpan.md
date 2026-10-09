# credits.C and pigpan.C (parts 2 and 5)

Reader: credits-pigpan. Slice: `credits.C` 0x127e0..0x12f30 and `pigpan.C` 0x12f30..0x13140. This file also documents the
asm 3D star engine at 0x41f65..0x42a48 (sub_42657 is called only by credits) and the asm rotozoomer at 0x4b90c..0x4bcb5
(called only by pigpan), because they are needed to port these parts and nobody else owns them. The tunnel inner loop, the
blit and wipe helpers and the LBM decoder are summarised here; reader "core" has the full write-up.

Everything marked **[verified]** was checked pixel-exact against the recording, or against the original machine code run
in Unicorn (see section 5).

## 0. Part order (who sets [0x1f6754])

| from part (render fn) | condition (checked in the render, after drawing) | sets [0x1f6754] | calls start |
|---|---|---|---|
| 0 title (0x12690) | `[0x1f777c] > 1200` | 2 | 0x12b00 credits start |
| **2 credits (0x12be0)** | `[0x1f80a8] > 0x5be` (1470) | 5 | 0x13030 pigpan start |
| **5 pigpan (0x13090)** | `[0x1f841c] > 0x1f4` (500) | 3 | 0x134c0 with eax=0 |
| 3 (0x135b0) | ... | 1 | 0x12310 |
| 1 (0x12390) | `[0x1f7454] > 0x30c` | 4 | 0x134c0 with eax=1 |
| 4 (0x135b0) | ... | 6 | 0x13ad0 |
| 6 (0x13b70) | ... | 7 | 0x13de0 |

So the order is 0 → 2 → 5 → 3 → 1 → 4 → 6 → 7. The switch happens inside a render, so the new part's start function runs
in the middle of a main-loop pass. The frame copy (0x114d0) right after it still shows the old part's final picture, but
with the new part's palette, because the start functions set the DAC.

## 1. Shared helpers used (interfaces only)

| addr | what it does |
|---|---|
| 0x104d0 `load(eax=filename)` | reads a whole file into a malloc'd buffer and returns a pointer to the raw file bytes |
| 0x10010 | assert(eax != 0) (edx=file, ebx=line). No effect |
| 0x146b3 / 0x147b3 | malloc(eax) / free(eax) |
| 0x4177d / 0x4178a `(eax=lbm)` | width / height: big-endian words at file offsets 0x14 / 0x16 (the BMHD w,h; it assumes the BMHD comes first) |
| 0x416e3 `(eax=dst, edx=lbm)` | ByteRun1-decodes the first `"BODY"` found by a byte scan of the file into dst, exactly w*h bytes (chunky PBM). A run that would overflow w*h stops decoding before it writes anything. Header byte 0x80 means 129 repeats (none of these files has one) |
| 0x416aa `(eax=dst, edx=lbm, ebx=count)` | finds the first `"CMAP"` and copies `count` RGB triples from CMAP entry 0, each byte `>> 2` (8-bit to 6-bit) |
| 0x10990 `(eax=tex256x256)` | copies the 64 KB texture twice into the tunnel texture buffer [0x1f678c] (128 KB), so `tex[(off&0xffff)+map]` never needs a wrap |
| 0x10a10 `(eax=n)` | selects tunnel n: [0x1f6780] = map table [0x1f6760+4n] (64000 u16), [0x1f6784] = shade table [0x1f6770+4n] (64000 bytes) |
| 0x10a00 `(eax=off)` | [0x1f6788] = off, the tunnel texture offset |
| 0x4162c tunnel | for i in 0..63999: `fb[i] = (tex[((off & 0xffff) + map[i])] + shade[i]) & 255`, which is the same as `tex256[(off + map[i]) & 0xffff] + shade[i]`. Writes all 64000 pixels |
| 0x415c3 `(eax=src, edx=count, ebx=dstOffset, ecx=add)` | for i in 0..count-1: `if src[i] != 0: fb[ebx+i] = (src[i] + cl) & 255` (0 is transparent). No clipping |
| 0x41575 `(eax=wipe, edx=dst, ebx=srcpic, cl=v)` | for i in 0..63999: `if wipe[i] == v: dst[i] = srcpic[i]` |
| 0x41590 `(eax=wipe, edx=dst, bl=v)` | for i in 0..63999: `if wipe[i] == v: dst[i] = 0` |
| 0x12010 `setpal(eax=pal, edx=first, ebx=count, ecx=bright, stack: r, g, b)` (callee pops 12) | for i in 0..count-1: DAC index first+i; each component `clamp(int8(pal[3i+c]) + (stackarg_c + bright), 0, 63)`. Every caller in this slice pushes 0,0,0, so it is `min(63, pal + bright)`. bright = 64 gives all white |
| 0x12100 `moveToward(eax=target, edx=out, ebx=cur, ecx=step, stack: count)` | for count triples, per component (unsigned bytes): `if cur > tgt: v = max(cur-step, tgt) else v = min(cur+step, tgt)`; `out = v`. cur is NOT modified |
| 0x114b0 | memset(fb, 0, 64000) |
| 0x1a5f0 `(eax=dst, edx=byte, ebx=n)` | memset |
| 0x14796 | Watcom `__CHP`: frndint with RC=truncate. So `call 0x14796; fistp` means truncate toward zero |

The frame buffer is `[0x1f6744]` (= [0x1f6ab0]). It is allocated as 64000 + 40000 bytes, so writes past row 199 land in
invisible slack: clip them at 64000 in a port. Only 64000 bytes are copied to the screen.

Row-offset table [0x1f6750]: 200 dwords, y*320.

Sine table 0x1f8424 (built by 0x13140 at init, outside my slice): `SIN[i] = trunc(sin(x_i) * 65536)`, i = 0..5119,
where `x_0 = 0` and `x_{i+1} = x_i + 0.001533203125` (repeated FPU addition; π was approximated as 3.14, so 4096
entries cover 6.28 rad, not 2π). Doubles in JS reproduce it (verified through the name positions below).

Asm 3D trig tables (made usable by 0x429b1 at init, which subtracts 0x80 from each): 1024 dword entries each.
`S[i] = [0x4872e+4i]-128 = round(128*sin(2πi/1024))`, `C[i] = [0x498ae+4i]-128 = round(-128*cos(2πi/1024))`.
Note that **C is minus cosine**. Both formulas match the exe tables for all 1024 entries (round = floor(x+0.5)).

DAC to RGB in the recording (DOSBox): `rgb8 = (v6*255 + 31) // 63` (i.e. round(v*255/63)). **[verified]** Every
pigpan pixel matches exactly with this mapping; `v<<2|v>>4` does not.

## 2. credits.C (part 2)

### Globals

| addr | name | meaning / initial |
|---|---|---|
| 0x1f80e4, 0x1f80c0, 0x1f80dc, 0x1f80bc, 0x1f80f0, 0x1f80b0, 0x1f80c8 | raw files | adept, jason, joachim, texture4, outside, wipe1, pal1 (.lbm) |
| 0x1f80fc, 0x1f80d4, 0x1f80b8, 0x1f80f8, 0x1f80ec, 0x1f8100 | pixels | decoded adept, jason, joachim, texture4, outside, wipe1 (w*h bytes each) |
| 0x1f8084[3] | name table | {adept px, joachim px, jason px}, in that order |
| 0x1f7d84 [768] | main palette | 6-bit RGB, see start |
| 0x1f7a84 [384] | target palette | pal1.lbm, 128 entries |
| 0x1f7784 [384] | scratch | output of moveToward |
| 0x1fd744 | logo buffer | 64000 bytes, allocated by text.C's load (0x13230); used here as an offscreen logo layer |
| 0x1f80a8 | `t` | tick counter (0 at start) |
| 0x1f80a4 | `bright` | 64 at start, fade from white |
| 0x1f80e8 | `wipeIn` | **render** counter, 0 at start |
| 0x1f0bd4 | `wipeOut` | **render** counter, initial 0, never reset (only its low byte is used) |
| 0x1f80cc | `rotZ` | star z-angle, initial 0, never reset |
| 0x1f80f4 | `spdIdx` | index into aSpeed, initial 0, never reset |
| 0x1f80d8 | `spdCnt` | 0 at start |
| 0x1f09c0 [132] | aSpeed | int32: 1..32, 32,32,32, 31..1, -1..-32, -32,-32,-32, -31..-1 (static data) |
| 0x1f80b4 | `ang` | float32 star orbit angle, initial 0.0, never reset |
| 0x1f80e0 | `tunOff` | tunnel offset accumulator, initial 0, never reset |
| 0x1f0bd0 | `namePhase` | 10000 at start |
| 0x1f8098 | `nameIdx` | 0 at start |
| 0x1f0bd8 | `palCnt` | initial 0, never reset |
| 0x1f809c | `palStep` | 0 at start |
| 0x1f8094, 0x1f80ac, 0x1f80a0 | dead | written but never used |

"Never reset" variables keep their static initial values because credits runs once.

### load 0x127e0 (at init)
It loads adept, jason, joachim, texture4, outside, wipe1, pal1 (in that order), mallocs w*h for each of the first six,
decodes them, and sets `0x1f8084 = {adept, joachim, jason}` pixels.

### free 0x12a70 (at exit)
Frees everything. Two original bugs: texture4's raw file is freed twice and pal1's is never freed. Irrelevant for the port.

### start 0x12b00 (called by the title render; no args)
```
tunnelSetTexture(texture4px)            // 0x10990
pal[0..255]   = texture4 CMAP[0..255]>>2   -> 0x1f7d84
pal[240..255] = adept CMAP[0..15]>>2       -> 0x1f8054
pal[128..207] = outside CMAP[0..79]>>2     -> 0x1f7f04
target[0..127]= pal1 CMAP[0..127]>>2       -> 0x1f7a84
tunnelSelect(0)                         // 0x10a10(0): TUNNEL1 map/shade (see core)
nameIdx=0; namePhase=10000; t=0; spdCnt=0; wipeIn=0; bright=64; palStep=0
memset(logoBuf, 0, 64000)
setpal(pal, 0, 256, bright=64)          // everything white
```
Star colours 209..239 and the tunnel colours 0..127 therefore come from texture4's CMAP. (texture4 pixels are 16..107;
the tunnel shade table adds to them.)

### tick 0x12dd0 (70.086 Hz, from the MIDAS callback)
```
rotZ += 2 * aSpeed[spdIdx]
if t < 64: bright -= 1; if bright <= 0: bright = 0      // (and dead counter 0x1f8094++)
if spdCnt > 5: spdCnt = 0; spdIdx += 1; if spdIdx > 131 (unsigned): spdIdx = 0
ang = float32(ang + 0.05)          // fld dword / fadd qword 0.05 / fstp dword (round to nearest)
t += 1; spdCnt += 1; tunOff += 0x101
if t > 400:
    namePhase += 200
    if namePhase >= 81000: nameIdx += 1; if nameIdx >= 3: nameIdx = 0; namePhase = 10000
if t > 400:
    if palCnt > 2: palCnt = 0; palStep += 1
    palCnt += 1
```
So spdIdx advances every 6 ticks, and palStep = floor((t-401)/3) for t ≥ 401.

### render 0x12be0 (part 2)
```
if t < 96: setpal(pal, 0, 256, bright)
tunnel()                                          // 0x4162c, uses [0x1f6788] set by the PREVIOUS render
// star
cx = trunc(cos(ang) * 4096); sy = trunc(sin(ang) * 2048)   // x87 fsin/fcos of the float32, then __CHP + fistp
setObjectPos(x = 1024 + sy, y = 0, z = 2048 + cx)          // 0x42a25: [0x42a3b],[0x42a3f],[0x42a43]
drawObject(angX = 0, angY = -255, angZ = rotZ)              // 0x42657 (section 4)
// name
if t > 400:
    s  = SIN[(namePhase / 16) & 0xfff]           // signed division toward zero (always positive here)
    y  = trunc(s * 40 / 65536) + 40 + 140        // sar/sbb idiom = division toward zero
    blitAdd(src = names[nameIdx], count = 17600 /*55 rows*/, dst = y*320, add = 0xF0)   // 0x415c3
// logo layer
if wipeIn < 256: wipeCopy(wipe1px, logoBuf, outsidepx, v = wipeIn & 255)        // 0x41575
if t > 340:      wipeClear(wipe1px, logoBuf, v = wipeOut & 255); wipeOut += 1    // 0x41590
blitAdd(src = logoBuf, count = 0xAF00 /*rows 0..139*/, dst = 0, add = 0x80)      // logo colours 128..207
// tunnel palette fade to pal1
if t > 400:
    moveToward(target, out=0x1f7784, cur=pal (entries 0..127), step=palStep, count=128)
    setpal(0x1f7784, 0, 128, 0)
wipeIn += 1
tunnelSetOffset(tunOff)                           // 0x10a00: used by the NEXT render
if t > 1470: part = 5; pigpanStart()
```
Notes:
* Draw order: tunnel, then star, then name (rows 140..199+), then logo (rows 0..139). The logo covers the star.
  The name rows clip at 200 (the slack takes the rest). The name image (320x55) uses only adept's 16-colour palette at 240..255.
* Name y = 180 + trunc(40*sin): at namePhase 10200 y = 213 (off screen); it sweeps up to 141 and back. Each name lasts 355 ticks.
  It is visible (y < 200) for t ∈ [487,705] (ADEPT), [842,1060] (JOACHIM), [1197,1415] (JASON). nameIdx wraps back to 0
  at t = 1465 (off screen).
* wipe1.lbm values are 1..235. wipeIn reveals logo pixels whose wipe value == wipeIn; wipeOut erases those == wipeOut.
  outside.lbm is 320x240, but only its first 64000 bytes go through the wipe and only rows 0..139 are copied (pixel value
  0 = transparent).
* moveToward: the largest |texture4 - pal1| component difference in entries 0..127 is 7, so the fade is complete at
  palStep 7, i.e. t ≈ 422 **[verified]** (recording frames at t = 404..422 match palStep 1, 2, 5, 6, 7).
* The first credits render uses the tunnel offset left by the title part. That frame is all white, so it does not matter.

### Render-count dependence (important)
`wipeIn`, `wipeOut` and the star's light angles (+2,+5,+7 per drawObject call, section 4) advance **per render, not per
tick**. In the recording the credits part renders only about once per 2 ticks: the frames show a tear line that moves,
and each new picture spans two captured frames. I measured the render index k (the light angle and wipeIn) against tick t
by matching the star's shading exactly:

| tick t | 98 | 197 | 397 | 697 | 997 | 1297 | 1447 |
|---|---|---|---|---|---|---|---|
| renders before this one, k | 51 | 105 | 207 | ~346 | 498 | 652 | 728 |

That is k ≈ t/2 (+0..8). The logo wipe confirms it: at t = 98 the highest revealed wipe value is exactly 51. Consequences
in the recording: the wipe-in runs from t ≈ 40 to t ≈ 460 (value 235). The wipe-out starts at t = 341, so the two overlap
(the logo is still building up on the right while it disappears on the left), and the light turns at half speed.
**A port with one render per tick would wipe twice as fast and rotate the light twice as fast.** To look like the
recording, advance these three render counters once every 2 ticks (k = floor(t/2) is within a few renders of the
recording). Everything else in credits is tick-driven. The pigpan part renders about once per tick (see 3).

## 3. pigpan.C (part 5)

### Globals
| addr | meaning |
|---|---|
| 0x1f8414 / 0x1f8420 | panorama.lbm raw / pixels (320x200, values 0..56) |
| 0x1f8408 / 0x1f8410 | texture3.lbm raw / pixels (256x256, values 0..127) |
| 0x1f8108 [768] | palette: 0..127 = texture3 CMAP[0..127]>>2; 128..191 = 0 (BSS, unused); 192..255 = panorama CMAP[0..63]>>2 |
| 0x1f8418 | `bright` (64 at start) |
| 0x1f841c | `t` tick counter (0 at start) |
| 0x1f840c | dead counter |
| rotozoom state (asm, words) | layer 1: P1.x [0x4bcf3], P2.y [0x4bcfb], angle dword [0x4bd31]; layer 2: P1.x [0x4bcff], P2.y [0x4bd07], angle [0x4bd35]. Other point coords 0. Divisors [0x4bd21] = [0x4bd25] = 1024, start u,v [0x4bcd9] = [0x4bcdd] = 0 (static, never written) |

### load 0x12f30 / free 0x13000
They load panorama and texture3, then malloc and decode them.

### start 0x13030
```
pal[0..127]   = texture3 CMAP[0..127]>>2      (0x1f8108)
pal[192..255] = panorama CMAP[0..63]>>2       (0x1f8348)
bright = 64; t = 0
setpal(pal, 0, 256, 64)                        // white
rotoInit()   // 0x4bbf0: layer1 L1 = 0x200, angle1 = 0; layer2 L2 = 0x400, angle2 = 0; 3D angles [0x4acb2/6/a] = 0
```
### tick 0x13100
```
if t < 64: bright -= 1; if bright <= 0: bright = 0   // (dead counter 0x1f840c++)
t += 1
L1 += 3; L2 += 2; angle1 += 1; angle2 -= 2     // 0x4bbbd (both "P1.x" and "P2.y" words of each layer get the same add)
```
### render 0x13090 (part 5)
```
if t < 96: setpal(pal, 0, 256, bright)
memset(fb, 0, 64000)
rotoLayer(texture3, L1, angle1); rotoLayer(texture3, L2, angle2)   // 0x4bb3f: additive, see below
blitAdd(panorama, count 64000, dst 0, add 0xC0)                     // pig picture, colours 193..248
if t > 500: part = 3; start_134c0(eax = 0)
```
### rotoLayer (0x4bb3f → 0x4b90c + 0x4ba10)
The layer is described by three points P0 = (0,0), P1 = (L,0), P2 = (0,L). Each is rotated by sub_4230d with angX = angY = 0
and angZ = a (it writes [0x4acba]). With angX = angY = 0 the rotation reduces exactly to (i = a & 1023):
```
t1 = (x*S[i] + y*C[i]) >> 7          // int32, arithmetic shift
t2 = (x*C[i] - y*S[i]) >> 7
u = -t2 ; v = -t1                     // [0x48712], [0x4871c]
```
(The projection and the z input of 4230d are computed but unused here.) Then:
```
duCol = ((P1.u-P0.u) << 16) / 1024 ; dvCol = ((P1.v-P0.v) << 16) / 1024     // idiv, toward zero (exact here: = *64)
duRow = ((P2.u-P0.u) << 16) / 1024 ; dvRow = ((P2.v-P0.v) << 16) / 1024
U = 0; V = 0                                 // 16.16
for row in 0..99:
    e = U >> 8; b = V >> 8; se = duCol >> 8; sb = dvCol >> 8    // arithmetic shifts; columns step in 8.8
    p = row*640
    for col in 0..159:
        c = tex[((b >> 8) & 255) * 256 + ((e >> 8) & 255)] >> 1      // fetch BEFORE stepping
        e += se; b += sb
        fb[p] += c; fb[p+1] += c; fb[p+320] += c; fb[p+321] += c      // byte adds (2x2 block)
        p += 2
    U += duRow; V += dvRow
```
Two layers of `tex>>1` give 0..126, which indexes the texture3 palette. Then the panorama is drawn over it.
**[verified]** pixel-exact: complete rows of recording frames 2688+n match this model at t = n-2 or n-1, for n from 70
to 499 (more than 15 frames checked). Some frames contain a tick boundary in the middle of a render: layer 1 at tick t,
layer 2 at t+1. Frame 2790 is exactly (L1 at 100, L2 at 101). A port will not reproduce that, and need not.

## 4. Star engine: drawObject 0x42657 (only caller: credits), with 0x4230d, 0x424ff, 0x4255e, 0x424ac, 0x41f65
**[verified]** I transcribed it to Python and compared it with the original code run in Unicorn. Over 300 consecutive
calls with random angles and positions (including off-screen and clipped cases, and a random frame buffer underneath)
the output was byte-identical. Against the recording, the star pixels at t = 98, 997 and 1297 match 100%.

Static state (asm data object):
* object position [0x42a3b],[0x42a3f],[0x42a43] (set by 0x42a25 = x,y,z from eax,edx,ebx)
* focal [0x4655c] = 280, z bias [0x46560] = 5000, centre [0x46528] = 160, [0x4652a] = 100, clip [0x48665] = 320, [0x48669] = 200
* light base vector words [0x44eee..] = (-30000, 0, 0). Light angles [0x4864d],[0x48651],[0x48655], initial 0, **+2,+5,+7 per call**
* vertex y bias [0x48640] = 0 (never written)
* object: 50 vertices at 0x42a48, 32 bytes each: int32 x,y,z (fixed <<11), u,v (unused), nx,ny,nz (16.16 normal),
  ended by x = 0x7fffffff. 96 faces at 0x4308c, 4 int16 each: v0,v1,v2,pad, ended by 0x7fff. It is a 5-pointed star.
  A port can read these bytes straight from the exe image (data object offset = linear - 0x40000), or embed the arrays.

```python
def s32(x): x &= 0xffffffff; return x - (1<<32) if x & 0x80000000 else x
def s16(x): x &= 0xffff;     return x - (1<<16) if x & 0x8000 else x
def idiv(a, b): q = abs(a)//abs(b); return q if (a >= 0) == (b > 0) else -q   # x86 idiv: toward zero

def rotate(x, y, z, ax, ay, az, pos):          # sub_4230d; x,y,z are int16
    i = az & 0x3ff
    t1 = s32(s32(x*S[i]) + s32(y*C[i])) >> 7
    t2 = s32(s32(x*C[i]) - s32(y*S[i])) >> 7
    i = ax & 0x3ff
    RX = s32(s32(z*S[i]) + s32(t2*C[i])) >> 7          # [0x48712]
    t3 = s32(s32(z*C[i]) - s32(t2*S[i])) >> 7
    i = ay & 0x3ff
    RZ = s32(s32(t1*S[i]) + s32(t3*C[i])) >> 7          # [0x48726]
    if RZ == 0: RZ = 1
    RY = s32(s32(t1*C[i]) - s32(t3*S[i])) >> 7          # [0x4871c]
    den = s32(RZ + pos[2] + 5000)
    n = s32(s32(RX + pos[0]) * 280); sx = s16((idiv(n, den) if den else n) + 160)   # cdq: low 32 bits of the product
    n = s32(s32(RY + pos[1]) * 280); sy = s16((idiv(n, den) if den else n) + 100)
    return RX, RY, RZ, sx, sy

def drawObject(fb, ax, ay, az):               # sub_42657 (eax=ax, edx=ay, ebx=az)
    L = rotate(-30000, 0, 0, light[0], light[1], light[2], pos)
    lx, ly, lz = s16(L[0]), s16(L[1]), s16(L[2])
    light = [light[0]+2, light[1]+5, light[2]+7]
    for each vertex d (int32[8]):
        x = s16(d[0] >> 11); y = s16(s32(d[1] + 0) >> 11); z = s16(d[2] >> 11)
        RX, RY, RZ, sx, sy = rotate(x, y, z, ax, ay, az, pos)
        # 0x424ff: light in object space, UNrotated vertex and normal; 16-bit differences
        sh = s32((s16(lx-x)*d[5]) >> 16) + s32((s16(ly-y)*d[6]) >> 16) + s32((s16(lz-z)*d[7]) >> 16)  # each 64-bit product >>16, low 32
        sh = (-s32(sh)) >> 6
        sh >>= 3
        sh = 30 if sh >= 30 else sh;  sh = 0 if sh <= 0 else sh
        PX[v], PY[v], SH[v], Z[v] = sx, sy, sh + 0xd1, RZ      # colours 209..239
    n = 96; key = [0]*(n+2); idx = [0]*(n+2)                   # key[0], key[n+1] stay 0
    for j, (a, b, c) in enumerate(faces): key[j+1] = s32(Z[a] + Z[b] + Z[c]); idx[j+1] = j
    quicksort(key, idx, 1, n, ebxIn = 5312, top = True)        # 5312 = nz of the last vertex (stale ebx)
    for k in n+1 .. 1 (descending):                            # k = n+1 reads idx[97] = 0, so face 0 is drawn
        f = faces[idx[k]]                                      # one extra time first; harmless, it is redrawn later
        v = [(PX[i], PY[i], SH[i]) for i in f]
        if frontFacing(v): tri(fb, v)

def quicksort(key, idx, lo, hi, ebxIn, top):  # sub_4255e; [0x45550]=lo, [0x45554]=hi, ebx = whatever the caller left
    p = ((ebxIn + hi) & 0xffffffff) >> 1
    pivot = 0 if top else key[p]          # top level: p = (5312+96)>>1 = 2704 -> dword 0x47fb0, static 0, never written
    i, j = lo, hi
    while True:
        while key[i] < pivot: i += 1      # signed compares
        while pivot < key[j]: j -= 1
        if i <= j: swap key[i],key[j]; swap idx[i],idx[j]; i += 1; j -= 1
        if not i <= j: break
    if lo < j: quicksort(key, idx, lo, j, ebxIn = j,  top=False)   # pivot = key[j] (last element)
    if i < hi: quicksort(key, idx, i, hi, ebxIn = hi, top=False)   # pivot = key[hi]

def frontFacing(v):                            # sub_424ac, 16-bit differences
    (x0,y0,_),(x1,y1,_),(x2,y2,_) = v
    return s32(s16(y1-y0)*s16(x2-x1)) - s32(s16(y2-y1)*s16(x1-x0)) < 0

def tri(fb, v):                                # sub_41f65, Gouraud, 16.16 (fractions are always 0 here)
    X = [x<<16]; Y = [y<<16]; Cc = [c<<16] per vertex
    sort by Y with three compare-swaps: (0,1), (1,2), (0,1), swapping x, y and c together, only if strictly greater
    y = Y0>>16; xs = xl = X0; cs = cl = C0; h = (Y2-Y0)>>16; if h == 0: return
    dv(a, b) = idiv(a, b>>16) if b>>16 else a          # NOTE: denominator 0 means no division at all
    dx01=dv(X1-X0,Y1-Y0); dx02=dv(X2-X0,Y2-Y0); dx12=dv(X2-X1,Y2-Y1); likewise dc01, dc02, dc12
    A = Y1-Y0; B = Y2-Y0
    tt = idiv(((A>>16) << 32) | (A & 0xffffffff), B)   # shld bug: equals trunc((y1-y0)*65537/(y2-y0)), not *65536
    xm = s32(((X2-X0)*tt >> 16) + X0); cm = s32(((C2-C0)*tt >> 16) + C0)
    den = s32(xm - X1) >> 16
    dcdx = (idiv(s32(cm - C1), den) if den else s32(cm - C1)) >> 8   # 8.8 colour step
    loop:
        if y >= 200: return
        if y == Y1>>16: dx01 = dx12; xs = X1; dc01 = dc12; cs = C1
        cs += dc01; ea = cs >> 8          # edges are stepped BEFORE use, every row including the first
        cl += dc02; eb = cl >> 8
        xl += dx02; R = xl >> 16
        xs += dx01; Lx = xs >> 16
        w = R - Lx
        if w < 0: w = -w; ea, eb = eb, ea; Lx, R = R, Lx      # ea = colour at the left end
        if not (y < 0 or Lx >= 320 or R <= 0):
            p = y*320 + Lx
            if Lx < 0: k = -Lx; p += k; w -= k; ea = s32(ea + s32(dcdx*k))
            if R > 320: w -= R - 320
            if w > 0:
                a16 = ea & 0xffff
                repeat w: fb[p] = a16 >> 8; a16 = (a16 + (dcdx & 0xffff)) & 0xffff; p += 1   # pixels Lx..R-1
        y += 1; h -= 1; if h == 0: return
```
(All intermediate sums wrap to int32; the code above marks the places where it matters.)

Credits calls `drawObject(fb, 0, -255, rotZ)` after `setObjectPos(1024 + trunc(2048*sin ang), 0, 2048 + trunc(4096*cos ang))`.
The star orbits around the camera axis (x ∈ [-1024, 3072], z ∈ [-2048, 6144], so +5000 keeps it in front) and spins
about z with a speed that oscillates through aSpeed.

## 5. Timeline and recording offset

Recording frame numbers are 0-based video frames of cap.avi (frame/70.086 = seconds).

| event | program | recording |
|---|---|---|
| credits start (title render saw [0x1f777c] > 1200) | credits t = 0 | white appears during frame **1217** (17.364 s; mean brightness 233), full white 1218 |
| fade from white | t = 0..64 (bright = 64-t) | back to normal at frame 1281-1282 |
| wipe-in of the OUTSIDE logo | render k = 1..235 (k ≈ t/2) | about 1260..1680 (18.0..24.0 s) |
| wipe-out | renders from t = 341 | first logo pixels gone around frame 1613 (logo wipe values start at 22); the last logo values (207..235) were revealed late and are erased at wipeOut 207..235, the logo is completely gone at frame ≈ 2060 (offset 845, t ≈ 842) **[verified]** |
| names start moving / tunnel palette fade to pal1 | t = 401 (fade done t ≈ 422) | ≈1620 / 1640 |
| ADEPT visible | t 487..705 | ≈ frames 1706..1924 |
| JOACHIM visible | t 842..1060 | ≈ 2061..2279 |
| JASON visible | t 1197..1415 | ≈ 2416..2634 |
| switch to pigpan | credits t = 1471 | white during frame **2688** (38.353 s); 2688 - 1217 = 1471 ✓ |
| pigpan fade from white | t = 0..64 | normal from frame ≈ 2752 |
| switch to part 3 | pigpan t = 501 | white during frame **3189** (45.501 s); 3189 - 2688 = 501 ✓ |

Offset: the frame captured after tick n of credits shows (because of tearing) the render of tick n-3..n-2. So use
**credits tick n ↔ video frame 1219+n** and **pigpan tick n ↔ video frame 2690+n** (±1). Credits: 1471 ticks = 20.99 s;
pigpan: 501 ticks = 7.15 s.

The offsets were determined from (a) the first white frame of each start (setpal(…,64) happens in the start functions),
(b) exact matches of the star at t = 98 → frame 1317 and t = 997 → frame 2217, (c) exact matches of the names, and (d)
exact matches of the pigpan picture at t = n-2/n-1 → frame 2688+n.

## 6. Checks and open questions

Verified:
* The pigpan picture (both rotozoom layers, the panorama, the palette and the DAC→RGB mapping) is pixel-exact against
  the recording over the whole part.
* The 3D star engine (rotation, projection, lighting, sort, culling, Gouraud filler, clipping) is byte-identical to the
  original code (Unicorn, 300 random calls). Star pixels match the recording 100% at t = 98, 997 and 1297, which also
  confirms the float32 `ang` accumulation, the trig truncation, rotZ/aSpeed and the light angle = render-count × (2,5,7).
* Name order (adept, joachim, jason), name y formula and SIN table: pixel-exact at t = 499, 597..600, 998, 999, 1397, 1398.
* Logo wipe order: the revealed wipe values follow the render counter exactly (value 51 at render 51).
* Tunnel palette fade to pal1: matches palStep = floor((t-401)/3) at the checked frames.
* Part order and lengths: 1471 and 501 frames between the white flashes.

Not verified / open:
* The tunnel picture itself (map, shade, TUNNEL1 files) belongs to reader "core"; I did not render full credits frames.
* The render rate in the recording (≈ 1 render per 2 ticks in credits) is a property of the DOSBox run, not of the code.
  The port has to choose. My recommendation: advance wipeIn, wipeOut and the light angles every second tick to
  reproduce the recording; everything else per tick.
* Static data the engine reads but nothing writes (pivot dword 0x47fb0, key[0], key[97], idx[97], the low words at
  0x486ac/0x486b0/0x486b8...) is 0 in the image, and no code references those addresses, so they are 0 at run time.
