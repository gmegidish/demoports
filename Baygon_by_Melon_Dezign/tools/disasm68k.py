#!/usr/bin/env python3
"""Disassemble 68000 code from a raw file: dis.py file fileoffset length loadaddr"""
import sys
from capstone import Cs, CS_ARCH_M68K, CS_MODE_M68K_000

def main():
    path, off, length, base = sys.argv[1], int(sys.argv[2], 0), int(sys.argv[3], 0), int(sys.argv[4], 0)
    data = open(path, 'rb').read()[off:off + length]
    md = Cs(CS_ARCH_M68K, CS_MODE_M68K_000)
    md.skipdata = True
    for ins in md.disasm(data, base):
        print(f'{ins.address:06x}  {ins.bytes.hex():<20} {ins.mnemonic} {ins.op_str}')

main()
