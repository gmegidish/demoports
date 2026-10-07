# A. Init, helpers, picture loader, and part 1 (the intro)

Slice: `main` 0x100fe, 0x102c0..0x10fb8 (video, memory, colour tables, MIDAS glue, keyboard),
0x10fb8 / 0x11079 (palette fades), 0x110fb (intro loader), part 1 0x1128f, the helpers
0x11780 / 0x11909 / 0x11a3c / 0x11ac1, 0x176c4.., and the picture loader 0x1936c / 0x18980 / 0x18e54.

Conventions: `trunc()` means the helper **0x199b2 followed by `fistp`**. 0x199b2 saves the FPU
control word, sets its high byte to 0x1f (precision 64 bit, **rounding = toward zero**), does
`frndint` and restores the control word. So 0x199b2+fistp is a C cast to int (truncation toward
zero), the same as Kahn's 0x1f318. Every float-to-int conversion in this slice goes through it.

"DAC write" = 0x1866c `set_dac(eax=index, dl=r, bl=g, cl=b)`: `out 0x3c8,index; out 0x3c9,r; g; b`
(SAME as Kahn 0x1e2d0). The VGA DAC (and DOSBox) keeps only the **low 6 bits** of each value, so a
port must write `value & 63`. This matters: two places below compute 64 (or more) for one frame.

---------------------------------------------------------------------------------------------------
## 1. main (0x100fe): order confirmed

```
int10h(ax=3)                                   // text mode
cout << banner strings ...                     // 0x10338 = ostream << const char*, cout object at 0x583d8
aligned_alloc_init()                           // 0x10750
vesa_init()                                    // 0x103d0
midas_init()                                   // 0x10c28   ("Kicking MIDAS - Hmm, It Looks Alive")
music_load("bicstl.xm")                        // 0x10cd0   (also installs the 100 Hz callback 0x10c00)
keyboard_install()                             // 0x10f40
ebx = 8                                        // 0x101d5: "Hack IDS, load data be4 entering mode, Bpp=1"
[0x58434] = 1                                  // bytes per pixel, needed by the loaders (cl=1)
0x110fb(); 0x11909(); 0x12b34(); 0x134da(); 0x1220a(); 0x130bf(); 0x138b4();   // loaders
set_mode(eax=320, edx=200, ebx=8)              // 0x104b0
raster_setup(eax=[0x58424]=320, edx=[0x58428]=200, ebx=[0x58440], ecx=0)        // 0x176c4
music_play()                                   // 0x10d84 (zeroes both tick counters)
0x1128f(); 0x12cc2(); 0x13559(); 0x122b0(); 0x13933(); 0x130f7();              // the six parts
music_stop() 0x10dd0; keyboard_remove() 0x10f88; music_free() 0x10d3c; midas_close() 0x10ca4;
video_close() 0x1041c; cout << "\nThe End!" << 3 more lines
```
**Correction to the brief:** the third argument of 0x104b0 is **EBX = 8** (bits per pixel; set at
0x101d5 and preserved by every intervening call, all of which push/pop ebx), not 0. The `xor ecx,ecx`
before it is for 0x176c4's fourth argument (blend table pointer = 0).

---------------------------------------------------------------------------------------------------
## 2. Small runtime/helpers (0x102c0..0x10c28)

| addr | name | notes |
|---|---|---|
| 0x102c0 | iostream static init | SAME Kahn 0x10278. Not port relevant |
| 0x1031e, 0x10326 | ios unitbuf / flush helpers | SAME Kahn 0x102d6 / 0x102de |
| 0x10338 | `ostream& operator<<(eax=ostream*, edx=const char*)` | SAME Kahn 0x102f0. Text-mode banner only |
| 0x103d0 | `vesa_init()` | SAME Kahn 0x10380. `[0x58418] = vbe_info = 0x18054()`; `[0x58420] = (vbe_info == 0) \| (vbe_info->version(u16 @+4) < 0x200)` = "VESA unusable" flag |
| 0x1041c | `video_close()` | `0x184d2([0x58414])` (if a VESA mode is mapped: DPMI 0x801 unmap LFB, int10h ax=3), then int10h ax=3, `[0x5dbe8] = 0` (graphics-on flag used by fatal error 0x185b0) |
| 0x1067c | `set_palette(eax = u8[768])` | SAME Kahn 0x1061c. out 0x3c8 ← 0, then 768 bytes to 0x3c9 (6-bit values, r,g,b) |
| 0x106c0 | `clear(eax = buf)` | SAME Kahn 0x10660. `rep stosd` of 0 over `[0x5843c]` dwords (16000) |
| 0x106dc | `flip(eax = buf)` | SAME Kahn 0x1067c. Copy `[0x5843c]` dwords to `[0x5841c]` (screen) |

### 0x104b0 `set_mode(eax = width, edx = height, ebx = bits)` (Kahn 0x10458, similarity 0.99)
```
if (w == [0x58424] && h == [0x58428] && (bits >> 3) == [0x58434]) return;   // nothing to do
if ([0x58414]) 0x184d2([0x58414]);                    // drop previous VESA mode
[0x58414] = 0x1831b(w, h, bits);                      // VESA set mode (SAME Kahn 0x1dfdb); returns mode object or 0
[0x58420] |= ([0x58414] == 0);
if ([0x58420]) { w = 320; h = 200; bits = 8; [0x5841c] = 0xA0000; int10h(ax=0x13); }
else             [0x5841c] = [0x58414]->lfb (dword @+0x14);
[0x58428] = h;  [0x58424] = w;  [0x58434] = bits >> 3;
[0x5842c] = (float)(w * 0.5 + -0.5);  [0x58430] = (float)(h * 0.5 + -0.5);     // doubles 0.5 / -0.5 at 0x50260/0x50268
[0x58438] = w*h*(bits>>3);  [0x5843c] = [0x58438] >> 2;
free([0x58448]); [0x58448] = malloc(h*4); for y < h: rowtab[y] = y * w;
free([0x58440]); [0x58440] = malloc([0x58438]);       // work buffer A
free([0x58444]); [0x58444] = malloc([0x58438]);       // work buffer B
[0x5dbe8] = 1;
```
Consequence for the port: buffers A/B (0x58440/0x58444) and the row table **do not exist during the
loaders**; they are allocated here, after all seven loaders ran. Their initial contents are whatever
malloc returns (UNSURE: DOS/4GW fresh memory is normally zero; part 1 clears A before using it, so
it does not matter here). Result for the demo: 320x200, 1 byte per pixel, size 64000, centre
(159.5, 99.5).

### 0x10750 `aligned_alloc_init()` / 0x10794 `aligned_block()` (SAME Kahn 0x106f0 / 0x10734)
```
0x10750: [0x5844c] = malloc(0x470000) or fatal("Not enough memory for Aligned Buffer.");
         [0x58454] (u8 count) = 0;  [0x58450] = (([0x5844c] >> 16) + 1) << 16;
0x10794: if (++[0x58454] > 70) fatal("Aligned Buffer too small.");
         r = [0x58450]; [0x58450] += 0x10000; return r;        // a fresh 64 KB block, 64K aligned
```
Blocks are never freed and not cleared. Pictures (320x200 = 64000 bytes, or 256x256 = 65536) and
64K colour tables live in them. Callers: all loaders and the 3DS texture loader 0x2bcd4.

---------------------------------------------------------------------------------------------------
## 3. Colour tables: 0x107d0, 0x10908 (and dead code next to them)

### 0x107d0 `nearest_colour(al = r, dl = g, bl = b, ecx = u8* palette) -> al`
```
best_d = 0xC0; best = <uninitialised>;
for k in 0..255:                                   // palette stride 3
    d = |pal[3k]-r| + |pal[3k+1]-g| + |pal[3k+2]-b|;  // 32-bit ints, not masked
    if (d < best_d) { best_d = d; best = k; }       // strict: first of equals wins
return (u8)best;
```
Identical in result to Kahn's inline search (`nearestColour` in Kahn `src/tables.js`: the Kahn
version masks the distance with 0xff, irrelevant since d <= 189 < 192, so a match is always found).

### 0x10908 `build_additive_table(eax = u8 table[65536])` (Kahn 0x10770, `buildAdditiveTable`)
```
pal = [0x5dbf0];                                   // !!! the GIF loader's palette buffer, see §6
for i in 0..255: for j in i..255:
    r = min((u8)(pal[3i]   + pal[3j]),   63);      // byte add; no wrap possible with 6-bit values
    g = min((u8)(pal[3i+1] + pal[3j+1]), 63);
    b = min((u8)(pal[3i+2] + pal[3j+2]), 63);
    c = nearest_colour(r, g, b, pal);
    table[(i<<8) + j] = c;  table[(j<<8) + i] = c;
```
Same algorithm and output as Kahn's 0x10770 / `buildAdditiveTable(palette)`, the only difference
being that the palette comes from the pointer [0x5dbf0] instead of a fixed global. [0x5dbf0] holds
the palette (6-bit) of the **most recently loaded picture** (§6). Callers and therefore palettes:
`0x12b34` → after `sflare.gif`; `0x134da` → after `flare2.gif`; `0x138b4` → after `flare3.gif`
(each loads that GIF into a 64K block, takes another 64K block for the table, calls 0x10908).
So a port: `buildAdditiveTable(paletteOf("SFLARE.GIF"))` etc.

Dead code (not disassembled by kdis because nothing references it; read with raw capstone):
- 0x10870 `nearest_colour_n(al,dl,bl,ecx=pal, stack: u8 n)` = 0x107d0 restricted to the first n entries (`ret 4`).
- 0x109e0 average table (Kahn 0x108e4): `(a+b) >> 1` per channel, palette [0x5dbf0].
- 0x10ad8 weighted table (Kahn 0x10a28): two float stack args, channel = trunc(fild(word)·w) via 0x199b2, `ret 0xc`.
- 0x11863 standalone copy of the angle function inlined in 0x11909 (§9).
None of them is called; the port can ignore them.

---------------------------------------------------------------------------------------------------
## 4. MIDAS glue, timer, keyboard, play status

| addr | what | detail |
|---|---|---|
| 0x10c28 | `midas_init()` (Kahn 0x10bf8) | MIDAS startup 0x199d0(0x537ea, 0); 0x19a2c(); if (0x19ac8()==0 && 0x1b25c()==0) { config 0x199f0(); fatal(ret ? "Configuration failed." : "User Exit.") }; **`[0x58474] = 100`** (ticks per second, used by the parts); MIDASinit 0x19ae4() or fatal "Initialization failed."; `[0x5dbe5]=1`; **music volume `[0x58468] = 0x20`** |
| 0x10ca4 | `midas_close()` | `[0x5dbe5]=0`; 0x19c88() or fatal "Could not close Midas." |
| 0x10cd0 | `music_load(eax=name)` | `[0x58478] = MIDASloadModule(name)` (0x19f4c) or fatal "Could not load module"; module info 0x1a66c(module, 0x5847c); `MIDASsetTimerCallbacks(100000 /* mHz = 100 Hz */, FALSE, 0x10c00, NULL, NULL)` (0x19dfc) or fatal "Could not initialize timer."; `[0x5dbe6]=1` |
| 0x10c00 | timer callback, 100 Hz | `[0x58470]++; [0x5846c]++;` |
| 0x10d3c | `music_free()` | `[0x5dbe6]=0`; free module 0x1a2f8; remove timer 0x19e38 |
| 0x10d84 | `music_play()` (Kahn 0x10d34) | MIDASplayModule(module, 0) (0x1a044) or fatal "Could not play module."; `set_volume()` 0x10e04; `[0x5846c] = [0x58470] = 0`; `[0x5dbe7]=1` |
| 0x10dd0 | `music_stop()` | `[0x5dbe7]=0`; 0x1a1e8(module) or fatal "Could not stop module." |
| 0x10e04 | `set_volume()` | `[0x5de2c]->vtbl[+0x58]((u8)[0x58468])` (sound device master volume) |
| 0x10e50 | `play_status()` (Kahn 0x10da4) | MIDASgetPlayStatus(0x58458) (0x1a5ac) or fatal "Could not get playback status."; then **`[0x584ac]=position (order index)`, `[0x584b0]=pattern`, `[0x584b4]=row`, `[0x584b8]=sync info`** |
| 0x10ea0 | keyboard ISR (IRQ1), lives in the gap after 0x10e50 | see below |
| 0x10f40 / 0x10f88 | install / restore int 9 | old vector saved in 0x58540 (offset) / 0x58544 (selector); `[0x5dbe4]` = installed flag |

Keyboard ISR 0x10ea0:
```
sc = inb(0x60); [0x5853c] = sc;
if (sc < 0x80) keys[sc] = 1; else keys[sc - 0x80] = 0;        // keys = 0x584bc
outb(0x20, 0x20);
if (keys[0x4e] /* keypad + */ && vol < 63) { vol++; set_volume(); }   // vol = u8 [0x58468]
if (keys[0x4a] /* keypad - */ && vol > 0)  { vol--; set_volume(); }
if (keys[0x01] /* ESC */) (u8)[0x5846f]++;                     // [0x5846c] += 0x01000000
```
Note: the volume/ESC tests run on **every** keyboard interrupt while the key is held (typematic repeats
included), not once per press. ESC touches only counter 0x5846c (not 0x58470).

Music facts used below (from BICSTL.XM): speed 2, BPM 100, **no Fxx/Bxx/Dxx effects in the whole song**,
so one row = 2 × 2.5/100 s = **50 ms**, a 128-row pattern = 6.4 s. Orders 0..6 play patterns
2, 3, 1, 1, 4, 5, 0 (all 128 rows), so position p starts at p × 6.4 s for p <= 7.

---------------------------------------------------------------------------------------------------
## 5. Palette fades 0x10fb8 and 0x11079

### 0x10fb8 `dac_whiten(stack: float32 t, stack: u8* pal)`, `ret 8`
Arguments: `[esp+4]` = t (float32, first argument), `[esp+8]` = palette pointer. Used by all six parts.
```
for i in 0..255:
    b = trunc((float)(64 - pal[3i+2]) * t + pal[3i+2]) & 0xff;    // (64-p) loaded as int32 (fild dword),
    g = trunc((float)(64 - pal[3i+1]) * t + pal[3i+1]) & 0xff;    // times float32 t in x87 extended
    r = trunc((float)(64 - pal[3i  ]) * t + pal[3i  ]) & 0xff;    // precision, + p (fild word), truncate
    set_dac(i, r, g, b);                                          // order of out: index, r, g, b
```
t = 0 gives the palette, t → 1 approaches **64**, not 63: at exactly t = 1.0 every channel is 64,
which the DAC stores as 64 & 63 = **0 (black)**. For t < 1 the result is at most 63.

### 0x11079 `dac_scale(stack: float32 t, stack: u8* pal)`, `ret 8` (shares 0x10fb8's epilogue)
```
for i in 0..255: set_dac(i, trunc(pal[3i]*t) & 0xff, trunc(pal[3i+1]*t) & 0xff, trunc(pal[3i+2]*t) & 0xff);
```
(computed in the order b, g, r like above; p via fild word, times float32 t.) Only caller: 0x130f7.

---------------------------------------------------------------------------------------------------
## 6. The picture loader: 0x1936c / 0x18980 / 0x18e54 (Kahn 0x1f114 / 0x1e5e4 / 0x1eafc)

Globals: `[0x5dbf0]` = pointer to a 768-byte palette buffer (allocated once at startup by the static
initialiser 0x18650: `malloc(0x300)`; never reallocated); `[0x5dbf4]` = pointer to the decoded index
buffer (malloc'd per picture, freed at the end of 0x1936c); `[0x5dbf8]` = FILE*.

### 0x1936c `load_picture(eax = name, edx = u8* dest, ebx = u8** palette_out, cl = bytes_per_pixel)` → void
```
if (!load_gif(name, &w, &h) && !load_pcx(name, &w, &h))
    fatal("PIX global error, file : " + name);          // strcat into the static message, 0x185b0
n = w * h;
switch (cl) {                                            // jump table 0x1935c
 case 1: memcpy(dest, [0x5dbf4], n); break;              // the only case used (all callers pass 1)
 case 2: for i<n: p = &pal[idx[i]*3]; ((u16*)dest)[i] = ((p[0]>>1)<<11) + (p[1]<<5) + (p[2]>>1); break;
 case 3: for i<n: dest[3i] = p[2]<<2; dest[3i+1] = p[1]<<2; dest[3i+2] = p[0]<<2; break;
 case 4: for i<n: dest[4i] = p[2]<<2; [+1] = p[1]<<2; [+2] = p[0]<<2; [+3] = 0; break;
}                                                        // pal = [0x5dbf0], idx = [0x5dbf4]
*palette_out = malloc(768); memcpy(*palette_out, [0x5dbf0], 768);   // 6-bit copy; no NULL check
free([0x5dbf4]); [0x5dbf4] = 0;
```
Differences from Kahn:
- **Signature.** Kahn's `load_texture(name, dest, bl=set_dac, cl=bpp)`; Brother's third argument is an
  output pointer that receives a freshly malloc'd **copy of the palette** (6-bit values). No option to
  program the DAC: the Brother loader never touches the DAC.
- The pixels are copied verbatim: `w*h` bytes, row after row, **no offset, no clipping, no padding,
  no size check**. A 320x200 picture fills the first 64000 bytes of its 64K block (rows of 320); a
  256x256 picture fills all 65536 bytes (texel = `block[v<<8 | u]`). The loader does not care which.
- **Side effect kept from Kahn:** the global palette buffer `[0x5dbf0]` is overwritten with the last
  picture's palette and stays valid after the call. 0x10908 (§3) depends on this.

### 0x18980 `load_gif(eax = name, edx = int* w_out, ebx = int* h_out)` → 1 ok / 0 not a GIF
```
f = fopen(name, "rb") or fatal("Unable to load file : " + name);       // 0x18690
fread(hdr, 1, 6, f);  if (strncmp(hdr, "GIF", 3)) { fclose(f); return 0; }
fread(lsd, 1, 7, f);
memset([0x5dbf0], 0, 0x300);
for i < 3 * (2 << (lsd[4] & 7)): pal[i] = getc(f) >> 2;               // global table assumed present
fread(tmp, 1, 5, f);                  // 0x2C + left + top, unchecked (no extension blocks allowed here)
w = getc | getc<<8; if (w_out) *w_out = w;      // 0x186f8
h = getc | getc<<8; if (h_out) *h_out = h;
[0x5dbf4] = malloc(w*h) or { fclose; fatal("not enough mem to internaly load : " + name); }
fread(tmp, 1, 1, f);                  // image flags ignored: no local table, no interlace support
mcs = getc(f); if (mcs < 2 || mcs > 9) { fclose; fatal("PIX internal error, file : " + name); }
[0x5dd28] = malloc(0x1001) /*stack*/; [0x5dd2c] = malloc(0x1001) /*suffix*/; [0x5dd30] = malloc(0x2002) /*prefix u16*/;
LZW decode into [0x5dbf4], sequentially, until the end code  (identical to Kahn's, H_loader.md §4)
free the three tables; fclose(f); return 1;
```
The LZW loop is instruction-for-instruction Kahn's (clear handling, `c >= free → c = 0` after a
clear, KwKwK, table growth only while `free < max`, code size up to 12; bit reader 0x1871c SAME as
Kahn 0x1e380; state globals 0x5dbfc size, 0x5dc0c max, 0x5dc00 clear, 0x5dc04 end, 0x5dc08 first,
0x5dc10 free). Differences: decodes into its own malloc'd w*h buffer (Kahn wrote to the caller's
dest; Kahn's dest==NULL "header only" path does not exist), tables are malloc'd per call, palette
goes through the pointer [0x5dbf0], no DAC programming, **no output bound** (a corrupt file would
overrun; the shipped files do not).

### 0x18e54 `load_pcx(eax = name, edx = int* w_out, ebx = int* h_out)` → 1 ok / 0 not a PCX
Same decoder as Kahn's 0x1eafc (H_loader.md §4), with these differences: a header that is not
`0a 05 01 (08 | planes==1)` closes the file and **returns 0** (Kahn: fatal); output goes into a
malloc'd w*h buffer `[0x5dbf4]`; never programs the DAC. 1-bpp/4-plane and 8-bpp/1-plane as in Kahn.
**Not used by the shipped data**: all 26 resource GIFs start with "GIF".

### What the data actually needs
All 26 pictures (checked with Pillow): GIF87a or GIF89a, global colour table of 256 (flags 0xd7/0xf7),
image separator 0x2C **immediately** after the global table (no extension blocks, so the 89a files
work with this decoder), image flags 0 (no local table, not interlaced), LZW minimum code size 8.
320x200: BROTHER, DARK, KOMBAT, LOGO, MORE, RAGE, THOR, TXT1. Everything else 256x256.
So Kahn's `src/gif.js` `decodeGif()` works unchanged; the port's equivalent of 0x1936c is:
`{pixels, palette} = decodeGif(bytes); block.set(pixels); paletteOut = palette.map(v => v >> 2); lastPalette = paletteOut;`

---------------------------------------------------------------------------------------------------
## 7. 0x110fb `load_intro()` — part 1's loader

```
[0x5854c] = aligned_block(); load_picture("logo.gif",   [0x5854c], &[0x58550], 1);   // 320x200
[0x58548] = malloc(0x300);                     // immediately overwritten below (leaked)
[0x58554] = aligned_block(); load_picture("kombat.gif", [0x58554], &[0x58548], 1);
[0x58558] = aligned_block(); load_picture("thor.gif",   [0x58558], &[0x58548], 1);
[0x5855c] = aligned_block(); load_picture("rage.gif",   [0x5855c], &[0x58548], 1);
[0x58560] = aligned_block(); load_picture("dark.gif",   [0x58560], &[0x58548], 1);
[0x58564] = aligned_block(); load_picture("more.gif",   [0x58564], &[0x58548], 1);
[0x58568] = aligned_block(); load_picture("txt1.gif",   [0x58568], &[0x58548], 1);
for i in 0..255: [0x58548][3i] = [0x58548][3i+1] = [0x58548][3i+2] = i >> 2;     // grey ramp
```
Result: `0x58550` = LOGO.GIF's palette (>>2). `0x58548` = **grey ramp** `(i>>2, i>>2, i>>2)` (the six
credit pictures' own palettes are discarded). `0x58554..0x58568` = an array of 6 picture pointers
(index 0 kombat, 1 thor, 2 rage, 3 dark, 4 more, 5 txt1). All six credit pictures are drawn with the
grey ramp, i.e. their pixel index is a brightness (verified against the capture, §10).

---------------------------------------------------------------------------------------------------
## 8. Part 1: 0x1128f `part_intro()` (0:00 – 0:38.4)

Locals: `flag` = 1 (palette-not-yet-set, phase B), `fade` (float32) = 1.0. Globals used:
`[0x58574]` u8 counter (initial 0 in the data image), `[0x58570]` previous row, `[0x5856c]` float.
Tick counter: `[0x5846c]` (100 Hz) in phase B only. Everything else is synchronised to the music
position/row returned by `play_status()`. All loops are **busy loops** (no vsync wait): they spin on
`play_status()` as fast as the CPU allows.

```
[0x584b4] = 0;  [0x584ac] = 0;                  // pretend row 0 / position 0
set_palette([0x58548]);                         // grey ramp

// ---- Phase A: lines (positions 0 and 1) -------------------------------------------------------
while ([0x584ac] <= 1) {                        // unsigned
    [0x58570] = [0x584b4];  play_status();
    if ([0x584b4] != [0x58570] && ([0x584b4] == 0x40 || [0x584b4] == 0)) {     // row changed to 0 or 64
        clear(A);                               // A = [0x58440]
        switch ([0x58574]) {
         case 0: for y in 0..199: memset(A + y*320 + 20, 0xff, 4);    // vertical bar x = 20..23
                 for y in 0..199: memset(A + y*320 + 31, 0xff, 4);    // vertical bar x = 31..34
                 break;
         case 1: for y in 110..113: memset(A + rowtab[y], 0xff, 320); break;   // horizontal bar
         case 2: for y in 20..23:   memset(A + rowtab[y], 0xff, 320);          // two horizontal bars
                 for y in 112..115: memset(A + rowtab[y], 0xff, 320); break;
         default: break;                        // counter >= 3: blank
        }
        flip(A);  fade = 1.0f;  [0x58574]++;
    }
    fade = (float)(fade * 0.999995);            // double constant 0x503f9; result stored as float32
    v = trunc(fade_extended * 63.0f) & 0xff;    // float32 63 at 0x50401; the product uses the
    set_dac(255, v, v, v);                      // not-yet-rounded x87 value (fst keeps st0)
}
```
The bars use colour 255, whose DAC entry is overwritten every loop iteration with `trunc(63*fade)`
grey. The fade is **per loop iteration, not per time**: the very first iteration already gives 62.
In the capture the decay is exponential with rate **0.95 per second** (fitted on the three bars:
0.954, 0.949, 0.944 /s), i.e. about **190,000 iterations per second** in that DOSBox run. A port
should use `fade = exp(-0.95 * secondsSinceTrigger)` (or `0.999995 ** (190000 * dt)`) and set
`DAC[255] = trunc(63 * fade)`. Rows sequence (each trigger restarts the fade at 1.0):

| trigger | music | time | screen |
|---|---|---|---|
| none | pos 0 rows 0..63 | 0.0 – 3.2 s | black (screen untouched; the first status returns row 0, no change) |
| counter 0 | pos 0 row 64 | 3.2 s | two vertical bars, x 20..23 and 31..34, full height, fading |
| counter 1 | pos 1 row 0 | 6.4 s | horizontal bar rows 110..113, fading |
| counter 2 | pos 1 row 64 | 9.6 s | horizontal bars rows 20..23 and 112..115, fading |
| counter 3 | pos 2 row 0 | 12.8 s | blank buffer flipped; then the `while` test fails and phase B starts in the same instant |

```
// ---- Phase B: logo, white flash (position 2 row 0 .. position 3 row 64) -----------------------
for i in 0..255: set_dac(i, i>>2, i>>2, i>>2);          // grey ramp again (inline, same as 0x58548)
memcpy(screen, [0x5854c], 64000);                         // LOGO.GIF straight to video memory
[0x5856c] = (float)(int64)([0x58474] * 5);                // 500.0f; never read again (dead store)
[0x5846c] = 0;
while (!([0x584b4] == 0x40 && [0x584ac] == 3)) {          // test BEFORE the status call
    play_status();
    if ([0x5846c] > [0x58474] /*100*/ && flag) {          // unsigned
        set_palette([0x58550]); flag = 0; continue;       // exact logo palette once, at tick 101
    }
    if ([0x5846c] < 100)
        dac_whiten((float)(1.0 - [0x5846c] * 0.01), [0x58550]);   // 0x10fb8; tick as int64→double
}                                                          // tick == 100: nothing that iteration
```
So the logo appears white and fades to its own colours in 1 second (t = 1 - tick/100, 100 Hz
ticks), then stays until pos 3 row 64. At tick 0, t = 1.0 → all channels 64 → black for ≤10 ms
(see §5); harmless, but a port that clamps instead of masking would show white there instead.

```
// ---- Phase C: logo fade out (position 3 row 64 .. position 4 row 0) ----------------------------
while ([0x584b4] != 0) {
    play_status();
    t = (float)((128 - [0x584b4]) * 0.015625);            // double 1/64 at 0x50405, stored float32
    for i: set_dac(i, trunc(pal[3i]*t), trunc(pal[3i+1]*t), trunc(pal[3i+2]*t));   // pal = [0x58550]; inline 0x11079
}
```
t goes 64/64 at row 64 down to 1/64 at row 127; at row 127 every channel truncates to 0 (black).
On the final pass status already returns row 0 of pos 4, so t = 2.0 is written once (values up to
126, masked to 6 bits) just before the screen is cleared on the next line: a sub-millisecond glitch
the port can skip.

```
// ---- Phase D: credits (position 4 row 0 .. position 5 row 0x21) --------------------------------
clear(screen);                     // 0x106c0 on [0x5841c] (video memory directly)
set_palette([0x58548]);            // grey ramp
while ([0x584b4] != 0x0f) play_status();               // wait for row 15
[0x58574] = 0;
while ([0x584ac] == 4 || ([0x584ac] == 5 && [0x584b4] <= 0x21)) {
    play_status();
    if ([0x584b4] & 0x1f) continue;
    memcpy(screen, pictures[[0x58574]], 64000);         // pictures = 0x58554[] (kombat, thor, ...)
    [0x58574]++;
    while (([0x584b4] & 0x1f) == 0) play_status();      // leave the trigger row
}
```
Pictures shown: KOMBAT at pos 4 row 32, THOR at row 64, RAGE at row 96, DARK at pos 5 row 0,
MORE at pos 5 row 32. The loop ends at pos 5 row 34. Each replaces the whole screen (not cleared
between).

```
// ---- Phase E: "Brother I can see the LIGHT" (position 5 row 64 .. position 6 row 0) -------------
while ([0x584b4] != 0x40) play_status();
clear(screen);
while ([0x584b4] < 0x5c) play_status();  memcpy(screen,          txt1,          0x2bc0);   // rows   0..34
while ([0x584b4] < 0x64) play_status();  memcpy(screen + 0x2bc0, txt1 + 0x2bc0, 0x2bc0);   // rows  35..69
while ([0x584b4] < 0x6c) play_status();  memcpy(screen + 0x5780, txt1 + 0x5780, 0x3200);   // rows  70..109
while ([0x584b4] < 0x73) play_status();  memcpy(screen + 0x8980, txt1 + 0x8980, 0x7080);   // rows 110..199
while ([0x584ac] <= 5) play_status();    // return at position 6 row 0
```
txt1 = `[0x58568]` (TXT1.GIF, grey ramp). The four bands are "Brother", "I", "can see the",
"LIGHT".

State left for part 2 (0x12cc2): screen = TXT1 in the grey-ramp DAC; buffer A = cleared (last
phase-A trigger drew nothing); `[0x58574]` = 5; `[0x5846c]` counting since phase B (part 2 zeroes
it itself, per the brief). ESC during part 1 only shortens the 1-second flash (phase B uses the tick
counter); every other phase waits on the music.

### Full timeline (music: 50 ms per row, 6.4 s per position)

| phase | starts at | ideal time | capture (s) |
|---|---|---|---|
| A black | pos 0 row 0 | 0.00 | 0.00 – 3.21 black |
| A vertical bars | pos 0 row 64 | 3.20 | 3.215 (fit of the fade origin) |
| A bar at y 110 | pos 1 row 0 | 6.40 | 6.407 |
| A bars at y 20, 112 | pos 1 row 64 | 9.60 | 9.611 |
| B logo, white → colours | pos 2 row 0 | 12.80 | 12.827 first white frame; tick fit = (T − 12.81)·100 |
| B logo palette exact | tick 101 | 13.81 | from 14.0 on identical to LOGO.GIF palette>>2 (max diff 1 in 8-bit) |
| C fade out | pos 3 row 64 | 22.40 | row fits give pos 3 row 64 at 22.39; black at row 127 = 25.53 |
| D clear + grey | pos 4 row 0 | 25.60 | (already black) |
| D KOMBAT | pos 4 row 32 | 27.20 | 27.124 |
| D THOR | pos 4 row 64 | 28.80 | 28.722 |
| D RAGE | pos 4 row 96 | 30.40 | 30.320 |
| D DARK | pos 5 row 0 | 32.00 | 31.904 |
| D MORE (group names) | pos 5 row 32 | 33.60 | 33.516 |
| E clear | pos 5 row 64 | 35.20 | 35.114 |
| E "Brother" | pos 5 row 92 | 36.60 | 36.51 |
| E "I" | pos 5 row 100 | 37.00 | 36.91 |
| E "can see the" | pos 5 row 108 | 37.40 | 37.31 |
| E "LIGHT" | pos 5 row 115 | 37.75 | 37.65 |
| part 2 | pos 6 row 0 | 38.40 | 38.31 |

---------------------------------------------------------------------------------------------------
## 9. Helpers in 0x11780..0x11b41 (used by other parts, listed here as asked)

### 0x11780 `build_shade_table(eax = u8 table[65536], edx = u8* pal)` — "darken by level"
Callers: loader 0x1220a, three times: tables `[0x5db2c]`, `[0x5db30]`, `[0x5db34]` from the palettes
of 2D2.GIF (`[0x5db20]`), 2D5.GIF (`[0x5db24]`), 2D6.GIF (`[0x5db28]`), for part 0x122b0.
```
for level in 0..63:
    for c in 0..255:
        r = (pal[3c]   * level) / 63;   // unsigned integer division (truncates)
        g = (pal[3c+1] * level) / 63;
        b = (pal[3c+2] * level) / 63;
        table[(c << 8) + level] = nearest_colour(r, g, b, pal);   // inlined: start 0xC0, strict <, int distance
```
Only the first 64 columns of each 256-byte row are written; columns 64..255 keep whatever the
aligned block contained (never cleared; UNSURE whether anything reads them, the rasterisers that
use this table should only index with level < 64). There is no Kahn equivalent (it is the darkening
counterpart of Kahn's `buildBrightenTable` 0x14c30 layout: `table[colour<<8 | level]`).

### 0x11909 `build_polar_tables()` — the loader main calls second
Two float32 tables of 41 rows × 26 columns, row stride 0x68 (104 bytes):
`dist[row][col]` at `0x5b770 + row*0x68 + col*4`, `angle[row][col]` at `0x5c818 + row*0x68 + col*4`
(the code stores the angle after advancing the pointer, so its base is written as 0x5c814 + 4; the
angle table starts right after the distance table). Readers: part 2 (0x12de2/0x12deb,
0x12f75/0x12f7e).
```
for row in 0..40:                 // dy = 20 - row  (20 .. -20), int
    for col in 0..25:             // dx = 12.5 - col (12.5 .. -12.5), double
        dist[row][col]  = (float)( sqrt(dx*dx + dy*dy + 1.0) * 8.17 );   // doubles 12.5 / 8.17 at 0x50428 / 0x50420
        X = (float)dx;  Y = (float)dy;
        if (X >= 0) {             // "0 > X" tested first
            if (Y == 0) a = 1.5707963705062866f;          // 0x3fc90fdb
            if (Y > 0)  a = atan(X / Y);
            if (Y < 0)  a = atan(X / Y) + 3.141592687;    // double at 0x50430 (NOT exactly pi)
        } else {
            if (Y == 0) a = 4.71238899230957f;            // 0x4096cbe4
            if (Y < 0)  a = atan(X / Y) + 3.141592687;
            if (Y > 0)  a = atan(X / Y) + 6.283185374;    // double at 0x50438
        }
        angle[row][col] = (float)a;          // X/Y division in float32 operands, fpatan in extended
```
`atan(X/Y)` is `fld X; fdiv Y; fld1; fpatan`. Net effect: `angle = atan2(dx, dy)` normalised to
[0, 2π), with the slightly-off π constant 3.141592687 / 6.283185374. dx is never 0 (half-integers),
dy is 0 on row 20.

### 0x11a3c `tri_tex_then_shade(eax=x0, edx=y0, ebx=x1, ecx=y1, stack: x2, y2, u0, v0, s0, u1, v1, s1, u2, v2, s2)`, `ret 0x2c`
Caller: 0x11e2c (twice). Builds Kahn's triangle parameter block on its stack (all values truncated to 16 bits):
```
T = { [0x5d8c8], {x0,y0,u0,v0}, {x1,y1,u1,v1}, {x2,y2,u2,v2} };  tri_affine_tex(&T);      // 0x15ca1 = Kahn 0x12962
T.ptr = [0x5d8cc]; T.v0.u = s0; T.v1.u = s1; T.v2.u = s2;          tri_shade_table(&T);     // 0x169a2 = Kahn 0x12fe1
```
i.e. draw the textured triangle, then remap the same pixels through the 64K table `[0x5d8cc]` with
a Gouraud parameter s (dst = tab[dst<<8 | s]); v keeps the texture v values (ignored by the shade
filler). Port: Kahn `src/engine/raster.js` triangle functions, A_fx_font.md "Triangles".

### 0x11ac1 `tri_tex(eax=x0, edx=y0, ebx=x1, ecx=y1, stack: x2, y2, u0, v0, u1, v1, u2, v2)`, `ret 0x20`
Caller: 0x11fa1 (twice). Exactly Kahn's wrapper sub_152e0: block `{ [0x5d8c8], v0, v1, v2 }` →
`tri_affine_tex` 0x15ca1. `[0x5d8c8]` / `[0x5d8cc]` are set by the parts (0x122b0, 0x12cc2, 0x130f7, ...).

---------------------------------------------------------------------------------------------------
## 10. 0x176c4.. library range

| addr | what |
|---|---|
| 0x176c4 | `raster_setup(eax = pitch, edx = rows, ebx = dst buffer, ecx = blend table)` SAME Kahn 0x13cfe (A_fx_font.md): `[0x5308c] = ecx` (64K blend table used by the sprite blender 0x13c28), `[0x53018] = ebx` (default destination), `[0x52010 + 4i] = i*pitch` for i < rows. main calls it with (320, 200, buffer A, 0); parts 0x12cc2, 0x13559, 0x13933 call it again with their own buffer/table (other slices) |
| 0x176e4 | program entry (C runtime start-up, LE entry point), SAME Kahn 0x1d3c8 |
| 0x17975..0x17ff0 | C runtime / iostream internals (all SAME as Kahn), 0x179b0 = get DS for the ISR |
| 0x18012 | stack check (hidden by show.py) |
| 0x18054 / 0x1831b / 0x184d2 | VESA: get controller info (SAME Kahn 0x1dd14) / set mode with LFB (SAME 0x1dfdb) / unmap LFB + text mode |
| 0x185b0 | `fatal(eax=msg)`: stops music, restores keyboard, frees module, closes MIDAS, closes video (each only if its flag 0x5dbe7/0x5dbe4/0x5dbe6/0x5dbe5/0x5dbe8 is set), text mode, prints, exit(1) |
| 0x18638 / 0x18644 | free / malloc |
| 0x1866c | `set_dac(eax=i, dl=r, bl=g, cl=b)` |
| 0x18690 / 0x186a8 / 0x186b8 / 0x186f8 | fopen(name,"rb") / fclose / file size / read u16 LE |
| 0x1871c | GIF LZW getcode, SAME Kahn 0x1e380 |

No other function of 0x176c4..0x18000 is called by the demo parts.

---------------------------------------------------------------------------------------------------
## 11. Checks against the capture (capframe / the raw video decoded with ffmpeg, 0..40 s)

- Contact sheet 0..40 s at 1 s: black, two vertical bars, one bar, two bars, white "Immortals" over
  clouds fading in, logo, logo fading out, black, KOMBAT/CODE, THOR/MUSIC-GFX, RAGE/CODE,
  Dark Spirit/MUSIC 3D GFX, group names (MORE.GIF), "Brother / I / can see the / LIGHT" revealed band
  by band, then part 2 at 38.3 s. Order and content agree.
- Bar geometry: non-zero columns exactly 20..23 and 31..34 at 3.5 s; rows exactly 110..113 at 7 s;
  rows 20..23 and 112..115 at 10 s. Agrees.
- Bar brightness: captured value of index 255 goes 251 (= DAC 62) on the first frame and decays
  exponentially, 0.95/s, restarting at each trigger. Agrees with the per-iteration 0.999995 decay;
  the rate itself is machine dependent (calibrated above).
- Logo: from 14 s to 22.3 s the frame equals LOGO.GIF indices through its palette >> 2 (max error 1
  in 8-bit). The whitening frames fit `trunc(p + (64-p)·(1 − tick/100))` with tick = (T − 12.81)·100.
- Fade-out: each frame from 22.4 s to 25.5 s equals `trunc(p·(128−row)/64)` for one row, rows 64..127
  in order, 50 ms apart, pos 3 row 64 at 22.39 s. Agrees.
- Credits and TXT1: every frame equals the GIF indices through the grey ramp `i>>2` (max error 1).
  TXT1 is revealed in 4 bands (rows ≤34, ≤69, ≤109, all). Agrees.
- **Timing discrepancy (UNSURE, not explained by the code):** up to pos 3 the capture matches
  ideal music time + ~15 ms. From pos 4 on, every event comes **70–100 ms early** (KOMBAT 27.124
  instead of 27.21, ..., part 2 at 38.31 instead of 38.41), while the fade-out rows up to row 119 are
  still on schedule and rows 120..127 already ~20 ms early. The song has no speed/break effects
  in orders 0..6, so this is probably capture or emulator timing (MIDAS position vs. video frame
  clock), not something the port must reproduce. The port should simply follow its own music
  position/row.

## Open questions
1. The bar fade speed depends on how fast the busy loop spins (≈190k iterations/s in the capture).
   The port needs a time-based approximation (exp(-0.95·t)); exactness is impossible by design.
2. Columns 64..255 of the 0x11780 shade tables are never written (contents = uninitialised block).
3. The 70–100 ms early drift of the capture after 25.5 s (above).
4. `[0x5856c]` = 500.0f written by phase B is not read by any plain `[0x5856c]` access; there are
   indexed accesses `[reg + 0x5856c]` in 0x11e2c/0x11fa1 that belong to other word arrays (other slice);
   if one of them can index 0, the porter of that part should check.
