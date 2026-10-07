# E. 3D engine: what differs from Kahn (BROTHER.EXE 0x1da90..0x2e990)

Slice: the engine functions that are not byte-identical to *The Quest of Kahn*: the .3DS loader and
scene setup, the per-frame pipeline (animate, camera, cull + sort) and the keyframer variants. Both
scenes (`SHPITZ.3DS`, `TENNISB.3DS`) are listed in section 8.

Reference material: Kahn notes `H_loader.md` (loader, data model) and `I_pipeline.md` (animate, cull,
keyframer); Kahn port `src/engine/scene.js`, `track.js`, `frame.js`, `math.js`. Everything below says
which Kahn JS function to patch.

How this was checked:
- Every function in the slice was diffed instruction by instruction against its Kahn counterpart, with
  addresses translated through a map of ~1000 Brother/Kahn global pairs built from the identical
  functions. Diffs that only change stack slots or x87 register order were read by hand to make sure
  the arithmetic is the same.
- The keyframer and the camera matrix were also run in a unicorn emulator on random inputs, the
  Brother code against the Kahn code (section 9).
- The two .3DS files were parsed with a script that implements these loader rules (section 8).
- DOSBox captures at 60..85 s (SHPITZ) and 120..145 s (TENNISB) match the reading (section 9).

All floats are float32 unless marked f64. "Kahn x" means the KAHN.EXE address.

---------------------------------------------------------------------------------------------------
## 0. Summary for the porter: patches to the Kahn JS

| # | where (Kahn JS) | change for Brother | Brother code |
|---|---|---|---|
| 1 | `scene.js` `renderFlagsFromName` + `FACE_*` constants | New suffixes and new bit values; matching is case-insensitive (section 3) | 0x2bf9c |
| 2 | `scene.js` handler 0x4120 | face flags = the whole u16 render flags (bit 0x80 and 0x100 exist now), not the low byte | 0x2c228 |
| 3 | `scene.js` handler 0x4600 | light pseudo-face flags = **0x100** (was 0x80) | 0x2c70c |
| 4 | `scene.js` `computeNormals` | vertex normals for **every** mesh (test is `renderFlags != 0`, always true), not only env meshes | 0x3a200 |
| 5 | `scene.js` `loadTextures` | no flare.gif load; texture path = map file name as is (no `TEXTURES\`); a material with no map file is skipped; each material also keeps a copy of its own palette | 0x2bcd4 |
| 6 | `frame.js` `activateScene` | also rewinds every track cursor (Kahn's unused 0x2fc40, = `rewindScene`) | 0x2bbac, 0x1e140 |
| 7 | `frame.js` `toViewSpace` | **no `flags & 7` skip**: hidden and dummy meshes are transformed too (TENNISB relies on it) | 0x2dffc |
| 8 | `frame.js` `setEnvironmentTexel` | `u = nx*127 + 127`, `v = ny*127 + 127` (Kahn: 128 and 127) | 0x2dffc |
| 9 | `frame.js` `toViewSpace` | new "GOR" vertex shade branch (render flag 0x10). Dead in this demo (section 5.4) | 0x2dffc |
| 10 | `frame.js` `toViewSpace`, morph path | env/GOR normals are the mesh's own vertex normals, not blended (no morph tracks in the data, so no visible effect) | 0x2dffc |
| 11 | `frame.js` `isFaceVisible` / `cullAndSort` | the two-sided bit is **0x80** ("CUL"), not 0x08 | 0x1f708 |
| 12 | `track.js` `ease` | `inverse = 1 / sum` (f64 sum), not `1 / f(sum)` | 0x1e494 |
| 13 | `track.js` `setLastTangent` | component 3 (quaternion w) gets an extra `- 0.25*(last.v[3]-thirdLast.v[3])` before the `* (1 - T)` (section 6.3) | 0x1ebe4 |
| - | `math.js` `lookAt`, `track.js` `evaluate`, `setMiddleTangents`, `setFirstTangent` | no change needed: same results within 1-2 float32 ulp (emulated, section 9) | 0x2df10, 0x1dfe4, 0x1ee9c.., 0x1e5ec, 0x1eb10 |

The struct layouts changed too (section 2). Only a port that keeps byte offsets needs them.

---------------------------------------------------------------------------------------------------
## 1. Globals: Kahn -> Brother

Scene "activate" copies (written by 0x2bbac = Kahn 0x2d150), loader globals, pipeline globals:

| Kahn | Brother | type | meaning |
|---|---|---|---|
| 0x5c964 | **0x5db9c** | WNode* | world list head (scene+0x00) |
| 0x5c968 | 0x5dba0 | WNode* | world list tail while loading |
| 0x5c96c | **0x5dba4** | KNode* | keyframer node list head (scene+0x04) |
| 0x5c970 | 0x5dba8 | KNode* | node list tail while loading |
| 0x5c974 | 0x5dbac | Material* | material list head (scene+0x08) |
| 0x5c978 | 0x5dbb0 | Material* | material tail while loading; also used as a cursor by 0x2bcd4 |
| 0x5c97c | 0x5dbb4 | Material* | flare material (scene+0x0c) |
| 0x5c980 | 0x5dbb8 | int | light count (scene+0x14) |
| 0x5c984 | 0x5dbbc | int | sortable face count (scene+0x10) = size of the sort buffers |
| 0x5c988 | **0x5dbc0** | Camera* | ACTIVE camera (scene+0x18). Parts overwrite it to switch cameras |
| 0x5c98c / 0x5c98e | 0x5dbc4 / 0x5dbc6 | u16 | first / last frame |
| 0x5c990 | 0x5dbc8 | f32 | frame span (last - first) |
| 0x5c994 | **0x5dbcc** | f32 | CURRENT FRAME, the only input of animate 0x2dffc. Written by the parts (0x136a1, 0x13a96) |
| 0x5c998 | 0x5dbd0 | u16 | scene+0x24, the loader's 2nd argument (0x14 for both scenes); read by the flare drawer 0x24dd6 and by part 0x13b62 |
| 0x5c99c | 0x5dbd4 | f32 | projection scale x = 160 / tan(fov/2) |
| 0x5c9a0 | 0x5dbd8 | f32 | projection scale y = 133.333 / tan(fov/2) |
| 0x5c9a8 | 0x5dbe0 | ? | (drawer global, other slice) |
| 0x5c9b0 (u8[768]) | `*[0x5dbf0]` | u8* | current palette. Brother keeps a POINTER to the GIF loader's palette buffer, not a fixed array |
| 0x5e0c8 | **0x5ef24** | Face** | sort buffer A = the final sorted list (nearest first) |
| 0x5e0cc | 0x5ef28 | Face** | sort buffer B (scratch) |
| 0x5e0d0 | **0x5ef2c** | int | number of entries in the sorted list this frame |
| 0x5e0c0 / 0x5e0c4 | 0x5ef1c / 0x5ef20 | int | statistics: total sorted faces / number of sort calls |
| 0x5d0b0, 0x5d4b4, 0x5d8b8, 0x5dcbc | 0x5df0c, 0x5e310, 0x5e714, 0x5eb18 | u32[257] | radix histograms, key bytes 0..3 |
| 0x5e0e0 | 0x5f050 | Scene* | scene being loaded |
| 0x5e0dc | 0x5f04c | void* | current object while loading |
| 0x5e0d4 | 0x5f044 | int | object id counter / node id (never reset between scenes) |
| 0x5e0d8 | 0x5f048 | u16 | id of the enclosing chunk |
| 0x5e0e4 | 0x5f054 | char[0x80] | last name read |
| 0x5e164 | 0x5f0d4 | float* | 5-float spline scratch (T, C, B, easeTo, easeFrom) |
| 0x55de0 | 0x54e38 | table | chunk table, 52 entries x 10 bytes. **Same ids, same order, same handler roles** (checked entry by entry) |
| 0x55d98 | 0x54df0 | f32[18] | lens -> FOV table, identical values |
| 0x55fe8 | 0x54dec | u32 | rand() seed (rand = 0x1f66e, SAME as Kahn 0x2fbc9) |
| 0x59384..0x59394 | 0x58424..0x58434 | | screen width, height, centre x/y (f32), bytes per pixel |
| 0x54730 | 0x53790 | f32 1.0 | near plane |
| 0x5472c | 0x5378c | f32 0.75 | aspect constant |

Scene-specific globals set by the loaders of the two parts (outside the engine, listed so the porter
can find them): SHPITZ scene* 0x5db64, flare2.gif block 0x5db6c, Camera01 0x5db78, Camera02 0x5db7c;
TENNISB scene* 0x5db80, flare3.gif block 0x5db88, Camera01 0x5db90, Camera02 0x5db94.

---------------------------------------------------------------------------------------------------
## 2. Struct layouts (Brother), differences from Kahn H_loader.md section 1

### Scene: 0x3a bytes (Kahn 0x2a)
+0x00..+0x29 exactly as Kahn. +0x2a..+0x39: 16 new bytes, zero-filled by the loader. I found no
reader in the engine or the two 3D parts (UNSURE: nothing in the listing references them by a direct
offset from a scene pointer). +0x26 = malloc(768) copy of `*[0x5dbf0]` after all textures are loaded.

### Object (mesh): 0x112 bytes (Kahn 0xe0). 0x32 bytes inserted at +0x20; everything after moves by +0x32
```
+0x00 char*  name            +0x04 int id          +0x08 int parent object id
+0x0c Vertex* vertices (count * 0x38)               +0x10 Face* faces (count * 0x30)
+0x14 int    vertex count    +0x18 int face count
+0x1c u16    state flags (1 hidden, 2 hidden by track, 4 dummy, 8 morph, 0x10 set by parts): as Kahn
+0x1e u16    render flags from the name (section 3)
+0x20 u8     NEW: "GOR" shade base   } read only by the GOR branch of 0x2dffc; nothing in the
+0x21 u8     NEW: "GOR" shade range  } executable writes them, so they stay 0
+0x22..+0x51 NEW, zero, unused as far as I can see
+0x52 char*  material name   (Kahn +0x20)
+0x56 vec    mesh translation (Kahn +0x24)
+0x62 mat3   inverse mesh matrix (Kahn +0x30)
+0x86 vec    pivot           (Kahn +0x54)
+0x92 vec    animated position (Kahn +0x60)
+0x9e quat   animated rotation (Kahn +0x6c)
+0xb2 vec    animated scale  (Kahn +0x80)
+0xbe mat3   M = R*diag(scale), world after the hierarchy pass (Kahn +0x8c)
+0xe2 mat3   R, own rotation only (Kahn +0xb0)
+0x106 Object* morph A, +0x10a Object* morph B, +0x10e f32 morph weight (Kahn +0xd4..+0xdc)
```
The dummy object created by node header 0x2caac (`$$$DUMMY`) is also 0x112 bytes; its material name
pointer (+0x52) is cleared.

### Vertex: 0x38 bytes (Kahn 0x40)
```
+0x00 vec position (object space, pivot relative)     +0x0c vec normal (object space)
+0x18 vec view-space position
+0x24 vec view-space normal: ENV meshes get all 3 components, GOR meshes only z (+0x2c)
+0x30 f32 u   +0x34 f32 v
```
The raw file u, v (Kahn +0x38/+0x3c) are no longer stored. The mapping chunk 0x4140 still writes
`u = u*256 + 8192`, `v = 8192 + (-v)*256` (f64 constants 256.0, 8192.0; same evaluation order).

### Face: 0x30 bytes (Kahn 0x35)
```
+0x00 Vertex* v0, +0x04 v1, +0x08 v2       +0x0c vec normal (object space)
+0x18 vec view-space normal                +0x24 2 bytes, not touched by the engine
+0x26 u32 sort key   (Kahn +0x2c)          +0x2a u16 render flags (Kahn u8 at +0x30)
+0x2c u8* texture    (Kahn +0x31)
```

### Light: 0x74 bytes (Kahn 0x81)
```
+0x00 name, +0x04 id, +0x08 parent id
+0x0c Vertex (0x38): position at +0x0c, view position at +0x24 (view z at +0x2c)
+0x44 Face (0x30): v0 = v1 = v2 = light+0x0c; flags (+0x6e) = 0x100; texture (+0x70)
```

### Material: 0x14 bytes (Kahn 0x10)
```
+0x00 char* name  +0x04 char* map file  +0x08 u8* 64K texture block
+0x0c u8* NEW: malloc(768) copy of the palette of this material's picture (set by the picture loader)
+0x10 Material* next   (Kahn +0x0c)
```
Camera (0x54), KNode (0x1c), Track (0x12), Key (0x56), WNode (0x0e): unchanged.

---------------------------------------------------------------------------------------------------
## 3. Render flags from the object name: 0x2bf9c (0x4100 Tri-Mesh, Kahn 0x2d550)

```
o = new(0x112); memset(o, 0, 0x112);
o->name = strdup(name);  o->id = [0x5f044]++;  o->flags(+0x1c) = 0;
U = upcase_dup(name);                       // 0x2bf64: strdup, then each char 'a'..'z' -= 0x20 (u8 index; leaks)
prs = strstr(U,"PRS"); env = strstr(U,"ENV"); spc = strstr(U,"SPC"); gor = strstr(U,"GOR");
zer = strstr(U,"ZER"); trn = strstr(U,"TRN"); cul = strstr(U,"CUL");     // strstr = 0x39bab
rf = 0;
if      (prs)            rf = 0x02;
else if (zer)            rf = 0x20;
else if (trn)            rf = 0x40;
else if (!(spc || gor))  rf = 0x01;         // the default
if (env) rf |= 0x04;
if (spc) rf  = 0x08;                        // ASSIGNMENT: drops PRS/ENV/... bits
if (gor) rf  = 0x10;                        // ASSIGNMENT, wins over SPC
if (cul) rf |= 0x80;
o->rflags(+0x1e) = rf;
[0x5f04c] = o; world_add(0, o); read_chunks(f, end, (u16)[0x5f044]);
```
Case-insensitive now (Kahn: case-sensitive "prs"/"PRS" etc.). Bit meanings, with the Kahn equivalent:

| Brother bit | suffix | Kahn bit | use |
|---|---|---|---|
| 0x01 | (default) | 0x02 | affine textured triangle. SHPITZ draw loop: `fl & 1` -> 0x22324 (Kahn 0x24b54 family) |
| 0x02 | PRS | 0x40 | perspective textured. SHPITZ loop: `fl & 2` -> 0x24fe0 (Kahn 0x27670 family) |
| 0x04 | ENV | 0x04 | env-mapped uv every frame (section 5.4); combines with 0x01/0x02 |
| 0x08 | SPC | 0x10 | special (no draw loop in the two 3D parts tests it) |
| 0x10 | GOR | - | NEW: vertex shade into u (section 5.4) |
| 0x20 | ZER | - | NEW, meaning in the drawers (other slice) |
| 0x40 | TRN | - | NEW, meaning in the drawers (other slice) |
| 0x80 | CUL | 0x08 | two-sided: no back-face test in 0x1f708 |
| 0x100 | (lights only) | 0x80 | flare pseudo-face. SHPITZ loop: `fl & 0x100` -> 0x24da4 (Kahn 0x27434) |

The SHPITZ draw loop (0x1370c..0x1374e, other slice) tests 0x01, then 0x02, then 0x100. The TENNISB loop
sends every sorted face to 0x24fe0. In the data only 0x01, 0x02 and 0x05 occur (section 8).

---------------------------------------------------------------------------------------------------
## 4. The loader, function by function

### Identical to Kahn (instruction sequence identical; only addresses differ)
| Brother | Kahn | what | Kahn JS |
|---|---|---|---|
| 0x2b870 | 0x2cc00 | static init (allocates the spline scratch) | - |
| 0x2b88c | 0x2cc1c | world_add | `scene.world.push` |
| 0x2b8f8 | 0x2ce7c | knode_add (a different jump-table tail fooled the matcher; the code is identical) | node creation in 0xb010 |
| 0x2b9f4 | 0x2cf78 | set_track (only the stack-check prologue differs in the diff) | `attachTrack` |
| 0x2ba90 | 0x2d014 | find_world_object ("Couldn't find world object : %s ") | `findObject` |
| 0x2bb80 | 0x2d124 | first camera | in `loadScene` |
| 0x2bea4, 0x2beb0, 0x2bed8, 0x2bf00, 0x2bf38 | 0x2d490, 0x2d49c, 0x2d4c4, 0x2d4ec, 0x2d524 | skip, colour chunks, read_name, 0x4000 object block | `Reader.name`, handler 0x4000 |
| 0x2c4ec, 0x2c7ec, 0x2c814, 0x2c880 | 0x2da7c, 0x2dd7c, 0x2dda4, 0x2de10 | smoothing (skip), spotlight (skip), lens_to_fov, 0x4700 camera | `lensToFov`, handler 0x4700 |
| 0x2ca08, 0x2ca2c, 0x2ca88, 0x2cd6c | 0x2df98, 0x2dfbc, 0x2e018, 0x2e2f8 | 0xA300 map file, 0xB008 frames, 0xB011 dummy name, read_spline | same handlers |
| 0x2cdfc, 0x2cfc8, 0x2d22c, 0x2d3fc, 0x2d5a4, 0x2d764, 0x2d8e4 | 0x2e388, 0x2e554, 0x2e7b8, 0x2e988, 0x2eb30, 0x2ecf0, 0x2ee70 | position, rotation, scale, FOV, roll, hide, morph track readers | `readVectorTrack`, 0xb021.. |
| 0x2da90, 0x2dac8, 0x2db00 | 0x2f01c, 0x2f054, 0x2f08c | 0xB030 node id, find_chunk, read_chunks | `readChunks` |
| 0x39dd8, 0x39ea8 | 0x3ce38, 0x3cf08 | quaternion "normalize" (divides by \|q\|^2), quaternion -> matrix | `math.js` |
| 0x1da90..0x1dcd8, 0x1dd70..0x1dfb8 | 0x23aa0..0x23cbc, 0x312b0..0x314d4 | vec/mat helpers (vec_add 0x1da90, vec_sub 0x1dab4, dot 0x1db88, cross 0x1dba8, normalize 0x1dbe4, length 0x1dc44, lerp2 0x1dc64, copy 0x1dcac, make 0x1dcd8, mat*vec 0x1dd70, mat*vec rows 0,1 0x1ddc4, mat*mat 0x1de24, scale columns 0x1df0c, mat_make 0x1df64, mat copy 0x1dfb8) | `math.js` |

### Changed only by struct offsets / sizes ("MNEM" in funclist; read and diffed)
- **0x2c138** (0x4110 vertices, Kahn 0x2d71c): vertex stride 0x38. Same (x, z, y) swap.
- **0x2c228** (0x4120 faces, Kahn 0x2d7ec): face stride 0x30; `face.flags (+0x2a, u16) = o->rflags (+0x1e, u16)`
  (Kahn stored the low byte). scene+0x10 += n as before; then read_chunks.
  JS: `createFace(..., mesh.renderFlags)` without `& 0xff`.
- **0x2c3a0** (0x4130, Kahn 0x2d928): material name stored at o+0x52.
- **0x2c418** (0x4140, Kahn 0x2d9a0): no raw u, v stored (see vertex layout). Same u', v'.
- **0x2c538** (0x4160, Kahn 0x2dac8): writes M at o+0x62, translation at o+0x56. Same math.
- **0x2c70c** (0x4600 light, Kahn 0x2dc9c): new(0x74); face at +0x44, `flags (+0x6e) = 0x100` (u16 store;
  Kahn: byte 0x80 at +0x7c). Lightcount++, facecount++ as before.
  JS: `light.face.flags = 0x100`.
- **0x2c974** (0xA000, Kahn 0x2df04): material new(0x14), next pointer at +0x10.
- **0x2caac** (0xB010 node header, Kahn 0x2e03c): dummy object new(0x112), clears +0x52. The hidden test
  `flags1 & 0x0800 -> o->flags |= 1; scene->facecount -= o->nfaces` is unchanged, **and it fires in
  TENNISB** (17 of 18 meshes, section 8). Kahn notes said no Kahn scene sets it; the Kahn JS handles it.
- **0x2cd08** (0xB013 pivot, Kahn 0x2e298): pivot at o+0x86.
- **0x2bc94** find_material (Kahn 0x2d234): walks `next` at +0x10. Same fallback: no match (or NULL name)
  -> the FIRST material.
- **0x2dbb4** transform_vertices (Kahn 0x2f140): vertex stride 0x38, reads o+0x56, o+0x62, o+0x86. Same math.

### 0x2ddd4 load_scene(eax = name, edx = u16 user word) -> Scene* (Kahn 0x2f1bc)
Identical except: `new(0x3a)` instead of 0x2a, and the palette copied into scene+0x26 is
`memcpy(malloc(0x300), *[0x5dbf0], 0x300)` (Kahn: from the fixed array 0x5c9b0). compute_normals is 0x3a200.
The callers also load ebx (0x5db74 / 0x5db8c) and ecx = 1; the function overwrites both before use, so
they are ignored. Both scenes are loaded with edx = 0x14.

### 0x3a200 compute_normals(eax = Scene*) (Kahn 0x31550)
Same face normals (`normalize(cross(v1 - v0, v2 - v0))`, face stride 0x30). The vertex-normal pass is
guarded by `if (o->rflags (+0x1e) != 0)` (u16 compare with 0) instead of `rflags & 4`. Every mesh has a
non-zero rflags (the rules of section 3 never leave 0), so **every mesh gets vertex normals**.
JS `computeNormals`: replace `if (!(mesh.renderFlags & FACE_ENVIRONMENT)) return;` with `if (mesh.renderFlags === 0) return;`.

### 0x2bcd4 load_textures() (Kahn 0x2d274)
```
if (scene->lightcount != 0) {
    m = scene->flare(+0x0c) = new(0x14) zeroed;
    m->name = strdup("Cohrnellious"); m->file = strdup("flare.gif"); m->tex = next_64k_block();   // 0x10794
    buf = "TEXTURES\\" + m->file;              // built on the stack and then NOT used:
                                               // Kahn's load_texture call is gone, flare.gif is never loaded
    for each WNode of type 2 (light): light->face.texture (+0x70) = m->tex;   // an untouched 64K block
}
for (m = scene->materials; m; m = m->next (+0x10)) {    // [0x5dbb0] is used as the loop cursor
    m->tex = next_64k_block();
    strcpy(buf, m->file);                      // NO "TEXTURES\" prefix (the stub matches basenames anyway)
    if (m->file == NULL) continue;             // new check (strcpy has already read address 0)
    load_texture(buf, m->tex, &m->pal (+0x0c), [0x58434] = bytes per pixel);   // 0x1936c
}
for each WNode of type 0: o = object;
    m = find_material(o->matname (+0x52));
    for each face: face.texture (+0x2c) = m->tex;
```
0x1936c (picture slice) = Kahn 0x1f114 with a changed 3rd argument: instead of "set the DAC" it is an
output pointer that receives `malloc(0x300)` holding a copy of the picture's palette (`*[0x5dbf0]`).
So every material keeps its own palette; the scene palette (+0x26) is still the last material's.
The parts load their own flare sprites (SHPITZ: `flare2.gif` into [0x5db6c], TENNISB: `flare3.gif` into
[0x5db88]) and the SHPITZ draw loop writes [0x5db6c] into the light face's texture field before
drawing it (0x1371f), so the empty block never shows.
JS `loadTextures`: drop the flare load (or keep the light faces' texture null and let the part set it),
use `material.file` without the folder, skip materials whose file is null, keep `machine.palette.slice()`
per material if a part needs it.

---------------------------------------------------------------------------------------------------
## 5. Per-frame pipeline

Per frame a 3D part does (0x13691..0x136ef, 0x13a86..0x13ae6; other slice):
```
[0x5dbcc] = frame;  0x2dffc();  0x1f708();  then walks [0x5ef24][[0x5ef2c]-1 .. 0] (farthest first)
```
as in Kahn (`animate`, `cullAndSort`, then the part's draw loop).

### 5.1 0x2bbac activate_scene(eax = Scene*) (Kahn 0x2d150)
Same field copies (to the globals of section 1), then `alloc_sort_lists()` (0x1f6b0 = Kahn 0x2c750),
then **NEW: `rewind_all_tracks()` (0x1e140)**, then set_projection(scene->camera) with the same
constants (f64 0.5, 0.005555555555555556, 3.141592687; W*0.5 and (H*0.5)/0.75f).
Both 3D parts call it once, at their start (0x13566, 0x13941).

**0x1e140 rewind_all_tracks()**: identical to Kahn's unreferenced 0x2fc40 (jump table 0x1e130):
```
for (k = [0x5dba4]; k; k = k->next (+0x14)) { t = k->tracks;
    type 0: t[0]->cur = t[1]->cur = t[2]->cur = 0;  if (t[3]) t[3]->cur = 0;  if (t[4]) t[4]->cur = 0;
    type 1: t[0]->cur = t[1]->cur = 0;  if (t[2]) t[2]->cur = 0;
    type 2, 3: t[0]->cur = 0; }
```
(cur = track+4.) JS `activateScene`: call `rewindScene(scene)` inside it.

### 5.2 0x2dffc animate() (Kahn 0x2f43c). Read in full
No arguments; F = [0x5dbcc]. Jump tables: node types 0x2dfdc (0x2e0f1, 0x2e021, 0x2e0d5, 0x2e1a2),
child types 0x2dfec (0x2e1fd, 0x2e297, 0x2e2cb, 0x2e263).

**Pass 1 (evaluate tracks), node list order.** Same as Kahn with the new offsets:
```
type 0 (o = node.data):
    eval_vec (t[0], F, &o->pos   +0x92);        // 0x1f024
    eval_quat(t[1], F, &o->quat  +0x9e);        // 0x1f220
    eval_vec (t[2], F, &o->scale +0xb2);
    if (t[3]) eval_hide (t[3], F, &o->flags +0x1c);   // 0x1f450 = Kahn 0x30fe0
    if (t[4]) eval_morph(t[4], F, &o->morphA +0x106); // 0x1f520 = Kahn 0x310b0
    quat_normalize(&o->quat);                   // 0x39dd8 (divides by |q|^2)
    quat_to_matrix(&o->quat, &o->R +0xe2);      // 0x39ea8
    o->M (+0xbe) = o->R;  scale_columns(o->M, o->scale);
type 1 (camera c): eval_vec(t[0], F, &c->pos +0x10); eval_float(t[1], F, &c->roll +0x28);   // 0x1ee9c
                   eval_float(t[2], F, &c->fov +0x2c);
                   if (t[2]->nkeys > 1) set_projection([0x5dbc0]);   // active camera, as Kahn
type 2 (target):   eval_vec(t[0], F, &c->target +0x1c);
type 3 (light):    eval_vec(t[0], F, &l->pos +0x0c);
```
**Pass 2 (hierarchy)**: identical to Kahn (object child: `C.M = P.M * C.M; C.pos = P.M*C.pos + P.pos`;
camera child -> cam+0x10, target child -> cam+0x1c, light child -> light+0x0c; camera node: light
children `+= cam.pos`).

**Camera matrix**: `camera_matrix([0x5dbc0])` = 0x2df10 instead of Kahn 0x2f2f0 (section 5.3).

**Pass 3 (view space), node list order** (cam = [0x5dbc0], V = cam+0x30):
```
type 0 (o):                                     // NOTE: no "if (o->flags & 7) skip" (Kahn had it)
    MV = V * o->M;   NV = V * o->R;   T = V * (o->pos - cam->pos);
    if (!(o->flags & 8)) {                      // not morphing
        if (o->rflags & 0x04) {                 // ENV
            for each vertex v:
                v.view (+0x18) = MV * v.pos + T;
                v.vn   (+0x24) = NV * v.normal;              // 0x1dd70: all three rows
                (v.vn.x, v.vn.y) = rows 0,1 of NV * v.normal; // 0x1ddc4: same values again
                v.u (+0x30) = (f32)(v.vn.x * 127.0 + 127.0);  // f64 127.0 at 0x50fd4 used for BOTH
                v.v (+0x34) = (f32)(v.vn.y * 127.0 + 127.0);  // Kahn: *128.0 + 127.0
        } else if (o->rflags & 0x10) {          // GOR (section 5.4)
            for each vertex v:
                v.view = MV * v.pos + T;
                v.vn.z (+0x2c) = NV[6]*n.x + NV[7]*n.y + NV[8]*n.z;   // 0x1de00, row 2 only, -> f32
                s = clamp_u8( (f32)((float)o->b21 * v.vn.z), 0, o->b21 );   // 0x2df78
                v.u (+0x30) = (float)(int)(o->b20 + s);                     // v (+0x34) untouched
        } else
            for each vertex v: v.view = MV * v.pos + T;
        for each face f (stride 0x30): f.vn (+0x18) = MV * f.normal (+0x0c);
    } else {                                    // morph: A = o+0x106, B = o+0x10a, w = o+0x10e, w1 = (f32)(1 - w)
        same three branches, with  p = A.vert[i].pos*w + B.vert[i].pos*w1  (0x1dc64)  and
        v.view = MV * p + T; the ENV/GOR normal is the object's OWN vertex normal o.vert[i].normal,
        NOT blended (Kahn blended A/B normals), and in the ENV branch only rows 0,1 are written (0x1ddc4).
        faces: f.vn = MV * (A.face[i].normal*w + B.face[i].normal*w1)       // as Kahn
    }
type 3 (light l): l.view (+0x24) = V * (l.pos - cam->pos);     // as Kahn
```
JS `toViewSpace`: delete the `if (mesh.flags & NOT_TRANSFORMED) return;` (keep `NOT_SORTED` in
`cullAndSort`); in `setEnvironmentTexel` use `viewX * 127.0 + 127.0`, `viewY * 127.0 + 127.0`; add the GOR
branch; in the morph path use `mesh.normal` for env/GOR vertices.

Why the skip was removed: in TENNISB 17 meshes carry the 0x0800 hidden flag, so the cull drops them, and
the TENNISB part then draws every vertex of every mesh node as a flare sprite at its view position
(0x13b1a..0x13c19, reads vertex+0x18/+0x1c/+0x20). That is the dotted tennis player in the capture.
Without the transform those dots would not move.

### 5.3 Camera matrix: 0x2df10 camera_matrix(eax = Camera*) and 0x1dfe4 rotation_matrix
```
0x2df10:  d = cam->target - cam->pos;                          // 0x1dab4
          len = sqrt(d.y*d.y + d.x*d.x + d.z*d.z);             // 0x1dc44
          p = asin(d.y / len);                                 // 0x3a382 = atan2(x, sqrt(1-x*x)), as Kahn 0x2fbfe
          a = -atan2(d.x, d.z);                                // 0x1e0fb (fxch; fpatan), as Kahn 0x31513
          rotation_matrix(a, p, cam->roll, &cam->V +0x30);     // 0x1dfe4, all three angles passed as f32
```
**0x1dfe4 rotation_matrix(stack: f32 a, f32 p, f32 r, mat3* out) ret 0x10** (also called by parts 0x122b0
and 0x130f7):
```
sa=sin a, ca=cos a, sp=sin p, cp=cos p, sr=sin r, cr=cos r
out[0] = sa*(sp*sr) + ca*cr     out[1] = cp*sr      out[2] = sa*cr - ca*(sp*sr)
out[3] = (sa*cr)*sp - ca*sr     out[4] = cp*cr      out[5] = -(ca*cr)*sp - sa*sr
out[6] = -sa*cp                 out[7] = sp         out[8] = ca*cp
```
This is Kahn's view matrix, term for term. Only the float32 rounding of the intermediates differs (sa, ca,
sp, cp, sr and the products sp*sr, sa*cr, ca*cr are stored as f32; cr stays extended). Emulated against
Kahn 0x2f2f0 on random cameras: max element difference 9.7e-8. **Keep Kahn `lookAt`.**

**0x1de00 mat_row2_dot(eax = mat3*, edx = vec*, ebx = vec* out)**: `out.z = M[6]*v.x + M[7]*v.y + M[8]*v.z`
(evaluated `M[7]*v.y + M[6]*v.x + M[8]*v.z`), only out+8 is written. New helper, used only by the GOR branch.

### 5.4 ENV and GOR vertex attributes
- ENV (0x04): `u = nx*127 + 127`, `v = ny*127 + 127` with (nx, ny) the view-space vertex normal (rotation R
  only, scale and parents ignored, as Kahn). Range [0, 254] for a unit normal (Kahn: [-1, 255]).
- GOR (0x10), new: **0x2df78 clamp_u8(stack: f32 x, u8 lo, u8 hi) -> al, ret 0xc**:
  ```
  if ((float)lo > x) return lo;
  if ((float)hi < x) return hi;
  return (u8)(int)trunc(x);          // call 0x199b2 + fistp: round toward zero
  ```
  The caller passes lo = 0, hi = o->b21 (+0x21) and x = (f32)((float)o->b21 * vn.z), then stores
  `u = (float)(o->b20 (+0x20) + result)` (int add, no wrap). In this executable nothing writes +0x20/+0x21
  (searched: no byte store at +0x20/+0x21 outside this function's reads) and no object name contains
  "GOR", so the branch is dead. Port it only for completeness.

### 5.5 0x1f708 cull_and_sort() (Kahn 0x2c7a8)
Identical algorithm (same near plane 1.0 test on all three vertices, same `dot(sum of view positions,
view normal) > 0` back-face test, same key `trunc(sum_z * 16384.0) + 0x1000000` (f64 16384 at 0x50bb0,
truncation by 0x199b2), same flare key `trunc(z * 49152.0) + 0x1000000` for world nodes of type 2 when
z > 0 (f64 compare), same object skip `flags & 0x17`, same 4-pass LSD radix sort, ascending =
nearest first, stable). Differences:
- two-sided test: `face.flags (+0x2a, u16) & 0x80` (Kahn: byte +0x30 & 0x08);
- face stride 0x30, key stored at face+0x26; flare pseudo-face at light+0x44, its vertex view z read
  through the face's v0 pointer (+0x20 of the light's vertex);
- the radix passes are coded with pointer walks instead of indices; histograms at 0x5df0c, 0x5e310,
  0x5e714, 0x5eb18; prefix sums for i = 1..255 `h[i] += h[i-1]`; A->B byte 0, B->A byte 1, A->B byte 2,
  B->A byte 3. Same result.
- statistics: [0x5ef20]++, [0x5ef1c] += count.

JS: in `isFaceVisible` test `face.flags & 0x80` for two-sided (rename `FACE_TWO_SIDED = 0x80`).

---------------------------------------------------------------------------------------------------
## 6. Keyframer

### Identical to Kahn
0x1e1e4 (track_alloc = 0x2fce4), 0x1e208/0x1e2a8/0x1e348/0x1e3ec (key constructors = 0x2fd08..0x2feec),
0x1e598 (= 0x3009c), 0x1e798/0x1e958 (looping tangents = 0x3029c/0x3045c), 0x1ecd0/0x1ed28 (two-key
tangents = 0x30848/0x308a0), 0x1ed84 (track_finish = 0x308fc; it calls 0x1e5ec, 0x1e798, 0x1e958,
0x1eb10, 0x1ebe4, 0x1ecd0, 0x1ed28 in the Kahn roles), 0x1f450 (hide = 0x30fe0), 0x1f520 (morph = 0x310b0),
0x1f66e (rand = 0x2fbc9), 0x1f668 (6-byte stub, SAME as several Kahn stubs).

### 6.1 0x1e494 ease(stack f32 u, f32 a, f32 b) ret 0xc (Kahn 0x2ff94; similarity 0.99)
One real difference: Kahn rescales with `a *= 1/s_f32` (the sum stored as float32); Brother divides by
the sum as f64: `a = (f32)(a * (1.0 / s))`, `b = (f32)(b * (1.0 / s))` with `s = (f64)(a + b)`.
Everything else is the same (`k = (f32)(1/((2.0 - a) - b))`, the three branches).
JS `ease`: `const inverse = 1 / sum;` (drop the `f()`). a + b of two float32 is exact in f64, so the
only change is the missing float32 rounding of the sum.

### 6.2 0x1e5ec middle-key tangents (Kahn 0x300f0; similarity 0.98)
`h = 0.5 - T*0.5` instead of `0.5*(1 - T)` (f64 0.5); the rest is identical. Same values (emulated:
tangents bit-identical). No JS change.

### 6.3 First / last key of a non-looping track: 0x1eb10 (Kahn 0x30614), 0x1ebe4 (Kahn 0x30728)
Rewritten in a simplified form. Arguments as in Kahn (eax, edx, ebx = keys[0], keys[1], keys[2] for the
first key; keys[n-3], keys[n-2], keys[n-1] for the last).
```
0x1eb10 (first key, writes k0.dd[0..3]):
    g = -(float)(k1.frame - k0.frame) / ((float)(k2.frame - k0.frame) * 2.0f);
    for i in 0..3:  k0.dd[i] = ((k2.v[i]-k0.v[i]) * g + (k1.v[i]-k0.v[i]) * 1.5) * (1 - k0.T);   // 1.5 is f64
0x1ebe4 (last key, writes kc.ds[0..3]):   ka = keys[n-3], kb = keys[n-2], kc = keys[n-1]
    g = -(float)(kc.frame - kb.frame) / ((float)(kc.frame - ka.frame) * 2.0f);
    for i in 0..2:  kc.ds[i] = ((kc.v[i]-ka.v[i]) * g + (kc.v[i]-kb.v[i]) * 1.5) * (1 - kc.T);
    i = 3:          kc.ds[3] = ((kc.v[3]-ka.v[3]) * g + (kc.v[3]-kb.v[3]) * 1.5
                                - (kc.v[3]-ka.v[3]) * 0.25) * (1 - kc.T);                       // 0.25 is f64
```
Kahn's formula `(d20*f + ((d10 - d20*0.5)*3)*0.5 + d20*0.5) * (1-T)` with `f = 0.25 - r` is the same thing
algebraically (`d20*(f - 0.25) + 1.5*d10`), and the emulated values agree for components 0..2 of both
functions and component 3 of the first-key function. **Component 3 of the last-key tangent differs**: it
carries an extra `-0.25*(kc.v[3]-ka.v[3])`. Checked in the emulator against the formula above (4 random
cases, agreement to f32 rounding). v[3] is 0 for every non-rotation track, so this only affects the
quaternion w of rotation tracks with 3 or more keys that do not loop. In the data: SHPITZ Sphere,prs (4 rot
keys), the $$$DUMMY that carries the flares (8), all TENNISB limbs with 3+ rotation keys.
JS `setLastTangent`:
```js
for (let i = 0; i < COMPONENTS; i++) {
  const fromThirdLast = last.v[i] - thirdLast.v[i];
  const fromSecondLast = last.v[i] - secondLast.v[i];
  let tangent = fromThirdLast * factor + (fromSecondLast - fromThirdLast * 0.5) * 3 * 0.5 + fromThirdLast * 0.5;
  if (i === 3) {
    tangent -= fromThirdLast * 0.25;   // BROTHER.EXE 0x1ebe4 only
  }
  last.ds[i] = tangent * (1 - last.tension);
}
```

### 6.4 Evaluators 0x1ee9c (float), 0x1f024 (vec3), 0x1f220 (quat) (Kahn 0x30a14, 0x30ba4, 0x30da8)
Same segment selection (loop wrap with truncation, one-key-per-call cursor advance, hold last key,
n == 1 shortcut). The Hermite weights are computed in a different x87 order: h2 = 3u² - 2u³ with 3u²
kept in extended precision (Kahn: `-2u³ + f32(3u²)`); h1 = (2u³ - f32(3u²)) + 1, h3 = u + (u³ - 2u²),
h4 = u³ - u², output `((h1*cur + h2*next) + h3*cur.dd) + h4*next.ds`, h1..h4 stored as f32 for
components >= 1 in the vec/quat versions, as Kahn. Emulated on 40 random tracks (1 to 7 keys, all
three types, random TCB/ease): outputs differ from Kahn by at most 1-2 float32 ulp (plus the quaternion w
effect of 6.3). No JS change.

---------------------------------------------------------------------------------------------------
## 7. Other functions named in the task

- **0x1c3b0**: not engine. cdecl function inside MIDAS (called from 0x1a5ac): copies fields
  [p+0x24], [0x5defc], [p+0x54] into the structure at [p+0x4c] and returns it through the 3rd argument.
  The 0.65 similarity to Kahn's mat_make is accidental.
- **0x1dfe4**: rotation_matrix, 5.3. **0x1e0fb**: atan2 helper (fxch; fpatan, or the emulator path when
  byte [0x56a7a] & 1), = Kahn 0x31513.
- **0x1eb10, 0x1ebe4**: 6.3.
- 0x2e8f6, 0x2e946 (no Kahn match, after 0x2dffc): called only from 0x176e4 (library), not engine.
- 0x1fb70, 0x22324, 0x24da4, 0x24fe0 (drawers, between the keyframer and the loader): other slice.
  0x1fb70 = Kahn 0x23cf0 (SAME).

---------------------------------------------------------------------------------------------------
## 8. The two scenes

Parsed with a script that implements the rules above (chunk table, y/z swap, Brother name flags, lens
table). Both parse to the end; every node finds its object.

### SHPITZ.3DS (part 0x13559, loaded by 0x134da with user word 0x14)
- size 38803, frames 0..400 (span 400).
- materials (file order): TXTURE1 -> STONES.GIF, ENVIRON -> TRIPAT.GIF. Scene palette = TRIPAT.GIF's.
- meshes (world order), Brother render flags:

| object | flags | verts | faces | material | uv |
|---|---|---|---|---|---|
| obj,env3 | 0x05 | 96 | 188 | ENVIRON | no |
| obj,env4 | 0x05 | 96 | 188 | ENVIRON | no |
| obj2,env2 | 0x05 | 96 | 188 | ENVIRON | no |
| obj,env5 | 0x05 | 96 | 188 | ENVIRON | no |
| Obj,env1 | 0x05 | 96 | 188 | ENVIRON | no |
| obj,env6 | 0x05 | 96 | 188 | ENVIRON | no |
| Sphere,prs | 0x02 | 114 | 224 | TXTURE1 | yes |
| $$$DUMMY "Dummy01" | (dummy, state flag 4) | 0 | 0 | - | - |

- 14 lights (Light01..Light14), all omni: scene+0x10 = 1352 + 14 = **1366**, light count 14.
  Light07..Light12 share the file position (82.5, 0, 69.3) (y/z-swapped coordinates as stored).
- cameras: Camera01 pos (-223.5, 227.1, 274.3) target (-2.9, 0, -18.1); Camera02 pos (-200.5, -273.4, 0)
  target (5.8, 9.6, 0) (y/z-swapped as stored); roll 0; lens 49.999996 -> no table match -> fov
  48.000004 for both. The part fetches both by name (0x2ba90).
- keyframer (node id: name, tracks as keys[first..last frame]; track flag word when non-zero):
  - 0..5 the six env objects: pos 3 [0..400], **rot 2 [0..30] flags 0x443 -> loop (0x0f00)**, scale 1.
    The only looping tracks in either scene: the spikes spin with a 30-frame period.
  - 6 Camera01 target: pos 2 [0..378]. 7 Camera01: pos 18 [0..400], fov 1, roll 3 [0..228].
  - 8 Sphere,prs: pos 1, rot 4 [0..400], scale 1.
  - 9 $$$DUMMY (instance "Dummy01", pivot 0): pos 1, rot 8 [0..388], scale 3 [0..400].
  - 10..21 Light02, 03, 05, 06, 01, 04, 08, 09, 11, 12, 07, 10: children of node 9 (the dummy); pos 1 each.
    The dummy's rotation and scale carry these 12 flares around.
  - 22 Camera02 target: pos 1. 23 Camera02: pos 11 [0..400], fov 2 [0..230], roll 4 [0..378].
  - 24 Light13, 25 Light14: no parent, pos 1.
  - $AMBIENT$ (0xB001) node: ignored.
- No hidden-node flag (all 0x4270 / 0x0270 / 0x0070 / 0x0030 / 0x0010), no hide or morph tracks.

### TENNISB.3DS (part 0x13933, loaded by 0x138b4 with user word 0x14)
- size 34172, frames 0..185 (span 185).
- one material: WALLS -> SEA.GIF.
- 18 meshes, all render flags **0x01** (no suffixes): Object01 (26 v / 48 f), Body (169/334), Hand,
  Hand01, Hand02, Hand03, Leg, Leg01, Leg02, Leg03 (32/60 each), Foot, Foot01, Foot02, Foot03 (8/12 each),
  Foot04 (22/40), Racket (96/192), Ball (26/48), ball01 (24 v / 12 f, uv, material WALLS). Every mesh but
  ball01 has no 0x4130 chunk and falls back to the first material (WALLS).
- **Hidden-node flag**: every object node except ball01 has flags1 = 0x4a70 (bit 0x0800 set) -> state flag 1
  and its faces are subtracted: scene+0x10 = 1202 + 1 light - 1190 = **13** (ball01's 12 faces and the
  light). Only ball01 and the flare go through the sorted list; the part draws the other 17 meshes
  vertex by vertex as sprites (5.2).
- 1 light (Light01). Cameras Camera01 pos (1229.3, 932.1, 608.9) target (-2.1, -254.6, 29.9);
  Camera02 pos (-1832.3, 0, -3513.1) target (-66.1, 0, -191.0); roll 0; fov 48.000004 for both.
- keyframer: hierarchy Body(0) -> Leg01(1) -> Leg02(2) -> Foot(3); Body -> Leg(4) -> Leg03(5) -> Foot01(6);
  Body -> Object01(7); Body -> Hand(8) -> Hand02(9) -> Foot03(10) -> Foot04(11) -> Racket(12);
  Body -> Hand01(13) -> Hand03(14) -> Foot02(15); Ball(16), ball01(20) roots. Body: pos 3 [0..169], rot 10
  [0..152]; limbs: rot 1..13 keys up to frame 169; Ball: pos 15 [0..169], scale 3 [0..185]. Camera01:
  target 6 keys [0..169], pos 5 [0..169]; Camera02: target 3, pos 3 [0..170]; fov and roll 1 key each.
  Pivots are set on the limbs (e.g. Body (-5.19, -95.38, 0) in file axes). No looping track (flag words
  0x40, 0x440, 0x840: `& 3 == 0`), no hide or morph tracks.

---------------------------------------------------------------------------------------------------
## 9. Verification

- **Emulation** (unicorn, both executables' code and data loaded at 0x10000/0x50000, stack-check stubbed):
  - tangents: 0x1eb10 vs 0x30614 identical; 0x1ebe4 vs 0x30728 identical for components 0..2, component 3
    differs exactly by `-0.25*dca*(1-T)` (6.3);
  - track_finish + evaluate (0x1ed84 + 0x1ee9c/0x1f024/0x1f220 vs 0x308fc + 0x30a14/0x30ba4/0x30da8), 40
    random tracks over the whole frame range: tangents bit-identical except 6.3, outputs within 1.5e-5 on
    values of magnitude 100 (1-2 ulp);
  - camera matrix 0x2df10 vs 0x2f2f0: max difference 9.7e-8 on 6 random cameras.
- **Chunk table and lens table** compared entry by entry with Kahn: identical ids, roles and values.
- **Capture** (`capframe.py --sheet 0 175 5`, plus single frames at 70 s and 127 s):
  - 60..85 s: SHPITZ: a six-armed grey env-mapped star (6 "env" meshes, 0x05) in front of a textured
    perspective sphere (Sphere,prs, 0x02) with about a dozen white flares around it. Agrees with 8.
  - 120..145 s: TENNISB: a room textured with a hexagon pattern (ball01, the only sorted mesh), a tennis
    player, racket and ball drawn as white dots (the hidden meshes drawn vertex by vertex), one flare.
    Agrees with the hidden flags and with the removed transform skip.
  I did not check pixel values: the drawers and the part loops belong to other slices.

## 10. UNSURE / open
1. Object +0x22..+0x51 and scene +0x2a..+0x39: zero-filled, no reader found (static search for direct
   offsets only).
2. GOR (0x10), ZER (0x20), TRN (0x40), SPC (0x08): no object in the two scenes uses them; their drawer
   meaning is not in this slice. GOR's per-object base/range bytes are never written, so a GOR mesh would
   get u = 0 on every vertex.
3. The 3rd/4th register arguments the parts pass to 0x2ddd4 (ebx = 0x5db74 / 0x5db8c, ecx = 1) are
   ignored by it; the parts may expect something there (other slice).
4. Kahn note open question 1 (the id counter is never reset between scenes) still holds: TENNISB's object
   ids continue after SHPITZ's last node id. Nothing in this slice compares node ids with object ids.
