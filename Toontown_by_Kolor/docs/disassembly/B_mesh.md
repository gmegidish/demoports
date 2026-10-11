# B: the bending grid and the textured triangle fillers

Ported in `src/parts/mesh.js` and `src/parts/triangles.js`; used by parts 5, 10 and 13 (`film.js`,
`silhouette.js`, `ripple.js`).

## The grid (0x10305a, 0x102fe9, 0x1032ac, 0x10334a, 0x1033eb)

`0x10305a(eax = isVShrunk)` mallocs three blocks and keeps their pointers in globals:

| global     | size   | contents |
|------------|--------|----------|
| `[0x16f704]` | 0x2ee0 | 1000 points (12 bytes): x, y, z. x = -160..152, y = -100..92, step 8 (40 columns, 25 rows, row-major); z = 0x200 |
| `[0x16f708]` | 0x4e20 | 1000 screen vertices (20 bytes): x, y, u, v, s. u = trunc((x + 160) * 0.8), v = trunc((y + 100) * 1.28) (`/ 1.28` if eax != 0), s = 0x80 |
| `[0x16f70c]` | 0x5dc0 | triangles, 3 vertex indices each: per cell (i = row*40 + col) (i, i+1, i+40) and (i+1, i+41, i+40); count 24*39*2 = 1872 in `[0x16ff10]` |

It also fills 256 int32 sines at 0x16f710 and cosines at 0x16fb10: trunc(sin(i * pi * (1/128)) * 200)
(part 5 refills them with amplitude 170). Every part calls it once (allocating again; 0x1033eb frees the three
blocks at the part's end, the port's malloc never frees).

`0x102fe9(float32 factor on the stack)`: every point's x, y = trunc(x * factor) (part 5: 1.45, 0x3fb9999a).

`0x1032ac(eax = dy)` / `0x10334a(eax = dx)`: perspective: vertex x = ((x + dx) << 9) / z + 160,
y = ((y + dy) << 9) / z + 100 (idiv, truncating; z == 0 skips the divide). u, v, s are not touched.

The parts move z per point (sine waves, mesh.js `waveMesh` for parts 5 and 13, a product of sines in part 10) and
write a shade s into the vertex.

## The fillers (0x106574, 0x106d1a, 0x1074af, 0x107b7b)

`fill(eax = v0, edx = v1, ebx = v2, ecx = dest buffer, [stack] = 256x256 texture)`, `ret 4`. One source
compiled four times; 0x106574, 0x106d1a and 0x1074af share the edge globals 0x170618..0x17067c, 0x107b7b has its own
copy at 0x170680.. (part 9, agent D1).

1. Sort the corners by y (three compare-and-swaps: (a,b), (a,c), (b,c)). Return if a.y > 199, c.y < 0 or
   a.y == c.y.
2. t = ((b.y - a.y) << 16) / (c.y - a.y); width = t * (c.x - a.x) + ((a.x - b.x) << 16) (32-bit wrap): the long
   edge's x minus b.x at b's row, 16.16. Return if 0.
3. width < 0: the long edge a-c is the left edge, the right edge is a-b then b-c; width = min(width, -0x1000).
   width > 0: the right edge is a-c, the left edge a-b then b-c; width = max(width, 0x1000).
   Edge lists: left `[0x170618..]`, right `[0x170624..]`; edge k runs from list[k] to list[k-1], the index counts
   down (`[0x170630]`, `[0x170634]`). An edge of height 0 is skipped; an empty next edge ends the triangle.
   Edge state: left x/u/v/s (16.16, 0x170670.., with steps), right x (0x170678, step 0x17067c), counts
   0x170638 / 0x17063c.
4. Gradients: du = ((t * (c.u - a.u) + ((a.u - b.u) << 16)) << 16 as a 64-bit value) / width, then `sar 8` (8.8);
   dv the same; ds without the shift (16.16).
5. Rows from a.y: xl = left.x >> 16, xr = right.x >> 16, u = left.u >> 8, v = left.v >> 8, s = left.s.
   Skip if xl > LAST or xr < 0; xr = min(xr, LAST); if xl < 0, u and v (not s) move by -xl gradient steps and
   xl = 0; skip if xr - xl <= 0 or the row is outside the routine's rows; then xr - xl pixels:
   texel = tex[((u & 0xff00) >> 8) + (v & 0xff00)], u += du, v += dv, s += ds.
   Then the left edge steps (or the next left edge starts, without a step), then the right edge likewise.

| routine  | LAST  | rows drawn | pixel |
|----------|-------|------------|-------|
| 0x106574 | 0x13f | 0..199 | texel 0 transparent, else `[0x13c6a4 + texel*256 + (s >> 16)]` |
| 0x106d1a | 0x140 | 0..199 | `[0x14c6a4 + texel*256 + (s >> 16)]` |
| 0x1074af | 0x13f | 1..198 (`cmp 0, y; jge skip` and `cmp y, 199; jge skip`) | texel 0 transparent, else the texel |

0x13c6a4 and 0x14c6a4 are 64 KB shade tables (pictures copied there at load, `INTERLEAVED` in loader.js).
`triangles.js` keeps the walk once (`fillTriangle`) with the three variants as objects; 0x107b7b can be added as a
fourth variant if its inner loop differs.
