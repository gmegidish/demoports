#!/usr/bin/env python3
"""Ground truth for part 2's two oscilloscopes ($d1c6 = scope1, $d4e2 = scope2): runs the ORIGINAL code under
Unicorn and writes a test fixture.

usage: scopes_harness.py part2.bin <scope1|scope2> <frames> <out.json[.gz]> [first script entry offset or -]
                         [warmup frames, then on to the scope's next entry] [memory dump out]

part2.bin is loaded at $a500 in 512 KB of chip RAM. The part's own init ($a500..$a5de, including mt_init) runs
first. Then the real level-3 interrupt ($ce48: script dispatcher, the effect, the $d956 tail with mt_music) runs
once per frame, so the channel structures at $66654/$666e4 hold what the real replayer puts there. scope1 comes
late in the script: either run the script up to it (warmup 4400: recording starts at part 2 frame 4480) or point
the script index $a6ee at a scope1 entry.

Fixtures in the repo:
  scopes_harness.py part2.bin scope2 720 test/fixtures/part2-scope2.json.gz
  scopes_harness.py part2.bin scope1 320 test/fixtures/part2-scope1.json.gz - 4400

The blitter is emulated in the $dff058 write hook by an implementation written from the Hardware Reference
Manual, independent of src/blitter.js. The fixture holds, per frame of the scope: the registers the dispatcher
hands over, the replayer/dispatcher state the scope reads (to plant before calling the port), and SHA-256
hashes of the memory regions the scope owns after it ran. It also lists every address the original wrote
while the scope ran, folded into ranges, so the test can check the port writes nowhere else.
"""
import sys, json, hashlib, gzip
from unicorn import Uc, UC_ARCH_M68K, UC_MODE_BIG_ENDIAN, UC_HOOK_CODE, UC_HOOK_MEM_WRITE, UC_HOOK_MEM_READ
from unicorn.m68k_const import *

PART = 0xa500
CHIP = 0x80000
STACK = 0x7ef00
STOP = 0x400          # where the interrupt's final `jmp old_vector` lands
MAIN_LOOP = 0xa5de
INTERRUPT = 0xce48
OLD_VECTOR = 0xd97a   # operand of the `jmp $0.l` at $d978
TAIL = 0xd956
SCRIPT = 0xa6f2
ENTRY = {'scope1': 0xd1c6, 'scope2': 0xd4e2}
EFFECT = {'scope1': 8, 'scope2': 9}
# Regions each scope owns (start, end): copper list, variables, double buffers.
REGIONS = {
    'scope1': [(0x4de92, 0x536f2), (0x562f2, 0x562f4)],
    'scope2': [(0x56436, 0x5b520), (0xa6ee, 0xa6f0)],
}
# State written by others that the scopes read: replayer channel structures, dispatcher variables.
PLANTS = [(0x66654, 0x66774), (0xa6bc, 0xa6be), (0xa6ee, 0xa6f2)]

part, which, frames, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
first_entry = int(sys.argv[5], 16) if len(sys.argv) > 5 and sys.argv[5] != "-" else None
warmup = int(sys.argv[6]) if len(sys.argv) > 6 else 0
data = open(part, 'rb').read()

uc = Uc(UC_ARCH_M68K, UC_MODE_BIG_ENDIAN)
uc.ctl_set_cpu_model(UC_CPU_M68K_M68000)
uc.mem_map(0, CHIP)
uc.mem_write(PART, data)
fresh = bytes(uc.mem_read(0, CHIP))
uc.mem_map(0xdff000, 0x1000)
uc.mem_map(0xbfe000, 0x1000)
uc.mem_write(0xbfe001, b'\x40')  # left button up

# ---- blitter, from the HRM -------------------------------------------------------------------------------------
regs = {}

def rw(a):
    return int.from_bytes(uc.mem_read(a & 0x7fffe, 2), 'big')

def ww(a, v):
    a &= 0x7fffe
    uc.mem_write(a, (v & 0xffff).to_bytes(2, 'big'))
    if state['in']:
        state['writes'].update((a, a + 1))

def ptr(r):
    return ((regs.get(r, 0) & 7) << 16) | (regs.get(r + 2, 0) & 0xfffe)

def mod(r):
    v = regs.get(r, 0) & 0xfffe
    return v - 0x10000 if v & 0x8000 else v

def minterm(lf, a, b, c):
    d = 0
    for bit in range(16):
        idx = ((a >> bit) & 1) << 2 | ((b >> bit) & 1) << 1 | ((c >> bit) & 1)
        d |= ((lf >> idx) & 1) << bit
    return d

def line_blit(height):
    con0, con1 = regs.get(0x40, 0), regs.get(0x42, 0)
    ash = con0 >> 12
    lf = con0 & 0xff
    sud, sul, aul = con1 & 0x10, con1 & 0x08, con1 & 0x04
    err = regs.get(0x52, 0) & 0xfffe
    err = err - 0x10000 if err & 0x8000 else err
    negative = bool(con1 & 0x40)
    amod, bmod, cmod = mod(0x64), mod(0x62), mod(0x60)
    addr = ptr(0x48)
    first = ptr(0x54)
    adat, bdat = regs.get(0x74, 0), regs.get(0x72, 0)
    for i in range(height):
        a = (adat & regs.get(0x44, 0xffff)) >> ash
        b = 0xffff if (bdat >> (15 - ((con1 >> 12) + i) % 16)) & 1 else 0
        target = first if i == 0 else addr
        ww(target, minterm(lf, a, b, rw(addr)))
        def step_x(neg):
            nonlocal ash, addr
            if neg:
                ash -= 1
                if ash < 0:
                    ash, addr = 15, addr - 2
            else:
                ash += 1
                if ash > 15:
                    ash, addr = 0, addr + 2
        def step_y(neg):
            nonlocal addr
            addr = addr - cmod if neg else addr + cmod
        if not negative:      # error >= 0: take the minor step too
            (step_y if sud else step_x)(sul)
        (step_x if sud else step_y)(aul)
        err += bmod if negative else amod
        err = ((err + 0x8000) & 0xffff) - 0x8000
        negative = err < 0
        addr &= 0x7fffe

def area_blit(height, width):
    con0, con1 = regs.get(0x40, 0), regs.get(0x42, 0)
    use = {ch: bool(con0 & bit) for ch, bit in (('a', 0x800), ('b', 0x400), ('c', 0x200), ('d', 0x100))}
    ash, bsh, lf = con0 >> 12, con1 >> 12, con0 & 0xff
    desc = bool(con1 & 2)
    ife, efe, fci = bool(con1 & 8), bool(con1 & 0x10), (con1 >> 2) & 1
    step = -2 if desc else 2
    p = {'a': ptr(0x50), 'b': ptr(0x4c), 'c': ptr(0x48), 'd': ptr(0x54)}
    m = {'a': mod(0x64), 'b': mod(0x62), 'c': mod(0x60), 'd': mod(0x66)}
    dat = {'a': regs.get(0x74, 0), 'b': regs.get(0x72, 0), 'c': regs.get(0x70, 0)}
    for _ in range(height):
        prev_a = prev_b = 0
        carry = fci
        for w in range(width):
            for ch in 'abc':
                if use[ch]:
                    dat[ch] = rw(p[ch])
                    p[ch] += step
            a = dat['a']
            if w == 0:
                a &= regs.get(0x44, 0xffff)
            if w == width - 1:
                a &= regs.get(0x46, 0xffff)
            b = dat['b']
            if desc:
                sa = ((a << ash) | (prev_a >> (16 - ash))) & 0xffff
                sb = ((b << bsh) | (prev_b >> (16 - bsh))) & 0xffff
            else:
                sa = (((prev_a << 16) | a) >> ash) & 0xffff
                sb = (((prev_b << 16) | b) >> bsh) & 0xffff
            prev_a, prev_b = a, b
            d = minterm(lf, sa, sb, dat['c'])
            if ife or efe:
                out = 0
                for bit in range(16):
                    edge = (d >> bit) & 1
                    if efe:
                        carry ^= edge
                        out |= carry << bit
                    else:
                        out |= (carry | edge) << bit
                        carry ^= edge
                d = out
            if use['d']:
                ww(p['d'], d)
                p['d'] += step
        for ch in 'abcd':
            if use[ch]:
                p[ch] += -m[ch] if desc else m[ch]

blits = []
state = {'in': False, 'writes': set(), 'frame': None, 'recording': False}

def on_custom_write(uc, access, address, size, value, _):
    reg = address - 0xdff000
    words = [(reg, value & 0xffff)] if size == 2 else [(reg, value >> 16), (reg + 2, value & 0xffff)]
    for r, v in words:
        regs[r] = v
        if r == 0x58:
            height, width = (v >> 6) or 1024, (v & 0x3f) or 64
            blits.append(dict(con0=regs.get(0x40, 0), con1=regs.get(0x42, 0), size=v))
            if regs.get(0x42, 0) & 1:
                line_blit(height)
            else:
                area_blit(height, width)

def on_custom_read(uc, access, address, size, value, _):
    if address in (0xdff002, 0xdff003):
        uc.mem_write(0xdff002, b'\x00\x00')     # DMACONR: blitter never busy
    if address in (0xdff006, 0xdff007):
        uc.mem_write(0xdff006, b'\xe8\x00')     # VHPOSR: always at line $e8 for the $d956 wait

uc.hook_add(UC_HOOK_MEM_WRITE, on_custom_write, begin=0xdff000, end=0xdfffff)
uc.hook_add(UC_HOOK_MEM_READ, on_custom_read, begin=0xdff000, end=0xdfffff)

# Unicorn does not instrument code it translated before a hook was added: hook everything up front.
records = []

def rd(a, n):
    return bytes(uc.mem_read(a, n))

def on_entry(uc, address, size, _):
    if not state['recording']:
        return
    state['in'] = True
    rec = {
        'a0': uc.reg_read(UC_M68K_REG_A0), 'a1': uc.reg_read(UC_M68K_REG_A1),
        'd0': uc.reg_read(UC_M68K_REG_D0), 'd1': uc.reg_read(UC_M68K_REG_D1),
        'plants': [[s, rd(s, e - s).hex()] for s, e in PLANTS],
    }
    state['frame'] = rec

def on_tail(uc, address, size, _):
    if not state['in']:
        return
    state['in'] = False
    rec = state['frame']
    rec['hashes'] = [hashlib.sha256(rd(s, e - s)).hexdigest() for s, e in REGIONS[which]]
    records.append(rec)

def on_ram_write(uc, access, address, size, value, _):
    if state['in'] and address < STACK - 0x100:
        for i in range(size):
            state['writes'].add(address + i)


uc.hook_add(UC_HOOK_CODE, on_entry, begin=ENTRY[which], end=ENTRY[which])
uc.hook_add(UC_HOOK_CODE, on_tail, begin=TAIL, end=TAIL)
uc.hook_add(UC_HOOK_MEM_WRITE, on_ram_write, begin=0, end=CHIP - 1)

# ---- run --------------------------------------------------------------------------------------------------------
uc.reg_write(UC_M68K_REG_A7, STACK)
uc.reg_write(UC_M68K_REG_A0, 0x7f18a)
uc.emu_start(PART, MAIN_LOOP)
D = [uc.reg_read(UC_M68K_REG_D0 + i) for i in range(8)]
print('main loop registers d0-d7:', ' '.join(f'{x:08x}' for x in D), file=sys.stderr)
uc.mem_write(OLD_VECTOR, STOP.to_bytes(4, 'big'))

def run_interrupt():
    uc.reg_write(UC_M68K_REG_A7, STACK)
    uc.emu_start(INTERRUPT, STOP, count=50_000_000)

def next_effect():
    index = int.from_bytes(uc.mem_read(0xa6ee, 2), 'big')
    frames_left = int.from_bytes(uc.mem_read(0xa6f0, 2), 'big')
    effect = int.from_bytes(uc.mem_read(SCRIPT + index + 2, 2), 'big')
    return effect if frames_left == 0 else None

# Warm up: at least `warmup` frames of the real script, then on until the scope's next entry starts.
for _ in range(warmup):
    run_interrupt()
while warmup and next_effect() != EFFECT[which]:
    run_interrupt()
    warmup += 1
print(f'recording starts at part 2 frame {warmup}', file=sys.stderr)
if first_entry is not None:
    uc.mem_write(0xa6ee, first_entry.to_bytes(2, 'big'))
    uc.mem_write(0xa6f0, b'\x00\x00')

start_memory = rd(0, CHIP)
state['recording'] = True
for f in range(frames):
    run_interrupt()
    if len(records) != f + 1:
        print(f'frame {f}: the scope did not run', file=sys.stderr)
        break

def runs(a, b):
    """Byte ranges where a and b differ, as [start, hex of b]."""
    out, i = [], 0
    while i < len(a):
        if a[i] != b[i]:
            j = i
            while j < len(a) and (a[j] != b[j] or (j + 8 < len(a) and a[j:j + 8] != b[j:j + 8])):
                j += 1
            out.append([i, b[i:j].hex()])
            i = j
        else:
            i += 1
    return out

def fold(addresses):
    out = []
    for a in sorted(addresses):
        if out and a == out[-1][1]:
            out[-1][1] = a + 1
        else:
            out.append([a, a + 1])
    return out

fixture = {
    'scope': which,
    'regions': REGIONS[which],
    'startDiff': runs(fresh, start_memory),
    'written': fold(state['writes']),
    'frames': records,
}
raw = json.dumps(fixture).encode()
open(out, 'wb').write(gzip.compress(raw, 9) if out.endswith('.gz') else raw)
print(f'{len(records)} frames, {len(blits)} blits, written ranges: '
      + ' '.join(f'${s:x}-${e:x}' for s, e in fixture['written']), file=sys.stderr)
if len(sys.argv) > 7:
    open(sys.argv[7], 'wb').write(rd(0, CHIP))
