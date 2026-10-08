# Disassembly notes: CONTROL.EXE (The Control, Coma, 1996)
> These are the notes the JavaScript port was written from: C1 the core (memory map, timeline, scene functions,
> data files), C2 the graphics library and the 400-line mode, C3..C6 the effects in timeline order. Below is the
> brief every reader was given. Its scratch paths no longer exist: the tools are in `tools/re/` (`unpack.py`, then
> `cdis.py`). `PORTING.md` is the brief given to the agents that ported the effects. Where notes disagree, the
> later correction wins: C6 on the rotozoomer's corners and on port 0x3d3, C3 on the "order ?" position.

# Brief: reading CONTROL.EXE (The Control, Coma, The Gathering 1996) for a faithful JavaScript port

Goal of the project: a faithful browser port (Canvas 2D, software rendering into an 8-bit palettised
320x200 buffer) of the DOS demo "The Control" by Coma. It must match the original run, which was recorded in
DOSBox. Your job is ONE slice of the disassembly: turn it into precise pseudo-code that someone can port to
JavaScript WITHOUT re-reading the assembly. You do not write the port.

Do not modify anything under /Users/gilm/git/demoports. Write only your notes file (path given in your task).

## What the program is

- CONTROL.EXE was packed with WWPACK. It has been unpacked (tools: $R/unpack.py) into $R/unpacked.bin.
- The program runs under Tran's PMODE 3.x DOS extender: a 16-bit stub (unpacked.bin 0..0xec0) switches to 32-bit
  protected mode and enters the 32-bit segment, which starts at unpacked.bin offset 0xec0. **All addresses below
  and in the listing are offsets in that 32-bit segment** ("code32 offsets"); code and data share it (flat, base =
  the program's load address). Memory past the end of the file image is BSS (zero at start).
- PMODE conventions: `[0x18]` holds the segment's linear base, so `0xa0000 - [0x18]` is the VGA framebuffer
  A000:0000 (and `0xaf8c0 - [0x18]` is A000 + 0xf8c0). gs is a selector for linear 0 (`gs:[0x6c]` = BIOS/IVT area).
  Low-level helpers at 0x0..0x3000 are the extender's runtime: 0x2b9 allocate memory (ecx bytes -> eax, CF on
  failure), 0x2b2c open file (edx = ASCIIZ name), 0x2bdc file size, 0x2c4d read (edx = buffer), 0x2b69 close,
  `[0x2c]` set an interrupt vector (bl = irq/int, edx = handler), 0x346/0x388 related vector helpers.
- The PIT is set to divisor 39772 (DS 0x1b705): **the timer interrupt (0x1b800) runs at 30.0 Hz**. Each tick it
  increments the tick counter dword [0x1b707]; while tick < 0xc15 (3093) it calls the per-tick function
  `[0x17ce0 + 4*tick]` (a timeline of scene functions; most entries repeat the same function), then calls the
  music player (`0x4be4` with eax=4) and advances a phase [0x5380c] by 0xc1c modulo 0x3e800.
- main is at 0x5607b: init (0x51e77, 0x1b27d loads demo.avi and demo.fli, 0x5208f), mode 13h, palette setup, then
  a loop `call [0x52185]` (the current per-frame effect, set by the scene functions) until tick >= 0xa7c, then a
  second section with effect 0x53fb0 until tick >= 0x21fc, then exit. Scene functions (0x522f9, 0x523f2, ...,
  0x55bc7) install effects in [0x52185]. Effects found so far: 52343 52441 52577 5264a 526f0 5277b 5282e 528b2
  53fb0 54043 540ca 54273 54314 54456 54507 545bd 546b3 5486d 54a2c 54ec3 54f64 5506b 55232 55be8.
  Check the timer rate: the recording lasts 379.5 s of emulated time, longer than 0x21fc ticks at 30 Hz (290 s),
  so something else drives time too (the music player? a second timer setting?). Find out and say.
- Music: an S3M module ("...anagnosis") is appended to CONTROL.EXE at file offset 0xfb2a; the player (0x4770..0x6400,
  dispatcher 0x4be4 with a command table at 0x458c) plays it on SB/GUS. The port plays the recording's audio, so
  only what the visuals depend on matters (positions, rows, VU, sync flags).
- Data files: DEMO.AVI (2.8 MB, starts with a ColoRIX "RIX3" 256x256 image; six RIX3 headers inside) and DEMO.FLI
  (970 KB, starts with a table of dword offsets). Both are loaded whole into memory by 0x1b27d; offsets tables are
  relocated by adding the load address (e.g. 30 dwords at 0x1b170). The names are jokes (README.1ST).

## Tools ($R = /private/tmp/claude-501/-Users-gilm-git-demoports-Euphoria-by-Esteem/9e8b164a-ee1a-4db7-924d-4bf0e24c5b44/scratchpad/control/re, Python = $S/venv/bin/python with $S = .../scratchpad)

- `$R/control.lst`: the disassembly (capstone, Intel syntax, 32-bit), lines `OFFSET  insn ; annotation`,
  functions start with `; ======== sub_XXXXX ========`. It was built by recursive descent plus code pointers found
  in stores, registers and jump tables; some code may be missing — if a routine you need is not there, disassemble
  it yourself with capstone from unpacked.bin (offset + 0xec0).
- `$S/venv/bin/python $R/show.py START END` prints the listing between two hex offsets. Read in chunks.
- `$S/venv/bin/python $R/peek.py OFFSET COUNT TYPE` dumps the initial contents (b, w, sw, d, sd, f, q, s=string).
- `$R/funcs.txt`: every function with its instruction count.
- The data files: /Users/gilm/git/demoports/The_Control_by_Coma/{DEMO.AVI,DEMO.FLI,CONTROL.EXE} (read only).
- The original running: `$S/venv/bin/python $S/control/capframe.py T out.png` writes the recorded frame at T seconds
  (0 = the first 320x200 frame, about when the timer starts; the recording is 380.5 s long; it was made with a Gravis Ultrasound);
  `capframe.py --sheet T0 T1 STEP out.png` makes a contact sheet. Use them to check what you read, and say what you
  checked. Overview: $S/control/cap2/sheet.png (one frame every 8 s).
- Other notes are written to $S/control/notes/*.md; read the ones relevant to you when they exist.

## What to write

One markdown file, path given in your task. For each routine in your slice:
- address, a descriptive name, register/memory inputs and outputs
- pseudo-code (C/JS-like) preserving EVERY constant, table address, loop bound and the integer semantics
  (8/16/32-bit wraps, signed vs unsigned, shifts, carries, self-modifying code if any), the exact pixel memory
  layout (where buffers are, stride, how a frame reaches A000, palette writes via 3c8/3c9 with 6-bit values,
  retrace waits on 3da), and the order of operations.
- the global variables it reads/writes (offset, guessed name, initial value via peek)
- data tables: dump short ones verbatim; for long ones give address, size and how to regenerate them
- timing: what drives the animation (frame count, tick count, music position) — this matters for matching.
- At the top: a summary of the slice and a list of every routine it calls. Mark guesses as GUESS; say what is
  unclear rather than inventing. Be exact over pretty.
