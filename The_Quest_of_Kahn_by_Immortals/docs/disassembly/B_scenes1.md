# KAHN.EXE 0x14239..0x15a68: loading screen, parts 1-3 (create / steal / meeting), wobbler grid helpers

All addresses hex. `t` always means the 32-bit unsigned timer `[0x593cc]` (100 Hz, bumped by the
MIDAS callback 0x10bd0, so it changes asynchronously while loops spin). All timer compares are
UNSIGNED (`jae`/`jbe`).

## 0. Shared facts established while reading this slice

### Globals used here

| addr | type | meaning (evidence) |
|---|---|---|
| 0x593d4 | u32 | `TICKS` = 100 (written once at 0x10c41: `mov [0x593d4],0x64`). One "second" in timer ticks. Every duration below is a multiple of it |
| 0x593cc | u32 | timer `t` (part-relative: each part subtracts its duration when it ends, it never zeroes it) |
| 0x593d0 | u32 | second timer; in this slice only *incremented* inside busy-wait loops (see sub_14477), never read |
| 0x5c988 | ptr | current camera of the active scene (set by sub_2d150 from scene+0x18; overwritten here for camera cuts) |
| 0x5c98c | u16 | scene start frame (sub_2d150 copies it from scene+0x1c) |
| 0x5c98e | u16 | scene end frame (scene+0x1e) - not read in this slice |
| 0x5c990 | f32 | scene frame span (scene+0x20), multiplied by t/duration |
| 0x5c994 | f32 | CURRENT FRAME NUMBER, written by every part loop, read by sub_2f43c (engine) and by the draw functions here |
| 0x5e0d0 | i32 | count of entries in the visible-face list built by sub_2c7a8 |
| 0x5e0c8 | ptr | array of face pointers (visible, sorted by the engine). Always walked from index count-1 DOWN to 0 |
| 0x5c9b0 | u8[768] | current palette (6-bit) as left by the last loader |
| 0x594b8 | ptr | 0xF0-byte loader text state (8 lines x 30 bytes, see sub_1418c at 0x1418c, outside this slice) |
| 0x53e94 | u8 | = 0x6f (111) text colour, part 2 |
| 0x53e95 | u8 | = 1 part 2: "Camera02 switch pending" |
| 0x53e96 | u8 | = 1 part 2: "Camera03 switch pending" |
| 0x53e97 | u8 | = 1 part 2: "initial fade-from-white pending" |
| 0x53e98 | u8 | = 1 part 2: "second fade-from-white (at camera 2 cut) pending" |
| 0x53e99 | u8 | = 1 part 2: "latch start time of second fade" |
| 0x53e9a,9b | u8 | 0 (unused here) |
| 0x53e9c | u8 | = 0x6b (107) text colour, part 3 |
| 0x53e9d/9e/9f | u8 | = 1,1,1 part 3: Camera02 / Camera03 / Camera04 switch pending |

Initial bytes: `53e94: 6f 01 01 01 01 01 00 00 6b 01 01 01`.

Part 1 (create) globals: 0x594bc scene, 0x594c0 duration scratch, 0x594c4 saved palette (768),
0x594c8 texture "immor2.gif" (64K block), 0x594cc work palette (768), 0x594d0 object "objct-prs".

Part 2 (steal) globals: 0x594d4 scene, 0x594d8 duration, 0x594dc flash start time, 0x594e0 saved
palette, 0x594e8 transparency table (64K), 0x594ec work palette, 0x594f0 Camera02, 0x594f4 Camera03,
0x594f8 Room, 0x594fc WallsX, 0x59500 "Ceilig,Prs", 0x59504 Floor, 0x59508 pyr-cul.

Part 3 (meeting) globals: 0x5950c scene, 0x59510 duration, 0x59514 saved palette, 0x59518 shade table
(64K), 0x5951c/0x59520/0x59524 Camera02/03/04, 0x59528 Ceil-prs, 0x5952c Floot-prs, 0x59530
"WallsX,prs", 0x59534 "Wallsy,prs", 0x59538 "DoorX,prs", 0x5953c cul-spc.

Wobbler globals: 0x59540 texture pointer for the grid, 0x59544 grid of {i16 u, i16 v}[41][26]
(stride 0x68 per column, 4 per row; ends at 0x5a5ec), 0x5a5ec f32 dist[41][26] (ends 0x5b694),
0x5b694 f32 angle[41][26], 0x5c73c f32 `T` (wobble phase 1), 0x5c740 f32 `T2` (phase 2); T/T2 are
written by the callers at 0x15bca/0x15d76/0x15e87/0x15e96/0x16051/0x16060 (outside this slice).

### Engine struct offsets touched in this slice (evidence = the code quoted per function)

Scene (returned by sub_2f1bc, consumed by sub_2d150 at 0x2d150):
```
+0x00 -> 0x5c964   +0x04 -> 0x5c96c   +0x08 -> 0x5c974   +0x0c -> 0x5c97c
+0x10 -> 0x5c984   +0x14 -> 0x5c980   +0x18 -> 0x5c988 (default camera)
+0x1c u16 -> 0x5c98c start frame      +0x1e u16 -> 0x5c98e end frame
+0x20 f32 -> 0x5c990 frame span       +0x24 u16 -> 0x5c998
```
Object (returned by sub_2d0b8):
```
+0x0c ptr   vertex array, stride 0x40           (sub_14fed)
+0x10 ptr   face array, stride 0x35 (53 bytes)  (sub_14294, sub_143ac)
+0x14 i32   vertex count                        (sub_14fed)
+0x18 i32   face count
+0x1c u8    flags; this slice ORs in 0x10 on every object it draws by hand
            (so 0x10 most likely means "engine: do not put my faces in the sorted list"; confirm in sub_2c7a8)
```
Face (0x35 bytes):
```
+0x00,+0x04,+0x08 ptr  the three vertices
+0x14 f32   unknown scalar; sub_143ac tests `< 0.5` to pick faces for re-texturing
+0x18 f32[3] vector dotted against the vertex sum (face normal in camera space)
+0x30 u8    flags tested here: 0x02, 0x10, 0x20, 0x40 (select the rasteriser, see draw functions)
+0x31 ptr   texture (64K block), unaligned dword
```
Vertex (0x40 bytes):
```
+0x18 f32[3] position used for culling (x,y,z in camera space; z compared with 1.0)
+0x30 f32    set to 50.0 or 0.0 by sub_14fed "update cone"
+0x34 f32    read by sub_14fed "update cone"
```
sub_2d014(eax=name, edx=&out): writes a pointer to `*out`; the camera pointer is the UNALIGNED dword at
`(*out)+2`.

Name lookups: the code asks for "objct-prs" while CREAT.3DS contains "Objct-prs", so sub_2d0b8 must be
case-insensitive (or names are lower-cased on load) - verify in sub_2d0b8.

Keyframe segments in the files (chunk 0xB008, parsed by me from SCENES/*.3DS): CREAT 0..570,
FIRSTS 0..500, SECONDS 0..580. If the loader stores start=0 and span=end-start, the frame formulas are
`frame = t*570/2000`, `t*500/1700`, `t*580/2780`. The exact span value is set in sub_2f1bc (not my slice).

### Callees outside the slice, as used here

- sub_14048(eax=dest buffer, edx=x, ebx=y, ecx=string, stack=colour byte): text with a colour-0 shadow at
  (x+1,y+1) first, then the text at (x,y) in `colour`.
- sub_1418c(eax=string): loader progress line (scrolls 8 lines of 30 bytes, copies buffer B 0x593a4 to
  buffer A, draws lines at x=30, y=46+16*i, colour 0x1c, flips).
- sub_1f07c(eax=filename, edx=dest, ebx=flag byte, ecx, stack arg): GIF load. Calls seen here:
  loading.gif (dest=[0x593a4], ebx=1, ecx=0, stack 0); immor2.gif (dest=64K block, ebx=0, ecx=0, stack 0);
  logo.gif (dest=[0x5937c] i.e. straight to the visible screen, ebx=0, ecx=0, stack 0).
- sub_23a6d(eax=dst, edx=src, ebx=n) = memcpy. sub_23b6c(eax=a, edx=b) = dot product of two f32[3] in ST0.
  sub_2fb70(eax) = abs(int).
- sub_1f318 + `fistp`: the helper sets the FPU control-word high byte to 0x1f (RC=11) and does `frndint`,
  i.e. it TRUNCATES TOWARD ZERO (plain C `(int)x`), not round-to-nearest.
- sub_12962(eax=struct): textured triangle. Struct = { u32 texture; {i16 x; i16 y; i16 u; i16 v;} v[3]; }
  (it sorts the three vertices by comparing the (y<<16|x) dwords). Internals not my slice.
- VSYNC below means: `while (inp(0x3da) & 8); while (!(inp(0x3da) & 8));`

---

## 1. sub_14239 loader_init (no args)

```
[0x594b8] = malloc(0xF0); memset([0x594b8], 0, 0xF0);
sub_10660([0x5937c]);                       // clear the VISIBLE screen
sub_1f07c("textures\loading.gif", edx=[0x593a4] /*buffer B*/, ebx=1, ecx=0, stack 0);
sub_1418c("loader initialized");
```
Buffer B keeps the loading picture; every sub_1418c call copies B to A, prints the 8 text lines, flips.

## 2. sub_14294 / sub_1467c / sub_14d9c draw_object_backface_perspective(eax=object)

Three byte-identical copies (0x14294 used by part 1, 0x1467c by part 2, 0x14d9c by part 3; the last one
only differs by sharing its epilogue with sub_14c30).

```
for (f = obj->faceCount - 1; f >= 0; f--) {          // [obj+0x18], signed
    face = obj->faces + f*0x35;                       // [obj+0x10]
    a = face->v[0] + 0x18; b = face->v[1] + 0x18; c = face->v[2] + 0x18;   // f32[3] each
    float sum[3] = { a[0]+b[0]+c[0], a[1]+b[1]+c[1], a[2]+b[2]+c[2] };     // stored as f32
    if (a[2] > 1.0f || b[2] > 1.0f || c[2] > 1.0f) {  // flt const at 0x54730 = 1.0
        d = sub_23b6c(sum, face + 0x18);              // dot(sum, face normal)
        if (d > 0)                                    // `fldz; fcompp; jae skip` => skip when 0 >= d
            sub_27670(eax=face, edx=0);
    }
}
```
So: any vertex in front of z=1, and normal pointing AWAY from the viewer (inside-out rooms), drawn
in reverse face order with rasteriser sub_27670.

## 3. Part 1 "create"

### sub_143ac load_create (loader)

```
sub_1418c("scene - create");
[0x594bc] = sub_2f1bc(eax="scenes\creat.3ds", edx=10);
[0x594c4] = malloc(0x300); memcpy([0x594c4], 0x5c9b0, 0x300);   // palette as left by the 3DS/texture load
[0x594cc] = malloc(0x300);                                       // work palette (uninitialised)
sub_1418c("xtra flat");
[0x594c8] = sub_10734();                                         // 64K block
sub_1f07c("textures\immor2.gif", edx=[0x594c8], ebx=0, ecx=0, stack 0);
o = sub_2d0b8("Immort");
for (i = 0; i < o->faceCount /*+0x18*/; i++) {
    face = o->faces /*+0x10*/ + i*0x35;
    if ((double)face->f14 < 0.5)          // f32 at face+0x14 vs double 0.5 @0x503b3; `jae skip`
        *(u32*)(face + 0x31) = [0x594c8]; // swap texture to immor2.gif
}
[0x594d0] = o2 = sub_2d0b8("objct-prs");
o2->flags /*byte +0x1c*/ |= 0x10;
```
Open: meaning of face+0x14 (see questions). CREAT.3DS material IMMOR maps IMMOR1.GIF; this replaces part
of the "Immort" object with IMMOR2.GIF.

### sub_14348 draw_create (per frame)

```
sub_10660([0x593a0]);                    // clear buffer A
sub_14294([0x594d0]);                    // "objct-prs" by hand
for (i = [0x5e0d0] - 1; i >= 0; i--) {
    face = [0x5e0c8][i]; fl = face->flags /*+0x30*/;
    if (fl & 0x02)      sub_24b54(eax=face, edx=0);
    else if (fl & 0x40) sub_27670(eax=face, edx=0);
    // else: not drawn
}
sub_1067c([0x593a0]);                    // flip
```

### sub_14477 run_create (part 1)

```
sub_2d150([0x594bc]);                    // make scene current
sub_1061c([0x594c4]);                    // set saved palette (hard cut, no fade in)
[0x594c0] = DUR = TICKS*20;              // = 2000 (20 s)
for (;;) {
    t = [0x593cc]; if (t >= [0x594c0]) break;
    // x87: (u32 t as int64) * f32[0x5c990] / (u32 DUR as int64) + (u16 [0x5c98c]), stored as f32
    [0x5c994] = (float)( (long double)t * span / DUR + startFrame );
    sub_2f43c(); sub_2c7a8(); sub_14348();
}
[0x593cc] = t - DUR;                     // t = the value that failed the compare

// --- logo ---
sub_10660([0x5937c]);                    // clear visible screen
memset([0x594cc], 0, 0x300); sub_1061c([0x594cc]);          // all black
sub_1f07c("textures\logo.gif", edx=[0x5937c], ebx=0, ecx=0, stack 0);   // decode straight to the screen
D = TICKS;                               // 100: 1 s of black (edi holds TICKS)
while ((t = [0x593cc]) < D) [0x593d0]++; // busy wait
[0x593cc] = t - D;
[0x594c0] = D*2;                         // 200: 2 s fade in
for (;;) {
    t = [0x593cc]; if (t >= [0x594c0]) break;
    for (i = 0; i < 0x300; i++)
        [0x594cc][i] = (u8)( (u32)[0x5c9b0 + i] * [0x593cc] / [0x594c0] );  // u32 mul, unsigned div; timer re-read per entry
    VSYNC; sub_1061c([0x594cc]);
}
[0x593cc] = t - [0x594c0];
VSYNC; sub_1061c(0x5c9b0);               // full logo palette
[0x594c0] = TICKS*5;                     // 500: hold 5 s
for (;;) { t = [0x593cc]; if (t >= [0x594c0]) break; [0x593d0]++; sub_10660([0x593a0]); }
[0x593cc] = t - [0x594c0];
memset([0x594cc], 0x3f, 0x300);          // all white
VSYNC; sub_1061c([0x594cc]);
sub_10660([0x5937c]);                    // clear visible screen (index 0 -> shows white)
```
Notes: the logo fade reads the palette from 0x5c9b0, so the logo.gif load must have written its palette
there (GIF loader, flag ebx=0 - confirm in sub_1f07c/0x1eafc). No text overlays in part 1. Total length
20 + 1 + 2 + 5 = 28 s. The part ends on a full-white palette, which part 2 fades from.

## 4. Part 2 "steal"

### sub_14899 load_steal (loader)

```
sub_1418c("scene - steal");
[0x594d4] = sub_2f1bc("scenes\firsts.3ds", edx=10);
[0x594e0] = malloc(0x300); memcpy([0x594e0], 0x5c9b0, 0x300);
[0x594ec] = malloc(0x300);
sub_1418c("searching cameras");
sub_2d014("Camera02", &p); [0x594f0] = *(u32*)(p + 2);
sub_2d014("Camera03", &p); [0x594f4] = *(u32*)(p + 2);
sub_1418c("searching objects");
[0x594f8] = sub_2d0b8("Room");        obj->flags(+0x1c) |= 0x10;
[0x594fc] = sub_2d0b8("WallsX");      |= 0x10;
[0x59500] = sub_2d0b8("Ceilig,Prs");  |= 0x10;
[0x59504] = sub_2d0b8("Floor");       |= 0x10;
[0x59508] = sub_2d0b8("pyr-cul");     // flag NOT set here (set at the camera-2 cut)
sub_1418c("transparecy table");
[0x594e8] = sub_10734();
sub_10a28(0.15f /*0x3e19999a, 1st stack arg*/, 0.85f /*0x3f59999a*/, table=[0x594e8]);
```
(push order: table, 0.85, 0.15 - so the lowest/first stack arg is 0.15.)

### sub_149ba run_steal (part 2)

```
sub_2d150([0x594d4]);
[0x594d8] = DUR = TICKS*17;              // 1700 (17 s). NOTE: no palette set here.
for (;;) {
    t = [0x593cc]; if (t >= DUR) break;
    [0x5c994] = frame = (float)( (long double)t * span / DUR + startFrame );

    if ([0x53e97]) {                                 // fade in from white, first 1 s
        if ([0x593cc] < TICKS) {
            for (i = 0; i < 0x300; i++)
                [0x594ec][i] = 63 - ( (u32)(63 - [0x594e0][i]) * [0x593cc] / TICKS );   // unsigned, low byte stored
            VSYNC; sub_1061c([0x594ec]);
        } else {
            VSYNC; sub_1061c([0x594e0]); [0x53e97] = 0;
        }
    }
    if ([0x53e95] && frame > 170.0) {                // double const @0x504ec; strictly greater
        [0x53e95] = 0;
        [0x5c988] = [0x594f0];                       // cut to Camera02
        ((obj*)[0x59508])->flags(+0x1c) |= 0x10;     // pyr-cul becomes hand-drawn
    }
    if ([0x53e96] && frame > 340.0) {                // @0x504f4
        [0x53e96] = 0;
        [0x5c988] = [0x594f4];                       // cut to Camera03
    }
    if (![0x53e95] && [0x53e98]) {                   // white flash starting at the Camera02 cut
        if ([0x53e99]) { [0x594dc] = [0x593cc]; [0x53e99] = 0; }
        dt = [0x593cc] - [0x594dc];
        if ([0x594dc] + TICKS > [0x593cc]) {         // unsigned
            for (i = 0; i < 0x300; i++)
                [0x594ec][i] = 63 - ( (u32)(63 - [0x594e0][i]) * dt / TICKS );
            VSYNC; sub_1061c([0x594ec]);
        } else {
            VSYNC; sub_1061c([0x594e0]); [0x53e98] = 0;
        }
    }
    sub_2f43c(); sub_2c7a8(); sub_14730();
}
[0x593cc] = t - DUR;
sub_10660([0x5937c]);                    // clear visible screen
```
The flash at the Camera02 cut starts at full white (dt=0 gives 63) and fades to the scene palette over
1 s. There is NO flash at the Camera03 cut and no fade-out at the end. Part 3 hard-sets its own palette.

### sub_14730 draw_steal (per frame)

```
// buffer A is NOT cleared in this part
sub_1467c([0x594f8]);  /* Room */      sub_1467c([0x594fc]);  /* WallsX */
sub_1467c([0x59500]);  /* Ceilig,Prs */ sub_1467c([0x59504]); /* Floor */
if (frame > 170.0)  sub_1467c([0x59508]);            // pyr-cul; frame = f32 [0x5c994], const double @0x5044f
for (i = [0x5e0d0] - 1; i >= 0; i--) {
    face = [0x5e0c8][i]; fl = face->flags;
    if ((fl & 0x10) || (fl & 0x20)) sub_29510(eax=face, edx=0, ebx=[0x594e8] /*transparency table*/);
    else                             sub_27670(eax=face, edx=0);
}
col = [0x53e94];   // 0x6f
if (frame < 170.0)                    sub_14048([0x593a0], x=20, y=170, "An Energy Source Lies Within the Gem", col);
if (frame > 170.0 && frame < 340.0) { sub_14048([0x593a0], x=20, y=160, "       The Gem Gives Life,", col);
                                      sub_14048([0x593a0], x=20, y=175, "        To Good And Evil", col); }
if (frame > 340.0)                    sub_14048([0x593a0], x=20, y=170, "Uh, Seems Like It Is About To Change.", col);
sub_1067c([0x593a0]);
```
(All comparisons strict; at exactly 170.0 / 340.0 no text. Leading spaces in the strings are literal and
do the centring: 7 spaces, 8 spaces.)

## 5. Part 3 "meeting"

### sub_14fed load_meeting (loader)

```
sub_1418c("scene - meeting");
[0x5950c] = sub_2f1bc("scenes\seconds.3ds", edx=10);
[0x59514] = malloc(0x300); memcpy([0x59514], 0x5c9b0, 0x300);
sub_1418c("searching cameras");
sub_2d014("Camera02", &p); [0x5951c] = *(u32*)(p+2);
sub_2d014("Camera03", &p); [0x59520] = *(u32*)(p+2);
sub_2d014("Camera04", &p); [0x59524] = *(u32*)(p+2);
sub_1418c("searching objects");
[0x59528] = sub_2d0b8("Ceil-prs");    flags(+0x1c) |= 0x10;
[0x5952c] = sub_2d0b8("Floot-prs");   |= 0x10;
[0x59530] = sub_2d0b8("WallsX,prs");  |= 0x10;
[0x59534] = sub_2d0b8("Wallsy,prs");  |= 0x10;
[0x59538] = sub_2d0b8("DoorX,prs");   |= 0x10;
[0x5953c] = sub_2d0b8("cul-spc");     // no flag change
sub_1418c("shade table");
sub_14c30();
sub_1418c("update cone");
o = [0x5953c];
for (i = 0; i < o->vertexCount /*+0x14*/; i++) {
    v = o->vertices /*+0x0c*/ + i*0x40;
    // f32 v+0x34, then double math: (+ -8192.0 @0x50661) / (-256.0 @0x50669), compared with 0.5 @0x50671
    if ( ((double)v->f34 + -8192.0) / -256.0 >= 0.5 )  *(f32*)(v + 0x30) = 50.0f;   // 0x42480000
    else                                                *(f32*)(v + 0x30) = 0.0f;
}
```
i.e. `v->f30 = (v->f34 <= 8064.0) ? 50 : 0` ((8192 - x)/256 >= 0.5). These look like texture
coordinates in 8.8-style units (32 - f34/256), used as shade/table index by sub_2b3c0 - see questions.

### sub_14c30 build_shade_table (no args)

Builds the 64K table at [0x59518] used by sub_2b3c0 (the light cone). Uses the saved part palette
[0x59514]. Only columns 0..63 of each 256-byte row are written.

```
[0x59518] = tbl = sub_10734();
int best_k;                                   // UNINITIALISED stack slot [esp+8], persists across iterations
for (s = 0; s < 64; s++) {
    for (c = 0; c < 256; c++) {
        add = (s < 60) ? (s / 2)              // signed /2, s >= 0
                       : 30 + 11*(s - 60);    // ((s-60)*44)/4 + 30  -> 30, 41, 52, 63
        r = pal[c*3+0] + add; if (r > 63) r = 63;
        g = pal[c*3+1] + add; if (g > 63) g = 63;
        b = pal[c*3+2] + add; if (b > 63) b = 63;
        best = 0xC0;                          // 192
        for (k = 0; k < 256; k++) {
            d = abs(pal[k*3] - r) + abs(pal[k*3+1] - g) + abs(pal[k*3+2] - b);
            if (d < best) { best = d; best_k = k; }      // strict: first minimum wins
        }
        tbl[(c << 8) + s] = (u8)best_k;       // row = source colour, column = brightness step
    }
}
```
The 192 threshold can never fail in practice (max distance is 189), so the stale-value case is theoretical.

### sub_15162 run_meeting (part 3)

```
sub_2d150([0x5950c]);
sub_1061c([0x59514]);                    // hard palette set
// u32 TICKS -> int64 -> fild; * 27.8 (double @0x50679); sub_1f318 (truncate); fistp qword; low dword
[0x59510] = DUR = (u32)trunc(TICKS * 27.8);      // 2780 expected (100*27.8 in x87 extended; if it lands at 2779.99.. it would be 2779)
for (;;) {
    t = [0x593cc]; if (t >= DUR) break;
    [0x5c994] = frame = (float)( (long double)t * span / DUR + startFrame );
    if ([0x53e9d] && frame > 220.0) { [0x53e9d] = 0; [0x5c988] = [0x5951c]; }   // Camera02, @0x50681
    if ([0x53e9e] && frame > 345.0) { [0x53e9e] = 0; [0x5c988] = [0x59520]; }   // Camera03, @0x50689
    if ([0x53e9f] && frame > 500.0) { [0x53e9f] = 0; [0x5c988] = [0x59524]; }   // Camera04, @0x50691
    sub_2f43c(); sub_2c7a8(); sub_14e4f();
}
[0x593cc] = t - DUR;
memset([0x59514], 0x3f, 0x300);          // destroys the saved palette: all white
VSYNC; sub_1061c([0x59514]);
sub_10660([0x5937c]);                    // clear visible screen
```
DUR precision: 27.8 as a double is 27.800000000000000710..., times 100 = 2780.00000000000007, so the
truncation gives 2780.

### sub_14e4f draw_meeting (per frame)

```
if (frame > 370.0) sub_10660([0x593a0]);         // buffer A is only cleared after frame 370 (@0x50574)
sub_14d9c([0x59530]);  /* WallsX,prs */   sub_14d9c([0x59534]);  /* Wallsy,prs */
sub_14d9c([0x59538]);  /* DoorX,prs  */   sub_14d9c([0x5952c]);  /* Floot-prs  */
sub_14d9c([0x59528]);  /* Ceil-prs   */
for (i = [0x5e0d0] - 1; i >= 0; i--) {
    face = [0x5e0c8][i]; fl = face->flags;
    if (fl & 0x10)      sub_2b3c0(eax=face, edx=0, ebx=[0x59518] /*shade table*/);
    else if (fl & 0x02) sub_24b54(eax=face, edx=0);
    else if (fl & 0x40) sub_27670(eax=face, edx=0);
}
col = [0x53e9c];   // 0x6b
if (frame < 219.0)                   sub_14048([0x593a0], 20, 170, " The Gem Is Gone, We Are Doomed!", col);
if (frame > 221.0 && frame < 282.0)  sub_14048([0x593a0], 20, 170, "   We Have Only One Option Left...", col);
if (frame > 283.0 && frame < 345.0)  sub_14048([0x593a0], 20, 170, "           Call Kahn", col);
if (frame > 500.0)                   sub_14048([0x593a0], 20, 170, "     I Will Reclaim Our Power.", 0x29);
sub_1067c([0x593a0]);
```
Double constants: 0x50574=370, 0x5057c=219, 0x50584=221, 0x5058c=282, 0x50594=283, 0x5059c=345,
0x505a4=500. Leading spaces literal (1, 3, 11, 5). Last line uses fixed colour 0x29 (41), not [0x53e9c].

## 6. Wobbler (textured 8x8 grid distortion) helpers

Used by later parts (callers 0x15acc, 0x15c8e, 0x15f4e - not my slice). Grid: 41 columns (i = 0..40,
x = 8*i) by 26 rows (j = 0..25, y = 8*j); element address = base + i*0x68 + j*4.

### sub_152e0 wobbler_triangle(eax=x0, edx=y0, ebx=x1, ecx=y1, stack: x2, y2, u0, v0, u1, v1, u2, v2)

Stack args listed lowest address first (= last pushed first); `ret 0x20`. All truncated to 16 bits.
```
struct { u32 tex; i16 x0,y0,u0,v0; i16 x1,y1,u1,v1; i16 x2,y2,u2,v2; } s;   // 0x1c bytes
s.tex = [0x59540];
sub_12962(eax=&s);
```

### sub_1535e angle_0_2pi(stack: float A /*[esp+0xc], x*/, float B /*[esp+0x10], y*/) -> ST0 float

atan2(B, A) folded into [0, 2pi), result goes through an f32 local:
```
float r;                              // uninitialised if NaN
if (B >= 0) {                         // `fldz; fcomp B; ja other`
    if ((bits(A) & 0x7fffffff) == 0) r = 1.5707964f;          // 0x3fc90fdb
    if (A > 0)  r = (float) atan(B / A);                      // fpatan(B/A, 1)
    if (A < 0)  r = (float)(atan(B / A) + 3.14159265358979 /*double @0x5069c*/);
} else {
    if ((bits(A) & 0x7fffffff) == 0) r = 4.712389f;           // 0x4096cbe4
    if (A < 0)  r = (float)(atan(B / A) + 3.14159265358979);
    if (A > 0)  r = (float)(atan(B / A) + 6.28318530717959 /*double @0x506a4*/);
}
return r;
```
B/A is an f32/f32 divide kept in extended precision.

### sub_1541e wobbler_init (loader, no args)

```
sub_1418c("wobbler init");
for (i = 0; i <= 40; i++)
    for (j = 0; j <= 25; j++) {
        double dy = 12.5 - j;                 // @0x506b9, stored as double
        int    dx = 20 - i;
        dist [i][j] /*f32 0x5a5ec + i*0x68 + j*4*/ = (float)( sqrt(dy*dy + (double)(dx*dx) + 1.0) * 8.17 /*@0x506c1*/ );
        angle[i][j] /*f32 0x5b694 + i*0x68 + j*4*/ = sub_1535e(A=(float)dx, B=(float)dy);
    }
```

### sub_154d4 wobbler_draw(eax=texture pointer)

Draws the whole 320x200 screen as 40x25 cells, two triangles each, with texture coordinates from the
grid at 0x59544 (U = i16 at 0x59544 + i*0x68 + j*4, V = i16 at +2). Destination buffer is whatever
sub_12962 targets.
```
[0x59540] = texture;
for (i = 0, x = 0; x < 320; x += 8, i++)
    for (j = 0, y = 0; y < 200; y += 8, j++) {
        X2 = (i16)(x + 7); Y2 = (i16)(y + 7);
        // triangle 1: top-left, top-right, bottom-right
        sub_152e0(x, y,  X2, y,   X2, Y2,
                  U[i][j],   V[i][j],   U[i+1][j],   V[i+1][j],   U[i+1][j+1], V[i+1][j+1]);
        // triangle 2: top-left, bottom-left, bottom-right
        sub_152e0(x, y,  x,  Y2,  X2, Y2,
                  U[i][j],   V[i][j],   U[i][j+1],   V[i][j+1],   U[i+1][j+1], V[i+1][j+1]);
    }
```
Note the corner coordinates are x..x+7 / y..y+7 (not +8) while the UVs are those of the neighbouring grid
nodes; whether sub_12962 treats the far edge as inclusive decides if there are seams.

### Grid generators (each fills U,V for i = 0..40, j = 0..25; no args)

Common: T = f32 [0x5c73c], T2 = f32 [0x5c740]; all trig in x87 (double/extended), final values
truncated toward zero (sub_1f318 + fistp dword) and stored as the low 16 bits.

#### sub_15637 wobbler_grid_A (caller 0x15acc)
```
float sT = (float)sin(T);
for i, j:
    float a  = (float)( cos(3.5*T)*42.0 + 128.0 - i*6.4 );      // consts @0x506c9=3.5, 0x506d1=42, 0x506d9=128, 0x506e1=6.4
    float b  = (float)( sin(3.5*T)*42.0 + 128.0 - j*10.24 );    // @0x506e9=10.24
    float d  = (float)sqrt(a*a + b*b + 1.0);
    float an = sT - angle[i][j];                                 // f32 subtract, 0x5b694 table
    U[i][j] = (i16)trunc( sin(T*0.5)*128.0*5.0 + cos(an)*d );    // @0x506f1=0.5, 0x506f9=5
    V[i][j] = (i16)trunc( cos(T*0.5)*128.0*5.0 + sin(an)*d );
```
(dist table not used by this variant.)

#### sub_157b0 wobbler_grid_B (caller 0x15c8e; funclist says 2 call sites)
```
float sT = (float)sin(T);
float k  = (float)( sin(T2) * 80.0 );                            // @0x50701
for i, j:
    double A  = (double)k * sin(1.5*T);                          // @0x50709=1.5
    double fx = (float)(i*8) / 50.0f;                            // f32 const @0x50721
    double fy = (float)(j*8) / 50.0f;
    U[i][j] = (i16)trunc( (cos(2.5*T)*A*2.34 + i*8) + (sin(fx) + sin(fy)) * (cos(1.5*T)*65.0) );   // @0x50711=2.5, 0x50719=2.34, 0x50725=65
    V[i][j] = (i16)trunc( (sin(2.5*T)*A*2.34 + j*8) + (cos(fy) + cos(fx)) * (sT * 35.0f) );         // f32 35 @0x5072d
```

#### sub_1592b wobbler_grid_C (caller 0x15f4e)
```
float sT = (float)sin(T);
for i, j:
    double ds = dist[i][j];                                      // f32 0x5a5ec table
    float d  = (float)( (cos(ds*0.01 + T) + 1.3) * ds * 3.0      // @0x50731=0.01, 0x50739=1.3, 0x50741=3
                      + cos(ds*0.07 + T) * 82.0 * sin(T2 + 3.14159265358979) );   // @0x50749=0.07, 0x50751=82, 0x50759=pi
    float an = sT - angle[i][j];
    U[i][j] = (i16)trunc( sin(T*0.6)*128.0*5.0 + cos(an)*d );    // @0x50761=0.6, 0x50769=128, 0x50771=5
    V[i][j] = (i16)trunc( cos(T*0.6)*128.0*5.0 + sin(an)*d );
```

## 7. Data referenced

Strings (exact, including leading spaces):
```
5033c "textures\loading.gif"   50351 "loader initialized"
50364 "scene - create"         50373 "scenes\creat.3ds"     50384 "xtra flat"
5038e "textures\immor2.gif"    503a2 "Immort"               503a9 "objct-prs"   503bb "textures\logo.gif"
503d0 "An Energy Source Lies Within the Gem"
503f5 "       The Gem Gives Life,"
50410 "        To Good And Evil"
50429 "Uh, Seems Like It Is About To Change."
5045f "scene - steal"  5046d "scenes\firsts.3ds"  5047f "searching cameras"  50491 "Camera02"  5049a "Camera03"
504a3 "searching objects"  504b5 "Room"  504ba "WallsX"  504c1 "Ceilig,Prs"  504cc "Floor"  504d2 "pyr-cul"
504da "transparecy table"
504fc " The Gem Is Gone, We Are Doomed!"
5051d "   We Have Only One Option Left..."
50540 "           Call Kahn"
50555 "     I Will Reclaim Our Power."
505ac "scene - meeting"  505bc "scenes\seconds.3ds"  505cf "searching cameras"
505e1 "Camera02"  505ea "Camera03"  505f3 "Camera04"  505fc "searching objects"
5060e "Ceil-prs"  50617 "Floot-prs"  50621 "WallsX,prs"  5062c "Wallsy,prs"  50637 "DoorX,prs"  50641 "cul-spc"
50649 "shade table"  50655 "update cone"  506ac "wobbler init"
```
Float/double constants: all listed inline next to their use. No other lookup tables are read from the
initialised data in this slice (the tables used are built at load time: 0x594e8, 0x59518, 0x5a5ec, 0x5b694).

## 8. Timeline summary (ticks = 1/100 s, relative to the start of each part)

| part | duration | frame formula | events |
|---|---|---|---|
| 1 create | 2000 | start + t*span/2000 (CREAT 0..570) | hard palette set; no text; then logo: 100 black, 200 fade in, 500 hold, white palette |
| 2 steal | 1700 | start + t*span/1700 (FIRSTS 0..500) | 0..100 fade from white; frame>170 Camera02 + pyr-cul + 100-tick white flash; frame>340 Camera03; texts at <170, 170..340, >340 |
| 3 meeting | 2780 | start + t*span/2780 (SECONDS 0..580) | hard palette; frame>220 Camera02; >345 Camera03; >500 Camera04; clear buffer only when frame>370; texts <219, 221..282, 283..345, >500; ends on white palette |

ESC adds 0x01000000 to t, which makes every `t < DUR` test fail; since each part subtracts only its own
DUR, the remainder stays huge and all following waits/parts fall through too.
