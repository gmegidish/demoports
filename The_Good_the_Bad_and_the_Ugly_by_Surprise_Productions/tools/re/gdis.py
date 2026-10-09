"""gdis.py [SEG:OFF ...]: recursive-descent 16-bit disassembly of work/img.bin (unpacked GBU.EXE at segment 0) -> work/gbu.lst.
Follows near/far jumps and calls, far pointers at relocations, plus extra entry points."""
import struct, re, sys, os
from capstone import Cs, CS_ARCH_X86, CS_MODE_16
HERE = os.path.dirname(os.path.abspath(__file__))
img = open(f'{HERE}/work/img.bin', 'rb').read()
relocs = {int(l.split()[0], 16) for l in open(f'{HERE}/work/relocs.txt')}
segs = sorted({struct.unpack_from('<H', img, r)[0] for r in relocs} | {0})
md = Cs(CS_ARCH_X86, CS_MODE_16)
entries = {(0, 0x3b1)}
for r in relocs:
    if r >= 3 and img[r - 3] in (0x9a, 0xea):
        entries.add((struct.unpack_from('<H', img, r)[0], struct.unpack_from('<H', img, r - 2)[0]))
    # far pointer dword (off, seg) stored as data: mov word [x], off / seg pairs are not followed
for a in sys.argv[1:]:
    s, o = a.split(':'); entries.add((int(s, 16), int(o, 16)))
funcs = set(entries); seen = {}; work = list(entries)
while work:
    seg, off = work.pop()
    while True:
        lin = seg * 16 + off
        if lin in seen or lin >= len(img) or lin < 0:
            break
        ins = next(md.disasm(img[lin:lin + 16], off), None)
        if ins is None:
            break
        seen[lin] = (seg, ins)
        m, o = ins.mnemonic, ins.op_str; raw = img[lin:lin + ins.size]
        if raw[0] in (0x9a, 0xea) and ins.size == 5:
            toff, tseg = struct.unpack('<HH', raw[1:5]); funcs.add((tseg, toff)); work.append((tseg, toff))
        elif m in ('call', 'jmp') or m.startswith('j') or m.startswith('loop'):
            if re.fullmatch(r'0x[0-9a-f]+|[0-9]+', o):
                t = int(o, 16) & 0xffff
                if m == 'call':
                    funcs.add((seg, t))
                work.append((seg, t))
        if m in ('ret', 'retf', 'iret', 'jmp', 'hlt', 'ljmp') or raw[0] == 0xea:
            break
        off = (off + ins.size) & 0xffff
out = open(f'{HERE}/work/gbu.lst', 'w'); names = {s * 16 + o for s, o in funcs}; last = None
for lin in sorted(seen):
    seg, ins = seen[lin]
    if last is not None and lin != last:
        out.write(f'        ; ---- gap {last:#x}..{lin:#x} ----\n')
    if lin in names:
        out.write(f'\n; ======== sub_{seg:04x}_{lin - seg * 16:04x} ========\n')
    raw = img[lin:lin + ins.size]
    rel = ' ;R' if any(lin <= r < lin + ins.size for r in relocs) else ''
    out.write(f'{seg:04x}:{lin - seg * 16:04x} {lin:06x}  {raw.hex():<20} {ins.mnemonic} {ins.op_str}{rel}\n')
    last = lin + ins.size
print(f'{len(seen)} insns, {len(funcs)} funcs, segs {[hex(s) for s in segs]}')
