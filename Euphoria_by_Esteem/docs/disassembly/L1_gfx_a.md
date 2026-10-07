# L1 gfx_a: segment 186a, 0000..1d02 (graphics library unit, first half)

## Summary

This range is the core of the graphics unit. It contains:
- a fatal-error routine
- the sin/cos tables (float32 and int*128)
- text-screen save and restore
- BIOS and VESA mode setting, the clip rectangle and the per-scanline offset table
- the palette layer: a shadow palette of int16 r,g,b, set/lock/unlock, gradient, rotate, add, time-based fade and step-based fade
- the "page" (64000-byte off-screen buffer) manager: pages in conventional memory or EMS, the active page pointer, copy, transparent copy, max-blend, clear, fill and present
- putpixel and getpixel, hline, vline, line (unclipped and clipped), filled rectangle, and a tiny 4x4 "dot" sprite
- VESA helpers: detect, bank switch, display start, VESA double-buffer toggle, clear all video memory

**Rendering model (important for the port).** Everything draws into the **active page** (far pointer `DS:5c22`).
- The active page is a linear 8-bit buffer. Its stride is `width` (`DS:5bf0`): 320 in mode 13h.
- Pixel address = `activePage + lineOfs[y] + x`, where `lineOfs` is a longint table at `DS:9122`. Only the low word is used, so for 320x200 it is simply `y*320 + x`.
- Page 0 is the screen itself (`A000:0000`, ptr `DS:5d7a`).
- Page 1 is normally the back buffer.

**How a frame reaches the screen:** `186a:14d1` copies 64000 bytes from the active page to `A000:0000` (rep movsd).
- **No retrace wait** inside it. The separate retrace wait is `186a:040b` (wait for the end of the current vertical retrace, then the start of the next one; port `3DA` bit 3). Callers decide whether to call it.
- The mode-X paths (flag `DS:5c02`) are dead code: `5c02` is only ever set to 0.
- VESA-mode drawing (bank switching) uses `1b75` etc. The VESA pixel writers themselves live after 1d02 (not in this slice).

**Palette:**
- Every palette write goes through `setColor` (`047d`). It writes the DAC (port `3C8` index, `3C9` r, g, b, 6-bit) with each component **clamped to 0..63**. The clamp is skipped entirely, and nothing is written, while the palette is "locked" (`DS:6398 = 1`).
- It always stores the **unclamped** int16 values into the shadow palette `DS:5d98` (256 entries * 6 bytes: r, g, b as int16).
- Fades work on the shadow palette, so values can go negative or above 63. That matters: a fade from "orig-64" up to orig shows black until the value passes 0.

## External calls

| call | meaning |
|---|---|
| 1cd9:0177(3) | CRT TextMode(3) (GUESS: CRT unit) |
| 1cd9:027d(n) | CRT TextBackground(n) (GUESS) |
| 1cd9:0263(n) | CRT TextColor(n) (GUESS) |
| 1d81:3a74 / 3a02 | Write(string) / WriteLn to Output (`DS:a4da` = Output text record) |
| 1d81:0116 | Halt (AX = exit code 1) |
| 1d81:32ba / 32bf | Sin / Cos (ST0) |
| 1d81:3275 | Round ST0 -> longint DX:AX (round-half-even) |
| 1d81:3d8f | longint multiply |
| 1d81:3d77, 4993 | Move(src, dst, count) |
| 1d81:028a / 029f | GetMem / FreeMem |
| 1d81:02e7 | MaxAvail (longint) |
| 1d81:4651 | **Longint (DX:AX) -> Real48 (DX:BX:AX)** in this slice (not FillChar) |
| 1d81:31e5 / 320f | Real48 -> ST0 / ST0 -> Real48 |
| 1d81:40cf, 40f9, 410f, 41a4, 41c0, 4164, 4184 | Pascal set ops: load set, empty set, set element, union (Include), difference (Exclude), store set, bit mask for an element (`n in set`) |
| 1d81:3eb8, 3f37, 3fd4, 3ed2, 3fa9 | string load, concat, char->str, store, compare |
| 1d45:0382 | IntToStr-like (longint -> string). GUESS: Str wrapper in a utility unit |
| 1d3b:0036 | DOS unit Intr(intno, var Registers) |
| 1c34:0009 / 00a5 / 01b7 / 0244 / 02a1 / 031b | EMS object (instance `DS:5c04`): detect / pages free / map handle -> far ptr / allocate N pages / copy handle -> handle / free |
| 1cbc:00a7 / 00ce | timer: mark(var t) / elapsed(var t) in 10 ms ticks |

## Globals (DS offsets)

| addr | type | name / meaning |
|---|---|---|
| 2522 | word[5] | VESA/BIOS mode numbers: 13h, 100h, 101h, 103h, 105h |
| 252c | {w,h:int16}[5] | 320x200, 640x400, 640x480, 800x600, 1024x768 |
| 2540 | word[5] (low byte used) | bank offset of VESA "page 1": 0, 3, 5, 7, 8 (64 KB banks) |
| 254a | word[5] | display-start X for showing page 1: 0, 0, 0, 0x163 (355), 0 |
| 2554 | word[5] | display-start Y for showing page 1: 0, 0, 0x200 (512), 0x23d (573), 0x200 |
| 255e | byte = 100 | highest page number kept in conventional memory. Pages > 100 go to EMS. Set to 0 at init if there is no EMS. |
| 2560 | {r,g,b:int16}[16] | default EGA text palette (6-bit): 0,0,0 / 0,0,2a / 0,2a,0 / 0,2a,2a / 2a,0,0 / 2a,0,2a / 2a,2a,0 / 2a,2a,2a / 15,15,15 / 15,15,3f / 15,3f,15 / 15,3f,3f / 3f,15,15 / 3f,15,3f / 3f,3f,15 / 3f,3f,3f |
| 2614 / 2618 | word | segment constants A000h / B800h (`DS:2610` = 1000h, 40h, A000h, B000h, B800h) |
| 5bec | byte | current mode index 0..4 |
| 5bee | word | BIOS/VESA mode number last set |
| 5bf0 / 5bf2 | int16 | screen width / height |
| 5bf4 / 5bf6 | int16 | centerX = width div 2, centerY = height div 2 (idiv, signed) |
| 5bf8 | word | VESA total memory in 64 KB units (VbeInfo byte +0x12, low byte only) |
| 5bfa, 5bfc, 5bfe, 5c00 | int16 | clip rectangle left, top, right, bottom (all INCLUSIVE) |
| 5c02 | byte | mode-X flag (always 0: mode-X code is dead) |
| 5c03 | byte | VESA present (1ab1 always returns 1, so always 1) |
| 5c04 | object | EMS manager instance (unit 1c34). `5c08` = its next-page counter (GUESS) |
| 5c1c | byte | EMS available |
| 5c1e | word | EMS free pages (the init requires >= 0x67 = 103) |
| 5c20 | byte | active page number |
| 5c22 | far ptr | active page pointer (draw target) |
| 5c26 | far ptr | = A000:0000 (set at init; usage not in this slice) |
| 5c2a | far ptr[256] | conventional page pointers (`[0]` = A000:0000) |
| 5cf4 | word[] | EMS handle for page n, index n-100 |
| 5d5a | set of byte (32 bytes) | allocated pages |
| 5d7a | far ptr | screen = A000:0000 |
| 5d7e | far ptr | text screen = B800:0000 |
| 5d82 / 5d86 | far ptr | mode-X draw / display page (A000:0000 / A000:4000); dead code |
| 5d8a | far ptr | saved text screen buffer (GetMem 0xfa2) |
| 5d8e | byte | current VESA bank (cache) |
| 5d91 | byte | VESA bank offset of the current draw page (0 or table 2540) |
| 5d92 | byte | VESA double-buffer toggle state |
| 5d95 / 5d96 | byte | saved text cursor column / row |
| 5d98 | {r,g,b:int16}[256] | **shadow palette** (unclamped) |
| 6398 | byte | palette locked (1 = setColor does not touch the DAC) |
| 639a | byte[17] | saved EGA attribute palette registers (INT 10h AX=1009h) |
| 63ac | far ptr | step-fade work struct (0x2404 bytes), nil if none |
| 63b0.. | float32 | sinF[i] at `0x6950 + 4*i`, i = -360..720 |
| 7a34 | float32 | cosF[i] at `0x7a34 + 4*i`, i = -360..720 |
| 8578 | int16[721] | sinI[i] = round(sin(i°)*128), i = 0..720 |
| 8b1a | int16[721] | cosI[i] = round(cos(i°)*128), i = 0..720 |
| 911a | far ptr | hline hook used by fillRect; init sets it to 186a:1689 (clipped solid hline) |
| 9122 | int32[height+1] | lineOfs[y] = y*width |
| 9fa5 | byte | set to 1 by fatalError (meaning unknown; GUESS "aborted") |
| a3ac | byte | if nonzero, timedFade (08bc) jumps straight to its end state. External flag (GUESS: skip/escape pressed) |

## Functions

### 186a:0000 fatalError(msg: string) far, retf 4
```
TextMode(3); TextBackground(1); TextColor(15);
WriteLn(msg); TextBackground(0); TextColor(7);
[9fa5] = 1; Halt(1);
```

### 186a:0078 initTrigTables() near (called from unit init)
`PI` = extended `cs:0066` = 3.141592653589793. Constants: `cs:0070` float32 180.0, `cs:0074` float32 128.0.
```
for (i = -360; i <= 720; i++) {          // int16
  a = (i * PI) / 180.0;                  // extended precision
  sinF[i] = (float32) sin(a);  cosF[i] = (float32) cos(a);
}
for (i = 0; i <= 720; i++) {
  sinI[i] = Round(sin(i*PI/180) * 128);  // round half to even, int16
  cosI[i] = Round(cos(i*PI/180) * 128);
}
```
Port: `Math.fround(Math.sin(i*Math.PI/180))`. The int tables use banker's rounding: exact .5 cases occur at i = 30, 150, etc. (sin = 0.5 -> 64, which is exact anyway).

### 186a:0142 saveTextScreen() far
Copies 0x7d0 words (4000 bytes) from B800:0 to the buffer at `[5d8a]`. Reads the cursor (INT 10h AH=3, page 0) into 5d95 (col) and 5d96 (row).

### 186a:0160 restoreTextScreen() far
Inverse of 0142: copies the buffer back and sets the cursor (AH=2).

### 186a:02b2: calls 0142. 186a:02bb: restore saved cursor position.

### 186a:02ca: save the cursor position, then set the cursor to column 1, row 0x1a (26).

### 186a:017e setBiosMode(m: byte) far
`[5bee] = m; INT 10h AH=0, AL=m; [5c02] = 0`.

### 186a:0194 setVesaMode(m: word) far
`[5bee] = m; INT 10h AX=4F02h, BX=m`.

### 186a:01a7 setMode(idx: byte) far (idx 0..4)
```
[5bec] = idx; vm = word[2522 + idx*2];
if (idx == 0) setBiosMode(vm) else setVesaMode(vm);
width = [252c+idx*4]; height = [252e+idx*4];
centerX = width/2; centerY = height/2;
setClip(0, 0, width-1, height-1);
buildLineTable();
```

### 186a:0229 setModeNoClear(idx) far
Same as 01a7, but BIOS mode `vm | 0x80` and VESA mode `vm | 0x8000` (keep the video memory).

### 186a:02e3 setBorderColor(c: byte) far
INT 10h AX=1001h, BH=c (overscan color).

### 186a:02f3 setClip(x1, y1, x2, y2: int16) far, retf 8
`[bp+0c]` = x1 -> left `5bfa`; `[bp+0a]` = y1 -> top `5bfc`; `[bp+8]` = x2 -> right `5bfe`; `[bp+6]` = y2 -> bottom `5c00`. All inclusive. No ordering check.

### 186a:0312 inClip(x, y): boolean far
`left <= x <= right && top <= y <= bottom` (signed compares).

### 186a:033d clipH (register routine)
In: SI = x, CX = len. Out: AH = visible (1/0), SI and CX adjusted.
```
ah = 1
if (x < left) { if (x+len < left) ah = 0; len -= (left - x); x = left; }
if (x > right) ah = 0;
else if (x + len > right) len = right - x + 1;      // correct inclusive clip
```

### 186a:0379 clipV (register routine)
In: DI = y, CX = len. Out: AH, DI, CX.
```
ah = 1
if (y < top) { if (y+len <= top) ah = 0; len = y + len - top; y = top; }
if (y > bottom) ah = 0;
if (y + len > bottom) len = bottom - y;              // QUIRK: no +1, so the bottom row of the clip is never drawn by a vline that crosses it
```

### 186a:03ae buildLineTable() far
For y = 0..height **inclusive**: `int32 lineOfs[y] = width * y` at `DS:9122 + 4*y`.

### 186a:040b waitRetrace() far
```
while (inb(0x3da) & 8) ;     // wait until we are out of the retrace
while (!(inb(0x3da) & 8)) ;  // wait for the start of the next retrace
```
This equals one call per displayed frame (70 Hz in mode 13h).

### 186a:0419 dacWrite(idx, r, g, b) near, ret 8
Args: `[bp+0a]` idx, `[bp+8]` r, `[bp+6]` g, `[bp+4]` b. If `[6398] == 1`, return. Otherwise clamp each of r, g, b to 0..63 (signed int16), then `out 3C8,idx; out 3C9,r; out 3C9,g; out 3C9,b`.

### 186a:047d setColor(idx: byte; r, g, b: int16) far, retf 8
`dacWrite(idx, r, g, b)`; then `pal[idx] = {r, g, b}` at `5d98 + idx*6`, **unclamped**. The store happens even while locked.

### 186a:04b4 lockPalette(): `[6398] = 1`.

### 186a:04be unlockPalette(): `[6398] = 0; setPalette(shadow 5d98)` (re-sends all 256 entries).

### 186a:04d1 setPalette(pal: array[0..255] of {r,g,b:int16}) far (value param of 0x600 bytes, copied)
For i = 0..255: `setColor(i, pal[i].r, pal[i].g, pal[i].b)`.

### 186a:053b setPaletteRange(first, last: byte; pal) far, retf 8
Args: `[bp+0c]` first, `[bp+0a]` last, `[bp+6]` pal. For i = first..last: `setColor(i, pal[i])`. The loop is skipped if first > last.

### 186a:05b9 saveEgaPalette() near
`Intr(10h, AX=1009h, ES:DX = DS:639a)`: reads 16 attribute registers plus overscan.

### 186a:05db restoreTextPalette() far
For i = 0..15: `setColor(egaRegs[639a+i], table2560[i])`.

### 186a:062a gradient(a, b: byte; r1, g1, b1, r2, g2, b2: int16) far, retf 0x10
Args: `[bp+14]` a, `[bp+12]` b, `[bp+10]` r1, `[bp+0e]` g1, `[bp+0c]` b1, `[bp+0a]` r2, `[bp+8]` g2, `[bp+6]` b2.
```
n = b - a                                  // int16
sr = (float32)((r2-r1)/n); sg = (float32)((g2-g1)/n); sb = (float32)((b2-b1)/n)
for (i = a; i <= b; i++) {
  t = (float32)(i - a)
  setColor(i, r1 + Round(t*sr), g1 + Round(t*sg), b1 + Round(t*sb))   // Round = half-even; low 16 bits
}
```
If a == b, this is 0/0 (FPU NaN, masked). The single entry would get r1 + Round(NaN), which yields the integer indefinite 0x8000 in the low word. Unclear; avoid that case.

### 186a:0729 rotatePalette(first, last, shift: int16) far, retf 6
Args: `[bp+0a]` first, `[bp+8]` last, `[bp+6]` shift.
```
tmp = copy of shadow 5d98
for (i = first; i <= last; i++) {
  j = i + shift
  if (j < first) j = last - (first - j) + 1
  if (j > last)  j = j - last + first - 1
  tmp[j] = shadow[i]           // entry i moves to i+shift (wrapping within [first..last])
}
setPalette(tmp)
```

### 186a:07cf addPalette(first, last, dr, dg, db: int16) far, retf 0x0a
For i = first..last: `setColor(i, shadow[i].r+dr, shadow[i].g+dg, shadow[i].b+db)`. This changes the shadow palette cumulatively.

### 186a:0836 setPaletteOffset(pal; first, last, dr, dg, db: int16) far, retf 0x0e
Args: `[bp+10]` pal (far ptr, copied), `[bp+0e]` first, `[bp+0c]` last, `[bp+0a]` dr, `[bp+8]` dg, `[bp+6]` db.
For i = first..last: `setColor(i, pal[i].r+dr, pal[i].g+dg, pal[i].b+db)`.

### 186a:08bc timedFade(first, last, dr, dg, db: int16; steps, duration: longint) far, retf 0x12
Args: `[bp+16]` first, `[bp+14]` last, `[bp+12]` dr, `[bp+10]` dg, `[bp+0e]` db, `[bp+0a..0c]` steps (int32), `[bp+6..8]` duration (int32, in 10 ms ticks).
```
base = copy of shadow palette; mark(t0)
if ([a3ac] == 0) {
  do {
    el = elapsed(t0)                                   // int32 ticks
    offR = Round( (float)(int32)(dr*el*steps) / duration )   // 32-bit products (wrap), FPU divide, round half-even, low word
    offG, offB likewise
    setPaletteOffset(base, first, last, offR, offG, offB)
  } while (el < duration)                              // signed 32-bit
}
setPaletteOffset(base, first, last, (int16)(dr*steps), (int16)(dg*steps), (int16)(db*steps))
```
This is a busy loop with no retrace wait, so it blocks for `duration` ticks. Typical use is dr = dg = db = ±1 with steps = 64 (a full fade).

### 186a:09ff fadeInFromBlack(duration: longint) far, retf 4
```
addPalette(0, 255, -64, -64, -64);   // shadow -= 64
unlockPalette();                     // re-send the shadow palette (clamped, so black)
timedFade(0, 255, 1, 1, 1, steps=64, duration);
```
Intended use: lockPalette, then setPalette(newPal) (stored only, nothing visible), then fadeInFromBlack(T).

### 186a:0a32 stepFadeInit(first, last: byte; var target: palette; steps: word) far, retf 0x0a
Args: `[bp+0e]` first, `[bp+0c]` last, `[bp+8]` target (far ptr, copied), `[bp+6]` steps.

Work struct at `[63ac]` (GetMem 0x2404 once, kept):
- `cur[256][3]` Real48 at +0 (18 bytes per entry)
- `delta[256][3]` Real48 at +0x1200
- `+2400` first (byte), `+2401` last (byte), `+2402` steps remaining (word)

```
store first, last, steps;  if (steps == 0) return
for i = first..last, c in (r,g,b):
   delta[i][c] = Real48( (target[i].c - shadow[i].c) / (float)steps )   // int16 diff, unsigned steps
   cur[i][c]   = Real48( shadow[i].c )
```

### 186a:0ca0 stepFadeStep(): boolean far
Returns 1 when finished. Otherwise it advances one step and returns 0.
```
if (steps remaining == 0) return true      // unsigned
tmp = copy of shadow
for i = first..last, c in (r,g,b): cur[i][c] = Real48(cur + delta);  tmp[i].c = Round(cur[i][c])  // half-even
setPalette(tmp); steps--; return false
```
Port: Real48 has a 40-bit mantissa, and the accumulation is rounded to Real48 at every step. Using doubles is close enough except near exact .5. GUESS: identical in practice.

### 186a:0e4c stepFadeFree(): FreeMem(work, 0x2404) if non-nil; `[63ac] = nil`.

### Page manager
Page = 64000 bytes (320x200). Page 0 = the screen, A000:0000. Pages 1..100 come from GetMem (conventional). Pages > 100 come from EMS (when present).
- **0e72 allocConv(n) near:** if `MaxAvail - 64000 > 1000` (signed 32-bit), then `page[n] = GetMem(64000)` (into 5c2a[n]) and return 1. Otherwise return 0.
- **0ebc freeConv(n) near:** FreeMem(page[n], 64000) if non-nil. The pointer is not cleared.
- **0f42 allocPage(n: byte) far:**
  - If n is already allocated or n == 0, return.
  - If n > 100 and EMS is available: call EMS allocate(4 pages) twice (the first result is ignored). On error: fatalError('EMS Error: Probably not enough EMS memory.'). Otherwise store `handle[n-100] = [5c08] - 4` and include n in the set.
  - Otherwise: if allocConv(n), include n. Else fatalError('Not enough memory to allocate page ' + n + '.').
- **1071 getPage(n): pointer far:** returns nil if n is not allocated. For n > 100 with EMS, maps n and returns a frame pointer. Otherwise returns `5c2a[n]`. Note that n = 0 is not in the set, so it returns nil unless the init added it (GUESS).
- **10e5 setActivePage(n) far:**
  - If n is allocated: active = getPage(n), `[5c20] = n`.
  - Else if n == 0: active = A000:0000.
  - Else: allocPage(n), activate it, and **fill it with 0** (148d(0)).
- **114d freePage(n) far:** if n is allocated: if n == active, setActivePage(0); then free it (EMS 1c34:031b or freeConv) and Exclude n.
- **13d4:** setActivePage(1). **13df:** freePage(1).
- **11ca copyDwords(src, dst: ptr; count: word) far:** copies count/4 dwords.
- **11e2 copyTransparent(src, dst, count) near:** for i < count: `if (src[i] != 0) dst[i] = src[i]`.
- **121e copyPage(src, dst: byte) far:** if either page is unallocated: fatalError('Page '+src+' or '+dst+' is not exist.'). If both > 100 and EMS: EMS copy. Otherwise copy 64000 bytes from getPage(src) to getPage(dst).
- **131a copyPageTransparent(src, dst: byte) far:** same as copyPage, but uses copyTransparent (color 0 = transparent).
- **13ea repackPage(page: byte; w, rows: int16) far, retf 6:** for r = 0..rows-1: `Move(page + r*320, page + r*w, w)`. This converts a 320-stride image in place into a packed w-stride image. The copy is forward, row by row.
- **144f clearActive():** fills 64000 bytes of the active page with 0.
- **146e clearScreen():** fills 64000 bytes at A000:0 with 0.
- **148d fillActive(c: byte):** fills the active page with c.
- **14af fillScreen(c):** fills A000:0 with c.
- **14d1 present() far:** copies 64000 bytes (movsd) from the active page to A000:0000. **No vsync.**
- **14f3 maxBlend(src, dst: ptr) far, retf 8:** for i = 0..63999: `dst[i] = max(src[i], dst[i])` (unsigned bytes).
- **1522 remapRange(page: byte; lo, hi: byte; shift: int16) far, retf 8:**
  ```
  p = getPage(page)
  for i = 0..63999: if (lo <= p[i] && p[i] <= hi) p[i] = (p[i] + shift) & 255
  rotatePalette(lo, hi + shift, shift)
  ```
  It moves the pixel indices and the palette together, so the picture looks unchanged while its colors now sit at lo+shift.
- **159c, 15b4, 15d1, 15e9** are mode-X CRTC start address, clear and flip routines. Dead code (5c02 is always 0).

### 186a:1620 setHLineHook(p: far proc)
`[911a] = p`. The default is 186a:1689.

### 186a:1634 putPixel(x, y: int16; c: byte) far, retf 6
Clipped against the clip rectangle. Writes `active[(uint16)(x + lineOfs[y])]`. The 16-bit offset wraps.

### 186a:166c getPixel(x, y): byte far
`active[lineOfs[y] + x]`. Not clipped.

### 186a:1689 hlineClipped (register routine, far)
In: ES:BX buffer, SI = x, DI = y, CX = len, AL = color.
If `top <= y <= bottom`, call clipH. If it is visible and len >= 1, fill `buf[lineOfs[y]+x .. +len-1]` with AL.

### 186a:1732 vlineClipped (register routine, near)
SI = x, DI = y, CX = len, AL = c, ES:BX = buf.
If `left <= x <= right`, call clipV (with the bottom-row quirk). If len >= 1, plot len pixels downward with stride = width.

### 186a:1765: AX = abs(AX).

### 186a:176d lineNoClip(x1, y1, x2, y2: int16; c: byte) far, retf 0x0a
Args: `[bp+0e]` x1, `[bp+0c]` y1, `[bp+0a]` x2, `[bp+8]` y2, `[bp+6]` c. Only called from 185f, which guarantees y1 <= y2 for sloped lines.
```
h = |y1-y2|+1;  w = |x1-x2|+1
if (h == 1) { hlineClipped(x=x1, y=y1, len=w); return }        // starts at x1 even if x1>x2 (185f sorts first)
if (w == 1) { vlineClipped(x=x1, y=min(y1,y2), len=h); return }
p = lineOfs[y1] + x1        // 16-bit offset into the active page
if (w > h) {   // x-major
   frac = low16( trunc( ((y2-y1+1) << 16) / w ) )   // 32-bit signed idiv
   dx = (x1 < x2) ? +1 : -1; acc = 0 (uint16)
   repeat w times: plot(p); p += dx; acc += frac; if carry(acc) p += width
   // pixel k: x = x1 + k*dx, y = y1 + floor(k*frac / 65536)
} else {       // y-major (h >= w)
   step = trunc( ((x2-x1+1) << 16) / h )            // int32, note +1 even when x2<x1 (asymmetry)
   pos = 0 (int32)
   repeat h times: plot(p); pos += step  -> p = lineOfs[y1]+x1 + k*width + (pos >> 16, floor)
   // pixel k: y = y1 + k, x = x1 + floor(k*step / 65536)
}
```
No clipping here.

### 186a:185f line(x1, y1, x2, y2: int16; c: byte) far, retf 0x0a (clipped line, 9 callers)
```
if (x1 == x2) goto draw
if (x1 > x2) swap(P1, P2)
if (y2 - y1 == 0) goto draw
slope = (y2-y1) / (x2-x1)                    // extended
if (x1 < left)  { if (x2 < left)  return; y1 += fistp((left  - x1) * slope); x1 = left }
if (x2 > right) { if (x1 > right) return; y2 += fistp((right - x2) * slope); x2 = right }
if (y1 > y2) swap(P1, P2)
if (y1 < top)    { if (y2 < top)    return; x1 += fistp((top    - y1) / slope); y1 = top }
if (y2 > bottom) { if (y1 > bottom) return; x2 += fistp((bottom - y2) / slope); y2 = bottom }
draw: lineNoClip(x1, y1, x2, y2, c)
```
`fistp` uses round-to-nearest-even. The x range is not re-checked after the y clip.

### 186a:1995 hline(x1, x2, y: int16; c: byte) far, retf 8
Swaps x1 and x2 if needed, `len = x2-x1+1`, then hlineClipped on the active page.

### 186a:19bf fillRect(x1, y1, x2, y2: int16; c: byte) far, retf 0x0a
```
rows = |y2-y1|+1; w = |x2-x1|+1
if (x1 > x2) swap(P1, P2)          // swaps both x and y
dy = (y1 < y2) ? 1 : -1
y = y1; repeat rows times: hook[911a](x=x1, y, len=w, c); y += dy
```
The hook defaults to hlineClipped.

### 186a:1a2a drawDot(x, y: int16; c: byte) far, retf 6
A 4x4 rounded blob:
```
hline(x+1, x+2, y,   c)
hline(x,   x+3, y+1, c+1)
hline(x,   x+3, y+2, c+1)
hline(x+1, x+2, y+3, c)
putPixel(x+1, y+1, c+2)          // c+1 and c+2 wrap to a byte
```

### VESA helpers
- **1ab1 vesaDetect(): boolean.**
  - INT 10h AX=4F00h into a 0x12d-byte buffer.
  - It checks the 'VESA' signature and version >= 1.2 (major >= 1, minor >= 2), but the result is overwritten: it **always returns 1**.
  - `[5bf8]` = total memory in 64 KB units (byte at +0x12).
- **1b75 setBank(n: byte):** `b = n + [5d91]`. If `b != [5d8e]`: `[5d8e] = b`, then INT 10h AX=4F05h, BX=0 (window A), DX=b.
- **1b9a nextBank():** `[5d8e]++` and set it.
- **1baf setDisplayStart(x, y):** INT 10h AX=4F07h, BX=0, CX=x, DX=y.
- **1bc5 vesaFlip():** toggles `[5d92]`.
  - If it is now 1: draw bank offset = `table2540[mode]`, display start (0,0). We draw into page 1 while page 0 is shown.
  - Else: offset 0, display start (`table254a[mode]`, `table2554[mode]`). Page 1 is shown and we draw page 0.
  - Then setBank(0).
  - For 640x480 (mode 2), page 1 = bank 5 = scanline 512.
  - QUIRK: mode 1 (640x400) has display Y = 0, so the flip never shows page 1.
- **1c24 vesaResetFlip():** `5d92 = 0`, `5d91 = 0`, display start (0,0).
- **1c3b vesaClearAll():** for bank = 0..[5bf8] (inclusive): setBank(bank), then store 0x7fff zero words at A000:0. That covers 65534 bytes; the last 2 bytes of each bank are left untouched.

## Unit init (outside the slice, 186a:3b59 and 3af1; noted for context)
- Reads the EGA palette.
- vesaDetect.
- screen = A000:0, text = B800:0.
- `page[0]` = A000:0.
- Allocates the text save buffer.
- setActivePage(0).
- width/height = 320x200 and clip = full screen.
- `[63ac] = nil`, `[5c02] = 0`.
- hline hook = 1689.
- Mode-X pages A000:0000 and A000:4000.
- EMS detect: if absent, `[255e] = 0`. If present and fewer than 0x67 pages are free, a fatal error at cs:3aaa.
- Line table and trig tables: the line table is built only by setMode, and the init calls 0078 (GUESS from caller count).
