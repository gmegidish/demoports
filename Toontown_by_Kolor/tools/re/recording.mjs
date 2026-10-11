// The reference recording (DOSBox Staging, see README): tools/re/work/cap/video0004..0006.avi, the mode 13h part,
// the 320x400 part and the last mode 13h part, as one sequence of frames at 70.086 Hz. Frame 0 is the switch to
// mode 13h. Frames are decoded on demand with ffmpeg (selected by index: seeking by time lands a frame early).
import { execFileSync } from 'node:child_process';

const CAP = new URL('./work/cap/', import.meta.url).pathname;
/** [file, frames, width, height] */
export const FILES = [
  ['video0004.avi', 14233, 320, 200],
  ['video0005.avi', 1405, 320, 400],
  ['video0006.avi', 2137, 320, 200],
];

/** Which file holds recording frame `frame`, and the index in it. */
export function locate(frame) {
  let first = 0;
  for (const [file, count, width, height] of FILES) {
    if (frame < first + count) {
      return { file: CAP + file, index: frame - first, width, height };
    }
    first += count;
  }
  throw new Error(`frame ${frame} is past the recording`);
}

/** Recording frames as { frame, width, height, rgb }. */
export function recordedFrames(frames) {
  const byFile = new Map();
  for (const frame of frames) {
    const at = locate(frame);
    if (!byFile.has(at.file)) {
      byFile.set(at.file, []);
    }
    byFile.get(at.file).push({ frame, ...at });
  }
  const result = [];
  for (const [file, list] of byFile) {
    list.sort((a, b) => a.index - b.index);
    const select = list.map(({ index }) => `eq(n\\,${index})`).join('+');
    const out = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select=${select}`, '-fps_mode', 'passthrough',
      '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
    const size = list[0].width * list[0].height * 3;
    list.forEach(({ frame, width, height }, i) => {
      result.push({ frame, width, height, rgb: new Uint8Array(out.buffer, out.byteOffset + i * size, size) });
    });
  }
  return result.sort((a, b) => a.frame - b.frame);
}
