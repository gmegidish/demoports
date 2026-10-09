# Part 3: the end part ($a500, disk $8c200, $44a00 bytes)

Ported in `src/parts/part3.js`. A dual-playfield screen: a wobbling 3D starfield ("jelly stars", "wibbly
stars") in playfield 1, a green text scroller in front of it in playfield 2. There are no vector shapes;
the "jelly" is the starfield's space being bent by a sine-like table before the perspective divide.

## Entry ($a500)

| Address | What |
|---|---|
| $a500 | Clear $5140 longs from $50000 (to $644ff): both star buffers and nearly all of the scroller planes. |
| $a512 | $ba22: 256 words, y * 40. |
| $a526 | $aa22: 2048 words, $fffe00 / (n + $200), the perspective scale (1.15 fixed point, $7fff at n = 0). |
| $a542 | `jsr mt_init` ($db14) unless the module at $112ee starts with $abcdef (it does not: the music plays). |
| $a554 | DMACON: sprites off, blitter-nasty on. INTENA: only COPER ($8010). $6c -> $a58c (old vector kept at $a99c, the target of the handler's final `jmp`). COP1LC = $a9a0. |
| $a58a | `bra.b *`: never returns. |

## Copper list ($a9a0)

DIW $2c81/$2cc1, DDF $38/$d0, BPLCON0 $4600 (4 planes, dual playfield), BPLCON2 $40 (playfield 2 in
front), modulos 0. Planes: 1 = star buffer, 3 = star buffer + $2800 (playfield 1); 2 = $5a000 + 40 * line,
4 = that + $5280 (playfield 2). COLOR00 0; COLOR01-03 (values at $a9ea/$a9ee/$a9f2) faded in by the CPU;
COLOR09-11 $0f0/$080/$040. Then WAIT $ffdd, WAIT $2c01 (line $12c) and `move #$8010,INTREQ`: the copper
raises the level-3 interrupt at line 300 of every frame.

## The interrupt ($a58c)

1. `btst #6,$bfe001`: left button down clears $112ec (the "scroller stopped" flag).
2. $a5a6: swap $db0c (shown) / $db10 (drawn) between $50000 and $55000; poke the shown one (and +$2800)
   into the copper list.
3. $a60e: blitter clears the drawn buffer: D only, minterm 0, BLTSIZE $8014 (512 lines x 20 words = both
   planes).
4. $a628: fade level $aa1a counts up to $40; COLOR01-03 = each component of $aa14.. ($dcf, $98a, $546)
   times level / 64 (`lsl.w #2 / and #$f00`, `lsr.w #2 / and #$f0`, `lsr.w #6 / and #$f`).
5. $a686: speeds: $aa1c = word at $d3aa + [$db00], $aa1e = $d53a + [$db02], $aa20 = $d700 + [$db04].
6. $a6bc: for each of the $91 stars at $bc22 (x, y, z words):
   x = ((x + $aa1c) & $1ff) - $100, y likewise with $aa1e, z = (z + $aa20) & $3ff, stored back.
   Bend: x += $cfaa[(x + [$db06]) & $1fe], y += $cfaa[(y + [$db08]) & $1fe],
   z += $d1aa[(z + [$db0a]) & $1fe]. Scale s = $aa22[z * 2] (index sign-extended as a word).
   Screen x = high word of (x * s) << 1, + $a0; y the same, + $80. Stored as words at $c7da.
7. $a758: plot each projected star with `bset` if x <= $13f and y <= $ff (unsigned): depth (the stored z,
   before the bend) < $190 -> plane 1 only (colour 1), $190..$2f7 -> plane 2 only (colour 2), >= $2f8 ->
   both (colour 3).
8. $a7be: $db00 += 2 (wraps at $190), $db02 += 2 (wraps at $1c6), $db04 = ($db04 + 2) & $3fe;
   $db06/$db08/$db0a += 4.
9. $a80a: if the module guard allows, wait until VHPOSR's high byte is $fd and `jsr mt_music` ($dbca). The
   interrupt came at line $12c, so this is line 253 of the *next* frame: the handler takes almost a whole
   frame, and the scroller below is moved just before the next interrupt.
10. $a82e: if $112ec is set, done. Otherwise, when the scroll line $ecde is a multiple of 16, blit the next
    text row ($a846); then $ecde += 1 (wraps at $110 = 272) and the copper's playfield-2 pointers =
    $5a000 + 40 * $ecde (and + $5280).

### Text rows ($a846)

The scroller planes are 272 lines, plus a copy of themselves after: a row for scroll line L is blitted at
$59d80 + 40 L (16 lines above the window's top; at L = 0, instead at the copy) and at + $2a80 (just below
the window's bottom), so the window can move down forever and wrap. Each of 20 characters: font at $ece2,
64 bytes a character from space ($20), 16 lines x 1 word per plane, the two planes one after the other;
BLTCON0 $09f0 (A to D), AMOD 0, DMOD $26, BLTSIZE $401, four blits (top plane 2/4, bottom plane 2/4; BLTAPT
is not reloaded between a character's two planes).

Text at $100e2, position $ece0. A zero byte ends a line early (the rest of the row is spaces, the zero is
not consumed); if the row started on a zero *word* it was an empty row and the position skips 2. After the
row, a negative word ($ffff at $112ea) ends the text: $ece0 = 0 and $112ec = 1.

The text is 760 rows; the last is blitted in the 12145th interrupt (242.9 s after the part starts). The rows
after "CYA L8A!" are empty, so the scroller stops on an empty screen while the stars go on forever. The left
button only clears $112ec: during the text it does nothing; after the end it starts the text again from the
top ("PRESS THE LEFT MOUSE BUTTON TO RESTART THIS SCROLLER"), the window continuing where it stopped.

## Port notes

- One frame of the port = `interruptStars` (steps 1-8), `yield`, `interruptMusicAndScroller` (9-10): the
  same sequence as the original, chunked so that a shown frame has the star buffer of the interrupt just
  run and the scroller of the one before, as on the real machine.
- Blits go through `custom()` and `src/blitter.js`, with the original register values.
- `m.isAudioOnly`: only the replayer runs (nothing it uses is touched by the drawing).
- Uninitialised memory: nothing visible reads part 2's leftovers. The cleared range ends at $644ff; the bottom
  copy of plane 4's rows at scroll line $100 reaches $64828, but those bytes are written before they are shown.

## Verification

- `tools/re/part3_handler.py` runs the original entry and handler under Unicorn (blits done in Python, VHPOSR
  reads $fd, module guard planted to skip the replayer) and hashes the star planes, scroller planes, copper
  list, star tables, phases and scroll state every frame; `tools/re/part3_compare.mjs` diffs the JS port:
  16500 frames, with clicks during the text (frame 3000) and after the end (16000), 0 differing.
  `test/fixtures/part3-handler-every-50th.txt` keeps every 50th line for `test/part3.test.js`.
- Against the capture (crop 1080x640 at 132,48 scaled to 320x256): text rows and star pixels line up with
  port frame n = (t - 249.87) * 50, constant from 255 s to 490 s (the scroller moves exactly a line a frame).
  The capture ends at 496 s with the scroller stopped on an empty screen, as the port does.
