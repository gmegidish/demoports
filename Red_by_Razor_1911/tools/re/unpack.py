# Runs the PKLITE stub of RED.EXE in Unicorn until it jumps to the unpacked program; saves memory from the PSP on.
import struct, sys
from unicorn import *
from unicorn.x86_const import *
d = open(sys.argv[1], 'rb').read()
PSP = int(sys.argv[2], 16)
h = struct.unpack('<14H', d[:28])
hdr = h[4] * 16
size = (h[2] - 1) * 512 + h[1]
img = d[hdr:size]
LOAD = PSP + 0x10
u = Uc(UC_ARCH_X86, UC_MODE_16)
u.mem_map(0, 0x110000)
u.mem_write(LOAD * 16, img)
for k in range(h[3]):
    off, seg = struct.unpack('<HH', d[h[12] + 4 * k:h[12] + 4 * k + 4])
    a = (LOAD + seg) * 16 + off
    v = struct.unpack('<H', bytes(u.mem_read(a, 2)))[0]
    u.mem_write(a, struct.pack('<H', (v + LOAD) & 0xffff))
u.mem_write(PSP * 16, b'\xcd\x20' + struct.pack('<H', 0x9fff))
u.reg_write(UC_X86_REG_CS, LOAD + h[11]); u.reg_write(UC_X86_REG_IP, h[10])
u.reg_write(UC_X86_REG_SS, LOAD + h[7]); u.reg_write(UC_X86_REG_SP, h[8])
u.reg_write(UC_X86_REG_DS, PSP); u.reg_write(UC_X86_REG_ES, PSP)
st = {'cs': None, 'n': 0, 'seen': []}
def intr(uc, n, _):
    ah = uc.reg_read(UC_X86_REG_AX) >> 8
    print('int %02x ah=%02x at %04x:%04x' % (n, ah, uc.reg_read(UC_X86_REG_CS), uc.reg_read(UC_X86_REG_IP)), file=sys.stderr)
    if n == 0x21 and ah == 0x30:
        uc.reg_write(UC_X86_REG_AX, 0x0005)
    elif n == 0x21 and ah == 0x4a:
        uc.reg_write(UC_X86_REG_EFLAGS, uc.reg_read(UC_X86_REG_EFLAGS) & ~1)
    else:
        uc.emu_stop()
def code(uc, addr, sz, _):
    cs = uc.reg_read(UC_X86_REG_CS)
    if cs != st['cs']:
        st['cs'] = cs
        st['seen'].append(cs)
        ip = uc.reg_read(UC_X86_REG_IP)
        print('cs -> %04x:%04x after %d' % (cs, ip, st['n']), file=sys.stderr)
        if len(st['seen']) >= int(sys.argv[3]):
            st['oep'] = (cs, ip); uc.emu_stop()
    st['n'] += 1
u.hook_add(UC_HOOK_INTR, intr)
u.hook_add(UC_HOOK_BLOCK, code)
u.emu_start((LOAD + h[11]) * 16 + h[10], 0x10ffff, count=200_000_000)
print('ss:sp %04x:%04x ds %04x es %04x' % (u.reg_read(UC_X86_REG_SS), u.reg_read(UC_X86_REG_SP), u.reg_read(UC_X86_REG_DS), u.reg_read(UC_X86_REG_ES)), file=sys.stderr)
open(sys.argv[4], 'wb').write(bytes(u.mem_read(LOAD * 16, 0xa0000 - LOAD * 16)))
