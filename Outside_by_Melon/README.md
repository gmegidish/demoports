# Outside — in a browser

**▶ [Watch it in your browser](https://gmegidish.github.io/demoports/Outside_by_Melon/)** · press **F** for fullscreen

*Outside* is a PC demo by Melon Dezign from 1997, "made at The Gathering 97" as it says itself. Two and a half minutes of pigs: a melon-headed pig over a tunnel, a spinning star under the OUTSIDE logo, two rotozoomed layers behind a pig in sunglasses, turning 3D signs, a pig sitting in a turning room, a pig flying over a 3D landscape, and the closing texts, over a tracked module.

This repository rebuilds it in a browser from the original files: `OUTSIDE.EXE` and the `DATA` folder. The program is unpacked in the browser, its tables and 3D objects are read from it, and its parts run as they ran under DOS: a tick per vertical retrace, 70 a second, and the renders in between. The picture is software-rendered into a 320x200 frame buffer and put on screen through the 6-bit palette by a 2D canvas. No WebGL, no libraries.

There is no source code for Outside. The program was unpacked, disassembled and read.

The whole port was written by [Claude Code](https://claude.com/claude-code): unpacking, disassembling, reading it in slices, recording the original in an emulator to compare against, porting, and this README.

![Sixteen moments of the demo, rendered by the port](docs/poster.png)

*Sixteen moments, in order. Rendered headless by `tools/poster.mjs`: no browser, no screenshots.*

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

Add `#t=60` to the URL to start 60 s in, `#hud` to show the clock, `#nosound` to run on the wall clock without the soundtrack.

```bash
npm test                                   # 6 tests
node tools/shot.mjs /tmp/outside 1000 4100 # the frames after timer ticks 1000 and 4100, as PNG
node tools/poster.mjs                      # renders docs/poster.png
```

## Credits

*Outside*, Melon Dezign, 1997. The demo's credits name Adept, Joachim and Jason. The music is `BEAST_4.XM`. All graphics and music belong to their authors.

The port, the tools and this README were written by [Claude Code](https://claude.com/claude-code).

## What is in the files

- **`OUTSIDE.EXE`** is the PMODE/W 1.33 DOS extender followed by the program in PMODE/W's own format, PMW1: a Watcom C program whose two objects, code and data, and their fixups are compressed with the same LZ coder the extender uses on itself. The C modules are named by their assertions: `title.C`, `credits.C`, `pigpan.C`, `text.C`, `roomc.C`, `logo.C`, `landscape.C`, `tunnelc.C`. The 3D engines, the tunnel, the rotozoomer and the blitters are hand-written assembly, linked into the data object, and so are the 3D objects: a star, two "melon" signs, a room, a terrain and a pig.
- **`DATA`** holds the pictures as Deluxe Paint PBM files, four tunnels as a 64000-entry texture-coordinate map (`.MAP`) and a shade map (`.SHD`) each, and the module, played by the MIDAS Sound System 0.6.1.
- **One clock.** MIDAS calls the program once per vertical retrace, and that call advances the current part. The main loop draws the current part as often as it can, and copies the frame to the screen without waiting for the retrace. The parts switch each other from inside their renders.

## The parts

Times are from the start of the demo.

| Time | Content |
|---|---|
| 0:00 | A tunnel fades in; the melon pig flashes in on white |
| 0:17 | Tunnel, star, the OUTSIDE logo wiped in and out, ADEPT, JOACHIM, JASON |
| 0:38 | The pig in sunglasses over two rotozoomed layers |
| 0:45 | "MADE AT THE GATHERING 97", two turning 3D signs over a tunnel |
| 0:55 | The pig sitting in a turning room |
| 1:07 | "LOOK OUT FOR THE NINJA 3(D)" |
| 1:24 | The pigs in the oval |
| 1:31 | Clouds, a 3D landscape and a flying pig |
| 1:42 | "MACK AND WALT", "CALL US TO GET IT BACK!", "THE END" |
| 2:25 | The last picture; in the original it stays until Esc, here it stays while the music loops |

## How it was read

1. Run the PMODE/W stub's own decompression in Unicorn, a CPU emulator, find its PMW1 loader and port it to JavaScript (`src/pmw1.js`), so the browser unpacks `OUTSIDE.EXE` itself.
2. Disassemble the unpacked program by recursive descent, following jump tables and code pointers (`tools/re/odis.py`).
3. Record the original. DOSBox Staging, 320x200 at 70 Hz, exact colours. A run with a Sound Blaster 16 was silent and is the picture reference; a second, with a Gravis UltraSound, has the music.
4. Read the program in four slices, written down as pseudo-code in `docs/disassembly/`. Each reader checked the reading against frames of the recording; the star engine was also run in Unicorn against the reading.
5. Port: each C module becomes a part with its load, start, tick and render; the assembly becomes `src/engine3d.js`, `src/mesh.js` and the helpers in `src/machine.js`.
6. Compare with the recording and set, for each part, how many renders per tick the original's main loop made.

## What is verified, and what is not

Verified:

- **Unpacking:** both objects unpack to the sizes in the PMW1 header, with their fixups (`test/pmw1.test.js`).
- **Against the original running:** the title, the room, the pigs, the closing texts and "THE END" are pixel for pixel the recorded frames (`test/original.test.js`); the parts start within a tick of the recording's.
- **Whole demo:** two and a half minutes run in about a second and a half, headless.

Not the same as the recording, and why:

- **Render speed.** The main loop never waits for the retrace, so the wipes and the star's light, which advance per render, depend on the machine's speed. The port gives each part the renders per tick measured in the recording.
- **Display lag.** The recording shows a slow render a few ticks after it began, sometimes torn, while its palette is visible at once. The port shows every render at once, so in the tunnel parts its frames are a little ahead of the recording's.
- **Music.** The soundtrack is an openmpt render of the module, timed against a recording of MIDAS on an emulated Gravis UltraSound; MIDAS plays it 0.08% slower, and the port's clock follows.
- **Seeking** backwards replays the demo from the start, because the parts keep state from frame to frame.

## Layout

```
index.html              the page
src/main.js             fetches the files and the soundtrack; runs the demo on the soundtrack's clock
src/pmw1.js             the PMW1 loader and decompressor
src/lbm.js              Deluxe Paint PBM pictures
src/machine.js          memory image, frame buffer, DAC, tunnel, overlays, wipes, palettes
src/demo.js             the timer tick, the renders per tick, the part switches
src/parts/              title, credits, pigpan, text, room, logo, landscape
src/engine3d.js         transform, lighting, Gouraud triangle, the star, the object batches
src/mesh.js             the room's textured mesh
src/tables.js           the sine tables
src/screen.js           what the monitor shows
assets/soundtrack.ogg   the module, rendered by openmpt
docs/disassembly/       the notes the port was written from
tools/re/               the unpacking and disassembly tools
tools/poster.mjs        renders docs/poster.png
```
