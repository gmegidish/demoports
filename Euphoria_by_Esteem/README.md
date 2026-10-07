# Euphoria — in a browser

**▶ [Watch it in your browser](https://gmegidish.github.io/demoports/Euphoria_by_Esteem/)** · press **F** for fullscreen

*Euphoria* is a demo by Esteem, first place at Movement'95, the first Israeli demo competition (24 December 1995). It is twelve minutes long: a greeting scroller and a waving flag, extruded 3D logos, a crystal, a starfield warp into a cloud tunnel, a pillar hall, translucent shards, a torus in 640x480, a Rubik's cube, a landscape flight, credits in fire, and "THE END" in lit 3D letters, with five tracked modules underneath.

This repository rebuilds it in a browser from the original executable: `EUPHORIA.EXE` carries everything, the pictures, meshes, fonts and music in a resource file appended to the program. The picture is composed the way the original did it: 64000-byte pages of palette indices, a 6-bit VGA palette, VESA banks for the 640x480 part, all software-rendered and put on screen by a 2D canvas. No WebGL, no libraries. Same pictures, same code paths, same 100 Hz clock.

There is no source code for Euphoria. The engine and every part were read out of the executable.

The whole port was written by [Claude Code](https://claude.com/claude-code): unpacking the executable, disassembling it, reading it in slices, recording the original in an emulator to compare against, porting, checking the rasterisers byte for byte against the machine code, and this README.

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

Add `#t=300` to the URL to start 300 s in, `#hud` to show the clock, `#nosound` to run on the wall clock without the soundtrack.

```bash
npm test                                      # 54 tests, a few seconds
node tools/shot.mjs /tmp/euphoria 30 300 600  # render three moments to PNG, no browser
node tools/poster.mjs                         # renders docs/poster.png
```

## Credits

*Euphoria*, Esteem, 1995. From `EUPHORIA.NFO`: code by Adept and Skyer, music by Bahc and Paso, graphics by Mr. Ed and Insane Tilt. Music player: BWSB Music and Sound Engine by Edward Schlunder. All graphics and music belong to their authors.

The port, the tools and this README were written by [Claude Code](https://claude.com/claude-code).

## What is in the executable

`EUPHORIA.EXE` is a Borland Pascal 7 real-mode program, 150 KB of code and data, followed by a 3 MB resource file: 50 sizes, then the items back to back. Six BWSB sound drivers, five GDM modules, three 3D Studio ASCII meshes, 21 PCX pictures (two of them 640x480), two glyph tables for the bitmap fonts, and the 80x25 text screen shown at exit.

- **Pages.** Everything draws into a 64000-byte "page" (conventional memory or EMS). `present` copies the active page to A000. No part waits for the vertical retrace: every loop runs as fast as the machine allows.
- **A 3D unit** (segment 1342) with BP7 objects: points with model and transformed coordinates, meshes, faces, polygon objects sorted by a quicksort on the sum of z, groups, starfields, explosions, point lights. Four shading modes: flat Lambert from an integer normal, Gouraud from point lights, per-vertex angle against a 91-entry lighting table, and none.
- **Hand-written fillers** (segment 186a): flat polygons with colour cycling and pluggable span routines (solid, gradient, additive), Gouraud with a fraction that leaks from one span to the next through the high word of EDI, the lighting-table fill, and a column-based affine texture mapper that steps u and v packed in one register.
- **Effects** (segment 179b): blur, fire, page averaging, a blend table, a wobble, a plasma, all on 8-bit pages.
- **Music.** BWSB plays modules from the resource file. The parts read the clock, and one part reads a channel's VU meter to make crystals bounce.
- **One clock.** The PIT is set to 100 Hz; `main` runs the parts in order and busy-waits after each one for an absolute tick.

The 8087 instructions are compiled as emulator interrupts (`int 34h`–`3Dh`); the runtime patches them into real FPU instructions on first use. The disassembler does the same patch. Transcendentals stay as `int 3Eh` calls into the runtime: the code byte after it selects sin, cos, arctan, ln or exp.

## The parts

| Time | Part | Code |
|---|---|---|
| 0:00 | Greeting scroller, MOVEMENT'95, the waving flag | `0000:0cd6` |
| 0:46.2 | 640x480 picture, ESTEEM in 3D with a trail, "present" | `0000:143e` |
| 1:25.2 | Moon landscape, starburst, EUPHORIA | `0000:1dab` |
| 1:50.2 | A sheet morphs into a ball and tumbles | `0a69:0620` |
| 2:12.7 | Three crystals, averaged pages | `0000:4ebc` |
| 2:53.0 | Stars, comet, warp, Jupiter and Earth, cloud tunnel | `0000:3f83` |
| 4:56.1 | Time-delay echo, checker cube in the pillar hall | `0000:60dc` |
| 6:40.4 | Shards, translucent box, wobble | `0000:2aa9` |
| 7:23.5 | Textured torus | `0000:3050` |
| 8:17.4 | Torus on a rainbow, VESA 640x480 | `0000:8768` |
| 8:47.5 | Rubik's cube | `0000:9178` |
| 9:14.6 | Landscape flight | `0000:7d84` |
| 10:18.7 | Credits in fire | `0000:9778` |
| 11:49.7 | THE END, then the text screen | `0000:0073` |

## How it was read

1. Split the resource file (`tools/re/extract.py`). The pictures decode identically with Pillow.
2. Disassemble the relocated MZ image by recursive descent from the entry point, every far call and every procedure pointer built in code, translating the 8087-emulator interrupts (`tools/re/edis.py`).
3. Identify the runtime: Real48 conversions, rounding, the math shortcuts, `Random`. Find `main`: thirteen parts and a wait after each.
4. Record the original. DOSBox Staging, Sound Blaster 16 at 44 kHz, video capture at native resolution: 12.3 minutes of frames in exact 6-bit colours, and the audio.
5. Read the executable in slices, libraries first, then the parts, each written down as pseudo-code: `docs/disassembly/`. Every part reader checked its reading against frames of the recording.
6. Port from the notes. Each part of the original is a JavaScript generator that yields the time it waits for, so the demo runs on virtual time: the same at any frame rate, headless or in a browser.
7. Compare with the recording, part by part, and tune what the code leaves to the CPU: how many loop passes per second.

## What is verified, and what is not

Verified:

- **Rasterisers:** byte-identical to the original machine code, run in an emulator, on 5,500 random polygons, textures and lines (`test/raster.test.js`). The one difference found, a rounding tie in the line clipper, was fixed.
- **Pictures:** all 21 PCX files decode to the same pixels and palette as Pillow.
- **3D letters:** the table-driven builder reproduces the original's calls for every letter, checked in an emulator.
- **Against the original running:** the intro at 2, 10 and 20 s is pixel for pixel the recorded frame (`test/original.test.js`). Every 12 s of the demo was compared side by side with the recording; layout, colours, motion and timing agree everywhere.
- **Whole demo:** runs headless from the first frame to the end of the text screen at 12:08 in about six seconds.

Not the same as the original, and why:

- **Randomness.** The original seeds `Random` from the clock, so every run differs: stars, shards, fire, the starburst rays and the Rubik's scramble cannot match a recording.
- **Loop speed.** No part waits for the retrace; many effects advance once per loop pass. The port charges each pass the time it took in the recording (measured per loop, in `FRAME_SECONDS` constants). Scenes that accumulate per pass (the terrain scroll, the wobble, the tumbling ball's scale) drift from the recording over tens of seconds.
- **Loading.** The original spends 0.1 to 0.5 s loading pictures at the start of some parts; the port loads instantly, so a few fades start that much earlier.
- **The 640x480 flag.** Part 143e shows a 640x480 picture that a preload put in hidden video memory. In the recording that memory had been cleared, and the screen shows a flat colour; the port shows what the recording shows (`IS_FLAG_PICTURE_LOST` in `src/parts/logos.js`).
- **Music.** The soundtrack is the audio of the recording: BWSB on an emulated Sound Blaster 16, aligned with the 100 Hz clock by construction. The crystals' bounce, which the original reads from the player's VU meter, comes from a table of bounces measured in the recording.
- **Tearing.** Palette changes in the middle of a screen refresh (visible in the recording during busy-wait fades) are not reproduced.
- **Seeking** restarts the part it lands in, from its start time in the recording; parts do not depend on each other, except through music.
- **Real-time playback in a visible tab** was checked only briefly.

## Layout

```
index.html              the page
src/main.js             fetches the executable, the font and the soundtrack; runs the demo on the soundtrack's clock
src/demo.js             main: part order, waits, part start times
src/machine.js          pages, video memory, VESA banks, DAC and shadow palette, virtual time, Random
src/gfx.js              graphics unit, first half: pixels, lines, rectangles, palette effects
src/raster.js           graphics unit, second half: polygon fillers, lighting table, texture mapper
src/engine/             the 3D unit: points and meshes, faces, objects, globals (engine3d.js re-exports)
src/effects.js          blur, fire, averaging, wobble, plasma, palette ramps
src/picture.js, pcx.js, font.js, asc.js, text3d.js, letters.js, tables.js, vesa.js, vu.js
src/parts/              one file per part
src/screen.js, textscreen.js   what the monitor shows, graphics and text mode
assets/soundtrack.ogg   the recording's audio
assets/vga8x16.bin      the VGA ROM font, for the text screen
docs/disassembly/       the notes the port was written from
tools/re/               the disassembly, emulation and capture tools
tools/poster.mjs        renders docs/poster.png
```

The soundtrack is the recording's audio, concatenated over the video mode switches and encoded:

```bash
ffmpeg -f s16le -ar 48000 -ac 2 -i soundtrack.s16 -c:a libopus -b:a 128k assets/soundtrack.ogg
```
