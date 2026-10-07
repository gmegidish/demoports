# Brief: porting one part of Euphoria to JavaScript

The project: /Users/gilm/git/demoports/Euphoria_by_Esteem, a browser port (Canvas 2D, software rendering into
8-bit palettised pages) of the DOS demo EUPHORIA.EXE. The disassembly has been read into notes:
$S/notes/*.md ($S = /private/tmp/claude-501/-Users-gilm-git-demoports-Euphoria-by-Esteem/9e8b164a-ee1a-4db7-924d-4bf0e24c5b44/scratchpad).
BRIEF.md explains the tools (euph.lst listing, show.py, peek.py) if you need to check the code itself.
The library is already ported; your job is to port ONE part (or two), following its notes, and make it match
the reference capture of the original.

## Read first
- src/machine.js (the machine model: pages, palette, video modes, virtual time, Random), src/parts/common.js
- src/gfx.js (186a first half), src/raster.js (186a second half), src/engine3d.js (1342), src/effects.js (179b),
  src/picture.js (PCX loader), src/font.js, src/asc.js, src/tables.js (0ba7), src/text3d.js
- Ported parts to use as templates: src/parts/intro.js, src/parts/credits.js, src/parts/gems.js, src/parts/morph.js,
  src/parts/terrain.js, src/parts/end.js. Copy their style.
- src/demo.js: the timeline (do NOT edit it; your part is already wired to a placeholder export in your file).

## Rules
- Edit ONLY your own part file (named in your task). It currently holds placeholder generators with the right
  export names; replace them. If you need a helper that does not exist in the library, write it in your part file,
  or in a NEW file under src/ named after the original routine (e.g. src/vesa.js), never in an existing shared file.
  If you find a bug in a shared file, do not fix it: describe it precisely (file, function, the fix) in your reply.
  Other agents are editing other part files at the same time.
- Time model: a part is a generator. It yields the machine time (seconds) it waits for, always strictly later than
  m.time. Use the helpers in parts/common.js: `yield* waitUntil(m, stamp, ticks)` for the original's busy waits,
  `yield* frame(m, seconds)` once per loop iteration of a loop that does not wait for the retrace,
  `yield* waitRetrace(m)` where the original waits for the retrace (186a:040b), `yield* timedFade(...)` for 186a:08bc.
  m.ticks is the 100 Hz clock. Loading takes no time in the port.
- Frame pacing: the original's loops mostly run as fast as the CPU allows, and many effects advance per loop pass,
  so the number of passes per second matters. Measure it in the capture: $S/fps.txt has, per second of the capture,
  the number of 70 Hz frames that changed (70 = at least 70 passes/s). Put the measured rate in a named constant
  (`const FRAME_SECONDS = fps(N)`), per loop if the loops differ, and say how you measured it.
- Port literally: keep every constant, the float32 stores (f32 = Math.fround), round-half-even (roundHalfEven),
  int16 wrap (int16), the order of operations and of Random calls. Faithfulness to the original beats elegance.
- Code style (the user's rules): always curly braces for if bodies, even single statements; English names that read
  well; named constants instead of magic numbers where it helps; short comments that give the original address of
  each routine (`/** 0000:2484 */`). No console.log left in. No exec/child_process in src/.
- Randomness: m.random(n) is Borland's Random; the original seeds it from the clock, so exact random patterns
  cannot match the capture. That is expected.

## Checking against the original
`CMP=<yourname> $S/venv/bin/python $S/compare.py T1 T2 ...` renders the port at demo times T (seconds, the capture's
clock) with tools/shot.mjs and the original's frame at the same time, prints the % of differing pixels and writes
$S/<yourname>.png (left = port, right = original). Look at it (Read the png). Use several times spread over your
part, and iterate until the port matches as closely as possible: same layout, colours, motion, timing. Use a
unique CMP name. `$S/venv/bin/python $S/capframe.py --sheet T0 T1 STEP out.png` makes a contact sheet of the original.
Part start times (src/demo.js PART_STARTS) are the times the part really starts in the reference run; a part is
rendered from its start, so a moment in your part is reproducible on its own.
`node tools/shot.mjs OUTDIR T...` renders only the port.

## Reply
Under 200 words: what you ported, how close it matches (with the % numbers and what remains different and why),
the frame rates you used, the part's real end time if it overruns main's wait tick, and any shared-library bug or
missing feature you found (precisely).
