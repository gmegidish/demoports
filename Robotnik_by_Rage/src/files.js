// Everything the port reads comes out of ROBOTNIK.EXE: the program image and the appended archive.
import { loadImage } from './le.js';
import { openArchive } from './archive.js';

export function openExe(exe) {
  return { exe, image: loadImage(exe), archive: openArchive(exe) };
}
