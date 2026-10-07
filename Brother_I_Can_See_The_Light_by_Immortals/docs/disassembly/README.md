# Disassembly notes: BROTHER.EXE ("Brother I Can See The Light", Immortals, 1997)

> These are the notes the JavaScript port is written from: one file per slice of the executable,
> each produced by reading the disassembly. Below is the brief every reader was given. The scratch
> paths it mentions are session-local; the tools are in `tools/re/` (run `unstub.py`, `extract.py`,
> `le.py BROTHER.EXE work`, then `kdis.py` to rebuild `work/brother.lst`).

Goal of the whole project: a faithful JavaScript port of this DOS demo (320x200, 8-bit palettized,
software-rendered; 2D texture effects plus 3D from .3DS scenes with keyframe animation, GIF
textures, XM music played by MIDAS). Your job is one slice of the disassembly: turn it into precise
pseudo-code that someone can port to JavaScript WITHOUT re-reading the assembly. You do not write
the port.

## The executable

`BROTHER.EXE` (1.1 MB) is three things glued together:

1. A PKLITE-packed real-mode loader (file 0..0x958). Unpacked, it hooks int 21h and serves file
   opens from a table of 31 files bound behind it (`tools/re/unstub.py`, `tools/re/extract.py`).
   The files are extracted in `tools/re/work/res/`: `SCENE1.3DS` (unused, Kahn's creature scene),
   `SHPITZ.3DS`, `TENNISB.3DS`, `TEST.EXE` (the real program), and 26 GIFs. Filenames are matched
   on the basename, case-insensitively, so `TEXTURES\FOO.GIF` opens `FOO.GIF`.
2. `TEST.EXE`: a Watcom C/C++ 32-bit program bound to DOS/4GW. This is what you read.
3. `BICSTL.XM` ships next to the executable (32 channels, 4:35). The demo is 2:55 long.

## Tools

Project root: `/Users/gilm/git/demoports/Brother_I_Can_See_The_Light_by_Immortals` (call it `$P`).
Python with capstone/unicorn/pillow/numpy: `$V` =
`/private/tmp/claude-501/-Users-gilm-git-demoports-Brother-I-Can-See-The-Light-by-Immortals/eab004d6-3d3f-495b-9585-6f8bfbb5a9ae/scratchpad/venv/bin/python`

- `$P/tools/re/work/brother.lst`  full annotated disassembly (capstone, Intel syntax). Lines are
  `ADDR  insn ; annotation`. Functions start with `; ======== sub_XXXXX ========`. Annotations show
  referenced strings and float/double constants (`flt=`, `dbl=`, `f=` for immediates that look like floats).
- `$V $P/tools/re/show.py START END`  print the listing between two hex addresses (stack-check calls
  removed). Read in chunks of ~0x400-0x800 bytes.
- `$V $P/tools/re/peek.py ADDR COUNT [b|w|d|f|q|s|p]`  dump the loaded image: bytes, u16, u32,
  float32, float64, C strings, or pointers. Code at 0x10000.., data at 0x50000..0x609f0.
- `$P/tools/re/work/funclist.txt`  every function: size (to the next function, gaps included),
  number of callers, and its counterpart in KAHN.EXE (see below). `work/callers.json` who calls what.
- `$P/tools/re/work/obj1.bin` / `obj2.bin`  raw code / data objects (fixups applied).
- `$V $P/tools/re/capframe.py T out.png`  a frame of the ORIGINAL running (DOSBox capture), at T
  seconds after the switch to 320x200 (the music starts a few ms later). `--sheet T0 T1 STEP out.png`
  makes a contact sheet. Use it to check your reading against what the screen shows; look at the
  PNGs with the Read tool. The demo is 175 s long.
- Resources: `$P/tools/re/work/res/` (GIFs open with Pillow; 3DS are binary 3D Studio files).

## The Quest of Kahn: the same engine, already read

Immortals' previous demo, *The Quest of Kahn* (Ritual '97), was ported in
`/Users/gilm/git/demoports/The_Quest_of_Kahn_by_Immortals`. Its executable was read the same way:
notes in `docs/disassembly/*.md`, the port in `src/` (engine in `src/engine/`: `scene.js` .3DS loader,
`track.js` keyframer, `frame.js` animate/transform/cull/sort, `triangle.js` clip/project,
`raster.js` span fillers, verified byte-for-byte against the machine code). Its listing is at
`/private/tmp/claude-501/-Users-gilm-git-demoports-Brother-I-Can-See-The-Light-by-Immortals/eab004d6-3d3f-495b-9585-6f8bfbb5a9ae/scratchpad/kahn/kahn.lst`
(same format; `show.py` does not read it, use sed/grep).

`funclist.txt` says, per function, either `kahn: SAME xxxxx` (identical instruction sequence, only
addresses differ), `kahn: MNEM xxxxx` (same mnemonics, operands differ), or `nearest kahn sub_xxxxx
similarity R` (fuzzy match of the mnemonic sequence, 1.0 = identical). About 160 engine functions are
SAME, including all the rasterisers (Brother 0x13c28 = Kahn 0x10f60 sprite_scaled_blend, 0x15223 =
0x1255b trap_persp_tex, 0x15ca1 = 0x12962 tri_affine_tex, 0x169a2 = 0x12fe1), the keyframer
splines, the 3DS chunk readers, MIDAS. **For a SAME function, do not re-derive it: name it, cite
the Kahn note / port module, and give its Brother address.** For a near match, read both and
document precisely what differs (constants, globals, extra branches), so the porter can start from
the Kahn JS and patch it. Global addresses differ between the two executables; give the Brother
addresses and, when you can, the Kahn equivalents.

## Compiler facts

Watcom C/C++ 10.x, 32-bit flat, DOS4GW. Register calling convention: integer/pointer args in EAX,
EDX, EBX, ECX (in that order), the rest on the stack; float/double args go on the stack; callee pops
stack args (`ret N`). Returns in EAX, floats in ST(0). `this` is in EAX. Every C function starts
with `push N; call 0x18012` (stack check, hidden by show.py). `call 0x199b2` before `fistp` is the
float-to-int rounding helper (Kahn's 0x1f318): say which form it is used in. C++ virtual calls look
like `mov edx,[eax]; call [edx+N]`.

## Already known

Program layout: demo code 0x100fe..0x176c4; library/IDS 0x176c4..0x199b0 (memory, VESA, GIF
loader 0x18980/0x18e54/0x1936c, file helpers 0x18690..); MIDAS 0x199d0..0x1d9fc; DPMI/interrupt
helpers 0x1d9fc..0x1da8f; 3D engine 0x1da90..0x2e990 (Kahn 0x23400..0x31700); C runtime 0x2e991+.

`main` = sub_100fe: prints the banner, allocates aligned memory (0x10750), VESA init (0x103d0),
MIDAS init (0x10c28), loads `bicstl.xm` (0x10cd0; also installs the 100 Hz timer callback 0x10c00),
keyboard handler (0x10f40), then seven loaders:
`0x110fb, 0x11909, 0x12b34, 0x134da, 0x1220a, 0x130bf, 0x138b4`,
then sets 320x200x8 (0x104b0(320, 200, 0)), calls 0x176c4(work buffer 0x58424.., ...),
starts the music (0x10d84: MIDASplayModule, zero both tick counters), and runs six parts in order:
`0x1128f, 0x12cc2, 0x13559, 0x122b0, 0x13933, 0x130f7`, then stops the music, restores, prints "The End!".

Globals:
- 0x5846c, 0x58470: two u32 tick counters, both incremented at 100 Hz by the MIDAS timer callback
  0x10c00. Zeroed when the music starts. Parts zero 0x5846c themselves.
- 0x10e50: MIDASgetPlayStatus into 0x58458.., copied to 0x584ac = song position (order index),
  0x584b0 = pattern, 0x584b4 = row, 0x584b8 = sync info. Parts poll this and switch on
  position/row: the demo is synchronised to the music.
- 0x58424 width (320), 0x58428 height (200), 0x5842c/0x58430 float centre (w*0.5-0.5, h*0.5-0.5),
  0x58434 bytes per pixel, 0x58438 buffer size (64000), 0x5843c size/4, 0x58448 row offset table
  (y*width), 0x58440 and 0x58444 two 64000-byte work buffers, 0x5841c pointer to visible video memory.
- 0x1067c(eax=palette) set the VGA DAC (256*3 6-bit), 0x106c0(eax=buf) clear 64000 bytes,
  0x106dc(eax=buf) copy buffer to the screen. 0x1da60 = memset(eax=ptr, edx=value, ebx=count).
- 0x584bc.. keyboard state (make codes set 1, break codes clear); ESC (0x584bd) increments 0x5846f
  (adds 0x01000000 to counter 0x5846c: skips the current part). '+'/'-' change the music volume.
- 0x185b0 fatal error(eax=message).

## What to write

One markdown file, path given in your task. For each function in your range:
- address, a descriptive name, arguments (which register / stack slot), return value
- pseudo-code in C-like form that preserves: every constant (floats as decimal AND whether float32
  or float64), every table and its contents or how it is built, loop bounds, integer vs float math,
  rounding (truncation vs round-to-nearest, which helper), signedness, wraparound (8-bit / 16-bit
  arithmetic, `& 0xff`), the exact order of drawing and of palette writes.
- for a demo part: its music sync (which position/row starts and ends each phase, which tick counter
  is used and how), what is drawn per frame, what it reads from the previous parts (buffers, palette).
- globals it reads and writes, with meaning.
- check your reading against the capture with capframe.py and say what you checked and what agreed.
  If something does not agree, say so; do not paper over it.
- Mark anything you are not sure of as UNSURE with the reason. Do not guess silently.

Write for a porter who has the Kahn port open next to your note. Be complete rather than short; the
porter will not look at the assembly. Do not modify any file outside your note.
