"""peek.py N ADDRESS COUNT TYPE: dumps work/exeN.img (the image relocated at segment 0) at a linear hex offset
or seg:off. TYPE: b (u8), sb, w (u16), sw, d (u32), s (ASCIIZ string), x (hex bytes)."""
import struct, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
img = open(f'{HERE}/work/exe{sys.argv[1]}.img', 'rb').read()
a = sys.argv[2]
at = int(a.split(':')[0], 16) * 16 + int(a.split(':')[1], 16) if ':' in a else int(a, 16)
count, kind = int(sys.argv[3], 0), sys.argv[4]
if kind == 's':
    print(img[at:img.index(0, at)].decode('cp437'))
elif kind == 'x':
    for i in range(0, count, 16):
        print(f'{at + i:06x}  {img[at + i:at + min(i + 16, count)].hex(" ")}')
else:
    fmt, size = {'b': ('B', 1), 'sb': ('b', 1), 'w': ('H', 2), 'sw': ('h', 2), 'd': ('I', 4)}[kind]
    values = struct.unpack(f'<{count}{fmt}', img[at:at + count * size])
    for i in range(0, count, 16):
        print(f'{at + i * size:06x}  ' + ' '.join(str(v) for v in values[i:i + 16]))
