# C — the blue RAZOR logo and the text pages (main script 0000:010e..0180)

Port: `src/parts/razorText.js`. Recording v2 frames 2304..4618 (port offset 2303 with `FIRST_PART=razorText`),
pixel-identical; the full run (no FIRST_PART) is identical too.

All code runs with ds = 16b2 unless noted. `wait` = 0000:05a7 (next frame counter tick). 2314 waits in all.

## Main script

```
010e  call 0b62        ; 3028:0000..f9ff = 0 (the work buffer)
0111  call 0c00        ; DAC 0.. <- 16b2:1bf8, 0x2fd bytes (colour 0 = 0,0,12: the dark blue)
0114  call 0af1        ; 4d0c:3238 (0x3e80 bytes, 2 bpp) -> 3028:0000, 320x200: 0 -> 0, 1 -> 0e, 2/3 -> 0f
0117  55 x { wait; call 11ed }                 ; logo slides in from the right
0124  wait; call 1232; call 0b0a               ; wobbling logo; background rows 0..85
012d  wait; call 1232; call 0b21               ; background rows 113..199
0136  wait; call 1232; call 0b3d               ; background rows 86..112, colour 0 transparent (around the logo)
013f  cx = 0xfc: do { wait; call 0b90 (cx); call 1232 } loop   ; 252 frames, background brightens
014f  call 0c12        ; text page 1 (340 frames)
0152  call 0c3d        ; hold 230 frames, page 2
0155  call 0c3d        ; hold 230 frames, page 3
0158  a000:6a40..+0x26c0 (rows 85..115): byte &= 0x0f       ; no wait: the text around the logo goes
016b  222 x { call 1147; wait; call 1119; wait }            ; blur band across the logo
017e  call 0797        ; white bars (80 frames)
```

The 0158 loop and the 1147/1119 pair read video memory (a000) back.

## Logo (4d0c:1b18, 160x27, opaque)

- 11ed: `[1a1f] -= 4` (0x13e at start); dx = [1a1f]; if dx + 0xa0 > 0x140 then bx = 0x140 - dx (else bx is kept:
  **quirk**, the last clipped width 0x9e stays, so from x = 0xa0 on the logo's last 2 columns are not drawn).
  27 rows of bx bytes to a000:6b80 + dx, source stride 0xa0. Ends at x = 0x62.
- 1232: bx = 0x18 + [1a1d], `[1a1d] += 27`; table bytes read from **4d0c**:bx (ds is already 4d0c);
  row r goes to a000:(table[r] + 0x6b5d + [1a1f] + r*320), 0x3d words (122 bytes, the logo's left part).
  Table values are ~0x33..0x35, so x = 0x62 - 0x23 + table ≈ 0x72..0x74 (a small horizontal shiver).
- 0b90 (cx): `out 3c8, 0e` always; at cx = fa/f5/f0/eb/e6 sets colours 14, 15 to blue (0c,0d) (0d,0e) (0e,0f)
  (0e,10) (0f,11).

## Text pages (0c12, 0c3d)

Variables (16b2): 1a21, 1a23 wave phases; 1a25 frames since the page started; 1a27 colour add (0x40 at start,
toggled 0/0x40 by each 0c3d); 1a28 text pointer (16b2:1a2a at start, 342 chars = 3 pages of 6x19).

```
0c12  a000:3d40 (0x7f80 bytes = rows 49..150) -> 5cfa:0000     ; the screen without text (kept for all pages)
0c1c  a000:3d40 -> 3028:0000                                   ; "before": the screen now
0c25  3028:7f80..feff = 0
0c28  call 0d4e: 6 lines x 19 chars -> 3028:7f88 + line*0x1540 + col*16
        char c: si = 1ef8 + word[1b80 + (c - 20h)*2] (16b2, the font: 3 rows of 20 16x16 chars, stride 320;
        1b80 is the offset table built by 0000:0b72 at start)
0c2b  call 0c81: 3028:7f80+i = ((3028:7f80+i << 4) + [1a27]) xor 5cfa:i    ; "after"
0c2e  340 x { wait; call 0ca8 }
0c3d  230 x wait; [1a25] = 0; toggle [1a27]; jmp 0c1c (shares 0c12's tail and its pop ds)
```

0ca8 (the wipe): `[1a25]++`, ax = [1a21] = (+2)&7f, dx = [1a23] = (-2)&7f. Per row r = 0..101 (0d17):
ax = (ax+2)&7f, dx = (dx+6)&7f, bx = word[5b78+dx] + word[5af8+ax] + [1a25] - 0x20, clamped signed to 4..0x13f;
bx -= 4; copy 8 bytes 3028:(r*320+bx) -> a000:3d40+r*320+bx, then 4 bytes 3028:(7f80+r*320+bx) over the first 4.
Two 64-entry word sine tables at 16b2:5af8 (0..16) and 16b2:5b78 (0..8). So the edge moves right one pixel a frame
plus the waves, revealing "after" behind it.

## Blur band (1147, 1119)

Variables (16b2): 5bf8 step (0 at start), 5bfa screen offset, 5bfc width (0 = nothing to draw).

1147: step++; width = 0; if 0x43 < step < 0xdd: x = step, width = 32; if step < 0x63 then width = step - 0x43,
x = 0x63; if step > 0xbd then width = 0xdd - step. For 27 rows from a000:6b80+x, width pixels:
3028:packed = blur(p) with ds = a000 (reads the screen):

```
11b7  al = byte sum (mod 256) of the 8 neighbours; c = centre
      ah of ((al >> 2) + c*254)     ; c*254 = (c*2 << 7) - c*2
```

1119: if width: the packed rows back to a000:[5bfa], stride 320.

## White bars (0797)

DAC 4 = 3f,3f,3f; bx = 0, dx = 0x13c; 80 x { wait; 4x50 bars of colour 4 at a000:bx, 3e80+dx, 7d00+bx,
bb80+dx; bx += 4; dx -= 4 } (0x7e2: `stosw` twice per row).

## State

- Needs: the screen all 0 (0000:010b, end of part B, clears it); 16b2:1b80 offsets (0000:0b72 at start). Variables
  1a1d..1a29 and 5bf8..5bfd are untouched before this part (their image values).
- Leaves: 3028:0000.. holds the last blur band, 5cfa:0000..7f7f the text-less screen (the bubbles' data there is
  overwritten), DAC with colour 4 white; the screen all colour 4.
- The far routines 0997:0000 / 11d9:0000 are called only by 0000:10fa, which is part D's (0000:01a9), not this part.
