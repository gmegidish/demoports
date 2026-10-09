"""Run part 1's original level-3 handler ($a5ae) under Unicorn, once per frame, and print the copper list
($a6f4..$a756: frame counter, modulos, colours, plane pointers) after each call, one hex line per frame.
The music is skipped by planting the `$abcdef` mark the handler tests at $cdc0 (the replayer is checked
elsewhere). The handler's final `jmp old_vector` is pointed at an `rts`.

usage: python -I tools/re/part1_handler.py part1.bin [frames] > handler.txt
"""
import sys
from unicorn import Uc, UC_ARCH_M68K, UC_MODE_BIG_ENDIAN
from unicorn.m68k_const import UC_CPU_M68K_M68020
from unicorn.m68k_const import UC_M68K_REG_A0, UC_M68K_REG_A5, UC_M68K_REG_A7

BASE = 0xa500
HANDLER = 0xa5ae
ENTRY_GUARD = 0xa526
BOOT_COPPER = 0x7f18a
OLD_VECTOR = 0xa6f0
REGION = (0xa6f4, 0xa756)
RTS_AT = 0x1000
STACK = 0x7000
CALLER = 0x2000


def main():
    part = open(sys.argv[1], 'rb').read()
    frames = int(sys.argv[2]) if len(sys.argv) > 2 else 0x310
    uc = Uc(UC_ARCH_M68K, UC_MODE_BIG_ENDIAN)
    uc.ctl_set_cpu_model(UC_CPU_M68K_M68020)
    uc.mem_map(0, 0x80000)
    uc.mem_map(0xdff000, 0x1000)
    uc.mem_write(BASE, part)
    uc.mem_write(0xcdc0, bytes.fromhex('00abcdef'))
    uc.mem_write(RTS_AT, bytes.fromhex('4e75'))
    uc.mem_write(OLD_VECTOR, RTS_AT.to_bytes(4, 'big'))
    # The caller: jsr handler, then a nop to stop at.
    uc.mem_write(CALLER, bytes.fromhex('4eb9') + HANDLER.to_bytes(4, 'big') + bytes.fromhex('4e71'))
    # The entry up to the module guard: saves A0, points both planes at the first picture.
    uc.reg_write(UC_M68K_REG_A0, BOOT_COPPER)
    uc.emu_start(BASE, ENTRY_GUARD)
    for _ in range(frames):
        uc.reg_write(UC_M68K_REG_A5, 0xdff000)
        uc.reg_write(UC_M68K_REG_A7, STACK)
        uc.emu_start(CALLER, CALLER + 6)
        print(uc.mem_read(REGION[0], REGION[1] - REGION[0]).hex())


main()
