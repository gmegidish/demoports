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
| Click | Start |
| **F** | Toggle fullscreen |
| ← / → | Seek 5 s |

Add `#t=90` to the URL to start 90 s in, `#hud` to show the clock.

```bash
npm test                                      # 28 tests, about six seconds
node tools/shot.mjs /tmp/brother 30 92 130    # render three moments to PNG, no browser
node tools/poster.mjs                         # renders docs/poster.png
```

## Credits

*Brother I Can See The Light*, Immortals, 1997. From `IMR.NFO`, `READ.ME` and the demo's own credits: code by Kombat and Rage, music and graphics by Thor, music and 3D graphics by Dark-Spirit, the logo by Sticky Baboon, help from Miki of BSP. Music player: MIDAS Sound System 0.7, by Petteri Kangaslampi and Jarno Paananen. All graphics and music belong to their authors.

The port, the tools and this README were written by [Claude Code](https://claude.com/claude-code).

## What is in the executable

`BROTHER.EXE` is three things glued together:

- **A PKLITE-packed DOS loader**, 2.4 KB. Unpacked, it hooks int 21h and runs the program bound behind it. Every file the program opens is served from a table of 31 entries that follows the loader, each 32 bytes, scrambled by subtracting the byte's index. Names match on the basename, so `TEXTURES\SEA.GIF` opens `SEA.GIF`.
- **The program, `TEST.EXE`**: Watcom C/C++, bound to DOS/4GW, 230 KB of code. The banner calls it the "Immortals Demo System V 1.08".
- **The data**: `SHPITZ.3DS`, `TENNISB.3DS`, 26 GIFs, and `SCENE1.3DS`, the creature scene of The Quest of Kahn, which nothing loads.

The program is the engine of [The Quest of Kahn](../The_Quest_of_Kahn_by_Immortals/), Immortals' demo from four months earlier, and the port starts from that port's code. About 160 functions are instruction for instruction the same, among them every rasteriser and the keyframer. What changed:

- **The scene loader** reads the material from the object's name case-insensitively and with new suffixes, gives every mesh vertex normals, keeps a palette per material, and no longer loads a flare picture of its own.
- **Animation** moves hidden meshes into view space too. The tennis part depends on it: its player is a set of hidden meshes, drawn vertex by vertex as flares.
- **Small numeric changes**: the environment map scales by 127 on both axes; the ease of a key divides by a double; the last tangent of a rotation track gets an extra term on its w component; one shade filler draws one row and one column more than Kahn's.
- **Sync**: the parts no longer count seconds. They ask MIDAS for the song position and row and switch on them. The module plays a row every 50 ms and a 128-row pattern every 6.4 s, without a tempo change.
- **New 2D effects**: three parts draw the screen as a 40x25 grid of 8x8 cells, two textured triangles each, with texture coordinates and a shade computed only at the 41x26 corners. For the swirl the corners come from polar tables, for the tunnel and the fur planes each corner is a raytraced point.

## The parts

Times are from the start of the music.

| Time | Part | Code |
|---|---|---|
| 0:00 | Bars, the Immortals logo, the credits, "Brother I can see the LIGHT" | `0x1128f` |
| 0:38.4 | A polar swirl of `2D3.GIF`; from 0:51.2 with thirty flares | `0x12cc2` |
| 1:04.0 | The spiked star, `SHPITZ.3DS`, four camera cuts | `0x13559` |
| 1:29.6 | The tunnel, four textures, pictures pasted into themselves | `0x122b0` |
| 1:55.2 | The tennis player, `TENNISB.3DS`, as a cloud of flares | `0x13933` |
| 2:20.8 | Two fur planes, raytraced and fogged | `0x130f7` |
| 2:46.4 | The title, `BROTHER.GIF`; picture and music fade out from 2:52.8 | `0x130f7` |
| 2:55.8 | "The End!" in text mode | `0x100fe` |

## How it was read

1. Run the packed loader in an emulator until it has unpacked itself, and read its int 21h handler to find the file table (`tools/re/unstub.py`, `tools/re/extract.py`).
2. Unpack the DOS/4GW program and disassemble it (`tools/re/le.py`, `tools/re/kdis.py`). Match every function against The Quest of Kahn's executable by instruction sequence: identical, same shape, or nearest.
3. Record the original. DOSBox Staging, Sound Blaster 16, video capture: 175 s of 320x200 frames in exact 6-bit colours.
4. Read the executable in six slices: start-up and part 1, part 2, part 4, the three 3D parts, the engine's differences from Kahn, and the polygon drawers. Each is written down as pseudo-code in `docs/disassembly/`, and each reader checked its reading against frames of the recording. The engine reader ran the keyframer of both executables side by side in an emulator. The tunnel reader ran the whole part in an emulator and matched it to the recording pixel for pixel; that is how the shade filler's two different instructions were found.
5. Port from the notes. Each part of the original is a JavaScript generator that yields once per frame. The machine's clock is the music's: the song position and row come from a table of row start times read from `BICSTL.XM`.
6. Compare with the recording moment by moment (`tools/re/compare.py`).

## What is verified, and what is not

Verified:

- **Against the original running** (`test/original.test.js`): the logo and the credits, the swirl, and the tunnel are pixel for pixel the recorded frames. Every moment of part 1 checked was identical. The fur planes match except for the top three rows of the recorded frame, which the capture tore. The star and the tennis scene differ in 34 to 75 of 64,000 pixels, each one a neighbouring texel of a perspective-mapped face.
- **Rasterisers**: the same code as The Quest of Kahn's, which that port matched byte for byte against the machine code (`test/raster.test.js`). The one filler that differs was checked against the emulated original on 49 frames of the tunnel.
- **Keyframer and camera**: the engine reader ran them in an emulator on random tracks; outputs agree with the port's code to a float ulp or two.
- **The files**: all 31 come out of the executable; all 26 pictures decode.
- **Whole demo**: runs headless from the boot log to "The End!" at 2:55.8 (`test/demo.test.js`).
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
src/parts/              one file per part: intro, kaleidoscope, scenes (parts 3 and 5), tunnel, fur
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
