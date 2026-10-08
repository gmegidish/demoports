# Runs the WWPACK stub of CONTROL.EXE in Unicorn until it far-jumps to the unpacked program, then saves memory.
import struct, sys
from unicorn import *
from unicorn.x86_const import *
d = open(sys.argv[1], 'rb').read()
h = struct.unpack('<14H', d[:28])
hdr = h[4] * 16
size = (h[2] - 1) * 512 + h[1]
img = d[hdr:size]
PSP = 0x1000
LOAD = PSP + 0x10
u = Uc(UC_ARCH_X86, UC_MODE_16)
u.mem_map(0, 0x110000)
u.mem_write(LOAD * 16, img)
u.mem_write(PSP * 16, b'\xcd\x20' + struct.pack('<H', 0x9fff))
u.reg_write(UC_X86_REG_CS, LOAD + h[11]); u.reg_write(UC_X86_REG_IP, h[10])
u.reg_write(UC_X86_REG_SS, LOAD + h[7]); u.reg_write(UC_X86_REG_SP, h[8])
u.reg_write(UC_X86_REG_DS, PSP); u.reg_write(UC_X86_REG_ES, PSP)
stub_cs = LOAD + h[11]
state = {'n': 0}
def intr(uc, n, _):
    ah = uc.reg_read(UC_X86_REG_AX) >> 8
    print('int %02x ah=%02x at %04x:%04x' % (n, ah, uc.reg_read(UC_X86_REG_CS), uc.reg_read(UC_X86_REG_IP)))
    if n == 0x21 and ah == 0x30:
        uc.reg_write(UC_X86_REG_AX, 0x0005)
    elif n == 0x21 and ah == 0x4a:
        uc.reg_write(UC_X86_REG_EFLAGS, uc.reg_read(UC_X86_REG_EFLAGS) & ~1)
    else:
        uc.emu_stop()
u.hook_add(UC_HOOK_INTR, intr)
def code(uc, addr, size, _):
    cs = uc.reg_read(UC_X86_REG_CS)
    state['n'] += 1
    if cs != state.get('cs'):
        print('cs %04x ip %04x after %d insns' % (cs, uc.reg_read(UC_X86_REG_IP), state['n']))
        state['cs'] = cs
        if state["n"] > 1000 and cs == LOAD:
            uc.emu_stop()
u.hook_add(UC_HOOK_CODE, code)
try:
    u.emu_start((LOAD + h[11]) * 16 + h[10], 0, count=200_000_000)
except UcError as e:
    print('error', e, hex(u.reg_read(UC_X86_REG_CS)), hex(u.reg_read(UC_X86_REG_IP)))
cs = u.reg_read(UC_X86_REG_CS); ip = u.reg_read(UC_X86_REG_IP)
print('stopped at %04x:%04x (relative %04x:%04x), ss:sp %04x:%04x ds %04x es %04x' % (cs, ip, cs - LOAD, ip, u.reg_read(UC_X86_REG_SS) - LOAD, u.reg_read(UC_X86_REG_SP), u.reg_read(UC_X86_REG_DS), u.reg_read(UC_X86_REG_ES)))
mem = u.mem_read(0, 0x110000)
open(sys.argv[2], 'wb').write(bytes(mem[LOAD * 16:LOAD * 16 + 0x80000]))
