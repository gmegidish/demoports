# Brief: porting your slice of GBU.EXE to JavaScript

Project: $R = /Users/gilm/git/demoports/The_Good_the_Bad_and_the_Ugly_by_Surprise_Productions — a browser port
(Canvas 2D, software rendering of the VGA) of "The Good, The Bad & The Ugly" (S!P, 1993). The notes from all
readers are in <scratch>/notes (G1_framework.md: main script, library, timers, player, timeline). You read your slice;
now port it. $S = <scratch>

## The port's design (written; read these files first: src/demo.js, src/machine.js, src/library.js, src/vga.js, src/screen.js, src/parts/index.js)
- src/machine.js: `m.mem` = 1 MB real-mode memory, linear (seg*16+off), with the unpacked program at segment 0:
  every address in the notes is the address in the port (`08d8:275d` = m.mem[0x8d80 + 0x275d]). Tables,
  variables, self-modified immediates live there: port the code against them literally (read tables from the
  image, do not regenerate them). The memory persists across the whole demo (state left by earlier effects is
  really there, e.g. the 08d8 angles). Accessors u8/s8/u16/s16/u32/set8/set16/set32, `linear(seg, off)`.
  DOS: `m.allocParagraphs(n)` -> segment (first fit, not zeroed); `m.free(seg)`; `m.loadResource(nameAddr,
  ptrAddr)` = 008e:04b3; `m.allocTo(ptrAddr, paragraphs)` = 008e:0014; `m.freeFrom(ptrAddr)` = 008e:0063.
  Timer: `m.setTimer('retrace'|'music'|'bios')` = 0731:013c / 0120 / 0158 (each of those first waits for the
  retrace start edge: a `yield` before calling it); `yield* waitTick(m)` = 0731:00a3; `m.frameCounter` =
  0731:[4] (08d8:157e reads it); `m.tickMusic()` = a direct `lcall 008e:1f63`; `m.musicSync` = 008e:18a4.
  The frame loop runs the timer interrupt at every retrace (frame counter + music tick under 'retrace', music at
  70.002 Hz under 'music', nothing under 'bios'), then resumes the demo's code.
- src/demo.js: the main script, literal (loads/frees/clears/mode sets between effects are done there). Each
  effect is a generator `function* (m)` in src/parts/index.js's EFFECTS table, currently a stub that waits the
  recorded number of retraces. `yield` = "wait for the next vertical retrace"; every retrace poll of the original
  (3da bit 3 edge), every 0731:00a3 wait is a yield (waitTick). Replace YOUR stubs: put your code in
  src/parts/<yourfile>.js and import it in index.js (edit only your entries in index.js).
- src/library.js: 0299 (RLE unpackRle, interpolatePalette, setDac, attribute palette, mode setups setModeX /
  setUnchained256 / setEgaPlanar, line compare ...), the fades 0749:0192/0153 (`yield* fadePalette(m, {...})`),
  0000:001b/002b. Use these; if one is wrong, fix it there and say so in your report (others use it too).
- src/vga.js: the VGA at register level. Port every `out` literally: `vga.out8(port, al)` / `vga.out16(port, ax)`.
  Video memory: `vga.write(offset, value)` / `vga.read(offset)` for A000:offset (chain-4, map mask, write modes 0/1,
  latches, bit mask, set/reset, logical op). For speed you may write `vga.planes[p][offset]` directly when that is
  exactly what the hardware would do (chain-4: CPU address a = plane a&3, offset a>>2, DOSBox layout).
  Mode 13h: vga.setMode13(). The display (src/screen.js) derives everything from the registers: start address
  (latched at the retrace), offset, line compare, max scan line/double scan, pel panning, 256 vs 16 colours, the
  attribute palette, Color Select (attr 14h) and P54S, the DAC, screen-off (SR1 bit 5).
- **Raster effects** (per-scanline register or VRAM changes): call `vga.hblank()` once for every horizontal
  retrace wait of the original (3da bit 0). Then every out/write first draws the rows the beam has passed with
  the old state: measured DOSBox rule, a write made after w hblank waits shows from scanline w-1 on. If you
  write vga.planes directly in raster code, call `vga.syncBeam()` first. Scanlines vs rows: a row is drawn when
  its first scanline is passed (rows = scanlines / lines per row). If this model is not enough for your effect,
  say exactly what is missing; you may extend vga.js/screen.js carefully (others depend on them: keep behaviour
  for non-raster frames identical) and report the change.
- The shared 08d8 3D engine (used by the blue cubes, intro, glentz, chess cube, transforming objects, glentz
  cubes...) is ported ONCE, by G2, into src/engine3d.js. If your effect needs it and it is not there yet, port your
  non-engine effects first; G2 will message when it is ready. Don't write your own copy.
- Music: src/song.js is a silent sequencer of the player (G1). Call m.tickMusic() exactly where the original calls
  008e:1f63 by hand; effects waiting on 008e:18a4 read m.musicSync.

## Checking against the original
Recording frame g (70.086 Hz, g = 0 is the switch to 640x400) vs the port: `<scratch>/venv/bin/python -I <scratch>/cmp.py G
[G...]` renders the port's frame g (node tools/frames.mjs; frame g = state after g+1 retraces) and compares it with
the recording's frame g, exact RGB; diff images in <scratch>/cmpout/diff-G.png (port | recording | mask). Use your own
copy of cmp.py with a different output dir if you run many in parallel (cmpout is shared). Also `capat.py`.
Your Python models in <scratch>/work/<id>/ are good references. Aim for pixel-exact frames over the whole effect
(sample densely; check the first and last frames, phase boundaries and the timing). Since the demo runs from the
start, frame g of your effect depends on everything before it: other effects are stubs until ported, so the
state they leave (palette, VRAM, 08d8 variables) may be missing — set nothing up in your effect to compensate;
instead tell me exactly what your effect needs from the previous one. The stubs' lengths keep the timeline;
YOUR effect must end on the frame the recording says (the next effect starts at the right frame).
A per-effect harness is fine for development (put it under <scratch>/work/<id>/), but the final check is through the
real demo (cmp.py).

## Rules
- Write only your part files (src/parts/<name>*.js) and your entries in src/parts/index.js (and engine3d.js for
  G2; library.js/vga.js/screen.js fixes allowed but reported). Never edit demo.js/machine.js — report needed
  changes. No git commands.
- Port literally: every constant, 8/16/32-bit wrap, signed/unsigned, carries, imul/idiv semantics, the order of
  operations; quirks the notes flag are kept.
- Code style (the user's rules): ES modules; curly braces on every if body; descriptive English names; named
  constants for magic numbers; a short comment with the original address on each routine; files under ~500
  lines (split by routine groups); no console.log in src; JSDoc typedef at the top for object-typed parameters.
- Performance: it runs in a browser at 70 Hz; typed arrays, no per-pixel allocations, hoist lookups out of inner
  loops. A frame of your effect should cost well under 5 ms in node.
- Report: what you ported (files), verification results (which frames, how many identical), what is not exact and
  why, changes to shared files, and what you need from others.
