# C4: effects 0x526f0, 0x5277b, 0x5282e, 0x528b2, 0x53fb0, 0x54043, 0x540ca

All addresses are code32 offsets. "u8" = byte arithmetic mod 256. "tick" = timer tick counter [0x1b707] (30 Hz).
Checked against the recording with capframe.py (see "Checks" at the end).

## Summary of the slice

| effect | installed by (scene fn, per tick) | ticks | demo time | what is on screen |
|---|---|---|---|---|
| 0x526f0 | 0x5269e (part-1 timeline 0x17ce0) | 1459..1922 | 48.6..64.1 s | starburst + the 3D spider (object at 0x43bf9) |
| 0x5277b | 0x52744 | 1923..2154 | 64.1..71.8 s | starburst + caption "order ?" |
| 0x5282e | 0x527de | 2155..2619 | 71.8..87.3 s | starburst + growing grain + caption "NO order!" |
| 0x528b2 | 0x5288c | 2620..2683 (part 1 ends at 0xa7c) | 87.3..89.5 s | starburst decays to black, caption "We are under / control.." |
| 0x53fb0 | 0x53f8b, later 0x53fa4 (part-2 timeline 0xf2d0) | p2 ticks 0..212 and 320..403 | ~89.9..97.0 s and ~100.6..103.4 s | "COMA" photo (children, "WE ARE NOTHING BUT GRAY MASS CONTROLLED BY THE SYSTEM") with grain |
| 0x54043 | 0x53fe9 | p2 213..319 | ~97.0..100.6 s | inverted dimmed drawing (face) + caption "the / CONTROL" |
| 0x540ca | 0x5409a | p2 404..426 | ~103.4..104.1 s | 160x100 RLE video (Marx-Engels sign) doubled to 320x200, light grain |

The other captions listed in the task are NOT in this slice: "I think I want to sing" / "my mouth is frozen" /
"I want to shout" / "I want to SEE !" are drawn by effect 0x54273 (text base 0x54175 + [0x5426f], set by scene fns
0x540e7..0x5413b), "We see nothing.." at 0x54305 is effect 0x54314, "What is wrong ?" (0x545b3) 0x545bd,
"and they said..." (0x5468d) 0x546b3, "some day" (0x5476e) 0x5486d-ish. They use the same building blocks
documented here (0x28b2a video, 0x53815 grain, 0x1bab5 text with [0x1b882]=0xc0, 0x53ed8 palette).
"COMA" and "the CONTROL" are not text in COMA's case: "COMA" + the vertical words are part of the photo
(DEMO.AVI item 2); "the CONTROL" is text drawn by 0x1bab5.

### Timing finding (rate check asked by the brief)
The demo has TWO timer sections, both 30 Hz (divisor [0x1b705]=39772):
- part 1: handler 0x1b800, timeline 0x17ce0, main loop runs until tick >= 0xa7c (2684 ticks = 89.47 s).
- main then stops music (0x4be4 eax=3), restores the timer (0x1b84d), sets [0x52185]=0x53fb0, reloads the second
  module (0x52021, re-reads control.exe), 0x52124, blacks palette 0xc0..0xff, then 0x1b724 installs handler
  0x1b7a4 and RESETS tick to 0. Handler 0x1b7a4: tick++; if tick < 0x2260 call [0xf2d0 + 4*tick]; music 0x4be4(4);
  if byte [0x1b7ff]==0 call 0x53ed8 (palette cycling, below); phase [0x5380c] += 0xc1c mod 0x3e800.
- part 2 loop runs until tick >= 0x21fc (8700 = 290.0 s). 2684 + 8700 ticks = 379.47 s = the recording length.
  In the recording, part-2 tick 0 is at about T = 89.9..90.0 s (load gap ~0.4 s; GUESS from the photo appearing at 90 s
  and "the CONTROL" at 97 s).

### Frame pacing
None of these routines waits for retrace (no 3da). The main loop calls the effect as fast as it can. Animation that is
driven by tick variables is rate-independent; the part-1 feedback buffer (0x1c2c2 decay + 0x5224c add, once per
frame) is frame-rate dependent. UNCLEAR how many frames per tick DOSBox produced; the recording is 70.086 fps.

### Routines called (and who documents them)
- own (documented here): 0x52918 (copy to VGA), 0x523d2 (feedback -> back buffer), 0x53815 / 0x53847 (grain add),
  0x538a8 (grain buffer generation at load), 0x53ed8 (part-2 palette cycler, timer), 0x52a0a (blend table),
  0x28b2a (video frame), 0x1c34d (video RLE decoder, self-modified limit), 0x1c504 + 0x1c558 (image decoder),
  0x51a38 (spider object setup), scene fns 0x5269e 0x52744 0x527de 0x5288c 0x53f8b 0x53fa4 0x53fe9 0x5409a.
- C2 (notes/C2_gfx.md): 0x1c2c2 (LUT 0x1c1a7 on the feedback buffer), 0x1bab5/0x1bafa (proportional font text).
  Short summaries are repeated below so this file stands alone.
- C3 (notes/C3_effects_a.md): 0x5224c (starburst accumulate), 0x51c2f and everything under it (3D engine:
  0x2d540 0x2d464 0x2d4d1 0x2d5ad 0x402d6), 0x5238e (part-1 palette 0xc0..0xff), 0x522b5 (starburst map).

## Buffers and globals

| addr | name | init / value |
|---|---|---|
| [0x5606e] = 0x561b8 | BACK: 320x200 bytes, stride 320; what is copied to A000 | static in BSS |
| [0x56072] = 0x65bb8 | FEED: 320x200 feedback (starburst) buffer, 0..255 intensities | BSS, zero |
| [0x1b25a] | starburst 64K map (C3) | alloc 0x10000 at load |
| [0x1b170 + 4*i] | DEMO.AVI items, file offset + load address | i=2: 0x20614 COMA photo, i=3: 0x2867a video, i=5: 0x79f1d starburst planes, i=11: 0x1613ed drawing |
| [0x529f4] | BLEND table, 0x40000 bytes (0x52a0a) | alloc at load |
| [0x53811] | GRAIN buffer, 0x4e200 = 320000 bytes = 1000 rows (0x538a8) | alloc at load |
| [0x5380c] dword | GRAIN phase; += 0xc1c (3100) every tick in both timer handlers, wraps to 0 when >= 0x3e800 | 0 |
| [0x53810] byte | GRAIN threshold ("noise level"), subtracted from grain | 0 |
| [0x53f8a] byte | fraction byte shared by the 0x53810 fades AND the video frame counter | 0 |
| [0x28b25] dword | video frame number 0..59 | 0 |
| [0x1b882] byte | font colour base (pixel = glyph<<2 + this) | 0; 0x80 set by 0x52441 (C3, "coma/virne/groo/apatia" titles), 0xc0 by 0x54043 |
| [0x1baa7] dword | text pointer for 0x1bab5 | |
| [0x1bab1] dword | extra advance per char for 0x1bab5 | 1 |
| first-call flags (bytes, init 0) | 0x526ef (526f0), 0x52772 (5277b), 0x5282d (5282e), 0x53faf (53fb0, set to 2) | 0 |
| [0x1b7ff] byte | 1 = palette cycler 0x53ed8 off | 0 during this slice (set 1 at 0x55c07 later) |
| [0x53ed0] dword (only low byte changes) | palette pulse phase | 0 |
| [0x53ed4] dword | selected tint palette offset 0, 0xc0, 0x180 | 0 |

Starburst/3D state touched by the scene functions (meaning in C3): bytes 0x522f7, 0x5224a, 0x5224b, 0x522f8, 0x56077;
3D position dwords 0x2d448 (x?), 0x2d44c (y?), 0x2d450 (z, distance); angle bytes 0x2d458, 0x2d45c, 0x2d460.

## Scene functions (called once per timer tick from the timeline)

All part-1 scene fns of this slice start with the common "starburst advance" block (same as C3's):
```
STARBURST_TICK():
  t = u8[0x522f7] + 0xbe; carry = t > 255; u8[0x522f7] = t & 255
  u8[0x5224a] = (u8[0x5224a] + carry) & 255
  u8[0x5224b] = (u8[0x5224b] + 1) & 255
  t = u8[0x522f8] + 0x64; carry = t > 255; u8[0x522f8] = t & 255
  u8[0x56077] = (u8[0x56077] + carry) & 255
```
- 0x5269e: effect=0x526f0; u8[0x2d458]=0x44; u8[0x2d45c]=4; u8[0x2d460]+=2; d[0x2d450]+=0x32; STARBURST_TICK; d[0x2d448]+=1.
- 0x52744: effect=0x5277b; STARBURST_TICK.
- 0x527de: effect=0x5282e; STARBURST_TICK; then fade the grain threshold down:
  ```
  f = u8[0x53f8a] - 0x28; borrow = f < 0; u8[0x53f8a] = f & 255
  n = (u8[0x53810] - borrow) & 255; u8[0x53810] = (n & 0x80) ? 0 : n     // jns: clamp at 0
  ```
- 0x5288c: effect=0x528b2 (nothing else; the starburst variables freeze).
- 0x53f8b (part 2, ticks 0..212): effect=0x53fb0; f = u8[0x53f8a]-0x64, borrow into u8[0x53810] (NO clamp: it wraps
  below 0 to 0xff, 0xfe, ...).
- 0x53fe9 (213..319): effect=0x54043; t=u8[0x2d458]+0xfd, u8[0x2d458]=t&255, u8[0x2d45c]+= 1+carry; u8[0x2d460]+=2.
  (3D angles, unused by 0x54043; keep for state fidelity.) 0x53810 is not touched -> it stays frozen.
- 0x53fa4 (320..403): effect=0x53fb0 (its first-call init is already done, so no reset).
- 0x5409a (404..426): effect=0x540ca; video frame advance:
  ```
  f = u8[0x53f8a] + 0x3c; carry = f > 255; u8[0x53f8a] = f & 255
  d[0x28b25] += carry; if (d[0x28b25] >= 0x3c) d[0x28b25] = 0
  ```
  (the "jb 0x2a0" in the listing jumps to a plain `ret` at 0x2a0.) Same code (+0x28 instead of 0x3c) continues in
  0x540e7..0x5413b, so the video keeps running into effect 0x54273.

Value of 0x53810/0x53f8a across the slice (simulate it per tick rather than hard-coding): 0x53810 = 0 when part 1
reaches 0x527de; 0x5282e's first call sets it to 0x20; fades by 0x28/256 per tick, clamped at 0 (reaches 0 at ~205
ticks). At part 2 start 0x53fb0's first call sets 0x53810 = 0x40 (fraction left from part 1: 0x53f8a was decremented
by 0x28 on each of the 465 ticks 2155..2619 -> (0 - 465*0x28) & 255 = 0x58, if no tick was lost). 212 ticks of -0x64
take the 16-bit pair 0x4058 down to 0x4058 - 212*100 = -4728 = 0xED88 -> 0x53810 = 0xED (-19), 0x53f8a = 0x88. So
during 0x54043 and the second 0x53fb0 stretch the threshold is about -19 (the grain gets ADDED with +19 bias).

## The effects

### 0x526f0 starburst + spider (48.6..64.1 s)
```
if (!u8[0x526ef]) { d[0x2d44c] = -10; d[0x2d448] = -220; d[0x2d450] = 8000; u8[0x526ef] = 1 }
FEED_decay()                          // 0x1c2c2: FEED[i] = LUT_1c1a7[FEED[i]] for i < 64000
starburst_add(FEED, map=[0x1b25a])    // 0x5224c (C3)
BACK_from_FEED()                      // 0x523d2
spider_draw()                         // 0x51a38 -> 0x51c2f (C3) draws into BACK
present()                             // 0x52918
```
The init runs at the first frame after tick 1459, i.e. after at least one 0x5269e tick already added to
0x2d450/0x2d448 (the init overwrites that).

0x51a38 (spider setup, then 0x51c2f): d[0x2e95d]=0x4e20 (20000); u8[0x2d619]=0x80; u8[0x2d61a]=0;
d[0x51885]=d[0x43bf9] (=0x1a9 = 425 vertices); d[0x51889]=d[0x43bfd] (=0x320 = 800 faces);
d[0x518bc..0x518e0] = 0x43c01, 0x455c9, 0x46f91 (vertex x,y,z arrays), 0x442a5, 0x47635, 0x47635 (vertex normals x,y,z:
note y and z point to the SAME array, like in C3's 0x518e4/0x5198e), 0x44949, 0x46311, 0x47cd9 (face normals x,y,z),
0x48959 (faces). Unlike 0x518e4/0x5198e it does NOT zero d[0x2d418]/d[0x2d41c]. Everything else: see C3 (0x51c2f).

### 0x5277b "order ?" (64.1..71.8 s)
```
if (!u8[0x52772]) {                     // first call: colours 0x80..0xbf = grey ramp
  u8[0x52772] = 1
  out 3c8 <- 0x80; for (i = 0; i < 0x40; i++) { out 3c9 <- i; out 3c9 <- i; out 3c9 <- i }
}
FEED_decay(); starburst_add(FEED, [0x1b25a]); BACK_from_FEED()
draw_text(BACK + 0xc8b4, "order ?")    // 0xc8b4 = row 160, x 180; colour base [0x1b882] (= 0x80, left by 0x52441)
present()
```
Text at 0x52773 = "order ?" (zero-terminated).

### 0x5282e "NO order!" (71.8..87.3 s)
```
if (!u8[0x5282d]) { u8[0x5282d] = 1; u8[0x53810] = 0x20 }
FEED_decay(); starburst_add(FEED, [0x1b25a])
grain_add_sat(FEED)                     // 0x53847, into the FEEDBACK buffer (so the grain also decays/persists)
BACK_from_FEED()
draw_text(BACK + 0xc8b4, "NO order!")  // string at 0x52823
present()
```

### 0x528b2 "We are under control.." (87.3..89.5 s)
(The listing mis-decodes it; real code: call 0x1c2c2; call 0x523d2; ...)
```
FEED_decay()                            // no starburst add any more -> fades to black (LUT ~x*0.83 per frame)
BACK_from_FEED()
draw_text(BACK + 0x57c6, "We are under\r   control.. ")   // 0x57c6 = row 70, x 70; string at 0x52897
present()
```

### 0x53fb0 COMA photo (part 2)
```
if (!u8[0x53faf]) { u8[0x53faf] = 2; u8[0x53810] = 0x40 }
decode_image(BACK, AVI + 0x20614)   // 0x1c504, esi=[0x1b178]: 320x200, values 0..63, decoded EVERY frame
grain_add_clamp63(BACK)             // 0x53815: BACK = min(BACK+grain,63)+0xc0
present()
```

### 0x54043 "the CONTROL" (part 2)
```
decode_image(BACK, AVI + 0x1613ed)  // esi=[0x1b19c]: 320x200, 8-bit grey 0..255 (white paper drawing)
for (i = 0; i < 64000; i++) BACK[i] = (~BACK[i] & 0xff) >> 3   // invert, 0..31
grain_add_clamp63(BACK)
u8[0x1b882] = 0xc0
draw_text(BACK + 0, "\r\r\r\r" + 20 spaces + "the" + "\r\r\r" + 20 spaces + "CONTROL")   // string at 0x54009
present()
```
Text colour = glyph<<2 + 0xc0 = the bright end of the (tinted) photo palette. Line layout per 0x1bab5 rules below:
"the" at y = 50, "CONTROL" at y = 95 (glyph tops; plus the font's own offsets), x = 20 space advances.

### 0x540ca video (part 2, 404..426 then reused by 0x54273)
```
u8[0x53810] = 8                     // every frame
video_frame(BACK)                   // 0x28b2a
grain_add_clamp63(BACK)
present()
```

## Building blocks

### 0x52918 present
Copies 0x3e30 dwords (= 0xf8c0 bytes = rows 0..198) from BACK to A000:0000. Row 199 of the screen is never written by
effects; main filled it with 0xc0 once (A000+0xf8c0, 320 bytes) and set the overscan colour (attribute reg 0x11) to 0xc0.

### 0x523d2 BACK_from_FEED
`for i < 0xfa00: BACK[i] = (FEED[i] >> 2) + 0xc0` (all 200 rows). Palette 0xc0..0xff in part 1 = the red/yellow
starburst ramp set by 0x5238e (C3).

### 0x1c2c2 FEED_decay (C2)
`for i < 0xfa00: FEED[i] = LUT[FEED[i]]`, LUT = 256 bytes at 0x1c1a7 (dumped below; ≈ floor(i*0.83)).

### 0x5224c starburst_add (C3; summary)
edi = destination (FEED here), ebp = map [0x1b25a]. s = sin8[u8[0x56077]] >> 1 (sin8 = table 0x2d218, below).
Source P = [0x1b184] = AVI+0x79f1d, 3 planes of 64000 bytes (A at +0, B at +64000, C at +128000).
```
for (k = 0, i = 63999; k < 64000; k++, i--) {     // source read backwards -> picture rotated 180°
  a = P[i]; lo = (a + u8[0x5224a]) & 255; hi = (a + u8[0x5224b]) & 255
  v = map[hi*256 + lo]
  d = (P[128000+i] - P[64000+i] + s) & 255
  v = (v - d) & 255; if (v & 0x80) v = 0           // jns: signed test
  dst[k] = min(dst[k] + v, 255)
}
```

### 0x53815 grain_add_clamp63 (edi = buffer, 64000 bytes)
```
src = GRAIN + d[0x5380c]; th = u8[0x53810]
for (i = 0; i < 0xfa00; i++) {
  g = (src[i] - th) & 255; if (g & 0x80) g = 0
  b = (buf[i] + g) & 255; if (b >= 0x3f) b = 0x3f; buf[i] = b + 0xc0
}
```
### 0x53847 grain_add_sat (edi = buffer)
Same g; `buf[i] = min(buf[i] + g, 255)` (no clamp to 63, no +0xc0).

### 0x538a8 grain generator (once, at load from 0x1b27d)
Fills GRAIN (320000 bytes) with values 0..31. Uses `in al,0x40` (PIT counter low byte) as the random source, so it
is NOT reproducible; use a random byte source. Exact recipe (eax upper bits stay 0; bl is one running accumulator
over the whole buffer, starting 0):
```
p = 0; bl = 0
for (blk = 0; blk < 1000; blk += 200)          // 5 blocks of 200 rows
  for (row = 0; row < 200; row++)
    for (x = 0; x < 320; x++) {
      a = rnd8(); a = (a + (SIN32[a] & 255)) & 255; a = (a + NT[a]) & 255
      bl = (bl + a) & 255
      a = rnd8(); a = (a + NT[a]) & 255; a = (a + bl) & 255
      a >>= 2
      a = (a - ROWDARK[blk + row]) & 255; if (a & 0x80) a = 0
      GRAIN[p++] = a >> 1
    }
```
SIN32 = dword table 0x2ca18: SIN32[i] = round(2048*sin(2*pi*i/256)) (verified for i<256; only the low byte is used).
NT = 256 bytes at 0x52a80, ROWDARK = 1000 bytes at 0x52b80 (dumped below; 0..63 per row, long zero runs = rows
where the grain is strongest -> the horizontal bands). Reading at phase 0x5380c (+3100 bytes = 9.69 rows per tick,
wrapping every 800 rows) makes the bands roll.

### 0x52a0a blend table (load)
`BLEND[a*4096 + b*64 + t] = a + floor((t+1)*(b-a)/64)` for a,b,t in 0..63 (floor toward -inf; code: 8.8 fixed point,
step = ((b-a)<<8) sar 6, accumulated 64 times starting at a.0, high byte stored after each add; t=63 gives b).

### 0x53ed8 part-2 palette cycler (every tick in handler 0x1b7a4 while u8[0x1b7ff]==0)
```
ph = (u8[0x53ed0] + 2); if (ph > 255) { d[0x53ed4] += 0xc0; if (d[0x53ed4] >= 0x240) d[0x53ed4] = 0 }
u8[0x53ed0] = ph & 255
t = sin8[u8[0x53ed0]] >> 1                      // 0..63, |sin|, period 128 ticks; 0 exactly when the tint switches
for (c = 0xc0; c < 0x100; c++) {                // one out 3c8 <- c per colour, then 3 x out 3c9
  for k in 0..2: out 3c9 <- BLEND[BASE[3*(c-0xc0)+k]*4096 + TINT[d[0x53ed4] + 3*(c-0xc0)+k]*64 + t]
}
```
BASE = 192 bytes at 0x53e08 (warm sepia ramp), TINT = 3 palettes x 192 bytes at 0x53bc8 (0: red-brown, 1: teal/green,
2: blue-grey). So the photo palette pulses sepia -> tint -> sepia every 128 ticks (4.27 s) and moves to the next tint.
sin8 = 256 bytes at 0x2d218: sin8[i] = round(127*|sin(pi*i/128)|) (verified).

### 0x1c504 image decoder (esi = source, edi = dest; returns ecx = bytes written)
```
n = u16 at src; src += 2
repeat n+1 times (the counter is decremented as a signed 16-bit and loops while >= 0):
  b = *src++
  if (b < 0x80) {
    c = b & 0x3f
    if (!(b & 0x40)) { v = *src++; write c bytes v }              // c may be 0
    else             { w = 2 bytes at src; src += 2; write the pair c times }
  } else {
    a = b & 0x7f
    if (!(a & 0x40)) { copy a & 0x3f literal bytes }
    else             { bitpacked(count = a & 0x3f) }                // 0x1c558
  }
```
0x1c558 bitpacked(count): `k = *src++; if (k < 0x80) { copy k bytes into DICT (0x1c3ee) }` (else keep the
previous DICT). k &= 0x7f; find the first entry of {2,4,8,16,32,64,128,256} (words at 0x1c4f1) >= k: mask = entry-1,
bits = its index+1. end = src + ceil(count*bits/8) (8-bit mul/div, no overflow for these sizes).
Bit reader: dx = u16 at src, src+=2; per pixel: out DICT[dx & 0xff & mask]; then `bits` times { dx >>= 1 (16-bit);
counter += 0x20 (byte, reset to 0 at each call); on carry (every 8 shifts) dh = *src++ }. Finally src = end.
Verified with Python on AVI+0x20614 and AVI+0x1613ed: both give exactly 64000 bytes and end at the next item.

### 0x28b2a video_frame
```
SELFMOD: d[0x1c3e2] = 0x3e80     // patches the imm32 of "cmp dword [0x1c349], imm" at 0x1c3dc (default 0xea0)
src = [0x1b17c] (= AVI + 0x2867a) + d[0x28a31 + 4*d[0x28b25]]
rle34d(dst = 0x28b98 (16000 bytes, ends at 0x2ca18), src)       // 0x1c34d
for (y = 0; y < 100; y++) for (x = 0; x < 160; x++) {            // pixel double
  v = (F[y*160+x] << 1) & 255
  BACK[(2y)*320 + 2x] = BACK[(2y)*320 + 2x+1] = BACK[(2y+1)*320 + 2x] = BACK[(2y+1)*320 + 2x+1] = v
}
```
Frame offset table 0x28a31 (61 dwords, frame 60 is never used since the counter wraps at 60):
0 0xec2 0x22fb 0x3768 0x4a32 0x5c80 0x7007 0x814f 0x92a6 0xa25f 0xb2de 0xc44e 0xd511 0xe55d 0xf6a3 0x1090e 0x11aca
0x12ddd 0x1412b 0x1540b 0x16893 0x17bd6 0x18813 0x195c4 0x1a14a 0x1abe4 0x1c357 0x1dc19 0x1f540 0x20d59 0x22697 0x23fd3
0x258e9 0x27190 0x288a8 0x29f64 0x2b52d 0x2c723 0x2dc7a 0x2f1ad 0x30684 0x31c6b 0x330ec 0x344a2 0x34e3c 0x357ed 0x360c3
0x36ad1 0x374db 0x37f8f 0x38bfc 0x397d8 0x3a22f 0x3bcc4 0x3d733 0x3f1f5 0x40dc0 0x420de 0x4331d 0x4435a 0x454aa

0x1c34d rle34d (independent keyframes; output bytes counted in d[0x1c349], stop when >= the patched limit; a run may
overshoot, frames 0..59 end exactly at 16000):
```
b = *src++
00xxxxxx: c = ((b&3)<<8 | *src++) + 1; v = b >> 2            (0..15)
11xxxxxx: c = (b & 0x1f) + 1;          v = (b & 0x20) >> 5     (0/1)
10xxxxxx: c = (b & 3) + 1;             v = (b & 0x3c) >> 2
01xxxxxx: c = ((b&3)<<8 | *src++) + 1; v = ((b & 0x3c) >> 2) | 0xf0   (only used by delta video 0x28999, not here)
write c bytes v
```
Verified: frames 0..59 decode to 160x100 values 0..15 (people under a "К.Маркс Ф.Энгельс" banner, then fur-hat crowd).

### 0x1bab5 draw_text (C2; summary)
esi = [0x1baa7], edi = start. For each byte: 0 ends; 0x0d: edi = line start + 0x1900 (20 rows); if the NEXT byte is
also 0x0d it is consumed and edi += 0x640 (5 more rows); the new line start is the new edi. Other bytes: glyph
(ch-0xf) of the font table at 0x1b887 (width/height words at +0x63a0/+0x63a2, pixels from +0x63a4); nonzero glyph pixel
p -> dest = (p<<2) + u8[0x1b882]; then edi += glyph width (8 if the glyph is empty) + d[0x1bab1].
So "\r\r" = 25 rows, "\r" = 20 rows.

## Data dumps (initial file contents)

NT 0x52a80 (256):
```
a2 90 25 9a 5d 6a a3 5e 8b bf b4 60 d1 b7 be 26 40 b9 a9 e0 8b 90 ce 8d 02 92 71 50 e3 67 a9 77
d2 77 79 b6 73 3b 54 81 84 ed 81 8c 04 56 fb ed 16 a7 c1 5d d9 b4 c1 89 5d ec d1 82 49 e9 54 b2
0c 83 77 e7 97 9e 55 62 f3 3f 2c e5 36 98 97 50 ac 0c 84 28 45 5e 29 21 7c 97 63 a3 66 56 27 a7
95 7e f2 a0 ea 8f 6a 2e a7 18 83 cf 3e 04 04 dd b7 c1 20 74 b4 77 82 28 54 c7 0a 98 9a e2 0c 4a
0b d5 ef 57 9d 6d 4b da 3e fd 09 33 82 fe 23 6b 3d 47 f2 7d 25 51 3d 31 b0 d6 62 cb d5 a6 62 d0
5f 9c a4 87 f7 f9 a1 20 31 9c f0 7b fd d3 4d 10 96 c2 8e 7d a7 a1 c0 98 32 41 bc 2c 9e 9f fb b3
d2 85 7f b0 54 5a 0f 77 c5 c2 27 97 42 b2 4f 2a 74 f9 b8 b7 62 7e 63 78 4b a5 1d 2b 0f b1 1e b4
00 ed 21 54 23 1a 24 22 1c 62 47 fb 72 ae 68 58 d5 59 6e 6f 8c 64 74 b5 43 cc 3a bd d3 9e 83 d2
```
ROWDARK 0x52b80 (1000 = 5 x 200 rows):
```
1c 09 25 27 01 23 0e 37 23 0d 29 3b 36 28 0c 2c 2e 32 33 2b 34 20 09 01 1a 1e 20 1a 0d 1e 08 30 18 1a 04 28 14 21 15 14
11 1f 28 03 0f 11 17 22 00 1b 07 11 0c 18 17 12 08 17 10 05 0d 14 12 13 06 04 0a 0a 00 00 08 04 03 06 03 07 04 06 06 05
06 02 04 02 04 03 02 02 00 01 01 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 01 01 01 01 00 01 03 02 00 05
05 03 00 06 01 04 08 09 03 05 09 00 0b 0c 06 0d 08 0c 0a 0f 12 0e 0b 08 11 15 07 01 13 18 09 06 1b 04 20 11 03 11 14 05
23 0b 0d 07 08 22 01 24 0a 0f 0a 2c 2a 24 13 1e 13 07 1a 2e 36 2e 1b 0e 07 0c 28 31 01 21 19 26 11 13 36 20 17 30 21 2a
0c 0a 3e 07 1f 2f 0b 1d 1b 3c 3d 07 3c 32 04 23 18 1c 24 15 29 12 2f 0d 0f 0e 1c 23 0c 0d 24 28 27 2a 09 10 0a 17 27 11
1c 08 11 09 1b 0d 03 11 17 18 08 01 1d 0a 1a 17 01 11 13 08 04 0d 00 07 03 0b 01 01 09 00 09 09 04 01 09 09 08 06 06 01
03 03 02 04 03 03 02 01 00 01 00 01 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 01 00 01 00 01 00 00 02 03 03 03 01 02
01 01 03 01 07 08 09 05 03 08 08 0d 01 0c 04 10 11 10 02 0e 0c 11 11 06 0f 19 11 0f 07 06 10 19 0b 22 0f 22 15 02 1c 1a
01 07 1b 2b 2c 26 1b 09 2c 20 2c 30 12 31 2b 28 13 2c 2d 0c 22 2e 16 35 1e 18 1a 3c 0d 09 23 0d 37 26 0c 15 3a 30 3e 11
05 3e 2c 38 02 13 12 1c 2e 18 11 22 24 0e 18 1e 31 36 07 18 38 0b 36 1d 12 2e 30 0e 32 08 2a 10 23 1e 17 2b 0f 21 06 02
07 11 15 1f 19 0b 1d 01 06 11 0e 13 12 18 08 0f 14 04 09 05 0f 06 12 05 09 07 05 02 0b 00 0c 03 05 03 05 05 04 04 03 02
02 02 03 01 01 00 02 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 01 00 00 01 00 01 01 03 03 02 03 01
00 01 07 02 08 03 04 05 07 01 0a 0b 08 04 08 11 11 02 01 09 14 0e 15 08 01 13 10 1c 17 14 04 08 0c 04 11 23 19 11 10 00
1b 24 16 28 29 14 05 1e 19 18 29 24 2b 22 1c 21 0d 03 2a 2d 2e 11 24 1d 1f 0a 2e 19 1f 21 37 3a 3a 3e 0d 02 2d 08 2a 29
2b 14 18 3f 0d 08 3d 35 18 3c 2e 07 13 27 37 1b 34 29 19 04 2e 1c 25 21 29 01 06 0f 06 14 26 29 14 1a 00 0d 23 04 26 17
12 03 06 05 13 13 0c 00 18 04 10 06 0c 0d 09 1b 06 0c 12 05 04 05 12 11 06 03 06 00 03 02 06 08 02 02 06 03 07 00 03 06
05 04 03 00 03 01 02 01 01 02 01 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 01 00 00 01 02 01 02 01 04 00 03
06 03 06 04 04 05 01 08 02 01 09 02 0a 0e 06 11 0a 0c 01 05 05 14 0b 02 09 0a 07 0c 1c 13 19 20 1c 1d 10 1b 16 04 11 10
00 0b 16 08 09 18 14 11 1f 08 00 14 07 27 29 1a 02 25 20 34 08 36 24 30 13 28 25 3c 0b 21 0f 1f 2c 29 00 0f 36 11 1f 15
24 0f 0c 1a 2b 18 0b 1e 05 1a 3d 32 06 24 29 30 24 34 30 02 21 2c 14 1a 28 0c 17 24 1c 28 0c 19 0e 09 00 27 21 10 23 26
06 0e 24 26 01 08 04 1d 0c 10 05 1c 07 0f 13 06 08 03 13 08 01 13 06 03 09 0d 0e 09 02 09 0a 04 08 00 08 03 08 05 02 01
06 04 02 00 03 02 01 02 02 02 01 01 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 01 00 01 02 01 01 02 03 02 03 02 01
05 00 02 07 04 02 04 09 08 09 0b 02 08 02 0e 0b 12 02 13 0e 04 0b 07 14 19 0d 11 13 18 0d 14 0e 13 04 12 0c 1b 02 14 0d
09 07 26 10 1c 0e 16 11 1d 13 18 16 2a 24 11 06 28 34 00 32 0b 28 03 2e 23 24 0d 3d 2e 12 2e 21 2e 09 12 19 1e 38 3c 29
```
BASE 0x53e08 (192 = 64 RGB, 6-bit):
```
05 04 00 06 04 00 07 04 00 07 05 00 08 06 00 09 06 00 0a 07 01 0b 08 01 0c 08 01 0d 09 02 0e 0a 02 0f 0a 03 10 0b 04 11 0c 05 11 0d 05 12 0d 06
13 0e 07 14 0f 08 15 10 09 16 11 0a 17 12 0c 18 13 0d 19 14 0e 1a 15 0f 1b 16 11 1c 17 11 1c 18 12 1d 19 13 1e 1a 14 1f 1b 15 20 1c 15 21 1d 16
22 1e 17 23 1f 18 24 20 19 25 21 1a 26 23 1b 27 23 1b 28 25 1c 29 26 1d 2a 27 1e 2a 28 1f 2b 29 20 2c 2a 21 2d 2b 22 2e 2d 23 2f 2e 24 30 2f 25
31 30 25 32 31 26 33 32 28 34 33 29 35 34 2a 36 36 2b 37 37 2d 38 38 2e 39 39 30 3a 3a 32 3b 3b 34 3c 3c 35 3d 3d 37 3e 3e 39 3f 3f 3b 3f 3f 3f
```
TINT 0x53bc8 (576 = 3 x 64 RGB):
```
00 00 00 01 00 00 03 00 00 03 00 00 04 00 00 05 00 00 05 00 00 06 01 01 07 01 01 07 01 01 08 01 02 08 02 03 09 03 03 0a 03 04 0a 04 05 0b 05 06
0c 06 07 0c 07 08 0d 08 09 0e 08 0a 0e 09 0b 0f 0a 0b 10 0c 0d 12 0d 0e 14 0e 0f 15 0f 10 17 10 12 19 11 13 1b 13 14 1d 13 14 1f 14 15 21 15 16
23 16 17 25 17 17 27 17 17 29 18 18 2b 1a 19 2d 1b 19 2f 1b 1a 31 1d 1a 33 1e 1b 34 1f 1c 34 20 1e 35 22 1f 35 23 20 36 24 22 36 26 23 37 27 25
37 28 26 38 2a 28 38 2b 29 39 2c 2b 39 2e 2c 3a 2f 2e 3a 31 2f 3b 32 31 3b 33 32 3c 35 34 3c 37 36 3d 38 38 3d 3a 39 3e 3b 3b 3e 3d 3d 3f 3f 3f
02 03 05 02 03 06 03 04 07 03 05 08 04 06 09 05 07 0a 05 08 0b 06 0a 0c 07 0b 0d 07 0c 0e 08 0d 0f 09 0f 10 09 10 11 0a 11 12 0b 12 13 0c 14 14
0c 15 15 0d 16 15 0e 17 16 0f 18 16 10 19 17 11 1a 18 12 1b 18 13 1c 19 13 1d 19 14 1e 1a 15 1f 1a 16 20 1b 17 21 1b 18 22 1c 19 23 1d 1a 24 1d
1b 25 1e 1c 26 1e 1e 27 1f 1f 28 20 20 29 20 21 2a 21 22 2b 22 24 2c 23 25 2d 24 27 2e 25 28 2f 27 2a 30 28 2b 31 29 2d 32 2a 2e 33 2b 30 35 2d
31 36 2e 33 37 2f 34 38 31 36 39 32 37 3a 33 39 3b 35 39 3b 36 3a 3b 37 3a 3c 38 3b 3c 39 3c 3d 39 3c 3d 3a 3d 3d 3b 3d 3e 3c 3e 3e 3d 3f 3f 3f
02 00 04 02 00 04 02 00 05 02 00 05 02 00 06 02 00 06 03 01 07 03 01 07 03 01 08 03 02 08 03 02 09 04 03 09 04 03 0a 04 04 0a 05 04 0b 05 05 0b
06 06 0c 06 07 0c 07 08 0d 08 09 0d 09 0a 0e 0a 0b 0e 0b 0c 0f 0c 0d 0f 0d 0e 10 0e 0f 11 0f 10 12 10 11 13 11 12 15 12 13 16 13 14 17 14 15 18
15 16 19 16 17 1b 18 19 1c 19 1a 1d 1a 1b 1e 1b 1c 1f 1c 1d 21 1d 1e 22 1e 1f 23 20 20 24 21 21 26 22 23 27 23 24 28 24 25 29 25 26 2a 27 27 2c
28 28 2d 29 29 2e 2a 2b 2f 2c 2c 31 2d 2d 32 2e 2e 33 2f 2f 34 30 31 35 32 32 37 34 34 38 35 35 39 37 37 3a 39 39 3b 3a 3a 3d 3c 3c 3e 3f 3f 3f
```
LUT 0x1c1a7 (256, FEED decay):
```
00 00 00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0c 0d 0e 0f 10 11 12 12 13 14 15 16 17 17 18 19 1a
1b 1b 1c 1d 1e 1f 20 21 21 22 23 24 25 26 26 27 28 29 2a 2b 2b 2c 2d 2e 2f 30 30 31 32 33 34 34
35 36 37 38 39 39 3a 3b 3c 3d 3e 3e 3f 40 41 42 43 44 44 45 46 47 48 49 49 4a 4b 4c 4d 4e 4e 4f
50 51 52 53 53 54 55 56 57 58 58 59 5a 5b 5c 5d 5d 5e 5f 60 61 61 62 63 64 65 66 66 67 68 69 6a
6b 6b 6c 6d 6e 6f 70 70 71 72 73 74 75 75 76 77 78 79 7a 7a 7b 7c 7d 7e 7f 7f 80 81 82 83 84 85
85 86 87 88 89 8a 8a 8b 8c 8d 8e 8f 8f 90 91 92 93 94 94 95 96 97 98 99 99 9a 9b 9c 9d 9e 9e 9f
a0 a1 a2 a3 a3 a4 a5 a6 a7 a8 a8 a9 aa ab ac ad ad ae af b0 b1 b2 b2 b3 b4 b5 b6 b7 b7 b8 b9 ba
bb bc bc bd be bf c0 c0 c1 c2 c3 c4 c5 c5 c6 c7 c8 c9 ca ca cb cc cd ce cf cf d0 d1 d2 d3 d4 d4
```

## Checks done
- Timelines decoded from 0x17ce0 and 0xf2d0 (table in the summary); part-1 transitions match the recording
  (spider 49..62 s, "order ?" from 64 s, "NO order!" 72..87 s, "We are under control.." at 88..89 s).
- Python re-implementation of 0x1c504/0x1c558 and 0x1c34d decoded the COMA photo, the drawing and video frames 0..59
  correctly (images in scratchpad/c4/dec.png, vid.png).
- Palette cycler: rendered the COMA photo with BLEND(BASE, TINT, sin) for part-2 ticks 30/90/150 and compared to the
  recording at 91/93/95 s: red-brown, red-brown, teal match (scratchpad/c4/palcheck.png). The photo is grain-free at
  90..92 s (threshold 0x40 > max grain 31) and grainy from ~94 s, then heavily grainy/bright while 0x53810 ≈ -19
  ("the CONTROL" at 97..100 s), as the threshold arithmetic predicts.
- Not checked: exact 3D spider rendering (C3), frame rate in DOSBox.
