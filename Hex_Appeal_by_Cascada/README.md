# Hex Appeal — in a browser

**▶ [Watch it in your browser](https://gmegidish.github.io/demoports/Hex_Appeal_by_Cascada/)** · press **F** for fullscreen

*Hex Appeal* is a demo by Cascada, released at Assembly '93 on 2 September 1993. "Thought we were gone forever?": five and a half minutes of blurred purple text, a chrome logo panned across a virtual screen, flat-shaded cubes, a burning Cascada logo, IFS fractals, morphing 3D dots, a grey picture, a texture-mapped cube over a starfield, and credits scrolling up through slime. The music is "libertine" by Zodiak, a six-channel ProTracker module.

This repository rebuilds it in a browser from the original file, `appeal.exe`. The browser splits it into its seven programs, loads each part's image into a megabyte of real-mode memory at the addresses the part was written for, and runs the part's code against that memory, one vertical retrace at a time, as the music system's timer interrupt did. Video goes through a VGA modelled at register level, so the parts' own `out` instructions set the modes, the 60 Hz retimings, the page flipping and the pel panning. The picture reaches the screen through the 6-bit palette and a 2D canvas. No WebGL, no libraries.

There is no source code for Hex Appeal. The program was disassembled and read.

The whole port was written by [Claude Code](https://claude.com/claude-code): splitting, disassembling, reading the parts in slices, recording the original in an emulator to compare against, porting, and this README.

![Twenty-four moments of the demo, rendered by the port](docs/poster.png)

*Twenty-four moments, in order. Rendered headless by `tools/poster.mjs`: no browser, no screenshots. The 320x400 and 640x400 scenes are scaled down.*

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
npm test                                         # 7 tests
node tools/shot.mjs /tmp/appeal 30 90 175 260    # render four moments to PNG, no browser
node tools/poster.mjs                            # renders docs/poster.png
```

## Credits

*Hex Appeal*, Cascada, 1993. From `appeal.doc`: design Cascada; setup Jeffe, setup graphics Mirage; intro blur Robban, intro font Delsion, logo O'Hara; stardriver, cubes, IFS and morphs Hellraiser, cube logo Delsion; Eevi picture Delsion; texture code Iceman, texture pictures O'Hara; slimy panner Iceman, slimy font and marble O'Hara; soundtrack Zodiak; music system Robban. All graphics and music belong to their authors.

The port, the tools and this README were written by [Claude Code](https://claude.com/claude-code).

## What is in the file

`appeal.exe` is seven DOS programs back to back, followed by the music:

- **The loader** puts the CPU in flat real mode, copies the six other programs into XMS and runs them one after the other, each as a normal DOS program whose exit returns to the loader. It also holds Robban's music system: a MOD player and software mixer that the parts call through `int 0x80`.
- **The setup screen**, a Turbo Pascal program in 640x480, where you pick the sound card with the mouse. The port starts after it.
- **Five parts**, written in assembly. Everything they show is inside them, uncompressed: fonts, pictures, textures and tables. None of them reads the file.
- **The tail**: "libertine", 32 orders at speed 8, and three ColoRIX pictures, probably for the setup screen.

**One clock.** The music system's timer interrupt is programmed slightly faster than the screen's refresh. Each time it fires, it waits for the vertical retrace, counts a frame, calls the current part's callback, and mixes one frame of audio. The parts' main loops wait on that frame counter, so the whole demo runs on the retrace. Every video mode is retimed to 528 lines, which is 59.60 Hz; the 640x400 picture uses 527 lines, 59.71 Hz. The music itself runs on real time. Two parts follow it: the intro's texts and logo start on song positions, and so does the cube's exit.

## The parts

Times are from the start of the demo.

| Time | Part | Content |
|---|---|---|
| 0:00 | Intro (exe2) | "Thought we were gone forever?", "In the summer of 1993", "We strike with another production", "Cascada demo section", "presents": typed in a wobbling font, faded through the colour indices |
| 0:40 | | The HEX APPEAL logo slides in on a 640-pixel virtual screen, with the APPEAL sprite bouncing below it |
| 0:50 | Cubes, IFS and morphs (exe3), 320x400 | Seven spinning cubes fly in over stars, then the Cascada logo catches fire |
| 0:55 | | IFS fractals blending into each other: Sierpinski triangles, a fern, a tree |
| 1:05 | | 400 dots morphing between 3D shapes |
| 2:12 | Eevi (exe4), 640x400 | Delsion's picture, faded in and out |
| 2:21 | Cube (exe5) | A texture-mapped cube flies in over a starfield: dragon, eye, symbol and a face scrolling "HEX APPEAL BY CASCADA" |
| 3:11 | | The cube flies away |
| 3:22 | Slime (exe6) | The marble checkerboard, warped, with the end text and credits scrolling up through it, then the fade-out |
| 5:34 | | Back to DOS |

## The cube that never leaves

In DOSBox the cube part never ends: the stars go on forever. This is a bug in the demo.

The cube part's per-frame callback asks the music system for the song position, and should end the part once the song is in its 20th order (order index + 1 ≥ 0x14) and at least row 52 (row + 1 ≥ 0x34). Between the two calls it loads its data segment into `ax` (0403:2882), which overwrites the row number in `al`. The compare at 0403:287e therefore tests the low byte of the segment the part was loaded at. If that byte is 0x38 or more, the part ends on cue; otherwise the test can never succeed. Where DOS loads the part depends on what else is in memory, so on the authors' machines it ended on cue, and in DOSBox it does not.

The port ends the part on cue: the reference recording was made with that compare patched to 0, so the part exits as soon as the order condition holds.

## How it was read

1. Split `appeal.exe` into its programs (`tools/re/split.py`) and disassemble each by recursive descent, adding the entry points the code reaches only through the music system's callbacks and interrupt vectors (`tools/re/hdis.py`).
2. Record the original in DOSBox Staging with a Sound Blaster 16. The first recordings, at 60000 cycles, were wrong: the software mixer starved the parts, the music ran 11% slow, and the intro and the slime dropped frames. The reference recording was made at 200000 cycles, where the music keeps its tempo and every part draws a frame per retrace.
3. Read the program in six slices, the loader and music system first, written down as pseudo-code in `docs/disassembly/`. Each reader checked the reading against frames of the recording; several wrote a Python model of their part that reproduced it.
4. Port: a register-level VGA, a megabyte of memory per part with the part's image at segment 0 (so its variables, tables and self-modified immediates sit at the addresses in the listings), and each part as a generator that yields when the original waits for the retrace.
5. Compare every part with the recording frame by frame, and fit what the code cannot tell: the song's offset against the soundtrack, and how many retraces the loader takes to copy each part into place.

## How the port works

**Not an emulator.** No x86 is interpreted. Each part was rewritten in JavaScript routine by routine from the listings, but it keeps the original's data where the original kept it. A part gets a fresh 1 MB `Uint8Array` with its load module copied in at segment 0. Because its relocations then add 0, every address in `docs/disassembly/` is the address in the port: `180d:0f37` is `m.mem[0x180d0 + 0xf37]`. Tables, fonts, pictures and textures are read from the image in place. Variables, self-modified immediates and DOS allocations (exe5's buffer at 2c11, exe6's 218 KB slime board, reached with 32-bit offsets under the loader's unreal mode) stay at their original addresses, and arithmetic is masked to 16 bits where the original's registers were. The memory is thrown away when a part exits. The VGA and the music position carry over to the next part, as they did.

**One generator per part.** The original's main loops spin on the music system's frame counter. In the port each part is a generator, and `yield` stands for that wait. `src/demo.js` drives them one retrace at a time:

1. latch the CRTC start address and the pel panning, as the card does at vertical retrace;
2. set the song time;
3. increment the frame counter and call the part's callback, as the timer interrupt does (`int 0x80` fn 0x1b registers it);
4. resume the part's main code until its next `yield`.

The retrace period comes from the CRTC registers the part has written: 31468.75 lines a second divided by the vertical total. That gives 59.60 Hz for 528 lines and 59.71 Hz for exe4's 527. So the demo's clock drifts against 60 Hz the way the original did. Between parts the loader spends a measured number of retraces copying the next program out of XMS, during which the screen keeps showing what the last part left.

**A VGA at register level.** `src/vga.js` holds the four 64 KB planes, the latches, and the sequencer, graphics, CRTC, attribute and DAC registers. The parts' `out dx,al`/`out dx,ax` become `vga.out8`/`vga.out16` with the same ports and values, and memory writes at A000 go through `vga.write` with its map mask, bit mask, write modes 0 and 1, and chain-4. The parts never ask for a resolution: the screen is worked out from the registers on every browser frame (`src/screen.js`). Rows per screen come from the vertical display end and the maximum scan line, the row stride from the offset register, and the start address, line compare and pel panning from the latched values. 256-colour modes read plane x&3. exe4's 16-colour mode combines one bit from each plane through the attribute palette. The 6-bit DAC is scaled to 8 bits the way DOSBox does it, so frames can be compared byte for byte with the recording. That model covers every trick in the demo:

| Part | What the registers do |
|---|---|
| exe2 | mode 13h, then chain-4 off: the picture stays, and the logo slides on a 640-pixel virtual screen through the start address and pel panning |
| exe3 | CRTC 9 = 0x40: 320x400 unchained, two pages flipped with the start address |
| exe4 | mode 12h retimed to 400 lines; the picture fades through the DAC |
| exe5, exe6 | mode 13h at 60 Hz; exe6 writes only the DAC |

Chain-4 addresses are stored the way DOSBox stores them (CPU address a goes to plane a&3, offset a>>2). That is how exe2's mode 13h picture stays in place when it switches chain-4 off, and how exe3 inherits it.

**Music as a clock, not a synthesiser.** The port does not play the MOD. The soundtrack is the recording's audio, and the page runs the demo up to the audio element's `currentTime`, spending at most 12 ms per browser frame catching up. The song position the parts ask for (fn 0x0a order, fn 0x0c row) is computed from soundtrack time with the recording's tempo, 10.225 s per order, and loops from order 21 after order 31 as the module's B15 does. Three corrections are fitted from the recording:
- the song starts 10 ms behind the soundtrack;
- it falls 50 ms further behind from exe3 on, because of the silence that pads each capture file's audio;
- it freezes 23 ms for each pair of fn 0x1d calls a part makes around a mode set.

**Seeking.** A seek forward runs the retraces in between, and the whole demo takes about a second. A seek back starts again from the first part, because the parts keep their state from frame to frame.

**Size.** The engine is about 650 lines (VGA, screen, memory, loader, music position) and the five parts about 3000. The page loads `appeal.exe` (the original file, unmodified) and a 3.3 MB Opus soundtrack.

## What is verified, and what is not

Verified:

- **Against the original running, every frame:** the port was rendered at the middle of each of the recording's 19932 frames and compared byte for byte. 19923 are identical; the other nine are explained below. `test/original.test.js` checks one moment in each part, in a single run of the whole demo.

  | Recording | Part | Identical frames |
  |---|---|---|
  | video 1 | intro | 3004 of 3006 |
  | video 2 | cubes, IFS, morphs | 4871 of 4872 |
  | video 3 | Eevi | 512 of 515 |
  | video 4 | cube and slime | 11536 of 11539 |

- **Timeline:** the intro's eight music cues and the cube's two fire on the retrace they fire on in the recording.
- **Whole demo:** runs from the first frame to the return to DOS in about a second, headless.

Not the same as the recording, and why:

- **Nine frames.** Eight are the first or last frames of a recording file: a mode switch between two parts, or the program's exit, caught by DOSBox halfway down the screen. The ninth is the frame where the Cascada logo is first drawn: DOSBox shows the fire colours one fade step early.
- **Random numbers.** The IFS part seeds its generator from the DOS clock. The port uses the seed of the recorded run, 0x6d.
- **Fitted timing.** The song's offset against the soundtrack (−10 ms, and 50 ms more from the second recording file on) and the loader's copy time per part (0, 3 and 3 retraces before exe3, exe4 and exe5) are measured in the recording, not derived from the code.
- **Music.** The soundtrack is the audio of the recording: the demo's own player and mixer on an emulated Sound Blaster 16. In the recording a pattern lasts 10.225 s instead of 10.24 s; the port follows the recording.
- **Seeking** backwards replays the demo from the start, because the parts keep state from frame to frame.

## Layout

```
index.html              the page
src/main.js             fetches appeal.exe and the soundtrack; runs the demo on the soundtrack's clock
src/appeal.js           splits appeal.exe into its seven programs
src/demo.js             the loader: the parts in order, the retrace-paced frame loop, song time
src/machine.js          a part's real-mode memory and the music system's int 0x80 services
src/music.js            the song position at a given time
src/vga.js              the VGA at register level: planes, latches, sequencer, CRTC, attribute controller, DAC
src/screen.js           what the monitor shows, from the registers
src/parts/exe2.js       the intro
src/parts/exe3*.js      cubes, fire logo, IFS and morphs
src/parts/exe4.js       the Eevi picture
src/parts/exe5*.js      the textured cube and its texture mapper
src/parts/exe6.js       the slime
assets/soundtrack.ogg   the recording's audio
docs/disassembly/       the notes the port was written from
tools/re/               the splitting and disassembly tools
tools/shot.mjs, poster.mjs   render moments and docs/poster.png headless
```
