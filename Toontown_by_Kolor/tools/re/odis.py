# Recursive-descent disassembly of TOONTOWN.EXE's unpacked flat memory (work/mem.bin, made by unpack.mjs).
# Addresses are linear: the program object at 0x100000 holds code, then data (relocated from the listing's original 0x40000 by +0xc0000).
import re, os, struct
from capstone import *
HERE = os.path.dirname(os.path.abspath(__file__))
c = open(os.path.join(HERE, 'work', 'mem.bin'), 'rb').read()
CODE = (0x100000, 0x126ee0)
DATA = (0x126ee0, 0x100000 + 0x73570)
md = Cs(CS_ARCH_X86, CS_MODE_32)
seen = {}
funcs = {0x114b6c}
work = [0x114b6c]

def in_code(t):
    return CODE[0] <= t < CODE[1]

covered = set()

def run():
    while work:
        a = work.pop()
        while in_code(a) and a not in seen:
            ins = next(md.disasm(c[a:a + 16], a), None)
            if ins is None:
                break
            seen[a] = ins
            covered.update(range(a, a + ins.size))
            m, o = ins.mnemonic, ins.op_str
            if (m == 'call' or m == 'jmp' or m.startswith('j') or m.startswith('loop')) and re.fullmatch(r'0x[0-9a-f]+', o):
                t = int(o, 16)
                if m == 'call':
                    funcs.add(t)
                work.append(t)
            mt = re.search(r'dword ptr (?:cs:)?\[(?:\w+)\*4 \+ (0x[0-9a-f]+)\]', o)
            if mt and m in ('jmp', 'call'):
                tb = int(mt.group(1), 16)
                for k in range(1024):
                    p = struct.unpack_from('<I', c, tb + 4 * k)[0]
                    if not in_code(p):
                        break
                    work.append(p)
            if m in ('ret', 'retf', 'iret', 'iretd', 'jmp', 'hlt'):
                break
            a += ins.size

def code_pointers():
    # function pointers: immediates (push/mov) and dwords in the data object that point into code
    found = set()
    for ins in list(seen.values()):
        for imm in re.findall(r'0x[0-9a-f]+', ins.op_str):
            t = int(imm, 16)
            if CODE[0] <= t < CODE[1] and t not in covered and ins.mnemonic in ('push', 'mov') and looks_like_func(t):
                found.add(t)
    for p in range(DATA[0] & ~3, DATA[0] + 0x10000, 4):
        t = struct.unpack_from('<I', c, p)[0]
        if CODE[0] <= t < CODE[1] and t not in covered and looks_like_func(t):
            found.add(t)
    return found

def looks_like_func(t):
    n = 0
    for ins in md.disasm(c[t:t + 64], t):
        if ins.bytes[:2] == b'\x00\x00':
            return False
        n += 1
        if n >= 6:
            return True
    return False

run()
for _ in range(20):
    new = code_pointers()
    if not new:
        break
    funcs |= new
    work.extend(new)
    run()

def asciiz(off):
    if not (DATA[0] <= off < DATA[1]):
        return None
    s = c[off:off + 60].split(b'\0')[0]
    if len(s) >= 4 and all(32 <= x < 127 or x == 10 for x in s):
        return s.decode().replace('\n', '\\n')
    return None

with open(os.path.join(HERE, 'work', 'toontown.lst'), 'w') as out:
    for a in sorted(seen):
        ins = seen[a]
        if a in funcs:
            out.write('\n; ======== sub_%06x ========\n' % a)
        ann = ''
        for imm in re.findall(r'0x[0-9a-f]+', ins.op_str):
            s = asciiz(int(imm, 16))
            if s:
                ann = ' ; "%s"' % s
        out.write('%06x  %-8s %s%s\n' % (a, ins.mnemonic, ins.op_str, ann))
print(len(seen), 'instructions', len(funcs), 'functions')
