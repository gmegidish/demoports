"""show.py START END: prints work/gbu.lst between two addresses (linear hex or SEG:OFF)."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
def linear(a):
    if ':' in a:
        s, o = a.split(':'); return int(s, 16) * 16 + int(o, 16)
    return int(a, 16)
start, end = linear(sys.argv[1]), linear(sys.argv[2])
for line in open(f'{HERE}/work/gbu.lst'):
    p = line.split()
    if len(p) > 1 and ':' in p[0] and not line.startswith(';'):
        at = int(p[1], 16)
        if start <= at < end:
            print(line, end='')
        elif at >= end:
            break
    elif line.startswith('; ====') and 'last' in dir():
        pass
