// Record layouts of the engine's buffers, as int offsets (the original's byte offsets / 4).

/** Vertex record (0x24 bytes, [0x89dd0]): camera-space x,y,z, corner normal, screen x,y, projected flag. */
export const V = { X: 0, Y: 1, Z: 2, NX: 3, NY: 4, NZ: 5, SX: 6, SY: 7, PROJECTED: 8 };
export const VERTEX_INTS = 9;

/** Polygon slot (0x18 bytes at +0x08 + 0x18*k): vertex index, texture u, v, projector s, t, w. */
export const S = { VERTEX: 0, U: 1, V: 2, S: 3, T: 4, W: 5 };
export const SLOT_INTS = 6;
export const MAX_SLOTS = 6;

/** Face (0x30 bytes): type (1 = point), material, face normal (-1 none), vertices a,b,c, u0,v0,u1,v1,u2,v2. */
export const F = { TYPE: 0, MATERIAL: 1, NORMAL: 2, A: 3, U0: 6 };
export const FACE_INTS = 12;

/** Face-normal record (12 bytes, [0x89dd4]). */
export const NORMAL_INTS = 3;

export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;
