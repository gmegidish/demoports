#!/usr/bin/env python3
"""Build the 2 MB chip-RAM image the demo runs from, the way its loader does."""
import os
os.makedirs('work', exist_ok=True)
adf = open('assets/baygon.adf', 'rb').read()
mem = bytearray(0x200000)
mem[0x2000:0x2000 + 0xba00] = adf[0x400:0x400 + 0xba00]          # bootblock load, relocated to $2000
mem[0xd980:0xd980 + 0xce667] = adf[0xbd80:0xbd80 + 0xce667]      # loader: $ce667 bytes from disk offset $bd80
open('work/mem.bin', 'wb').write(mem)
