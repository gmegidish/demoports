# Brief: porting effects of The Control to JavaScript

Project: /Users/gilm/git/demoports/The_Control_by_Coma, a browser port (Canvas 2D, software rendering) of the DOS
demo CONTROL.EXE (Coma, 1996). The disassembly has been read into notes: $N = /private/tmp/claude-501/-Users-gilm-git-demoports-Euphoria-by-Esteem/9e8b164a-ee1a-4db7-924d-4bf0e24c5b44/scratchpad/control/notes
(C1_core.md is the core: memory map, timeline, scene functions, helpers, data files; C2_gfx.md the graphics library;
C3..C6 the effects). The brief the readers had, with the tools (listing, show.py, peek.py, capframe.py), is
/private/tmp/claude-501/-Users-gilm-git-demoports-Euphoria-by-Esteem/9e8b164a-ee1a-4db7-924d-4bf0e24c5b44/scratchpad/control/BRIEF.md.

## The port's design (already written; read these files first)
- src/machine.js: `m.mem` is the program's flat memory: address 0 = the start of the 32-bit segment (code32 offsets,
  exactly the addresses in the notes), initialised from the unpacked CONTROL.EXE, with the start-up allocations after it
  (DEMO.AVI, DEMO.FLI, LERP64, NOISE, TEX ...) in the original's order, so pointers stored in memory work as in the
  original. Accessors: m.u8/s8/u16/u32/s32/set8/set16/set32, m.addByte(a, v, carryIn) -> carry, m.subByte.
  Variables, tables, self-modified immediates all live in m.mem at their original addresses: port the code against
  them literally (read the table at 0x2d218 from memory, do not regenerate it).
  Video: m.screen (mode 13h A000, linear 64000+), m.planes[0..3] + m.mapMask + m.writePlanes(offset, v) + m.crtcStart
  (unchained 320x400), m.setMode13(), m.setModeX(), m.dac (768 bytes, 6-bit), m.dacMask, m.dacLoad(first, address, count),
  m.dacGreyRamp(first). The display (src/screen.js) shows the INTENDED 400-line picture in mode X (all 400 lines), not
  DOSBox's banded one (DOSBox mirrors port 3d3 onto the CRTC and repeats every line 7 times; see C2/C6).
- src/tables.js (start-up tables, aviItem(m, i), fliItem(m, i)), src/helpers.js (C1 §9 routines: decay, feedbackAdd,
  toRamp, grain, grainSaturate, lerpIntoW, upscale2x, blit, setPaletteFade, setPaletteFromTexture, palettePulse,
  buildStarburstTexture, isFirstCall, workBuffer(m), backBuffer(m)), src/addresses.js (memory addresses shared by
  several modules), src/scenes.js (all scene functions), src/demo.js (main loop and timers).
- src/effects/index.js: `EFFECTS[address] = { draw(m), passesPerSecond }`. An effect's draw(m) is ONE pass of the main
  loop (one call of the original effect routine), synchronous. passesPerSecond is how often the original's main loop
  ran it, measured in the recording (no retrace waits anywhere; fps.txt-style counting of changed frames is unreliable
  when frames tear — prefer measuring a per-pass quantity such as a decay or a step). Register your effects from your
  own module: `export const PART_X_EFFECTS = { 0x52343: {...}, ... }`, imported and spread into EFFECTS in
  src/effects/index.js.
- One-shot "first call" flags are bytes in memory: test and set them in m.mem like the original.

## Rules
- Write your effects in the files named in your task. Shared code you need: if it is in another agent's file, import
  it; if no one owns it, put it in your own file. Do not edit machine.js, demo.js, scenes.js, helpers.js, tables.js,
  screen.js; report bugs or missing features in them instead (file, function, fix).
- Port literally: every constant, 8/16/32-bit wrap, signed/unsigned, carries, the order of operations; quirks the notes
  flag (out-of-range reads, swapped corners, self-modifying code) are kept. Random numbers: Math.random only where the
  original reads the PIT.
- Code style (the user's rules): curly braces on every if body; descriptive English names; named constants; short
  comments with the original address of each routine; files under ~600 lines (split if needed); no console.log in src.
- Check against the recording: `node tools/shot.mjs OUT T...` (writes OUT/port-T.png) once it exists, or a script
  of your own in the scratchpad; and `$S/venv/bin/python $S/control/capframe.py T out.png` for the original.
  Time T is seconds of the recording: part 1 tick t at t/30, part 2 tick t at 90.50 + t/30. Mode-X parts will NOT
  match the recording (it shows DOSBox's banding); compare their content by reasoning.
- Reply in under 200 words: what you ported, how it matches the recording (numbers if you can), pass rates chosen,
  and any core bug found.
