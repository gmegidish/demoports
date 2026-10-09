# Reverse-engineering tools

Python scripts used to take `appeal.exe` apart. `pip install capstone`. Run them from this folder; they write to
`work/` (not in the repository).

| Script | What it does |
|---|---|
| `split.py ../../appeal.exe work` | writes the seven chained MZ programs (`exe0.exe` loader and music system, `exe1.exe` setup, `exe2.exe`..`exe6.exe` the parts) and the data after them (`tail.bin`: the MOD and three ColoRIX pictures) |
| `hdis.py N [SEG:OFF ...]` | recursive-descent 16-bit disassembly of `work/exeN.exe`, loaded at segment 0, into `work/exeN.lst` (and the image as `work/exeN.img`); extra entry points for code reached only through callbacks, interrupt vectors and jump tables |
| `show.py N START END` | prints the listing between two addresses (linear hex or SEG:OFF) |
| `peek.py N ADDR COUNT TYPE` | dumps the image's initial contents: b, sb, w, sw, d, s (string), x (hex) |

The extra entry points each listing was made with are at the top of the notes in `docs/disassembly/`
(exe0: H0; exe2: `0c48:8340 0c48:8302`; exe3: `0000:0204`; exe6: `0000:0257 0000:4411 0000:486a`).
