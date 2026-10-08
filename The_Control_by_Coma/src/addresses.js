// Memory addresses (and a file offset) that more than one module reads or writes. The program keeps its
// variables and pointers at fixed places in the flat memory; each name here is the original address.

/** 0x5606e / 0x56072: pointers to the 320x200 work buffer W and the back buffer B2 (see helpers.js). */
export const WORK_BUFFER_POINTER = 0x5606e;
export const BACK_BUFFER_POINTER = 0x56072;
/** Pointers to the 256x256 texture (starburst, text), buffer A (64000 bytes) and the 160x100 rotozoom buffer. */
export const TEXTURE_BUFFER_POINTER = 0x1b25a;
export const BUFFER_A_POINTER = 0x1b25e;
export const ROTOZOOM_BUFFER_POINTER = 0x1b262;
/** 0x1b3bd: 200 dwords, the address of each row of W. */
export const ROW_TABLE = 0x1b3bd;
/** The item tables of DEMO.AVI (30 dwords) and DEMO.FLI (20 dwords), relocated to pointers. */
export const AVI_ITEMS = 0x1b170;
export const FLI_ITEMS = 0x1b0f8;

/** 0x2ca18 / 0x2ce18: round(2048 * sin / cos(2 pi i / 256)), signed dwords. */
export const SINE_DWORDS = 0x2ca18;
export const COSINE_DWORDS = 0x2ce18;
/** 0x2d218: |sin| table (2 humps, max 0x7f); 0x2d318: the same shifted by a quarter (cosine). */
export const SINE_BYTES = 0x2d218;
export const COSINE_BYTES = 0x2d318;

/** The 3D engine's scratch x, y (also the input and output of the rotation 0x2d540) and its z angle. */
export const SCRATCH_X = 0x2d424;
export const SCRATCH_Y = 0x2d428;
export const ANGLE_Z = 0x2d460;
/** Object placement, written by the scenes and the effects. */
export const OFFSET_X = 0x2d448;
export const OFFSET_Y = 0x2d44c;
export const DISTANCE = 0x2d450;
/** 0x2d708: the texture of the triangles (and of the map); a RIX item's pixels. */
export const TEXTURE_POINTER = 0x2d708;
/** A RIX item: 10-byte header, 0x300-byte palette, then the pixels. */
export const RIX_PIXELS = 0x30a;

/** 0x53815's level and its self-modified immediates: byte count (mov ecx) and the value added (add [edi], imm8). */
export const GRAIN_LEVEL = 0x53810;
export const GRAIN_COUNT = 0x53822;
export const GRAIN_ADD = 0x53840;
/** 0x53811 / 0x5380c: the grain's noise frames and the phase the timer advances through them. */
export const GRAIN_NOISE_POINTER = 0x53811;
export const GRAIN_PHASE = 0x5380c;
/** [0x1b7ff] non-zero stops the part-2 palette pulse (0x53ed8). */
export const PALETTE_PULSE_OFF = 0x1b7ff;
/** The texture scroll bytes of the starburst painter 0x5224c, also the map renderer's u, v (0x55121). */
export const TEXTURE_SCROLL_U = 0x5224a;
export const TEXTURE_SCROLL_V = 0x5224b;
/** 0x52982's table pointer (LERP64) and its t; 0x1c314's added byte. */
export const LERP64_POINTER = 0x529f4;
export const LERP_T = 0x529f8;
export const UPSCALE_2X_ADD = 0x1c313;
