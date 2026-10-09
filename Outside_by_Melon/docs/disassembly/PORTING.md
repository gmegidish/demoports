# From the program to the port

## Structure

Each C module of the original is one file in `src/parts/`, with its load, start, tick and render functions (the addresses are in comments). The hand-written asm the parts share is in `src/machine.js` (tunnel, overlays, wipes, palettes), `src/engine3d.js` (transform, lighting, Gouraud triangle, the star, the object batches) and `src/mesh.js` (the room). Tables and 3D objects are read from the unpacked program at their own addresses; the trig tables get the 0x80 subtracted that 0x429b1 subtracts at start-up.

## Time

- **Ticks.** MIDAS calls 0x10060 once per vertical retrace, 70.086 times a second, and it runs the current part's tick. In the recording (DOSBox, mode 13h at 70.086 Hz, one video frame per retrace), frame n is shown after tick n.
- **Before the title.** The timer is installed before the end of loading, and the part index is 0 in BSS, so the title's tick runs 16 times before the title's start function. The title tunnel's position is not reset by start: the port runs those 16 ticks.
- **Renders.** The main loop renders as fast as the machine allows. Some state advances per render, not per tick: the credits' logo wipes and the star's light, the text parts' wipes, the closing texts. The port gives each part the number of renders per tick measured in the recording (`RENDERS_PER_TICK` in `src/demo.js`): credits 0.5, text 0.406 (0.426 while the second text is wiped out), room 0.5, closing texts 0.5 (that render waits for the retrace and misses the next one), the rest 1. The part switches then fall within a tick of the recording's.
- **Display lag.** In the recording, a slow render reaches the screen two to four ticks after it started, possibly torn, while the palette it sets is visible at once. The port shows each render at once. Frames of the recording are therefore matched against port frames a few ticks earlier (`test/original.test.js`).

## Music

No part reads the music position. The soundtrack is an openmpt render of `DATA/BEAST_4.XM` (four passes). Aligned with the audio of a recording made with a Gravis UltraSound: recording time = 1.000834 x soundtrack time + 2.092 s, and the title started 2.040 s into that recording (from the white flash at its tick 761). So the music starts 3.6 ticks after the title, and a soundtrack second is 70.086 x 1.000834 ticks: MIDAS plays the module 0.08% slower than openmpt.

## Recording

DOSBox Staging, `machine = svga_s3`, `cpu_cycles = 200000`, dynamic core. The Sound Blaster 16 run is silent (its audio track is all zero) and is the frame reference; the Gravis UltraSound run (`ULTRASND=240,3,3,5,5`, `OUTSIDE.CFG` written by hand) gave the music timing.
