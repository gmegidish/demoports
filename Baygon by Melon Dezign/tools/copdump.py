#!/usr/bin/env python3
"""Decode a copper list: copdump.py memfile hexaddr [maxwords]"""
import sys, struct
NAMES = {0x80:'COP1LCH',0x82:'COP1LCL',0x84:'COP2LCH',0x86:'COP2LCL',0x88:'COPJMP1',0x8a:'COPJMP2',0x8e:'DIWSTRT',0x90:'DIWSTOP',0x92:'DDFSTRT',0x94:'DDFSTOP',0x96:'DMACON',
 0x100:'BPLCON0',0x102:'BPLCON1',0x104:'BPLCON2',0x106:'BPLCON3',0x108:'BPL1MOD',0x10a:'BPL2MOD',0x10c:'BPLCON4',0x1e4:'DIWHIGH',0x1fc:'FMODE',0x9c:'INTREQ',0x9a:'INTENA'}
mem = open(sys.argv[1], 'rb').read(); a = int(sys.argv[2], 16); n = int(sys.argv[3]) if len(sys.argv) > 3 else 400
run = None
for _ in range(n):
    w1, w2 = struct.unpack('>HH', mem[a:a+4])
    if w1 & 1:
        print(f'{a:06x}  {"WAIT" if not w2 & 1 else "SKIP"} v={w1>>8:02x} h={w1&0xfe:02x} mask={w2:04x}')
        if w1 == 0xffff: break
    else:
        r = w1 & 0x1fe
        name = NAMES.get(r) or (f'BPL{(r-0xe0)//4+1}PT{"HL"[(r>>1)&1]}' if 0xe0 <= r < 0x100 else f'SPR{(r-0x120)//4}PT{"HL"[(r>>1)&1]}' if 0x120 <= r < 0x140 else f'COLOR{(r-0x180)//2:02d}' if 0x180 <= r < 0x1c0 else f'${r:03x}')
        print(f'{a:06x}  {name} = {w2:04x}')
    a += 4
