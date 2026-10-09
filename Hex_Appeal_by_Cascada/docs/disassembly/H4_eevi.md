# exe4: the "Eevi" picture (640x400, 16 colours)

## Summary

What is seen: a 16-level greyscale picture by Delsion (a horned, goat-skulled figure above a woman's face in a cage of
ribs, signed "DELSION '93") on a 640x400 screen. It fades in from black over about 2 s, stays for about 4.6 s, and
fades out to black over about 2 s. Then the part exits. There is no animation apart from the fade, and nothing is
synced to the music.

- Video mode: BIOS mode 12h (640x480, 16 colours, planar), then CRTC tweaks for **400 visible lines** at about 59.7 Hz.
  The picture fills lines 0..332. Lines 333..399 stay colour 0 (black).
- Palette: DAC entries 0..15. The attribute controller palette is set to the identity (pixel value i -> DAC i).
  The source palette is a grey ramp (below).
- Main loop: 512 iterations, one per vertical retrace. Each iteration writes the palette, computes the next faded
  palette from a 512-byte brightness table, and checks ESC. 512 frames / 59.6 Hz = 8.59 s, which is the 8.6 s recording.
- End: exit code 0 after 512 frames, or exit code 1 (abort the demo) if the last keyboard scancode is ESC (port
  0x60 == 1).

The program has a single routine, `sub_1a43_0000` (the entry point). Its 7283 instructions are real code: the picture
copy is fully unrolled, with 333 lines x 4 planes of `rep movsb`. A second unrolled block of 48
`lodsb / mul bl / shr ax,6 / stosb` does the palette scaling. Nothing was missed by the disassembler: there are no
callbacks, interrupt handlers or other code. The program makes no DOS calls except the final int 21h/4Ch. It
allocates no memory and reads no files: the picture is embedded in the EXE image.

## Image layout (load segment 0)

MZ header: CS:IP = 1a43:0000, SS:SP = 0000:0100. Image size 0x1e38c bytes.

| segment | linear | contents |
|---|---|---|
| 0000 | 0x00000-0x000ff | 256 zero bytes, the stack |
| 0010 | 0x00100-0x002ff | `fadeTable[512]`, brightness per frame, 0..64 |
| 0010:0200 | 0x00300 | `frameIdx` (word), initial value 0 |
| 0010:0205 | 0x00305 | `srcPal[48]`: copy of the picture palette, filled at run time (initially 0) |
| 0010:0235 | 0x00335 | `curPal[48]`: palette sent to the DAC, initially all 0 (black) |
| 0037 | 0x00370 | RIX3 picture A: lines 0..199 |
| 0fdb | 0x0fdb0 | RIX3 picture B: lines 200..332 |
| 1a43 | 0x1a430-0x1e38b | code |

### The picture: two raw (uncompressed) ColoRIX RIX3 chunks

Each chunk is a complete RIX3 file:

```
+0  "RIX3"
+4  u16 width  = 0x0280 (640)
+6  u16 height = 0x00c8 (200) for chunk A, 0x0085 (133) for chunk B
+8  0xab, 0x04   (palette type / storage type bytes; 0x04 here = uncompressed 16-colour planar)
+10 palette: 16 x (r,g,b), 6-bit values
+58 (0x3a) pixel data: height x 320 bytes
```

Both chunks have the same palette, a 16-step grey ramp (r = g = b):

```
0, 3, 7, 12, 16, 20, 24, 29, 33, 37, 41, 46, 50, 54, 58, 63
```

Pixel data: each line is 320 bytes, laid out as plane 0 (80 bytes), plane 1, plane 2, plane 3. Plane p holds bit p
of the colour index. In each byte the MSB is the leftmost of its 8 pixels. Line y of the screen comes from chunk A
line y (y < 200) or from chunk B line y-200 (200 <= y < 333).

Decoder (this is exactly what the unrolled copy does, expressed as pixels):

```js
// img = exe4 image bytes (load segment 0). For APPEAL.EXE: exe4's image is the file of exe4 minus its MZ header,
// see tools/re/split.py.
function decodeEevi(img) {
  const idx = new Uint8Array(640 * 400);            // all 0 = black below line 333
  const chunks = [[0x00370, 200, 0], [0x0fdb0, 133, 200]];
  for (const [base, rows, y0] of chunks) {
    const data = base + 0x3a;
    for (let r = 0; r < rows; r++) {
      for (let x = 0; x < 640; x++) {
        const byteOff = x >> 3, bit = 7 - (x & 7);
        let c = 0;
        for (let p = 0; p < 4; p++) {
          c |= ((img[data + r * 320 + p * 80 + byteOff] >> bit) & 1) << p;
        }
        idx[(y0 + r) * 640 + x] = c;
      }
    }
  }
  return idx;
}
const srcPal = img.subarray(0x370 + 0x0a, 0x370 + 0x3a); // 48 bytes, 6-bit
```

Relation to the RIX3 pictures in the APPEAL.EXE tail: this is **not** one of them. The tail pictures are 640x480,
640x52 and 408x264, and their palettes start 00 3f 3f 3f. The Eevi picture is only inside exe4's image.

## Routine: `1a43:0000` main (entry point)

Pseudo-code in order of execution:

```js
int80(bx=0x1d);                 // toggle the music system's retrace-synced timer (GUESS: off during the mode switch)
int10(ax=0x0012);               // mode 12h: 640x480x16 planar, VRAM A000:0000, 80 bytes per line, VRAM cleared

// CRTC (port 3d4, written as word out: low byte = index, high byte = value)
crtc[0x11] = 0x0e;   // clear the write-protect bit (bit 7); VRE = 0xe
crtc[0x06] = 0x0d;   // vertical total low
crtc[0x07] = 0x3e;   // overflow: VT8=0 VDE8=1 VRS8=1 VBS8=1 LC8=1 VT9=1 VDE9=0 VRS9=0
crtc[0x10] = 0xc0;   // vertical retrace start low  -> VRS = 0x1c0 = 448
crtc[0x11] = 0xac;   // VRE = 0xc, bit5 = 1 (vertical interrupt disabled), protect bit set again
crtc[0x12] = 0x8f;   // vertical display end low     -> VDE = 0x18f = 399 -> 400 visible lines
crtc[0x15] = 0x98;   // vertical blank start low     -> VBS = 0x198 = 408
crtc[0x16] = 0x06;   // vertical blank end
// vertical total = 0x20d (+2 = 527 scanlines) -> 31.47 kHz / 527 = 59.7 Hz. Horizontal timing, misc output
// and all other registers stay as in mode 12h (640 pixels wide, 80-byte stride, start address 0).

for (cx = 16; cx >= 1; cx--) {  // int 10h ax=1000h: set attribute palette register bl to value bh
  bl = 16 - cx; bh = 16 - cx;   // -> attr palette reg i = i, for i = 0..15 (identity: pixel i -> DAC i)
  int10(ax=0x1000, bl, bh);
}
int80(bx=0x1d);                 // toggle the timer back

// DAC: index 0, 48 bytes from 0010:0235 (curPal, all 0) -> colours 0..15 black
out(0x3c8, 0); for (i = 0; i < 48; i++) out(0x3c9, curPal[i]);

// picture copy: es = A000, di = 0
out(0x3c4, 2);                  // sequencer index 2 = map mask; data port 3c5 is then written per plane
mask = 0x11;                    // rol'd each time: 0x11,0x22,0x44,0x88 -> planes 0,1,2,3 (high nibble ignored)
src = 0037:003a;
for (line = 0; line < 333; line++) {        // fully unrolled in the code
  if (line == 200) src = 0fdb:003a;         // second RIX3 chunk
  for (p = 0; p < 4; p++) {
    out(0x3c5, mask); mask = rol8(mask, 1);
    copy 80 bytes src -> A000:di; src += 80; // rep movsb, then di -= 80
  }
  di += 80;
}
copy 48 bytes 0037:000a -> 0010:0205 (srcPal)

// fade loop (ds = 0010)
do {
  while (int80(bx=0x19) == 0) {}  // wait until the music system's frame counter is non-zero
  int80(bx=0x1a);                 // reset the frame counter to 0
  out(0x3c8, 0); for (i = 0; i < 48; i++) out(0x3c9, curPal[i]);   // shows the palette computed LAST iteration
  f = fadeTable[frameIdx];        // mov bx,[0200]; mov bl,[bx]  (byte at 0010:frameIdx)
  for (i = 0; i < 48; i++)
    curPal[i] = ((srcPal[i] * f) >> 6) & 0xff;   // mul bl (8x8 -> 16 bit), shr ax,6, store al. f <= 64 so <= 63
  frameIdx++;
  exitCode = 1;
  if (in(0x60) == 1) break;       // ESC scancode in the keyboard port -> exit 1 at once (no fade-out)
  exitCode = 0;
} while (frameIdx < 0x200);       // unsigned compare
int21(ah=0x4c, al=exitCode);
```

Notes for the port:
- Iteration k (k = 0..511) shows `fadeTable[k-1]` (black for k = 0). The value computed in the last iteration,
  `fadeTable[511]`, is never shown. The last visible step is `fadeTable[510] = 1`, which gives 0 for every entry, so
  the screen is black when the part ends.
- The frame counter is not reset before the loop. If it is already non-zero (the copy takes a while), the first
  iteration does not wait. That iteration writes black either way.
- Each loop iteration waits for at least one retrace. The loop body is short, so in practice it is one iteration per
  retrace (the recording confirms this, see below).

### fadeTable (0010:0000, 512 bytes)

It is symmetric (`t[i] == t[511-i]`): a rise of 118 entries, then 276 entries of 64 (i = 118..393), then the
mirrored fall (i = 394..511). It is close to a quarter sine but not exactly, so use the values verbatim. The rise,
`t[0..117]`:

```
0,1,2,2,3,4,5,5,6,7,8,9,9,10,11,12,12,13,14,15,16,16,17,18,19,19,20,21,22,22,23,24,24,25,26,27,27,28,29,29,
30,31,32,32,33,34,34,35,36,36,37,37,38,39,39,40,41,41,42,42,43,44,44,45,45,46,46,47,47,48,48,49,49,50,50,51,
51,52,52,53,53,54,54,54,55,55,56,56,56,57,57,58,58,58,59,59,59,59,60,60,60,61,61,61,61,61,62,62,62,62,62,63,
63,63,63,63,63,63
```

```js
const rise = [/* the 118 values above */];
const fadeTable = [...rise, ...Array(276).fill(64), ...rise.slice().reverse()]; // 512 entries
```

### Globals

| addr | name | init | use |
|---|---|---|---|
| 0010:0000 | fadeTable[512] | table above | read |
| 0010:0200 | frameIdx (u16) | 0 | loop counter, 0..0x200 |
| 0010:0205 | srcPal[48] | 0, set from 0037:000a | read |
| 0010:0235 | curPal[48] | 0 | written to the DAC each frame |

## Timing

- What drives the timing: only the music system's retrace frame counter (int 0x80 fn 0x19 and 0x1a). There is no
  music order/row test, no callback, and no DOS or BIOS wait.
- Length: 512 retraces. Fade-in: shown frames 1..119 (full brightness from loop iteration 119). Hold: iterations
  119..394. Fade-out: iterations 395..511.
- Seconds at 59.6 Hz: full brightness from about 2.0 s, fade-out starts at about 6.6 s, black at about 8.58 s, exit
  at 8.59 s.

## Checked against the recording (video0018.avi, 514 frames at 59.71 fps)

1. **Picture**: I decoded it with the decoder above at full brightness (6-bit to 8-bit as `v<<2 | v>>4`) and compared
   it with the recording frame at 4.3 s. Mean absolute difference: 0.19 per channel. Maximum: 1 (8-bit rounding of
   the 6-bit values). No pixel differs by more than 1. A 1-line vertical shift raises the mean difference to 6.2, so
   the line alignment is exact.
   Files: `$S/h4/eevi_decoded.png` (decoded), `$S/h4_rec_mid.png` (recording), `$S/h4/render.py` (decoder),
   `$S/h4_sheet.png` (0.25 s contact sheet).
2. **Fade curve**: I measured the brightness of the colour-15 pixels in every video frame (`$S/h4/fade.py`). Video
   frame f shows `(63 * fadeTable[f-2]) >> 6`, so the model "iteration k shows fadeTable[k-1]" holds with video
   frame = iteration + 1. Checks:
   - first non-zero value at frame 4;
   - full 63 from frame 120 (fadeTable[118] = 64);
   - first 62 at frame 396 (fadeTable[394] = 63);
   - last non-zero value (1) at frame 511 (fadeTable[509] = 2);
   - frames 512 and 513 black.

   The model fits every frame within rounding (mean error 0.75 of a 6-bit step, mostly from the 8-to-6-bit rounding
   of the capture). The recording's 514 frames = 512 loop iterations + about 2 frames around the part boundaries.

## Unclear

- The exact effect of int 0x80 fn 0x1d (called twice, around the mode switch) is described in the exe0 notes. It
  looks like "pause / resume the retrace-synced timer" so the BIOS mode set does not disturb it. For the port: there
  is no visible effect, the music keeps playing.
