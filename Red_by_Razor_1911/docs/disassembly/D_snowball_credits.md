# Part D: the snowball kid and the credit tiles (main script 0000:0181..020d)

Ports: `src/parts/snowball.js` (0181..01c3) and `src/parts/credits.js` (01c6..020d). All data in ds = 16b2 unless a
segment is given. Everything waits on the frame counter (05a7) only: no music position, no other interrupt.

Recording (v2, 70.086 Hz): kid shown on white at frame 4619, text from 4683, text done at 5926, fade to black
5927..5990, credits picture 5991, band from 5993, second credit from 6505, slide apart 7017..7061, colour 1 fade
7062..7171. The previous part leaves a white screen (rec 4618); nothing of its state is used.

## Main script

```
0181  139d[0..2] = 0; 139d[3..2ff] = 3f    ; palette: black + 255 x white
0197  call 0673                            ; DAC <- 139d
019a  call 1029                            ; screen = colour 1, kid picture 6c1f:0000 (166x200) at column 51
019d  call 1004                            ; fade 139d down to 7ce2 (the kid's palette), 64 retraces
01a0  call 105b                            ; 3028:0000..45bf = 94h (empty)
01a3  do: call 106b                        ; scroller: a character into 3028 every 15 retraces
          wait frame
          call 10fa                        ; text along the snowball path (unrolled code)
      while [7fe2] != 1                    ; set when the text's terminating 0 is read
01b4  7ce2[0..2ff] = 0
01c3  call 1004                            ; fade to black, 64 retraces
01c6  wait frame
01c9  call 0e3d                            ; picture 2287:6c04 top 44 rows, 112 rows colour 1, bottom 44 rows
01cc  2287:[bd50] = 2c04                   ; credit 1: "Coding by Performer"
01de  do: call 0f0b                        ; build texture 2287:0004 (320x32)
          wait frame
          if [79d8] != 40h: [79d8]++; call 0e61   ; fade 139d up to 79e2, sends DAC
          call 0eb2                        ; band rows 44..155 from the texture
          call 0e7c                        ; next zoom
      while byte 2287:[0002] != 2
0208  call 0de3                            ; halves slide apart, 45 retraces
020b  call 0db1                            ; colour 1 fades out, 55 steps x 2 retraces
020e  (part E: 0365, mode 12h)
```

## 1004 fade down / 0e61 fade up

- 1004: 64 x { for each of 300h bytes: if 139d[i] != 7ce2[i]: 139d[i]-- ; wait frame; call 0673 }. Only decrements.
- 0e61: for each byte: if 139d[i] != 79e2[i]: 139d[i]++ ; call 0673 (no wait: the caller waited).

## 106b scroller (data 7fe2 done, 7fe4 text index, 7fe6 buffer position, byte 7fe8 countdown, 7fe9 text)

```
if --byte[7fe8] == 0:
    c = text[[7fe4]++]
    if c == 0: [7fe4] = 1; c = text[0]; [7fe2] = 1
    [7fe8] = 15
    si = 803c + word[1b80 + (c - 20h) * 2]       ; font in 16b2, 320 bytes per row, 15x16 characters
    copy char to 3028:[7fe6] - f0h and 3028:[7fe6] + 10e0h   ; 10e4: 16 rows of 15 bytes, stored consecutively (240 bytes)
[7fe6] += 15; if [7fe6] == 12c0h: [7fe6] = f0h
```

Initial values (image): 7fe2 = 0, 7fe4 = 0, 7fe6 = f0h, 7fe8 = 15. 1b80 is 0b72's block offset table (built at 0045).

## 10fa: text along the path

`ds = 3028, es = a000, fs = 6c1f, di = 0, si = [7fe6]`, far call 0997:0000 then 11d9:0000 (registers carry over).
Both are straight-line code made of only these instructions (decoded by `decodeUnrolled` at load time):

```
lodsb                         ; al = 3028:[si++]
add si, imm8 / imm16          ; skip buffer bytes
mov es:[imm16], al            ; a screen pixel
cmp al, 94h / jne L / nop nop / mov bl, fs:[di+imm16] / mov es:[imm16], bl / jmp E / L: mov es:[imm16], al / E:
                              ; empty buffer byte: the kid's pixel at that place instead
mov bl, imm8 / add al, bl     ; 11d9:3e6b..4d92: text colour + 0, 8, ..., 60h (farther along the path, darker bands)
retf
```

0997 has 1206 transparency checks, 11d9 165; together ~7200 screen writes per retrace.

## 0f0b texture, 0eb2 band, 0e7c zoom (79da index, 79dc zoom, 79de / 79e0 origins = 0)

```
0f0b: x = 8000h - 160 * zoom + [79de]           (16 bit)
      for column 0..319: copy 32 bytes 2287:([bd50] + (x >> 8) * 32) down column `column` of 2287:0004 (stride 320)
                         x += zoom
0eb2: y = (4000h - 56 * zoom + [79e0]) & 1fffh
      for row 0..111: copy 320 bytes 2287:(4 + (y >> 8) * 320) to a000:3700 + row * 320; y = (y + zoom) & 1fffh
0e7c: [79da] = ([79da] + 2) & 3ffh
      if [79da] == 0: 2287:[bd50] = 4c04 ("Gfx by Zebig"); byte 2287:[0002]++
      [79dc] = word 2287:[2804 + [79da]]
```

Initial: 79da = 0, 79dc = 2, 2287:0002 = 0. So 2 rounds of 512 retraces.

## 0de3 slide apart / 0db1 colour 1 fade

```
0de3: for k = 0..44: wait frame; dx = k * 320
        a000:0 <- 2287:(6c04 + dx), 3700h - dx bytes; 2 rows colour 1
        skip 8700h + 2 dx; 2 rows colour 1; then 3700h - dx bytes from 2287:(6c04 + 3700h) (ends at fa00h)
0db1: 55 x { wait frame x 2; out 3c8, 1; for 3 bytes at 79e5: if != 0: dec; out 3c9 }
```

The band's last texture stays between the moving halves.
