"""peek.py ADDR COUNT TYPE [FILE]: dumps work/img.bin (unpacked GBU.EXE at segment 0) or a resource file (res/NN_name, offset from 0).
ADDR = linear hex or SEG:OFF. TYPE: b, sb, w, sw, d, s (string), x (hex dump)."""
import sys, os, struct
HERE = os.path.dirname(os.path.abspath(__file__))
a, n, t = sys.argv[1], int(sys.argv[2], 0), sys.argv[3]
d = open(sys.argv[4] if len(sys.argv) > 4 else f'{HERE}/work/img.bin', 'rb').read()
if ':' in a:
    s, o = a.split(':'); a = int(s, 16) * 16 + int(o, 16)
else:
    a = int(a, 16)
if t == 's':
    print(d[a:a + n]); sys.exit()
if t == 'x':
    for o in range(a, a + n, 16):
        print('%06x  %s' % (o, d[o:min(o + 16, a + n)].hex(' ')))
    sys.exit()
f = {'b': 'B', 'sb': 'b', 'w': 'H', 'sw': 'h', 'd': 'I'}[t]; sz = struct.calcsize(f)
vals = [struct.unpack_from('<' + f, d, a + i * sz)[0] for i in range(n)]
for i in range(0, n, 16):
    print('%06x  %s' % (a + i * sz, ' '.join(str(v) for v in vals[i:i + 16])))
