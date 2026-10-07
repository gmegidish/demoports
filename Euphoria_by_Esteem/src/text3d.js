// Unit 1117: extruded 3D letters (1117:0000) and TText3D (1117:20e8), a group of letters.
// Notes: docs/disassembly/L6_letters.md.
import { int16 } from './machine.js';
import { PolyObject, Group } from './engine3d.js';
import { LETTERS, LETTER_WIDTHS } from './letters.js';

function corner(row, k, isMirrored) {
  return [row[3 * k], row[3 * k + 1], isMirrored ? -row[3 * k + 2] : row[3 * k + 2]];
}

/** 1117:0000 */
export function buildLetter(engine, ch, flag, minC, maxC) {
  const mesh = new PolyObject(engine, flag, minC, maxC);
  const letter = LETTERS[ch.toUpperCase()];
  if (letter) {
    const front = (row) => mesh.addQuad(corner(row, 0, false), corner(row, 1, false), corner(row, 2, false), corner(row, 3, false));
    const back = (row) => mesh.addQuad(corner(row, 2, true), corner(row, 1, true), corner(row, 0, true), corner(row, 3, true));
    if (letter.isInterleaved) {
      letter.rows.forEach((row, j) => {
        front(row);
        if (j < letter.mirrored) {
          back(row);
        }
      });
    } else {
      letter.rows.forEach(front);
      letter.rows.slice(0, letter.mirrored).forEach(back);
    }
  }
  mesh.setPivot(4, 5, 0);
  mesh.translate(-5, -5, 0);
  mesh.scaleUniform(6);
  mesh.scale(1, 1, 0.5);
  return mesh;
}

function widthOf(ch) {
  return LETTER_WIDTHS[ch.toUpperCase()] ?? 0;
}

/** 1117:20e8: the letters side by side, centred on x = 0, sorted together. */
export function buildText3d(engine, text, spacing, flag, minC, maxC) {
  const group = new Group(engine);
  group.flags = flag;
  group.minColor = minC;
  group.maxColor = maxC;
  let w = 0;
  if (text.length > 1) {
    for (const ch of text.slice(0, -1)) {
      w += widthOf(ch) + spacing;
    }
  } else {
    w = widthOf(text[0]);
  }
  let x = Math.trunc(int16(-w) / 2);
  for (const ch of text) {
    const letter = buildLetter(engine, ch, flag, minC, maxC);
    letter.translate(x, 0, 0);
    x = int16(x + widthOf(ch) + spacing);
    group.addMesh(letter);
  }
  return group;
}
