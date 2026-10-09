# Disassembly notes: GBU.EXE (The Good, The Bad & The Ugly, Surprise! Productions, 1993)

> These are the notes the JavaScript port was written from, one per slice of the program: G1 the framework (main
> script and timeline, the MOD player and its sync counter, timers, the video library, the MyLZ packer), G2..G8 the
> effects in the order they run. Below is the brief every reader was given; `PORTING.md` is the brief given when
> the same readers ported their slices. Their scratch paths no longer exist: the tools are in `tools/re/`
> (`work/` there is where they write; `re/img.bin` in the brief is `tools/re/work/img.bin`, `res/NN_name` is
> `tools/re/work/res/`). Files named `work/Gn/...` in the notes are the readers' Python models and measurement
> scripts, which are not in the repository. Frame numbers are frames of the reference recording (70.086 Hz,
> frame 0 = the switch to 640x400 graphics after the start key), which is also the port's time base.
>
> Some of what the notes say was corrected during porting, and the code is right where they differ: effects do
> read the music (G1 section 1), the 08d8 engine's state carries from effect to effect, and several DOSBox
> display rules (the EGA memory copy, the render palette, the line a raster write lands on) are described in the
> port's src/vga.js and src/screen.js.

# Brief: reading GBU.EXE ("The Good, The Bad & The Ugly", Surprise! Productions, The Party '93) for a faithful JavaScript port

Goal of the project: a faithful browser port (Canvas 2D, software rendering of the VGA screen, no emulation of x86)
of the DOS demo GBU.EXE by S!P (1993, 2nd at The Party 3). It must match the original run, which was recorded in
DOSBox. Your job is ONE slice of the disassembly: turn it into precise pseudo-code that someone can port to
JavaScript WITHOUT re-reading the assembly. Later you will probably be asked to port your slice yourself, so
understand it well.

Do not modify anything under /Users/gilm/git/demoports. Write only your notes file (path given in your task) and
scratch files under $S/work/<your slice id>/.

$S = <scratch>
$P = $S/venv/bin/python (capstone, unicorn, numpy, PIL). Always run it with `-I`.

## What the program is

- GBU.EXE is packed with a "MyLZ" stub. It has been unpacked (Unicorn) and rebased to segment 0: `tools/re/work/img.bin`
  (0x13b90 bytes, the program image at segment 0; 452 relocations, `tools/re/work/relocs.txt` = "linear_offset value").
  Entry 0000:03b1. Hand-written 16-bit real-mode assembly (TASM), one segment per module, all far calls.
- Data: everything else is appended to GBU.EXE and read at run time by name with `lcall 008e:04b3` (ds:dx = 8-char
  name, the new block's segment is stored at ds:[di]; it allocates with int 21h/48h and reads the whole resource).
  `lcall 008e:0063` frees the block whose segment is at ds:[di]. `lcall 008e:0014` allocates bx paragraphs -> ds:[di].
  The 49 resources are extracted to `tools/re/work/res/NN_name` (e.g. res/21_mutamcde, res/40_citydata); list:
  `ls $S/res`. The MOD (inc\b2.mod, "Beastsong" by Fred) is at file offset 0x9c40. Two resources are CODE
  overlays called with far calls through a pointer, function number in AH: res/21_mutamcde (listing
  `tools/re/work/mutamcde.lst`) and res/35_zoomcde2 (`tools/re/work/zoomcde2.lst`); offsets in those listings are from the start of
  the resource (it is loaded at offset 0 of its own segment). res/22_frakcode may be code or data: find out.
  Re-disassemble overlays with extra entry points: `$P -I tools/re/work/odis.py tools/re/work/res/NN_name OUT.lst OFF [OFF...]`.
- Main script (0000:03b1..0000:088a) calls the effects in order; see "Main script" below.
- **Timing.** The timer (module 0731) is reprogrammed to fire once per VGA vertical retrace: its IRQ handler
  0731:007a waits for the retrace (3da bit 3), restarts the PIT with the measured frame length, increments the
  frame counter word cs:[4] of segment 0731 (= linear 0x7314), sends EOI and calls the GUS MOD player tick
  008e:1f63. `lcall 0731:00a3` = "wait for the next timer tick" (sets cs:[4]=0, spins until nonzero).
  0731:013c installs that retrace-synced handler; 0731:0120 installs the plain one (0731:00f0: music only, PIT at
  70 Hz); 0731:0158 restores the BIOS timer. The music player runs one tick per retrace (70.086 Hz in all of
  the demo's modes). Effects pace themselves with 0731:00a3, with their own `in al,3dx` retrace polls, or with
  frame counts. As far as we know no effect reads the music position (player variables 008e:1261 order,
  008e:1263 row, 008e:1268 speed) — check that for your slice. 008e:2068 sets the music volume (fade-out at the end).
- Keyboard: int 9 is replaced (072c:0034): ESC jumps to the end sequence 0000:088a. The port never presses ESC.

## Tools

- `tools/re/work/gbu.lst`: recursive-descent disassembly of img.bin. Lines `SSSS:OOOO LINEAR hexbytes mnemonic operands`;
  `;R` marks a relocated segment value (`mov ax, 0x8d8 ;R` = the program's segment 08d8 = linear 0x8d80).
  `; ======== sub_SSSS_OOOO ========` starts a function; `; ---- gap ----` marks bytes not disassembled.
  Built from the entry point, far-call relocations and 0731:007a 0731:00f0 072c:0034 only: code reached through
  jump tables (e.g. `call word ptr cs:[bx+0x2c5]` at 0e40:0420, `call word ptr cs:[bp+0x1017]` at 126e:100a,
  `jmp ax` at 0777:0246) or through far pointers (`lcall cs:[0]` at 0d2e, `lcall cs:[0x1d8]` at 0d34,
  `lcall cs:[0xc4]` at 0d97, `lcall ds:[si]` at 0e40:0425) is missing. To add entry points, run
  `$P -I tools/re/work/gdis.py 0731:007a 0731:00f0 072c:0034 SEG:OFF ...` -> rewrites tools/re/work/gbu.lst. OTHER READERS USE THE
  SAME FILE: instead write your own copy: `cp tools/re/work/gdis.py $S/work/<id>/gdis.py`, edit its two `HERE`-relative
  paths (img.bin/relocs.txt input, gbu.lst output) to point at tools/re/work/img.bin, tools/re/work/relocs.txt and your own
  output file, and keep the default entries plus yours.
- `$P -I tools/re/work/show.py START END`: prints gbu.lst between two addresses (linear hex or SEG:OFF).
- `$P -I tools/re/work/peek.py ADDR COUNT TYPE [FILE]`: dumps the initial image at linear hex or SEG:OFF (or a resource
  file, offset from 0); TYPE b, sb, w, sw, d, s (string), x (hex). Memory past the image is allocated at run time.
- The recording (DOSBox Staging, GUS, cycles 60000; all modes run at 70.086 Hz, one captured frame per retrace):
  `$P -I $S/capat.py T out.png` writes the frame at demo time T (seconds since the start key; frame index =
  round(T * 70.086)); `$P -I $S/capat.py --frame G out.png`; `$P -I $S/capat.py --sheet T0 T1 STEP out.png` a
  contact sheet; `$P -I $S/capat.py --files` lists the capture files (a new file starts at each mode change).
  The demo is ~456 s, then the end text screen. Look at the frames (Read tool on the PNG) to check what you read,
  and say what you checked. 320x400 captures = unchained modes with CRTC 9 tweaked (2 lines per row or 400 lines).
  A second recording at cycles 200000 exists in $S/cap2 (same file layout, maybe different timing): if an effect
  looks CPU-bound (dropped frames, slow motion), compare.
- Credits (GBU.NFO, in order of appearance): Textmode-routines Peci; Intro Erik, gfx Maestro; Credits Antibyte;
  Plasma Erik; Cyclic-Plasma Erik; Morphing-Line-figures Peci; Chess-effect Erik; Water-effect Erik/Maestro;
  Glentz-Vector Erik; Picture-Wobbler Erik; Chess-Paralax-zoomer Erik; Paralax-Bars-with-chessplane Erik;
  Zooming-16x16-pictures Erik; Glentz-chess-cube Erik; Greetings-scroller Peci; Dot-tunnel Antibyte;
  Picture-of-Motorcycle J.O.E; Transforming-objects Erik; Contour-City Erik; Rotating-door Erik; Picture-zoomer
  Erik/Maestro; Rotating-Fractal-zoomer Erik; Two-glentz-cubes Erik; Jelly-Cubes Erik; 3200-Dots-cubes Antibyte;
  End-Ansi Erik. Music Fred. Graphics Maestro and J.O.E.

## Main script (decoded; load = 008e:04b3 by name)

```
0444 lcall 11d6:000a ; 0449 lcall 08d8:196e ; 044e lcall 11d6:032c   (before GUS init; first recording file = 640x400 blue cube)
045b lcall 008e:170e (GUS detect, skipped with [S]) ; 0465 008e:1942 (load MOD) ; 046a..0483 save int 8/9, install kbd, video lib init
048d 0731:000a measure frame length ; 0498 0731:013c retrace timer ; 04a2 lcall 08d8:275d
04ba load 'ugur' ; 04bf lcall 0db5:07b0
04db..059e load p3_sin p3_chess p3_zoom p3_outf chess (->0777) cheffect (->08d8:0018) p75_data plasma (->0cc5) kp3_sin kp3_sin2 (->0cf9) mutamcde (->0d2e) watr_dat watr_pic (->0749) wave_sin wave_ran wave (->08a8)
05a3 lcall 0cf9:01dd ; 05af 0731:013c ; 05b4 lcall 0cc5:0139 ; clear ; 05d0 0299:01cc ; 05d5 lcall 0d2e:0010 ; clear
05f0 lcall 08d8:18d4 ; 05f5 lcall 0749:01cc ; frees
0670 0299:0076 palette ; 0675 0731:013c ; 067f lcall 08d8:1625 ; 0684 lcall 08d8:16de ; 0689 wait tick ; 0692 0299:0175 ; 0697 lcall 08a8:01f2
06c0 lcall 0777:0995 ; 06c5 0731:013c ; 06ca lcall 08d8:2dc1 ; 06d4 lcall 0eb3:27e8 ; 06d9 lcall 0eb3:28ab ; 06de lcall 0eb3:27d5
06ed load 'dot_data' ; 06f2 lcall 0e40:063b
0703 lcall 08d8:396c ; 0708 08d8:3041 ; 0710 08d8:346a (cx=0x96) ; 0715 08d8:35f6 ; 071a 08d8:39d4 ; 0722 08d8:346a (cx=0x32) ; 0727 08d8:3e3a ; 072c 08d8:39b1
07a0 0731:013c ; 07a5 mode 13h ; 07aa lcall 0d97:013c
07f8 lcall 0d34:04e1
0835 lcall 08d8:25f4 ; 083a lcall 08d8:16de
085b lcall 126e:13ea
086d 64x { wait tick; 008e:2068 volume = counter; wait tick; wait tick }   (fade-out)
088a mode 3, music off, restore ints, load 'ending' (80x25 text screen) -> b800, cursor to row 0x17, exit
```
Which effect is which call is partly a guess: confirm for your slice in the recording.

## What to write

One markdown file, path given in your task. For each routine in your slice:
- address (SEG:OFF), a descriptive name, register/memory inputs and outputs
- pseudo-code (C/JS-like) preserving EVERY constant, table address, loop bound and the integer semantics
  (8/16-bit wraps, signed vs unsigned, shifts, carries, imul/idiv, self-modifying code), the exact video memory
  layout (mode, chain-4 or unchained, planes/map mask, write mode, stride, page addresses, CRTC start address,
  CRTC tweaks, how a frame is shown), palette writes (3c8/3c9, 6-bit values, fades), retrace waits on 3da (which
  bit, which edge), and the order of operations.
- the global variables it reads/writes (SEG:OFF, guessed name, initial value via peek)
- data: where every picture/font/table comes from (image address or resource name + offset), how it is decoded
  (give the full decoder), sizes and formats. Short tables verbatim; long ones: address, size, "read from X".
  Tables computed at run time: the exact generator.
- timing: what drives the animation and the effect's end (frame counts, 0731:00a3 ticks, retrace polls, counters,
  busy loops) — the port must reproduce the timeline exactly, so give exact conditions and loop structure (how many
  retraces per animation step, whether drawing is double-buffered, what happens if a frame overruns).
- Measure in the recording: the demo time (capat.py time base) at which each of your effects starts and ends and
  its visible events; relate them to the frame counts you found in the code.
- At the top: a summary (what is seen, in order), the video mode(s), the main loop, the list of every routine.
  Mark guesses as GUESS; say what is unclear rather than inventing. Be exact over pretty. The notes will be
  published in the repo as docs/disassembly, so write them for a reader, in plain English.
