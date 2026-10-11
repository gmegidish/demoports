# Red — disassembly notes

What each part of `RED.EXE` does, as read from the listing (`tools/re/rdis.py`), in the order of the main script
0000:0000..0276. Addresses are `segment:offset` in the unpacked image loaded at segment 0, the same addresses the
port uses (`src/machine.js`). Each note names the recording frames its part covers.

| Note | Main script | Port |
|---|---|---|
| [A_bubbles.md](A_bubbles.md) | 0050..0089 | `src/parts/bubbles.js` |
| [B_redLogo.md](B_redLogo.md) | 008a..010d | `src/parts/redLogo.js` |
| [C_razorText.md](C_razorText.md) | 010e..0180 | `src/parts/razorText.js` |
| [D_snowball_credits.md](D_snowball_credits.md) | 0181..020d | `src/parts/snowball.js`, `src/parts/credits.js` |
| [E_ending.md](E_ending.md) | 020e..0276 | `src/parts/ending.js` |

Before the parts: 0000:0002..003a skips the music with `-s`, otherwise hands the module to the player
(87ba:0580 ah=0eh, which loads and starts it) and sets the volume (ah=28h, 100h: the ending fades it from there); 0045 calls 0b72 (the 16b2:1b80 table of 60 block offsets);
004b sets mode 13h; 004d calls 02b7, which times a frame with the PIT and installs the retrace-counting timer
interrupt 0000:0278 (see `src/demo.js`).
