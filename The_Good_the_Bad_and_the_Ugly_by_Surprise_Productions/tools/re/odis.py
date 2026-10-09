"""odis.py FILE OUT [OFF ...]: recursive-descent 16-bit disassembly of an overlay resource loaded at offset 0 of its own segment."""
import re, sys
from capstone import Cs, CS_ARCH_X86, CS_MODE_16
img = open(sys.argv[1], 'rb').read(); md = Cs(CS_ARCH_X86, CS_MODE_16)
work = [0] + [int(x, 16) for x in sys.argv[3:]]; funcs = set(work); seen = {}
while work:
    off = work.pop()
    while 0 <= off < len(img) and off not in seen:
        ins = next(md.disasm(img[off:off + 16], off), None)
        if ins is None:
            break
        seen[off] = ins; m, o = ins.mnemonic, ins.op_str
        if (m in ('call', 'jmp') or m.startswith('j') or m.startswith('loop')) and re.fullmatch(r'0x[0-9a-f]+|[0-9]+', o):
            t = int(o, 16) & 0xffff; work.append(t)
            if m == 'call':
                funcs.add(t)
        if m in ('ret', 'retf', 'iret', 'jmp', 'hlt', 'ljmp'):
            break
        off += ins.size
out = open(sys.argv[2], 'w'); last = None
for a in sorted(seen):
    i = seen[a]
    if last is not None and a != last:
        out.write(f'        ; ---- gap {last:#x}..{a:#x} ----\n')
    if a in funcs:
        out.write(f'\n; ======== sub_{a:04x} ========\n')
    out.write(f'{a:04x}  {img[a:a + i.size].hex():<20} {i.mnemonic} {i.op_str}\n'); last = a + i.size
print(sys.argv[1], len(seen), 'insns', len(funcs), 'funcs')
