# Recursive-descent disassembly of The Control's 32-bit PMODE segment (base = unpacked.bin offset 0xec0).
# Offsets in the listing are code32 offsets (what the code uses for addresses, flat from the segment base).
import re, os
from capstone import *
HERE = os.path.dirname(os.path.abspath(__file__))
b = open(os.path.join(HERE, 'unpacked.bin'), 'rb').read()
BASE = 0xec0
c = b[BASE:]
md = Cs(CS_ARCH_X86, CS_MODE_32)
entries = {0x259, 0x5607b}
seen = {}
funcs = set(entries)
work = list(entries)
def pointer_stores():
    # code pointers stored into memory ("mov dword ptr [x], imm") or pushed: effect callbacks
    found = set()
    for a, ins in list(seen.items()):
        mm = re.fullmatch(r'dword ptr \[[^\]]+\], (0x[0-9a-f]+)', ins.op_str) if ins.mnemonic == 'mov' else None
        if ins.mnemonic == 'push' and re.fullmatch(r'0x[0-9a-f]+', ins.op_str):
            mm = re.fullmatch(r'(0x[0-9a-f]+)', ins.op_str)
        if ins.mnemonic == 'mov' and not mm:
            mm = re.fullmatch(r'(?:e[a-d]x|e[sd]i|ebp), (0x[0-9a-f]+)', ins.op_str)
        if mm:
            t = int(mm.group(1), 16)
            if 0x400 <= t < 0x60000 and t not in seen and looks_like_code(t):
                found.add(t)
    return found
def looks_like_code(t):
    text = c[t:t + 40].split(b'\0')[0]
    if len(text) >= 2 and all(32 <= x < 127 for x in text):
        return False
    # at least 8 decodable instructions, none of them "add [eax], al" (zero bytes) before a ret/jmp
    n = 0
    for ins in md.disasm(c[t:t + 96], t):
        if ins.bytes[:2] == b'\x00\x00':
            return False
        n += 1
        if ins.mnemonic in ('ret', 'jmp', 'iretd') or n >= 8:
            return n >= 3
    return False
def run():
  while work:
      a = work.pop()
      while 0 <= a < len(c) and a not in seen:
          ins = next(md.disasm(c[a:a + 16], a), None)
          if ins is None:
              break
          seen[a] = ins
          m, o = ins.mnemonic, ins.op_str
          if (m == 'call' or m == 'jmp' or m.startswith('j') or m.startswith('loop')) and re.fullmatch(r'0x[0-9a-f]+', o):
              t = int(o, 16)
              if m == 'call':
                  funcs.add(t)
              work.append(t)
          # tables of code pointers: "jmp dword ptr [reg*4 + table]"
          mt = re.search(r'(?:jmp|call|mov)\s+(?:\w+, )?dword ptr \[(?:\w+)\*4 \+ (0x[0-9a-f]+)\]', m + ' ' + o)
          if mt:
              tb = int(mt.group(1), 16)
              for k in range(4096):
                  p = int.from_bytes(c[tb + 4 * k: tb + 4 * k + 4], 'little')
                  if 0x200 < p < len(c) and p not in seen:
                      work.append(p)
                      funcs.add(p)
                  elif p == 0 or p >= len(c):
                      break
          if m in ('ret', 'retf', 'iret', 'iretd', 'jmp', 'hlt'):
              break
          a += ins.size


run()
for _ in range(20):
    new = pointer_stores()
    if not new:
        break
    funcs |= new
    work.extend(new)
    run()

def asciiz(off):
    if not (0 <= off < len(c)):
        return None
    s = c[off:off + 60].split(b'\0')[0]
    if len(s) >= 4 and all(32 <= x < 127 for x in s):
        return s.decode()
    return None

with open(os.path.join(HERE, 'control.lst'), 'w') as out:
    for a in sorted(seen):
        ins = seen[a]
        if a in funcs:
            out.write('\n; ======== sub_%05x ========\n' % a)
        ann = ''
        for imm in re.findall(r'0x[0-9a-f]+', ins.op_str):
            s = asciiz(int(imm, 16))
            if s:
                ann = ' ; "%s"' % s
        out.write('%05x  %-8s %s%s\n' % (a, ins.mnemonic, ins.op_str, ann))
print(len(seen), 'instructions', len(funcs), 'functions')
