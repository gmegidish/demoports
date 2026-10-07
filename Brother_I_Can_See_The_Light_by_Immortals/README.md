# Brother I Can See The Light — in a browser

**▶ [Watch it in your browser](https://gmegidish.github.io/demoports/Brother_I_Can_See_The_Light_by_Immortals/)** · press **F** for fullscreen

*Brother I Can See The Light* is a demo by Immortals, first place at The Movement '97 demo competition in Israel, 31 December 1997. Thor's hard disk, with the demo the group had been working on, was stolen at the party. About eight hours before the deadline they started again from a tune Thor had tracked; the exit message calls it "A 6 Hours production". It is under three minutes long: credits over a cloud logo, a polar swirl with drifting flares, a spiked star in 3D Studio, a raytraced tunnel that pastes the screen into itself, a tennis player drawn as a cloud of light, two endless fur planes, and the title.

This repository rebuilds it in a browser from the original executable. `BROTHER.EXE` carries everything except the music: the program, three 3D Studio scenes and 26 pictures, bound behind a small DOS loader. The port reads them straight out of it. The picture is composed the way the original did it: a 320x200 buffer of palette indices and a 6-bit VGA palette, software-rendered on the CPU, put on screen by a 2D canvas. No WebGL, no libraries. Same files, same code paths, same music positions and rows.

There is no source code for Brother I Can See The Light. Everything was read out of the executable.

The whole port was written by [Claude Code](https://claude.com/claude-code): unpacking the executable, disassembling it, recording the original in an emulator, reading the code in six slices, checking the readings against the recording and against the machine code in an emulator, porting, and this README.

![Twenty-four moments of the demo, rendered by the port](docs/poster.png)

*Twenty-four moments, in order. Rendered headless by `tools/poster.mjs`: no browser, no screenshots.*

## Run

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

| Key | Action |
|---|---|
| Click, Enter or Space | Start |
| **F** | Toggle fullscreen |
| ← / → | Seek 5 s |

Add `#t=90` to the URL to start 90 s in, `#hud` to show the clock.

```bash
npm test                                      # 29 tests, about seven seconds
node tools/shot.mjs /tmp/brother 30 92 130    # render three moments to PNG, no browser
node tools/poster.mjs                         # renders docs/poster.png
```

## Credits

*Brother I Can See The Light*, Immortals, 1997. From `IMR.NFO`, `READ.ME` and the demo's own credits: code by Kombat and Rage, music and graphics by Thor, music and 3D graphics by Dark-Spirit, the logo by Sticky Baboon, help from Miki of BSP. Music player: MIDAS Sound System 0.7, by Petteri Kangaslampi and Jarno Paananen. All graphics and music belong to their authors.

The port, the tools and this README were written by [Claude Code](https://claude.com/claude-code).

---

# How it was made, and how it was unmade

## Eight hours

`READ.ME`, written by Kombat at 14:58 on the last day of 1997, tells it. Immortals came to The Movement '97 to finish a demo they had been working on. Thor's hard disk was stolen at the party, "and all the scenes/textures/whatever was gone". Two days later, about eight hours before the deadline, they sat down with a tune Thor had tracked and wrote another one. It won.

The same file lists what is in it: "some raytracing, freedirection-tunnels, raytracing-planes, recursive stuff, some 3d engine", and a particle system that was not used because the deadline was five minutes ago. The demo was left in its party version. The exit message says "A 6 Hours production" and "Final Version (I hope :)".

## One file, a loader and a demo

`BROTHER.EXE` is 1,106,753 bytes. It starts like a small DOS program:

```
00000000: 4d5a 5801 0500 0100 0200 6b01 ffff 9e00   MZX.......k.....
00000020: b8d8 01ba 9400 0500 003b 0602 0073 1a2d   .........;...s.-
00000050: cd20 4e6f 7420 656e 6f75 6768 206d 656d   . Not enough mem
```

Five pages, 2,392 bytes, and the entry code of PKLITE. Nothing unpacks it on disk, so it was run in an emulator until it had unpacked itself (`tools/re/unstub.py`). What comes out is a small loader that carries the message `Executing internal subfile...` and hooks int 21h. Every DOS call the program behind it makes to open (`3D`), read (`3F`), seek (`42`), close (`3E`) or execute (`4B`) a file goes through it first.

Right after the loader's 2,392 bytes:

```
00000958: 584c 0282 0000 0000 1f00 0100 1000 0000   XL..............
```

`XL`, a count of 0x1F, a table at offset 0x10. The table is 31 entries of 32 bytes: a 16-byte name, a size, an offset. It is scrambled, barely: byte *i* of the table is stored plus *i*. The loader undoes it once, at start-up:

```asm
sub es:[si], bl
inc bl
inc si
loop ...
```

When the program opens a file, the loader cuts the path after its last `\` or `:`, upper-cases it, and looks for it in the table. Found: the open succeeds, and reads come from inside `BROTHER.EXE`. So the 3D loader can ask for `TEXTURES\SEA.GIF` and get `SEA.GIF`. Nothing is ever written to disk. The loader's last job is to execute one of its own entries, `TEST.EXE`, the demo.

| Entries | What |
|---|---|
| `TEST.EXE` | the demo: a DOS/4GW program, 339,863 bytes |
| `SHPITZ.3DS`, `TENNISB.3DS` | the two 3D Studio scenes |
| `SCENE1.3DS` | The Quest of Kahn's creature scene. Nothing loads it |
| 26 GIFs | 19 used; `ASHSEN`, `BURGUL`, `CHECKER2`, `CLOUD`, `CREAT`, `FOOD`, `FLARE1` are not |
| `_____XLC@SRT` | 141 bytes the loader keeps for itself; not traced |

The music, `BICSTL.XM`, ships next to the executable.

## The engine from four months earlier

`TEST.EXE` is a Watcom C/C++ linear executable for DOS/4GW. Two objects:

```
object 1   base 0x10000   0x38861 bytes   code
object 2   base 0x50000   0x109F0 bytes   data
```

8,246 fixups, all 32-bit offsets. Resolve them, disassemble from the entry point and from every code address a fixup produces, and `main` is easy to find by its strings. It prints a banner in text mode:

```
]  Immortals Demo System V 1.08
]  Kicking MIDAS  -  Hmm, It Looks Alive
]  Hack IDS, load data be4 entering mode, Bpp=1
]  Hang on, loading/calculating/doing magic
```

then calls seven loaders, sets 320x200, starts the music and calls six parts.

Four months earlier the same group had won The Ritual '97 with *[The Quest of Kahn](../The_Quest_of_Kahn_by_Immortals/)*, already ported in this repository. Its executable was disassembled the same way, so every function of one was compared with every function of the other by instruction sequence, addresses masked out:

| Match | Functions |
|---|---|
| Identical | 161 |
| Same instructions, different operands | 9 |
| Neither | 77 |

The identical ones include every hand-written rasteriser, the 3D Studio chunk readers, the keyframer's splines, the matrix and quaternion helpers and the MIDAS player. The "neither" are mostly the six new parts. So the port starts from the Kahn port's engine, and six readers went through the executable looking for what changed. Each wrote its slice down as pseudo-code, in `docs/disassembly/`.

## What changed in the engine

Little, and all of it matters.

**Object names.** 3D Studio objects carry their material in their name, `Sphere,prs`, `obj,env3`. Kahn matched `prs` and `PRS` but not `Prs`. Brother upper-cases the name first, and has more suffixes: `PRS` is perspective-mapped, `ENV` environment-mapped, `CUL` two-sided, and `SPC`, `GOR`, `ZER`, `TRN` exist for drawers this demo never calls. The bits were renumbered on the way.

**Hidden meshes.** Kahn did not move a hidden mesh into view space. Brother does. The tennis scene depends on it: every mesh of the player, the racket and the balls is flagged hidden in the `.3DS` file, so the sorter drops their faces, and the part then puts an additive flare on each of their vertices, 8 to 169 per mesh. The player is a cloud of light because his faces are never drawn.

**Numbers.** Environment mapping scales the normal by 127 on both axes (Kahn: 128 and 127). The ease of a key divides by the sum of two floats as a double, not as a float. The tangent at the last key of a rotation track gets an extra term on its w component only, `- 0.25 × (last.w - thirdLast.w)`; the engine reader confirmed it by running both executables' keyframers side by side in an emulator.

**One filler.** The shade filler, which re-colours pixels already drawn through a 64 KB table, was reported identical to Kahn's: similarity 1.00. Rounded. Two instructions differ:

```asm
inc word [0x5303c]        ; Brother: draw the flat bottom row too
add eax, 1                ; Brother: span width +1 (Kahn: add eax, 0xffff0001)
```

Without them, every 8x8 cell of the tunnel has a lighter seam along its last row and column. The reader that found it had run the whole tunnel part in an emulator and compared its frames with the recording.

## No seconds, only rows

Kahn's parts counted ticks of a 100 Hz timer. Brother's ask MIDAS where the song is:

```c
MIDASgetPlayStatus(&status);
[0x584ac] = status.position;   // index in the order list
[0x584b4] = status.row;
```

and switch on it. Part 1 shows a credit picture whenever the row is a multiple of 32. The 3D parts cut to the other camera on row 0 of every new position. A part ends when the position passes its last.

`BICSTL.XM` never changes tempo: speed 2, 100 BPM, so a row is 2 × 2.5 / 100 = 50 ms, and most patterns are 128 rows, 6.4 s. The port reads the module's order list and patterns itself (`src/xm.js`) and turns the music's playing time into a position and a row. The table it builds makes the song 4:35.2 long, as libopenmpt does.

| Song position | Time | Part |
|---|---|---|
| 0 | 0:00 | Bars, the logo, the credits, "Brother I can see the LIGHT" |
| 6 | 0:38.4 | A polar swirl of `2D3.GIF`; at position 8, thirty flares |
| 10 | 1:04.0 | The spiked star, `SHPITZ.3DS`; a camera cut at 11, 12, 13 |
| 14 | 1:29.6 | The tunnel, a phase per position, 14 to 17 |
| 18 | 1:55.2 | The tennis player, `TENNISB.3DS`; cuts at 19 to 23 |
| 24 | 2:20.8 | Two fur planes |
| 28 | 2:46.4 | The title, `BROTHER.GIF`; from position 29, picture and music fade out |
| | 2:55.8 | "The End!" |

The timers are still there. Fades and the 3D animations run on one of them, zeroed at the start of each part. The swirl, the cut flashes, the flight down the tunnel and the turn of the fur planes run on the other. That one is never zeroed by the part that uses it, but by the part before: the last frame of the star part resets it as it cuts on position 14, and that becomes the tunnel's clock.

## A grid of 8x8 cells

Three parts share a trick. They do not compute every pixel. They compute 41x26 corners, eight pixels apart, and draw the screen as 40x25 cells, each two textured triangles with Kahn's affine filler: 2,000 triangles a frame. The corners of a cell are at +0 and +7, the filler draws both edges of every span, and the cells tile the screen with no gaps.

**The swirl.** A table built at load time holds each corner's distance and angle from the centre:

```
radius = sqrt(dx² + dy² + 1) × 8.17
angle  = atan2(dy, dx) in 0..2π, with π = 3.141592687
```

That π is the executable's, not quite Math.PI. Per frame, with a = ticks × 0.0098 and s = sin a:

```
u = radius × cos(s - angle) × 4 × s + 512 sin a + 256
v = radius × sin(s - angle) × 4 × s + 512 cos a + 256
```

The zoom is proportional to s. Every 3.2 s s crosses zero, every corner collapses onto the same texel, and for a frame the screen is a mosaic of flat 8x8 squares.

**The flares.** Thirty flares follow 3D Studio splines of ten random keys each. The keys come from the C runtime's `rand()`, seeded with 1. They are the only two calls to `rand` in the program, so every run of the demo draws the same flares, and so does the port.

**The tunnel.** Each corner is a ray from the eye, turned by a matrix of three angles, intersected with a cylinder of radius √70000 around the z axis. The quadratic has two roots, and the code takes the smaller one: the wall behind the eye. The eye flies down the tunnel at 270 units a second; the texture's u is the distance along it, v the angle around it, and the shade falls with the distance from the eye. The angle is scaled by 0.318309882798629, which is close to 1/π but is not the double nearest to it. With 1/π, one corner in 20,000 lands on another texel.

Then the tunnel pastes the screen into itself. A sub-picture is every third pixel of every third row, a 106x66 copy, written into the same buffer it reads from. Later rows of the copy read rows the copy already wrote, and calling it eight times in a row nests the picture inside itself. That is the "recursive stuff". A copy into a separate buffer would not nest; the port does it in place, as the original does.

**The fur planes.** The same rays, intersected with two planes, y = -200 and y = +200, textured with `FUR.GIF` by their x and z, fogged to black 3,150 units away.

## Bugs, kept

**Black before white.** Every part opens with a fade from white:

```
DAC = trunc(p + (64 - p) × t)
```

64, not 63. On the first frame t is 1.0, every channel comes out as 64, and the VGA DAC keeps six bits of it: 0. So each fade from white starts with a black frame. The recording shows them, and so does the port.

**The first row.** The sub-picture copy clips at the top of the screen, and when it does, its first visible row reads source row 0 instead of the row it should. Kept.

**The bars.** The opening bars fade by 0.999995 on every pass of a busy loop. Their speed was the CPU's. In the recording that was about 190,000 passes a second, a fade of 0.95 per second, and the port fades them by time at that rate.

## Measuring the original

The original was run in DOSBox Staging, a Sound Blaster 16 at 44.1 kHz, with video capture started before the demo. MIDAS detects the card by itself. The capture holds 175 s of 320x200 frames in exact 6-bit colours, and the audio.

Comparing frames turned up a clock problem. In the recording, MIDAS reports each new song position before its audio is heard: by about 0.1 s at the start and 0.5 s by the end. The 100 Hz timer drifts against both. That is the emulator, not the demo: on a real PC all three count real time. So the port runs everything, positions, rows and both timers, on the music's clock, and the comparison tools pair each moment of the song with the moment of the recording that shows it (`tools/re/compare.py`). The pairing is not one formula: parts that run on the timer line up with one offset, parts that run on the row with another.

With that, the 2D parts match the recording pixel for pixel, and the 3D parts match in all but a few dozen of 64,000 pixels: perspective-mapped texels that land on their neighbour. The x87 keeps intermediate results in 80 bits where JavaScript has 64, and a texel boundary is a sharp place to feel it.

## The text screens

The demo begins and ends in text mode, and so does the port. At the start, the banner, printed one `cout` at a time. At the end, `main` switches to mode 3 and prints its goodbye without a newline after "The End!":

```
The End!Brother I can see the light, Immortals 1997
A 6 Hours production
Final Version (I hope :)


C:\>_
```

The port draws them with the VGA ROM font, 9x16 cells, as the recording shows them.

## How the port works

Each part of the original is a loop that spins as fast as the machine allows and checks the song position. In the port each is a JavaScript generator that yields once per frame. Before each frame the page sets the machine's time from the music's `currentTime`; position, row and both timers are read from it. The original ran its loops thousands of times a second and could not miss a row; a frame can, so the port tests "reached" where the original tested "equal".

Seeking works by starting over and jumping. A part that is over falls through at once, and a part zeroes its timers at the row where the original would have zeroed them, so a jump lands where continuous play would be. After a jump the keyframer and the flare splines are evaluated a few extra times: their cursors move one key per call.

## What is verified, and what is not

Verified:

- **Against the original running** (`test/original.test.js`): the logo and the credits, the swirl, and the tunnel are pixel for pixel the recorded frames. Every moment of part 1 checked was identical. The fur planes were checked with `tools/re/compare.py` only: they match except for the top three rows of the recorded frame, which the capture tore. The star and the tennis scene differ in 34 to 75 of 64,000 pixels, each one a neighbouring texel of a perspective-mapped face.
- **Rasterisers**: the same code as The Quest of Kahn's, which that port matched byte for byte against the machine code (`test/raster.test.js`). The one filler that differs was checked against the emulated original on 49 frames of the tunnel.
- **Keyframer and camera**: the engine reader ran them in an emulator on random tracks; outputs agree with the port's code to a float ulp or two.
- **The files**: all 31 come out of the executable; all 26 pictures decode.
- **Whole demo**: runs headless from the boot log to "The End!" at 2:55.8, and a jump into a part shows what playing up to it shows (`test/demo.test.js`).
- **Browser**: the boot log, playback on the music's clock and seeking were exercised in Chrome. Real-time playback in a visible tab was not watched end to end.

Not the same as the original, and why:

- **Timing.** In the recording, the pictures change ahead of the music: MIDAS reports each new song position before its audio is heard, by about 0.1 s at the start and 0.5 s by the end, and the 100 Hz timer drifts against both. Most of that is the emulator. The port switches on the rows as heard, and runs both timers on the music's clock. To compare frames, the tools pair each moment of the song with the matching moment of the recording.
- **Music.** The soundtrack is `BICSTL.XM` rendered with libopenmpt, not MIDAS's mixing. The rows come at the same times: openmpt and the port's row table both make the song 4:35.2 long.
- **The bars at the start** fade by 0.999995 per pass of a busy loop, so their speed was the CPU's. The port fades them by time, at the rate measured in the recording.
- **The first camera cut** of the two 3D parts happens only if their first frame still sees row 0 of the song position, which depends on how long the previous part's last frame took. In the recording the star part takes the cut and the tennis part does not; the port does the same.
- **The 3D texels**: the x87 FPU keeps intermediate results in 80 bits where JavaScript has 64. In the perspective-mapped scenes a few dozen pixels a frame land on the neighbouring texel.
- **Loading.** The original spends about 24 s precalculating behind its text-mode log ("Hang on, loading/calculating/doing magic"). The port prints the log in a few frames.
- **Keys.** ESC, and + and - for the volume, are not wired up. In the original, ESC can only cut short a fade or the final picture: every part waits for the music.
- **Seeking** restarts the timers at the row where the original would have restarted them, so a jump lands where continuous play would be.

## Layout

```
index.html              the page
src/main.js             fetches BROTHER.EXE, the module, the font and the music; runs the demo on the music's clock
src/demo.js             main: boot log, load order, part order, "The End!"
src/bundle.js           the file table bound into BROTHER.EXE
src/xm.js               when each row of the module plays
src/machine.js          screen, work buffers, DAC, tick counters, MIDAS play status
src/grid.js             the 8x8-cell grid of the 2D parts, polar tables, rotation, rays
src/tables.js           additive and shade lookup tables
src/parts/              one file per part: intro, kaleidoscope, scenes (parts 3 and 5), tunnel, fur; common.js for fades
src/engine/             The Quest of Kahn's engine, patched: scene loader, keyframer, animate/sort, drawers, rasteriser
src/screen.js, textscreen.js, gif.js, picture.js
assets/music.ogg        BICSTL.XM rendered with libopenmpt
assets/vga8x16.bin      the VGA ROM font, for the text screens
docs/disassembly/       the notes the port was written from
tools/re/               the unpacking, disassembly and capture tools
tools/poster.mjs        renders docs/poster.png
```

The music is rendered once, then encoded:

```bash
openmpt123 --render --samplerate 44100 --channels 2 bicstl.xm
ffmpeg -i bicstl.xm.wav -c:a libopus -b:a 160k assets/music.ogg
```
