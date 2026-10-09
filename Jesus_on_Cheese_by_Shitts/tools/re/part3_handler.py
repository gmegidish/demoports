"""Run part 3's original code under Unicorn and print, once per frame, SHA-1s of the memory the interrupt
handler ($a58c) works on, for tools/re/part3_compare.mjs to diff against the JS port.

Memory is set up as the boot block leaves it: part 2's bytes at $a500, part 3's over them. The module guard
$abcdef is planted at $112ee so the replayer is skipped (the JS port does the same; the music does not touch
any of the compared memory). The entry runs up to its `bra.b *`. Then the handler runs again and again; a
line is printed each time it reaches $a80a, the replayer call: the stars are drawn, the scroller not yet
moved. (The JS port shows a frame at the same point.) Blits are done here in Python: the handler uses only a
D-only clear and an A-to-D copy. $dff006 reads $fd so the wait for that line ends at once.

usage: python -I tools/re/part3_handler.py part2.bin part3.bin frames [click_frame ...] > hashes.txt
A click holds the left mouse button for handlers click_frame .. click_frame+4 (counted from 1).
"""
import sys
import hashlib
from unicorn import Uc, UC_ARCH_M68K, UC_MODE_BIG_ENDIAN, UC_HOOK_MEM_WRITE
from unicorn.m68k_const import UC_CPU_M68K_M68020, UC_M68K_REG_A7

BASE = 0xa500
ENTRY_LOOP = 0xa58a
HANDLER = 0xa58c
REPLAYER_CALL = 0xa80a
HANDLER_END = 0xa99a
MODULE = 0x112ee
VECTOR_3 = 0x6c
RTS_AT = 0x1000
STACK = 0x7000
CALLER = 0x2000
CUSTOM = 0xdff000
CIA_A = 0xbfe000
CLICK_FRAMES = 5
WRAP = 0x7fffe
# The regions compared, by name.
REGIONS = [
    ('star planes', 0x50000, 0x5a000),
    ('scroller planes', 0x59d80, 0x64830),
    ('copper list', 0xa9a0, 0xaa22),
    ('fade and speeds', 0xaa14, 0xaa22),
    ('stars', 0xbc22, 0xbf88),
    ('projected', 0xc7da, 0xca1e),
    ('phases and buffers', 0xdb00, 0xdb14),
    ('scroll state', 0xecde, 0xece2),
    ('stopped flag', 0x112ec, 0x112ee),
]


def reg16(uc, reg):
    return int.from_bytes(uc.mem_read(CUSTOM + reg, 2), 'big')


def reg32(uc, reg):
    return int.from_bytes(uc.mem_read(CUSTOM + reg, 4), 'big') & WRAP


def blit(uc, size):
    """Area mode, ascending, no shifts, masks all ones: only what part 3 asks of the blitter."""
    con0 = reg16(uc, 0x40)
    rows = (size >> 6) or 1024
    words = (size & 0x3f) or 64
    amod = (reg16(uc, 0x64) ^ 0x8000) - 0x8000
    dmod = (reg16(uc, 0x66) ^ 0x8000) - 0x8000
    apt = reg32(uc, 0x50)
    dpt = reg32(uc, 0x54)
    assert reg16(uc, 0x42) == 0 and con0 in (0x0100, 0x09f0), hex(con0)
    for _ in range(rows):
        if con0 == 0x09f0:
            data = bytes(uc.mem_read(apt, words * 2))
            apt += words * 2 + amod
        else:
            data = bytes(words * 2)
        uc.mem_write(dpt, data)
        dpt += words * 2 + dmod
    uc.mem_write(CUSTOM + 0x50, (apt & WRAP).to_bytes(4, 'big'))
    uc.mem_write(CUSTOM + 0x54, (dpt & WRAP).to_bytes(4, 'big'))


def on_custom_write(uc, access, address, size, value, _):
    if address == CUSTOM + 0x58:
        # The hook comes before the store; BLTSIZE itself needs no keeping.
        blit(uc, value & 0xffff)


def hashes(uc):
    return ' '.join(hashlib.sha1(bytes(uc.mem_read(start, end - start))).hexdigest()[:12] for _, start, end in REGIONS)


def main():
    part2 = open(sys.argv[1], 'rb').read()
    part3 = open(sys.argv[2], 'rb').read()
    frames = int(sys.argv[3])
    clicks = [int(a) for a in sys.argv[4:]]
    uc = Uc(UC_ARCH_M68K, UC_MODE_BIG_ENDIAN)
    uc.ctl_set_cpu_model(UC_CPU_M68K_M68020)
    uc.mem_map(0, 0x80000)
    uc.mem_map(CUSTOM, 0x1000)
    uc.mem_map(CIA_A, 0x1000)
    uc.mem_write(BASE, part2)
    uc.mem_write(BASE, part3)
    uc.mem_write(MODULE, (0xabcdef).to_bytes(4, 'big'))
    uc.mem_write(RTS_AT, bytes.fromhex('4e75'))
    uc.mem_write(VECTOR_3, RTS_AT.to_bytes(4, 'big'))
    uc.mem_write(CUSTOM + 6, bytes([0xfd]))
    uc.mem_write(CIA_A + 1, bytes([0xff]))
    uc.mem_write(CALLER, bytes.fromhex('4eb9') + HANDLER.to_bytes(4, 'big') + bytes.fromhex('4e71'))
    uc.hook_add(UC_HOOK_MEM_WRITE, on_custom_write, begin=CUSTOM, end=CUSTOM + 0xfff)
    uc.reg_write(UC_M68K_REG_A7, STACK)
    uc.emu_start(BASE, ENTRY_LOOP)
    uc.reg_write(UC_M68K_REG_A7, STACK)
    for frame in range(1, frames + 1):
        is_down = any(c <= frame < c + CLICK_FRAMES for c in clicks)
        uc.mem_write(CIA_A + 1, bytes([0xbf if is_down else 0xff]))
        if frame == 1:
            uc.emu_start(CALLER, REPLAYER_CALL)
        else:
            # The rest of the previous handler, then this one up to the replayer call.
            uc.emu_start(REPLAYER_CALL, CALLER + 6)
            uc.reg_write(UC_M68K_REG_A7, STACK)
            uc.emu_start(CALLER, REPLAYER_CALL)
        print(hashes(uc))


main()
