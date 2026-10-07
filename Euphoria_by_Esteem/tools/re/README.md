# Reverse-engineering tools

Python scripts used to take `EUPHORIA.EXE` apart and to check the port against the original. They read
`../../EUPHORIA.EXE` and write to `work/` (or `$EUPHORIA_RE_WORK`). `pip install capstone unicorn numpy pillow`.

| Script | What it does |
|---|---|
| `extract.py` | splits the resource file appended to the executable into `work/res/NN.*` (music, meshes, pictures, text screen) |
| `edis.py` | recursive-descent disassembly of the relocated MZ image into `work/euph.lst`, with the Borland 8087-emulator interrupts translated back to FPU instructions; also writes `work/img.bin` |
| `show.py SEG:OFF SEG:OFF` | prints the listing between two addresses |
| `peek.py ADDR COUNT TYPE` | dumps the image: bytes, words, floats, Real48, Pascal strings (`ADDR` = DS offset or `SEG:OFF`) |
| `gdis.py` | linear disassembly of a range the recursive pass missed |
| `emu16.py`, `emu.py` | Unicorn harnesses that run the original routines; `emu.py` runs the rasterisers |
| `gen_raster_cases.py` | regenerates `test/fixtures/raster-cases.json` from the original machine code |
| `capframe.py`, `compare.py`, `fps.py` | read the reference capture (DOSBox ZMBV AVIs in `work/cap/`): a frame at a demo time, port-versus-original sheets, screen updates per second |
| `bounces.py` | measures the music-driven bounces of part 4ebc in the capture (the table in `src/vu.js`) |
