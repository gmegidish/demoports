// 0e5a:01ab LoadASC(N, mesh): a 3D Studio ASCII export into a polygon object. Every face is a
// quad with the last vertex repeated. Notes: L5_units.md "0e5a shared helpers".
import { f32 } from './machine.js';
import { Pixel } from './engine3d.js';

function wordsOf(line) {
  return line.trim().split(/\s+/).map((w) => w.toUpperCase());
}

/** The value after the next colon: "X: -12.5" -> -12.5. */
function valuesAfterColons(line) {
  return line.split(':').slice(2).map((part) => parseFloat(part.trim().split(/\s+/)[0]));
}

/** "A:12" -> 13 (1-based vertex number). */
function vertexNumber(word) {
  return parseInt(word.slice(2), 10) + 1;
}

export function loadAsc(m, resourceNumber, mesh) {
  const text = new TextDecoder('latin1').decode(m.resources[resourceNumber - 1]);
  const vertices = [null];
  for (const rawLine of text.split('\r\n')) {
    const line = rawLine.replace(/[\x00-\x1f]/g, '');
    const words = wordsOf(line);
    if (words[0] === 'VERTEX' && words[1] && !words[1].startsWith('LIST')) {
      const [x, y, z] = valuesAfterColons(line);
      const v = new Pixel(f32(x), f32(y), f32(z), 0);
      vertices.push(v);
      mesh.append(v);
    }
    if (words[0] === 'FACE' && words[1] && !words[1].startsWith('LIST')) {
      const [a, b, c] = words.slice(2, 5).map(vertexNumber);
      const face = mesh.newFace();
      face.setVertices(vertices[a], vertices[b], vertices[c], vertices[c]);
      face.items = [vertices[a], vertices[b], vertices[c]];
      mesh.faces.push(face);
      face.color = mesh.nextColor;
      mesh.nextColor = (mesh.nextColor + mesh.colorStep) & 0xff;
    }
  }
}
