# Brief: porting one part of Hex Appeal to JavaScript

Project: ., a browser port (Canvas 2D, software rendering) of the
DOS demo APPEAL.EXE (Cascada, 1993). The disassembly has been read into notes in
$N = <scratch>/notes
(H0_loader_music.md: loader, music system, timing; H2..H6: one per part). The readers' brief, with the RE tools
(listing, show.py, peek.py), is $S/BRIEF.md ($S = the scratchpad dir above, without /notes). Several readers left
a Python model of their part that matched the recording: use it as a reference ($S/h4/render.py, $S/h5/sim.py,
$S/h6/model.py ...).

## The port's design (already written; read these files first)
- src/vga.js: the VGA at register level. Port every `out` literally: `vga.out8(port, al)` / `vga.out16(port, ax)`
  (3c4/3c5 sequencer incl. map mask, 3ce/3cf graphics controller incl. write mode 1 latches and bit mask, 3d4/3d5
  CRTC, 3c0 attribute (pel panning 0x13), 3c8/3c9 DAC, 3da). Video memory: `vga.write(offset, value)` /
  `vga.read(offset)` for CPU accesses to A000:offset (they honour chain-4, map mask, write modes, latches; a
  read loads the latches). For speed you may write `vga.planes[p][offset]` directly when that is exactly what the
  hardware would do (e.g. chain-4 mode 13h: CPU address a = plane a & 3, offset a >> 2 — keep that layout, it is
  how DOSBox stores it and what makes pictures survive a chain-4 -> unchained switch). Mode sets:
  vga.setMode13(), vga.setMode12(); write the parts' own CRTC tweaks after them with out16 as the original does.
  The display (src/screen.js renderFrame) derives everything from the registers (start address, offset, line
  compare, max scan line, pel panning, attribute mode, DAC) and the refresh rate from the vertical total — so get
  the register writes right and the picture and the frame rate follow.
- src/machine.js: `m.mem` is the part's 1 MB real-mode memory, linear (seg*16+off), the part's image loaded at
  segment 0, exactly the addresses in the listings/notes. Accessors m.u8/s8/u16/s16/u32/set8/set16/set32;
  `linear(seg, off)`. Tables, variables, self-modified immediates live in m.mem at their original addresses: port
  the code against them literally (read tables from the image, do not regenerate them). DOS allocations:
  m.allocParagraphs(n) -> segment. int 0x80: m.frameCounter (fn 0x19; fn 0x1a = set it to 0), m.callback = fn
  (fn 0x1b; null = fn 0x1c), m.musicOrder() (fn 0x0a = order index + 1), m.musicRow() (fn 0x0c = row + 1),
  m.pauseMusic() (call it ONCE for each fn 0x1d off/on pair), m.volume (fn 9). Keyboard: m.readKeyboard()
  (port 0x60; never ESC in the port). Exit: set m.exitCode and return from the generator.
- src/demo.js: the frame loop. A part is a generator function `run(m)`: its main code runs until it `yield`s,
  which means "wait for the next vertical retrace". At each retrace the frame loop does `m.frameCounter++` and
  calls `m.callback(m)` (the IRQ order: counter, then callback), then resumes the generator. So a polling loop
  `do { int80 fn19 } while (ax == old)` becomes `while (m.frameCounter === old) { yield; }` — literal. Heavy work
  that took real time in the original (precomputation before the first frame) can be modelled by yielding the
  number of retraces it took in the recording; say so in a comment with the measurement.
  Time: the soundtrack is the clock. Retraces happen at vga.refreshRate (59.5999 Hz for 528-line modes, 59.713 Hz
  for exe4's 527 lines). The song position (music.js) is computed from that time.
- src/parts/index.js lists the parts; yours exports the run function named there, in src/parts/exeN.js. If it
  passes ~700 lines, split it into src/parts/exeN-*.js files.

## Checking against the original
The reference is a NEW recording (DOSBox at 200000 cycles: the music has its true tempo and the parts run at full
frame rate; the readers' notes measured an older, CPU-starved run — redo any timing measurement on the new one).
`$P -I $S/capat.py T out.png` writes the recorded frame at soundtrack time T (the same time base as the port);
`$P -I $S/capat.py --part N` prints where part N starts and ends in soundtrack time. The port's frame:
`node tools/shot.mjs OUTDIR T1 T2 ...` (run from the project dir) writes port-T.png. Compare them (Python, PIL,
numpy: $P = python3 (a venv with capstone, numpy, PIL, unicorn), run with -I).
Aim for pixel-exact frames (DAC 6->8 bit rounding is dacTo8, as DOSBox). Report what matched, where, and what
does not and why. A one-frame phase offset is expected at part boundaries: find it and fix it if it is ours.
Put scratch files in $S/port/exeN/.

## Rules
- Write only your part's files (src/parts/exeN*.js). Do not edit vga.js, machine.js, demo.js, screen.js, music.js;
  if they are wrong or missing something, report the bug and the fix (file, function, change) — you may patch a
  local copy to test it, but say so.
- Port literally: every constant, 8/16/32-bit wrap, signed/unsigned, carries (adc), imul/idiv semantics, the
  order of operations; the quirks the notes flag (out-of-range reads, the stray bytes in exe5's span loop, the
  cos[0] = -32768 flip, palette fades off by one ...) are kept. Random numbers: as the original (exe3's seed
  comes from the DOS clock: use the seed the notes suggest and say which).
- exe5's exit test: the original compares the load segment's low byte (a bug; it hangs in DOSBox). The port follows
  the recording, which was made with the compare patched to 0: exit when the other conditions hold. Comment it.
- Code style (the user's rules): ES modules; curly braces on every if body; descriptive English names; named
  constants for magic numbers; a short comment with the original address on each routine; files under ~700
  lines; no console.log in src; types used in function parameters described at the top of the file (JSDoc
  typedef) when they are objects.
- Performance: it runs in a browser at 60 Hz; typed arrays, no per-pixel allocations, hoist lookups out of inner
  loops. A frame of your part should cost well under 8 ms in node.
