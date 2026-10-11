# A: the intro (p01..p04) and the outro (p12, p14)

Port: `src/parts/spiral.js` (shared), `src/parts/intro.js` (p01..p04), `src/parts/outro.js` (p12, p14).

## Shared routines

- **0x1011ec** `decodeSpiralFrame(picture=eax, palette=ebx)`: PCX RLE decoder into the buffer at `[0x1719ec]`.
  Skips the 128-byte header, 200 lines, a line ends after the token that reaches 320 pixels (runs are not cut, the
  output is one stream). Then the palette: `edi` points one byte past the data (over the 0x0c marker), 768 bytes
  `>> 2` to `ebx` (always 0x1719f0). `edx` is ignored (callers pass 0xa0000 or 0xb00).
- **0x10ed88** (and the identical **0x10ea2c**): one DAC colour: index al, red dl, green bl, blue cl.
- The spiral: 39 PCX blocks loaded by main (`src/loader.js`), pointers at 0x16def4 + 4 * i, i = 0..38
  ([0x16df8c] = block 38). Their palettes are decoded each time but only sent to the DAC at the start of a part.
- `[0x12bd80]`: main's 0x2ee00-byte work buffer (malloc at 0x100317, `src/loader.js` in the port).

## p01 0x10ed9f (eax = 2)

malloc(0x10000) -> [0x1719ec]; decode block 38; palette 0x1719f0 to the DAC. Nothing is copied to the screen yet
(it is black from the mode switch). 11 times: wait 12 retraces, colour 0 = (0, 0, i), i = 0..10.
Then the loop (0x10ee60): until position >= 2: wait 4 retraces, copy buffer to 0xa0000, frame--, decode (frame goes
38 -> 37 ... -> 0 and stays at 0). The animation steps per loop pass, not per retrace count.

## p02 0x10ecc1 (eax = 4)

Palette 0x16dbe8; every retrace copy [0x16dbe4] (the Kolor picture) to the screen. It computes
`cos((counter % 360) * pi / 180)` into a local that is never used.

## p03 0x10e813 (eax = 8), helpers 0x10e6b1, 0x10e701

Name pointers [0x16d5c4..0x16d5d4] copied to 0x170fd8 (5 names), palette 0x16d5dc.
Per frame: background [0x16d5d8] -> work buffer; 0x10e701(a, b, amplitude, name); two bars of colour 0x5c,
6x50 pixels at (0, 75) and (314, 75); wait one retrace; copy to screen; read the status. The name index goes up
when the position changes, and from 2 to 3 when row > 0x20 (the third name is shown for half a position).
`a` and `b` (always equal) go up by the retraces passed; amplitude =
`trunc(double(22 + 10 cos((a & 255) pi / 128)) - 10 sin((b & 255) pi / 128))`.

- 0x10e6b1(amp): `T[i] = trunc(sin(i * pi / 128) * amp)`, i = 0..255, at 0x170fec (dword).
- 0x10e701: pixel (x, y) = name[clamp(y*320 + x + 320*trunc(5 sin((a+b+y) pi / 60)) + T[(a+y+x)&255] +
  T[(b+x)&255], 0, 0xf9ff)], not drawn if 0x5c. `a+b+y` is loaded with `fild qword` (unsigned).

## p04 0x10eaa0 (eax = 0xb), helpers 0x10ea43, 0x10ea68, sprite 0x100a79

Fade palette 0x1713ec cleared (bytes 0..0x2fe; the last byte is not), sent; the picture [0x16d8dc] copied to the
screen. 63 times: 0x10ea68 (wait 3 retraces, each byte of 0x1713ec + 1 while below 0x16d8e0), send it, colour 0x5c =
(0, 0, blue), angle + 1, blue = `trunc(12 - 7 cos(angle pi / 180) + 8)`.
Then 0x100a79 draws the 320x200 sprite [0x16dbe0] (0 transparent) into the picture itself.
Loop until position 0xb: wait; if (position >= 0xa and row > 0x2d) or position == 0xb send palette 0x16d8e0,
else colour 0x5c = (0, 0, blue); copy the picture; angle += retraces passed (counted from before the fade-in),
mod 360; read status; in the fade-out condition 0x10ea43 lowers each byte of 0x16d8e0 by one.

Precision: at angle 90 the x87 gives `cos(pi_d / 2) = +6e-17`, so `12 - 7cos + 8` is just below 20 in 80 bits:
blue 19; in doubles it rounds to 20. `truncDifference` (TwoSum) gives the exact truncation; the argument is
computed as `(angle / 180) * pi` so that angles 90 and 270 are exact.

## p12 0x10eeea (eax = 0x2d)

As p01 without the fade: block 38 decoded, palette sent, then every 4 retraces copy and step backwards to frame 0.

## p14 0x10efc2 (eax = 0x33, edx = 0)

Block 0 decoded, wait a retrace, palette, copy. Loop: ends when position >= 0x33 or (position == 0x32 and
row >= edx = 0), i.e. at the start of position 0x32. Wait 4 retraces, copy, frame++ up to 38; frames 1..37 are
decoded, at 38 the buffer is filled with colour 0x5b (and stays).
