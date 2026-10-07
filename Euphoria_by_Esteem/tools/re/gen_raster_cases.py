# Random cases for the rasterisers, run through the original machine code (emu.py), written to
# test/fixtures/raster-cases.json for test/raster.test.js.
# usage: python gen_raster_cases.py [--trace]
#   --trace: also lists every function of the program the routines entered (slow), to show that they
#            call nothing the harness does not provide.
import hashlib, json, os, random, sys
from emu import Emu, ROOT

SEED = 1995
OUT = os.path.join(ROOT, 'test', 'fixtures', 'raster-cases.json')
TRANSPARENT_BELOW = 40


def noise(seed, count):
    """xorshift32, the same generator as test/raster.test.js."""
    out = bytearray(count)
    s = seed
    for i in range(count):
        s ^= (s << 13) & 0xffffffff
        s ^= s >> 17
        s ^= (s << 5) & 0xffffffff
        out[i] = s & 0xff
    return out


BACKGROUND = noise(3, 0x10000)
TEXTURE = bytes(0 if b < TRANSPARENT_BELOW else b for b in noise(1, 0x10000))
LIT_TABLE = noise(2, 91)

rnd = random.Random(SEED)


def clip_rect():
    if rnd.random() < 0.4:
        return [0, 0, 319, 199]
    l, r = sorted(rnd.randint(0, 319) for _ in range(2))
    t, b = sorted(rnd.randint(0, 199) for _ in range(2))
    return [l, t, r, b]


def coord(lo, hi, wide):
    """Mostly near the clip range lo..hi, sometimes far outside it."""
    if rnd.random() < wide:
        return rnd.randint(lo - 300, hi + 300)
    return rnd.randint(lo - 30, hi + 30)


def point(clip, wide):
    return coord(clip[0], clip[2], wide), coord(clip[1], clip[3], wide)


def polygon(n, shade, clip):
    """4 records (x, y, c); n = 3 keeps a 4th record as the engine does (a copy of the 3rd)."""
    kind = rnd.random()
    if kind < 0.15:   # small
        cx, cy = point(clip, 0)
        pts = [(cx + rnd.randint(-6, 6), cy + rnd.randint(-6, 6)) for _ in range(n)]
    elif kind < 0.22:  # degenerate: a point, a horizontal line, or collinear
        x, y = point(clip, 0)
        sub = rnd.randint(0, 2)
        if sub == 0:
            pts = [(x, y)] * n
        elif sub == 1:
            pts = [(point(clip, 0)[0], y) for _ in range(n)]
        else:
            dx, dy = rnd.randint(-5, 5), rnd.randint(-5, 5)
            pts = [(x + k * dx, y + k * dy) for k in range(n)]
    elif kind < 0.3:  # in the whole screen, whatever the clip
        pts = [point([0, 0, 319, 199], 0.1) for _ in range(n)]
    else:
        pts = [point(clip, 0.1) for _ in range(n)]
    verts = [[x, y, shade()] for x, y in pts]
    if n == 3:
        verts.append(list(verts[2]) if rnd.random() < 0.7 else [*point(clip, 0.2), shade()])
    return verts


def page_sha1(e):
    return hashlib.sha1(e.page()).hexdigest()


def prepare(e, case):
    e.set_page(BACKGROUND)
    e.set_clip(*case['clip'])


def flat_cases(e, count):
    out = []
    for i in range(count):
        span = ('solid', 'gradient', 'additive')[i % 3]
        n = rnd.choice((3, 4))
        case = {'routine': 'flat', 'span': span, 'clip': clip_rect(), 'n': n, 'v': None}
        case['v'] = polygon(n, lambda: rnd.randint(0, 255), case['clip'])
        if rnd.random() < 0.5:
            case['cyc'] = [0, 0]
        else:
            case['cyc'] = [rnd.randint(0, 255), rnd.randint(0, 255)]
        case['color'] = rnd.randint(0, 255)
        case['gradStep'] = rnd.choice((1, 0x40, 0x100, rnd.randint(0, 0xffff)))
        prepare(e, case)
        e.set_span(span)
        e.set_grad_step(case['gradStep'])
        e.flat_poly(case['v'][:n], case['cyc'][0], case['cyc'][1], case['color'])
        case['sha1'] = page_sha1(e)
        out.append(case)
    e.set_span('solid')
    return out


def gouraud_cases(e, count):
    out = []
    for _ in range(count):
        n = rnd.choice((3, 4))
        case = {'routine': 'gouraud', 'clip': clip_rect(), 'n': n, 'v': None}
        case['v'] = polygon(n, lambda: rnd.randint(-40, 300), case['clip'])
        case['bias'] = 0 if rnd.random() < 0.7 else rnd.randint(-50, 50)
        case['fraction'] = rnd.randint(0, 0xffff)
        prepare(e, case)
        e.set_vertices(case['v'])
        case['fractionAfter'] = e.gouraud_poly(case['v'][:n], case['bias'], case['fraction'])
        case['sha1'] = page_sha1(e)
        out.append(case)
    return out


def phong_cases(e, count):
    out = []
    e.set_lit_table(LIT_TABLE)
    for _ in range(count):
        n = rnd.choice((3, 4))
        case = {'routine': 'phong', 'clip': clip_rect(), 'n': n, 'v': None}
        case['v'] = polygon(n, lambda: rnd.randint(0, 90), case['clip'])
        prepare(e, case)
        e.set_vertices(case['v'])
        e.phong_poly(case['v'][:n])
        case['sha1'] = page_sha1(e)
        out.append(case)
    return out


def texture_rect():
    w = rnd.choice((rnd.randint(1, 256), rnd.randint(1, 64), 192))
    h = rnd.choice((rnd.randint(1, 200), rnd.randint(1, 64), 150))
    return [rnd.randint(0, 256 - min(w, 256)), rnd.randint(0, 200 - min(h, 200)), w, h]


def texture_cases(e, count, mirrored, lit):
    out = []
    e.set_texture_page(TEXTURE)
    e.set_lit_table(LIT_TABLE)
    for _ in range(count):
        case = {'routine': 'texture', 'mirrored': mirrored, 'lit': lit, 'clip': clip_rect(),
                'v': None, 'tex': texture_rect()}
        case['v'] = polygon(4, lambda: rnd.randint(0, 90), case['clip'])
        prepare(e, case)
        e.tex_quad(case['v'], case['tex'], mirrored=mirrored, lit=lit)
        case['sha1'] = page_sha1(e)
        out.append(case)
    return out


def line_cases(e, count):
    out = []
    for _ in range(count):
        clip = clip_rect()
        x, y = point(clip, 0.3)
        k = rnd.random()
        if k < 0.1:
            pts = [x, y, x, point(clip, 0.3)[1]]
        elif k < 0.2:
            pts = [x, y, point(clip, 0.3)[0], y]
        else:
            pts = [x, y, *point(clip, 0.3)]
        case = {'routine': 'line', 'clip': clip, 'p': pts, 'color': rnd.randint(0, 255)}
        prepare(e, case)
        e.line(*pts, case['color'])
        case['sha1'] = page_sha1(e)
        out.append(case)
    return out


def print_code_ranges(e):
    """The code the routines ran, as runs of basic blocks per segment (a gap > 0x40 starts a new run)."""
    for seg in sorted({s for s, _ in e.entries}):
        offs = sorted(o for s, o in e.entries if s == seg)
        runs = [[offs[0], offs[0]]]
        for o in offs[1:]:
            if o - runs[-1][1] > 0x40:
                runs.append([o, o])
            else:
                runs[-1][1] = o
        print('%04x:' % seg, ' '.join('%04x-%04x' % (a, b) for a, b in runs))


def main():
    e = Emu()
    if '--trace' in sys.argv:
        e.trace()
    cases = []
    cases += flat_cases(e, 1500)
    cases += gouraud_cases(e, 800)
    cases += phong_cases(e, 600)
    for mirrored in (False, True):
        for lit in (False, True):
            cases += texture_cases(e, 400, mirrored, lit)
    cases += line_cases(e, 1000)
    if e.entries is not None:
        print_code_ranges(e)
    with open(OUT, 'w') as f:
        f.write('[\n' + ',\n'.join(json.dumps(c, separators=(',', ':')) for c in cases) + '\n]\n')
    print(len(cases), 'cases ->', OUT)


if __name__ == '__main__':
    main()
