# C_scenes2: KAHN.EXE 0x15a68 .. 0x17530 (wobbler parts 1-3, badguy, hitcar, bridge, return)

All functions here take no arguments and return nothing unless stated. Vsync waits (port 0x3DA bit 8
polled: wait until clear, then until set) precede every palette upload in this slice; written below
as `wait_vsync()`.

## 0. Shared facts for this slice

### Globals

| addr | type | meaning |
|---|---|---|
| 0x593cc | u32 | timer A, 100 Hz. Every part here uses ONLY this one (0x593d0 is never touched in this slice) |
| 0x593d4 | u32 | `T` = "one second" unit. Written once, at 0x10c41, with 100 (0x64). All durations below are multiples of T |
| 0x5c9b0 | u8[768] | current palette (6-bit) |
| 0x593a0 | u8* | work buffer A (everything in this slice draws there, then flips with sub_1067c) |
| 0x5937c | u8* | visible screen |
| 0x5c988 | ptr | engine: current camera |
| 0x5c98c | u16 | engine: current scene start frame |
| 0x5c98e | u16 | engine: current scene end frame |
| 0x5c990 | f32 | engine: current scene frame span (float) |
| 0x5c994 | f32 | engine: current frame number (input of sub_2f43c) |
| 0x5c998 | u16 | engine: copy of scene+0x24 (2nd argument of sub_2f1bc, see below) |
| 0x5e0d0 | i32 | engine: number of entries in the sorted face list built by sub_2c7a8 |
| 0x5e0c8 | face** | engine: sorted face list (array of pointers) |
| 0x54730 | f32 | constant 1.0 (near-plane test) |

Wobbler globals: 0x5c748 / 0x5c74c / 0x5c750 = image 1/2/3 (64K texture blocks), 0x5c754 / 0x5c758 /
0x5c75c = their saved palettes (768 bytes), 0x5c760 = 768-byte scratch palette for fades (shared by all
three wobbler parts), 0x5c764 = u32 duration of the running wobbler phase, 0x5c73c = f32 wobble
parameter 1, 0x5c740 = f32 wobble parameter 2 (both read by the helpers at 0x154d4..0x1592b).

Per-part globals are listed with each part.

### Initialised data bytes 0x53ea0..0x53ebc (peek.py 53ea0 32 b)

```
53ea0: 01 00 00 00 44 01 01 00 4a 01 01 01 01 01 00 00
53eb0: 6c 01 01 01 01 00 00 00 10 01 01 01 01 00 00 00
```

| addr | init | meaning |
|---|---|---|
| 0x53ea0 | 1 | wobbler "fade-in pending" flag |
| 0x53ea4 | 0x44 | text colour, badguy scenes |
| 0x53ea5 | 1 | badguy (baddy.3ds) fade-in pending |
| 0x53ea6 | 1 | badguy2 (baddy2.3ds) fade-in pending |
| 0x53ea8 | 0x4a | text colour, hitcar |
| 0x53ea9 | 1 | hitcar fade-in pending |
| 0x53eaa | 1 | hitcar: switch to Camera02 pending |
| 0x53eab | 1 | hitcar: switch to Camera03 pending |
| 0x53eac | 1 | not referenced anywhere in the listing (grep) |
| 0x53eb0 | 0x6c | text colour, bridge |
| 0x53eb1 | 1 | bridge fade-in pending (re-armed for phase 2) |
| 0x53eb2 | 1 | bridge: switch to Camera02 pending |
| 0x53eb3 | 1 | not referenced in this slice |
| 0x53eb4 | 1 | bridge: switch to Camera04 pending |
| 0x53eb8 | 0x10 | text colour, return scene |
| 0x53eb9 | 1 | return: fade-in pending |
| 0x53eba | 1 | return: Camera02 pending |
| 0x53ebb | 1 | return: Camera03 pending |
| 0x53ebc | 1 | return: Camera04 pending |

### Double constants read (all float64)

| addr | value | used by |
|---|---|---|
| 0x5079c | 5.7 | sub_15acc duration factor |
| 0x507a4, 0x507d0, 0x5080c | 0.01 | wobble parameter 1 = t*0.01 |
| 0x507d8, 0x50814 | 0.003 | wobble parameter 2 = t*0.003 |
| 0x50804 | 10.5 | sub_15f4e duration factor |
| 0x5089e, 0x508a6 | 5.75 | badguy / badguy2 duration factor |
| 0x508e8, 0x508f0 | 385, 520 | hitcar text window |
| 0x5095e, 0x50966 | 500, 545 | hitcar camera switches |
| 0x509ce, 0x509d6 | 250, 385 | bridge text 1 |
| 0x509de, 0x509e6 | 445, 590 | bridge text 2 |
| 0x50a5d | 250 | bridge Camera02 switch |
| 0x50a65 | 590 | bridge Camera04 switch |
| 0x50adc, 0x50ae4 | 240, 335 | return text 1 |
| 0x50aec, 0x50af4 | 345, 390 | return text 2 |
| 0x50afc, 0x50b04 | 400, 435 | return text 3 |
| 0x50b0c | 440 | return text 4 |
| 0x50b9b, 0x50ba3, 0x50bab | 90, 270, 340 | return camera switches |

### Callees outside the slice, as used here

- `sub_1418c(eax=char*)` loader progress message.
- `sub_10734()` -> eax = new 64K-aligned 64K block.
- `sub_1f07c(eax=filename, edx=dest, ebx=0, ecx=0, stack=0)` load GIF into dest (sets palette 0x5c9b0 as a
  side effect, which is why each loader copies 0x5c9b0 right afterwards).
- `sub_23a6d(eax=dst, edx=src, ebx=n)` = memcpy.
- `sub_1d3b0(eax=ptr, edx=value, ebx=n)` = memset.
- `sub_1061c(eax=pal768)` set VGA palette; `sub_10660(eax=buf)` clear 64000 bytes; `sub_1067c(eax=buf)` flip.
- `sub_23b6c(eax=float[3] a, edx=float[3] b)` -> ST0 = a.x*b.x + a.y*b.y + a.z*b.z (float32 loads, x87 precision).
- `sub_14048(eax=dest buffer, edx=x, ebx=y, ecx=char* text, stack arg = u8 colour)` draw text with the
  proportional font at 0x594a8. It first draws the string twice in colour 0 (at (x+1,y+1) and (x,y+1))
  as a shadow, then in the given colour at (x,y). (Owned by another reader; only the argument order is
  asserted here: ebx is used as index into the row-offset table 0x593a8, so ebx = y.)
- `sub_13cfe(eax=width, edx=height, ebx=buffer, ecx=table)`: stores ecx to 0x53e8c, ebx to 0x53e18, and
  fills u32 table 0x52e10[i] = i*width for i in 0..height-1. Set-up for the blended polygon filler sub_27434.
- `sub_2f1bc(eax=filename, edx=int)` load 3DS -> eax = scene struct. The edx value (10 for
  baddy/baddy2/bridge/badguy, 20 for hitcar) is stored as u16 at scene+0x24 (0x2f252) and copied to
  0x5c998 by sub_2d150. Meaning unknown here (owner of 0x2f1bc to say).
- `sub_2d150(eax=scene)` make scene current. Copies (evidence: 0x2d15e..0x2d1bf):
  scene+0x00 -> 0x5c964, +0x04 -> 0x5c96c, +0x08 -> 0x5c974, +0x0c -> 0x5c97c, +0x10 -> 0x5c984,
  +0x14 -> 0x5c980, +0x18 -> 0x5c988 (default camera = first camera of the scene, set at 0x2f287..0x2f292),
  +0x1c (u16) -> 0x5c98c start frame, +0x1e (u16) -> 0x5c98e end frame, +0x20 (f32) -> 0x5c990 frame span,
  +0x24 (u16) -> 0x5c998. Note it re-reads the scene struct every time, so the overrides of
  0x5c98c/0x5c990 done by the bridge part do not persist.
- `sub_2d014(eax=name, edx=node** out)` find world node by name; `*out` = node; node layout used here:
  `+0: u16 type, +2: void* object, +6: node* next`. The loaders take `(*out)->object` (dword at +2) as
  the camera pointer. Exits the program with "Couldn't find world object : %s" if missing.
- `sub_2d0b8(eax=name)` -> eax = mesh object pointer (node type 0 with matching name). (It writes
  through an uninitialised EBX as scratch; harmless, not ours.)
- `sub_2f43c()` animate the current scene to frame 0x5c994 using camera 0x5c988.
- `sub_2c7a8()` transform/sort: builds the face list 0x5e0c8 / 0x5e0d0.
- `sub_24b54(eax=face, edx=0)`, `sub_27670(eax=face, edx=0)`, `sub_27434(eax=face, edx=dest buffer)`
  polygon fillers. NOTE: this slice never calls 0x29510 or 0x2b3c0.
- Wobbler helpers (other reader): `sub_15637()`, `sub_157b0()`, `sub_1592b()` (per-frame set-up for
  variants 1/2/3, no args, read 0x5c73c / 0x5c740) and `sub_154d4(eax=image)` (renders into buffer A).

### Frame ranges of the 3DS files (read from the KFSEG chunk 0xB008 of each file, not from the code)

| file | start | end |
|---|---|---|
| SCENES\BADDY.3DS | 0 | 90 |
| SCENES\BADDY2.3DS | 0 | 90 |
| SCENES\HITCAR.3DS | 0 | 630 |
| SCENES\BRIDGE.3DS | 0 | 780 |
| SCENES\BADGUY.3DS | 0 | 550 |

Assumption (loader not read by me): scene+0x1c = start, +0x1e = end, +0x20 = (float)(end - start).
The bridge part's own arithmetic (0x16e81: `span = end - 445`, `start = 445`) is consistent with that.

### Mesh object / face / vertex layout inferred here

```
object: +0x10: face*  faces        (array, stride 0x35 = 53 bytes)
        +0x18: i32    face count
        +0x1c: u8     flags; loaders OR in 0x10 for the objects they draw by hand
face:   +0x00: vertex* v0
        +0x04: vertex* v1
        +0x08: vertex* v2
        +0x18: f32[3]  normal (in the same space as vertex+0x18)
        +0x30: u8      render flags: 0x02 -> sub_24b54, 0x40 -> sub_27670, 0x80 -> sub_27434
vertex: +0x18: f32[3]  camera-space position x,y,z
```

### Common code pattern 1: fade-in from white (macro `FADE_IN(flag, savedPal, scratchPal)`)

Identical instruction sequence in every part loop. `t` = current value of 0x593cc (unsigned).

```c
if (flag != 0) {
    if (t < T) {                                    // unsigned compare, T = [0x593d4] = 100
        for (i = 0; i < 0x300; i++)
            scratchPal[i] = (u8)(0x3f - ((0x3f - savedPal[i]) * t) / T);   // u32 mul, u32 unsigned div (truncating)
        wait_vsync();
        sub_1061c(scratchPal);
    } else {
        wait_vsync();
        sub_1061c(savedPal);
        flag = 0;
    }
}
```
i.e. white (63,63,63) at t=0 -> real palette at t=T, then the real palette is set once and the flag cleared.
In sub_15acc/162c2/16452/1681a/17322 `t` is re-read from 0x593cc for the `t < T` test and again for each
multiply (the timer is an interrupt, so it can tick mid-loop; irrelevant for a port: use one sample).

### Common code pattern 2: frame number (macro `SET_FRAME(duration)`)

```c
// x87 extended precision, result rounded to float32 on store
[0x5c994] = (float)( (double)(u32)[0x593cc] * (f32)[0x5c990] / (double)(u32)duration + (int)(u16)[0x5c98c] );
```
Order: fild t; fmul span; fild duration; fdivp; fild start; faddp; fstp dword. So frame = start + t*span/duration.

### Common code pattern 3: draw "prs" object by hand (functions sub_16084 = sub_165a4 = sub_16a18 = sub_16ff4)

Four byte-identical copies (only the addresses differ). Argument: eax = mesh object.

```c
void draw_prs_object(object *o)            // sub_16084 / sub_165a4 / sub_16a18 / sub_16ff4
{
    for (i = o->faceCount - 1; i >= 0; i--) {             // [o+0x18], descending
        face *f = (face*)((u8*)o->faces + i * 0x35);       // [o+0x10]
        float *a = f->v0 + 0x18, *b = f->v1 + 0x18, *c = f->v2 + 0x18;
        float sum[3];                                     // float32 temporaries
        sum[0] = a[0] + b[0] + c[0];
        sum[1] = a[1] + b[1] + c[1];
        sum[2] = a[2] + b[2] + c[2];
        if (a[2] > 1.0f || b[2] > 1.0f || c[2] > 1.0f) {  // at least one vertex in front of z = 1.0 ([0x54730])
            float d = sub_23b6c(sum, (float*)((u8*)f + 0x18));   // dot(sum, face normal)
            if (d > 0.0)                                  // code: fldz; fcompp; jae skip  => skip when 0 >= d
                sub_27670(f, 0);                          // eax = face, edx = 0
        }
    }
}
```
So objects whose name ends in ",prs" get flag 0x10 at object+0x1c (presumably "exclude from the engine's
sorted list"; engine owner to confirm) and are drawn first, unsorted, back-face culled with the
centroid*3-dot-normal test, always through sub_27670.

### Common code pattern 4: draw the engine's sorted face list (macro `DRAW_SORTED()`)

```c
for (i = [0x5e0d0] - 1; i >= 0; i--) {         // descending index
    face *f = ((face**)[0x5e0c8])[i];
    u8 fl = *((u8*)f + 0x30);
    if (fl & 0x02)      sub_24b54(f, 0);
    else if (fl & 0x40) sub_27670(f, 0);
}
```
The hitcar variant has a different test order and a third case; given in full there.

---

## 1. Wobbler part 1

### sub_15a68: load_wobbler1
```c
sub_1418c("wobbler image1");
[0x5c748] = sub_10734();
sub_1f07c("TEXTURES\\2dtest.gif", [0x5c748], 0, 0, /*stack*/0);
[0x5c754] = malloc(0x300);  memcpy([0x5c754], 0x5c9b0, 0x300);    // saved palette of image 1
[0x5c760] = malloc(0x300);                                        // scratch palette (uninitialised)
```

### sub_15acc: run_wobbler1
```c
[0x5c764] = D = round_fistp((double)T * 5.7);      // fild qword T; fmul dbl 5.7; call 0x1f318; fistp qword. = 570
// NOTE: 0x53ea0 is NOT set here; it relies on its initial value 1.
for (;;) {
    t = [0x593cc];
    if (t >= D) break;                              // unsigned
    FADE_IN([0x53ea0], [0x5c754], [0x5c760]);
    [0x5c73c] = (float)((double)(u32)[0x593cc] * 0.01);   // float32 store
    sub_15637();
    sub_154d4([0x5c748]);                           // eax = image 1
    sub_1067c([0x593a0]);                           // flip buffer A
}
// shared exit tail at 0x15bee (also the exit of sub_15f4e):
[0x593cc] = t - D;                                  // keep the overshoot
memset([0x5c760], 0x3f, 0x300);
wait_vsync();
sub_1061c([0x5c760]);                               // whole palette white
sub_10660([0x5937c]);                               // clear the VISIBLE screen to index 0 (shows as white)
```

## 2. Wobbler part 2

### sub_15c39: load_wobbler2
```c
sub_1418c("wobbler image2");
[0x5c74c] = sub_10734();
sub_1f07c("TEXTURES\\2dtest2.gif", [0x5c74c], 0, 0, 0);
[0x5c758] = malloc(0x300);  memcpy([0x5c758], 0x5c9b0, 0x300);    // code at 0x15c7b, shared with sub_15f07
```

### sub_15c8e: run_wobbler2 (two phases)
```c
// ---- phase 1 ----
[0x5c764] = D1 = T << 2;                            // 400
[0x53ea0] = 1;
for (;;) {
    t = [0x593cc];
    if (t >= D1) break;
    FADE_IN([0x53ea0], [0x5c758], [0x5c760]);       // t sampled once for the "< T" test here
    [0x5c73c] = (float)((double)(u32)[0x593cc] * 0.01);
    // 0x5c740 is NOT written in phase 1: it keeps its previous value (0.0 from BSS unless a helper
    // at 0x154d4..0x1592b writes it; this part runs before sub_15f4e, the only other writer here)
    sub_157b0();
    sub_154d4([0x5c74c]);
    sub_1067c([0x593a0]);
}
[0x593cc] = t - D1;
// no white flash, no clear between the phases
// ---- phase 2 ----
[0x53ea0] = 1;                                      // fade from white again
[0x5c764] = D2 = ((T*4 - T)*4 - T);                 // 11*T = 1100
for (;;) {
    t = [0x593cc];
    if (t >= D2) break;
    FADE_IN([0x53ea0], [0x5c758], [0x5c760]);
    tt = (double)(u32)[0x593cc];                    // one sample for both
    [0x5c740] = (float)(tt * 0.003);
    [0x5c73c] = (float)(tt * 0.01);
    sub_157b0();
    sub_154d4([0x5c74c]);
    sub_1067c([0x593a0]);
}
[0x593cc] = t - D2;
memset([0x5c760], 0x3f, 0x300);  wait_vsync();  sub_1061c([0x5c760]);   // white
sub_10660([0x5937c]);
```

## 3. Wobbler part 3

### sub_15f07: load_wobbler3
```c
sub_1418c("wobbler image3");
[0x5c750] = sub_10734();
sub_1f07c("TEXTURES\\2dtest3.gif", [0x5c750], 0, 0, 0);
[0x5c75c] = malloc(0x300);  memcpy([0x5c75c], 0x5c9b0, 0x300);    // via jmp 0x15c7b
```

### sub_15f4e: run_wobbler3
```c
[0x5c764] = D = round_fistp((double)T * 10.5);      // = 1050
[0x53ea0] = 1;
for (;;) {
    t = [0x593cc];
    if (t >= D) break;                              // exit jumps to the tail of sub_15acc (0x15bee)
    FADE_IN([0x53ea0], [0x5c75c], [0x5c760]);
    tt = (double)(u32)[0x593cc];
    [0x5c73c] = (float)(tt * 0.01);
    [0x5c740] = (float)(tt * 0.003);
    sub_1592b();
    sub_154d4([0x5c750]);
    sub_1067c([0x593a0]);
}
// tail 0x15bee: [0x593cc] = t - D; white palette via [0x5c760]; clear visible screen
```

---

## 4. "scene - badguy" (baddy.3ds and baddy2.3ds)

Globals: 0x5c768 scene baddy, 0x5c76c scene baddy2, 0x5c770 u32 duration, 0x5c774 saved palette,
0x5c778 scratch palette, 0x5c77c "panel,prs" object of baddy, 0x5c780 "panel,prs" object of baddy2.

### sub_1622e: load_badguy
```c
sub_1418c("scene - badguy");
[0x5c768] = sub_2f1bc("scenes\\baddy.3ds", 10);
[0x5c774] = malloc(0x300);  memcpy([0x5c774], 0x5c9b0, 0x300);   // palette as it is after loading baddy.3ds
[0x5c778] = malloc(0x300);
[0x5c77c] = sub_2d0b8("panel,prs");   *(u8*)([0x5c77c] + 0x1c) |= 0x10;
[0x5c76c] = sub_2f1bc("scenes\\baddy2.3ds", 10);
[0x5c780] = sub_2d0b8("panel,prs");   *(u8*)([0x5c780] + 0x1c) |= 0x10;   // looked up in baddy2 (current scene after load)
```
Note: the palette is saved only once (after baddy.3ds, before baddy2.3ds); both scenes use 0x5c774.
No camera is looked up: both scenes use their default camera.

### sub_162c2: run_badguy (demo part 5; text "The Power Must Remain Mine")
```c
sub_2d150([0x5c768]);
[0x5c770] = D = round_fistp((double)T * 5.75);      // = 575
// no palette set here: screen is still all-white from the previous part's exit
for (;;) {
    t = [0x593cc];
    if (t >= D) break;
    FADE_IN([0x53ea5], [0x5c774], [0x5c778]);
    SET_FRAME(D);                                   // frame = 0 + t*90/575
    sub_2f43c();
    sub_2c7a8();
    sub_16138();
}
// exit tail 0x16407 (shared with sub_16452):
[0x593cc] = t - D;
memset([0x5c778], 0x3f, 0x300);  wait_vsync();  sub_1061c([0x5c778]);   // white
sub_10660([0x5937c]);
```

### sub_16138: badguy_draw_frame
```c
sub_10660([0x593a0]);                    // clear buffer A
draw_prs_object([0x5c77c]);              // sub_16084, panel of baddy.3ds
DRAW_SORTED();
sub_14048([0x593a0], 20, 170, "     The Power Must Remain Mine", /*colour*/[0x53ea4] /*0x44*/);
sub_1067c([0x593a0]);
```
String at 0x5081c (5 leading spaces). Text is shown on every frame of the part.

### sub_16452: run_badguy2 (NOT a top-level part: called only from sub_16cdd, between the two bridge phases)
```c
sub_2d150([0x5c76c]);
sub_1061c([0x5c774]);                               // real palette set immediately (no vsync wait) ...
[0x5c770] = D = round_fistp((double)T * 5.75);      // 575
for (;;) {
    t = [0x593cc];
    if (t >= D) break;                              // exit: jmp 0x16407 = tail of sub_162c2 (white palette, clear screen)
    FADE_IN([0x53ea6], [0x5c774], [0x5c778]);       // ... then faded from white as usual on the first frame
    SET_FRAME(D);                                   // 0 + t*90/575
    sub_2f43c();
    sub_2c7a8();
    sub_161bf();
}
```

### sub_161bf: badguy2_draw_frame
Identical to sub_16138 except for the text (it jumps into sub_16138 at 0x161a2 for the tail). Note it
passes **0x5c77c** (the panel object of baddy.3ds, not 0x5c780 of baddy2.3ds) to sub_16084: 0x5c780 is
written by the loader and never read. This is what the code does (0x161d6); the baddy.3ds object's
vertices are simply whatever they were left at when that scene last rendered.
```c
sub_10660([0x593a0]);
draw_prs_object([0x5c77c]);              // sic
DRAW_SORTED();
sub_14048([0x593a0], 20, 170, "      He Will Never Make It", [0x53ea4] /*0x44*/);   // string 0x5083c, 6 leading spaces
sub_1067c([0x593a0]);
```

---

## 5. "scene - hitcar"

Globals: 0x5c784 scene, 0x5c788 u32 duration, 0x5c78c saved palette, 0x5c790 scratch palette,
0x5c794 additive blend table (64K), 0x5c798 Camera02, 0x5c79c Camera03, 0x5c7a0 "Tun,prs" object,
0x5c7a4 "Floor,prs" object.

### sub_16743: load_hitcar
```c
sub_1418c("scene - hitcar");
[0x5c784] = sub_2f1bc("scenes\\hitcar.3ds", 20);           // note 20, the others pass 10
[0x5c78c] = malloc(0x300);  memcpy([0x5c78c], 0x5c9b0, 0x300);
[0x5c790] = malloc(0x300);
sub_1418c("addative table");
[0x5c794] = sub_10734();
sub_10770([0x5c794]);                                      // additive table from the CURRENT palette (hitcar's)
sub_1418c("searching cameras");
node *n;
sub_2d014("Camera02", &n);  [0x5c798] = n->object;         // dword at node+2
sub_2d014("Camera03", &n);  [0x5c79c] = n->object;
[0x5c7a0] = sub_2d0b8("Tun,prs");    *(u8*)([0x5c7a0] + 0x1c) |= 0x10;
[0x5c7a4] = sub_2d0b8("Floor,prs");  *(u8*)([0x5c7a4] + 0x1c) |= 0x10;
```

### sub_1681a: run_hitcar (demo part 6)
```c
sub_2d150([0x5c784]);
sub_1061c([0x5c78c]);                               // real palette immediately
sub_13cfe(/*eax*/[0x59384] /*320*/, /*edx*/[0x59388] /*200*/, /*ebx*/[0x593a0], /*ecx*/[0x5c794]);
                                                    // blend filler set-up: dest = buffer A, table = additive
[0x5c788] = D = (T*4 - T) << 3;                     // 24*T = 2400
for (;;) {
    t = [0x593cc];
    if (t >= D) break;
    FADE_IN([0x53ea9], [0x5c78c], [0x5c790]);
    SET_FRAME(D);                                   // frame = 0 + t*630/2400
    if ([0x53eaa] != 0 && (double)[0x5c994] > 500.0) { [0x53eaa] = 0; [0x5c988] = [0x5c798]; }  // Camera02
    if ([0x53eab] != 0 && (double)[0x5c994] > 545.0) { [0x53eab] = 0; [0x5c988] = [0x5c79c]; }  // Camera03
    sub_2f43c();
    sub_2c7a8();
    sub_16658();
}
[0x593cc] -= D;
memset([0x5c78c], 0x3f, 0x300);                     // sic: overwrites the SAVED palette (not the scratch one)
wait_vsync();  sub_1061c([0x5c78c]);                // white
sub_10660([0x5937c]);
```
Both camera tests are evaluated in the same iteration, in that order (so a jump past 545 in one frame
ends on Camera03). Before frame 500 the scene's default (first) camera is used. Comparisons are
`fcomp`/`jbe` = strictly greater.

### sub_16658: hitcar_draw_frame
```c
sub_10660([0x593a0]);
draw_prs_object([0x5c7a4]);              // sub_165a4: Floor first
draw_prs_object([0x5c7a0]);              // then Tun
for (i = [0x5e0d0] - 1; i >= 0; i--) {
    face *f = ((face**)[0x5e0c8])[i];
    u8 fl = *((u8*)f + 0x30);
    if (fl & 0x40)      sub_27670(f, 0);            // NOTE: 0x40 is tested BEFORE 0x02 here
    else if (fl & 0x02) sub_24b54(f, 0);
    else if (fl & 0x80) sub_27434(f, /*edx*/[0x593a0]);   // blended (additive table set by sub_13cfe)
}
double fr = (double)[0x5c994];
if (fr > 385.0 && fr < 520.0) {                     // jbe / jae => strict on both sides
    sub_14048([0x593a0], 20, 160, "      Oh No, Somebody Is Trying", [0x53ea8] /*0x4a*/);   // 0x508b0, 6 spaces
    sub_14048([0x593a0], 20, 175, "            To Stop Me!",         [0x53ea8]);            // 0x508d0, 12 spaces
}
sub_1067c([0x593a0]);
```

---

## 6. "scene - bridge"

Globals: 0x5c7a8 scene, 0x5c7ac u32 duration, 0x5c7b0 saved palette, 0x5c7b4 scratch palette,
0x5c7b8 Camera02, 0x5c7bc Camera03, 0x5c7c0 Camera04, 0x5c7c4 "Ground,prs", 0x5c7c8 "Cliff1,prs",
0x5c7cc "Cliff2,prs".

### sub_16bf5: load_bridge
```c
sub_1418c("scene - bridge");
[0x5c7a8] = sub_2f1bc("scenes\\bridge.3ds", 10);
[0x5c7b0] = malloc(0x300);  memcpy([0x5c7b0], 0x5c9b0, 0x300);
[0x5c7b4] = malloc(0x300);
sub_1418c("searching cameras");
node *n;
sub_2d014("Camera02", &n);  [0x5c7b8] = n->object;
sub_2d014("Camera03", &n);  [0x5c7bc] = n->object;
sub_2d014("Camera04", &n);  [0x5c7c0] = n->object;
[0x5c7c4] = sub_2d0b8("Ground,prs");  *(u8*)([0x5c7c4] + 0x1c) |= 0x10;
[0x5c7c8] = sub_2d0b8("Cliff1,prs");  *(u8*)([0x5c7c8] + 0x1c) |= 0x10;
[0x5c7cc] = sub_2d0b8("Cliff2,prs");  *(u8*)([0x5c7cc] + 0x1c) |= 0x10;
```

### sub_16cdd: run_bridge (demo part 8: bridge phase 1, then badguy2, then bridge phase 2)
```c
// ---- phase 1: frames start .. start+385 ----
sub_2d150([0x5c7a8]);
sub_1061c([0x5c7b0]);                               // real palette immediately
[0x5c7ac] = D1 = (T << 4) - T;                      // 15*T = 1500
[0x5c990] = 385.0f;                                 // override the span (imm 0x43c08000); start stays scene start (0)
for (;;) {
    t = [0x593cc];
    if (t >= D1) break;
    FADE_IN([0x53eb1], [0x5c7b0], [0x5c7b4]);
    SET_FRAME(D1);                                  // frame = 0 + t*385/1500
    if ([0x53eb2] != 0 && (double)[0x5c994] > 250.0) { [0x53eb2] = 0; [0x5c988] = [0x5c7b8]; }   // Camera02
    sub_2f43c();
    sub_2c7a8();
    sub_16acc();
}
[0x593cc] = t - D1;
// no white flash and no clear here

// ---- interlude ----
sub_16452();                                        // baddy2.3ds, 575 ticks, "He Will Never Make It";
                                                    // returns with all-white palette and cleared screen

// ---- phase 2: frames 445 .. end ----
[0x5c7ac] = D2 = (T*4 + T) * 2;                     // 10*T = 1000
[0x53eb1] = 1;                                      // re-arm fade from white
sub_2d150([0x5c7a8]);                               // reloads start/end/span/default camera from the scene
[0x5c990] = (float)(int)((u32)(u16)[0x5c98e] - 0x1bd);   // end - 445 (= 335 for end 780); fild dword (signed 32)
[0x5c98c] = 0x1bd;                                  // start = 445
[0x5c988] = [0x5c7bc];                              // Camera03
for (;;) {
    t = [0x593cc];
    if (t >= D2) break;
    FADE_IN([0x53eb1], [0x5c7b0], [0x5c7b4]);
    SET_FRAME(D2);                                  // frame = 445 + t*335/1000
    if ([0x53eb4] != 0 && (double)[0x5c994] > 590.0) { [0x53eb4] = 0; [0x5c988] = [0x5c7c0]; }   // Camera04
    sub_2f43c();
    sub_2c7a8();
    sub_16acc();
}
[0x593cc] = t - D2;
sub_10660([0x5937c]);                               // clear the visible screen only; palette is left as is (no white flash)
```
Camera timeline: default camera (frames 0..250), Camera02 (250..385), [badguy2], Camera03 (445..590),
Camera04 (590..780). Frames 385..445 of bridge.3ds are never shown.

### sub_16acc: bridge_draw_frame
```c
sub_10660([0x593a0]);
draw_prs_object([0x5c7c4]);              // sub_16a18: Ground
draw_prs_object([0x5c7cc]);              // Cliff2
draw_prs_object([0x5c7c8]);              // Cliff1
DRAW_SORTED();                           // 0x02 -> sub_24b54, else 0x40 -> sub_27670
double fr = (double)[0x5c994];
if (!(fr >= 250.0) && !(fr >= 385.0)) {  // 0x16b44: fcomp 250; JAE skip   0x16b52: fcomp 385; JAE skip
    sub_14048([0x593a0], 20, 160, " My Destiny Lies Beyond This Bridge,", [0x53eb0] /*0x6c*/);  // 0x50970, 1 space
    sub_14048([0x593a0], 20, 175, "        The Gem Enlightens.",          [0x53eb0]);           // 0x50995, 8 spaces
}
if (fr > 445.0 && fr < 590.0)
    sub_14048([0x593a0], 20, 170, "        I Must Reach The Gem",         [0x53eb0]);           // 0x509b1, 8 spaces
sub_1067c([0x593a0]);
```
AMBIGUITY worth knowing (0x16b44..0x16b5b): the first window is coded as `frame < 250 && frame < 385`
(first branch is `jae`, where every other text window in this slice uses `jbe` for its lower bound).
Taken literally the two-line text is visible from frame 0 until frame 250 (i.e. exactly while the
default camera is active) and NOT during 250..385. This is what the binary does; whether the author
meant 250..385 is unknowable. Port the literal behaviour.

---

## 7. "scene - return" (badguy.3ds)

Globals: 0x5c7d0 scene, 0x5c7d4 u32 duration, 0x5c7d8 saved palette, 0x5c7dc scratch palette,
0x5c7e0 Camera02, 0x5c7e4 Camera03, 0x5c7e8 Camera04, 0x5c7ec "Room,prs", 0x5c7f0 "Floor,prs",
0x5c7f4 "Ramp,prs", 0x5c7f8 "Holder,prs".

### sub_17221: load_return
```c
sub_1418c("scene - return");
[0x5c7d0] = sub_2f1bc("scenes\\badguy.3ds", 10);
[0x5c7d8] = malloc(0x300);  memcpy([0x5c7d8], 0x5c9b0, 0x300);
[0x5c7dc] = malloc(0x300);
sub_1418c("searching cameras");
node *n;
sub_2d014("Camera02", &n);  [0x5c7e0] = n->object;
sub_2d014("Camera03", &n);  [0x5c7e4] = n->object;
sub_2d014("Camera04", &n);  [0x5c7e8] = n->object;
sub_1418c("searching objects");
[0x5c7ec] = sub_2d0b8("Room,prs");    *(u8*)([0x5c7ec] + 0x1c) |= 0x10;
[0x5c7f0] = sub_2d0b8("Floor,prs");   *(u8*)([0x5c7f0] + 0x1c) |= 0x10;
[0x5c7f4] = sub_2d0b8("Ramp,prs");    *(u8*)([0x5c7f4] + 0x1c) |= 0x10;
[0x5c7f8] = sub_2d0b8("Holder,prs");  // looked up only: flag NOT set, pointer never read again (only reference in the listing)
```

### sub_17322: run_return (demo part 9)
```c
sub_2d150([0x5c7d0]);
sub_1061c([0x5c7d8]);
[0x5c7d4] = D = ((T*8 - T)*4 + T);                  // 29*T = 2900
for (;;) {
    t = [0x593cc];
    if (t >= D) break;
    FADE_IN([0x53eb9], [0x5c7d8], [0x5c7dc]);
    SET_FRAME(D);                                   // frame = 0 + t*550/2900
    if ([0x53eba] != 0 && (double)[0x5c994] >  90.0) { [0x53eba] = 0; [0x5c988] = [0x5c7e0]; }   // Camera02
    if ([0x53ebb] != 0 && (double)[0x5c994] > 270.0) { [0x53ebb] = 0; [0x5c988] = [0x5c7e4]; }   // Camera03
    if ([0x53ebc] != 0 && (double)[0x5c994] > 340.0) { [0x53ebc] = 0; [0x5c988] = [0x5c7e8]; }   // Camera04
    sub_2f43c();
    sub_2c7a8();
    sub_170a8();
}
[0x593cc] -= D;
memset([0x5c7d8], 0x3f, 0x300);                     // sic: overwrites the saved palette
wait_vsync();  sub_1061c([0x5c7d8]);                // white
sub_10660([0x5937c]);
```

### sub_170a8: return_draw_frame
```c
sub_10660([0x593a0]);
draw_prs_object([0x5c7ec]);              // sub_16ff4: Room
draw_prs_object([0x5c7f0]);              // Floor
draw_prs_object([0x5c7f4]);              // Ramp
DRAW_SORTED();                           // 0x02 -> sub_24b54, else 0x40 -> sub_27670
double fr = (double)[0x5c994];           // all bounds strict (jbe / jae)
if (fr > 240.0 && fr < 335.0)
    sub_14048([0x593a0], 20, 170, "    The Gem, I Have Found It!", [0x53eb8] /*0x10*/);   // 0x50a70, 4 spaces
if (fr > 345.0 && fr < 390.0)
    sub_14048([0x593a0], 20, 170, "    It Is Ours Once Again...",  [0x53eb8]);            // 0x50a8e, 4 spaces
if (fr > 400.0 && fr < 435.0)
    sub_14048([0x593a0], 20, 160, "    Hand Over The Gem, Kahn!",  0x11);                 // 0x50aab, literal colour 0x11, y = 160
if (fr > 440.0)
    sub_14048([0x593a0], 20, 170, "             Never!",           [0x53eb8]);            // 0x50ac8, 13 spaces; until the end
sub_1067c([0x593a0]);
```

### sub_17530
Starts at 0x17530 (`mov eax, 0x12; call 0x2fb78` = allocate 0x12 bytes): beginning of the next slice, not covered.

---

## 8. Timeline summary (ticks of 0x593cc at 100 Hz, T = 100)

Demo order of the parts in this slice (each subtracts its duration from 0x593cc on exit, so overshoot
carries into the next part; ESC adds 0x01000000 so every loop exits at once):

| order | function | content | duration | frames | exit |
|---|---|---|---|---|---|
| 4 | sub_15acc | wobbler 1 (2dtest.gif, sub_15637) | 570 | - | white + clear |
| 5 | sub_162c2 | baddy.3ds | 575 | 0..90 | white + clear |
| 6 | sub_1681a | hitcar.3ds | 2400 | 0..630 | white + clear |
| 7 | sub_15c8e | wobbler 2 (2dtest2.gif, sub_157b0) | 400 then 1100 | - | white + clear (after 2nd) |
| 8 | sub_16cdd | bridge.3ds phase 1 | 1500 | 0..385 | nothing |
| 8 | (sub_16452) | baddy2.3ds | 575 | 0..90 | white + clear |
| 8 | sub_16cdd | bridge.3ds phase 2 | 1000 | 445..780 | clear only |
| 9 | sub_17322 | badguy.3ds | 2900 | 0..550 | white + clear |
| 10 | sub_15f4e | wobbler 3 (2dtest3.gif, sub_1592b) | 1050 | - | white + clear |

Every part fades in from white over its first T = 100 ticks (pattern 1). Only sub_15acc and sub_162c2
do not also upload the real palette before their loop (they start on the white palette left by the
previous part; sub_15acc depends on whatever part 149ba/15162 left).

## 9. Open questions

1. Meaning of the 2nd argument of sub_2f1bc (10, or 20 for hitcar) -> scene+0x24 -> 0x5c998.
2. scene+0x1c/+0x1e/+0x20 = start/end/span is inferred from sub_2d150, the bridge code and the KFSEG
   chunks; the loader code that fills them was not read.
3. Object flag 0x10 at object+0x1c: assumed "skip in sub_2c7a8's face list" (must be, or the faces
   would be drawn twice); engine owner to confirm. The hand-drawn objects still need their vertices
   transformed by the engine (vertex+0x18 is read).
4. sub_161bf draws 0x5c77c (panel of baddy.3ds) while baddy2.3ds is current; 0x5c780 is never read.
   Whether that panel's vertices get re-transformed while another scene is current depends on the engine
   (if not, the panel is drawn with its stale last-frame positions from part 5).
5. Bridge text 1 condition is literally `frame < 250` (see sub_16acc).
6. 0x5c740 during phase 1 of sub_15c8e is whatever was left there (expected 0.0) unless the wobble
   helpers write it.
7. sub_1f318 rounding mode is irrelevant here: 5.7*100, 5.75*100, 10.5*100 give 570, 575, 1050 either way
   (5.7*100 in x87 is 570.0000000000000178).
