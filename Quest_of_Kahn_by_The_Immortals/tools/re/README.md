# Disassembly tools

Small Python scripts used to take `KAHN.EXE` apart. Run them from this folder with the demo's
`KAHN.EXE` copied or linked next to them; `kdis.py` needs `pip install capstone`.

| Script | What it does |
|---|---|
| `le.py OUT` | unpacks the two objects of the linear executable with relocations applied: `obj1.bin` (code, loaded at 0x10000), `obj2.bin` (data, at 0x50000), `fix.json` |
| `kdis.py` | recursive-descent disassembly of `obj1.bin` into `kahn.lst`, annotated with strings and float constants |
| `show.py START END` | prints the listing between two addresses |
| `peek.py ADDR COUNT [b\|w\|d\|f\|q\|s\|p]` | dumps the loaded image as bytes, words, floats, strings or pointers |
| `models/` | Python models of the hand-written rasteriser, with the harness (`emu.py`, needs `unicorn`) that matched them byte for byte against the original machine code |
| `gen_raster_fixture.py MODELS OUT` | regenerates `test/fixtures/raster-cases.json` from those models |
