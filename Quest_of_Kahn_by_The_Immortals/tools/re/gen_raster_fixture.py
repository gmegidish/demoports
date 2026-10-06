# Build test/fixtures/raster-cases.json from the emulator-verified Python models in re/A.
import sys, json, random, hashlib
sys.path.insert(0, sys.argv[1])
import model_span, model_tri, model_sprite
from model_span import fround
MARGIN = 0x10000
def noise(seed, n):            # xorshift32, the same generator the JS test uses
    out = bytearray(n); s = seed
    for i in range(n):
        s ^= (s << 13) & 0xffffffff; s ^= s >> 17; s ^= (s << 5) & 0xffffffff
        out[i] = s & 0xff
    return bytes(out)
tex = noise(1, 65536); table = noise(2, 65536); bg = noise(3, 64000)
keyed = bytes(0 if b < 50 else b for b in tex)   # texture with transparent texels for the keyed variant
def fresh(): return bytearray(MARGIN) + bytearray(bg) + bytearray(0x40000 - MARGIN - 64000)
def digest(fb):
    clean = fb[:MARGIN] == bytes(MARGIN) and fb[MARGIN+64000:] == bytes(0x40000 - MARGIN - 64000)
    return hashlib.sha1(bytes(fb[MARGIN:MARGIN+64000])).hexdigest() if clean else None
random.seed(1997)
f = fround
spans = []
while len(spans) < 300:
    variant = random.choice(['blend', 'opaque'])
    y0 = random.randrange(0, 150); rows1 = random.randrange(0, 25); rows2 = random.randrange(0, 25)
    xl = random.randrange(40, 200); w = random.randrange(1, 100) if variant == 'opaque' else random.randrange(-1, 100)
    if random.random() < 0.2: w = random.choice([15, 16, 17, 31, 32, 33, 1, 2])
    S = {}
    S['i04'] = y0*320 + xl; S['i08'] = y0*320 + xl + w
    sl = lambda: (320 << 16) + random.randrange(-65536, 65536)
    S['i0c'] = sl(); S['i10'] = sl(); S['i14'] = S['i0c'] + random.randrange(0, 40000)
    S['i18'] = S['i10'] - random.randrange(0, 40000) if rows2 else sl()
    if rows2 and (S['i18']-S['i10'])*(rows2+1) + (S['i14']-S['i0c'])*rows1 + (w << 16) < 0x18000: S['i18'] = S['i10']
    S['i4c'] = rows1 | (rows2 << 16)
    z = random.uniform(1, 20); dzx = random.uniform(-0.002, 0.002); dzy = random.uniform(-0.002, 0.002); ooz = 1/z
    u = random.uniform(-70000, 70000); v = random.uniform(-70000, 70000)
    S['f40'] = f(ooz); S['f44'] = f(u*ooz); S['f48'] = f(v*ooz)
    S['f1c'] = f(16*dzx*ooz); S['f20'] = f(random.uniform(-300, 300)*16*ooz); S['f24'] = f(random.uniform(-300, 300)*16*ooz)
    for k in ('f28', 'f2c'): S[k] = f(dzy*ooz)
    for k in ('f30', 'f34', 'f38', 'f3c'): S[k] = f(random.uniform(-300, 300)*ooz)
    fb = fresh(); model_span.span(fb, tex, table, S, variant)
    d = digest(fb)
    if d: spans.append({'variant': variant, 'rows1': rows1, 'rows2': rows2, 's': S, 'sha1': d})
tris = []
while len(tris) < 600:
    variant = random.choice(['opaque', 'key', 'blend']); mode = random.randrange(4)
    def rv():
        x = random.randrange(0, 320)
        y = random.randrange(-60, 260) if mode else random.randrange(0, 200)
        if mode == 3: y = random.choice([y, 10, 50, -5, 220])
        wide = mode == 2
        return [x, y, random.randrange(65536) if wide else random.randrange(256), random.randrange(65536) if wide else random.randrange(256)]
    vs = [rv(), rv(), rv()]
    fb = fresh()
    model_tri.tri(fb, table if variant == 'blend' else (keyed if variant == 'key' else tex), [model_tri.V(*v) for v in vs], variant)
    d = digest(fb)
    if d: tris.append({'variant': variant, 'v': vs, 'sha1': d})
sprites = []
while len(sprites) < 300:
    x0 = random.randrange(-100, 340); y0 = random.randrange(-100, 220)
    x1 = x0 + random.randrange(0, 200); y1 = y0 + random.randrange(0, 200)
    if random.random() < 0.25: x1 = random.choice([0, 1, 2, 318, 319, 320, x1]); y1 = random.choice([199, 200, 0, 1, y1])
    p0 = ((y0 << 16) + x0) & 0xffffffff; p1 = ((y1 << 16) + x1) & 0xffffffff
    fb = fresh()
    try: model_sprite.sprite(fb, tex, table, p0, p1)
    except IndexError: continue
    d = digest(fb)
    if d: sprites.append({'p0': p0, 'p1': p1, 'sha1': d})
json.dump({'spans': spans, 'triangles': tris, 'sprites': sprites}, open(sys.argv[2], 'w'), separators=(',', ':'))
print(len(spans), len(tris), len(sprites))
