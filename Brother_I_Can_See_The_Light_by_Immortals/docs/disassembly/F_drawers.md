# F_drawers: the per-face drawer functions, BROTHER.EXE 0x22168..0x2b870

Slice: the clip helpers 0x22168/0x221dc/0x22280, the big drawer 0x22324, the flare drawer 0x24da4,
the clip helpers 0x24e84/0x24ef8/0x24f6c, the big drawer 0x24fe0, and everything else between
0x24fe0 and 0x2b870 (the funclist "size" of 0x24fe0 covers three more functions nobody calls).

## 0. Summary for the porter

**Every live drawer in this range is the Kahn drawer, with the same arithmetic.** You can use
`The_Quest_of_Kahn_by_Immortals/src/engine/triangle.js` and `faces.js` without changing any maths.
Here is what differs between the two executables:

1. **Face struct layout.** The texture pointer is at face **+0x2c** (Kahn +0x31). The flag word is at
   face **+0x2a** (u16; Kahn: byte +0x30). The bit values are also different (section 7). A Brother
   face is 0x30 bytes (Kahn 0x35). In the port these are fields of `face`, so only the flag
   constants change.
2. **Local vertex copies are 0x38 bytes apart** (Kahn 0x40), because Brother's vertex struct is 0x38
   bytes. Only stack-slot addressing changes (`imul 0x38`, done as `lea [r*8]; sub; shl 3`). This has
   no effect on the result.
3. **Global addresses** are different. The full map is in section 8.
4. **Instruction scheduling** in the plane-gradient block of 0x24fe0 is different. I traced it with
   a symbolic x87 tracer: every value stored is the same expression with the same float32 rounding
   points (section 4.3).
5. **Dispatch.** The part code picks the drawers with different flag bits, and part 0x13933 sends every
   face to the perspective drawer without testing any flag (section 6).

| Brother addr | Kahn equivalent | what it draws | selected by (in the part) | rasteriser called / parameter struct | live? |
|---|---|---|---|---|---|
| **0x22324** | 0x24b54 (F_raster1.md) | affine textured triangle (int16 x,y,u,v at the vertices); plain texel copy. Used for the "env" star objects (u,v from the env-map pass of the frame code, not from this function) | face flag **0x0001** (part 0x13559) | `0x1fb70(eax=0x5ef30)` (= Kahn 23cf0, integer X clip) -> `0x15ca1` (= Kahn 12962) ; Tri2D block **0x5ef30..0x5ef4b** | yes |
| **0x24fe0** | 0x27670 (G_raster2.md section 4) | opaque perspective-correct textured triangle (16-pixel perspective spans) | face flag **0x0002** (part 0x13559); **every face** (part 0x13933) | `0x15223(eax=0x5ef68)` (= Kahn 1255b); block **0x5ef68..0x5efb7**, gradValid 0x5efb8, y-gradients 0x5efbc/0x5efc0/0x5efc4 | yes |
| **0x24da4** | 0x27434 (F_raster1.md) | flare: screen-aligned scaled sprite centred on face->v[0] | face flag **0x0100** (light pseudo-face; part 0x13559, which first sets face->tex = FLARE2.GIF) | `0x13c28(eax=(y1<<16)+x1, edx=(y2<<16)+x2, ebx=face->tex, ecx=dest)` (= Kahn 10f60) | yes |
| 0x22168 | 0x24998 SAME | clipZ helper of 0x22324 (and of 0x2a3ec) | | | yes |
| 0x221dc | 0x24a0c SAME | clipX helper, undivided u,v | | | yes |
| 0x22280 | 0x24ab0 SAME | clipY helper, undivided u,v | | | yes |
| 0x24e84 | 0x27514 SAME | clipZ helper of 0x24fe0 | | | yes |
| 0x24ef8 | 0x27588 SAME | clipX helper, u/z v/z linear | | | yes |
| 0x24f6c | 0x275fc SAME | clipY helper | | | yes |
| 0x23864 | 0x25fc4 (Kahn's dead twin) | affine twin, ends in `0x14b54(eax=0x5ef4c)` (= Kahn 11e8c) | nobody | Tri2D 0x5ef4c | **dead** |
| 0x26f4c | 0x29510 (G_raster2.md section 6) | perspective textured through a 64K blend table | nobody | `0x1468a(eax=0x5efc8)` (= Kahn 119c2) | **dead** |
| 0x28eac | 0x24b54 / 0x25fc4 | third affine twin, ends in `0x214c0(eax=0x5f028)` (a third copy of the Kahn 23cf0 X-clipper, which calls 0x1562a) | nobody | Tri2D 0x5f028 | **dead** |
| 0x2a3ec | 0x2b3c0 (G_raster2.md section 7) | Gouraud "table shade" triangle | nobody | `0x16320(eax=stack block)` (= Kahn 12fe1) | **dead** |

Note: the brief grouped 0x22280 with "Kahn 27434". In fact 0x22280 = Kahn **0x24ab0** (SAME), and
0x24da4 = Kahn 0x27434 (MNEM: only the face texture offset and the global addresses differ).

## 1. How the range was split (the listing stops early)

`brother.lst` is a recursive-descent listing, so code that no call reaches is missing from it. Its
`sub_22324` stops at the `ret` at 0x23860, and `sub_24fe0` stops at the `ret` at 0x26f49. I scanned
`obj1.bin` for Watcom prologues (`68 imm32 e8 -> 0x18012`) between 0x22000 and 0x2b900 and found:

```
22168 push 14 | 221dc push 28 | 22280 push 28 | 22324 push 160 | 23864 push 160 (unlisted)
24da4 push 30 | 24e84 push 14 | 24ef8 push 14 | 24f6c push 14
24fe0 push 1a8 | 26f4c push 1a4 (unlisted) | 28eac push 160 (unlisted) | 2a3ec push 178 (unlisted)
2b870 push 4 (next slice)
```

Nothing calls the four unlisted functions except themselves. I checked every E8/E9 rel32 in obj1, and
every fixup in `fix.json` pointing into 0x23861..0x24da4 or 0x26f4a..0x2b870:

- 0x23864 is called only from 0x23e63, 0x243f6, 0x245b1, 0x24a23, 0x24bd9 (inside itself).
- 0x26f4c is called only from 0x2760a, 0x27b65, 0x27d1d, 0x28152, 0x28308 (inside itself).
- 0x28eac is called only from 0x294ab, 0x29a3e, 0x29bf9, 0x2a06b, 0x2a221 (inside itself).
- 0x2a3ec is called only from 0x2a9f1, 0x2af2f, 0x2b0f0, 0x2b534, 0x2b6ef (inside itself).
- No fixup targets any of them (so there are no function pointers to them).
- The two other E8 hits are false positives in the C runtime (0x3a866 -> 0x2b153 and
  0x3ab3d -> 0x2702a). Both targets are mid-instruction.

The rasterisers that only these dead functions reach are also dead: 0x1468a (= Kahn 119c2, hidden
inside the funclist "size" of 0x13c28), 0x14b54 (= Kahn 11e8c), 0x16320 (= Kahn 12fe1, inside the
size of 0x15ca1), 0x20818 and 0x214c0 (two more copies of the Kahn 23cf0 X-clipper, inside the size
of 0x1fb70, which is 3 x 3240 bytes), and 0x1562a. 0x1562a is Brother-only, between 0x15223 and
0x15ca1. It is the Kahn 12962 affine rasteriser except that the pixel store writes the u-register
byte (`mov [edi], bl`) instead of the fetched texel (`mov al,[ebx]; mov [edi],al`). That looks like
a flat or interpolated-index fill (UNSURE about its meaning; it is dead, so it does not matter).
**A port can ignore all of the dead code.** The live 3D rasterisers are 0x15223 (persp), 0x15ca1
(affine), 0x13c28 (sprite) and 0x169a2 (≈ Kahn 12fe1, called from 0x11a3c, another slice).

Method used for every comparison below:
- `nd.py`: a normalised instruction diff against the Kahn binary.
- `fd.py`: a feature-stream diff. It compares the sequence of FPU ops with their memory operands,
  calls, branches, struct-field offsets on non-stack bases, immediates and globals, ignoring
  register allocation and stack-slot numbers. It also builds the Brother-to-Kahn address map from
  the aligned instructions.
- `fpu.py`: a symbolic x87 tracer for straight-line blocks, run where the FPU scheduling differs.

The scripts are scratch tools and were not added to the repo.

## 2. Clip helpers: 0x22168, 0x221dc, 0x22280, 0x24e84, 0x24ef8, 0x24f6c

All six are identical to Kahn, instruction for instruction: a normalised diff of 0x22168..0x22324
against 0x24998..0x24b54 gives ratio 1.0, and of 0x24e84..0x24fe0 against 0x27514..0x27670 also
1.0. They read no globals.
- 0x22168 = Kahn 0x24998 `clip_edge_nearZ(A=eax, B=edx, Out=ebx, float plane)`, `ret 4`
  (F_raster1.md "Clipping helpers"). funclist says it is also SAME as 27514: the two are byte twins.
- 0x221dc = Kahn 0x24a0c `clip_edge_screenX`: perspective-correct u,v from undivided attributes.
- 0x22280 = Kahn 0x24ab0 `clip_edge_screenY`.
- 0x24e84 = Kahn 0x27514 `clip_edge_z`, 0x24ef8 = 0x27588 `clip_edge_x`, 0x24f6c = 0x275fc
  `clip_edge_y`. These are the linear lerps used by the perspective drawer, whose z,u,v are
  already 1/z, u/z, v/z (G_raster2.md section 3).

Port: the existing `clipEdgeLinear` / `clipEdgeUndivided` in triangle.js.

## 3. 0x22324 = Kahn 0x24b54 `draw_face_affine_textured(eax = Face*, dl = mode)`

The pseudo-code in F_raster1.md "sub_24b54" applies unchanged: near clip at z = 1.0, project with
+0.5, float X clip, float Y clip with recursion modes 1/2/3, then emit int16 x,y and
`trunc(u+0.5)`, `trunc(v+0.5)` to the Tri2D block, and hand it to the integer X clipper. The port
is `drawAffineTriangle` (triangle.js).

Complete list of differences (fd.py ratio 0.935; every remaining mismatch is in this list):

| # | Brother | Kahn | effect |
|---|---|---|---|
| 1 | 0x223a3 `mov eax,[ebx+0x2c]`: texture = face **+0x2c** | 0x24bd3 `[ebx+0x31]` | struct layout only |
| 2 | local vertex temporaries spaced **0x38** (`idx*7*8`) | spaced 0x40 (`idx<<6`) | none |
| 3 | 0x227a5..: copies u,v of the projected vertex with `fld/fstp` | copies with `mov` | none: a float32 copy through the FPU is bit-exact for finite values |
| 4 | 0x2384f `mov eax, 0x5ef30` -> `call 0x1fb70` | `0x5cfb8` -> `call 0x23cf0` | Tri2D block address; 0x1fb70 is SAME as Kahn 23cf0 |
| 5 | the "w threshold" global is **0x5dbe0** | 0x5c9a8 | Like Kahn's, it is never written (its only six references are the six `fcomp` reads in 0x22324; the other six are in the dead twin 0x23864), so it is BSS = 0.0 and the float clip always runs |
| 6 | register choice (`fcomp [ebx]` vs `[esi]`), `mov bh,2` scheduled earlier | | none |

Every branch, every FPU op and every constant is the same. Constants: 1.0 f32 at 0x53790 (Kahn
0x54730), 0.5 f64 at 0x50bb8 (Kahn 0x51900), -0.5 f64 at 0x50bc0 (Kahn 0x51908) (values checked
with peek.py). It uses the same 12 `call 0x199b2; fistp` truncations (= Kahn 0x1f318, chop).

Tri2D block at 0x5ef30 (same layout as Kahn 0x5cfb8): +0 tex u32 (= face+0x2c), then 3 x
{int16 x, y, u, v} at 0x5ef34, 0x5ef3c, 0x5ef44.
Chain: `0x1fb70` (= Kahn 23cf0 `tri2d_clipX_and_draw`, F_raster1.md) -> `0x15ca1` (= Kahn 12962,
plain texel copy, its own Y clipping). These are the Kahn port's `emitAffine` + affine filler.

Only caller: part 0x13559 at 0x1374e (and the dead helper 0x13468 at 0x134c5), always with
`edx = 0`.

## 4. 0x24fe0 = Kahn 0x27670 `draw_textured_triangle(eax = Face*, dl = stage)`

The pseudo-code in G_raster2.md section 4 (4.1 projection, 4.2 axis clip, 4.3 sort, gradients,
edge setup, 4.4 block layout) applies unchanged. It ends in `sub_15223` (= Kahn 1255b, documented
in E_tri_big.md section 6 and G_raster2.md section 5). The port is
`drawPerspectiveTriangle(a, b, c, texels, null)`, without a table.

### 4.1 Differences (fd.py ratio 0.952 against 0x27670..0x29510)

| # | Brother | Kahn | effect |
|---|---|---|---|
| 1 | 0x2505f `mov eax,[ebx+0x2c]` -> `[0x5ef68]` (block.tex) | 0x276ef `[ebx+0x31]` -> `[0x5cff0]` | struct layout only |
| 2 | local temporaries spaced 0x38 | 0x40 | none |
| 3 | gradient block 0x2672a..0x269bc: the -k256 factor is kept in an x87 register (`fld; fchs`) | stored to `[esp+0x170]` as float32 and reloaded | none: negation is exact, and k256 was already float32 (see 4.3) |
| 4 | 0x26b47 / 0x26e8d: the row-table pointer `[0x58448]` is loaded at a different point; the flat-top branch recomputes `trunc(P0.y)` (0x26e85..0x26e93) instead of reusing a stored copy | | same value |
| 5 | 0x26f38 `mov eax,0x5ef68; call 0x15223` | `0x5cff0; call 0x1255b` | block address; 0x15223 is SAME as 1255b |

All branches (jcc kinds and their order), all compares, all `call 0x199b2` truncations (25 of them,
= Kahn 0x1f318) and all constants are the same: 1.0 f32 0x53790, 0.5 f64 0x50bd8, -0.5 f64
0x50be0, 16.0 f32 0x50be8, 256.0 f32 0x50bec, 65536.0 f32 0x50bf0, 0.0625 f32 0x51ddc (checked
with peek.py). The flat-bottom fix-up `if (h2 == 0) h1++` is present (0x26f27: `cmp word [0x5efb6],0;
jne; inc word [0x5efb4]`), and there is no right-edge decrement (the decrement belongs to the blend
twin).

### 4.2 Parameter block 0x5ef68 (layout of G_raster2.md 4.4, Kahn address + 0x5ef68 - 0x5cff0)

```
0x5ef68 +00 tex            0x5ef6c +04 leftOfs     0x5ef70 +08 rightOfs
0x5ef74 +0c leftStepTop    0x5ef78 +10 leftStepBot 0x5ef7c +14 rightStepTop  0x5ef80 +18 rightStepBot
0x5ef84 +1c dZdx16         0x5ef88 +20 dUdx16      0x5ef8c +24 dVdx16
0x5ef90 +28 dZleftTop      0x5ef94 +2c dZleftBot   0x5ef98 +30 dUleftTop     0x5ef9c +34 dUleftBot
0x5efa0 +38 dVleftTop      0x5efa4 +3c dVleftBot
0x5efa8 +40 Z0             0x5efac +44 U0          0x5efb0 +48 V0
0x5efb4 +4c int16 h01      0x5efb6 +4e int16 h12
0x5efb8 gradValid (u8)     0x5efbc dZdy   0x5efc0 dUdy*256   0x5efc4 dVdy*256
```

### 4.3 Gradient block checked symbolically

I ran `fpu.py` on Brother 0x2672a..0x269bc and Kahn 0x28cdc..0x28f80, with vertex pointers named by
the stack slot that holds them (Brother P0..P2 = slots 0x11c/0x120/0x124, V0..V2 = 0x110/0x114/0x118;
Kahn 0x144/0x148/0x14c and 0x138/0x13c/0x140). Write `A = f32(dx01*dy02 - dx02*dy01)` with
`dy02 = f32(P2.y-P0.y)`, `dy01 = f32(P1.y-P0.y)`, `dx01 = P1.x-P0.x`, `dx02 = P2.x-P0.x`. Both
executables store:

```
dZdx16 = f32((dy02*(P1.z-P0.z) - dy01*(P2.z-P0.z)) * f32(f32(1/A)*16))
dZdy   = f32(((P1.z-P0.z)*dx02' - (P2.z-P0.z)*dx01') * -f32(1/A))       dx0k' = f32(dx0k)
dUdx16 = f32((dy02*f32(V1.u-V0.u) - dy01*f32(V2.u-V0.u)) * f32(f32(f32(1/A)*16)*256))
dVdx16 = f32((dy02*f32(V1.v-V0.v) - dy01*(V2.v-V0.v))    * f32(f32(f32(1/A)*16)*256))
dUdy   = f32((f32(V1.u-V0.u)*dx02' - f32(V2.u-V0.u)*dx01') * -f32(f32(1/A)*256))
dVdy   = f32((f32(V1.v-V0.v)*dx02' - (V2.v-V0.v)*dx01')     * -f32(f32(1/A)*256))
```

Note the unrounded `(V2.v-V0.v)` term, the same in both. Brother writes `-f32(k)` where Kahn writes
`f32(-f32(k))`; these are bit-identical. The flat-top edge block (Brother 0x26e05..0x26f38, Kahn
0x293ca..0x29503) traces to identical expressions, including `rightStepBot =
T((dxc / (float)h12 + 320.0) * 65536)` with a true division, and the first LEFTGRAD product using
the unrounded `dx*0.0625` for Z and the stored f32 one for U and V. So the Kahn JS (`edgeSlope`,
`rasterise`) applies bit for bit.

Callers: part 0x13559 at 0x13713 (flag 0x0002), part 0x13933 at 0x13b0e (every face), the dead
helper 0x1376c at 0x13798 (every face), and the dead helper 0x13468 at 0x1348a. Always `edx = 0`.

## 5. 0x24da4 = Kahn 0x27434 `draw_face_billboard(eax = Face*, edx = dest buffer)`

funclist says "MNEM 27434". fd.py finds exactly one non-address difference: 0x24e0c `mov ebx,[ebx+0x2c]`
(texture from face+0x2c; Kahn +0x31). The other differences are only addresses: half-size u16 at
**0x5dbd0** (Kahn 0x5c998), sx 0x5dbd4, sy 0x5dbd8, cx 0x5842c, cy 0x58430, trunc helper 0x199b2,
and the sprite blitter **0x13c28** (= Kahn 10f60). Symbolic trace of the four stored integers:

```
v = face->v[0];  r = (float)(uint16)[0x5dbd0];  kx = sx * (1/v.z);  ky = (1/v.z) * sy;
x1 = T((v.x - r)*kx + cx);   y1 = T(cy - (v.y + r)*ky);
x2 = T(cx + kx*(v.x + r));   y2 = T(cy - ky*(v.y - r));
0x13c28(eax = (y1<<16) + x1, edx = (y2<<16) + x2, ebx = face->tex (+0x2c), ecx = dest);
```

This is exactly Kahn F_raster1.md "sub_27434" and the port's `drawFlare`. [0x5dbd0] is written
once, by the scene-select routine 0x2bbac (`mov word [0x5dbd0], [scene+0x24]`), so it is the same
"scene user word" as in Kahn.

Only caller: part 0x13559 at 0x1372e (and the dead 0x13468 at 0x134a5), with `edx = [0x58440]`
(work buffer). It first sets `face->tex = [0x5db6c]`, which is FLARE2.GIF (loaded by 0x134da).

The face here is a **light pseudo-face**: the scene loader at 0x2c79d..0x2c7b6 sets, in the light
struct, `+0x44 = +0x48 = +0x4c = &lightVertex` (three identical vertex pointers) and
`+0x6e = 0x100` (= pseudo-face +0x2a flags). The sorter 0x1f708 inserts `light+0x44` into the face
list when the light's view z > 0, with key `T(z*49152) + 0x1000000` (0x1f846..0x1f896). The port
equivalent is Kahn's `light.face = { light, flags: FACE_FLARE }`.

## 6. Who calls the drawers: dispatch in the parts

Every caller walks the sorted face list built by 0x1f708 (≈ Kahn 2c7a8): `Face** list = [0x5ef24]`,
`count = [0x5ef2c]`, **from index count-1 down to 0**. Both parts call `0x2dffc` (frame:
animate/transform), then `0x1f708` (sort), then `0x106c0([0x58440])` (clear the work buffer), then
draw, then `0x106dc([0x58440])` (copy to screen).

### Part 0x13559 (third part, SHPITZ.3DS: the metal star, the background sphere, 14 light flares)

```c
for (i = count-1; i >= 0; i--) {                    // 0x136fe..0x13753
    Face *f = list[i];
    uint16 fl = f->flags;                            // word +0x2a
    if (fl & 0x0001)        draw_face_affine(f, 0);           // 0x22324
    else if (fl & 0x0002)   draw_face_perspective(f, 0);      // 0x24fe0
    else if (fl & 0x0100) { f->tex = [0x5db6c];               // FLARE2.GIF
                            draw_face_billboard(f, [0x58440]); }   // 0x24da4
    // anything else: skipped
}
```

The test order is affine, then perspective, then flare. It does not matter which comes first,
because the loader sets at most one of bits 0/1, and flares have only 0x100.

### Part 0x13933 (fifth part, TENNISB.3DS: hex-cage room and a player made of glowing dots)

```c
for (i = count-1; i >= 0; i--)                      // 0x13af5..0x13b18
    draw_face_perspective(list[i], 0);               // 0x24fe0, NO flag test
for (obj = [0x5dba4]; obj; obj = obj->next /* +0x14 */) {   // 0x13b1a..
    if (*(uint16*)obj != 0) continue;                // type 0 = mesh
    mesh = obj->+4;  v = mesh->+0xc;  end = v + mesh->+0x14 * 0x38;
    for (; v < end; v += 0x38)                       // EVERY vertex of EVERY mesh
        inline flare (same maths as 0x24da4, symbolic trace identical) with
        ebx = [0x5db88] (FLARE3.GIF), ecx = [0x58440] -> 0x13c28
}
```

Consequences for a port:
- 13933 never calls 0x22324 or 0x24da4. All its faces go through the perspective drawer.
- TENNISB.3DS has one light (Light01). Its pseudo-face, if z > 0, is also passed to 0x24fe0. Its
  three vertex pointers are identical, so after projection the integer sort finds `d == 0, e == 0`
  and returns: nothing is drawn. Near-clip case: all z equal, so `z[hi] <= 1` returns. The pseudo-face
  is harmless, but a port that keeps lights out of the list gives the same picture.
- The vertex flares are not a face drawer: they are inline code in the part. They hit every vertex,
  including the room's (Object01) vertices: the small white dots at the cage corners in the capture.

### Part 0x130f7 (last part)

It calls none of the drawers in this slice. Its callees are 0x199b2, 0x1866c, 0x1936c, 0x1067c,
0x10e50, 0x106c0, 0x106dc, 0x10fb8, 0x1dcd8, 0x1dd70, 0x1dbe4, 0x1dfe4, 0x11e2c and 0x11079. Its
triangles go through 0x11e2c -> 0x11a3c -> 0x15ca1 / 0x169a2 directly (another slice).

### Dead copies of the part render loops (no callers, no fixups)

- 0x13468..0x134d9 (in the padding after 0x130f7, no stack-check prologue): a byte-for-byte copy of
  13559's draw loop (clear, the flag-1/2/0x100 dispatch, copy to screen).
- 0x1376c..0x138a3 (between 0x13559 and 0x138b4; it shares the epilogue at 0x138ad that 13933's
  exit jump `ja 0x138ad` uses): a copy of 13933's draw loop (24fe0 on every face, plus the vertex
  flares with `ebx = [0x5db88]`).

## 7. Face flag bits in Brother (where 0x0001 / 0x0002 / 0x0100 come from)

This is outside the slice, but needed to read the dispatch. It is a quick read of 0x2bf9c (the
mesh-chunk handler, ≈ Kahn 2d550 `renderFlagsFromName`). The face-list reader 0x2c228 copies the
mesh's word +0x1e into every face's +0x2a (0x2c371..0x2c379). 0x2bf9c builds that word from
substrings of the object name. The substrings are upper case only ("PRS", "ENV", ...); 0x2bf64
probably upper-cases the name first (UNSURE).

```c
if (has "PRS")       fl = 0x02;        // perspective
else if (has "ZER")  fl = 0x20;
else if (has "TRN")  fl = 0x40;
else if (!has "SPC" && !has "GOR") fl = 0x01;   // default: affine
else fl = 0;
if (has "ENV") fl |= 0x04;             // env-mapped (u,v made by the frame code, 0x2e40d/0x2e5e7 test bit 4)
if (has "SPC") fl = 0x08;              // overwrites everything above
if (has "GOR") fl = 0x10;              // overwrites everything above
if (has "CUL") fl |= 0x80;             // the sorter (0x1f74f, test 0x80) skips back-face culling
lights: 0x100 (set by 0x2c79d)
```

SHPITZ.3DS objects are `obj,env3`, `obj,env4`, `obj2,env2`, `obj,env5`, `Obj,env1`, `obj,env6`
(the star: 0x01|0x04, so affine, with env-map u,v), `Sphere,prs` (0x02, perspective background) and
Light01..Light14 (0x100, flares). That fits the capture (below).

| meaning | Brother bit (word +0x2a) | Kahn bit (byte +0x30) |
|---|---|---|
| affine textured -> 0x22324 / Kahn 24b54 | 0x0001 | 0x02 |
| perspective textured -> 0x24fe0 / Kahn 27670 | 0x0002 | 0x40 |
| env-map u,v | 0x0004 | 0x04 |
| two-sided (no cull) | 0x0080 | 0x08 |
| flare -> 0x24da4 / Kahn 27434 | 0x0100 | 0x80 |
| SPC / GOR / ZER / TRN | 0x08 / 0x10 / 0x20 / 0x40 | (Kahn's 0x10/0x20 select 29510/2b3c0; Brother's drawers for these are dead) |

## 8. Global address map (Brother -> Kahn), from the aligned instructions

| Brother | Kahn | meaning |
|---|---|---|
| 0x58424 / 0x58428 | 0x59384 / 0x59388 | width / height |
| 0x5842c / 0x58430 | 0x5938c / 0x59390 | cx / cy float |
| 0x58448 | 0x593a8 | row offset table |
| 0x5dbd0 | 0x5c998 | u16 flare half-size (scene +0x24) |
| 0x5dbd4 / 0x5dbd8 | 0x5c99c / 0x5c9a0 | projection scales sx / sy (written by 0x2bbac at 0x2bc83 and by 0x2e0c4, camera setup, other slice) |
| 0x5dbe0 | 0x5c9a8 | "w threshold", never written = 0.0 |
| 0x5ef30..0x5ef4b | 0x5cfb8..0x5cfd3 | Tri2D of the affine drawer |
| 0x5ef4c.. | 0x5cfd4.. | Tri2D of the dead twin 0x23864 |
| 0x5ef68..0x5efc4 | 0x5cff0..0x5d04c | perspective block + gradValid + y-gradients |
| 0x5efc8..0x5f024 | 0x5d050..0x5d0ac | same for the dead blend twin 0x26f4c |
| 0x5f028.. | – | Tri2D of the dead affine twin 0x28eac |
| 0x53790 | 0x54730 | f32 1.0 |
| 0x50bb8 / 0x50bc0 | 0x51900 / 0x51908 | f64 ±0.5 (affine) |
| 0x50bd8 / 0x50be0 / 0x50be8 / 0x50bec / 0x50bf0 | 0x51920 / 0x51928 / 0x51930 / 0x51934 / 0x51938 | f64 0.5, f64 -0.5, f32 16, 256, 65536 (perspective) |
| 0x51ddc | 0x52bcc | f32 0.0625 |
| 0x5ef24 / 0x5ef2c | 0x5e0c8 / 0x5e0d0 | sorted face list / count |
| 0x199b2 | 0x1f318 | chop-rounding helper before `fistp` (truncate toward zero) |

Part globals: 0x5db6c FLARE2.GIF and 0x5db88 FLARE3.GIF (pixel buffers from 0x10794 + GIF loader
0x1936c, set by loaders 0x134da / 0x138b4). [0x58440] is the work buffer the parts draw into.
0x5db70 / 0x5db98 come from 0x10908 and are passed to 0x176c4 as ecx. UNSURE: probably the table
0x13c28 uses; that belongs to the sprite-rasteriser slice.

## 9. Checked against the capture

- Contact sheet 0..175 s step 5 s, and frames at 75 s and 130 s (`capframe.py`).
- 75 s (part 0x13559): a metallic star with smooth env-mapped shading (affine faces, flag 0x0001
  with ENV), a textured background that moves like a sphere around the camera (`Sphere,prs`,
  perspective), and round flare sprites (the 14 lights, 0x24da4 with FLARE2). This agrees.
- 130 s (part 0x13933): a perspective-textured hex-cage room (0x24fe0 on every face), the player and
  racket drawn as glowing dots (one flare per vertex, the inline loop), and tiny dots at the cage
  corners (flares of the room's own vertices, far away so they are small). This agrees.
- UNSURE: the player's own faces are not visibly textured in the capture, even though 0x13933 sends
  every sorted face to 0x24fe0. They may have a black or near-black texture, or the sorter may
  exclude those meshes (object flag test `test al,0x17` at 0x1f741). That is decided outside this
  slice (sorter / loader / materials), not by the drawer.

## 10. Open points

1. 0x2bf64 (name pre-processing before the substring tests) was not read, so whether matching is
   case-insensitive is UNSURE. SHPITZ uses lower case "env"/"prs", and the capture shows them
   working, so it probably upper-cases the name.
2. Meaning of the dead rasteriser 0x1562a (stores the u-register byte instead of a texel): not
   needed for the port.
3. Why the tennis player's faces are not visible (section 9): outside the drawers.
