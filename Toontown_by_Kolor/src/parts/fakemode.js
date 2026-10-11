// Part 11, 0x10629f (runs to song position 0x2c): the "faked highcolor" picture, Minnie with a "Kolor super demo!"
// sign over colour-cycling rays (docs/disassembly/G_fakemode.md).
//
// The part renders a 320x200 truecolour buffer (3 bytes per pixel, in the TGA's B, G, R order): each component is a
// ray pattern from the load-time table 0x106024, then the TGA picture's lines 83..199 are copied over it with
// colour fc fc fc transparent. With the truecolour flag [0x12bd8c] clear (the default) it is shown in "FakeMode"
// (0x105d7a): a 320x400 unchained 256-colour mode whose DAC holds three 64-step ramps, red (0..63), green
// (64..127) and blue (128..191). Each source row becomes three scanlines, one per component, and planes 0 and 2
// are one scanline lower than planes 1 and 3, so the components interleave diagonally and the eye mixes them
// (0x105f62). The VESA 2.0 path (0x1052c7, 0x10552e, 0x1053e3) is not ported.
import { POSITION, HALF_RETRACES, waitRetrace } from '../machine.js';

/** @typedef {import('../machine.js').Machine} Machine */

/** The truecolour buffer main allocates (0x100317: 0x2ee00 bytes, 320x200x3). */
const BUFFER = 0x12bd80;
const WIDTH = 320;
const HEIGHT = 200;
const BYTES_PER_PIXEL = 3;
const LINE_BYTES = WIDTH * BYTES_PER_PIXEL;
const PIXELS = WIDTH * HEIGHT;

/** The TGA picture main loads (0x1000bd), 320x200, top-down. */
const PICTURE = 0x16deec;
/** 0x10644c: the picture's lines 0x53..0x53 + 0x75 are copied, all 320 pixels wide. */
const PICTURE_FIRST_LINE = 0x53;
const PICTURE_LINES = 0x75;
/** 0x10626b: a pixel fc fc fc is transparent. */
const TRANSPARENT = 0xfc;

/** The table 0x106024 builds, 0x3f400 bytes (buildRaysTables). */
const TABLES = 0x170608;
const TABLES_SIZE = 0x3f400;
/** Per pixel: its angle around the centre and its squared distance, 2 bytes, in screen order. */
const ANGLE_DISTANCE_BYTES = PIXELS * 2;
/** 0x1f400: 256 rows; row r = the ray length r, column d = the brightness at distance d (255 down to 0). */
const FALLOFF = 0x1f400;
/** 0x2f400: a 256x256 picture from TOONTOWN.DAT, row r scaled by r / 256: row = amplitude, column = angle. */
const RAY_LENGTHS = 0x2f400;
/** 0x106187: the picture is an Alchemy (mhwanh) file at this offset; its pixels follow 0x320 bytes of header. */
const RAY_PICTURE_OFFSET = 0x42505 + 0x320;
const RAY_PICTURE_SIZE = 0x10000;
/** 0x10604f: the centre of the angles and distances (x relative to column 0x9f). */
const CENTRE_X = 0x9f;
const CENTRE_Y = 0x64;
/** 0x127578 127.5, 0x127598 pi: angles from -127.5 to 127.5. */
const ANGLE_SCALE = 0x127578;
const PI = 0x127598;
/** 0x127580 4, 0x127588 150, 0x1275a0 47000: distance = (x² + 4y²) * 150 / 47000. */
const Y_SQUARED_SCALE = 0x127580;
const DISTANCE_SCALE = 0x127588;
const DISTANCE_DIVISOR = 0x1275a0;
/** 0x127590 0.5. */
const HALF = 0x127590;

/** 0x106323: the music sync counter is reset at the start. */
const SYNC_RESET = 0;
/** The three components' animations ([esp + ...] of 0x10629f): phase, amplitude and the amplitude's step. */
const COMPONENTS_START = [
  { phase: 0, amplitude: 0x3c, step: -1, phaseStep: 1 },
  { phase: 0x3c, amplitude: 0x96, step: 1, phaseStep: 1 },
  { phase: 0x5a, amplitude: 0xfa, step: -1, phaseStep: 2 },
];
/** 0x1064c8: an amplitude at or below 0x32, or at or above 0xfd, turns its step around. */
const AMPLITUDE_LOW = 0x32;
const AMPLITUDE_HIGH = 0xfd;

/** The FakeMode screen (0x105f62): 133 source rows of 3 scanlines, 80 bytes per scanline. */
const FAKE_ROWS = 0x85;
const FAKE_ROW_STEP = 0x180f6;
const SCANLINE_BYTES = 0x50;
/** 0x10560b builds the ramps' lookup at 0x170300, but 0x105f62 does the same arithmetic itself. */
const RED_RAMP = 0x00;
const GREEN_RAMP = 0x40;
const BLUE_RAMP = 0x80;
const RAMP_STEPS = 0x40;

/** 0x114e44 then fistp: the low byte of the value truncated toward zero. */
const truncatedByte = (value) => Math.trunc(value) & 0xff;

/**
 * 0x106024 (main, load time): the rays' tables at [0x170608]. Angles go through a float (fstp dword) as the
 * original stores them; column 0x9f (x = 0) averages the angles of its two neighbours.
 * @param {Machine} m
 */
export function buildRaysTables(m) {
  const block = m.malloc(TABLES_SIZE);
  m.set32(TABLES, block);
  const angleScale = m.f64(ANGLE_SCALE);
  const pi = m.f64(PI);
  let at = block;
  for (let row = 0; row < HEIGHT; row++) {
    const y = row - CENTRE_Y;
    for (let column = 0; column < WIDTH; column++) {
      const x = column - CENTRE_X;
      const angle = x === 0
        ? Math.fround((Math.atan2(y, x + 1) + Math.atan2(y, x - 1)) * m.f64(HALF))
        : Math.fround(Math.atan2(y, x));
      m.set8(at++, truncatedByte((angle * angleScale) / pi));
      const squared = y * m.f64(Y_SQUARED_SCALE) * y + x * x;
      m.set8(at++, truncatedByte((squared * m.f64(DISTANCE_SCALE)) / m.f64(DISTANCE_DIVISOR)));
    }
  }
  // 0x10613f: row r, column d: 255 - d * 255 / r below r, 0 from r on.
  for (let length = 0; length < 0x100; length++) {
    for (let distance = 0; distance < 0x100; distance++) {
      m.set8(at++, distance < length ? 0xff - Math.trunc((distance * 0xff) / length) : 0);
    }
  }
  // 0x106187: the picture, then 0x1061cf: row r times r / 256.
  m.readDat(RAY_PICTURE_OFFSET, RAY_PICTURE_SIZE, at);
  for (let row = 0; row < 0x100; row++) {
    for (let column = 0; column < 0x100; column++, at++) {
      m.set8(at, (m.u8(at) * row) >> 8);
    }
  }
}

/**
 * 0x106329 (one of three unrolled copies): one component of the buffer. A pixel's ray length is the ray picture
 * at row `amplitude`, column angle + phase / 2; its brightness the fall-off at that length and its distance.
 * The loop runs the table backwards and swaps each pair of pixels, so buffer pixel p takes table pixel
 * 0xf9ff - p (the picture turned half a turn); the table's first pair (the buffer's last two pixels) is skipped.
 */
function drawComponent(m, component, phase, amplitude) {
  const tables = m.u32(TABLES);
  const buffer = m.u32(BUFFER) + component;
  const phaseByte = (phase >> 1) & 0xff;
  const amplitudeRow = (amplitude & 0xff) << 8;
  for (let p = 0; p < PIXELS - 2; p++) {
    const from = tables + (PIXELS - 1 - p) * 2;
    const length = m.u8(tables + RAY_LENGTHS + amplitudeRow + ((m.u8(from) + phaseByte) & 0xff));
    m.set8(buffer + p * BYTES_PER_PIXEL, m.u8(tables + FALLOFF + (length << 8) + m.u8(from + 1)));
  }
}

/**
 * 0x1061ff(x 0, line 0x53, width 0x140, lines 0x75, picture, buffer): copies a rectangle of the picture to the same
 * place in the buffer, skipping fc fc fc pixels.
 */
function drawPicture(m) {
  const picture = m.u32(PICTURE);
  const buffer = m.u32(BUFFER);
  const first = PICTURE_FIRST_LINE * LINE_BYTES;
  const last = (PICTURE_FIRST_LINE + PICTURE_LINES) * LINE_BYTES;
  for (let at = first; at < last; at += BYTES_PER_PIXEL) {
    const isTransparent = m.u8(picture + at) === TRANSPARENT && m.u8(picture + at + 1) === TRANSPARENT
      && m.u8(picture + at + 2) === TRANSPARENT;
    if (!isTransparent) {
      m.mem.copyWithin(buffer + at, picture + at, picture + at + BYTES_PER_PIXEL);
    }
  }
}

/** 0x1055f4: one DAC entry. */
function setColour(m, index, red, green, blue) {
  m.vga.out8(0x3c8, index);
  m.vga.out8(0x3c9, red);
  m.vga.out8(0x3c9, green);
  m.vga.out8(0x3c9, blue);
}

/**
 * 0x105d7a: FakeMode. Mode 13h, chain-4 off, the CRTC in byte mode with one scanline per row (320x400), the screen
 * cleared, and the three ramps. The blue loop starts its values at 0x40 (the DAC keeps 6 bits: 0..63, and
 * 0..3 in entries 192..195, which no pixel uses).
 */
function setFakeMode(m) {
  const vga = m.vga;
  vga.setMode13();
  vga.out8(0x3c4, 4);
  vga.out8(0x3c5, (vga.sequencer[4] & 0xf7) | 4);
  vga.out16(0x3c4, 0x0f02);
  for (let offset = 0; offset < 0x10000; offset++) {
    vga.write(offset, 0);
  }
  vga.out8(0x3d4, 0x14);
  vga.out8(0x3d5, vga.in8(0x3d5) & 0xbf);
  vga.out8(0x3d4, 0x17);
  vga.out8(0x3d5, vga.in8(0x3d5) | 0x40);
  vga.out8(0x3d4, 9);
  vga.out8(0x3d5, vga.in8(0x3d5) & 0x70);
  for (let i = 0; i < RAMP_STEPS; i++) {
    setColour(m, RED_RAMP + i, i, 0, 0);
  }
  for (let i = 0; i < RAMP_STEPS; i++) {
    setColour(m, GREEN_RAMP + i, 0, i, 0);
  }
  for (let i = 0; i < 0x44; i++) {
    setColour(m, BLUE_RAMP + i, 0, 0, 0x40 + i);
  }
}

/**
 * 0x105f62 (through [0x1702fc] = 0x1053fc): the buffer to the FakeMode screen, plane by plane. Source row
 * floor(k * 0x180f6 / 65536) gives scanlines 3k (the buffer's byte 0, blue ramp), 3k + 1 (byte 1, green) and
 * 3k + 2 (byte 2, red); planes 0 and 2 start one scanline lower.
 */
function showFake(m) {
  const vga = m.vga;
  const buffer = m.u32(BUFFER);
  for (let plane = 0; plane < 4; plane++) {
    vga.out16(0x3c4, ((1 << plane) << 8) | 2);
    let address = plane % 2 === 0 ? SCANLINE_BYTES : 0;
    let y = 0;
    for (let k = 0; k < FAKE_ROWS; k++) {
      let from = buffer + (y >>> 16) * LINE_BYTES + plane * BYTES_PER_PIXEL;
      y += FAKE_ROW_STEP;
      for (let column = 0; column < SCANLINE_BYTES; column++, from += 4 * BYTES_PER_PIXEL, address++) {
        vga.write(address, BLUE_RAMP + (m.u8(from) >> 2));
        vga.write(address + SCANLINE_BYTES, GREEN_RAMP + (m.u8(from + 1) >> 2));
        vga.write(address + 2 * SCANLINE_BYTES, RED_RAMP + (m.u8(from + 2) >> 2));
      }
      address += 2 * SCANLINE_BYTES;
    }
  }
}

/** 0x1064b1: one step of a component's animation; the third one checks its amplitude before adding the step. */
function stepComponents(components) {
  const isOutside = (amplitude) => amplitude <= AMPLITUDE_LOW || amplitude >= AMPLITUDE_HIGH;
  return components.map((c, index) => {
    const phase = c.phase + c.phaseStep;
    if (index === 2) {
      const step = isOutside(c.amplitude) ? -c.step : c.step;
      return { ...c, phase, step, amplitude: c.amplitude + step };
    }
    const amplitude = c.amplitude + c.step;
    return { ...c, phase, amplitude, step: isOutside(amplitude) ? -c.step : c.step };
  });
}

/**
 * 0x10629f: the part. Animations advance by the half-retrace counter [0x12bd88]. At the end (0x106550) it sets
 * mode 13h again, which also restores the BIOS palette and clears the screen for the next part.
 * @param {Machine} m
 * @param {number} lastPosition
 */
export function* fakeMode(m, lastPosition) {
  setFakeMode(m); // 0x10630e (0x1052c7 / 0x10552e when [0x12bd8c] = 1)
  let halfRetraces = m.u32(HALF_RETRACES);
  m.readPlayStatus();
  m.setSyncs(SYNC_RESET);
  let components = COMPONENTS_START;
  for (;;) {
    components.forEach((c, index) => drawComponent(m, index, c.phase, c.amplitude));
    m.readPlayStatus(); // 0x106447
    drawPicture(m);
    yield* waitRetrace(m);
    showFake(m);
    const now = m.u32(HALF_RETRACES);
    for (let i = now - halfRetraces; i > 0; i--) {
      components = stepComponents(components);
    }
    halfRetraces = now;
    if (lastPosition <= m.u32(POSITION)) {
      break;
    }
  }
  m.vga.setMode13();
  return false;
}
