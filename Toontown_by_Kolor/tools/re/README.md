# Reverse-engineering tools

`TOONTOWN.EXE` is a PMODE/W 1.32 stub followed by a PMW1 executable (a Watcom LE program compressed by PMWLITE). `pip install capstone` for the disassembler; the comparison tools need `ffmpeg`.

| Script | What it does |
|---|---|
| `node unpack.mjs ../../TOONTOWN.EXE work/mem.bin` | unpacks the program with `src/pmw1.js` into a flat memory image: the program object at 0x100000, fixups applied |
| `odis.py` | recursive-descent disassembly of `work/mem.bin` into `work/toontown.lst`, following jump tables and code pointers |
| `show.py START END` | prints the listing between two hex addresses |
| `peek.py ADDRESS COUNT TYPE` | dumps the unpacked memory's initial contents: b, w, sw, d, sd, f, q, s |
| `node capframe.mjs OUT_DIR FRAME...` | frames of the reference recording as PNG |
| `node compare.mjs [--rate R] [--part NAME] [--shift=S] [--png DIR] FRAME...` | differing pixels between port frames and recording frames |
| `node sweep.mjs [--rate R] [--before B] [--after A] FRAME...` | for each recording frame, the closest of the port frames just before it (the original shows each picture a few retraces late) |

`recording.mjs` reads the recording: `work/cap/video0004.avi` (mode 13h), `video0005.avi` (320x400) and `video0006.avi` (mode 13h) as one sequence of 70.086 Hz frames, frame 0 the switch to mode 13h. They were made with DOSBox Staging, `machine = svga_s3`, `cpu_cycles = 200000`, Sound Blaster 16 at 220/7/1/5, video capture started before the demo. `--rate 1.0097` plays the music at the recording's speed (DOSBox ran it 0.97 % fast), so the parts start where they do in the recording.

`work/` (not in git) holds `mem.bin`, `toontown.lst` and the recordings.
