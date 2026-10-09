# Part 1: the intro ($a500)

Loaded from disk $c00, $19600 bytes, to $a500. Not crunched. Port: `src/parts/part1.js`.

## Memory map

| Address | What |
|---|---|
| $a500-$a5ad | entry / main loop / exit |
| $a5ae-$a6f3 | level-3 handler (ends `jmp old_vector`; the operand at $a6f0 is patched by the entry) |
| $a6f4 | word: frame counter, counted by the handler |
| $a6f6-$a751 | copper list |
| $a752 | long: A0 at entry (the boot block's copper list, $7f18a) |
| $a756, $ae36, $b516 | three one-plane pictures, 40 bytes x 44 lines ($6e0) each: "PREPARE YOURSELF", "FOR", "A BORING WAIT / WHILE IT LOADS" |
| $bbf6 | mt_init |
| $bc8a | mt_end |
| $bcac | mt_music (the replayer runs to $c750; tables after it) |
| $cdc0-$23ac1 | ProTracker module "introbit" (M.K., 2 positions, 2 patterns) |
| $23ac2-$23aff | padding |

There is no other code: rdis.py's recursive pass covers $a500-$a6ee and $bbf6-$c750, and everything else is
the pictures, replayer tables and the module.

## Entry ($a500)

1. `move.l a0,$a752`; point BPL1PT and BPL2PT in the copper list ($a734/$a738 and $a73c/$a740) at $a756.
2. `cmpi.l #$abcdef,$cdc0 / beq`: unless the module starts with that mark, `jsr mt_init`.
3. DMACON $0020 (sprites off), $8400 (blitter nasty on). INTENA $0060 (VERTB and BLIT off).
4. Old $6c vector into $a6f0 (the handler's `jmp` operand); $6c = $a5ae; INTENA $8010 (COPER on).
5. COP1LC = $a6f6 (takes effect at the next vertical blank).
6. Loop: `cmpi.w #$310,$a6f4 / beq out`, `btst #6,$bfe001 / bne loop`.
7. Out: same module guard, `jsr mt_end`; COP1LC = ($a752); $6c = old vector; INTENA $0010 (COPER off; VERTB is
   left off); `moveq #0,d0 / rts`.

## Copper list ($a6f6)

```
008e 2c81   DIWSTRT          standard 320x256 window
0090 2cc1   DIWSTOP
0092 0038   DDFSTRT          40 bytes a line
0094 00d0   DDFSTOP
0100 0200   BPLCON0          no planes, colour on
0102 0010   BPLCON1          plane 2 (even, PF2) delayed one pixel
0104 0000   BPLCON2
0108 ffd8   BPL1MOD  ($a714) -40 = repeat the first line; 0 from frame $1c0; -40 again from $300
010a ffd8   BPL2MOD  ($a718)
0180 0000   COLOR00  ($a71c)
0186 0000   COLOR03  ($a720) the letters
0184 0000   COLOR02  ($a724) right-hand fringe
0182 0000   COLOR01  ($a728) left-hand fringe
9601 fffe   WAIT line $96
0100 2200   BPLCON0          two planes
00e0/00e2   BPL1PT   ($a734/$a738)
00e4/00e6   BPL2PT   ($a73c/$a740)  same picture as plane 1
c201 fffe   WAIT line $c2
0100 0200   BPLCON0          no planes
009c 8010   INTREQ           set COPER: the level-3 interrupt
ffff fffe
```

So the picture band is lines $96-$c1 (44 lines), canvas rows 106-149, starting at the window's left edge
(DDFSTRT $38 puts the first pixel at $81). Both planes show the same bitmap; plane 2 is one pixel later, so
pixel x has colour bit(x) + 2*bit(x-1): 3 inside a letter, 1 on the first pixel of each run (left edge), 2 on
the pixel just past each run (right edge).

**The copper's INTREQ write is the part's only interrupt source.** VERTB is disabled at entry; the handler is
reached through COPER, at line $c2 of every frame the copper list runs. It is still exactly once a frame, and
since it runs after the band, its changes appear on the next frame. The port runs it after `nextFrame` and the
renderer shows the result, which is the same thing. Side effects: the handler also `jmp`s to the old level-3
handler (the system's), and the first call comes only on the first frame the new copper list runs. The
exit leaves VERTB off; nothing later in the boot block needs it (it times itself from the CIA TOD).
`display.js` ignores writes to $9c, which is correct for drawing.

## Handler ($a5ae)

1. `move.w #$10,$9c(a5)` (acknowledge COPER), save registers.
2. Module guard, then `jsr mt_music`.
3. If COLOR00 ($a71c) is not 0: $a71c -= $111, $a720 -= $110 (a 15-frame fade: colour 0 white to black,
   colour 3 white to $00f).
4. On the frame counter (before incrementing):
   - $1c0: modulos 0 (show the picture: "PREPARE YOURSELF"), $a71c = $a720 = $fff.
   - $230: planes = $ae36 ("FOR"), white flash.
   - $2a0: planes = $b516 ("A BORING WAIT WHILE IT LOADS"), white flash.
   - $300: white flash, modulos -40 (the first line of $b516, empty, repeated: a blank band).
5. Counter += 1.
6. Fringe colours from colour 3 (c3): $a724 = c3 >> 1; $a728 = c3 | (c3>>1)<<4 | (c3>>1)<<8 (16-bit
   shifts; the colour register keeps 12 bits). At rest: c3 = $00f, colour 2 = $007, colour 1 = $77f.
7. Restore registers, `jmp old_vector`.

The main loop sees $310 right after the handler call that counts it, so the last part-1 frame shown is the
one with colour 0 = $111; the next frame is the boot copper list (with its colour 1 still black, then the
red fade-in of the next message).

## Verification

- `tools/re/part1_handler.py` runs the original entry (to $a526) and handler $310 times under Unicorn (music
  skipped by planting the $abcdef mark) and prints $a6f4-$a755 after each call. The port's chip RAM over the
  same range, frame by frame, is identical for all $310 frames.
- Timing against the capture: the white flash of frame $1c0 is capture frame 675 (13.50 s) and port 15.49 s;
  the first red step of the next message is capture 1011 (20.22 s) and port 22.21 s. **Port time = capture
  time + 1.99 s** (100 frames), constant through the part. Fade brightness per frame matches the capture.
- Picture positions: bounding boxes of the three pictures in the capture (1280x720, scale ≈3.415 x 2.56 per
  lores pixel) and in the port map to the same capture origin (x ≈125.5, y ≈40) as the boot block's message
  screen, within one capture pixel; so part 1's window/fetch/modulo place the band as the original does.
  The fringe colours (light blue left, dark blue right) match a zoomed capture.
- `test/part1.test.js`: black before $1c0, the white flash, each picture bit-exact in the band, the return
  to the boot copper at $310 and on a click.

Not verified here: the music (the replayer is ported separately; part 1 calls it at the original's points).
