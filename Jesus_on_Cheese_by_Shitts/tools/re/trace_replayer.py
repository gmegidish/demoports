#!/usr/bin/env python3
"""Run a part's ORIGINAL ProTracker replay routine under a 68000 emulator and record what it does.

usage: trace_replayer.py <part 1|2|3> <part.bin> <frames> <out.json.gz> [fuzz seed]

With a fuzz seed, the module's first patterns are overwritten with random rows that use every effect (and
the song is made of them), to exercise the code paths the demo's own modules never take. The fixture then
carries the patch, which the test applies before running the port.

The part is loaded at $a500 in 512 KB of chip RAM. mt_init is called once, then mt_music <frames> times
(one call per vertical blank, as the parts do). Recorded:
  - every write to $dff000-$dff1ff (Paula registers and DMACON) and to the CIA-A port ($bfe001), split into
    16-bit words the way the 68000 bus does it, with the frame (-1 = mt_init) and how many DMA wait loops
    (`move.w #$118,d0 / dbra d0,*`) the replayer had run through so far in that call;
  - the replayer's variables and channel structures, as byte changes per frame;
  - every other chip RAM byte that differs from the loaded part at the end (the EFx "funk" effect
    rewrites sample data).
The fixture is read by test/replayer.test.js. Dev tool only; nothing in src/ or test/ runs it.
"""
import gzip
import json
import random
import sys
from unicorn import Uc, UC_ARCH_M68K, UC_MODE_BIG_ENDIAN, UC_HOOK_CODE, UC_HOOK_MEM_WRITE, UC_HOOK_MEM_UNMAPPED
from unicorn.m68k_const import UC_CPU_M68K_M68000, UC_M68K_REG_A7, UC_M68K_REG_PC

PART_ADDRESS = 0xa500
CHIP_BYTES = 0x80000
RETURN_ADDRESS = 0x400  # an `rts` target nothing else uses: the low vectors
STACK_TOP = 0x1000
CUSTOM = 0xdff000
CIAA = 0xbfe000
DMA_WAIT = bytes.fromhex('303c0118')  # move.w #$118,d0

# Entry points and the replayer's data block (channel structures up to the module) per part.
PARTS = {
    1: {'module': 0xcdc0, 'init': 0xbbf6, 'music': 0xbcac, 'end': 0xbc8a, 'vars': (0xcc02, 0xcdc0), 'code': (0xbbf6, 0xc752)},
    2: {'module': 0x66822, 'init': 0x65640, 'music': 0x656f4, 'end': 0x656d2, 'vars': (0x66654, 0x66822), 'code': (0x65640, 0x661a4)},
    3: {'module': 0x112ee, 'init': 0xdb14, 'music': 0xdbca, 'end': 0xdba8, 'vars': (0xeb20, 0xecde), 'code': (0xdb14, 0xe670)},
}
FUZZ_PATTERNS = 2
FUZZ_SONG_LENGTH = 6
ROWS = 64
PERIODS = [856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453, 428, 404, 381, 360, 340, 321, 302, 285,
           269, 254, 240, 226, 214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113]


def random_cell(rng):
    """One channel of one row: maybe a note, maybe a sample, an effect with a parameter."""
    period = rng.choice(PERIODS) if rng.random() < 0.5 else 0
    if rng.random() < 0.03:
        period = rng.randrange(0x1000)
    sample = rng.randrange(1, 32) if rng.random() < 0.4 else 0
    # Position jumps and pattern breaks are rare, or the song would hardly get past the top of a pattern;
    # E commands (16 of them) come up as often as all the others together.
    roll = rng.random()
    if roll < 0.01:
        effect = rng.choice([0xb, 0xd])
    elif roll < 0.45:
        effect = 0xe
    else:
        effect = rng.choice([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0xa, 0xc, 0xf])
    parameter = rng.randrange(256)
    if effect == 0xf:
        parameter = rng.randrange(1, 0x10)
    if effect == 0xb:
        parameter = rng.randrange(FUZZ_SONG_LENGTH + 2)
    return bytes([(sample & 0xf0) | (period >> 8), period & 0xff, ((sample & 0xf) << 4) | effect, parameter])


def fuzz_patch(module, seed):
    """[(address, bytes)]: a song of FUZZ_SONG_LENGTH positions over random patterns 0 and 1."""
    rng = random.Random(seed)
    positions = bytes(rng.randrange(FUZZ_PATTERNS) for _ in range(FUZZ_SONG_LENGTH))
    rows = b''.join(random_cell(rng) for _ in range(FUZZ_PATTERNS * ROWS * 4))
    return [(module + 0x3b6, bytes([FUZZ_SONG_LENGTH])), (module + 0x3b8, positions), (module + 0x43c, rows)]


def main():
    number, path, frames, out = int(sys.argv[1]), sys.argv[2], int(sys.argv[3]), sys.argv[4]
    seed = int(sys.argv[5]) if len(sys.argv) > 5 else None
    part = PARTS[number]
    binary = bytearray(open(path, 'rb').read())
    patch = fuzz_patch(part['module'], seed) if seed is not None else []
    for address, data in patch:
        binary[address - PART_ADDRESS:address - PART_ADDRESS + len(data)] = data
    uc = Uc(UC_ARCH_M68K, UC_MODE_BIG_ENDIAN)
    uc.ctl_set_cpu_model(UC_CPU_M68K_M68000)
    uc.mem_map(0, CHIP_BYTES)
    uc.mem_map(CIAA, 0x1000)
    uc.mem_map(CUSTOM, 0x1000)
    uc.mem_write(PART_ADDRESS, bytes(binary))
    uc.mem_write(RETURN_ADDRESS, bytes.fromhex('4e71'))  # nop: emu_start stops here
    uc.mem_write(CIAA + 1, b'\xff')
    initial = bytes(uc.mem_read(0, CHIP_BYTES))

    code_start, code_end = part['code']
    waits = set()
    at = initial.find(DMA_WAIT, code_start, code_end)
    while at >= 0:
        waits.add(at)
        at = initial.find(DMA_WAIT, at + 2, code_end)
    state = {'frame': -1, 'phase': 0, 'writes': [], 'error': None}

    def on_code(uc_, address, size, _):
        if address in waits:
            state['phase'] += 1

    def log_word(address, value):
        # Custom registers as their offset from $dff000; the CIA-A port as the string 'bfe001'.
        register = address - CUSTOM if address >= CUSTOM else 'bfe001'
        state['writes'].append([state['frame'], state['phase'], register, value])

    def on_write(uc_, access, address, size, value, _):
        value &= (1 << (8 * size)) - 1
        if CUSTOM <= address < CUSTOM + 0x1000:
            if size == 4:
                log_word(address, value >> 16)
                log_word(address + 2, value & 0xffff)
            else:
                log_word(address, value)
        elif address == CIAA + 1:
            log_word(address, value)

    def on_unmapped(uc_, access, address, size, value, _):
        state['error'] = f'touched ${address:x} at pc ${uc_.reg_read(UC_M68K_REG_PC):x}'
        return False

    uc.hook_add(UC_HOOK_CODE, on_code, begin=min(waits), end=max(waits))
    uc.hook_add(UC_HOOK_MEM_WRITE, on_write, begin=CIAA, end=CUSTOM + 0xfff)
    uc.hook_add(UC_HOOK_MEM_UNMAPPED, on_unmapped)

    def call(entry):
        uc.reg_write(UC_M68K_REG_A7, STACK_TOP - 4)
        uc.mem_write(STACK_TOP - 4, RETURN_ADDRESS.to_bytes(4, 'big'))
        state['phase'] = 0
        uc.emu_start(entry, RETURN_ADDRESS, count=5_000_000)
        if state['error']:
            raise SystemExit(state['error'])

    vars_start, vars_end = part['vars']
    call(part['init'])
    previous = bytes(uc.mem_read(vars_start, vars_end - vars_start))
    after_init = list(previous)
    var_changes = []
    for frame in range(frames):
        state['frame'] = frame
        call(part['music'])
        now = bytes(uc.mem_read(vars_start, vars_end - vars_start))
        for offset in range(len(now)):
            if now[offset] != previous[offset]:
                var_changes.append([frame, offset, now[offset]])
        previous = now
    final = bytes(uc.mem_read(0, CHIP_BYTES))
    memory_changes = [[address, final[address]] for address in range(CHIP_BYTES)
                      if final[address] != initial[address] and not vars_start <= address < vars_end
                      and not STACK_TOP - 0x100 <= address < STACK_TOP]
    fixture = {
        'part': number, 'frames': frames, 'patch': [[address, data.hex()] for address, data in patch], 'varsStart': vars_start, 'varsLength': vars_end - vars_start,
        'varsAfterInit': after_init,
        'writes': state['writes'], 'varChanges': var_changes, 'memoryChanges': memory_changes,
    }
    with gzip.open(out, 'wt') as f:
        json.dump(fixture, f, separators=(',', ':'))
    print(f'part {number}: {frames} frames, {len(state["writes"])} register writes, '
          f'{len(var_changes)} variable byte changes, {len(memory_changes)} sample bytes changed')


main()
