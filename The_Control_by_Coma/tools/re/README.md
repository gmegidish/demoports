# Reverse-engineering tools

Python scripts used to take `CONTROL.EXE` apart. `pip install capstone unicorn`. Run them from this folder.

| Script | What it does |
|---|---|
| `unpack.py CONTROL.EXE unpacked.bin` | runs the WWPACK stub in Unicorn until it jumps to the program (0000:03d9) and saves 512 KB of memory from the load segment |
| `stubdump.py CONTROL.EXE` | prints the WWPACK decompressor's code with how often each instruction ran (what `src/wwpack.js` was written from) |
| `cdis.py` | recursive-descent disassembly of the 32-bit PMODE segment (`unpacked.bin` + 0xec0) into `control.lst`, following code pointers stored in memory, loaded into registers and kept in jump tables |
| `show.py START END` | prints the listing between two hex offsets |
| `peek.py OFFSET COUNT TYPE` | dumps the segment's initial contents: b, w, sw, d, sd, f, q, s |
