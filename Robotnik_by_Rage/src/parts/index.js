// The sixteen parts, by sequencer position. Each is { init(demo) -> state, *run(demo, state, firstSync),
// deinit?(demo, state) }; a missing one holds the screen until the next part's first sync entry.
// Porters: replace your slot's `undefined` with your part and add its import above.
import { spider } from './spider.js';
import { presents } from './presents.js';
import { codingCredits, artworkCredits, musicCredits } from './credits.js';
import { ball } from './ball.js';
import { sunset } from './sunset.js';
import { maze } from './maze.js';
import { face } from './face.js';
import { ending } from './ending.js';
import { endPictures } from './endpictures.js';
import { robot } from './robot.js';
import { skullShadow, skullDrill } from './skull.js';
import { room } from './room.js';
import { tunnel } from './tunnel.js';

export const PARTS = [
  spider, // 0 spider
  presents, // 1 presents
  codingCredits, // 2 credits: coding
  skullShadow, // 3 skull
  artworkCredits, // 4 credits: artwork
  skullDrill, // 5 skull, teeth, drill
  musicCredits, // 6 credits: music
  ball, // 7 ball with light rays
  sunset, // 8 sunset
  robot, // 9 robot
  room, // 10 room
  maze, // 11 maze
  tunnel, // 12 tunnel
  face, // 13 face
  ending, // 14 ending
  endPictures, // 15 end pictures
];
