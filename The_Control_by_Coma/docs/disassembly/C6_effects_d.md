# C6: effects 0x54a2c, 0x54ec3, 0x54f64, 0x5506b, 0x55232, 0x55be8 and the end of the demo (part 2, T ≈ 165..380.5 s)

All addresses are code32 offsets (unpacked.bin offset = addr + 0xec0). u8/u16 = byte/word arithmetic mod 256/65536.
"tick" = part-2 tick (timer 0x1b7a4, table 0xf2d0). Recording time (cap2, the GUS run that capframe.py now reads):
**T = 90.50 + tick/30** (C1). I checked it with exact-seek decoding (`ffmpeg -i cap2/video0002.avi -ss T`):
- the gear appears at 172.45 (tick 2457 → 172.40);
- "END" appears at 354.1 (tick 7908 → 354.10).
(The older SB recording in cap/ has no load gap: T = 89.47 + tick/30 there.)

## Summary of the slice

This slice is the last third of the demo, ticks 2244..8700 of part 2. The routines in the title are only part of
it: the timeline installs many more effects that are not in control.lst. C1 §7/§8 already lists all of their scene
functions and sketches each effect. This file gives the exact per-frame pseudo-code for the ones in my slice.
It also adds what C1..C5 do not cover:
- 0x55121, the map-distortion renderer behind "system divines" and "nature";
- the corrections listed below;
- the exit path.

Corrections to the other notes (verified against the code bytes or against the recording):
1. **C5 rotozoom corners are swapped.** In 0x2879f, ecx keeps -c across the second `call 0x2d540`. So
   P1 (d[0x28735], d[0x28739]) = rotZ(**-c, -c+30**) and P2 (d[0x2873d], d[0x28741]) = rotZ(**c, c+30**). P0 = rotZ(c, -c+30) as C5
   says. The scan is a proper rectangle: start at P1 (top-left), step along x toward P0 (top-right) over 160 px,
   and along y toward P2 (bottom-right) over 120 rows (only 100 drawn). Everything else in C5's 0x2879f is right.
   See the bytes at 0x287be..0x2882c below.
2. **0x54e0b's `out 3d3, ax`** sets CRTC[9] = 6, so every memory line shows for 7 scanlines. C2 has this right and
   C1's "no effect" is wrong. The recording confirms it: bands are 3–4 capture rows tall. Consequence for this slice:
   in all mode-X effects only memory lines 0..56 of the page are visible.
   - Most of the text drawn into mode X never appears: "SCREAM", "with mask on your face ?", the 0x1bddc/0x1be99/0x1c086
     scrollers, and the 0x556ee/0x557ac captions.
   - Only "take it off" (line 20) is visible, plus the top 7 lines of "but how can you scream ?" and of 0x557ac's "SCREAM" (line 50).
3. 0x455c9 and 0x46f91 are not code. They are the vy[425] and vz[425] blocks of the 3D object whose header is at 0x43bf9
   (C3: the "crab", effect 0x526f0, part 1). Their only references are the pointer stores at 0x51a6e and 0x51a78 in
   setup routine 0x51a38. The disassembler's pointer heuristic took them for functions.
   0x402d6 is code: the cull/sort/draw stage of the 3D engine, documented in C3. Its only caller is 0x51d74 (the end of
   0x51c2f). 0x51c2f is called by the object setups:
   - 0x518e4 (effect 0x5264a), 0x5198e (0x52577), 0x51a38 (0x526f0) in part 1;
   - 0x51ace (my 0x55be8/0x55b6c) and 0x51b74 (0x55f1e) in part 2.
4. 0x0f8c0..0x17c50 (the "0x10000 routine" of the listing) is the part-2 timeline table 0xf2d0 (0x2260 dwords), not
   code (C2 agrees).

### Routines called (owner of the full description)
| addr | what | documented in |
|---|---|---|
| 0x1c2f8 | decay [0x1b262] (16000 B) through table 0x1c1a7 | C1 §9, C3 (table) |
| 0x1bb5c / 0x1bbac | opaque string into 256-stride texture [0x1b25a]+2 | C2 (font), C5 |
| 0x2879f (+0x2d540) | additive rotozoom into [0x1b262] 160x100 | C5 (with correction 1) |
| 0x1c314 | 160x100 → 320x200 2x2 upscale + [0x1c313] | C1/C2 |
| 0x53815 | grain add/clamp, self-modified count/add | C1 §9, C4 |
| 0x1bab5 / 0x1bafa | transparent string, 320 stride, colour (g<<2)+[0x1b882] | C2 |
| 0x52918 | present W → A000 (rows 0..198) | C1/C4 |
| 0x54e0b | mode X 320x(400/7) init | C2 (+ below) |
| 0x1afc4 / 0x1af4e / 0x1ad47 / 0x1af37 | RGB 3-stream delta video into the planes | C2, C1 §8 |
| 0x28623 / 0x286ce | 78xH → 320x4H lerp upscale | C5 |
| 0x1bddc / 0x1be99 / 0x1c086 / 0x1c0c1 | scroller text into B2 and onto the planes | C2 |
| 0x53929 | DAC[0..191] = RIX palette of the texture at [0x2d708] | C1 §9 |
| 0x55121 | map-distortion renderer | **here** |
| 0x28b2a | 160x100 RLE video frame [0x28b25] into W (2x, <<1) | C4 |
| 0x528f6 | W = 0 | C1 |
| 0x51ace / 0x51b74 → 0x51c2f → 0x402d6 → 0x2dc83 (+0x2d464/0x2d4d1/0x2d540/0x2d5ad) | gear object | C3 (+ below) |
| 0x28999 (+0x28970, 0x1c34d) | single-stream anim (48 rows), loops | C5 |
| 0x53ed8 | part-2 palette pulse of DAC 0xc0..0xff (ISR, when u8[0x1b7ff]==0) | C1 §9, C4 |
| 0x1b84d, 0x4be4, 0x51f35, 0x3f3 | exit path | C1 (+ below) |

## Timeline of this slice (part-2 ticks, T = 90.50 + tick/30)

| ticks | T | scene → effect | screen mode | what |
|---|---|---|---|---|
| 2244..2349 | 165.30..168.83 | 0x54911 → **0x54a2c** | 13h | text-texture rotozoom, "we will see.." |
| 2457..2530 | 172.40..174.87 | 0x55bc7 → **0x55be8** | 13h | gear #1 (3D, 0x51ace) |
| 2531..3632 | 174.87..211.60 | 0x54e78 → **0x54ec3** | X | RGB video AVI[14,15,16] (+ invisible scroller) |
| 3633..3739 | 211.60..215.17 | 0x54f41 → **0x54f64** | X | frozen RGB video + grain growing |
| 3740..3846 | 215.17..218.73 | 0x55032 → **0x5506b** | 13h | map distortion, tex AVI[18], " system divines" |
| 3847..3953 | 218.73..222.30 | 0x55202 → **0x55232** | 13h | map distortion, tex AVI[17], " nature" |
| 3954..4024 | 222.30..224.63 | 0x55032 → 0x5506b | 13h | system divines again |
| 4025..4296 | 224.63..233.70 | 0x55202 → 0x55232 | 13h | nature again |
| 4297..4523 | 233.70..241.27 | 0x552ae → 0x552f4 | X | RGB video AVI[19,20,21] |
| 4524..4665 | 241.27..246.00 | 0x5537c → 0x5539b | X | RGB video AVI[22,23,24] |
| 4666..4808 | 246.00..250.77 | 0x5540a → 0x5543c | X | frozen + grain (level 0x0c) |
| 4809..4899 | 250.77..253.83 | 0x55529 → 0x5558a | 13h | 160x100 video + grain + "Scream until / you are / FREE!" |
| 4900..5093 | 253.83..260.30 | 0x555fb → 0x55621 | X | RGB video FLI[0,1,2] |
| 5094..5235 | 260.30..265.03 | 0x556cf → 0x556ee | X | RGB video FLI[3,4,5] |
| 5236..5378 | 265.03..269.80 | 0x5578d → 0x557ac | X | RGB video FLI[6,7,8] |
| 5379..5451 | 269.80..272.23 | 0x5584b → 0x55b6c | 13h | gear #2 (same as #1, with mode reset) |
| 5452..5770 | 272.23..282.87 | 0x55c35 → 0x55c6d | X | RGB video FLI[12,13,14] |
| 5771..5984 | 282.87..290.00 | 0x55d31 → 0x55d69 | X | RGB video FLI[15,16,17] |
| 5985..6197 | 290.00..297.10 | 0x55e12 → 0x55e3d | X | RGB video FLI[9,10,11] + "take it off" (visible) |
| 6198..6518 | 297.10..307.77 | 0x5540a → 0x5543c | X | frozen + grain |
| 6519..6732 | 307.77..314.90 | 0x55ef6 → 0x55f1e | 13h | gear, pulsing distance (0x51b74) |
| 6733..7159 | 314.90..329.13 | 0x55f77 → 0x55fa4 | 13h | photo anim FLI[19], pulse-tinted |
| 7160..7907 | 329.13..354.07 | 0x55ef6 → 0x55f1e | 13h | gear again (init re-armed) |
| 7908..8699 | 354.07..380.50 | 0x56012 → 0x56021 | 13h | "END" |
| 8700 | 380.50 | main loop exits | text | DOS text mode + copyright line |

(Ticks 2350..2456 are C5's 0x54777/0x5486d; ticks 2137..2243 too.)

## Global state used by this slice

All of these persist across effects. The port must carry them from the earlier slices, and ideally simulate every
scene function from tick 0 of part 1. Each init flag is a byte at the address just before its effect, initially 0.

| addr | size | name | init | writers / notes |
|---|---|---|---|---|
| 0x52185 | d | effect fn | | scene fns |
| 0x1b7ff | b | pulseOff | 0 | 0 → ISR runs palette pulse 0x53ed8 on DAC 0xc0..0xff every tick. 0x55be8/0x55b6c set 1, 0x54e78 (every tick) 0, 0x552ae 0 (when it jumps to 0x54ebb), 0x55f1e 0x8d (every frame), 0x55f77 0 (every tick), 0x55fa4 0 (init) |
| 0x53f8a | b | frameAcc | 0 | shared 8-bit accumulator; ADV(r): `+= r; carry → d[0x28980] = d[0x28989]` |
| 0x28980 / 0x28985 / 0x28989 | d | vidReq / vidLast / vidNext | 0 | delta-video frame request, last decoded, next |
| 0x2897c, 0x1ad2d, 0x1ad31 | d | video item ptrs (R,G,B) | | set every frame by the RGB effects |
| 0x54e77 | b | textAcc | 0 | scroller step accumulator |
| 0x1bdd4 | d | scroller offset | 0 | into string lists 0x1bc04 / 0x1be09 / 0x1bec6 |
| 0x1bdd8 | d | text plane offset | 0x6a4a | VGA byte offset of the B2 text block inside the page |
| 0x1b882 | b | text colour base | 0 | 0xc0 since part-2 effects / 0x1bddc |
| 0x1ad24 | d | page | 0x7fd0 | drawn page; ^= 0x7d00 after each mode-X frame (pages 0x7fd0 / 0x02d0) |
| 0x53810 | b | grainTh | 0 | 0x0a when 0x54a2c runs (set by 0x54777) |
| 0x53822 | d | grain count (imm of `mov ecx` in 0x53815) | 0xfa00 | 0xa640 in 0x54f64/0x5543c, back to 0xfa00 in 0x5558a |
| 0x53840 | b | grain add (imm of `add [edi],0xc0`) | 0xc0 | 0 in 0x54f64/0x5543c, 0xc0 in 0x5558a |
| 0x5475e, 0x54762, 0x54766, 0x5476a | d | zoomA, zoomB, angA, angB | 0 | low byte only (u8 adds), see 0x54911 |
| 0x28769 | d | rotozoom zoom index | | = zoomA / zoomB before each 0x2879f |
| 0x28918 | b | rotozoom shift (imm of `shr al,3` at 0x28916) | 3 | 1 / 3 |
| 0x2d458, 0x2d45c, 0x2d460 | d | angX, angY, angZ (0..255) | 0 | **shared with the rotozoomer (angZ) and part 1**. The gear's orientation is whatever the earlier scenes left, plus the gear scenes' increments. See below. |
| 0x2d448, 0x2d44c, 0x2d450 | d | offX, offY, dist | | 0x51ace: 0, 0, 12000; 0x51b74: dist only |
| 0x2e965 | d | shadeMode | 0 | 1 from 0x51ace/0x51b74 (planar UV + shade OR) |
| 0x2d708 | d | texPtr | | 3D texture / 0x55121 texture / 0x53929 palette source |
| 0x5224a, 0x5224b | b | mapA, mapB | 0 | **shared with part 1** (every part-1 scene adc/adds them) and C5's 0x54575 |
| 0x55119, 0x5511a | b | phaseU, phaseV | 0 | only this slice |
| 0x55ef2 | d | gearPulse | 0 | u8 += 6 per tick in 0x55ef6 |
| 0x2861f | d | upRows | | 0x21 from 0x1afc4, 0x30 from 0x55fa4 |
| 0x20602 / 0x2060c | b | upShift / upAdd | | 2/0 for RGB video, 3/0xc0 for 0x55fa4 |
| 0x28b25 | d | 160x100 video frame | | VIDEO scene 0x55529 |

Angles at the gears: scene fns change only the low byte. The values come from:
- part-1 writers (C1);
- 0x53fe9 (`u8 angX += 0xfd; u8 angY += 1 + CF; u8 angZ += 2`, ticks 213..319);
- the rotozoomers, which **store the full dword**: 0x5486d/0x54a2c set angZ = d[0x54766] then d[0x5476a] on every frame. So
  gear #1 starts with angZ = angB as left by the last rotozoom frame (C5: angB = −3n). At tick 2457 that is the value
  after 0x54777's second run.

## Scene functions of the slice (per tick, from the ISR; CF = 1 on entry)

```
0x54911: effect=0x54a2c; u8 angA(0x54766) += 0xfe; u8 angB(0x5476a) += 1; u8 zoomA(0x5475e) += 0x41; u8 zoomB(0x54762) += 2
0x55bc7: effect=0x55be8; u8 angX += 1; u8 angZ += 0xff; u8 angY += 1
0x5584b: effect=0x55b6c; u8 angX += 1; u8 angZ += 0xfe; u8 angY += 1
0x54e78: effect=0x54ec3; ADV(0xc8)
         u8 textAcc += 0x1e; if carry { d[0x1bdd4] += 0x10; if d[0x1bdd4] >= 0x1b0: d[0x1bdd4] = 0 }
         u8 pulseOff = 0                                        // 0x54ebb, always reached
0x54f41: effect=0x54f64; t = frameAcc; frameAcc = u8(t - 0xc8); grainTh = u8(grainTh - (t < 0xc8));
         if (grainTh & 0x80) grainTh = 0
0x55032: effect=0x5506b; u8 mapA += 0xff; u8 mapB += 1; u8 phaseU += 1; u8 phaseV += 0xff
0x55202: effect=0x55232; u8 mapA += 1;    u8 mapB += 1; u8 phaseU += 2; u8 phaseV += 1
0x552ae: effect=0x552f4; ADV(0x50); u8 textAcc += 0x28;
         if carry { d[0x1bdd4] += 0x12; if d[0x1bdd4] < 0x5a: pulseOff = 0 else d[0x1bdd4] = 0 }
0x5537c: effect=0x5539b; ADV(0x50)
0x5540a: effect=0x5543c; u8 textAcc += 0x50; if carry { d[0x1bdd4] += 0x10; if >= 0x160: d[0x1bdd4] = 0 }
0x55529: effect=0x5558a; s = frameAcc + 0x64 + 1 (CF); frameAcc = u8(s); d[0x28b25] += (s > 255);
         if d[0x28b25] >= 0x3c: d[0x28b25] = 0               // "jb 0x2a0" = jump to a bare ret
0x555fb/0x556cf/0x5578d/0x55c35/0x55d31/0x55e12: effect = 0x55621/0x556ee/0x557ac/0x55c6d/0x55d69/0x55e3d; ADV(0x78)
0x55ef6: effect=0x55f1e; u8 angX += 2; u8 angZ += 0xfd; u8 angY += 0xfd; u8 gearPulse += 6
0x55f77: pulseOff = 0; effect=0x55fa4; ADV(0x1c); byte[0x55f1d] = 0      // re-arms 0x55f1e's init
0x56012: effect=0x56021
```
frameAcc on entry to 0x54e78:
- 0x546b3 zeroes it on its first frame.
- 0x5466a then adds 0x32 per tick (C5) until tick 2136. 0x54777/0x54911/0x55bc7 do not touch it.
- So frameAcc = u8(0x32 × number of 0x5466a ticks after that first frame), ≈ 0x32·213 mod 256 = 0x9a. It only shifts the
  phase of the frame advances.

## The effects

Buffers: W = [0x5606e] = 0x561b8 (320x200, 64000 B, contiguous); B2 = [0x56072] = 0x65bb8; ROT = [0x1b262]
(160x100); TEX64 = [0x1b25a] (256x256); rowAddr table 0x1b3bd (200 dwords, W + 320y).
Data items (C1 §10): AVI[k] = dword[0x1b170+4k] (+ DEMO.AVI base), FLI[k] = dword[0x1b0f8+4k] (+ DEMO.FLI base).

### 0x54a2c "we will see.." (ticks 2244..2349): byte-for-byte C5's 0x5486d with two other strings
```
decay(ROT)                                   // 0x1c2f8: ROT[i] = DECAY[ROT[i]], 16000 bytes
[0x1baa7] = 0x54938; drawString256(TEX64 + 2)  // 0x1bb5c: opaque glyphs (g<<2), 256 stride, CR = +25 rows (+5 more for CRCR)
rzShift = 1; d[0x28769] = d zoomA; angZ = d angA; rotozoom(TEX64)        // 0x2879f, see correction 1
rzShift = 3; d[0x28769] = d zoomB; angZ = d angB; rotozoom(AVI[13])      // [0x1b1a4], raw 256x256 at AVI 0x16ee09
byte[0x1c313] = 0; up2x(W)                   // 0x1c314
grain(W)                                     // 0x53815: count 0xfa00, +0xc0, grainTh 0x0a → W in 0xc0..0xff
[0x1baa7] = 0x54a1e "we will see.."; drawString320(W + 0xc805)   // row 160, x 5, colour 0xc0 + (g<<2)
present()                                    // 0x52918
```
Texture string 0x54938. Each '\r' (0x0d) starts a new line 25 texture rows lower, at x = 2:

    30542jesus92363441 / 98903529732dfgdfg144x / 409do8not34646343197 / 24235235534576362165 / 89523576547523555133 /
    409do8not34646343197 / 24235235534576362165 / 89523576547523555133 / 7control9y45745ou82 / f.gjdfgputweroyt9683 /
    FSDGJGmrwergrwe731255

- TEX64 is never cleared, so wherever these glyph boxes do not reach, it still holds C5's 0x547a5 text and the part-1
  plasma (C5).
- The colours are 0xc0..0xff, so the palette pulse (pulseOff = 0) tints the image.
- Recording: change rate 58 of 70 frames/s. The trail feedback is per frame, so match it to C5's frame-rate estimate.

### 0x55be8 gear #1 (ticks 2457..2530) and 0x55b6c gear #2 (ticks 5379..5451)
```
if (!byte[0x55be7]) {                // 0x55b6c: flag 0x5586b, and first does int10h(0x13) (cli; [0xe0]=0x13; int 33h al=0x10; sti)
  DAC[0..255] = 768 bytes at 0x5586c (out 3c8,0; rep outsb, under cli)
  pulseOff = 1
  texPtr = FLI[18] + 0x30a           // DEMO.FLI 0xca166: "RIX3" 256x256; pixels at +0x30a; values 1..15
  byte[0x55be7] = 1
}
clearW()                             // 0x528f6
gear(0x51ace): offX = 0; offY = 0; dist = 12000; shadeMode = 1; object = header 0x500d1 (N = 96, F = 156)
               → 0x51c2f (C3): rotate Z(angZ), X(angX), Y(angY), project, cull, sort, draw into W
present()
```
Gear object blocks: vx 0x500d9, vnx 0x50259, fnx 0x503d9, vy 0x50649, vny 0x507c9 (never read, C3 quirk), fny 0x50949,
vz 0x50bb9, vnz 0x50d39, fnz 0x50eb9, faces 0x51129 (F × 3 dwords). The gear is flat: |x|,|y| ≤ 6554, |z| ≤ 518.

shadeMode 1 (C3's 0x402d6):
- Per face: orMask = min(15, dot>>23) << 4.
- Per vertex: u = ((vx>>5)+0x40)&255, except **the first vertex of each face uses ((vx>>6)+5)&255**;
  v = ((vy>>5)+0x40)&255. These are the unrotated object coordinates read from the hard-wired blocks 0x500d9/0x50649.
  That makes the texture stick to the object, and the first-vertex quirk makes it look streaky.
- Pixel = tex[v*256+u] | orMask.

DAC 0x5586c holds 16 brightness blocks of 16 entries: block = shade (orMask>>4) and entry = texel. Block 0 is near
black, block 15 is near white with a blue tint. Copy the 768 bytes (unpacked.bin 0x5672c).
The pulse is off, so the DAC stays fixed. Row 199 of A000 is never written (part-2 start: 0xc0, shown in that DAC; after a mode reset: 0).
Recording: the gear first shows at 172.45 (gear #1) and 270.2 (gear #2).

### 0x55f1e gear #3 (ticks 6519..6732, 7160..7907)
```
if (!byte[0x55f1d]) { cli; int10h(0x13); DAC[0..255] = 0x5586c; sti; texPtr = FLI[18]+0x30a; byte[0x55f1d] = 1 }
pulseOff = 0x8d                      // every frame
clearW()
0x51b74: dist = 30000 + SIN[d gearPulse] * 8      // SIN = d[0x2ca18+4i]; gearPulse low byte += 6 per tick
         shadeMode = 1; offX/offY = 0 (left by 0x51ace); object 0x500d1; → 0x51c2f
present()
```
dist ranges 13616..46384, so the gear "breathes" over a 256/6 ≈ 42.7-tick period. Since 0x55f77 re-arms the flag, the
second run re-does the mode set and the DAC load.

### 0x54ec3 RGB video #1 (ticks 2531..3632), and its siblings
```
if (!byte[0x54e76]) { byte[0x54e76] = 1; vidNext = 0; vidReq = 0; setRGBMode() /*0x54e0b*/ }
[0x2897c] = AVI[14]; [0x1ad2d] = AVI[15]; [0x1ad31] = AVI[16]     // 209-frame R, G, B streams
upShift = 2; upAdd = 0
rgbVideo()                         // 0x1afc4 (C2): decode at most one new frame, lerp-upscale each channel to 320x132,
                                   // write lines 3r+c (c = 0 R, 1 G, 2 B) of page d[0x1ad24], colours 64c + value
memset(B2, 0, 16000)
scroller()                         // 0x1bddc: string 0x1bc04 + d[0x1bdd4] (16-byte entries), colour base 0xc0 → B2,
                                   // then 0x1c0c1 copies the non-zero bytes of B2 lines 0..49 to page + d[0x1bdd8]
showPage()                         // 0x1af37: CRTC 0x0c/0x0d = d[0x1ad24] (no retrace wait)
d[0x1ad24] ^= 0x7d00
```
- **The display shows lines 0..56 only** (CRTC[9] = 6, C2), i.e. the top 19 video rows of 132.
- 320x200 output row y shows page line floor(2y/7).
- The scroller sits at line 340 (offset 0x6a4a) and is invisible.

Pacing: the video advances one frame per ADV carry, but at most one per drawn frame. When two carries fall between
frames, vidReq is just set twice to the same vidNext. It clamps on the last frame (vidNext stops at count−1).
- C2 measured 14.3 video fps from 173.9 s, so the effect runs slower than the 23.4 carries/s.
- The port needs the original's frame rate here. Recording change rate is ≈ 32/s at 176–181 s, then 0 changes/s while
  the clamped last frame shows (≈ 195–210 s).

The siblings differ only in their streams, init and text. These are C1's sketches, confirmed:

| effect | init (once) | streams R,G,B | text (lines visible?) |
|---|---|---|---|
| 0x552f4 | vid reset, setRGBMode, d[0x1bdd4]=0 | AVI[19,20,21] (30 fr) | 0x1be99: list 0x1be09 (18-byte entries), offs 0x6a4a: invisible |
| 0x5539b | vid reset, d[0x1bdd4]=0 | AVI[22,23,24] (29 fr) | none, and no B2 clear |
| 0x55621 | vid reset, setRGBMode, d[0x1bdd4]=0 | FLI[0,1,2] (40) | "SCREAM" at 0x67a2 (line 331): invisible |
| 0x556ee | vid reset | FLI[3,4,5] (45) | "SCREAM" at 0x2594 (line 120): invisible |
| 0x557ac | vid reset | FLI[6,7,8] (37) | "SCREAM" at 0xfb4 (line 50, x 80): top 7 lines visible |
| 0x55c6d | vid reset, setRGBMode, DAC[0xc0..0xff]=(i,i,i), d[0x1bdd4]=0 | FLI[12,13,14] (126) | "but how can you\rscream ?" at 0xfa2 (line 50, x 8): top 7 lines visible |
| 0x55d69 | vid reset, d[0x1bdd4]=0 | FLI[15,16,17] (52) | "with mask on\ryour face ?" at 0x4e20 (line 250): invisible |
| 0x55e3d | vid reset, d[0x1bdd4]=0 | FLI[9,10,11] (48) | "take it off" at 0x64a (line 20, x 40): visible, 7x tall |

The fixed-text effects run:
`memset(B2,0,16000); [0x1baa7]=str; d[0x1bdd8]=offs; [0x1b882]=0xc0; drawString320(B2); copyTextToPlanes() /*0x1c0c1*/`.
They run it after rgbVideo and before showPage. The text colours are DAC 0xc0..0xff, and the pulse is on (pulseOff = 0 from the scene).

Byte offsets are relative to the page and use 80 bytes per line. A B2 pixel at (x, y) for y < 50 lands at plane byte
offs + 80y + x/4, i.e. page line (offs + 80y + x/4) div 80. Text near the right edge wraps into the next line.

### 0x54f64 frozen video + grain (ticks 3633..3739); 0x5543c is the same with level 0x0c and text
```
if (!byte[0x54f63]) { byte[0x54f63] = 1; grainTh = 0x40 }      // the scene's first tick already ran
d[0x53822] = 0xa640; byte[0x53840] = 0                          // SELF-MOD grain: 42560 bytes (133 lines), no +0xc0
for c in 0..2:                                                  // planes [0x28b88], [0x28b8c], [0x28b90] (last decoded frame)
  upscale4x(plane c → W)        // 0x28623 with upRows 0x21, upShift 2, upAdd 0 as left by 0x1afc4
  grain(W)                      // W[i] = min(u8(W[i] + max(0,(int8)(NOISE[ph+i] - grainTh))), 0x3f) + 0
  d[0x1ad28] = 0x50*c; byte[0x1ad28+4 = 0x1ad2c] = 0x40*c; writePlanes()   // 0x1ad47, 132 lines, stride 3
showPage(); d[0x1ad24] ^= 0x7d00
```
- The grain source and phase are the same for all three channels, so the noise is grey/white.
- grainTh starts at 0x40 and falls by 1 per scene borrow, about 0.78/tick (0xc8/256 per tick), clamped at 0. That is
  ≈ 82 ticks to 0, so the grain grows.
- Recording: ≈ 12 drawn frames/s.

0x5543c (C1 §8):
- grainTh = 0x0c every frame. Its init only zeroes d[0x1bdd4], once.
- It draws text with 0x1c086 (list 0x1bec6, 16-byte entries, offs 0x2bcf = line 140, invisible).
- It runs `memset(B2,0,16000)` before the text, and its planes are the last frame of the preceding RGB effect.

### 0x5506b " system divines" (ticks 3740..3846, 3954..4024) and 0x55232 " nature" (3847..3953, 4025..4296)
```
0x5506b:
  byte[0x55229] = 0                                  // re-arm 0x55232's init
  if (!byte[0x55059]) {
    byte[0x55059] = 1
    if (!byte[0x5505a]) { byte[0x5505a] = 1; int10h(0x13); DAC[0xc0+i] = (i,i,i) for i < 64 }  // only the very first time
    texPtr = AVI[18] + 0x30a                         // RIX3 at DEMO.AVI 0x26a132
    setPalRIX()                                      // 0x53929: DAC[0..191] = 576 bytes at texPtr - 0x300
    overscan = 0xc0                                  // in 3da; out 3c0,0x31; out 3c0,0xc0 (border colour, not in the capture)
  }
  mapRender(esi = AVI[6], edi = W, ebp = texPtr)     // 0x55121
  drawString320(W + 0xc805, " system divines")        // 0x5505b, row 160, x 5, base [0x1b882] = 0xc0
  present()
0x55232: same, but with flag 0x55229, re-arms byte[0x55059] = 0, NO mode set and NO grey ramp,
         texPtr = AVI[17] + 0x30a (RIX3 at 0x259e28), text " nature" (0x5522a)
```

**0x55121 mapRender** (esi = map M, 2 × 64 KB at DEMO.AVI 0xa8d1d; edi = W; ebp = texture T, 256x256):
```
Aoff = u8((SIN[phaseU] >> 6) + 0x20)        // SIN = d[0x2ca18 + 4i], sar → -32..32 → Aoff 0..64      → byte[0x5511c]
Boff = u8((COS[phaseV] >> 6) + 0x30)        // COS = d[0x2ce18 + 4i] → 16..80                              → byte[0x5511e]
for (y = 0; y < 100; y++)                   // byte[0x5511d]
  for (x = 0; x < 160; x++) {               // byte[0x5511b]
    cl = u8(x + Aoff); ch = u8(y + Boff); if (ch == 0xff) ch = 0        // never happens (ch ≤ 179)
    i  = ch*256 + cl
    lo = u8(M[i] + mapA);          lo = lo >> 0; lo = u8(lo + byte[0x5511f])   // shift imm (0x55194) and 0x5511f are 0: no-ops
    hi = u8(M[i + 0xff00] + mapB); hi = hi >> 0; hi = u8(hi + byte[0x55120])   // 0x551a3 and 0x55120: 0, never written
    p  = T[hi*256 + lo]
    W[(2y)*320 + 2x] = W[(2y)*320 + 2x+1] = W[(2y+1)*320 + 2x] = W[(2y+1)*320 + 2x+1] = p
  }
u8 mapA += 1; u8 mapB += 1; u8 phaseU += 3; u8 phaseV += 2     // PER FRAME (on top of the scenes' per-tick changes)
```
- The second lookup M[i + 0xff00] reads map row ch+255: row 255 of the first 64 KB for ch = 0, otherwise row ch−1 of
  the second 64 KB.
- The whole W (200 rows) is written; row 199 is not presented.
- The texture's own palette covers 0..191 (pixel values ≥ 192 would show pulse colours). The text uses 0xc0+ with the
  pulse on.

Checked: rendering this with mapA = mapB = phase = 0 gives the same ring/tunnel picture as the recording at 216.5 s, and
the caption position matches.

**Frame-rate dependence.** mapA/mapB/phaseU/phaseV change per frame here, while the scenes change them per tick, so the
scroll speed depends on the original's frame rate. The recording changes on every captured frame (70/s at 215–224 s),
so the effect ran at ≥ 70 fps (≥ 2.3 frames per tick); I could not pin the exact rate. The port needs a frames-per-tick
constant for this effect, tuned so the scroll speed matches.
mapA/mapB enter with part-1 history: every part-1 scene does `adc u8[0x5224a],0; add u8[0x5224b],1` (C1), plus
0x54575's +3/−1 per tick (C5).

### 0x5558a "Scream until you are FREE!" (ticks 4809..4899)
C1 §8 is complete. Exact order:
1. once: `d[0x1bdd4] = 0; cli; int10h(0x13); sti`.
2. Every frame:
   - grainTh = 4;
   - videoFrame() (C4 0x28b2a: RLE frame d[0x28b25] of DEMO.AVI item [0x1b17c] + table 0x28a31 → 160x100 at [0x28b88], then 2x2 into W as v<<1);
   - restore grain: d[0x53822] = 0xfa00, byte[0x53840] = 0xc0;
   - grain(W) → 0xc0..0xff;
   - text 0x55559 at W + 0x3223 (row 40, x 35), base 0xc0;
   - present.

The frame index runs at 0x65/256 per tick (11.8 fps) and wraps at 60. The pulse is on, so the tint shifts sepia → green
(recording at 251..253 s).

### 0x55fa4 photo anim (ticks 6733..7159)
```
once (flag 0x55fa3): vidReq = 0; vidNext = 0; pulseOff = 0; DAC[0xc0+i] = (i,i,i), i < 64
[0x2897c] = FLI[19] (DEMO.FLI 0xda470: 50 frames, 78x48, values 0..7 here)
d[0x2861f] = 0x30; upShift = 3; upAdd = 0xc0
animStep()          // 0x28999 (C5): decode at most one frame, upscale4x → W rows 0..191, rows 192..211 = 0xc0 (overruns W by 12 rows into B2)
present()
```
- ADV(0x1c) gives 3.28 carries/s, so ≈ 46 frames over the 427 ticks. The anim wraps after frame 49 (not reached).
- Pixel values are (v<<3)+0xc0 with v ≤ 7, interpolated. Delta drift could push a value past 7; then (v<<3) ≥ 64 indexes past LERP4 (C5's overflow note).
- The pulse is on, so the photos are tinted by the three cycling palettes (sepia / rose / green in the recording).

### 0x56021 "END" (ticks 7908..8699)
```
DAC[0xc0+i] = (i,i,i) for i < 64          // every frame
memset(W, 0, 64000)                        // 0x3e80 dwords
drawString320(W + 0x5802, "END")           // 0x5601d, row 70 (0x5802 = 70*320 + 130), x 130, base 0xc0
present()
```
pulseOff is still 0x8d from 0x55f1e, so nothing touches the DAC and "END" is grey-white (colours 0xc0 + 4g). The
recording shows a static frame (0 changes/s at 360–365 s).

### End of the program (main 0x56146..0x56177)
When tick ≥ 0x21fc (8700), or when port 0x60 reads scancode 1 (ESC), at any time in part 1 or part 2:
```
restoreTimer()                 // 0x1b84d: IRQ0 vector back, PIT divisor 0 (18.2 Hz)
int10h(0x03)                   // [0xe0] = 3; int 33h al=0x10 → 80x25 text mode, screen cleared
musicCmd(3)                    // 0x4be4 eax=3: stop the player
dosPrint(0x5617c)              // 0x51f35: int 21h AH=9 via int 33h al=0x21, '$'-terminated
exit                           // jmp 0x3f3 (PMODE: restore vectors, PIC masks, return to DOS)
```
Printed text: 16 spaces + "The Control   -   Copyright (c) 1996 Coma" + CR LF.
video0003.avi (720x400 text mode, 13 s) shows it on row 0, then a blank line and the `C:\>` prompt from COMMAND.COM.
The port can end on that text screen.

## 0x54e0b setRGBMode (as used here)
C2 has it in full:
- PEL mask 0;
- SEQ4 = 6;
- CRTC 0x14 = 0, 0x17 = 0xe3, 9 = 0;
- `out 3d3, 0x4006` makes CRTC[9] = 6 and leaves index 0x40;
- map mask 0xf, clear the 256 KB;
- DAC[0..191] from 0x54b0b;
- PEL mask 0xff.

Called once by 0x54ec3, 0x552f4, 0x55621 and 0x55c6d (each with its own flag).
DAC 0x54b0b, with r[k] (k = 0..63) = 0,1,2,3,4,6,7,8,10,11,12,14,15,17,18,19,21,22,23,25,26,27,29,30,31,33,34,35,37,38,40,41,
42,44,45,46,48,49,50,52,53,54,56,57,59,60,61,63, then 63 ×16, and w[k] = 0 for k < 48, else
3,7,11,15,19,23,27,30,34,38,42,46,50,54,58,63:
- entry k = (r[k], w[k], w[k]) (red);
- 64+k = (w[k], r[k], w[k]) (green);
- 128+k = (w[k], w[k], r[k]) (blue).

The int10h(0x13) resets (0x5506b once, 0x5558a, 0x55b6c, 0x55f1e) are needed to leave mode X. They also reset the DAC
to the BIOS default and clear VRAM, so A000 row 199 is 0 from then on.

## Bytes for correction 1 (0x2879f)
```
287b8 mov [0x2d424], ecx        ; x = c
287be neg ecx                   ; ecx = -c
287c0 mov [0x2d428], ecx ; 287c6 sub [0x2d428], -0x1e   ; y = -c+30
287cd call 0x2d540 → 0x2872d/0x28731 = P0 = rotZ(c, -c+30)
287e6 mov [0x2d424], ecx        ; x = -c   (ecx not touched by 0x2d540)
287ec mov [0x2d428], ecx ; 287f2 sub ..., -0x1e          ; y = -c+30
287f9 call 0x2d540 → 0x28735/0x28739 = P1 = rotZ(-c, -c+30)
28812 neg ecx                   ; c
28814 mov [0x2d424], ecx ; 2881a mov [0x2d428], ecx ; 28820 sub ..., -0x1e   ; (c, c+30)
28827 call 0x2d540 → 0x2873d/0x28741 = P2 = rotZ(c, c+30)
```

## Tables (copy from unpacked.bin = addr + 0xec0)
| addr | size | content |
|---|---|---|
| 0x5586c | 768 | gear DAC (16 shade blocks × 16) |
| 0x54b0b | 576 | RGB-mode DAC (formula above) |
| 0x54938 | 0xe6 | rotozoom texture string (above) |
| 0x54a1e, 0x5505b, 0x5522a, 0x55559, 0x5561a, 0x55c54, 0x55d50, 0x55e31, 0x5601d | ASCIIZ | "we will see..", " system divines", " nature", "   Scream until\r      you are  \r\r       FREE!   ", "SCREAM", "but how can you\rscream ?", "with mask on\ryour face ?", "take it off", "END" |
| 0x1bc04 | 27 × 16 | scroller of 0x54ec3 (invisible) |
| 0x1be09 | 5 × 18 | scroller of 0x552f4 (invisible) |
| 0x1bec6 | 22 × 16 | scroller of 0x5543c (invisible) |
| 0x5617c | '$'-string | exit message |
| 0x2ca18 / 0x2ce18 | 256 dwords each | SIN/COS = round(2048·sin/cos(2πi/256)) (C3) |

## Checks done
I made the following checks with exact-seek ffmpeg decoding (`-i file -ss T`) on cap2/video0002.avi and capframe.py.

**Scene times**
- Gear #1 at 172.45 and END at 354.1 match T = 90.50 + tick/30.
- On the older SB recording, "we will see.." spans 164.3–167.8, the gear 171.4 and Scream 249.8. Those match
  T = 89.47 + tick/30 (no load gap there).

**Mode-X effects**
- RGB bands are 4,3,4,3… capture rows (CRTC[9] = 6).
- The scroller text never appears; "take it off" appears at lines 20+, stretched 7x.

**0x55121 and text**
- The 0x55121 model renders the same picture as the recording at 216.5.
- " system divines" appears at row 160, x 5.

**END and exit**
- "END" is static, at row 70, x 130.
- video0003.avi shows the copyright line, then `C:\>`.

**Data**
- The DEMO.FLI/AVI items have the frame counts quoted above; header = count, key offset, count+1 delta offsets.
- The photo anim keyframe values are 0..7.
- The gear texture values are 1..15 (0 never occurs), which fits the shade-OR palette layout.

**Frame-change rates per second** (an upper bound on drawn frames; the capture is 70/s):

| effect | rate |
|---|---|
| 0x54a2c | 58 |
| gear | 42–52 |
| 0x54ec3 | 32 |
| 0x54f64 | 12 |
| 0x5506b / 0x55232 | 70 (saturated) |
| 0x552f4 | 8.6 |
| 0x5539b | 11 |
| 0x5543c | 18 |
| 0x5558a | 61 |
| 0x55621 / 0x556ee / 0x557ac | 10 / 20 / 33 |
| 0x55c6d | 16 |
| 0x55d69 | 8 |
| 0x55e3d | 31 |
| 0x55fa4 | 44 |
| END | 0 |

Only 0x54a2c (trail feedback), the RGB/anim video pacing (one frame per drawn frame at most) and 0x55121 (per-frame
increments) depend on these rates. Everything else is tick-driven.

Unclear / GUESS:
- The exact frames-per-tick of 0x55121 and 0x54a2c in the original run.
- Whether any stale-memory edge cases (C3/C5 notes) are visible in this slice. I saw none.
