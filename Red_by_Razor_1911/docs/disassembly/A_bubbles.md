# Part A: the RAZOR bubble logo (main script 0000:0050..0089)

Port: `src/parts/bubbles.js`. All data in ds = 16b2 unless a segment is given.

## Main script

```
0050  call 05a7                 ; wait frame
0053  call 0673                 ; DAC 0..255 <- 16b2:139d (initially 0,0,0 then 48 x 765: black + grey)
0056  [1099] = 1                ; animation pointer: 5cfa:0001
005c  repeat 91:                ; 2 retraces per animation frame (35 Hz)
        wait frame; wait frame
        call 05cf               ; draw one RLE frame
0070  call 0626                 ; logo picture + palette fade (64 retraces)
0073  repeat 200: wait frame
007b  call 0685                 ; logo bounces and falls off (120 retraces)
007e  call 06f0                 ; growing rectangle (235 retraces + 1)
0081  wait frame
0084  call 0598                 ; clear a000:0000..f9ff to 0 (rep stosw 7d00h words)
0087  wait frame                ; part B (008a) starts in the next retrace
```

## 05a7 wait frame / 0673 send palette

- 05a7: spin while `[01fe] == [0200]`, then `[01fe] = [0200]` (the IRQ 0278 increments 0200 at each retrace).
- 0673: `out 3c8,0; rep outsb 3c9` 300h bytes from 139d.

## 05cf: RLE animation frame

```
seg = [109b] != 0 ? 4d0c : 5cfa
si = [1099]; di = 0
do:
    w = lodsw
    colour = w >> 15                      ; 0 or 1
    n = w & 7fff
    if (n odd) or (n == 0): stosb colour  ; 05f9 `sar cx,1 / ja`: a run of 0 still writes one pixel
    rep stosw (colour,colour) n>>1 times
while di != fa00
[1099] = si
if word [si] == 0: [1099] = 70b8; [109b]++
```

Two-colour frames (colours 0 and 1, black and grey 48 at this point). Frames 0..73 are in 5cfa from offset 0001
(frame 73 ends at 5cfa:f241, followed by a zero word); frames 74..90 are in 4d0c from 70b8 to 9a3a. The 91st frame
ends exactly where the logo picture (4d0c:9a3c) begins. 16b2:109b is 0 at load.

## 0626: logo picture and fade

- Copies 85 rows x 303 bytes from 4d0c:9a3c to a000:5b4a (row 73, column 10), stride 320 (`rep movsw` 97h, `movsb`,
  `add di,11h`). This happens in the same retrace as the last animation frame, so animation frame 90 is never seen.
- 64 times: each of the 300h bytes of 139d moves one step toward 109d (signed compare, `jl`), then wait frame,
  then 0673.

## 0685: bounce

120 times:
```
wait frame
y = byte [169d + [1097]]; [1097]++            ; 1097 starts at 0
if y == c8: continue                          ; off screen
di = y*320 - 636h                             ; row y-5, column 10
clear 500h bytes (4 rows) at di
rows = y > 72h ? 200 - y : 85                 ; cut at the screen's bottom
copy `rows` rows of the logo (from 4d0c:9a3c, si restarts every time)
if di < c800h: clear 500h bytes at di         ; 4 rows below
```
Table 169d: 73 70 68 ... 27 ... 196 199 then 200s (an upward throw, then a fall off the screen).
The clears start at column 10, so they run 10 pixels into the next row's left edge, as the copies do.

## 06f0: growing rectangle, 076f: its colour

```
for cx = 240 down to 1:
    bx = [1095]                     ; 1200 at load
    if bx == 25: continue           ; the last 5 iterations do nothing, not even wait
    bx -= 5; [1095] = bx
    [1093] = 2400 / bx              ; half height (rows)
    [1091] = 3840 / bx              ; half width in pixels = words per row
    wait frame
    076f: if cx >= 128: DAC colour 1 = 3 bytes at 1079 + 3*((240-cx) >> 4)
    di = 7da0h - [1093]*320 - [1091]
    2*[1093] rows of [1091] words 0101h, stride 320
wait frame
DAC colour 0 = (5, 8, 8)            ; part B's background (its palette at 4018:0000 starts with the same colour)
```
Table 1079: (1,1,1) (1,2,2) (2,3,3) (2,4,4) (3,5,5) (4,6,6) (5,7,7) (5,8,8): colour 1 brightens to part B's
background colour while the rectangle grows to 306x192, then colour 0 becomes the same, and 0598 clears the screen.

## Timing against the recording (v2.rgb, offset 0)

The port is pixel-identical to the recording for frames 0..806 with `TIMER_MEASURE_RETRACES = 1` in src/demo.js
(0000:02b7 returns in the retrace after the mode set; the IRQ's first count is the retrace after that).

| recording frames | what |
| --- | --- |
| 0..1 | mode 13h, black |
| 2 | DAC: black + grey |
| 4, 6, ..., 184 | animation frames 0..90 (frame 90 is covered by the logo in the same retrace) |
| 185..248 | palette fade |
| 249..448 | pause |
| 449..568 | bounce |
| 569..803 | rectangle |
| 804 | colour 0 = (5,8,8) |
| 805 | screen cleared |
| 806 | part B's code starts (0000:08ac: DAC from 4018:0000) |
| 807 | part B's first drawing visible |

Nothing here reads the music position.
