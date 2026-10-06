# Disassembly notes: KAHN.EXE ("The Quest of Kahn", Immortals, 1997)
> These are the notes the JavaScript port was written from: one file per slice of the executable,
> each produced by reading the disassembly. Below is the brief every reader was given; it records
> what was already known and how the listing was made. The scratch paths it mentions no longer
> exist: the tools are in `tools/re/` (run `le.py` then `kdis.py` to rebuild `kahn.lst`).
> Where a note says it guessed, and a later note corrected it, the code follows the correction:
> `A_fx_font.md` (checked against the real machine code in an emulator) wins over the others
> on anything the rasteriser does.

Goal of the whole project: a faithful JavaScript port of this DOS demo (320x200, 8-bit palettized,
software-rendered 3D from .3DS scenes with keyframe animation, GIF textures, XM music).
Your job is one slice of the disassembly: turn it into precise pseudo-code that someone can port
to JavaScript WITHOUT re-reading the assembly. You do not write the port.

The demo and its data files are in /Users/gilm/git/quest-kahn (KAHN.EXE, SCENES/*.3DS, TEXTURES/*.GIF,
TEXTURES/STANDARD.AFT, MUSIC/DUCKSIN.XM). Do not modify anything there.

## Tools (all in this scratchpad directory, call it $S)

$S = /private/tmp/claude-501/-Users-gilm-git-quest-kahn/8902eaa9-bb8c-4ee6-ab72-4ea289b5ccfe/scratchpad

- `$S/kahn.lst`  full annotated disassembly (capstone, Intel syntax). Lines are `ADDR  insn ; annotation`.
  Functions start with `; ======== sub_XXXXX ========`. Annotations show referenced strings and
  float/double constants (`flt=`, `dbl=`, `f=` for immediates that look like floats).
- `python3 $S/show.py START END`  print the listing between two hex addresses (stack-check calls removed).
  Read your range in chunks of ~0x400-0x800 bytes; do not dump a whole 7 KB function in one call.
- `python3 $S/peek.py ADDR COUNT [b|w|d|f|q|s|p]`  dump the loaded image: bytes, u16, u32, float32,
  float64, C strings, or pointers (marks relocated ones). Code is at 0x10000.., data at 0x50000..0x5fa80
  (initialized up to 0x592f6, zero BSS after).
- `$S/funclist.txt` every function with size and number of callers; `$S/callers.json` who calls what.
- `$S/obj1.bin` / `$S/obj2.bin` raw code / data objects (fixups already applied).
- Python with capstone: `$S/venv/bin/python`.

## Compiler facts

Watcom C/C++ 10.x, 32-bit flat, DOS4GW. Register calling convention: integer/pointer args in
EAX, EDX, EBX, ECX (in that order), the rest on the stack; float/double args go on the stack;
callee pops stack args (`ret N`). Returns in EAX, floats in ST(0). `this` is in EAX.
Every C function starts with `push N; call 0x10236` (stack check, already hidden by show.py).
`call 0x1f318` after FP math is the float-to-int rounding helper (treat as "round per current FPU
mode", and say which form: fistp after it). C++ objects have a vtable pointer; virtual calls look
like `mov edx,[eax]; call [edx+N]`.

## Already known

Globals:
- 0x59384 screen width (320), 0x59388 height (200), 0x5938c/0x59390 float screen centre
  (w*0.5-0.5, h*0.5-0.5), 0x59394 bytes per pixel (1), 0x59398 buffer size (64000), 0x5939c size/4
- 0x5937c pointer to visible screen memory; 0x593a0 work buffer A, 0x593a4 work buffer B (64000 each)
- 0x593a8 table of row offsets (y*width)
- 0x5c9b0 current palette, 256*3 bytes, 6-bit VGA values
- 0x593cc and 0x593d0: two 32-bit timer counters, both incremented at 100 Hz by a MIDAS timer
  callback (0x10bd0). ESC adds 0x01000000 to both (skips ahead). Scenes reset and compare these.
- 0x5941c.. keyboard state bytes; 0x593c8 music volume
- 0x594b8 0xF0-byte loader state allocated by sub_14239

Functions:
- 0x1e268 malloc(eax=size) / 0x1e25c free(eax) / 0x1d3b0 memset(eax=ptr, edx=value, ebx=count)
- 0x1e270 fatal error(eax=message)
- 0x1061c set VGA palette from eax (768 bytes) / 0x10660 clear 64000-byte buffer eax
- 0x1067c copy buffer eax to the screen (the "flip")
- 0x106a0 blend(eax=dst, edx=src, ebx=64K table): dst[i] = table[(src[i]<<8) | dst[i]] over 64000 bytes
- 0x10734 returns the next 64 KB-aligned 64 KB block (textures are 256x256, 64K aligned)
- 0x10770(eax=table) builds a 256x256 additive-colour lookup from the palette (clamped at 63, nearest match
  by sum of absolute RGB differences); 0x108e4 same for the 50% average; 0x10a28(float a, float b, table
  on stack) for weighted a*i + b*j
- 0x1f07c load GIF (eax=filename, edx=destination, ebx, ecx, one stack arg)
- 0x1418c loader progress message(eax=string); 0x14048 called 25x (probably text drawing)
- 0x1f336..0x23188 is the MIDAS sound system: ignore, just name calls into it "midas_*"
- 0x31763 and above is the C/C++ runtime (ignore; identify memcpy/strcmp/fopen-like calls by behaviour)

Demo order (main at 0x100ef): loaders 143ac, 14899, 14fed, 1541e, 15a68, 15c39, 15f07, 1622e, 16743,
16bf5, 17221, 18286, 1d210; then music starts and timers are zeroed (10d34); then the parts run in
this order: 14477, 149ba, 15162, 15acc, 162c2, 1681a, 15c8e, 16cdd, 17322, 15f4e, 18396, 1d2d1.

## What to write

One markdown file, path given in your task. For each function in your range:
- address, a descriptive name, arguments (which register / stack slot), return value
- pseudo-code in C-like form that preserves: every constant (give floats as decimal AND say whether
  float32 or float64 where it matters), every global address touched (keep the hex address next to
  any name you invent), loop bounds, order of operations where it affects the result (integer
  truncation vs rounding, 8-bit wraparound, signed vs unsigned, fixed-point shifts)
- struct layouts you can infer: `offset: type meaning`, with the evidence being the code you read
- for callees outside your range keep the name `sub_XXXXX` and describe the arguments passed
- dump any data tables the code reads (use peek.py) and include them in the file
Prefer exactness over prose. Where you are not sure, say so explicitly with the address; do not guess
silently. If two functions are near-duplicates, document one fully and list the exact differences.
Do not paste raw assembly back except for a few lines where the meaning is genuinely ambiguous.

Your final message back should be short: the file path, a 10-line summary of what the slice does,
and a list of open questions. The detail belongs in the file.
