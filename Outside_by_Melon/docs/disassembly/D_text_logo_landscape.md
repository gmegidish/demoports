# D: text.C, logo.C, landscape.C (parts 3, 4, 6, 7) and the 3D object engine 0x52a4c..0x530d6

Reader: text-logo-land. Slice: 0x13230..0x140c3, plus the asm 3D-object wrappers at 0x52a4c..0x530d6, which only these parts call (checked by scanning the whole image for `call rel32` to them).

## 0. Part order and what runs forever

| part idx | start function | render | tick | what is on screen |
|---|---|---|---|---|
| 5 (pigpan) | | 0x13090 | 0x13100 | when `[0x1f841c] > 500`: sets idx 3, calls `text_start(0)` |
| **3** | `0x134c0(0)` | 0x135b0 | 0x13720 | orange tunnel (TUNNEL2, texture5), two 3D "melon" sign objects, text1 wiped in ("MADE AT THE GATHERING '97 / TAKE A LOOK... AT THIS !!") |
| 1 (room) | 0x12310 | 0x12390 | 0x12470 | text v0 switches to it when its counter > 720; the room switches back with idx 4 and `text_start(1)` when `[0x1f7454] > 780` |
| **4** | `0x134c0(1)` | 0x135b0 | 0x13720 | blue tunnel (TUNNEL3, texture6), the same 3D signs, text2 wiped in and then wiped out ("LOOK OUT FOR THE NINJA 3(D) / FLY IN THE SKY...") |
| **6 (v0)** | `0x13ad0(0)` | 0x13b70 | 0x13d00 | ENDPIGS.LBM, static (the pigs in an oval) |
| **7** | `0x13de0` | 0x13e90 | 0x140b0 | landscape: scrolling clouds, ground, 3D terrain mesh, 3D flying pig, palette pulsing towards PAL3 |
| **6 (v1)** | `0x13ad0(1)` | 0x13b70 | 0x13d00 | MELON.LBM backdrop. text3 ("MACK AND WALT: ...") is wiped in, held, wiped out, then text4 ("CALL US TO GET IT BACK! NEW NUMBER!!") the same way, then text5 ("THE END" + the "Stolen" logo) is wiped in **and never removed. This is the final state, kept until ESC.** |

Chain: 5 -> 3 -> 1 -> 4 -> 6(v0) -> 7 -> 6(v1) -> forever.

- **THE END:** text5.lbm (the overlay) over melon.lbm (the background). It is drawn by part 6 v1 (logo.C render 0x13b70) in state 1 with `k = 2`. The wipe-out branch needs `k < 2`, so it never runs again. Every later render does the same three things, giving an identical frame each time: memcpy melon, leave the overlay alone, blit the overlay. The palette is written only while `[0x1fdac0] < 0x60`.
- **Static in the recording:** the last pixel change is at frame 10168 (145.08 s). From there to the end of the file (frame 19051, 271.8 s) every frame is byte-identical. The briefing's "about 2:15" is really 2:25.

Every part switch happens **inside a render function**. The old render goes on to finish its frame, and the new part's start function has already reprogrammed the palette. Consequences that show in the recording:
- **Switches into a part with a white fade-in** (text, logo, room): the last frame of the old part shows up white, because bias 64 is applied to every DAC entry.
- **logo v0 -> landscape** (`0x13de0` loads the clouds palette with bias 0): the render returns right after the switch, so the endpigs picture is shown for one frame in the **clouds palette**. Recording frame 6395 shows the pigs in purple/blue tones. This is authentic and should be reproduced.

## 1. Shared helpers used (interfaces only; reader "core" documents them in full)

Watcom register convention: args in eax, edx, ebx, ecx, then stack. Each "asm" routine saves all registers (pushal/pushfd).

| addr | name | interface |
|---|---|---|
| 0x104d0 | `load_file(eax=name)` | malloc + read the whole file; returns the buffer (ebx/edx = line / source name, used only by asserts) |
| 0x10010 | `check_alloc(eax)` | exits with "Couldn't allocate a memory-block" when eax == 0 |
| 0x146b3 / 0x147b3 | malloc / free | |
| 0x1a5f0 | `memset(eax=dst, edx=byte, ebx=count)` | |
| 0x4177d / 0x4178a | `lbm_w(file)` / `lbm_h(file)` | big-endian words at file+0x14 and file+0x16 (assumes BMHD is the first chunk, which is true for every file here) |
| 0x416e3 | `lbm_body(eax=dst, edx=file)` | finds the first "BODY" by a byte scan from the file start, skips 8 bytes, ByteRun1-decodes w*h bytes. Chunky PBM: one byte per pixel. Control byte n: 0..127 copies n+1 bytes; 128..255 repeats the next byte 257-n times (0x80 gives 129). **A run that would exceed the remaining count stops decoding without being written.** Every file here decodes to exactly w*h. |
| 0x416aa | `lbm_cmap(eax=dst, edx=file, ebx=count)` | finds the first "CMAP", skips 8, writes `count*3` bytes, each `byte >> 2` (8-bit to 6-bit DAC) |
| 0x12010 | `set_dac(eax=pal, edx=first, ebx=count, ecx=bias, stack: addR, addG, addB)` | for each entry, each component: `v = (int8)pal[c] + add_c + bias`; if `v >= 63` then 63, else if `v <= 0` then 0; written to the DAC starting at index `first`. In this slice it is always called with adds 0, first 0, count 256, so a bias of 64 gives an all-white palette. `ret 0xc`. |
| 0x12100 | `pal_approach(eax=target, edx=out, ebx=src, ecx=step, stack: count)` | per component (unsigned bytes): if `src > tgt`: `v = src - step`, and `v = tgt` if `v < tgt`; else `v = src + step`, and `v = tgt` if `v > tgt`. Writes `out`; src is not modified. `ret 4`. |
| 0x120d0 | `set_border(al)` | int 10h AX=1001h, BH=al (overscan colour) |
| 0x10990 | `tunnel_texture(eax=pix)` | copies the 65536-byte texture twice into `[0x1f678c]` (a 128 KB buffer) |
| 0x10a10 | `tunnel_select(eax=n)` | `[0x1f6780] = [0x1f6760+4n]` (map), `[0x1f6784] = [0x1f6770+4n]` (shade). n=1: tunnel2.map/.shd, n=2: tunnel3.map/.shd (load order in 0x107d0) |
| 0x10a00 | `tunnel_offset(eax)` | `[0x1f6788] = eax` |
| 0x4162c | `tunnel_draw()` | for i in 0..63999: `fb[i] = (tex[(off & 0xffff) + map16[i]] + shade8[i]) & 0xff`, with tex = 128 KB double copy, off = `[0x1f6788]`, fb = `[0x1f6744]` |
| 0x41575 | `wipe_copy(eax=mask, edx=dst, ebx=src, cl=thr)` | for i in 0..63999: if `mask[i] == thr` then `dst[i] = src[i]` (zeros copied too) |
| 0x41590 | `wipe_clear(eax=mask, edx=dst, bl=thr)` | for i in 0..63999: if `mask[i] == thr` then `dst[i] = 0` |
| 0x415c3 | `blit_nz(eax=src, edx=count, ebx=dstoff, cl=add)` | for i < count: `p = src[i]`; if `p != 0` then `fb[dstoff+i] = (p + cl) & 0xff`. Always called here with (overlay, 64000, 0, 0). |
| 0x42a25 | `proj_offset(eax=X, edx=Y, ebx=Z)` | stores to `[0x42a3b]`, `[0x42a3f]`, `[0x42a43]` (dwords), which are added in projection |
| 0x4230d | `xform()` (core) | see section 5.1 |
| 0x424ff | `light()` (core) | see section 5.1 |
| 0x424ac | `backface()` (core) | see section 5.1 |
| 0x41f65 | `gouraud_tri()` (core) | draws one triangle from (x, y, colour) words at 0x486ae/0x486b2/0x486ba, 0x486c6/0x486ca/0x486d2, 0x486de/0x486e2/0x486ea, into `[0x4869c]` (= fb, set by 0x429b1) with the clip rect at 0x4866d.. |
| 0x4b4a8 | `wait_retrace_start()` | spins while port 0x3DA bit 3 is set, then until it is set |
| 0x14796 | `__CHP` | x87 round with RC = truncate. Every `fistp` that follows it is a **truncation toward zero**. |

`fb` is always `[0x1f6744]`, the frame-buffer pointer cached at init (equal to `[0x1f6ab0]`). 0x114d0 copies it to the screen after every render.

## 2. text.C (parts 3 and 4)

### 2.1 Globals (all BSS, initial value 0)

| addr | meaning |
|---|---|
| 0x1fd778 / 0x1fd748 | texture5.lbm file / 256x256 pixels |
| 0x1fd76c / 0x1fd760 | texture6.lbm file / 256x256 pixels |
| 0x1fd780 / 0x1fd758 | wipe1.lbm file / 320x200 pixels (wipe mask) |
| 0x1fd794 / 0x1fd78c | text1.lbm file / 320x200 pixels |
| 0x1fd768 / 0x1fd784 | text2.lbm file / 320x200 pixels |
| 0x1fd744 | **overlay buffer**, 64000 bytes, zeroed at load. Also used by logo.C. |
| 0x1fd424 | palette, 256*3 bytes (6-bit) |
| 0x1fd728 | variant (0 = part 3, 1 = part 4) |
| 0x1fd738 | fade bias: 64 at start, decremented per tick |
| 0x1fd77c | tick counter (reset at start) |
| 0x1fd770 | **render counter** = wipe-in threshold (reset at start, ++ per render) |
| 0x1f0df0 | wipe-out threshold (part 4; reset at start, ++ per render once the wipe-in is done) |
| 0x1fd724 | float32 angle a; += 0.05 per tick; **not reset at start** (part 4 continues from part 3's value) |
| 0x1fd764 | tunnel offset; += 0x101 per tick; **not reset** |
| 0x1fd790 / 0x1fd788 / 0x1fd740 | 3D object angles (1024 units per turn): += 7, += 3, constant 0 per tick; all reset at start |
| 0x1fd75c, 0x1fd774, 0x1f0bdc, 0x1fd750 | "aSpeed" machinery: every 6 ticks the index 0x1fd774 is incremented (wrapping when > 0x83), and `[0x1fd750] += 2*aSpeed[idx]` every tick. **0x1fd750 is never read, so all of this is dead.** |
| 0x1fd72c, 0x1fd73c, 0x1fd734, 0x1fd730, 0x1f0dec | written only (dead) |

### 2.2 `text_load` 0x13230 (called from init)
1. Load and decode, in order: texture5, texture6, wipe1, text1, text2. Each pixel buffer is `malloc(w*h)` followed by `lbm_body`.
2. `[0x1fd744] = malloc(64000)`, then memset 0.

`text_free` 0x13450 frees all 11 buffers.

### 2.3 `text_start(v)` 0x134c0
```
[0x1fd73c]=[0x1fd734]=0
if v==0: tunnel_select(1); tunnel_texture(texture5.pix); lbm_cmap(0x1fd424, texture5.file, 256)
else:    tunnel_select(2); tunnel_texture(texture6.pix); lbm_cmap(0x1fd424, text2.file, 256)   // NB: the palette comes from TEXT2.LBM
[0x1fd728]=v; [0x1fd738]=64
zero: 0x1f0dec 0x1fd77c 0x1fd72c 0x1fd75c 0x1fd730 0x1fd770 0x1f0df0 0x1fd788 0x1fd790 0x1fd740
memset(overlay, 0, 64000)
set_dac(0x1fd424, 0, 256, bias=64)            // all white
```

### 2.4 `text_render` 0x135b0
```
if counter([0x1fd77c]) < 0x60: set_dac(0x1fd424, 0, 256, bias=[0x1fd738])
tunnel_draw()                                    // uses the offset set at the END of the previous render
                                                 // (the first render of part 3 uses whatever offset the previous part left)
a = float32 [0x1fd724]
cz = trunc(cos(a) * 4096.0)   ; sx = trunc(sin(a) * 2048.0)   // x87 fcos/fsin on the float, then __CHP + fistp
proj_offset(X = sx + 0x400, Y = 0, Z = cz + 0x800)
draw_text_objects()                              // 0x52dbd, section 5.3
if v == 0:
    if counter > 720: [0x1f6754]=1; room_start()  // 0x12310; this frame is still finished below
    if [0x1fd770] < 256: wipe_copy(wipe1, overlay, text1, thr=[0x1fd770]&0xff)
else:
    if [0x1fd770] < 256: wipe_copy(wipe1, overlay, text2, thr=[0x1fd770]&0xff)
    else: wipe_clear(wipe1, overlay, thr=[0x1f0df0]&0xff); [0x1f0df0]++
    if counter > 1200: [0x1f6754]=6; logo_start(0)
blit_nz(overlay, 64000, 0, 0)
[0x1fd770]++
tunnel_offset([0x1fd764])
```
Note that the v0 path never wipes the text out; the part ends with the text fully shown (wipe1 values under text1 pixels run from 15 to 235).

### 2.5 `text_tick` 0x13720
```
[0x1fd750] += 2*aSpeed[[0x1fd774]]            // dead
if counter < 0x40: [0x1fd738] = max([0x1fd738]-1, 0); [0x1fd72c]++
if [0x1fd75c] > 5: [0x1fd75c]=0; [0x1fd774]++; if [0x1fd774] > 0x83 (unsigned): [0x1fd774]=0   // dead
[0x1fd724] = float32([0x1fd724] + 0.05)        // double constant 0x40649, added in x87 then stored as float32
counter++; [0x1fd75c]++; [0x1fd788]+=3; [0x1fd790]+=7; [0x1fd764]+=0x101
```
Fade: the bias after tick k is `max(64-k, 0)`. The DAC is rewritten by the render while the counter is < 96.

## 3. logo.C (part 6, both variants)

### 3.1 Globals (BSS, 0)
| addr | meaning |
|---|---|
| 0x1fdac8 / 0x1fdae0 | endpigs.lbm file / pixels |
| 0x1fdaa8 / 0x1fdac4 | melon.lbm file / pixels |
| 0x1fdae4, 0x1fdae8, 0x1fdaec / 0x1fdacc, 0x1fdad0, 0x1fdad4 | text3, text4, text5 files / pixels (arrays indexed by k) |
| 0x1fda9c / 0x1fdab4 | wipe4.lbm file / pixels (wipe-in mask) |
| 0x1fdaa4 / 0x1fdaa0 | wipe2.lbm file / pixels (wipe-out mask). Not freed by 0x13a70. |
| 0x1fd79c | palette 256*3 |
| 0x1fdabc | fade bias (64 at start) |
| 0x1fdac0 | tick counter |
| 0x1fdad8 | variant |
| 0x1fdaac | k, the text index 0..2 |
| 0x1fdab8 | wipe-in threshold (++ per render in state 0) |
| 0x1fdadc | wipe-out threshold (++ per render) |
| 0x1f0dfc | state 0 = wiping in, 1 = holding/wiping out. **Not reset by start** (initial 0; v1 runs once and v0 never touches it). |
| 0x1f0df8 | hold timer, ++ per tick while state == 1. **Not reset by start** (initial 0). |
| 0x1fdab0 | ++ per tick during the fade; dead |

### 3.2 `logo_load` 0x13830
Loads endpigs, melon, text3, text4, text5, wipe4 and wipe2, and decodes each into `malloc(w*h)` (all are 320x200).

`logo_free` 0x13a70 frees all of them except the wipe2 buffers.

### 3.3 `logo_start(v)` 0x13ad0
```
lbm_cmap(0x1fd79c, v==0 ? endpigs.file : melon.file, 256)
[0x1fdabc]=64; [0x1fdac0]=0
set_dac(0x1fd79c, 0, 256, bias=64)       // white
set_border(0)
[0x1fdad8]=v; [0x1fdaac]=0; [0x1fdadc]=0; [0x1fdab8]=0
memset(overlay [0x1fd744], 0, 64000)
```

### 3.4 `logo_render` 0x13b70
```
wait_retrace_start()                      // only render in this slice that syncs to the display
if [0x1fdac0] < 0x60: set_dac(0x1fd79c, 0, 256, bias=[0x1fdabc])
if v == 0:
    memcpy(fb, endpigs.pix, 64000)
    if [0x1fdac0] > 500: [0x1f6754]=7; landscape_start()   // palette -> clouds; this frame still shows the pigs
    return                                // no overlay in v0
memcpy(fb, melon.pix, 64000)
if state == 0:
    wipe_copy(wipe4, overlay, text[k], thr=[0x1fdab8]&0xff)
    [0x1fdadc]=0; [0x1fdab8]++
    if [0x1fdab8] >= 256: state=1
elif state == 1:
    if [0x1f0df8] > 300 and k < 2:
        wipe_clear(wipe2, overlay, thr=[0x1fdadc]&0xff); [0x1fdadc]++
        if [0x1fdadc] >= 256: [0x1fdab8]=0; [0x1fdadc]=0; [0x1f0df8]=0; k++; state=0
blit_nz(overlay, 64000, 0, 0)
```

### 3.5 `logo_tick` 0x13d00
```
if state == 1: [0x1f0df8]++
if [0x1fdac0] < 0x40: [0x1fdabc] = max([0x1fdabc]-1, 0); [0x1fdab0]++
[0x1fdac0]++
```

## 4. landscape.C (part 7)

### 4.1 Globals (BSS, 0)
| addr | meaning |
|---|---|
| 0x1fe404 / 0x1fe40c | clouds.lbm file / pixels, **576x110** |
| 0x1fe400 | pal3.bbm file (1x1 image; only its CMAP is used) |
| 0x1fe0f0 | clouds palette (6-bit) |
| 0x1fddf0 | pal3 palette (6-bit) |
| 0x1fdaf0 | blended output palette |
| 0x1fe3f0 | float32 t, += 0.025 per tick, not reset (starts at 0; the part runs once) |
| 0x1fe408 | sky scroll, ++ per tick |
| 0x1fe438 | tick counter |
| 0x1fe430 | a, += 0x50 per tick |
| 0x1fe43c | b, += 0x5a per tick |
| 0x1fe428 | angle Z of terrain and pig, += 5 per tick |
| 0x1fe434 | light angle, += 5 per tick, not reset (starts at 0) |
| 0x1fe410 | angle X of terrain and pig (computed per render; 0x28 at start, overwritten before use) |
| 0x1fe418 | angle Y, constant -290 (0xfffffede), i.e. 734 & 0x3ff |
| 0x1fe41c, 0x1fe414 | pig extra angles, 0 |
| 0x1fe420 | pig extra Z angle (per render) |
| 0x1fe3fc, 0x1fe3f4, 0x1fe3f8 | pig projection offset X, Y, Z (per render) |
| 0x1fe424, 0x1fe42c | light angles, never written (0) |

### 4.2 Load, free and start
- `landscape_load` 0x13d40: load clouds.lbm and decode its pixels (576*110 = 63360 bytes); load pal3.bbm.
- `landscape_free` 0x13dd0 is just `ret`.

`landscape_start` 0x13de0:
```
proj_offset(0,0,0)
[0x1fe410]=0x28; [0x1fe428]=[0x1fe414]=[0x1fe41c]=[0x1fe420]=[0x1fe3fc]=[0x1fe3f4]=[0x1fe3f8]=0; [0x1fe418]=-290
lbm_cmap(0x1fe0f0, clouds.file, 256); lbm_cmap(0x1fddf0, pal3.file, 256)
set_dac(0x1fe0f0, 0, 256, bias=0)        // no white flash here
[0x1fe438]=[0x1fe408]=[0x1fe430]=[0x1fe43c]=0
```

### 4.3 `landscape_render` 0x13e90
`T[k]` is the dword table at 0x1f8424, built by 0x13140 at init (core):
`T[k] = trunc(sin(theta_k) * 65536)` for k = 0..5119, where `theta_k` is accumulated in the x87 by repeated addition of 0.001533203125 (≈ 2π/4098). `T[k+1024]` (the table at 0x1f9424) acts as a cosine.

`tdiv(x, n)` is C integer division truncating toward zero. The compiler emits `sar` with sign fix-up: `(x + (x<0 ? n-1 : 0)) >> log2 n`.
```
step = trunc(sin(float32 t) * 16.0); if step < 0: step = 0
pal_approach(target=pal3, out=0x1fdaf0, src=clouds_pal, step, 256)
set_dac(0x1fdaf0, 0, 256, bias=0)                          // every render
if [0x1fe438] > 800: [0x1f6754]=6; logo_start(1)           // white palette; this frame is still drawn
for row in 0..95: memcpy(fb + row*320, clouds.pix + [0x1fe408] + row*576, 320)
       // linear addressing: past column 575 it reads the start of the next row (scroll reaches ~801, max index 55840 < 63360)
memset(fb + 96*320, 0x32, 104*320)                         // ground rows 96..199
i = tdiv(a,16) & 0xfff                ; a = [0x1fe430]
[0x1fe3fc] = tdiv(T[i]*150, 4096)     // pig X offset
[0x1fe3f8] = tdiv(T[i+1024]*150, 4096)// pig Z offset
j = tdiv(tdiv(a,2),16) & 0xfff
[0x1fe3f4] = tdiv(T[j]*50, 4096)      // pig Y offset
[0x1fe420] = tdiv(-(T[i]*40), 4096)   // pig extra Z angle
k = tdiv(b,16) & 0xfff                ; b = [0x1fe43c]
[0x1fe410] = tdiv(T[k]*60, 65536)     // X angle
draw_terrain()   // 0x52f12
draw_pig()       // 0x53024
```

### 4.4 `landscape_tick` 0x140b0
```
[0x1fe3f0] = float32(t + 0.025)    // double constant 0x40702
[0x1fe43c]+=0x5a; [0x1fe408]+=1; [0x1fe428]+=5; [0x1fe434]+=5; [0x1fe430]+=0x50; [0x1fe438]+=1
```
The listing mis-decodes 0x140c3..0x140d3. The correct bytes are `mov ebx,[0x1fe408]` at 0x140c7 and `fadd qword [0x40702]` at 0x140cd.

## 5. The 3D object engine (0x52a4c..0x530d6, used only by this slice)

Core owns the transform, lighting, backface and triangle routines (0x4230d, 0x424ff, 0x424ac, 0x41f65). Everything below them is in this slice.

### 5.1 What I rely on from core (my reading; core is authoritative)
- **Angle tables** (1024 entries, dwords). After init 0x429b1 subtracts 128: `S[n] = [0x4872e+4n]` ≈ round(128 sin(2πn/1024)) and `C[n] = [0x498ae+4n]` ≈ -round(128 cos(2πn/1024)) (C[0] = -128, C[256] = 0). Take them from mem.bin and subtract 128.
- **`xform`** 0x4230d. Inputs: words x=[0x4870c], y=[0x48716], z=[0x48720]; angles (dwords, `&0x3ff`) A=[0x4acb2], B=[0x4acb6], G=[0x4acba]. Each `>>7` below is an arithmetic shift of the low 32 bits of the product.
  ```
  p = (x*S[G] + y*C[G])>>7 ;  q = (x*C[G] - y*S[G])>>7
  X = (z*S[A] + q*C[A])>>7 ;  r = (z*C[A] - q*S[A])>>7
  Z = (p*S[B] + r*C[B])>>7 ;  if Z==0: Z=1 ;  Y = (p*C[B] - r*S[B])>>7
  sx = (int16)( idiv((X+[0x42a3b])*280, Z+[0x42a43]+5000) + 160 )   // idiv truncates; skipped when the divisor is 0
  sy = (int16)( idiv((Y+[0x42a3f])*280, Z+[0x42a43]+5000) + 100 )
  ```
  Outputs: X=[0x48712], Y=[0x4871c], Z=[0x48726] (dwords); sx=[0x4872a], sy=[0x4872c] (words). The constants 280/5000/160/100 are at 0x4655c/0x46560/0x46528/0x4652a. With all angles 0 the transform is the identity (apart from forcing Z=1).
- **`light`** 0x424ff. L = words [0x44ee8], [0x44eea], [0x44eec]; v = the input words above; n = dwords [0x48634], [0x48638], [0x4863c].
  `d = Σ_c ( (int64)(int16)(L_c - v_c) * n_c ) >> 16` (each term truncated to 32 bits, using shrd), then `eax = (-d) >> 6` (arithmetic shift).
- **`backface`** 0x424ac: `cross = (x2-x1)*(y1-y0) - (x1-x0)*(y2-y1)`, with 16-bit differences sign-extended. It returns dl=1 (cull) when cross < 0.
- **`gouraud_tri`** 0x41f65: draws the triangle in the 8-bit colour of each vertex (word, low byte).

### 5.2 Object data (in the image, data object)
Each object is a vertex list followed directly by its face list. All four are contiguous: 0x530d7..0x6578f.

- **Vertex**: 32 bytes. Fields: +0 x, +4 y, +8 z (int32, 20.12 fixed point; `>>12` arithmetic gives units); +0x0c and +0x10 are 0 and unused; +0x14, +0x18, +0x1c normal nx, ny, nz (int32, unit = 65536). The list ends with a dword 0x7fffffff at +0.
- **Face**: 8 bytes. Fields: word v0, v1, v2 (vertex indices within the object), word 0. The list ends with the word 0x7fff.

| name | vertices | faces | verts / faces | extent (units) | used by |
|---|---|---|---|---|---|
| signB | 0x530d7 | 0x5631b | 402 / 546 | x ±1731, y ±540, z ±80 | text, second object |
| signA | 0x5742d | 0x5a631 | 400 / 530 | x ±1731, y ±540, z ±80 | text, first object |
| terrain | 0x5b6c3 | 0x617a7 | 775 / 1440 | x ±3462, y ±3392, z ±630 | landscape |
| pig | 0x644a9 | 0x6514d | 101 / 200 | x ±664, y ±534, z ±449 | landscape |

### 5.3 Engine state (data object; initial values from mem.bin)
| addr | meaning |
|---|---|
| 0x65790 / 0x65794 | current vertex list / face list pointer |
| 0x65798 | base colour (word) |
| 0x6579a / 0x6579e / 0x657a2 | object-space offset added to x / y / z after `>>12` |
| 0x6578f | depth-cue flag (byte) |
| 0x1ee899 / 0x1ee89d | shade max / shade min |
| 0x657a6 | **B**: running vertex base in bytes (= 2 × vertices already processed in this batch); reset to 0 by `draw_list` |
| 0x657aa, 0x657ae, 0x657b2 | bookkeeping, dead |
| 0x657da + 2s, 0x6677a + 2s, 0x6771a + 2s | per-vertex word arrays sx, sy, colour, indexed by slot s |
| 0x686ba + 4s, 0x6a5fa + 4s, 0x6c53a + 4s | per-vertex dword arrays X, Y, **Z**. Only Z is read. **The Z array is persistent global memory, initially all zero.** |
| 0x1ee47a | 256 word bucket counts |
| 0x6e47a / 0xee47a / 0x16e47a | per bucket, 0x400 word entries each: the face's three vertex byte-offsets (2*idx + B) |
| 0x1ee8cc / 0x1ee8d0 | loop cursors |

### 5.4 `add_object` 0x52a4c (one object; sets up its sort entries)
Inputs come from the engine state; B = [0x657a6]. The angle and projection globals must already be set.
```
for i = 0 .. until vtx[i].x == 0x7fffffff:
    x16 = (vtx.x>>12) + offX ; y16 = (vtx.y>>12) + offY ; z16 = (vtx.z>>12) + offZ    // stored as int16
    n = vtx.normal
    xform()
    s = B/2 + i
    SX[s]=sx; SY[s]=sy; Xd[s]=X; Yd[s]=Y; Zd[s]=Z
    sh = light()
    if depthcue: sh += (Z>>4) + 0x50
    if sh >= max: sh = max
    if sh <= min: sh = min
    COL[s] = (sh + basecol) & 0xffff
nv = i
for each face f (until f.v0 == 0x7fff):
    za = Zd[f.v0 + B]; zb = Zd[f.v1 + B]; zc = Zd[f.v2 + B]       // !! slot idx+B, not idx+B/2 (see bug)
    key = max(za,zb,zc)                                           // signed
    bucket = (128 - (key >> 6)) & 0xffff                          // larger Z (farther) -> smaller bucket
    e = bucket*0x400 + cnt[bucket]; cnt[bucket]++
    E0[e] = 2*f.v0 + B ; E1[e] = 2*f.v1 + B ; E2[e] = 2*f.v2 + B   // byte offsets into the word arrays = slot*2
[0x657a6] += 2*nv ; [0x657b2] += nv
```

**Original bug (reproduce it).** When B > 0, the depth key reads Z slot `idx + B` instead of `idx + B/2`. This only happens for signB, the second object of the text batch (B = 800):
- Its faces read Z slots 800 + idx.
- Slots 800 and 801 are signB's own vertices 400 and 401 from this frame.
- Slots 802..1201 are never written by anyone, so they are 0 forever. The terrain writes at most slot 774, and it runs later anyway.

So most signB faces get key = max(0, the few real values), which puts them in bucket 128. Port this by keeping a zero-initialised Z array of at least 1202 entries that persists across frames and parts.

The code assumes 0 ≤ bucket < 256 (key in -8128..8255) and at most 1024 faces per bucket. Both hold for these objects.

### 5.5 `draw_list` 0x52c83
```
for bucket in 0..255:                       // far to near (painter's algorithm)
    for n in 0 .. cnt[bucket]-1:             // insertion order; cnt is decremented back to 0
        load (SX,SY,COL) of the three slots into the triangle inputs
        if !backface(): gouraud_tri()
[0x657a6]=0; [0x657aa]=4; [0x657ae]=0; [0x657b2]=0
```
Because every count ends at 0, the buckets are left empty for the next batch.

### 5.6 The three wrappers
**`draw_text_objects`** 0x52dbd (text render)
- Light: angles A, B, G = [0x1ee88d], [0x1ee891], [0x1ee895], which are never written (0). Transform (0, -30000, 0) and store the int16 results X, Y, Z in 0x44ee8, 0x44eea, 0x44eec. This gives **L = (0, -30000, 1)**.
- Object angles: A = [0x1fd790], B = [0x1fd788], G = [0x1fd740] (= 0).
- Clear cnt[0..255] (rep stosd 0x80 dwords). B = 0; max = 0x1e; min = 5; depth-cue flag = 0.
- `add_object(signA)`: base colour 0xad, offset (0x8c, 0, 0), so colours are 0xb2..0xcb.
- `add_object(signB)`: base colour 0x94, offset (0, 0, 0), so colours are 0x99..0xb2.
- `draw_list()`.

The projection offset comes from `text_render` (section 2.4).

**`draw_terrain`** 0x52f12 (landscape)
- Light: angles A = [0x1fe42c] (0), B = [0x1fe424] (0), G = [0x1fe434] (5 per tick). Transform (0, -10000, 0) and store it in L. The pig reuses this L.
- Object angles: A = [0x1fe410], B = [0x1fe418] (-290), G = [0x1fe428].
- Clear cnt. Base colour 0xa0, offset (0, 0, -800), max = 0x5f, min = 5, proj_offset = (0, 0, 0), **depth-cue flag 1**. Colours are 0xa5..0xff.
- `add_object(terrain)`, then `draw_list()`.

**`draw_pig`** 0x53024 (landscape, right after the terrain)
- Object angles: A = [0x1fe410] + [0x1fe41c], B = [0x1fe418] + [0x1fe414], G = [0x1fe428] + [0x1fe420].
- Base colour 0x40, offset (0, 0, 0x320), max = 0x5a, min = 5, depth-cue flag 0. Colours are 0x45..0x9a.
- proj_offset = ([0x1fe3fc], [0x1fe3f4], [0x1fe3f8]). These are left in place for later frames (harmless).
- No count clear (`draw_list` left the counts at 0). `add_object(pig)`, then `draw_list()`.

## 6. Data files
| file | size | use |
|---|---|---|
| TEXTURE5.LBM, TEXTURE6.LBM | 256x256 PBM | tunnel textures for part 3 and part 4. Part 3's palette is TEXTURE5's CMAP. |
| TEXT1.LBM, TEXT2.LBM | 320x200 | overlays; 0 = transparent. Part 4's palette is **TEXT2's CMAP**. |
| WIPE1.LBM | 320x200 | wipe mask for the text parts (values 0..255; text1/text2 pixels have 15..235 and 12..235) |
| ENDPIGS.LBM | 320x200 | logo v0 picture + palette |
| MELON.LBM | 320x200 | logo v1 background + palette (no zero pixels) |
| TEXT3/4/5.LBM | 320x200 | logo v1 overlays (text5 = "THE END" plus the "Stolen" logo at the bottom left) |
| WIPE4.LBM | 320x200 | logo wipe-in mask (text5 pixels have values 6..161) |
| WIPE2.LBM | 320x200 | logo wipe-out mask |
| CLOUDS.LBM | 576x110 | sky + landscape palette |
| PAL3.BBM | 1x1 | target palette only |
| TUNNEL2/3.MAP/.SHD | | via core's `tunnel_select(1/2)` |

All files are "FORM PBM" with BMHD first and compression 1. The CRNG, TINY, DPPS and GRAB chunks are ignored, so there is no colour cycling. Only the first CMAP and BODY found by the byte scan are used.

## 7. Timeline and recording offsets

Recording: 70.086 fps, one frame per tick. I found the part starts from the white-palette frames (whole-frame mean colour jumps) and from the sky scroll value. Each part's local tick 0 ≈ the frame below (±1; the start function runs inside the previous render, mid-frame).

| event | part tick | frame | time (s) |
|---|---|---|---|
| part 3 start (white) | 0 | 3189/3190 | 45.50 |
| part 3 fade ends (bias 0) | 64 | 3254 | 46.43 |
| part 3 -> room (counter > 720) | 721 | 3912 | 55.82 |
| part 4 start (white) | 0 | 4694 | 66.97 |
| part 4 -> logo v0 (counter > 1200) | 1201 | 5895 | 84.11 |
| logo v0 -> landscape (counter > 500); one frame of pigs in the clouds palette | ~500 | 6395 | 91.24 |
| landscape tick 0 (sky offset 0 measured; offset 1 at 6398) | 0 | 6397 | 91.27 |
| landscape -> logo v1 (counter > 800) | 801 | 7197 | 102.69 |
| logo v1 text3 wipe-in done | 510 | ~7707 | 110.0 |
| text3 wipe-out start / end | 812 / 1322 | 8009 / 8519 | 114.3 / 121.6 |
| text4 wipe-in start / done | 1324 / 1834 | 8521 / 9031 | 121.6 / 128.9 |
| text4 wipe-out start / end | 2136 / 2646 | 9333 / 9843 | 133.2 / 140.4 |
| text5 ("THE END") wipe-in start | 2648 | 9845 | 140.5 |
| THE END complete; the screen never changes again | 2970 | 10168 | 145.08 |
| end of recording (ESC) | | 19051 | 271.8 |

The logo v1 rows come from a model with one render every 2 ticks, starting on the part's first tick. I checked it against measured wipe thresholds at L+64, +128, +192, +256, +1324..+1360 and +2663..+2973 (L = 7197); it matches to ±1 frame.

### Render cadence: this code depends on renders per tick
Several pieces of state advance **per render, not per tick**:
- text: wipe thresholds `[0x1fd770]` and `[0x1f0df0]`
- logo v1: `[0x1fdab8]` and `[0x1fdadc]`; the whole text3/text4/text5 schedule

What the recording shows (measured by checking, in each frame, which overlay pixels are shown against the wipe-mask values; exact cut-offs like "all ≤ 93 shown, ≥ 94 not"):
- **Text parts (no vsync):** about **0.406 renders per tick** during the wipe-in (both parts) and **0.426** during part 4's wipe-out. That is about 28.4 to 29.8 renders/s, because DOSBox's emulated CPU is slow here. Because of this, in the recording part 3's text finishes appearing at about tick 585, and part 4's wipe-out only just completes (threshold 235) at tick ~1198, right before the switch. At one render per tick, the wipe-in would take 256 ticks, and part 4's text would be gone by tick ~512.
- **Logo v1 (`wait_retrace_start` + three 64000-byte passes):** **exactly one render every 2 ticks**. The work misses the next retrace each time. A fast machine would manage one per tick, finishing THE END at ~1787 ticks instead of 2970.
- **Landscape:** about 2 renders per 3 ticks (sky offset sequence 0,1,1,3,4,4,5,7,...). Its render state is all tick-driven, so this only affects which frames are sampled.
- **Logo v0:** not observable (static image). The switch happens on the first render after counter 500.

Recommendation to the porter: to match the recording, run `logo_render` only on every second tick of part 6. Run `text_render` with an accumulator of ~0.406 renders/tick (0.426 once `[0x1fd770] ≥ 256`). Otherwise the text timings will be visibly shorter than in the capture. One render per tick is what a fast real PC would show for the text parts.

Also note that ticks executed by a part after its switch condition depend on when the render notices it (±2 ticks at these rates). That carries the non-reset globals (`[0x1fd724]`, `[0x1fd764]`) into part 4.

## 8. Checks
Verified against the recording:
- **Part order, and that the switch thresholds (720/780/1200/500/800 ticks) are compared with `>`:** frame distances between white frames are 722, 782, 1201, ~501, 800.
- **Text palettes:** part 3's text colours match the TEXTURE5 CMAP and part 4's match the TEXT2 CMAP (exact RGB matches of the text pixels).
- **Wipe semantics (equality with an increasing threshold):** at every sampled frame the shown text pixels are exactly those with mask ≤ t.
- **The final screen** is melon + text5 and is byte-static from frame 10168 to the end.
- **The one-frame endpigs-in-clouds-palette glitch** at frame 6395.
- **Sky:** rows 0..95 = clouds[scroll + row*576 + col], with scroll = landscape tick; index-consistency score 0 over 12 rows.
- **Landscape palette:** `pal_approach` with step `max(0, trunc(16 sin t))`, t = 0.025*tick (float32). Fitted steps match the prediction at 8 of 11 sampled frames and are within ±1 at the others (render/tick skew).

Not verified pixel-exactly (it needs core's triangle filler): the 3D objects' positions and shading, and the signB sort bug's visual effect.

Open questions:
1. The DOSBox cycles setting behind the recording's render cadence is unknown. The rates above are measured, not derived.
2. The exact sub-frame alignment of part tick 0 (±1 frame).
3. The x87 accumulation of `[0x1fd724]`/`[0x1fe3f0]` is extended precision rounded to float32 on each store. `Math.fround(t + 0.05)` should match, but rare 1-ulp double-rounding differences are possible.
