# Reverse-engineering tools

Scripts used to take GBU.EXE apart. The Python ones need `pip install capstone`. Run them from this folder; they
write to `work/` (not in the repository).

| Script | What it does |
|---|---|
| `node unpack.mjs` | unpacks GBU.EXE with the port's own unpacker (`src/mylz.js`, LZEXE 0.91 under a "MyLZ" signature): `work/img.bin` (the program at segment 0, up to the stack segment 13b9:0000), `work/relocs.txt`, `work/res/NN_name` (the 49 resources) and `work/mod.bin` (the MOD) |
| `gdis.py [SEG:OFF ...]` | recursive-descent 16-bit disassembly of `work/img.bin` into `work/gbu.lst`, from the entry point 0000:03b1, the far calls and the extra entry points given (code reached through jump tables, interrupt vectors and far pointers) |
| `odis.py FILE OUT [OFF ...]` | the same for a code overlay loaded at offset 0 of its own segment (`work/res/21_mutamcde`, `35_zoomcde2`, `22_frakcode`) |
| `show.py START END` | prints `work/gbu.lst` between two addresses (linear hex or SEG:OFF) |
| `peek.py ADDR COUNT TYPE [FILE]` | dumps the image (or a resource) at linear hex or SEG:OFF: b, sb, w, sw, d, s (string), x (hex) |

The listing the notes in `docs/disassembly/` refer to was made with
`gdis.py 0731:007a 0731:00f0 072c:0034` (the two timer interrupt handlers and the keyboard handler); the readers
added the jump-table targets they name in their notes.

The unpacker was first written as a Unicorn run of the packer's own stub (running it at two load segments and
diffing the memory gave the relocations); `src/mylz.js` reproduces that memory byte for byte.
