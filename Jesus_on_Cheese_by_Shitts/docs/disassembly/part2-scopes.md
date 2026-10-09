# Part 2: the two oscilloscopes ($d1c6 and $d4e2)

Ported in `src/parts/part2-scopes.js`; checked against the original code by `tools/re/scopes_harness.py`
(Unicorn) and `test/part2-scopes.test.js`.

Both are effects of part 2's script dispatcher ($ce48, the level-3 interrupt). Each ends with `jmp $d956`
(wait for line $e8, clear the first-frame flag $a6bc, `jsr $656f4` = mt_music). Neither uses A1. Only scope2
reads A0 (its four script parameter words).

| | scope1 | scope2 |
|---|---|---|
| routine | $d1c6..$d43c | $d4e2..$d8f6, dots at $d8fc |
| script effect | 8 (table entry $a684) | 9 (table entry $a68c) |
| copper list | $4de92 | $56436 |
| used | 4 entries of 320 frames, from part 2 frame 4480 (capture ≈134.8 s) | the first 105 entries (from capture 45.2 s) and 8 more later |
| look | white jagged line over a checkerboard plane; colours flash | white screen with a dotted vertical line when silent; mirrored filled bars over a 4-plane fractal picture with rotating palettes |

## Shared: listening to the replayer

Both read two of the replayer's channel structures, $66654 (channel 1) and $666e4 (channel 2):
+4 sample pointer (long), +8 length in words, +$e repeat length in words (1 = no loop), +$10 period,
+$13 volume (byte), +$2a "new note" word (set by the replayer, cleared by the scope).

Per frame:
1. step = N / period (`move.w #N,d1 / divu.w d0,d1`, period 0 taken as 1), N = $83a (scope1) or $8be (scope2).
   The upper word of D1 is the interrupted main loop's D1 for the first channel; it is 0 (mt_init ends with
   d1 = 2 × the last sample's length = 0), so no overflow.
2. If a channel's +$2a word is set, its position is reset to 0. The positions are saved, the +$2a words cleared.
3. For each point: per channel, if `len*2 - pos` (16-bit) is negative, the sample is 0 and pos -= step
   (so the following pos += step leaves it in place); else sample = `(sampleptr + pos.w)` byte (signed index).
   level = (s1 × vol1 + s2 × vol2) asr 7; both positions += step.
4. At the end the positions are restored and advanced by $117a7 / period (3546895 / 50: what Paula plays in a
   frame; on divu overflow D0 stays $117a7 and `add.w` adds $17a7). If `len*2 > pos` (unsigned) nothing else,
   else pos = len*2 if repeat == 1, else 0. (The loop start is ignored: looping samples restart at 0.)

Variables: scope1 step $4dede/$4dee0, position $4dee2/$4dee4, saved $4dee6/$4dee8;
scope2 step $5650a/$5650c, position $5650e/$56510, saved $56512/$56514.

## scope1 ($d1c6)

- Colour flash: index word $562f2 into the word table $562f4 (ended by a negative word): COLOR01 value
  ($4dec4) := COLOR03 value ($4decc); COLOR03 := table[index]; index += 2.
- Double buffer: $536ea (shown) / $536ee (drawn) swap between $4deea and $50aea (256 lines of 44 bytes: the
  copper list shows a 352-pixel window, DIW $2c71-$2cd1, DDF $30-$d8, 2 lores planes). BPL1PT in the copper
  list ($4deb4/$4deb8) := the shown buffer. Plane 2 is static at $536f2 (set by the part's init).
- Clear: BLTDPT = back, BLTCON0/1 = $0100/$0000, BLTDMOD = 0, BLTSIZE = $4016.
- 43 points: x = 8, 16, ... 344, y = $80 − level (16-bit; 1..256 for volumes up to 64). Lines go from
  (0, $7f) through the points, then from (344, y) to (351, $7f).
- Line routine $d442 (D0,D1) → (D2,D3), D6 = plane:
  - start = D6 + 44·y0 (mulu.w) + (x0 & $fff0) >> 3 (the add is `add.w`, so no carry into the high word)
  - octant index = (y1 < y0) << 2 | (x1 < x0) << 1 | (|dy| < |dx|), from the X flag of each `sub.w` via
    `roxl.b`; table at $d4da: `01 11 09 15 05 19 0d 1d` (LINE set, no SING, no ONEDOT)
  - ld = long delta, sd = short delta (swapped when |dy| < |dx|, signed compare)
  - BLTBMOD = 2·sd, BLTAPTL = 2·sd − ld (SIGN in BLTCON1 when negative), BLTAMOD = 2·sd − 2·ld: half the
    usual 4·sd / 4·sd − 2·ld / 4·(sd − ld). Bit 0 of APTL and of the moduli does not exist in the hardware,
    so the error term runs at half scale with its low bit dropped.
  - BLTADAT = $8000, BLTBDAT = $ffff, BLTAFWM = $ffff, BLTCON0 = (x0 & 15) << 12 | $0bca (A, C, D;
    minterm $ca = A | C with the all-ones texture), BLTCPT = BLTDPT = start, BLTCMOD = BLTDMOD = 44,
    BLTSIZE = ld << 6 | 2. Height ld, not ld + 1: the end point is drawn by the next segment.

## scope2 ($d4e2)

On an entry's first frame ($a6bc set), from the script parameters at A0:
- $a6ee += 8 (steps the script over the 4 words).
- p0 ≠ 0: upside down: BPL1MOD/BPL2MOD values ($56450/$56454) = $ffb0 (−80) and the planes start at the
  last line (+$27d8); else modulos 0. The 4 picture planes at $5b520 + k·$2800 go into the copper list's
  BPL1..4PT ($56458..$56474). (`addi.l #$5b520,d0` after `move.w (a0)+,d0` relies on D0's upper word = the
  main loop's = 0.)
- p1, p2: palettes (×32 bytes into the 16-colour table at $65520) copied into the copper list's COLOR00-15
  values ($56480 + 4k) and COLOR16-31 values ($564c0 + 4k). The 32 COLOR moves at $5647e are built by the
  part's init.
- p3 → $56516: thick dots (4 lines instead of 2).

Every frame:
- Palette rotation: COLOR01..15 rotate one step down (colour k takes k+1, colour 15 takes colour 1); COLOR17..31
  one step up (colour 17 takes 31). Colours 0 and 16 stay.
- Double buffer $5b518 (shown) / $5b51c (drawn) between $56518 and $58d18 (256 lines of 40 bytes). The shown one
  (+$27d8 when $56450 is negative) is BPL5PT ($56478/$5647c): the scope is plane 5, so it selects colours 16-31.
- Clear: as scope1 with BLTSIZE $4014.
- 32 rows, 8 lines (320 bytes) apart, from line 4: x = $9f − |level| (`tst.w / bmi / neg.w`). For each row,
  $d8fc plots with the CPU (`bset`) at (x, lines 4-5 of the row; 4-7 thick) and at ((previous x + x) / 2,
  lines 0-1 of the row; 0-3 thick), and again mirrored: 320 − x and 320 − previous x. The first previous x is
  $9f.
- Fill: BLTAPT = BLTDPT = back + $27fe, BLTCON0/1 = $09f0/$000a (A → D, descending, inclusive fill), masks
  $ffff, moduli 0, BLTSIZE $4014. Each line's dot pair becomes a bar from x to 320 − x. When silent
  x = 159 and 161: a dotted vertical line in the middle (the white screen at the start of part 2).

## Verification

`tools/re/scopes_harness.py part2.bin <scope1|scope2> <frames> <out.json.gz> [entry offset|-] [warmup]`
loads part 2 at $a500 in 512 KB, runs its init ($a500..$a5de, mt_init included), then the real level-3
interrupt once per frame (dispatcher + effect + mt_music; $dff002 reads "blitter idle", $dff006 reads line
$e8, the final `jmp` lands on a stop address). Blits run inside the BLTSIZE write hook through a blitter
written from the Hardware Reference Manual, independently of `src/blitter.js`. Unicorn only instruments code
translated after a hook is added, so all hooks are installed before anything runs.

Fixtures: `test/fixtures/part2-scope2.json.gz` (part 2 frames 0-719: the opening scope2 entries including the
first upside-down / thick-dot ones) and `part2-scope1.json.gz` (frames 4480-4799, the first scope1 entry, after
running the whole script up to it). Per frame: A0/A1, the replayer and dispatcher memory the scope reads
($66654-$66774, $a6bc, $a6ee-$a6f1) and SHA-256 of the scope's own memory after it ran. The test replays the
port over the same frames and requires every hash to match, and that the port writes nowhere the original did
not. Both pass, so `src/blitter.js` agrees with the independent blitter for this line setup (half-scale terms,
bit 0 dropped), the clears and the descending inclusive fill.

The capture agrees: capture 45.3 s (white, dotted blue line), 46-51 s (red bars on black), 59 s (upside-down
fractals with bars); 134.9-138.8 s (checkerboards red/blue, brown/pink, green/blue with the white line).
