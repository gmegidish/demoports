# exe0: the loader and the music system

APPEAL.EXE's first MZ program (`work/exe0.exe`) is the loader plus Robban's music system. The loader copies the
other six programs to XMS, runs the setup screen (exe1), starts the music and then runs the five demo parts
(exe2..exe6) one after the other. The music system is a ProTracker MOD player and software mixer. Parts reach it
through `int 0x80`.

Segments in the listing: the loader code is at `0040:` (data in its own code segment, `cs:`). The music code is at
`0c00:`, and its data segment is `0xef` (written `ef:XXXX` below; peek with `peek.py 0 00ef:XXXX`).

The extra entry points used to regenerate `work/exe0.lst` (repeat all of them when you run hdis.py again):

```
0040:0490 0040:0945 0040:0660 0040:0714 0040:07c8 0040:087c 0040:0930 0c00:3067 0c00:2986 0c00:295c 0c00:24d5
0c00:26ee 0c00:3033 0c00:3000 0c00:3079 0c00:3093 0c00:30ac 0c00:30b5 0c00:30c0 0c00:30c9 0c00:30dd 0c00:30e7
0c00:30f0 0c00:30fd 0c00:3111 0c00:311a 0c00:3125 0c00:3130 0c00:3147 0c00:315e 0c00:3177 0c00:318e 0c00:31a7
0c00:31f3 0c00:31fc 0c00:3208 0c00:321d 0c00:27ee 0c00:15a2 0c00:2e6c 0c00:1e0f 0c00:1e29 0c00:1e5b 0c00:1e89
0c00:1ec7 0c00:1f27 0c00:1f81 0c00:2002 0c00:2026 0c00:2037 0c00:204d 0c00:2075 0c00:2266 0c00:22ba 0c00:22cb
0c00:22ef 0c00:2300 0c00:230d 0c00:231a 0c00:2341 0c00:23b7 0c00:23cf 0c00:23e7 0c00:23f6 0c00:2401
```

(The last 25 are the targets of the effect jump tables at `0c00:2455`, `2475` (row effects, Exx on a row), `2495`
and `24b5` (effects on the other ticks).)

## Summary for the port

- **The song runs on real (audio) time, not on retrace.** One tick is `[ef:adbc]` mixed samples. That is
  `rate/50` at start, and an Fxx with xx >= 0x20 sets it to `rate*5/(2*BPM)`. The MOD never changes the BPM, and
  every Fxx in it is F08. So one tick = 20 ms, one row = 8 ticks = 0.16 s, and one order = 64 rows = 10.24 s,
  exactly at 20 kHz. The setup caps the Sound Blaster at 20000 Hz, so that is the SB rate.
- **The frame counter runs on retrace.** The music IRQ (IRQ0) is a PIT timer set slightly *faster* than the
  measured retrace rate. Each time it fires it busy-waits for vertical retrace, increments the frame counter, calls
  the part's callback, then mixes one frame of audio (and runs any ticks/rows that fall inside it). The number of
  samples mixed per frame is servoed to the SB DMA position, so the audio keeps real time whatever the retrace
  rate.
- **Video timing.** Every mode the parts use is retimed to about 60 Hz. The loader sets mode 3 with 528 total
  lines, which is 31.469 kHz / 528 = 59.60 Hz. This matches the recording's 59.59998 Hz. exe4's 640x400 mode has
  527 lines: 59.71 Hz, and its recording runs at 59.713 Hz.
- **When the music starts.** The music starts (fn 2) a few ms before exe2's first instruction. The song state is
  order 0 (pattern 10), row 0. exe2, exe4 and exe5 each pause the music briefly around their mode set (fn 0x1d
  twice). That freezes the song and silences the audio for about 23 ms (measured: silence from 8 to 31 ms in
  a16/a18/a19). exe3 and exe6 do not pause. Nothing else resets or changes the music between parts. exe6 fades the
  master volume (fn 9) at its end.
- **Mapping recorded audio time to song position.** Song time = audio time minus about 0.02 s for each pause
  already passed. Then `order = floor(songTime / 10.24)` and `row = floor((songTime mod 10.24) / 0.16)`. Parts see
  `fn 0x0a = order + 1` and `fn 0x0c = row + 1` (orders 0..31, then after order 31 row 63 the B15 jumps back to
  order 21). The state the parts read can lead the audible audio by up to about one frame (see Timing).
- **Between parts the loader does nothing visible.** There is no mode set, no palette change and no clear. Each part
  inherits the previous part's VGA state and the running music. The gap is only the XMS copy (a few ms).

## Startup: `0040:01ee` (entry)

```
cs:[0x120] = es (PSP); ds = cs
cs:[0x134] = (in 0xa1 << 8) | in 0x21           // original PIC masks, restored on exit
int21 4Ah es, bx=0x1000                        // shrink to 64 KB; fails -> "Internal Error..." (cs:0x0c), exit
if (smsw & 1) -> "This computer is already in v86 mode..." (cs:0xaf), exit   // sub 0a0a
sub_09ab: sgdt, build a GDT with a 4 GB data descriptor (selector 0x10), enter PM, load es/ds/fs/gs, leave PM
          -> "flat real mode": real-mode code can use 32-bit offsets from segment 0
cs:[0x13a] = 0x945                              // "return label": where a part's int21/4Ch goes
hook int 21h -> 0040:0995 (old vector saved at cs:[0x136]/[0x138])
int21 48h bx=0xffff: if largest free block < 0x83b5 paragraphs -> "Not enough memory! ..." (cs:0x44), exit
XMS: int2f 4300h must return al=0x80 (else exit silently); 4310h -> driver entry cs:[0x180]
  XMS fn 08: largest free KB must be >= 0x2bc (700) else "Not enough memory"
  XMS fn 09: allocate dx = largest free KB -> handle cs:[0x176]
  XMS fn 0C: lock -> 32-bit linear address dx:bx -> cs:[0x178]
open "Appeal.Exe" (string at cs:0, opened relative to the current directory, read-only) -> handle cs:[0x174]
```

### Sizing the seven MZ programs and copying exe1..exe6 to XMS (`0040:02c0`..`03ce`)

- There is a table at `cs:0x13c` with 7 entries of 8 bytes each: `{dword a, dword b}`.
- For k = 0..6 the loader reads the 0x1c-byte MZ header to `cs:0x18c`. Program size is
  `(pages[0x190]-1)*512 + lastpage[0x18e]`. It stores that size in `entry[k].a` and seeks forward
  `size-0x1c` to the next program.
- It seeks back to `entry[0].a` (the start of exe1). It allocates a 64 KB buffer with int21 48h, bx=0x1000.
- For entries 1..6 (exe1..exe6), `bp = 0x144 + 8*(k-1)`:
  - `size = entry.a`, and `entry.a = edi`, the current linear XMS address.
  - The program is read in 64 KB chunks and copied with `rep movsb es:[edi], [esi]`, using a 32-bit address with
    es = 0. Reading 64 KB is done as two reads: 0xffff bytes plus 1 byte.
  - edi is rounded up to a 16-byte boundary. Then `entry.b = edi - entry.a`, the aligned size.
- So `entry.a` = linear XMS address of the program's MZ file and `entry.b` = its size.
- int21 4201h, offset 0: the current file position goes to `cs:[0x188]` (lo) / `cs:[0x18a]` (hi). This is the file
  offset of the tail, i.e. the MOD (0xb21f3).
- The 64 KB buffer is freed. All free conventional memory is allocated (48h bx=ffff, then 48h with the size
  returned) -> segment `cs:[0x184]`.
- `pusha; push ds; push es`, and the loader's ss:sp is saved in `cs:[0x122]`/`[0x124]`.

### How a program is started (`0040:03fb` for exe1; the same code at 05cb, 067f, 0733, 07e7, 089b for exe2..exe6)

```
es = load segment (cs:[0x184], freshly allocated: all free memory)
esi = entry.a; copy (entry.b - hdrParas*16) bytes from esi + hdrParas*16 (linear, ds=0) to es:edi
   exe1: edi = 0x100 and base = es + 0x10    (a 256-byte PSP-sized gap. The `mov ah,0x26` at 03fb is never
                                               followed by an int, so the gap is NOT a real PSP)
   exe2..6: edi = 0 and base = es
for each relocation {off, seg} (count at hdr+6, table at hdr+[0x18]): word at base:(seg*16+off) += base
cs:[0x13a] = return label (0490 after exe1, 0660 after exe2, 0714, 07c8, 087c, 0930 after exe6)
ss = hdr.SS + base; sp = hdr.SP; ds = es = base; far-jump to (hdr.CS + base):hdr.IP
```

All registers other than ss/sp/cs/ip/ds/es hold whatever the loader had there. A part does not get a PSP: ds = es =
its own load segment. Parts shrink their memory block themselves with int21 4Ah (exe5: bx = 0x3d09).

### Return from a part: int 21h hook `0040:0995`

```
if (ah != 0x4c) jmp far old int21
cs:[0x0b] = al              // exit code
discard the iret frame (3 pops); jmp cs:[0x13a]
```

Each return label (`0660`, `0714`, `07c8`, `087c`, and `0930`, which has no check) does this:

```
cli; ss:sp = saved; sti; int21 49h es=cs:[0x184]    // free the part's memory
if (cs:[0x0b] == 1) goto END (0945)                 // exit code 1 = ESC = abort the demo
start the next part (as above)
```

`0930` (after exe6) falls straight into END. Exit codes other than 1 continue normally. The return path changes
**nothing** about video, palette, CRTC, PIC or music. It takes only the XMS-to-memory copy and the relocation
loop: a few ms at most, and nothing is visible.

### After exe1 (setup): `0040:0490`

```
restore stack; free exe1's memory
int10 ax=3                                  // text mode 80x25: screen cleared (black)
if (exit code != 0) goto 0959               // EXIT/ESC in setup: quit without touching the music
out 0x21, 0xfa; out 0xa1, 0xff               // PIC masks: only IRQ0 (timer) and IRQ2 (cascade) enabled.
                                             // The KEYBOARD IRQ1 IS MASKED for the whole demo: parts must poll
                                             // port 0x60 for ESC (scan code 1); BIOS int 16h gets nothing.
open Appeal.Exe; lseek(-9, SEEK_END); read 9 bytes -> cs:0x1a8; close
decode the config (below) -> cs:[0x1e2..0x1ec]
// 480-line retiming of the current text mode:
CRTC 0x11 &= 0x7f (unprotect)
misc output (3cc -> 3c2) |= 0xc0              // sync polarities for 480 lines; the clock is unchanged
CRTC: 06=0x0e 07=0x3e 09=0x41 10=0xc5 11=0xac 15=0x9c 16=0x00
lcall 0c00:3267  (install int 0x80 -> 0c00:3067)
int80 fn 0 (init: ax=device word, cx=port, dx=rate, si=interpolation, di=IRQ, bp=DMA)
int80 fn 1 (song position to order 0)
int80 fn 4 (load MOD: ds:dx = cs:0 "Appeal.Exe", cx:ax = cs:[0x18a]:[0x188] = 0xb21f3)
int80 fn 2 (start playing)
load and start exe2
```

The resulting timing in mode 3 (28.322 MHz, horizontal total 100x9 dots) works out like this:

- Vertical total = 0x20e + 2 = 528 lines. VT8 = 0 and VT9 = 1 from CR07.
- Display end is CR12 = 0x8f (unchanged from mode 3) with VDE8 = 1, so 400 lines are displayed.
- Vertical blank start = 0x19c and vertical retrace start = 0x1c5, with end at low nibble 0xc.
- Frame rate = 31469 / 528 = **59.60 Hz**.
- CR09 = 0x41 makes each character cell 2 scanlines tall. The screen is blank anyway.

The recording shows this as video0015: 3 black frames at 720x400, 59.6 Hz, about 50 ms. The parts later set the
same CRTC values on top of mode 13h. The music system measures the retrace rate in fn 0 while this mode is active,
and it never measures it again.

### END: `0040:0945`

```
int80 fn 3 (stop: SB reset/silence, PIT back to 18.2 Hz, old int 8 vector, PIC back to normal EOI)
int80 fn 5 (free the module memory)
lcall 0c00:328c (restore the old int 0x80 vector)
int10 ax=3                                   // normal 70 Hz text mode; the DOS prompt reappears (video0020)
0959: pop es, ds, popa; XMS unlock (0Dh) and free (0Ah); restore the GDTR (09ee)
0974: restore the int 21h vector; restore the PIC masks from cs:[0x134]; int21 4C00h
```

There is no end screen or text. An ESC in any part (exit code 1) goes through the same END sequence, so the music
stops and the screen goes to mode 3 immediately.

### What each part inherits

| part | video on entry | music |
|---|---|---|
| exe2 | mode 3 retimed to 528 lines (59.6 Hz), blank screen, default text palette | just started (fn 2 a few ms earlier): order 0 row 0, frame counter about 0, no callback |
| exe3 | whatever exe2 left (mode 13h 60 Hz variant, its last palette and screen) | running; exe2 removed its callback (fn 0x1c) |
| exe4 | whatever exe3 left | running |
| exe5 | whatever exe4 left (640x400 16-colour) | running |
| exe6 | whatever exe5 left | running |

The loader never resets the frame counter. Every part that uses it calls fn 0x1a first. The CPU is in flat real
mode, the PIC is in auto-EOI mode (see fn 2), and the PIT runs at about 60.85 Hz.

## Config: the last 9 bytes of APPEAL.EXE (decoded at `0040:04dd`)

The file as shipped ends with `01 01 01 01 20 02 02 05 01`.

| byte | meaning | decoding |
|---|---|---|
| 0 | sound device index (setup order: GUS, SB, D/A LPT1, D/A LPT2, PC speaker, Silent) | `devWord = [1, 4, 0x103, 0x203, 2, 0][b0]`, from the table at cs:0x1b2. The low byte is the driver number, the high byte is the LPT number |
| 1 | mixing rate index | `rate = [16000, 20000, 24000, 28000, 32000, 36000, 40000, 44100][b1]` (cs:0x1be). **If the driver is 4 (SB), the rate is capped at 20000** |
| 2 | interpolation flag | passed as si; 1 = interpolating mixer |
| 3 | not read by the loader (GUESS: the "CDS" checkbox) | |
| 4-5 | port (word, here 0x220) | passed as cx; used by the GUS. **The SB ignores it and autodetects base 0x210..0x260** |
| 6 | SB IRQ index | used if driver = 4: `irq = [2, 3, 5, 7, 10, 11, 12, 13, 14, 15][b6]` (cs:0x1ce) |
| 7 | IRQ index for the other devices | same table |
| 8 | DMA channel | |

Driver numbers inside the music system: 0 = silent (timer-driven, handler `0c00:18d8`), 1 = GUS (`0c00:1928`),
2 = PC speaker, 3 = D/A on LPT (handlers in the data segment at `ef:b08d` / `ef:b0cc`), 4 = Sound Blaster
(`0c00:15a2`). The shipped config is SB at 20 kHz with interpolation. The recording used DOSBox's SB16. An SB that
is not found is downgraded to driver 2.

### exe1: the setup screen (short)

- exe1 is a Turbo Pascal program ("Portions Copyright (c) 1983,92 Borland"). It runs in mode 12h, 640x480 with
  16 colours, and needs a mouse driver ("Mousdriver not loaded. Press any key to continue.").
- The screen (recording video0014, 24.5 s, 59.94 Hz, 640x480) has:
  - the title "HEXAPPEAL SETUP"
  - the left panel "SOUND SYSTEM": Gravis Ultrasound, SoundBlaster, D/A in LPT1, D/A in LPT2, PC Speaker, Silent
  - ADDRESS / IRQ / DMA boxes
  - "Interpolation" and "CDS" toggles
  - "MIXING SPEED": 16, 20, 24, 28, 32, 36, 40 and 44.1 kHz
  - the buttons SAVE, BEGIN and EXIT
- It opens APPEAL.EXE four times, and the loader re-reads the config from the file after setup exits. So the
  chosen settings must be written to the last 9 bytes before exiting (GUESS: on SAVE and BEGIN).
- GUESS: the 640x480 RIX3 picture at file offset 0xeb6f9 is its background. It is the only 640x480 RIX; the
  others are 640x52 and 408x264.
- Exit code 0 means BEGIN. Anything else (EXIT) quits without running the demo.

## int 0x80: dispatcher `0c00:3067`

```
sti; push bx; push ds
if (bx <= 0x1d) call cs:[0x322b + 2*bx]
pop ds; pop bx; iret
```

Notes on the calling convention:

- **iret restores the caller's flags**, so int 0x80 never returns a status in the flags. A `jne` straight after
  `int 0x80` tests the flags from *before* the call: exe6 uses this after `dec`.
- The dispatcher **executes `sti`**. A callback that calls int 0x80 therefore re-enables interrupts inside the
  timer IRQ.
- Functions that use `pusha/popa` return nothing. Fn 4 tries to return an error code in ax, but popa then
  overwrites it.

`ef:` is the music data segment. "chan" means the 74-byte (0x4a) channel record at
`ef:ae0e + 0x4a*(n-1)`, n = 1..channels.

| fn | address | inputs | output / effect |
|---|---|---|---|
| 0x00 | 2986 | al=driver (0..4, >4 -> 2), ah=LPT number, dx=mix rate, cx=GUS port, di=IRQ, bp=DMA, si=interpolation | Initialises the driver, computes the rate, the period-to-step table and the retrace rate (detailed below) |
| 0x01 | 295c | none | Rewinds the song: `[9f4e]=0x40, [9f52]=0, speed [9f4a]=6, tick countdown [9f4c]=1, samples to next tick [adbe]=1`. **Does not touch [9f50]/[9f54]** (both 0 from the image) |
| 0x02 | 24d5 | none | Starts playing (no-op if already playing, [add6]=1). Detailed below |
| 0x03 | 26ee | none | Stops (no-op if not playing). SB DSP reset with the speaker off (`2f62`), PIT ch0 back to divisor 0 (18.2 Hz), old IRQ0 vector restored, PIC re-initialised with normal EOI (ICW4=1) |
| 0x04 | 3033 | ds:dx = file name, cx:ax = file offset | Opens the file, seeks, loads the MOD (`32a5`), closes it. Master volume [9f56]=64. Channels from the signature: M.K.-style = 4, 6CHN = 6, 8CHN = 8 (this song: 6CHN). Song length -> [ef:8451], restart -> [ef:8452]. Order table at ef:8453 |
| 0x05 | 3000 | none | Frees the module's memory (pattern block and up to 31 sample blocks) |
| 0x06 | 3079 | al=channel (1-based) | ax = chan[0x44]. This is the channel's "VU" volume: set to the channel volume when a note triggers or the volume changes, and forced to 0 if the channel is muted |
| 0x07 | 3093 | al=channel, ah=value | Writes the byte chan[0x44] = ah (sets or decays the VU) |
| 0x08 | 30ac | none | ax = master volume [9f56] (0..64) |
| 0x09 | 30b5 | ax=volume | [9f56] = ax (no clamp). Takes effect at the next mixed frame: each channel's mix volume = `(vol*master + 32) >> 6`, rounded with adc of the bit shifted out. Used by exe6 for the fade-out |
| 0x0a | 30c0 | none | ax = [9f54] = **order index of the pattern now playing, plus 1**. 0 before the first row is played |
| 0x0b | 30c9 | ax=order (1-based) | [9f52] = ax-1 and [9f4e] = 0x40. **At the next row boundary** (not at once: the current row finishes its ticks) the player jumps to order ax-1 at row [ad98] (normally 0) |
| 0x0c | 30dd | none | ax = [9f50] + 1 = **row (0..63) now playing, plus 1** |
| 0x0d | 30e7 | none | ax = number of channels [9f44] (6) |
| 0x0e | 30f0 | none | dx:ax = [adaa]:[ada8], a 32-bit count of timer IRQs. It counts every IRQ, including re-entered ones, and is incremented before the retrace wait |
| 0x0f | 30fd | none | Clears that count |
| 0x10 | 3111 | none | ax = channel enable mask [9f46] (bit n-1 = channel n; initially 0xff) |
| 0x11 | 311a | ax=mask | [9f46] = ax (a channel with its bit clear is mixed at volume 0) |
| 0x12 | 3125 | none | ax = song length [8451] (32) |
| 0x13 | 3130 | al=channel | ax = chan[0x24] = effect of the current row: low byte = effect number 0..15, high byte = parameter |
| 0x14 | 3147 | al=channel | ax = chan[0x48]: set on every note trigger to (note index >> 1) + 1, where the note index comes from the period lookup at ef:8506. A "note was hit" flag; clear it with fn 0x15 |
| 0x15 | 315e | al=channel | chan[0x48] = 0 |
| 0x16 | 3177 | al=channel | ax = chan[0x46] = instrument number of the last triggered note |
| 0x17 | 318e | al=channel | chan[0x46] = 0 |
| 0x18 | 31a7 | al=channel | GUS only: voice play position relative to the sample start (reads GUS registers 0x8a/0x8b) |
| 0x19 | 31f3 | none | ax = **frame counter** [add2] (16-bit, wraps) |
| 0x1a | 31fc | none | [add2] = 0 |
| 0x1b | 3208 | ax=offset, cx=segment | [adf8]=ax, [adfa]=cx, [adf6]=1: install the per-frame far callback |
| 0x1c | 321d | none | [adf6]=0: remove the callback |
| 0x1d | 27ee | none | **Toggles retrace sync, which is the same as pausing and resuming the music** (only while playing, [add6]=1). Detailed below |

Calls made by the parts, from grepping exe1..exe6 for int 0x80:

| part | calls |
|---|---|
| exe1 | none |
| exe2 | 0x1d, 0x1d (around its mode set), 0x1b, 0x19, 0x1a, 0x1c, 0x0a, 0x0c |
| exe3 | 0x1b, 0x19, 0x1a, 0x1c |
| exe4 | 0x1d, 0x1d, 0x19, 0x1a |
| exe5 | 0x1d, 0x1d, 0x1b, 0x19, 0x1a, 0x1c, 0x0a, 0x0c |
| exe6 | 0x1b, 0x1a, 0x19, 0x1c, 0x09 |

The port needs fns 0x09, 0x0a, 0x0c, 0x19, 0x1a, 0x1b, 0x1c and 0x1d.

### fn 0 details (`0c00:2986`)

The steps relevant to timing:

```
[adc4..adc6] = 0x1234dc (PIT Hz). For the SB: 1000000 (time-constant base), and the SB is detected (2e2a)
[adca] = base / rate; [adc8] = base / [adca]        // actual rate. SB at 20000: tc 50 -> exactly 20000 Hz
build the period -> step table (ef:9f60 + 4*period, periods 0x6c..0x38c)
[adbc] = [adc8] / 50                               // samples per tick at 125 BPM = 400 at 20 kHz
// retrace measurement (cli):
wait for 3da bit3 = 1, then = 0                    // the start of the next display period
PIT ch0 mode 2 (0x34), count 0
wait for 3da bit3 = 1, then = 0                    // exactly one frame
ticks = -(read ch0 lo, hi); PIT ch0 count 0 again; sti
[adda] = round(119318000 / ticks)                  // retrace rate in 1/100 Hz; rounds up when remainder >= ticks/4
// about 5960 for the 59.60 Hz loader mode
if driver != 0:
  [adb0] = rate*100 / [adda]                       // samples per frame: 335 at 20 kHz / 59.60 Hz
  [addc] = [adb0]*100/[adda] + 1                   // max per-frame correction (6)
  [adde] = -max(1, round([adb0]*13/1000))          // (-4)
mixer selection: si==1 -> interpolating mixer. The mixer is self-modifying unrolled code built at cs:0x32 and
cs:0x94e from templates at ef:b05e/b080. Not needed for the port.
```

### fn 2 details (`0c00:24d5`)

```
cli; [add6]=1; [add8]=0; clear every channel's step and volume
re-init the master PIC: ICW1 0x11, ICW2 8, ICW3 4, ICW4 3   (AUTO-EOI; the IRQ handlers never send EOI)
save the old IRQ0 vector -> [adfc]/[adfe]
SB: start the DSP (2e6c): speaker on (0xd1), time constant -[adca]&0xff,
    auto-init 8-bit DMA of the 0x800-byte ring at ef:1800
[adca] = 119318000 / ([adda] + 125)        // PIT divisor: the timer runs at (retraceHz + 1.25) Hz, about 60.85 Hz
IRQ0 vector = 0c00:15a2 (SB)
[ada8..adaa] = 0
[adba] = [adb0] - 10; [adb4] = -10
wait for 3da bit3 = 1, then = 0, then = 1  // the start of a retrace
PIT ch0 mode 2, count [adca]; sti
```

The first IRQ0 therefore fires about 16.4 ms after a retrace start, which is just before the next retrace.

### fn 0x1d details: retrace sync toggle = pause/resume (`0c00:27ee`)

Off (the first call, [add8] 0 -> 1):

- The SB DSP is reset with the speaker off, so **sound stops at once**.
- [adca] is set back to the SB time constant.
- PIT ch0 goes to count 0 (18.2 Hz) and IRQ0 goes back to the saved old vector (the BIOS).
- After that the frame counter, the callback, the ticks and the song position are all **frozen**.
- The PIC stays in auto-EOI mode.

On (the second call):

- The SB is restarted and [adca] = 119318000/([adda]+125). The retrace rate is NOT re-measured.
- IRQ0 = 15a2. The mix ring is reset: [adb8]=0x1000, [adce]=0, [adb4]=-10, [adba]=[adb0]-10.
- It waits for 3da bit3 = 1, = 0, = 1 (up to about 2 frames), then programs the PIT.
- The song continues from where it stopped. Nothing is reset.

exe2, exe4 and exe5 do `fn 0x1d; int10 mode; retime CRTC to about 60 Hz; fn 0x1d` at their start, so the
music is never synced to a 70 Hz mode. In the recording each such pause is a silence of about 23 ms
(a16/a18/a19 at 8..31 ms). exe3's start has no gap.

**Why the retrace rate matters.** If a part ran at 70 Hz with the timer still at about 60.85 Hz, each IRQ would wait
for the *next* retrace after the timer expired. That is every second retrace, so 35 frames per second. The music
would still play at the correct speed, because the samples are servoed to the DMA position. The pause around mode
sets and the retiming of every mode to 528 lines avoid this.

## The timer interrupt: `0c00:15a2` (SB driver)

```
pusha; push ds; push es; ds = 0xef
[ada8:adaa] += 1                                   // fn 0x0e count (every entry)
if ([add4] == 1) { pop; iret }                     // re-entered: nothing else (frame counter NOT incremented)
[add4] = 1
dx = 0x3da
do { al = in(dx) } while (!(al & 8))              // wait while NOT in vertical retrace. If already in retrace,
                                                   // continue at once. The END of retrace is never waited for.
bx = SB DMA current count (2fe8: clear flip-flop, read port 2*dma+1 lo, hi)
PIT ch0 = mode 2 (0x34), count [adca]              // restart the timer -> the next IRQ comes about 16.43 ms after
                                                   // this retrace start (the frame is 16.78 ms)
[add2] += 1                                        // FRAME COUNTER (fn 0x19)
if ([adf6] & 1) lcall far [adf8]                   // PART CALLBACK: ds = 0xef, other registers = garbage,
                                                   // IF = 0 unless the callback (or int 0x80) does sti
// drift servo: read position = 0x7ff - DMA count, write position = ([adb8]-0x800)/2,
//   difference wrapped to +-0x400, halved, clamped to +-[addc] -> [adb2]
// [adb8] (the ring write pointer) advances by the samples mixed last frame
// samples this frame [adb6] = [adb0] + [adb2]      (about 335 +- 6)
mix loop:
  if ([adb6] > [adbe]) split: mix [adbe] samples, keep the rest in [adc0]
  mix all channels into the 16-bit buffer, then convert to the 8-bit DMA ring
  [adbe] -= samples mixed
  if ([adbe] == 0) { [adbe] = [adbc]; run ONE PLAYER TICK (1db7); continue with the rest }
[add4] = 0; iret                                   // no EOI: the PIC is in auto-EOI
```

What this means for timing:

- The frame counter increments once per vertical retrace, right after the retrace begins.
- The callback runs right after the increment and **before** this frame's mixing and ticks. So inside the callback,
  fn 0x0a/0x0c report the state left by the previous IRQ's mixing.
- If the callback plus mixing takes longer than the timer period (about 16.4 ms), the next IRQ0 nests (auto-EOI,
  and int 0x80 did sti). The nested IRQ only bumps [ada8] and returns, so **that retrace's frame count is lost**.
  GUESS: this does not happen in the recording, but heavy callbacks could do it.

### Player tick (`0c00:1db7`) and the row/order variables

- `[9f4a]` = speed (ticks per row)
- `[9f4c]` = tick countdown
- `[9f4e]` = next row to play (0x40 = "load the next pattern")
- `[9f52]` = next order index (0-based)
- `[9f54]` = current order + 1
- `[9f50]` = current row
- `[ad98]` = pending break row

```
tick:
  [9f4c] -= 1
  if ([9f4c] != 0) { tick-effects for each channel (jump table 2495/24b5); return }
  // row start
  [9f4c] = [9f4a]
  if ([9f4e] >= 0x40) {                        // new pattern
     if ([9f52] >= songLength [8451]) [9f52] = ([8452] < 0x78) ? [8452] : 0     // restart
     [9f54] = [9f52] + 1                        // fn 0x0a value changes HERE
     pattern pointer = order[[9f52]]
     [9f4e] = [ad98]; [ad98] = 0                // Dxx target row
     [9f52] += 1
  }
  [9f50] = [9f4e]                               // fn 0x0c value changes HERE (row 0..63)
  for each channel: read the note, trigger samples, row effects (jump tables 2455 / 2475):
     Bxx: [9f4e]=0x3f; low byte of [9f52] = xx
     Dxx: [9f4e]=0x3f; [ad98] = decimal(xx), max 99 -> 63
     Fxx: xx==0 ignored; xx<=0x1f: speed [9f4a]=[9f4c]=xx; else BPM: [adbc] = rate*5/(2*xx) (SB/LPT/speaker)
     Cxx: volume (cap 63); 9xx: sample offset; 3xx, 4xx, E1x, E2x, EAx, EBx as in ProTracker
  [9f4e] += 1 (after all channels)
```

So:

- **[9f54] (fn 0x0a) and [9f50] (fn 0x0c) change together on the first tick of a row.** They stay constant for the
  rest of the row (8 ticks = 160 ms).
- [9f54] is 1-based: it is 1 during the first order (pattern 10).
- Fn 0x0c returns row+1 = 1..64.

The song loops at the end: order 31 (pattern 30) row 63 has B15. That sets [9f52]=0x15, so the next row loads order
21 and [9f54] becomes 22.

The first tick happens 1 sample into the first IRQ's mix, because fn 1 sets [adbe]=1. Order 0 row 0 is therefore
reported from the end of the first IRQ after fn 2. F08 on row 0 sets the speed and the countdown together, so row 0
also lasts 8 ticks. After that, tick k sits at sample `1 + 400k` of the mixed stream.

### How audio time maps to song position

- Ticks are counted in mixed samples (400 samples = 20 ms at 20000 Hz), and the samples mixed per frame are servoed
  to the DMA read position. The song therefore advances in real time:
  `row index since start = floor(songTime / 0.16)`, `order = floor(songTime / 10.24)`.
- Check in the recording: the onset autocorrelation of a17.wav peaks at a lag of 10.244 s, against the predicted
  10.240 s.
- The retrace rate only decides which frame first sees a change: rows per frame = 0.16 * 59.6 = 9.54 frames.
- GUESS (from the servo, which drives the write start toward the DMA read position): the chunk mixed at retrace n
  is heard during frame n. Because the whole frame is mixed at once, a row start that falls inside frame n's audio
  is already visible to the main loop during frame n, and to the callback at the start of frame n+1. For the port,
  reading the song position at (frame time + one frame) from the audio clock reproduces this within one frame.
- If the setup had chosen 16 kHz, the SB rate would be 1000000/62 = 16129 Hz and a tick would be 322 samples
  (19.96 ms). That is 0.2% fast. The shipped config and the measured 10.244 s point to 20 kHz.

## When the music starts, and the part boundaries in the recording

- The loader does fn 2 after the MOD load. That load is the 50 ms of video0015, the black 59.6 Hz text mode.
- Then it copies exe2 and jumps to it. exe2's first instructions are fn 0x1d (pause), int10 13h, its retiming, and
  fn 0x1d (resume).
- In a16.wav, music is audible from 0.008 s, silent from 0.019 to 0.041 s (the pause), and continuous after that.
  So **song time 0 is about 0.01 s before exe2's video frame 0**, and song time = a16 time - about 0.02 s from then
  on. Each later pause (exe4 and exe5 starts) adds about 0.023 s of offset.
- The video files follow each other with no measurable gap: exe2 55.84 s, exe3 81.78 s, exe4 8.61 s,
  exe5+exe6 210.55 s. Each part therefore starts on the song timeline at roughly the sum of the previous durations
  (minus the pauses):

| part | starts at song time | position |
|---|---|---|
| exe3 | 55.8 s | order 5 (pattern 1), row about 29 |
| exe4 | 137.6 s | order 13, row about 28 |
| exe5 | 146.2 s | order 14, row about 18 |

- The song passes order 31 at 327.7 s and loops to order 21.
- Nothing in the loader resets or changes the music between parts. The only changes are the parts' own fn 0x1d
  pauses and exe6's volume fade (fn 9, decreasing by 1 per frame until it reaches 0).

## Global variables (data segment 0xef; initial values from the image)

| addr | name | init | notes |
|---|---|---|---|
| ef:9f42 | gusPort | 0x220 | |
| ef:9f44 | channels | 4 | 6 after loading this MOD |
| ef:9f46 | channelMask | 0xff | fn 0x10/0x11 |
| ef:9f4a | speed | | 6 after fn 1 |
| ef:9f4c | tickCountdown | | |
| ef:9f4e | nextRow | | 0x40 after fn 1 |
| ef:9f50 | curRow | 0 | fn 0x0c - 1 |
| ef:9f52 | nextOrder | 0 | |
| ef:9f54 | curOrderPlus1 | 0 | fn 0x0a |
| ef:9f56 | masterVolume | 64 | fn 8/9 |
| ef:ad98 | breakRow | 0 | |
| ef:ada8/adaa | irqCount32 | 0 | fn 0x0e/0x0f |
| ef:adb0 | samplesPerFrame | | |
| ef:adbc | samplesPerTick | | rate/50 |
| ef:adbe | samplesToNextTick | | |
| ef:adca | PIT divisor / SB time constant | | |
| ef:add2 | frameCounter | 0 | fn 0x19/0x1a |
| ef:add4 | irqBusy | | |
| ef:add6 | playing | | |
| ef:add8 | syncOff | | fn 0x1d state |
| ef:adda | retraceHz*100 | | measured in fn 0 |
| ef:adf6 | callbackOn | 0 | |
| ef:adf8/adfa | callback offset/segment | | |
| ef:adfc/adfe | old IRQ0 vector | | |
| ef:84d5 | driver | | |
| ef:8451 | songLength | | |
| ef:8452 | restart | | |
| ef:8453 | order table | | |

Loader data in cs:

| addr | meaning |
|---|---|
| cs:0 | "Appeal.Exe" |
| cs:0x0b | exit code |
| cs:0x13a | return label |
| cs:0x13c | program table |
| cs:0x174 | file handle |
| cs:0x176 | XMS handle |
| cs:0x178 | XMS linear address |
| cs:0x184 | part segment |
| cs:0x188 | MOD file offset |
| cs:0x1a8 | config bytes |
| cs:0x1e2..0x1ec | fn 0 arguments |

## Not covered (not needed by the port)

- The mixer inner loops (`cs:0x18c8` call table, self-modifying code)
- The DMA ring layout beyond what is described above
- The GUS, PC-speaker and LPT drivers
- The MOD loader internals (`32a5`)
- The effect handlers on non-row ticks (`1e0f..2075`: arpeggio, slides, vibrato and so on)
