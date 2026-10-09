"""show.py N START END: prints work/exeN.lst between two linear image offsets (hex), or seg:off addresses."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
def linear(a):
    if ':' in a:
        s, o = a.split(':')
        return int(s, 16) * 16 + int(o, 16)
    return int(a, 16)
start, end = linear(sys.argv[2]), linear(sys.argv[3])
for line in open(f'{HERE}/work/exe{sys.argv[1]}.lst'):
    parts = line.split()
    if len(parts) > 1 and ':' in parts[0] and not line.startswith(';'):
        at = int(parts[1], 16)
        if start <= at < end:
            print(line, end='')
        elif at >= end:
            break
