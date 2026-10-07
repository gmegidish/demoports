# L5: small utility units, unit inits and early main helpers

## Summary

| Seg | What it is |
|---|---|
| 1c6a | **Resource file unit.** It opens its own EXE (ParamStr(0)), finds the appended resource file, and gives a buffered byte stream over "resource N". Resource numbers are **1-based** (N -> `res/(N-1).*`). |
| 1c34 | **EMS unit** (INT 67h wrappers: detect, alloc, map 4 pages, realloc, move, free). |
| 1d3b | Borland **Dos** unit: GetIntVec, SetIntVec, Intr. |
| 1d45 | Small **math/string** unit: angle convert, ArcSin/ArcCos in degrees, Power, HexWord, IntToStr. |
| 1cd9 | Borland **Crt** unit (TextMode, Window, ClrScr, ClrEol, GotoXY, TextColor, TextBackground, Delay, KeyPressed, ReadKey). |
| 1cd0 | Tiny unit: its init waits for the floppy motor to stop (up to 5 s), then copies Crt's DelayCnt. |
| 0e30 | **PCX loader** (reads resource N, decodes RLE straight into a page or a VESA screen, loads palette). |
| 0db3 | **Bitmap font object** (glyph table from a 2048-byte resource + font picture from a PCX). Centered text, and a "wave" text. |
| 0e5a (helpers) | The **3D Studio .ASC parser** (0e5a:01ab) and its nested helpers (ReadLine, GetWord, SkipColon, StrToInt), SinDeg/CosDeg, AddTriangle. |
| 179b | **8-bit effect helpers**: saturating fade, blur/fire, 128x128 blend table, page average, fire, water/wobble distortion, plasma with a 256-byte sine/log table. |
| 1813 | Borland **Objects** unit (TObject, TCollection, TStream Get/Put). |
| 1856 | Palette preset: 3 gradients over colors 0x21..0x7f from a table. |
| 0b1a | The **"time-delay echo" 3D part** (EMS ring of 71 120x70 frames). This is a whole demo part, called by 0000:60dc. |
| 0ba7 | **Trig tables**: Real48 sin/cos for -360..360 degrees, int16 sin/cos*128 for 0..360, an optional arctan table. |
| 1117 | **3D text object** (a row of extruded 3D letters) and a ROM-font pointer fetch. |

### External calls made by this slice (names from L1/L2/L3 notes when known)

| Address | Meaning |
|---|---|
| 1d81:* | RTL (see BRIEF). Also: 04ed IOResult, 3b31 Assign, 3b6c Reset(f, recsize), 3c57 BlockRead(f, buf, n, var got), 3cbf Seek(f, longint), 491e FileSize, 4939 Eof, 3bed Close, 49b7 FillChar(p, n, v), 3cef ParamStr, 3fa9 string compare, 3f63 Pos, 4060 Delete, 4651 longint->Real48, 47fc Str(longint), 48d2 Val(real) -> ST0, 4847 Val(integer), 32d3/3317 constructor/destructor helpers, 010f RunError, 39e1 WriteLn, 3768/376d assign Input/Output to CRT |
| 186a:047d | setColor(idx, r, g, b) (also writes shadow DS:5d98 + 6*idx, words r,g,b) |
| 186a:062a | gradient(a, b, r1, g1, b1, r2, g2, b2) |
| 186a:10e5 | setActivePage(n) (sets DS:5c22) |
| 186a:1071 | getPage(n): far pointer |
| 186a:0f42 / 114d / 13aa | allocPage / freePage / isPageAllocated(n): bool |
| 186a:121e / 13ea / 1522 | copyPage(src, dst) / repackPage(page, w, rows) / remapRange(page, lo, hi, shift) |
| 186a:14d1 | present(): copy the active page to A000:0 |
| 186a:1b75 / 1b9a | VESA setBank(n) / nextBank() |
| 186a:02f3 | setClip(x1, y1, x2, y2) |
| 186a:03ae | buildLineTable() (row offset dword table DS:9122 for width DS:5bf0) |
| 186a:04b4 / 04be | lockPalette / unlockPalette |
| 186a:053b / 07cf / 0836 | setPaletteRange(first, last, pal) / addPalette(first, last, dr, dg, db) / setPaletteOffset(pal, first, last, dr, dg, db) |
| 186a:39d3 | NewTexture(page, u0, v0, w, h): pointer |
| 186a:3a7e | PollKey(): reads port 60h; ESC -> Halt(0); returns DS:a3ac |
| 1342:0604 | TPixel.Init(x, y, z: single; color: byte) (VMT 0x239a) |
| 1342:0c20 | TMesh.Append(item) |
| 1342:0db6 / 0ed1 / 1184 / 1466 | TMesh.MoveTo / Translate / ScaleUniform / RotateWork |
| 1342:02be / 0271 / 0282 | AddAngles(var a, b, c; da, db, dc) / SetPerspective(D) / ZeroVec(var x, y, z) |
| 1342:1c84 / 1cd4 | TFace.Init(flag, minColor, maxColor, color) (VMT 0x23da) / TFace.SetVertices(v1, v2, v3, v4) |
| 1342:2bff, 2c11, 2c6c, 2a90, 3518, 364d, 36ba, 287c | 3D-engine methods outside L3a (see L3b). Named by address only. |
| 0e5a:0596 | Constructor of a mesh object (other slice) |
| 0d6d:0333 | setMusicVolume(v) |
| 1cbc:00a7 / 00ce / 00f3 | timer mark / elapsed / waitUntil (BRIEF) |

---

## 1c6a: resource file unit

### File layout (what the port needs)
- At startup (1c6a:042a), the unit opens `ParamStr(0)` with record size 1. It reads 0x1c bytes from offset 0. If 0x1c bytes were read **and** the first word is 0x5A4D ('MZ'), then `base = 0x273F0` (the resource file starts at EXE file offset 160752). Otherwise `base = 0` (a standalone resource file).
- At `base` there is a table of 50 longints (200 bytes) read into DS:a1ae: `size[1..50]` (size[i] is at DS:a1aa + 4*i).
- `dataStart = base + 200` (DS:a182). File size is stored in DS:a186.
- **offsetOf(N)** (1c6a:0301, far, arg N at [bp+6]):
  ```
  off = dataStart
  if (N > 1) for (i = 1; i <= N-1; i++) off += size[i]        // unsigned compare N > 1
  if (off > fileSize) error("Data Item Not Exist.")           // signed 32-bit compare
  return off
  ```
  So resource N (1-based) is item N-1 in the BRIEF numbering. Examples: 0x10 -> 15.asc, 0x19 -> 24.pcx, 0x15 -> 20.bin, 0x2b -> 42.bin (text screen).
- **Port replacement:** `getResource(N)` returns the bytes of `res/(N-1).*`. Note that streams are never bounded by the resource size. A reader that ran past the end would continue into the next resource. None of the loaders below do that (checked for PCX and ASC).

### Globals
| DS | Name | Meaning |
|---|---|---|
| a0a8 (far ptr) | buf | stream buffer (GetMem) |
| a098 | bufSize | 0xFFFF = "default 65535" |
| a09a (dword) | pos | read index in buf |
| a0a6 | fill | number of valid bytes in buf |
| a09e (dword) | filePos | offset of the resource, then += fill on each refill |
| a0a2 (dword) | fileSize copy |
| a0ac | byte, 1 = read from the EXE file (DS:a0ae), 0 = from a second file var DS:9fc8 (never used) |
| a0ae | file var of the EXE (128 bytes) |
| a12e | string[79] the EXE name |
| a17e (dword) | base |
| a182 (dword) | dataStart |
| a186 (dword) | fileSize |
| a18a | byte, 1 = resource file present (not Eof at base) |
| a18c | word, BlockRead count |
| a18e | 0x1c-byte MZ header buffer |
| a1ae | size table (50 dwords) |
| a1aa (dword) | saved ExitProc |
| a276 | byte, last IOResult |

### Functions
- **1c6a:0000 resError(msg: string)** near: `TextMode(3)` (1cd9:0177); `WriteLn(msg)`; `Halt(1)`.
- **1c6a:0059 blockRead(dstOff [bp+0a], count [bp+8], var got [bp+4])** near, ret 8: `BlockRead(file, buf[dstOff], count, got)`. Then `a276 = IOResult`. If it is nonzero: resError("Error reading file.").
- **1c6a:00c4** near: Close(file 9fc8); `a276 = IOResult`. This only applies to the unused second-file mode.
- **1c6a:00db closeRes()** far: `FreeMem(buf, bufSize==0xFFFF ? 0xFFFF : bufSize)`. If a0ac==0, close the second file.
- **1c6a:0113 clearBuf()** far: `FillChar(buf, bufSize, 0)`. It is used with 029c.
- **1c6a:0129 refill(count [bp+6])** far, retf 2:
  ```
  if (pos != 0 && fill != 0 && fill != pos) {          // never true in practice
     Move(buf+pos, buf, 0xFFFE - pos); blockRead(pos+1, count, &fill)   // odd; dead path
  } else blockRead(0, count, &fill)
  filePos += fill; pos = 0
  ```
  It is always called with count = 0xFFFE (65534), and only when pos >= fill (or pos was just zeroed). So in effect it means "read the next 65534 bytes of the file into buf[0..]".
- **1c6a:01b9 restart()** far: `pos = 0; fill = 0; refill(0xFFFE)`.
- **1c6a:01d1 skip(n)** far, retf 2: calls readByte() n times (for i = 1..n, signed).
- **1c6a:01fb readByte(): byte** far, register: `if (pos >= fill) restart(); return buf[pos++]` (16-bit unsigned compare of the low words).
- **1c6a:021c readWord(): word** far: `Move(buf+pos, &w, 2); pos += 2; return w`. **No refill check.** It is only used for the PCX header, at the start of a buffer.
- **1c6a:024c openRes(N)** far, retf 2: `a0ac = 1; buf = GetMem(0xFFFF); pos = 0; fill = 0; Seek(file, offsetOf(N)) (via 1c6a:0385); a0a2 = fileSize; bufSize = 0xFFFF; filePos = offsetOf(N)`. Note that the buffer is **not filled** here. Every caller calls restart() (1c6a:01b9) next.
- **1c6a:029c openResBuf(N [bp+8], bufSize [bp+6])**: same, but with the buffer size given (GetMem is still 0xFFFF). The only caller is 0000:a2c1 (N = 0x2b, size 5000).
- **1c6a:0385 seekRes(N)**: `Seek(file, offsetOf(N))`.
- **1c6a:039f readTable()** near: `FillChar(a1ae, 200, 0); Seek(file, base); BlockRead(file, a1ae, 200, a18c); dataStart = base + 200`.
- **1c6a:03f0 exitProc**: restores ExitProc from a1aa and closes the EXE file.
- **1c6a:042a openSelf()** near: does the work described in "File layout". If Reset fails: resError("Error opening resource file.").
- **1c6a:04f1 unit init**: saves ExitProc (DS:25fc) to a1aa, installs 1c6a:03f0, sets `a0ac = 0`, calls openSelf.

The music loader 0d27:000a uses `openRes(N)` + `restart()` + `size[N]` (DS:a1aa + 4N). It copies `size[N]` bytes out of the buffer (one 64K buffer, so modules must be < 65534 bytes after the first refill; GUESS, belongs to the music slice).

---

## 1c34: EMS unit (INT 67h)

The handle record (passed as `var rec`, DS:467a in 0b1a):
`+0 handle (word), +2 frameSeg (word), +4 pages (word), +8/+0xc/+0x10/+0x14 four far pointers`. All four pointers are always set to the same value, see map below. The last status (AH) goes to DS:9fb4.

- **1c34:0009 emsPresent(var rec): boolean**: INT 21h AX=3567h (vector of INT 67h). Compares 8 bytes at ES:000A with "EMMXXXX0".
- **1c34:00a5 emsFreePages(var rec): word**: AH=42h, returns BX (unallocated pages).
- **1c34:00ce emsAlloc(pages [bp+0a], var rec)**: AH=41h -> rec.frameSeg = BX. If ok: rec.pages = pages; AH=43h BX=pages -> rec.handle = DX. Returns the status byte.
- **1c34:0137 emsMap(logical [bp+0c], phys [bp+0a], var rec)**: AH=44h AL=phys BX=logical DX=handle. Then **all four** rec pointers = `frameSeg:(phys << 14)`.
- **1c34:01b7 emsMap4(first [bp+0a], var rec): pointer**: maps logical first+3, +2, +1, +0 to phys 3, 2, 1, 0 (in that order). Returns rec+8, which is frameSeg:0000 (the last map was phys 0). This gives a linear 64K window.
- **1c34:0217 emsMap1(page, var rec): pointer**: map page -> phys 0, return frameSeg:0000.
- **1c34:0244 emsRealloc(more, var rec)**: if rec.pages == 0: emsAlloc(more). Otherwise rec.pages += more; AH=51h BX=rec.pages.
- **1c34:02a1 emsCopy(srcPage [bp+0e], dstPage [bp+0c], nPages [bp+0a], var rec)**: AX=5700h move. The block at DS:9fb6 is: length = nPages*16384 - 1 (dword); src type 1 (EMS), handle, offset 0, page srcPage; dst type 1, handle, offset 0, page dstPage. Note the length is one byte short.
- **1c34:031b emsFree(var rec)**: if pages > 0: AH=45h; pages = 0.

Port: EMS is just memory. Model a "page" as a JS Uint8Array.

---

## 1d3b: Dos unit
- 1d3b:0000 GetIntVec(n, var p); 1d3b:0018 SetIntVec(n, p); 1d3b:0036 Intr(n, var regs). The regs record is AX, BX, CX, DX, BP, SI, DI, DS, ES, Flags (words, +0..+0x12).

## 1d45: math/string unit
Constants: cs:0000 = 57.29577951308232 (extended), cs:000a = 0.9 (extended), cs:0090 = 1.0f, cs:00ff = 90.0f, cs:013a = 0.0f, cs:013e = 1.0f.
- **1d45:0014 convAngle(x: Real48 [bp+8], mode: byte [bp+6]): Real48**: mode 2: `x*57.29577951308232` (rad -> deg). Mode 3: `x*0.9`. Otherwise x. The result is rounded to Real48.
- **1d45:0094 ArcSinDeg(x: Real48): Real48** = `convAngle(Real48(ArcTan(x / Sqrt(-x*x + 1.0))), 2)`.
- **1d45:0103 ArcCosDeg(x)** = `Real48(90.0 - ArcSinDeg(x))`. Caller: 1342:237f.
- **1d45:0142 Power(base: Real48 [bp+0c], e: Real48 [bp+6]): Real48** (caller 186a:26e7):
  ```
  if (base < 0) {
     if (Int(e) != e) { if (!odd(Trunc(1.0/e))) RunError(207) }    // fractional exponent, allowed only if 1/e is an odd integer
  }
  if (base == 0 && e < 0) RunError(207)
  r = (base == 0) ? 0 : Exp(e * Ln(|base|))
  if (base < 0 && (odd(Trunc(e)) || odd(Trunc(1.0/e)))) r = -r
  return Real48(r)
  ```
- **1d45:02f8 HexWord(w): string**: 4 uppercase hex digits, high byte first. The table DS:25c0 = "0123456789ABCDEF".
- **1d45:0382 IntToStr(n: longint): string** = `Str(n)`. Callers: 186a debug or status text.

## 1cd9: Borland Crt (standard, not ported)
000d init (assigns Input/Output, detects mode, calibrates DelayCnt -> DS:a3d2, hooks INT 1Bh). 0177 TextMode(m). 018c Window(x1, y1, x2, y2). 01cc ClrScr. 01e6 ClrEol. 021f GotoXY(x, y). 0263 TextColor(c). 027d TextBackground(c). 02a8 Delay(ms). 0308 KeyPressed. 031a ReadKey. TextAttr = DS:a3cc. WindMin/WindMax = DS:a3ce/a3d0.

## 1cd0: init only
**1cd0:007a**: calls 1cd0:0000. That routine loops while `(0040:003F & 0x0F) != 0` (the floppy motor is running) and BIOS ticks < start + 0x5B (91 ticks, about 5 s). Then `DS:a3c4 = DS:a3d2` (Crt DelayCnt). The port ignores this.

---

## 0e30: PCX loader

### 0e30:0223 loadPCX(dest [bp+8], N [bp+6]) far, retf 4
`dest` is a page number for pictures up to 320 wide, or a start row for wide (VESA) pictures.
```
openRes(N); line = GetMem(2001) (DS:54f2); restart()
readHeader()                              // 0e30:00e6
skip(0x70)                                // 16 + 112 = 128-byte header
row(5500) = 0; col(54fe) = 0; dstOff(5512, dword) = 0
if (wide) setBankStart(dest)              // 0e30:01c5, longint(dest)
else setActivePage(dest)                  // 186a:10e5(byte dest); dest pointer = DS:5c22
decode()                                  // 0e30:016b
readByte()                                // the 0x0C palette marker, not checked
readPalette()                             // 0e30:009c
FreeMem(line, 2001); closeRes()
```
**Note: the page becomes the active page** (setActivePage side effect) in the narrow case.

**readHeader (0e30:00e6)**: bytes: manufacturer -> 54f8, version -> 54f9, encoding -> 54fa, bitsPerPixel -> 54f7. Words: xmin 5502, ymin 5504, xmax 5506, ymax 5508. Then **width = word at header offset 12 (HDpi)** -> 550e, **height = word at offset 14 (VDpi)** -> 5510. If width == 0: width = xmax+1. If height == 0: height = ymax+1. `wide (5516) = width > 320` (unsigned). The program uses the DPI fields as the size. All resource PCX files have HDpi/VDpi equal to 320x200 or 640x480, the same as xmax+1/ymax+1. BytesPerLine (offset 66) and planes are ignored.

**decode (0e30:016b)**:
```
do {
  b = readByte()
  if (b > 0xC0) {                       // signed int compare of 0..255: 0xC0 itself is a LITERAL
     n = b - 0xC0; v = readByte()
     fill line[col .. col + 2*ceil(n/2) - 1] = v    // stosw of (n+1)>>1 words: may write 1 byte past
     col += n
  } else line[col++] = b
  if (col >= width) { col = 0; row++; flushLine() }   // signed compare; any overflow past width is dropped
} while (row != height)
```
For every resource PCX this is identical to standard PCX decoding. I checked all 21 files: no run crosses a line, no bare 0xC0 bytes, and the decode ends exactly at filesize-769. **Port: a standard 8-bit PCX decoder.**

**flushLine (0e30:0000)**:
- Narrow (width <= 320): `copy (width+1)>>2 dwords from line to [5c22] + dstOff` (320 -> 80 dwords). Then `dstOff += width + (DS:5bf0 - width)` (that is, += screenWidth, 32-bit). If the high word of dstOff becomes nonzero: set it to 0 and nextBank(). This does not happen for 320x200.
- Wide: dst = DS:5d7a (A000:0) + dstOff.lo. If `dst.off + width` does not carry: copy (width+1)>>2 dwords and advance as above. Otherwise (the line crosses the 64K bank): copy `0x10000 - dstOff` bytes, nextBank(), then copy `(width - firstPart + (5bf0 - width)) >> 2` dwords from `line + firstPart` to offset 0. Set `dstOff = width - firstPart + 5bf0 - width`. For 640-wide lines on a 640 screen every split is a multiple of 128, so it is exact.

**setBankStart (0e30:01c5)(y: longint)**: `n = DS:5bf0 * y` (32-bit). `bank = n div 65535`; `dstOff = (n mod 65535) - bank` (this equals n mod 65536 for the values used). Then setBank(bank). The only wide caller passes y = 0 (0000:06b4, resource 0x1a = 25.pcx, 640x480).

**readPalette (0e30:009c)**: only if IOResult == 0: `for i = 0..255: r = readByte() >> 2; g = readByte() >> 2; b = readByte() >> 2; setColor(i, r, g, b)`. This is 8-bit -> 6-bit by shift (truncate). The palette is the last 768 bytes after 0x0C. setColor writes the DAC immediately (unless the palette is locked) and stores the shadow at DS:5d98.

Globals: 54f2 line ptr, 54f7..54fa header bytes, 54fe col, 5500 row, 5502..5508 window, 550e width, 5510 height, 5512 dword dstOff, 5516 wide flag.

---

## 0db3: bitmap font object

Object layout (allocated by constructor, VMT link at **+0x1084**, VMT DS:0a76):
| Offset | Field |
|---|---|
| +0x000 int16 | centerX (wave text) |
| +0x002 int16 | centerY (wave text) |
| +0x008 + 8*c | glyph[c] = {x, y, w, h: int16} for c = 0..255. This is the raw 2048-byte resource. |
| +0x802 + 6*i | phase[i]: Real48, i = 1..len (wave text; overlaps glyphs 0xFA..0xFF) |
| +0x880 byte | font picture page number |
| +0x881 byte | 0x1e (unused here) |
| +0x882 | 0x600 bytes, a copy of the palette shadow taken right after loading the PCX |
| +0xe82, +0xe83 byte | 0 |
| +0xe84 string[255] | wave text |

The set string DS:0a7e = `" I0123456789-+.,!?:()*'"` (characters whose advance is width-1).
`advance(c) = (Pos(c, set) > 0) ? glyph[c].w - 1 : glyph[c].w`. Note that ' ' is in the set.

- **0db3:004f Font.Init()** constructor: page = 0x0b; while isPageAllocated(page) page++; allocPage(page). `+0xe82 = 0; +0x881 = 0x1e; +0xe83 = 0`. Returns self.
- **0db3:00ad Font.Done**: freePage(page).
- **0db3:0769 Font.Load(pcxRes [bp+0c], glyphRes [bp+0a]; self)**: `loadPCX(page, pcxRes)` (this also sets the active page to the font page and loads the palette). Then Move(5d98 -> self+0x882, 0x600); openRes(glyphRes); restart(); Move(buf -> self+8, 0x800); closeRes().
  - Callers: 0000:0d39 Load(0x16 -> 21.pcx, 0x17 -> 22.bin); 0000:979b Load(0x14 -> 19.pcx, 0x15 -> 20.bin).
  - Glyph tables: 20.bin defines 80 chars: space, ! " $ % & ' ( ) + , - . / 0-9 : ? A-Z \ a-z ~. For example 'A' = (6,7,26,23) and ' ' = (295,154,18,27). 22.bin defines 30 chars: space, ', 5, 9, A-Z, for example 'A' = (12,16,29,29) and ' ' = (3,98,22,27). Port: read the .bin directly as 256 x 4 int16 LE.
- **0db3:0000 blitMasked(src: far ptr [bp+0e], x [bp+0c], y [bp+0a], w [bp+8], h [bp+6], srcOff [bp+4])** near, ret 0x0e:
  ```
  d = [5c22] + y*W + x   (W = DS:5bf0, 16-bit mul)
  s = src + srcOff
  for h rows: for w: { if (*s != 0) *d = *s; d++; s++ }  d += W - w; s += W - w
  ```
  Color 0 is transparent. Both strides are the **screen width W** (320).
- **0db3:00ca Font.DrawChar(c [bp+0a], y [bp+0c], x [bp+0e]; self)** retf 0x0a. **Vertical clip only** (clipTop DS:5bfc, clipBottom DS:5c00, inclusive):
  ```
  gx, gy, gw, gh = glyph[c]
  if (y < top) { if (y + gh < top) return; gy += top - y; gh -= top - y; y = top }
  if (y + gh > bottom) { if (y > bottom) return; gh -= (y + gh) - bottom }
  if (gh <= 0) return
  blitMasked(pagePtr[page] (DS:5c2a + 4*page), x, y, gw, gh, gy*320 + gx)
  ```
  There is no horizontal clipping. Note `y+gh > bottom` keeps rows up to `bottom - 1`, because the check uses height and not the last row.
- **0db3:01bc Font.DrawCentered(cx [bp+10], y [bp+0e], s [bp+0a]; self)** retf 0x0c (9 callers):
  ```
  total = sum(advance(s[i]) for i = 1..len)          // int16
  x = cx - (total >>> 1)                             // unsigned shift of the 16-bit total
  for i = 1..len: { if (s[i] > ' ') DrawChar(s[i], y, x); x += advance(s[i]) }
  ```
- **0db3:033b Font.SetWave(cx [bp+10], cy [bp+0e], s [bp+0a]; self)**: `centerX = cx; centerY = cy; text = s`; for i = 1..len: `phase[i] = Real48((1.0f - i/len) * 2*pi)`. The 1.0 is float32, 2*pi = 6.283185307179586 extended, and i/len is computed in the FPU from int32 values.
- **0db3:0429 Font.DrawWave(a [bp+0a], b [bp+10], c [bp+16]: Real48; n [bp+1c]: int16; self)** retf 0x18 (caller 0000:9f55):
  ```
  scale = Real48(Real48(n) / 1000.0f)
  width = 0; for each ch: width += Round(scale * (advance(ch)))  // int32 add, low 16 kept; Round = half-even
  x = centerX - (width idiv 2)                                      // signed
  y0 = centerY - (glyph[text[1]].h >>> 1)
  for i = 1..len:
     ang = Real48(b * pi(ext) / 180.0f + phase[i])
     dy = Round(c * sin(ang) * cos(ang / a))
     dx = Round(c * cos(ang))
     if (ch > ' ') DrawChar(ch, y0 + dy, x + dx)
     x += Round(scale * advance(ch))
  ```
  Glyphs are not scaled, only the spacing is.
- **0db3:07c2** unit init: empty.

---

## 0e5a shared helpers (3DS .ASC loader)

These are nested procedures of 0e5a:01ab (the parent BP is pushed last). Strings are Pascal strings, max 255.
- **0e5a:0000 ReadLine(var s)**: `s = ''; cur = 0; do { if (cur >= 0x20) s += cur; prev = cur; cur = readByte() } until (prev == 0x0D && cur == 0x0A)`. Control characters are dropped.
- **0e5a:0068 GetWord(var s): string**: if length(s) < 2, return ''. Otherwise delete leading spaces, then move characters to the result (**UpCase**) until s[1] == ' ' or s is empty.
- **0e5a:011e SkipColon(var s)**: delete characters until s[1] == ':' or s is empty, then delete one more (the colon).
- **0e5a:015a StrToInt(s): int16** = Val(s) (the error code is ignored).
- **0e5a:13e4 SinDeg(x: Real48): Real48** = `sin(x * pi(ext) / 180.0f)`. **0e5a:1433 CosDeg** is the same with cos. Both are nested (parent BP at [bp+4]).

### 0e5a:01ab LoadASC(N [bp+0a], var mesh: ^TMesh [bp+6]) far, retf 6
Callers: 0000:14f5 (N = 0x10 -> 15.asc "ESTEEM"), 0000:1b03 (0x11 -> 16.asc), 0000:7e7a (0x12 -> 17.asc).
```
openRes(N); nV = 0; nF = 0; V[] = local array of pointers (index from 1)
loop {
  line = ReadLine(); s = line
  w = GetWord(s)
  if (w == "VERTEX" && Copy(GetWord(s), 1, 4) != "LIST") {
     SkipColon(s); x = (single)Val(GetWord(s))
     SkipColon(s); y = (single)Val(GetWord(s))
     SkipColon(s); z = (single)Val(GetWord(s))
     V[++nV] = new TPixel(x, y, z, color 0)          // 1342:0604, VMT 0x239a
     TMesh.Append(mesh, V[nV])                        // 1342:0c20
  }
  if (w == "FACE" && Copy(GetWord(s), 1, 4) != "LIST") {
     nF++
     a = StrToInt(Copy(GetWord(s) + " ", 3, len - 2)) + 1   // "A:12" -> 13
     b = ... (next word, "B:..."), c = ... ("C:...")
     f = new TFace(flag = mesh[+0x92], minColor = mesh[+0x7e], maxColor = mesh[+0x7f], color = 0)  // 1342:1c84
     TFace.SetVertices(f, V[a], V[b], V[c], V[c])                 // 1342:1cd4: a quad with the last vertex repeated
     mesh.faces(+0x59 TCollection).Insert(f)                      // virtual slot +0x1c
     f.color(+0x77) = mesh[+0x80]
     1342:2c11(mesh)
  }
  if (buf[pos] == 0xFF && buf[pos+1] == 0xFF) break   // raw buffer peek, no refill
}
closeRes()
```
Vertex coordinates are in the file's X, Y, Z order (single precision). Lines such as "Vertex list:", "Face list:", "Tri-mesh, Vertices:", "Smoothing:", "Material:" and the camera/light blocks are ignored. Every .ASC resource ends with `\r\n\r\n\r\n\xFF\xFF`. 15.asc (68339 bytes) is larger than the 65534-byte buffer; the refill handles that correctly.

### 0e5a:1b9f AddTriangle(p1 [bp+12], p2 [bp+0e], p3 [bp+0a]: var Vec3 of single; mesh [bp+6])
Nested; 20 callers in 0e5a:1478.
```
1342:2bff(mesh, 5); 1342:2c11(mesh)
if (mesh.word[+0x5f] > 10) mesh[+0x80] = mesh[+0x7e]
f = new TFace(mesh[+0x92], mesh[+0x7e], mesh[+0x7f], mesh[+0x80])
v1, v2, v3 = GetMem(0x2c) each; TPixel.Init(v_k, p_k.x, p_k.y, p_k.z, color 0)
TFace.SetVertices(f, v1, v2, v3, v3)
1342:2c6c(mesh, f)            // add face (vertices are NOT appended to the mesh point list)
```

---

## 179b: 8-bit effect helpers

All of these work on 320x200 linear byte pages. `P` = active page DS:5c22 unless stated otherwise.

- **179b:0000 fadePage(d: byte)**: for each of the 32000 words of P: if word != 0, each byte = max(byte - d, 0) (saturating). Zero words are skipped, which gives the same result.
- **179b:002f blur()** (16 callers). A running accumulator `v` (16-bit) is reset to 0 at the start of row 0, of each middle row, and of row 199:
  ```
  row 0   (i = 0..319):   v = (v + P[i+320] + P[i+1]) >> 2;            P[i] = v
  rows 1..198:            v = (v + P[i-320] + P[i+320] + P[i+1]) >> 2; P[i] = v
  row 199:                v = (v + P[i-320] + P[i+1]) >> 2;            P[i] = v
  ```
  v is the value just written to the left pixel. P[i-320] has already been updated, while P[i+1] and P[i+320] are old values. P[i+1] of the last pixel in a row is the first pixel of the next row. The very last pixel reads P[64000] (the byte after the page; GUESS 0).
- **179b:0097 blurDecay(d: byte)**: row 0 and row 199 are the same as in blur(). Middle rows: `v = (v + up + down + right) >> 2; if (v == 0) { /* pixel NOT written, v = 0 */ } else { v = max(v - d, 0); P[i] = v }`.
- **179b:0276 buildBlendTable(var T [bp+8] (16384 bytes); k [bp+6])**: for a = 0..127, b = 0..127: `T[a*128 + b] = Trunc((uint16)((65-k)*a)/64.0f + (uint16)(b*k)/64.0f)` (16-bit unsigned products).
- **179b:0110 blendPages(var T [bp+6]; dstPage [bp+0a]; srcPage [bp+0c])**: for i < 64000: `B[i] = T[((A[i] << 7) | B[i]) & 0xFFFF]`, where A = getPage(srcPage) and B = getPage(dstPage). Values must be < 128.
- **179b:018c averagePages(dst [bp+6], src [bp+8])**: uses the pointers in DS:5c2a. For 15999 dwords (63996 bytes; **the last 4 bytes are untouched**): `s = (uint32)(src32 + dst32)`; if s != 0: `dst32 = (s >>> 1) & 0x7F7F7F7F`. **Carries cross byte boundaries.** Emulate with 32-bit words to match exactly.
- **179b:01cc fire(cap [bp+6], dst: far ptr [bp+8], buf: far ptr [bp+0c])**: `S = buf.seg:(buf.off + dst.off)`. For i = 0..63679:
  ```
  v = (S[i] + S[i+319] + S[i+320] + S[i+321]) >> 2
  if (v != 0) { v--; S[i] = v; if (i <= 63360) dst[i] = min(v, cap) }   // when v==0 nothing is written
  ```
- **179b:021a fire2(off [bp+6], cap [bp+8], dst [bp+0a], buf [bp+0e])**: like fire, but the neighbours are `S[i+off+219], S[i+off+220], S[i+off+221]` (plus S[i] itself). dst[i] is written for all i < 63680. Afterwards it clears 320 bytes at **buf.seg:0xF8D4** (offset 63700, absolute, not relative to buf.off). Caller 0000:a069.
- **179b:060b wobble(srcPage [bp+0a], dstPage [bp+8], speed [bp+6])** (caller 0000:2f6a). Uses the table T = DS:5aec and the phase bytes DS:2472, DS:2473 (both 0xBE at start):
  ```
  ph1 -= speed; ph2 += speed                           // bytes, wrap
  s = src + 3200; d = dst + 3200                       // start at row 10
  for (row = 10; row < 190; row++) {
     p = T[(row + ph1) & 255]
     q = T[ph2]                                       // not row dependent
     vy = |(T[(row + q) & 255] >> 4) - 8|             // 0..8
     for (x = 0; x < 320; x++) {
        vx = |(T[((x & 255) + p) & 255] >> 4) - 8|
        *d++ = s[(vy - 4)*320 + vx]; s++
     }
  }
  ```
- **179b:0711 buildTable(f: far function(Real48): byte)**: `for i = 0..255: T[i] (DS:5aec) = f(Real48(i))`.
- **179b:0531 (the table function)**: `x = Real48(i*pi/128.0f); return (byte)(Round(sin(x) * Ln(x + 1.0f) * 43.0f) + 75)`. The result table (all values are in 0..118, so there is no wrap):
  ```
  75,75,75,75,75,76,76,76,77,77,77,78,78,79,79,80,80,81,82,82,83,84,85,85,86,87,88,88,89,90,91,92,
  93,93,94,95,96,97,98,99,99,100,101,102,103,104,104,105,106,107,107,108,109,110,110,111,111,112,113,113,114,114,115,115,
  116,116,116,117,117,117,118,118,118,118,118,118,118,118,118,118,118,118,118,118,117,117,117,117,116,116,115,115,114,114,113,112,
  112,111,110,110,109,108,107,106,105,104,103,102,101,100,99,98,97,96,94,93,92,91,89,88,87,85,84,82,81,79,78,76,
  75,73,72,70,69,67,66,64,63,61,60,58,56,55,53,52,50,49,47,45,44,42,41,39,38,36,35,33,32,31,29,28,
  27,25,24,23,21,20,19,18,17,15,14,13,12,11,10,9,9,8,7,6,5,5,4,4,3,2,2,2,1,1,1,0,
  0,0,0,0,0,0,0,0,0,0,1,1,1,2,2,3,3,4,4,5,6,7,7,8,9,10,11,12,13,14,16,17,
  18,19,21,22,24,25,26,28,30,31,33,34,36,38,40,41,43,45,47,49,51,53,55,57,59,61,63,65,67,69,71,73
  ```
- **179b:05aa plasma()** (installed as the callback DS:5ae8): `a = DS:5ae2; b = DS:5ae3`. Writes **25600 consecutive bytes** at P (100 rows of 256 bytes, packed):
  ```
  for (r = 0; r < 100; r++) {
     dl = T[a]; dh = T[b]
     repeat 64 { c = T[dl] + T[dh]; out c, c; dl++; dh--; c = T[dl] + T[dh]; out c, c; dl++ }   // byte wraps; 4 bytes per iteration
     a++; b++   // the local copies only; the globals are not changed
  }
  ```
- **179b:02f6 fireRamp(n: byte)** (caller 0000:986b): builds a palette in a local zeroed array pal[256] of {r, g, b: int16}, then setPalette(pal) (186a:04d1). Entries are written at idx = n, n-1, n-2, ... (one shared counter, decremented after each entry). Entries above n and below the last one written stay 0.
  ```
  k = Real48(64.0f / (n / 3.0f));  q = n idiv 3;  idx = n
  for (j = q; j >= 1; j--) pal[idx--] = (63, 63, Round(j*k))   // white -> yellow (skipped if q == 0)
  for (j = q; j >= 0; j--) pal[idx--] = (63, Round(j*k), 1)    // yellow -> red; b is the raw value 1, not scaled
  for (j = q; j >= 0; j--) pal[idx--] = (Round(j*k), 0, 1)     // red -> black; g = 0, b = 1 (raw)
  ```
  Round is half-even. Round(q*k) can be 64 (just outside 6-bit). idx is a byte and wraps.
- **179b:0740 setCallback(p)**: DS:5ae8 = p.
- **179b:0754 unit init**: `DS:5ae6 = 0xFE; DS:5ae7 = 1; buildTable(179b:0531); setCallback(179b:05aa)`.

---

## 1813: Borland Objects unit (port with JS arrays)
TCollection layout: +0 VMT, +2 Items (far ptr), +6 Count, +8 Limit, +0x0a Delta.
0000 TObject.Init (zero-fills the object after the VMT field), 0031 TObject.Done, 004e TStream.Get, 009d TStream.Put, 0101 TCollection.Init(ALimit, ADelta), 014d TCollection.Done, **0172 At(i)** (30 callers; index error -> Error(-1)), 01a4 AtInsert(i, item), 0215 AtPut, 0248 DeleteAll (Count = 0), 0258 Error -> RunError(212 - code), 026a FreeAll, 02ba FreeItem, 02d7 GetItem, 02f8 IndexOf, 0336 Insert (= AtInsert(Count, item)), 0350 PutItem, 0366 SetLimit (clamped to Count..0x3FFC).

## 1856: palette preset
- **1856:0000 presetGradient(n)**: `t = DS:2492 + 12*n` (12 bytes: c0, c1, c2, c3). It calls gradient(0x21, 0x40, c0, c1), gradient(0x40, 0x5f, c1, c2), and gradient(0x5f, 0x7f, c2, c3), where each c is (r, g, b) at t+0..2, t+3..5, t+6..8, t+9..11. The only call is n = 10 (0000:0d40): DS:250a = `0b 26 3c | 3f 3f 3f | 3f 28 00 | 06 06 3f`, so (11,38,60) -> (63,63,63) -> (63,40,0) -> (6,6,63).
- **1856:0130** unit init: empty.

## 0ba7: trig tables
Constants: cs:0000 = pi (extended), cs:000a = 180.0f, cs:000e = 100.0f, cs:0012 = 57.29577951308232 (extended), cs:01e8 = pi (extended), cs:01f2 = 180.0f, cs:01f6 = 128.0f.
- **0ba7:001c buildTables()** near:
  - `sinT = GetMem(4326)` (DS:4c3a), with Real48 entries for a = -360..360 at `sinT + 0x870 + 6*a`: `Real48(sin(a*pi/180.0f))`.
  - `cosT` (DS:4c3e) is the same with cos.
  - If DS:0126 != 0 (initial 0, so normally skipped): `atanT = GetMem(40002)` (DS:4c42) with `atanT[i] = Round(ArcTan(i/100.0f) * 57.29577951308232)` for i = 0..20000 (int16).
- **0ba7:013c SinR(a: int16): Real48** (3 callers): `while (a > 360) a -= 360; while (a < -360) a += 360; return sinT[a]`. **0ba7:0192 CosR** is the same with cosT.
- **0ba7:01fa unit init**: buildTables(); then for i = 0..360: `DS:4696[i] = Round(sin(i*pi/180.0f) * 128.0f)` and `DS:4968[i] = Round(cos(i*pi/180.0f) * 128.0f)` (int16, half-even rounding). The loop counter is the global DS:4c46 (it ends at 360).

## 1117: 3D text object and ROM font
- **1117:20e8 TText3D.Init(s [bp+14]: string; spacing [bp+12]: int16; flag [bp+10]: int16; minC [bp+0e], maxC [bp+0c]: byte)**, constructor (VMT [bp+0a], self [bp+6]), retf 0x12. Callers: 0000:02bd, 02e0, 0395 (VMT 0x0cfe, args 5, 0x10, 1, 1, ... after the string).
  ```
  1342:364d(self, len*20, 0)                // init the container (L3b)
  self.word[+0x92] = flag; self[+0x7e] = minC; self[+0x7f] = maxC
  if (len > 1) w = sum(i = 1..len-1: width[s[i]] + spacing)   // the last char is excluded
  else w = width[s[1]]
  x = (-w) idiv 2
  for i = 1..len:
     L = 1117:0000(s[i], flag, minC, maxC)  // build one 3D letter mesh
     self.letter[i] (+0x9c + 4*i) = L
     TMesh.Translate(L, (single)x, 0.0, 0.0)  // 1342:0ed1
     x += width[s[i]] + spacing
     1342:36ba(self, L)                      // add to group
  ```
  `width[c]` = int16 at DS:0c8c + 2*c, a typed constant array that starts at 'A' (DS:0d0e): A-H 44, I 14, J-L 44, M 50, N-P 44, Q 50, R 44, S 50, T 50, U 44, V 44, then W, X, Y = 0, Z = 1 (probably beyond the real array, GUESS: only A..V are defined). Lower indices read VMT bytes (garbage).
- **1117:0000 BuildLetter(ch [bp+0c], flag [bp+0a], minC [bp+8], maxC [bp+6]): pointer**. This is an **8.4 KB procedure (1117:0000-20e7) that is NOT in the listing** (it still has untranslated 8087-emulator INT 34h-3Dh opcodes). It creates `1342:287c(nil, VMT 0x23ea, maxC, minC, flag, 10)` and UpCases ch. Then it has a large `if ch == 'A' ... ` chain that builds each letter's geometry, using loops over a 6-byte-record array (`[bp-0xc]*6 + [bp-0xa]*0x18`). **This needs its own decoding pass (UNCLEAR, not done here).**
- **1117:2290 getRomFont()**: INT 10h AX=1130h BH=2 (the 8x14 ROM font) -> DS:5518 = BP (offset), DS:551a = ES. No reader of 5518/551a was found in the listing (GUESS: used by the unlisted code).
- **1117:22a3** unit init: calls getRomFont.

---

## 0b1a: the "time-delay echo" part (0b1a:01f7, called from 0000:60e0)

A rotating 3D object is rendered into a 120x70 window at screen (x=100, y=65) (DS:0122 = 100, DS:0124 = 65). The renders go into a ring of 71 EMS frames (EMS pages 0..70, 16K each, handle DS:467a). The screen window shows **row i from the frame rendered (71 - i) iterations ago**, which gives a vertical time-smear.

### Helpers
- **0b1a:0000 grabBackground(dst: far ptr)** near: setActivePage(3) (side effect: DS:5c22 = page 3). For 70 rows: copy 120 bytes from `page3 + rowOfs[65] + 100 + r*320` to `dst + r*120`. rowOfs is DS:9122 (dword table, low word).
- **0b1a:00e5 initRing()**: `free = emsFreePages(); emsAlloc(70)`. For i = 0..free (inclusive; logical pages >= 70 fail to map and are ignored): `frame = emsMap1(i); grabBackground(frame)`. Then `cur (DS:4674) = 0; frame (DS:4676) = emsMap1(0); grabBackground(frame)`. Set `centerX (5bf4) = 60; centerY (5bf6) = 35`.
  - Port: 71 buffers of 120x70, all initialised with the background window. (Only pages 0..69 exist after alloc(70); page 70 maps fail. GUESS: in the original the "frame 70" mapping fails and the previous mapping stays. See below.)
- **0b1a:0045 showRing()** near: if y > 200: return. `k = cur; srcOff = 0; dst = 65*W + 100`. For i = 0..69: `if (i > 0) { p = emsMap1(k); copy 120 bytes p+srcOff -> A000:dst }`; `srcOff += 120`; if `dst + W > 64000` return; `dst += W; k++; if (k > 70) k = 0`.
  - So screen row 65 + i (i = 1..69) gets row i of frame (cur + i) mod 71. Row 65 is never written. **EMS page 70 does not exist** (alloc was 70 pages, 0..69), so the map of k = 70 fails and the window keeps the previous mapping (page k = 69). That row then shows row i of frame 69. Port: treat frame 70 as an alias of frame 69 (GUESS, depends on the EMM).
- **0b1a:0171 doneRing()**: centerX = W idiv 2, centerY = H idiv 2 (H = DS:5bf2); emsFree.
- **0b1a:0199 stepRing()**: showRing(); `cur++; if (cur > 70) cur = 0; frame = emsMap1(cur); grabBackground(frame)` (the new oldest frame is reset to clean background).

### 0b1a:01f7 part body
Constants (cs): 01d1 = 1.0f, 01d5 = -0.1 (ext), 01df = 0.0f, 01e3 = 200.0f, 01e7 = 400.0f, 01eb = 1000.0f, 01ef = 20.0f, 01f3 = 0.75f.
```
mark(T0 = DS:a38c); DS:a3ac = 0
setClip(0, 0, W-1, H-1); SetPerspective(200); ZeroVec(&A1=554a, &A2=554e, &A3=5552); lockPalette()
if (!emsPresent() || emsFreePages() < 70) return          // whole part skipped without EMS
tmp = DS:255e + 1                                          // DS:255e init = 100, so tmp = 101 (an EMS page)
loadPCX(tmp, 0x28)                 // 39.pcx background
remapRange(tmp, lo=1, hi=104, shift=150)                   // pixels 1..104 -> 151..254, palette rotated too
pal = copy of shadow 5d98 (0x600 bytes)
loadPCX(2, 0x1f)                   // 30.pcx texture into page 2 (palette shadow now = 30.pcx)
repackPage(2, 256, 200)
setActivePage(3); copyPage(tmp, 3); freePage(tmp)
setPaletteRange(150, 255, pal)                              // background colors back
setColor(0, 0, 0, 0)
gradient(101, 130, 30,20,0, 63,40,0)
gradient(130, 149, 63,40,0, 63,50,30)
obj = 0e5a:0596(nil, VMT 0xc7e, 38, 38, 38, 9, 101, 149)    // mesh constructor (other slice; arg order as pushed)
t1 = NewTexture(2, 0, 0, 192, 150); t2 = NewTexture(2, 0, 0, 192, 150)
1342:2a90(obj, t1, t2)
TMesh.Translate(obj, 0.0, 0.0, -4500.0)                    // 0xC58CA000
ZeroVec(&A1, &A2, &A3)
s = 1.0f; ds = -0.1f (single); s42 = 0.0f; L4 = 0 (int32); L8 = 1 (int32); done = false
initRing()
addPalette(0, 255, -64, -64, -64)                            // shadow -= 64 (black)
setActivePage(3); unlockPalette(); present()                 // background on screen
pal = copy of shadow (the darkened palette)
D = 200 - elapsed(T0); mark(T1 = DS:a394)
// fade-in
do {
  if (a3a8 <= 200 && !musicOff(54e5)) setMusicVolume(Round(a3a8*64 / 200.0f))   // a3a8 from the previous iteration (initially a stale global)
  if (PollKey()) goto end            // (PollKey returns DS:a3ac; ESC halts)
  a3a8 = elapsed(T1)
  v = Round(a3a8*64 / D)  (int32 mul, FPU divide by int32 D)
  setPaletteOffset(pal, 0, 255, v, v, v)
} while (a3a8 < D)                   // signed 32-bit
if (!musicOff) setMusicVolume(64)
setPaletteOffset(pal, 0, 0, 64, 64, 64)                     // only color 0
mark(T1)
// main loop
do {
  t = elapsed(T1)  (DS:a3a4)
  if (PollKey()) break
  if (t <= 400)  { u = 400 - t;  TMesh.MoveTo(obj, 0.0, 0.0, (single)((int32)(-(u*u)*30) / 400.0f)) }
  if (t >= 3700) { u = t - 3700; TMesh.MoveTo(obj, 0.0, 0.0, (single)((int32)(-(u*u)*30) / 400.0f)) }
  TMesh.RotateWork(obj, A1, A2, A3)
  AddAngles(&A1, &A2, &A3, 0.6f, 0.8f, 0.7f)                 // 0x3F19999A, 0x3F4CCCCD, 0x3F333333
  DS:5c22 = frame; W(5bf0) = 120; buildLineTable()
  1342:3518(obj)                                           // draw the mesh into the 120x70 frame
  W = 320; buildLineTable()
  stepRing()
  if (t > 800) {
     TMesh.ScaleUniform(obj, (single)(SinR(L4*10 (int16)) * s / 1000.0f + 1.0f))
     if (s < 1.0f || s > 20.0f) ds = -ds
     s += ds; s42 += 1.0f; L4++
  }
  if (t > 1500 && cur == 0 && !done) { for i = 0..obj.word[+0x5f]-1: obj.faces(+0x59).At(i).byte[+0x7b] = 3; done = true }
  t = elapsed(T1); waitUntil(T1, Real48(L8 * 0.75f)); L8++  // the frame pacing: 0.75 tick per frame (133.3 fps target)
} while (t <= 4200)                                         // signed 32-bit
end:
obj.Done(free=1) (virtual slot +0x0c); doneRing(); freePage(2); freePage(3)
waitUntil(T0, 4500.0)                                       // Real48 0x8D,0,0x0CA0 = 4500
```
Notes:
- The `t` used in the loop condition is the value re-read just before waitUntil.
- MoveTo z: `-(u*u)*30` is int32 (no overflow in range), then FPU divided by 400.0f and stored as single. At t = 0 (u = 400), z = -12000.0. It reaches 0 at t = 400 (the fly-in), and from t = 3700 it goes negative again (the fly-out).

---

## Unit initialisation at program start (0000:a62a)
Order: RTL init (1d81:0000, 1d81:0548), then:
| Call | What it does |
|---|---|
| 1cd9:000d | Crt init (see above). |
| 1cd0:007a | waits for the floppy motor off (max 91 BIOS ticks); DS:a3c4 = DelayCnt. |
| 1cbc:0132 | timer unit: `DS:a3c2 (timerInstalled) = 0`. |
| 1c6a:04f1 | resource unit: install the exit proc, open the EXE, read the 50-entry size table. |
| 186a:3c7a | graphics unit: save ExitProc to DS:9fb0, install 186a:3c64, call 186a:3b59 (L1/L2 notes). |
| 1856:0130 | empty. |
| 179b:0754 | builds the 256-byte table DS:5aec (see 179b:0531), DS:5ae6 = 0xFE, DS:5ae7 = 1, plasma callback DS:5ae8 = 179b:05aa. |
| 1342:4540 | 3D unit: SetPerspective(200); centerX/Y = W/2, H/2; `TPixel.Init(DS:551c, 0, 0, 0, color 15)`; DS:5a8f = 1; DS:5a9c = 0; call 1342:4467 (L3b). |
| 1117:22a3 | 8x14 ROM font pointer -> DS:5518/551a. |
| 0db3:07c2 | empty. |
| 0d27:042d | music wrapper: DS:54e2 = 0 (driver loaded flag), 54e4 = 0, 54e3 = 0, **54e5 = 0 (musicOff)**, 543a = 0xFFFF, 54e6 = 0. |
| 0bcf:1569 | sound-setup unit: DS:4ca2 = 0000:[2618] (far ptr; 2618 = a BP system segment var, GUESS PrefixSeg/SegB800), DS:4ca6 = 1. |
| 0ba7:01fa | trig tables (Real48 sin/cos -360..360; int16 sin/cos*128 0..360 at DS:4696/DS:4968). |

Then the main program: `0000:a39c` (setup), `0000:a3ef` (the demo), `0000:a616`, Halt(0).

## Early main helpers
- **0000:a1b1 vesaWarning()**: if DS:5c03 (VESA present flag) == 0: TextBackground(0). Then it prints, in yellow (14), red (12), yellow: "WARNING!!! WARNING!!! WARNING!!!" (WriteLn). Then in white (15): "VESA BIOS Interface ver 1.2+ not installed,", "You will not see SVGA parts of this demo.", "press ESC now to exit, or any other key to continue...". `ch = ReadKey; if (ch == 0) ch = ReadKey`. TextBackground(0), TextColor(7). If ch == ESC: Halt(0).
- **0000:a2a4 soundSetup()**: `musicOff (54e5) = 0`. `ok = 0bcf:1548()` (the sound setup menu). If not ok: fatalError('') (186a:0000 with an empty string, a quiet exit).
- **0bcf (sound setup, summary)**: a Crt text-mode menu (Window, GotoXY, TextColor). It has the items "Run DEMO / >>Start DEMO<<", "Test Sound Card" ("Testing Sound Card", "Playing Music...!   Press any key to stop playing."), and "Change Settings" (Choose Sound Card / Port / DMA / IRQ, plus a "Sound Card: / Base Port: / DMA: / IRQ: / Mix Rate:" info box, "Sound Error"). 0bcf:1548 runs it and returns true to start the demo. Choosing "no sound" presumably sets DS:54e5 (musicOff; GUESS). The port can replace all of this with a click-to-start screen.
- **0000:a39c setup()**: vesaWarning(); soundSetup(); save ExitProc -> DS:2682 and install 0000:a370; `DS:2686 = 0; DS:9fa6 = 0`; **Randomize** (seeded from the clock); 186a:02b2 (save the text screen); setMode(0) (mode 13h); 1cbc:0029 (install the 100 Hz timer: PIT ch0 divisor 0x2E9B = 11931, then reset the tick counter); 186a:3a6c (mask IRQ1, so the keyboard is polled through port 60h by PollKey).
- **0000:a370 exit proc**: restore ExitProc; 0d27:0167 (music shutdown); 186a:3a75 (unmask IRQs: out 21h, 0). If DS:9fa5 == 0: endScreen() (0000:a2c1). Then 1cbc:0065 (restore INT 8 and the PIT to 18.2 Hz).
- **0000:a2c1 endScreen()**: setBiosMode(3); `openResBuf(0x2b, 5000)` (42.bin, the 80x25 text screen); clearBuf(); restart(); read 2000 words into the saved-text-screen buffer DS:5d8a; closeRes(); restoreTextPalette(); addPalette(0, 255, -64, -64, -64) (black); restoreTextScreen (186a:0160, copies the buffer to video memory); 186a:02ca (cursor to column 1, row 26); timedFade(0, 255, +1, +1, +1, steps 64, duration 200 ticks) (2 s fade-in of the text screen); restore the cursor (186a:02bb); GotoXY(1, 23); TextBackground(0); TextColor(7).
  - DS:9fa5 is BSS (0). PollKey writes 9fa5 = 0 only after Halt (dead store), so the end screen is always shown unless another slice sets 9fa5.
