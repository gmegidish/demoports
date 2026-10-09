# Notes on the original program

What the port was written from: four readings of `OUTSIDE.EXE`, each checked against frames of the original running in DOSBox. Addresses are linear addresses of the unpacked program (`tools/re/unpack.mjs`): code object at 0x10000, data object at 0x40000.

| File | Contents |
|---|---|
| [A_core.md](A_core.md) | main, the timer callback and the main loop, loading, the IFF loader, MIDAS set-up, the tunnel, palette helpers, the frame copy, the hand-written asm in the data object |
| [B_title_room.md](B_title_room.md) | title.C (part 0) and roomc.C (part 1), the room's textured mesh renderer, the order of the parts |
| [C_credits_pigpan.md](C_credits_pigpan.md) | credits.C (part 2) and pigpan.C (part 5), the star engine, the rotozoomer |
| [D_text_logo_landscape.md](D_text_logo_landscape.md) | text.C (parts 3 and 4), logo.C (part 6), landscape.C (part 7), the bucket-sorted object engine and its four objects |
| [PORTING.md](PORTING.md) | how the port maps onto the program, and how it is timed against the recording |
