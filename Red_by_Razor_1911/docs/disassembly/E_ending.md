# Part E: the ending (main script 0000:0211..0276)

Port: `src/parts/ending.js`. All data in ds = 16b2 unless a segment is given.

0000:0365 (called at 020e) has put the BIOS timer back (int 8 vector from [0204]/[0206], PIT channel 0 to 0 =
65536). From here on nothing counts frames: every wait is 05be, a poll of 3da for the next vertical retrace. Mode 12h
runs at 25.175 MHz / 800 / 525 = 59.94 Hz (CRTC 6 = 0bh, overflow bits 8/9 -> vertical total 20bh, + 2).

## Main script

```
0211  int 10h ax=12h            ; 640x480x16, video memory cleared, EGA DAC
0216  call 05be                 ; wait retrace
0219  si = 174a; call 04e2      ; colours: all black
021f  call 0510                 ; the RAZOR logo on lilac
0222  call 0426                 ; fade in: si = 174a, 1747, .. 171d, 3 retraces a step
0225  repeat 500: call 05be
022d  call 0441                 ; fade out: si = 171d, 1720, .. 174a, 3 retraces a step
0230  call 054f                 ; clear, the triangle logo
0233  call 0477                 ; grey ramp table at 171d, fade to white: si = 171d .. 174a, 2 retraces a step
0236  call 045c                 ; white to the logo's colours: si = 0aa6 .. 0a79, 2 retraces a step
0239  repeat 150: call 05be
0241  call 04b6                 ; fade out with the music: si = 0d79 .. 0da6, 4 retraces a step
0244  ah = 0bh; lcall 87ba:0580 ; the player stops the music (port: nothing, the audio is the recording's)
024b  ds = 16b2
0250  int 10h ax=3              ; text mode
0255  si = 0004; es:di = b800:0000; cx = 1fah; call 03bc   ; the end screen
0266  [0040:001a] = [0040:001c] ; BIOS keyboard buffer emptied (head = tail)
0273  int 21h ax=4c00h          ; exit
```

## 05be wait retrace

```
do al = in 3da while al & 8     ; leave the retrace in progress
do al = in 3da until al & 8     ; the next one starts
```

## 04e2 set colours (si)

```
for i = 0..15: in 3da; out 3c0, i; out 3c0, i   ; attribute palette = identity (PAS clear: screen blank)
out 3c0, 20h                                     ; PAS on
out 3c8, 0
repeat 16: 3 x (lodsb; out 3c9); si += 2dh       ; DAC c = table entry si + 30h * c
```

So si points into a 256-entry (768-byte) table and colour c takes entry `si/3 + 16c`: the fades are 16 columns of
such a table, and a fade step moves si by one entry (3 bytes).

Tables (16b2):

| si | colours |
|----|---------|
| 171d | the RAZOR logo: 0 black, 1 lilac (34,34,46), 2..4 greys-blues, 6..14 reds and oranges, 15 white |
| 174a | all black (171d + 15 entries) |
| 0aa6 | 0 black, 1..15 white (63,63,63) |
| 0a79 | the triangle logo: 0 and 1 black, 2..14 pinks (59,57,57)..(17,6,6), 15 white |
| 0d79 | = 0a79 (the fade-out's first step changes nothing) |
| 0da6 | the last fade-out step: never seen, mode 3 follows at once |

## 0426 / 0441 / 045c / 049b / 04b6 fades

```
0426: si = 174a; 16 x { 3 x call 05be; call 04e2; si -= 3 }
0441: si = 171d; 16 x { 3 x call 05be; call 04e2; si += 3 }
045c: si = 0aa6; 16 x { 2 x call 05be; call 04e2; si -= 3 }
049b: si = 171d; 16 x { 2 x call 05be; call 04e2; si += 3 }      ; after 0477 built the table
04b6: si = 0d79; bx = 100h
      16 x { 4 x { call 05be; ah = 28h; lcall 87ba:0580 (bx = volume); bx -= 2 }; call 04e2; si += 3 }
```

04b6 lowers the music volume from 100h by 2 per retrace (64 calls, down to 80h); the port does nothing for it.

## 0477 grey ramp table

```
171d: 30h zero bytes                     ; row 0: colour 0 black
then 15 rows of 16 entries (r = g = b): 0, 4, 8, .. 60
```

Read with 04e2's stride, entry k gives colour 0 black and colours 1..15 grey 4k: the fade from black to (almost)
white; 045c then starts from real white (0aa6).

## 0510 the RAZOR logo / 054f the triangle logo

```
0510: es = a000; map mask = 1; rep stosb ffh 9600h bytes     ; plane 0 all ones: every pixel colour 1 (lilac)
      ds:si = 743a:0000; ah = 1
      4 x { map mask = ah; ah <<= 1; di = 2ee0h; rep movsw 1c20h words }   ; 180 lines from line 150, per plane
      map mask = 0fh
054f: map mask = 0fh; rep stosb 0 9600h bytes                 ; clear
      si = 0209; ah = 1
      4 x { map mask = ah; ah <<= 1; di = 42b3h; 54 x { rep movsw 5 words; di += 46h } }
      map mask = 0fh                                           ; 80x54 pixels at x = 280, line 213
```

## 03bc TheDraw crunched text (ds:si, cx bytes, to es:di)

```
dx = di; ah = 0
while cx:
    al = lodsb
    al >= 20h: stosw (al, ah)
    al < 10h:  ah = (ah & f0h) | al                ; foreground
    al < 18h:  ah = (ah & 8fh) | (al - 10h) << 4   ; background
    al = 18h:  dx += 160; di = dx                  ; new line
    al = 19h:  n = lodsb; n + 1 spaces             ; (cx -= 1 more)
    al = 1ah:  n = lodsb; c = lodsb; n + 1 x c     ; (cx -= 2 more)
    al = 1bh:  ah ^= 80h                           ; blink
    1ch..1fh:  ignored
```

The 1fah bytes at 16b2:0004 begin with three new lines (rows 0..2 keep mode 3's blank 0720h cells) and draw the
RAZOR 1911 logo, "R E D", the credits box (Coding : PERFORMER, Replay : MAT, Graphics : ZEBIG, Music : T.D.K /
Melon) and "Switch off the music with the -S option".

## After the exit

The demo never moves the BIOS cursor (row 0, column 0), so COMMAND.COM prints a new line and its prompt `C:\>` on
row 1, in the cells' existing attribute 07h, with the cursor (scanlines 13..14) after it. The recording shows that,
and the port draws it (`printDosPrompt`). DOSBox blinks the cursor, 16 frames on, 16 off; the port shows it steadily.

## Timing against the recording (DOSBox, GUS)

Port frame g (with `FIRST_PART=ending`: g = 0 the last mode 13h retrace, g = 1 the mode set) = v3 frame g - 2 for
g = 2..880 (all 879 frames of v3), and the text screen at g = 881 = v4 frame 0 (v3 and v4 are consecutive). The
mode-set frame (port g = 1) is not in the recording: DOSBox restarts its frame at the mode set.

The code's waits give three retraces fewer than the recording shows. Fitted, as extra retraces before fade steps:

- 0441 (logo fade-out): step 8 lasts 4 retraces instead of 3 (recording frames 572..575).
- 04b6 (triangle fade-out): its first visible change comes 2 retraces late (somewhere in the 150-retrace hold or the
  first two steps: the picture is still) and its step 14 colours last 6 retraces instead of 4.

05be only sees a retrace while bit 3 of 3da is set, the 2-line (64 us) retrace pulse of mode 12h. An interrupt that
runs across the pulse (the GUS player) makes it miss that retrace; the misses cluster where 04b6 calls the player.
