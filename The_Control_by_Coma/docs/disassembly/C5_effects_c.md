# C5: effects 0x54273, 0x54314, 0x54456, 0x54507, 0x545bd, 0x546b3, 0x5486d (part 2, ~104.8..172.5 s)

All addresses are code32 offsets. `u8`/`u16`/`d` = byte/word/dword in memory; "u8 arithmetic" = mod 256.
"tick" = part-2 tick counter [0x1b707] (30 Hz, reset to 0 when part 2 starts; see C2/C4).
Shared building blocks already written up elsewhere are referenced by name; anything they do not cover is
documented in full here. Listing note: control.lst decodes several of these functions misaligned (the text strings
before each function swallow the first bytes). I re-disassembled linearly from the true entry points.

## Summary of the slice

**The task description guessed wrong about this slice.** None of these effects draws a gear-shaped 3D object, and
none uses the 320x400 RGB mode. They are all 320x200 mode-13h effects built from these parts:
- a 78x48 RLE delta animation ("anim") upscaled 4x by bilinear interpolation (0x28999 / 0x28970 / 0x28623),
- a 160x100 additive rotozoomer with a feedback decay (0x2879f, 0x1c2f8, 0x1c314),
- the starburst feedback (0x5224c, from C3),
- the 160x100 RLE video (0x28b2a, from C4),
- grain (0x53815 / 0x53847, from C4),
- a 64-step crossfade through the BLEND table (0x52982),
- proportional-font captions (0x1bab5 / 0x1bb5c, from C2).

The only "3D" is a 2D Z rotation of three texture-space corner points (0x2d540).

Recording time: **rec_t = part2_tick/30 + 90.55 s**. I measured it from six scene switches (part-2 ticks 213, 404, 854,
1275, 1709, 1923 and 2137 appear at rec 97.64, 103.98, 119.03, 133.06, 147.53, 154.67 and 161.78 s, with a spread of
±0.02 s). C4's estimate of 89.9..90.0 s for part-2 tick 0 is therefore about 0.6 s early. Part 1 ends at 2684/30 =
89.47 s, so there is a load gap of about 1.08 s at the section switch, not zero as C2 says.

| effect | scene fn (per tick) | part-2 ticks | rec time (s) | on screen |
|---|---|---|---|---|
| 0x54273 | 0x540e7,0x540f3,0x540ff,0x5410b,0x54117,0x54123,0x5412f,0x5413b | 427..853 | 104.8..119.0 | 160x100 RLE video (fur-hat crowd), grain, captions "I think I want to sing" … "behind this mask" |
| 0x54314 | 0x542d0 | 854..1067 | 119.0..126.2 | anim (gas-mask face) crossfaded with a rotozoomed ring texture (pulsing), "We see nothing.." |
| 0x54456 | 0x543bf | 1068..1274 | 126.2..133.0 | the same, but the anim is frozen on its last frame; caption "we do not move / because / …" |
| 0x54507 | 0x544c0 | 1275..1708 | 133.0..147.5 | anim (supermarket crowd, 184 frames) direct, "we are mass / under systems / CONTROL!" |
| 0x545bd | 0x54575 | 1709..1922 | 147.5..154.7 | starburst feedback (bright, saturating), grain, "What is wrong ?" |
| 0x546b3 | 0x5466a | 1923..2136 | 154.7..161.8 | anim (bushes/man, 64 frames) fixed 41/64 blend over a frozen starburst snapshot, "and they said / that I am / but I was not.." |
| 0x5486d | 0x54777 | 2137..2243 and 2350..2456 | 161.8..165.4, 168.9..172.5 | two additive rotozoom layers: a texture of digit/word text drawn every frame + AVI texture; grain; "some day" |

(Between the two 0x5486d runs, scene 0x54911 / effect 0x54a2c runs at ticks 2244..2349. That is another slice, but
0x54911 changes the 0x5486d parameters; see below.)

### Routines called
- Documented here: 0x28999 animStep, 0x28970 animRedisplay, 0x28623 upscale4x (also called by C2's 0x1af4e),
  0x286ce lerp4 table build (load), 0x2879f rotozoom, 0x52982 blendFrame, 0x528dd fillBack, 0x2d540 rotZ (repeated
  here; C3 has the full engine), and the scene functions listed above.
- C2 (notes/C2_gfx.md): 0x1c34d RLE (self-modified limit at 0x1c3e2), 0x1c2a7 / 0x1c2f8 darken LUT 0x1c1a7,
  0x1c314 up2x, 0x1bab5 drawString320, 0x1bb5c drawString256, font.
- C3 (notes/C3_effects_a.md): 0x522b5 buildPlasmaTab, 0x5224c addStarburst, the SIN/COS dword table 0x2ca18.
- C4 (notes/C4_effects_b.md): 0x52918 present, 0x53815 grain_add_clamp63, 0x53847 grain_add_sat, 0x538a8 grain
  generator, 0x52a0a BLEND table, 0x28b2a video_frame (+ the frame table 0x28a31), 0x53ed8 palette cycler.
  0x53ed8 drives the palette (0xc0..0xff) of every effect in this slice. None of my effects writes the DAC.

## Buffers and globals

| addr | name | initial (peek) | notes |
|---|---|---|---|
| [0x5606e] = 0x561b8 | BACK | BSS | 320x200, presented by 0x52918 (rows 0..198) |
| [0x56072] = 0x65bb8 | FEED | BSS | not used here, but 0x28623's 0xc0 fill overruns BACK by 3840 bytes into it |
| [0x1b25a] | TEX64 | alloc 0x10000 | 256x256: plasma map (0x522b5) in 0x545bd; text texture in 0x5486d |
| [0x1b25e] | bufA | alloc 0xfa00 | 320x200 scratch (rotozoom upscaled; starburst snapshot) |
| [0x1b262] | ROT | alloc 0xfa00, zeroed at load | 160x100 rotozoom accumulator (16000 bytes used) |
| [0x529f4] | BLEND | 0x40000 | BLEND[a*4096+b*64+t] = a + floor((t+1)*(b-a)/64) (C4) |
| [0x53811] | GRAIN | 0x4e200 | values 0..31 (C4) |
| 0x1c602 | LERP4 | built by 0x286ce at load | 16384 bytes, see 0x286ce |
| [0x28b88] = 0x28b98 | ANIMBUF | zero | 78x48 = 0xea0 bytes. The same address is the 160x100 video buffer of 0x28b2a (0x28b98..0x2ca18) |
| [0x28b94] = 0x2aad8 | DELTABUF | zero | delta decode buffer (inside the video buffer region) |
| 0x246a8 | SHIFTBUF | zero | 80-stride copy of the anim (78 used + 2 pad bytes that are never written, so 0) |
| 0x20697 | HBUF | zero | 320-stride horizontally interpolated rows |
| d[0x2897c] | animPtr | 0 | anim stream base (avi table entry) |
| d[0x28980] | animReq | 0 | requested frame (set by scene fns) |
| d[0x28985] | animLast | **0xffffead7** | last frame decoded |
| d[0x28989] | animNext | 0 | next frame number (incremented per decode) |
| u8[0x20602] | upShift | 2 | `shl` count in 0x28623 |
| u8[0x2060c] | upAdd | 0xc0 | added to every upscaled pixel |
| d[0x2861f] | upRows | **0x30 (48)** | written only by C2's 0x1afc4 (0x21), which runs after this slice, so it is 48 for all my effects |
| d[0x1c3e2] | rleLimit | 0xea0 | self-modified imm32 of the cmp at 0x1c3dc |
| d[0x28769] | rzZoomIdx | 0 | index into the SIN dword table |
| d[0x2d460] | angZ | 0 | rotation angle, 0..255 (only the low byte is ever changed; the upper bytes stay 0) |
| u8[0x28918] | rzShift | 3 | **SELF-MOD**: the imm8 of `shr al,3` at 0x28916 in 0x2879f |
| d[0x2876d], d[0x28771] | rzW, rzH | 0xa0 (160), 0x78 (120) | divisors |
| d[0x28783], d[0x28787] | rzOffU, rzOffVIdx | 0, 0 | never written: constants 0 |
| u8[0x1c313] | up2xAdd | 0 | 0x1c314 adds it |
| d[0x529f8] | blendT | 0 | t for 0x52982 |
| d[0x542fc] | pulse542 | 0 | crossfade / threshold phase |
| u8[0x53f8a] | frameAcc | 0 | per-tick accumulator; a carry advances the anim or video frame |
| d[0x28b25] | vidFrame | 0 | video frame 0..59 (C4) |
| d[0x5426f] | capOfs | 0 | caption offset for 0x54273 |
| u8[0x53810] | grainTh | 0 | grain threshold |
| d[0x5475e], d[0x54762], d[0x54766], d[0x5476a] | zoomA, zoomB, angA, angB | 0 | 0x5486d layer params (only the low bytes change) |
| u8[0x5224a], u8[0x5224b], u8[0x56077] | scrollA, scrollB, pulse | 0 | starburst params (C3); the values left over from part 1 carry into 0x545bd |
| u8[0x1b882] | fontBase | 0 | 0xc0 for all of my captions (set by 0x54273/0x54314/0x545bd; 0x54456/0x54507/0x546b3/0x5486d rely on the value left behind) |
| u8 0x54313, 0x544de, 0x545bc, 0x54688 | init flags | 0 | first-frame flags of 0x54314, 0x54507, 0x545bd and 0x546b3 |

DEMO.AVI items used (`aviTab` [0x1b170+4*i] = load address + offset):

| item | addr | file offset | what |
|---|---|---|---|
| 3 | [0x1b17c] | 0x2867a | RLE video frames (C4) |
| 4 | [0x1b180] | 0x6db24 | anim, 42 frames (`dword N, dword keyOfs, dword deltaOfs[N]`, offsets relative to the item), values 0..7 |
| 5 | [0x1b184] | 0x79f1d | starburst planes, 3 x 64000 (C3) |
| 7 | [0x1b18c] | 0xd8a1d | raw 256x256 texture (ring/swirl) |
| 8 | [0x1b190] | 0xe8a1d | anim, 184 frames, values 0..15 (one pixel wraps, see 0x28623) |
| 12 | [0x1b1a0] | 0x1650ec | anim, 64 frames, values 0..15 |
| 13 | [0x1b1a4] | 0x16ee09 | raw 256x256 texture |

## Anim player

### 0x28999 animStep() (no args; draws into BACK)
```
d[0x1c3e2] = 0xea0                                   // SELF-MOD rle limit = 78*48
if (animReq == animLast) { upscale4x(ANIMBUF); return }   // jumps to 0x2898d = animRedisplay
animLast = animReq
if (animReq == 0) {                                  // "ja" = unsigned > 0, so this branch means == 0
  rle(src = animPtr + d[animPtr+4], dst = ANIMBUF)   // keyframe
  upscale4x(ANIMBUF)                                 // (wasted, overwritten below)
}
rle(src = animPtr + d[animPtr + 8 + 4*animReq], dst = DELTABUF)
for (i = 0; i < 0xea0; i++) ANIMBUF[i] = (ANIMBUF[i] - DELTABUF[i]) & 255
upscale4x(ANIMBUF)
animNext++; if (animNext >= d[animPtr]) animNext = 0  // unsigned compare; WRAPS (C2's 0x1afc4 freezes instead)
```
So frame 0 = key − delta0, and frame n = frame n−1 − delta n. RLE (C2/C4) values 0xf0..0xff in deltas mean −16..−1.
Deltas can overshoot 0xea0 by up to 83 bytes. The spill lands inside the video-buffer region, which does no harm;
decode into a larger scratch buffer.

**Frame pacing:** the scene fn does `u8 frameAcc += K; on carry animReq = animNext`. The effect decodes one frame per
change, so the displayed anim frame advances once per carry. K = 0x32 (0x542d0, 0x5466a: every 5.12 ticks = 5.86
frames/s) or 0x64 (0x544c0: every 2.56 ticks = 11.7 frames/s). Each effect's init sets frameAcc = 0, animReq = 0 and
animNext = 0. It does not reset animLast, so the first frame is decoded only if animLast != 0. In this run animLast is
0xffffead7 before 0x54314, 41 before 0x54507 (213 ticks * 50 / 256 = 41 carries) and about 169 before 0x546b3, so
the keyframe is always decoded. A port should keep animLast as real state anyway: if it were 0, the old ANIMBUF would
be shown and the anim would never start.

### 0x28970 animRedisplay(): `upscale4x(ANIMBUF)` (esi = [0x28b88]; 0x2898d is an identical copy).

### 0x286ce buildLerp4() (load time; table LERP4 at 0x1c602, 64*64*4 bytes)
```
for (a = 0; a < 64; a++) for (b = 0; b < 64; b++) {
  step = (((b - a) << 8) as int16) >> 2          // = (b-a)*64, 8.8 fixed point; frac = low byte, int = high byte
  acc = a << 8                                   // al = a, dl = 0
  for (k = 0; k < 4; k++) { acc += step; LERP4[a*256 + b*4 + k] = (acc >> 8) & 255 }
}
// => LERP4[a*256+b*4+k] = a + floor((k+1)*(b-a)/4); entry k=3 == b
```
The table ends exactly at 0x20602, which is upShift.

### 0x28623 upscale4x(esi = src 78 x upRows bytes) -> BACK
```
H = upRows (48 for this slice)
// 1. copy with shift into an 80-stride buffer (2 pad bytes per row never written = 0)
for (r = 0; r < H; r++) for (c = 0; c < 78; c++) SHIFTBUF[r*80 + c] = (src[r*78 + c] << upShift) & 255
// 2. horizontal pass: starts 81 bytes BEFORE SHIFTBUF (0x24657), i.e. one row up and one column left
p = 0x24657; q = HBUF (0x20697)
for (n = 0; n < H*80 - 1; n++) {                 // the last 4 bytes of HBUF row H-1 are never written (0)
  a = mem[p+n]; b = mem[p+n+1]
  copy 4 bytes LERP4[a*256 + b*4 .. +3] to q; q += 4
}
// 3. vertical pass, 4x, into BACK starting at row 0
for (r = 0; r < H; r++) for (x = 0; x < 320; x++) {
  a = HBUF[r*320 + x]; b = HBUF[(r+1)*320 + x]    // row H of HBUF is read but never written: 0 here
  for (k = 0; k < 4; k++) BACK[(4r+k)*320 + x] = (LERP4[a*256 + b*4 + k] + upAdd) & 255
}
// 4. fill 0x640 dwords of 0xc0 after the last row: BACK rows 4H .. 4H+19
//    (H=48: rows 192..211, which overruns BACK by 3840 bytes into FEED)
```
Closed form with S(r,c) = shifted source pixel, which is 0 for r = −1, c = −1, c = 78 or c = 79. Everything between
0x20697 and 0x246a8 is zero in the image and only this routine writes there:
`Hrow(j)[4c+k] = lerp(S(j−1,c−1), S(j−1,c), k)` for c in 0..79, and `BACK(4j+k, x) = lerp(Hrow(j)[x], Hrow(j+1)[x], k) + upAdd`,
where lerp(a,b,k) = a + floor((k+1)(b−a)/4).
Results:
- The 78x48 picture lands at BACK x = 4..315, y = 4..195 conceptually.
- Rows 0..3 and columns 0..3 ramp up from 0.
- Columns 312..315 ramp down to 0 and columns 316..319 are 0.
- Rows 188..191 ramp down to 0, and rows 192..199 are 0xc0.

**Index overflow:** LERP4 is indexed with a*256 + b*4. Any shifted value ≥ 64 reads outside the table, at 0x20602
and beyond (variables, code, HBUF itself). Only one case happens: anim 0xe8a1d (shift 2) has its last pixel
(index 3743) wrapped to 252..255 in frames 140..159 and some others. That corrupts the 4x4-ish bottom-right
corner. A port can clamp it, or emulate it with a flat memory image (GUESS: not visible).

Note for C2 (0x1af4e calls this with H = 33): HBUF row 33 is then read but not rewritten. It still holds row 33 from
the last 48-row call, which is the last frame of 0x546b3. So rows 128..131 of the RGB video interpolate toward stale
data from this slice.

## Rotozoomer

### 0x2d540 rotZ (same as C3)
Input d[0x2d424]=x and d[0x2d428]=y. With a = d[0x2d460] and SIN[i] = d[0x2ca18+4i], COS[i] = d[0x2ce18+4i]:
`x' = (x*COS[a] − y*SIN[a]) >> 11; y' = (x*SIN[a] + y*COS[a]) >> 11` (Math.imul low 32 bits, arithmetic shift).
The results go back to d[0x2d424] and d[0x2d428]. x and y are also copied to d[0x2d430] and d[0x2d434].

### 0x2879f rotozoom(esi = 256x256 texture) -> adds into ROT (160x100)
```
c = SIN[rzZoomIdx]; c = ((c + 0x800) >> 5) + 0x32             // sar; c in 50..178
P0 = rotZ( c, -c + 30)     -> (x0,y0)  stored d[0x2872d], d[0x28731]
P1 = rotZ( c,  c + 30)     -> (x1,y1)  d[0x28735], d[0x28739]
P2 = rotZ(-c, -c + 30)     -> (x2,y2)  d[0x2873d], d[0x28741]
qux = trunc(((x0-x1) << 8) / 160); quy = trunc(((y0-y1) << 8) / 160)   // idiv, toward 0; 8.8 steps per pixel
qvx = trunc(((x2-x0) << 8) / 120); qvy = trunc(((y2-y0) << 8) / 120)   // per row (120, but only 100 rows drawn)
// only the low 16 bits of each q are used (frac byte + low byte of q>>8 via add/adc)
// row start in 8.8, 16-bit wrap: int bytes = bx saved at 0x28775, frac bytes = dx at 0x28778 (starts 0)
Urow = (((x1 & 255) + 0x80 + (d[0x28783] & 255)) & 255) << 8
Vrow = (((y1 & 255) + 0x80 + sin8[d[0x28787]]) & 255) << 8        // both offsets are 0
for (row = 0; row < 100; row++) {
  u = Urow & 0xff00; v = Vrow & 0xff00              // within a row the fractions restart at 0 (xor edx,edx)
  for (x = 0; x < 160; x++) {
    t = tex[(v & 0xff00) | (u >> 8)] >> rzShift     // byte shr
    p = ROT[row*160 + x] + t; if (p >= 0x40) p = 0x3f; ROT[row*160+x] = p   // unsigned; never wraps here
    u = (u + qux) & 0xffff; v = (v + quy) & 0xffff  // dl+=frac, bl+=int+carry ; dh/bh likewise
  }
  Urow = (Urow + qvx) & 0xffff; Vrow = (Vrow + qvy) & 0xffff   // row fractions DO accumulate
}
```
In other words, each row starts at the 8.8 position (P1+128)<<8 + row*qv (16-bit wrap), but its pixels use only the
integer part of that position: the fraction restarts at 0 and steps by qu. The texture wraps in both axes (u8 coordinates). The visible step is P1→P0 over 160 px
and P0→P2 over 120 rows.

## 0x52982 blendFrame()
```
for (i = 0; i < 64000; i++) {
  a = bufA[i]; b = BACK[i]
  BACK[i] = (mem[BLEND + a*4096 + b*64 + blendT] + 0xc0) & 255
}
```
With a, b < 64 this gives a + floor((t+1)(b−a)/64) + 0xc0: t = 63 shows BACK and t = 0 shows almost all bufA.
**Overflow:** BACK rows 192..199 hold 0xc0 (from 0x28623), so the index becomes (a+3)*4096 + t, which reads entry
(a+3, 0, t): dark, as the recording shows. For a ≥ 61 the index is ≥ 0x40000 and reads past BLEND (GUESS: into
GRAIN, the next allocation). This is rare. Clamp, or keep a flat BLEND+GRAIN array.
0x529bb (a variant with a<<10) is not used.

## 0x528dd fillBack(): `BACK[0..63999] = 0xc0`.

## The effects (each is called once per main-loop frame; init blocks run on the first frame)

### 0x54273 video + captions (ticks 427..853)
```
video_frame()                       // C4 0x28b2a: frame vidFrame, BACK = 2x2-doubled (v<<1), values 0..30
grain_add_clamp63(BACK)             // C4 0x53815 with grainTh = 8 (left by 0x540ca); BACK = min(v+g,63) + 0xc0
fontBase = 0xc0
drawString320(BACK + 0x3e80 /* row 50, x 0 */, 0x54175 + capOfs)
present()
```
Scene fns (per tick):
- `capOfs = K`
- `[0x52185] = 0x54273`
- `u8 frameAcc += 0x28; vidFrame += carry; if (vidFrame >= 0x3c) vidFrame = 0` (the `jb 0x2a0` jumps to a ret)

| fn | ticks | K | caption |
|---|---|---|---|
| 0x540e7 | 427..483 | 0 | " I think I want to sing " |
| 0x540f3 | 484..532 | 0x19 | "   my mouth is frozen   " |
| 0x540ff | 533..590 | 0x32 | "     I want to shout    " |
| 0x5410b | 591..639 | 0x4b | " but I just cant do that" |
| 0x54117 | 640..697 | 0x64 | "   Our minds are full  \r\r         of lies        " |
| 0x54123 | 698..746 | 0x96 | "  Our eyes are blinded  " |
| 0x5412f | 747..804 | 0xaf | "     I want to SEE !    " |
| 0x5413b | 805..853 | 0xc8 | "but I cant see anything \r    behind this mask    " |

The video advances every 6.4 ticks (4.69 frames/s). It continues from the vidFrame/frameAcc left by 0x5409a,
which adds 0x3c per tick.

### 0x54314 anim + rotozoom crossfade, "We see nothing.." (ticks 854..1067)
```
if (!u8[0x54313]) { frameAcc = 0; u8[0x54313] = 1; animReq = 0; animNext = 0; fillBack() }
darken(ROT)                          // 0x1c2f8: ROT[i] = LUT1c1a7[ROT[i]], 16000 bytes (trails)
animPtr = [0x1b180]; upShift = 3; upAdd = 0
animStep()                           // BACK = anim 0..56 (rows 192..199 = 0xc0)
rzZoomIdx = 0x32                     // c = ((1931+2048)>>5)+50 = 174
rotozoom([0x1b18c])                  // rzShift is 3 here (initial value; 0x5486d later sets it back to 3)
up2x(bufA)                           // 0x1c314: bufA = ROT doubled, + up2xAdd (0)
blendT = (eax = pulse542 with the low byte replaced by sin8[pulse542] >> 1)   // pulse542 < 256 here, so 0..63
blendFrame()                         // BACK = lerp(bufA -> anim, t) + 0xc0
fontBase = 0xc0; drawString320(BACK /* row 0 */, 0x54300 = "\r We see nothing..")   // the text sits at row 20
present()
```
Scene 0x542d0:
- `[0x52185] = 0x54314`
- `u8 frameAcc += 0x32; on carry animReq = animNext`
- `u8 angZ += 0xfe` (−2 per tick)
- `u8 pulse542 += 5`

So the blend pulses with sin8, which has period 128, giving 25.6 ticks = 0.85 s per cycle. The start value of angZ is
whatever part 1 and 0x53fe9 left (C3/C4); a port must carry it over.

### 0x54456 frozen anim + rotozoom (ticks 1068..1274)
Same as 0x54314 without the init block and without decoding: `darken(ROT); upShift=3; upAdd=0; animRedisplay();
rzZoomIdx=0x32; rotozoom([0x1b18c]); up2x(bufA); blendT=…; blendFrame(); drawString320(BACK, 0x543d8); present()`.
fontBase is not set (still 0xc0).
Caption: "\r     we do not move\r\r          because\r\r      we dont know\r\r      where to move..\r\r     and if we move\r\r       we may see..\r".
Scene 0x543bf: `[0x52185]=0x54456; u8 angZ += 0xfe; u8 pulse542 += 5`. The anim is not advanced, so the last frame
of 0x54314 stays on screen.

### 0x54507 anim direct, "we are mass…" (ticks 1275..1708)
```
if (!u8[0x544de]) { frameAcc = 0; u8[0x544de] = 1; animReq = 0; animNext = 0; fillBack() }
animPtr = [0x1b190]; upShift = 2; upAdd = 0xc0
animStep()                           // BACK = 0xc0 + anim*4 (0..60)
drawString320(BACK + 0x960a /* row 120, x 10 */, 0x544df = "we are mass\r\runder systems\r\r   CONTROL!")
present()
```
Scene 0x544c0: `[0x52185]=0x54507; u8 frameAcc += 0x64; on carry animReq = animNext`.

### 0x545bd starburst feedback, "What is wrong ?" (ticks 1709..1922)
```
if (!u8[0x545bc]) { frameAcc = 0; u8[0x545bc] = 1; animReq = 0; animNext = 0; pulse542 = 0
                    fillBack(); buildPlasmaTab() /* C3 0x522b5 into TEX64 */ }
darken(BACK)                         // 0x1c2a7, all 64000
addStarburst(edi = BACK, ebp = TEX64)   // C3 0x5224c (reads planes backwards: 180° rotation; saturating add)
grainTh = sin8[d pulse542] >> 3      // FULL dword index, see below
grain_add_sat(BACK)                  // C4 0x53847
for (i = 0; i < 64000; i++) BACK[i] = (BACK[i] >> 2) + 0xc0   // in place: the feedback carries the +0xc0 offset
drawString320(BACK /* row 0 */, 0x5459c = "\r"x11 + "    What is wrong ?\r")   // text at row 145
present()
```
Scene 0x54575 (per tick):
- `u8 scrollA += 3; u8 scrollB += 0xff; u8 pulse += 2`
- `d pulse542 += 10` (dword add)
- `[0x52185] = 0x545bd`

Because BACK holds 0xc0..0xff after each frame, the next darken maps it to about 0x9f..0xd4 before the add. That is
why this part is so bright. The steady state depends on the frame rate (see Timing).

**Out-of-table read:** pulse542 grows by 10 per tick from 0 (reset on the first frame) to about 2130. The code reads
`mem[0x2d218 + pulse542]`, so sin8 (512 bytes: |sin| then |cos|) is exceeded after 52 ticks. From then on grainTh =
(byte at 0x2d218 + i) >> 3, with i up to about 2130, i.e. 0x2d418..0x2da6a. That memory is mostly code, so it is
static: take it from unpacked.bin at 0xec0 + addr. It also contains runtime variables of the 3D engines:
- 0x2d418..0x2d463: rotZ/X/Y temporaries and the angles (i = 512..587, ticks 52..58),
- 0x2d619/0x2d61a and 0x2d6d9..0x2d727 (i = 1025..1295, ticks 103..129), including the pointer d[0x2d708].

For those, use the port's emulated values or the file bytes (GUESS; it only changes how strong the grain is, from
0 to 31).

### 0x546b3 anim over a starburst snapshot, "and they said…" (ticks 1923..2136)
```
if (!u8[0x54688]) {
  darken(BACK); addStarburst(BACK, TEX64)              // one more starburst step on the 0x545bd frame
  for (i = 0; i < 64000; i++) bufA[i] = BACK[i] >> 2   // snapshot, 0..63
  frameAcc = 0; u8[0x54688] = 1; animReq = 0; animNext = 0
}
animPtr = [0x1b1a0]; upShift = 2; upAdd = 0
animStep()
blendT = 0x28; blendFrame()          // BACK = snap + floor(41*(anim*4 - snap)/64) + 0xc0
drawString320(BACK + 0x960a, 0x54689 = "and they said\r\rthat I am\r\rbut I was not..")
present()
```
Scene 0x5466a: `[0x52185]=0x546b3; u8 frameAcc += 0x32; on carry animReq = animNext`.

### 0x5486d text-texture rotozoom, "some day" (ticks 2137..2243, 2350..2456)
```
darken(ROT)                                           // 0x1c2f8
drawString256(TEX64 + 2, 0x547a5)                     // C2 0x1bb5c, opaque glyphs, 256 stride, "\r" = 25 rows
esi = TEX64; rzShift = 1 (SELF-MOD 0x28918); rzZoomIdx = d zoomA; angZ = d angA; rotozoom(TEX64)
rzShift = 3; rzZoomIdx = d zoomB; angZ = d angB; rotozoom([0x1b1a4])
up2xAdd = 0; up2x(BACK)                               // BACK = ROT doubled (0..63)
grain_add_clamp63(BACK)                               // grainTh = 10 (set by the scene)
drawString320(BACK + 0xc805 /* row 160, x 5 */, 0x5476e = "some day")
present()
```
The text drawn into the texture is 10 lines at 25-row pitch, starting at x=2:

    3056245642352coma41 / 01345192we41973214x / 12345409410love4197 / 2135514under3562165 / 82356195systems5133 /
    2135514under3562165 / 82356195systems5133 / 623467control901482 / 623467control901482 / DSJgert489023+90 22

- Each line is 300..326 px wide, so it runs past x=256 and continues one row lower (linear addressing).
- Glyphs are 26..31 rows tall, so later lines overwrite the descenders of earlier lines.
- The last line can write up to about 1 row past the 64 KB buffer (GUESS: into bufA, which is harmless here).
- Pixels not covered by glyph boxes keep the plasma left by 0x522b5 (values 0..31).

Emulate this as linear writes into a flat 65536+ array.

Scenes (per tick):
- 0x54777: `[0x52185]=0x5486d; u8 angA += 4; u8 angB += 0xfd; u8 zoomA += 5; u8 zoomB += 1; grainTh = 0x0a`.
- 0x54911 (ticks 2244..2349, effect 0x54a2c in between): `u8 angA += 0xfe; u8 angB += 1; u8 zoomA += 0x41; u8 zoomB += 2`.

All four start at 0. At tick 2137+n of the first run: angA = 4n, angB = −3n, zoomA = 5n, zoomB = n (mod 256).
angZ is left equal to angB afterwards.

## Timing / ordering for the port
- Scene functions run in the timer ISR once per tick, before the frames drawn during that tick. The init block of each
  effect runs on its first frame, after the first tick of its scene. That first tick has already added to
  frameAcc/pulse542, and the init then resets them.
- The anim, video, rotation, zoom, pulse and grain phase (d[0x5380c] += 0xc1c per tick, C4) all depend only on the
  tick.
- The feedback in ROT (rotozoom trails) and in BACK (0x545bd) is applied once per frame, so it depends on the frame
  rate. The effects never wait for retrace. C3 estimates 1..1.3 frames per tick for part 1.
- I could not measure the frame rate for this slice. In the recording, 50..65 of the 70 frames per second change, but
  that count includes the per-tick palette cycling (0x53ed8) and tearing. GUESS: about 1 frame per tick. Tune it
  against the trail length and brightness of 0x545bd in the recording.
- Row 199 of the screen is never presented: it stays 0xc0 (C4/0x52918).

## Checks done (capframe.py / trans.py on video0002.avi)
- **Scene-switch times:** see the summary; rec_t = tick/30 + 90.55 for part 2.
- **0x54314 / 0x54507 frames (rec 121 and 140), checked pixel by pixel against the 0x28623 model:**
  - Columns 0..3 ramp up from dark to the image (col 3 is the brightest).
  - Rows 188..191 ramp down to dark.
  - Rows 192..198 are flat dark. In 0x54314 they take 2 colours (the overflowed blend); in 0x54507 they are 0xc0
    plus the "CONTROL!" text.
  - Row 199 is uniform.

  This confirms upRows = 48 (not 33), the one-row and one-column offset, and the 0xc0 fill.
- **Anim decoding:** decoding the anims at AVI 0x6db24, 0xe8a1d and 0x1650ec and the 60 video frames with the RLE above
  gives coherent pictures (gas-mask face, supermarket crowd, …). Maximum values are 7, 15 (+1 wrapped pixel) and 15,
  which match the shifts 3/2/2.
- **0x54314 crossfade:** the recording alternates between the face and the ring texture every ~0.85 s (rec 119..121
  sheet).
- **0x545bd:** the starburst centre is at about (158,97) in the recording. Planes 0..2 at AVI 0x79f1d are centred at
  (160,100), so the 180° flip cannot be told apart visually.
- **Caption positions:** 0x54273 at row ~50+, 0x54314/0x54456 at row 20+, 0x54507/0x546b3 at row 120+, 0x545bd at
  row 145+, and "some day" at row 160+. All match the sheet.
- **Tables:** SIN dword 0x2ca18 = round(2048 sin), round(2048 cos), and sin8 0x2d218 = round(127|sin(πi/128)|) and
  |cos|. Both verified exactly.
