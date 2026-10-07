# Runs the rasterisers of EUPHORIA.EXE (graphics unit, segment 186a) in Unicorn, real mode.
# Only what they read is set up: the DS globals, a fake heap for GetMem/FreeMem, the pages, a stack.
# Every call returns to a HLT stub. Segments below are the program's own (as in the listing); the
# image is loaded at LOAD, so the emulated segment is SEG + LOAD.
import os, struct
from unicorn import Uc, UC_ARCH_X86, UC_MODE_16, UC_HOOK_CODE, UC_HOOK_BLOCK
from unicorn.x86_const import *

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
LOAD = 0x1000
GFX = 0x186a
RTL = 0x1d81
DS = 0x2220
IMAGE_END = 0x273f0

# Where the harness puts things (emulated segments, outside the image and its BSS).
VERTSEG = 0x4300   # polygon vertices and the texture descriptor
HEAPSEG = 0x6000   # GetMem: one block per call, each in its own 64 KB segment from here
TEXSEG = 0x8000    # the texture page
PAGESEG = 0x9000   # the active page (draw target)
STUBSEG = 0x4400   # HLT
STACKSEG = 0x4500
PAGE_BYTES = 0x10000
TEXTURE_PAGE = 2
ACTIVE_PAGE = 1

ADDR = {
    'width': 0x5bf0, 'height': 0x5bf2, 'clip': 0x5bfa, 'modeX': 0x5c02, 'emsOk': 0x5c1c,
    'active': 0x5c22, 'pages': 0x5c2a, 'pageSet': 0x5d5a, 'gradStep': 0x9118, 'spanFn': 0x911a,
    'lineOfs': 0x9122, 'litTab': 0x90bc, 'zbufMode': 0x9fa4, 'convPages': 0x255e,
}
SPANS = {'solid': 0x1689, 'gradient': 0x16c1, 'additive': 0x16fa}


def load_image():
    d = open(os.path.join(ROOT, 'EUPHORIA.EXE'), 'rb').read()
    h = struct.unpack('<14H', d[:28])
    img = bytearray(d[h[4] * 16:IMAGE_END])
    for i in range(h[3]):
        off, seg = struct.unpack('<HH', d[h[12] + 4 * i:h[12] + 4 * i + 4])
        lin = seg * 16 + off
        v = struct.unpack('<H', img[lin:lin + 2])[0]
        img[lin:lin + 2] = struct.pack('<H', (v + LOAD) & 0xffff)
    return img


def patch_fpu_emulator(buf, start, end):
    """The 8087-emulator interrupts (INT 34h..3Dh) -> the FPU opcodes they stand for."""
    i, n = start, 0
    while i < end - 2:
        if buf[i] == 0xcd and 0x34 <= buf[i + 1] <= 0x3b:
            buf[i] = 0x9b; buf[i + 1] += 0xa4; i += 2; n += 1; continue
        if buf[i] == 0xcd and buf[i + 1] == 0x3c:
            b = buf[i + 2]; buf[i] = 0x9b; buf[i + 1] = [0x3e, 0x36, 0x2e, 0x26][b >> 6]; buf[i + 2] = 0xd8 | (b & 7)
            i += 3; n += 1; continue
        if buf[i] == 0xcd and buf[i + 1] == 0x3d:
            buf[i] = 0x90; buf[i + 1] = 0x9b; i += 2; n += 1; continue
        i += 1
    return n


def lin(seg, off):
    return seg * 16 + off


class Emu:
    def __init__(self):
        img = load_image()
        # only the graphics unit uses the FPU here (line 185f)
        patch_fpu_emulator(img, GFX * 16, GFX * 16 + 0x3c9c)
        u = self.u = Uc(UC_ARCH_X86, UC_MODE_16)
        u.mem_map(0, 0x110000)
        u.mem_write(LOAD * 16, bytes(img))
        u.mem_write(lin(STUBSEG, 0), b'\xf4')
        self.heap = []      # live blocks: (seg, size)
        self.leaks = 0
        self.entries = None  # after trace(): the set of (seg, off) of every basic block run
        u.hook_add(UC_HOOK_CODE, self._getmem, begin=lin(RTL + LOAD, 0x028a), end=lin(RTL + LOAD, 0x028a))
        u.hook_add(UC_HOOK_CODE, self._freemem, begin=lin(RTL + LOAD, 0x029f), end=lin(RTL + LOAD, 0x029f))
        self._fninit()
        self._globals()

    # ---- memory helpers ----
    def w16(self, seg, off, v):
        self.u.mem_write(lin(seg, off), struct.pack('<H', v & 0xffff))

    def r16(self, seg, off):
        return struct.unpack('<H', self.u.mem_read(lin(seg, off), 2))[0]

    def ds(self, off, data):
        self.u.mem_write(lin(DS + LOAD, off), bytes(data))

    def _fninit(self):
        """fninit; fldcw 1332h: the control word the RTL sets on a 387 (1d81:3000)."""
        code = b'\xdb\xe3\x2e\xd9\x2e\x20\x00\xf4'
        self.u.mem_write(lin(STUBSEG, 0x10), code)
        self.u.mem_write(lin(STUBSEG, 0x20), struct.pack('<H', 0x1332))
        self.u.reg_write(UC_X86_REG_CS, STUBSEG)
        self.u.emu_start(lin(STUBSEG, 0x10), lin(STUBSEG, 0x17))

    def _globals(self):
        a = ADDR
        self.ds(a['width'], struct.pack('<HH', 320, 200))
        self.ds(a['lineOfs'], b''.join(struct.pack('<i', y * 320) for y in range(201)))
        self.ds(a['modeX'], b'\0')
        self.ds(a['emsOk'], b'\0')
        self.ds(a['zbufMode'], b'\0')
        self.ds(a['convPages'], b'\x64')
        self.ds(a['active'], struct.pack('<HH', 0, PAGESEG))
        pages = bytearray(32)
        pages[TEXTURE_PAGE >> 3] |= 1 << (TEXTURE_PAGE & 7)
        pages[ACTIVE_PAGE >> 3] |= 1 << (ACTIVE_PAGE & 7)
        self.ds(a['pageSet'], pages)
        self.ds(a['pages'] + 4 * TEXTURE_PAGE, struct.pack('<HH', 0, TEXSEG))
        self.ds(a['pages'] + 4 * ACTIVE_PAGE, struct.pack('<HH', 0, PAGESEG))

    def set_clip(self, left, top, right, bottom):
        self.ds(ADDR['clip'], struct.pack('<hhhh', left, top, right, bottom))

    def set_span(self, name):
        self.ds(ADDR['spanFn'], struct.pack('<HH', SPANS[name], GFX + LOAD))

    def set_grad_step(self, v):
        self.ds(ADDR['gradStep'], struct.pack('<H', v))

    def set_lit_table(self, t):
        assert len(t) == 91
        self.ds(ADDR['litTab'], t)

    def set_page(self, data):
        self.u.mem_write(lin(PAGESEG, 0), bytes(data))

    def page(self):
        return bytes(self.u.mem_read(lin(PAGESEG, 0), PAGE_BYTES))

    def set_texture_page(self, data):
        self.u.mem_write(lin(TEXSEG, 0), bytes(data))

    def set_vertices(self, verts):
        """verts: [(x, y, c)], written as 8-byte records at VERTSEG:0. Returns the far pointer."""
        raw = b''.join(struct.pack('<hhhh', x, y, c, 0) for x, y, c in verts)
        self.u.mem_write(lin(VERTSEG, 0), raw)
        return (VERTSEG, 0)

    def set_texture(self, page, u0, v0, w, h):
        """A 7-byte descriptor as 186a:3a14 fills it, at VERTSEG:0x100."""
        raw = struct.pack('<HHBH', w, h, page, ((v0 << 8) + u0) & 0xffff)
        self.u.mem_write(lin(VERTSEG, 0x100), raw)
        return (VERTSEG, 0x100)

    # ---- the fake heap ----
    def _ret(self, argbytes, ax=None, dx=None):
        u = self.u
        ss = u.reg_read(UC_X86_REG_SS); sp = u.reg_read(UC_X86_REG_SP)
        ip = self.r16(ss, sp); cs = self.r16(ss, sp + 2)
        u.reg_write(UC_X86_REG_SP, sp + 4 + argbytes)
        if ax is not None:
            u.reg_write(UC_X86_REG_AX, ax)
        if dx is not None:
            u.reg_write(UC_X86_REG_DX, dx)
        u.reg_write(UC_X86_REG_CS, cs)
        u.reg_write(UC_X86_REG_IP, ip)

    def _getmem(self, u, addr, size, _):
        ss = u.reg_read(UC_X86_REG_SS); sp = u.reg_read(UC_X86_REG_SP)
        n = self.r16(ss, sp + 4)
        seg = HEAPSEG + 0x1000 * len(self.heap)
        assert seg < TEXSEG, 'heap exhausted'
        # garbage, so that a read of an uninitialised byte would show
        u.mem_write(lin(seg, 0), bytes((i * 37 + 11) & 0xff for i in range(0x10000)))
        self.heap.append((seg, n))
        self._ret(2, ax=0, dx=seg)

    def _freemem(self, u, addr, size, _):
        ss = u.reg_read(UC_X86_REG_SS); sp = u.reg_read(UC_X86_REG_SP)
        n = self.r16(ss, sp + 4); off = self.r16(ss, sp + 6); seg = self.r16(ss, sp + 8)
        assert (seg, n) in self.heap and off == 0, 'FreeMem of a block not from GetMem: %x:%x %d' % (seg, off, n)
        self.heap.remove((seg, n))
        self._ret(6)

    def trace(self):
        """Records every basic block from now on (slow): which code the routines actually run."""
        self.entries = set()
        self.u.hook_add(UC_HOOK_BLOCK, self._block)

    def _block(self, u, addr, size, _):
        cs = u.reg_read(UC_X86_REG_CS) - LOAD
        self.entries.add((cs, u.reg_read(UC_X86_REG_IP)))

    # ---- calling ----
    def call(self, off, args, edi_hi=0, seg=GFX):
        """Far call seg:off with Pascal args (pushed left to right, words), returning to the HLT stub."""
        u = self.u
        self.heap = []
        sp = 0xfff0
        stack = b''.join(struct.pack('<H', a & 0xffff) for a in reversed(args))
        stack = struct.pack('<HH', 0, STUBSEG) + stack
        sp -= len(stack)
        u.mem_write(lin(STACKSEG, sp), stack)
        u.reg_write(UC_X86_REG_SS, STACKSEG); u.reg_write(UC_X86_REG_SP, sp)
        u.reg_write(UC_X86_REG_DS, DS + LOAD); u.reg_write(UC_X86_REG_ES, DS + LOAD)
        u.reg_write(UC_X86_REG_EDI, (edi_hi & 0xffff) << 16)
        u.reg_write(UC_X86_REG_CS, seg + LOAD); u.reg_write(UC_X86_REG_IP, off)
        u.emu_start(lin(seg + LOAD, off), lin(STUBSEG, 0), count=200_000_000)
        assert u.reg_read(UC_X86_REG_CS) == STUBSEG and u.reg_read(UC_X86_REG_IP) == 0, 'did not return'
        assert u.reg_read(UC_X86_REG_SP) == 0xfff0, 'stack not balanced'
        self.leaks = len(self.heap)
        return (u.reg_read(UC_X86_REG_EDI) >> 16) & 0xffff

    # ---- the routines ----
    def flat_poly(self, verts, cyc_lo, cyc_hi, color):
        s, o = self.set_vertices(verts)
        self.call(0x1d02, [s, o, len(verts), cyc_lo, cyc_hi, color])

    def gouraud_poly(self, verts, bias, edi_hi):
        s, o = self.set_vertices(verts)
        return self.call(0x21bf, [s, o, len(verts), bias, 0, 0], edi_hi=edi_hi)

    def phong_poly(self, verts):
        s, o = self.set_vertices(verts)
        self.call(0x2774, [s, o, len(verts)])

    def tex_quad(self, verts, tex, mirrored=False, lit=False):
        s, o = self.set_vertices(verts)
        ts, to = self.set_texture(TEXTURE_PAGE, *tex)
        if lit:
            self.call(0x381f if mirrored else 0x366b, [s, o, ts, to])
        else:
            self.call(0x34d7 if mirrored else 0x3343, [s, o, ts, to, 0])

    def line(self, x1, y1, x2, y2, c):
        self.call(0x185f, [x1, y1, x2, y2, c])
