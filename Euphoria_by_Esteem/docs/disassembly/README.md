# Disassembly notes: EUPHORIA.EXE (Esteem, 1995)
> These are the notes the JavaScript port was written from, one file per slice of the executable,
> each produced by reading the disassembly: `L*` are the libraries (L1/L2 graphics unit, L3/L4 3D unit,
> L5 the small units, L6 the 3D letters), `P*` the parts. Below is the brief every reader was given.
> The scratch paths it mentions no longer exist: the tools are in `tools/re/` (run `extract.py` and
> `edis.py` to rebuild `work/euph.lst`). `PORTING.md` is the brief given to the agents that ported the
> last eight parts. Where a later note corrects an earlier one (L4 on the light vector of L3, P09 on
> 0e5a:1b9f in L5), the code follows the correction.

# Brief: reading EUPHORIA.EXE (Esteem, 1995) for a faithful JavaScript port

Goal of the whole project: a faithful browser port (Canvas 2D, software rendering into an 8-bit
palettised buffer) of the DOS demo "Euphoria" by Esteem (Movement'95). It must match the original
run frame for frame where possible. Your job is ONE slice of the disassembly: turn it into precise
pseudo-code that someone can port to JavaScript WITHOUT re-reading the assembly. You do not write the port.

Do not modify anything under /Users/gilm/git/demoports. Write only your notes file (path given in your task).

## Tools (all in $S = /private/tmp/claude-501/-Users-gilm-git-demoports-Euphoria-by-Esteem/9e8b164a-ee1a-4db7-924d-4bf0e24c5b44/scratchpad)

- `$S/euph.lst` full disassembly (capstone, Intel syntax, 16-bit). Lines `SEG:OFF  insn ; annotation`.
  Functions start with `; ======== sub_SEG_OFF ========`. `callf far SEG:OFF` = far call. Near call
  targets are offsets in the same segment. Annotations with quoted strings are often WRONG (they are
  guesses from immediates); trust only `cs:"..."` ones.
- `$S/venv/bin/python $S/show.py SEG:OFF SEG:OFF` prints the listing between two addresses. Read in
  chunks of a few hundred lines; never dump a whole segment at once.
- `$S/venv/bin/python $S/peek.py ADDR COUNT TYPE` dumps initialised data. ADDR is a DS offset (`0x2522`)
  or `SEG:OFF` for constants stored in code (`186a:0066` - the code often does `fld xword ptr cs:[0x66]`).
  TYPE: b bytes, w u16, sw s16, d u32, f float32, q float64, x float80, r Real48, s pascal string.
  DS data is initialised up to DS:0x2620; everything above is BSS (zero at start).
- `$S/funcsizes.txt` every function, size, number of callers. `$S/img.bin` the loaded image
  (segment 0 at offset 0, so SEG:OFF is at SEG*16+OFF; DS = segment 0x2220).
- `$S/res/NN.*` the resources extracted from the appended resource file (see below).
- Other notes already written live in `$S/notes/*.md`; read the ones relevant to you (library notes).

## Compiler and runtime facts (Borland Pascal 7, real mode, $G+ $N+ $E+)

- Calling convention: Pascal. Args are pushed LEFT TO RIGHT, callee pops (`retf N`/`ret N`). In a far
  procedure, `[bp+6]` is the LAST argument, the first argument is at the highest offset. In a near
  procedure the last argument is at `[bp+4]`. Var parameters and strings/records are passed as far
  pointers (two pushes: segment then offset). Byte args occupy a word.
- Nested procedures: the caller pushes its own BP as a hidden extra argument after the real ones;
  inside, `mov di,[bp+4]` then `ss:[di-N]` reads the PARENT's local at [bp_parent-N]. Name those
  "parent.localN".
- Return values: AX (byte/word), DX:AX (longint/pointer), Real48 in DX:BX:AX, single/double/extended in ST(0).
- Real48 (6-byte `Real`) constants appear as three immediates loaded into AX, BX, DX. Decode them
  (peek type `r` for memory; for immediates: byte0=exp, value=(1+mantissa/2^39)*2^(exp-129)).
- Float immediates are often in the code segment: `fld dword ptr cs:[0x943]`, give their decimal values (peek).
- 8087 emulator interrupts were already translated into real FPU opcodes in the listing.
- Objects: BP7 objects; a far pointer to an object is passed as `es:di`; virtual calls go through the VMT
  (`les di,[obj]; mov di,es:[di+VMT]; call far [di+N]`). Say which method slot if you see one.
- RTL (segment 1d81) entry points you will see:
  - 31e5 Real48(DX:BX:AX)->ST0; 320f ST0->Real48; 3275 Round(ST0)->DX:AX (round-to-nearest-even);
    3256 Trunc(ST0)->DX:AX; 3284 Int(); 32b6 Sqrt; 32ba Sin; 32bf Cos; 32c4 ArcTan; 32c9 Ln; 32ce Exp
  - 3d8f longint mul (DX:AX * BX:CX); 3dcc longint div/mod; 3e95 longint shl
  - 3d77 and 4993: Move(src, dst, count) (byte copy); 4651/47fc/48d2: FillChar-like (check)
  - 4677 Random(n) (BP LCG: RandSeed = RandSeed*134775813+1; result = (RandSeed_hi32 * n) >> 32 style);
    470c Randomize (seeds from DOS time - so randomness differs every run)
  - 028a GetMem / 029f FreeMem; 3ed2 string store; 3eb8 string load; 3f37 concat; 3ef6 Copy;
    3fd4 char->string; 49cb UpCase; 3a74/3a02 Write/WriteLn to text; 0116 Halt
- Timer: unit 1cbc. PIT reprogrammed to 100 Hz; INT 8 handler increments the longint DS:a380.
  1cbc:0091 resets it to 0 and stores a start stamp; 1cbc:00a7(var t) stores now into t;
  1cbc:00ce(var t) returns now - t (ticks of 10 ms); 1cbc:00f3(var t, Real48 ticks) busy-waits until
  now - t >= ticks. Every part is timed with this clock.
- Music: unit 0d27/0d6d is the BWSB player wrapper (ignore internals). 0d27:02a8(n) loads resource n
  and starts playing it; 0d27:03ef fades out; 0d27:03cf stops; 0d6d:0333(v) sets music volume (0..64?).
  Just name these calls.
- Video modes (186a:01a7(m)): table at DS:2522: m=0 mode 13h 320x200, 1 VESA 100h 640x400,
  2 VESA 101h 640x480, 3 VESA 103h 800x600, 4 VESA 105h 1024x768. Width/height per mode at DS:252c.

## Resources

The resource file appended to the EXE: item i (0-based) = res/i.*. The code refers to items with a
1-based number in several places (0xb = item 10); verify per use. 9-13 are GDM music modules
(prelude, "Music 1 - Begin to Euphoria", "Music 2 - Euphoria - Space", "Music 3 - Slime to Rubix",
"03:28AM - 05:52AM, sleepy"). 15-17 are 3D Studio ASCII (.ASC) meshes. 19, 21, 23-41 are PCX images
(25 and 41 are 640x480, others 320x200). 20 and 22 are 2048-byte binaries. 42 is an 80x25 text screen.

## Demo order (main = 0000:a3ef)

Part functions in call order. Each part is followed in main by a wait until the given absolute tick
(100 Hz, 0 = timer reset just before the first part). Times in seconds of the reference capture:
| part | starts | main waits until tick | notes |
|---|---|---|---|
| 0000:0cd6 | 0.00 | 4615 (46.15 s) | intro: "WE ARE VERY GLAD..." scroller over picture, waving flag |
| 0000:143e | 46.15 | 8225 | starts with a 640x480 picture (6 s), then ESTEEM / present / EUPHORIA logos, blue gem |
| 0000:1dab | 82.25 | 10755 | |
| 0a69:0620 | 107.55 | 13270 | |
| 0000:4ebc | 132.70 | 17300 | |
| 0000:3f83 | 173.00 | 29535 | main stores a time stamp (1cbc:00a7) just before |
| 0000:60dc | 295.35 | 40040 | music resource 0xd started before it |
| 0000:2aa9 | 400.40 | 44345 | |
| 0000:3050 | 443.45 | 49740 | |
| 0000:8768 | 497.40 | 52750 | runs in VESA 640x480 |
| 0000:9178 | 527.50 | 55460 | music resource 0xe started before it |
| 0000:7d84 | 554.60 | 61865 | |
| 0000:9778 | 618.65 | 70965 | |
| 0000:0073 | 709.65 | - | end part, then music fade out and stop, text screen |

You can look at the original: `$S/venv/bin/python $S/capframe.py T out.png` writes the frame shown at
demo time T seconds (the clock of the table above), and `capframe.py --sheet T0 T1 STEP out.png` a contact
sheet. Use it to check your reading (what is drawn, colours, motion), and say what you checked.

## What to write

One markdown file, path given in your task. For each function in your range:
- address, a descriptive name, arguments (name each, with its stack slot), return value
- pseudo-code in C/JS-like form that preserves EVERY constant (give floats as decimal and say
  whether float32/float64/extended/Real48), every table address, loop bounds, and integer
  semantics (signed/unsigned, 16 vs 32 bit, truncation vs rounding, shifts, overflow/wraparound).
- what global variables it reads/writes (DS offsets), with a guessed name for each.
- data tables it uses: dump them with peek and include short ones verbatim (long ones: address, length,
  how to regenerate or where in the image).
- For pixel-writing code: exact memory layout (linear 320-wide? VESA banked? planar mode-X?),
  where the frame buffer is, how and when it is copied to the screen, palette writes (port 3c8/3c9 with
  6-bit values), vertical retrace waits (port 3da).
- Be exact over being pretty. If something is unclear, say so explicitly rather than guessing; mark
  guesses as GUESS.
- At the top: a short summary of what the slice does, and a list of every external call it makes
  (address -> what it is, if known from other notes).
