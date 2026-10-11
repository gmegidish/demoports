# G: part 11, 0x10629f — "faked highcolor" (Minnie over rays)

Port: `src/parts/fakemode.js` (`fakeMode`, `buildRaysTables`); registered as `p11_10629f` (runs to position 0x2c).

## Data

| Address | What |
|---|---|
| `[0x12bd80]` | main's work buffer, 0x2ee00 bytes (0x100317): here a 320x200 truecolour buffer, 3 bytes per pixel in the TGA's B, G, R order, 0x3c0 bytes per line |
| `[0x16deec]` | the 24-bit TGA (DAT 0xf2dcc, 320x200, turned top-down by 0x1000bd): Minnie and the "Kolor super demo!" sign |
| `[0x170608]` | the table 0x106024 builds at load time, 0x3f400 bytes (below) |
| `[0x1702f8]` | the screen address (0xa0000 in FakeMode, the VESA linear frame buffer otherwise) |
| `[0x1702fc]` | the "show the buffer" routine: 0x1053fc (FakeMode) or 0x1053e3 (VESA) |
| `[0x12bd8c]` | truecolour flag (the -24 switch). 0 here: FakeMode |
| `0x170300..0x1705ff` | 0x10560b: three 256-byte lookups `v >> 2`, `(v >> 2) + 0x40`, `(v >> 2) + 0x80`. Built but not read: 0x105f62 does the arithmetic inline |

### 0x106024: the rays' tables (`buildTables106024` -> `buildRaysTables`)

- `+0x00000`, 200 x 320 x 2 bytes, screen order: per pixel (x = column - 0x9f, y = row - 0x64)
  - angle byte = low byte of trunc(float32(atan2(y, x)) * 127.5 / pi) (constants 0x127578, 0x127598). Column 0x9f
    (x = 0) uses (atan2(y, 1) + atan2(y, -1)) * 0.5 (0x127590) instead.
  - distance byte = trunc((4 y² + x²) * 150 / 47000) (0x127580, 0x127588, 0x1275a0) — squared distance, no sqrt.
- `+0x1f400`, 256 x 256 "fall-off": row r, column d = `255 - trunc(d * 255 / r)` for d < r, else 0.
- `+0x2f400`, 256 x 256 from TOONTOWN.DAT 0x42505 + 0x320 (an Alchemy "mhwanh" image: 0x20 header + 0x300
  palette skipped), row r scaled by `* r >> 8`: the ray length at amplitude r and angle column.

0x114f89 (atan2) is `fxch; fpatan`: atan2(st0 at call, st1 at call). JS doubles give the same bytes (the
distance quotient is never within rounding of an integer; the angle goes through a float32 first).

## The part, 0x10629f

1. 0x10630e: `[0x12bd8c]` = 0 -> 0x105d7a (FakeMode). (= 1: 0x1052c7 VBE2 info, 0x10552e find a 320x200x24 linear mode
   via 0x10536d / 0x1053af / 0x1053d6 / 0x1050e5 DPMI physical mapping; not ported. 0x104e00 is the fatal-error
   exit, 0x104e1d / 0x104e70 / 0x104f59 / 0x1051ff / 0x10522b DPMI real-mode call helpers.)
2. `[esp+0xc] = [0x12bd88]` (half-retrace counter), 0x100064, `[0x170614] = 0` (`m.setSyncs(0)`).
3. Loop:
   - 0x106329 / 0x106387 / 0x1063e6: three unrolled copies, one per buffer byte (component) c = 0, 1, 2 with
     (phase, amplitude) = ([esp+0x10], [esp+4]), ([esp+0x14], [esp+0x20]), ([esp+8], [esp+0x24]):
     `len = RAYLEN[amp][(angle + (phase >> 1)) & 255]`, `value = FALLOFF[len][distance]`. The loop runs ecx
     0x7cff..1 while edi goes up and writes the pair swapped, so buffer pixel p = table pixel 0xf9ff - p (rotated
     180°); buffer pixels 0xf9fe, 0xf9ff are never written (line 199, which 0x105f62 never shows).
   - 0x100064, then 0x1061ff(x 0, y 0x53, w 0x140, h 0x75, src TGA, dst buffer): copy a rectangle at the same
     place, pixel fc fc fc transparent.
   - 0x100056 wait retrace, `call [0x1702fc]` with the buffer (0x1053fc -> 0x105f62).
   - n = half retraces passed; n times (0x1064b1): phase0 += 1, amp0 += d0, flip d0 if amp0 <= 0x32 or >= 0xfd;
     same for component 1 (step in ebp); phase2 += 2, then **check** amp2 and flip d2, then amp2 += d2 (order
     differs). Start: phases 0, 0x3c, 0x5a; amplitudes 0x3c, 0x96, 0xfa; steps -1, +1, -1.
   - Esc check (port 60h), loop while arg > `[0x12bd70]`.
4. 0x10653c: free table and TGA, **int 10h ax=13h**: the part itself puts the VGA back to mode 13h (BIOS palette,
   cleared memory) for the next part.

### 0x105d7a: FakeMode

int 10h ax=13h; sequencer 4: chain-4 off (`& 0xf7 | 4`); map mask 0xf; clear (rep stosw 0xffff words, then 0xfa00
bytes); CRTC 14h `&= ~0x40` (dword mode off), CRTC 17h `|= 0x40` (byte mode), CRTC 9 `&= 0x70` (max scan line 0, no
double scan). Result: 400 displayed lines of 80 bytes (offset 0x28), 320 pixels, plane = x & 3. DAC via 0x1055f4
(al index, dl R, bl G, cl B): 0..63 red ramp, 64..127 green ramp, 128..195 blue with values 0x40..0x83 (6-bit DAC:
0..63, then 0..3 in 192..195 — unused, pixels never exceed 0xbf).

### 0x105f62: show the buffer (FakeMode)

For each plane p (map mask 1, 2, 4, 8): a toggle `^= 0x50` added to edi gives a start of 0x50 (one scanline lower)
for planes 0 and 2, 0 for planes 1 and 3. 133 rows k, source line `(k * 0x180f6) >> 16` (0..198):
for 80 columns, source pixel 4 * column + p: scanline 3k byte 0 >> 2 + 0x80 (blue ramp), 3k + 1 byte 1 >> 2 + 0x40
(green), 3k + 2 byte 2 >> 2 (red). So every source line becomes three single-colour scanlines, staggered by one
scanline between neighbouring pixel columns.

screen.js / vga.js needed no change: this mode renders as 320x400 with one output line per scanline, as recorded.

## Verification (recording frames 14233..15637, `--rate 1.0085 --part p11_10629f`)

- The picture changes every 4 retraces in the recording, and each new picture shows on two frames: the first is
  torn (DOSBox draws the frame while 0x105f62 writes the planes one after the other), the second is complete.
- All 352 complete new pictures (14237, 14241, 14245, ..., 15633) are pixel-exact against port frame g - 5 and
  g - 4 (render time of the original, not modelled; the shift is constant over the whole part).
- The torn frames (14240, 14244, ..., 15636) are pixel-exact mixes of the old and the new port picture, per plane:
  plane 0 new from line ~2, plane 1 from ~60, plane 2 from ~195, plane 3 from ~302 (checked 14240, 14300, 14400,
  15000, 15520: 0 pixels outside the two pictures).
- 15637 (last 320x400 frame) is torn by the int 10h ax=13h at the end; not modelled.
- Part boundaries: port 320x400 from 14232 (recording 14233). End: port at 15656, recording at 15638 — the port
  reaches position 0x2c ~18 retraces later than the recording ended this part (music clock, not this part's code).
