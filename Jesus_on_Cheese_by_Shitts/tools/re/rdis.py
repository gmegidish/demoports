#!/usr/bin/env python3
"""Recursive-descent 68000 disassembly of a part loaded at a base address.
usage: rdis.py part.bin base [extra seed addresses...] > part.lst
Follows branches, bsr/jsr/jmp absolute, and immediates of the form move.l #addr,<ea>
or lea addr that point at code-looking places ($6c vectors etc.) when passed as seeds."""
import sys, re
from capstone import Cs, CS_ARCH_M68K, CS_MODE_M68K_000

path, base = sys.argv[1], int(sys.argv[2], 16)
seeds = [int(x, 16) for x in sys.argv[3:]] or [base]
data = open(path, 'rb').read()
end = base + len(data)
md = Cs(CS_ARCH_M68K, CS_MODE_M68K_000)
insns = {}
labels = set(seeds)
work = list(seeds)
vectors = set()
while work:
    a = work.pop()
    while base <= a < end and a not in insns:
        chunk = data[a - base:a - base + 12]
        ins = next(md.disasm(chunk, a), None)
        if ins is None:
            break
        insns[a] = ins
        m, op = ins.mnemonic, ins.op_str
        targets = re.findall(r'\$([0-9a-f]+)', op)
        if m.startswith(('b', 'db', 'j')) and not m.startswith(('btst', 'bset', 'bclr', 'bchg')):
            for t in targets[-1:]:
                t = int(t, 16)
                if base <= t < end and ('(' not in op or 'pc' in op):
                    labels.add(t); work.append(t)
        # immediate addresses stored to vectors: move.l #$xxxx, $6c.w etc.
        mm = re.match(r'move\.l #\$([0-9a-f]+), \$(6c|68|70|74|78|64)\.w', m + ' ' + op)
        if mm:
            t = int(mm.group(1), 16)
            if base <= t < end:
                vectors.add(t); labels.add(t); work.append(t)
        if m in ('rts', 'rte', 'bra.b', 'bra.w', 'bra', 'jmp') or m.startswith('bra'):
            break
        a += ins.size
for a in sorted(insns):
    ins = insns[a]
    if a in labels:
        print(f'\nL{a:05x}:' + ('   ; vector' if a in vectors else ''))
    print(f'  {a:06x}  {ins.bytes.hex():<20} {ins.mnemonic} {ins.op_str}')
print(f'; {len(insns)} instructions', file=sys.stderr)
