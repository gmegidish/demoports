# Reverse-engineering tools

Python scripts used to take `BROTHER.EXE` apart and to check the port against the original. They
read `../../BROTHER.EXE` and write to `work/`. `pip install capstone unicorn numpy pillow`; the
capture tools also need `ffmpeg`.

| Script | What it does |
|---|---|
| `unstub.py` | runs the PKLITE-packed DOS loader at the front of the file in Unicorn until it has unpacked itself; writes `work/stub.bin` (the int 21h file server) |
| `extract.py` | splits the 31 files bound behind the loader into `work/res/` (scenes, GIFs, `TEST.EXE`) |
| `le.py EXE OUT` | unpacks the two objects of the DOS/4GW program with relocations applied: `obj1.bin` (code at 0x10000), `obj2.bin` (data at 0x50000), `fix.json`. Run as `le.py ../../BROTHER.EXE work` |
| `kdis.py` | recursive-descent disassembly of `obj1.bin` into `work/brother.lst`, annotated with strings and float constants |
| `show.py START END` | prints the listing between two addresses |
| `peek.py ADDR COUNT [b\|w\|d\|f\|q\|s\|p]` | dumps the loaded image as bytes, words, floats, strings or pointers |
| `capframe.py T [OUT]` | a frame of the reference capture (DOSBox Staging, ZMBV AVI in `work/cap/video0002.avi`) at T seconds after the switch to 320x200; `--sheet T0 T1 STEP OUT` makes a contact sheet |
| `compare.py OUT T...` | port, original and difference side by side for moments of the song; `CAP_SLOPE`, `CAP_OFFSET` map song time to capture time |
| `fixtures.py` | writes the capture frames `test/original.test.js` checks |

The capture: DOSBox Staging, `machine = svga_s3`, `cpu_cycles = 200000`, Sound Blaster 16 at
44.1 kHz, video capture started before the demo. MIDAS auto-detects the card; no setup menu.
