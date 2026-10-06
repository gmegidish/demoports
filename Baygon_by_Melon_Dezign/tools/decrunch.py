#!/usr/bin/env python3
"""Run a crunched part's self-decruncher under a 68000 CPU emulator and save the unpacked memory.
usage: decrunch.py <hex entry>   ->  work/mem_<entry>.bin"""
import sys
from unicorn import Uc, UC_ARCH_M68K, UC_MODE_BIG_ENDIAN, UC_HOOK_CODE, UC_HOOK_MEM_UNMAPPED
from unicorn.m68k_const import *

entry = int(sys.argv[1], 16)
RET = 0x1f0000
original = open('work/mem.bin', 'rb').read()
uc = Uc(UC_ARCH_M68K, UC_MODE_BIG_ENDIAN)
uc.ctl_set_cpu_model(UC_CPU_M68K_M68020)
uc.mem_map(0, 0x200000)
uc.mem_write(0, original)
uc.reg_write(UC_M68K_REG_A7, 0x2000 - 4)
uc.mem_write(0x2000 - 4, RET.to_bytes(4, 'big'))
uc.reg_write(UC_M68K_REG_A5, 0x168000)
uc.reg_write(UC_M68K_REG_A6, 0xdff000)
state = {'entries': 0, 'why': None}

def on_code(uc, addr, size, _):
    if addr == entry:
        state['entries'] += 1
        if state['entries'] == 2:
            state['why'] = 'unpacked code re-entered'
            uc.emu_stop()
    if addr == RET:
        state['why'] = 'returned'
        uc.emu_stop()

def on_unmapped(uc, access, addr, size, value, _):
    state['why'] = f'touched ${addr:x} at pc ${uc.reg_read(UC_M68K_REG_PC):x}'
    return False

uc.hook_add(UC_HOOK_CODE, on_code)
uc.hook_add(UC_HOOK_MEM_UNMAPPED, on_unmapped)
try:
    uc.emu_start(entry, 0, count=200_000_000)
except Exception as e:
    state['why'] = (state['why'] or '') + f' ({e})'
mem = bytes(uc.mem_read(0, 0x200000))
diff = [i for i in range(0, 0x200000, 16) if mem[i:i + 16] != original[i:i + 16]]
print(f'stop: {state["why"]}, pc=${uc.reg_read(UC_M68K_REG_PC):x}, changed ${diff[0]:x}..${diff[-1] + 16:x}' if diff else state)
open(f'work/mem_{entry:x}.bin', 'wb').write(mem)
