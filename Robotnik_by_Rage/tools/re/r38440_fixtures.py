# Ground truth for test/r38440.test.js: the depth-cued perspective texture mapper 0x38440 run in
# unicorn on random triangles (the same inputs as engine_fixtures.raster_cases, depths up to 40000 so
# that the cue wraps past row 127, material +0x28 = depth shift), CRC32 of each drawn screen.
#   $P r38440_fixtures.py            (from tools/re, with capstone and unicorn installed)
import json, os, struct
from engine_fixtures import (Emu, XorShift, random_polygon, big_colour_table_pattern, background_pattern,
                             crc, COLOUR_TABLE, TARGET, SCREEN, RES)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'test', 'fixtures', 'r38440.json')
CASES = 300
ROUTINE = 0x38440


def depth_cued_cases(seed, shift):
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
    e.w32(mat + 0x0c, COLOUR_TABLE)
    e.w32(mat + 0x28, shift)
    rng = XorShift(seed)
    out = []
    for _ in range(CASES):
        verts, _nz, _ambient, _base = random_polygon(rng, 3)
        depths = [rng.int(20, 40000) for _ in verts]
        record = bytearray(0xa4)
        struct.pack_into('<i', record, 4, 3)
        for i, (sx, sy, nx, ny, u, v) in enumerate(verts):
            e.wb(vb + i * 0x24, struct.pack('<9i', 0, 0, depths[i], nx, ny, 0, sx, sy, 1))
            struct.pack_into('<3i', record, 8 + 0x18 * i, i, u, v)
        struct.pack_into('<II', record, 0x80, mat, normal)
        e.wb(poly, record)
        e.wb(TARGET, background_pattern())
        e.call(ROUTINE, eax=poly)
        out.append(crc(e.rb(TARGET, SCREEN)))
    return out


def main():
    fixtures = {'shift0': depth_cued_cases(71, 0), 'shift1': depth_cued_cases(72, 1)}
    with open(OUT, 'w') as f:
        json.dump(fixtures, f, separators=(',', ':'))
    print('wrote', os.path.normpath(OUT))


if __name__ == '__main__':
    main()
