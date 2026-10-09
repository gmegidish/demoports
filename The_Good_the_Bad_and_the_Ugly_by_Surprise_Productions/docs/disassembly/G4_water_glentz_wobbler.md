# G4: Water-effect, Glentz-Vector, Picture-Wobbler (GBU.EXE, Surprise! Productions 1993)

Slice: `0749:01cc` (Water), main `0670..0692` + `08d8:1625` + `08d8:16de` (Glentz), `08a8:01f2` (Wobbler).

All three effects were checked against the reference recording with literal Python models
(`work/G4/water2.py`, `glentz.py`, `wob.py`, `wobpal.py`, `dis.py`, `rle.py`). Every frame of the
three effects is reproduced **pixel-exactly**, except the two transition frames named below. Time base: global
frame G, t = G / 70.086 s (the `capat.py` time base).

## Summary (what is seen, in order)

| Global frames | Time (s) | What | Mode |
|---|---|---|---|
| 8671..8730 | 123.72..124.56 | Water: the picture fades in from white (60 steps) | 320x400, unchained 256 colours |
| 8731..8880 | 124.58..126.70 | Water: still picture (150 frames) | same |
| 8881..9790 | 126.72..139.69 | Water: per-scanline CRTC offset ripple, 910 frames | same |
| 9791..10089 | 139.70..143.95 | Water: ripple goes on and the picture scrolls down off the screen (299 frames) | same |
| 10090 | 143.97 | black (end of the water effect) | |
| 10091..10092 | 143.98..144.00 | black (the first glentz page is still empty) | 320x200 16 colours, planar |
| 10093..11001 | 144.01..156.96 | Glentz: a blue cube inside a transparent green "star tetrahedron", renders 0..908 | same |
| 11002 | 156.98 | transition garbage (mode switch frame); the port shows black | |
| 11003 | 156.99 | wobbler VRAM shown linearly (80-byte stride, start 0), palette almost black | 320x200 unchained 256 |
| 11004..11483 | 157.01..163.84 | Wobbler: the fractal picture wobbled sideways per row, fades in during the first 60 frames | same, CRTC offset 0xa0 |
| 11484..11583 | 163.86..165.27 | still (unwobbled) picture, 100 frames | same |
| 11584..11873 | 165.28..169.41 | the picture dissolves into green "bubble" blocks, 4 per frame | same |
| 11874..12189 | 169.42..173.92 | all blocks, palette shimmer, **until music sync #6 (MOD effect 8xx)** | same |
| 12190..12192 | 173.93..173.97 | white flash (main script, not this slice) | |

Capture-file mapping: file 6 (`video0006.avi`, 1420 frames) = the water effect exactly. File 7 (`video0007.avi`,
2102 frames) = glentz (frames 0..910), then wobbler (911..2098), then white (2099..2101).

## Shared helpers (used by this slice and by others)

- `0299:0000` RLE decoder (all pictures). `0299:0023` palette interpolation. `0299:0076` set DAC.
  `0299:0175` sets the unchained 256-colour 320x200 mode. `0299:01cc` sets the 16-colour planar 320x200 mode.
- `0731:00a3` waits one tick. `0731:013c`, `0731:0120`, `0731:0158` switch the timer modes. `008e:1f63` is the
  music tick.
- `008e:18a4` returns the **music sync counter** (`008e:11cc`). It is incremented only by the MOD effect-8xx handler
  `008e:1e8e` (effect jump table at `008e:11ab`, entry 8). The wobbler's last phase waits for it to reach 6.
  The same getter is also called at 08d8:1941, 08d8:2c6c, 0cc5:030c, 0cf9:0208 and 0cf9:0334.
- `0777:0401` / `0777:03d9` are pseudo-random generators over `p3_sin`. Their state (`0777:0032`, `0777:0034`) is
  shared with the chess effects that come later.
- The 08d8 glentz 3-D engine (`128d` and the routines it calls) is shared with the intro cube (`196e`), the
  `275d` effect, the two-glentz-cubes effect (`25f4`) and the transforming objects.
- **`08d8:16de` is not a renderer.** It only clears the screen and sets the start address to 0. Main calls it after
  the glentz and again after the two-glentz-cubes effect (083a).

---

## Common helpers

### 0299:0000 — RLE decode
Inputs: ds:si = source, es:di = destination, bx = exact output size.
```
do { c = src[si++];
     if (c <= 0x7f) { n = c+1; copy n literal bytes; }
     else           { n = 0x101 - c; v = src[si++]; write v n times; }   // c=0x80 -> 129, c=0xff -> 2
     bx -= n; } while (bx != 0);
```
`watr_pic` (from offset 0xc0) and `wave` (from offset 0) both decode to exactly 64000 bytes and use exactly the
whole file.

### 0299:0023 — palette interpolation
Inputs: ds:si = from, ds:di = to, ds:bp = output (bp advances), cx = number of colours, dl = divisor, dh = step.
For each of the cx*3 bytes:
```
d = (int8)(to - from);              // 8-bit wrap
q = trunc((d * (int8)dh) / (int8)dl); // imul then idiv, rounds toward 0
out[bp++] = (from + q) & 0xff;
```

### 0299:0076 — set DAC
Inputs: di = first index, cx = number of colours, ds:si = 6-bit RGB values.
It sets SR1 bit 5 (screen off), writes 3c8 = di and then cx*3 bytes to 3c9, and clears SR1 bit 5 again.
The screen-off bit is **visible** when this runs during the display: see the wobbler fade.

### 0299:0175 — unchained 256-colour 320x200
AC 0x10 = 0x41, GC 5 = 0x40, SR1 = 0x01, SR4 = 0x06. CRTC 0..0x18 come from `0299:015c`:
`5f 4f 50 82 54 80 bf 1f 00 c0 00 00 00 00 00 00 9c 8e 8f 28 00 96 b9 e3 ff`.
So CRTC9 = 0xc0 (each row is double-scanned to 400 lines), start = 0, offset = 0x28 (80 bytes per line), byte mode.
The routine ends with `sti`.

### 0299:01cc — 16-colour planar 320x200
AC 0x10 = 0x01, GC 5 = 0x00, SR1 = 0x09, SR4 = 0x06. CRTC values come from `0299:01b3`
(offset 0x14 = 40 bytes per line, CRTC9 = 0xc0). The AC palette registers are the identity (set once by `0299:005e`
at start-up), and AC 0x14 bits 3..2 = 0. So pixel value i uses DAC i.

### Main-script helpers
- `0000:001b` writes 300 bytes of 0x3f from DAC index 0, so colours 0..99 become white.
- `0000:002b` writes 768 zero bytes, so all 256 colours become black.

### 6-bit to 8-bit colour
The capture matches `round(v*255/63)`.

---

## 1. Water-effect — 0749:01cc

### Variables (segment 0749)

| addr | name | initial value |
|---|---|---|
| `[0]` w | ripple phase (index into watr_dat) | 0 |
| `[2]` b | "ending" flag | 0 |
| `[3]` w | CRTC start address | 0 |
| `[5]` w | number of rippled lines | 1 |
| `[0x17]` | segment of `watr_dat` (res 00, 641 bytes; 640 are used) | |
| `[0x19]` | segment of `watr_pic` (res 01) | |
| `[0x112]` | 64000-byte buffer allocated with `008e:0014`, bx = 0xfa0 | |

### Data
- `watr_pic` holds a 64-colour palette (192 bytes, 6-bit values), then RLE data that decodes to 320x200 bytes.
  The picture uses colours 0..62.
- `watr_dat` holds 640 bytes. Each is a CRTC 0x13 value: 0 = repeat the line, 40 = normal, 80 = skip one line.

### Steps
1. Wait for the start of vertical retrace (3da bit 3: wait while it is set, then wait until it is set).
   Write DAC index 0 and 162 bytes of 0x3f, so colours 0..53 become white.
2. Clear all planes, a000:0000, 0x1f40 words.
3. Call `0299:0175`.
4. Decode `watr_pic+0xc0` into the buffer with RLE.
5. `0114` copies the picture to VRAM at 0x5dc0. Each source row goes to 2 consecutive 80-byte lines (400 lines):
   ```
   for p in 0..3 (map mask 1<<p): for r in 0..199: for c in 0..79:
       VRAM[p][0x5dc0 + 80*(2r)   + c] = pic[r*320 + 4c + p];
       VRAM[p][0x5dc0 + 80*(2r+1) + c] = pic[r*320 + 4c + p];
   ```
6. CRTC9 = CRTC9 & 0x60 (double scan off, so 400 single lines). Start address = `[3]` = 0x5dc0.
7. buffer[0..0xbf] = the picture palette, buffer[0xc0..0x17f] = 0x3f (white).
   `0731:0158` puts the BIOS timer back, so from here **the music is ticked by hand** with one `1f63` per frame.
8. Fade (`0153`, ax = 0x3c colours, dl = 0x3c steps):
   ```
   for dh in 1..60 {
     interpolate(from = white, to = picture palette, 60 colours, dl = 60, dh) -> buf+0x180;
     wait for vsync start;
     setDAC(0, 60 colours);
     music tick;
   }
   ```
   **Only colours 0..59 are faded.** Colours 60..63 keep the values the previous effect (chess, 08d8:18d4) left.
   The recording shows (1,1,1) for colours 60..62 (63 is not used). Step dh = k is shown at file-6 frame k-1.
9. `0067`, the animation:
   ```
   repeat 150: { wait for vsync start; music tick; }            // still picture
   [5] = 1;
   cx = 910;
   loop {
     music tick;
     if ([2]) { [3] -= 0x50; if ([3] == 0) break; }            // ending scroll
     if ([5] < 400) [5]++;
     set CRTC start = [3]; wait for vsync start (bit 3 0->1);
     si = [0];
     for k in 0..[5]-1 { v = watr_dat[si]; si = (si+1) % 640;
         wait until 3da bit 0 = 1; CRTC 0x13 = v; wait until bit 0 = 0; }
     for k in [5]..399 { wait until bit 0 = 1; CRTC 0x13 = 0x28; wait until bit 0 = 0; }
     [0] = ([0] + 2) % 0x280;
     if (--cx == 0) [2] = 1;   // the loop then continues until the scroll ends
   }
   CRTC 0x13 = 0x00;           // `mov ax,0x13; out dx,ax`: the offset becomes 0
   ```
10. `0731:0120` (plain 70 Hz music timer). Clear VRAM with all planes, `rep stosw` of 0xfde8 words from 0.
    This wraps around, so all 64K is cleared. CRTC9 |= 0x80. Start address = 0.

### Display model (verified)
- Line 0 starts at S = `[3]`.
- line(k) = line(k-1) + 2*v_k, where v_k = watr_dat[([0]+k) % 640] for 1 <= k < [5], and v_k = 0x28 otherwise.
- The value written during vblank (k = 0) is never used.
- Each line shows 80 bytes (320 pixels; pixel x = plane x&3, byte x>>2).

### Timeline (file-6 frame f)

| f | Shown |
|---|---|
| 0..59 | fade step f+1 |
| 60..209 | still picture |
| 210..1119 | iteration i = f-210, with [5] = min(i+2, 400) and phase = 2i mod 640 |
| 1120..1418 | scroll, j = f-1120: S = 0x5dc0 - 0x50*(j+1), [5] = 400, phase = 2(f-210) mod 640 |
| 1419 | black |

No frames are dropped.

---

## 2. Glentz-Vector

### Main script
1. `065e` 0299:01cc.
2. `0670` setDAC(0, 16 colours from `08d8:1479`):
   `0,0,0 11,11,20 13,13,23 16,16,26 30,40,30 22,32,35 25,35,39 29,39,45 10,20,10 11,11,20 13,13,23 16,16,26 20,30,20 22,32,35 25,35,39 29,39,45`.
3. `0675` 0731:013c (retrace timer).
4. 08d8:1625.
5. 08d8:16de.
6. Wait one tick.
7. 0000:002b (all colours black).
8. 0299:0175.

### 08d8:1625 — driver
Sets `[0x914]` (y centre, an immediate inside 07cb) = 100, `[0xa3]` zdist = 0x1356 (4950),
`[0x8e]` xoff = -80, `[0x1578]` dx = 2, `[0x157a]` dz = 25.
It then runs 5 phases. Each phase is `cx += N; do { 158f(); cx -= ticks; } while (cx > 0)`, so any overshoot carries
into the next phase:

| N | dx | dz |
|---|---|---|
| 120 | 2 | 25 |
| 110 | 0 | 0 |
| 300 | 0 | 5 |
| 250 | 0 | 0 |
| 130 | 2 | -30 |

That is 910 ticks in total.

### 158f — one frame
```
14a9: CRTC start = [0x1413]; wait tick (0731:00a3); CRTC9 = (CRTC9&0x60)|([0x92]+1)   // [0x92]=0 -> 2 lines per row
      [0x1413] ^= 0x1f40; [0xe61] ^= 0x1f4        // page offset / VGA segment a000<->a1f4 (self-modified imm at 0e60)
1417: clear the previous bbox on the new hidden page (see below)
1514: bb=b3, bd=b5, b7=af, b9=b1;  b3=1000, b5=0, af=1000, b1=0
128d: render object at 05ca (es=ds=05ca, linear 0x5ca0)
157e: ticks = 0731:[4]                             // 1 at 70 Hz; the recording never needs more
repeat ticks: { 1535: a97+=2, a99+=4, a95+=2 (each mod 0x5a0); xoff += [0x1578]; zdist -= [0x157a]; }
```
So render k uses the state after k ticks and is **shown at file-7 frame k+2**. Renders 0..908 are visible.
Render 909 is never shown, because 16de clears the screen at once.

**Initial angles (verified exactly against all frames):** a95 = 40, a97 = 584, a99 = 0. These are byte offsets
into the sine table. They are not set by 1625. They are left over from the `275d` effect:
- 99 only gets +0.
- 97 gets 6*280 + 8*43 = 2024, which is 584 mod 1440.
- 95 = 1080 - 1040 = 40.

The port just hard-codes them.

### Sine table
`08d8:00c1`, 900 int16 values (`img.bin` linear 0x8e41). There are 720 entries per turn, amplitude 32767,
and cos = entry + 180. It is not reproducible by a formula (errors up to 7), so **copy the table**.
Byte offset a gives sin = T[a/2] and cos = T[a/2 + 180].

### Object at 05ca:0000
- Header: `[0]`=4 planes, `[2]`=10 faces, `[4]`=0xb4 face list, `[6]`=0x16c edge table, `[8]`=14 vertices,
  `[0xa]`=0x60 projected vertex array (x, y, z per vertex, 6 bytes each; vertex i is at 0x60+6i).
  The vertices are at `0xc` (x, y, z int16).
- Vertices: the cube (±240, ±240, ±240) in the order (-,-,+) (+,-,+) (+,+,+) (-,+,+) (-,-,-) (+,-,-) (+,+,-) (-,+,-),
  then (0,-720,0) (0,0,-720) (720,0,0) (0,0,720) (-720,0,0) (0,720,0).
- A face is `colour word, n, n × (p0, p1)`, where p0 and p1 point into the projected array.

| Face | Colour | Vertices (projected offsets) |
|---|---|---|
| 0 | 0x0001 | 60-66-6c-72 |
| 1 | 0x0001 | 7e-78-8a-84 |
| 2 | 0x0002 | 78-7e-66-60 |
| 3 | 0x0002 | 6c-84-8a-72 |
| 4 | 0x0003 | 66-7e-84-6c |
| 5 | 0x0003 | 60-72-8a-78 |
| 6 | 0x0c04 | 90-96-9c (triangle) |
| 7 | 0x0c04 | 90-a2-a8 (triangle) |
| 8 | 0x0c04 | a2-9c-ae (triangle) |
| 9 | 0x0c04 | a8-ae-96 (triangle) |

  The low byte is the plane mask for a front face. The high byte is XORed in for a back face; if it is 0, the back
  face is skipped. So the cube uses planes 0..1 and is opaque. The triangles use plane 2 when front-facing and
  plane 3 (4^0xc = 8) when back-facing, which gives the transparent glentz.

### 07cb — rotate and project (self-modifying immediates; all imul take the high word = floor(p/65536))
Per vertex: X=2x, Y=2y, Z=2z (16-bit). s1,c1 come from a97, s2,c2 from a99, s3,c3 from a95, and hi(a,b) = (a*b)>>16.
```
A  = 2*(hi(Z,c1) + hi(X,s1));   X1 = 2*(hi(X,c1) - hi(Z,s1))
Y1 = 2*(hi(X1,s2) + hi(Y,c2));  X2 = hi(X1,c2) - hi(Y,s2)
Y3 = hi(Y1,c3) + hi(A,s3);      Z3 = hi(A,c3) - hi(Y1,s3)
d  = Z3 - 400 - zdist;          px = idiv(-400*X2, d) + xoff;   py = idiv(-400*Y3, d)
mode [0x92]: 0 -> py + [0x914] (=100);  1 -> (2py)/3 + 0x42;  2 -> 2py + [0x914]
store (px, py', Z3)          (all 16-bit, idiv truncates toward 0)
```

### 128d — faces to edge table, then per-plane XOR polygons
1. Edge count `[[6]]` = 0. Project all vertices.
2. For each face, with A = p0 of edge 0, B = p1 of edge 0 and C = p1 of edge 1 (0926):
   `v = (Cy-Ay)*(Bx-Ax) - (By-Ay)*(Cx-Ax)` (32-bit). v < 0 means a back face: skip it if bh = 0, otherwise bl ^= bh.
3. For each edge of a drawn face:
   - Load (x0,y0) = p0 and (x1,y1) = p1.
   - Normalise: if y0 < y1, swap the points. If y0 == y1 and !(x1 > x0), swap x0 and x1.
   - Search the 9-byte entries `{mask, x0, y0, x1, y1}`. If one matches, mask ^= bl. Otherwise append it with
     count++.
   - So an edge exists in a plane only if an odd number of drawn faces of that plane share it.
4. Per plane p = 0..3 (bl = 1<<p, map mask = bl, DS = `scr_data` segment = 08d8:[0]):
   - Set bbox ad = -1000, ab = 1000, a9 = -1000, a7 = 1000, and ad1 = 0.
   - For each edge with mask & bl, call 13f7: clip (0b70). If it is accepted: bbox update (0f93), draw the line (097f),
     ad1++. Then, if flag [0x9b] is set, draw the x=0 line (0ad3).
   - If byte `[0x128c]` == 1 (initial value 1): if ad1 != 0, fill (0e00). Then 0fe1 merges the bbox:
     b1 = max(b1, a9), af = min(af, a7), b5 = max(b5, ad), b3 = min(b3, ab).

### Edge buffer
`scr_data` (res 10, 8521 bytes) is used as the edge buffer:
- bytes 0..0x1f3f: 40 bytes × 200 rows, all zero.
- 0x1f41..0x1f48: pixel masks `80 40 20 10 08 04 02 01`.
- 0x1f49: T0[256], a prefix XOR from the MSB (bit k of the output = XOR of input bits 7..k).
- 0x2049: T1 = ~T0.

These are generated tables (checked). An edge pixel at (x,y) does `buf[y*40 + x>>3] ^= 0x80>>(x&7)`.

### 0b70 — clip
Inputs: x0=si, y0=di, x1=bp, y1=dx. The ymax limit is `[0x90]` = 199. All comparisons are signed.

Outcode cl (point 0) / ch (point 1): 1 = x<0, 4 = x>319, 2 = y<0, 8 = y>199. cx = cl | ch<<8.

- **If cl & ch is nonzero (rejected):**
  - 0b24: if cx&0x101, ab = 0. If cx&0x202, a7 = 0. If cx&0x404, ad = 319. If cx&0x808, a9 = 199.
  - If (cl&ch&1) and not (&2 or &8) and y0 != y1: [0x9b] = 1, [0x9c] = max(min y, 0), [0x9e] = min(max y, 199).
  - Do not draw.
- **Else if (cl|ch) == 0:** draw unchanged.
- **Else:** let q(p,d) = d ? idiv(p,d) : low16(p).
  - If cl != 0:
    - if x0<0: [0x9b] = 1; [0x9c] = clamp(y0, 0, 199); y0 += q((y1-y0)*(-x0), x1-x0); [0x9e] = y0; x0 = 0.
    - if cl&4 and x0>319: y0 += q((y1-y0)*(319-x0), x1-x0); x0 = 319.
    - if cl&2 and y0<0: x0 += q((x1-x0)*(-y0), y1-y0); y0 = 0.
    - if cl&8 and y0>199: x0 += q((x1-x0)*(199-y0), y1-y0); y0 = 199.
  - If ch != 0, do the same for point 1. Two differences:
    - for x1<0, [0x9c] = clamp(y1) and [0x9e] = the new y1;
    - in the x1>319 case, x1 = 319 is skipped when x1-x0 == 0.
  - Finally clamp x0 and x1 to 0..319 and y0 and y1 to 0..199, then draw.

### 097f — XOR line
One pixel per row, rows ymin+1..ymax. Horizontal edges are not drawn.
Let (xb, yb) be the point with the larger y, xt the other x, dy = yb - yt, d = xt - xb, s = sign(d), da = |d|.
```
da==0 or da==dy: for k<dy: xor(x,y); y--; x+=s (if da)
da>dy : xor(xb,yb); err=0; rows=dy; loop { x+=s; err+=2dy; if(err>da){ y--; if(--rows==0) return; err-=2da; xor(x,y);} }
da<dy : err=0; for k<dy: { xor(x,y); y--; err+=2da; if(err>dy){ err-=2dy; x+=s; } }
```

### 0ad3 — left border line
lo/hi = [0x9c]/[0x9e] (swapped if needed), then lo = max(lo, 0) and hi = min(hi, 199).
For rows lo+1..hi: `buf[row*40] ^= 0x80`. Then ad1++ and [0x9b] = 0.

### 0e00 — fill
Rows a7..a9. Bytes from ab>>3 through (ad>>3) inclusive (logical shifts). For each row, inside = 0, then for each
byte p in the span:
- if buf[p] != 0, or p is the last byte of the span:
  `VGA[page+p] = T[inside][buf[p]]`; if popcount(buf[p]) is odd, inside ^= 1; buf[p] = 0.
- else, if inside: `VGA[page+p] = 0xff` (the byte is otherwise not written).

### 1417 — clear the previous bbox on the hidden page
```
bp = bd>>4; dx = bb>>4; if (bp < 20) bp++; bp -= dx; if (bp <= 0) return;
if (b9 - b7 < 0) return; rows = b9 - b7 + 1;
write zero words to all planes (map mask from the immediate at 1461 = 0x0f02):
  bp words per row, starting at b7*40 + 2*dx + page, row stride 40
```

**Port shortcut (verified identical on all 910 frames):** clear the whole hidden page every frame. The edge buffer
also never keeps stale bits. A frame = 4 bit planes; pixel colour = Σ plane_bit << p, through the 16-colour DAC.
Pages are at plane offsets 0 and 0x1f40 (only needed for a literal port).

A literal model that matches every frame is in `work/G4/glentz.py`.

### 08d8:16de
Clears a000:0000 with all planes (0x1f40 words) and sets the CRTC start address to 0.

### Timeline (file-7 frames)
- 0..1: black.
- 2..910: renders 0..908.
- The object enters from the left: x starts at -80, so the left-clipping paths are used.
- Ticks 120..230: it stays at x=160, z=1950.
- Ticks 230..530: it approaches to z=450 (it nearly fills the screen around t≈152..155 s).
- Ticks 780..910: it leaves to the right (x 160 to 420, z to 4350). The screen is black from frame 888.

---

## 3. Picture-Wobbler — 08a8:01f2

### Variables (segment 08a8)

| addr | name | initial value |
|---|---|---|
| `[0]` w | sine phase | 0 |
| `[0xa]` | `wave` (res 07, RLE picture) | |
| `[0xc]` | allocated picture buffer, 0xfa0 paragraphs | |
| `[0x1e]` | `wave_sin` (res 08) | |
| `[0x20]` | `wave_ran` (res 09) | |
| `[0x4a]` | palette work area, 0x175 paragraphs | |
| `[0xa1]` w | palette fade pointer | 0x1680 |
| `[0x14d]`, `[0x14f]` w | random column / row | 0, 0 |

### 00a3 / 004c — setup
1. pal[0..0x5f] = wave_sin[0..0x5f] (32 colours). pal[0x1680..0x16df] = 0.
2. For dh = 0..59: interpolate(from pal+0, to pal+0x1680, 32 colours, dl = 60, dh) → pal + 0x60*(dh+1).
   Block j (1..60) = palette faded by (j-1)/60. Block 60 is computed in place over the "to" buffer, so it is
   `from - trunc(from*59/60)` (nearly black, not black).
3. RLE-decode `wave` (from offset 0) to 64000 bytes. It uses colours 0..31.
4. 0022 copies it twice into VRAM, with a row stride of 320 bytes:
   `VRAM[p][base + 320r + c] = pic[r*320 + 4c + p]` for base 400 (0x190) and base 561 (0x231).

### Main loop (`0731:0158` first: BIOS timer, so the music is ticked by hand once per frame)
```
for i in 0..479:
  if ([0xa1]) { setDAC(0, 32 colours from pal+[0xa1]); [0xa1] -= 0x60; }   // 01bb, SR1 screen-off during it
  wait for vsync END (3da bit3: wait while 0, then while 1);  CRTC 0x13 = 0xa0
  prev = 0x50; si = 0x60 + [0]
  for k in 0..197: bp = word wave_sin[si]; si += 2;
      wait 2 scanline ends (bit0: while 1, while 0, while 1, while 0)
      CRTC 0x13 = (0xa0 + bp - prev) & 0xff;  prev = bp
  [0] += 6; if ([0] >= 0xfa0) [0] -= 0xfa0      // never wraps in 480 frames; max read is file offset 3364 < 3374
  music tick
```

### Display model (verified pixel-exact)
- The start address stays 0, as set by 16de and the 0175 table.
- rowStart(0) = 0, so the row shows bytes 0..79, which are black.
- rowStart(y) = rowStart(y-1) + 2*O_{y-1}, with O_k = 0xa0 + bp_k - bp_{k-1} (bp_{-1} = 0x50) for k ≤ 197.
- Row 199 reuses O_197. The value written in vblank is unused.
- The result is rowStart(y) = 320y + 2*bp_{y-1} - 160.
- Each row shows 80 bytes (320 pixels); every row is double-scanned.
- Alternating bp values of about X and X-81 select copy A or copy B (B is offset by an odd byte), which gives
  4-pixel steps.

### Fade
Iteration i shows palette block 60-i for i < 60, and block 1 (the original palette) afterwards.

Raster artifact (verified) for i = 0..58: the next palette is written at about row 198, so **row 198 is black**
(the screen-off bit) and **row 199 already uses block 59-i**.

File-7 frame 912 (before the loop) = VRAM shown with stride 80 from 0, using block 60.

Wobble iteration i is shown at file-7 frame 913+i.

### After the loop
1. Start address = 0x50 and CRTC 0x13 = 0xa0. The image is then copy A shifted down one row, with row 0 black.
2. Repeat 100 times: wait for vsync start; music tick. These are frames 1393..1492.
3. Repeat 290 times (n = 0..289, shown at frame 1493+n):
   wait for vsync start; 0151; music tick; then 4 times: `di = wave_ran[4n+k]`, 011e(di, bl = 0x20).
4. Then, each frame: wait for vsync start; 0151; music tick; until `008e:18a4` (music sync counter) >= 6.
   In the recording that is 316 more frames, 1783..2098. Then retf.

### 011e — block
For 28 VRAM rows (stride 0x50) × 2 bytes × 4 planes, write colours bl, bl+1, … (bl is never reset, so row r uses
0x20+8r .. +7).

With the display stride of 320, only the r ≡ 1 mod 4 rows are visible. That makes an 8×7 block whose row m uses
colours 40+32m .. 47+32m. All `wave_ran` targets satisfy (di-0x50) % 320 ∈ 240..318 (even).

Colours 32..255 start black (all black from 0000:002b). Only the colours set by 0151 ever show.

### 0151 — palette shimmer
```
si = ([0x14d]&7)*3 + ([0x14f]&7)*0x30;  di = 40
repeat 7: { setDAC(di, 8 colours from img linear 0x5ee0 + si); di += 32; si += 0x30; if (si >= 0x150) si -= 0x150; }
[0x14d] = rndA(); [0x14f] = rndB()
```
The table at 0x5ee0 is 0x150 bytes. Reads can run up to about 0x17d past it, so copy 0x180 bytes.

The random generators:
```
rndA (0777:0401): v = p3_sin[A]; A += 3; if (A >= 0x258) A = 0; return v & 7    // A = 0777:[0x32], starts 0
rndB (0777:03d9): v = p3_sin[B]; B += 2; if (B >= 0x258) B = 0; return v & 7    // B = 0777:[0x34], starts 190
```
These are not used before this effect. The state continues into the later chess effects.

The palette and the 4 blocks of iteration n both appear in the same captured frame (verified).

---

## Open points / GUESSes
- The DAC colours 60..63 during the water effect come from the end state of the chess effect (observed as 1,1,1).
- The transition frame at file-7 frame 911 (global 11002) is not modelled; show black.
- The end of the wobbler depends on the music: it waits for the 6th 8xx command. The port must take it from the
  player (or hard-code 316 frames after the dissolve).
