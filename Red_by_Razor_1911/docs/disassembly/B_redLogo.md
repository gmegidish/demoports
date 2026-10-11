# B — the RED logo and the glass ball (main script 0000:008a..010d)

Port: `src/parts/redLogo.js`. Recording v2 frames 806..2303 (port offset 805 with `FIRST_PART=redLogo`), pixel-identical.

All code runs with ds = 16b2 unless noted. `wait` = 0000:05a7 (next frame counter tick).

## Main script

```
008a  call 08ac                       ; DAC 0..255 <- 4018:0000 (768 bytes)
008d  cx = 0x140
      do { wait; cx -= 4; call 095d } while cx != 0          ; 80 frames: wall bar slides in from the right
009e  bx = 0x183c, cx = 0x8d
      do { wait; cx -= 3; call 092e } while cx != 0          ; 47 frames: pillar drops from the top
00b2  bx = 0xfc25, cx = 2
      do { wait; call 0908; cx += 3 } while cx != 0x1a       ; 8 frames: pedestal rises from the bottom
00c6  bx = 0xa9a1, cx = 1, dx = 4
      do { wait; call 08c7; bx -= 0x3c5; cx += 3; dx += 5 } while cx != 0x8b   ; 46 frames: logo window grows
00e7  call 098a                       ; screen rows 0..135 -> 3028:0000, then 0x4ec0 bytes of 0x0f
00ef  cx = 0x4ea; call 09a8           ; one extra ball step before the loop
      do { call 09a8; call 0a43; call 0a8f; wait; call 0a6b } loop cx      ; 1258 frames of ball
0108  call 07f1                       ; tiled wipe and fill (59 frames)
010b  call 0598                       ; clear a000:0000..f9ff to 0 (no wait)
```

## Building the screen (all from segment 4018)

| routine | picture | placement |
|---|---|---|
| 095d (cx) | 320x40 at 4018:0300 | rows 136..175 (a000:aa00); copies the left 320-cx columns to x = cx |
| 092e (bx, cx) | 44x142 at 4018:3500 | x 229, rows 0..(0x8e-cx-1); `bx -= 0x84` (3 rows) every call and is kept, the source starts at 3500+bx: the bottom rows show first |
| 0908 (bx, cx) | 91 wide at 4018:4d68 | `bx -= 0x3c0` (kept), cx rows at di = bx (x 229, from row 198 upward by 3 a frame) |
| 08c7 (bx, cx, dx) | 229 (0xe5) wide at 4018:5595 | top-left dx x cx of the picture at di = bx. bx steps -3 rows -5 columns, so the window's bottom-right stays at (229, 136). Odd/even dx only picks `rep movsw` + `movsb` or `rep movsw`: dx bytes either way |

## The ball (00ef..0106)

Variables (16b2): 5bfe x index, 5c00 y index, 5c02 screen offset of the ball's 72x72 box, 5c04 rows drawn,
5c06 rows*320 (written, never read). Buffer 16b2:5c08, 72x72.

09a8 (cx = loop counter):
```
5c04 = 0x48; 5c06 = 0x5a00
5c00 = (5c00 + 4) & 0x3ff;  y = word [7448 + 5c00]                 ; bounce
if cx > 0x426: y += word [7848 + (0x4ea - cx)*2]                   ; falling in (first 196 frames)
elif cx < 0xc4: y += word [7848 + cx*2]                            ; leaving (last 195 frames)
y += 4  (16-bit)
if y >= 0x40 (unsigned):
    if y >= 0x84: y = 0x84; 5c04 = 0                               ; fully below: not drawn
    else: 5c04 = 0x88 - y                                          ; clipped at the bottom
5bfe = (5bfe + 2) & 0x3ff
5c02 = y*320 + word [7048 + 5bfe] + 0x10
```
0a43: 72 rows of 72 bytes from 3028:5c02 (stride 320) to the buffer (`rep movsd`, si wraps at 16 bits).

0a8f -> 0000:1280..996c: si = 5c02 (ds = 3028), di = 5c08 (es = 16b2), then 3140 blocks of 11 bytes, all the same form
```
8a 84 ss ss    mov al, [si + source]
04 aa          add al, add               ; 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0 or 0xe0: the ball's palette bands
26 88 85 dd dd mov es:[di + dest], al
```
and a `ret`. No other variant occurs (checked over the whole range). The port reads the blocks from the code bytes
(`decodeRefraction`) and throws on anything else. The source offsets run 0x015c..0x4ee3 past 5c02 (rows 1..63 of the box): with y up to 0x84 they reach row ~200,
the refraction lens reads the background around, which is why 098a pads 3028 below row 136 with 0x0f.

After the wait, 0a6b copies 5c04 rows of the buffer to a000:5c02. The old ball is never erased: the 72x72 box
(background + ball) covers it, the ball moving less than its margin per frame.

## 07f1: the wipe

```
DAC 0x20 = (0,1,0x0b), 0x21 = (5,8,8)
wait; every 0 pixel of the screen -> 0x21
ds = 4d0c; si = 2bf8; di = f8c0 (row 199); bx = 0x618
25x: wait; 8x: { 8 copies of the 40 bytes at 4d0c:2bf8+bx side by side; bx -= 40; next row up; if bx < 0: bx = 0x618 }
                                     ; 40x40 tiles, 8 rows a frame from the bottom
si = 0; 8x: wait; DAC 0 <- the next 3 bytes of 4d0c:0000     ; colour 0 steps from (5,8,8) to (0,1,11)
di = f000; 25x: wait; 0xa00 bytes of 0x20 at di; di -= 0xa00 ; fill 8 rows a frame, bottom up
```

## State

- Needs from part A: the screen all 0 (part A ends with 0598) — the whole palette comes from 08ac. 5bfe/5c00 start
  at their values in the image (only this part touches them).
- Leaves: screen all 0, DAC 0 = (0,1,11), 0x20 = (0,1,11), 0x21 = (5,8,8), the rest from 4018:0000; 3028 holds the
  logo screen (part C's 0b62 clears it).
