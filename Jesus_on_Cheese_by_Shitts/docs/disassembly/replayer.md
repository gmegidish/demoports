# The ProTracker replay routines, and Paula

Each part carries its own copy of the ProTracker 2.x replay routine (the "mt_" routine shipped with
ProTracker 2.1/2.2: `mt_init`, `mt_music`, `mt_end`, effects 0-F and E0-EF, speed only — `Fxx` never sets a
BPM; the routine is called once per frame). Port: `src/replayer.js`. Paula and the mixer: `src/paula.js`.

## Copies and addresses

| | part 1 | part 2 | part 3 |
|---|---|---|---|
| mt_init | $bbf6 | $65640 | $db14 |
| mt_end | $bc8a | $656d2 | $dba8 (never called) |
| mt_music | $bcac | $656f4 | $dbca |
| called from | copper interrupt $a5c8, line $c2 | interrupt tail $d96a, after `cmpi.b #$e8,$dff006` | interrupt $a824, after `cmpi.b #$fd,$dff006` |
| mt_FunkTable / VibratoTable / PeriodTable | $c752 / $c762 / $c782 | $661a4 / $661b4 / $661d4 | $e670 / $e680 / $e6a0 |
| channel structures (mt_chan1temp..4) | $cc02, +$2c each | $66654, +$30 each | $eb20, +$2c each |
| mt_SampleStarts (31 longs) | $ccb2 | $66714 | $ebd0 |
| mt_SongDataPtr + variables | $cd2e | $66790 | $ec4c |
| 32 sample-header pointers (written, never read) | $cd40 | $667a2 | $ec5e |
| module | $cdc0 "introbit" | $66822 "happy-answer" | $112ee "in-the-bag" |

Part 3's code is part 1's moved up by $1f1e byte for byte (only the absolute addresses of the variables
differ); its module is not next to it. Every part guards the calls with `cmpi.l #$abcdef,<module>`: the module
slot holds $abcdef when the part was built without music.

The modules (all M.K., 31 samples):
- introbit: 2 positions, effects 1, 2, C, F (F07, F0F).
- happy-answer: 29 positions over 20 patterns, effects A, C, E9 (retrigger), F05.
- in-the-bag: 21 positions over 9 patterns, effects C, F06.

## The variables (offsets from mt_SongDataPtr)

| +0 | long | mt_SongDataPtr (the module) |
|---|---|---|
| +4 | byte | mt_speed (6 after init) |
| +5 | byte | mt_counter (ticks into the row) |
| +6 | byte | mt_SongPos |
| +7 | byte | mt_PBreakPos |
| +8 | byte | mt_PosJumpFlag |
| +9 | byte | mt_PBreakFlag |
| +10 | byte | mt_LowMask (E1x/E2x) |
| +11 | byte | mt_PattDelTime |
| +12 | byte | mt_PattDelTime2 |
| +14 | word | mt_PatternPos (row x 16) |
| +16 | word | mt_DMACONtemp |

## A channel structure

| +$00 | long | the row's 4 bytes: note (period + sample high nibble), command, parameter |
|---|---|---|
| +$04 | long | sample start (n_start) |
| +$08 | word | length in words (n_length) |
| +$0a | long | loop start (n_loopstart) |
| +$0e | word | loop length in words (n_replen) |
| +$10 | word | period (n_period) |
| +$12 | byte | finetune |
| +$13 | byte | volume |
| +$14 | word | DMA bit (1, 2, 4, 8; preset in the part's data) |
| +$16 | byte | tone portamento direction |
| +$17 | byte | tone portamento speed |
| +$18 | word | wanted period |
| +$1a / +$1b | byte | vibrato command / position |
| +$1c / +$1d | byte | tremolo command / position |
| +$1e | byte | wave control (vibrato low nibble, tremolo high) |
| +$1f | byte | glissando (low nibble) / funk speed (high) |
| +$20 | byte | sample offset |
| +$21 / +$22 | byte | E6x loop row / count |
| +$23 | byte | funk offset |
| +$24 | long | funk position (n_wavestart) |
| +$28 | word | real length |
| +$2a | word | part 2 only: 1 when this row named a sample, else 0 |

Part 2's oscilloscopes read channels 1 and 4 ($66654 and $666e4): sample start +4, length +8, loop length
+$e, period +$10, volume +$13.

## Part 2's variant

Three differences, nothing else (instruction-level diff with addresses normalised):
1. mt_init does not `clr.l (a2)` the first long of every sample (parts 1/3 do: ProTracker's convention so a
   one-shot sample's 2-byte "loop" at its start is silent). It makes no difference here: every sample in
   happy-answer already starts with a zero word, as ProTracker saves them.
2. mt_playvoice clears the word at +$2a, and sets it to 1 when the row has a sample number.
3. Hence the structures are $30 bytes apart, not $2c.

## Quirks kept (they are ProTracker 2.x's own)

- mt_SetTonePorta indexes the period table with `mulu #$4a` (37 words) though rows are 36 words ($48): with a
  finetune other than 0 the target period comes from the wrong row.
- mt_SetPeriod and the arpeggio search 37 entries, so a note not in the table reads one word past the row.
- Tremolo's ramp-down waveform tests the vibrato position (+$1b), not the tremolo one.
- `9xx` sample offset is applied twice on a row with a note (`bsr mt_CheckMoreEfx`, then mt_SetPeriod ends in
  mt_CheckMoreEfx again); Paula gets the first, the structure keeps the second.
- Volume slide up: `cmpi.b #$40 / bmi`, so a volume of $c0 or more is not clamped; slide down clamps on `bpl`.
- `E0x` writes $bfe001 twice (`andi.b #$fd` then `or.b`): the LED filter is switched on, then as asked.
- mt_DoRetrig (E9x, EDx) ends with `move.l $e(a6),$4(a5)`: AUDxLEN = loop length and AUDxPER = period.
- mt_init: the highest pattern is found with a signed byte compare (`ble`).
- Word/byte arithmetic exactly as the 68000 does it: `add.w mt_PatternPos,d1` (no carry into the high word),
  byte wrap of positions, volumes and funk offsets.

## Timing within the frame

The routine has two delay loops between DMACON writes, `move.w #$118,d0 / dbra d0,*`: about 2822 CPU cycles
at 7.09 MHz = 0.398 ms (6 raster lines). They are dbra loops, not $dff006 waits. On a new row:
DMACON off for the new notes, AUDxLC/LEN/PER, **wait**, DMACON on, **wait**, AUDxLC/LEN = the loops (channel 4
first). The port time-stamps every write: the frame's time + the raster line the part calls mt_music at
(`musicLine`, from the table above) + 0.398 ms per wait passed (`setPaulaCursor` / `delayPaula`).

## Paula model (src/paula.js)

- AUDxLC/LEN/PER/VOL are latches. DMA on (DMACON bit n while DMAEN, bit 9, is set) copies LC/LEN into the
  channel's counters and starts from the first byte; at the end of the block it reloads from the latches —
  that is how the loop pointers written 0.4 ms after DMA-on take effect, and how a loop length of 1 at a
  cleared sample start becomes silence. DMA off stops the channel (its output goes to 0).
- Each byte lasts AUDxPER colour clocks (3,546,895 Hz); a period change applies from the next byte. LEN 0 =
  65536 words, PER 0 = 65536. Volume: bit 6 set = 64, else bits 0-5. Bytes are read from chip RAM when played
  (so EFx's sample rewriting is heard).
- Mixing: each output sample is the average of every channel over its duration (box filter), channels 0+3
  left, 1+2 right, hard-panned (as the hardware), scaled so that two full channels make 1.0.
- Filters: the A500's fixed one-pole low-pass (360 ohm / 0.1 uF = 4.42 kHz), the LED filter (Sallen-Key, 10 k /
  6800 pF / 3900 pF: 3.09 kHz, Q 0.66) while the LED is on, and the output's AC coupling (5.2 Hz high-pass).
  Every mt_init sets $bfe001 bit 1 (LED filter off) and no module uses E0x, so the LED filter never plays.

### The filter choice, against the capture

`node tools/render-audio.mjs port.wav 300` against the capture's audio (`ffmpeg -i a.mp4 -vn -ar 48000`),
long-term spectrum ratio capture/port over part 2 (capture 50-200 s):

| band | with the A500 filter | without |
|---|---|---|
| 1-2 kHz | -0.3 dB | -0.7 dB |
| 3-4 kHz | -0.6 dB | -2.5 dB |
| 4-6 kHz | -0.8 dB | -4.1 dB |
| 8-11 kHz | -2.2 dB | -9.0 dB |
| 11-15 kHz | -3.8 dB | -12.4 dB |

With the fixed filter the port is within 1 dB up to 6 kHz (the rest is the capture's AAC and its emulator's
resampling); without it the port is far too bright. A LED filter (12 dB/octave from 3.1 kHz) would make the port
much darker than the capture, which agrees with the replayers switching it off. So: fixed filter on, LED off.

### Tempo, pitch, stereo, against the capture

- Onsets (spectral flux, 10 ms hops) cross-correlated in 8 s windows: port time − capture time = 1.89 s in
  part 1 (capture 8-14 s, correlation 0.79-0.90), then 1.94 s at capture 47 s rising steadily to 2.04 s at
  capture 220 s (correlation 0.73-0.94).
- Pitch (log-frequency cross-correlation of long-term spectra, 262144-point FFT): the capture is 0.060% higher
  over part 2.
- Both are the same 0.06%: the capture runs at exactly 50.00 frames/s, the port at the PAL 49.97 (FRAME_MS =
  312 x 227.5 / 3,546,895 s). The capture was made at 50 Hz (an emulator locked to its 50 Hz video); the port
  keeps the real machine's clock. Tempo and pitch match otherwise; video aligned to the capture will drift by
  the same 0.06% (0.1 s over part 2).
- Stereo: the capture's left/right correlation in part 1 is 0.51 against the port's 0.08; mixing each side
  with 0.22 of the other reproduces it — the capture tool's stereo separation, not the Amiga. The port stays
  hard-panned.

## The browser side

`src/audio-worklet.js` (processor name `paula`) runs its own runner with `isAudioOnly` and a mixer in step
with its sample clock; its message protocol is documented at the top of the file. The page and the worklet
use the same demo clock: AudioContext.currentTime. `tools/render-audio.mjs` renders the same mixer to a WAV
(`--part N` drives only one part's replayer at 50 Hz, without the parts' code).

## Verification

`tools/re/trace_replayer.py <part> <part.bin> <frames> <out.json.gz> [fuzz seed]` runs the ORIGINAL code under
Unicorn (68000 model): the part at $a500 in 512 KB, $dff000 and $bfe000 pages hooked, mt_init then mt_music
once per frame. It logs every custom-register and $bfe001 write (word by word, with the number of DMA wait
loops passed), the variables and channel structures after every frame, and the sample bytes changed at the
end. With a seed it first writes random patterns using every effect (B/D rare, E commands half the time) over
the module, to reach the code the demo's modules never use. `test/replayer.test.js` replays each fixture with
the port and requires identical writes, identical variable memory every frame and identical sample memory:

| fixture | frames | writes | variable byte changes |
|---|---|---|---|
| part 1 module | 3000 | 16,923 | 5,059 |
| part 2 module | 11000 (the whole song and its restart) | 96,830 | 73,783 |
| part 3 module | 9000 (the whole song and its restart) | 56,745 | 14,030 |
| part 1 code, random patterns, seeds 1 and 3 | 3000 each | 11,936 / 11,948 | 18,152 / 21,938 |
| part 2 code, random patterns, seeds 1 and 3 | 3000 each | 11,938 / 11,948 | 20,041 / 23,798 |

All identical. Line coverage of src/replayer.js by these runs: 97% (not reached: mt_end, which is three
writes, and a few corner branches of tone portamento, glissando and sample offset).
