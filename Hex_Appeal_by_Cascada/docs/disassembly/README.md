# Disassembly notes: APPEAL.EXE (Hex Appeal, Cascada, 1993)

> These are the notes the JavaScript port was written from: H0 the loader and the music system (int 0x80, the
> retrace-paced timer, how song time maps to positions), H2..H6 the five parts in the order they run. Below is
> the brief every reader was given. Its scratch paths no longer exist: the tools are in `tools/re/`. The readers
> measured an older recording made at 60000 DOSBox cycles, where the mixer starved the CPU: the music ran 11%
> slow and exe2 and exe6 dropped frames. Their timings in seconds and frame numbers are from that run; the
> port was checked against a second recording at 200000 cycles (see the project README). The code they
> describe is the same. `PORTING.md` is the brief given to the agents that ported the parts.

# Brief: reading APPEAL.EXE (Hex Appeal, Cascada, Assembly'93) for a faithful JavaScript port

Goal of the project: a faithful browser port (Canvas 2D, software rendering of the VGA screen) of the DOS demo
"Hex Appeal" by Cascada (1993). It must match the original run, which was recorded in DOSBox. Your job is ONE slice
of the disassembly: turn it into precise pseudo-code that someone can port to JavaScript WITHOUT re-reading the
assembly. You do not write the port.

Do not modify anything in the project except files under tools/re/work/ (you may re-run hdis.py
there for YOUR exe only). Write only your notes file (path given in your task).

## What the program is

- APPEAL.EXE is 7 MZ programs chained back to back plus a tail (tools/re/split.py). Split copies:
  $W = ./tools/re/work: exe0.exe .. exe6.exe, tail.bin.
  - exe0 = loader + music system. It enters flat real mode, copies exe1..exe6 to XMS, runs exe1 (setup GUI), loads
    the music, then runs exe2, exe3, exe4, exe5, exe6 in order (each as a normal DOS program; a part's
    int 21h/4Ch returns to the loader; exit code 1 = ESC pressed = abort the demo). Afterwards: music off, mode 3.
  - exe1 = setup screen (sound card choice). exe2..exe6 = the five demo parts.
  - tail.bin = a 6-channel ProTracker MOD "libertine" by Zodiak (0x39506 bytes) followed by ColoRIX (RIX3) pictures
    at APPEAL.EXE file offsets 0xeb6f9, 0x110f33, 0x11506d (tail.bin offset = file offset - 0xb21f3). Parts may
    open APPEAL.EXE themselves and read pictures/data from it (find out: look for int 21h 3Dh/42h/3Fh).
- The music system is reached through **int 0x80** with the function number in **bx** (other args in ax/cx/dx):
  0x0a -> ax = current pattern-order index + 1; 0x0c -> ax = row + 1; 0x19 -> ax = frame counter (incremented once
  per VGA vertical retrace); 0x1a reset the frame counter; 0x1b install a per-frame far callback (ax = offset,
  cx = segment) that the timer interrupt calls once per retrace, before mixing; 0x1c remove it; 0x1d toggle the
  retrace-synced timer. Other function numbers exist (table at exe0 0c00:322b) — the exe0 reader documents them.
  **Everything is paced by the VGA retrace**: the recording runs at about 59.6 Hz (tweaked 60 Hz modes). The MOD
  plays at speed 8 / 125 BPM: one row = 0.16 s, one order = 10.24 s; order list
  [10,11,9,12,0,1,2,2,3,5,4,6,7,8,13,...]; the song starts when exe2 starts.
- Parts are 16-bit real-mode programs (TASM/Pascal-ish), DOS memory allocation via int 21h 48h/4Ah, VGA programmed
  directly (mode 13h + tweaks, unchained 320x400 / mode-X style, 640x400 16-colour tweak, palette via 3c8/3c9,
  retrace via 3da, CRTC 3d4 start address for page flipping).
- Known demo bug (exe5): its callback at 0403:285c/2882 does `mov ax,<seg>` before `cmp al,0x38` at 0403:287e, so the
  exit-from-starfield test compares the low byte of the load segment instead of the music row. In DOSBox the part
  never ends; the recording was made with that compare patched to 0 (i.e. exit as soon as order index+1 >= 0x14).

## Tools (P = python3 (a venv with capstone, numpy, PIL, unicorn), always run with `$P -I`; it has capstone, numpy, PIL, unicorn)

R = ./tools/re
- `$W/exeN.lst`: the disassembly (16-bit, Intel syntax). Lines are `SSSS:OOOO LINEAR hexbytes mnemonic operands`,
  `;R` marks an instruction containing a relocated segment value (the image is loaded at segment 0, so a value like
  `mov ax, 0x180d ;R` is "the part's segment 0x180d" = linear 0x180d0 in the image). Functions start with
  `; ======== sub_SSSS_OOOO ========`, `; ---- gap ----` marks undisassembled bytes.
  It was built by recursive descent from the entry point and far-call relocations ONLY: callbacks installed via
  int 0x80 fn 0x1b (ax:cx), interrupt handlers, jump tables, and code reached through registers are probably
  missing. Add them: `$P -I $R/hdis.py N SEG:OFF [SEG:OFF ...]` regenerates exeN.lst with extra entry points
  (repeat the full list of extras each time).
- `$P -I $R/show.py N START END`: prints the listing between two addresses (linear hex or SEG:OFF).
- `$P -I $R/peek.py N ADDR COUNT TYPE`: dumps the initial image (relocated at segment 0) at linear hex or SEG:OFF;
  TYPE b, sb, w, sw, d, s (string), x (hex). Data segment values in the code are image segments: ds=0x180d ->
  peek `180d:OFF`. Memory past the image is BSS/allocated (zero/undefined at start).
- The recording: `$P -I $S/capframe.py PART T out.png` writes the frame of part PART (2..6) T seconds into that part's
  recording; `$P -I $S/capframe.py --sheet PART T0 T1 STEP out.png` a contact sheet. Recordings: exe2 55.8 s
  (the first ~4 s black = loading), exe3 81.8 s (320x400), exe4 8.6 s (640x400), exe5+exe6 share one 210.6 s
  recording (exe5 cube 0..~65 s, black, exe6 from ~75 s). Use them to check what you read and say what you checked.
  ($S = <scratch>)
- Credits (appeal.doc): intro blur Robban, intro font Delsion, logo O'Hara; Stardriver/Cubes/IFS & Morphs Hellraiser,
  cube logo Delsion; Eevi picture Delsion; texture code Iceman, texture pics O'Hara; slimy panner Iceman, slimy font
  & marble O'Hara; music Zodiak; music system Robban.

## What to write

One markdown file, path given in your task. For each routine in your slice:
- address (SEG:OFF), a descriptive name, register/memory inputs and outputs
- pseudo-code (C/JS-like) preserving EVERY constant, table address, loop bound and the integer semantics
  (8/16-bit wraps, signed vs unsigned, shifts, carries, imul/idiv, self-modifying code if any), the exact video
  memory layout (mode, planes/map mask, stride, page addresses, CRTC start, how a frame is shown), palette writes
  (3c8/3c9, 6-bit values, fades), retrace waits on 3da, and the order of operations.
- the global variables it reads/writes (SEG:OFF, guessed name, initial value via peek)
- data: where every picture/font/table comes from (embedded in the image? read from APPEAL.EXE at what offset? how
  decoded/decompressed — give the full decoder), sizes and formats. Dump short tables verbatim; for long ones give
  address, size and how to regenerate them (or say "read from the image at X").
- timing: what drives the animation and the part's end (frame counter from int 0x80 fn 0x19, music order/row,
  per-frame callback, busy loops, retrace waits) — the port must reproduce the timeline, so give the exact
  conditions and the main loop structure (what runs in the callback vs the main loop; how many retraces per frame).
- Measure in the recording: when the part's visible events happen (seconds from the part's first frame) and
  relate them to frame counts / music positions you found in the code.
- At the top: a summary of the part (what is seen, in order), the video mode(s), the main loop, the list of every
  routine. Mark guesses as GUESS; say what is unclear rather than inventing. Be exact over pretty. The notes will
  be published in the repo as docs/disassembly, so write them for a reader, in plain English.
