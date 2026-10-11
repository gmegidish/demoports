// The 3D engine of ROBOTNIK.EXE (Imagine-TDDD-derived library + demo helpers), ported bit-exactly:
// every routine here is checked against the original code run in unicorn (test/engine.test.js,
// fixtures by tools/re/engine_fixtures.py). Notes: docs/disassembly/E1_engine_data.md, E2_engine_render.md.
//
// API (names follow the original entry points; addresses in the module comments)
//
// Objects (eob.js, statics.js)
//   LoadObject(archive, 'name.eob') -> object        0x24688 = LoadObjectTree 0x433b0 + BuildMaterialsTree 0x41c50
//   staticObject(image, address) / staticMaterial(image, address)   objects / materials of the data segment
//       (0x835b8, 0x82a74, 0x80dec...): one shared, mutable instance per address, like the data segment
//   createObject(fields)                              a blank object (parts that build their own)
//   object fields: next, child, points (Int32Array xyz), faces (Int32Array, 12 per face: type, material,
//     normal, a, b, c, u0, v0, u1, v1, u2, v2), faceNormals, cornerNormals, matrix (8.8 K), position,
//     angles (Int16Array, 4096/turn), bbox, flags (FLAG.*), materials, keys
//   material fields: draw(polygon, context) (+0x2c), drawAddress, texture (+0x10, 256 wide), phongMap
//     (+0x14), ambient (+4), colourBase (+8), textureWidth / textureHeight (+0x1c / +0x20)
//   setObjectDraw(obj, draw) 0x2469c, setTreeDraw(obj, draw) 0x246d0, useSingleMaterial(obj, mat) 0x24720,
//   setTreeFlags(obj, bits) 0x27798, clearTreeFlags(obj, bits) 0x277bc, objectsOf(obj) (tree walk)
//   drawRoutine(address) -> the library routine: 0x28b60 flat, 0x29994 shade-by-v (logo), 0x2c118 phong,
//     0x44354 phong+flat, 0x331b4 texture, 0x35860 texture x phong, 0x36890 perspective texture
//
// Animation (anim.js): ScalePoints(obj, s) 0x39ad0, ScaleKeys(obj, s) 0x39bfc, AnimateTree(obj, t)
//   0x39e08 (t = frame*256), AnimateObject 0x39d50, AnimLength(obj) 0x39e30, LerpAngle 0x513a0
//
// World / camera (world.js)
//   CreateWorld(30, 1900, 2700, 2700) 0x39e68 (clears the global render list), DestroyWorld 0x39fd8,
//   AddObject(world, obj) 0x3a590, ComputeBounds(world) 0x3a598, SetRenderMode(world, 3) 0x3a5b4,
//   world.isFastPath (+0xb8), world.materials (+0), world.centreX / centreY, world.far
//   SetCameraPos(w, x, y, z) 0x3a114, SetCameraAngles(w, [ax, ay, az]) 0x3a2bc, GetCameraPos 0x3a178,
//   GetCameraAngles 0x3a250, CameraPitchLocal(w, a) 0x3a66c, CameraMoveLocalX/Y/Z(w, d) 0x3a764/0x3a7b4/0x3a714
//   SetObjPos(obj, x, y, z) 0x39a2c, SetObjZ 0x39a58, GetObjZ 0x39a64, GetObjPos 0x39b04,
//   SetObjAngleX/Y/Z(obj, a) 0x39a70/78/80, SetObjAngles(obj, [ax, ay, az]) 0x39b30, GetObjAngles 0x39b50
//
// Rendering (render.js, projector.js)
//   RenderWorld(world, { target, colourTable, ...extra }) 0x3a4e0: target = 320x200 bytes ([0x89dcc]),
//     colourTable = the part's 0xfd0a0 table (Uint8Array); extra fields reach the draw routines.
//   RenderWorldProjected(view, projectorWorld, { target, colourTable, projector }) 0x457f0 (parts 3/5);
//     projector = createProjectorState() { depth, lightMap, film, frameId }; install drawProjected
//     (0x46d08) with setTreeDraw.
//
// Writing a part's own draw routine (the override mechanism): material.draw = (polygon, context) => ...
//   polygon: { n, slots (Int32Array, SLOT_INTS per slot: S.VERTEX, S.U, S.V, S.S, S.T, S.W), material,
//     normal (face-normal record or -1), key, object, flags, projectorFlags }
//   context: { world, vertices (Int32Array, VERTEX_INTS per vertex: V.X, V.Y, V.Z camera space, V.NX,
//     V.NY, V.NZ corner normal, V.SX, V.SY screen), faceNormals (3 per record), target, colourTable, ...extra }
//   building blocks: triangleOf, rasterTemplate, packedChannel, scalarChannel, clippedSpan, packedIndex
//   (the 0x331b4-family template), perspectiveTriangle / perspectiveSpan (0x36890's setup and span,
//   for 0x37668-like routines), addEdge / resetEdgeTable (0x28c50 edge table).
//
// Triangle engine (triangles.js; src/shatter.js has its own copy): createTriangleEngine(sine),
//   triangleSineTable(image) (0x71054), createTriangleVertices(n), rotateVertices 0x43450,
//   projectVertices 0x435e8, setupTriangle(engine, v, a, b, c[, isSided]) 0x43654 / 0x437c4,
//   fillTriangleSpans(engine, texture) 0x764a2, setTriangleTarget 0x76a3c, walkEdge 0x439cc,
//   walkSidedEdge 0x43cf8 (part 12 fills its own spans from engine.right / engine.left).
//
// Recordings (rec.js): readCameraRecording + playCameraRecord(world, records, index) 0x2789c;
//   part 0: readChannelRecording(bytes, channels), createRecordPlayer, advanceRecordPlayer(player, dt,
//   onNextRecord), lerpRecord (spider.rec, light.rec), cameraQuadratics (0x26d44), createOrbitState,
//   orbitCamera(state, object, player, quads, world, divisor) 0x26e1c; teeth.rap: unpackFilmFrame
//   0x49028, filmFrameAt(frames).
//
// Transitions (quad.js): createQuadWorld(image, screen, backTexture) 0x27cac -> { world, quad }:
//   move with SetObjPos / SetObjAngle*, draw with RenderWorld.
//
// Tables (tables.js): phongMap 0x316c4 / generatePhongMap 0x314c0, clearPhongMaps 0x315f0.

export * from './eob.js';
export * from './anim.js';
export * from './world.js';
export * from './render.js';
export * from './layout.js';
export * from './triangles.js';
export * from './projector.js';
export * from './rec.js';
export * from './statics.js';
export * from './quad.js';
export { triangleSineTable, phongMap, generatePhongMap, clearPhongMaps } from './tables.js';
export { drawRoutine } from './raster/routines.js';
export {
  triangleOf, rasterTemplate, packedChannel, scalarChannel, clippedSpan, packedIndex, sortSlotsByY,
} from './raster/template.js';
export { perspectiveTriangle, perspectiveSpan, roundToEven } from './raster/perspective.js';
export { addEdge, resetEdgeTable } from './raster/edgetable.js';
