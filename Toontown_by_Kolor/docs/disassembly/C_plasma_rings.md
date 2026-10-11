# C: parts 6 and 7 (the plasma and the rings)

## Part 6, 0x100cd5: the plasma with Mickey (`src/parts/plasma.js`, `plasma`)

Data: the plasma picture `[0x12c094]` (PCX 0x00000, 256x256, palette 0x12c098), Mickey and the "Die Super Maus"
sign `[0x12bd90]` (PCX 0xe0ff7, 320x200, palette 0x12bd94), the black-out mask `[0x15c6a4]` (PCX 0x2a22f,
320x200). Globals: `[0x16e0a0]` angle (degrees), `[0x16e0a4]` offset, `[0x16e09c]` black-out level, the 256-byte sine
table at 0x16df90. Part 5 (0x103808) zeroes the angle and the offset at its start and counts both up by one per
retrace (its own plasma), so part 6 starts with them at part 5's retrace count (355 in the recording); the angle
is reduced mod 360.

### The plasma (0x100cff and 0x100e12, the same code twice)

T = 0x16df90 (bytes, indices mod 256), e = `[0x16e0a4]`, phase = `[esp+0x14]`:

    a = T[x]; b = T[y - e + a]; c = T[x + e]
    hi = T[c - (b + x + e)] * 255
    lo = T[e + y - T[phase - y + x]]
    pixel = picture[lo + hi]          (a row stride of 255, not 256)

### Setup

1. 0x100cff: one plasma render before the table exists (all zero: a uniform colour, picture[0]), with the phase
   `[esp+0x14]` not written yet.
2. 0x100bff: T[i] = byte(trunc(sin(i * pi / 128) * 30)) (raw fsin). The plasma picture += 0x3c, its palette bytes
   0..0x59 copied to colour 60 (0x12c14c); Mickey += 0x7f (so his transparent 0x80 becomes 0xff), his 128 colours
   to colour 127 (0x12c215). Wait, DAC from 0x12c098, the buffer to the screen, colour 0 = black (0x100be8).
3. `[0x16e094]` = 0x3c, `[0x16e098]` = 0x28 (never read).

### The loop

Plasma; 0x100aa2 (copy, 0xff transparent) of Mickey's rows 75..199 at (0, 75); when position >= last - 1 and
row >= 0x25 every pixel whose mask byte <= low byte of `[0x16e09c]` becomes 0. Wait, copy. Per retrace passed:
angle++, offset++, and when position >= last - 1, row > 0x25 (the row read before the render) and level < 0xfe:
level += 2. Then angle %= 360, phase = trunc(cos(angle * pi / 180) * 128 + 128) (0x114e62, 0x114e44).

Quirks:

- The phase of the first loop picture is stale: `[esp+0x14]` was last written by part 5, whose frame used the
  same stack slot: 0x1045b6 stores the frame buffer address `[0x12bd80]` there for each triangle. Only its low byte
  matters; 0x50 (the original's buffer address) is what recording frame 5705 shows (`STALE_PHASE`).
- At 300 degrees the x87 gets cos = 0.49999999999999982 and 191.99999999999998, which a double rounds to 192:
  the original's phase is 191 (checked for all 360 angles against an 80-bit model; it is the only one).
- The level test reads the row once per frame, so the original (rendering every few retraces) raises the level
  for all the retraces of the frame in which the row passes 0x25.

## Part 7, 0x108c6a: the rings (`src/parts/rings.js`, `rings`)

Data: `[0x16cfb4]` (PCX 0xa029b, 256x512): the rings' colour picture (256x256, indexed [A][B]) and at +0x10000 the
"Kolor" texture; `[0x16cfb8]` the ball (PCX 0xab233, 320x50); palette 0x16cfbc (both).

### 0x108a58, at load (`buildRingTables`, called from `tables.js buildTables108a58`)

Two malloc(0x3e800) into `[0x170704]` and `[0x170708]`: 640x400 bytes each, for y from -199 to 200 and x from -319
to 320 (row-major): byte(fistp_word(sin((x^2 + y^2) / S) * 127)) + 0x7f with S = 12000 (A) and 16000 (B) (raw fsin,
round to nearest even; JS doubles give the same bytes for every distance).

### Setup (0x108c83)

Four word tables of 256 entries, angle a = i * pi / 128:
`0x17070c` trunc(sin(a) * 256), `0x17090c` trunc(cos(f32(a)) * 256), `0x170b0c` trunc(sin(f32(a) + Q) * 307.2),
`0x170d0c` trunc(cos(f32(a) + Q) * 307.2), f32 = the float32 copy at `[esp+0xc]`, Q = the double at 0x127644
(pi/2 three ulps low). The palette, then the loop with t = 0 (the retraces since the start) and P0 = the position.

### The loop

1. Centres (fistp word, nearest even): x1 = round(sin(t / 12.124682523) * 160) + 160, y1 = round(sin(t / 42.235734)
   * 100) + 100, x2 = round(sin(t / 47.23549) * 160) + 160, y2 = round(sin(t / 84.34347437) * 100) + 100.
2. 0x108b21: pixel (x, y) = picture[A[y1 + y][x1 + x] << 8 | B[y2 + y][x2 + x]].
3. The first 0x1cc0 bytes (23 rows) = 1; 0x100a79 (copy, 0 transparent) of the ball at (0, 150), 320x50.
4. Read the play status; if position > P0 the flash (below).
5. Wait, copy; t += retraces passed; end when position >= the part's last position.

### The flash (0x108e64, 0x108bac)

rand() is Watcom's (0x114f3f: state = state * 0x41c64e6d + 0x3039, return (state >> 16) & 0x7fff; the state at
0x129bec starts at 1 and this part is its first user). zoom = 0x94 + 20 - rand() % 40, k = rand() % 16 -
rand() % 16 (three calls per frame). Steps (8.8 fixed point, 16-bit): u per column = cos[k] * zoom >> 8, v per
column = sin[k] * zoom >> 8, u per row = cosShifted[k] * zoom >> 8, v per row = sinShifted[k] * zoom >> 8, all
from the dword below the entry, `sar 16`; start u = 0x8000 - 160 du/dx - 100 du/dy (likewise v): the texture
centre at the screen centre. Texel = texture[(v & 0xff00) + (signed(u) >> 8)] (u >= 0x8000 reads up to 128 bytes
before the texture), colour 0x85 transparent. The row start values are stored back to 0x170f14/0x170f16.

Negative k reads each table's predecessor; for the sine table that is the 30 bytes below 0x17070c, which hold heap
pointers in the original: `[0x1706f8]`, `[0x1706fc]` (two 0x40 blocks from the startup initializer 0x107b5c, an
entry of Watcom's init table at 0x12ba50, used by part 9) and the ring tables `[0x170704]`, `[0x170708]`. Their
values, fitted from frames with k = -1..-4 and -7..-10: 0x1700a0, 0x1700e8, 0x4db0f8, 0x51a0fc. The port's heap is
elsewhere. With these values the port matched the DOSBox recording pixel for pixel, but every negative k draws a
stretched smear (du/dx comes from the end of the sine table, a few units, on any machine). The hardware capture
(youtube.com/watch?v=jcFiRrdicj0, same EXE as scene.org) never shows one: every flash is the logo, upright or
turned counter-clockwise. 86Box (Pentium MMX 200, real FPU) shows the smear too, so it is the demo's bug; why the YouTube capture lacks it
is unknown (scene.org and Hornet hold only this build). The port uses
|k|, which keeps the random sequence and looks like the hardware.

The original renders a frame every 4 retraces in this part (in the recording) and draws a new flash per frame; the
port renders every retrace but draws a new flash every 1072/270 retraces (`RETRACES_PER_FLASH`).
