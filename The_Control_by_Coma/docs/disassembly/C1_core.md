# C1: program core — main, init, timers, tick tables, scene functions, palette helpers, data-file map, frame buffers

All addresses are code32 offsets (unpacked.bin offset = code32 + 0xec0). "u8" = byte arithmetic mod 256.
"tick" = timer counter dword [0x1b707]. Initial values come from peek.py (BSS = 0).
Checked against the recording (video0002.avi, 380.50 s, 70.086 fps) — see section 12.

## 0. Summary

- The demo has TWO parts, each with its own 30 Hz timer handler and its own timeline table:
  - part 1: ISR 0x1b800, table 0x17ce0, music module 1 "anagnosis"; main loop until tick >= 0xa7c (2684 = 89.47 s).
  - part 2: ISR 0x1b7a4, table 0xf2d0, music module 2 "anamnesis" (loaded between the parts); tick is RESET to 0;
    main loop until tick >= 0x21fc (8700 = 290.0 s).
  - In the recording: part-1 tick t is at T = t/30 s; part-2 tick t is at **T = 90.50 + t/30 s** (gap of ~1.03 s
    while the second module is read from CONTROL.EXE and uploaded to the sound card). End = 90.50 + 290.0 = 380.50 s
    = the length of video0002.avi (the brief's "379.5 s" is 2684+8700 ticks = 379.47 s of timer time; the extra
    ~1 s is the load gap). Nothing else drives time: both timers are 30.0007 Hz (PIT divisor 39772), and no visual
    code reads the music player's state.
- Each tick the ISR calls the scene function `table[tick]` (tick already incremented, so table[0] is never called).
  Scene functions install the per-frame effect in [0x52185] and advance animation counters (8.8 fixed-point
  accumulators: a byte fraction whose carry bumps another variable) — so animation speed is tick-driven.
  The main loop calls `[0x52185]` as fast as it can; there are NO retrace waits anywhere (3da is read only to reset
  the attribute flip-flop). Effect one-shot init uses a "first call" flag byte per effect.
- **Carry quirk**: every scene function is entered with CF=1 (the ISR's `cmp eax, limit; jae skip` falls through
  with CF set, `mov`/`call` keep it). It matters only where the first arithmetic op is `adc`: 0x55529
  (`adc byte [0x53f8a], 0x64` adds 0x65).
- Routines called from this slice (owned elsewhere unless described here):
  0x1c2a7/0x1c2c2/0x1c2f8 (decay via table 0x1c1a7, described here), 0x1c314 (2x upscale, described), 0x1c504 (RLE
  picture), 0x1bab5 (text), 0x28b2a (160x100 video), 0x28999/0x28970/0x28623/0x2879f (frame-animated object
  "morphs"), 0x1afc4/0x1af4e/0x1ad47/0x1af37/0x1bddc/0x1be99/0x1c086/0x1c0c1 (mode-X triple-object effects),
  0x518e4/0x5198e/0x51a38/0x51ace/0x51b74 (textured 3D objects), 0x52982 (lerp, described), 0x53815/0x53847
  (grain, described), 0x53929 (palette from RIX, described), 0x53ed8 (part-2 palette pulse, described),
  0x54e0b (mode X init, described), 0x55121 (effect of 0x5506b/0x55232), music 0x4be4.

## 1. Global variables

| addr | size | name | init | notes |
|---|---|---|---|---|
| 0x1b707 | d | tick | 0 | ++ in ISR, reset to 0 by 0x1b724 / 0x1b75f |
| 0x1b705 | w | PIT divisor | 0x9b5c (39772) | 1193182/39772 = 30.0007 Hz |
| 0x52185 | d | current effect fn | 0x52343 | called once per main-loop iteration |
| 0x5606e | d | W = work buffer | 0x561b8 | 64000 bytes (320x200, stride 320), BSS |
| 0x56072 | d | B2 = second buffer | 0x65bb8 | 64000 bytes, BSS |
| 0x1b256 | d | screen | set to 0xa0000-[0x18] | A000:0000 |
| 0x1b25a | d | TEX 256x256 | alloc 0x10000 | built by 0x522b5 |
| 0x1b25e | d | buffer 64000 | alloc 0xfa00 | lerp source for 0x52982 |
| 0x1b262 | d | buffer 64000 | alloc 0xfa00 | 160x100 image used by 0x1c2f8/0x1c314 |
| 0x529f4 | d | LERP64 table | alloc 0x40000 | built by 0x52a0a |
| 0x529f8 | d | lerp t for 0x52982 | 0 | |
| 0x53811 | d | NOISE buffer | alloc 0x4e200 | 5 x 64000, built by 0x538a8 |
| 0x5380c | d | noise phase | 0 | += 0xc1c per tick mod 0x3e800 (both ISRs) |
| 0x53810 | b | grain level | 0 | subtracted from noise (bigger = less grain) |
| 0x53f8a | b | frame-rate accumulator | 0 | carry advances animations/videos |
| 0x28980 / 0x28989 | d | anim frame shown / next | 0 | set [0x28980]=[0x28989] to advance one frame |
| 0x28b25 | d | video frame (0x28b2a) | 0 | wraps at 0x3c (60 frames) |
| 0x1b7ff | b | part-2 palette-pulse disable | 0 | 0 = ISR calls 0x53ed8 each tick |
| 0x522f5 | b | part-1 fade level | 0x40 | palette 0xc0.. minus level |
| 0x522f6 | b | fade fraction | 0 | |
| 0x5224a / 0x5224b | b | TEX scroll u / v | 0 / 0 | |
| 0x522f7 | b | fraction for 0x5224a | 0 | |
| 0x522f8 | b | fraction for 0x56077 | 0 | |
| 0x56077 | b | sine phase for [0x52249] | 0 | |
| 0x52249 | b | brightness bias | 0 | = sin[[0x56077]] >> 1, set by 0x5224c |
| 0x2d448/0x2d44c/0x2d450 | d | 3D object position (x?,y?,z?) GUESS | 0 | |
| 0x2d458/0x2d45c/0x2d460 | b (sometimes written as d) | 3D object angles GUESS | 0 | |
| 0x2d708 | d | current texture = RIX item + 0x30a | 0 | palette = [0x2d708]-0x300 |
| 0x1baa7 | d | text string ptr for 0x1bab5 | | |
| 0x1b882 | b | text colour base (glyph*4 + base) | 0 | |
| 0x1ad24 | d | mode-X CRTC start address | 0x7fd0 | toggled ^0x7d00 after each mode-X frame |
| 0x51d7a/7b/7c | b/b/w | sound card type / IRQ / port | 0/7/0x220 | |
| 0x51e6f | d | music module buffer | alloc 0x86470 | |

## 2. main (0x5607b)

```
sti
init_sound_config()           // 0x51e77
load_data()                   // 0x1b27d
load_module1_and_init_player()// 0x5208f
int10h(ax=0x13)               // [0xe0]=0x13; int 0x33 al=0x10 = PMODE real-int 10h -> mode 13h (clears VRAM, default palette)
DAC[0x80..0xbf] = (i,i,i) for i=0..63   // grey ramp, out 3c8=0x80 then 3x i per entry
memset(A000 + 0xf8c0, 0xc0, 320)       // row 199 = colour 0xc0 (never rewritten by the 199-row blits)
in 3da; out 3c0,0x31; out 3c0,0xc0      // attribute reg 0x11 (overscan/border) = colour 0xc0 (PAS bit set)
start_music_gus_pan()         // 0x52124
install_timer_part1()         // 0x1b75f: ISR 0x1b800, PIT 30 Hz, tick = 0
do { call [0x52185] } while (in(0x60) != 1 /*ESC*/ && tick < 0xa7c)
   (ESC -> goto quit)
player(3)                     // stop music
restore_timer()               // 0x1b84d
cli
[0x52185] = 0x53fb0
load_module2_and_init_player()// 0x52021 (ends with sti)
start_music_gus_pan()         // 0x52124
DAC[0xc0..0xff] = (i,i,i) i=0..63   // grey ramp
install_timer_part2()         // 0x1b724: ISR 0x1b7a4, tick = 0
do { call [0x52185] } while (in(0x60) != 1 && tick < 0x21fc)
quit:
restore_timer(); int10h(ax=3); player(3); print("The Control - Copyright (c) 1996 Coma") ; exit (jmp 0x3f3)
```
The mode is never re-set between the parts. Order matters for the port: the first effect frame of part 2
(0x53fb0) runs right after tick 0 starts.

## 3. Init

### 0x51e77 init_sound_config
Prints the banner (0x51d7f). 0x51f66 searches the DOS environment for "ULTRASND": if found, port = first number
parsed in hex -> [0x51d7c], 2 numbers skipped, 4th number (decimal) -> [0x51d7b] (IRQ), [0x51d7a]=1 (GUS), return.
Otherwise menus: card = key-'1' -> [0x51d7a] (0 SB, 1 GUS, 2 SB Pro; >2 e.g. 'Q' returns at once = no sound);
IRQ = {2,3,5,7,11,15}[key-'1'] -> [0x51d7b]; port = {0x210..0x260}[key-'1'] -> [0x51d7c]. Irrelevant to the port.

### 0x1b27d load_data
```
[0x1b256] = A000
memset(W, 0, 64000)
AVI = alloc(size("demo.avi")); read whole file; for i in 0..29: [0x1b170+4i] += AVI   // 25 used, 25..29 are 0 -> = AVI
FLI = alloc(size("demo.fli")); read; for i in 0..19: [0x1b0f8+4i] += FLI
[0x529f4] = alloc(0x40000); build_lerp64()          // 0x52a0a
[0x53811] = alloc(0x4e200); build_noise()           // 0x538a8
for y in 0..199: dword[0x1b3bd + 4y] = W + 320*y    // row table
[0x1b25a] = alloc(0x10000); [0x1b25e] = alloc(0xfa00); [0x1b262] = alloc(0xfa00)
memset([0x1b25a], 0, 0xbd00*4)   // 0x2f400 bytes: clears all three (bump allocator 0x2b9 is contiguous)
build_lerp4()                                         // 0x286ce
```
Allocation failure -> 0x51f13 prints "Not enough memory!" and exits.

### 0x52a0a build_lerp64  -> table L at [0x529f4], 64x64x64 bytes
```
for a in 0..63: for b in 0..63:
   step16 = int8(b - a) * 4            // (ax=b-a; shl ax,8; sar ax,6)
   acc = a<<8                           // al=a, dl=0
   for i in 0..63: acc += step16; L[a*4096 + b*64 + i] = (acc >> 8) & 0xff
=> L[a][b][i] = a + floor((i+1)*(b-a)/64)     (exact; i=63 gives b, i=0 gives a + (b-a)/64)
```
### 0x286ce build_lerp4 -> table at 0x1c602, 64x64x4 bytes (used by the mode-X renderers, other slice)
`T4[a*256 + b*4 + k] = a + floor((k+1)*(b-a)/4)`, a,b in 0..63, k in 0..3 (same 8.8 accumulation, step = int8(b-a)*64).

### 0x538a8 build_noise -> NOISE (5 frames of 320x200, values 0..31)
```
eax = ebx(bl) = 0
for f in 0..4 (ebp = 200*f): for y in 0..199: for x in 0..319:
   r  = in(0x40)                              // PIT counter low byte = effectively RANDOM
   al = u8(r + byte[0x2ca18 + 4*r])           // (eax upper bits are 0)
   al = u8(al + byte[0x52a80 + al])           // 256-byte random table
   bl = u8(bl + al)                           // running sum, never reset
   r2 = in(0x40); al = u8(r2 + byte[0x52a80 + r2]); al = u8(al + bl)
   al >>= 2                                   // 0..63
   al = al - byte[0x52b80 + y + ebp]          // 1000-byte per-row (5x200) attenuation table
   if (int8)al < 0: al = 0
   NOISE[f*64000 + y*320 + x] = al >> 1
```
Non-deterministic (PIT reads). Port: use a PRNG for r, r2 and keep the two table lookups, the running sum and the
row table 0x52b80 (dump 1000 bytes at unpacked.bin 0x53a40; it has bands of zeros = horizontal stripes without
grain, e.g. rows 88..108 of frame 0). 0x2ca18 is read with stride 4 (another slice's table).

### 0x5208f load_module1 / 0x52021 load_module2
```
print(" Loading module...")
[0x51e6f] = alloc(0x86470)                 // module 1 only; module 2 reuses the buffer
open("control.exe"); seek(-0xbd9b2, SEEK_END) ; read 0x4acd0 bytes -> [0x51e6f]   // file 0xfb2a "anagnosis"
  (0x52021: seek(-0x72ce2, SEEK_END); read 0x72ce2 bytes              // file 0x5a7fa "anamnesis")
print(" Initializing player...")             // 0x5208f only
player(1, ah=card[0x51d7a], bl=[0x51d7e], bh=IRQ, dx=port); on CF -> exit
player(7, edx=[0x51e6f]); on CF -> exit       // load module
```
0x52021 runs with interrupts off (cli ... sti at the end).

### 0x52124 start_music_gus_pan
`player(2)` (start playback; command 2 = 0x4e27 sets flag 0x400 in [0x457b]); then for voice 0..15:
out(port+0x102, voice); out(port+0x103, 0x0c); out(port+0x105, 8) — GUS pan = centre. No visual effect.

## 4. Timers

### 0x1b75f install part-1 timer / 0x1b724 install part-2 timer
cli; set IRQ0 vector (bl=0, [0x2c]) to 0x1b800 (resp. 0x1b7a4); 0x346 (real-mode callback setup, old vector ->
[0x1b6f5]); out 43,0x36; out 40, lo(39772); out 40, hi; sti; tick = 0.
### 0x1b84d restore_timer
IRQ0 -> 0x1b79a (EOI-only stub), restore old vector (0x388), PIT divisor 0 (=65536, 18.2 Hz).

### 0x1b800 part-1 ISR (30 Hz)
```
pushad; sti; out 20,20
tick++
if (tick < 0xc15) call dword[0x17ce0 + 4*tick]     // CF=1 on entry
player(4)                                          // SB DMA refill poll; returns at once for GUS
[0x5380c] += 0xc1c; if ([0x5380c] >= 0x3e800) [0x5380c] = 0
popad; iretd
```
### 0x1b7a4 part-2 ISR (30 Hz)
```
same, but: if (tick < 0x2260) call dword[0xf2d0 + 4*tick]
player(4)
if (byte[0x1b7ff] == 0) palette_pulse()            // 0x53ed8
phase update as above
```
Note the ISR order: scene fn, then music poll, then palette pulse. A tick's scene function runs before the next
main-loop frame, so on the first frame of a new effect the scene fn has already run once (one-shot effect init
that sets a variable overwrites the scene's first increment, e.g. 0x52577 sets [0x2d448]=-340 after 0x52522 added 2).

## 5. Timeline (tick ranges, inclusive; T = seconds in the recording)

### Part 1 (table 0x17ce0, 0xc15 entries; loop ends at tick 2684)
| ticks | T (s) | scene fn | effect | on screen |
|---|---|---|---|---|
| 1..246 | 0.03..8.23 | 0x522f9 | 0x52343 | starburst feedback (AVI[5]) fading in |
| 247..445 | 8.23..14.87 | 0x523f2 | 0x52441 | starburst + "coma" |
| 446..543 | 14.87..18.13 | 0x5247a | 0x52441 | + "virne" |
| 544..638 | 18.13..21.30 | 0x524b2 | 0x52441 | + "groo" |
| 639..736 | 21.30..24.57 | 0x524ea | 0x52441 | + "apatia" |
| 737..1048 | 24.57..34.97 | 0x52522 | 0x52577 | starburst + 3D object 0x5198e (tex AVI[9]) |
| 1049..1458 | 34.97..48.63 | 0x525f2 | 0x5264a | starburst + 3D object 0x518e4 (plant) |
| 1459..1922 | 48.63..64.10 | 0x5269e | 0x526f0 | starburst + 3D object 0x51a38 (spider) |
| 1923..2154 | 64.10..71.83 | 0x52744 | 0x5277b | starburst + "order ?" |
| 2155..2619 | 71.83..87.33 | 0x527de | 0x5282e | + grain + "NO order!" |
| 2620..2683 | 87.33..89.47 | 0x5288c | 0x528b2 | starburst decays, "We are under / control.." |
(entries 2684..3092 are never reached: 0x5288c to 3083, 0x522f9 at 3084, then 0,0,0,0,0x7fd0,0,0,0 garbage)

### Load gap: T 89.47..90.50 — screen frozen on the last part-1 frame.

### Part 2 (table 0xf2d0, 0x2260 entries; loop ends at tick 8700). T = 90.50 + tick/30
| ticks | T (s) | scene fn | effect | on screen |
|---|---|---|---|---|
| 0..212 | 90.50..97.60 | 0x53f8b | 0x53fb0 (also set by main) | COMA photo (AVI[2]), grain growing |
| 213..319 | 97.60..101.17 | 0x53fe9 | 0x54043 | inverted face drawing (AVI[11]) + "the CONTROL" |
| 320..403 | 101.17..103.97 | 0x53fa4 | 0x53fb0 | COMA photo, heavy grain |
| 404..426 | 103.97..104.73 | 0x5409a | 0x540ca | video AVI[3] |
| 427..483 | 104.73..106.63 | 0x540e7 | 0x54273 | video + " I think I want to sing " |
| 484..532 | 106.63..108.27 | 0x540f3 | 0x54273 | "my mouth is frozen" |
| 533..590 | 108.27..110.20 | 0x540ff | 0x54273 | "I want to shout" |
| 591..639 | 110.20..111.83 | 0x5410b | 0x54273 | "but I just cant do that" |
| 640..697 | 111.83..113.77 | 0x54117 | 0x54273 | "Our minds are full / of lies" |
| 698..746 | 113.77..115.40 | 0x54123 | 0x54273 | "Our eyes are blinded" |
| 747..804 | 115.40..117.33 | 0x5412f | 0x54273 | "I want to SEE !" |
| 805..853 | 117.33..118.97 | 0x5413b | 0x54273 | "but I cant see anything / behind this mask" |
| 854..1067 | 118.97..126.10 | 0x542d0 | 0x54314 | anim AVI[4] lerped + "We see nothing.." |
| 1068..1274 | 126.10..133.00 | 0x543bf | 0x54456 | "we do not move because..." |
| 1275..1708 | 133.00..147.47 | 0x544c0 | 0x54507 | anim AVI[8] + "we are mass under systems CONTROL!" |
| 1709..1922 | 147.47..154.60 | 0x54575 (falls into 0x54591) | 0x545bd | "What is wrong ?" |
| 1923..2136 | 154.60..161.73 | 0x5466a | 0x546b3 | anim AVI[12] + "and they said..." |
| 2137..2243 | 161.73..165.30 | 0x54777 | 0x5486d | "some day" (AVI[13]) |
| 2244..2349 | 165.30..168.83 | 0x54911 | 0x54a2c | "some day" variant |
| 2350..2456 | 168.83..172.40 | 0x54777 | 0x5486d | |
| 2457..2530 | 172.40..174.87 | 0x55bc7 | 0x55be8 | 3D object 0x51ace (tex FLI[18]) — mode 13h |
| 2531..3632 | 174.87..211.60 | 0x54e78 | 0x54ec3 | MODE X 320x400, 3 objects AVI[14,15,16] |
| 3633..3739 | 211.60..215.17 | 0x54f41 | 0x54f64 | (mode X) |
| 3740..3846 | 215.17..218.73 | 0x55032 | 0x5506b | mode 13h again; AVI[6] w/ palette AVI[18] + " system divines" |
| 3847..3953 | 218.73..222.30 | 0x55202 | 0x55232 | AVI[6] w/ palette AVI[17] + " nature" |
| 3954..4024 | 222.30..224.63 | 0x55032 | 0x5506b | system divines |
| 4025..4296 | 224.63..233.70 | 0x55202 | 0x55232 | nature |
| 4297..4523 | 233.70..241.27 | 0x552ae | 0x552f4 | MODE X, objects AVI[19,20,21] |
| 4524..4665 | 241.27..246.00 | 0x5537c | 0x5539b | mode X, objects AVI[22,23,24] |
| 4666..4808 | 246.00..250.77 | 0x5540a | 0x5543c | mode X, current 3 objects + grain |
| 4809..4899 | 250.77..253.83 | 0x55529 | 0x5558a | mode 13h; video + "Scream until you are FREE!" |
| 4900..5093 | 253.83..260.30 | 0x555fb | 0x55621 | MODE X, FLI[0,1,2] + "SCREAM" |
| 5094..5235 | 260.30..265.03 | 0x556cf | 0x556ee | mode X, FLI[3,4,5] + "SCREAM" |
| 5236..5378 | 265.03..269.80 | 0x5578d | 0x557ac | mode X, FLI[6,7,8] + "SCREAM" |
| 5379..5451 | 269.80..272.23 | 0x5584b | 0x55b6c | mode 13h; 3D object 0x51ace (tex FLI[18]) |
| 5452..5770 | 272.23..282.87 | 0x55c35 | 0x55c6d | MODE X, FLI[12,13,14] + "but how can you / scream ?" |
| 5771..5984 | 282.87..290.00 | 0x55d31 | 0x55d69 | mode X, FLI[15,16,17] + "with mask on / your face ?" |
| 5985..6197 | 290.00..297.10 | 0x55e12 | 0x55e3d | mode X, FLI[9,10,11] + "take it off" |
| 6198..6518 | 297.10..307.77 | 0x5540a | 0x5543c | mode X, current objects (FLI 9-11) + grain |
| 6519..6732 | 307.77..314.90 | 0x55ef6 | 0x55f1e | mode 13h; 3D object 0x51b74 (tex FLI[18]) |
| 6733..7159 | 314.90..329.13 | 0x55f77 | 0x55fa4 | anim FLI[19] (photo of a face) |
| 7160..7907 | 329.13..354.07 | 0x55ef6 | 0x55f1e | 3D object again |
| 7908..8699 | 354.07..380.50 | 0x56012 | 0x56021 | "END" |
(8700..8799 = 0x56012, never reached.)

## 6. Scene functions (part 1) — exact per-tick operations

P1_COMMON (every part-1 scene fn except 0x5288c; u8 with carry):
```
[0x522f7] += 0xbe;  [0x5224a] += carry
[0x5224b] += 1
[0x522f8] += 0x64;  [0x56077] += carry
```
(=> TEX scroll u advances 190/256 px per tick, v 1 px per tick, sine phase 100/256 per tick.)

- **0x522f9** (1..246): effect=0x52343; P1_COMMON; `[0x522f6] += 0x3c; [0x522f5] -= carry; if (int8)[0x522f5] < 0 -> 0`;
  then set_palette_fade() (0x5238e). After t calls the level is 0x40 - floor(60t/256): 64 at t=0, 7 at t=246.
  **Nothing writes DAC 0xc0..0xff again in part 1, so the starburst palette keeps level 7 (max component 0x38) for
  the rest of part 1.**
- **0x523f2** (247..445): effect=0x52441; [0x1baa7]=0x5242a "coma"; P1_COMMON.
- **0x5247a** "virne" (0x5242f), **0x524b2** "groo" (0x52435), **0x524ea** "apatia" (0x5243a): same as 0x523f2.
- **0x52522** (737..1048): effect=0x52577; `u8[0x2d45c]+=2; u8[0x2d460]+=1; u8[0x2d458]+=0xff; d[0x2d448]+=2;
  d[0x2d450]+=0x96`; P1_COMMON.
- **0x525f2** (1049..1458): effect=0x5264a; `d[0x2d458]=0x3a; d[0x2d460]=0xc` (dword stores: also zero bytes
  0x2d459..b, 0x2d461..3); `u8[0x2d45c]+=2; d[0x2d450]+=0x3c; d[0x2d448]-=1`; P1_COMMON.
- **0x5269e** (1459..1922): effect=0x526f0; `u8[0x2d458]=0x44; u8[0x2d45c]=4; u8[0x2d460]+=2; d[0x2d450]+=0x32`;
  P1_COMMON; `d[0x2d448]+=1`.
- **0x52744** (1923..2154): effect=0x5277b; P1_COMMON.
- **0x527de** (2155..2619): effect=0x5282e; P1_COMMON; `[0x53f8a] -= 0x28; [0x53810] -= borrow; if (int8)<0 -> 0`
  (grain level, set to 0x20 by 0x5282e's first call, decreases 1 per 6.4 ticks -> more grain).
- **0x5288c** (2620..): effect=0x528b2 only.

Part-1 effects (pipeline only; details in the effect slices):
```
0x52343: once: build_tex() (0x522b5). decay(W) (0x1c2a7); feedback_add(edi=W, ebp=TEX) (0x5224c);
         for i<0xf8c0: A000[i] = (W[i]>>2) + 0xc0                      // direct, 199 rows
0x52441: decay(W); feedback_add(W); B2 = (W>>2)+0xc0 (0x523b2); text([0x1baa7]) at B2+0x645 (row 5, x 5),
         colour base 0x80 (grey ramp); blit B2 -> A000 (0x5293b)
0x52577: once: [0x2d708]=AVI[9]+0x30a; set_pal_rix() (0x53929); [0x2d44c]=0; [0x2d448]=-340; [0x2d450]=0x36b0;
         copy W -> B2 (0x3e30 dwords).  Every frame: decay(B2) (0x1c2c2); feedback_add(edi=B2);
         W = (B2>>2)+0xc0 (0x523d2); 3D 0x5198e into W; blit W (0x52918)
0x5264a: once: [0x2d44c]=-20; [0x2d448]=200; [0x2d450]=0x2580.  same, 3D = 0x518e4
0x526f0: once: [0x2d44c]=-10; [0x2d448]=-220; [0x2d450]=0x1f40. same, 3D = 0x51a38
0x5277b: once: DAC[0x80..0xbf] = grey ramp (undo the RIX palette). decay(B2); feedback_add(B2); W=(B2>>2)+0xc0;
         text "order ?" at W+0xc8b4 (row 160, x 52), colour base [0x1b882] (still 0x80); blit W
0x5282e: once: [0x53810]=0x20. decay(B2); feedback_add(B2); grain_sat(edi=B2) (0x53847); W=(B2>>2)+0xc0;
         text "NO order!" at W+0xc8b4; blit W
0x528b2: decay(B2) (no feedback add -> fades out); W=(B2>>2)+0xc0; text "We are under\r   control.. " at
         W+0x57c6 (row 70, x 70); blit W
```
The feedback buffer decays once per FRAME, so the starburst's look depends on the frame rate (UNCLEAR: DOSBox
frames/tick).

## 7. Scene functions (part 2)

Common "advance animation" pattern, ADV(r): `[0x53f8a] += r; if carry: [0x28980] = [0x28989]` (one new frame of the
current morph/object animation each time the byte wraps => r/256 frames per tick).
VIDEO(r): `[0x53f8a] += r; [0x28b25] += carry; if [0x28b25] >= 0x3c: [0x28b25] = 0` (160x100 video frame).

| fn | sets [0x52185] | other per-tick ops |
|---|---|---|
| 0x53f8b | 0x53fb0 | `[0x53f8a] -= 0x64; [0x53810] -= borrow` — NO clamp: level goes 0x40 -> 0 at tick ~164 then wraps to 0xff, 0xfe... (noise - level becomes noise + (256-level): grain keeps growing) |
| 0x53fe9 | 0x54043 | `u8[0x2d458] += 0xfd; u8[0x2d45c] += 1 + carry; u8[0x2d460] += 2` (unused by 0x54043) |
| 0x53fa4 | 0x53fb0 | — ([0x53810] stays where 0x53f8b left it) |
| 0x5409a | 0x540ca | VIDEO(0x3c) |
| 0x540e7/0x540f3/0x540ff/0x5410b/0x54117/0x54123/0x5412f/0x5413b | (jmp 0x54145) | `d[0x5426f]` = 0/0x19/0x32/0x4b/0x64/0x96/0xaf/0xc8 (caption offset into 0x54175) |
| 0x54145 | 0x54273 | VIDEO(0x28) |
| 0x542d0 | 0x54314 | ADV(0x32); `u8[0x2d460] += 0xfe; u8[0x542fc] += 5` |
| 0x543bf | 0x54456 | `u8[0x2d460] += 0xfe; u8[0x542fc] += 5` |
| 0x544c0 | 0x54507 | ADV(0x64) |
| 0x54575 | 0x545bd (via 0x54591) | `u8[0x5224a] += 3; u8[0x5224b] += 0xff; u8[0x56077] += 2; d[0x542fc] += 0xa` (DWORD add — [0x542fc] can exceed 255 here; matters if 0x545bd indexes a 256 table with it, see that slice) |
| 0x5466a | 0x546b3 | ADV(0x32) |
| 0x54777 | 0x5486d | `u8[0x54766]+=4; u8[0x5476a]+=0xfd; u8[0x5475e]+=5; u8[0x54762]+=1; [0x53810]=0x0a` |
| 0x54911 | 0x54a2c | `u8[0x54766]+=0xfe; u8[0x5476a]+=1; u8[0x5475e]+=0x41; u8[0x54762]+=2` |
| 0x55bc7 | 0x55be8 | `u8[0x2d458]+=1; u8[0x2d460]+=0xff; u8[0x2d45c]+=1` |
| 0x54e78 | 0x54ec3 | ADV(0xc8); `[0x54e77] += 0x1e; if carry { d[0x1bdd4] += 0x10; if >= 0x1b0 -> 0 }`; `[0x1b7ff] = 0` |
| 0x54f41 | 0x54f64 | `[0x53f8a] -= 0xc8; [0x53810] -= borrow; if (int8)<0 -> 0` |
| 0x55032 | 0x5506b | `u8[0x5224a]+=0xff; u8[0x5224b]+=1; u8[0x55119]+=1; u8[0x5511a]+=0xff` |
| 0x55202 | 0x55232 | `u8[0x5224a]+=1; u8[0x5224b]+=1; u8[0x55119]+=2; u8[0x5511a]+=1` |
| 0x552ae | 0x552f4 | ADV(0x50); `[0x54e77] += 0x28; if carry { d[0x1bdd4] += 0x12; if < 0x5a: [0x1b7ff]=0 (jumps to 0x54ebb) else d[0x1bdd4]=0 }` |
| 0x5537c | 0x5539b | ADV(0x50) |
| 0x5540a | 0x5543c | `[0x54e77] += 0x50; if carry { d[0x1bdd4] += 0x10; if >= 0x160 -> 0 }` |
| 0x55529 | 0x5558a | `adc [0x53f8a], 0x64` (CF=1 on entry: +0x65); `[0x28b25] += carry; if >= 0x3c -> 0` |
| 0x555fb, 0x556cf, 0x5578d, 0x55c35, 0x55d31, 0x55e12 | 0x55621, 0x556ee, 0x557ac, 0x55c6d, 0x55d69, 0x55e3d | ADV(0x78) |
| 0x5584b | 0x55b6c | `u8[0x2d458]+=1; u8[0x2d460]+=0xfe; u8[0x2d45c]+=1` |
| 0x55ef6 | 0x55f1e | `u8[0x2d458]+=2; u8[0x2d460]+=0xfd; u8[0x2d45c]+=0xfd; u8[0x55ef2]+=6` |
| 0x55f77 | 0x55fa4 | `[0x1b7ff]=0`; ADV(0x1c); `[0x55f1d]=0` (re-arms 0x55f1e's one-shot init for its second run) |
| 0x56012 | 0x56021 | — |
(0x55ee6 sets [0x52185]=0x55ef1 = a bare `ret`; it is not in the table.)

## 8. Part-2 effects that are NOT in control.lst (reached only through 0xf2d0) — disassembled here

Shared mode-X object pipeline "OBJ3(p,q,r)": `[0x2897c]=p; [0x1ad2d]=q; [0x1ad31]=r; [0x20602]=2; [0x2060c]=0;
call 0x1afc4` (decode/advance three morph objects into [0x28b88],[0x28b8c],[0x28b90] and draw them into planes,
see 0x1afc4 below); `memset(B2, 0, 0xfa0*4)` (first 16000 bytes); ...; `call 0x1af37` (CRTC start = [0x1ad24]);
`[0x1ad24] ^= 0x7d00`.
"RESET_ANIM": `[0x28989]=0; [0x28980]=0`.

```
0x552f4: once{ RESET_ANIM; mode_x_init() (0x54e0b); d[0x1bdd4]=0 }
         OBJ3(AVI[19],AVI[20],AVI[21]); memset(B2,0,16000); call 0x1be99; flip
0x5539b: once{ RESET_ANIM; d[0x1bdd4]=0 }  OBJ3(AVI[22],AVI[23],AVI[24]); call 0x1af37; flip   (no clear)
0x5543c: once{ d[0x1bdd4]=0 }
         [0x53810]=0x0c; SELF-MODIFY grain(): dword[0x53822]=0xa640 (byte count 42560 = 133 rows), byte[0x53840]=0
           (no +0xc0) — stays modified until 0x5558a restores it
         for k in 0..2: esi=[0x28b88+4k]; edi=W; call 0x28623; grain(W); [0x1ad28]=0x50*k; [0x1ad2c]=0x40*k; call 0x1ad47
         memset(B2,0,16000); call 0x1c086; call 0x1af37; flip
0x5558a: once{ d[0x1bdd4]=0; int10h(0x13) (back to mode 13h) }
         [0x53810]=4; call 0x28b2a (video into W); restore grain(): dword[0x53822]=0xfa00, byte[0x53840]=0xc0;
         grain(W); text "   Scream until\r      you are  \r\r       FREE!   " at W+0x3223 (row 40, x 35),
         colour base [0x1b882] (as left: 0xc0); blit W
0x55621: once{ RESET_ANIM; mode_x_init(); d[0x1bdd4]=0 }
         OBJ3(FLI[0],FLI[1],FLI[2]); memset(B2,0,16000); [0x1baa7]="SCREAM"; d[0x1bdd8]=0x67a2;
         edi=B2; [0x1b882]=0xc0; text(); call 0x1c0c1; call 0x1af37; flip
0x556ee: once{ RESET_ANIM }  same with FLI[3,4,5], [0x1bdd8]=0x2594, "SCREAM"
0x557ac: once{ RESET_ANIM }  same with FLI[6,7,8], [0x1bdd8]=0xfb4, "SCREAM"
0x55b6c: once{ int10h(0x13); DAC[0..255] = 768 bytes at 0x5586c; [0x1b7ff]=1; [0x2d708]=FLI[18]+0x30a }
         clear W (0x528f6: 63680 bytes + 320 more = 64000 zero); 3D 0x51ace into W; blit W
0x55be8: identical to 0x55b6c but WITHOUT the int10h (mode is already 13h at tick 2457).
0x55c6d: once{ RESET_ANIM; mode_x_init(); DAC[0xc0..0xff]=grey ramp; d[0x1bdd4]=0 }
         OBJ3(FLI[12],FLI[13],FLI[14]); memset(B2,0,16000); text "but how can you\rscream ?", [0x1bdd8]=0xfa2,
         edi=B2, base 0xc0; call 0x1c0c1; call 0x1af37; flip
0x55d69: once{ RESET_ANIM; d[0x1bdd4]=0 } FLI[15,16,17]; "with mask on\ryour face ?", [0x1bdd8]=0x4e20; same tail
0x55e3d: once{ RESET_ANIM; d[0x1bdd4]=0 } FLI[9,10,11];  "take it off", [0x1bdd8]=0x64a; same tail
0x55f1e: once{ int10h(0x13); DAC[0..255]=0x5586c; [0x2d708]=FLI[18]+0x30a } (flag 0x55f1d, re-armed by 0x55f77)
         [0x1b7ff]=0x8d (every frame); clear W; 3D 0x51b74 into W; blit W
0x55fa4: once{ [0x28980]=0; [0x28989]=0; [0x1b7ff]=0; DAC[0xc0..0xff]=grey ramp }
         [0x2897c]=FLI[19]; d[0x2861f]=0x30; [0x20602]=3; [0x2060c]=0xc0; call 0x28999; blit W
0x56021: DAC[0xc0..0xff]=grey ramp (every frame); memset(W,0,64000); text "END" at W+0x5802 (row 70, x 130),
         base 0xc0; blit W   ([0x1b7ff]=0x8d from 0x55f1e, so the pulse is off and END is white)
```
0x1afc4 (shared; listed): `[0x1c3e2]=0xa0e` (decoded frame size 2574 bytes), `[0x2861f]=0x21`; if [0x28980] !=
[0x28985] (new frame requested): remember it; if [0x28980]==0: for each of the 3 items decode base frame
(item + dword[item+4]) with 0x1c34d into [0x28b88]/[0x28b8c]/[0x28b90]; then for each item decode delta
`item + dword[item + 8 + 4*[0x28980]]` into [0x28b94] and subtract bytewise (0xa0e bytes) from its buffer;
`[0x28989]++; if [0x28989] >= dword[AVI/FLI item p] (frame count) [0x28989]--` (clamps on the last frame).
Then always 0x1af4e draws the three buffers (0x28623 into W, then 0x1ad47 to planes with [0x1ad28]=0/0x50/0xa0,
[0x1ad2c]=0/0x40/0x80). 0x28999 is the single-object version (frame size 0xea0, loops to 0 at the end).

0x54e0b mode_x_init:
```
out 3c6,0 (DAC mask 0 = black while switching)
out 3c4: idx 4 = 0x06 (chain-4 off)
out 3d4: idx 0x14 = 0x00, idx 0x17 = 0xe3 (byte mode), idx 0x09 = 0x00 (no double scan -> 400 lines)
out 3d3, 0x4006  (ports 3d3/3d4 typo — writes nothing meaningful; GUESS no effect)
out 3c4: idx 2 = 0x0f (all planes); memset(A000, 0, 0x4000 dwords) = clear all 256 KB
DAC[0..191] = 576 bytes at 0x54b0b
out 3c6,0xff
```
=> 320x400 unchained, 80 bytes/row per plane, page size 0x7d00; displayed page start [0x1ad24] alternates
0x7fd0 / 0x02d0 (start 0x7fd0 = 0x7d00 + 720, i.e. both pages are offset by 9 rows: GUESS for the vertical centring
of the content). No retrace wait before or after the CRTC write.

## 9. Palette helpers and per-pixel helpers (this slice)

### 0x5238e set_palette_fade (part 1)
`out 3c8,0xc0; for k in 0..191: v = byte[0x52189+k] - [0x522f5]; if (int8)v<0 v=0; out 3c9,v` (64 colours, 6-bit).
Table 0x52189 (64 RGB triplets, black -> red -> yellow -> white):
```
00 00 00 00 00 00 01 00 00 02 00 00 03 00 01 04 01 01 05 01 01 06 01 01 07 01 02 09 01 02 0a 02 03 0c 02 03
0e 02 04 10 03 04 12 03 05 14 03 05 16 04 05 18 04 05 1a 04 06 1c 04 06 1e 04 06 20 02 06 22 02 06 24 02 05
26 02 05 28 02 05 2a 02 05 2c 01 04 2e 01 04 30 01 03 32 01 03 34 01 02 37 01 01 39 01 01 3b 00 01 3d 00 00
3f 00 00 3f 04 01 3f 09 03 3f 0d 06 3f 12 08 3f 16 0a 3f 1a 0d 3f 1e 0f 3f 22 12 3f 25 14 3f 29 16 3f 2c 19
3f 2e 1b 3f 31 1d 3f 33 20 3f 36 22 3f 37 24 3f 39 27 3f 3b 29 3f 3c 2c 3f 3d 2e 3f 3e 30 3f 3f 33 3f 3f 35
3f 3f 37 3f 3f 3a 3f 3f 3c 3f 3f 3f
```
### 0x53929 set_pal_rix
`esi = [0x2d708] - 0x300; out 3c8,0; rep outsb 0x240 bytes` = DAC[0..191] from the RIX palette of the current
texture item (RIX header 10 bytes + 768-byte 6-bit palette + 256x256 pixels; [0x2d708] points at the pixels).

### 0x53ed8 palette_pulse (part-2 ISR, when [0x1b7ff]==0)
```
u8[0x53ed0] += 2; if carry { d[0x53ed4] += 0xc0; if (d[0x53ed4] >= 0x240) d[0x53ed4] = 0 }
t = sin[ u8[0x53ed0] ] >> 1                 // 0..63; sin = 0x2d218 (|sin|, 2 humps, max 0x7f)
A = 0x53e08 (192 bytes), Bp = 0x53bc8 + d[0x53ed4]   // B = one of 3 palettes (0x53bc8, 0x53c88, 0x53d48)
for c in 0xc0..0xff: out 3c8,c; for comp 0..2: out 3c9, L[A[k]*4096 + Bp[k]*64 + t]   (k = 3*(c-0xc0)+comp)
```
=> colours 0xc0..0xff oscillate between A (sepia ramp below) and B, twice per 128 ticks (peaks at byte 64 and 192);
B switches every 128 ticks (4.27 s): 0x53bc8, 0x53c88, 0x53d48, 0x53bc8... starting at part-2 tick 128.
A (0x53e08) = 05 04 00 06 04 00 07 04 00 07 05 00 08 06 00 09 06 00 0a 07 01 0b 08 01 0c 08 01 0d 09 02 0e 0a 02
0f 0a 03 10 0b 04 11 0c 05 11 0d 05 12 0d 06 13 0e 07 14 0f 08 15 10 09 16 11 0a 17 12 0c 18 13 0d 19 14 0e 1a 15
0f 1b 16 11 1c 17 11 1c 18 12 1d 19 13 1e 1a 14 1f 1b 15 20 1c 15 21 1d 16 22 1e 17 23 1f 18 24 20 19 25 21 1a 26
23 1b 27 23 1b 28 25 1c 29 26 1d 2a 27 1e 2a 28 1f 2b 29 20 2c 2a 21 2d 2b 22 2e 2d 23 2f 2e 24 30 2f 25 31 30 25
32 31 26 33 32 28 34 33 29 35 34 2a 36 36 2b 37 37 2d 38 38 2e 39 39 30 3a 3a 32 3b 3b 34 3c 3c 35 3d 3d 37 3e 3e
39 3f 3f 3b 3f 3f 3f.  B palettes: 576 bytes at unpacked.bin 0x54a88.

### 0x522b5 build_tex (TEX 256x256 at [0x1b25a], values 0..31)
```
for idx in 0..65535: x = idx & 0xff; y = idx >> 8
  v = sin[u8(2x) ^ y] + sin2[u8(2y) ^ x]     // sin = 0x2d218, sin2 = 0x2d318 (cosine, = sin[i+64]); max 0xfe
  v = (v >> 1) - 0x60; if (int8)v < 0: v = 0
  TEX[idx] = v
```
### 0x5224c feedback_add(edi = dest, ebp = TEX)  — the starburst painter
```
[0x52249] = sin[u8[0x56077]] >> 1
S = AVI[5] (3 planes of 64000: S0 = +0, S1 = +0xfa00, S2 = +0x1f400)
for i in 0..63999:                    // ecx = 64000-i; source index j = 63999 - i  (image drawn ROTATED 180 deg)
   p  = S0[j]
   a  = TEX[ u8(p + [0x5224b]) * 256 + u8(p + [0x5224a]) ]
   b  = u8(S2[j] - S1[j] + [0x52249])
   v  = u8(a - b); if (v & 0x80) v = 0           // sign of the 8-bit result
   dest[i] = min(255, dest[i] + v)
```
(AVI[5] is the radial ray image; S0 = angle/ray coordinate used to look up the scrolling TEX, S2-S1 = radial
brightness GUESS. The 180-degree rotation is visible only as asymmetry.)

### 0x1c2a7 / 0x1c2c2 / 0x1c2f8 decay
`buf[i] = DECAY[buf[i]]` for W (64000), B2 (64000) resp. [0x1b262] (0x3e80 = 16000 bytes). DECAY = 256 bytes at
0x1c1a7 (unpacked.bin 0x1d067): 0,0,0,1,2,...; DECAY[255]=0xd4 (~0.84x-2, piecewise; copy the table).
### 0x1c314 upscale: for y<100, x<160: v = u8([0x1b262][y*160+x] + byte[0x1c313]); write v to (2x,2y),(2x+1,2y),
(2x,2y+1),(2x+1,2y+1) at edi (stride 320). [0x1c313] is 0 unless written by another slice.
### 0x52982 lerp_into_W: for i<64000: `W[i] = L[ [0x1b25e][i]*4096 + W[i]*64 + [0x529f8] ] + 0xc0` (values must be 0..63).
### 0x53815 grain(edi): `src = NOISE + [0x5380c]; for i < N (imm at 0x53822, normally 0xfa00): v = src[i] - [0x53810];
if (int8)v<0 v=0; d = u8(edi[i] + v); if d >= 0x3f d = 0x3f; edi[i] = u8(d + K)` with K = imm byte at 0x53840
(normally 0xc0). NB the add before the clamp is 8-bit: a sum > 255 wraps first.
### 0x53847 grain_sat(edi): `v = src[i] - level, clamp >= 0 (int8); edi[i] = min(255, edi[i] + v)` for 64000.
### 0x523b2: B2[i] = (W[i]>>2)+0xc0 ; 0x523d2: W[i] = (B2[i]>>2)+0xc0 (64000 bytes each).
### 0x528dd: W = 0xc0 (64000). 0x528f6: W = 0 (63680 + 320 bytes).
### 0x52918: A000[0..63679] = W[0..63679] ; 0x5293b: A000[0..63679] = B2[...]  (199 rows; row 199 stays 0xc0).

## 10. Data files (map from the code)

Both files are read whole; dword offset tables in the EXE (0x1b170: 30 for DEMO.AVI, 0x1b0f8: 20 for DEMO.FLI) are
turned into pointers. "RIX" = ColoRIX: "RIX3", w=256, h=256, 2 bytes (0xaf,0x00), 768-byte 6-bit palette, 65536
pixels (0x1030a bytes). "MORPH" = frame-animated object (consumers 0x28999 / 0x1afc4): dword nFrames; dword
baseOff; dword deltaOff[...] (all offsets relative to the item); frames decoded by 0x1c34d to 0xa0e or 0xea0 bytes;
delta frames are subtracted bytewise; triplets go to the three mode-X objects.

DEMO.AVI (2,802,832 bytes):
| # | offset | size | format | used by |
|---|---|---|---|---|
| 0 | 0x0 | 0x1030a | RIX | unused (no reference) |
| 1 | 0x1030a | 0x1030a | RIX | unused |
| 2 | 0x20614 | 0x8066 | RLE picture (0x1c504: word count, packets) | 0x53fb0 COMA photo |
| 3 | 0x2867a | 0x454aa | 160x100 RLE video, 60 frames GUESS (0x28b2a) | 0x540ca, 0x54273, 0x5558a |
| 4 | 0x6db24 | 0xc3f9 | MORPH (42 frames) | 0x54314 |
| 5 | 0x79f1d | 0x2ee00 | 3 raw planes 320x200 | 0x5224c starburst (part 1, 0x545bd?) |
| 6 | 0xa8d1d | 0x2fd00 | raw (195840 bytes) for 0x55121 | 0x5506b, 0x55232 |
| 7 | 0xd8a1d | 0x10000 | 64 KB map for 0x2879f | 0x54314, 0x54456 |
| 8 | 0xe8a1d | 0x583bc | MORPH (0xb8 frames?) | 0x54507 |
| 9 | 0x140dd9 | 0x1030a | RIX (texture + palette) | 0x52577 -> all part-1 3D objects |
| 10 | 0x1510e3 | 0x1030a | RIX | unused |
| 11 | 0x1613ed | 0x3cff | RLE picture | 0x54043 face drawing |
| 12 | 0x1650ec | 0x9d1d | MORPH (64 frames) | 0x546b3 |
| 13 | 0x16ee09 | 0x10000 | 64 KB map | 0x5486d, 0x54a2c |
| 14,15,16 | 0x17ee09.. | 0x45f83/0x48bc0/0x4c4dc | MORPH triplet (0xd1 frames) | 0x54ec3 |
| 17 | 0x259e28 | 0x1030a | RIX | 0x55232 (palette+texture) |
| 18 | 0x26a132 | 0x1030a | RIX | 0x5506b |
| 19,20,21 | 0x27a43c.. | 0xba73/0xaf06/0xa84a | MORPH triplet (0x1e frames) | 0x552f4 |
| 22,23,24 | 0x29b5ff.. | 0x63c7/0x549a/0x5630 | MORPH triplet (0x1d frames) | 0x5539b |
(25..29: table entries 0 -> point at file start; unused.)

DEMO.FLI (970,038 bytes):
| # | offset | format | used by |
|---|---|---|---|
| 0,1,2 | 0x0, 0x709e, 0xdea5 | MORPH triplet (0x28 frames) | 0x55621 |
| 3,4,5 | 0x1500e, 0x1f337, 0x2616a | MORPH triplet (0x2d) | 0x556ee |
| 6,7,8 | 0x2d7b8, 0x3c509, 0x4bfb4 | MORPH triplet (0x25) | 0x557ac |
| 9,10,11 | 0x5cd09, 0x64161, 0x6a6d2 | MORPH triplet (0x30) | 0x55e3d |
| 12,13,14 | 0x709bb, 0x87ebe, 0x9aedc | MORPH triplet (0x7e) | 0x55c6d |
| 15,16,17 | 0xafcc2, 0xb9572, 0xc175f | MORPH triplet (0x34) | 0x55d69 |
| 18 | 0xca166 | RIX | 0x55be8, 0x55b6c, 0x55f1e (3D object texture; palette is NOT taken from it — those effects load the 768-byte DAC from 0x5586c) |
| 19 | 0xda470 | MORPH (0x32 frames, 0xea0-byte frames) | 0x55fa4 |

Music: CONTROL.EXE file offset 0xfb2a (0x4acd0 bytes, S3M "anagnosis", part 1) and 0x5a7fa (0x72ce2 bytes, S3M
"anamnesis", part 2), loaded by seeking from the end of the file.

## 11. Frame-buffer model

- Mode 13h (chain-4, 320x200, A000 linear) for all of part 1 and most of part 2. Work buffer W (0x561b8) and B2
  (0x65bb8) are 320x200 bytes, stride 320. Part-1 effects keep an INTENSITY image (0..255) in a feedback buffer
  (W for 0x52343/0x52441, B2 for 0x52577..0x528b2) and convert it to palette indices (v>>2)+0xc0 (0xc0..0xff,
  the red starburst ramp) into the other buffer, then draw text/3D on top, then blit 63680 bytes (rows 0..198) to
  A000. Row 199 is filled with 0xc0 once by main and never rewritten; the border (overscan) is colour 0xc0.
- Palette regions: 0x00..0xbf belong to textures/objects (RIX palette, or the 0x5586c / 0x54b0b palettes);
  0x80..0xbf is a grey ramp in part 1 for text (text colour = glyph*4 + base); 0xc0..0xff is the main ramp
  (part 1: 0x52189 with fade; part 2: pulse 0x53ed8 or grey ramp).
- Part 2 grain: 0x53815 adds NOISE (window offset [0x5380c], moving 3100 bytes per tick) minus [0x53810] to 0..63
  images, clamps to 63 and adds 0xc0.
- Mode X 320x400 (0x54e0b) for the triple-object scenes; two pages at 0 and 0x7d00 in each plane, displayed start
  toggles 0x7fd0/0x02d0 via CRTC 0x0c/0x0d (0x1af37) without waiting for retrace. Mode 13h is restored by int 10h
  (0x5558a, 0x5506b, 0x55b6c, 0x55f1e). int 10h also resets the DAC to the BIOS default, which is then reloaded.
- No vertical-retrace synchronisation anywhere: tearing and the frames-per-tick ratio depend on DOSBox's speed.
  Everything driven from scene functions is per tick; per-frame state (feedback decay, 0x1afc4/0x28999 decode only
  on frame change, effect-internal counters) is frame-rate dependent.

## 12. Music interface

0x4be4(al=cmd), table 0x458c: 0 nop, 1 init card (0x4bf7), 2 start (0x4e27), 3 stop (0x4e42), 4 SB DMA poll
(0x4ea1, returns immediately for GUS), 5 get position (0x4f3c: (order-1)*64 + row-1) , 6 nop, 7 load module
(0x4cc7), 8 (0x4f50), 9 nop, 10 (0x4f69). Visual code calls only 1, 7 (load), 2 (start), 4 (each tick), 3 (stop).
**Command 5 is never called and no code above 0x7000 reads player variables (0x3800..0x4700)** — visuals are
not synced to the music except through the shared 30 Hz tick.

## 13. Checks against the recording

- Part 1: the decay of "NO order!" into "We are under control.." (tick 2620) is visible at T=87.327 (expected
  87.333). "coma" first appears between T=8 and T=10 (tick 247 = 8.23 s); fade-in visible at T=0..6.
- Part 2 tick-0 estimate from 4 transitions: tick 213 -> 97.57 s, tick 404 -> 103.985 s, tick 2531 (mode X) ->
  174.871 s, tick 7908 (END) -> 354.099 s => tick 0 at 90.47..90.52, take 90.50. The COMA photo appears at
  90.52 s. Video length 380.50 s = 90.50 + 8700/30.
- Contact sheets at 6 s steps over part 2 match every row of the table in section 5 (captions, mode-X scenes,
  "system divines"/"nature", 3D object scenes, face video, END).
- Open points (GUESS / UNCLEAR): meaning of the 3D variables 0x2d448..0x2d460; exact frame count per tick in
  DOSBox; the purpose of the 0x7fd0 page offset; MORPH table length (offset of frame 0 = 4*(n+4) in all items).
