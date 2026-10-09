# show.py START END : the listing (work/outside.lst) between two addresses (hex)
import sys, re, os
A, B = int(sys.argv[1], 16), int(sys.argv[2], 16)
for line in open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work', 'outside.lst')):
    m = re.match(r'([0-9a-f]{5})  ', line)
    if m:
        v = int(m.group(1), 16)
        if v >= B:
            break
        if v >= A:
            sys.stdout.write(line)
    elif line.startswith('; ====') and A <= int(line.split('_')[1].split()[0], 16) < B:
        sys.stdout.write(line)
