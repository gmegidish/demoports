# D_scenes: BROTHER.EXE parts 3, 5, 6 and their loaders

Slice: loaders 0x134da (shpitz), 0x138b4 (tennisb), 0x130bf (fur); parts 0x13559 (part 3, shpitz),
0x13933 (part 5, tennisb), 0x130f7 (part 6, fur planes + brother.gif); plus the small demo-side
helpers only these parts use: 0x10fb8, 0x11079, 0x11780, 0x11e2c, 0x11a3c, and the engine entry
0x1dfe4 (Euler matrix) as far as part 6 needs it.

Conventions: `f()` = round to float32 (`Math.fround`), everything else on the x87 stack is IEEE
double (control word 0x127F, 53-bit, as in Kahn: see Kahn `A_fx_font.md` "FPU facts").
`trunc()` = helper **0x199b2** (= Kahn 0x1f318, SAME) followed by `fistp`: it **truncates toward
zero** (it forces RC=11 around `frndint`). Every float->int conversion in this slice goes through
it, so every one is a truncation. `fistp` of inf/NaN/out of range stores 0x80000000.

Times: one XM row = 0.05 s exactly (speed 2, BPM 100, no Fxx anywhere in BICSTL.XM; checked with a
parser over every pattern). "XM t" below is the nominal song time of an order position; "cap t" is
what `capframe.py` shows (DOSBox capture). The capture runs slightly ahead of the nominal song
times, by 0.23 s at 64 s and growing to 0.82 s at 173 s (see the table in section 6).

---------------------------------------------------------------------------------------------------

## 0. Globals and callees

### Globals used by this slice

| Brother addr | Kahn equiv. | type | meaning |
|---|---|---|---|
| 0x5846c | 0x593cc | u32 | tick counter A, 100 Hz. Each part here zeroes it at its start; ESC adds 0x01000000 (byte 0x5846f) |
| 0x58470 | 0x593d0 | u32 | tick counter B, 100 Hz. Zeroed at music start, and **by parts 3 and 5 at every camera switch**. Part 6 reads it as its clock |
| 0x58474 | 0x593d4 | u32 | `T` = 100 (written once at 0x10c71): ticks per second |
| 0x58468 | (none) | u8 | music master volume 0..63, initial 0x20 (0x10c98); '+'/'-' change it |
| 0x5de2c | (MIDAS) | ptr | MIDAS sound-device/API object; `call [ [0x5de2c] + 0x58 ](int vol)` = set master volume (same call as 0x10e04) |
| 0x584ac / 0x584b4 | 0x10da4 outputs | u32 | music order position / row, refreshed by **0x10e50** (≈ Kahn 0x10da4, 0.83) |
| 0x58424 / 0x58428 | | u32 | 320 / 200 |
| 0x5842c / 0x58430 | 0x5938c / 0x59390 | f32 | screen centre cx = 159.5, cy = 99.5 |
| 0x58440 | 0x593a0 | u8* | work buffer A (64000). All three parts draw here and copy it to the screen |
| 0x5841c | 0x5937c | u8* | visible VGA memory |
| 0x5dba4 | 0x5c96c | ptr | engine: scene+0x04 (mesh object list), made current by 0x2bbac |
| 0x5dbc0 | 0x5c988 | ptr | engine: current camera object |
| 0x5dbc4 / 0x5dbc6 | 0x5c98c / 0x5c98e | u16 | engine: scene start / end frame |
| 0x5dbc8 | 0x5c990 | f32 | engine: scene frame span |
| 0x5dbcc | 0x5c994 | f32 | engine: current frame (input of 0x2dffc) |
| 0x5dbd0 | 0x5c998 | u16 | engine: scene+0x24 = the 2nd argument of the 3DS loader (20 for both scenes here) = flare half-size in world units |
| 0x5dbd4 / 0x5dbd8 | 0x5c99c / 0x5c9a0 | f32 | engine: projection scales Px, Py (set by 0x2bbac from the camera FOV, see 1.3) |
| 0x5ef24 / 0x5ef2c | 0x5e0c8 / 0x5e0d0 | face** / i32 | engine: sorted face list / count, built by 0x1f708 |
| 0x5dbf0 | 0x5c9b0 | u8* | the GIF loader's current palette (768 bytes, 6-bit) |

Per-part globals are listed with each part.

### Callees (Brother address -> Kahn counterpart from funclist.txt)

| Brother | Kahn | what | used by |
|---|---|---|---|
| 0x10794 | 0x10734 SAME | `alloc64K()` -> next 64K-aligned 64K block (fatal "Aligned Buffer too small." after 70) | all loaders |
| 0x1936c | ≈0x1f114 (0.74) | `load_gif(eax=name, edx=dest, ebx=u8** palOut, ecx=mode)`. Mode 1 = plain 8-bit copy of the pixels into dest. `*palOut` = a freshly malloc'd **copy** of the GIF's 768-byte (6-bit) palette; the palette is also left in [0x5dbf0]. Does NOT touch the DAC | loaders, part 6 |
| 0x2ddd4 | ≈0x2f1bc (0.99) | `load_3ds(eax=name, edx=userWord)` -> scene*. Stores edx at scene+0x24 (u16). Brother addition: scene+0x26 = malloc'd copy of [0x5dbf0] taken at the end of loading, i.e. the palette of the last material GIF loaded. EBX/ECX are not arguments (preserved) | loaders |
| 0x10908 | ≈0x10770 (0.59) | `build_additive_table(eax=table)` from the current palette [0x5dbf0]: `tab[i<<8|j] = tab[j<<8|i] = nearest(min(63, pal[i]+pal[j]) per channel)`, nearest via 0x107d0. = Kahn port `buildAdditiveTable` (another slice owns the exact search) | loaders 0x134da, 0x138b4 |
| 0x2ba90 | 0x2d014 SAME | `find_world_object(eax=name, edx=node** out)`; the loaders take `(*out)+2` (dword) = the camera object | loaders |
| 0x2bbac | ≈0x2d150 (0.99) | `activate_scene(eax=scene)`, see 1.3 | parts 3, 5 |
| 0x1067c | 0x1061c SAME | `set_dac(eax=pal768)`: 256 triplets to port 0x3c9 from index 0. **No vsync wait** | all |
| 0x1866c | 0x1e2d0 SAME | `set_dac_entry(eax=index, edx=r, ebx=g, ecx=b)`: out 0x3c8,index; out 0x3c9 r,g,b (bytes, unmasked) | 0x10fb8, 0x11079, part 6 |
| 0x176c4 | 0x13cfe SAME | `raster_setup(eax=w, edx=h, ebx=dest buffer, ecx=sprite blend table)` | parts 3, 5 |
| 0x10e50 | ≈0x10da4 (0.83) | poll MIDAS play status -> 0x584ac.. (fatal "Could not get playback status.") | all |
| 0x2dffc | ≈0x2f43c (0.47) | animate the current scene to frame [0x5dbcc] with camera [0x5dbc0] (internally calls 0x2df10 camera matrix and 0x2df78 clamp, see 1.4) | parts 3, 5 |
| 0x1f708 | ≈0x2c7a8 (0.82) | transform/cull/sort -> [0x5ef24]/[0x5ef2c] | parts 3, 5 |
| 0x106c0 | 0x10660 SAME | `clear(eax=buf)`: 64000 zero bytes | parts 3, 5, 6 |
| 0x106dc | 0x1067c SAME | `show(eax=buf)`: copy 64000 bytes to [0x5841c], **no vsync** | all |
| 0x22324 | ≈0x24b54 (0.94) | face drawer, affine (Kahn port `drawFaceAffine`) `(eax=face, edx=0)` | part 3 |
| 0x24fe0 | ≈0x27670 (0.94) | face drawer, perspective (Kahn port `drawFacePerspective`) `(eax=face, edx=0)` | parts 3, 5 |
| 0x24da4 | 0x27434 MNEM | flare billboard `(eax=face, edx=dest)`: texture = face+0x2c, position = face->v0 +0x18.. (Kahn port `drawFlare`) | part 3 |
| 0x13c28 | 0x10f60 SAME | `sprite_scaled_blend(eax=(y0<<16)+x0, edx=(y1<<16)+x1, ebx=tex, ecx=dst)` (Kahn port `drawScaledSprite`) | part 5 (and 0x24da4) |
| 0x199b2 | 0x1f318 SAME | truncation helper | all |
| 0x1dcd8 | 0x23cbc SAME | `vec_set(stack: f32 x, f32 y, f32 z, vec3* out)`, ret 0x10 | part 6 |
| 0x1dd70 | 0x312b0 SAME | `mat_mul_vec(eax=M, edx=v, ebx=out)`: out[r] = M[3r]*v.x + M[3r+1]*v.y + M[3r+2]*v.z, stored f32 | part 6 |
| 0x1dbe4 | 0x23bc8 SAME | `normalize(eax=v)` in place (Kahn port `math.js normalize`) | part 6 |
| 0x1dfe4 | none (nearest 0x2f2f0, 0.48) | `euler_matrix(stack: f32 A, f32 B, f32 C, mat3* out)`, ret 0x10. Section 4.4 | part 6 |
| 0x11e2c | none (nearest 0x2de10, 0.44) | draw the 40x25 shaded-texture grid, section 4.5 | part 6 (and part 4 0x122b0) |
| 0x11a3c | ≈0x152e0 (0.73) | textured + shaded triangle wrapper, section 4.6 | 0x11e2c |
| 0x15ca1 | 0x12962 SAME | `tri_affine_tex(eax=T)` (Kahn port `fillAffineTriangle(..., AFFINE_OPAQUE)`) | 0x11a3c |
| 0x169a2 | ≈0x12fe1 (1.00) | `tri_shade_table(eax=T)` (Kahn port `fillAffineTriangle(..., AFFINE_SHADE)` / `drawShadeTriangle`) | 0x11a3c |
| 0x10fb8 | none | palette from white, float. Section 1.1 | all three parts |
| 0x11079 | none | palette scaled toward black, float. Section 1.2 | part 6 |
| 0x11780 | ≈0x10770 (0.53) | shade table builder. Section 5.2 | loader 0x130bf (via tail jump into 0x1220a) |

---------------------------------------------------------------------------------------------------

## 1. Shared helpers

### 1.1 0x10fb8 `pal_from_white(stack: f32 f, u8* pal)`, ret 8

Stack slots: [ebp+0x18] = f (pushed last), [ebp+0x1c] = pal. f is 1.0 = white, 0.0 = pal.
```c
for (i = 0; i < 256; i++) {          // per entry: b, then g, then r are computed, then one DAC write
    b = (u8)trunc((double)(64 - pal[3i+2]) * f + (double)pal[3i+2]);
    g = (u8)trunc((double)(64 - pal[3i+1]) * f + (double)pal[3i+1]);
    r = (u8)trunc((double)(64 - pal[3i  ]) * f + (double)pal[3i  ]);
    set_dac_entry(i, r, g, b);        // 0x1866c
}
```
Note the **64**, not 63: at f == 1.0 exactly every channel is 64 = 0x40, which the VGA DAC takes as
its low 6 bits = **0 (black)**. Every part below calls this with `f = 1 - t*0.01` and t = 0 on its
first frame, so **each part opens with one or more black frames, then white**. The capture shows
exactly this (black frames at cap 63.77, 114.73, 140.18 before the white). For f in (0.984, 1) the
value truncates to 63 (white). A port must write `value & 0x3f` (or reproduce the black).

### 1.2 0x11079 `pal_scale(stack: f32 f, u8* pal)`, ret 8

Same shape (shares the epilogue at 0x11071):
```c
for (i = 0; i < 256; i++) {
    b = (u8)trunc((double)pal[3i+2] * f);  g = (u8)trunc((double)pal[3i+1] * f);  r = (u8)trunc((double)pal[3i] * f);
    set_dac_entry(i, r, g, b);
}
```

### 1.3 0x2bbac `activate_scene(eax=scene)` (engine; summary only)

Copies scene+0x00 -> 0x5db9c, +0x04 -> 0x5dba4, +0x08 -> 0x5dbac, +0x0c -> 0x5dbb4, +0x10 -> 0x5dbbc,
+0x14 -> 0x5dbb8, +0x18 -> 0x5dbc0 (default camera), +0x1c u16 -> 0x5dbc4, +0x1e u16 -> 0x5dbc6,
+0x20 f32 -> 0x5dbc8, +0x24 u16 -> 0x5dbd0; calls 0x1f6b0 and 0x1e140; then (Brother addition vs Kahn)
computes the projection from the camera's FOV (camera+0x2c, degrees):
```c
tn = tan(fov * 0.5 * 0.00555556(dbl) * 3.14159(dbl));          // fptan
[0x5dbd4] = Px = f( (320 * 0.5) / tn );                          // ... = (w*0.5) * (1/tn)
[0x5dbd8] = Py = f( (200 * 0.5 / 0.75f) / tn );
```
(Exact constants at 0x50c5b/0x50c63/0x50c6b; the engine slice owns this.) The default camera
(scene+0x18) is the **first world node of type 1** (0x2bb80); world nodes are appended in file order
(0x2b8c0..0x2b8ee), and in both SHPITZ.3DS and TENNISB.3DS Camera01's named-object chunk comes before
Camera02's, so **the default camera is Camera01** in both scenes. Note: the parts switch cameras by
writing 0x5dbc0 directly, which does not recompute Px/Py here; 0x2dffc recomputes the FOV each frame
only when the camera has more than one FOV key (0x2e05c..0x2e07e). Both cameras of both scenes have
lens 50 (static chunk), so Px/Py stay equal anyway unless keyed.

### 1.4 The engine functions named in the brief

- 0x2df10 and 0x2df78 are called only from 0x2dffc (animate). 0x2df10 builds a camera matrix (vector
  target-position via 0x1dab4, roll at camera+0x28, angles via 0x1dc44/0x3a382/0x1e0fb, then 0x1dfe4);
  0x2df78 is a "float to byte, clamped to [lo, hi]" helper (stack: f32 x, u8 lo, u8 hi; trunc). Slices
  E/F own them; the parts here never call them.
- 0x2bbac: above. 0x24fe0, 0x22324, 0x24da4: the per-face drawers the parts call (section 2/3).
- The parts' own "face walk" is inline in each part (sections 2 and 3); there is no separate draw
  function per part in this slice, unlike Kahn's sub_16658 etc.

---------------------------------------------------------------------------------------------------

## 2. Part 3: shpitz (spiky star over a swirling grey sphere, light flares)

### 2.1 Loader 0x134da (called 4th by main)

```c
[0x5db64] = scene = load_3ds("shpitz.3ds", 0x14);      // 0x2ddd4; userWord 20 = flare half-size
[0x5db6c] = alloc64K();
load_gif("flare2.gif", [0x5db6c], &[0x5db74], 1);       // EBX=0x5db74 and ECX=1 survive from the 0x2ddd4 call setup
                                                        // -> [0x5db74] = copy of flare2.gif's palette
[0x5db70] = alloc64K();
build_additive_table([0x5db70]);                        // 0x10908, from [0x5dbf0] = flare2.gif's palette
find_world_object("Camera01", &n);  [0x5db78] = n->object;   // dword at node+2
find_world_object("Camera02", &n);  [0x5db7c] = n->object;
```
Globals: 0x5db64 scene*, 0x5db6c flare2 texture (64K), 0x5db70 additive table (64K), 0x5db74 u8*
flare2 palette, 0x5db78 Camera01, 0x5db7c Camera02, 0x5db68 u32 duration (set by the part).

About "flare.gif": the string is in the 3DS loader (0x2bcd4, engine): when the scene has lights it
creates an extra material named "Cohrnellious" with file "flare.gif", allocates its 64K block and
points every light's flare face at it, and builds the string "TEXTURES\flare.gif" on the stack, but
the following loop (0x2bdd5..0x2be44) only loads the materials of the scene's own list, and
FLARE.GIF is not among the bound files. So that block is never filled (UNSURE: engine slice to
confirm). It does not matter: part 3 overwrites the flare faces' texture pointer with flare2.gif every
frame (2.3). SHPITZ.3DS has 14 lights (Light01..Light14) -> 14 flares.

Palettes: SHPITZ's material GIFs (STONES.GIF, TRIPAT.GIF) and FLARE2.GIF have **byte-identical
palettes** (checked with Pillow), so scene+0x26 and [0x5db74] hold the same colours.

### 2.2 Music sync

| event | condition in code | position | XM t | cap t |
|---|---|---|---|---|
| part starts | part 2 (0x12cc2) leaves when pos > 9 | 10 row 0 | 64.00 | 63.77 (black), 63.80 (white) |
| fade from white ends | t >= 100 ticks | | 65.00 | ~64.8 |
| camera switch + white flash | row == 0 and pos != last pos | 11 | 70.40 | 70.10 |
| " | | 12 | 76.80 | 76.52 |
| " | | 13 | 83.20 | 82.83 |
| part ends | loop test pos > 13 (unsigned) | 14 row 0 | 89.60 | 89.20 |

Also a switch at pos 10 itself on the first frame (see below), hidden by the fade-in. Scene frame
range (KFSEG of SHPITZ.3DS): 0..400; duration 2600 ticks, part length 25.6 s, so the last frame
drawn is ~393.8 (the end of the animation is never reached).

### 2.3 0x13559 pseudo-code

```c
activate_scene([0x5db64]);                         // 0x2bbac: camera = Camera01, frames, Px/Py
set_dac(scene->pal /* +0x26 */);                   // real palette at once (screen still shows part 2's last frame)
raster_setup(320, 200, [0x58440], [0x5db70]);      // 0x176c4: dest = buffer A, sprite blend table = additive
[0x5db68] = dur = [0x58474] * 26;                  // 2600 ticks
fadeIn = 1;  flash = 0 /* esi */;  lastPos = 0;
[0x5846c] = 0;
while ([0x584ac] <= 13) {                          // uses the position from the previous poll
    // (a) fade from white over the first second, with timer A
    f = f(1.0 - (double)(u32)[0x5846c] * 0.01);    // fild qword (zero-extended u32); dbl 0.01; stored f32
    if (f < 0)          { set_dac([0x5db74]); fadeIn = 0; }       // NOTE: every frame once f < 0
    else if (fadeIn)    pal_from_white(f, [0x5db74]);             // 0x10fb8
    // (b) camera-switch flash, with timer B
    if (flash) {
        g = f(1.0 - (double)(u32)[0x58470] * 0.01);
        if (g < 0) { set_dac([0x5db74]); flash = 0; }
        else        pal_from_white(g, [0x5db74]);
    }
    poll_music();                                  // 0x10e50
    // (c) frame number: fild qword t (re-read); fmul f32 span; fild qword dur; fdivp; fild start; faddp; fstp f32
    [0x5dbcc] = f( (double)(u32)[0x5846c] * (double)[0x5dbc8] / (double)dur + (double)(u16)[0x5dbc4] );
    // (d) camera switch on row 0 of every new order position
    if ([0x584b4] == 0 && [0x584ac] != lastPos) {
        lastPos = [0x584ac];
        [0x5dbc0] = ([0x5dbc0] == [0x5db78]) ? [0x5db7c] : [0x5db78];   // toggle Camera01 <-> Camera02
        flash = 1;
        [0x58470] = 0;                             // restart timer B
    }
    animate();                                     // 0x2dffc
    cull_and_sort();                               // 0x1f708
    clear([0x58440]);                              // 0x106c0
    for (i = [0x5ef2c] - 1; i >= 0; i--) {         // far to near, descending index
        face = ((face**)[0x5ef24])[i];
        fl = *(u16*)(face + 0x2a);                 // Brother face flags (Kahn: u8 at +0x30, other bits)
        if      (fl & 0x0001) draw_face_affine(face, 0);        // 0x22324 (Kahn 0x24b54)
        else if (fl & 0x0002) draw_face_perspective(face, 0);   // 0x24fe0 (Kahn 0x27670)
        else if (fl & 0x0100) {                                 // a light's flare
            *(u8**)(face + 0x2c) = [0x5db6c];                   // force flare2.gif as its texture
            draw_flare(face, [0x58440]);                        // 0x24da4 (Kahn 0x27434)
        }
    }
    show([0x58440]);                               // 0x106dc
}
return;
```
Notes for the port:
- Test order is 0x01, 0x02, 0x100 (first match wins). Which bits the loader gives which faces (the
  "Sphere,prs" background, the six "obj,envN" spikes) is the engine slice's business.
- `lastPos` starts at 0, so on the **first frame** the test fires if the row is still 0 (part 2 leaves
  on its first poll that sees pos 10; part 3's first poll comes after only the scene activation, much
  less than one 50 ms row later). Then the part starts on **Camera02**, and the order is pos 10:
  Camera02, 11: Camera01, 12: Camera02, 13: Camera01. UNSURE in the original (timing dependent; the
  white fade-in hides it); a port that starts the part exactly at row 0 must take the switch.
- The switch is detected after the palette step, so the flash's first palette write is on the next
  frame, with whatever timer B has reached by then (normally >= 1 tick: white, not the black of f=1).
- On the last frame the poll usually sees pos 14 row 0: the camera toggles and timer B is reset to 0,
  then the frame is drawn with the other camera and the loop exits. (Same mechanism verified on
  part 5's last frame, see 4.2.)
- The flash and the fade-in use the same palette and both write all 256 entries; when both run, the
  flash's write is the one that stays.
- ESC only adds 2^24 ticks to timer A (f < 0, frame number huge); it does **not** leave this part,
  which ends only on the music position.

---------------------------------------------------------------------------------------------------

## 3. Part 5: tennisb (hexagon-tiled room, point-cloud tennis player, ball)

### 3.1 Loader 0x138b4 (called 7th by main)

Byte-for-byte the shape of 0x134da:
```c
[0x5db80] = scene = load_3ds("tennisb.3ds", 0x14);     // userWord 20
[0x5db88] = alloc64K();
load_gif("flare3.gif", [0x5db88], &[0x5db8c], 1);       // [0x5db8c] = flare3 palette: never read again
[0x5db98] = alloc64K();
build_additive_table([0x5db98]);                        // from flare3.gif's palette
find_world_object("Camera01", &n);  [0x5db90] = n->object;
find_world_object("Camera02", &n);  [0x5db94] = n->object;
```
SEA.GIF (the room's material) and FLARE3.GIF have byte-identical palettes. TENNISB.3DS: meshes
Object01 (the room, 26 verts), Body, Hand..Hand03, Leg..Leg03, Foot..Foot04, Racket, Ball, ball01;
Camera01, Camera02, one light; KFSEG 0..185.

### 3.2 Music sync

| event | condition | position | XM t | cap t |
|---|---|---|---|---|
| part starts | part 4 (0x122b0) leaves when pos > 17 | 18 row 0 | 115.20 | 114.73 |
| camera switch + flash | row 0, new pos | 19 | 118.40 | 117.79 |
| " | | 20 | 121.60 | 120.96 |
| " | | 21 | 124.80 | 124.16 |
| " | | 22 | 128.00 | 127.36 |
| " | | 23 | 134.40 | 133.75 |
| part ends | pos > 23 | 24 row 0 | 140.80 | 140.20 |

Positions 18..21 are 64-row patterns (3.2 s each), 22 and 23 are 128 rows. Duration 2600 ticks,
part length 25.6 s, last frame ~182.2 of 185. Same first-frame switch reasoning as part 3
(pos 18: Camera02 expected, then alternating).

### 3.3 0x13933 pseudo-code

```c
activate_scene([0x5db80]);
set_dac(scene->pal);                               // scene+0x26
raster_setup(320, 200, [0x58440], [0x5db98]);
[0x5db84] = dur = [0x58474] * 26;                  // 2600
fadeIn = 1 /*[ebp-0x18]*/;  lastPos = 0 /*[ebp-0x14]*/;  flash = 0 /*[ebp-8]*/;
[0x5846c] = 0;
while ([0x584ac] <= 23) {
    f = f(1.0 - (double)[0x5846c] * 0.01);
    if (f < 0)        { set_dac(scene->pal); fadeIn = 0; }
    else if (fadeIn)  pal_from_white(f, scene->pal);
    if (flash) {
        g = f(1.0 - (double)[0x58470] * 0.01);
        if (g < 0) { set_dac(scene->pal); flash = 0; }
        else        pal_from_white(g, scene->pal);
    }
    poll_music();
    [0x5dbcc] = f( (double)[0x5846c] * (double)[0x5dbc8] / (double)dur + (double)(u16)[0x5dbc4] );
    if ([0x584b4] == 0 && [0x584ac] != lastPos) {
        lastPos = [0x584ac];
        [0x5dbc0] = ([0x5dbc0] == [0x5db90]) ? [0x5db94] : [0x5db90];
        flash = 1;  [0x58470] = 0;
    }
    animate();  cull_and_sort();
    clear([0x58440]);
    for (i = [0x5ef2c] - 1; i >= 0; i--)           // EVERY sorted face, no flag test at all
        draw_face_perspective(((face**)[0x5ef24])[i], 0);   // 0x24fe0
    // flare sprites at every vertex of every mesh
    for (node = [0x5dba4]; node; node = *(node**)(node + 0x14)) {
        if (*(u16*)node != 0) continue;            // type 0 = mesh
        obj = *(obj**)(node + 4);
        vtx = *(u8**)(obj + 0x0c);  end = vtx + *(i32*)(obj + 0x14) * 0x38;   // vertex stride 0x38
        for (; vtx < end; vtx += 0x38)             // unsigned compare (jae)
            draw_flare_at(vtx + 0x18 /* view-space x,y,z */, [0x5db88], [0x58440]);
    }
    show([0x58440]);
}
```
`draw_flare_at` is inline code (0x13b49..0x13c06) whose x87 sequence is **instruction for
instruction the body of 0x24da4** (= Kahn 0x27434 / Kahn port `drawFlare`), just fed with a vertex
instead of `face->v0`, texture flare3 (0x5db88) and dest buffer A:
```c
w  = 1.0 / z;  kx = Px * w;  ky = Py * w;          // Px=[0x5dbd4], Py=[0x5dbd8], registers (no f32 rounding)
R  = (double)(u16)[0x5dbd0];                        // 20
x0 = trunc(cx + (x - R) * kx);   y0 = trunc(cy - (y + R) * ky);   // cx=[0x5842c], cy=[0x58430]
x1 = trunc(cx + (x + R) * kx);   y1 = trunc(cy - (y - R) * ky);
sprite_scaled_blend((y0 << 16) + x0, (y1 << 16) + x1, [0x5db88], [0x58440]);  // 0x13c28, table = [0x5db98] via 0x176c4
```
(x,y,z f32 loads from +0x18,+0x1c,+0x20.) There is **no z test**: a vertex behind the camera gives
x0 > x1 and y0 > y1, which 0x13c28 rejects through its `w < 2` / `h < 2` tests; z == 0 gives
0x80000000 corners (rejected by the clip tests in practice; UNSURE).

So the tennis player, racket and balls are drawn as clouds of additive flare3 sprites (one per
vertex), and the room (Object01) also gets a sprite at each of its 26 vertices (the bright dots at
the room's corners in the capture, e.g. cap 125.0). The meshes' faces all go through 0x24fe0; in the
capture only the room's faces are visible, the figure's faces are not (UNSURE whether they are culled,
untextured or flagged invisible; engine slice).

---------------------------------------------------------------------------------------------------

## 4. Part 6: fur planes, then the BROTHER.GIF title

### 4.1 Loader 0x130bf (called 6th by main)

```c
[0x5db58] = alloc64K();
load_gif("fur.gif", [0x5db58], &[0x5db5c], 1);   // [0x5db5c] = fur palette copy
[0x5db60] = alloc64K();
build_shade_table([0x5db60], [0x5db5c]);          // jmp 0x122a7 = "call 0x11780; pop edx,ecx,ebx; ret"
                                                  // (tail-shares the end of loader 0x1220a); eax=table, edx=palette
```
Globals: 0x5db58 fur texture (256x256), 0x5db5c u8* fur palette, 0x5db60 shade table.

### 4.2 Music sync

| event | condition | position | XM t | cap t |
|---|---|---|---|---|
| phase 1 (fur planes) starts | part 5 leaves at pos > 23 | 24 row 0 | 140.80 | 140.18 (black), 140.20 (white) |
| fade from white ends | t >= 100 | | 141.80 | ~141.2 |
| phase 1 ends | loop test pos > 27 (unsigned) | 28 row 0 | 166.40 | 165.74 |
| black, then BROTHER.GIF visible | after decode | | | 165.756..165.841 black, 165.856 picture |
| fade-out (picture + music) starts | busy-wait until pos == 29 | 29 row 0 | 172.80 | 171.98 |
| part returns (main stops the music) | timer A >= 300 | | 175.80 | ~174.95 (black) |

Timer B at the start of part 6: part 5's last frame normally sees pos 24 row 0 and resets 0x58470
(2.3 note). **Verified**: a simulation of the plane maths below with `[0x58470] = 41` matches cap
140.6 (0.40 s after the part start at cap 140.20) and with `[0x58470] = 980` matches cap 150.0, so
timer B is within a tick or two of timer A here. A port must keep timer B's semantics (reset by the
part-5 camera switches, never by part 6).

### 4.3 0x130f7 pseudo-code

```c
// ---------- phase 1 ----------
[0x5d8c8] = [0x5db58];               // texture used by 0x11a3c's first triangle
[0x5d8cc] = [0x5db60];               // shade table used by its second triangle
fadeIn = 1;
end = 0x58578 + 0x31f8;               // grid G: 41 rows x 26 entries x 12 bytes (row stride 0x138)
[0x5846c] = 0;
while ([0x584ac] <= 27) {
    poll_music();                                          // NOTE: here the poll comes first
    f = f(1.0 - (double)[0x5846c] * 0.01);
    if (f < 0)          { set_dac([0x5db5c]); fadeIn = 0; }   // every frame once past 1 s
    else if (fadeIn)    pal_from_white(f, [0x5db5c]);

    a_d = (double)(u32)[0x58470] * 0.008;                   // timer B!  dbl 0.008
    a   = f(a_d);                                           // [ebp-8]
    euler_matrix(A = a, B = f(-a * 0.6), C = f(a_d * 0.2), M = 0x5daf0);   // 0x1dfe4; C uses the unrounded a_d
    ox  = f(a * 350.0f + 100.0f);                           // flt consts at 0x5058b, 0x50597
    // origin O = (ox, 0, f(-a * 350.0f))

    for (row = 0, X = -160; row < 41; row++, X += 8)        // esi = G + row*0x138
      for (col = 0, Y = -100; col < 26; col++, Y += 8) {    // e = G[row][col], 3 x i32: u, v, s
        vec_set((float)X, (float)Y, 256.0f, &dir);          // 0x1dcd8
        mat_mul_vec(0x5daf0, &dir, &d);                     // 0x1dd70, f32 results
        normalize(&d);                                      // 0x1dbe4
        vec_set(ox, 0.0f, f(-a * 350.0f), &O);              // re-made every point (same values)
        t  = (O.y + 200.0) / fabs(d.y);                     // flt 200; O.y = 0 -> t = 200/|d.y|
        px = d.x * t + O.x;                                 // x87 double
        pz = d.z * t + O.z;
        py = d.y * t + O.y;                                 // computed, stored to a dead local
        e.u = trunc(fabs(px));                              // from the DOUBLE px
        e.v = trunc(fabs(pz));                              // from the DOUBLE pz
        pxf = f(px);  pzf = f(pz);
        dist = sqrt((pzf - O.z)*(pzf - O.z) + (pxf - O.x)*(pxf - O.x));   // double
        s = trunc(63.0 - dist * 0.02);                      // dbl 63, dbl 0.02
        e.s = (s > 63) ? 63 : (s < 0 ? 0 : s);
      }
    draw_grid();                                           // 0x11e2c, into the raster dest = buffer A
    show([0x58440]);
}
// ---------- phase 2 ----------
clear([0x5841c]);                                          // clears VIDEO memory directly
for (i = 0; i < 256; i++) set_dac_entry(i, 0, 0, 0);      // 0x1866c, i as a byte
load_gif("brother.gif", [0x5841c], &pal, 1);               // decodes straight into video memory
set_dac(pal);
while ([0x584ac] != 29) poll_music();                       // busy-wait (== test, not >)
dur = f((double)([0x58474] * 3));                           // 300.0
[0x5846c] = 0;
while ((double)[0x5846c] < dur) {                           // fcomp; jae -> return
    vol = [0x58468];                                        // u8, default 32
    inv = f(1.0 / dur);
    newVol = trunc((double)vol - (double)(u32)(vol * [0x5846c]) * inv);   // vol*(1 - t/300), see below
    midas->setMasterVolume(newVol);                         // call [[0x5de2c]+0x58], 1 stack arg, caller pops
    fo = f(((double)dur - (double)[0x5846c]) * inv);        // fild t; fsubr dur; fmul inv
    pal_scale(fo, pal);                                     // 0x11079
}
return;                                                     // shared epilogue at 0x12c2f
```
Exact volume expression (0x133ec..0x13434): `t = [0x5846c]` (read once for the product),
`p = (u32)(vol * t)` (32-bit imul, loaded as zero-extended qword), `newVol = trunc((double)vol -
(double)p * inv)` where `vol` is re-read as a 16-bit int. The volume byte 0x58468 itself is not
changed. The palette factor re-reads t. Both run every iteration as fast as the CPU loops (no frame
drawing in phase 2). At t = 299: fo = 1/300 -> all entries 0.

Phase-2 order matters for the screen: video memory is cleared and the DAC zeroed **before** the GIF
decode, so the decode is invisible (the black gap of ~0.1 s in the capture), then the palette is set
in one go.

ESC: phase 1 ignores it (only the music ends it); in phase 2 it pushes timer A past 300 and ends the
demo at once.

### 4.4 0x1dfe4 `euler_matrix(stack: f32 A, f32 B, f32 C, mat3* out)`, ret 0x10

Stack: [esp+0x44] = A (first argument, pushed last), +0x48 = B, +0x4c = C, +0x50 = out. Row-major
float32[9]. With sA = sin A etc. (fsin/fcos on the double of the f32 argument):
```
out[0] = cA*cC + sA*sB*sC      out[1] = cB*sC      out[2] = sA*cC - cA*sB*sC
out[3] = sA*sB*cC - cA*sC      out[4] = cB*cC      out[5] = -cA*sB*cC - sA*sC
out[6] = -sA*cB                out[7] = sB         out[8] = cA*cB
```
Exact rounding (temporaries stored to f32 are marked `f()`; everything else stays in a register):
```c
sAf=f(sA); cAf=f(cA); sBf=f(sB); cBf=f(cB); sCf=f(sC);   // cC is never stored: used unrounded
sBsC = f(sB * sCf);  sAcC = f(sA * cC);  cAcC = f(cA * cC);   // sB, sA, cA: unrounded register values
out[1] = f(cB * sCf);             // cB unrounded
out[4] = f(cBf * cC);
out[6] = f(-sAf * cBf);
out[8] = f(cAf * cBf);
out[7] = sBf;                     // bit copy
out[0] = f(sAf * sBsC + cAcC);
out[2] = f(sAcC - cAf * sBsC);
out[3] = f(sAcC * sBf - cAf * sCf);
out[5] = f(-cAcC * sBf - sAf * sCf);
```
Part 6 passes A = a, B = -0.6a, C = 0.2a. Consequences of the plane maths: the camera sits between
two infinite planes y = -200 (screen top at a = 0) and y = +200, both textured with fur.gif, u = |x|,
v = |z| in world units (1 texel = 1 unit, wrapping every 256), fogged to black with distance
(shade 63 at the camera, 0 beyond 3150 units). The origin slides along x and -z at 350 units/rad,
and the view rolls/pitches/yaws: at the horizon the fog leaves a black band. This is the "magenta
walls": the planes seen rotated.

### 4.5 0x11e2c `draw_grid()` (no arguments)

Draws grid G (base 0x58578, 41 rows of 26 entries, each `{i32 u, i32 v, i32 s}`, row stride 0x138)
as 40 x 25 screen quads of 8x8 pixels, each split into two triangles; grid row r = screen x = 8r,
grid column c = screen y = 8c. Only the **low 16 bits** of u, v, s are passed on (movsx word).
```c
for (r = 0; r < 40; r++) {                      // X = 8r
    for (c = 1; c <= 25; c++) {                 // Y = 8(c-1)
        X = 8*r;  Y = 8*(c-1);
        P = G[r][c-1];  Q = G[r][c];  R = G[r+1][c-1];  S = G[r+1][c];
        tri_tex_shade(X, Y, P,   X, Y+7, Q,   X+7, Y+7, S);      // 0x11a3c
        tri_tex_shade(X, Y, P,   X+7, Y, R,   X+7, Y+7, S);
    }
}
```
Screen corners use +7, not +8 (the next quad starts at +8); with the Kahn triangle filler's fill
rules the capture shows no gaps. Exit is a `jge 0x12c2f`, the shared epilogue.

### 4.6 0x11a3c `tri_tex_shade(eax=x0, edx=y0, ebx=x1, ecx=y1, stack: x2, y2, u0, v0, s0, u1, v1, s1, u2, v2, s2)`, ret 0x2c

Builds Kahn's triangle block T (0x1c bytes, see Kahn `A_fx_font.md` "Parameter block T") on its
stack, all fields as 16-bit words:
```c
T = { [0x5d8c8], {x0,y0,u0,v0}, {x1,y1,u1,v1}, {x2,y2,u2,v2} };
tri_affine_tex(&T);                 // 0x15ca1 (Kahn 0x12962): dst = tex[(v<<8)|u]
T.ptr = [0x5d8cc];  T.v0.u = s0;  T.v1.u = s1;  T.v2.u = s2;    // v fields keep the texture v (ignored)
tri_shade_table(&T);                // 0x169a2 (≈ Kahn 0x12fe1): dst = tab[(dst<<8)|s]
```
So each triangle is first texture-mapped, then the same pixels are re-coloured through the shade
table with the interpolated s. Destination: the rasteriser's dest pointer from the last 0x176c4 call
(part 5 set it to buffer A). The x range is 0..319 and y 0..199 by construction (the fillers do not
clip x).

---------------------------------------------------------------------------------------------------

## 5. Tables built by the loaders

### 5.1 Additive tables (0x10908)

As Kahn port `buildAdditiveTable(palette)` with the palette current at load time (flare2 for part 3,
flare3 for part 5). Used only as the blend table of the flare sprites (0x13c28 through 0x176c4).
Nearest-colour search 0x107d0 belongs to another slice (check it against Kahn's `nearestColour`).

### 5.2 Shade table 0x11780 `(eax=table, edx=palette)`

```c
for (s = 0; s < 64; s++)
    for (c = 0; c < 256; c++) {
        tr = pal[3c]   * s / 63;  tg = pal[3c+1] * s / 63;  tb = pal[3c+2] * s / 63;   // u32 mul, unsigned div (trunc)
        best = 0xc0;  idx = <previous value>;
        for (k = 0; k < 256; k++) {
            d = |pal[3k]-tr| + |pal[3k+1]-tg| + |pal[3k+2]-tb|;    // 32-bit, no byte masking
            if (d < best) { best = d; idx = k; }                   // strictly smaller: first minimum wins
        }
        table[(c << 8) | s] = idx;
    }
```
Columns 64..255 of each row are never written. Since 3*63 = 189 < 0xc0 the first k always wins, so
`idx` is always set (the "previous value" never leaks). Equivalent to Kahn's `nearestColour` with an
unmasked distance.

---------------------------------------------------------------------------------------------------

## 6. Capture checks (what I checked, what agreed)

Tools: `capframe.py` contact sheets, a per-frame mean-luminance scan of video0002.avi (to find
flashes and cuts to the frame), an XM order-time parser, a 3DS chunk lister, and a Python
re-implementation of part 6's per-point maths rendered per pixel with FUR.GIF.

| what | expected (XM t) | capture | offset |
|---|---|---|---|
| part 3 start (black frames, then white) | 64.00 | 63.77 / 63.80 | -0.23 |
| part 3 switches pos 11/12/13 | 70.40 / 76.80 / 83.20 | 70.10 / 76.52 / 82.83 | -0.30 / -0.28 / -0.37 |
| part 3 end = part 4 start | 89.60 | 89.20 | -0.40 |
| part 5 start | 115.20 | 114.73 | -0.47 |
| part 5 switches pos 19..23 | 118.4, 121.6, 124.8, 128.0, 134.4 | 117.79, 120.96, 124.16, 127.36, 133.75 | -0.61..-0.65 |
| part 6 start | 140.80 | 140.20 | -0.60 |
| part 6 phase 1 end | 166.40 | 165.74 | -0.66 |
| picture fade starts | 172.80 | 171.98 | -0.82 |
| picture black | 175.80 | ~174.93 | |

Agreed:
- Every phase boundary and every camera cut lands on row 0 of the predicted order position (with the
  capture's slowly growing lead over nominal song time, which I cannot explain from the code; it
  looks like a clock-rate difference between the capture and MIDAS's row timing).
- The black-then-white opening of each part (the 64 -> 0 DAC wrap of 0x10fb8 at t = 0): black frames
  seen at all three part starts; the white flashes at camera cuts are not preceded by black frames,
  as predicted (timer B is >= 1 by the next palette write).
- Part 3: grey swirling sphere, the six-spike star, ~14 white sparkles (the 14 lights drawn as
  flare2 billboards); white flash fading over ~1 s at each cut.
- Part 5: the room's hexagon texture (SEA.GIF), the figure drawn only as additive sprites at its
  vertices, dots at the room's corners, white flash at each cut.
- Part 6: the simulation (matrix 4.4, origin, plane intersection, u = |x|, v = |z|, shade) matches
  the capture at cap 140.6 (timer B = 41, palette 59% white) and at cap 150.0 (timer B = 980): plane
  orientation, texture placement and the black fog band all line up. Then black for ~0.1 s, the
  BROTHER.GIF picture, unchanged until pos 29, then a linear fade to black over 3 s.

Not checked / UNSURE:
- The initial camera of parts 3 and 5 (Camera02 if the first-frame switch fires, as argued in 2.3);
  not distinguishable in the capture without evaluating the cameras' keyframes.
- Whether the figure meshes' faces in part 5 draw anything (engine flags), and how the loader assigns
  face flag bits 0x01 / 0x02 / 0x100 (engine slices).
- The "flare.gif" material of 0x2bcd4 is never loaded (engine slice to confirm); irrelevant for the
  picture because part 3 overrides the flare texture.
- The volume ramp in phase 2 is not audible-checked.
