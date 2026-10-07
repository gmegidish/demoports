# L6_letters: 1117:0000 BuildLetter and 1117:20e8 TText3D.Init (3D extruded text, used for "THE END")

## Summary

Unit 1117 builds solid, bevelled 3D capital letters. Every letter is **purely table-driven**: there are no sin/cos arcs or
builder calls other than `TPolyObject.AddQuad` (1342:3018). Each letter has a table of quads of int16 (x, y, z) vertices
(grid units, x 0..8, y 0..12, z in {-1, 0, 1}). The table holds the front half of the solid (z >= 0, with a few end-cap
quads that already span z = -1..+1). BuildLetter emits each table row as a front quad, and for the first M rows also a
mirrored back quad (z negated, vertex order reversed). It then applies a fixed normalising transform.
TText3D.Init lays the letters out in a row, centred on x = 0, and merges them into one TGroup so all faces sort together.

The only caller is the end part (0000:0073), called from main as `endPart('THE END', 2)` (string at cs:a3e7). It splits the
string at the first space (cs:0059 = ' ') and builds two TText3D objects, "THE" and "END". **Letters actually used: T, H, E, N, D.**
Checked against the capture (contact sheet 712..740 s): two rows of bevelled blue letters "THE" over "END", consistent with this geometry.

How I got the data: BuildLetter was emulated with unicorn (img.bin, DS = 2220) for 'A'..'Z', hooking every far call
(287c, 03ef, 3018, 1004, 0ed1, 1184, 11b8, 49cb) and logging the arguments. The logged quads were then checked to be
**exactly** reproduced by the table + (N, M, order) rule below for all 22 letters. Scripts: `$S/l6/emu_letters.py`, `$S/l6/verify.py`;
raw log `$S/l6/letters.json`; JS-ready table `$S/l6/letters_js.txt` (also pasted below).

### External calls
| addr | meaning |
|---|---|
| 1342:287c | TPolyObject.Init(limit, flags, minColor, maxColor) constructor, VMT 23ea (L4) |
| 1d81:49cb | UpCase(ch) |
| 1342:03ef | MakeVec(x, y, z: single; var v) (L3), fills the 4 local 12-byte vectors |
| 1342:3018 | TPolyObject.AddQuad(const a, b, c, d: Vec3): creates 4 TPixels (colour 0), new TFace, AddFace (vertex dedup, face colour counter) (L4) |
| 1342:1004 | TMesh.SetPivot(x, y, z) |
| 1342:0ed1 | TMesh.Translate(dx, dy, dz) (permanent; also moves origin and pivot) |
| 1342:1184 | TMesh.ScaleUniform(s: single) -> Scale(s, s, s) |
| 1342:11b8 | TMesh.Scale(sx, sy, sz: Real48) (permanent, about pivot.work) |
| 1342:364d | TGroup.Init(limit) (inherited call, VMT arg 0) |
| 1342:36ba | TGroup.AddMesh(m) |
| near `call 0` in 1117 from 20e8 | = 1117:0000 BuildLetter (push cs; call 0 = far call to 1117:0000) |

### Globals / data
| DS | what |
|---|---|
| 0cee | VMT of a TPolyObject descendant (size 0x94), not used here |
| 0cfe | **VMT of TText3D**: size 0x118, Done = 1342:368e (TGroup.Done), +0xC = 1342:29cf |
| 0c8c | base of `width: array['A'..'V'] of int16`, indexed `0x0c8c + 2*ord(c)`; the real data starts at DS:0d0e ('A') right after the VMT |
| 0d3a..0x2389 | letter quad table: 238 rows of 24 bytes (4 vertices x 3 int16) |

Width table (int16, DS:0d0e, 22 entries, verified with peek):
```
A 44  B 44  C 44  D 44  E 44  F 44  G 44  H 44  I 14  J 44  K 44
L 44  M 50  N 44  O 44  P 44  Q 50  R 44  S 50  T 50  U 44  V 44
```
'W'..'Z' read the first words of A's quad table (0, 0, 0, 1). Characters below 'A' (space, digits, lower case) read VMT bytes
(space -> DS:0ccc). Note that TText3D.Init uses the **raw** character for the width (no UpCase), while BuildLetter upcases.
BuildLetter makes an **empty** mesh (no faces) for any character other than 'A'..'V' (no else branch), but still applies the final transform.

## 1117:0000 BuildLetter(ch [bp+0xc]: char; flag [bp+0xa]: word; minC [bp+8]: byte; maxC [bp+6]: byte): ^TPolyObject, far, retf 8

Locals: [bp-8] the mesh, [bp-0xa] j (row, 1-based), [bp-0xc] k (vertex 1..4), [bp-0x48+12k] the 4 Vec3 (P1 at bp-0x3c,
P2 bp-0x30, P3 bp-0x24, P4 bp-0x18).
```
m = new TPolyObject(limit = 10, flags = flag, minColor = minC, maxColor = maxC)     // 287c, VMT 23ea
ch = UpCase(ch)
T = table of letter ch (base, N, M, order: see below); row(j)[k] = int16 x, y, z at DS:base + 24*(j-1) + 6*(k-1) + {0,2,4}
   (the code addresses it as [di + base - 0x1e] with di = 24*j + 6*k)
front(j) = AddQuad(P1, P2, P3, P4)                       with Pk = (float32)row(j)[k]           (fild word -> fstp dword: exact)
back(j)  = AddQuad(Q3, Q2, Q1, Q4)                       with Qk = (row(j)[k].x, row(j)[k].y, -row(j)[k].z)
           (z is negated as an int16 `neg`, then sign-extended to int32 and fild dword; exact)
if order == "inter":  for j = 1..N { front(j); if (j <= M) back(j) }     // the code tests j < M+1 (or has no test when M == N)
if order == "seq":    for j = 1..N front(j);  for j = 1..M back(j)
// fixed normalisation, same for every letter:
m.SetPivot(4.0, 5.0, 0.0)                // f32 0x40800000, 0x40a00000, 0
m.Translate(-5.0, -5.0, 0.0)             // f32 0xc0a00000; pivot becomes (-1, 0, 0), origin (-5, -5, 0)
m.ScaleUniform(6.0)                      // f32 0x40c00000 -> Scale(6, 6, 6) as Real48
m.Scale(1.0, 1.0, 0.5)                   // Real48 0x81/0/0 = 1.0, 0x80/0/0 = 0.5
return m
```
Net effect on every vertex (all exact in float32): **x' = 6x - 25, y' = 6y - 30, z' = 3z**. Origin ends at (-25, -30, 0),
pivot at (-1, 0, 0). A 7-unit-wide letter covers x' -25..17, y' -30..30 (y grows downwards on screen), z' -3..3.

Face consequences (from L4 AddQuad/AddFace):
- Each quad is a 4-vertex TFace (n = 4) even when two table vertices are equal (rows like D F10 `(5,1,1),(6,2,1),(5,2,0),(5,2,0)`):
  AddQuad builds 4 distinct TPixels, so SetVertices sees v3 != v4 and sets n = 4; AddFace's AddUnique then replaces the
  duplicate by the existing vertex, so the face ends with a repeated vertex pointer. Keep these as 4-vertex polygons with a
  repeated vertex (the depth sum counts 4 z values either way). Mirrored versions of such rows have the repeat in another slot.
- flags = 0x10 from the caller, so 0x100 is clear: **vertices are deduplicated by exact pos** within one letter
  (integer coordinates, so exact equality of the table values; the back half's z=0 vertices are shared with the front half).
  Mesh vertex list order = first appearance in face-call order, vertex order P1..P4 (Q3,Q2,Q1,Q4 for backs).
- Face colour: k-th face (0-based, call order) gets colour (minC + k) & 255; with minC = maxC = 1 this is 1, 2, 3...
  Face flags +0x7b = low byte of flag = 0x10 (Gouraud from point lights, L4 209b), min/max = 1/1 (light indices).
- Face order within the letter = call order above (matters for equal-depth sort ties).

### Per-letter parameters (verified by emulation)
`base` = DS address of row 1; N = rows (front quads); M = mirrored rows; order as above. Total quads = N + M.
| ch | base | N | M | order | quads |  | ch | base | N | M | order | quads |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 0d3a | 12 | 12 | inter | 24 | | L | 1892 | 6 | 4 | seq | 10 |
| B | 0e5a | 14 | 14 | inter | 28 | | M | 1922 | 14 | 12 | inter | 26 |
| C | 0faa | 8 | 6 | seq | 14 | | N | 1a72 | 12 | 10 | inter | 22 |
| D | 106a | 12 | 12 | inter | 24 | | O | 1b92 | 8 | 8 | inter | 16 |
| E | 118a | 13 | 10 | seq | 23 | | P | 1c52 | 10 | 9 | inter | 19 |
| F | 12c2 | 10 | 7 | seq | 17 | | Q | 1d42 | 11 | 11 | inter | 22 |
| G | 13b2 | 12 | 10 | seq | 22 | | R | 1e4a | 16 | 14 | inter | 30 |
| H | 14d2 | 12 | 8 | seq | 20 | | S | 1fca | 12 | 10 | inter | 22 |
| I | 15f2 | 4 | 2 | seq | 6 | | T | 20ea | 8 | 6 | inter | 14 |
| J | 1652 | 10 | 8 | seq | 18 | | U | 21aa | 8 | 6 | inter | 14 |
| K | 1742 | 14 | 10 | seq | 24 | | V | 226a | 12 | 10 | inter | 22 |

The rows not mirrored (j > M) are always the last ones, and they are the end-cap quads that already contain z = -1 and z = +1.
Code locations of the branches: `cmp ch, 'A'` at 1117:0039, 'B' 01a5, 'C' 0311, 'D' 0490, 'E' 05fc, 'F' 077b, 'G' 08fa,
'H' 0a79, 'I' 0bf8, 'J' 0d77, 'K' 0ef6, 'L' 1075, 'M' 11f4, 'N' 1369, 'O' 14de, 'P' 164a, 'Q' 17bf, 'R' 192b, 'S' 1aa0,
'T' 1c15, 'U' 1d87, 'V' 1ef9; common tail at 206b. (A..K jump to 1d87 when done and fall through the U/V tests; harmless.)

### Letter table, JS-ready
Each row = 12 int16: x1,y1,z1, x2,y2,z2, x3,y3,z3, x4,y4,z4 (raw table, before the normalising transform).
Regenerate with `peek.py 0xBASE N*12 sw`.
```js
const LETTERS = {
  A: { base: 0xd3a, N: 12, M: 12, order: "inter", rows: [[0,0,0,1,1,1,1,9,1,0,10,0],[1,1,1,2,2,0,2,4,0,1,5,1],[1,5,1,2,6,0,2,8,0,1,9,1],[0,0,0,7,0,0,6,1,1,1,1,1],[1,1,1,6,1,1,5,2,0,2,2,0],[5,2,0,6,1,1,6,5,1,5,4,0],[5,6,0,6,5,1,6,9,1,5,8,0],[6,1,1,7,0,0,7,10,0,6,9,1],[1,5,1,2,4,0,5,4,0,6,5,1],[1,5,1,6,5,1,5,6,0,2,6,0],[2,8,0,1,9,-1,0,10,0,1,9,1],[5,8,0,6,9,1,7,10,0,6,9,-1]] },
  B: { base: 0xe5a, N: 14, M: 14, order: "inter", rows: [[0,0,0,1,1,1,1,9,1,0,10,0],[1,1,1,2,2,0,2,4,0,1,5,1],[1,5,1,2,6,0,2,8,0,1,9,1],[0,0,0,6,0,0,5,1,1,1,1,1],[1,1,1,5,1,1,4,2,0,2,2,0],[2,8,0,5,8,0,6,9,1,1,9,1],[1,9,1,6,9,1,7,10,0,0,10,0],[4,2,0,5,1,1,5,5,1,4,4,0],[5,1,1,6,0,0,6,4,0,5,5,1],[6,5,1,6,9,1,5,8,0,5,6,0],[5,6,0,2,6,0,1,5,1,6,5,1],[7,4,0,7,10,0,6,9,1,6,5,1],[1,5,1,2,4,0,4,4,0,5,5,1],[6,4,0,7,4,0,6,5,1,5,5,1]] },
  C: { base: 0xfaa, N: 8, M: 6, order: "seq", rows: [[0,0,0,1,1,1,1,9,1,0,10,0],[1,1,1,2,2,0,2,8,0,1,9,1],[0,0,0,7,0,0,6,1,1,1,1,1],[1,1,1,6,1,1,5,2,0,2,2,0],[2,8,0,5,8,0,6,9,1,1,9,1],[1,9,1,6,9,1,7,10,0,0,10,0],[7,0,0,6,1,-1,5,2,0,6,1,1],[5,8,0,6,9,-1,7,10,0,6,9,1]] },
  D: { base: 0x106a, N: 12, M: 12, order: "inter", rows: [[0,0,0,1,1,1,1,9,1,0,10,0],[1,1,1,2,2,0,2,8,0,1,9,1],[0,0,0,5,0,0,5,1,1,1,1,1],[1,1,1,5,1,1,5,2,0,2,2,0],[5,9,1,5,10,0,0,10,0,1,9,1],[5,8,0,5,9,1,1,9,1,2,8,0],[5,2,0,6,2,1,6,8,1,5,8,0],[6,2,1,7,2,0,7,8,0,6,8,1],[5,0,0,7,2,0,6,2,1,5,1,1],[5,1,1,6,2,1,5,2,0,5,2,0],[6,8,1,7,8,0,5,10,0,5,9,1],[5,8,0,6,8,1,5,9,1,5,8,0]] },
  E: { base: 0x118a, N: 13, M: 10, order: "seq", rows: [[0,0,0,7,0,0,6,1,1,1,1,1],[1,1,1,6,1,1,5,2,0,2,2,0],[0,0,0,1,1,1,1,9,1,0,10,0],[1,1,1,2,2,0,2,4,0,1,5,1],[1,5,1,2,6,0,2,8,0,1,9,1],[6,9,1,7,10,0,0,10,0,1,9,1],[5,8,0,6,9,1,1,9,1,2,8,0],[1,5,1,2,4,0,5,4,0,4,5,1],[1,5,1,4,5,1,3,6,0,2,6,0],[7,0,0,6,1,-1,5,2,0,6,1,1],[3,6,0,4,5,-1,5,4,0,4,5,1],[7,10,0,6,9,1,5,8,0,6,9,-1],[5,4,0,4,5,-1,3,6,0,4,5,1]] },
  F: { base: 0x12c2, N: 10, M: 7, order: "seq", rows: [[0,0,0,7,0,0,6,1,1,1,1,1],[1,1,1,6,1,1,5,2,0,2,2,0],[0,0,0,1,1,1,1,9,1,0,10,0],[1,1,1,2,2,0,2,4,0,1,5,1],[1,5,1,2,6,0,2,8,0,1,9,1],[1,5,1,2,4,0,5,4,0,4,5,1],[1,5,1,4,5,1,3,6,0,2,6,0],[7,0,0,6,1,-1,5,2,0,6,1,1],[3,6,0,4,5,1,5,4,0,4,5,-1],[0,10,0,1,9,1,2,8,0,1,9,-1]] },
  G: { base: 0x13b2, N: 12, M: 10, order: "seq", rows: [[0,0,0,1,1,1,1,9,1,0,10,0],[1,1,1,2,2,0,2,8,0,1,9,1],[0,0,0,7,0,0,6,1,1,1,1,1],[1,1,1,6,1,1,5,2,0,2,2,0],[2,8,0,5,8,0,6,9,1,1,9,1],[1,9,1,6,9,1,7,10,0,0,10,0],[6,6,1,7,5,0,7,10,0,6,9,1],[5,7,0,6,6,1,6,9,1,5,8,0],[6,6,1,5,7,0,4,6,1,4,6,1],[7,5,0,6,6,1,4,6,1,3,5,0],[7,0,0,6,1,-1,5,2,0,6,1,1],[5,7,0,4,6,-1,3,5,0,4,6,1]] },
  H: { base: 0x14d2, N: 12, M: 8, order: "seq", rows: [[0,0,0,1,1,1,1,9,1,0,10,0],[6,9,1,6,1,1,7,0,0,7,10,0],[1,1,1,2,2,0,2,4,0,1,5,1],[1,5,1,2,6,0,2,8,0,1,9,1],[5,2,0,6,1,1,6,5,1,5,4,0],[5,6,0,6,5,1,6,9,1,5,8,0],[1,5,1,2,4,0,5,4,0,6,5,1],[5,6,0,2,6,0,1,5,1,6,5,1],[0,0,0,1,1,-1,2,2,0,1,1,1],[5,2,0,6,1,-1,7,0,0,6,1,1],[0,10,0,1,9,1,2,8,0,1,9,-1],[7,10,0,6,9,-1,5,8,0,6,9,1]] },
  I: { base: 0x15f2, N: 4, M: 2, order: "seq", rows: [[0,0,0,1,1,1,1,9,1,0,8,0],[1,1,1,2,2,0,2,10,0,1,9,1],[0,0,0,1,1,-1,2,2,0,1,1,1],[0,8,0,1,9,1,2,10,0,1,9,-1]] },
  J: { base: 0x1652, N: 10, M: 8, order: "seq", rows: [[0,5,0,4,5,0,3,6,1,1,6,1],[1,6,1,3,6,1,2,7,0,2,7,0],[0,5,0,1,6,1,1,9,1,0,10,0],[1,6,1,2,7,0,2,8,0,1,9,1],[1,9,1,2,8,0,5,8,0,6,9,1],[0,10,0,1,9,1,6,9,1,7,10,0],[5,2,0,6,1,1,6,9,1,5,8,0],[6,1,1,7,0,0,7,10,0,6,9,1],[2,7,0,3,6,1,4,5,0,3,6,-1],[7,0,0,6,1,1,5,2,0,6,1,-1]] },
  K: { base: 0x1742, N: 14, M: 10, order: "seq", rows: [[0,0,0,1,1,1,1,9,1,0,10,0],[1,1,1,2,2,0,2,4,0,1,5,1],[1,5,1,2,6,0,2,8,0,1,9,1],[1,5,1,2,4,0,4,4,0,5,5,1],[6,4,0,7,4,0,6,5,1,5,5,1],[1,5,1,6,5,1,5,6,0,2,6,0],[4,0,0,5,1,1,5,5,1,4,4,0],[5,1,1,6,2,0,6,4,0,5,5,1],[5,6,0,6,5,1,6,9,1,5,8,0],[6,5,1,7,4,0,7,10,0,6,9,1],[0,0,0,1,1,-1,2,2,0,1,1,1],[4,0,0,5,1,-1,6,2,0,5,1,1],[0,10,0,1,9,1,2,8,0,1,9,-1],[7,10,0,6,9,-1,5,8,0,6,9,1]] },
  L: { base: 0x1892, N: 6, M: 4, order: "seq", rows: [[0,0,0,1,1,1,1,9,1,0,10,0],[1,1,1,2,2,0,2,8,0,1,9,1],[0,10,0,1,9,1,6,9,1,7,10,0],[1,9,1,2,8,0,5,8,0,6,9,1],[0,0,0,1,1,-1,2,2,0,1,1,1],[5,8,0,6,9,-1,7,10,0,6,9,1]] },
  M: { base: 0x1922, N: 14, M: 12, order: "inter", rows: [[0,0,0,1,1,1,1,9,1,0,10,0],[1,1,1,2,2,0,2,8,0,1,9,1],[6,2,0,7,1,1,7,9,1,6,8,0],[7,1,1,8,0,0,8,10,0,7,9,1],[0,0,0,2,0,0,2,1,1,1,1,1],[1,1,1,2,1,1,2,2,0,2,2,0],[6,0,0,8,0,0,7,1,1,6,1,1],[6,1,1,7,1,1,6,2,0,6,2,0],[2,0,0,4,2,0,4,3,1,2,1,1],[2,1,1,4,3,1,4,4,0,2,2,0],[4,2,0,6,0,0,6,1,1,4,3,1],[4,3,1,6,1,1,6,2,0,4,4,0],[2,8,0,1,9,-1,0,10,0,1,9,1],[6,8,0,7,9,1,8,10,0,7,9,-1]] },
  N: { base: 0x1a72, N: 12, M: 10, order: "inter", rows: [[0,0,0,1,1,1,1,9,1,0,10,0],[1,2,1,2,4,0,2,8,0,1,9,1],[5,0,0,6,1,1,6,7,1,5,5,0],[6,1,1,7,0,0,7,10,0,6,9,1],[1,1,1,2,0,0,2,2,0,1,2,1],[5,7,0,6,7,1,6,9,1,5,8,0],[0,0,0,2,0,0,1,1,1,1,1,1],[5,0,0,7,0,0,6,1,1,6,1,1],[1,2,1,2,2,0,5,5,0,6,7,1],[1,2,1,6,7,1,5,7,0,2,4,0],[2,8,0,1,9,-1,0,10,0,1,9,1],[5,8,0,6,9,1,7,10,0,6,9,-1]] },
  O: { base: 0x1b92, N: 8, M: 8, order: "inter", rows: [[0,0,0,1,1,1,1,9,1,0,10,0],[1,1,1,2,2,0,2,8,0,1,9,1],[0,0,0,7,0,0,6,1,1,1,1,1],[1,1,1,6,1,1,5,2,0,2,2,0],[2,8,0,5,8,0,6,9,1,1,9,1],[1,9,1,6,9,1,7,10,0,0,10,0],[5,2,0,6,1,1,6,9,1,5,8,0],[6,1,1,7,0,0,7,10,0,6,9,1]] },
  P: { base: 0x1c52, N: 10, M: 9, order: "inter", rows: [[0,0,0,1,1,1,1,9,1,0,10,0],[1,1,1,2,2,0,2,4,0,1,5,1],[1,5,1,2,6,0,2,8,0,1,9,1],[0,0,0,7,0,0,6,1,1,1,1,1],[1,1,1,6,1,1,5,2,0,2,2,0],[5,2,0,6,1,1,6,5,1,5,4,0],[6,1,1,7,0,0,7,6,0,6,5,1],[1,5,1,2,4,0,5,4,0,6,5,1],[1,5,1,6,5,1,7,6,0,2,6,0],[2,8,0,1,9,-1,0,10,0,1,9,1]] },
  Q: { base: 0x1d42, N: 11, M: 11, order: "inter", rows: [[0,0,0,1,1,1,1,9,1,0,10,0],[1,1,1,2,2,0,2,8,0,1,9,1],[0,0,0,7,0,0,6,1,1,1,1,1],[1,1,1,6,1,1,5,2,0,2,2,0],[2,8,0,5,8,0,6,9,1,1,9,1],[1,9,1,6,9,1,6,10,0,0,10,0],[5,2,0,6,1,1,6,9,1,5,8,0],[6,1,1,7,0,0,7,8,0,6,9,1],[7,8,0,8,9,0,7,10,1,6,9,1],[6,9,1,7,10,1,8,12,0,6,10,0],[8,9,0,8,12,0,7,10,1,7,10,1]] },
  R: { base: 0x1e4a, N: 16, M: 14, order: "inter", rows: [[0,0,0,1,1,1,1,9,1,0,10,0],[1,1,1,2,2,0,2,4,0,1,5,1],[1,5,1,2,6,0,2,8,0,1,9,1],[0,0,0,7,0,0,6,1,1,1,1,1],[1,1,1,6,1,1,5,2,0,2,2,0],[5,2,0,6,1,1,6,5,1,5,4,0],[6,1,1,7,0,0,7,6,0,6,5,1],[1,5,1,2,4,0,5,4,0,6,5,1],[1,5,1,4,5,1,4,6,0,2,6,0],[4,5,1,6,5,1,7,6,0,6,6,0],[4,5,1,6,7,1,5,7,0,4,6,0],[4,5,1,6,6,0,7,7,0,6,7,1],[5,7,0,6,7,1,6,9,1,5,8,0],[6,7,1,7,7,0,7,10,0,6,9,1],[2,8,0,1,9,-1,0,10,0,1,9,1],[5,8,0,6,9,1,7,10,0,6,9,-1]] },
  S: { base: 0x1fca, N: 12, M: 10, order: "inter", rows: [[1,0,0,2,1,1,2,5,1,1,6,0],[2,1,1,3,2,0,3,4,0,2,5,1],[1,0,0,8,0,0,7,1,1,2,1,1],[2,1,1,7,1,1,6,2,0,3,2,0],[3,4,0,7,4,0,6,5,1,2,5,1],[2,5,1,6,5,1,5,6,0,1,6,0],[7,4,0,7,10,0,6,9,1,6,5,1],[6,5,1,6,9,1,5,8,0,5,6,0],[2,8,0,5,8,0,6,9,1,1,9,1],[1,9,1,6,9,1,7,10,0,0,10,0],[8,0,0,7,1,-1,6,2,0,7,1,1],[2,8,0,1,9,1,0,10,0,1,9,-1]] },
  T: { base: 0x20ea, N: 8, M: 6, order: "inter", rows: [[0,0,0,8,0,0,7,1,1,1,1,1],[1,1,1,4,1,1,3,2,0,2,2,0],[4,1,1,7,1,1,6,2,0,5,2,0],[3,2,0,4,1,1,4,9,1,3,10,0],[4,1,1,5,2,0,5,10,0,4,9,1],[3,10,0,4,9,1,5,10,0,5,10,0],[0,0,0,1,1,1,2,2,0,1,1,-1],[8,0,0,7,1,-1,6,2,0,7,1,1]] },
  U: { base: 0x21aa, N: 8, M: 6, order: "inter", rows: [[0,0,0,1,1,1,1,9,1,0,10,0],[1,1,1,2,2,0,2,8,0,1,9,1],[2,8,0,5,8,0,6,9,1,1,9,1],[1,9,1,6,9,1,7,10,0,0,10,0],[5,2,0,6,1,1,6,9,1,5,8,0],[6,1,1,7,0,0,7,10,0,6,9,1],[0,0,0,1,1,-1,2,2,0,1,1,1],[7,0,0,6,1,1,5,2,0,6,1,-1]] },
  V: { base: 0x226a, N: 12, M: 10, order: "inter", rows: [[0,0,0,1,1,1,1,7,1,0,7,0],[1,1,1,2,2,0,2,7,0,1,7,1],[5,2,0,6,1,1,6,7,1,5,7,0],[6,1,1,7,0,0,7,7,0,6,7,1],[0,7,0,1,7,1,3,9,1,3,10,0],[1,7,1,2,7,0,3,8,0,3,9,1],[4,8,0,5,7,0,6,7,1,4,9,1],[6,7,1,7,7,0,4,10,0,4,9,1],[3,8,0,4,8,0,4,9,1,3,9,1],[3,9,1,4,9,1,4,10,0,3,10,0],[0,0,0,1,1,-1,2,2,0,1,1,1],[7,0,0,6,1,1,5,2,0,6,1,-1]] },
};
```
Reference JS for one letter (geometry only, before TText3D's per-letter Translate):
```js
function buildLetterQuads(ch) {             // returns quads in AddQuad call order, final coordinates
  const L = LETTERS[ch.toUpperCase()]; const out = [];
  if (!L) return out;
  const P = (r, k) => [r[3*k], r[3*k+1], r[3*k+2]];
  const front = r => [P(r,0), P(r,1), P(r,2), P(r,3)];
  const back  = r => [2,1,0,3].map(k => { const p = P(r,k); return [p[0], p[1], -p[2]]; });
  if (L.order === "inter") { L.rows.forEach((r, j) => { out.push(front(r)); if (j < L.M) out.push(back(r)); }); }
  else { L.rows.forEach(r => out.push(front(r))); L.rows.slice(0, L.M).forEach(r => out.push(back(r))); }
  return out.map(q => q.map(([x, y, z]) => [6*x - 25, 6*y - 30, 3*z]));
}
// then: dedupe vertices by exact (pre-transform) position across the letter, first-seen order, 4 vertex refs per face.
```
Letters used by the demo, rows 1..N (pre-transform):
- T: `[0,0,0, 8,0,0, 7,1,1, 1,1,1] [1,1,1, 4,1,1, 3,2,0, 2,2,0] [4,1,1, 7,1,1, 6,2,0, 5,2,0] [3,2,0, 4,1,1, 4,9,1, 3,10,0] [4,1,1, 5,2,0, 5,10,0, 4,9,1] [3,10,0, 4,9,1, 5,10,0, 5,10,0] [0,0,0, 1,1,1, 2,2,0, 1,1,-1] [8,0,0, 7,1,-1, 6,2,0, 7,1,1]` (inter, M = 6)
- H, E, N, D: see the table above (H seq M=8, E seq M=10, N inter M=10, D inter M=12).

## 1117:20e8 TText3D.Init(s [bp+0x14]: string; spacing [bp+0x12]: int16; flag [bp+0x10]: word; minC [bp+0xe], maxC [bp+0xc]: byte), constructor (VMT [bp+0xa], self [bp+6]), retf 0x12

L5's summary is confirmed, with these exact details:
```
s = local copy (Pascal string, max 255); len = length(s) (byte, zero-extended)
TGroup.Init(self, limit = len*20 (16-bit imul), VMT 0)          // 364d: TPolyObject.Init(limit, 0x100, 0, 0) + members
self.+0x92 = flag (word; overwrites TGroup's 0x100, so faces of the group are NOT deduped and sorting is ON); self.+0x7e = minC; self.+0x7f = maxC
if (len > 1) { w = 0; for (i = 1; i <= len-1; i++) w += width[s[i]] + spacing }   // int16 adds, last char excluded
else          w = width[s[1]]                                     // len == 0 also takes this path (reads s[1] garbage) and then builds nothing
x = (-w) / 2                       // 16-bit: neg, cwd, idiv 2 -> truncation toward 0
for (i = 1; i <= len; i++) {
   L = BuildLetter(s[i], flag, minC, maxC)
   self.letter[i] = L              // far ptr at self + 0x9c + 4*i  (i.e. +0xa0 .. ; object size 0x118 -> at most 30 letters)
   L.Translate((float32)x, 0.0, 0.0)          // 0ed1: moves vertices, origin and pivot
   x += width[s[i]] + spacing      // int16
   self.AddMesh(L)                 // 36ba: faces appended to the group (flags |= low byte of +0x92 = 0x10), vertices appended (no dedup), L kept in members
}
return self
```
Callers (end part 0000:0073): all pass spacing = 5, flag = 0x10, minC = 1, maxC = 1, VMT 0x0cfe.
- 0000:02bd: "THE" (Copy(s, 1, pos-1)), stored in [bp-0x104]
- 0000:02e0: "END" (Copy(s, pos+1, 255)), stored in [bp-0x108]
- 0000:0395: whole string when it has no space (not taken for "THE END").

Resulting letter x offsets (added to x' = 6x - 25 of each letter):
- "THE": w = (50+5) + (44+5) = 104, x0 = -52: T at -52, H at +3, E at +52.
- "END": w = (44+5) + (44+5) = 98, x0 = -49: E at -49, N at 0, D at +49.

Caller context (belongs to the end-part slice, listed so the two objects can be checked): after building, the caller does on
"END": ScaleUniform(0.9f = 0x3f666666), Scale(Real48 0.8000000000001819, 1.0, 3.0), Center (1082), Rotate(-110.0, 0, 0);
then Translate("THE", 0, -30, 0) and Translate("END", 0, +30, 0) (only in the space-split path). The "THE" object's own
scale/rotate calls follow at 0000:03a2 (outside this slice).

## 1117:2290 getRomFont / 1117:22a3 unit init
As in L5 (INT 10h AX=1130h BH=2 -> DS:5518/551a). Not used by BuildLetter or TText3D.Init (they only use the quad tables).
