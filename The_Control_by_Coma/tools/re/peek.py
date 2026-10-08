# peek.py OFFSET COUNT [b|w|sw|d|sd|f|q|s] : the 32-bit segment's initial contents at a code32 offset (hex)
# s = zero-terminated string. Memory above the end of the file is BSS (zero at start).
import sys, struct, os
c = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'unpacked.bin'), 'rb').read()[0xec0:]
a = int(sys.argv[1], 16); n = int(sys.argv[2], 0); t = sys.argv[3] if len(sys.argv) > 3 else 'b'
if t == 's':
    print(repr(c[a:a + 256].split(b'\0')[0].decode('latin1'))); sys.exit()
fmt = {'b': '<B', 'w': '<H', 'sw': '<h', 'd': '<I', 'sd': '<i', 'f': '<f', 'q': '<d'}[t]
sz = struct.calcsize(fmt)
vals = [struct.unpack(fmt, c[a + i * sz:a + i * sz + sz])[0] if a + i * sz + sz <= len(c) else 0 for i in range(n)]
print(' '.join(hex(v) if t in ('b', 'w', 'd') else repr(v) for v in vals))
