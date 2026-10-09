# Reverse-engineering tools

`OUTSIDE.EXE` is a PMODE/W 1.33 stub followed by a PMW1 executable (a Watcom LE program compressed by PMWLITE). `pip install capstone`.

| Script | What it does |
|---|---|
| `node unpack.mjs ../../OUTSIDE.EXE work/mem.bin` | unpacks the program with `src/pmw1.js` into a flat memory image: code object at 0x10000, data object at 0x40000, fixups applied |
| `odis.py` | recursive-descent disassembly of `work/mem.bin` into `work/outside.lst`, following jump tables and code pointers |
| `show.py START END` | prints the listing between two hex addresses |
| `peek.py ADDRESS COUNT TYPE` | dumps the unpacked memory's initial contents: b, w, sw, d, sd, f, q, s |

`work/` (not in git) holds `mem.bin`, `outside.lst` and the DOSBox recordings the port was compared against.
