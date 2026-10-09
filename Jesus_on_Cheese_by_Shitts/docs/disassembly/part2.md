# Part 2: the script, its dispatcher, and the non-scope effects

Loaded at $a500 from disk $1a200, $72000 bytes. Port: `src/parts/part2.js` (the oscilloscopes $d1c6 and $d4e2 are
in `src/parts/part2-scopes.js`). Disassembly: `tools/re/rdis.py part2.bin a500 ceca cee6 d076 d956 d1c6 d4e2`.

## Entry $a500-$a606

| address | what |
|---|---|
| $a500 | `move.l a0,$d992`: boot copper list saved (inside the effect-0 list, past its COPJMP2, never executed) |
| $a506 | old $6c vector into the operand of `jmp $0.l` at $d978 (the handler chains to it) |
| $a514 | $d9de: 16 copper moves COLOR00-15 = 0 (the rings' palette, filled every frame) |
| $a528 | effect 7's copper list ($4de2e): 8 colours copied from $3cb56 to $4de68, 3 plane pointers $3cb56 + n*$dec at $4de50. No script entry uses effect 7 |
| $a580 | $5647e: 32 longs `$0180_0000 + n*$2_0000` (32 black colour moves for $d4e2's list $56436) |
| $a59a | $4debc/$4dec0 = $536f2 (first plane of $d1c6's list $4de92) |
| $a5ae | `jsr $65640` mt_init |
| $a5b4 | $6c = $ce48; INTENA = $0060 off, $8010 on (COPER only); DMACON = $0020 (sprites off); COP2LC = $d996; COP1LC = $d97e |
| $a5de | wait for the left button (`btst #6,$bfe001 / bne`) |
| $a5e8 | `jsr $656d2` mt_end; COP1LC = ($d992); $6c restored; INTENA = $0010; `moveq #0,d0 / rts` |

## How the handler runs

Every effect copper list ends with `WAIT $ffdd / WAIT $2c01 / COPJMP2`; COP2LC = $d996 is `INTREQ = $8010`, so
the copper raises a level-3 COPER interrupt at line $12c (300) of every frame. The handler's work is shown from
the next frame on: the port runs it once per frame after `nextFrame` and the next render shows it.

$ce48: `INTREQ = $10`; `movem` push; **if the left button is down, skip everything** (`beq $d974`, no music either).
If `$a6f0` (frames left) is 0, start the next entry:

```
d0 = $a6ee (byte index into the script at $a6f2); if word(script+d0) == 0: d0 = 0, $a6ee = 0   ; loop
$a6ee += 4
$a6f0 = word(script+d0)                       ; frames
effect = long($a6be + 4*word(script+d0+2))    ; effect table entry
$ce44 = long(effect)                          ; routine
COP1LC = long(effect+4)                       ; copper list (takes effect at the next frame)
a0 = script+d0+4 (parameter words), a1 = effect+8 (effect parameters), $a6bc = 1 (first frame)
```

Then `$a6f0 -= 1` and `move.l $ce44,-(a7) / rts`. On frames other than an entry's first, A0/A1 are the main
loop's (what mt_init left: A0 = $dff000, A1 = $66794); no routine reads them then. Effects that take parameter
words step `$a6ee` over them on their first frame: $ceca 2 bytes, $d076 4, $d4e2 8, $cee6 and $d1c6 none.

$d956 (common tail): `cmpi.b #$e8,$dff006 / bne` (wait for line 232 of the next frame), `clr.w $a6bc`, `jsr $656f4`
(mt_music), `movem` pops, `jmp <old vector>`.

The script is 9280 frames (185.6 s) and loops (frame 9281 = frame 1, verified under the emulator). In the capture
part 2 starts at 45.18 s: capture frame = script frame + 2259 (50 fps), fitted over the whole script.

## Effect table $a6be

| # | routine | copper | parameters (a1) | what |
|---|---|---|---|---|
| 0 | $ceca | $d97e | - | plain background |
| 1 | $cee6 | $d99e | - | rings (moiré) |
| 2 | $d076 | $21e7a | $21f06, $d0 x $100 | man with glasses and an "A" mask |
| 3 | $d076 | $21e7a | $28706, $e0 x $e6 | face with dust mask |
| 4 | $d076 | $21e7a | $2eba6, $a0 x $100 | |
| 5 | $d076 | $21e7a | $33ba6, $140 x $be | rainbow |
| 6 | $d076 | $21e7a | $3b266, $60 x $85 | dog |
| 7 | $d956 | $4de2e | - | (unused: the tail alone) |
| 8 | $d1c6 | $4de92 | - | oscilloscope 1 |
| 9 | $d4e2 | $56436 | - | oscilloscope 2 (over the fractals) |
| 10 | $d076 | $21e7a | $3cb56, $f0 x $f5 | Jesus on a cheese cross |
| 11 | $d076 | $21e7a | $43e2e, $140 x $100 | "JESUS ON CHEESE" logo |

## $ceca: plain background

First frame only: `$a6ee += 2`, `$d984 = (a0)`: COLOR00 of the list $d97e (BPLCON0 = $0200, no planes).

## $cee6: rings

Four word tables, each ending in a negative word, read at byte indices kept in memory:

| table | entries | range | index | value |
|---|---|---|---|---|
| $dab4 | 100 | 0-287 | $db7e | $daac x1 |
| $db80 | 137 | 0-222 | $dc94 | $daae y1 |
| $dc96 | 151 | 0-286 | $ddc6 | $dab0 x2 |
| $ddc8 | 87 | 0-222 | $de78 | $dab2 y2 |

Pictures at $de7a, 80 bytes (640 px) a row, planes 3/4 $a000 after planes 1/2. Odd planes (1, 3) show the
picture at (x1, y1), even planes (2, 4) at (x2, y2): pointer = $de7a + y*80 + (x>>3 & ~1) (the column is an
`add.w`), scroll = (15 - x) & 15, BPLCON1 ($d9b4) = scroll1 | scroll2 << 4. BPLCON0 is $4200: four planes, not dual
playfield, so the overlap makes a 16-colour moiré. DIW $1c71-$3cd1, DDF $28-$d8, modulos $22. Then each index
steps by 2 (wrapping at the negative word), and `$daaa` (0-3) picks one of four 16-colour banks at $da2a ($20
bytes each) copied into the COLOR moves at $d9e0: the colours cycle every frame.

## $d076: pictures

First frame only. From a1: picture address, width, height (longs). Plane bytes = (width>>3) * height (stored at
$d072); four planes one after another into BPL1-4PT at $21e9c. Centring, word arithmetic as in the original:

```
side = (320 - width) >> 1      DIWSTRT = ($2c + top) << 8 | ($81 + side)
top = (256 - height) >> 1      DIWSTOP = ($2b - top) << 8 | ($c1 - side)
fetch = (320 - width) >> 2     DDFSTRT = $38 + fetch, DDFSTOP = $d0 - fetch
```

`$a6ee += 4`; two script colours A = (a0), B = 2(a0). Colour i (i = 0..15, at $21ebc + 4i) =
A + (B - A) * (15 - i) / 15 per 4-bit component (`muls`, `divs #15`: rounds towards zero; red = `lsr.w #8`
unmasked). So colour 0 is B and colour 15 is A. Nothing happens on later frames.

### Colours that miss the copper

The handler starts at line 300; the copper reads the colour moves at the top of the next frame, 12 lines
(~5450 CPU cycles) later. The palette loop costs ~860 cycles a colour (three `muls`/`divs` pairs), so only the
first colours are written in time: **an entry's first frame shows the new COLOR00-05 and the previous COLOR06-15**.
This is plainly visible in the capture (e.g. capture 77.2 s: red background, white face, red mask lines) and
matters for the one-frame flashes (script frames 3520-3680, 3840-...), which never show more than those six.
Fitted on 223 first frames of picture entries in the capture: 6 best (5 and 7 nearly as good, 0 and 16 far
worse). The port writes colours 6-15 at the start of the next interrupt (`flushLateCopperWrites`).

## Verification

- `tools/re/part2_handler.py part2.bin out.bin 9400 [every]`: runs the original entry and handler under Unicorn
  (custom chips as RAM, VHPOSR line byte $e8, DMACONR 0, CIA-A PRA $40) and dumps the memory the dispatcher and
  these effects own after each frame (script variables, $d97e/$d99e/$21e7a lists, rings counters, COP1LC).
- `node tools/re/part2_compare.mjs out.bin 9400`: the JS port matches all 9400 frames (more than one pass of the
  script). `test/fixtures/part2-handler-every-37th.bin` is every 37th frame, checked by `test/part2.test.js`.
- Against the capture (cropped 1091x646 at (125, 44), scaled to 320x256): pictures, flashes and rings match frame
  for frame; remaining differences are YouTube chroma blur on thin coloured lines.
