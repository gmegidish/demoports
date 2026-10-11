# Ground truth for test/engine.test.js: runs the original 3D engine of ROBOTNIK.EXE in unicorn
# (x87 precision control set to 24 bits as main does) and writes test/fixtures/engine.json with
# CRC32s of what it draws. The JS test rebuilds the same inputs (same xorshift32 streams, same
# colour table / background patterns) and compares.
#   $P engine_fixtures.py            (from tools/re, with capstone and unicorn installed)
import json, os, struct, sys, zlib
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import *

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, 'work')
RES = os.path.join(WORK, 'res')
OUT = os.path.join(HERE, '..', '..', 'test', 'fixtures', 'engine.json')

STACK_TOP = 0x3f0000
RET = 0x3ff000
STUB = 0x3fe000
HEAP = 0x400000
MEMORY = 0x4000000
TARGET = 0xe4d40
COLOUR_TABLE = 0xfd0a0
COLOUR_TABLE_BYTES = 0x8000
SCREEN = 64000
M32 = 0xffffffff
FILE_PADDING = 0x10000


class Fatal(Exception):
    pass


class Emu:
    def __init__(self):
        u = Uc(UC_ARCH_X86, UC_MODE_32)
        self.u = u
        u.mem_map(0, MEMORY)
        for name, base in (('obj1.bin', 0x10000), ('obj2.bin', 0x70000), ('obj3.bin', 0x80000)):
            u.mem_write(base, open(os.path.join(WORK, name), 'rb').read())
        u.mem_write(RET, b'\xf4')
        self.heap = HEAP
        # malloc: every block is followed by zeros, so reads past its end (the 32 KB phong maps are
        # read up to 64 KB) see 0 as in the port instead of the next block.
        self.hook_return(0x2d354, lambda: self.alloc(self.reg(UC_X86_REG_EAX) + FILE_PADDING))
        self.hook_return(0x2d434, lambda: self.alloc(self.reg(UC_X86_REG_EAX) + FILE_PADDING))  # malloc (demo side)
        self.hook_return(0x2d464, lambda: 0)                                        # free
        self.hook_return(0x2cf98, self.load_file)                                   # archive load
        self.hook_return(0x31170, lambda: 0)                                        # printf
        for fatal in (0x3af20, 0x3bfe0, 0x4a7fa):
            self.u.hook_add(UC_HOOK_CODE, self.fatal, begin=fatal, end=fatal)
        # fninit; fldcw [cw]; hlt  with cw = 0x007f (precision 24 bits, round to nearest)
        u.mem_write(STUB, b'\xdb\xe3\xd9\x2d' + struct.pack('<I', STUB + 0x10) + b'\xf4')
        u.mem_write(STUB + 0x10, struct.pack('<H', 0x007f))
        u.emu_start(STUB, STUB + 8)

    def fatal(self, u, address, size, data):
        raise Fatal(hex(address))

    def reg(self, r):
        return self.u.reg_read(r)

    def hook_return(self, address, fn):
        def cb(u, a, size, data):
            value = fn()
            sp = u.reg_read(UC_X86_REG_ESP)
            ret = struct.unpack('<I', u.mem_read(sp, 4))[0]
            u.reg_write(UC_X86_REG_EAX, value & M32)
            u.reg_write(UC_X86_REG_ESP, sp + 4)
            u.reg_write(UC_X86_REG_EIP, ret)
        self.u.hook_add(UC_HOOK_CODE, cb, begin=address, end=address)

    def load_file(self):
        name = self.cstr(self.reg(UC_X86_REG_EAX)).lower()
        data = open(os.path.join(RES, name), 'rb').read()
        # Reads past the end of a texture (teethtxt is 256x32) see zeros here, as in the port; in
        # the original they see whatever the heap holds next.
        return self.alloc(len(data) + FILE_PADDING, data)

    def cstr(self, a):
        out = b''
        while True:
            b = bytes(self.u.mem_read(a, 1))
            if b == b'\0':
                return out.decode('latin1')
            out += b
            a += 1

    def alloc(self, n, data=None):
        a = self.heap
        self.heap = (self.heap + n + 15) & ~15
        if data is not None:
            self.u.mem_write(a, bytes(data))
        return a

    def w32(self, a, v): self.u.mem_write(a, struct.pack('<I', v & M32))
    def r32(self, a): return struct.unpack('<i', self.u.mem_read(a, 4))[0]
    def wb(self, a, b): self.u.mem_write(a, bytes(b))
    def rb(self, a, n): return bytes(self.u.mem_read(a, n))

    def call(self, addr, eax=0, edx=0, ebx=0, ecx=0, esi=0, edi=0, stack=()):
        u = self.u
        sp = STACK_TOP
        for v in reversed(list(stack)):
            sp -= 4
            u.mem_write(sp, struct.pack('<I', v & M32))
        sp -= 4
        u.mem_write(sp, struct.pack('<I', RET))
        for r, v in ((UC_X86_REG_EAX, eax), (UC_X86_REG_EDX, edx), (UC_X86_REG_EBX, ebx), (UC_X86_REG_ECX, ecx),
                     (UC_X86_REG_ESI, esi), (UC_X86_REG_EDI, edi), (UC_X86_REG_ESP, sp), (UC_X86_REG_EBP, 0)):
            u.reg_write(r, v & M32)
        u.emu_start(addr, RET, count=500_000_000)
        return u.reg_read(UC_X86_REG_EAX)


class XorShift:
    """xorshift32, the same stream as test/engine.test.js."""
    def __init__(self, seed):
        self.s = seed & M32

    def next(self):
        s = self.s
        s ^= (s << 13) & M32
        s ^= s >> 17
        s ^= (s << 5) & M32
        self.s = s
        return s

    def int(self, lo, hi):
        """Integer in [lo, hi]."""
        return lo + self.next() % (hi - lo + 1)


def colour_table_pattern():
    return bytes((((i * 2654435761) & M32) >> 24) for i in range(COLOUR_TABLE_BYTES))


def background_pattern():
    return bytes(((i * 31) ^ (i >> 5)) & 255 for i in range(SCREEN))


def crc(data):
    return zlib.crc32(data) & M32


# --- objects ----------------------------------------------------------------------------------------

def load_object_tree(e, data):
    """0x433b0's result built directly in memory: the file is a raw pre-order dump."""
    at = [0]

    def take(n):
        chunk = data[at[0]:at[0] + n]
        assert len(chunk) == n
        at[0] += n
        return chunk

    def collection(header, count_off, size):
        n = struct.unpack('<I', take(4))[0]
        struct.pack_into('<I', header, count_off, n)
        struct.pack_into('<I', header, count_off + 4, e.alloc(n * size, take(n * size)) if n else 0)

    def read():
        header = bytearray(take(0xb4))
        collection(header, 0x08, 12)
        collection(header, 0x10, 0x30)
        collection(header, 0x18, 12)
        collection(header, 0x20, 12)
        collection(header, 0x98, 0x11c)
        if struct.unpack_from('<I', header, 0xac)[0]:
            keys = []
            while True:
                k = bytearray(take(0x44))
                keys.append(k)
                if struct.unpack_from('<I', k, 0)[0] == 0:
                    break
            addresses = [e.alloc(0x44) for _ in keys]
            for i, k in enumerate(keys):
                struct.pack_into('<I', k, 0, addresses[i + 1] if i + 1 < len(keys) else 0)
                e.wb(addresses[i], k)
            struct.pack_into('<I', header, 0xac, addresses[0])
        address = e.alloc(0xb4)
        if struct.unpack_from('<I', header, 0)[0]:
            struct.pack_into('<I', header, 0, read())
        if struct.unpack_from('<I', header, 4)[0]:
            struct.pack_into('<I', header, 4, read())
        e.wb(address, header)
        return address

    root = read()
    assert at[0] == len(data)
    return root


def load_object(e, name):
    root = load_object_tree(e, open(os.path.join(RES, name), 'rb').read())
    e.call(0x41c50, eax=root)
    return root


def tree(e, obj):
    out = []
    while obj:
        out.append(obj)
        child = e.r32(obj + 4)
        if child:
            out += tree(e, child)
        obj = e.r32(obj)
    return out


def phong_map_crcs(e, root):
    out = []
    for obj in tree(e, root):
        n = e.r32(obj + 0xa0)
        mats = e.r32(obj + 0xa4)
        for i in range(n):
            table = e.r32(mats + 0x30 * i + 0x14)
            out.append(crc(e.rb(table, 0x8000)) if table else 0)
    return out


# --- scenes -----------------------------------------------------------------------------------------

def new_world(e):
    e.wb(COLOUR_TABLE, colour_table_pattern())
    e.w32(0x89dcc, TARGET)
    e.w32(0x106b58, 0xa0000)
    return e.call(0x39e68, eax=30, edx=0x76c, ebx=0xa8c, ecx=0xa8c)


def render(e, world):
    e.wb(TARGET, background_pattern())
    e.call(0x3a4e0, eax=world)
    return crc(e.rb(TARGET, SCREEN))


def set_camera(e, world, pos, angles):
    e.call(0x3a114, eax=world, stack=pos)
    packed = [(angles[0] & 0xffff) | ((angles[1] & 0xffff) << 16), angles[2] & 0xffff]
    e.call(0x3a2bc, eax=world, stack=packed)


def logo_scene():
    """Part 1: init 0x21db4's calls, then the camera of run 0x21f44 at several elapsed frames."""
    e = Emu()
    world = new_world(e)
    e.call(0x3a66c, eax=world, edx=0x400)
    e.call(0x3a714, eax=world, edx=-5000)
    e.call(0x3a7b4, eax=world, edx=3000)
    e.call(0x3a114, eax=world, stack=(-2500, 1250, 2350))
    logo = load_object(e, 'logo.eob')
    e.call(0x39a2c, eax=logo, stack=(0, 0, 2000))
    e.call(0x3a590, eax=world, edx=logo)
    e.call(0x39ad0, eax=logo, edx=1)
    e.call(0x39ad0, eax=logo, edx=1)
    e.call(0x39bfc, eax=logo, edx=1)
    e.call(0x3a598, eax=world, edx=3)
    e.call(0x3a5b4, eax=world, edx=3)
    frames = []
    for elapsed in (0, 20, 45, 80, 120, 150, 176):
        e.call(0x3a114, eax=world, stack=(-2150 + 23 * elapsed, 1250, 2350 - 3 * elapsed))
        frames.append({'elapsed': elapsed, 'crc': render(e, world)})
    return {'phongMaps': phong_map_crcs(e, logo), 'frames': frames}


def posed_scene(name, scales, key_scales, seed, poses, fast_path=False, distance=(200, 900), draw=None):
    """An object at random positions / angles / animation times in front of a random camera."""
    e = Emu()
    world = new_world(e)
    if fast_path:
        e.w32(world + 0xb8, 1)
    obj = load_object(e, name)
    if draw:
        e.call(0x246d0, eax=obj, edx=draw)
    e.call(0x3a590, eax=world, edx=obj)
    for s in scales:
        e.call(0x39ad0, eax=obj, edx=s)
    for s in key_scales:
        e.call(0x39bfc, eax=obj, edx=s)
    e.call(0x3a598, eax=world)
    e.call(0x3a5b4, eax=world, edx=3)
    length = e.call(0x39e30, eax=obj)
    rng = XorShift(seed)
    frames = []
    for _ in range(poses):
        time = rng.int(0, length) if length else 0
        cam = (rng.int(-100, 100), rng.int(-100, 100), rng.int(-100, 100))
        cam_angles = (rng.int(-200, 200), rng.int(-200, 200), rng.int(-400, 400))
        pos = (rng.int(-150, 150), rng.int(-150, 150), rng.int(*distance))
        angles = (rng.int(0, 4095), rng.int(0, 4095), rng.int(0, 4095))
        if length:
            e.call(0x39e08, eax=obj, edx=time)
        e.call(0x39a2c, eax=obj, stack=pos)
        e.call(0x39b30, eax=obj, stack=[angles[0] | (angles[1] << 16), angles[2]])
        set_camera(e, world, cam, cam_angles)
        frames.append(render(e, world))
    return {'phongMaps': phong_map_crcs(e, obj), 'frames': frames}


# --- rasterisers on random polygons ---------------------------------------------------------------

BIG_COLOUR_TABLE_BYTES = 0x10000
RASTER_CASES = 400


def big_colour_table_pattern():
    return bytes((((i * 2654435761) & M32) >> 24) for i in range(BIG_COLOUR_TABLE_BYTES))


def phong_pattern():
    return bytes((((i * 40503) & M32) >> 8) & 127 for i in range(0x10000))


def random_polygon(rng, n):
    """Vertices (sx, sy, nx, ny, u, v), then nz, ambient and colour base: the order the JS test draws them in."""
    reach = (10, 100, 300)[rng.int(0, 2)]
    verts = []
    for _ in range(n):
        if rng.int(0, 9) < 3:
            sx, sy = rng.int(0, 319), rng.int(0, 199)
        else:
            sx, sy = rng.int(-reach, 320 + reach), rng.int(-reach, 200 + reach)
        verts.append([sx, sy, rng.int(-256, 256), rng.int(-256, 256), rng.int(0, 255), rng.int(0, 255)])
    if rng.int(0, 9) == 0:
        verts[1][1] = verts[0][1]
    nz = rng.int(-300, 300)
    ambient = (0, 0x10, 0x40, 0x80, 0xff)[rng.int(0, 4)]
    base = rng.int(0, 255)
    return verts, nz, ambient, base


def raster_cases(routine, seed, sides, has_depth=False):
    e = Emu()
    e.wb(COLOUR_TABLE, big_colour_table_pattern())
    e.w32(0x89dcc, TARGET)
    vb = e.alloc(8 * 0x24)
    e.w32(0x89dd0, vb)
    texture = open(os.path.join(RES, 'skultxt.raw'), 'rb').read()[0x300:]
    mat = e.alloc(0x30)
    normal = e.alloc(12)
    poly = e.alloc(0xa4)
    e.w32(mat + 0x10, e.alloc(0x10000, texture))
    e.w32(mat + 0x14, e.alloc(0x10000, phong_pattern()))
    e.w32(mat + 0x0c, COLOUR_TABLE)
    e.w32(mat + 0x1c, 256)
    e.w32(mat + 0x20, 256)
    rng = XorShift(seed)
    out = []
    for _ in range(RASTER_CASES):
        n = sides[rng.int(0, len(sides) - 1)]
        verts, nz, ambient, base = random_polygon(rng, n)
        depths = [rng.int(20, 3000) if has_depth else 100 for _ in verts]
        record = bytearray(0xa4)
        struct.pack_into('<i', record, 4, n)
        for i, (sx, sy, nx, ny, u, v) in enumerate(verts):
            e.wb(vb + i * 0x24, struct.pack('<9i', 0, 0, depths[i], nx, ny, 0, sx, sy, 1))
            struct.pack_into('<3i', record, 8 + 0x18 * i, i, u, v)
        struct.pack_into('<II', record, 0x80, mat, normal)
        e.wb(poly, record)
        e.w32(normal + 8, nz)
        e.w32(mat + 4, ambient)
        e.wb(mat + 8, struct.pack('<h', base))
        e.wb(TARGET, background_pattern())
        e.call(routine, eax=poly)
        out.append(crc(e.rb(TARGET, SCREEN)))
    return out


# --- triangle engine ---------------------------------------------------------------------------------

TRIANGLE_CASES = 400


def triangle_cases(seed, is_sided):
    """0x43654 + 0x764a2 (or 0x437c4 + 0x43cf8: CRC of the row tables) on random triangles."""
    e = Emu()
    e.call(0x76a3c, eax=320, edx=200, ebx=TARGET)
    texture = e.alloc(0x20000, bytes((((i * 2246822519) & M32) >> 24) for i in range(0x20000)))
    verts = [e.alloc(0x40) for _ in range(3)]
    rng = XorShift(seed)
    out = []
    for _ in range(TRIANGLE_CASES):
        reach = (10, 100, 250)[rng.int(0, 2)]
        for p in verts:
            if rng.int(0, 9) < 4:
                sx, sy = rng.int(0, 319), rng.int(0, 199)
            else:
                sx, sy = rng.int(-reach, 320 + reach), rng.int(-reach, 200 + reach)
            fields = [rng.int(-1000, 1000) for _ in range(6)] + [sx, sy, rng.int(0, 120), rng.int(0, 255), rng.int(-500, 500), rng.int(-500, 500)]
            e.wb(p, struct.pack('<12i', *fields))
        if is_sided:
            e.call(0x437c4, eax=verts[0], edx=verts[1], ebx=verts[2], ecx=0x43cf8)
            state = e.rb(0x89f40, 0x18) + e.rb(0x11283c, 32 * 202) + e.rb(0x11683c, 32 * 202)
            out.append(crc(state))
        else:
            e.wb(TARGET, background_pattern())
            e.call(0x43654, eax=verts[0], edx=verts[1], ebx=verts[2], ecx=0x439cc)
            e.call(0x764a2, eax=texture)
            out.append(crc(e.rb(TARGET, SCREEN) + e.rb(0x89f40, 8)))
    return out


def rotate_project_cases(seed):
    e = Emu()
    verts = e.alloc(0x40 * 16)
    rng = XorShift(seed)
    out = []
    for _ in range(40):
        for k in range(16):
            e.wb(verts + 0x40 * k, struct.pack('<3i', rng.int(-0x8000, 0x8000), rng.int(-0x8000, 0x8000), rng.int(-0x8000, 0x8000)))
        a, b, c = rng.int(0, 1023), rng.int(0, 1023), rng.int(0, 1023)
        distance = rng.int(0x1000, 0x400000)
        e.w32(0x89f18, distance)
        e.call(0x43450, eax=verts, edx=16, ebx=a, ecx=b, stack=(c,))
        e.call(0x435e8, eax=verts, edx=16, ebx=160, ecx=100)
        out.append(crc(e.rb(verts, 0x40 * 16)))
    return out


# --- projector ---------------------------------------------------------------------------------------

def light_map_pattern():
    return [(i * 7919) % 0x2800 for i in range(0x10000)]


def film_pattern():
    return bytes(((i * 37) >> 3) & 63 for i in range(0x2800))


def projector_scene(seed, poses):
    """Parts 3/5: the skull drawn by 0x457f0 with a view world and a projector world."""
    e = Emu()
    view = new_world(e)
    light = e.call(0x39e68, eax=30, edx=0x76c, ebx=0xa8c, ecx=0xa8c)
    e.w32(view + 0xb8, 1)
    skull = load_object(e, 'skull.eob')
    e.call(0x3a590, eax=view, edx=skull)
    e.call(0x39ad0, eax=skull, edx=1)
    e.call(0x39ad0, eax=skull, edx=0x20)
    e.call(0x39bfc, eax=skull, edx=0x20)
    e.call(0x3a598, eax=view)
    e.call(0x3a5b4, eax=view, edx=3)
    e.call(0x3a5b4, eax=light, edx=3)
    e.call(0x246d0, eax=skull, edx=0x46d08)
    depth = e.alloc(0x40000)
    e.w32(0x11a878, depth)
    e.w32(0x11a880, e.alloc(0x40000, struct.pack('<65536I', *light_map_pattern())))
    e.w32(0x11a870, e.alloc(0x2800, film_pattern()))
    rng = XorShift(seed)
    frames = []
    for frame_id in range(poses):
        e.w32(0x11a87c, frame_id & 255)
        pos = (rng.int(-150, 150), rng.int(-150, 150), rng.int(400, 1500))
        angles = (rng.int(0, 4095), rng.int(0, 4095), rng.int(0, 4095))
        e.call(0x39a2c, eax=skull, stack=pos)
        e.call(0x39b30, eax=skull, stack=[angles[0] | (angles[1] << 16), angles[2]])
        cam = (rng.int(-100, 100), rng.int(-100, 100), rng.int(-100, 100))
        cam_angles = (rng.int(-100, 100), rng.int(-100, 100), rng.int(-400, 400))
        set_camera(e, view, cam, cam_angles)
        set_camera(e, light, tuple(c + rng.int(-200, 200) for c in cam), tuple(a + rng.int(-60, 60) for a in cam_angles))
        e.wb(TARGET, background_pattern())
        e.call(0x457f0, eax=view, edx=light)
        frames.append(crc(e.rb(TARGET, SCREEN) + e.rb(depth, 0x40000)))
    return frames


# --- recordings --------------------------------------------------------------------------------------

def orbit_camera_frames(seed, frames):
    """Part 0's camera: camera.rec through 0x26d44 quadratics and 0x26e1c, dt of 1..3 frames."""
    e = Emu()
    world = new_world(e)
    spider = e.alloc(0xb4)
    rec = open(os.path.join(RES, 'camera.rec'), 'rb').read()
    records = [struct.unpack_from('<4i', rec, 16 * i) for i in range(len(rec) // 16)]
    quads = e.alloc(0x80)
    state = e.alloc(16, struct.pack('<4i', 0, 0, 0, 0x251c))
    player = e.alloc(12)

    def build(first):
        for c in range(4):
            e.call(0x26d44, eax=records[first][c], edx=records[first + 1][c], ebx=records[first + 2][c], ecx=16,
                   stack=(quads + 0x20 * c,))

    build(0)
    rng = XorShift(seed)
    acc = index = frac = 0
    out = []
    for _ in range(frames):
        e.call(0x39a2c, eax=spider, stack=(rng.int(-3000, 3000), 0, rng.int(-3000, 3000)))
        e.w32(player + 8, frac)
        e.call(0x26e1c, eax=state, edx=spider, ebx=player, ecx=quads, stack=(world, 1))
        out.append(crc(e.rb(state, 16) + e.rb(world + 4, 0x12) + e.rb(world + 0x3c, 0x60)))
        acc += rng.int(1, 3)
        while acc >= 16:
            build(index)
            index += 1
            acc -= 16
        frac = acc & 15
    return out


def film_frames():
    e = Emu()
    rap = open(os.path.join(RES, 'teeth.rap'), 'rb').read()
    src = e.alloc(len(rap), rap)
    dst = e.alloc(0x2800)
    out = []
    for frame in range(36):
        e.call(0x49028, esi=src + frame * 0x1400, edi=dst)
        out.append(crc(e.rb(dst, 0x2800)))
    return out


def quad_frames(seed, frames):
    """0x27cac(withBack=1) on a patterned VGA and a patterned back picture, then the quad moved and
    turned as the transitions do, drawn by RenderWorld (0x36890 on both faces)."""
    e = Emu()
    e.wb(COLOUR_TABLE, colour_table_pattern())
    e.wb(0xa0000, background_pattern())
    back = e.alloc(0x10000, bytes(((i * 13) ^ (i >> 8)) & 255 for i in range(0x10000)))
    e.w32(0x83464, back)
    e.call(0x27cac, eax=1)
    world = e.r32(0xe3cf0)
    quad = 0x835b8
    rng = XorShift(seed)
    out = []
    for _ in range(frames):
        e.call(0x39a2c, eax=quad, stack=(rng.int(-300, 300), rng.int(-300, 300), rng.int(-200, 1200)))
        e.call(0x39a70, eax=quad, edx=rng.int(0, 4095))
        e.call(0x39a78, eax=quad, edx=rng.int(0, 4095))
        e.call(0x39a80, eax=quad, edx=rng.int(0, 4095))
        out.append(render(e, world))
    return out


def main():
    fixtures = {
        'logo': logo_scene(),
        'spider': posed_scene('spider.eob', (1, 1), (1,), 11, 12),
        'spiderNear': posed_scene('spider.eob', (1, 1), (1,), 12, 12, distance=(-50, 250)),
        'skull': posed_scene('skull.eob', (1, 0x20), (0x20,), 13, 12, distance=(300, 1500)),
        'skullFast': posed_scene('skull.eob', (1, 0x20), (0x20,), 14, 12, fast_path=True, distance=(300, 1500)),
        'robot': posed_scene('en_obj.eob', (1, 1), (1,), 15, 12, distance=(300, 1200)),
        'robotNear': posed_scene('en_obj.eob', (1, 1), (1,), 16, 12, distance=(-50, 300)),
        'skullPerspective': posed_scene('skull.eob', (1, 0x20), (0x20,), 17, 12, distance=(300, 1500), draw=0x36890),
        # near-clipped quads drawn by 0x44354, whose slot[n] = slot[0] write makes Draw's fan degenerate
        'spiderNearPhongFlat': posed_scene('spider.eob', (1, 1), (1,), 18, 24, distance=(-50, 250), draw=0x44354),
        'raster': {
            'flat': raster_cases(0x28b60, 21, (3, 3, 4, 5)),
            'shadedByV': raster_cases(0x29994, 22, (3,)),
            'phong': raster_cases(0x2c118, 23, (3,)),
            'phongFlat': raster_cases(0x44354, 24, (3, 3, 4)),
            'texture': raster_cases(0x331b4, 25, (3,)),
            'texturePhong': raster_cases(0x35860, 26, (3,)),
            'perspective': raster_cases(0x36890, 27, (3,), has_depth=True),
        },
        'triangles': triangle_cases(31, False),
        'sidedTriangles': triangle_cases(32, True),
        'rotateProject': rotate_project_cases(33),
        'projector': projector_scene(41, 24),
        'orbitCamera': orbit_camera_frames(51, 600),
        'film': film_frames(),
        'quad': quad_frames(61, 40),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(fixtures, f, separators=(',', ':'))
    print('wrote', os.path.normpath(OUT))


if __name__ == '__main__':
    main()
