# GBU.EXE framework: main script, timeline, library 008e, video 0299, timers 0731/072c, MyLZ unpacker

Slice G1. Addresses are SEG:OFF in the unpacked image rebased to segment 0 (`re/img.bin`), linear = SEG*16+OFF.
"Frame" = global frame index of the reference recording (one per VGA retrace, 70.086 Hz);
demo time T = frame / 70.086 (the capat.py time base). Every boundary below was checked on the 40x25 / 160x100
thumbnails of all 32744 frames and on contact sheets, and the music on the recording's audio.

## 1. Summary

What the viewer sees, in order (NFO name -> code):

| # | frames (T s) | NFO part | main-script call |
|---|---|---|---|
| 1 | 0..2 (0.00) | Textmode-routines (Peci): DOS text screen redrawn as 640x400 graphics | 0444 `11d6:000a` |
| 2 | 3..~440 (0.04..6.3) | Textmode-routines: two small rotating blue cubes, 640x400 | 0449 `08d8:196e` |
| 3 | ~441..~510 (..7.3) | fade of DAC 0..62 to black in 70 retraces | 044e `11d6:032c` |
| 4 | ~511..549 | black: GUS detect, MOD load + sample upload (CPU/IO bound) | 045b `008e:170e`, 0465 `008e:1942` |
| 5 | 550..583 (7.85) | black, mode 13h-unchained (capture file 3) + PIT measurement | 0479 `0299:00f5`, 048d `0731:000a`, 0498 `0731:013c` |
| 6 | 584 (8.333) | music starts (first tick ~frame 585; audio onset 8.339 s) | 049d `0299:01cc` |
| 7 | 584..2294 (8.33..32.73) | Intro (Erik, gfx Maestro): black until 769, chess plane 770, "SURPRISE!" logo 1086, yellow polygons, "PRESENTS" (1600..1854), black 1855..1959, GBU logo from 1960 (music sync 1), fade out to 2294 | 04a2 `08d8:275d` |
| 8 | 2295..2296 | black (DAC zeroed by `0000:002b`, `0299:01cc`) | 04a7, 04ab |
| 9 | 2297..~3688 (32.77..52.62) | Credits (Antibyte), "ugur" | 04bf `0db5:07b0` |
| 10 | 3689..5145 (52.64..73.41) | Plasma (Erik): black 3689..3730 (42 frames; ~14 of them CPU-bound precalc), visible from 3731 (53.24); ends at music sync 3 | 05a3 `0cf9:01dd` |
| 11 | 5146..6482 (73.42..92.49) | Cyclic plasma (Erik): starts with a white flash fading down; after sync 4 (~frame 6203) fades to black by 6482 | 05af `0731:013c`, 05b4 `0cc5:0139` |
| 12 | 6483..7685 (92.50..109.66) | Morphing line figures (Peci), mutamcde overlay | 05b9 clear, 05d0 `0299:01cc`, 05d5 `0d2e:0010` |
| 13 | 7686..8666 (109.66..123.65) | Chess effect (Erik): black 7686..7688, visible 7689; ends at sync 5 | 05da clear, 05f0 `08d8:18d4` |
| 14 | 8667..~10090 (123.66..143.96) | Water (Erik/Maestro): starts white; capture file 6 (320x400) from 8671; fades to black ~10087 | 05f5 `0749:01cc` |
| 15 | 10091..~10977 (143.98..156.62) | Glentz vector (Erik): black 10091..10110, visible 10111 (144.27), fades out | 065e `0299:01cc` (file 7), 0670 pal, 0675 `0731:013c`, 067f `08d8:1625`, 0684 `08d8:16de` |
| 16 | ~10978..12188 (156.6..173.90) | Picture wobbler (Erik) "wave": black until ~11003, fade-in from 11004; fractal picture, random-block dissolve (wave_ran) into a green grid (~168.5..173.9); ends at sync 6 | 0689 wait tick, 068e `0000:002b`, 0692 `0299:0175`, 0697 `08a8:01f2` |
| 17 | 12189..12192 | white flash (DAC 0..99 = 63,63,63) | 069c retrace wait, 06a9 `0000:001b`, 06ac `0299:01cc`, 06b1 manual music tick, 06b6 `0299:020a` |
| 18 | 12193..~16207 (173.97..231.24) | Chess-paralax-zoomer, Paralax-bars-with-chessplane (~198.9), Zooming 16x16 pictures (spheres, ~213.9), ending on a flat chessboard (229.5..231.2). All in segment 0777 (confirmed by G5), capture file 8 (320x400) | 06c0 `0777:0995` |
| 19 | 16208..17659 (231.26..251.97) | Glentz chess cube (Erik); capture file 9 (320x200) from 16208; exactly 1450 ticks | 06c5 `0731:013c`, 06ca `08d8:2dc1` |
| 20 | 17660..~18809 (251.98..268.4) | Greetings scroller (Peci), font "ugu"/"ugu2" | 06cf `0299:01cc`, 06d4 `0eb3:27e8`, 06d9 `0eb3:28ab`, 06de `0eb3:27d5` |
| 21 | 18810..20576 (268.4..293.59) | Dot tunnel (Antibyte): black 18810..18886 (77 frames, ~3 CPU-bound), dots from 18887 | 06ed load "dot_data", 06f2 `0e40:063b` |
| 22 | 20577..~20751 (293.60..296.1) | Picture of motorcycle (J.O.E): black 20577..20580, bike fades in from 20581 and out to ~20748 (CPU-paced: ~20 frames shorter at 200000 cycles) | 0703 `08d8:396c` (loads citydata, citydat2, citydat3, bg2), 0708 `08d8:3041` |
| 23 | ~20752..20903 | "Surprise!" background fades in (151 frames) | 070d cx=150, 0710 `08d8:346a` |
| 24 | 20904..~21864 (298.27..311.9) | Transforming objects (Erik): 16 shapes x 60 frames | 0715 `08d8:35f6` |
| 25 | ~21865..22980 (312.0..327.88) | Contour city (Erik), city rises from ~21868, then Rotating door (white bars, 22800..22980) | 071a `08d8:39d4`, 071f cx=50, 0722 `08d8:346a`, 0727 `08d8:3e3a`, 072c `08d8:39b1` (frees) |
| 26 | 22981..~24640 (327.9..351.6) | black 22981..22989 (mode 13h + loads), then Picture zoomer (Erik/Maestro) from 22990: GBU characters picture, spaceship, robot (wobbling), ends with the fractal picture fading in | 07a0 `0731:013c`, 07a5 int 10h ax=13h, 07aa `0d97:013c` |
| 27 | ~24640..26117 (351.6..372.65) | Rotating fractal zoomer (Erik), frakcode + resources "0".."10". The fractal of the previous part stays visible because nothing clears the screen in between. Boundary from G7 | 07f8 `0d34:04e1` |
| 28 | 26118..28854 (372.67..411.71) | black 26118..26120, Two glentz cubes (from 26121), then Jelly cubes (~393..411) | 0819 `0299:01cc`, 0826 clear, 0835 `08d8:25f4`, 083a `08d8:16de` |
| 29 | 28855..~31794 (411.72..453.64) | black 28855..28859, 3200 dots cubes (Antibyte) from 28860, fades out | 083f `0299:01cc`, 0844 clear, 085b `126e:13ea` |
| 30 | 31794..31996 (453.64..456.53) | black screen, music fades over 64x3 ticks | 0860 free, 086d fade loop |
| 31 | 31997.. (456.54) | text mode 80x25 (720x400 capture file 10), "ending" screen, cursor row 23; the program exits, DOS prints `C:\>` on row 24 | 088a end sequence |

Video modes: see section 5 (0299). The captures are 640x400 (11d6 text-to-graphics), 320x200 or 320x400
(unchained with CRTC 9 tweaks), 720x400 (text). A capture file boundary is a mode change, so it is a frame-exact
boundary.

### What the porters must know (short list)

1. **Music-position sync.** The brief says no effect reads the music position. That is wrong. Pattern effect
   `8xx` (unused by ProTracker) increments a sync counter `008e:11cc`, and `lcall 008e:18a4` returns it in AX.
   Effects wait on it:
   - `08d8:2c6c` (intro 275d) waits for sync >= 1 before the GBU logo.
   - `0cf9:0208` waits for >= 2 at its start and loops until == 3 (end of the plasma).
   - `0cc5:030c` reacts at >= 4 (cyclic plasma fade-out).
   - `08d8:1941` loops until >= 5 (end of the chess effect).
   - `08a8:02ed` loops until >= 6 (end of the wave).

   The port must run a model of the player (at least its row/order/speed logic) to know when the syncs fire;
   see section 3.4.
2. **The music is not always driven by the retrace timer.** Effects that install the BIOS timer (`0731:0158`) or
   the 70 Hz music-only timer (`0731:0120`) call the player tick `008e:1f63` themselves. The callers are
   0749 (water), 0777 (chess zoomer), 08a8 (wave), 0cf9 (plasma), 0749:0153 (shared fade) and main `0000:06b1`.
   Measured music drift against "one tick per frame from frame 585", in ticks ahead of nominal:

   | demo time (s) | drift (ticks) | where |
   |---|---|---|
   | ..53 | 0 | |
   | 53..73.5 | climbs to +11 | plasma 0cf9: its loop at 0224 calls 1f63 once per iteration but does not wait for the retrace, so the iterations are slightly shorter than a frame |
   | ~122 | +10 | |
   | ~156 | +8 | |
   | 164..198 | +9 | |
   | 198..212 | climbs to +11 | 0777 |
   | ~293 | +7 | 3041 |
   | ~326 | +6 | |
   | ~372 | +4 | |

   All values are ±1 tick. To be exact, the port should tick the music where the original does.
3. **Determinism.** The cycles=200000 recording ($S/cap2) is identical frame for frame to the main recording
   except in these places:
   - GUS load: 3 frames shorter.
   - Credits->plasma black gap: 32 frames instead of 42.
   - Dot tunnel start: 74 black frames instead of 77.
   - Motorcycle part (294.7..295.1 s): ~20 frames shorter.

   Everything else is paced by retraces, ticks or music syncs. Reproduce the 60000-cycle lengths given here.
4. **`0731:00a3` only works under the retrace timer.** It only returns when `0731:[4]` is incremented, and only the
   retrace-synced handler 007a does that. Under the 0120 or BIOS timers it would hang.
5. **The music volume fade is lazy.** `008e:2068` only sets a cap. The cap is applied whenever the player
   (re)writes a voice volume. A held note keeps its old volume until it is re-triggered or changed.

## 2. Main script 0000:03b1..08d7

```
03b1 lcall 008e:0000              ; shrink the program's DOS block (int 21h/4Ah, es = PSP)
03b6 int 21h/3567h; if es:000a == "EMMXXXX0": print 0000:0041 ("ERROR: There's currently a EMS driver installed...") ; exit
03e3 int 21h/48h bx=ffff; if largest free block < 0x7e97 paragraphs: print 0000:0356 ("You need 600000 Bytes...") ; exit
03fd print 0000:0122 (GUS note, [S]/[Q] menu); key = int 21h/08h
     's'/'S' -> byte 0000:0121 = 0 (skip GUS detect; initial value 1); 'q'/'Q' -> exit; any other key -> go
     == demo time 0 is the frame after this key ==
0424 lcall 008e:0182              ; open "gbu.exe" (the resources are appended to the EXE)
0429 ds=08d8: load "scr_data" -> 08d8:[0000], "screen2" -> 08d8:[000a]
0444 lcall 11d6:000a ; 0449 lcall 08d8:196e ; 044e lcall 11d6:032c       ; text-mode part
0453 if byte cs:[0121] != 0: lcall 008e:170e (GUS detect + init)
0460 ds=cs dx=0010 ("inc\b2.mod", not used by the loader) ; lcall 008e:1942   ; load MOD, upload samples
046a lcall 0731:00b4 (save int 8) ; 046f lcall 072c:0004 (save int 9) ; 0474 lcall 072c:0028 (install kbd 072c:0034)
0479 lcall 0299:00f5 (mode 13h, unchained, clear 256 KB) ; 047e lcall 0299:020a (border) ; 0483 lcall 0299:005e (identity attribute pal)
048d ds=0731: lcall 0731:000a (measure frame length -> 0731:[6]) ; 0492 word 0731:[6] -= 0xc8
0498 lcall 0731:013c (retrace timer on; music runs from here) ; 049d lcall 0299:01cc
04a2 lcall 08d8:275d (intro)
04a7 call 0000:002b (all 256 DAC entries = 0) ; 04ab lcall 0299:01cc
04b0 ds=0db5: load "ugur" -> 0db5:[0200] ; 04bf lcall 0db5:07b0 (credits) ; free 0db5:[0200]
04d0..059e loads (DOS file I/O: no emulated time):
     ds=0777: p3_sin->[0], p3_chess->[2], p3_zoom->[6], p3_outf->[8], chess->[4]
     ds=08d8: cheffect->[18] ; ds=0cc5: p75_data->[2], plasma->[0] ; ds=0cf9: kp3_sin->[0], kp3_sin2->[2]
     ds=0d2e: mutamcde->[4] ; ds=0749: watr_dat->[17], watr_pic->[19] ; ds=08a8: wave_sin->[1e], wave_ran->[20], wave->[0a]
05a3 lcall 0cf9:01dd (plasma)
05a8 out 3d4, 2813h (CRTC 13h offset = 0x28)
05af lcall 0731:013c ; 05b4 lcall 0cc5:0139 (cyclic plasma)
05b9 map mask 0f, es=a000, di=0: 0x7fff words of 0 (all 4 planes, 0..fffd)
05d0 lcall 0299:01cc ; 05d5 lcall 0d2e:0010 (morphing lines)
05da map mask 0f, 0x2ee0 words of 0 at a000:0000 ; 05f0 lcall 08d8:18d4 (chess) ; 05f5 lcall 0749:01cc (water)
05fa frees: 0749:[19],[17],[112] ; 0cc5:[2],[0],[134] ; 0d2e:[4] ; 0cf9:[0],[2],[1c]
065e lcall 0299:01cc
0663 DAC 0..15 = 08d8:1479 (48 bytes: 0 0 0 11 11 20 13 13 23 16 16 26 30 40 30 22 32 35 25 35 39 29 39 45
     10 20 10 11 11 20 13 13 23 16 16 26 20 30 20 22 32 35 25 35 39 29 39 45) via 0299:0076
0675 lcall 0731:013c ; es=a000 ; 067f lcall 08d8:1625 ; 0684 lcall 08d8:16de (glentz)
0689 lcall 0731:00a3 (wait 1 tick) ; 068e call 0000:002b (DAC black) ; 0692 lcall 0299:0175 ; 0697 lcall 08a8:01f2 (wave)
069c wait for retrace start (3da bit3: wait while 1, then until 1)
06a9 call 0000:001b (DAC 0..99 = 63,63,63) ; 06ac lcall 0299:01cc ; 06b1 lcall 008e:1f63 (one extra music tick)
06b6 lcall 0299:020a ; es=a000 ; 06c0 lcall 0777:0995 (chess zoomer / bars / spheres)
06c5 lcall 0731:013c ; 06ca lcall 08d8:2dc1 (glentz chess cube)
06cf lcall 0299:01cc ; 06d4 lcall 0eb3:27e8 ; 06d9 lcall 0eb3:28ab ; 06de lcall 0eb3:27d5 (greetings)
06e3 ds=0e40: load "dot_data" -> [4] ; 06f2 lcall 0e40:063b (dot tunnel) ; free 0e40:[4]
0703 lcall 08d8:396c (load city data, bg2) ; 0708 lcall 08d8:3041 ; 070d cx=0x96 lcall 08d8:346a
0715 lcall 08d8:35f6 ; 071a lcall 08d8:39d4 ; 071f cx=0x32 lcall 08d8:346a ; 0727 lcall 08d8:3e3a ; 072c lcall 08d8:39b1
0731 frees: 0777:[54],[0],[2],[6],[8],[4] ; 08a8:[c],[a],[4a],[1e],[20] ; 08d8:[18]
07a0 lcall 0731:013c ; 07a5 int 10h ax=0013h ; 07aa lcall 0d97:013c (picture zoomer)
07af frees 0d97:[12],[8],[16],[38],[3a],[3c],[3e] ; 08d8:[a]
07f8 lcall 0d34:04e1 (fractal zoomer) ; frees 0d34:[8],[62],[64]
0819 lcall 0299:01cc ; map mask 0f, 0x1f40 words of 0 at a000:0000 ; 0835 lcall 08d8:25f4 ; 083a lcall 08d8:16de
083f lcall 0299:01cc ; map mask 0f, 0x7d00 words of 0 ; 085b lcall 126e:13ea (dots cubes)
0860 free 08d8:[0]
086d for cx = 0x40 downto 1: { lcall 0731:00a3 ; lcall 008e:2068 (ax = cx: volume cap) ; 0731:00a3 ; 0731:00a3 }   ; 192 ticks
088a (also the ESC target of 072c:0034)
     int 10h ax=0003h ; lcall 008e:18a9 (stop all 32 GUS voices) ; lcall 0731:00c6 (restore int 8)
     lcall 0731:0113 (PIT ch0 back to 65536) ; lcall 072c:0016 (restore int 9)
     load "ending" -> 0000:[03af] ; copy 0xfa0 bytes to b800:0000 (80x25 char/attr) ; int 10h ah=2 page 0 row 0x17 col 0
     lcall 008e:0194 (close file) ; int 21h/4Ch
```

Helpers inside segment 0000:
- `0000:001b`: DAC from index 0, 300 bytes of 63, so colors 0..99 are white. Near call, ret.
- `0000:002b`: DAC from index 0, 768 bytes of 0. Far (called as `push cs; call`), retf.
- Neither waits for the retrace.

Retraces spent by the main script itself between effects:
- Each `0731:013c` waits for one retrace start edge.
- `0731:00a3` = 1 tick.
- 069c = 1 retrace start.
- The PIT measurement takes 16 x 2 retraces.
- The final fade takes 192 ticks.
- Loads and frees take no emulated time (DOSBox int 21h).
- All other gaps listed in the table are inside the effects.

## 3. Library segment 008e

### 3.1 Memory and resources

- `008e:0000` resize: `bx = ss - es + (sp >> 4) + 1; int 21h/4Ah` (es = PSP on entry).
- `008e:0014` alloc: in: bx paragraphs, ds:di. Does `int 21h/48h`. On failure: print 008e:002f ("Sorry dude! Your
  machine hasn't got enough memory."), set mode 3, exit. On success: `ds:[di] = ax`. Callers: 0749, 0777, 08a8, 08d8,
  0cc5, 0cf9, 0d34, 0d97, 0db5, 0e40, 11d6.
- `008e:0063` free: `es = ds:[di]; int 21h/49h`. Callers: main, 08d8, 0d34, 0db5, 0e40, 0eb3, 11d6.
- `008e:0182` open: opens "gbu.exe" (008e:0178), mode 92h. The handle goes to `008e:[0180]`.
- `008e:0194` close: closes that handle.
- `008e:04b3` load by name: in: ds:dx = 8-char name (space padded), ds:di = slot.
  1. Compares the name with the 49 names at `008e:01a2` (8 bytes each).
  2. If there is no match it prints 008e:04b2 and exits (never happens).
  3. Directory entry k is at `008e:032a + 8k`: dword offset, word size, word 0.
  4. Seeks to `dword 008e:[019e] (=0x9c40) + offset`.
  5. Allocates `(size >> 4) + 1` paragraphs into `ds:[di]` (via 0014).
  6. Reads `size` bytes to seg:0000. Registers are preserved.

  Callers: main, 08d8, 0d34, 0d97, 0eb3. The MOD itself is at offset 0 of that area (file 0x9c40).

### 3.2 GUS (summary)

- **Ports.** Variables 008e:0535.. start at base 0x210 and step by 0x10 until the detection succeeds; it gives up at
  0x270. The variables are: base, +6, +8, +9, +0xb, +0x100, +0x101, +0x102 (voice select), +0x103 (register
  select), +0x104/+0x105 (data), +0x107 (DRAM).
- **`170e` detect.** `1684` resets the card (reg 4Ch = 0 then 1), pokes 0x11 at DRAM 0 (regs 43h/44h, port +0x107)
  and reads it back.
  - Found: byte `[11cb] = 1`, then `1762` (reset, 16 active voices: reg 0Eh = 0xcf), `187f` (voice setup), `184e`
    (frequency table), `2093` (sample-info pointers: `[116b + 2i] = 20 i`, i = 0..30).
  - Not found: `[11cb] = 0` and the GUS write routines are patched to `ret`.
- **`1942` load MOD.**
  1. Reads the 0x43c-byte header from `base + 0` (31 samples, "M.K.") into a temporary block.
  2. `19b2` keeps per sample (20-byte records at `126a+20i`): DRAM start, loop start, loop end, sample end
     (GUS address format), volume (64 -> 63) at `+0x10`, `finetune*72` at `+0x12`, loop flag at `+0x11`
     (8 = no loop, when repeat offset = 0 and length = 2).
  3. `1af1`:
     - song length to `[11dd]` (28);
     - order table to `008e:11df` (128 bytes);
     - number of patterns = max order + 1, kept in `[125f]` (26);
     - allocates `pat*1024` bytes at `[11d0]` and reads the patterns.
  4. `1b78` uploads the samples to GUS DRAM: 7 reads of 32 KB, byte by byte with `18dc`.
  5. `1bdf` converts each 4-byte note in place to: `[period index: 0 = none, else 2 + 2*k where k = position of the
     period in the 36-entry table 008e:05cf]`, `[sample number]`, `[effect]`, `[param]`.
  6. Frees the header and does `inc word [11dd]`, so the player's song length is 29 (one order too many, see
     below). Then calls `206d`.
- **`184e` frequency table.** `FC[p] = round(floor(3579364 / p) * 100 / 3700)` for periods p = 0x6c..0x38c, stored
  at `008e:0a4f + 2p`. The GUS mixes 16 voices (38587 Hz), so the pitch is `FC * 38587 / 1024` Hz, about 2.8 %
  above a PAL Amiga (NTSC clock and the 3700 divisor). Only voices 0..3 are used: voice = channel.
- **`008e:05cf`** = the 16 finetune period tables, 36 words each, starting 856 808 762 720 ... 113.
- **`1cc1` set volume.** `v = min(v, word [1cbf])`; GUS reg 9 = `word 008e:054d[v]`. The table holds 65 words:
  20000 39120 41376 42656 43936 45072 45696 46240 46848 47408 47952 48528 49072 49360 49632 49920 50160 50432
  50704 50928 51168 51424 51680 51952 52160 52448 52672 52912 53152 53312 53440 53584 53664 53808 53952 54048
  54144 54288 54400 54496 54608 54720 54832 54944 55072 55184 55312 55440 55552 55696 55760 55888 56016 56096
  56240 56304 56448 56528 56672 56752 56896 56976 57136 57216 57216.
- **`2068` volume cap.** `word [1cbf] = ax`; the initial value is 63. Only main 0878 calls it.
- **`18a9` stop.** For voices 31..0: voice control (reg 0) = 3 and volume control (reg 0Dh) = 3.
- **`18a4`** returns `ax = word [11cc]` (the sync counter, initial 0).

### 3.3 Player tick `008e:1f63`

Callers:
- the timer handlers 0731:007a and 0731:00f0;
- main 06b1;
- 0749:007d, 008f, 0185;
- 0777:0500, 053f, 0618, 0770, 082d, 09b9, 09da, 1125, 120c, 126a;
- 08a8:0262, 0291, 02b5, 02e7;
- 0cf9:0292.

State (all in 008e):
- `word [1261]` order (0)
- `byte [1263]` row (0)
- `word [1264]` row pointer (0)
- `word [1266]` break offset (0)
- `byte [1268]` speed (initial **8**)
- `byte [1269]` tick (0)
- per channel:
  - `[14d6+ch]` last sample
  - `[14e6+2ch]` effect word (low byte = effect, high byte = param)
  - `[1506+2ch]` period
  - `[1526+ch]` volume
  - `[1536+ch]` note index
  - `[1546+2ch]` finetune offset

```
pusha; cli; ds = pattern segment [11d0]; si = [1264]
for ch = 0..3: select voice ch
  if tick == 0:
    idx = byte, smp = byte                       ; converted note
    if idx|smp != 0:
      if smp: lastSample[ch] = smp; set volume = sample volume (1f48 -> 1cc1)
      if idx: noteIndex[ch] = idx
              if effect byte != 3:                ; tone portamento does not retrigger
                if smp == 0: (use lastSample for the sample addresses)
                program the voice start/loop/end addresses (1c49), loop mode = sample flag
                period = periodTable[finetune(lastSample)*36 + idx/2 - 1]; FC = FC[period] (1cef); start voice (1ce0)
    effectWord[ch] = (param << 8) | effect
  if effectWord[ch] != 0: call handler[effect] (table 008e:11ab)
tick++
if tick >= speed: tick = 0; [1264] += 16; row++
   if row >= 64: order++; if order >= songLength+1: order = 11
                 [1264] = orderTable[order]*1024 + [1266]; row = 0; [1266] = 0     (206d)
pop; sti; retf
```

Effect handlers (they run on tick 0 too, after the note):
- **0 arpeggio** (when the effect word is nonzero).
  - Tick 0: computes the base, +x and +y periods from the note index (index + 2x, index + 2y; an index >= 0x46
    becomes 0).
  - Ticks >= 1: tick t uses +x if t%3 == 0, +y if t%3 == 1, base if t%3 == 2 (table 008e:1606).
- **1 / 2 porta up / down.** Ticks > 0 only: period -= / += param, clamped to 113 / 856. The effect is cleared
  when the period is already at the limit.
- **3 tone portamento.**
  - Tick 0 with a param: target = period of the note, step = param (signed toward the target).
  - Every tick: period += step until the target is reached, then the effect is cleared.
- **8xx: `word [11cc]++` (sync), then the effect is cleared.**
- **A volume slide.**
  - Tick 0 stores the slide: param > 0x0f means up by (param >> 4); otherwise down by param.
  - It is applied on every tick *including tick 0* (unlike ProTracker).
  - The volume is clamped to 0..63; reaching a clamp clears the effect.
- **C** set volume, then clear.
- **D** `[1266] = param*16` (raw param, not BCD), `row = 63`, clear.
- **F** if param <= 0x1f: `speed = param + 3` (tempo conversion to the 70 Hz tick); a larger param (BPM) is ignored.
- **4..7, 9, B, E** are ignored.

### 3.4 The song and its timeline

"Beastsong":
- Song length 28, order list: 15 0 9 1 2 3 4 5 14 6 7 8 10 11 12 13 18 22 20 20 17 16 19 21 23 24 25 25.
- The player also plays order 28 (pattern 0), then loops to order 11.
- Most patterns start with F08 (speed 11); pattern 15 row 1 has F08 and F7F (ignored), so row 0 runs at speed 8.
- Real tempo: 11 ticks / 70.086 Hz = 0.15695 s per row. The author's intent is F08 + F7F = speed 8 at 127 BPM =
  0.15748 s per row, so the +3 is a deliberate conversion.
- `work/G1/songsim.py` simulates this (ticks from the first tick).

| tick | music s | event |
|---|---|---|
| 0 | 0 | order 0 (pat 15) |
| 701 | 10.00 | order 1 |
| 1372 | 19.58 | **sync 1** (order 1 row 61) |
| 2736 | 39.04 | **sync 2** (order 3 row 57) |
| 4573 | 65.25 | **sync 3** (order 7 row 0) |
| 5629 | 80.32 | **sync 4** (order 8 row 32) |
| 8093 | 115.47 | **sync 5** (order 12 row 0) |
| 11613 | 165.70 | **sync 6** (order 17 row 0) |
| 18829 | 268.66 | order 28 (pattern 0) |
| 19533 | 278.70 | loop to order 11 |

Orders last 704 ticks, except order 6 (pattern 4, break at row 31) = 352 and order 20 (pattern 17, break at row 15)
= 176.

**Checked against the recording.**
- Audio onset at 8.339 s, so tick 0 is at about frame 585.
- Predicted sync frames (585 + tick − drift) against the frames where the effects change:

  | sync | predicted frame | observed change |
  |---|---|---|
  | 1 | 1957 | GBU logo at 1960 |
  | 3 | 5147 | plasma ends at 5146 |
  | 5 | 8667 | water at 8667 |
  | 6 | 12190 | white flash at 12189 |

- The drift was measured by correlating the recording's band-onset envelope with a rough render of the MOD using
  these player rules (`work/G1/render.py`, `align2.py`, `align3.py`).

## 4. Timers 0731 / keyboard 072c

Variables of 0731:
- `cs:[0]` / `cs:[2]`: old int 8 vector
- `cs:[4]`: tick counter (0)
- `cs:[6]`: PIT count per frame
- `cs:[8]`: high word used while measuring

Routines:
- **`0731:000a` measure.** Done 16 times:
  1. PIT ch0 control 34h (mode 2), write low byte 0.
  2. Wait for the retrace start (3da bit3: wait while 1, then until 1).
  3. Write high byte 0: the count starts at 65536.
  4. Wait for the next retrace start.
  5. Latch (43h = 0) and read the count c.
  6. Sum += (−c) & 0xffff.

  Then `[6] = sum / 16`: about 17024 at 70.086 Hz. Takes 32 retraces. Main then subtracts 200.
- **`0731:007a` IRQ0 (retrace timer).**
  1. Wait until 3da bit3 = 1 (level, not edge).
  2. PIT ch0 mode 3 (36h), count = `[6]`.
  3. `inc [4]`, EOI.
  4. `lcall 008e:1f63`.

  The PIT fires about 200 PIT ticks (~168 µs) before each retrace, so one tick happens at every retrace start.
- **`0731:00a3`** wait for the next tick: sti, `[4] = 0`, spin until `[4] != 0`.
- **`08d8:157e`** (shared helper) reads `0731:[4]` without resetting it, as the "ticks since the last 00a3" count.
  Callers: 0cc5, 0d2e, 0d34, 0d97, 0db5, 0e40, 126e, 08d8.
- **`0731:00b4`** save the int 8 vector. **`00c6`** restore it. **`00d8`** set int 8 = 00f0. **`00e4`** set int 8 = 007a.
- **`0731:00f0`** music-only IRQ: `lcall 1f63`; EOI. **It does not increment `[4]`.**
- **`0731:00fc`** (near) PIT ch0 mode 3, count = 1193180 / bx.
- **`0731:0113`** PIT ch0 count 0 (18.2 Hz).
- **`0731:0120`**: wait for the retrace start edge, PIT 70 Hz (count 17045), int 8 = 00f0. Callers: 0749:029f,
  0777:0995.
- **`0731:013c`**: wait for the retrace start edge, PIT 17045 (the first tick then resyncs to the retrace),
  int 8 = 007a. Callers: main 0498 05af 0675 06c5 07a0, 0777:1220, 08d8:2859 30eb 311f, 0d34:0611.
- **`0731:0158`**: wait for the retrace start edge, PIT 18.2 Hz, BIOS int 8. Callers: 0749:027a, 0777:09a0,
  08a8:01fe, 08d8:30d0 3102, 0cf9:0212, 0d34:05f6.
- **`072c:0004`** save the int 9 vector. **`0016`** restore it. **`0028`** install `072c:0034`.
- **`072c:0034`** IRQ1: read port 60h; on ESC (1): EOI, then `jmp far 0000:088a` (the stack is not cleaned).
  Otherwise EOI and iret; keys are not passed to the BIOS.

## 5. Video library 0299

Callers are listed by segment.

- **`0299:0000` RLE unpack.** In: ds:si source, es:di destination, bx = output byte count.

  ```
  do { c = [si++];
       if (c <= 0x7f) { n = c+1; copy n literal bytes }
       else           { n = 0x101-c; v = [si++]; write v n times }
       bx -= n } while (bx != 0)
  ```

  Caller: 08d8 (275d).
- **`0299:0023` palette interpolation.** In:
  - cx = number of colors
  - ds:si = source palette
  - ds:di = destination palette
  - ds:bp = output
  - dh = step, dl = number of steps

  For each of the 3*cx bytes: `out = src + trunc_signed((int8)(dst-src) * (int8)dh / (int8)dl)`. It uses
  8-bit imul and idiv; the quotient truncates toward 0. Callers: 0749, 0777, 08a8, 08d8, 0cc5, 0cf9.
- **`0299:0045` attribute palette.** Reset the 3c0 flip-flop (read 3da); attribute regs 0..15 = 16 bytes at ds:si;
  then 20h.
- **`0299:005e`**: attribute regs i = i (i = 0..15). Caller: main.
- **`0299:0076` set DAC.** In: di = first index, cx = count, ds:si = 3*cx bytes of 6-bit values.
  - Sets SR1 bit5 (screen off) first and clears it after.
  - No retrace wait.

  The most used routine (main and every effect segment).
- **`0299:009c`**: attribute mode control (10h) |= 80h (P54S). Callers: 0777, 08d8. **`00b0`**: clears it again
  (no caller found).
- **`0299:00c4`**: CRTC 9 &= 7fh. **`00d0`**: CRTC 11h &= 7fh (unlock). Caller of both: 0777:0995.
- **`0299:00f5` "mode X" set.**
  1. int 10h mode 13h, then cli.
  2. Wait until in retrace, then until the retrace ends.
  3. SR4 = 06h (chain-4 off).
  4. Attribute 10h = 61h, attribute 11h = 0 (border).
  5. CRTC 11h unlock, then CRTC 0..18h from the table at 0299:00dc:
     `5f 4f 50 82 54 80 bf 1f 00 c0 00 00 00 00 00 00 9c 8e 8f 28 00 96 b9 e3 ff`.
     This gives 320x200 unchained, 80 bytes per line, CRTC 9 = c0h (double scan), line compare 3ffh.
  6. Map mask 0fh; clear a000:0000..ffff on all 4 planes (256 KB). sti.

  Caller: main 0479.
- **`0299:0175` unchained 256 colors without a BIOS call, no clear.** Attribute 10h = 41h, GC5 = 40h, SR1 = 01h,
  SR4 = 06h, CRTC from table 0299:015c (identical to the 00dc table). Callers: main 0692, 0749:01ff, 08d8:28c9 2b20,
  0cf9:01f0.
- **`0299:01cc` EGA 320x200x16 planar (mode 0Dh registers), no clear.** Attribute 10h = 01h, GC5 = 00h,
  SR1 = 09h, SR4 = 06h, CRTC from 0299:01b3:
  `2d 27 28 90 2b 80 bf 1f 00 c0 00 00 00 00 00 00 9c 2e 8f 14 00 96 b9 e3 ff` (40 bytes per line).
  - Pixels map through the attribute palette (identity, from 005e) to DAC 0..15.
  - The main script uses it as a neutral or blank mode between effects.

  Callers: main (11 times), 0777:11f7, 08d8:299b 306e.
- **`0299:020a`**: attribute 11h (border) = ffh; DAC[255] = 0,0,0. Callers: main 047e 06b6.
- **`0299:0227` line compare = bx.** Bits 0..7 to CRTC 18h, bit 8 to CRTC 7 bit4, bit 9 to CRTC 9 bit6. Callers:
  08d8:1810 1968.

Shared fades in segment 0749, used by several effects:
- **`0749:0192`** fade. In:
  - ax = number of colors
  - si = from-palette, di = to-palette
  - bp = work buffer
  - dl = number of steps
  - bx = first DAC index

  For dh = 1..dl:
  1. Work = interpolation (0299:0023).
  2. Wait for the retrace start (while bit3, then until bit3).
  3. Upload the DAC (0299:0076).

  So one step per frame and dl frames in all.
- **`0749:0153`**: the same, plus `lcall 008e:1f63` after each step (used while the BIOS timer is installed).
- Callers: 11d6 (0192), 08d8:30e6 311a and 0d34:060c (0153).

## 6. MyLZ = LZEXE 0.91

GBU.EXE packed file:
- MZ header: 2 paragraphs, 0 MZ relocations, CS:IP = 08be:000e, SS:SP = 1400:0080.
- "MyLZ" at file offset 1ch: this is the LZEXE "LZ91" signature renamed. The stub text contains "*FAB*" (Fabrice
  Bellard).

Stub header at 08be:0000 (words):

| offset | value | meaning |
|---|---|---|
| 0 | 03b1 | IP |
| 2 | 0000 | CS |
| 4 | 0100 | SP |
| 6 | 13b9 | SS |
| 8 | 08be | paragraphs of packed data |
| a | 0b0c | move distance in paragraphs |
| c | 0357 | stub size |

How the stub runs:
1. **Move.** 000e copies itself (backward, std) to `ds + [a]` and continues there at 002b. 002b..0058 move the
   packed data (in chunks of at most 1000h paragraphs) up to `load + 0b0ch`.
2. **Decompress** (005a..00f4) from `load + b0c0h` to `load:0000`.
   - Control bits come from 16-bit words, LSB first. The next word is read immediately after its 16th bit is used.
   - Bit 1: copy 1 literal byte.
   - Bits 0, 0, b1, b2: length `2*b1 + b2 + 2`; offset = byte − 256.
   - Bits 0, 1: read a word w.
     - Offset = `(((w >> 11) | 0xe0) << 8 | (w & 0xff)) − 65536` (13-bit).
     - If `(w >> 8) & 7` is nonzero, length = that + 2.
     - Otherwise read a byte n: 0 = end, 1 = segment renormalisation (no output), else length = n + 1.
   - Copies are byte by byte, so they may overlap.
3. **Relocate** (00fc). The table is at stub offset 158h (taken from `mov si, 0158h` at 00fe).
   - A byte b != 0 means: pointer += b, then add the load segment to that word.
   - A byte 0 is followed by a word w: w = 0 means pointer += 0fff0h; w = 1 means end; otherwise pointer += w and
     patch.
   - The pointer starts at the load segment.
   - There are 452 entries, identical to `re/relocs.txt`.
4. **Start.** `ss = 13b9 + load`, `sp = 0100`, `ds = es = PSP`, `jmp far (0000 + load):03b1`.

The decompressed program is 0x13b8c bytes. `re/img.bin` (0x13b90) has 4 more bytes up to the stack segment:
`02 7e 13 be`. These are leftovers of the moved packed copy (packed[0x13b8c − 0xb0c0]), not program data.

`work/G1/mylz.js` exports `unpackGbu(exeBytes) -> {image, relocations, entry:{cs:0, ip:0x3b1},
stack:{ss:0x13b9, sp:0x100}}`. It reproduces the memory up to `ss:0`, leftovers included. The check
`node work/G1/check_mylz.mjs` reports image identical (80784 bytes) and relocations identical (452).

## 7. Open points

- The boundary 0d97/0d34 (~24640) and the sub-boundaries inside 08d8:3041..3e3a are measured, not derived from code.
  Their readers should refine them.
- The 11d6 / 196e / 032c boundaries (frames 2/3, ~440, ~510) are approximate (±3 frames).
- The music drift values are ±1 tick. The plasma's music gain comes from its loop period, which the plasma reader
  must derive.

## 8. Silent sequencer for the port: exact rules and who ticks the player

The port does not play audio. It only needs tick -> (order, row, speed, sync counter). The module is
`work/G1/song.js`: `createSong(modBytes)` returns `{ tick(), order, row, speed, tickInRow, syncCounter, pattern }`.
`modBytes` = GBU.EXE from file offset 0x9c40.

### 8.1 Initial state

`008e:1942` runs at main 0465. It reads the header and sets the song length (`[11dd] = 28 + 1`). Then `206d` sets:
- order 0
- `rowPointer = orders[0]*1024` (pattern 15)
- row 0
- break offset 0

The image already holds speed 8, tick 0 and sync 0. The first tick is the first timer IRQ after `0731:013c` at
main 0498: about frame 585.

### 8.2 One tick (`008e:1f63`)

1. **Read the row (tick 0 only).** If tickInRow == 0, read the 4 cells of the row and run their effects in channel
   order 0..3, in this same call. Effects with a nonzero effect word also run on later ticks, but 8, D, F, C clear
   themselves, so for timing they only act on tick 0.
2. **Advance the tick.** tickInRow++. If tickInRow >= speed (the speed after this row's Fxx):
   1. rowPointer += 16, tickInRow = 0, row++.
   2. If row >= 64: order++; if order >= 29, order = 11. Then `rowPointer = orders[order]*1024 + breakOffset`,
      row = 0, breakOffset = 0.

### 8.3 Effects that change timing, position or sync

| effect | rule |
|---|---|
| Fxx | xx <= 0x1f: speed = xx + 3. xx > 0x1f: ignored (the song's F7F BPM command does nothing). |
| Dxx | breakOffset = xx*16 (raw hex param, so D10 means row 16); row = 63, so the order advances when this row ends. Only D00 is used (pattern 4 row 31, pattern 17 row 15). |
| 8xx | sync counter += 1, any param (8 00 is used). |
| Bxx, Exx (E6x loop, EEx delay...), 9xx, 4..7 | ignored: handler `ret`. |

Speed starts at 8; pattern 15 row 1 sets speed 11, and every main pattern restarts with F08 = 11. The song never
changes the speed otherwise. Rows last 11 ticks; orders last 704 ticks, or 352 / 176 with a break.

### 8.4 Sync ticks (0-based index of the `tick()` call that raises the counter)

| sync | tick | order / row | predicted frame (585 + tick − drift) | observed |
|---|---|---|---|---|
| 1 | 1372 | 1 / 61 | 1957 | GBU logo 1960 |
| 2 | 2736 | 3 / 57 | 3321 | (credits still running; plasma starts later) |
| 3 | 4573 | 7 / 0 | 5147 | plasma ends 5146 |
| 4 | 5629 | 8 / 32 | 6203 | cyclic plasma starts its fade |
| 5 | 8093 | 12 / 0 | 8667 | water starts 8667 |
| 6 | 11613 | 17 / 0 | 12190 | wobbler ends / white flash 12189 |
| 7 | 19500 | 28 / 61 | 20078 | (nobody waits for it) |

`node work/G1/check_song.mjs` prints these.

### 8.5 Who ticks the player, phase by phase

| from | to | what calls 1f63 |
|---|---|---|
| main 0498 `013c` | `0cf9:0212` | IRQ 007a: exactly 1 tick per retrace |
| `0cf9:0212` (`0158`, BIOS timer) | end of 0cf9 | by hand at `0cf9:0292`, once per loop iteration. The loop (0224..033e) does not wait for a retrace start, so it is a bit shorter than a frame: some frames get 2 ticks (+11 ticks over 53.2..73.4 s, measured) |
| main 05af `013c` | `0749:027a` | IRQ: 1 per retrace |
| `0749:027a` (`0158`) | `0749:029f` | by hand: `0749:007d` / `008f` in its loop, `0749:0185` (fade 0153) once per faded frame |
| `0749:029f` (`0120`) | main 0675 | IRQ 00f0 at 70.000 Hz, not synced to the retrace: one frame in about 800 gets 0 ticks |
| main 0675 `013c` | `08a8:01fe` | IRQ |
| `08a8:01fe` (`0158`) | end of 08a8 | by hand: 08a8:0262, 0291, 02b5, 02e7 in its retrace loops |
| main 06b1 | | one hand tick; the BIOS timer is still active, so it is not a double tick |
| `0777:0995` (`0120`) | `0777:09a0` | IRQ at 70.000 Hz during the precalc (0777:02fa, 0895) |
| `0777:09a0` (`0158`) | `0777:1220` (`013c`) | by hand: 0777:09b9, 09da, 0500, 053f, 0618, 0770, 082d, 1125, 120c, 126a |
| `0777:1220` | | IRQ (main 06c5 `013c` again) |
| `08d8:30d0` (`0158`) | `30eb` (`013c`) | by hand, fade 0749:0153: 1 tick per faded frame; again from 3102 to 311f |
| `0d34:05f6` (`0158`) | `0611` (`013c`) | by hand, fade 0749:0153 |
| all other times, to main 088a | | IRQ: 1 per retrace |

Each `013c` / `0158` / `0120` call waits for a retrace start edge, so the switch can leave one frame without a
tick. Hand-ticked loops that take longer than a frame give 0-tick frames. The per-effect readers must give each loop's
period.

Measured cumulative drift, in ticks ahead of "1 per frame from frame 585":
0 to 53 s, +11 at 73.4 s, +10 at 122 s, +8 at 156 s, +9 at 164..198 s, +11 at 212 s, +7 at 294 s, +6 at 326 s,
+4 at 372 s (all ±1).

Port rule: call `song.tick()` exactly where the original calls `008e:1f63`. Then the sync waits (`08d8:2c6c` >= 1,
`0cf9:0208` >= 2 and loop until == 3, `0cc5:030c` >= 4, `08d8:1941` >= 5, `08a8:02ed` >= 6) land on the frames
above.
