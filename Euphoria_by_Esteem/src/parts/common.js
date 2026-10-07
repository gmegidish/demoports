// What every part uses: the 100 Hz stamps of unit 1cbc, frame pacing, and 0000:0000 PartInit.
// A part is a generator; it yields the machine time it waits for (see machine.js).

/** 1cbc:00a7 mark(var t): a stamp of now, in ticks. */
export function mark(m) {
  return m.ticks;
}

/** 1cbc:00ce elapsed(var t): ticks since the stamp. */
export function elapsed(m, stamp) {
  return m.ticks - stamp;
}

/** 1cbc:00f3 waitUntil(var t, ticks): busy-waits until elapsed >= ticks. */
export function* waitUntil(m, stamp, ticks) {
  while (m.ticks - stamp < ticks) {
    yield m.tickTime(Math.max(m.ticks + 1, stamp + Math.ceil(ticks)));
  }
}

/** One frame of a loop that does not wait for the retrace: it costs what it cost in the reference run. */
export function* frame(m, seconds) {
  yield m.time + seconds;
}

/** 0000:0000: the start of most parts. Returns the part's start stamp (DS:a38c). */
export function partInit(m) {
  m.setClip(0, 0, m.width - 1, m.height - 1);
  m.engine.perspective = 200;
  m.engine.lightDir.update(0, 0, 0);
  return mark(m);
}

/** Measured in the reference capture: how long one frame of a CPU-bound loop took. */
export function fps(n) {
  return 1 / n;
}
