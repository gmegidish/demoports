# Reverse-engineering tools

Scripts used to take `ROBOTNIK.EXE` apart and to check the port against the original. They read
`../../ROBOTNIK.EXE` and write to `work/` (not in git). Python needs `pip install capstone unicorn
numpy pillow`; the capture tools also need `ffmpeg`.

| Script | What it does |
|---|---|
| `le.py EXE OUT` | unpacks the three LE objects with relocations applied: `obj1.bin` (code, 0x10000), `obj2.bin` (writable asm, 0x70000), `obj3.bin` (data, 0x80000), `fix.json`. Run as `le.py ../../ROBOTNIK.EXE work` |
| `extract.mjs` | unpacks the 93 files appended to the EXE into `work/res/` (node, uses `src/archive.js`) |
| `kdis.py` | recursive-descent disassembly of objects 1 and 2 into `work/robotnik.lst`, annotated with strings and float constants |
| `show.py START END` | prints the listing between two addresses |
| `peek.py ADDR COUNT [b\|w\|d\|f\|q\|s\|p]` | dumps the loaded image as bytes, words, floats, strings or pointers |
| `callgraph.py ADDR...` | functions reachable from roots below 0x2c000, the library calls they make and the strings they use |
| `capframe.py T [OUT]` | a frame of the recording (`work/cap/demo.avi`) at T seconds after the switch to mode 13h; `--sheet T0 T1 STEP OUT` makes a contact sheet |
| `compare.py OUT T...` | port, original and difference side by side for soundtrack moments, with the share of identical pixels |
| `fixtures.py` | writes the recording frames `test/parts.test.js` checks |
| `engine_fixtures.py`, `r38440_fixtures.py` | run the original engine and the 0x38440 mapper in Unicorn and write the CRCs `test/engine.test.js` and `test/r38440.test.js` check |

The recording: DOSBox Staging 0.83, `machine = svga_s3`, `cpu_cycles = 200000`, Sound Blaster 16 at
220/7/1/5, video capture started at a `pause` before `robotnik`. MIDAS detects the card from `BLASTER`;
no setup screen. The run is one 401.8-second mode 13h stream with sound, `work/cap/demo.avi`.
