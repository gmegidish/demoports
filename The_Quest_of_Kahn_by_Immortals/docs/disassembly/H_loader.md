# H — 3D scene loader, data model, picture loaders (KAHN.EXE)

Slice: 0x2cc1c..0x2f2f0, sub_31550, sub_311f8, sub_2c750, string helpers 0x3cc0f/0x3cc56/0x3cd60,
picture loaders 0x1e380..0x1f318. The engine is a C++-ified derivative of the "Clax" 3DS keyframer
(same chunk-name strings, `$AMBIENT$`, `$$$DUMMY`), but with different, **byte-packed** structs.

Validation scripts (read-only re-implementations, all in `$S/re/`):
- `h_parse3ds.py FILE [-v]`  the loader below, re-implemented; parses all 9 SCENES/*.3DS without error.
- `h_stats.py`               per-scene summary (objects, flags, materials, tracks).
- `h_gif.py`, `h_pcx.py`     the GIF and PCX decoders below; pixel+palette output is byte-identical to
  PIL for every file in TEXTURES/ (62 GIF, 2 PCX).

All structs are packed (alignment 1): dwords sit at odd offsets. All floats are float32 unless stated.
"vec" = 3 float32 (x,y,z) = 12 bytes. "mat3" = 9 float32 row-major (m[row*3+col]) = 36 bytes.
"quat" = 4 float32 in order x,y,z,w.

---------------------------------------------------------------------------------------------------
## 0. External helpers used (by behaviour)

| addr | meaning |
|---|---|
| 0x23599 | fopen(eax=name, edx=mode) |
| 0x2364d | fread(eax=buf, edx=size, ebx=count, ecx=FILE) -> items read |
| 0x32376 | ftell(eax=FILE) |
| 0x3227a | fseek(eax=FILE, edx=offset, ebx=whence) |
| 0x323b8 | fgetc(eax=FILE) (-1 on EOF) |
| 0x2390b | fclose |
| 0x23828 / 0x32104 | raw malloc / free;  0x1e268 / 0x1e25c app malloc / free |
| 0x2fb78 | operator new(eax=size) (malloc with new-handler retry). NOT zeroed; callers memset |
| 0x1d3b0 | memset(eax=ptr, edx=val, ebx=n) |
| 0x3cd27 | sprintf(buf, fmt, ...) (cdecl stack) |
| 0x102f0 | ostream << string (eax=stream 0x59338, edx=char*) ; 0x3220a exit(eax) |
| 0x3251c | strncmp/memcmp(eax, edx, ebx=n) |
| 0x23ac4 | vec_sub(eax=a, edx=b, ebx=out): out = a - b |
| 0x23aa0 | vec_add(eax=a, edx=b, ebx=out) |
| 0x23b8c | vec_cross(eax=a, edx=b, ebx=out): out = (a.y*b.z-a.z*b.y, a.z*b.x-a.x*b.z, a.x*b.y-a.y*b.x) |
| 0x23bc8 | vec_normalize(eax=v) in place: l2=x²+y²+z² (stored as float32); if (0 < l2) v *= 1/sqrt(l2); else unchanged |
| 0x23c90 | vec_copy(eax=src, edx=dst) |
| 0x23cbc | vec_make(stack: float x, y, z, vec* out) (ret 0x10) |
| 0x312b0 | mat3_mul_vec(eax=M, edx=v, ebx=out): out[i] = M[i*3]*v.x + M[i*3+1]*v.y + M[i*3+2]*v.z |
| 0x31480 | mat3_make(stack: 9 floats row-major, mat3* out) (ret 0x28) |
| 0x3ce10 | quat_identity(eax=q): (0,0,0,1) |
| 0x3d230 | quat_make(stack: a,b,c,d, quat* out): out = {a,b,c,d} |
| 0x3cec4 | axisangle_to_quat(eax=q) in place: h = q[3]*0.5 (double); s=sin(h); c=cos(h); q = (q[0]*s, q[1]*s, q[2]*s, c) |
| 0x3d17c | quat_mul(eax=a, edx=b, ebx=out), Hamilton product a*b: |
|         | out.w = a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z |
|         | out.x = a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y |
|         | out.y = a.w*b.y + a.y*b.w + a.z*b.x - a.x*b.z |
|         | out.z = a.w*b.z + a.z*b.w + a.x*b.y - a.y*b.x |
| 0x3d204 | quat_copy(eax=src, edx=dst) (copies 0x14 bytes: the quat class is 20 bytes, 5th dword unused here) |
| 0x3ce38 | quat "normalize"(eax=q): n = x²+y²+z²+w² (float32); if (0 < n) q *= 1/n  (NO sqrt - divides by the squared norm; a no-op for unit quats); else q = (0,0,0,1) |
| 0x1f318 | FPU helper: frndint with control word high byte 0x1f = round toward zero (truncate). Always followed by fistp. |
| 0x2fce4, 0x2fd08, 0x2fda8, 0x2fe48, 0x2feec | track/key constructors, documented in §1.9 (outside the slice but needed for the model) |
| 0x308fc | track_finish(eax=track): sets track+8 = frame of last key, computes spline tangents (other slice) |
| 0x10734 | returns the next 64K-aligned 64K texture block |

### String helpers (in slice)
- **sub_3cc0f** `stricmp(eax=a, edx=b)`: ASCII case-insensitive ('A'..'Z' -> +0x20 on both sides), returns
  (lower(a[i]) - lower(b[i])) at first difference / terminator; 0 = equal.
- **sub_3cc56** `strstr(eax=haystack, edx=needle)`: case-SENSITIVE; returns pointer to first occurrence or 0
  (empty needle returns haystack).
- **sub_3cd60** `strcmp(eax=a, edx=b)`: 0 if equal (also 0 immediately if a==b as pointers), else -1/+1.
- **sub_311f8** `strdup(eax=s)`: malloc(strlen+1) + copy; returns 0 if malloc fails.

---------------------------------------------------------------------------------------------------
## 1. Data model

### 1.1 Globals
| addr | type | meaning |
|---|---|---|
| 0x5e0e0 | Scene* | scene currently being LOADED (set by sub_2f1bc, stays pointing at the last loaded scene) |
| 0x5e0dc | void* | "current object" during loading (mesh / light / camera last created or referenced) |
| 0x5e0d4 | int | id counter. Incremented for every mesh/light/camera created; overwritten with the node id by chunk 0xB030. **Never reset between scenes.** |
| 0x5e0d8 | int | chunk id of the enclosing chunk (set on entry of the recursive reader, §2.1) |
| 0x5e0e4 | char[0x80] | last ASCIIZ name read (sub_2d4ec), no bounds check |
| 0x5e164 | float* | pointer to a 5-float scratch array (T, C, B, easeTo, easeFrom), 0x14 bytes, allocated by static init sub_2cc00 |
| 0x5c968 | WNode* | tail of the world list while loading |
| 0x5c970 | KNode* | tail of the keyframer list while loading |
| 0x5c978 | Material* | current/tail material while loading |
| 0x55de0 | table | chunk dispatch table, 52 entries × 10 bytes (§2.2) |
| 0x55d98 | float[18] | lens→FOV table (§2.3 camera) |
| "active scene" copies written by sub_2d150: | | |
| 0x5c964 | WNode* | scene+0x00 world list head |
| 0x5c96c | KNode* | scene+0x04 keyframer list head |
| 0x5c974 | Material* | scene+0x08 material list head |
| 0x5c97c | Material* | scene+0x0c flare material |
| 0x5c984 | int | scene+0x10 face count (size of the sort lists) |
| 0x5c980 | int | scene+0x14 light count |
| 0x5c988 | Camera* | scene+0x18 active camera |
| 0x5c98c / 0x5c98e | u16 | scene+0x1c / +0x1e first / last frame |
| 0x5c990 | float | scene+0x20 frame span (last - first) |
| 0x5c998 | u16 | scene+0x24 user word given to the loader |
| 0x5c99c / 0x5c9a0 | float | projection scale x / y (see sub_2d150) |
| 0x5e0c8 / 0x5e0cc | void** | two face-pointer arrays (visible list / radix-sort temp), each 4*[0x5c984] bytes (sub_2c750) |
| 0x5c9b0 | u8[768] | current palette, 6-bit; overwritten by every picture load (§5) |

### 1.2 Scene — 0x2a bytes (sub_2f1bc)
```
+0x00 WNode*    world list head (meshes, cameras, lights in creation order; dummies appended later)
+0x04 KNode*    keyframer node list head (file order)
+0x08 Material* material list head (file order)
+0x0c Material* flare material (only allocated when light count != 0, else NULL)
+0x10 int       face count = sum of all mesh face counts + 1 per light - faces of objects flagged hidden
+0x14 int       number of lights
+0x18 Camera*   first camera in the world list ("No Camera Defined." fatal if none)
+0x1c u16       first frame   (chunk 0xB008)
+0x1e u16       last frame
+0x20 float     (float)(last - first)
+0x24 u16       2nd argument (edx) of sub_2f1bc, uninterpreted here
+0x26 u8*       malloc(768) copy of palette 0x5c9b0 taken after all textures were loaded
```
### 1.3 WNode (world list node) — 0x0e bytes (sub_2cc1c)
```
+0x00 u16   type: 0 = mesh object (also dummy), 1 = camera, 2 = light
+0x02 void* object
+0x06 WNode* next
+0x0a WNode* prev
```
### 1.4 Object (mesh) — 0xe0 bytes (sub_2d550 / dummy in sub_2e03c), zero-filled
```
+0x00 char*  name (strdup). Dummies: 0 until chunk 0xB011 supplies the instance name
+0x04 int    id (value of 0x5e0d4 at creation; dummies: the keyframer node id)
+0x08 int    parent OBJECT id (id field of the parent's object), -1 = none. Set by 0xB010 under 0xB002
+0x0c Vertex* vertices   (count*0x40 bytes)
+0x10 Face*  faces       (count*0x35 bytes)
+0x14 int    vertex count
+0x18 int    face count
+0x1c u16    state flags: 0x01 hidden (node flags1 & 0x0800; cleared again if a hide track exists),
                          0x04 dummy, 0x08 has morph track. (0x02, 0x10 are not set by the loader;
                          scene code ORs 0x10; sub_2c7a8 skips objects with flags & 0x17)
+0x1e u16    render flags derived from the name (§3); low byte is copied into every face
+0x20 char*  material name (strdup) from the LAST 0x4130 chunk of the mesh; NULL if none
+0x24 vec    mesh-matrix translation (0x4160 origin, y/z swapped)
+0x30 mat3   inverse mesh matrix, y/z swapped (0x4160), see §2.3
+0x54 vec    pivot (0xB013, y/z swapped); (0,0,0) if never set
+0x60..0xdf  runtime (animation matrices etc.) - not touched by the loader
```
### 1.5 Vertex — 0x40 bytes
```
+0x00 vec   position in object (pivot-relative) space after load (§2.4)
+0x0c vec   vertex normal, object space. ONLY computed for meshes with render flag 0x04 (env);
            (0,0,0) otherwise
+0x18 vec   runtime: transformed (camera space) position
+0x24 vec   runtime: transformed normal (env objects)
+0x30 float u' = u*256 + 8192
+0x34 float v' = 8192 - v*256
+0x38 float raw u from the file
+0x3c float raw v from the file
```
(all zero if the mesh has no 0x4140 chunk)
### 1.6 Face — 0x35 bytes (53)
```
+0x00 Vertex* v0, +0x04 Vertex* v1, +0x08 Vertex* v2   (pointers, not indices)
+0x0c vec    face normal, object space, normalize((v1-v0) x (v2-v0)) (§2.5)
+0x18 vec    runtime: transformed normal
+0x24 8 bytes runtime (not touched by the loader)
+0x2c int    runtime: sort key (sub_2c7a8)
+0x30 u8     render flags = low byte of object+0x1e (lights: 0x80)
+0x31 u8*    texture (256x256, 64K block) of the object's material (§2.6)
```
The 3DS per-face flag word and smoothing groups are discarded.
### 1.7 Material — 0x10 bytes
```
+0x00 char* name (0xA000)
+0x04 char* map file name (0xA300, last one seen inside 0xA200 or 0xA230); NULL if the material has no map
+0x08 u8*   texture block (64K, from sub_10734)
+0x0c Material* next
```
No colours, shading modes or lookup tables are kept per material.
### 1.8 Camera — 0x54 bytes; Light — 0x81 bytes
```
Camera:
+0x00 char* name            +0x04 int id
+0x08 int   parent object id of the camera node (0xB003), -1 none
+0x0c int   parent object id of the camera TARGET node (0xB004), -1 none
+0x10 vec   position (y/z swapped)       +0x1c vec target (y/z swapped)
+0x28 float roll  = -(file roll in degrees) * pi/180    (radians)
+0x2c float fov in degrees (from lens, §2.3)
+0x30 mat3  runtime camera matrix (not written by the loader)

Light = name/id header + one embedded Vertex + one embedded Face (so it can sit in the face sort list):
+0x00 char* name            +0x04 int id
+0x08 int   parent object id (0xB005/6/7), -1 none
+0x0c Vertex (0x40 bytes): +0x0c position (y/z swapped); rest zero
+0x4c Face   (0x35 bytes): v0 = v1 = v2 = &light+0x0c;
                           flags (+0x7c) = 0x80; texture (+0x7d) = flare texture (set in sub_2d274)
```
Light colour, spotlight data, camera ranges are read and discarded.
### 1.9 Keyframer: KNode 0x1c, track set, Track 0x12, Key 0x56
```
KNode (sub_2ce7c):
+0x00 u16  type: 0 object, 1 camera, 2 camera target, 3 light (omni, spot, and light target all use 3)
+0x02 u16  node id (0xB030)
+0x04 void* object (Object* / Camera* / Light*)
+0x08 Track** track set (array of pointers, zero-filled):
        type 0: 5 slots  [0] position [1] rotation [2] scale [3] hide [4] morph
        type 1: 3 slots  [0] position [1] roll [2] FOV
        type 2: 1 slot   [0] position (of the target)
        type 3: 1 slot   [0] position
+0x0c KNode* first child   (most recently added child)
+0x10 KNode* next sibling
+0x14 KNode* next in list  +0x18 KNode* prev in list

Track (operator new 0x12, zero-filled):
+0x00 int  number of keys allocated
+0x04 int  number of keys stored (incremented by the key constructors; hide track: reset to 0 afterwards)
+0x08 int  frame number of the last key (set by sub_308fc; hide track: set by the reader)
+0x0c u16  loop flags: 0x0f00 if (track flags word & 3) != 0, else 0. (The intermediate value 0x00f0
           for bit 1 is always overwritten.) All tracks in the shipped scenes have 0.
+0x0e Key* keys (malloc(n*0x56), NOT zeroed: fields not listed for a key type are garbage)

Key (0x56 bytes):
+0x00 u16   frame (low word of the 32-bit frame number)
+0x02 float a   pos/scale: x     scalar tracks: value   rotation: quat x
+0x06 float b   pos/scale: y(=file z)                    rotation: quat y
+0x0a float c   pos/scale: z(=file y)                    rotation: quat z
+0x0e float d   0 for vec/scalar keys                    rotation: quat w
+0x12 int   rotation only: key's own rotation angle in whole degrees, truncated (§2.3)
+0x16 Object* morph only: target object
+0x1a float tension  +0x1e float continuity  +0x22 float bias  +0x26 float easeTo  +0x2a float easeFrom
+0x2e float[4] = 0   (tangent slot, filled by sub_308fc)
+0x3e 4 bytes  not written
+0x42 float[4] = 0   (tangent slot, filled by sub_308fc)
+0x52 4 bytes  not written
```
Key constructors (all: `k = &trk->keys[trk->count]; ...; trk->count++`, copy 5 spline floats to +0x1a..+0x2a,
zero +0x2e..+0x3a and +0x42..+0x4e):
- **sub_2fce4**(eax=trk, edx=n): keys = malloc(n*0x56); count = 0; nkeys = n.
- **sub_2fd08**(eax=trk, stack: float value, int frame, float* spline) ret 0xc: a=value, b=c=d=0.
- **sub_2fda8**(eax=trk, stack: float x, y, z, int frame, float* spline) ret 0x14: a,b,c = x,y,z; d = 0.
- **sub_2fe48**(eax=trk, stack: float qx,qy,qz,qw, int degrees, int frame, float* spline) ret 0x1c: +2..+0xe = quat; +0x12 = degrees.
- **sub_2feec**(eax=trk, edx=Object*, ebx=frame, ecx=spline): a=b=c=d=0; +0x16 = object.

---------------------------------------------------------------------------------------------------
## 2. Loading a .3DS file

### 2.1 sub_2f1bc — load_scene(eax = filename, edx = u16 user word) -> Scene* (eax)
```
f = fopen(name, "rb");
if (!f) { sprintf(buf, "Cant open %s !", name); fatal(buf); }
scene = [0x5e0e0] = new(0x2a); memset(scene, 0, 0x2a);
[0x5c964]=[0x5c968]=[0x5c96c]=[0x5c970]=[0x5c974]=[0x5c978]=[0x5c97c]=[0x5c980]=[0x5c984]=0;
scene->w24 = (u16)edx;
fseek(f,0,SEEK_END); size = ftell(f); fseek(f,0,SEEK_SET);
read_chunks(f, size, 0);          // sub_2f08c
transform_vertices();             // sub_2f140
scene->camera = first_camera();   // sub_2d124: first WNode of type 1
if (!scene->camera) fatal("No Camera Defined.");
compute_normals(scene);           // sub_31550
load_textures();                  // sub_2d274
scene->palette = malloc(0x300); memcpy(scene->palette, 0x5c9b0, 0x300);
return scene;                     // the file is never closed; 0x5e0d4 is NOT reset
```
### sub_2f08c — read_chunks(eax = FILE, edx = end offset, bx = parent chunk id)
```
[0x5e0d8] = (u16)bx;                               // only on entry, not restored after nested calls
loop:
  if (ftell(f) >= end) return;
  start = ftell(f);
  if (fread(hdr, 6, 1, f) != 1) return;            // u16 id, u32 length
  if (hdr.length == 0) return;
  idx = find_chunk(hdr.id);                        // sub_2f054: linear search of the 52-entry table, -1 if absent
  chunk_end = start + hdr.length;
  if (idx >= 0) {
      if (table[idx].handler) table[idx].handler(eax = f, edx = chunk_end);
      else read_chunks(f, chunk_end, hdr.id);      // container: recurse
  }                                                // unknown ids are skipped
  fseek(f, chunk_end, SEEK_SET);
  if (f->flags & 0x20) return;                     // stream error bit
  goto loop;
```
Handlers that contain sub-chunks call read_chunks themselves (0x4000, 0x4100, 0x4120, 0x4600) and pass
`bx = (u16)[0x5e0d4]` (the id counter!) as "parent id", so [0x5e0d8] is meaningless inside objects. It is
only tested by the 0xB010 handler, where the enclosing 0xB001..0xB007 container has just set it.

### 2.2 Chunk table at 0x55de0 (entry = u16 id, char* name, handler; 0 handler = container, recurse)
```
0x0010 RGB float           sub_2d49c  read 12 bytes, discard
0x0011 RGB byte            sub_2d4c4  read 3 bytes, discard
0xC23D Project             -          container
0x3DAA Material Library    -
0x4D4D Main                -
0x3D3D Object Mesh         -
0x1200 Background color    -
0x2100 Ambient color       -
0x4000 Object Block        sub_2d524
0x4100 Tri-Mesh            sub_2d550
0x4110 Vertex list         sub_2d71c
0x4111 Vertex flag list    sub_2d490  (empty function)
0x4120 Face list           sub_2d7ec
0x4165 Mesh color          sub_2d490
0x4130 Face material       sub_2d928
0x4140 Mappings list       sub_2d9a0
0x4170 Texture info        sub_2d490
0x4150 Smoothings          sub_2da7c  reads u32s until chunk end, discards
0x4160 Matrix              sub_2dac8
0x4600 Light               sub_2dc9c
0x4610 Spotlight           sub_2dd7c  read 20 bytes, discard
0x4700 Camera              sub_2de10
0x4F00 Hierarchy           -
0x7001 Viewport info       sub_2d490
0xAFFF Material            -
0xA000 Material name       sub_2df04
0xA010 Ambient color       -
0xA020 Diffuse color       -
0xA030 Specular color      -
0xA200 Texture map         -
0xA230 Bump map            -
0xA300 Map filename        sub_2df98
0xB000 Keyframer data      -
0xB001 Ambient key         -
0xB002 Track info          -          (object node)
0xB008 Frames              sub_2dfbc
0xB010 Track Obj. Name     sub_2e03c
0xB011 Dummy Object Name   sub_2e018
0xB013 Pivot point         sub_2e298
0xB020 Position keys       sub_2e388
0xB021 Rotation keys       sub_2e554
0xB022 Scale keys          sub_2e7b8
0xB026 Morph keys          sub_2ee70
0xB029 Hide keys           sub_2ecf0
0xB030 Object number       sub_2f01c
0xB003 Camera track        -
0xB004 Camera target track -
0xB005 Pointlight track    -
0xB006 Pointlight target track -
0xB007 Spotlight track     -
0xB023 FOV track           sub_2e988
0xB024 Roll track          sub_2eb30
```
Everything else (e.g. 0x0002, 0x3D3E, 0x0100 master scale, 0x0030 percentages, 0xA040.., 0xA351.., 0xB009,
0xB00A, 0xB014 bounding box, 0xB015 morph smooth, 0xB025..0xB028 light tracks) is skipped.

### 2.3 Chunk handlers. All take eax = FILE, edx = chunk end. "abort" = return (chunk is then skipped).
Axis convention: every xyz triple read from the file is stored as **(x, z, y)** — file Y and Z are
swapped, no sign change. This applies to vertices, mesh matrix, pivots, camera/target/light positions,
position keys, scale keys and rotation axes.

**sub_2d4ec read_name(f)**: `i=0; while ((c=fgetc(f)) != -1 && c != 0) name[i++] = c; name[i] = 0;` into 0x5e0e4.

**sub_2d524 (0x4000 object block)**: `read_name(f); read_chunks(f, end, (u16)[0x5e0d4]);`

**sub_2d550 (0x4100 tri-mesh)**:
```
o = new(0xe0); memset(o,0,0xe0);
o->name = strdup(name);  o->id = [0x5e0d4]++;  o->flags(+0x1c) = 0;
env = strstr(name,"env") || strstr(name,"ENV");
spc = strstr(name,"spc");                          // lower case only
sp2 = strstr(name,"sp2") || strstr(name,"SP2");
cul = strstr(name,"cul") || strstr(name,"CUL");
prs = strstr(name,"prs") || strstr(name,"PRS");
rf  = prs ? 0x40 : 0x02;
if (env) rf |= 0x04;  if (cul) rf |= 0x08;  if (spc) rf |= 0x10;  if (sp2) rf |= 0x20;
o->rflags(+0x1e) = rf;
[0x5e0dc] = o;  world_add(0, o);                   // sub_2cc1c
read_chunks(f, end, (u16)[0x5e0d4]);
```
Matching is a case-sensitive substring test anywhere in the object name, so mixed case does NOT match:
"Arm,Env", "Ceilig,Prs", "Chai1,Pr01", "Fing1,en01" get plain 0x02.

**sub_2d71c (0x4110 vertices)**:
```
n = read u16; o->nverts = n; o->verts = malloc(n*64); memset 0;
for i in 0..n-1: read float x,y,z;  verts[i].pos = (x, z, y);
```
**sub_2d7ec (0x4120 faces)**:
```
n = read u16; o->nfaces = n; o->faces = malloc(n*0x35); memset 0;  scene->facecount += n;
for i in 0..n-1: read u16 a,b,c; read u16 faceflags (discarded);
    faces[i].v0 = &verts[a]; .v1 = &verts[b]; .v2 = &verts[c];   // file order kept (no winding swap)
    faces[i].flags(+0x30) = (u8)o->rflags;
read_chunks(f, end, (u16)[0x5e0d4]);               // 0x4130, 0x4150
```
Relies on 0x4110 preceding 0x4120 and 0x4100's name flags being final (true for all files).

**sub_2d928 (0x4130 face material)**: `read_name(f); o->matname = strdup(name); n = read u16; read n u16 (discarded);`
One material per object: a later 0x4130 overwrites the earlier one (old string leaks).

**sub_2d9a0 (0x4140 mapping)**:
```
n = read u16;
for i in 0..n-1: read float u, v;
    verts[i].u(+0x30) = (float)((double)u * 256.0 + 8192.0);
    verts[i].v(+0x34) = (float)(8192.0 + (-(double)v) * 256.0);
    verts[i].ru(+0x38) = u;  verts[i].rv(+0x3c) = v;
```
i.e. texel coordinates for a 256x256 texture, V flipped, biased by +32 texture widths so they stay positive.

**sub_2dac8 (0x4160 mesh matrix)**: reads float m[9] (three rows = local X,Y,Z axes in world space) and float t[3].
```
c = (float)(1.0 / (m0*m0 + m1*m1 + m2*m2));   // note evaluation: m1² + m0² + m2²
a = (float)(1.0 / (m3*m3 + m4*m4 + m5*m5));
b = (float)(1.0 / (m6*m6 + m7*m7 + m8*m8));
M = { m0*c, m1*c, m2*c,   m3*a, m4*a, m5*a,   m6*b, m7*b, m8*b };   // each row / |row|²  -> o+0x30
for r in 0..2: swap(M[r*3+1], M[r*3+2]);       // swap columns 1 and 2
swap rows 1 and 2 (M[3..5] <-> M[6..8]);
o->translate(+0x24) = (t0, t2, t1);
```
M is the inverse of the (orthogonal, possibly scaled) mesh matrix, expressed in the y/z-swapped system:
`local = M * (world - translate)`.

**sub_2dc9c (0x4600 light)**:
```
L = new(0x81); memset 0; read float x,y,z;
L->name = strdup(name); L->id = [0x5e0d4]++;
L->vertex.pos(+0x0c) = (x, z, y);
L->face.flags(+0x7c) = 0x80; L->face.v0 = v1 = v2 = &L->vertex (L+0x0c);
[0x5e0dc] = L; world_add(2, L);
scene->lightcount++; scene->facecount++;
read_chunks(f, end, (u16)[0x5e0d4]);           // 0x0010 colour, 0x4610 spot: read and dropped
```
**sub_2de10 (0x4700 camera)**: reads 8 floats: pos xyz, target xyz, roll, lens.
```
C = new(0x54); memset 0; C->name = strdup(name); C->id = [0x5e0d4]++;
C->pos(+0x10) = (px, pz, py);  C->target(+0x1c) = (tx, tz, ty);
C->roll(+0x28) = (float)(-(double)roll * 3.14159265358979 (double) * 0.00555555555 (double, 1/180));
lens_to_fov(lens, &C->fov);                    // sub_2dda4
[0x5e0dc] = C; world_add(1, C);
```
**sub_2dda4 lens_to_fov(stack: float lens, float* out)**, table at 0x55d98 (float32 pairs lens, fov):
```
15→115, 20→94.28571, 24→84, 28→76.36364, 35→63, 50→46, 85→28, 135→18, 200→12
for i in 0..8: if (lens == table[i].lens) { *out = table[i].fov; return; }     // exact float compare
*out = (float)(15.0 / lens * 160.0);                                            // doubles
```
In the shipped scenes no lens matches exactly (e.g. 49.999996 → 48.000004, 74.99999 → 32.000004,
40.000004 → 59.999996, 38.866394 → 61.750004, 35.294117 → 68.0, 30.769228 → 78.00001).

**sub_2df04 (0xA000 material name)**: read_name; allocate a zeroed 0x10 Material; append (scene+8 head if empty,
else [0x5c978]->next); [0x5c978] = it; it->name = strdup(name).
**sub_2df98 (0xA300 map filename)**: read_name; [0x5c978]->file = strdup(name). Reached only inside 0xA200 or
0xA230 (other map chunks are not in the table); the last one wins.

**sub_2dfbc (0xB008 frames)**: read u32 start, end; scene->first = (u16)start; scene->last = (u16)end;
scene->span = (float)(int)(last - first).

**sub_2f01c (0xB030 node id)**: read u16 → [0x5e0d4] = it (zero-extended).

**sub_2e03c (0xB010 node header)**:
```
read_name(f); read u16 flags1, u16 flags2; read s16 parent;
if (parent != -1) {                         // translate parent NODE id into parent OBJECT id
    pid = <uninitialised: low word of the FILE*>;      // only matters if no node matches (never in data)
    for k in keyframer list: if (k->id == parent) pid = (s16)*(u16*)(k->object + 4);   // last match wins
} else pid = -1;
if (strcmp(name, "$$$DUMMY") == 0) {
    obj = new(0xe0) zeroed; obj->flags = 4; obj->id = [0x5e0d4] (not incremented); world_add(0, obj);
} else {
    find_world_object(name, &node);          // sub_2d014 (case-insensitive; types 0,1,2)
    obj = node->object;                      // "$AMBIENT$": node == NULL -> garbage pointer, but no case below runs
}
switch ([0x5e0d8]) {
 case 0xB002: obj->parent(+8) = pid;
              if (flags1 & 0x0800) { obj->flags |= 1; scene->facecount -= obj->nfaces; }
              ts = new(0x14) zeroed; knode_add(type 0, id=[0x5e0d4], parent, ts, obj); [0x5e0dc] = obj; break;
 case 0xB003: cam->parent(+8) = pid;        ts = new(0x0c) zeroed; knode_add(1, id, parent, ts, cam); break;
 case 0xB004: cam->tparent(+0xc) = pid;     ts = new(4) zeroed;    knode_add(2, id, parent, ts, cam); break;
 case 0xB005: case 0xB006: case 0xB007:
              light->parent(+8) = pid;      ts = new(4) zeroed;    knode_add(3, id, parent, ts, light); break;
}
```
(In the dummy case under 0xB003..7 the object pointer used is uninitialised; no file does that.)
In all shipped scenes flags1 is one of 0, 0x10, 0x30, 0x70, 0x4000, 0x4020, 0x4070, 0x8000 — bit 0x0800 is
never set, so the "hidden" path (and the face-count subtraction) never runs.

**sub_2ce7c knode_add(eax=type, edx=id, ebx=s16 parent node id, ecx=track set, stack=object)**:
new zeroed 0x1c KNode, fill +0,+2,+4,+8; append to list (scene+4 head, [0x5c970] tail, +0x14 next, +0x18 prev);
`if (parent != -1) for every k in list with k->id == parent: { if (k->child) new->sibling = k->child; k->child = new; }`

**sub_2e018 (0xB011 dummy instance name)**: read_name; `[0x5e0dc]->name = strdup(name)` (overwrites the name pointer of the current object).

**sub_2e298 (0xB013 pivot)**: read float x,y,z; `[0x5e0dc]->pivot(+0x54) = (x, z, y)`.

**Track header, common to all track readers**:
```
trk = new(0x12) zeroed;
flags = read u16;  trk->loop = 0; if (flags & 2) trk->loop = 0xf0; if (flags & 3) trk->loop = 0xf00;
read 4 × u16 (discarded);  nkeys = read u16;  read u16 (discarded);
track_alloc(trk, nkeys);                                  // sub_2fce4
per key: frame = read u16; read u16 (discarded); sflags = read u16; read_spline(f, sflags);
```
**sub_2e2f8 read_spline(eax=f, dx=sflags)**: `memset([0x5e164], 0, 0x14); for bit in 0..15: if (sflags & (1<<bit)) { v = read float; if (bit < 5) spline[bit] = v; }`
→ spline[0..4] = tension, continuity, bias, easeTo, easeFrom.

**sub_2e388 (0xB020 position)**: per key: read float x,y,z; `key_vec(trk, x, z, y, frame, spline)` (sub_2fda8).
After the loop: `track_finish(trk)` (sub_308fc); `set_track(0, [0x5e0d4], trk)`.

**sub_2e7b8 (0xB022 scale)**: identical to position, but `set_track(2, ...)`.

**sub_2e554 (0xB021 rotation)**:
```
acc = quat identity (0,0,0,1);
per key: read float angle, ax, ay, az;
    q = (ax, az, ay, angle);                                   // axis y/z swapped
    deg = trunc((double)angle * 180.0 * 0.318309886183791);    // call 0x1f318 + fistp  => round toward zero
    axisangle_to_quat(q);                                      // (ax*s, az*s, ay*s, c), s=sin(angle/2), c=cos(angle/2)
    tmp = quat_mul(q, acc);                                    // new relative rotation on the LEFT
    q = tmp; acc = tmp;
    quat_normalize(q);                                         // sub_3ce38: divides by |q|² (see §0)
    key_quat(trk, q.x, q.y, q.z, q.w, deg, frame, spline);     // sub_2fe48
track_finish(trk); set_track(1, [0x5e0d4], trk);
```
So keys hold ABSOLUTE orientations: Q_k = q_k * Q_{k-1}; acc itself is never renormalised. No negation of
angle or axis is applied. `deg` example: file angle 0.26179895 (15°) → 14.

**sub_2e988 (0xB023 FOV)**: per key: read float v; `key_scalar(trk, v, frame, spline)` (sub_2fd08, raw degrees);
finish; `set_track(6, ...)`.

**sub_2eb30 (0xB024 roll)**: per key: read float v; `key_scalar(trk, (float)(-(double)v * pi * (1/180.0)), frame, spline)`;
finish; `set_track(5, ...)`.

**sub_2ecf0 (0xB029 hide)**: header as above; per key: frame = read u16, read 2 × u16 (discarded; NO spline data is
read); `trk->keys[trk->count++].frame = frame`. Afterwards `trk->last(+8) = keys[count-1].frame; trk->count = 0;
set_track(3, ...)`. No track_finish.

**sub_2ee70 (0xB026 morph)**: per key: header + read_spline; read_name(f); find_world_object(name, &node);
`key_morph(trk, node->object, frame, spline)` (sub_2feec). finish; `set_track(4, ...)`. Not used by any shipped scene.

**sub_2cf78 set_track(eax=index, edx=node id, ebx=track)**: k = FIRST KNode with id == edx (no end-of-list check);
```
type 0: index 0..2 -> ts[index] = trk;
        index 3 -> ts[3] = trk; if (k->object->flags & 1) k->object->flags ^= 1;    // un-hide: hide track takes over
        index 4 -> ts[4] = trk; k->object->flags |= 8;
type 1: index 0 -> ts[0];  index 5 -> ts[1] (roll);  index 6 -> ts[2] (FOV);  others ignored
type 2, 3: index 0 -> ts[0]; others ignored
```

### 2.4 sub_2f140 — transform_vertices() (after the whole file is read)
```
for each WNode w of type 0 in [0x5e0e0]->world:  o = w->object;
    for i in 0..o->nverts-1:
        tmp  = verts[i].pos - o->translate(+0x24);         // float32 each step
        tmp2 = mat3_mul_vec(o->M(+0x30), tmp);
        verts[i].pos = tmp2 - o->pivot(+0x54);
```
i.e. world-space file vertices → object-local, pivot-relative coordinates. For a mesh without a 0x4160
chunk M is all zero (would collapse to -pivot; does not occur). Lights/cameras are untouched.
Reference (CREAT.3DS, object "Objct-prs"): translate (-272.8181, -573.2162, 119.9375), M = [1 0 0 / 0 0 1 / 0 -1 0],
pivot 0 → vertex 0 becomes (-5397.6426, -4559.6523, -6.9058824); u',v' = (6351.4805, 9605.262) from raw (-7.18953, -5.520553).
"Head": file matrix rows (1,0,0),(0,9.4e-8,1),(0,-1,9.4e-8), origin (-1.91698, -0.04465, 75) →
M = [1 0 0 / 0 0 -1 / 0 1 0], translate (-1.91698, 75, -0.04465), pivot (0, 30.6526, -73.7792).

### 2.5 sub_31550 — compute_normals(eax = Scene*)
```
for each WNode of type 0: o = object
    for each face f:  e1 = f.v1->pos - f.v0->pos;  e2 = f.v2->pos - f.v0->pos;
                      n = cross(e1, e2); normalize(n);  f.normal(+0x0c) = n;   // degenerate: stays (0,0,0)
    if (o->rflags & 4) {                                   // env-mapped objects only
        for each vertex j:
            acc = (0,0,0); cnt = 0;
            for each face f of o that references vertex j (pointer compare against v0, v1, v2):
                acc = acc + f.normal; cnt++;
            if (cnt > 0) { normalize(acc); verts[j].normal(+0x0c) = acc; }
            else verts[j].normal = (0, 0, 1);
    }
```
Smoothing groups are ignored: vertex normals are plain averages of unit face normals. O(nverts*nfaces).

### 2.6 sub_2d274 — load_textures()  (no arguments; works on [0x5e0e0])
```
if (scene->lightcount != 0) {
    m = scene->flare(+0x0c) = new(0x10) zeroed;
    m->name = strdup("Cohrnellious"); m->file = strdup("flare.gif"); m->tex = sub_10734();
    load_texture("TEXTURES\\" + m->file, m->tex, bl=0, cl=[0x59394]);        // sub_1f114
    for each WNode of type 2: light->face.texture(+0x7d) = m->tex;
}
for (m = scene->materials; m; m = m->next) {              // file order
    m->tex = sub_10734();
    load_texture("TEXTURES\\" + m->file, m->tex, bl=0, cl=[0x59394]);        // every material, used or not
}
for each WNode of type 0: o = object
    m = find_material(o->matname);                         // sub_2d234
    for each face f of o: f.texture(+0x31) = m->tex;
```
`[0x59394]` is bytes per pixel = 1. A material without a map file would pass a NULL file name (not in data).
A scene with meshes but no materials would crash (not in data).
**sub_2d234 find_material(eax=name)**: first material with strcmp(name, m->name) == 0; if none, the FIRST
material of the scene. Objects with no 0x4130 chunk pass NULL (strcmp then reads address 0, never equal),
so they silently get the first material: CREAT "Rope1"/"Rope01" → SKIN.GIF, SECONDS "cul-spc" → SKIN01.GIF.

**No per-material lookup tables are built** by the loader: the result is one raw 8-bit 256x256 index
texture per material plus a texture pointer in every face. The scene palette (scene+0x26) is whatever
0x5c9b0 holds after the last material's picture was loaded (flare.gif is loaded first, so it never
defines the scene palette unless the scene has no materials). Textures of a scene share one palette in
practice (exception: BRIDGE's ROPEE.GIF has a different palette from the other four; palette used = ROCK4.GIF,
the last material).

### 2.7 Lookup / activation functions
**sub_2cc1c world_add(eax=type, edx=object)**: new zeroed 0x0e WNode {type, object}; append (scene+0 head, [0x5c968] tail).

**sub_2d014 find_world_object(eax=name, edx=WNode** out)**: iterates the world list of [0x5e0e0] using *out as the cursor;
for nodes of type 0, 1, 2: `if (stricmp(node->object->name, name) == 0) return;` (*out = node; the object is at
`(*out)+2`). Not found: if `strstr(name, "$AMBIENT$")` → *out = NULL; else prints
"Couldn't find world object : %s " to the stream at 0x59338 and exit(1). Dummy objects with a NULL name would be
dereferenced as a NULL string.

**sub_2d0b8 find_mesh(eax=name, ebx=WNode** scratch) -> Object***: same, but only type-0 nodes; returns node->object;
not found: prints "ehh, phuck " + name, exit(1). Case-insensitive (so "objct-prs" finds "Objct-prs").

**sub_2d124 first_camera()**: object of the first type-1 WNode of [0x5e0e0], or 0.

**sub_2d150 activate_scene(eax=Scene*)**: copies scene fields to the globals of §1.1 (0x5c964..0x5c998), calls
sub_2c750, then with cam = scene->camera:
```
t = tan( (double)cam->fov * 0.5 * 0.00555555555 * 3.14159265358979 );     // fptan
[0x5c99c] = (float)( [0x59384] * 0.5 * (1.0 / t) );                        // 160 / t
[0x5c9a0] = (float)( ([0x59388] * 0.5 / 0.75f) * (1.0 / t) );              // 133.333 / t
```
(uses the scene's default camera only; switching cameras later is the scene code's business).

**sub_2c750 alloc_sort_lists()**: free [0x5e0c8] and [0x5e0cc] if non-NULL; each = malloc([0x5c984] * 4).

Unused (no callers) but present: 0x2cc88 free world object, 0x2cd20 free KNode + tracks, 0x2cda8 free material,
0x2cdd8 free scene. Scenes are never freed.

---------------------------------------------------------------------------------------------------
## 3. Name suffixes → render flags

Face flag byte (+0x30), set from the object name (§2.3 sub_2d550):

| bit | substring (case-sensitive) | meaning as far as visible from this slice + dispatch loops |
|---|---|---|
| 0x02 | (default: name has no "prs"/"PRS") | normal textured triangle; scene loops call sub_24b54 |
| 0x40 | "prs" / "PRS" | "perspective": replaces 0x02; scene loops call sub_27670 (perspective-correct mapper, used on big floors/walls/plates) |
| 0x04 | "env" / "ENV" | environment mapping: the only effect at load time is that vertex normals are computed (§2.5); the per-frame transform (0x2f8a4, 0x2fa45: `test [obj+0x1e], 4`) rotates them and derives UVs from the normal. File UVs are usually absent on these meshes |
| 0x08 | "cul" / "CUL" | no back-face culling (double sided): sub_2c7a8 skips the normal·view test when `face.flags & 8` |
| 0x10 | "spc" (lower case only) | "special 1": scene-specific rasteriser (0x1479b loop → sub_29510; 0x14ec3 loop → sub_2b3c0) |
| 0x20 | "sp2" / "SP2" | "special 2": scene-specific (0x147b2 loop → sub_27670). Not present in any shipped scene name |
| 0x80 | (lights only) | flare sprite; scene loops call sub_27434(eax=face, edx=buffer) |

There is no "flat" suffix handling in the loader ("xtra flat" is only a loader progress string). Material
names never influence flags. Names in the data: ",prs" / "-prs" / "3prs" (0x40), ",env" / "env," / "env-" (0x06),
"culenvspc" (0x1e, FIRSTS), "Lmp,envcul" (0x0e), "pyr-cul" (0x0a), "cul,prs,*" (0x48), "cul-spc" (0x1a, SECONDS).
Counts over all scenes: 0x40 ×74, 0x06 ×33, 0x48 ×3, one each of 0x0a, 0x0e, 0x1a, 0x1e; everything else 0x02.
Note bits combine: an "spc" object without "prs" still carries 0x02, so the order in which a draw loop tests
the bits matters (keep each scene's test order).
Object state flags (+0x1c) are separate: 1 hidden, 4 dummy, 8 morph (§1.4).

---------------------------------------------------------------------------------------------------
## 4. Picture loaders

### sub_1f07c — load_picture(eax = filename, edx = u8* dest, bl = set_dac, ecx = int* width_out, stack = int* height_out) → 1; `ret 4`
```
if (load_gif(name, dest, bl, ecx, stackarg)) return 1;        // sub_1e5e4
if (load_pcx(name, dest, bl, ecx, stackarg)) return 1;        // sub_1eafc (file is not "GIF...")
fatal("PIX global error, file : " + name);                    // strcat into the static string, then sub_1e270
```
- `dest`: receives width*height palette indices, row after row, no padding, no clipping, no size check.
  NULL is allowed for GIF only (palette + dimensions only).
- `bl != 0`: additionally program all 256 VGA DAC entries from 0x5c9b0 immediately (sub_1e2d0: out 0x3c8 index,
  out 0x3c9 r,g,b). Used for "textures\loading.gif" (dest = [0x593a4]) and "textures\roller2.gif".
- `ecx`, stack arg: optional output pointers (NULL = don't care). All 9 callers pass 0 and 0.
- **Side effect, always: the global palette 0x5c9b0 is overwritten** (memset 0, then filled from the file,
  values >> 2). The VGA DAC itself is only touched when bl != 0.

Callers (eax string, edx, ebx): loading.gif → [0x593a4], 1 | immor2.gif → new 64K block, 0 | logo.gif →
[0x5937c] (straight to the screen), 0 | 2dtest.gif, 2dtest2.gif, 2dtest3.gif → 64K blocks, 0 | roller1.GIF →
material texture, 0 | roller2.gif → 64K block, 1 | shad.gif → 64K block, 0.
TEXTURES/2DTEST2.GIF and 2DTEST3.GIF are really PCX files (first bytes 0a 05 01 08), so the PCX path is live.

### sub_1f114 — load_texture(eax = filename, edx = dest, bl = set_dac, cl = bytes per pixel)   (only caller: sub_2d274)
```
tmp = malloc(0x10000);                                         // never freed
if (!load_gif(name, tmp, bl, &w, &h) && !load_pcx(name, tmp, bl, &w, &h)) fatal("PIX global error, file : " + name);
n = w*h;
switch (cl) {                                                  // jump table 0x1f104
 case 1: memcpy(dest, tmp, n); break;                          // the only case used ([0x59394] == 1)
 case 2: for i: p=&pal[tmp[i]*3]; ((u16*)dest)[i] = ((p[0]>>1)<<11) + (p[1]<<5) + (p[2]>>1);   // 565
 case 3: for i: dest[i*3] = p[2]<<2; dest[i*3+1] = p[1]<<2; dest[i*3+2] = p[0]<<2;              // BGR
 case 4: for i: dest[i*4] = p[2]<<2; [+1] = p[1]<<2; [+2] = p[0]<<2; [+3] = 0;                  // BGRA
}                                                              // pal = 0x5c9b0 (6-bit)
```

### sub_1e5e4 — load_gif(eax = filename, edx = dest, bl = set_dac, ecx = int* w, stack = int* h) → 1 ok / 0 not a GIF
```
[0x5ccb0] = f = fopen(name, "rb");  if (!f) fatal("Unable to load file : " + name);
fread(hdr, 1, 6);  if (strncmp(hdr, "GIF", 3) != 0) { fclose(f); return 0; }
fread(lsd, 1, 7);                                    // logical screen descriptor; lsd[4] = packed flags
memset(0x5c9b0, 0, 0x300);
n = 3 * (2 << (lsd[4] & 7));                         // global colour table assumed present (bit 7 not tested)
for i in 0..n-1: pal[i] = fgetc(f) >> 2;             // 8-bit → 6-bit, stored r,g,b
if (bl) for i in 0..255: set_dac(i, pal[3i], pal[3i+1], pal[3i+2]);
fread(tmp, 1, 5);                                    // 0x2C separator + left + top; NOT checked: extension
                                                     // blocks before the image are not supported
w = fgetc | fgetc<<8;  if (ecx) *ecx = w;            // sub_1e35c
h = fgetc | fgetc<<8;  if (stackarg) *stackarg = h;
if (dest == NULL) { fclose(f); return 1; }
fread(tmp, 1, 1);                                    // image flags: local colour table / interlace IGNORED
mcs = fgetc(f);  if (mcs < 2 || mcs > 9) { fclose(f); fatal("PIX internal error, file : " + name); }
LZW decode (below) writing bytes sequentially to dest until the end code;
fclose(f); return 1;
```
LZW (state: 0x5ccb4 code size, 0x5ccc4 1<<size, 0x5ccb8 clear, 0x5ccbc end, 0x5ccc0 first free, 0x5ccc8 next free,
0x5cde0 4097-byte stack, 0x5cde4 suffix bytes, 0x5cde8 prefix u16s; bit reader sub_1e380 with sub-block buffer
0x5ccd8, 0x5cccc bytes left, 0x5ccd0 bits left, 0x5ccd4 current byte, masks table 0x54738 = 0,1,3,7,...,0xfff):
```
clear = 1<<mcs; end = clear+1; first = clear+2; size = mcs+1; max = 1<<size; free = first;
loop: c = getcode(size);                       // LSB-first, across 255-byte sub-blocks; a 0-length block just stops refilling
  if (c == end) break;
  if (c == clear) { size = mcs+1; free = first; max = 1<<size;
                    do c = getcode(size); while (c == clear);
                    if (c == end) break;
                    if (c >= free) c = 0;
                    old = firstch = c; *dest++ = c; continue; }
  cur = c; sp = stack;
  if (cur >= free) { *sp++ = firstch; cur = old; }            // KwKwK
  while (cur >= first) { *sp++ = suffix[cur]; cur = prefix[cur]; }
  *sp++ = cur;
  if (free < max) { firstch = cur; suffix[free] = cur; prefix[free] = old; free++; old = c; }
  if (free >= max && size < 12) { size++; max *= 2; }
  while (sp > stack) *dest++ = *--sp;
```
This is a standard GIF87a decoder; `h_gif.py` reproduces it and matches PIL bit-for-bit on all 62 real GIFs
(all are GIF87a, global table of 256, single non-interlaced image right after the header, min code size 8;
256x256 except LOADING/LOGO/ROLLER2 = 320x200). A port may use any correct GIF decoder, provided it returns
raw indices and the palette as `byte >> 2`.

**sub_1e380 getcode()** → next `[0x5ccb4]`-bit code as described (refills from the file one sub-block at a time).

### sub_1eafc — load_pcx(same arguments) → 1
```
f = fopen(name,"rb") or fatal("Unable to load file : "); base = ftell(f); fread(hdr, 1, 0x80);
ok = hdr[0]==10 && hdr[1]==5 && hdr[2]==1 && (hdr[3]==8 || hdr[0x41]==1);  else fatal("PIX internal error, file : ");
w = u16[8] - u16[4] + 1;  h = u16[10] - u16[6] + 1;  (stored through ecx / stack arg if non-NULL)
bpp = hdr[3]; planes = hdr[0x41];
if (bpp==1 && planes==4)      { memset(pal,0,768); for i<48: pal[i] = hdr[0x10+i] >> 2; }
else if (bpp==8 && planes==1) { size = filesize(name) (sub_1e31c reopens the file);
                                fseek(f, base + size - 768, SEEK_SET); for i<768: pal[i] = fgetc(f) >> 2; }
else fatal("PIX internal error, file : ");
if (bl && bpp==8 && planes==1) program all 256 DAC entries from pal;
if (dest == NULL) fatal("PIX internal error, file : ");
fseek(f, base + 0x80, SEEK_SET);
for y in 0..h-1:
    memset(dest, 0, w); row = dest;
    for p in 0..planes-1:
        dest = row; x = 0;
        while (x < w) {
            c = fgetc(f);
            if ((c & 0xc0) != 0xc0) emit(c);
            else { v = fgetc(f); n = c & 0x3f; while (n > 0 && x < w) { emit(v); n--; } }   // run cut at row end
        }
    // dest now points at the next row
emit(v): bpp==1: for bit 7..0: *dest++ |= ((v>>bit)&1) << p;  x += 8;      else: *dest++ = v; x++;
fclose(f); return 1;
```
Bytes-per-line (hdr[0x42]) is ignored (w is used). The two real files are 256x256, 8 bpp, 1 plane,
bytes-per-line 256; `h_pcx.py` matches PIL exactly.

---------------------------------------------------------------------------------------------------
## 5. Validation against the real data (h_parse3ds.py / h_stats.py)

All nine scenes parse to the end with this reading (every node header finds its object, every track finds
its node, hide tracks contain no spline data, chunk sizes line up).

| scene | frames | scene+0x10 faces | lights | cameras | materials (name → file, list order) |
|---|---|---|---|---|---|
| BADDY / BADDY2 | 0..90 | 672 | 0 | 1 | HAND→REFMAP2, VELVET→VELVET, PANEL→PANEL, BUTTON→BUTTON, SCREEN→SCRE0341 |
| BADGUY | 0..550 | 3414 | 1 | 4 | REFLECTION→XREFMAP, REF MAP→BREFMAP, GEM→BGEM, SKIN→XSKIN, EYES→XEYEMAP, WALLS→EWALL, WOOD→XWOOOD, CEILING→XCEILI, FLOOR→XFLOOR |
| BRIDGE | 0..780 | 2581 | 1 | 4 | SKIN→BSKIN, EYES→EYEMAPB, PLATE→PLATE, ROPE→ROPEE, ROCK→ROCK4 |
| CREAT | 0..570 | 1822 | 0 | 1 | SKIN→SKIN, BUMPYWHITE STONE→OFLOOR, IMMOR→IMMOR1, EYES→EYEMAP3 |
| CRED | 0..600 | 70 | 0 | 1 | 3→CR3, 1→CR1, 2→CR2 |
| FIRSTS | 0..500 | 294 | 0 | 3 | GLASS→REFMAP, FLOOR→FLOOR, WALLS→CEILING, GEM→GEM, PICKER→REFMAP, WALLSX→WALLSX |
| HITCAR | 0..630 | 2274 | 2 | 3 | TUNNEL→TUNNEL, SKIN→SSKIN, EYES→EYEMAP1, GARABGAE→GARBA, TOP→TOP, CAR REF→TOP |
| SECONDS | 0..580 | 4698 | 0 | 4 | SKIN→SKIN01, EYES→EYEMAP4, TABLE→TABLE, CEILING→XCELING, FLOOR→YFLOOR, DOOR WALL→DOORX, WALLS X→WALLX, DOOOR→DOOR, RED SKIN→RSKIN01 |

Observations from the data:
- Object ids are assigned in creation order across meshes, cameras and lights (e.g. CREAT: Head 0, Lft Eye 1,
  Rt Eye 2, Camera01 3, Neck 4, Body 5 ...), and `parent` resolves to sensible hierarchies (Head→Neck→Body).
  The ids printed by the scripts assume 0x5e0d4 starts at 0; in the EXE it continues from the previous
  scene's last node id (see open questions).
- Track types present: object pos/rot/scale everywhere; hide tracks in BADGUY (26 objects) and SECONDS (75);
  camera pos + roll + FOV and target pos for every camera; light pos in BADGUY, BRIDGE, HITCAR. No morph
  tracks, no dummies, no loop flags, no hidden-node flag.
- Non-zero tension/continuity/bias/ease values do occur on a handful of keys per scene (they matter).
- 14 of CREAT's 1822 faces are degenerate (zero normal stays (0,0,0)).

---------------------------------------------------------------------------------------------------
## 6. Open questions / things to confirm elsewhere

1. **0x5e0d4 is never reset** between scenes. Object ids of scene N start at (last node id of scene N-1),
   while node ids restart at 0 from 0xB030. Parent links compare object ids with object ids, so hierarchy
   stays consistent, but anything that compares a node id to an object id (dummies get `id = node id`)
   would differ. No dummies exist in the data, so a port can simply number objects from 0 per scene; verify
   against the animation code's use of object+4 / +8 (other slice).
2. Rotation key field +0x12 (whole degrees, truncated) and the 5th dword of the 20-byte quat class: their use
   is in the interpolation code (sub_308fc and friends), not here.
3. sub_3ce38 divides by the squared norm (no sqrt). Faithful port: keep it; the error is ~1e-7 because the
   inputs are unit quaternions.
4. KNode type 3 is shared by light, spotlight and light-target nodes, all pointing at the Light and all with
   a single position slot; a light-target track would therefore drive the light position. Only omni lights
   occur in the data.
5. Meaning of render bits 0x10 ("spc") and 0x20 ("sp2") is decided by per-scene draw loops and their
   rasterisers (sub_29510, sub_2b3c0, sub_27670), outside this slice; object state bits 0x02 and 0x10 are set
   elsewhere (scene code).
6. Vertex +0x24 and Face +0x18/+0x24/+0x2c are runtime fields inferred from sub_2c7a8 / 0x2f88f only.
7. The `[0x5e0d8]` "parent chunk" global is not restored after nested containers; harmless for the shipped
   files because 0xB010 always directly follows 0xB030 inside its own 0xB00x container.
8. In sub_2e03c, a parent node id that matches no earlier node leaves the parent object id uninitialised
   (low word of the FILE pointer). Never happens in the data (parents always precede children).
9. The scene's u16 at +0x24 (second argument of sub_2f1bc → 0x5c998) is only stored here; meaning is in the callers.
