# Reverse-engineering tools

Scripts used to take RED.EXE apart. `unpack.py` and `rdis.py` need a Python with capstone and unicorn
(`python3 -m venv venv && venv/bin/pip install capstone unicorn`); `show.py` and `peek.py` run on a plain `python3`.
They read and write `work/` (not in the repository).

| Script | What it does |
|---|---|
| `unpack.py EXE PSP N OUT` | runs RED.EXE's PKLITE 1.12 stub in Unicorn with the PSP at segment `PSP` (hex) until the code segment has changed `N` times (the jump into the unpacked program), then saves memory from the load segment (PSP + 10) to a000:0000 into `OUT` |
| `rdis.py [SEG:OFF ...]` | recursive-descent 16-bit disassembly of `work/img.bin` into `work/red.lst` (`SEG:OFF LINEAR  bytes  insn`, `;R` marks a relocated word), from the entry 0000:0000, the far calls/jumps and the extra entry points given (code reached through interrupt vectors, callbacks and jump tables). It rewrites `red.lst`: don't run two at once |
| `show.py START END` | prints `work/red.lst` between two addresses (linear hex or SEG:OFF) |
| `peek.py ADDR COUNT TYPE` | dumps `work/img.bin` at linear hex or SEG:OFF: b, sb, w, sw, d, s (ASCIIZ string), x (hex) |

`work/img.bin` is `unpack.py` run at PSP 1000 and 0f00, rebased to segment 0; the words that differ by the load
segment between the two runs are `work/relocs.txt`. The program proper is the first 0x8b1ff bytes (what the stub
decompresses from load:0000); after it, img.bin holds leftovers of the stub's moved copy of the packed data. Two
entries of relocs.txt (2285e, 8c58e) are such leftovers, not relocations, and `rdis.py` ignores them.

`src/pklite.js` (`unpackRed`) reproduces the stub in JS: it gives the same 0x8b1ff bytes, the other 68
relocations, entry 0000:0000 and stack 2276:0100 (test/pklite.test.js compares it with img.bin when present).
