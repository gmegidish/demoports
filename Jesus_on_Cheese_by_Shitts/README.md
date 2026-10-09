# Jesus on Cheese — in a browser

**▶ [Watch it in your browser](https://gmegidish.github.io/demoports/Jesus_on_Cheese_by_Shitts/)** · press **F** for fullscreen

*Jesus on Cheese* is a demo by S.H.I.T.T.S., the "Swansea Hardcore Idiotic Techno Termination Source", released for the Amiga 500 in 1993. A parody of LSD's *Jesus on E's*: one disk, a "boring wait while it loads", three minutes of strobing pictures, oscilloscopes and moiré rings over a sampled remix of Rob Acid's *Happy Answer*, then an end scroller over a wobbling starfield and The Shamen.

This repository rebuilds it in a browser from the original disk image. The disk is loaded into 512 KB of chip RAM exactly where the boot block put it, and the demo's 68000 code is ported routine by routine to JavaScript that works on that memory. A small model of the chipset turns memory into a picture (copper, bitplanes, blitter, 12-bit palette), and a model of Paula turns the demo's own ProTracker replay routines into sound. A 2D canvas and an AudioWorklet put it out. No WebGL, no libraries, no CPU emulator, no pre-rendered music.

There is no source code for Jesus on Cheese. Everything below was read out of the disk.

The whole port was written by [Claude Code](https://claude.com/claude-code): reading the disk, disassembling the three parts, running their code under an emulator to compare against, porting, measuring a capture of the original, and this README.

![Twenty moments of the demo, rendered by the port](docs/poster.png)

*Twenty moments, in order. Rendered headless by `tools/poster.mjs`: no browser, no screenshots.*

## Run

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

The sound needs an AudioWorklet, which browsers only allow over https or from `localhost`. Opened from another machine's address on the LAN, the demo runs silent.

| Key | Action |
|---|---|
| Click to start | Start |
| Click on the picture | The left mouse button |
| **F** | Toggle fullscreen |
| ← / → | Seek 5 s |

The left mouse button does what it did on the Amiga: it ends the intro early, it is the only way out of the main part, and after the end scroller's last page it starts the text again.

Add `#t=130` to the URL to start 130 s in, `#hud` to show the clock, `#nosound` to run without sound.

```bash
npm test                                   # 45 tests
node tools/frame.mjs out.png 17.5 80 300   # render three moments to PNG, no browser
node tools/render-audio.mjs out.wav 60     # the first minute of sound, to WAV
node tools/poster.mjs                      # renders docs/poster.png
```

## Credits

*Jesus on Cheese* by S.H.I.T.T.S., Amiga 500, 1993. From the demo's own end scroller:

| Role | Authors |
|---|---|
| Code | Goz |
| Graphics in the main part, drawn and scanned | Kaleb |
| Main music | "Happy Answer" by Rob Acid, sampled and remixed by Goz ("in about 80K") |
| End music | "In the Bag" by The Shamen, sampled and remixed by Goz |
| Font | Goz |

All graphics and music belong to their authors. This repository re-hosts the original disk image untouched.

The port, the tools and this README: written by [Claude Code](https://claude.com/claude-code).

---

# How it was made, and how it was unmade

## One file, 901,120 bytes

`assets/jesus-on-cheese.adf` is an 880 KB floppy image: 80 cylinders × 2 sides × 11 sectors × 512 bytes, `$1600` bytes a track. It has no filesystem. Its boot block starts with `DOS\0` and a checksum, and the text after the code says what the disk is:

```
JESUS ON CHEESE is a S.H.I.T.T.S. production, © 1993
S.H.I.T.T.S. are the Swansea Hardcore Idiotic Techno Termination Source
```

Kickstart reads the boot block into any free memory and jumps to it with A1 pointing at a `trackdisk.device` IORequest. The boot block copies itself, from its byte `$2e`, to `$7f000`, and from there on talks to the drive only through that IORequest (`CMD_READ`, then `TD_MOTOR` off):

```
read $800 bytes from disk $400 to $7f400      three messages, 16 lines of 40 bytes each, one bitplane
for each part:
    read the part to $a500
    motor off
    fade the message out (red, $100 a step)
    jsr $a500  with A0 = the boot block's copper list
    show the next message: the plane pointer += $280
```

| Disk | Bytes | Tracks | Part |
|---|---|---|---|
| `$c00` | `$19600` | 19 | The intro: "PREPARE YOURSELF / FOR / A BORING WAIT WHILE IT LOADS" |
| `$1a200` | `$72000` | 83 | The main part |
| `$8c200` | `$44a00` | 50 | The end part |

All three load to the same address, each over the one before, in 512 KB of chip RAM: the main part alone runs from `$a500` to `$7c500`, right up to the boot block. Nothing is crunched. Each part carries its own copy of the ProTracker replay routine and its own module. The end part never returns; if it did, the boot block would flash the screen yellow and blue forever.

The messages say what the loading is like: "WHY - ARE WE WAI-TING, WE ARE SUF-FO-CA-TING .... While you're waiting, turn off the lights or something", and before the end part, "Oh dear. There's more. Don't worry, it's the end bit. Pull up a beanbag and get ready to "chill out", "man"."

The port (`src/demo.js`, `src/disk.js`) copies the same bytes to the same addresses at the same moments, and waits as long as the drive did: 14.7 frames per track touched, measured in the capture (1218 frames for the main part's 83 tracks, 743 for the end part's 50).

## Every part is a copper interrupt

All three parts are built the same way. The entry saves the old level-3 vector at `$6c`, installs its own, turns off every interrupt but `COPER` (`INTENA $0060` off, `$8010` on), turns sprites off and blitter-nasty on, and points `COP1LC` at its copper list. The copper list ends with a `WAIT` for line 300 and a `MOVE #$8010,INTREQ`: the copper itself raises the interrupt, once a frame, at a fixed raster line. There is no vertical-blank interrupt anywhere in the demo.

The main loop then does nothing but `btst #6,$bfe001`, the left mouse button on CIA-A. All the work, music included, happens in the interrupt, which ends by jumping to the old vector so the system's handler still runs.

The port turns each part into a generator. One `yield` is one frame: the code before it is what the interrupt did, and the next render shows the result, as the copper did on the real machine.

```js
export function* part1(m, bootCopper) {
  w32(m, SAVED_COPPER, bootCopper);
  showPicture(m, PREPARE_YOURSELF);
  if (isMusicPresent(m)) {
    mtInit(m, PART1_REPLAYER);
  }
  custom32(m, COP1LC, COPPER);
  // $a56e: until frame $310, or the left button.
  for (;;) {
    yield* nextFrame(m);
    interrupt(m);
    if (r16(m, FRAME_COUNTER) === LAST_FRAME || isLeftButtonDown(m)) {
      break;
    }
  }
  if (isMusicPresent(m)) {
    mtEnd(m, PART1_REPLAYER);
  }
  custom32(m, COP1LC, r32(m, SAVED_COPPER));
}
```

## The intro

| Address | What |
|---|---|
| `$a500` | entry and main loop |
| `$a5ae` | the interrupt |
| `$a6f4` | frame counter |
| `$a6f6` | copper list |
| `$a756`, `$ae36`, `$b516` | three pictures, 40 × 44 bytes, one bitplane |
| `$bbf6` | ProTracker: `mt_init`, `mt_end`, `mt_music` |
| `$cdc0` | the module, "introbit" |

Each picture is shown twice: both bitplanes point at the same bytes, and `BPLCON1 = $0010` delays the second one by a pixel. Pixel x gets colour `bit(x) + 2·bit(x−1)`: 3 inside a letter, 1 on its first pixel, 2 just past its last. Colour 3 is the letter, and the interrupt derives the fringes from it every frame:

```
colour 2 = c3 >> 1
colour 1 = c3 | (c3 >> 1) << 4 | (c3 >> 1) << 8        at rest: $00f, $007, $77f
```

The band is lines `$96` to `$c1`, opened and closed by two `WAIT`s that switch `BPLCON0` between no planes and two. Before frame `$1c0` the moduli are −40: the first line of the picture, which is empty, repeats all the way down, and the music plays to a black screen. At `$1c0`, `$230`, `$2a0` and `$300` the interrupt changes the picture and sets colours 0 and 3 to `$fff`; they fade back by subtracting `$111` and `$110` a frame. The part returns at frame `$310`, 15.7 s after it started, or on the left button.

## The main part is a script

| Address | What |
|---|---|
| `$a500` | entry, main loop |
| `$a6be` | effect table, 12 entries |
| `$a6ee` / `$a6f0` | script position / frames left in the entry |
| `$a6f2` | the script, 1248 entries |
| `$ce48` | the interrupt: the dispatcher |
| `$ceca` – `$d8fc` | the effects |
| `$d956` | the common tail |
| `$65640` | ProTracker, part 2's variant |
| `$66822` | the module, "happy-answer" |

Every effect's copper list ends with `WAIT $ffdd`, `WAIT $2c01`, `COPJMP2`, and `COP2LC` is a two-word list that writes `INTREQ`. The interrupt at line 300 is a dispatcher:

```
if the left button is down: return             no music either: the replayer freezes while it is held
if frames left = 0:
    entry = script[pos]; if entry.frames = 0: pos = 0      the script loops
    effect = table[entry.effect]
    routine = effect.routine; COP1LC = effect.copper
    A0 = entry's parameter words, A1 = effect's parameters, first frame = 1
frames left -= 1
push routine; rts
```

Each routine ends by jumping to `$d956`, which busy-waits for `VHPOSR` to read line `$e8` of the next frame, clears the first-frame flag and calls `mt_music`. An entry's parameter words follow it in the script, and the routine steps `$a6ee` over them on its first frame: 2 bytes for a colour, 4 for a picture's two colours, 8 for a scope.

The script is 9280 frames, 185.6 s, cut to the music: whole runs of one-frame entries flash a picture through four colour ramps and a black frame, five times a second. Then it starts again, for as long as nobody presses the button. The port presses it for you five frames before the script would restart, unless you clicked first.

| # | Routine | Copper | What |
|---|---|---|---|
| 0 | `$ceca` | `$d97e` | A plain colour: the parameter goes into `COLOR00`, no bitplanes |
| 1 | `$cee6` | `$d99e` | The rings |
| 2–6, 10, 11 | `$d076` | `$21e7a` | Seven scanned pictures: a man with an "A" mask, a face with a dust mask, a rainbow, a dog, Jesus on a cross of cheese, the "JESUS ON CHEESE" logo |
| 7 | `$d956` | `$4de2e` | The tail alone. The script never uses it |
| 8 | `$d1c6` | `$4de92` | Oscilloscope 1: a white line over a checkerboard |
| 9 | `$d4e2` | `$56436` | Oscilloscope 2: mirrored bars over a fractal |

### The rings

One picture of concentric circles, 640 × 512 pixels in two bitplanes `$a000` bytes apart, 80 bytes a row. `BPLCON0` is `$4200`, four planes, not dual playfield: the odd planes (1, 3) show the picture at one position and the even planes (2, 4) the same picture at another, and where the two sets of circles overlap the 16 colours make the moiré. Each position comes from two word tables of 87 to 151 entries, ending in a negative word, stepped every frame:

```
BPLxPT  = $de7a + y·80 + ((x >> 3) & ~1)
scroll  = (15 − x) & 15
BPLCON1 = scroll(odd) | scroll(even) << 4
```

A counter picks one of four 16-colour banks every frame, which makes the rings pulse.

### The pictures, and the six colours that make it in time

The picture routine reads width, height and address from the effect table and centres the picture with the display window and data fetch, all in 16-bit word arithmetic:

```
side = (320 − width) >> 1           DIWSTRT = ($2c + top) << 8 | ($81 + side)
top  = (256 − height) >> 1          DIWSTOP = ($2b − top) << 8 | ($c1 − side)
fetch = (320 − width) >> 2          DDFSTRT = $38 + fetch,  DDFSTOP = $d0 − fetch
```

The palette is a ramp between two colours A and B from the script. Each 4-bit component is computed with `muls` and `divs #15`, which round towards zero:

```
colour i = A + (B − A) · (15 − i) / 15        colour 0 = B, colour 15 = A
```

On a picture's first frame only colours 0 to 5 reach the screen; colours 6 to 15 still show the previous picture's ramp. The interrupt starts at line 300 and the copper reads the colour moves at the top of the next frame, twelve lines or about 5450 CPU cycles later. Three multiply-divide pairs per colour cost about 860 cycles, so the CPU writes the sixth colour just as the copper reads it. The capture shows it plainly at 77.2 s: a red background behind a face that is still white. The count was fitted on 223 first frames of the capture; six fits best, and 0 or 16 fit far worse. The port writes the remaining ten colours at the start of the next interrupt, and its memory still matches the original's at every frame boundary.

### The oscilloscopes do not listen to the sound

Both scopes read two of the replayer's four channel structures, channels 1 and 4: sample start, length, loop length, period and volume. Then they play the samples themselves, in their heads:

```
step = N / period                           N = $83a (scope 1) or $8be (scope 2); divu.w
if the channel's "new sample" word is set: position = 0, clear the word
for each point:
    sample = position past the end ? 0 : byte(start + position)
    level  = (s1 · vol1 + s2 · vol2) asr 7
    position += step
afterwards: position = saved + $117a7 / period    3,546,895 / 50: what Paula plays in a frame
```

The line is what the samples would look like, not what Paula played: a looping sample restarts at 0, not at its loop start. Which is why the music cannot be a recording. The port runs the demo's replay routine, with its variables in chip RAM at the addresses the scopes read, and the same replay routine drives the emulated Paula.

**Scope 1** draws 44 blitter lines through 43 points, x = 8 to 344, y = `$80 − level`, into a 352-pixel window over a static checkerboard plane, and flashes colours 1 and 3 from a table. Its line routine is the usual octant-table one with one difference: it loads `BLTBMOD = 2·sd`, `BLTAPTL = 2·sd − ld`, `BLTAMOD = 2·(sd − ld)`, half the textbook `4·sd` terms. The blitter has no bit 0 in its pointers and moduli, so the error term runs at half scale with its low bit dropped, and the lines come out subtly different from a correct Bresenham. The port's blitter drops bit 0 the same way, in `blitterWrite`.

**Scope 2** plots its points with the CPU (`bset`) into a fifth bitplane: 32 rows, 8 lines apart, a dot at `$9f − |level|` and its mirror at `320 − x`, and a dot halfway to the previous row's. A descending inclusive-fill blit (`BLTCON1 = $000a`) turns every pair into a bar. Plane 5 selects colours 16–31, so the bars have their own palette over the four-plane fractal: every frame colours 1–15 rotate one way and 17–31 the other. A script parameter turns the fractal upside down with moduli of −80 and pointers at its last line; another makes the dots 4 lines thick. With silence both dots are in the middle, and the screen is one dotted vertical line.

## The end part

| Address | What |
|---|---|
| `$a500` | entry: clears `$50000`–`$644ff`, builds two tables, never returns (`bra.b *`) |
| `$a58c` | the interrupt |
| `$a9a0` | copper list |
| `$aa22` | perspective table, 2048 words |
| `$bc22` | 145 stars, x y z words |
| `$cfaa`, `$d1aa` | the bend tables |
| `$db14` | ProTracker, the intro's code moved up by `$1f1e` |
| `$100e2` | the scroll text |
| `$112ee` | the module, "in-the-bag" |

`BPLCON0 = $4600`: four planes, dual playfield. Playfield 1, planes 1 and 3, is the starfield; playfield 2, planes 2 and 4, is the scroller, in front through `BPLCON2 = $40`.

**The stars** are double-buffered between `$50000` and `$55000`. Each frame the blitter clears the back buffer (`BLTSIZE $8014`: 512 lines of 20 words, both planes in one blit), and every star moves through a 512 × 512 × 1024 box that wraps:

```
x = ((x + vx) & $1ff) − $100            vx, vy, vz from speed tables
z = (z + vz) & $3ff
x += bend[(x + phase) & $1fe]           the same for y; z through its own table
s = persp[z] = $fffe00 / (z + $200)     1.15 fixed point
screen x = high word of (x · s) << 1, + $a0
```

The bend is what the scroller calls the jelly: "DO YOU LIKE MY JELLY STARS? BELIEVE IT OR NOT, THEY WERE DESIGNED TO DO THAT, IT WAS NOT A MISTAKE IN A ROTATION ROUTINE!!" The depth before the bend picks the colour: plane 1 alone when z is under `$190`, plane 2 alone up to `$2f7`, both further away.

**The scroller** moves by moving the bitplane pointers: the copper's playfield-2 pointers go down 40 bytes a frame. The planes are 272 lines with a copy of themselves after, and each text row of 20 characters is blitted twice, 16 lines above the window and just below it, so the window can move down forever and wrap. A character is 64 bytes: 16 lines of one word in each of two planes. Characters are blitted with `BLTCON0 $09f0`, a plain A-to-D copy, `BLTDMOD $26`.

The interrupt takes almost a whole frame: after the stars it waits for `VHPOSR` to read `$fd`, line 253 of the next frame, before it calls `mt_music` and moves the scroller. The port splits the frame at the same point, so a shown frame has the stars of the interrupt just run and the scroller of the one before.

The text is 760 rows. At the end marker the scroller stops on an empty screen and the stars carry on; the left button clears the stop flag, and the text starts again from "WELL THIS IS THE END".

## The music

All three replay routines are ProTracker 2.x's `mt_init` / `mt_music` / `mt_end`, called once a frame, speed only (`Fxx` never sets a BPM).

| | Intro | Main part | End part |
|---|---|---|---|
| `mt_music` | `$bcac` | `$656f4` | `$dbca` |
| Called at line | `$c2` | `$e8` | `$fd` |
| Channel structures | `$cc02`, `$2c` apart | `$66654`, `$30` apart | `$eb20`, `$2c` apart |
| Module | "introbit": 2 positions | "happy-answer": 29 positions, 20 patterns | "in-the-bag": 21 positions, 9 patterns |

The main part's copy is a variant: it does not clear the first long of every sample in `mt_init`, and `mt_playvoice` keeps a word at `+$2a` of each channel structure, set to 1 when the row names a sample. That word, which makes the structures `$30` bytes instead of `$2c`, is what the oscilloscopes read.

`src/replayer.js` is one implementation of both variants, parameterised by the addresses above, that keeps all its state in chip RAM. It keeps ProTracker 2.x's own bugs, because they are audible: tone portamento indexes the period table with `mulu #$4a`, a row of 37 words instead of 36; tremolo's ramp-down tests the vibrato position; `9xx` is applied twice on a row with a note; volume slide up does not clamp at `$c0` and above; 68000 word and byte arithmetic wraps where it wraps.

### Paula

The replayer's register writes go to `src/paula.js`, a model of the hardware rather than of a tracker:

- `AUDxLC`, `LEN`, `PER` and `VOL` are latches. DMA on copies `LC`/`LEN` into the channel's counters; at the end of a block they reload from the latches. That is how ProTracker loops: it writes the loop's pointer and length after starting the note.
- Each byte lasts `AUDxPER` colour clocks at 3,546,895 Hz. A new period applies from the next byte. Bytes are read from chip RAM as they play.
- Channels 0 and 3 left, 1 and 2 right, hard-panned. Each output sample is the box-filtered average of the channel over its duration.
- The A500's fixed one-pole low-pass, 360 Ω and 0.1 µF, 4.42 kHz, is always on. The "LED" filter, a 3.1 kHz Sallen-Key, is modelled, but every `mt_init` switches it off through bit 1 of `$bfe001` and no module uses `E0x`. A 5.2 Hz high-pass stands for the output's AC coupling.

Writes are time-stamped inside the frame. The replayer runs at the raster line its part calls it from, and between `DMACON` off and on it spins `move.w #$118,d0 / dbra d0,*` twice, about 2822 cycles or 0.398 ms each; the port advances Paula's clock by the same amount at the same points, so notes restart as they did.

Against the capture's audio, long-term spectra over the main part: with the fixed filter the port is within 0.8 dB of the capture up to 6 kHz; without it, 4 dB too bright at 4–6 kHz and 12 dB at 11–15 kHz.

### Two threads, one demo

The sound is made in an AudioWorklet that runs its own copy of the demo with `isAudioOnly`: the parts skip their drawing, but run their interrupts and replayers exactly as on screen. The page runs a second copy and draws it. Both are deterministic, so they agree as long as they see the same clicks.

Both use one clock, the audio context's:

```
demo ms = startMs + (AudioContext.currentTime − contextTime) · 1000
```

The page draws for `currentTime − outputLatency`, the moment the speaker is playing. A click is the left button at a frame number, scheduled a few frames ahead (output latency plus 60 ms) and sent to both copies; if the worklet has already mixed past that frame, it rebuilds its copy with the new click list and catches up silently. A seek replays the demo from zero on both threads, which takes about a second for the whole demo, and is debounced so held arrow keys make one seek.

## The chipset, in 400 lines

`src/display.js` and `src/blitter.js` model only what the demo uses.

**The copper** runs from `COP1LC` every frame, line by line, until `$ffff,$fffe`. `MOVE` writes a register at its position; `WAIT` holds until the beam passes. `COPJMP2` jumps to `COP2LC`. The demo patches its copper lists like any other data, so pointers, colours and window positions arrive the way they did.

**Bitplanes** are fetched as OCS fetches them: `DDFSTRT`/`DDFSTOP` decide the bytes per line, the moduli are added at the end of each line, `BPLCON1` delays odd and even planes, `DIWSTRT`/`DIWSTOP` crop. `BPLCON0`'s dual-playfield bit splits the planes into two 8-colour playfields with `BPLCON2` deciding which is in front.

**The palette** is 32 registers of 12 bits, expanded to 24 bits by repeating each nibble (`× $11`).

**The blitter** does area mode with shifts, masks and minterms, ascending and descending, inclusive and exclusive fill, and line mode with octants, sign bit and single-dot. It is Baygon's blitter, with one change for this demo: bit 0 of every pointer and modulo is dropped on write, as the hardware drops it.

The canvas shows the standard 320×256 window at `DIWSTRT $2c81`, stretched to 4:3 like a PAL monitor.

## Checked against the original

The port's memory can be compared with the original's. For every part, the original 68000 code was run under Unicorn [2] with the custom chips hooked, for thousands of frames, and the chip RAM the code owns was compared with the port's:

| Code | Frames | Result |
|---|---|---|
| Intro interrupt | 784 (all) | identical |
| Main part dispatcher and effects | 9,400 (a whole pass and the restart) | identical |
| Oscilloscope 1 / 2 | 320 / 720 | identical bitplanes, copper lists, palettes |
| End part interrupt, with clicks during and after the text | 16,500 | identical |
| Replayers: the three modules | 3,000 / 11,000 / 9,000 | identical Paula writes and variables |
| Replayers: random patterns that use every effect | 4 × 3,000 | identical |

The harnesses fake what the code polls: `VHPOSR` reads the line it waits for, `DMACONR` reads "blitter idle", CIA-A reads "button up" except on the click frames. The oscilloscope harness runs its blits through a second blitter written from the Hardware Reference Manual, independent of `src/blitter.js`. The replayer runs cover 97% of `src/replayer.js`. The tests replay fixtures recorded from those runs.

The rest was compared with a 50 fps capture of the real thing [1], frame by frame. The intro's flashes, the main part's pictures, flashes and scopes, and the end part's pages and stars land on the same frames as in the capture. In the main part, port frame = capture frame + 102 for the whole script.

| Event | Capture (s) | Port (s) |
|---|---|---|
| Intro starts | 4.54 | 6.52 |
| Intro's first flash | 13.50 | 15.49 |
| Main part starts | 45.18 | 47.22 |
| Main part script restarts | 230.78 | 232.82 (the port clicks here) |
| End part starts | 249.87 | 248.44 (the viewer of the capture clicked 3.5 s later) |

## How the port works

1. Load the disk into a 512 KB `Uint8Array` the way the boot block does.
2. Port each part's code to a generator that reads and writes that array, and yields once a frame, where the copper interrupt comes.
3. Blits, copper lists, palette and Paula writes go through the chipset model, which keeps the same registers.
4. Drive the generator from the audio clock. Seeking replays it from zero.
5. At every shown frame, run the copper list, fetch the bitplanes, look the pixels up in the palette, and `putImageData` the result onto a 320×256 canvas.
6. Compare against the original: by running its code under Unicorn where possible, by the capture elsewhere.

```
index.html                 the demo page
src/machine.js             chip RAM, the frame clock, the mouse button
src/display.js             the copper, bitplane fetch, the palette, one frame to pixels
src/blitter.js             area and line mode
src/disk.js                the boot block's reads
src/demo.js                the boot block: messages, loading, the three parts; and the runner
src/parts/part1.js         the intro
src/parts/part2.js         the main part: the script, the pictures, the rings
src/parts/part2-scopes.js  the two oscilloscopes
src/parts/part3.js         the end part
src/replayer.js            ProTracker 2.x, both variants
src/paula.js               Paula and the A500's output filters
src/audio-worklet.js       the audio thread: its own copy of the demo
src/screen.js              the canvas
src/main.js                boot, clock, seeking, clicks
tools/frame.mjs            renders moments of the whole demo, to PNG
tools/part.mjs             renders one part on its own
tools/render-audio.mjs     renders the sound, to WAV
tools/poster.mjs           renders docs/poster.png
tools/re/                  disassembler, and the Unicorn harnesses that ran the original code
docs/disassembly/          reading notes, one file per part, and the replayer
test/                      node --test
```

## What is not verified

- Loading times are a measurement of one capture's drive, 14.7 frames a track. The intro's load happened before the capture started and is the same rate applied to its 19 tracks.
- The main part has no end. The port's click after one pass of the script is a choice; on the Amiga it was the viewer's.
- The six colours that make it to the screen on a picture's first frame are fitted to the capture, not counted in cycles.
- The capture runs at exactly 50 frames a second, the port at PAL's 49.97 (312 lines × 227.5 colour clocks): the music is 0.06% lower and slower than the capture's, which is the capture's error, not the port's.
- The canvas shows the standard 320×256 window. The capture shows a little of the border around it.
- Paula is modelled per byte: the hardware's two-sample DMA start delay is not.

## Going further

- [1] [Capture of the original](https://www.youtube.com/watch?v=AkMmfW3aeKM), 50 fps, the reference for every timing in this port
- [2] [Unicorn](https://www.unicorn-engine.org), which ran the original code for the comparisons
- [3] [Capstone](https://www.capstone-engine.org), which read the code
- `docs/disassembly/`: every address, register value and quirk behind the sections above
