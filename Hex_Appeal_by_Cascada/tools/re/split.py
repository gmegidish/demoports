"""split.py APPEAL.EXE OUTDIR: writes the chained MZ programs (exe0..exeN) and the trailing data (tail.bin)."""
import struct, sys, os
data = open(sys.argv[1], 'rb').read()
out = sys.argv[2]
os.makedirs(out, exist_ok=True)
offset, index = 0, 0
while data[offset:offset + 2] == b'MZ':
    last, pages = struct.unpack('<HH', data[offset + 2:offset + 6])
    size = (pages - 1) * 512 + last if last else pages * 512
    open(f'{out}/exe{index}.exe', 'wb').write(data[offset:offset + size])
    print(f'exe{index} at {offset:#x} size {size:#x}')
    offset += size
    index += 1
open(f'{out}/tail.bin', 'wb').write(data[offset:])
print(f'tail at {offset:#x} size {len(data) - offset:#x}')
