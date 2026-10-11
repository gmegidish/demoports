# Red — technical notes

How `RED.EXE` is built and how it drives the hardware: the compression, the memory map, the timers, the VGA
registers, and the formats of the pictures and text. Addresses are `segment:offset` in the unpacked image loaded at
segment 0, the same addresses the port and `docs/disassembly/` use. The README covers the port itself; the notes in
`docs/disassembly/` have the pseudo-code of every routine.

## The file: PKLITE 1.12

`RED.EXE` is a 192 KB MZ executable packed with PKLITE 1.12 ("PKLITE Copr. 1990-92"). The word at 1ch of the MZ
header is 310ch: version 1.12 with both the *large* and the *extra* flags set. It unpacks to 569855 bytes (0x8b1ff).

**The stub.** The MZ entry point is a small loader at load:0100. It checks that memory reaches up to
`load + 8c59h` paragraphs, moves its second half and the packed data to the top of that area, and continues there.
The `add ax, 0` in its first instructions is patched by the MZ header's only relocation: it adds the load segment,
so the check is against the end of the program, not against absolute paragraph 8c59h. An unpacker that runs the
stub without applying that relocation sees a program with no room and gets a wrong image.

**The stream** starts at load-module offset 290h (file offset 2f0h). It is an LZ77 variant:

- A 16-bit control word is read least significant bit first. A new word is loaded right after the 16th bit is used.
  Bit 0 is a literal, bit 1 a match.
- *Extra* flag: each literal byte is XORed with the number of bits left in the control word at that moment
  (16 just after a reload).
- Match length: codes read most significant bit first. Lengths 2 and 3 are direct; three tables in the stub give
  4–10, 11–15 and 16–24. The value 19h is an escape: the next byte b gives a length of 19h + b. b = feh outputs
  nothing (it renormalises the segments in the 16-bit stub), b = ffh ends the stream.
- Offset: a length-2 match has a high byte of 0; otherwise a code gives the high byte (1..0dh from a table, or a
  6-bit code ANDed with dfh for 0eh..1fh, so offsets reach 13 bits). The low byte follows as a plain byte. The copy
  is byte by byte, so overlapping matches repeat.
- After the data: the relocation table, as groups of a count and that many offsets, for segments 0, 0fffh, 1ffeh
  and so on (count 0 skips a segment, ffffh ends the table), then ss, sp, cs, ip.

There are 68 relocations, every one a segment value in the code. Entry 0000:0000, stack 2276:0100. `src/pklite.js`
decodes this in the browser and reads the four code tables out of the stub's own instructions
(`mov reg8, cs:[bx + table]`), so nothing of the format is copied by hand.

## Memory map

| Segment | Contents |
|---|---|
| 0000 | Code: the main script 0000:0000..0276, about 70 routines, the timer interrupt 0278, and the unrolled ball renderer 0000:1280..996c |
| 0997, 11d9 | Two unrolled routines that draw the snowball scroller (far-called from 0000:10fa) |
| 16b2 | The data segment: frame counter, palettes, sine and bounce tables, fonts, the scroller text, the end screen |
| 2287 | The credits: the two credit textures, the zoom table, a 320x200 picture, and a 320x32 work texture |
| 3028 | A 64000-byte off-screen buffer, reused by every part |
| 4018 | The RED part's palette and pictures (wall bar, pillar, pedestal, logo) |
| 4d0c, 5cfa | Bubble animation frames, the bubble logo, the blue RAZOR logo, its 2-bit background, the tile for the wipe |
| 6c1f | The kid, 166x200 |
| 743a | The 640x480 RAZOR logo, four planes |
| 824a | The module "wizardry" by T.D.K, 4 channels, 14 orders, 9 patterns |
| 87ba | Mat's replay routine (GUS, SB, SB Pro), called far at 87ba:0580 with a function number in `ah` |

The demo is a single program: no overlays, no files read, no EMS or XMS. It needs about 590 KB of conventional
memory, which the NFO asks for.

## Timers

**The frame clock.** The demo does not use the BIOS 18.2 Hz tick. At start (0000:02b7) it measures one frame:

1. Wait for the start of a vertical retrace (port 3dah bit 3), and for its end.
2. Load PIT channel 0 in mode 0 (one-shot, control word 30h) with ffffh.
3. Wait for the next retrace start and read the count back: `elapsed = ffffh - count`.
4. Keep `elapsed * 98 / 100` at 16b2:0202: 98% of a frame in PIT ticks.

It then installs its own IRQ 0 handler (0000:0278) with `int 21h ah=25h`, after saving the old vector with
`ah=35h`. The handler:

1. Busy-waits inside the interrupt for the vertical retrace to start.
2. Re-arms the one-shot with the 98% count.
3. Increments the frame counter at 16b2:0200, and sends the end of interrupt.

So the interrupt fires just before each retrace, waits for it, and counts exactly one frame per retrace: 70.09 Hz in
mode 13h. Every effect waits on that counter (0000:05a7 spins until it differs from the value it saw last). The
`in al, dx` runs from port 300h between the PIT writes are I/O delays.

Before the 640x480 ending, 0000:0365 puts the BIOS vector back and reprograms channel 0 in mode 3 (control word
36h) with count 0, the BIOS's 65536 (18.2 Hz). From then on the ending polls 3dah itself (0000:05be): wait while
bit 3 is set, then wait until it is set again.

**The music clock.** The Ultrasound replay keeps its own time with the card's two timers and its own IRQ (it hooks
the GUS IRQ vector, not IRQ 0, so the demo's timer takes nothing from it). For 125 BPM it divides 7a12h (31250) by
the tempo, giving 250 units of 80 µs = 20 ms per tick. It loads timer 2 (320 µs units) with 250 / 4 = 62 periods
and timer 1 (80 µs units) with the remainder of 2. In its interrupt it alternates: timer 2 expires and starts timer
1 for the remainder, timer 1 expires and the music ticks. That alternation is what DOSBox Staging gets wrong: the
recorded song plays 2.1 times too fast. The port's soundtrack is the module rendered at its real tempo instead (see
the README).

The demo never asks the player where the song is. Picture and music run side by side; they only meet at the end,
when 0000:04b6 lowers the volume (function 28h) from 100h by 2 every retrace, 64 times, before function 0bh stops
the music.

## VGA registers

The demo uses two graphics modes, both set through the BIOS (`int 10h`), and the text mode it exits to. It does not
tweak the CRTC: no mode X, no page flipping, no split screen, no pel panning.

**Mode 13h, 320x200x256, 70.09 Hz** (0:00 to 1:42). Everything is drawn into A000:0000 linearly, often from the
3028 off-screen buffer. The only registers the parts write are the DAC's:

| Port | Use |
|---|---|
| 3c8h | DAC write index: 0 before a full palette, or one colour (the bubbles' colour 1, the blue logo's colours 14 and 15, the credits' colour 1, the bars' colour 4) |
| 3c9h | DAC data, 6 bits per component; whole palettes go out with `rep outsb` of 300h bytes |
| 3dah | Input status: bit 3 (vertical retrace) for the timer and the frame measurement |

Every fade is the same idea: a 768-byte working copy (16b2:139d) moves one step per frame toward a target palette,
one 6-bit unit per component, and is sent whole to the DAC.

**Mode 12h, 640x480x16, 59.94 Hz** (1:42 to 1:57). Planar, four bit planes at A000:

| Port | Use |
|---|---|
| 3c4h index 2 | Sequencer map mask: which planes a write reaches. Each picture is copied plane by plane: mask 1, 2, 4, 8 |
| 3c0h | Attribute controller: palette registers 0..15 set to 0..15 (identity), each preceded by an `in 3dah` to reset the index/data flip-flop, then index 20h to turn the screen back on |
| 3c8h / 3c9h | The 16 colours. The fades walk a 256-entry table: colour c takes entry `si/3 + 16c`, and a step moves si by one entry |
| 3dah | The retrace poll |

**Mode 3, 80x25 text, 70.09 Hz.** The end screen is written into B800:0000 as character/attribute pairs.

## Pictures and text formats

**Bubble animation: two-colour run lengths** (4d0c, 5cfa; drawn by 0000:05cf). Each frame is a stream of words
that fills 64000 pixels. Bit 15 is the colour (0 or 1), bits 0..14 the run length. The run is written with
`rep stosw`, plus one `stosb` for an odd length. A run of 0 still writes one pixel, because of the `sar cx, 1 / ja`
test. A zero word after a frame means the frames continue in the other segment. 91 frames, shown every second
retrace.

**Plain pictures: raw 8-bit chunky.** The bubble logo (303x85 at 4d0c:9a3c), the RED part's pieces at 4018, the
blue RAZOR logo (160x27 at 4d0c:1b18), the kid (166x200 at 6c1f:0000) and the credits picture (2287:6c04) are raw
bytes, one per pixel, copied row by row with `rep movsw`.

**The blue RAZOR background: 2 bits per pixel** (4d0c:3238, 3e80h bytes, unpacked by 0000:0af1). Values map to
colours 0, 0eh, 0fh, 0fh.

**Fonts: 16x16 and 15x16 glyphs in a 320-wide sheet.** The text pages and the scroller cut their characters out of
pictures stored like the screen (320 bytes per row): 3 rows of 20 glyphs. 0000:0b72 builds the table of 60 glyph
offsets at 16b2:1b80 at start.

**The glass ball: a renderer compiled to code** (0000:1280..996c). 3140 blocks of 11 bytes, all the same:

```
8a 84 ss ss      mov al, [si + source]       ; a background pixel inside the ball's 72x72 box
04 bb            add al, band                ; 20h..e0h: one of the ball's seven palette bands
26 88 85 dd dd   mov es:[di + dest], al
```

Each ball pixel is a refracted background pixel shifted into the ball's colour band. The ball never changes shape:
only its box moves, and the code is run again every frame. The port reads the blocks out of the code and refuses
any other instruction.

**The snowball scroller: the path compiled to code** (0997:0000, 11d9:0000). The scroller keeps its text in the
3028 buffer, one character every 15 frames. Two far routines of straight-line code put the buffer on the screen
along the snowball's curved path: `lodsb`, `add si, n` to skip, `mov es:[addr], al` for each screen pixel. Pixels
that may be empty (94h) go through `cmp al, 94h / jne` and show the kid's own pixel (`mov bl, fs:[di + n]`) instead.
Near the end of the path, `add al, bl` shifts the text into darker colour bands. The two routines write about 7200
pixels a frame. As with the ball, the port decodes them at load time.

**The credit tiles: a texture zoomed with 8.8 fixed point** (2287). Each credit is stored as 32-byte columns
(2287:2c04 and 4c04). Every frame, 0000:0f0b samples 320 columns from it into a 320x32 texture with a step of `zoom / 256`, and 0000:0eb2 repeats the result over 112 rows
with the same step vertically. The zoom follows a 512-entry word table at 2287:2804.

**The 640x480 logos: four bit planes** (743a). The RAZOR logo is 180 lines of 80 bytes per plane, copied with the
map mask set to one plane at a time. Plane 0 is first filled with ffh, so the background is colour 1, lilac. The
triangle (16b2:0209) is 80x54 pixels in the same layout.

**The end screen: TheDraw crunched text** (16b2:0004, 1fah bytes, decoded by 0000:03bc):

| Byte | Meaning |
|---|---|
| 20h..ffh | A character, with the current attribute |
| 00h..0fh | Set the foreground colour |
| 10h..17h | Set the background colour |
| 18h | Next line |
| 19h n | n + 1 spaces |
| 1ah n c | n + 1 copies of c |
| 1bh | Toggle blink |

The demo never moves the BIOS cursor, so after it exits COMMAND.COM prints `C:\>` on the second row.

## What it needs

A 386 or better: the code uses `rep movsd` and the `fs` segment register, the replay `pushad`. A VGA, and a
Gravis Ultrasound, Sound Blaster or Sound Blaster Pro for music; `RED.EXE -S` runs it silent. The NFO asks for a
"good" PC with a fast VGA card: the effects redraw large parts of the screen every frame, and there is no frame
skipping. On a slow machine the whole demo just runs slower.
