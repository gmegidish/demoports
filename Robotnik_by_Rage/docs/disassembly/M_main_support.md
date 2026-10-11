# M: main, sequencer, timing/sync, shared helpers

Slice M of the Robotnik disassembly notes. It covers program flow, MIDAS usage, timing and the sync
tables, the shared helper routines, and the picture, palette and font formats those helpers use. The
parts and the 3D engine are covered in other files.

Conventions: Watcom register calls (eax, edx, ebx, ecx, then stack) unless marked *cdecl*.
"VGA" means 0xa0000 (320x200, linear, mode 13h). Palettes are 6-bit (0..63) DAC values.
"Verified" means I checked the claim by running the original code in unicorn or by decoding a real file.
The scratch scripts are in `scratchpad/agents/M/` (`emu.py`, `xm.py`, `users.py`).

---------------------------------------------------------------------------------------------------

## 1. main `0x12b7c (argc=eax, argv=edx)`

Local options and their defaults:

| local | default | set by | meaning |
|---|---|---|---|
| start | 0 | `/sN` (N decimal) | first part to run (0..15). Also sets `[0x91280] = startSync[N]` (table at 0x80010, see 4.3) |
| rVal | 0 | `/rN` | passed to inits of parts 0, 10, 12, 14 (eax). Patches the sync tables (see below) |
| r6flag | 0 | `/r6` | =1 when N==6; passed to part 9 init (0x1f064) |
| introOnly | 0 | `/i` | skip the demo half |
| pVal | 0 | `/pN` | passed to part 3/5 init (0x23264 eax). Patches intro rows (see below) |
| stop | 0x63 | `/qN` | last part to run |
| midasCfg | 0 | `/m[N]` | = N+1 (so plain `/m` gives 1). Non-zero forces the MIDAS setup screen |
| useArchive | 1 | `/l` | 0 means load loose files from disk instead of the data appended to the EXE |
| helpShown | 0 | bad option | 1 means print help and exit without running |
| (global) `[0x80054]` | 1 | `/c` → 0 | turns on the "free all leaked mallocs" wrappers around some parts |
| (global) `[0x91284]` | 0x80058 | | pointer to the active sync table (intro table first) |

`/d` sets start=7 and `[0x91280]=[0x8002c]` (=0), so only the demo half runs.

Parsing: each argv[i] (i≥1) must start with `/` or `-`. The next char c is used as `switch(c-'a')`,
with a jump table at 0x12b30 (19 entries, 'a'..'s'). Any other char, including upper case, prints
the help text and sets helpShown. `/a` is a no-op. `/b /e /f /g /h /j /k /n /o` print help.
Numbers are decimal: `n = n*10 + ch-'0'` over the rest of the string, with no validation.

Patches made by `/rN` (default run: none of these apply):
- N==6: `[0x8026c]=0x10` (demo entry 11 row: 0 becomes 16), r6flag=1.
- N!=6 (including `/r0`): intro entry 3 = (pos 3,row 0) (`[0x80088]=3,[0x8008c]=0`); demo entry 13
  row=7 (`[0x8028c]`); demo entry 22 row=0x1d (`[0x8031c]`); demo entry 31 row=0x1f (`[0x803ac]`).

Patches made by `/pN` (any N): intro entry 11 row=0x36 (`[0x8010c]`), intro entry 16 row=0x3f (`[0x8015c]`).
These look like alternate versions or debug tweaks. The port should use the default (unpatched) tables.

Then:
```
if (!helpShown) {
    init_0x12100(useArchive);                    // precalc, see 1.1
    sequencer_0x123f0(start, rVal, pVal, r6flag, /*stack:*/ midasCfg, introOnly, stop);
    fpu_restore_0x11a58();                       // restore x87 control word
    lib_0x2cc8c();                               // libc/archive shutdown
}
```
Help strings are at 0x8d612... ("Robotnik by Rage 1997", "/sn start at position n, 0..13", ...).

### 1.1 `0x12100 init(eax=useArchive)`
1. `0x2d2c4`: `[0x1060e0]=0` (malloc tracking off).
2. If useArchive: open the appended archive `"robotnik.exe"` (0x2cb80). On failure print "loader error" and exit(1).
3. `0x11bc0` builds the sine table (see 3.2).
4. `0x22180` (glod precalc for parts 2/4/6): `[0x11494] = malloc(0x2000)`. Loads `gl_pal.col` (768 bytes)
   into 0xdf8a0. Then `buildBrightenTable(32, pal=0xdf8a0, out=[0x11494])` (0x1d340).
5. `0x21d7c("presents.raw")` (part 1 precalc): loads the first 0x300 bytes of presents.raw (its palette)
   to the stack, then `buildBrightenTable(32, pal, out=0xdc710)`.
6. Row-offset table `0x90e5c[256]` (dwords): `t[i] = min(i,200)*320`, so t[0..200]=i*320 and t[200..255]=64000.
7. `0x11a39`: set the x87 precision control to **24-bit (single)**: `cw &= 0xfcff`. Rounding stays
   round-to-nearest. **All float math in the demo runs at single precision** (add/sub/mul/div/sqrt
   rounded to 24-bit mantissa). For bit-exact ports, `Math.fround` each such op. fsin/fcos/fpatan are
   not affected by PC.

---------------------------------------------------------------------------------------------------

## 2. Sequencer `0x123f0`

Args: esi=start, `[esp+14]`=rVal, edi=pVal, `[esp]`=r6flag, ebp=stop, `[esp+28]`=midasCfg, `[esp+2c]`=introOnly.
It returns with `ret 0xc`, and the return value (elapsed seconds) is ignored.

`run(k)` below means: the part runs only if `start <= k && k <= stop`.

```
midasSetDefaults();                         // 0x2d884
midasDetectSD();                            // 0x2d574 -> [0x10610c] card type, [0x10613c] SD
ok = 1;
if (midasCfg || ([0x10610c] != 0 && [0x10610c] != 4)) ok = midasConfig();   // 0x30e2c, 0 = user ESC
if (!ok) return;
setMode(0x13);                              // 0x11a92
err = tmrGetScrSync(&scrSync /*0x90254*/);  // 0x2fedc, measures the display refresh
if (err) midasError(err);                   // 0x2d4f0 prints "MIDAS Error: ..." and exits
setMode(3);
if ([0x1062d4]==0) { printf("Warning! Unable to synchronize to display refresh!..."); while(!kbhit()); }
midasInit();                                // 0x2d5e0
printf("Using %s\n%s, port %X, IRQ %i and DMA %i\n", ...SD fields...);
if (start < 7) gmpLoadXM("pullmax.xm", 1, 0, &module /*0x90258*/);   // 0x1c0a8 (cdecl)
setMode(0x13);
installKeyboard();                          // 0x118ce, see 3.6
// ---------------- intro (song pullmax.xm, sync table 0x80058) ----------------
if (start < 7) {
    midasPlayModule(module, 0);                         // 0x2d9cc
    tmrSyncScr(scrSync, timerTick_0x12280, 0, 0);       // 0x301c0: preVR callback = 0x12280
    getStatus(); frame = row*49/5;                      // [0x91260]
    if (syncIdx) { gmpSetPosition(playHandle, table[syncIdx].pos); getStatus(); frame = row*49/5; }
    getStatus();
    run(0): [trk] 0x21674(rVal); 0x20b8c(0);  0x21604();  [/trk]
    getStatus(); run(1): [trk] 0x21db4(); 0x21f44(5); 0x2215c(); [/trk]
    getStatus(); run(2): 0x221e8("coding.raw","hardware.raw",0,1); 0x22398(8); 0x221c8();
    getStatus(); run(3): [trk] 0x23264(pVal,1); 0x2381c(0xa); 0x24464(); [/trk]
    getStatus(); run(4): 0x221e8("artwork.raw","is.raw",1,2); 0x223e4(0xd); 0x221c8();
    getStatus(); run(5): [trk] 0x23264(pVal,2); 0x23de8(0xf); 0x24464(); [/trk]
    getStatus(); run(6): 0x221e8("music.raw","pain.raw",2,0); 0x22430(0x12); 0x221c8();
    midasStopModule(module);  err = gmpFreeModule(module); if (err) midasError(err);  // 0x2dae4, 0x2e0b0
}
free([0x11494]);                            // 0x221dc: glod brighten table
if (introOnly || stop < 7) goto exit;
// ---------------- "waiting for robotnik" screen ----------------
loadFont("font.raw", add=0, shift=0);       // 0x1dcd0
for (i=0;i<32;i++) setDAC(i, i,i,i);        // ports 0x3c8/0x3c9: grey ramp 0..31 in entries 0..31
drawSmallTextCentered("waiting for", y=170, dst=VGA);   // 0x1dff8
drawSmallTextCentered("robotnik{{{", y=180, dst=VGA);   // '{' = '.' glyph -> "ROBOTNIK..."
freeFont();                                  // 0x1dda0
precalcPart7Maps();                          // 0x1fd38, see 2.2
gmpLoadXM("bergborr.xm", 1, 0, &module);
// ---------------- demo (song bergborr.xm, sync table 0x801b8) ----------------
midasPlayModule(module, 0);
tmrSyncScr(scrSync, timerTick_0x12280, 0, 0);
[0x91284] = 0x801b8;
if (start < 7) syncIdx = 0;
if (syncIdx) gmpSetPosition(playHandle, table[syncIdx].pos);
memset(VGA, 0, 64000);                       // 0x11a5f: wipes the waiting text when music starts
getStatus(); frame = row*49/5;
t0 = [0x9125c];
getStatus(); if (run(7)) { 0x1fffc(); 0x20480(0); }   0x20398();      // part 7 deinit ALWAYS called
getStatus(); run(8):  0x106f5(); 0x286b4(5); 0x106e8();
getStatus(); [trk] 0x1f064(r6flag); if (run9) 0x1ea28(9); 0x1f008(); [/trk]  // part 9 init+deinit ALWAYS
getStatus(); run(10): 0x13128(rVal,0xc); 0x1366c(0xc); 0x139fc();
getStatus(); run(11): 0x1b860(); 0x1b9fc(0xf); 0x1b9d8();
getStatus(); run(12): 0x19ae0(rVal); 0x1a850(0x12); 0x1a528();
getStatus(); run(13): 0x1d7c0(); 0x1da10(0x18); 0x1d9e0();
getStatus(); run(14): [trk] 0x15ab4(rVal); 0x16180(0x1b); 0x164d8(); [/trk]
getStatus(); run(15): 0x1d898(); 0x1db88(0x20); 0x1d9e8();
t1 = [0x9125c];
midasStopModule(module); gmpFreeModule(module);
exit:
midasClose();                                // 0x2d74c
restoreKeyboard();                           // 0x118fc
setMode(3);
return (t1 - t0) / 0x12331a;                 // elapsed seconds (0x12331a = 70*0x428f); unused
```
- "Part 7 deinit always called" means it is called whenever the demo block runs, even if part 7 was skipped.
  The same holds for part 9 init and deinit.
- `[trk]...[/trk]` = `if([0x80054]) 0x2d2d0()` before and `0x2d2f0()` after. 0x2d2d0 starts recording
  every malloc (in `0x1050e0[0..1023]`, count `[0x1060e4]`). 0x2d2f0 frees everything recorded. This is
  a leak collector and has no visual effect. Ignore it in the port.
- `getStatus` = `0x12198` (see 4.1). Calling it between parts only refreshes the globals.
- The intro module keeps playing until part 6 returns. Part 6 waits for sync index > 0x14, i.e. entry 20
  at pos 13 row 56 (124.32 s), and clears VGA. The song is 125.44 s long. Then the song is stopped
  and freed.
- Between the intro and the demo the **palette is not reset**. Entries 0..31 are overwritten with the grey
  ramp and the screen is already black (part 6 cleared it). The rest of gl_pal is still in the DAC but
  unused by the text.
- **Duration of the waiting screen**: there is no fixed duration. It stays up for as long as
  `precalcPart7Maps` plus loading bergborr.xm take. When the music starts, VGA is cleared. A port can
  show it for a short moment (e.g. 1-2 s) or skip it, and should start the demo music from t=0
  afterwards.
- The pixel-exact render of the waiting screen (my own reimplementation of 0x1dff8 using font.raw) is
  at `scratchpad/agents/M/waiting.png`: grey text "WAITING FOR" / "ROBOTNIK..." at x=105,
  y=170 / 180 on black.

### 2.1 Exit paths (ESC)
There are three identical "killed" helpers. All take no args (eax/edx are passed debug strings like
"glod1 waiting for sync", which are ignored):

| addr | behaviour |
|---|---|
| `0x122b8` | if `[0x118c4]` (ESC seen): tmrStopScrSync (0x302b4), restoreKeyboard, setMode(3), midasClose, puts("killed."), exit(0) |
| `0x122f0` | same, but calls getStatus first (inside the if, so it has no effect) |
| `0x12330` | same as 0x122b8, **plus pause**: `while ([0x118c0] == 0x19) ;` where 0x19 is the scan code of P |

Pause detail: `[0x118c0]` holds the last scan code with bit 7 stripped, so it stays 0x19 after P is
released. Pause lasts until any other key event arrives. The music (IRQ driven) keeps playing, so the
sync index jumps ahead afterwards. Only parts 2/3/4/5/6 call 0x12330. A port may map ESC to "stop" and
can ignore P.

### 2.2 `0x1fd38 precalcPart7Maps()` (runs during the waiting screen; data for part 7)
`p = malloc(0x40000)`. `[0xdc700] = p` (map A, 256x256 entries of 2 bytes). `[0xdc6fc] = p+0x20000` (map B, same layout).
All float math is single precision. `round()` = fistp, round-to-nearest-even. `trunc()` = 0x44160 (__CHP).
```
k = 0;
for (y=-128; y<128; y++) {
    fy = y*1.15;  A = trunc(fy*fy + 147456.0);            // int
    for (x=-128; x<128; x++, k+=2) {
        D = x*x + A;  B = -294912.0 / D;  C = 570224.0 / D;
        if (B*B < C) { A8[k] = A8[k+1] = 0; continue; }
        t = -B - sqrt(B*B - C);
        X = x*t;  Z = 384*t - 768;  Y = fy*t;
        A8[k]   = (round(atan2(-Z, X) * 40.4254...) + 0x80) & 0xff;   // 40.4254 = 127/pi (double const at 0x8db2c)
        A8[k+1] = (round(asin(Y / sqrt(X*X+Y*Y+Z*Z)) * 81.169...) + 0x80) & 0xff; // 255/pi (0x8db34)
    }
}
k = 0;
for (a=0; a<256; a++) {
    th = (a-128)*pi/256;  s=sin(th); c=cos(th);
    for (b=0; b<256; b++, k+=2) {
        ph = (b-128)*pi/128;
        P = -c*sin(ph);  Q = c*cos(ph);
        B8[k]   = (round(atan2(c*sin(ph), s) * 128/pi) + 0x80) & 0xff;
        B8[k+1] = (round(asin(Q / sqrt(Q*Q + s*s + P*P)) * 256/pi) + 0x80) & 0xff;
    }
}
```
`atan2(a,b)` here is 0x44193 (`fxch; fpatan`), which equals C `atan2(a,b)`. 0x45572 is asin (computed as
atan2(x, sqrt(1-x²))). Exact constants: 1.15 (0x8db1c), 384 (0x8db24), 147456, -294912, 570224, -768
(0x8db64..0x8db7c), pi (0x8db3c), 1/256, 1/128 (0x8db44, 0x8db4c), 128, 256 (0x8db54, 0x8db5c).
This is a reading, not run in the emulator. The part 7 notes should confirm how the maps are used.

---------------------------------------------------------------------------------------------------

## 3. Shared helpers in 0x10000..0x12fff and 0x1d000..0x1e2ff

"Users" lists the parts that reach the helper (computed from the call graph).

### 3.1 Hardware, memory, misc

| addr | name | signature | behaviour |
|---|---|---|---|
| 0x11a92 | `setMode` | eax=mode | `int 10h` with AX=eax. 0x13 = 320x200x256 (clears VRAM, default palette), 3 = text |
| 0x11af3 | `setPalette` | esi=pal | out 0x3c8,0; then 768 bytes `rep outsb` to 0x3c9 (all 256 entries, 6-bit) |
| 0x11ad0 | `waitVRetrace` | – | `while(in(0x3da)&8);  while(!(in(0x3da)&8));` (users: p2/4/6) |
| 0x11ae1 | `kbhit` | → eax | DOS int21 AH=0x0b; returns 0 or 0xff |
| 0x11a5f | `memzero` | edi=dst, ecx=bytes | zero dwords; ecx must be a multiple of 4 (used as `memset(VGA,0,64000)` everywhere) |
| 0x11d43 | `memcpy16` | esi=src, edi=dst, ecx=bytes | copy, ecx a multiple of 16 |
| 0x11a39 / 0x11a58 | `fpuSingle` / `fpuRestore` | – | see 1.1. Saves the original CW at 0x119dc, the modified one at 0x119de |
| 0x1d190 | `malloc` | eax=size → eax | `jmp 0x2d434` |
| 0x1d198 | `free` | eax=ptr | `jmp 0x2d464` |
| 0x2ceb0 | `loadFilePart` | eax=name, edx=dst, ebx=offset, ecx=count | reads `count` bytes starting at `offset` of the named resource into dst. With /l uses 0x1e140 |
| 0x2cf98 | `loadFile` | eax=name → eax=new buffer | whole file, malloc'd. Prints an error and exits if missing |
| 0x1e140 | `readFileRaw` | eax=name, edx=dst, ebx=offset, ecx=len | DOS open(O_RDONLY\|O_BINARY), lseek, read, close (no-archive fallback) |
| 0x1e174 | `writeFileRaw` | eax=name, edx=src, ebx=offset, ecx=len | open(0x222 = O_WRONLY\|O_CREAT\|O_TRUNC\|O_BINARY, 0x1ff), lseek, write, close. Only from camera-record code 0x26dd0/0x27874 (debug .rec dumps), never in a normal run |
| 0x11c68 | `seedRandom` | – | `[0x11c64] = [0x9125c]` (seeds the LFSR from the timer accumulator, so it is not deterministic). Users p8, p13 |
| 0x11c2b | `randomBits` | cl=n → eax | see 3.3 (verified) |

### 3.2 Trig tables (verified in the emulator)
`0x11bc0 buildSine()` fills dword table `S = 0x9025c`, 641 entries:
```
for (i=0; i<=128; i++) {
    x = (i*0x3243f) >> 16;            // 0x3243f = pi*65536 -> x = angle in 8.8 (i*pi/256 rad)
    q = (x*x*x) / 0x60000;            // unsigned 32-bit: x^3/(6*65536)
    v = x - q + (q*x*x) / 0x140000;   // + x^5/(120*2^32) Taylor term
    S[i]=v; S[256-i]=v; S[512+i]=v; S[256+i]=-v; S[512-i]=-v;
}
```
512 steps per turn, amplitude 8.8 (peak 257, not 256: S[126..130]=257, S[0..3]=0,3,6,9).
S[640] overlaps the first dword of 0x90c5c (a part-7 table), which gets set later.
- `0x11a7d sin(eax)` → `S[eax & 511]`
- `0x11a70 cos(eax)` → `S[(eax & 511) + 128]` (reads 0x9045c)

### 3.3 `0x11c2b randomBits(cl=n)` (LFSR, verified)
Seed dword at 0x11c64, initial value 0x12345678. n=0 means 256 iterations.
```
r = 0;
repeat n: { r = (r<<1) | (seed&1);  nb = ((seed>>10) ^ (seed>>15)) & 1;  seed = (seed>>>1) | (nb<<31); }
return r;
```
There is an unreferenced routine in a gap at 0x10ea0: `repeat 16000: buf[randomBits(16)]++` with edi=buf. It is dead code.

### 3.4 Angle `0x11d72 angle(eax=x, ebx=y) → eax` (verified)
This is an octant-linear approximation of atan2. 1024 units per turn, signed `idiv` (truncating). Neither 0x400 nor
negative results are wrapped.
```
if (x==0) return y<0 ? 768 : 256;          // includes (0,0) -> 256
if (y==0) return x>0 ? 0 : 512;
if (x>0 && y>0) return x>=y ? (y<<7)/x        : 256 - (x<<7)/y;
if (x<0 && y>0) { c=-x; return c>=y ? 512-(y<<7)/c : 256 + (c<<7)/y; }
if (x<0 && y<0) { c=-x; m=-y; return c>=m ? 512+(m<<7)/c : 768 - (c<<7)/m; }
/* x>0,y<0 */     { m=-y; return x>=m ? 1024-(m<<7)/x : 768 + (x<<7)/m; }   // (1000,-1) -> 1024
```
Users: p3/5, p14.

### 3.5 Image ops

**`0x10db7 zoomBlit(eax=x0, ebx=y0, ecx=x1, edx=y1, esi=src320, edi=dst)`** (verified). Users p1, p2/4/6, p7, p8.
It stretches the source rectangle (x0,y0)-(x1,y1) of a 320-wide image to a full 320x200 dst.
```
dy = trunc64(((int64)(y1-y0) << 16) / 200);   // signed idiv, truncates toward 0
dx = trunc64(((int64)(x1-x0) << 16) / 320);
yf = y0 << 16;                                 // 32-bit shl
for (row=0; row<200; row++, yf+=dy) {
    s = src + (yf >>> 16)*320;  xf = x0 << 16;
    for (k=0;k<320;k++, xf+=dx) *dst++ = s[xf >>> 16];
}
```

**`0x1d1a0 scale(eax=srcW, ebx=srcH, ecx=dstW, edx=dstH, esi=src, edi=dst)`** (verified). Users: most parts.
Nearest-neighbour resample, dst packed dstW x dstH:
```
sx = (int32)(srcW<<16) / dstW;  sy = (int32)(srcH<<16) / dstH;   // signed idiv
yf=0; for (y<dstH) { s = src + (yf>>16)*srcW; xf=0; for (x<dstW) { *dst++ = s[xf>>16]; xf+=sx; } yf+=sy; }
```

**`0x11b5d blurWrap(esi=src, edi=dst, ecx=w, ebx=h)`** (verified). Users p2/4/6, p7, p8, p13.
N=w*h, with linear wrap-around of indices mod N:
`dst[c] = (s[c] + s[(c+1)%N] + s[(c+1+w)%N] + s[(c+w)%N] + 2) >> 2` for c in 0..N-1 (16-bit sum).
src and dst may be the same buffer. In that case it works in place and reads already-updated values for
indices < c. That is how 0x221e8 calls it (4 passes, 320x200, in place).

**`0x114bc buildBlurTables()`** (verified). Users p2/4/6:
- `0x11394[i]` (256 bytes) = `i==0 ? 0 : (i-1)>>2`
- `0x11354[c]` (64 bytes) = `min(c+3, 21)`

**`0x1178c fireBlur(esi=src, edi=dst)`** (verified). Users p2/4/6:
`dst[i+2] = T[(s[i] + s[i+1] + s[i+319] + s[i+320]) & 0xff]` for i = 0..63999, with T = 0x11394.
The **sum wraps at 8 bits**, but for pixel values < 64 it never overflows. dst bytes 0..1 are untouched.
It reads src up to index 64320.

**`0x119e0 shadeShifted(esi=src, edi=dst, cl=shift, ch=add)`**. Users p2/4/6, p10.
For i in 0..63999: `dst[i] = L[ (((src[i]>>shift) + add) & 0xff) * 256 + dst[i] ]` with L = 64 KB table at 0xfd0a0.

**`0x11a02 shadeClamped(esi=src, edi=dst, ebx=table, dl=max)`**. Users p14.
For i in 0..63999: `dst[i] = table[ min(src[i], dl)*256 + dst[i] ]`.

Part-specific helpers in this range, listed here only so nothing is lost:
- p2/4/6 (glod): `0x114ff` remaps `dst[i] = src[u16tbl[i]]` for i<63680.
  `0x11535` (eax) patches the store address of 0x11540 (self-modifying: `mov [ecx+imm32]`, imm32=eax).
  `0x11540` is the smoke/fire composite. `0x115ba(edx=t, esi=A, edi=B)` writes
  `VGA[i] = (mask[i] - 2t >= 0) ? A[i] : B[i]` for i in 320..63679, with mask=[0x114ac] (gl_smoke.dat).
- p7: 0x11e4c, 0x11fd9, the gap routine at 0x11c75 (sqrt/sin bump-texture generator, then 0x11b5d
  passes), and the line shaders 0x1201f/0x1204e/0x1207d/0x120b7. These four apply `buf[p] = T[buf[p]]` to a
  stepped line in the buffer at 0xe4fc0 (320 wide) through T=0x90c5c:
  - `1201f(eax=x0, ebx=x1, ecx=y·256, edi=dy)`: x = x0..x1-1, always at least once.
  - `1204e`: the same with x descending while x > x1.
  - `1207d(eax=x·256, ecx=y0, ebx=y1, edi=dx)`: y = y0..y1-1.
  - `120b7`: y descending while y > y1.
- p8: 0x10946..0x10d58, `0x1d2fc` (`out[s*256+k]=min(s+k,255)`, s<128), `0x1d58c(eax=pal)` (blank the
  DAC, keep a dword copy of the palette at 0xd5830), `0x1d5dc(eax=level)` (upload `pal[i]*level>>8`, level 0..256).
- p9/p15: `0x1d648(eax=buf, edx=rowLen≤512, ebx=rows)` mirrors each row left-right in place.
- p11: 0x100a8..0x1055c. p13: 0x10eb3..0x11280. p10: 0x12f00, 0x12fd4.

### 3.6 Keyboard `0x118ce install / 0x118fc restore`, ISR at 0x1190d
The ISR hooks INT 9 (old vector saved at 0x118b4/0x118b8) and reads port 0x60 (sc):
- `sc==1` (ESC press) → `[0x118c4]=1` (sticky).
- `[0x118bc] = (sc&0x80)?0:1` (pressed flag). `[0x118c0] = sc&0x7f`. `0x118c8` returns `[0x118bc]`.
- Debug axes (byte: +1 = pressed key A, -1 = pressed key B, 0 on release):
  - `0x118ac`: Up(0x48) +, Down(0x50) −
  - `0x118ad`: Left(0x4b) +, Right(0x4d) −
  - `0x118ae`: `'`(0x27) +, `.`(0x34) −
  - `0x118af`: `,`(0x33) +, `/`(0x35) −
  - flags: `0x118b0`='1', `0x118b1`='2', `0x118b2`=Space, `0x118b3`=Right Shift.

  These are read by p0 (0x20e5c), the 3D glue (0x255e3, 0x25b3f, 0x26991, 0x26be1: dword read of
  0x118ac..af) and p12 (0x1ade0 Space, 0x1adfe RShift). They are all 0 in a normal run.

### 3.7 Palette / colour tables
**`0x1d254 nearestColor(eax=pal768, edx=R, ebx=G, ecx=B) → eax`** (verified as part of 0x1d340):
`d(i) = 2*|pal[i].r-R| + 7*|pal[i].g-G| + |pal[i].b-B|`. Scan i=0..255. Return i immediately on d==0.
Otherwise return the **first** i with the smallest d.

**`0x1d340 buildBrightenTable(eax=N, esi=pal, edi=out)`** (verified). Users: main (N=32 for presents and gl_pal).
```
for (c<256) out[c]=c;
step = 0x4000/(N-1);  acc = 0;                       // N=32 -> 528
for (L=1; L<N; L++) { acc += step; add = acc>>8;     // add = 2,4,6,8,10,12,14,16,18,20,22,24,26,28,30,33,...,63
    for (c<256) out[L*256+c] = nearestColor(pal, min(r_c+add,63), min(g_c+add,63), min(b_c+add,63)); }
```
So table L holds "palette brightened by add(L), mapped back to the nearest existing colour". For N=32,
add(L) = floor(L*528/256).

### 3.8 Font (`font.raw`, 12100 bytes) — verified by rendering
**Format**: an 8-bit intensity image, **22 px wide, 550 rows**, values 0..31. Rows 0-1 are padding.
Glyph g occupies rows `2+14g .. 15+14g`, i.e. bytes `[44 + 308g, +308)`, 22x14. There are 39 slots:
0..25 = A..Z, 26 = `.`, 27 = `!`, 28..37 = `0`..`9`, 38 = blank. The glyph sheet (my render) is at
`scratchpad/agents/M/fontsheet.png`.

**Char → glyph**: `g = (c >= 'a') ? c-'a' : c-0x14`. So lower-case letters give A..Z, `{`→26 '.', `|`→27 '!',
digits '0'..'9' → 28..37. A space advances without drawing. There is no upper case (it would map to
garbage).

**`0x1dcd0 loadFont(eax=name, edx=add, ebx=shift)`**:
- `[0x8193c] = loadFile(name)`; then every byte is changed in place: `b = ((b << shift) + add) & 0xff`.
  Callers: main(0,0), p0(add 0x40, shift 1), p9(0,0), p11(0,0), p14(add 0, shift 1).
- `[0x81940] = malloc(3025)`: a half-size font, **11 x 275**:
  `half[r*11+c] = (F[r*44+2c] + F[r*44+2c+1] + F[r*44+2c+22] + F[r*44+2c+23] + 2) >> 2`
  for r<275, c<11 (taken after the add/shift change).
  Small glyph g = `half[11 + 77g ..]`, 11 wide x 7 rows. Only 10 columns are drawn.

**`0x1dda0 freeFont()`**: frees both buffers.

| addr | name | args | drawing |
|---|---|---|---|
| 0x1ddb4 | `bigText` | eax=str, edx=x, ebx=y, ecx=dst | per char at dst+y*320+x: 21x14 cells (cols 0..20 of 22), `d = L[glyph*256 + d]`, L=0xfd0a0. Advance 21 |
| 0x1de4c | `bigTextCentered` | eax=str, edx=y, ebx=dst, cl=clampMax | x0 = `(299 - 21*(n-1)) >> 1` = (320-21n)/2 (arith shift). `d = L[min(glyph,cl)*256 + d]`. Advance 21. n=0 leaves x0 undefined |
| 0x1dff8 | `smallTextCentered` | eax=str, edx=y, ebx=dst | x0 = `(310 - 10*(n-1)) >> 1` = (320-10n)/2. **Opaque copy** of 10x7 glyph cells (zeros overwrite too). Advance 10 |
| 0x1e09c | `smallText` | eax=str, edx=x, ebx=y, ecx=dst | 10x7 cells, `d = L[glyph*256 + d]`, L=0xfd0a0. Advance 10 |

All of them use 320-byte rows and write rows y..y+13 (big) or y..y+6 (small). There is no clipping.
L = 0xfd0a0 is a 64 KB blend table that each part builds itself (e.g. 0x221e8 copies the 32x256
brighten table into it).

### 3.9 Object-tree helpers (TDDD objects; struct: +0 child, +4 next sibling, +0x84 flags, +0xa0 face count, +0xa4 faces (stride 0x30, +0x2c per-face pointer))
- `0x24688 loadObject(eax=name) → obj`: `o = 0x433b0(name)` (read and parse .eob, "Can't load object"),
  `0x41c50(o)` (recursive per-node 0x418b4 prepare), return o. Users p0, p1, p3/5, p9, p14.
- `0x27798 setFlags(eax=obj, edx=mask)`: recursively over child and sibling subtrees, `flags |= mask`.
- `0x277bc clearFlags(eax=obj, edx=mask)`: the same with `flags &= ~mask`.
- `0x2469c setFaceTex(eax=obj, edx=v)`: `obj->faces[i].+0x2c = v` for all faces of this node only.
- `0x246d0 setFaceTexTree(eax=obj, edx=v)`: the same for obj, all siblings (iterative) and all children (recursive).
- `0x244f0` / `0x24564` / `0x245a4`: alloc/free the 4 arrays at (+8 count,+0xc ptr: 12-byte elements), (+0x10,+0x14: 48-byte),
  (+0x18,+0x1c: 12-byte), (+0x20,+0x24: 12-byte). 0x245a4 frees recursively.

Not covered here (shared 3D/camera glue that calls the engine at 0x39xxx and 0x3axxx): 0x16650..0x171a8,
0x189e8, 0x247d4, 0x254a4, 0x25a5c, 0x26dd0, 0x26e1c, 0x277e4, 0x27874, 0x2789c, 0x27cac,
0x27e28..0x28168.

---------------------------------------------------------------------------------------------------

## 4. Timing and sync

Globals (all dwords):

| addr | name | meaning |
|---|---|---|
| 0x9125c | `tickAcc` | += 0x428f per timer tick. Used only as "tick changed" (0x123b0), elapsed time and random seed |
| 0x91260 | `frame` | ++ per tick. Reset by parts to `row*49/5` (row within the current pattern) |
| 0x91264 | `frameRow` | `frame*5/49` (unsigned), recomputed every tick right after `frame++` |
| 0x91270 | `songPos` | order position (from gmpInformation+0) |
| 0x91274 | (info+4) | pattern number, probably. Unused |
| 0x91278 | `songRow` | row (info+8) |
| 0x9127c | (info+0x14) | unused |
| 0x91280 | `syncIdx` | number of sync entries already passed |
| 0x91284 | `syncTable` | 0x80058 (intro) or 0x801b8 (demo) |
| 0x90254 | `scrSync` | MIDAS display-sync timer value |
| 0x90258 | `module` | gmpModule* |
| 0x106140 | `playHandle` | MIDAS play handle |

### 4.1 Routines
- **`0x12280 timerTick`** (MIDAS preVR callback, once per vertical retrace = 70.086 Hz in mode 13h):
  `tickAcc += 0x428f; frame++; frameRow = (frame*5)/49;`
- **`0x12198 getStatus`**: `gmpGetInformation(playHandle, &info)` (cdecl 0x2e2c4). Then copies info+0, +4, +8, +0x14
  to 0x91270, 0x91274, 0x91278, 0x9127c.
- **`0x121d4 resyncFrame`**: `getStatus(); frame = (row*49)/5;` (unsigned; row*48+row then div 5).
  Parts call it right after their start entry fires. 9.8 frames = one row (speed 7 @125 BPM = 0.14 s, ×70 Hz).
- **`0x12204 syncAdvance → eax`**: `getStatus(); i=syncIdx; while (pos > T[i].pos || (pos == T[i].pos && row >= T[i].row)) i++; syncIdx=i; return i;`
  (unsigned compares). So syncIdx = index of the first entry not yet reached. The sentinel (pos 100) stops it.
- **`0x123b0 waitTick`**: `t=tickAcc; if (tickAcc==t) while (tickAcc==t);` waits for the next 70 Hz tick.
- **`0x11ad0 waitVRetrace`**: polls the port (see 3.1).

Typical part idiom (seen in every run function; s = the run arg):
```
while (syncAdvance() <= s) killCheck();   // wait until entry s has been reached
resyncFrame();                            // frame = row*49/5
... loop drawing frames, waitTick(), killCheck(), until syncAdvance() > s+k ...
```
**So the run(N) argument is the index of the part's own first sync entry** (= `startSync[part]`). Each
part's per-entry use is documented in its own notes.

### 4.2 Sync entry format (16 bytes)
`{ u32 position; u32 row; u32 id (= its own index, unused by code); u32 0 }`. An entry is "reached" when the
song is at (pos,row) or later. The table ends with a sentinel `{100,0,...}`.

Both songs: all patterns are 64 rows, speed 7, BPM 125, so **one row = 0.14 s**. pullmax.xm has no
breaks. bergborr.xm has many `D00` pattern breaks at row 31 or 15 (positions 7..51 mostly last 32
rows). The times below come from walking the XM (`xm.py`): they are seconds from song start, at the
row where the entry fires. They assume the default (no /r, /p) tables.

### 4.3 `startSync[16]` at 0x80010 (dwords)
`[0,5,8,10,13,15,18, 0,5,9,12,15,18,24,27,32]`, then 0x80050 = 100, 0x80054 = 1 (the /c flag).
Index = part (0..15). `/sN` sets syncIdx = startSync[N] and seeks the song to `T[syncIdx].pos`, row 0.

### 4.4 Intro table 0x80058 (pullmax.xm, 14 positions, 125.44 s)
| # | addr | pos | row | t (s) | used by |
|---|---|---|---|---|---|
| 0 | 0x80058 | 0 | 32 | 4.48 | part 0 start (run(0)) |
| 1 | 0x80068 | 1 | 0 | 8.96 | part 0 |
| 2 | 0x80078 | 2 | 28 | 21.84 | part 0 |
| 3 | 0x80088 | 2 | 46 | 24.36 | part 0 (/r≠6: becomes (3,0)) |
| 4 | 0x80098 | 2 | 56 | 25.76 | part 0 |
| 5 | 0x800a8 | 3 | 0 | 26.88 | part 1 start |
| 6 | 0x800b8 | 3 | 30 | 31.08 | part 1 |
| 7 | 0x800c8 | 3 | 48 | 33.60 | part 1 |
| 8 | 0x800d8 | 3 | 52 | 34.16 | part 2 start |
| 9 | 0x800e8 | 4 | 32 | 40.32 | part 2 |
| 10 | 0x800f8 | 5 | 52 | 52.08 | part 3 start |
| 11 | 0x80108 | 7 | 48 | 69.44 | part 3 (/p: row 54) |
| 12 | 0x80118 | 7 | 56 | 70.56 | part 3 |
| 13 | 0x80128 | 8 | 0 | 71.68 | part 4 start |
| 14 | 0x80138 | 9 | 0 | 80.64 | part 4 |
| 15 | 0x80148 | 10 | 0 | 89.60 | part 5 start |
| 16 | 0x80158 | 11 | 52 | 105.84 | part 5 (/p: row 63) |
| 17 | 0x80168 | 12 | 8 | 108.64 | part 5 |
| 18 | 0x80178 | 12 | 9 | 108.78 | part 6 start |
| 19 | 0x80188 | 13 | 0 | 116.48 | part 6 |
| 20 | 0x80198 | 13 | 56 | 124.32 | part 6 end (waits for idx > 20, then the intro is over) |
| 21 | 0x801a8 | 100 | 0 | – | sentinel |

### 4.5 Demo table 0x801b8 (bergborr.xm, 57 positions, 315.84 s)
| # | addr | pos | row | t (s) | used by |
|---|---|---|---|---|---|
| 0 | 0x801b8 | 0 | 16 | 2.24 | part 7 start |
| 1 | 0x801c8 | 1 | 0 | 8.96 | part 7 |
| 2 | 0x801d8 | 3 | 0 | 26.88 | part 7 |
| 3 | 0x801e8 | 3 | 24 | 30.24 | part 7 |
| 4 | 0x801f8 | 3 | 30 | 31.08 | part 7 |
| 5 | 0x80208 | 3 | 32 | 31.36 | part 8 start |
| 6 | 0x80218 | 6 | 0 | 53.76 | part 8 |
| 7 | 0x80228 | 6 | 32 | 58.24 | part 8 |
| 8 | 0x80238 | 6 | 48 | 60.48 | part 8 |
| 9 | 0x80248 | 7 | 0 | 62.72 | part 9 start |
| 10 | 0x80258 | 15 | 17 | 98.70 | part 9 |
| 11 | 0x80268 | 16 | 0 | 100.80 | part 9 (/r6: row 16) |
| 12 | 0x80278 | 17 | 0 | 105.28 | part 10 start |
| 13 | 0x80288 | 21 | 0 | 123.20 | part 10 (/r≠6: row 7) |
| 14 | 0x80298 | 21 | 8 | 124.32 | part 10 |
| 15 | 0x802a8 | 21 | 12 | 124.88 | part 11 start |
| 16 | 0x802b8 | 25 | 8 | 151.20 | part 11 |
| 17 | 0x802c8 | 25 | 18 | 152.60 | part 11 |
| 18 | 0x802d8 | 25 | 30 | 154.28 | part 12 start |
| 19 | 0x802e8 | 27 | 16 | 161.28 | part 12 |
| 20 | 0x802f8 | 32 | 4 | 182.00 | part 12 |
| 21 | 0x80308 | 33 | 0 | 185.92 | part 12 |
| 22 | 0x80318 | 38 | 16 | 210.56 | part 12 (/r≠6: row 29) |
| 23 | 0x80328 | 38 | 30 | 212.52 | part 12 |
| 24 | 0x80338 | 39 | 0 | 212.80 | part 13 start |
| 25 | 0x80348 | 42 | 24 | 229.60 | part 13 |
| 26 | 0x80358 | 43 | 8 | 231.84 | part 13 |
| 27 | 0x80368 | 43 | 16 | 232.96 | part 14 start |
| 28 | 0x80378 | 45 | 30 | 243.88 | part 14 |
| 29 | 0x80388 | 46 | 30 | 248.36 | part 14 |
| 30 | 0x80398 | 47 | 30 | 252.84 | part 14 |
| 31 | 0x803a8 | 49 | 24 | 260.96 | part 14 (/r≠6: row 31) |
| 32 | 0x803b8 | 50 | 0 | 262.08 | part 15 start |
| 33 | 0x803c8 | 50 | 16 | 264.32 | part 15 |
| 34 | 0x803d8 | 51 | 0 | 266.56 | part 15 |
| 35 | 0x803e8 | 52 | 0 | 271.04 | part 15 |
| 36 | 0x803f8 | 52 | 16 | 273.28 | part 15 |
| 37 | 0x80408 | 52 | 50 | 278.04 | part 15 |
| 38 | 0x80418 | 100 | 0 | – | sentinel |

"Used by" is the owner range `[startSync[p], startSync[p+1])`. Exactly which entries a part tests
(beyond its first) is in each part's notes. Positions 53..56 of bergborr are the empty pattern 68.
The table at 0x80428 that follows is unrelated data.

### 4.6 MIDAS 0.6.0 API identification (`midas.c 1.11 1997/01/16`, all cdecl)
| addr | function | notes |
|---|---|---|
| 0x2d884 | midasSetDefaults() | clears config globals |
| 0x2d574 | midasDetectSD() | sets [0x10613c]=SoundDevice*, [0x10610c] |
| 0x30e2c | midasConfig() → 1 ok / 0 cancel | "MIDAS Sound System v0.6.0 configuration" |
| 0x2d5e0 | midasInit() | |
| 0x2fedc | tmrGetScrSync(&scrSync) → err | the Win95 warning if [0x1062d4]==0 |
| 0x301c0 | tmrSyncScr(scrSync, preVR=0x12280, immVR=0, inVR=0) → err | installs timerTick |
| 0x302b4 | tmrStopScrSync() | in the kill path |
| 0x1c0a8 | gmpLoadXM(name, 1, 0, &module) → err | XM loader (linked low) |
| 0x2d9cc | midasPlayModule(module, 0) | play handle at [0x106140] |
| 0x2e2c4 | gmpGetInformation(handle, &info) → err | info ptr stored at 0x90250 |
| 0x2f868 | gmpSetPosition(handle, pos) | used only for /s jump starts |
| 0x2dae4 | midasStopModule(module) | |
| 0x2e0b0 | gmpFreeModule(module) → err | |
| 0x2d74c | midasClose() | |
| 0x2d4f0 | midasError(err) | midasClose, builds "MIDAS Error: <msg>", calls the fatal handler at [0x106104] (does not return) |
Libc: 0x2d489 puts, 0x2d4b7 exit, 0x31170 printf.

---------------------------------------------------------------------------------------------------

## 5. Data formats used by the helpers

- **`.col`** palette: 768 bytes = 256 × (R,G,B), 6-bit (max 63). `sh_pal.col` and `en_pal.col` are 769
  bytes with a trailing `0xbd`. Every loader reads only 0x300 bytes (offset 0), so the extra byte is junk.
- **64768-byte `.raw` pictures** (presents, punish, your, machine, endlogo, burns, hardware, is,
  pain, flesh, vectors, coding, artwork, music): **bytes 0..767 = palette (6-bit), bytes 768..64767 =
  320x200 8-bit pixels**, row-major. Verified by decoding presents.raw (`scratchpad/agents/M/presents.png`:
  "presents" over a mouth with text). Loaders use `loadFilePart(name, dst, 0x300, 0xfa00)` for the pixels
  and `(name, dst, 0, 0x300)` for the palette. Exception: in coding.raw, artwork.raw and music.raw the
  768-byte header is **not** a palette (values up to 255). Those three are drawn with gl_pal and the
  header is skipped.
- **64000-byte `.raw`** (rage, robotnik, punished, cl_pic, wa_pic): bare 320x200 pixels, no palette.
- **`font.raw`**: see 3.8.
- Other texture sizes (65536 = 256x256, 66304 = 256x256+768, 33536 = 256x128+768, ...) belong to the parts.
  Their palette position is not consistent (both the head and the tail have bytes > 63 in some files), so check each part's loader.

---------------------------------------------------------------------------------------------------

## 6. Open questions
- `/r` and `/p` meaning (alternate sync/variants?). The default run doesn't use them, so the port can ignore them.
- MIDAS's exact row/position update moment relative to the 70 Hz tick (sync times above are ideal row
  times; MIDAS updates the reported row when it processes the row).
- `0x1fd38` was decoded by reading only. Part 7's notes should confirm the map usage. The single-precision
  FPU setting matters for rounding at .5 boundaries.
