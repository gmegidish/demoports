# B: title.C (part 0) and roomc.C (part 1)

Reader: title-room. Slice: `0x121d0..0x127e0`.

| Address | File | Role |
|---|---|---|
| 0x124e0 | title.C | load (called from init 0x10080) |
| 0x12600 | title.C | free (called from shutdown 0x10210) |
| 0x12620 | title.C | start part 0 (called from main 0x10354, before the main loop) |
| 0x12690 | title.C | render part 0 (main loop table 0x10284[0]) |
| 0x12760 | title.C | tick part 0 (timer table 0x10034[0]) |
| 0x121d0 | roomc.C | load |
| 0x122d0 | roomc.C | free |
| 0x12310 | roomc.C | start part 1 (called from the text part's render, 0x1364e) |
| 0x12390 | roomc.C | render part 1 |
| 0x12470 | roomc.C | tick part 1 |

Also documented here because only roomc.C uses them: the 3D mesh renderer **0x4e611**, its triangle filler **0x4de50**, and the shared 3D transform **0x4230d**, backface test **0x424ac**, camera-offset setter **0x42a25** and trig tables **0x4872e/0x498ae** (these last four are used by other parts too). I checked my reading of the room renderer pixel by pixel against the recording (see section 5).

Conventions: `s16()`/`s32()` mean truncate to 16/32 bits and sign-extend. `>>` on signed values is arithmetic (sar). "DAC" values are 6-bit (0..63). `fb` is the 320x200 byte frame buffer `[0x1f6744]`, which is the same pointer as `[0x1f6ab0]` (init stores the result of 0x11440 there). `rowoff` is `[0x1f6750]` (200 dwords, y*320).

---

## 1. Shared helpers used (interface only, "core" documents them in full)

- **0x104d0 loadFile(name) -> ptr**: reads the whole file into malloc'd memory.
- **0x146b3 malloc(size)**, **0x147b3 free(p)**, **0x1a5f0 memset(p, val=edx, n=ebx)**, **0x10010** aborts if `eax == 0`.
- **0x4177d lbmW(p)** / **0x4178a lbmH(p)**: big-endian words at file offsets 0x14 and 0x16 (BMHD width and height). This works because all the files are `FORM....PBM BMHD....` with the BMHD data at offset 0x14.
- **0x416e3 lbmDecode(dst=eax, file=edx) -> bytes**: finds `"BODY"` by a byte-wise scan from the file start. It decodes ByteRun1 into chunky bytes (PBM) and stops when the next run would exceed w*h. Quirk: control byte 0x80 is **not** a no-op; it means "repeat next byte 129 times". None of my files hit it.
- **0x416aa lbmPalette(dst=eax, file=edx, count=ebx)**: finds `"CMAP"` and copies `count` RGB triplets, each byte `>> 2` (8-bit to 6-bit).
- **0x12010 setPalette(pal=eax, first=edx, count=ebx, bright=ecx, [stack] addR, addG, addB)**, callee pops 12. For each entry i in 0..count-1, it sets DAC index first+i (writing port 0x3c8 every entry) to `clamp(sbyte(pal[3i+k]) + bright + add_k, 0, 63)` for k = R,G,B. The exact clamp is: `v >= 63 → 63; else v <= 0 → 0`. Every call in my slice passes `addR = addG = addB = 0`.
- **0x12100 palApproach(target=eax, out=edx, cur=ebx, step=ecx, [stack] count)**, callee pops 4. For each of the count*3 bytes (unsigned):
  `c=cur[j], g=target[j]; if (c > g) { c -= step; if (c < g) c = g; } else { c += step; if (c > g) c = g; } out[j] = c`
  The result is not accumulated: `out` is recomputed from `cur` on every call.
- **0x10990 tunnelSetTexture(tex)**: copies the 64 KB texture twice into the 128 KB buffer `[0x1f678c]`.
- **0x10a10 tunnelSelect(i)**: `[0x1f6780] = map[i]`, `[0x1f6784] = shd[i]`. Index 0..3 means files TUNNEL1..TUNNEL4, so **index 3 = TUNNEL4.MAP/.SHD**.
- **0x10a00 tunnelSetPos(p)**: `[0x1f6788] = p`.
- **0x4162c tunnelDraw()**: `for i in 0..63999: fb[i] = (tex2x[(pos & 0xffff) + map[i]] + shd[i]) & 0xff`. Here `map` is u16 and `shd` is u8 (bytes above 0x7f act as negative). This is equivalent to `tex[(pos + map[i]) & 0xffff]`.
- **0x415c3 overlay(src=eax, count=edx, dstOff=ebx, add=cl)**: `for i < count: if (src[i] != 0) fb[dstOff+i] = (src[i] + add) & 0xff`.

## 2. title.C (part 0)

### Globals

| Addr | Meaning | Init |
|---|---|---|
| 0x1f7764 | titlepig.lbm file image | load |
| 0x1f7778 | texture2.lbm file image | load |
| 0x1f7774 | titlepig decoded, 320x200 chunky (memset 0 first) | load |
| 0x1f7780 | texture2 decoded, 256x256 chunky | load |
| 0x1f75dc | titlePal: 128 entries x 3 (6-bit), CMAP of titlepig | load |
| 0x1f745c | texPal: 128 entries x 3 (6-bit), CMAP of texture2 | load |
| 0x1f777c | T, title tick counter | BSS 0, set to 0 by start |
| 0x1f776c | fadeIn brightness | BSS 0, set to -64 by start |
| 0x1f7760 | flash brightness | BSS 0, set to 64 by start |
| 0x1f7768 | pos, tunnel texture offset | BSS 0, **not reset by start** |
| 0x52a48 | sub, 7-tick sub-counter | data 0, **not reset by start** |
| 0x1f775c, 0x1f7770 | set to 0 by start, never read | |

### load 0x124e0
1. Load titlepig.lbm and texture2.lbm.
2. Allocate the titlepig buffer (w*h = 64000) and memset it to 0. Allocate the texture2 buffer (65536).
3. Decode both images.
4. Copy 128 CMAP entries from each: titlepig's into 0x1f75dc, texture2's into 0x1f745c.

Only entries 0..127 of each 256-entry CMAP are used. texture2 pixels range from 23 to 110 and the tunnel output stays at 126 or below, so the tunnel uses DAC 0..127. titlepig pixels range from 0 to 95; overlaid with +0x80 they use DAC 128..223.

### free 0x12600
Frees the titlepig file and the decoded titlepig. The texture2 buffers are never freed.

### start 0x12620
```
setPalette(texPal, 0, 128, -64)      // DAC 0..127 all black
setPalette(titlePal, 128, 128, 0)    // DAC 128..255 = title colours
tunnelSetTexture(texture2 decoded)
fadeIn = -64; T = 0; flash = 64; [0x1f775c] = [0x1f7770] = 0
```

### tick 0x12760 (once per vertical retrace)
```
old = T
if (old > 760) {                 // only after the title has appeared
    if (sub >= 3) { flash--; if (flash <= 0) flash = 0; }   // sub is never reset here, so in practice every tick
} else if (sub >= 7) { fadeIn++; sub = 0; }
pos += (old >= 760) ? 0x202 : 0x101   // note: >= here, > above
sub++; T++
```

### render 0x12690
```
if (fadeIn < 0) setPalette(texPal, 0, 128, fadeIn)
tunnelSelect(3); tunnelSetPos(pos); tunnelDraw()
if (T > 760) {
    overlay(titlepigDecoded, 64000, 0, 0x80)
    if (T < 960) { setPalette(texPal, 0, 128, flash); setPalette(titlePal, 128, 128, flash) }
}
if (T > 1200) { [0x1f6754] = 2; credits_start_0x12b00() }
```
Consequences for the port:
- The last fade-in palette set uses **-1**, because the render stops setting the palette as soon as `fadeIn` reaches 0. The tunnel therefore stays one DAC step darker (-1, clamped at 0) until the flash at T=761. The recording confirms this (section 5).
- With flash at 63 or 64, every entry clamps to 63, so the whole screen is white.
- The render changes no state, so the number of renders per tick does not matter.

### Timeline (T = title tick; C = global callback count = T + 16; s = C / 70.086)

| T | C | s | Event |
|---|---|---|---|
| (before) | 1..16 | 0.01-0.23 | Timer already runs the title tick (part index is 0 in BSS). T goes 0→16, pos goes to 0x101*16, sub goes to 2. fadeIn is incremented at C=8 and C=15, but start overwrites it. |
| 0 | 16 | 0.228 | start: DAC 0..127 black. The main loop begins drawing the tunnel. |
| 6, 13, 20, … (T ≡ 6 mod 7) | 22, 29, … | | fadeIn++. Brightness after tick T: `-64 + floor((T+1)/7)` for T ≤ 447. |
| ~250 | 266 | 3.80 | first non-black pixel in the recording (fadeIn -29, texPal max 31) |
| 447 | 463 | 6.61 | fadeIn reaches 0. The palette is left at -1. |
| 760 | 776 | 11.07 | last tick at +0x101. From the next tick, pos advances +0x202 per tick. |
| 761 | 777 | 11.087 | Title (titlepig) appears. Palette flash is 64, the screen is white. |
| 762..825 | 778..841 | | flash = 64 - (T-761), one step per tick, reaching 0 at T=825 (12.00 s) |
| 960 | 976 | 13.93 | Palette writes stop. Palette is final. |
| 1201 | 1217 | 17.364 | render sets part 2 and calls credits start 0x12b00 |

`pos` after C callbacks is `0x101*C` for C ≤ 776, and `0x101*776 + 0x202*(C-776)` after that. Only `pos & 0xffff` is used.

**Port initialisation:** to reproduce the 16 pre-start ticks, set at start `pos = 0x1010` and `sub = 2`, or run 16 ticks of the title tick before calling start.

## 3. roomc.C (part 1: pig sitting in a rotating textured room)

### Globals

| Addr | Meaning | Init |
|---|---|---|
| 0x1f7458 | room.lbm file | load |
| 0x1f7444 | room decoded, 256x256 texture | load |
| 0x1f742c | sitting.lbm file | load |
| 0x1f744c | sitting decoded, 320x200 overlay | load |
| 0x1f7430 | pal2.lbm file (only its CMAP is used) | load |
| 0x1f712c | roomPal: 256 entries; 224..255 overwritten by sitting CMAP (32 entries at 0x1f73cc) | start |
| 0x1f6e2c | pal2: 256 entries (CMAP of pal2.lbm, a 1x1 image) | start |
| 0x1f6b2c | tmpPal: 160 entries, output of palApproach | render |
| 0x1f7450 | fade, white-flash brightness | start: 64 |
| 0x1f7454 | T, room tick | start: 0 |
| 0x1f7448 | t, float32 angle for colour wobble | start: 0.0 |
| 0x1f7438 | rotX for the mesh | load: 0 (constant) |
| 0x1f743c | rotY for the mesh | load: 230 (0xe6), constant |
| 0x1f7440 | rotZ for the mesh | load: 0, +2 per tick, **not reset by start** (only room ticks touch it, so it equals 2*T) |
| 0x1f7434 | incremented while T<64, never read | |

### load 0x121d0
1. Set rotY = 230, rotX = 0, rotZ = 0.
2. Load room.lbm, allocate w*h (65536), decode.
3. Load sitting.lbm, allocate 64000, decode.
4. Load pal2.lbm.

No memset. Both bodies decode completely.

### free 0x122d0
Frees all five pointers.

### start 0x12310
```
lbmPalette(roomPal, room.lbm, 256)
lbmPalette(roomPal + 224*3, sitting.lbm, 32)     // DAC 224..255 = pig colours
lbmPalette(pal2, pal2.lbm, 256)
fade = 64; T = 0
setPalette(roomPal, 0, 256, 64)                  // whole screen white
t = 0.0f
```

### tick 0x12470
```
f = fade
if (T < 64) { f--; if (f <= 0) f = 0; [0x1f7434]++ }
t = (float32)(t + 0.025)        // x87: float32 load, add double 0.025 (0x40426), store float32
T++; rotZ += 2; fade = f
```
Fade after room tick k is `max(0, 64-k)`.

### render 0x12390
```
v = trunc(sin((double)t) * 8.0)   // x87 fsin, fmul double 8.0 (0x4041e), frndint in chop mode (0x14796), fistp
if (v < 0) v = 0                  // v in 0..7; 8 only if sin == 1 exactly
if (T < 96) setPalette(roomPal + 160*3, 160, 96, fade)
palApproach(pal2, tmpPal, roomPal, v, 160)      // colours 0..159 pulled toward the bluish pal2 by v steps
setPalette(tmpPal, 0, 160, fade)
if (T > 780) { [0x1f6754] = 4; text_start_0x134c0(1) }   // the rest of this render still runs
camSetOffset_0x42a25(0, 0, 0)
meshRender_0x4e611(roomTex)       // rotX=0, rotY=230, rotZ=rotZ (read inside from 0x1f7438/3c/40)
overlay(sittingDecoded, 64000, 0, 0xe0)
```
- Sitting pixels range 1..23 and 45..46 (0 is transparent). Adding 0xe0 wraps 45..46 to 13..14, which are room colours. This is faithful to the program.
- The mesh covers every pixel for every rotZ I tried (0, 200, 770, 1200, 1562), so no clear is needed.
- The render changes no state.
- In the recording, the 3D render takes about 2 frames, so the original shows every other tick (section 5). One render per tick is correct for the port.

### Timeline (k = room tick; global C = 3911 + k, ±1; s = C/70.086)

| k | C | s | Event |
|---|---|---|---|
| 0 | 3911 | 55.80 | start (called by the text part, mode 0, when its counter `[0x1fd77c] > 720`). White screen. |
| 1..64 | 3912..3975 | | fade 63→0, one step per tick (white to normal) |
| 96 | 4007 | 57.17 | last write of DAC 160..255 |
| all | | | colours 0..159 wobble with `v = max(0, trunc(8 sin(0.025k)))`: brown-to-blue for t in (0, π), plain room colours for t in (π, 2π), period ≈ 251 ticks |
| 781 | 4692 | 66.95 | render sets part 4 and calls text start(1) (blue water "LOOK OUT FOR THE NINJA"). The white flash of that start is first seen at frame 4693. |

## 4. 3D mesh renderer (0x4e611 and helpers)

### 0x42a25 camSetOffset(ox=eax, oy=edx, oz=ebx)
Stores the three values into the data dwords right after its own `ret`: `[0x42a3b] = ox`, `[0x42a3f] = oy`, `[0x42a43] = oz`. `ecx` is not a parameter. The room passes 0,0,0. Other parts (credits 0x12c54, text 0x13625, landscape 0x13def) pass other values, and the setting persists.

### Trig tables
At init, 0x429b1 subtracts 0x80 from each of the 1024 dwords of both tables. After that:
- `SIN[i] = [0x4872e + 4i] = floor(128*sin(2πi/1024) + 0.5)`
- `NCOS[i] = [0x498ae + 4i] = floor(-128*cos(2πi/1024) + 0.5)`

I checked both formulas against all 1024 entries of mem.bin with no mismatches. 0x429b1 also sets fields 0x4866d..0x4869c, which this renderer does not use.

### 0x4230d transform
Inputs:
- point: words X `[0x4870c]`, Y `[0x48716]`, Z `[0x48720]`
- angles: `[0x4acba]` (a, applied first), `[0x4acb2]` (b), `[0x4acb6]` (c), each `& 0x3ff`

All products are 32-bit imul (the high half is discarded). All shifts are sar.
```
X1 = (X*SIN[a] + Y*NCOS[a]) >> 7          ; Y1 = (X*NCOS[a] - Y*SIN[a]) >> 7
Z1 = (Z*SIN[b] + Y1*NCOS[b]) >> 7         ; W  = (Z*NCOS[b] - Y1*SIN[b]) >> 7
Zp = (X1*SIN[c] + W*NCOS[c]) >> 7; if (Zp == 0) Zp = 1        -> [0x48726]
Yp = (X1*NCOS[c] - W*SIN[c]) >> 7                             -> [0x4871c]
d  = Zp + oz + 5000                       // [0x46560] = 5000
sx = s16( trunc32((Z1 + ox) * 280) / d  + 160 )   -> word [0x4872a]   // [0x4655c]=280, word [0x46528]=160
sy = s16( trunc32((Yp + oy) * 280) / d  + 100 )   -> word [0x4872c]   // word [0x4652a]=100
```
- Division is idiv, truncating toward zero. If `d == 0` the division is skipped and the quotient is the product itself.
- The dividend is the 32-bit product sign-extended (cdq), so the product is truncated to 32 bits before dividing.
- Screen x comes from `Z1`. That is the code's naming; take it literally.

### 0x4e611 meshRender(tex)
Mesh data is in the data object; `mem.bin` offset = linear address.
- **Vertices** at `0x4e878`: 150 records of 32 bytes, ended by a dword `0x7fffffff` at 0x4fb38. Each record is `int32 x, y, z` (fixed point, used as `>>12`), `int32 u, v` (used as `>>16`, range 0..256), then `int32 n[3]`, which this renderer does not use.
- **Faces** at `0x4fb3c`: 192 records of 8 bytes `u16 i0, i1, i2, pad(0)`, ended by `i0 == 0x7fff` at 0x5013c.

```
texBase = tex                                      // self-modifies imm32 at 0x4e5d0
for each vertex i:
    X = s16(x >> 12); Y = s16(y >> 12); Z = s16((z >> 12) - 1200)     // [0x5090e] = -1200
    angles: b = rotX [0x1f7438], c = rotY [0x1f743c], a = rotZ [0x1f7440]
    (sx, sy, Zp) = transform(X, Y, Z)
    SX[i] = sx; SY[i] = sy                      // words at 0x5013e, 0x502ce
    U[i] = s16(u >> 16); V[i] = s16(v >> 16)    // words at 0x5045e, 0x505ee
    S[i] = clamp(((-Zp) >> 4) + 80, -20, 30)    // word at 0x5077e; min(…,30) first, then max(…,-20)
for each face (in list order, no depth sort, no z-buffer):
    load vertex slots P0, P1, P2 from i0, i1, i2. Each slot field is a dword
    whose high word is the value and whose low word is 0 (16.16 fixed point):
        x = SX<<16, y = SY<<16, s = S<<16, u = U<<16, v = V<<16
    cross = s16(x2-x1)*s16(y1-y0) - s16(y2-y1)*s16(x1-x0)   // 16-bit integer parts
    if (cross >= 0) fillTriangle()                          // cross < 0 → culled (0x424ac)
    xor byte [0x4e877], 1                                   // a flag nobody reads
```
Slot layout (base 0x486ac, stride 0x18): +0 x, +4 y, +8 unused, +0xc s, +0x10 u, +0x14 v. The low words start as 0 and are never written; the dwords are only swapped between slots. A port can therefore use integers << 16.

### 0x4de50 fillTriangle (textured, linear shade, affine)
Clip limits: width `[0x50927] = 320`, height `[0x5092b] = 200`.
```
sort slots by y (signed dword): if y0>y1 swap(0,1); if y1>y2 swap(1,2); if y0>y1 swap(0,1)
         (each swap moves x, y, u, v, s)
if (int(y0) > 200) return; if (int(y2) < 0) return            // int() = high word, signed
if (int(x0) > 320 && int(x1) > 320 && int(x2) > 320) return
if (int(x0) < 0 && int(x1) < 0 && int(x2) < 0) return
cy = y0 >> 16
A = {x,u,v,s} of P0; B = same
H = (y2 - y0) >> 16; if (H == 0) return; count = H (16-bit)
h01 = (y1 - y0) >> 16
dA.k = h01 ? (P1.k - P0.k) / h01 : (P1.k - P0.k)             // k in x,u,v,s; idiv
dB.k = (P2.k - P0.k) / H
// horizontal gradients, constant for the whole triangle:
q = idiv( ((y1-y0) >> 16) * 2^32 + (y1-y0),  (y2-y0) )   // the code's cdq/shld quirk: = trunc(dy01*65537/dy02)
M.k = (((P2.k - P0.k) * q) >> 16, low 32 bits) + P0.k     // 64-bit imul then shrd 16
for k in u, v, s:
    e = M.k - P1.k; w = M.x - P1.x; if (w < 0) { w = -w; e = -e }
    w >>= 16; if (w) e = idiv(e, w)
    g_k = (e >> 8) & 0xffff          // 16-bit 8.8 step, patched into the add imm16 at 0x4e5cc/0x4e5d7/0x4e5e0 (+0x4e5ef/0x4e5ea/0x4e5f4)
loop {
    if (cy == y1 >> 16) { A = P1's x,u,v,s; h12 = (y2-y1)>>16; dA.k = h12 ? (P2.k-P1.k)/h12 : (P2.k-P1.k) }
    if (cy >= 200) return
    A += dA; B += dB                 // added BEFORE drawing, so the first span uses P0 + one step
    if (cy >= 0) {
        XL = A.x >> 16; XR = B.x >> 16; L = A; R = B
        if (XL > XR) swap (XL,L) with (XR,R)
        n = XR - XL
        if (n > 0 && XR > 0) {
            if (XR >= 320) n -= XR - 320
            if (XL < 320) {
                Uc = (L.u >> 8) & 0xffff; Vc = (L.v >> 8) & 0xffff; Sc = (L.s >> 8) & 0xffff
                p = rowoff[cy] + XL
                if (XL < 0) { k = -XL; p += k; n -= k; Uc += k*g_u; Vc += k*g_v; Sc += k*g_s (all mod 2^16) }
                repeat n times {
                    fb[p++] = (tex[(Vc >> 8)*256 + (Uc >> 8)] + (Sc >> 8)) & 0xff
                    Uc = (Uc + g_u) & 0xffff; Vc = (Vc + g_v) & 0xffff; Sc = (Sc + g_s) & 0xffff
                }
            }
        }
    }
    cy++; if (--count == 0) return     // 16-bit counter
}
```
Notes:
- u and v wrap modulo 256. Vertex u/v = 256 equals 0.
- The shade is the integer high byte of the 8.8 value Sc, added with byte wrap to the texel index. Room texel 16..127 plus shade -20..30 can wrap to 252..255, which are pig colours. This is faithful to the program.
- Integer divisions are all idiv, truncating toward zero.

## 5. Recording offset and checks

**Global clock.** The MIDAS timer is installed in sound init (0x10690). That is just before the video mode is set (0x10b90 mode 10 = BIOS mode 0x13; this happens after the data is loaded, not before). From then on, callback 0x10060 runs the current part's tick, and the part index is 0 in BSS. Recording frame n coincides with callback count C = n:
- The **palette** state after callback C becomes visible part-way down frame C.
- **Pixels** may lag by one tick (or two in the room) because the frame buffer is blitted after the render.

How I determined this:
1. I wrote a Python re-implementation of the tunnel (TUNNEL4 + texture2 + texPal, DAC 6→8-bit conversion `round(v*255/63)`, which is DOSBox's). Searching all 65536 texture offsets, frame 699 matches **exactly** (100% of pixels) at offset 48571, and frame 701 at 48571 + 0x202. Since `48571 = 0x101*699 mod 65536`, pos = 0x101 * frame number. So 16 ticks ran before start (C = T + 16), and frame n shows C = n.
2. The white flash, which must be T=761, starts on line ~33 of **frame 777** (777 = 761 + 16). Frame 778 is all white. In frame 779, the rows below the line are already at flash 62. For frames 776..795 the best-matching flash value equals `64 - (C - 777)`, with pixel content from C-1.
3. During the fade-in, frames 395..424 give the best brightness `-64 + #{x in 17..n : x % 7 == 1}` exactly, and the switches fall on the predicted frames (±a partial frame). This confirms sub = 2 at start and the T ≡ 6 (mod 7) step.
4. Frames 700..776 match brightness -1, not 0, which confirms the "last set is -1" quirk.
5. Title to credits: the title image is matched exactly up to frame 1216 (C=1215 pixels). Frame 1217 is the first credits frame, as predicted by T = 1201 → C = 1217.
6. Room: my Python port of 0x4e611/0x4de50/0x4230d (mesh data, trig tables, palApproach, sitting overlay) reproduces **frame 4300 exactly**: rows 0..120 match room tick k=385 at 100% and rows 121..199 match k=387 at 100%. The room renders every ~2 frames, so frames tear between two renders. For frames 3919..3972 the top rows match 100% with palette tick kp = n - 3912 and pixel tick kp - 2 (v goes from 1 to 7 over that range, so palApproach is confirmed too). The room start's white write lands at line ~110 of frame 3911, and the next part's white lands at frame 4693. That puts room start at C ≈ 3911 (±1) and room end at C = 3911 + 781 = 4692.

**Part order** (from all writes of `[0x1f6754]`):
`0 title` (C 16) → (T>1200) `2 credits` start 0x12b00 (C 1217) → (`[0x1f80a8] > 1470`) `5 pigpan` start 0x13030 → (`[0x1f841c] > 500`) `3 text` start 0x134c0(0) ("MADE AT THE GATHERING 97") → (mode 0 and `[0x1fd77c] > 720`) `1 room` start 0x12310 (C ≈ 3911) → (T>780) `4 text` start 0x134c0(1) ("LOOK OUT FOR THE NINJA 3(D)", C ≈ 4692) → (mode 1 and `[0x1fd77c] > 1200`) `6 logo` start 0x13ad0(0) (melon pigs) → (`[0x1fdad8]==0` and `[0x1fdac0] > 500`) `7 landscape` start 0x13de0 → (`[0x1fe438] > 800`) `6 logo` start 0x13ad0(1) ("MACK AND WALT… / CALL US… / THE END"; no further switch is visible, it runs until ESC). The other readers own the thresholds after the room.

**Renders per tick:** neither part mutates state in its render, so "one tick, then one render" per 70 Hz frame is correct for both.

**Open questions**
- The room start is ±1 tick, because of the 2-frame render pace in both the text part and the room. The text part's own counter should pin it: room start = text start + 721 ticks.
- `[0x1f7434]` and the `[0x4e877]` toggle are written but never read.
- The texture2 file and decoded buffers leak (not freed). This has no effect.
