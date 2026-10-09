// exe5: the texture-mapped cube over a starfield (texture code Iceman, pictures O'Hara, cube logo Delsion; the
// starfield is Hellraiser's). Docs: H5_cube.md. Mode 13h retimed to 60 Hz, one page: each retrace the main loop
// copies last frame's cube from the off-screen buffer to the screen, draws the next cube into the buffer, then
// erases and redraws the 64 stars straight into video memory. The per-retrace callback runs the animation.
//
// The part's memory holds everything at its original address: DS0 = segment 0 (stars, palettes, star sine tables),
// the code segment 0403 (cube data, scroller, edge tables, cube sine table), the textures inside the image, the
// buffer at 2c11. Video memory is chain-4: address a is plane a & 3, offset a >> 2.
import { CODE, BUFFER, transformCube, faceTexCoords, drawVisibleFaces } from './exe5-cube.js';

/** @typedef {import('../machine.js').Machine} Machine */

// ---- DS0 (segment 0) ----
const STAR_ANGLES = 0x0006;
const STAR_OFFSETS = 0x000e;
const STAR_COUNT = 64;
const STAR_SPEED = 0x0738;
const FADE_STEP = 0x073a;
const STATE = 0x080b;
const STARS = 0x081f;
const TARGET_PALETTE = 0x1ae3;
const CURRENT_PALETTE = 0x1de3;
const STAR_SIN = 0x20f0;
const STAR_COS = 0x3090;

// ---- code segment 0403 (offsets) ----
const P2_PHASE = 0x306f;
const P3_PHASE = 0x3071;
const SCROLL_COLUMN = 0x3073;
const P4_PHASE = 0x3075;
const SCROLL_TEXT = 0x3079;
const TEXT_POINTER = 0x3095;
const GLYPH_SOURCE = 0x3097;
const GLYPH_WIDTH_LEFT = 0x3099;
const CHARACTER_TABLE = 0x309b;
const GLYPH_WIDTHS = 0x30ba;
const FACES = 0x31a2;
const FACE_RECORD_BYTES = 0xe6;
const FACE_ANGLE = 0;
const FACE_SPEED = 2;
const FACE_SCALE = 8;
const FACE_U_OFFSET = 0xc;
const SCROLL_SEGMENT = 0x360a;
const PERSPECTIVE_DISTANCE = 0x71d2;
const MASKED_ANGLES = 0x728e;
const CUBE_ANGLES = 0x7294;
const S1_SAWTOOTH = 0x729a;
const SINE_TABLE = 0x72ca;

// ---- other segments (linear) ----
const FONT = 0x268f0;
const FONT_PALETTE = 0x265f0;
/** Font bytes after the palette: 39 glyphs of 24x24, shifted to colours 0x80..0xbf at start. */
const FONT_GLYPH_BYTES = 0x57c0;
const FONT_GLYPHS_AT = 0x300;
const GLYPH_BYTES = 0x240;
const GLYPH_SIDE = 24;
const SCROLL_PARAGRAPHS = 0x800;
const SCROLL_FILL = 0x80;
const SCROLL_TEXTURE_BYTES = 0x8000;
/** The scroller's two copies: row 52, columns col and col + 128. */
const SCROLL_ROWS_AT = [0x3400, 0x3480];
const TEXT_END = 0xff;
/** int 21h/4Ah bx=0x3d09 keeps 0x3d09 paragraphs from the PSP (the image starts 0x10 after it); DOS puts the next
 * block's header right after, so the scroller texture is allocated 0x3d09 - 0x10 + 1 paragraphs after the image's
 * segment. */
const FIRST_FREE_SEGMENT = 0x3d09 - 0x10 + 1;

/** The palette groups in the program's order: DAC index, colours, source (linear). */
const PALETTE_GROUPS = [
  [0x80, 64, 0x265f0],
  [0x00, 32, 0x0caf0],
  [0x40, 64, 0x263b0],
  [0xc0, 64, 0x1fe30],
  [0x20, 32, 0x2c0b0],
];
const STAR_PALETTE_FROM = 0x60;
const STAR_PALETTE_BYTES = 0x60;
const STAR_FIRST_COLOUR = 0x20;
const FADE_LAST_STEP = 0x40;

// ---- states (DS0:080b) ----
const STATE_ZOOM_OUT = 1;
const STATE_CLEAR_WINDOW = 2;
const STATE_STARS_ONLY = 3;
const STATE_EXIT = 5;

// ---- animation ----
const DISTANCE_STEP = 200;
const DISTANCE_NEAR = 0x546;
const DISTANCE_FAR = 0x8000;
const S1_STEP = 1000;
const S1_WRAP = 50000;
const S1_RESTART = 100;
const P2_STEP = 0x46;
const P3_STEP = 0xa0;
const P4_STEP = 0x28;
const SCROLL_U_END = 0xc0;
const SCROLL_U_REWIND = 0x80;
/** The music cue (order index + 1, row + 1): order 18 row 51 starts the zoom-out, order 19 row 51 ends the part. */
const ZOOM_OUT_ORDER = 0x13;
const EXIT_ORDER = 0x14;
const CUE_ROW = 0x34;

// ---- the window: 200x170 at (60,15), the only part of the buffer that is shown ----
const WINDOW_START = 0x12fc;
const WINDOW_WIDTH = 200;
const WINDOW_ROWS = 170;
const ROW_BYTES = 320;

// ---- stars ----
const STAR_ANGLE_PERIOD = 2000;
const STAR_ANGLE_REWIND = 1999;
const STAR_SPEED_STEP = -35;
const STAR_Z_LIMIT = 1800;
const STAR_Z_SPAN = 3600;
const STAR_DEPTH = 0x0a5a;
const STAR_LENS_X = 225;
const STAR_LENS_Y = 450;
const STAR_CENTRE_X = 160;
const STAR_CENTRE_Y = 200;
const SCREEN_LAST_X = 319;
const SCREEN_LAST_Y = 199;
const STAR_COLOUR_BIAS = 0x1f4;
const STAR_COLOUR_BASE = 0x33;
const NOT_DRAWN = 0xffff;

const SCAN_CODE_ESCAPE = 1;

function s16(v) {
  return (v << 16) >> 16;
}

/** Mode 13h video memory, chain-4. */
function vramRead(vga, a) {
  return vga.planes[a & 3][a >> 2];
}

function vramWrite(vga, a, value) {
  vga.planes[a & 3][a >> 2] = value;
}

/** 0403:0000: memory, mode 13h at 60 Hz (the music paused around the mode set), scroller, font, palettes, callback. */
function setUp(m) {
  const vga = m.vga;
  // int 80h bx=1dh twice around the mode set
  m.pauseMusic();
  vga.setMode13();
  vga.out8(0x3d4, 0x11);
  vga.out8(0x3d5, vga.in8(0x3d5) & 0x7f);
  vga.out8(0x3c2, vga.in8(0x3cc) | 0xc0);
  for (const value of [0x0e06, 0x3e07, 0x4109, 0xc510, 0xac11, 0x9c15, 0x0016]) {
    vga.out16(0x3d4, value);
  }
  convertScrollText(m);
  m.freeSegment = FIRST_FREE_SEGMENT;
  const scrollSegment = m.allocParagraphs(SCROLL_PARAGRAPHS);
  m.set16(CODE + SCROLL_SEGMENT, scrollSegment);
  m.mem.fill(SCROLL_FILL, scrollSegment * 16, scrollSegment * 16 + SCROLL_TEXTURE_BYTES);
  // 0403:0067: the font to colours 0x80..0xbf, and colour 0x80 = (10,10,10), the scroller face's grey
  for (let i = 0; i < FONT_GLYPH_BYTES; i++) {
    const a = FONT_PALETTE + FONT_GLYPHS_AT + i;
    m.mem[a] = (m.mem[a] + 0x80) & 0xff;
  }
  m.mem.fill(0x0a, FONT_PALETTE, FONT_PALETTE + 3);
  for (const [first, count, source] of PALETTE_GROUPS) {
    m.mem.copyWithin(TARGET_PALETTE + first * 3, source, source + count * 3);
    vga.dacLoad(first, m.mem, source, count * 3);
  }
  m.mem.copyWithin(CURRENT_PALETTE, TARGET_PALETTE, TARGET_PALETTE + 768);
  m.callback = frameCallback;
}

/** 0403:3045: the scroll text's characters, in place, to indices in the character table (until 0xff). */
function convertScrollText(m) {
  for (let at = CODE + SCROLL_TEXT; m.mem[at] !== TEXT_END; at++) {
    let index = 0;
    while (m.mem[CODE + CHARACTER_TABLE + index] !== m.mem[at]) {
      index++;
    }
    m.mem[at] = index;
  }
}

function faceAddress(k) {
  return CODE + FACES + k * FACE_RECORD_BYTES;
}

function cubeSine(m, byteOffset) {
  return m.s16(CODE + SINE_TABLE + (byteOffset & 0xffe));
}

/** Adds `step` to the word at `a` (16-bit wrap) and returns the new value. */
function addWord(m, a, step) {
  const v = (m.u16(a) + step) & 0xffff;
  m.set16(a, v);
  return v;
}

/** 0403:0d43 frameCallback: the star fade-in, the animation counters, the zoom, the scroller, the music cues. */
function frameCallback(m) {
  fadeInStars(m);
  for (let i = 0; i < 3; i++) {
    addWord(m, CODE + CUBE_ANGLES + 2 * i, 2 * (i + 1));
  }
  if (addWord(m, CODE + S1_SAWTOOTH, S1_STEP) >= S1_WRAP) {
    m.set16(CODE + S1_SAWTOOTH, S1_RESTART);
  }
  addWord(m, CODE + P2_PHASE, P2_STEP);
  addWord(m, CODE + P3_PHASE, P3_STEP);
  for (let k = 0; k < 6; k++) {
    addWord(m, faceAddress(k) + FACE_ANGLE, m.u16(faceAddress(k) + FACE_SPEED));
  }
  const p4 = m.u16(CODE + P4_PHASE);
  m.set16(CODE + P4_PHASE, p4 + P4_STEP);
  m.set16(faceAddress(4) + FACE_SCALE, ((((cubeSine(m, p4) + 0x7fff) & 0xffff) >> 1) + 0x3060) & 0xffff);
  moveCube(m);
  scrollText(m);
  followMusic(m);
  for (let i = 0; i < 3; i++) {
    const a = STAR_ANGLES + 2 * i;
    if (addWord(m, a, i + 1) >= STAR_ANGLE_PERIOD) {
      m.set16(a, m.u16(a) - STAR_ANGLE_REWIND);
    }
  }
  addWord(m, STAR_SPEED, STAR_SPEED_STEP);
}

/** Colours 0x20..0x3f: outputs the previous step, then computes target * step >> 6 (so 63/64 at the end). */
function fadeInStars(m) {
  const step = m.u16(FADE_STEP);
  if (step > FADE_LAST_STEP) {
    return;
  }
  m.vga.dacLoad(STAR_FIRST_COLOUR, m.mem, CURRENT_PALETTE + STAR_PALETTE_FROM, STAR_PALETTE_BYTES);
  for (let i = STAR_PALETTE_FROM; i < STAR_PALETTE_FROM + STAR_PALETTE_BYTES; i++) {
    m.mem[CURRENT_PALETTE + i] = ((m.mem[TARGET_PALETTE + i] * (step & 0xff)) >> 6) & 0xff;
  }
  m.set16(FADE_STEP, step + 1);
}

/** The fly-in (state 0) and the zoom-out (state 1): the depth D moves by 200 a retrace (unsigned compares). */
function moveCube(m) {
  const state = m.u16(STATE);
  const a = CODE + PERSPECTIVE_DISTANCE;
  if (state === 0 && addWord(m, a, -DISTANCE_STEP) <= DISTANCE_NEAR) {
    m.set16(a, DISTANCE_NEAR);
  }
  if (state === STATE_ZOOM_OUT && addWord(m, a, DISTANCE_STEP) >= DISTANCE_FAR) {
    m.set16(a, DISTANCE_FAR);
    m.set16(STATE, STATE_CLEAR_WINDOW);
  }
}

/** Face 4's scroller: one font column a retrace, written twice into its texture (rows 52..75). */
function scrollText(m) {
  addWord(m, CODE + SCROLL_COLUMN, 1);
  const uOffset = faceAddress(4) + FACE_U_OFFSET;
  if (addWord(m, uOffset, 1) >= SCROLL_U_END) {
    m.set16(uOffset, m.u16(uOffset) - SCROLL_U_REWIND);
    m.set16(CODE + SCROLL_COLUMN, 0);
  }
  if (m.u16(CODE + GLYPH_WIDTH_LEFT) === 0) {
    while (m.mem[CODE + m.u16(CODE + TEXT_POINTER)] === TEXT_END) {
      m.set16(CODE + TEXT_POINTER, SCROLL_TEXT);
    }
    const pointer = m.u16(CODE + TEXT_POINTER);
    const glyph = m.mem[CODE + pointer];
    m.set16(CODE + TEXT_POINTER, pointer + 1);
    m.set16(CODE + GLYPH_WIDTH_LEFT, m.mem[CODE + GLYPH_WIDTHS + glyph]);
    m.set16(CODE + GLYPH_SOURCE, glyph * GLYPH_BYTES);
  }
  const texture = m.u16(CODE + SCROLL_SEGMENT) * 16;
  const column = m.u16(CODE + SCROLL_COLUMN);
  const source = m.u16(CODE + GLYPH_SOURCE);
  for (const rowsAt of SCROLL_ROWS_AT) {
    for (let r = 0; r < GLYPH_SIDE; r++) {
      // a width of 25 (T) reads one column into the next glyph, as the original does
      const font = FONT + ((source + r * GLYPH_SIDE) & 0xffff);
      m.mem[texture + ((rowsAt + column + r * 0x100) & 0xffff)] = m.mem[font];
    }
  }
  addWord(m, CODE + GLYPH_SOURCE, 1);
  addWord(m, CODE + GLYPH_WIDTH_LEFT, -1);
}

/**
 * 0403:2847: the music cues. The original's exit test (0403:287e `cmp al,0x38`) compares the low byte of the load
 * segment, which a `mov ax,seg` has just put in al, instead of the row: in DOSBox the part never ends. The
 * recording was made with that compare patched to `cmp al,0`, so the port exits on the outer conditions alone:
 * order index + 1 >= 0x14 and row + 1 >= 0x34, once the zoom-out has started.
 */
function followMusic(m) {
  const order = m.musicOrder() & 0xff;
  const row = m.musicRow() & 0xff;
  if (order < ZOOM_OUT_ORDER || row < CUE_ROW) {
    return;
  }
  if (m.u16(STATE) < STATE_ZOOM_OUT) {
    m.set16(STATE, STATE_ZOOM_OUT);
    return;
  }
  if (order >= EXIT_ORDER) {
    m.set16(STATE, STATE_EXIT);
  }
}

/** 0403:28df copyWindowToScreen, and the window clears inlined in the main loop (buffer or video memory). */
function copyWindowToScreen(m) {
  const vga = m.vga;
  for (let r = 0; r < WINDOW_ROWS; r++) {
    const row = WINDOW_START + r * ROW_BYTES;
    for (let x = 0; x < WINDOW_WIDTH; x++) {
      vramWrite(vga, row + x, m.mem[BUFFER + row + x]);
    }
  }
}

function clearBufferWindow(m) {
  for (let r = 0; r < WINDOW_ROWS; r++) {
    const row = BUFFER + WINDOW_START + r * ROW_BYTES;
    m.mem.fill(0, row, row + WINDOW_WIDTH);
  }
}

function clearScreenWindow(vga) {
  for (let r = 0; r < WINDOW_ROWS; r++) {
    const row = WINDOW_START + r * ROW_BYTES;
    for (let x = 0; x < WINDOW_WIDTH; x++) {
      vramWrite(vga, row + x, 0);
    }
  }
}

/** The main loop's cube step (0403:01c2..0797): show last frame's cube, then draw the next one into the buffer. */
function drawCube(m, codeDwords) {
  copyWindowToScreen(m);
  for (let i = 0; i < 3; i++) {
    m.set16(CODE + MASKED_ANGLES + 2 * i, m.u16(CODE + CUBE_ANGLES + 2 * i) & 0xffe);
  }
  const p2 = m.u16(CODE + P2_PHASE);
  const p3 = m.u16(CODE + P3_PHASE);
  m.set16(faceAddress(2) + FACE_SCALE, ((((cubeSine(m, p2) + 0x7fff) & 0xffff) >> 1) + 0x24a8) & 0xffff);
  m.set16(faceAddress(3) + FACE_SCALE, ((((cubeSine(m, p3) + 0x8000) & 0xffff) >> 2) + 0x4000) & 0xffff);
  m.set16(faceAddress(1) + FACE_SCALE, m.u16(CODE + S1_SAWTOOTH));
  clearBufferWindow(m);
  transformCube(m, codeDwords);
  faceTexCoords(m, codeDwords);
  drawVisibleFaces(m, codeDwords);
}

/** shl ax,1; imul dx: the high word of (2v as a word) * c. */
function rotateTerm(v, c) {
  return (s16(v << 1) * c) >> 16;
}

/**
 * 0403:82ca starfield, with 83ac eraseStars, 843e rotateProjectStar and 8401 plotStar. The artefacts are kept:
 * the erase writes 0 to video memory even where the cube has been copied since; an off-screen star leaves its
 * offset table entry stale (erased again every frame); a star is not drawn on a non-zero pixel.
 */
function starfield(m) {
  const vga = m.vga;
  for (let i = 0; i < STAR_COUNT; i++) {
    const at = m.u16(STAR_OFFSETS + 2 * i);
    if (at !== NOT_DRAWN) {
      vramWrite(vga, at, 0);
    }
  }
  const angles = [0, 1, 2].map((i) => m.u16(STAR_ANGLES + 2 * i));
  m.set16(0, angles[0]);
  m.set16(2, angles[1]);
  m.set16(4, angles[2]);
  const [c0, c1, c2] = angles.map((a) => m.s16(STAR_COS + 2 * a));
  const [n0, n1, n2] = angles.map((a) => m.s16(STAR_SIN + 2 * a));
  const speed = m.s16(STAR_SPEED);
  m.set16(STAR_SPEED, 0);
  let drawn = 0;
  for (let i = 0; i < STAR_COUNT; i++) {
    const star = STARS + 6 * i;
    const x = m.s16(star);
    const y = m.s16(star + 2);
    let z = s16(m.s16(star + 4) + speed);
    if (z >= STAR_Z_LIMIT) {
      z -= STAR_Z_SPAN;
    } else if (z <= -STAR_Z_LIMIT) {
      z += STAR_Z_SPAN;
    }
    m.set16(star + 4, z);
    const x1 = s16(rotateTerm(x, c0) - rotateTerm(y, n0));
    const y1 = s16(rotateTerm(y, c0) + rotateTerm(x, n0));
    const z2 = s16(rotateTerm(z, c1) - rotateTerm(x1, n1));
    const x2 = s16(rotateTerm(x1, c1) + rotateTerm(z, n1));
    const z3 = s16(s16(rotateTerm(z2, c2) - rotateTerm(y1, n2)) + STAR_DEPTH);
    const y3 = s16(rotateTerm(y1, c2) + rotateTerm(z2, n2));
    // 16-bit idivs (no overflow or zero divisor in this run); 450 >> 1 is both multiplier and offset for x
    const sx = (Math.trunc((x2 * STAR_LENS_X) / s16(z3 + STAR_LENS_X)) + STAR_CENTRE_X) & 0xffff;
    const sy = (Math.trunc((y3 * STAR_LENS_Y) / s16(z3 + STAR_LENS_Y)) + STAR_CENTRE_Y) & 0xffff;
    if (sx > SCREEN_LAST_X) {
      continue;
    }
    const py = sy >> 1;
    if (py > SCREEN_LAST_Y) {
      continue;
    }
    const colour = ((((z3 - STAR_DEPTH + STAR_COLOUR_BIAS) & 0xffff) >> 8) + STAR_COLOUR_BASE) & 0xff;
    let at = (sx + py * ROW_BYTES) & 0xffff;
    if (vramRead(vga, at) !== 0) {
      at = NOT_DRAWN;
    } else {
      vramWrite(vga, at, colour);
      if (m.mem[BUFFER + at] === 0) {
        m.mem[BUFFER + at] = colour;
      }
    }
    m.set16(STAR_OFFSETS + 2 * drawn, at);
    drawn++;
  }
}

/** The part (0403:0000): set up, then one main-loop iteration per retrace until the music cue or ESC. */
export function* runCube(m) {
  setUp(m);
  const codeDwords = new Int32Array(m.mem.buffer, CODE, 0x4000);
  for (;;) {
    // int 80h fn 19h until it changes, then fn 1ah
    const frame = m.frameCounter;
    while (m.frameCounter === frame) {
      yield;
    }
    m.frameCounter = 0;
    const state = m.u16(STATE);
    if (state <= STATE_ZOOM_OUT) {
      drawCube(m, codeDwords);
    }
    if (state === STATE_CLEAR_WINDOW) {
      clearScreenWindow(m.vga);
      m.set16(STATE, STATE_STARS_ONLY);
    }
    starfield(m);
    if (m.u16(STATE) === STATE_EXIT) {
      m.exitCode = 0;
      break;
    }
    if (m.readKeyboard() === SCAN_CODE_ESCAPE) {
      m.exitCode = 1;
      break;
    }
  }
  // int 80h fn 1ch, then the scroller texture is freed; the screen is left as it is
  m.callback = null;
}
