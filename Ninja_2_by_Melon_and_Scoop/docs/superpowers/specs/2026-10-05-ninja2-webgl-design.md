# Ninja 2 (SCOOP & Melon, 1996) — WebGL port design

Date: 2026-10-05

## Goal

A browser port of the DOS demo Ninja 2 that reproduces the original picture pixel for pixel.
Static files, no build step, three.js from a CDN importmap, hostable on GitHub Pages.

Decisions made with the user:

- Pixel exact. A 320×256, 256-colour indexed framebuffer is composed on the CPU exactly like the C code.
- Music is pre-rendered from the XM to `music.ogg`.
- Scene logic is locked to 30 steps per second.

## Revision, 2026-10-05

The timing model below was replaced. `NINJA2.EXE` was built from a later revision than `original_src/`: scene timing is driven by a per-retrace timer interrupt, and every scene was retimed. The port now takes its scene logic and tick constants from the executable's disassembly. See the Timing section of `README.md`.

The three.js presenter was also replaced by a plain 2D canvas (`src/screen.js`).

## Source of truth

| Source | Role |
|---|---|
| `original_src/NINJAC.C` | Complete DOS original. All 17 scene routines, the two opening logos, `Credits()`, and `main()`. Primary reference. |
| `original_src/NINJA.A` | Assembly for drawing routines: `DepackILBM`, `ILBM_Palette`, `DrawLayerVert`, `DrawLayerHor`, `DrawFog`, `Sprite_Draw`, `BitmapZoom`, `MotionBlurr`. Authoritative for those. |
| `NEWSRC/*.c` | Partial SDL port. Readable C versions of most drawing routines. Used as a cross-check only; it lacks `Credits`, `MotionBlurr` and the opening logos. |
| `NINJA2.000` | 2,312,928 bytes. Concatenated IFF ILBM images. Byte-identical to `NEWSRC/NINJA.000`. |
| `original_src/LINK/FILES.H` | `file_offsets[]` into `NINJA2.000`. |
| `NINJA2.001` | The XM module. Byte-identical to `NEWSRC/NINJA2.XM`. |

Where `NEWSRC` and `SRC` disagree, `SRC` wins.

## Timing model

Facts from the original:

- `time_GetDelta()` returns the constant 33. Every scene loop advances by 33 ms of logic per drawn frame.
- `VBlank()` is an empty `ret`. Scene loops were never synced to the display.
- `VerticalBlank()` polls port `3DAh` and waits one real retrace. The mode is 320×256 at 60 Hz.
- The two opening logos run before `PlayModule()`. They are silent.

Port rules:

- One scene-loop iteration (a `ShowScreen()` call) consumes 33 ms of demo time.
- One `VerticalBlank()` consumes 1/60 s of demo time.
- Demo time is a single monotonic clock. Before the music start point it follows `performance.now()`. From the point where `main()` called `PlayModule()` it follows `audio.currentTime` plus that offset.
- The frame loop steps the demo until its consumed time catches up with the clock, then presents the last framebuffer.

Verification: total consumed demo time after the music start must land close to the rendered music length. A large mismatch means the 30 steps/s assumption is wrong and goes back to the user.

## Architecture

Each blocking C routine becomes a JavaScript generator. It `yield`s a duration in milliseconds wherever the original called `ShowScreen()` or `VerticalBlank()`. The body stays line-for-line comparable with `NINJAC.C`, including float accumulators and integer truncation.

```
index.html              canvas, start overlay, importmap for three
src/main.js             load assets, clock, requestAnimationFrame loop, F = fullscreen, #t= seek
src/screen.js           three.js presenter
src/machine.js          the "PC": framebuffer, palette, layers, pGraphics, yield helpers
src/ilbm.js             ILBM_GetXSize, ILBM_GetYSize, DepackILBM, ILBM_Palette
src/gfx.js              DrawLayerVert, DrawLayerHor, DrawFog, Sprite_Draw, BitmapZoom, MotionBlurr
src/files.js            file_offsets and the ANIMS.H constants
src/demo.js             main(): logos, music start marker, scene order, inline fades, Credits
src/scenes/*.js         one generator per routine, grouped: animplay, intro, logo, city, mutant, ninja, credits
assets/NINJA2.000       original graphics, decoded at runtime
assets/music.ogg        rendered from NINJA2.001
test/demo.test.js       headless checks, runs under node
```

### `src/machine.js`

Holds the state the C code kept in globals:

- `screen`: `Uint8Array(320*256)`, the indexed framebuffer.
- `palette`: `Uint8Array(256*4)`, RGBA. `ResetPalette()` zeroes the colours.
- `pLayer1..3`: `Uint8Array(400000)` each. `pVspace`: `Uint8Array(320*400)`.
- `pGraphics`: `Uint8Array` over `NINJA2.000`.
- `SHOW_SCREEN_MS = 33`, `VERTICAL_BLANK_MS = 1000/60`.

No DOM, no three.js. It runs under node unchanged.

### `src/screen.js`

The only three.js code. One orthographic camera and one full-screen quad.

- Index texture: 320×256 `RedFormat`, `UnsignedByteType`, nearest filtering.
- Palette texture: 256×1 `RGBAFormat`, nearest filtering.
- Fragment shader: read the index, look up the palette.
- `present(screen, palette)` uploads both and renders.
- Canvas keeps square pixels, scales by `object-fit: contain` with `image-rendering: pixelated`. No 4:3 stretch.

### Scenes

`AnimPlay`, `AnimPlay2`, `AnimPlay3`, `AnimPlay4`, `AnimPlayUnpacked`, `Intro`, `Logo`, `City`, `MutantSurprise`, `NinjaScrollUp`, `NinjaJumpUp`, `NinjaInAir`, `NinjaFallDown`, `NinjaAttack`, `MutantHead`, `NinjaIntoFog`, `Credits`. Plus the two opening logos (`gMELONSCOOP`, `g2035`) and the inline fades in `main()`.

Keyboard checks (`GetKB()`) are dropped; the SDL port already stubs them to 0.

### Seeking

Scenes are deterministic and CPU-only. Seeking to time T rebuilds the machine and replays the generator from zero until consumed time reaches T, without presenting. `#t=<seconds>` in the URL and the arrow keys (±5 s) use this.

## Music

`NINJA2.001` is rendered once to `assets/music.ogg` with `openmpt123` (libopenmpt), then encoded with ffmpeg as Opus in an Ogg container (the local ffmpeg has no Vorbis encoder). The local ffmpeg has no libopenmpt demuxer, so `openmpt123` must be installed (`brew install libopenmpt`). The command is recorded in the README. The XM itself is not shipped to the browser.

## Error handling

- Asset fetch failure: the start overlay shows which file failed. Nothing starts.
- `DepackILBM` and `chunk_search` bound their reads to the buffer length and throw on a missing `BODY` or `CMAP` chunk. The original scanned memory unbounded.
- Autoplay: the demo starts on a click.

## Testing

`test/demo.test.js`, plain `node:test`, synchronous file reads:

1. Every offset in `file_offsets` points at a `FORM....ILBM` header and decodes without overrun.
2. The whole demo generator runs to completion headless without throwing.
3. Total consumed time after the music start is within a tolerance of the rendered music length.
4. A framebuffer checksum at a few fixed times, recorded after visual sign-off, guards against regressions.

Visual check: run in a browser and compare key scenes against a DOSBox capture of `NINJA2.EXE`.

## Out of scope

- Live XM playback.
- CRT, scanline or aspect-correction filters.
- Smooth sub-pixel scrolling or interpolation above 30 steps/s.
- Mobile-specific controls.

## Open items

- The project folder sits inside the `/Users/gilm/git` repository, which is not this project's repository. The spec is not committed. A dedicated repository is the user's call.
- `vga.32` (the `pos` macro used by `ShowScreen_`) is not in the source tree. It does not affect the port: page flipping has no visible equivalent here.
