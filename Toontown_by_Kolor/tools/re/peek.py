# peek.py ADDRESS COUNT TYPE : initial contents of the unpacked memory (work/mem.bin); TYPE = b w sw d sd f q s
import sys, os, struct
m = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work', 'mem.bin'), 'rb').read()
a, n, t = int(sys.argv[1], 16), int(sys.argv[2], 0), sys.argv[3] if len(sys.argv) > 3 else 'b'
if t == 's':
    print(m[a:a + n].split(b'\0')[0])
    sys.exit()
fmt, size = {'b': ('B', 1), 'w': ('H', 2), 'sw': ('h', 2), 'd': ('I', 4), 'sd': ('i', 4), 'f': ('f', 4), 'q': ('d', 8)}[t]
vals = struct.unpack_from('<%d%s' % (n, fmt), m, a)
for i in range(0, n, 16):
    print('%06x: %s' % (a + i * size, ' '.join(str(v) if t in ('f', 'q', 'sw', 'sd') else hex(v) for v in vals[i:i + 16])))
