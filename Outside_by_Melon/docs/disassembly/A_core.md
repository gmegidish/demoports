# A_core: program core, shared helpers, hand-written asm

Reader: "core". Scope: main/init/exit, file I/O and the IFF LBM loader, MIDAS setup, tunnel module (tunnelc.C), the mode-13h part of vgac.C, palette helpers, the sine table module (0x13140/0x131a0), the 65536-entry table, and all hand-written asm in the data object that the demo code calls, including a second 3D engine at 0x4f000+ that the listing does not contain.

Conventions used below:
- Watcom register calling convention: args in eax, edx, ebx, ecx, then the stack (pushed right to left, so the 5th arg is the last pushed). "ret N" pops the stack args.
- `>>` on signed values is arithmetic (sar). `>>>` is logical (shr). `/` on ints is x86 idiv (truncates toward zero).
- int16(x) means "keep the low 16 bits and read them as signed".
- fb = the 320x200 8-bit frame buffer, pointer in both [0x1f6744] and [0x1f6ab0] (same block).
- rowoff = the 200-entry dword table at [0x1f6750], rowoff[y] = 320*y.
- DAC values are 6-bit (0..63). **Verified:** the recording converts a DAC value v to 8-bit RGB as `round(v*255/63)` = `(v*255 + 31) // 63`. It is not `v<<2 | v>>4` (for example v=11 shows as 45, not 44).

---

## 1. Program flow

### main 0x102b0 (argc=eax, argv=edx)

```
[0x1f674c] = 0                       // "configure sound" flag
if argc >= 2:
    if strcmp(argv[1], "/c") == 0 or strcmp(argv[1], "/C") == 0: [0x1f674c] = 1
    else: print usage ("Outside.", "Wrong syntax.", ..., "(C)1997 by Melon Dezign"); exit(0)
init()                               // 0x10080
[0x1f6754] = 0                       // part index (it is already 0)
part0_start()                        // 0x12620
loop:                                // 0x10360
    if inp(0x60) == 1: break         // scancode 1 = ESC pressed (keyboard IRQ is masked, see init)
    switch [0x1f6754]:               // table 0x10284
        0: 0x12690   1: 0x12390   2: 0x12be0   3,4: 0x135b0
        5: 0x13090   6: 0x13b70   7: 0x13e90   (else: nothing)
    flip()                           // 0x114d0
exit_demo()                          // 0x10210
_setvideomode(3)                     // 0x1412f = Watcom _setvideomode
```

The main loop is free-running. Nothing in it waits for the retrace, except the part-6 render 0x13b70, which starts with `wait_vsync` 0x4b4a8.

### Timer callback 0x10060

```
if [0x1f6754] <= 7: jump table 0x10034:
    0: 0x12760  1: 0x12470  2: 0x12dd0  3,4: 0x13720  5: 0x13100  6: 0x13d00  7: 0x140b0
```

MIDAS calls it as the **pre-VR** callback (the 2nd argument of MIDASsetTimerCallbacks, see below), once per display frame (70.086 Hz). It runs from the moment the sound is initialised, **during loading**, so the part-0 tick 0x12760 runs during data loading (see the timeline, section 6).

### init 0x10080

In order:
1. `cli` (0x41540).
2. Load the part data: 0x124e0 title, 0x127e0 credits, 0x121d0 room, 0x12f30 pigpan, 0x13d40 landscape, 0x13230 text, 0x13830 logo.
3. `sti` (0x41542).
4. 0x107d0 loads the tunnels.
5. 0x103d0 (empty).
6. 0x13140 builds the sine table.
7. `sound_init("outside.cfg", configure=[0x1f674c], callback=0x10060)` (0x10690). **From here on the timer callback runs at 70 Hz.**
8. `0x10b90(0xa, 0)`: video mode 0xa = **real VGA mode 13h** (int 10h via `_setvideomode(0x13)`). It allocates the frame buffer (malloc 128000; only the first 64000 bytes are used). The DOSBox capture starts here (frame 0).
9. `[0x1f6744] = 0x11440()`, the frame buffer pointer (= [0x1f6ab0]).
10. PIC: `old = inp(0x21)`, saved in [0x1f6758]. Then `outp(0x21, (old & 0xfb) | 2)`: this masks IRQ1 (keyboard, so ESC is read by polling port 0x60) and unmasks IRQ2.
11. 0x429b1, the 3D engine init (see 0x429b1).
12. `[0x1f6750] = malloc(800)`, with rowoff[y] = 320*y for y = 0..199.
13. `[0x1f6740] = malloc(0x20002)` and the 65536-entry word table (see section 5.1). **It is never used.**
14. `[0x1f6748] = load_module("data/beast_4.xm")` (0x10760), then `play_module` (0x107b0).
15. Return. main then calls 0x12620 (part-0 start) straight away.

Every malloc result goes through 0x10010. If the pointer is NULL it does: setvideomode(3), print "Couldn't allocate a memory-block", exit(0).

### exit_demo 0x10210

In order:
1. Stop the module (0x107c0) and free it (0x10790).
2. Free the row table and the 1/x table.
3. Part cleanups 0x12600, 0x12a70, 0x122d0, 0x13000, 0x13dd0, 0x13450, 0x13a70.
4. 0x103e0 (empty).
5. 0x10960 frees the tunnel data.
6. 0x10750 = MIDASclose.
7. 0x131a0 (empty).
8. 0x113f0 frees the frame buffer.
9. Restore the PIC mask from [0x1f6758].

---

## 2. Sound (MIDAS 0.6.1): API calls only

| addr | demo wrapper | MIDAS call |
|---|---|---|
| 0x10690 | sound_init(cfgname=eax, configure=edx, callback=ebx) | 0x15864 MIDASstartup. Then: if configure: 0x166cc MIDASconfig (fail = "Configuration error.") and 0x168d4 MIDASsaveConfig(cfg). Else: if fopen(cfg, "r+b") works, fclose and 0x16798 MIDASloadConfig(cfg); otherwise config + save as above. Then 0x155c0 MIDASinit, 0x16fec(&[0x1f675c]) (gets the display refresh rate into [0x1f675c]), and 0x172d0 **MIDASsetTimerCallbacks(rate=[0x1f675c], preVR=0x10060, immVR=NULL, inVR=NULL)**. 0x172d0 waits for the start of a vertical retrace (port 0x3da bit 3) before it programs the PIT, so the timer is phase-locked to the display. Errors go to 0x154d0 (fatal). |
| 0x10760 | load_module(name) | 0x177c0(name, 1, 0, &module) (XM loader). Returns the module handle. |
| 0x107b0 | play_module(m) | 0x159ac(m, 0) = MIDASplayModule |
| 0x107c0 | stop_module(m) | 0x15ac4 = MIDASstopModule |
| 0x10790 | free_module(m) | 0x18d90 |
| 0x10750 | sound_close() | 0x1572c = MIDASclose |

**Does any part read the music position or row? No.**
- The demo code (0x10000..0x14100) calls no MIDAS function except the six wrappers above, all in init and exit.
- It references no MIDAS variable: there is no access to the MIDAS data at 0x1fe5xx/0x1fe9xx, and every 0x1fxxxx global it uses is its own.
- The data object 0x52a48 that the part-0 tick reads is a demo counter, not a play status.

All timing in the demo is therefore driven by counting timer callbacks.

**When does the music start?** MIDASplayModule is the last thing init does. main then immediately sets [0x1f6754] = 0 and calls 0x12620, which resets the part-0 counters. So music start equals part-0 tick 0, within microseconds. The player starts the first row on its first player tick after that.

The timer callback, however, has been running since step 7 of init. In the recording, step 7 is about frame 0 (see section 6). **The audio track of cap.avi is all zeros for its whole length** (checked every sample), so the music start cannot be measured from the recording.

---

## 3. Files and file I/O (fileio.C)

| addr | function |
|---|---|
| 0x103f0 | `fopen(name, "r+b")`. Asserts name != NULL. |
| 0x105d0 | `fclose(f)` |
| 0x10600 | `filesize(f)`: ftell(0x15345), fseek(f, 0, SEEK_END) (0x153c9), ftell, fseek back. Returns the size. |
| 0x10450 | `read(f=eax, buf=edx, n=ebx)`: fread(buf, 1, n, f). Returns 1 on a short read, 0 on success. |
| 0x104d0 | **load_file(name) -> pointer**: open, size, malloc(size), read the whole file. Returns the buffer, or 0 on any failure (callers then assert through 0x10010). The size is **not** returned. Despite its use for .LBM files it does no parsing; that is done by the asm helpers below. |
| 0x10420, 0x10530, 0x10550, 0x10660 | write/save helpers ("w" mode, fwrite). Unreferenced, dead code. |

Data files: all *.LBM/*.BBM through load_file plus the asm decoder; TUNNEL1-4.MAP/.SHD through load_file (raw); BEAST_4.XM through the MIDAS loader; OUTSIDE.CFG through MIDAS.

### IFF LBM handling (asm, data object): exactly what the code does

The code assumes the file layout `FORM <len> PBM  BMHD <len=20> <bmhd...> ...`, so BMHD data starts at file offset 0x14.

- **0x4177d `lbm_width(file=eax)`**: returns the big-endian u16 at file+0x14.
- **0x4178a `lbm_height(file=eax)`**: returns the big-endian u16 at file+0x16.
- **0x41766 `find_chunk`** (internal; esi = file, eax = 4CC as a little-endian dword):
  - It scans **byte by byte** from the file start for the 4 bytes, without walking the chunk structure.
  - It returns esi = 8 bytes past the tag (the chunk data), and ebp = the low 16 bits of the chunk length (bytes 2..3 of the length, big-endian; this value is not used).
  - Checked on all 26 files: the first byte match of "CMAP" and "BODY" is always the real chunk.
- **0x416e3 `lbm_decode(dest=eax, file=edx)` -> eax = number of bytes written**:

  ```
  total = BE16(file+0x14) * BE16(file+0x16)        // w*h; the compression and nPlanes fields are NOT read
  p = find_chunk("BODY")
  out = dest; remaining = total
  loop:
      c = byte[p++]                                    // unsigned
      if c < 0x80:  n = c + 1                          // literal run
          if remaining < n: break                      // the packet is dropped whole, not partially
          remaining -= n; copy n bytes p..p+n-1 to out; p += n; out += n
      else:         n = ((256 - c) & 0xff) + 1         // replicate run; NOTE c = 0x80 gives n = 129, not a no-op
          if remaining < n: break
          remaining -= n; v = byte[p++]; write v n times
  return out - dest
  ```

  This is ByteRun1 decoded as **chunky PBM** (one byte per pixel, rows of w bytes, no planar ILBM conversion and no row padding). Results checked on all files:
  - Every image decodes exactly w*h bytes. No file contains a 0x80 code, so plain ByteRun1 gives identical output.
  - The loop reads one control byte past the end of BODY (= end of file) and stops.
  - The PAL1/PAL2/PAL3 files (1x1, uncompressed) decode 0 bytes. They are only used for their CMAP.

  Image sizes:
  - 320x200: MELON, TITLEPIG, ENDPIGS, PANORAMA, SITTING, TEXT1..5, WIPE1/2/4.
  - 256x256 (65536 bytes): ROOM, TEXTURE2..6.
  - 320x240: OUTSIDE.
  - 576x110: CLOUDS.
  - 320x55: ADEPT, JASON, JOACHIM.
- **0x416aa `lbm_palette(dest=eax, file=edx, count=ebx)`**: finds "CMAP" and, for i < count: `dest[3i+k] = cmap[3i+k] >> 2` (8-bit to 6-bit DAC, truncating) for k = 0..2. It always starts at CMAP entry 0, whatever DAC range the caller later uploads it to.
- **0x41670** (not in the listing, **unreferenced**): finds CMAP and writes it straight to the DAC (`out 0x3c8, i; out 0x3c9, v>>2` × 3), count = edx.

Typical caller pattern (part loaders): `buf = load_file(); out = malloc(lbm_width(buf)*lbm_height(buf)); lbm_decode(out, buf); lbm_palette(pal, buf, n)`.

---

## 4. Tunnel module (tunnelc.C)

### Data files: TUNNELn.MAP and TUNNELn.SHD (n = 1..4)
- **MAP**: 128000 bytes = 64000 little-endian u16, one per screen pixel in row-major order (320x200). The value is a texture offset into a 256x256 texture, `(v<<8) | u`.
- **SHD**: 64000 bytes, one per pixel. It is added to the texel's palette index (palette-offset shading, values 0..255).

### Globals

| addr | meaning | init |
|---|---|---|
| 0x1f6760, 0x1f6764, 0x1f6768, 0x1f676c | MAP buffers 1..4 | load |
| 0x1f6770..0x1f677c | SHD buffers 1..4 | load |
| 0x1f6780 | current MAP | = tunnel1 after load |
| 0x1f6784 | current SHD | = tunnel1 after load |
| 0x1f6788 | texture offset (only the low 16 bits are used) | 0 |
| 0x1f678c | tunnel texture buffer, 0x20000 bytes (zeroed at load) | |
| 0x1f6790 | 18, the length of `aTunnelSpeeds` | |

`aTunnelSpeeds` is at 0x415e4: 18 dwords = 0x0101 ×15, 0x0202, 0x0303, 0x0202. Its address is only asserted; **nobody reads it**.

### Functions
- **0x107d0 tunnel_load()**:
  - [0x1f678c] = malloc(0x20000), memset 0.
  - Load tunnel1..4 .map and .shd with load_file (order map1, shd1, map2, ...).
  - current = tunnel 1.
- **0x10960 tunnel_free()**.
- **0x10990 tunnel_set_texture(tex=eax)**: copies 65536 bytes of tex to buf[0..65535] **and again** to buf[65536..131071]. The renderer can then index buf[off + map] with off, map < 65536 and get wraparound for free.
- **0x10a00 tunnel_set_offset(off=eax)**: [0x1f6788] = off.
- **0x10a10 tunnel_select(n=eax)**: n is 0-based (0 = TUNNEL1). [0x1f6780] = map[n], [0x1f6784] = shd[n].
- **0x4162c tunnel_render()** (asm, no args): renders all of fb, overwriting it.

  ```
  base = [0x1f6788] & 0xffff
  for i in 0..63999:
      fb[i] = (tex[(base + map[i]) & 0xffff] + shd[i]) & 0xff
  ```

  **Verified pixel-exact:** recording frame 631 (and 500) of the title tunnel reproduces in all 64000 pixels. That used TUNNEL4 (tunnel_select(3)), TEXTURE2 as the texture, DAC 0..127 = TEXTURE2 CMAP>>2 and 128..255 = TITLEPIG CMAP[0..127]>>2, palette brightness -1 through 0x12010, and offset = 257*frame (see section 6).
- **0x10a30 dpmi_realmode_int(intno=eax, rmregs=edx)**: this is NOT a tunnel routine. It is DPMI 0x300 (simulate real-mode interrupt) through int386x(0x31). It is used by the VESA code at 0x1172a and is irrelevant for mode 13h.

---

## 5. Tables built at init

### 5.1 The 65536-entry word table at [0x1f6740] (built in 0x10080, **unused**)

```
fld 65535.0 ; fld 1.0                      // 1.0 is the float 0x3f800000 left in [esp+4]
for i = 0..65535:
    t = 1.0 / i                            // fild i; fdivr st, st(1)
    t = t * 65535.0                        // fmul st, st(2)
    t = chop(t)                            // call 0x14796
    table[i] = low16(fistp(t))
```

**0x14796 is not a libm function.** It is Watcom's `__CHP` (used for float-to-int casts): it saves the FPU control word, sets the rounding-control bits to 11 (truncate, `mov byte [esp+1], 0x1f`), does `frndint`, and restores the control word. So it is `trunc()`.

Result:
- `table[i] = floor(65535 / i)` for i = 1..65535. Exhaustively checked with 64-bit and with 53-bit mantissa rounding; no entry differs from integer division.
- `table[0] = 0`: 1/0 = +inf, fistp stores the integer indefinite 0x80000000, and its low word is 0.

**Nothing reads the table.** The only other reference is `mov edi, [0x1f6740]` at 0x420c0, which is overwritten before use. A port can skip it.

### 5.2 Sine table 0x13140 (init) / 0x131a0 (cleanup, just `ret`)

```
x = 0.0 (x87); step = 0.001533203125 (double at 0x40558, exactly 7070651414971679 / 2^62)
for k = 0..5119:
    dword[0x1f8424 + 4k] = trunc(sin(x) * 65536.0)     // fsin; fmul 65536.0 (double at 0x40550); __CHP; fistp
    x = x + step                                       // accumulated, not k*step
```

- Values are 16.16 signed. They go from 0 up to +65535 at k ≈ 1024, down to -65535, and up again. The step is 1.57/1024, so 1024 entries are slightly under a quarter turn.
- Checked: emulating the x87 with 64-bit-mantissa accumulation, with 53-bit, and with plain JS doubles (`x += 0.001533203125; Math.trunc(Math.sin(x)*65536)`) gives **identical** tables for all 5120 entries. Use the JS expression.
- **The base is 0x1f8424, not 0x1f8420** (the index register is incremented by 4 before the store). Users read `[k*4 + 0x1f8424]` (0x12c8e, 0x14010) and `[ebx + 0x1f9424]` = entry k + 1024 (0x13fc1).
- [0x1f8420] itself is written separately by the pigpan code (0x12f96).

---

## 6. Timeline of the core and the recording offset

Callback ticks are 70.086 Hz. Frame n of cap.avi is at n / 70.086 s.

| event | when |
|---|---|
| sound_init, timer callbacks start (part-0 tick 0x12760 starts running with stale counters) | ≈ frame 0 |
| mode 13h set (recording starts) | frame 0 |
| 65536 FPU divisions, XM load, MIDASplayModule | frames 0..≈16 |
| 0x12620 part-0 start: resets [0x1f777c] = 0, [0x1f776c] = -64, [0x1f7760] = 64, [0x1f775c] = 0, [0x1f7770] = 0, and sets the palette black; music starts | ≈ frame 16 (0.23 s) |
| screen black until frame 270, first non-black pixel frame 271 (3.87 s), from the fade-in of the tunnel | |

How the offset was found (all by pixel matching the tunnel, section 4):

1. **Tunnel offset**: the matched offset is exactly **0x101 × frame index**, at frames 500 and 631.
   - The part-0 tick adds 0x101 to [0x1f7768] every callback.
   - **0x12620 does not reset [0x1f7768] or the phase counter [0x52a48].**
   - So the callback count since timer install equals the recording frame index. The tick-to-frame mapping is 1:1 at least up to frame 631.
2. **Brightness**: the fade-in brightness b ([0x1f776c], applied with 0x12010) steps +1 every 7 ticks. Measured b = -16 for frames 352..357 and -15 from frame 358, so the steps fall on frames ≡ 1 (mod 7). Counting back 49 steps from -15 puts the first step after the reset at frame 22, so 0x12620 ran between frames 15 and 21.
   - b stops at **-1**: when b reaches 0 the render no longer reloads the palette, so the last applied brightness is -1. Matched b = -1 at frames 450..776.
3. **Overlay**: frame 776 is pure tunnel. Frame 777 is the first with the white flash / titlepig overlay (render condition [0x1f777c] > 760). That gives [0x1f777c] = frame - 16, so **0x12620 ≈ frame 16**.
   - From frame 779 on, the tunnel offset advances 0x202 per frame and the flash brightness drops 1 per frame (62 at 779, 61 at 780, 51 at 790).
   - The number of 0x202 steps seen (1 at 779, 11 at 790) is 2-3 fewer than "counter = frame - 16" predicts. So either the render that shows the overlay is not the one right after the callback, or the counter phase differs by about 2 ticks.
   - The title reader should pin this down. The core facts are: callback count = frame index, and part-0 tick 0 is about frame 16-19.

Renders per tick: in the title tunnel (frames 350..1400) no two consecutive recording frames are identical, so there is at least one render per tick there. Some frames match the model in only about 62000-63500 of 64000 pixels (for example frames 350, 351, 353, 357), which looks like tearing: the memcpy to 0xA0000 is not synced to the retrace.
- "One tick, then one render" is right for everything driven by tick counters.
- Exception: **0x42657 (the star) advances its light angles on every render call**, not per tick, so its speed depends on the render rate. The part-6 render waits for the retrace (0x4b4a8), so it renders at most once per frame.

---

## 7. vgac.C, mode-13h subset

**0x10b90 `vga_set_mode(mode=eax, flags=edx)`**:
- [0x1f6ad4] = mode. If flags & 8: [0x4b8a4] = 1 (not here, flags = 0).
- Modes 0..0x16 go through table 0x10acc. **Mode 0xa → 0x10c64**:

```
_setvideomode(0x13)                 // BIOS int 10h mode 13h, 320x200x256, linear at 0xA0000
[0x4b898] = 1                       // "plain mode 13h" flag used by flip
[0x1f6ac8] = 0xfa00                 // frame size 64000
[0x1f6ab0] = malloc(64000 + 200*320) = malloc(128000)     // the extra 64000 is never used
[0x1f6ad8] = pitch = 320*8/8 = 320; [0x1f6adc] = 320 (width); [0x1f6ae0] = 200 (height); [0x1f6ae4] = 8 (bpp)
bytes [0x1f6aec..0x1f6af1] = 0      // RGB mask info, unused in 8-bit
return 0x1f6ad8                     // pointer to the mode info struct
```

- [0x4b894] (banked/VESA flip) stays 0. [0x1f6ab8] (bank-switch kind) stays 0.
- The other modes (VESA/SVGA chipsets via 0x4acc2, 0x116c0..0x11b00, 0x4ad7a, 0x4b134, 0x4b38e, 0x4b42b..0x4b48d) are not used.

Other entry points:
- **0x11440 `vga_framebuffer()`**: returns [0x1f6ab0] (asserts it is not NULL).
- **0x114b0 `vga_clear()`**: memset(fb, 0, [0x1f6ac8] = 64000). Called by the pigpan render (0x130b9).
- **0x114d0 `flip()`**, mode-13h path: [0x4b894] == 0 and [0x4b898] == 1, so it does `memcpy(0xA0000, fb, 64000)` (rep movsd). **No retrace wait, no palette work.**
- **0x113f0 `vga_close()`**: frees fb. The SVGA cleanup is skipped because [0x1f6ab8] is 0.

Retrace waits in the whole program:
- 0x4b4a8 `wait_vsync` (pushal; wait while port 0x3da bit 3 is set, then wait until it is set; popal). It is called only by the part-6 render 0x13b70 (first instruction).
- MIDAS's own wait in 0x172d0 (once, at timer setup).
- Nothing else.

### Palette helpers (vgac.C)

**0x12010 `set_palette(pal=eax, first=edx, count=ebx, bright=ecx, addR, addG, addB)`** (3 stack args, `ret 0xc`):

```
dR = addR + bright; dG = addG + bright; dB = addB + bright
idx = first
for i in 0..count-1:
    out 0x3c8, idx & 0xff                         // the index is written every entry
    for (k, d) in (0,dR),(1,dG),(2,dB):
        v = sbyte(pal[3i+k]) + d                  // pal read as SIGNED bytes (movsx), from pal[0], not pal[3*first]
        if v >= 63: v = 63
        elif v <= 0: v = 0
        out 0x3c9, v
    idx++
```

Every call in the program pushes addR = addG = addB = 0, so it is effectively `DAC[first+i] = clamp(pal[i] + bright, 0, 63)`. The DAC change is immediate (not synced to the frame flip).

**0x12100 `pal_step(target=eax, dst=edx, cur=ebx, step=ecx, count=[stack])`** (`ret 4`). For each of 3*count bytes (unsigned values, 32-bit arithmetic):

```
c = cur[j]; t = target[j]
if c > t: c -= step; if c < t: c = t
else:     c += step; if c > t: c = t            // c == t: c+step, clamped back to t
dst[j] = c
```

This moves each component one `step` toward the target without overshoot. dst may equal cur.

**0x120d0 `set_border(color=eax)`**: int 10h AX = 0x1001, BH = color (overscan register). It is called with 0 at 0x13b2f. Not visible in the 320x200 capture.

---

## 8. Hand-written asm helpers in the data object (0x41500..0x417a0)

| addr | name / args | exact behaviour |
|---|---|---|
| 0x41540 | cli | `cli; ret` |
| 0x41542 | sti | `sti; ret` |
| 0x41575 | `mask_copy(mask=eax, dst=edx, src=ebx, key=cl)` | for i < 64000: `if mask[i] == key: dst[i] = src[i]` (all regs preserved). Used for WIPE*.LBM transitions (key = a counter). |
| 0x41590 | `mask_clear(mask=eax, dst=edx, key=bl)` | for i < 64000: `if mask[i] == key: dst[i] = 0` |
| 0x415c3 | `blit_add(src=eax, count=edx, dstoff=ebx, add=cl)` | `d = fb + dstoff`; for i < count: `v = src[i]; if v != 0: d[i] = (v + add) & 0xff` (colour 0 is transparent, the colour offset is added to the others). count == 0 would loop 2^32 times; callers always pass > 0. |
| 0x4162c | `tunnel_render()` | see section 4 |
| 0x416aa, 0x416e3, 0x41766, 0x4177d, 0x4178a | LBM | see section 3 |

Code in 0x41500..0x417a0 that the listing missed (disassembled with capstone; **none of it is reached**, no call/jmp/pointer to it anywhere in the image):
- **0x41544** "dissolve": for 0x15180 bytes of fb: `if fb[i] != 0 and src(eax)[i] == byte[0x415e1]: fb[i] = 0`; then byte[0x415e1]++.
- **0x415a6** "add image": for i < 64000: `fb[i] += src(eax)[i]`.
- **0x41670**: CMAP to DAC (section 3).
- 0x415e1 is that byte counter; 0x415e4..0x4162b is `aTunnelSpeeds`. 0x41797..0x417a3 are the LBM decoder's scratch dwords.

### Gap 0x417a4..0x41f63

A complete second copy of a **gouraud + texture triangle setup**, structurally identical to 0x4de50 below, but its scanline code at 0x41cc6 has a different, older layout. It works on the same vertex globals 0x486ac.. and on clip globals 0x48665/0x48669 = 320/200, with scratch at 0x48588..0x4862c. **No reference to it exists anywhere** (absolute or relative scan of the whole image). It is dead code.

---

## 9. 3D engine #1 (data object 0x41f65..0x42a3a, plus helpers used by every 3D object)

Shared globals:

| addr | meaning | initial |
|---|---|---|
| 0x4872e | S[1024] dwords: 128 + 128·sin, in the EXE image | 0x429b1 subtracts 128 → **S[i] ≈ 128·sin(2πi/1024)**, S[0] = 0, S[256] = 128 |
| 0x498ae | C[1024] dwords | after -128: **C[i] ≈ -128·cos(2πi/1024)**, C[0] = -128. A port should copy both tables from mem.bin (0x4872e and 0x498ae, 1024 dwords each) and subtract 128. |
| 0x4acb2, 0x4acb6, 0x4acba | rotation angles A, B, Γ for 0x4230d (each used `& 0x3ff`) | 0 |
| 0x42a3b, 0x42a3f, 0x42a43 | camera/translation (cx, cy, cz), set by 0x42a25 | 0 |
| 0x4655c | focal length 280 | const |
| 0x46560 | z bias 5000 | const |
| 0x46528, 0x4652a | screen centre 160, 100 (words) | const |
| 0x4870c, 0x48716, 0x48720 | input point X, Y, Z (int16 words) for 0x4230d | |
| 0x48712, 0x4871c, 0x48726 | outputs xr, yr, zr (dwords) | |
| 0x4872a, 0x4872c | projected sx, sy (words) | |
| 0x48634, 0x48638, 0x4863c | vertex normal nx, ny, nz (16.16 dwords) for 0x424ff | |
| 0x44ee8, 0x44eea, 0x44eec | light vector Lx, Ly, Lz (int16) for 0x424ff | |
| 0x486ac + 0x18k (k = 0..2) | triangle vertex k: dword x (16.16), +4 y (16.16), +0xc c (16.16 shade), +0x10 u, +0x14 v. Callers only write the **high words** (0x486ae, 0x486b2, 0x486ba, 0x486be, 0x486c2; +0x18; +0x30). The low words are 0 in the image and are never written by reached code, so each value = int16 << 16. | |
| 0x48665, 0x48669 | clip width 320, height 200 (used by 0x41f65) | const |
| 0x50927, 0x5092b | clip width 320, height 200 (used by 0x4de50) | const |

**0x42a25 `set_camera(cx=eax, cy=edx, cz=ebx)`**: [0x42a3b] = eax, [0x42a3f] = edx, [0x42a43] = ebx (registers preserved).

**0x429b1 `engine_init()`** (called once from init):
- S[i] -= 128 and C[i] -= 128 for i < 1024.
- Clip vars [0x4866d] = 0, [0x48671] = 0, [0x48675] = 319, [0x48679] = 200, [0x4867d] = 320. These are not read by reached code.
- [0x4869c] = fb.

**0x4230d `rotate_project()`** (no args; all ints; `imul` keeps the low 32 bits):

```
a = [0x4acba]&0x3ff ; X,Y,Z = int16 inputs
t1 = (X*S[a] + Y*C[a]) >> 7            // [0x48718]
t2 = (X*C[a] - Y*S[a]) >> 7            // [0x4870e]
b = [0x4acb2]&0x3ff
xr = (Z*S[b] + t2*C[b]) >> 7           // [0x48712]
t3 = (Z*C[b] - t2*S[b]) >> 7           // [0x48722]
g = [0x4acb6]&0x3ff
zr = (t1*S[g] + t3*C[g]) >> 7 ; if zr == 0: zr = 1     // [0x48726]
yr = (t1*C[g] - t3*S[g]) >> 7          // [0x4871c]
den = zr + cz + 5000
sx = int16( (den != 0 ? int32((xr + cx)*280) / den : int32((xr+cx)*280)) + 160 )   // [0x4872a]
sy = int16( (den != 0 ? int32((yr + cy)*280) / den : int32((yr+cy)*280)) + 100 )   // [0x4872c]
```

The centre is added to the low word only (16-bit add). Use the formulas literally; do not substitute textbook sin/cos, because C has the opposite sign of cos. Special case used by the rotozoomer: for angles A = B = 0 and Γ = a, xr = -t2, yr = -t1, zr = Z (or 1 if Z = 0).

**0x424ac `face_area()`** (uses the words x1, y1 = [0x486ae], [0x486b2]; x2, y2 = [0x486c6], [0x486ca]; x3, y3 = [0x486de], [0x486e2]):

```
ecx = int16(y3-y2) * int16(x2-x1)
eax = int16(y2-y1) * int16(x3-x2) - ecx          // the subtractions are 16-bit, then sign-extended; 32-bit products
[0x4acbe] = eax ; return dl = (eax < 0) ? 1 : 0
```

The star draws faces with dl == 1. The two other 3D renderers draw faces with dl == 0.

**0x424ff `vertex_light()`** -> eax (also leaves ebx = nz):

```
s = ((int16(Lx - X) * nx) >> 16) + ((int16(Ly - Y) * ny) >> 16) + ((int16(Lz - Z) * nz) >> 16)
    // L-V is a 16-bit subtraction; each product is 64-bit, then shrd 16 (arithmetic >>16, low 32 bits kept)
return (-s) >> 6
```

X, Y, Z are the unrotated object-space inputs [0x4870c..], and N is the unrotated normal. The light is rotated into object space by the caller.

### 0x42657 `draw_star(A=eax, B=edx, Γ=ebx)`: the credits "star" (only caller: 0x12c66)

Object: 50 vertices at 0x42a48 and 96 faces at 0x4308c (constant data; copy from mem.bin).
- Vertex record = 8 dwords `x, y, z, u, v, nx, ny, nz`. The coordinates are 21.11 (the code uses `>> 11`). The list ends at x == 0x7fffffff.
- Face = 4 u16 `a, b, c, 0`. The list ends at a == 0x7fff.

```
// 1. light, rotating PER CALL (= per render, not per tick)
angles = ([0x4864d], [0x48651], [0x48655])          // initial 0,0,0
(X,Y,Z) = (-30000, 0, 0)                             // words at 0x44eee
rotate_project(); Lx,Ly,Lz = int16(xr), int16(yr), int16(zr)        // -> 0x44ee8..
[0x4864d] += 2; [0x48651] += 5; [0x48655] += 7      // dwords, unmasked (masked on use)
// 2. vertices
angles = (A, B, Γ)
for i in 0..49:
    X = int16(x >> 11); Y = int16((y + [0x48640]) >> 11)   // [0x48640] = 0, never written
    Z = int16(z >> 11); N = (nx, ny, nz)
    rotate_project()
    SX[i] = sx; SY[i] = sy                           // words at 0x43390 + 2i, 0x43778 + 2i
    l = vertex_light() >> 3; l = (l >= 30) ? 30 : (l <= 0 ? 0 : l)
    SH[i] = l + 0xd1                                 // palette 209..239, word at 0x44330 + 2i
    ZR[i] = zr                                        // dword at 0x44718 + 4i
    // (u >> 16, v >> 16 are stored at 0x43b60/0x43f48 but are unused)
// 3. depth keys, 1-based arrays
for f in 0..95: key[f+1] = ZR[a]+ZR[b]+ZR[c]; idx[f+1] = 8f      // 0x45570 + 4k, 0x45d40 + 4k
key[0] = key[97] = 0 and idx[97] = 0 (never written, zero)
// 4. sort: quicksort(lo=1, hi=96, hint=5312), see below
// 5. draw from k = 97 down to 1:
for k = 97 .. 1:
    f = idx[k] / 8                     // k = 97 gives face 0 drawn once extra, first (harmless, see note)
    load vertices a, b, c of face f: x = SX, y = SY, c = SH into the 0x486ac triangle slots
    if face_area() < 0: fill_gouraud()      // 0x41f65
```

The extra first draw of face 0 cannot change the result: face 0 is drawn again later at its sorted position, with the same culling and colour.

**Quicksort 0x4255e** (globals lo = [0x45550], hi = [0x45554], j = [0x4555c]; the pivot index comes from the **entry ebx**, a leftover register):

```
qs(lo, hi, hint):
    i = lo; j = hi
    p = key[(hint + hi) >>> 1]                  // 32-bit add, logical shift
    do {
        while key[i] < p: i++                   // signed compares
        while p < key[j]: j--
        if i <= j: swap(key[i], key[j]); swap(idx[i], idx[j]); i++; j--
    } while i <= j                              // unsigned compare (values stay >= 0)
    if lo < j: qs(lo, j, j)                     // hint = new hi, so the pivot = key[j]
    if i < hi: qs(i, hi, hi)                    // pivot = key[hi]
top call: qs(1, 96, 5312)
```

5312 is the nz of the last vertex, which 0x424ff left in ebx. The pivot index is (5312+96)/2 = 2704, which reads `dword[0x45570 + 4*2704] = [0x47fb0]`. That address is outside the array, never written, and holds **0**. So the top-level pivot value is 0, and the sentinels key[0] = key[97] = 0 keep both scans in bounds. Recursive levels use pivot = the last element of the range.

The sort is ascending zsum. Drawing goes from k = 96 down to 1, so the largest z (farthest) is drawn first. The sort is not stable, so a port must copy this exact algorithm to get the same order for equal keys.

**0x41f65 `fill_gouraud()`**: flat-texture-less gouraud triangle, used by the star and by engine #2. The inputs are the 3 slots of x, y, c (16.16 dwords with zero fraction).

```
sort the 3 vertices by y: if y0 > y1 swap(0,1); if y1 > y2 swap(1,2); if y0 > y1 swap(0,1)   // signed, swap x,y,c
y = y0 >> 16
h = (y2 - y0) >> 16 ; if h == 0 return
q(d) = d >> 16 (on 16.16 differences)
dxa = q(y1-y0) ? (x1-x0)/q(y1-y0) : (x1-x0)      // idiv; the division is skipped when the divisor is 0
dxb = (x2-x0)/h
dx12 = q(y2-y1) ? (x2-x1)/q(y2-y1) : (x2-x1)
dca = q(y1-y0) ? (c1-c0)/q(y1-y0) : (c1-c0)
dcb = (c2-c0)/h
dc12 = q(y2-y1) ? (c2-c1)/q(y2-y1) : (c2-c1)
t = trunc( D * 65537 / H )   where D = (y1-y0)>>16, H = (y2-y0)>>16
     // the code does cdq; shld edx,eax,16 without shifting eax, so the dividend is D*2^32 + D*2^16 over H*2^16
xm = (((x2-x0) * t) >> 16) + x0     // 64-bit product, arithmetic >>16, low 32 bits   [0x48564]
cm = (((c2-c0) * t) >> 16) + c0     //                                                [0x48570]
k = (xm - x1) >> 16                 // arithmetic: floor for negatives
dcdx = ((k != 0) ? (cm - c1) / k : (cm - c1)) >> 8           // 8.8 shade step per pixel
xa = xb = x0 ; ca = cb = c0
repeat h times:
    if y >= 200: return
    if y == (y1 >> 16): dxa = dx12; xa = x1; dca = dc12; ca = c1     // switch to the lower edge
    ca += dca; cb += dcb; xb += dxb; xa += dxa                // PRE-STEP: the first row already uses the stepped values
    col_a = ca >> 8 ; col_b = cb >> 8                         // 8.8
    L = xa >> 16 ; R = xb >> 16 ; n = R - L ; col = col_a
    if n < 0: n = -n; swap(L, R); col = col_b
    if y >= 0 and L < 320 and R > 0:
        p = rowoff[y] + L
        if L < 0: col += dcdx * (-L) (32-bit); p += -L; n -= -L
        if R > 320: n -= R - 320
        while n > 0: fb[p++] = (col >> 8) & 0xff; col = (col & ~0xffff) | ((col + dcdx) & 0xffff); n--
                                                      // ax += bp: 16-bit add, no carry out of bit 15
    y++
```

The pixel span is [min(L,R), max(L,R)), with the right end exclusive. Rows y0 .. y2-1. There is no z-buffer.

---

## 10. Rotozoomer for the pigpan (part 5): 0x4b90c, 0x4ba10, 0x4bb3f, 0x4bbbd, 0x4bbf0

Globals (data object), words unless noted:
- 0x4bce5 X[3], 0x4bceb Y[3]: current triangle.
- Layer 1: 0x4bcf1 X1[3], 0x4bcf7 Y1[3], angle dword 0x4bd31.
- Layer 2: 0x4bcfd X2[3], 0x4bd03 Y2[3], angle dword 0x4bd35.
- Texture pointer dword 0x4bcb5. Start (u0, v0) dwords 0x4bcd9/0x4bcdd = 0, never written.
- Divisors dwords 0x4bd21 = 0x4bd25 = 1024.

**0x4bbf0 `roto_reset()`** (called at 0x13086, part start):
- Layer 1: X1 = (0, 0x200, 0), Y1 = (0, 0, 0x200).
- Layer 2: X2 = (0, 0x400, 0), Y2 = (0, 0, 0x400).
- Also X = (0, 0x400, 0), Y = (0, 0, 0x400).
- Angles [0x4acb2] = [0x4acb6] = [0x4acba] = 0.
- [0x4bd31] and [0x4bd35] are **not** reset (initial 0 in the image).

**0x4bbbd `roto_tick()`**: called from the part-5 tick 0x13100 **every tick, unconditionally**:
- X1[1] += 3, Y1[2] += 3 (16-bit wrap).
- X2[1] += 2, Y2[2] += 2.
- [0x4bd31] += 1, [0x4bd35] -= 2.

**0x4bb3f `roto_draw(tex=eax)`** (called at 0x130cd): [0x4bcb5] = tex, then for each layer L in (1, 2):
1. X = XL; Y = YL.
2. [0x4acba] = angle_L. [0x4acb2] and [0x4acb6] stay 0 from roto_reset.
3. 0x4b90c computes the gradients.
4. 0x4ba10 draws.

**0x4b90c**: for point j = 0..2, set [0x4870c] = X[j] and [0x48716] = Y[j]. Z = [0x48720] is left over from earlier calls but does not affect xr/yr when the other two angles are 0. Then call rotate_project. With A = B = 0 and Γ = a:
- `Xr[j] = -((X*C[a] - Y*S[a]) >> 7)`
- `Yr[j] = -((X*S[a] + Y*C[a]) >> 7)`

Then (each value is `((d << 16) / 1024)` with a sign-extended dividend, which equals d*64 exactly):

```
dudx = (Xr1 - Xr0)*64 ; dvdx = (Yr1 - Yr0)*64     // [0x4bcc1], [0x4bcc5]
dudy = (Xr2 - Xr0)*64 ; dvdy = (Yr2 - Yr0)*64     // [0x4bcd1], [0x4bcd5]
```

Point 0 is (0, 0), so Xr0 = Yr0 = 0.

**0x4ba10**: draws an **additive** 160x100 grid of 2x2 blocks over the whole screen. The texture address is patched into the instruction at 0x4bab2 (self-modifying code).

```
u = 0; v = 0                                   // 16.16
for r in 0..99:
    U = u >> 8; V = v >> 8; sU = dudx >> 8; sV = dvdx >> 8      // all arithmetic
    p = 640*r
    for c in 0..159:
        t = tex[ (((V >> 8) & 0xff) << 8) | ((U >> 8) & 0xff) ] >> 1    // 256x256 texture
        fb[p] += t; fb[p+1] += t; fb[p+320] += t; fb[p+321] += t       // byte adds, wrap
        U += sU; V += sV; p += 2
    u += dudy; v += dvdy
```

Both layers use the same texture and add on top of what is already in fb (the caller clears or draws first).

---

## 11. Title 3D mesh: 0x4e611 `draw_mesh_textured(tex=eax)` and its filler 0x4de50

Only caller: 0x12456 (title render 0x12390), after a set_camera at 0x12447.

Object: 150 vertices at 0x4e878 (8 dwords `x, y, z, u, v, nx, ny, nz`, coordinates 20.12, u and v 16.16) and 192 faces at 0x4fb3c (4 u16, ends at a == 0x7fff). The texture pointer is patched into the instruction at 0x4e5ce.

```
angles = ([0x1f7438], [0x1f743c], [0x1f7440])    // room/title variables; 0x121d0 sets them to 0, 0xe6, 0;
                                                 // 0x124a8..0x124b8 animates [0x1f7440]
for i in 0..149:
    X = int16(x >> 12); Y = int16(y >> 12); Z = int16((z >> 12) - 1200)   // [0x5090e] = -1200
    U[i] = int16(u >> 16); V[i] = int16(v >> 16)          // 0x5045e, 0x505ee
    rotate_project(); SX[i] = sx; SY[i] = sy              // 0x5013e, 0x502ce
    s = ((-zr) >> 4) + 80 ; s = (s >= 30) ? 30 : (s <= -20 ? -20 : s)
    SH[i] = s                                             // 0x5077e (can be negative); the normals are loaded but unused
for f in 0..191 in TABLE ORDER (no depth sort):
    slots k = 0..2 <- vertex a, b, c: x = SX, y = SY, c = SH, u = U, v = V   (high words)
    if face_area() >= 0: fill_textured()                  // dl != 1. This is the opposite rule to the star.
    byte[0x4e877] ^= 1                                    // unused toggle
```

**0x4de50 `fill_textured()`**. The vertex slots are: x at +0, y at +4, c at +0xc, u at +0x10, v at +0x14 (all 16.16 with zero fraction).

```
sort by y exactly like 0x41f65, swapping x, y, u, v, c
if (y0>>16 as int16) > 200 return ; if (y2>>16) < 0 return             // word compares of the high words
if x0 > 320 and x1 > 320 and x2 > 320 return ; if x0 < 0 and x1 < 0 and x2 < 0 return
y = y0 >> 16 ; h = int16((y2-y0) >> 16) ; if h == 0 return             // the row counter is a 16-bit word
d1 = (y1-y0)>>16 ; d2 = (y2-y0)>>16 = h
dXa,dUa,dVa,dCa = (X1-X0, U1-U0, V1-V0, C1-C0) / d1    (each: divide only if d1 != 0, else keep the difference)
dXb,dUb,dVb,dCb = (X2-X0, U2-U0, V2-V0, C2-C0) / d2
t = trunc(D*65537/H) as in 0x41f65
Xm = (((X2-X0)*t) >> 16) + X0 ; Um, Vm, Cm likewise
for (W, P) in (U, dudx), (V, dvdx), (C, dcdx):
    num = Wm - W1 ; den = Xm - X1
    if den < 0: den = -den; num = -num
    den >>= 16 ; q = den ? num/den : num ; P = int16(q >> 8)           // 8.8, patched into the code as imm16
xa=xb=X0 ; ua=ub=U0 ; va=vb=V0 ; ca=cb=C0
repeat (16-bit counter h):
    if y == y1>>16: xa=X1; ua=U1; va=V1; ca=C1 ; d=(y2-y1)>>16 ;
                    dXa,dUa,dVa,dCa = (X2-X1, U2-U1, V2-V1, C2-C1)/d (if d != 0)
    if y >= 200: return
    xa += dXa; xb += dXb; ua += dUa; ub += dUb; va += dVa; vb += dVb; ca += dCa; cb += dCb    // pre-step
    if y >= 0:
        L = xa>>16, R = xb>>16 ; (us, vs, cs) = (ua, va, ca)
        if L > R: swap(L, R); (us, vs, cs) = (ub, vb, cb)
        n = R - L
        if n > 0 and R > 0 and L < 320:
            p = rowoff[y] + L
            if R >= 320: n -= R - 320
            U16 = (us >>> 8) & 0xffff ; V16 = (vs >>> 8) & 0xffff ; C16 = (cs >>> 8) & 0xffff
            if L < 0: k = -L; p += k; n -= k; repeat k: U16 += dudx, V16 += dvdx, C16 += dcdx   (16-bit wraps)
            repeat n:
                fb[p++] = (tex[((V16 >> 8) << 8) | (U16 >> 8)] + (C16 >> 8)) & 0xff
                U16 = (U16 + dudx) & 0xffff ; V16 = (V16 + dvdx) & 0xffff ; C16 = (C16 + dcdx) & 0xffff
    y++
```

The texture is addressed as 256x256 (v*256 + u, wrapping at 256 in each axis). The shade is added to the texel index. The shade is the high byte of an 8.8 value and can be negative: -20 gives +236 mod 256.

---
## 12. Second 3D engine (0x4f000..0x66000, not in the listing)

This is a hand-written asm "multi-object gouraud renderer" that lives in the data object and is missing from `outside.lst`. It was disassembled with capstone. It reuses the helpers documented above: **0x4230d** (rotate and project one point), **0x424ff** (point-light dot product), **0x424ac** (signed area / back-face test) and **0x41f65** (gouraud triangle filler, opaque, colour = high byte of an 8.8 shade). Nothing in it is additive or transparent. Every pixel is a plain store done by 0x41f65.

Depth ordering is **not** a quicksort here. It uses a **256-bucket sort** on the face's maximum rotated z.

There are three entry points, plus two internal routines:

| entry | called from | objects drawn |
|---|---|---|
| 0x52dbd | text part render 0x135b0 (call at 0x1362a) | object TA (verts 0x5742d, faces 0x5a631) then object TB (verts 0x530d7, faces 0x5631b), sorted together |
| 0x52f12 | landscape render (call at 0x14094) | object L1 (verts 0x5b6c3, faces 0x617a7) |
| 0x53024 | landscape render (call at 0x14099, right after 0x52f12) | object L2 (verts 0x644a9, faces 0x6514d) |
| 0x52a4c | internal | transform one object and insert its faces into the buckets |
| 0x52c83 | internal | draw all buckets far to near, then reset |

All five routines take no register arguments. 0x52dbd, 0x52f12 and 0x53024 do pushal/pushfd and popfd/popal, so they preserve every register. 0x52a4c and 0x52c83 clobber registers.

### Object data (constant, in the EXE image; copy it from mem.bin)

The four tables are contiguous: TB verts 0x530d7, TB faces 0x5631b, TA verts 0x5742d, TA faces 0x5a631, L1 verts 0x5b6c3, L1 faces 0x617a7, L2 verts 0x644a9, L2 faces 0x6514d, then globals at 0x6578f.

- **Vertex record**: 32 bytes, 8 signed dwords `x, y, z, u, v, nx, ny, nz`.
  - Coordinates use 20.12 fixed point (the code takes `>>12`).
  - The normal is 16.16 (about unit length × 65536).
  - u and v are present but **unused** by this engine.
  - The list ends with a record whose `x == 0x7fffffff`.
- **Face record**: 8 bytes, 4 u16 `a, b, c, 0`. These are vertex indices local to the object. The list ends when `a == 0x7fff`. The 4th word is always 0 and is unused.

| object | verts | faces | model extent (x, y, z after >>12) | base colour [0x65798] | model offset (0x6579a, 0x6579e, 0x657a2) | shade clamp max/min | depth cue [0x6578f] |
|---|---|---|---|---|---|---|---|
| TA | 400 | 530 | ±1732, ±540, ±80 | 0xad | (140, 0, 0) | 30 / 5 | 0 |
| TB | 402 | 546 | ±1732, ±540, ±80 | 0x94 | (0, 0, 0) | 30 / 5 | 0 |
| L1 | 775 | 1440 | ±3462, ±3393, ±630 | 0xa0 | (0, 0, -800) | 95 / 5 | 1 |
| L2 | 101 | 200 | ±665, ±534, ±449 | 0x40 | (0, 0, +800) | 90 / 5 | 0 |

The resulting palette index ranges are:
- TA: 0xb2..0xcb
- TB: 0x99..0xb2
- L1: 0xa5..0xff
- L2: 0x45..0x9a

### Globals

**Inputs set by the entry points:**

- `[0x65790]` (dword): vertex table pointer.
- `[0x65794]` (dword): face table pointer.
- `[0x65798]` (word): base colour added to the shade.
- `[0x6579a]`, `[0x6579e]`, `[0x657a2]` (signed dwords): model-space offset (ox, oy, oz). It is added to each vertex after `>>12` and before rotation.
- `[0x1ee899]` (dword): shade upper clamp.
- `[0x1ee89d]` (dword): shade lower clamp.
- `[0x6578f]` (byte): depth-cue flag.
- Rotation angles `[0x4acb2]`, `[0x4acb6]`, `[0x4acba]`: the angle inputs of 0x4230d, each masked `&0x3ff` there.
- Camera `[0x42a3b]`, `[0x42a3f]`, `[0x42a43]`: projection offsets of 0x4230d, set by 0x42a25.
- Light vector words `[0x44ee8]`, `[0x44eea]`, `[0x44eec]`: read by 0x424ff.

**Engine state:**

- `[0x657a6]` (dword) = **2 × B**, where B is the number of vertices already transformed in this batch (B = 0 for the first object of a batch). It is used as a byte offset into the word arrays. It is reset to 0 at the end of 0x52c83 and by 0x52dbd.
- `[0x1ee8cc]` and `[0x1ee8d0]`: loop offsets (scratch).
- `[0x1ee880]`, `[0x657aa]`, `[0x657ae]`, `[0x657b2]`: written only and never read in a way that matters. `[0x657b2]` accumulates the vertex count. `[0x657aa]` is set to 4.
- **0x1ee47a**: 256 u16 **bucket counters** (512 bytes, cleared with `rep stosd` 0x80 dwords).
- Per-vertex arrays, indexed by global vertex g = B + i. They persist across calls and frames and are never cleared:
  - `sx`: word at 0x657da + 2g
  - `sy`: word at 0x6677a + 2g
  - `shade`: word at 0x6771a + 2g
  - rotated x: dword at 0x686ba + 4g
  - rotated y: dword at 0x6a5fa + 4g
  - rotated z: dword at 0x6c53a + 4g
- Bucket entry arrays: three u16 arrays of 256 × 1024 entries at 0x6e47a, 0xee47a and 0x16e47a. Entry `e = bucket*1024 + slot`. Each entry holds the **byte offset** (2 × global vertex index) of face vertex a, b and c.

None of these addresses is touched by the demo code (checked by an absolute-address scan of the whole image).

### 0x52a4c: transform one object and bucket its faces

```
B2 = [0x657a6]                      // = 2*B
for i = 0..; rec = vtab + 32*i; if rec.x == 0x7fffffff break:
    X = int16((rec.x >> 12) + ox)    // sar (arithmetic), 32-bit add, truncated to word
    Y = int16((rec.y >> 12) + oy)
    Z = int16((rec.z >> 12) + oz)
    N = (rec.nx, rec.ny, rec.nz)     // -> [0x48634],[0x48638],[0x4863c]
    call 0x4230d with (X,Y,Z) in [0x4870c],[0x48716],[0x48720]
    g2 = 2*i + B2
    sx[g2/2] = word [0x4872a]; sy[g2/2] = word [0x4872c]
    xr[g] = [0x48712]; yr[g] = [0x4871c]; zr[g] = [0x48726]     // address = base + 2*g2
    s = 0x424ff()                    // uses X,Y,Z (offset already added, unrotated) and N; returns -(sum)>>6
    if [0x6578f] != 0: s += (zr_this >> 4) + 0x50      // zr_this = [0x48726], sar
    if s >= max: s = max             // signed compares
    if s <= min: s = min
    shade[g] = int16(s + [0x65798])  // 16-bit add
n = number of vertices (the code keeps 2n)

for each face f (face table offset 8f) while a != 0x7fff:
    // DEPTH KEY BUG: the index is a + B2 (= a + 2B), NOT a + B
    za = zr[a + B2]; zb = zr[b + B2]; zc = zr[c + B2]       // dword at 0x6c53a + 4*(idx + 2B)
    zmax = max(za, zb, zc)                                    // signed
    bucket = ((-(zmax >> 6)) + 0x80) & 0xffff                 // sar 6, neg, +128
    slot = cnt[bucket]; cnt[bucket] += 1                      // u16 counters at 0x1ee47a
    e = bucket*1024 + slot
    A[e] = 2a + B2; Bv[e] = 2b + B2; C[e] = 2c + B2           // these are correct (= 2*(local+B))
[0x657a6] += 2n                                                // B += n
```

**The depth key bug:** the key uses index a + 2B where a + B was meant. It only matters when B > 0, which happens only for **TB**, the second object of the text batch (B = 400). Each 0x52c83 resets B to 0, so L1 and L2 in the landscape each run with B = 0 and their keys are correct.

For TB the keys read zr[800 + a] for a in 0..401:

- Indices 800 and 801 are TB's own vertices 400 and 401 (current frame).
- Indices 802..1201 are never written by any code. Every batch writes at most indices 0..801. They are zero in the image and in BSS, so they are always **0**.
- So a TB face key is max of zr[800+a], zr[800+b], zr[800+c], where only the vertex-400 and vertex-401 values are nonzero.
- Most TB faces therefore land in bucket 128 (key 0) and are drawn in face order.
- A port reproduces this exactly by keeping one zr array of at least 1202 entries, initialised to 0.

A bucket outside 0..255 would corrupt memory. The model extents keep zmax within about ±5700, so this does not happen. A bucket with more than 1024 entries would spill into the next bucket's slots. That should also not happen, but note that in the text batch most of TB's faces share a few buckets.

### 0x52c83: draw the buckets, far to near

```
for bucket = 0..255:                       // bucket 0 = largest z = farthest (projection divides by z+camZ+5000)
    slot = 0
    while int16(cnt[bucket]) > 0:          // signed word test
        e = bucket*1024 + slot
        for k, (sxw, syw, shw) in vertices A[e], Bv[e], C[e]:     // byte offsets into the word arrays
            vertex k of the filler: word x at 0x486ae/0x486c6/0x486de = sx,
                                    word y at 0x486b2/0x486ca/0x486e2 = sy,
                                    word shade at 0x486ba/0x486d2/0x486ea = shade
            (the low words 0x486ac.. stay 0, so each value is v<<16)
        dl = 0x424ac()                      // dl = 1 if (y3-y2)*(x2-x1) - (y2-y1)*(x3-x2) < 0
        if dl != 1: 0x41f65()               // draws when area >= 0 (opposite rule to the star in 0x42657)
        cnt[bucket] -= 1; slot += 1
[0x657a6] = 0; [0x657aa] = 4; [0x657ae] = 0; [0x657b2] = 0
```

Within a bucket, faces are drawn in insertion order: object order, then face order. Every counter is back at 0 afterwards, so the buckets are empty for the next batch.

### Entry 0x52dbd (text part)

1. Angles = `[0x1ee88d]`, `[0x1ee891]`, `[0x1ee895]`, which go to `[0x4acb2]`, `[0x4acb6]`, `[0x4acba]`. **Nothing ever writes these three dwords, so they are always 0.**
2. Rotate the light model vector (0, −30000 (0x8ad0), 0) with 0x4230d. Store the words of `[0x48712]`, `[0x4871c]` and `[0x48726]` to `[0x44ee8]`, `[0x44eea]` and `[0x44eec]`.
   - With all angles 0, and with the tables S[0] = 0 and C[0] = −128, the result is **L = (0, −30000, 1)**. The z comes out 0 and 0x4230d forces a zero z to 1.
3. Object angles = `[0x1fd790]`, `[0x1fd788]`, `[0x1fd740]`, which go to `[0x4acb2]`, `[0x4acb6]`, `[0x4acba]`. These are text-part variables: initialised at 0x13570..0x1357c and animated at 0x137da..0x1380c.
4. Clear the 256 bucket counters. Set `[0x657a6]`, `[0x657aa]` and `[0x657ae]` to 0. Clamp max = 30, min = 5. Depth cue off.
5. Run 0x52a4c on TA: colour 0xad, offset (140, 0, 0).
6. Run 0x52a4c on TB: colour 0x94, offset (0, 0, 0). B = 400 here, so the depth key bug applies.
7. Run 0x52c83.
   - The camera is **not** set here. It is whatever the text part last passed to 0x42a25 (the call at 0x13625, just before).

### Entry 0x52f12 (landscape, first object)

1. Light model vector (0, −10000 (0xd8f0), 0), rotated with angles `[0x1fe42c]`, `[0x1fe424]` and `[0x1fe434]` (to `[0x4acb2]`, `[0x4acb6]`, `[0x4acba]`). The result goes to `[0x44ee8..]`.
   - `[0x1fe42c]` and `[0x1fe424]` are never written, so they are 0.
   - Only `[0x1fe434]` (az) is animated, by the landscape at 0x140d9/0x1410f.
2. Object angles = `[0x1fe410]`, `[0x1fe418]`, `[0x1fe428]`.
3. Clear the bucket counters. Note that `[0x657a6]` is not reset here; it relies on the reset at the end of the previous 0x52c83, so it is 0.
4. Object L1: colour 0xa0, offset (0, 0, −800), clamp max 95, min 5, **depth cue on**. The shade becomes `clamp(light + (zr>>4) + 80, 5, 95) + 0xa0`.
5. **Camera forced to (0, 0, 0)**: `[0x42a3b]`, `[0x42a3f]` and `[0x42a43]` are set to 0.
6. Run 0x52a4c, then 0x52c83.

### Entry 0x53024 (landscape, second object, drawn after L1 and so on top of it)

1. Angles:
   - `[0x4acb2]` = `[0x1fe410] + [0x1fe41c]`
   - `[0x4acb6]` = `[0x1fe418] + [0x1fe414]`
   - `[0x4acba]` = `[0x1fe428] + [0x1fe420]`
2. The light is not recomputed. It is still the light from 0x52f12.
3. Object L2: colour 0x40, offset (0, 0, +800), clamp max 90, min 5, depth cue off.
4. Camera = `[0x1fe3fc]`, `[0x1fe3f4]`, `[0x1fe3f8]`, which go to `[0x42a3b]`, `[0x42a3f]`, `[0x42a43]`. The landscape sets these at 0x13fc7, 0x1402d and 0x13feb.
5. The buckets are not cleared; they are already empty from 0x52f12's 0x52c83. B = 0 at entry.
6. Run 0x52a4c, then 0x52c83. B = 0, so the depth keys are correct.

### Shading recap (0x424ff as used here, no extra >>3 unlike the star)

```
s = -( ((Lx - X)*nx >> 16) + ((Ly - Y)*ny >> 16) + ((Lz - Z)*nz >> 16) ) >> 6
```

- The differences `L - V` are computed in int16 (16-bit wrap) and then sign-extended.
- Each product is a 64-bit signed multiply, and `>>16` takes the low 32 bits of the arithmetic shift.
- The final `>>6` is arithmetic.
- X, Y, Z are the unrotated model coordinates with the object offset already added.

---

## 13. Global variables owned by the core (BSS initial value 0 unless noted)

| addr | meaning | value |
|---|---|---|
| 0x1f6740 | ptr to the 65536-word 1/x table (unused) | malloc |
| 0x1f6744 | frame buffer pointer (= [0x1f6ab0]) | from 0x11440 |
| 0x1f6748 | MIDAS module handle | |
| 0x1f674c | /c flag (run the sound setup) | 0/1 |
| 0x1f6750 | ptr to rowoff[200] (dword, 320*y) | malloc |
| 0x1f6754 | current part index (0..7), selects tick and render | 0 |
| 0x1f6758 | saved PIC mask (port 0x21) | |
| 0x1f675c | display refresh rate from MIDAS | |
| 0x1f6760..0x1f6790 | tunnel module | see section 4 |
| 0x1f6ab0 | frame buffer (malloc 128000) | |
| 0x1f6ab8 | SVGA bank-switch kind | 0 (mode 13h) |
| 0x1f6ac8 | frame size | 64000 |
| 0x1f6ad4 | requested mode | 0xa |
| 0x1f6ad8 / 0x1f6adc / 0x1f6ae0 / 0x1f6ae4 | pitch / width / height / bpp | 320 / 320 / 200 / 8 |
| 0x4b894 / 0x4b898 / 0x4b8a4 | VESA-flip / plain-mode-13h / alt flag | 0 / 1 / 0 |
| 0x1f8424 + 4k | sine table, 5120 dwords (16.16) | 0x13140 |
| data object | 3D engine globals | see sections 9-12 |

## 14. Checks and open questions

Verified against the recording:
- **Tunnel renderer 0x4162c, set_palette 0x12010 and the DAC→RGB conversion**: frames 500 and 631 match in 64000/64000 pixels with TUNNEL4, TEXTURE2, the palettes described in section 4, brightness -1, and offset 0x101*frame. Frames 352, 355 and 450 match fully as well.
- **Recording offset**: callback count = frame index (from the tunnel offset). Part-0 start at about frame 16 (from the overlay at frame 777 and the brightness steps), with a 2-3 tick discrepancy in the 0x202 phase noted in section 6.
- The screen is black for frames 0..270. The first visible pixel is in frame 271.
- No duplicate consecutive frames during the title tunnel. Some frames match only about 98-99%, which is likely tearing because flip() is not synchronised.
- The audio track of cap.avi is entirely silent, so no music timing can be measured from it.

Verified by computation:
- LBM decoding of all 26 picture files.
- The 1/x table formula (exhaustive).
- The sine table (x87 64-bit, x87 53-bit and JS double all agree).

Not verified against frames (the part readers can check them in their scenes):
- Star 0x42657 / 0x41f65.
- Rotozoomer 0x4ba10.
- Title mesh 0x4e611 / 0x4de50.
- Engine #2.

Open:
1. The 0x202-phase discrepancy around frames 777..790 (section 6). Possible causes: a render/tick phase shift, or the palette being written before the flip (the DAC change shows on the old image).
2. The star's light advances per render. If the original rendered more than once per tick in that part, the light turned faster than one step per tick. Check in the credits part.
3. 0x42657's pivot depends on the never-written dword [0x47fb0] = 0. Confirmed by an absolute-address scan; a runtime write through a computed pointer cannot be ruled out statically.
4. The SVGA paths (VESA modes, banked flips, 0x4acc2...) are not documented, because only mode 0xa (13h) is used.
