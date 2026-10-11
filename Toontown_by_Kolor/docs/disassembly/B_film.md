# B: parts 5, 10 and 13 (the grid parts)

The grid and the triangle fillers are in `B_mesh.md`.

## Part 5, 0x103808: the Mickey film (`src/parts/film.js`, `mickeyFilm`)

Data: the film `[0x15c9ac]` (PCX 0x52825, 256x1280 = five 256x256 frames, palette 0x15c9b0), the dissolve mask
`[0x16dee8]` (PCX 0xe3202, 256x256), the shade table at 0x14c6a4.

### 0x102e40, at load (`buildTunnelTable`, called from `tables.js buildTables102e40`)

malloc(0x3f000) into `[0x16f700]`:

- +0: per pixel (x = col - 160, y = row - 100) two bytes: angle = trunc(float32(atan2(y, x)) * 255 / pi), distance =
  trunc(sin(d / 6666) * 255 + d / 140), d = x^2 + y^2 (low bytes of the ints). Column 160 (x = 0) takes the angle
  (atan2(y, 1) + atan2(y, -1)) / 2, and at the end of each row its distance byte is replaced by the mean of its two
  neighbours' (`(b[159] + b[161]) >> 1`).
- +0x1f400: per pixel trunc(255 - d / 140).
- +0x2ee00: the texture (film frame 0, copied at the part's start); +0x3ee00 / +0x3ef00: two 256-byte tables the
  part refills every frame: trunc(sin(i * pi / 255) * 100) for i from `[esp+0x11c]` / `[esp+0x120]`.

### The tunnel (0x103b33)

Reads the table backwards: for c = 0xf9fe down to 2 step 2, pixels (2k, 2k+1) = tex[(hi + T2[s]) << 8 | (lo + T1[s])]
for the words at c and c - 1, both with the shade byte s at c. The picture is upside down; the buffer's last two
pixels are never written.

### The loop

Locals: `[esp+0x110]` wobble = trunc(sin((tick & 255) * pi / 128) * 112), `[0x114]` tick, `[0x11c]`/`[0x120]` tunnel
wave phases (+2, +3 per retrace, from 0 and 10), `[0x124]` row phase, `[0x144]` dissolve step (reset when the row
> 0x3e), `[0x140]` the texture, `ebp` the grid depth (0x174). Grid z = SIN[wobble + 4 col] + ebp + SIN[row phase +
wobble + 5 row]; s = trunc(-(z - ebp) * 0x4b4b / 65536) + 0x9c. Drawn with 0x106d1a.

1. While position <= P0 + 2 (P0 = the position at the start): project (old z), tunnel, film frame (P0: frame 1;
   P0 + 1: frame 1 dissolved into frame 2 by 0x1037a6; P0 + 2: frame 2 into 3), z and s, triangles, wait, at P0
   rows < 0x20 the palette from 0x16f400, copy. Per retrace the depth grows by 2 up to 0x4b0 once past
   (P0, row 0x30). At P0, 0x1037d2(dissolve step / 3) fades 0x16f400 (bss, black) towards the film's palette.
2. While position < P0 + 4: the same, frames 2 -> 3 and 3 -> 4, the depth shrinking by 3 down to 0x1c4; z and s
   after the copy.
3. Until the last position: a plasma from film frame 0 (byte table trunc(sin(i * pi / 128) * 30), phases
   `[0x16e0a0]` (mod 360, gives the wobble `[esp+0x12c]` = trunc(cos(a deg) * 128 + 128)) and `[0x16e0a4]`), the
   grid rising (`[esp+0x1c0]` -1 per retrace as 0x1032ac's dy).
4. Wait, all 256 colours (63, 63, 63).

Quirks: the projection uses the previous frame's z while the shade is this frame's, so the picture depends on the
render cadence (see verification). `[esp+0x12c]` is not set before the first plasma frame (stack garbage; the port
uses 0, and the recording's frames match). Unused: the 57-amplitude byte table built at the start (overwritten
before the plasma), `[esp+0x13c]` (a countdown nothing reads), the 64 KB `[esp+0x128]` block.

0x1037a6(eax = dst, edx = src, ebx = mask, ecx = threshold): dst[i] = src[i] where mask[i] <= threshold, 64 KB.
0x1037d2(eax = n): n times, every byte of 0x16f400 below 0x15c9b0's goes up by one.
0x102fd2(al = index, dl, bl, cl): one DAC colour.

## Part 10, 0x1049fe: Mickey's silhouette (`src/parts/silhouette.js`, `mickeySilhouette`)

0x1048f1(eax = table, dl/bl/cl = from RGB, stack: to R, G, B, first, last) fills RGB entries first..last from `from`
in 8.8 steps of ((to - from) * 256 + 256) / (last - first + 1). Six runs build 256 entries at 0x16ff18
(red - yellow - white-ish - yellow - red).

Setup: wait, clear the screen, palette 0x16d2c4, colour 3 = (0, 0x17, 0x39), the grid. Tables of 80 float32:
sin(i * 4.5 deg), sin(i * 7.2 deg). Loop: background `[0x16d2c0]` (PCX 0xaff29) into the buffer; z = 0x200 +
fistp16(A[col] * B[row] * amp) (round to nearest even); project; triangles with 0x1074af from `[0x16d2bc]`
(PCX 0xaec9f); wait; colour 3 = gradient[`[esp+0x2a0]`]; copy. Per retrace `[0x29c]` += 2, `[0x2a0]` += 1 (both
& 255 after); amp = trunc(cos(a * pi / 128) (stored as a double) * sin(b * pi / 128) * 300). The position is read at
the top of the loop.

## Part 13, 0x103409: the "Toons" logo swaying (`src/parts/ripple.js`, `toonSway`)

Setup: malloc a 64000-byte background; 0x1011ec (agent A's `decodeSpiralFrame`, with `[0x1719ec]` pointed at the
block for the call) decodes spiral frame 0 into it and its palette into 0x16dbe8; background bytes 0x5b / 0x5c are
replaced by the bytes at `[0x15c6a8]` + 0x10000 / + 0x10100 (the logo picture is 256x258). Wait, palette 0x15c6ac,
copy the background to the screen, the grid.

Loop: z = SIN[sway - phaseA/2 + 5 col] + 0x28c + SIN[phaseB/2 + sway + 4 row] (amplitude-200 sines);
s = trunc(-(z - 0x28c) / 3.125 + 128); project with dx = `[esp+0x24]` (0x10334a); background into the buffer;
triangles with 0x106574 from `[0x15c6a8]`; if `[0x16e09c]` > 2, pixels whose byte in `[0x15c6a4]` (PCX 0x2a22f) is
<= its low byte are cleared; wait until the retrace counter differs from the one read after the last copy (no wait
at all if the render took longer); copy; per retrace `[0x16e09c]` -= 2 while > 1, sway phase +1, phaseA -1,
phaseB +3, and `[esp+0x24]` +1 if the position is the last - 1 and the row > 0x10. sway = trunc(sin(phase * pi /
128) * 142).

## Verification (recording, `--rate 1.0085`)

The pictures depend only on the retrace counter at each copy, except where noted, so each part was compared with
the recording's freshly rendered frames, with the port copying to the screen only at those frames (a scratch
harness wrapping the part; the original renders every 4..5 retraces in the recording, the port every retrace).

- Part 5 (`--part p05_103808`, starts at frame 3913): with copies at the recording's fresh frames (plus one at
  3918, an all-black frame that cannot be seen in the recording), every fresh frame 3928..5697 is pixel-exact (all
  three loops, both dissolves, the fade-in, the plasma); 3923 differs in 13 dark pixels (4,4,4 vs 0,0,0). Rendering
  every retrace (the port's normal run) the pictures differ: the grid is projected from the previous frame's depths
  and shaded from this frame's, so the shading lags the geometry by one retrace in the port and by 4..5 in the
  original; the palette fade-in (0x1037d2 per rendered frame) also runs faster, and the depth's growth starts with the retraces passed on the first frame past (P0, row 0x30),
  so it can end up a few units apart.
- Part 10: with the part starting 2 retraces earlier than `--part` starts it (the end of part 9 in the original),
  every fresh frame 12808..14228 is pixel-exact (361 frames), with or without the cadence emulation; in a whole
  run (no `--part`) frames 13501..13529 are exact at shift 0.
- Part 13 (frames ~16011..17079): copies happen mid-frame here (the inline wait does not wait when the render took
  longer than a retrace), so the recording has torn frames. Each fresh frame matched the best port frame within
  30: up to frame ~16800 every complete frame is exact (the rest are torn frames); after the position moves the logo
  right (`[esp+0x24]` += retraces passed, only while the position condition holds) the logo is one pixel left of the
  recording's: the original added 2 retraces on the first frame of the move where the port adds 1. With that offset
  forced (+1) frames 16805, 16900, 17040 are exact.
