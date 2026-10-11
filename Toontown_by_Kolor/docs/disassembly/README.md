# Toontown: notes

Addresses are those of the unpacked program with its object at 0x100000 (`tools/re/unpack.mjs`), as in
`tools/re/work/toontown.lst` and in the port's memory.

## The program

- Watcom C/C++ 32-bit, PMODE/W, MIDAS Sound System 0.6.0. Register calling convention: eax, edx, ebx, ecx, then
  the stack.
- Runtime helpers the parts use: 0x113600 / 0x114ee4 malloc, 0x114b64 free, 0x114e44 round toward zero (frndint
  with the control word's rounding set to chop), 0x114e6c sin, 0x114e62 cos, 0x114f89 atan2, 0x114f3f rand
  (state at 0x129bec).
- Static initialisers before main (Watcom's XI table): 0x101274 (part 8's buffers), 0x107b5c (part 9's bend
  arrays), 0x10e688 (copies four picture pointers that are still 0; part 3 sets them again). The parts that need
  their blocks allocate them.

## main, 0x10028d

1. MIDAS setup; mode 13h to measure the refresh rate (0x11319c), mode 3. "Using ..." and the -24 hint.
2. 0x100317 malloc(0x2ee00) -> `[0x12bd80]`, the work buffer (320x200x3 for the -24 mode).
3. Loading, with a message per step: the module, then PCX pictures from TOONTOWN.DAT (0x10102c), the tables
   0x102e40, 0x106024, the TGA (0x1000bd), the table 0x108a58, the 39 spiral frames, and four 64 KB shade tables
   copied to 0x12c6a4, 0x13c6a4, 0x14c6a4, 0x15cfb4. Port: `src/loader.js`, `src/dos.js`.
4. Mode 13h; MIDASsetTimerCallbacks with the retrace callback 0x100006 (`[0x12bd84]` += 1, `[0x12bd88]` += 1
   every second retrace); MIDASplayModule; the sync callback 0x1000ad (`[0x170614]` += 1 on W01).
5. The parts, each called with the song position it runs to (0x100064 reads MIDASgetPlayStatus into position
   `[0x12bd70]`, pattern `[0x12bd74]`, row `[0x12bd78]`); a part returns 1 if Esc was pressed, which ends the
   demo.
6. Mode 3, "kachkéis, bouneschlupp, quetschekraut an kolor", exit.

| Part | Address | Runs to | Notes | Port |
|---|---|---|---|---|
| 1 | 0x10ed9f | 0x02 | A | `parts/intro.js` spiralIntro |
| 2 | 0x10ecc1 | 0x04 | A | `parts/intro.js` kolorLogo |
| 3 | 0x10e813 | 0x08 | A | `parts/intro.js` credits |
| 4 | 0x10eaa0 | 0x0b | A | `parts/intro.js` toonTown |
| 5 | 0x103808 | 0x10 | B_film, B_mesh | `parts/film.js` mickeyFilm |
| 6 | 0x100cd5 | 0x14 | C | `parts/plasma.js` plasma |
| 7 | 0x108c6a | 0x18 | C | `parts/rings.js` rings |
| 8 | 0x1019b1 | 0x1c, 0x20 | D2, D1 | `parts/kaleidoscope.js` kaleidoskop |
| 9 | 0x1087bc | 0x24 | D1 | `parts/star.js` starTunnel |
| 10 | 0x1049fe | 0x28 | B_film, B_mesh | `parts/silhouette.js` mickeySilhouette |
| 11 | 0x10629f | 0x2c | G | `parts/fakemode.js` fakeMode |
| 12 | 0x10eeea | 0x2d | A | `parts/outro.js` spiralReturn |
| 13 | 0x103409 | 0x30 | B_film, B_mesh | `parts/ripple.js` toonSway |
| 14 | 0x10efc2 | 0x33 (ends at 0x32) | A | `parts/outro.js` spiralEnd |

## Timing

Every part advances by the retraces that passed since its last picture, so a picture rendered at a given counter
value does not depend on the machine's speed, with three exceptions where state is stepped once per picture
(part 5's fade-in, part 7's flashes, part 9's tunnel bend; see the README). The port renders on every retrace and
paces those three at the reference recording's rate.

The music clock: the port's position at retrace n after the callbacks are installed is the module's row at
n / 70.086 s (`src/demo.js musicClock`), computed from the XM's speed and tempo commands (`src/xm.js`).
