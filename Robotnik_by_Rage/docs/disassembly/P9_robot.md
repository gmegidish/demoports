# P9 — demo part 9: robot in the octagonal room with "rage mirror", "rage tv" and the RAGE blocks

Slice P9. Sequencer entry 9: `init 0x1f064(r6flag)` / `run 0x1ea28(9)` / `deinit 0x1f008`.
Init and deinit always run, even when the part is skipped (see M §2).
Capture: the part is on screen from about **188.0 s to 225.5 s** in `demo.avi`. 186–187 s are black
because part 8 ended and part 9 init is loading. At 225.6 s part 10 starts with a spinning panel on black.

The part runs from demo song (pos 7,row 0) = 62.72 s to (16,0) = 100.80 s. See M §4.5. Phase A runs
until (15,17) = 98.70 s. Phase B covers the last 2.1 s.

All coordinates in these notes are engine "int domain" units, where points, positions and the camera
share one scale. See E1 §1/§2. Angles use 4096 units per turn.

---------------------------------------------------------------------------------------------------

## 0. What is on screen (verified against the capture)

- **Room.** The camera is always inside an octagonal room. The room is built procedurally in place of
  the robot file's root mesh. Its walls carry `pattrn2.raw` (brown/red ramp, palette 0xa0..0xbf), drawn
  unshaded. There is a floor ring, a wall band and a ceiling ring.
- **Two panels, set into wall segments 0 and 4.** In those two segments the wall band has holes.
  - "rage mirror": shows a second render of the scene taken from the mirror's centre. It is a
    "fake mirror": the camera is aimed by a law-of-cosines formula, and the image is not flipped.
  - "rage tv": shows the **previous final frame**, which gives video feedback (the robot repeats inside the TV).
  - In both panels the image is modulated by a light map. The light map is `cy_mirr.raw`, a soft grey
    streak picture scaled to 320x200, with the label "rage mirror" or "rage tv" stamped into it as
    brighter pixels. The modulation goes through the 8-ramp shade table (§3).
- **Robot** (`en_obj.eob`, keyframed, 7 keys per object, frames 0..60). It dances in the room centre and
  spins about its vertical axis (one turn per 1024 ticks = 14.6 s).
- **Two "RAGE" blocks.** These are boxes 2800 wide, 1100 high and 1700 deep. They use texture
  `cy_block.raw` ("RAGE" on the front and back faces) and are drawn unshaded in grey (ramp 0).
  - Phase A: both blocks sink slowly, 1 unit per tick, from y=6500 to y=4500 (reached after 2000 ticks = 28.5 s).
  - Phase B: they slide together, 64 units per tick, to form "RAGE RAGE".
  - Once they touch, the robot's head (with face, add-on and eye) disappears. The rest of the robot
    sinks through the floor at 30 units per tick, and the dance plays 5x faster. This matches the
    capture at 223.5–225.4 s.
- Camera: plays back a recorded path (`cy_cam1.rec`), one record per 70 Hz tick.
- Palette: `cy_pal.col` is set instantly in init. The part has **no fades**.

---------------------------------------------------------------------------------------------------

## 1. Files

| file | size | use |
|---|---|---|
| `font.raw` | 12100 | Font, loaded with add=0, shift=0 (format: M §3.8). Used only in init to stamp the two labels, then freed |
| `cy_cam1.rec` | 33132 | Camera path: 2761 records of 12 bytes = `int16 x,y,z, int16 ax,ay,az`. Record *n* is used at tick *n* of the part. Positions are sign-extended to int. Angles are pitch(x), yaw(y), roll(z), 4096/turn. There is **no bounds check**: the part uses ≤ ~2670 records. First record (-3959,3800,-3959, 0,2560,0) is close to wall segment 5 (giant pixels at 188 s); last record (1884,3968,7154, 15,6212,0) |
| `en_obj.eob` | 161480 | Robot object tree. Format: E1 §1. Loaded with `0x24688`, which also loads the textures (below) |
| `cy_mirr.raw` | 16000 | 160x100, values 8..127, no header. Light map for both panels |
| `cy_block.raw` | 8192 | **256x32** texture for the blocks. Only u=0..127 is used. Remapped in init (§2.4) |
| `cy_pal.col` | 768 | 6-bit VGA palette (max 63), sent to the DAC as is |
| `pattrn2.raw` | 0x300+256x128 | Room wall texture: material #1 of the eob root, texels 160..189 |
| `pattrn.raw`, `torso2`, `neck`, `hand` (x2), `head`, `face2`, `addon`, `eye` `.raw` | 0x300 header + 256 x h | Robot textures. They are not named in the demo code. The EOB material loader `0x418b4` loads them from the paths stored in the eob, `E:\robotnik\X.pic` → `x.raw` (E1 §1.2). Pixels start at +0x300 |

### 1.1 en_obj.eob tree
I parsed this with my own walker (`scratchpad/agents/P9/eob.py`). Pointer `+4` = first child,
`+0` = next sibling (E1 §3.1). The file has 33 objects, and every one has keys at frames 0,10,..,60.
The root's keys are all identity.

```
root            12 pts, mats [none, pattrn2]     <- mesh REPLACED by the room in init
└ (child) n2    16 pts, pattrn       (lower body / spring)          <- spun / sunk by the part
  └ n3          49 pts, untextured
    └ n4        48 pts, torso2
      └ n5      32 pts, neck  ; its siblings (+0 chain) = the two arms (axis objects, 20/16/12-pt
      │                       segments, 139-pt hand.pic hands)
      └ n6      34 pts, head                                       <- hidden in the end phase
        └ n7   318 pts, face2
          └ n8  23 pts, addon (flags 0x20e, others 0x20a)
            └ n9 20 pts, eye
```
In init, the static object `0x81ef8` (mirror + TV panels) is spliced in as the root's **first child**,
and `n2` becomes its child: `0x81ef8->child = root->child; root->child = 0x81ef8`. So the chain the run
loop walks is root → n1=0x81ef8 → n2 → ... → n9. `0x81ef8` has no keys and an identity matrix, so it
just passes the root transform through.

---------------------------------------------------------------------------------------------------

## 2. init `0x1f064(eax = r6flag)`

`r6flag` is 0 in a normal run (`/r6` sets it). When it is non-zero, `[0x81950] = 1` turns on the
**camera-record mode** (§6). Ignore that mode in the port. In the order the code runs:

```
srand(2)                                            // 0x43437(2); LCG seed [0x89f14]
loadFont("font.raw", add 0, shift 0)                // 0x1dcd0 -> [0x8193c]
[0x89ec0] = 0                                       // loader verbose off
[0xd9adc] = record ? malloc(0x10000) : loadFile("cy_cam1.rec")
root = [0x81954] = LoadObject("en_obj.eob")         // 0x24688 (+materials/textures); edx=0x37668 is passed but ignored
SetSpanFn(root, 0x37668)                            // 0x2469c, root node only; irrelevant, root's materials are replaced below
root->mats(+0xa4)[1].+0x28 = 0                      // byte offset 0x58 of the runtime material array
// template object 0x8200c gets the room mesh:
[0x82018] = 0xda350 (points), [0x82020] = 0xd9ae0 (polygons)
BuildRoom(0x8200c)                                  // 0x1e1e4, §2.1
[0x89dcc] = 0xe4d40                                 // render target = back buffer
bufMirrTex [0xdb4ec] = malloc(64K)   // reflection render target; 1st holds cy_mirr.raw
bufTvTex   [0xdb4e8] = malloc(64K)   // copy of previous final frame
bufMirrLM  [0xdb4dc] = malloc(64K)   // mirror light map 320x200
bufTvLM    [0xdb4e0] = malloc(64K)   // tv light map 320x200
bufJunk    [0xdb4d4] = malloc(64K)   // target of a one-off render in init, otherwise unused
[0x106b58] = 0xa0000
loadFilePart("cy_mirr.raw", bufMirrTex, 0, 16000)
ScaleImage(160,100 -> 320,200, bufMirrTex -> bufMirrLM)   // 0x1d1a0, §2.2
ScaleImage(160,100 -> 320,200, bufMirrTex -> bufTvLM)
FontAddTable()                                      // rows 0..31 of 0xfd0a0, §2.3
DrawText("rage mirror", x=40, y=8, bufMirrLM)       // 0x1ddb4, §2.3
DrawText("rage tv",     x=40, y=8, bufTvLM)
MirrorRows(bufMirrLM, 320, 200); MirrorRows(bufTvLM, 320, 200)   // 0x1d648: reverse each row
freeFont()                                          // 0x1dda0
blockTex [0xdb4d0] = loadFile("cy_block.raw"); remap, §2.4
```
Material records (0x30 bytes each, layout E1 §3.2; all other fields are bss zeros):

| record | +0x10 tex1 | +0x14 tex2 | +0x28 | +0x2c span fn | used by |
|---|---|---|---|---|---|
| 0xd9a40 | root's original material #1 texture (`pattrn2.raw` pixels) | 0 | 0 | 0x36890 (0x331b4 in record mode) | room |
| 0xd9a70 | bufMirrTex (0xdb4ec) | bufMirrLM (0xdb4dc) | 0 | 0x37668 | mirror panel (material 0 of 0x81ef8) |
| 0xd9aa0 | bufTvTex (0xdb4e8) | bufTvLM (0xdb4e0) | 0 | 0x37668 | TV panel (material 1) |
| 0xda320 | blockTex (0xdb4d0) | – | – | 0x36890 | both blocks |

Then:
```
world = [0xdb4e4] = CreateWorld(30, 1900, 2700, 2700)       // 0x39e68
SetCamPos(world, (0, 3800, -8000))                          // 0x3a114
SetCamAngles(world, (0,0,0))                                // 0x3a2bc
SetObjPos(root, (0,0,0))                                    // 0x39a2c
SetObjAngle(root: ax = -1024, ay = 0, az = 0)               // 0x39a70/78/80. Turns the z-up model y-up:
                                                            //   local (x,y,z) -> world (x, z, -y)
ScalePoints(root, 1); ScalePoints(root, 1)                  // 0x39ad0 x2: robot points >>16 (E1)
ScaleKeys(root, 1)                                          // 0x39bfc
// replace root's mesh/materials by the template 0x8200c (8-byte copies):
root[+0x08..+0x27] = tmpl[+0x08..+0x27]  // 32 pts @0xda350, 44 polys @0xd9ae0, 0 normals
root[+0xa0,+0xa4] = 1, 0xd9a40
// splice the panels object in as root's first child:
0x81ef8->child(+4) = root->child; root->child = 0x81ef8
SetFlags(root tree, 8)                                      // 0x27798 (meaning: E2)
AddObject(root); AddObject(0x81c28 /*block A*/); AddObject(0x81cdc /*block B*/)  // 0x3a590
ComputeBounds()                                             // 0x3a598
SetRenderMode(world, 3)                                     // 0x3a5b4
world+0xb8 = 1
loadFilePart("cy_pal.col", stackbuf, 0, 0x300); SetPalette(stackbuf)   // 0x11af3: instant, no fade
ShadeTable8x32()                                            // 0x1e420 overwrites 0xfd0a0 rows 0..127, §3
SetFlags(0x81ef8 subtree, 0x1000 /*hidden*/)
RenderMirror(world, bufJunk, root, 0)                       // §4. Output never used
ClearFlags(0x81ef8 subtree, 0x1000)
```
The one-off render into `bufJunk` has no visible effect, so the port can skip it.

### 2.1 `0x1e1e4 BuildRoom(eax = template object)` — octagonal room, z-up model space
Ring table at 0x81fac, 8 entries of (x,y,0):
`P = (2000,6000) (6000,2000) (6000,-2000) (2000,-6000) (-2000,-6000) (-6000,-2000) (-6000,2000) (-2000,6000)`.
Heights at 0x1e1b0: `H = {-1000, 2000, 6000, 9000}`.
```
for j in 0..3: for i in 0..7:
    x = P[i].x; y = P[i].y; if (j==0 || j==3) { x >>= 2; y >>= 2; }   // arithmetic shift
    pts[j*8+i] = (x, y, H[j])
n = 0
for k in 0..2:                               // band: 0 = floor, 1 = wall, 2 = ceiling
    vTop = 0x7f - 0x2a*k;  vBot = 0x55 - 0x2a*k    // k0: 127/85, k1: 85/43, k2: 43/1
    for i in 0..7:
        if (k==1 && (i==0 || i==4)) continue        // holes for mirror (seg 0) and TV (seg 4)
        a = k*8+i; b = k*8+(i+1)%8; c = (k+1)*8+(i+1)%8; d = (k+1)*8+i
        poly[n++] = {+0:0, +4:0 (material), +8:-1, pts a,b,c, uv (32i,vTop) (32i+31,vTop) (32i+31,vBot)}
        poly[n++] = {+0:0, +4:0,            +8:-1, pts a,c,d, uv (32i,vTop) (32i+31,vBot) (32i,vBot)}
```
Polygon layout: +0x0c/+0x10/+0x14 = point indices, +0x18..+0x2c = u0,v0,u1,v1,u2,v2 (texels).
This gives 44 triangles. The texture is 256x128 (`pattrn2`): 8 segments of 32 texels across, and
bands take 42 rows each, from the bottom (v=127) up.

The world positions follow from root angle ax=-1024. The floor runs from a small ring at y=-1000 up
to the big ring at y=2000. The wall runs from y=2000 to y=6000. The ceiling runs from y=6000 to a small ring
at y=9000. The rings are open in the middle and nothing caps them. The big ring has radius 6325
(apothem 5843).

### 2.2 `0x1d1a0 ScaleImage(eax=srcW, ebx=srcH, ecx=dstW, edx=dstH, esi=src, edi=dst)`
Nearest-neighbour, 16.16:
```
xs = (srcW<<16)/dstW; ys = (srcH<<16)/dstH;  (signed idiv)
for (y=0, fy=0; y<dstH; y++, fy+=ys) { row = src + (fy>>16)*srcW;
    for (x=0, fx=0; x<dstW; x++, fx+=xs) *dst++ = row[fx>>16]; }
```
Here each source pixel becomes exactly 2x2.

### 2.3 Labels
`FontAddTable` (inline at 0x1f1d2): for s in 0..31 and d in 0..127, `T[s*256+d] = min(2*s + d, 127)`
(T = 0xfd0a0).
`0x1ddb4 DrawText(eax=str, edx=x, ebx=y, ecx=buf)`:
```
p = buf + y*320 + x
for each char c until 0:
    if (c != ' ') { g = (c >= 'a') ? c-'a' : c-0x14;  src = font + 0x2c + g*0x134;
        for r in 0..13: for q in 0..20: p[r*320+q] = T[src[r*22+q]*256 + p[r*320+q]]; }
    p += 21
```
Glyphs are 21x14, read from 22-byte rows. Font values are 0..31, so a label adds up to +62 to the light map, clamped at 127.
"rage mirror" fills x=40..270, y=8..21. "rage tv" fills x=40..186.
`0x1d648 MirrorRows(eax=buf, edx=w, ebx=h)` then reverses every row (`row[w-1-i] = old[i]`), so the
labels end up mirrored in the light maps. On screen they read correctly, because the panel's u runs
right-to-left as seen from inside the room. The capture at 194 s shows a readable "RAGE MIRROR" at the
top of the mirror.

### 2.4 Block texture remap (0x1f27d)
For each of the 8192 bytes: `b = (b < 0x80) ? b>>2 : (b-0x80)>>3`. The result is 0..31, i.e. palette ramp 0 (grey).

### 2.5 Static objects (data segment, E1 §3.1 layout; positions/angles 0, K = identity 0x100)
- **Block A `0x81c28`, block B `0x81cdc`**: these share one mesh. There are 8 points at 0x81958:
  (0,0,0) (0,0,1700) (2800,0,1700) (2800,0,0) (0,1100,0) (0,1100,1700) (2800,1100,1700) (2800,1100,0).
  There are 12 polys at 0x819b8 (+0/+4/+8 all 0), and 1 material at 0xda320. These blocks are
  top-level world objects, so their axes are the world axes, with y up.

  | polys (pts) | face | uv |
  |---|---|---|
  | (0,3,1) (1,3,2) | bottom y=0 | u 64..127, v 2..29 |
  | (4,5,7) (5,6,7) | top y=1100 | u 64..127, v 2..29 |
  | (0,7,3) (0,4,7) | front z=0 | u 2..63, v 2 (y=0) .. 29 (y=1100) — "RAGE" |
  | (1,6,5) (1,2,6) | back z=1700 | u 2..63 — "RAGE" (one uv is (2,0), see table at 0x819b8 poly 7) |
  | (2,3,6) (3,7,6) | side x=2800 | u 64..95 |
  | (0,1,5) (0,5,4) | side x=0 | u 64..95 |

  Exact UVs per polygon (u0,v0,u1,v1,u2,v2), in order:
  `(40,2,7f,2,40,1d) (40,1d,7f,2,7f,1d) (40,2,40,1d,7f,2) (40,1d,7f,1d,7f,2) (2,2,3f,1d,3f,2) (2,2,2,1d,3f,1d)
  (3f,2,2,1d,3f,1d) (3f,2,2,0,2,1d) (5f,2,40,2,5f,1d) (40,2,40,1d,5f,1d) (40,2,5f,2,5f,1d) (40,2,5f,1d,40,1d)` (hex).
- **Panels `0x81ef8`**: 8 points at 0x81d90 (model space, z up). Its parent is the root, so world = (x, z, -y):

  | pt | model | world |
  |---|---|---|
  | 0..3 mirror | (2000,6000,2000) (6000,2000,2000) (2000,6000,6000) (6000,2000,6000) | centre (4000, 4000, -4000) |
  | 4..7 TV | (-2000,-6000,2000) (-6000,-2000,2000) (-2000,-6000,6000) (-6000,-2000,6000) | centre (-4000, 4000, 4000) |

  There are 4 polys at 0x81e08, with +0=0, +4=material, +8=-1: `(0,1,2) m0 uv (2,197)(253,197)(2,2)`;
  `(1,3,2) m0 uv (253,197)(253,2)(2,2)`; `(4,5,6) m1` same uv; `(5,7,6) m1` same uv. Each panel lies
  exactly in its wall hole (coplanar with segment 0 / segment 4).

---------------------------------------------------------------------------------------------------

## 3. `0x1e420 ShadeTable8x32` — the global colour x light table at 0xfd0a0

Palette model: 8 ramps of 32 colours. The table is `T[L*256 + c]` for light L = 0..127 and colour
c = 0..255. P9 writes rows 0..127 (this overwrites the font rows from §2.3). It does not touch rows 128..255.
```
for L in 0..127:
    q = L/4; t = L/3                       // C division, L >= 0
    for c in 0..255:
        r = c >> 5; l = c & 31
        o = (r <= 2) ? q - 16 : t - 21     // L=64 -> 0 for ramps 0-2; L=63 -> 0 for ramps 3-7
        T[L*256+c] = r*32 + clamp(l + o, 0, 31)
```
Who reads this table: the panel span routines (§5, light map = L) and the engine's shaded fillers for
the robot (material table pointer `+0xc = 0xfd0a0`, E1 §1.2 / E2).

---------------------------------------------------------------------------------------------------

## 4. `0x1e860 RenderMirror(eax=world, edx=target, ebx=root, ecx=hideRoot)` + `0x1e704 AimMirrorCam`

```
C0 = GetCamPos(world); A0 = GetCamAngles(world)       // 0x3a178, 0x3a250 (ints)
M  = GetObjPos(root) + (4000, 4000, -4000)            // = mirror centre (root is at 0)
SetCamPos(world, M)
AimMirrorCam(world, P = C0)                           // 0x1e704, below
if (hideRoot) root.flags |= 0x1000                    // ecx = 0 in every call
SetSpanFn(root, 0x331b4)          // room: affine, unshaded (E1 helper 0x2469c, this node only)
SetSpanFn(0x81ef8, 0x34f6c)       // panels: affine version of 0x37668
old = [0x89dcc]; [0x89dcc] = target
RenderWorld(world)                                    // 0x3a4e0: everything (robot, blocks, panels)
if (!record) SetSpanFn(root, 0x36890)                 // back to the perspective mappers
SetSpanFn(0x81ef8, 0x37668)
if (hideRoot) root.flags &= ~0x1000
[0x89dcc] = old
SetCamPos(world, C0); SetCamAngles(world, A0)
```
Inside the reflection pass, the mirror panel samples `bufMirrTex`, which is the target being drawn right
now. So a mirror seen in the mirror shows a mix of the previous reflection and the current one. The TV
seen in the mirror shows the previous frame.

`0x1e704(eax=world, stack: P.x,P.y,P.z)` (ret 0xc). C = the camera position just set (M). It uses
32-bit int math for the squares, then x87:
```
K  = 32000000.0                         // = 4000²+4000², assumes root at origin
A1 = (C.x-P.x)² + (C.z-P.z)²;  B1 = P.x² + P.z²
a1 = acos((K + A1 - B1) / (2*sqrt(K)*sqrt(A1))) * 651.9     // 651.9 ~ 4096/2π (exact constant 651.9)
if (-P.z < P.x) a1 = -a1
A2 = (C.y-P.y)² + (C.z-P.z)²;  B2 = P.y² + P.z²
a2 = acos((K + A2 - B2) / (2*sqrt(K)*sqrt(A2))) * 651.9
yaw   = (int16) trunc(a1 - 512)          // 0x44160 = frndint with chop
pitch = (int16) trunc(a2 - 512)
SetCamAngles(world, (pitch, yaw, 0))    // (ax, ay, az)
```
(a1 is the angle at M between the directions to the origin and to the viewer, in the xz plane. a2 is
the same in the yz plane.)

---------------------------------------------------------------------------------------------------

## 5. Panel span routine `0x37668` (P9 only), with its affine twin `0x34f6c`

`0x37668` is a perspective-correct triangle filler with the same setup as `0x36890` (E2). Its inner
span is `0x4f9dd`, which runs a perspective divide every 16 pixels with affine steps in between, and
the pixel loop at `0x4fb35`. The only P9-specific behaviour is in the texel fetch:
```
tex1 = mat+0x10 + 0x20;  tex2 = mat+0x14 + 0x20        // +0x20: skip 32 columns
// u,v are 8.8. The step is packed as (V<<16)|U, so a carry out of U spills into V's fraction
off = rowOfs[v] + u        // rowOfs (0x90e5c) = v*320 for v<200, 64000 for v>=200; u = 0..255
pix = T[tex2[off]*256 + tex1[off]]          // light map selects the row of T (§3)
```
The 320x200 buffers are read through a 256-wide window at columns 32..287. The panel UVs (2..253,
2..197) therefore cover columns 34..285 and rows 2..197.
`0x34f6c` does the same fetch with plain affine interpolation (spans `0x4fef6`/`0x4ff39`). It is used
only in the reflection pass.

Other span routines used here (shared, E2): `0x36890` = perspective, unshaded, 256-wide texture,
`pix = tex[(v<<8)|u]` (spans `0x4f891`/`0x4f800`); `0x331b4` = the affine version (`0x4fd9b`/`0x4fdc9`).

---------------------------------------------------------------------------------------------------

## 6. run `0x1ea28(eax = s0 = 9)`

```
d = 2000;  dist = 3500;  animT = 0;  prevEl = 0
cam = {frame [0xd9ad0]=0, [0xd9ad4]=0, [0xd9ad8]=0, data [0xd9adc]}
len = AnimLength(root)                    // 0x39e30: 60<<8 = 15360
while (syncAdvance() <= 9) killCheck()    // wait for (7,0)
resyncFrame(); start = frame              // [0x91260]
s = syncAdvance()
while (s <= 11) {
    el    = frame - start                 // ticks since part start
    delta = el - prevEl;  prevEl = el
    s = syncAdvance()
    if (s <= 10) d    = max(d - delta, 0)               // phase A
    else         dist = max(dist - 64*delta, 1400)      // phase B
    base = GetObjPos(root)                              // (0,0,0)
    SetObjPos(blockA, base + (dist - 1400, d + 4500, -950))
    SetObjPos(blockB, base + (-1400 - dist, d + 4500, -950))
    cam.frame = el
    if (record) { FreeFlyCam(...0x25a5c); RecordCam(world,&cam) /*0x277e4*/ }
    else PlayCam(world, &cam)             // 0x2789c: SetCamPos(rec[el].xyz); SetCamAngles(rec[el].angles)
    animT += delta * (dist == 1400 ? 200 : 40)
    if (animT >= len) do animT -= len; while (animT >= len)
    if (dist > 1400)
        n2.az = (int16)(el*4)             // SetObjAngleZ(root->child->child): robot spins
    else {                                // end phase
        SetFlags(n6 /*head*/, 0x1000)     // hides head, face2, addon, eye (subtree + siblings, none)
        n2.pos += (0, 0, -30*delta)       // model z = world up: the robot sinks
    }
    AnimateTree(root, animT)              // 0x39e08
    RenderMirror(world, bufMirrTex, root, 0)   // §4
    RenderWorld(world)                    // into 0xe4d40
    copy 64000 bytes 0xe4d40 -> bufTvTex and -> VGA 0xa0000
    killCheck2()                          // 0x122f0 (ESC handling only)
}
if (record) SaveCam("cy_cam1.rec")        // 0x27874 -> 0x1e174 file write
free(cam data)
return frames*0x4600 / el                 // fps statistic, unused
```
Notes for the port:
- The loop never waits for retrace or for a tick. It renders as fast as it can, and `delta` counts
  70 Hz ticks. Any delta works, delta=0 included. A port can run once per tick with delta=1.
- `n2` = `root->child->child` (the pattrn lower body). Its angle and position are the extra
  `+0x58/+0x64` fields, applied as `T(pos)·K·Rz(az)` (E1 §2). They stay as they were when the phase changes.
- In phase B `dist` reaches 1400 after ⌈2100/64⌉ = 33 ticks. Phase B lasts about 2.1 s, so the
  sinking/headless state covers most of it. When phase B starts `d` is already 0, since phase A lasts
  36 s > 2000 ticks. Final block x ranges: A 0..2800 and B -2800..0, which gives "RAGE RAGE"; y 4500..5600; z -950..750.
- The frame whose `syncAdvance` returns 12 is still drawn, using phase-B logic, before the loop exits.
- There is no screen clear in this part. Whether `RenderWorld` clears the target is E2's question. The
  room surrounds the camera, so in practice every pixel is redrawn.
- The camera index `el` is used without a bounds check. 2761 records cover 39.4 s and the part is about 38.1 s long.

## 7. deinit `0x1f008`
`ResetTarget()` (0x3b828: target back to 0xa0000, freed if it was a private buffer), `DestroyWorld(world)`
(0x39fd8), then free the five 64 KB buffers, the root object (only the root block itself) and the block
texture. Then `0x315f0` clears the ShadeTable cache. Nothing visible happens.

## 8. Record mode (`/r6`, not part of the normal demo)
`[0x81950] = 1` changes these things:
- The camera buffer is a blank 64 KB block.
- The room keeps span routine `0x331b4`.
- The camera is a keyboard free-fly (`0x25a5c` reads key flags 0x118ac..0x118b3, set by the INT 9
  handler at 0x1190d). Each frame's camera is appended as a 12-byte record (`0x277e4`), and the file
  is written at the end.

## Open questions / things I did not verify
- Meaning of object flag 8 (set on the whole tree), the polygon `+8 = -1`, world `+0xb8 = 1`, and whether
  render mode 3 sorts or uses bbox culling. All of these belong to E2.
- The sub-pixel and edge rules of the span routines (`0x4f9dd`, `0x4fb35`) and of the
  triangle setup are E2's.
- I did not emulate `AimMirrorCam` against the capture, so the mirror image's exact framing is unchecked.
  The formulas above are read straight from the code.
