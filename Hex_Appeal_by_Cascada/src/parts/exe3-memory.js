// exe3's memory map (docs/disassembly/H3_ifs_morphs.md): the part's variables and tables, at their linear
// addresses in the image (loaded at segment 0). DS is segment 180d, the palette and logo are in segment 083c, and
// the self-modified immediates live in the code segment 0000, so cs:x is linear x.

/** Segment 180d: all variables and tables (DS). */
export const DATA = 0x180d0;
/** Segment 083c: the palette (from 083c:0007) and the logo picture (from 083c:031b). */
export const PICTURE_DATA = 0x83c0;
export const PALETTE = PICTURE_DATA + 0x0007;
export const LOGO_PICTURE = PICTURE_DATA + 0x031b;

// ---- rotation and projection (rotate_project 0f11) ----
export const ANGLE_Z = DATA + 0x0000;
export const ANGLE_Y = DATA + 0x0002;
export const ANGLE_X = DATA + 0x0004;
export const MORPH_ANGLE_Z = DATA + 0x0006;
export const MORPH_ANGLE_Y = DATA + 0x0008;
export const MORPH_ANGLE_X = DATA + 0x000a;
export const STAR_ANGLE_Z = DATA + 0x000c;
export const STAR_ANGLE_Y = DATA + 0x000e;
export const STAR_ANGLE_X = DATA + 0x0010;
export const END_COUNTER = DATA + 0x0012;
export const IS_ENDING = DATA + 0x0014;
export const POINT_X = DATA + 0x0f02;
export const ROTATED_X1 = DATA + 0x0f04;
export const ROTATED_X = DATA + 0x0f06;
export const POINT_Y = DATA + 0x0f08;
export const ROTATED_Y1 = DATA + 0x0f0a;
export const ROTATED_Y = DATA + 0x0f0c;
export const POINT_Z = DATA + 0x0f0e;
export const ROTATED_Z1 = DATA + 0x0f10;
export const ROTATED_Z = DATA + 0x0f12;
export const SCREEN_X = DATA + 0x0f14;
export const SCREEN_Y = DATA + 0x0f16;
export const TRANSLATE_X = DATA + 0x0f18;
export const TRANSLATE_Y = DATA + 0x0f1a;
export const TRANSLATE_Z = DATA + 0x0f1c;
export const PERSPECTIVE = DATA + 0x0f1e;
/** 2000 int16 each: SIN at [82e0], COS at [9280] (COS[0] = -32768). */
export const SIN_TABLE = DATA + 0x82e0;
export const COS_TABLE = DATA + 0x9280;

// ---- cubes and stars ----
export const CUBE_SPIN = DATA + 0x0018;
export const CUBE_ANGLES = DATA + 0x0042;
export const CUBE_POSITIONS = DATA + 0x006c;
/** Face colours, indexed by the running face number 1..42. */
export const FACE_COLOURS = DATA + 0x0096;
export const CUBE_VERTICES = DATA + 0x0f38;
export const PROJECTED_VERTICES = DATA + 0x0f68;
export const FACE_POINTS = DATA + 0x0f88;
export const BACKFACE_VECTORS = DATA + 0x0fb0;
export const CUBE_FACES = DATA + 0x0f98;
export const IS_BACKFACE = DATA + 0x0fbc;
export const VERTEX_INDEX = DATA + 0x0fbd;
export const FACE_NUMBER = DATA + 0x0fbe;
export const STARS = DATA + 0x5d48;
export const STAR_MOTION = DATA + 0x0f20;
export const CUBE_MOTION = DATA + 0x0f22;
/** cs:04a4, the cubes' screen y offset (self-modified word, -81 at start, +1 per retrace). */
export const CUBE_Y_OFFSET = 0x04a4;

// ---- dots and pages ----
export const DOT_LIST_PAGE0 = DATA + 0x00ec;
export const DOT_LIST_PAGE1 = DATA + 0x07f4;
export const DOT_LIST_INDEX = DATA + 0x0efc;
export const MORPH_FRAMES = DATA + 0x0efe;
export const QUIT_FLAG = DATA + 0x0f00;
export const IFS_WEIGHT = DATA + 0x0f28;
export const MORPH_WEIGHT = DATA + 0x0f2a;
export const FRAMES_WAITED = DATA + 0x0f2c;
export const PLOT_X = DATA + 0x0f2e;
export const PLOT_Y = DATA + 0x0f30;
export const PLOT_SEGMENT = DATA + 0x0f32;
export const POLYGON_PAGE = DATA + 0x0f34;
export const PAGE_FLAG = DATA + 0x0f37;
/** cs:1093, the colour immediate of plot's `mov byte es:[di], 2`. */
export const PLOT_COLOUR = 0x1093;
/** cs:0196, the immediate of `mov al, 0x64` in main: the IFS dot colour, one less each frame down to 0x50. */
export const IFS_COLOUR = 0x0196;

// ---- palette fades ----
export const FIRE_FADE = DATA + 0x0fbf;
export const BLUES_FADE = DATA + 0x107f;
export const FIRE_FADE_STEP = DATA + 0x113f;
export const LOGO_FADE_STEPS = DATA + 0x1140;
export const LOGO_FADE_DELAY = DATA + 0x1141;
export const BLUES_FADE_STEP = DATA + 0x1142;

// ---- phases ----
export const IS_CUBES_DONE = DATA + 0x1157;
export const LOGO_STATE = DATA + 0x1158;
export const IS_IFS_ON = DATA + 0x1159;
export const IFS_HALF_RATE = DATA + 0x115a;
export const IFS_CYCLES = DATA + 0x115b;

// ---- random numbers and IFS ----
export const RANDOM_MULTIPLIER = DATA + 0x115c;
export const RANDOM_STATE = DATA + 0x115e;
export const IFS_DIVISOR = DATA + 0x1160;
export const FERN_SCALE = DATA + 0x1162;
export const IFS_OUT_X = DATA + 0x1178;
export const IFS_OUT_Y = DATA + 0x117a;
export const IFS_OUT_Z = DATA + 0x117c;
export const IFS_TERM = DATA + 0x117e;
export const RANDOM_VALUE = DATA + 0x1180;
export const BLEND_A_X = DATA + 0x1f0e;
export const BLEND_A_Y = DATA + 0x1f10;
export const BLEND_B_X = DATA + 0x1f12;
export const BLEND_B_Y = DATA + 0x1f14;
export const BLEND_A_Z = DATA + 0x1f16;
export const BLEND_B_Z = DATA + 0x1f18;
export const BLEND_WEIGHT = DATA + 0x1f1a;
export const IFS_BLEND_DIVISOR = DATA + 0x1f1c;
export const MORPH_BLEND_DIVISOR = DATA + 0x1f1e;
export const IFS_STEP = DATA + 0x1f24;
export const IFS_PAIR_INDEX = DATA + 0x1f25;
export const FERN_SHAPE_INDEX = DATA + 0x1f27;
export const IFS_X_OFFSET_A = DATA + 0x1f29;
export const IFS_X_OFFSET_B = DATA + 0x1f2b;
/** 41 bytes: the IFS blend weight per step. */
export const IFS_WEIGHTS = DATA + 0x1f2d;
/** 756 bytes: the morph blend weight per step. */
export const MORPH_WEIGHTS = DATA + 0x1f56;
export const IFS_PAIRS = DATA + 0x224a;
export const IFS_FIRST = DATA + 0x2286;
export const IFS_SECOND = DATA + 0x2288;
export const SHAPES = DATA + 0x228a;

// ---- polygons ----
/** byte count, byte colour, then (x, y) int16 points. */
export const POLYGON = DATA + 0x1184;
export const ROW_STRIDE = DATA + 0x1182;
export const LEFT_EDGES = DATA + 0x1586;
export const RIGHT_EDGES = DATA + 0x18a6;
export const POLYGON_EDGES_LEFT = DATA + 0x1bc6;
export const POLYGON_COLOUR = DATA + 0x1bc7;
export const POLYGON_MIN_X = DATA + 0x1bc8;
export const POLYGON_MAX_X = DATA + 0x1bca;
export const POLYGON_MIN_Y = DATA + 0x1bcc;
export const POLYGON_MAX_Y = DATA + 0x1bce;
export const IS_EDGE_DOWN = DATA + 0x1bd0;
export const LEFT_MASKS = DATA + 0x1bd2;
export const RIGHT_MASKS = DATA + 0x1d12;

// ---- morph ----
/** The generated fern shape, 400 x (x, y, z) int16. */
export const FERN_SHAPE = DATA + 0x2c02;
export const MORPH_POINTS = DATA + 0x7974;
export const MORPH_STEP = DATA + 0x82d4;
export const SHAPE_INDEX = DATA + 0x82d6;
export const IS_FERN_SHAPE_MADE = DATA + 0x82d8;
/** cs:0b7e/0b8f/0ba0 and cs:0b85/0b96/0ba7: the displacements of the morph's reads of shape A and shape B. */
export const SHAPE_A_PATCHES = [0x0b7e, 0x0b8f, 0x0ba0];
export const SHAPE_B_PATCHES = [0x0b85, 0x0b96, 0x0ba7];

/** A 16-bit value as signed. */
export function s16(v) {
  return (v << 16) >> 16;
}

/** `idiv`: a signed 32-bit dividend by a signed 16-bit divisor, quotient truncated toward zero, as 16 bits.
 * (A zero divisor or a quotient out of range would be a divide fault in the original; it does not happen.) */
export function idiv16(dividend, divisor) {
  if (divisor === 0) {
    return 0;
  }
  return Math.trunc(dividend / divisor) & 0xffff;
}
