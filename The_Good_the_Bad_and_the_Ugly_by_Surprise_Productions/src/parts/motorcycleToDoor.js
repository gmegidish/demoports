// Main script 0000:0703..072c (docs/disassembly/G6_greets_tunnel_city.md, section 3): the motorcycle picture, the
// "Surprise!" pattern with the transforming objects, the contour city and the rotating door, one generator.
import { loadCityResources, motorcycle, freeCityResources } from './motorcycle.js';
import { showPages } from './surprisePages.js';
import { transformingObjects, contourCity } from './morphAndCity.js';
import { rotatingDoor } from './rotatingDoor.js';

/** 0710 / 0722: the page-cycle loops' cx. */
const PATTERN_FADE_PAGES = 0x96;
const CITY_PAUSE_PAGES = 0x32;


/** 0703 08d8:396c, 0708 3041, 0710 346a, 0715 35f6, 071a 39d4, 0722 346a, 0727 3e3a, 072c 39b1. */
export function* motorcycleToDoor(m) {
  loadCityResources(m); // the disk loads take less than a retrace in the recording
  yield* motorcycle(m);
  yield* showPages(m, PATTERN_FADE_PAGES);
  yield* transformingObjects(m);
  yield* contourCity(m);
  yield* showPages(m, CITY_PAUSE_PAGES);
  yield* rotatingDoor(m);
  freeCityResources(m);
}
