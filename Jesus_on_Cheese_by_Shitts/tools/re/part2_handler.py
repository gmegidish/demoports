#!/usr/bin/env python3
"""Run part 2's ORIGINAL code under a 68000 emulator: the entry at $a500 up to its mouse loop, then the
level-3 handler $ce48 once per frame. Dumps the memory the script dispatcher and the non-scope effects own,
frame after frame, so the JS port can be diffed against it (test/part2.test.js, tools/re/part2_compare.mjs).

usage: part2_handler.py part2.bin out.bin frames [every]
  out.bin: for frame 1, 1+every, 1+2*every, ... up to `frames`: the WATCHED regions concatenated, then COP1LC.
  The custom-chip page is plain RAM with VHPOSR's line byte held at $e8 (so $d956's beam wait passes) and
  DMACONR reading 0 (blitter never busy); CIA-A port A reads $40 (left button up)."""
import sys
from unicorn import Uc, UC_ARCH_M68K, UC_MODE_BIG_ENDIAN, UC_HOOK_MEM_WRITE
from unicorn.m68k_const import UC_CPU_M68K_M68000, UC_M68K_REG_A7, UC_M68K_REG_A0

# (address, bytes) pairs, in the order they are written per frame. Keep in sync with part2_compare.mjs.
WATCHED = [
    (0xa6bc, 2), (0xa6ee, 4), (0xce44, 4),        # first-frame flag, script index, frames left, routine
    (0xd072, 4),                                  # $d076's plane size
    (0xd97e, 0x20),                               # effect 0 copper list
    (0xd99e, 0x8c),                               # effect 1 copper list (up to the colour-cycle table)
    (0xdaaa, 0x0a), (0xdb7e, 2), (0xdc94, 2), (0xddc6, 2), (0xde78, 2),   # effect 1 counters
    (0x21e7a, 0x8c),                              # pictures' copper list
]
PART = 0xa500
MOUSE_LOOP = 0xa5de
HANDLER = 0xce48
OLD_VECTOR_OPERAND = 0xd97a
STOP = 0x7fff0
STACK = 0x7ff00
# A0 at `jsr $a500`: the boot block's copper list (src/demo.js BOOT_COPPER).
BOOT_COPPER = 0x7f18a

def main():
    part, out, frames = sys.argv[1], sys.argv[2], int(sys.argv[3])
    every = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    uc = Uc(UC_ARCH_M68K, UC_MODE_BIG_ENDIAN)
    uc.ctl_set_cpu_model(UC_CPU_M68K_M68000)
    uc.mem_map(0, 0x80000)
    uc.mem_map(0xdff000, 0x1000)
    uc.mem_map(0xbfe000, 0x1000)
    uc.mem_write(PART, open(part, 'rb').read())
    uc.mem_write(0xbfe001, b'\x40')
    cop = {'lc': 0}

    def on_custom_write(uc, access, addr, size, value, _):
        reg = addr - 0xdff000
        if reg == 0x80 and size == 4:
            cop['lc'] = value & 0x7ffff
        elif reg == 0x80:
            cop['lc'] = ((value & 7) << 16) | (cop['lc'] & 0xffff)
        elif reg == 0x82:
            cop['lc'] = (cop['lc'] & 0xffff0000) | value

    uc.hook_add(UC_HOOK_MEM_WRITE, on_custom_write, begin=0xdff000, end=0xdff0ff)
    uc.reg_write(UC_M68K_REG_A7, STACK)
    uc.reg_write(UC_M68K_REG_A0, BOOT_COPPER)
    uc.emu_start(PART, MOUSE_LOOP)
    uc.mem_write(OLD_VECTOR_OPERAND, STOP.to_bytes(4, 'big'))
    dump = bytearray()
    for frame in range(1, frames + 1):
        uc.mem_write(0xdff006, b'\xe8')
        uc.mem_write(0xdff002, b'\x00\x00')
        uc.reg_write(UC_M68K_REG_A7, STACK)
        uc.emu_start(HANDLER, STOP)
        if (frame - 1) % every == 0:
            for address, length in WATCHED:
                dump += uc.mem_read(address, length)
            dump += cop['lc'].to_bytes(4, 'big')
    open(out, 'wb').write(dump)

main()
