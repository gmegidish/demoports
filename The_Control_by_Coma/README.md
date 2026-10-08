# The Control — in a browser

**▶ [Watch it in your browser](https://gmegidish.github.io/demoports/The_Control_by_Coma/)** · press **F** for fullscreen

*The Control* is a demo by Coma, from the PC demo competition of The Gathering 1996: "to wake up slaves chained to the system". Six minutes of a red starburst, textured 3D objects, grainy photographs and video with captions, morphing animations, and three scenes in a 400-line VGA mode that interleaves red, green and blue scanlines, over two tracked modules.

This repository rebuilds it in a browser from the original files: `CONTROL.EXE`, `DEMO.AVI` and `DEMO.FLI`. The program is unpacked in the browser, its memory laid out as the original laid it out, and its scene functions and effects run against that memory on a 30 Hz timer, as they did under DOS. The picture is software-rendered into VGA memory, mode 13h or the unchained 320x400 mode, and put on screen through the 6-bit palette by a 2D canvas. No WebGL, no libraries.

There is no source code for The Control. The program was unpacked, disassembled and read.

The whole port was written by [Claude Code](https://claude.com/claude-code): unpacking, disassembling, reading it in slices, recording the original in an emulator to compare against, porting, and this README.

![Twenty-four moments of the demo, rendered by the port](docs/poster.png)

*Twenty-four moments, in order. Rendered headless by `tools/poster.mjs`: no browser, no screenshots. In the 400-line scenes the red, green and blue lines are blended, as a CRT would show them.*

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

Add `#t=200` to the URL to start 200 s in, `#hud` to show the clock, `#nosound` to run on the wall clock without the soundtrack.

```bash
npm test                                      # 8 tests
node tools/shot.mjs /tmp/control 30 120 260   # render three moments to PNG, no browser
node tools/poster.mjs                         # renders docs/poster.png
```

## Credits

*The Control*, Coma (Community of Moral Advancement), 1996. From `COMA.NFO`: code by Verne, music by Groo, graphics by Apatia. All graphics and music belong to their authors.

The port, the tools and this README were written by [Claude Code](https://claude.com/claude-code).

## What is in the files

- **`CONTROL.EXE`** is packed with WWPACK. Unpacked, it is Tran's PMODE extender, a 16-bit stub that switches to protected mode, and one 32-bit segment of code and data, all hand-written assembly. The two music modules, S3M files called *anagnosis* and *anamnesis*, are appended to the executable and read by seeking from its end.
- **`DEMO.AVI`** and **`DEMO.FLI`** are not video files ("The .AVI and .FLI extensions are only jokes", says `README.1ST`). They are concatenations of 25 and 20 items located by offset tables inside the program: ColoRIX 256x256 textures, run-length-coded pictures, a 160x100 video, raw image planes, and "morph" animations made of a key frame and byte deltas.
- **One clock.** The PIT runs at 30 Hz. Each tick, the timer interrupt calls a scene function from a table with one entry per tick (3093 entries for the first part, 8800 for the second). The scene functions install the current effect and advance its counters with byte arithmetic, where the carry of one byte steps the next. The main loop calls the current effect as fast as the machine allows and never waits for the vertical retrace.
- **Two parts.** At tick 2684 the program stops the music, loads the second module and installs a second timer interrupt with a second table; the screen stays frozen for the second it takes.
- **Effects.** A feedback starburst, a sphere-mapped textured 3D engine with five objects, grain from five frames of noise built at start-up, a rotozoomer, crossfades through a 64x64x64 interpolation table, a bilinear 4x upscaler, captions in a proportional font, and a 160x100 video.

### The striped scenes

Three scenes switch the VGA to an unchained mode with no line doubling: 400 lines of 320 pixels. Every line of the picture becomes three scanlines, the first coloured from a palette of 64 reds, the second from 64 greens and the third from 64 blues, and a monitor blends them into a colour image.

In DOSBox these scenes are stripes of red, green and blue. The mode-setting routine writes 0 to the CRTC's maximum scan line register, then executes `out 3d3, ax` with a 6 in AL. Port 0x3d3 is not a VGA register, but DOSBox, like a CGA, mirrors it onto the CRTC data port, so the register ends up at 6: every line is repeated seven times and only the first 57 lines are shown. On the machine it was written on the write evidently did nothing. The port shows the 400 lines.

## The parts

Times are from the start of the demo.

| Time | Content |
|---|---|
| 0:00 | The starburst fades in, then "coma", "virne", "groo", "apatia" |
| 0:24.6 | A spiked star, a plant and a spider, textured, over the starburst |
| 1:04.1 | "order ?", "NO order!", "We are under control.." |
| 1:30.5 | Second part: the COMA photo, the drawing and "the CONTROL" |
| 1:43.9 | Video with captions: "I want to shout", "I want to SEE !"... |
| 1:59.0 | Animated photographs, rotozoomed text: "We see nothing..", "we are mass under systems CONTROL!", "some day" |
| 2:52.4 | The gear |
| 2:54.9 | 400-line RGB scene: three morphing pictures |
| 3:35.2 | "system divines", "nature" |
| 3:53.7 | 400-line RGB scenes, "Scream until you are FREE!", "SCREAM", "take it off" |
| 5:07.8 | The gear again, and a face |
| 5:54.1 | END |

## How it was read

1. Run the WWPACK stub in Unicorn, a CPU emulator, until it jumps to the program, and save the memory (`tools/re/unpack.py`). Then port the decompressor to JavaScript (`src/wwpack.js`), checked byte for byte against that memory, so the browser unpacks `CONTROL.EXE` itself.
2. Find the 32-bit segment from the PMODE stub and disassemble it by recursive descent, following code pointers stored in memory, loaded into registers and kept in jump tables (`tools/re/cdis.py`).
3. Record the original. DOSBox Staging, 320x200 at 70 Hz, exact colours. A first run with a Sound Blaster Pro was silent; the second, with a Gravis Ultrasound, has the music.
4. Read the program in six slices, core and timeline first, written down as pseudo-code in `docs/disassembly/`. Each reader checked the reading against frames of the recording.
5. Port: the program's 32-bit segment becomes a byte array with the start-up allocations after it in the same order, so the code's own variables, tables, pointers and self-modified immediates are used at their own addresses. Scene functions and effects are JavaScript functions keyed by their original address; the timeline tables are read from memory.
6. Compare with the recording and set, for each effect, how many passes per second the original's main loop made.

## What is verified, and what is not

Verified:

- **Unpacking:** `src/wwpack.js` produces the same 512 KB as the original stub run in an emulator (`test/wwpack.test.js`).
- **Against the original running:** at 1:30, 2:54, 5:30 and 6:18 the port's frame is pixel for pixel the recorded one, and the opening starburst differs by a few pixels (`test/original.test.js`). Every 12 s of the demo was compared with the recording: everything without grain agrees, mostly exactly; the 3D objects match exactly in every gear scene checked.
- **Whole demo:** runs from the first frame to the copyright line in about two seconds, headless.

Not the same as the recording, and why:

- **Grain.** The program builds its grain from the PIT counter, which is effectively random; the port uses a seeded generator, so its grain is the same on every run but not the recording's. The grainy scenes match in brightness and density, not pixel by pixel.
- **Loop speed.** The main loop never waits for the retrace, so effects with trails or per-pass steps depend on the machine's speed. The port charges each pass the time measured in the recording, per effect.
- **The 400-line scenes** show what the program draws, not DOSBox's stripes (see above).
- **Music.** The soundtrack is the audio of the recording: the program's own player on an emulated Gravis Ultrasound, aligned with the 30 Hz clock by construction.
- **Seeking** backwards replays the demo from the start, because effects keep state from frame to frame.

## Layout

```
index.html              the page
src/main.js             fetches the three files, the font and the soundtrack; runs the demo on the soundtrack's clock
src/wwpack.js           the WWPACK decompressor
src/machine.js          flat memory, VGA (mode 13h and 320x400 unchained), DAC, virtual time
src/demo.js             main, the two 30 Hz timer interrupts, the exit screen
src/scenes.js           the scene functions of both timelines
src/tables.js           start-up: data files, interpolation tables, noise
src/helpers.js          decay, feedback, grain, crossfade, blits, palettes
src/addresses.js        memory addresses shared by several files
src/effects/            the effects, by part (index.js maps original addresses to them)
src/engine3d.js, triangle.js   the 3D engine and its textured triangle
src/morph.js            run-length decoder, morph animations, upscaler, unchained-mode writers
src/text.js             the caption font
src/screen.js, textscreen.js   what the monitor shows
assets/soundtrack.ogg   the recording's audio
assets/vga8x16.bin      the VGA ROM font, for the exit screen
docs/disassembly/       the notes the port was written from
tools/re/               the unpacking and disassembly tools
tools/poster.mjs        renders docs/poster.png
```
