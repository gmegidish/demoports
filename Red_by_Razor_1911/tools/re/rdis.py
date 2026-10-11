"""rdis.py [SEG:OFF ...]: recursive-descent 16-bit disassembly of work/img.bin (the unpacked RED.EXE image,
relocated at segment 0, written by unpack.py) into work/red.lst. Follows near/far jumps and calls; extra entry
points for code reached only through callbacks, interrupt vectors and jump tables go on the command line."""
import struct, re, sys, os
from capstone import Cs, CS_ARCH_X86, CS_MODE_16
HERE = os.path.dirname(os.path.abspath(__file__))
img = bytearray(open(f'{HERE}/work/img.bin', 'rb').read())
relocs = {int(x, 16) for x in open(f'{HERE}/work/relocs.txt').read().split()} - {0x2285e, 0x8c58e}
ENTRY = (0, 0)
segvals = {struct.unpack('<H', img[r:r + 2])[0] for r in relocs if r + 2 <= len(img)}
segs = sorted(segvals | {0})
md = Cs(CS_ARCH_X86, CS_MODE_16)
entries = {ENTRY}
for r in relocs:
    if r >= 3 and img[r - 3] == 0x9a or r >= 3 and img[r - 3] == 0xea:
        entries.add((struct.unpack('<H', img[r:r + 2])[0], struct.unpack('<H', img[r - 2:r])[0]))
extra = [x.split(':') for x in sys.argv[1:]]
for s, o in extra:
    entries.add((int(s, 16), int(o, 16)))
funcs = set(entries)
seen = {}
work = list(entries)
def code_seg_of(lin):
    return max(s for s in segs if s * 16 <= lin)
while work:
    seg, off = work.pop()
    while True:
        lin = seg * 16 + off
        if lin in seen or lin >= len(img) or lin < 0:
            break
        ins = next(md.disasm(bytes(img[lin:lin + 16]), off), None)
        if ins is None:
            break
        seen[lin] = (seg, ins)
        m, o = ins.mnemonic, ins.op_str
        raw = img[lin:lin + ins.size]
        if raw[0] in (0x9a, 0xea) and ins.size == 5:
            toff, tseg = struct.unpack('<HH', raw[1:5])
            funcs.add((tseg, toff)); work.append((tseg, toff))
        elif m in ('call', 'jmp') or m.startswith('j') or m.startswith('loop'):
            if re.fullmatch(r'0x[0-9a-f]+|0', o):
                t = int(o, 16) & 0xffff
                if m == 'call':
                    funcs.add((seg, t))
                work.append((seg, t))
        if m in ('ret', 'retf', 'iret', 'jmp', 'hlt', 'ljmp') or raw[0] == 0xea:
            break
        off = (off + ins.size) & 0xffff
out = open(f'{HERE}/work/red.lst', 'w')
names = {s * 16 + o for s, o in funcs}
last = None
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
print(f'red: {len(seen)} insns, {len(funcs)} funcs, segs {[hex(s) for s in segs]}, image {len(img):#x}')
