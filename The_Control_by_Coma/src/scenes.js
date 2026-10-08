// The scene functions: called by the 30 Hz timer from the timeline tables 0x17ce0 (part 1) and 0xf2d0
// (part 2), keyed here by their original address. They install the per-frame effect in [0x52185] and
// advance the animation counters with byte-carry chains. Notes: docs/disassembly/C1_core.md §6, §7.
import { setPaletteFade } from './helpers.js';

const EFFECT = 0x52185;

/** TEX scroll u/v and the sine phase of the starburst, common to the part-1 scenes. */
function advanceStarburst(m) {
  m.addByte(0x5224a, 0, m.addByte(0x522f7, 0xbe));
  m.addByte(0x5224b, 1);
  m.addByte(0x56077, 0, m.addByte(0x522f8, 0x64));
}

/** ADV(r): a new frame of the current animation each time the byte accumulator wraps. */
function advanceAnimation(m, rate) {
  if (m.addByte(0x53f8a, rate)) {
    m.set32(0x28980, m.u32(0x28989));
  }
}

/** VIDEO(r): the 160x100 video's frame, 60 frames, looping. */
function advanceVideo(m, rate, carryIn = 0) {
  const carry = m.addByte(0x53f8a, rate, carryIn);
  let frame = m.u32(0x28b25) + carry;
  if (frame >= 0x3c) {
    frame = 0;
  }
  m.set32(0x28b25, frame);
}

/** [0x53f8a] -= rate; grain level [0x53810] -= borrow, optionally floored at 0. */
function increaseGrain(m, rate, isFloored) {
  m.subByte(0x53810, 0, m.subByte(0x53f8a, rate));
  if (isFloored && m.u8(0x53810) & 0x80) {
    m.set8(0x53810, 0);
  }
}

/** The mode-X scroller position: [0x54e77] += rate, and on carry [0x1bdd4] += step, wrapped at `limit`. */
function advanceScroller(m, rate, step, limit) {
  if (m.addByte(0x54e77, rate)) {
    let position = m.u32(0x1bdd4) + step;
    if (position >= limit) {
      position = 0;
    }
    m.set32(0x1bdd4, position);
  }
}

function setEffect(m, address) {
  m.set32(EFFECT, address);
}

function nameScene(nameAddress) {
  return (m) => {
    setEffect(m, 0x52441);
    m.set32(0x1baa7, nameAddress);
    advanceStarburst(m);
  };
}

function captionScene(captionOffset) {
  return (m) => {
    m.set32(0x5426f, captionOffset);
    setEffect(m, 0x54273);
    advanceVideo(m, 0x28);
  };
}

function objectsScene(effect) {
  return (m) => {
    setEffect(m, effect);
    advanceAnimation(m, 0x78);
  };
}

export const SCENES = {
  // ---- part 1 ----
  0x522f9(m) {
    setEffect(m, 0x52343);
    advanceStarburst(m);
    m.subByte(0x522f5, 0, m.addByte(0x522f6, 0x3c));
    if (m.u8(0x522f5) & 0x80) {
      m.set8(0x522f5, 0);
    }
    setPaletteFade(m);
  },
  0x523f2: nameScene(0x5242a),
  0x5247a: nameScene(0x5242f),
  0x524b2: nameScene(0x52435),
  0x524ea: nameScene(0x5243a),
  0x52522(m) {
    setEffect(m, 0x52577);
    m.addByte(0x2d45c, 2);
    m.addByte(0x2d460, 1);
    m.addByte(0x2d458, 0xff);
    m.set32(0x2d448, m.u32(0x2d448) + 2);
    m.set32(0x2d450, m.u32(0x2d450) + 0x96);
    advanceStarburst(m);
  },
  0x525f2(m) {
    setEffect(m, 0x5264a);
    m.set32(0x2d458, 0x3a);
    m.set32(0x2d460, 0xc);
    m.addByte(0x2d45c, 2);
    m.set32(0x2d450, m.u32(0x2d450) + 0x3c);
    m.set32(0x2d448, m.u32(0x2d448) - 1);
    advanceStarburst(m);
  },
  0x5269e(m) {
    setEffect(m, 0x526f0);
    m.set8(0x2d458, 0x44);
    m.set8(0x2d45c, 4);
    m.addByte(0x2d460, 2);
    m.set32(0x2d450, m.u32(0x2d450) + 0x32);
    advanceStarburst(m);
    m.set32(0x2d448, m.u32(0x2d448) + 1);
  },
  0x52744(m) {
    setEffect(m, 0x5277b);
    advanceStarburst(m);
  },
  0x527de(m) {
    setEffect(m, 0x5282e);
    advanceStarburst(m);
    increaseGrain(m, 0x28, true);
  },
  0x5288c(m) {
    setEffect(m, 0x528b2);
  },

  // ---- part 2 ----
  0x53f8b(m) {
    setEffect(m, 0x53fb0);
    increaseGrain(m, 0x64, false);
  },
  0x53fe9(m) {
    setEffect(m, 0x54043);
    const carry = m.addByte(0x2d458, 0xfd);
    m.addByte(0x2d45c, 1, carry);
    m.addByte(0x2d460, 2);
  },
  0x53fa4(m) {
    setEffect(m, 0x53fb0);
  },
  0x5409a(m) {
    setEffect(m, 0x540ca);
    advanceVideo(m, 0x3c);
  },
  0x540e7: captionScene(0),
  0x540f3: captionScene(0x19),
  0x540ff: captionScene(0x32),
  0x5410b: captionScene(0x4b),
  0x54117: captionScene(0x64),
  0x54123: captionScene(0x96),
  0x5412f: captionScene(0xaf),
  0x5413b: captionScene(0xc8),
  0x542d0(m) {
    setEffect(m, 0x54314);
    advanceAnimation(m, 0x32);
    m.addByte(0x2d460, 0xfe);
    m.addByte(0x542fc, 5);
  },
  0x543bf(m) {
    setEffect(m, 0x54456);
    m.addByte(0x2d460, 0xfe);
    m.addByte(0x542fc, 5);
  },
  0x544c0(m) {
    setEffect(m, 0x54507);
    advanceAnimation(m, 0x64);
  },
  0x54575(m) {
    SCENES[0x54591](m);
  },
  0x54591(m) {
    setEffect(m, 0x545bd);
    m.addByte(0x5224a, 3);
    m.addByte(0x5224b, 0xff);
    m.addByte(0x56077, 2);
    m.set32(0x542fc, m.u32(0x542fc) + 0xa);
  },
  0x5466a(m) {
    setEffect(m, 0x546b3);
    advanceAnimation(m, 0x32);
  },
  0x54777(m) {
    setEffect(m, 0x5486d);
    m.addByte(0x54766, 4);
    m.addByte(0x5476a, 0xfd);
    m.addByte(0x5475e, 5);
    m.addByte(0x54762, 1);
    m.set8(0x53810, 0x0a);
  },
  0x54911(m) {
    setEffect(m, 0x54a2c);
    m.addByte(0x54766, 0xfe);
    m.addByte(0x5476a, 1);
    m.addByte(0x5475e, 0x41);
    m.addByte(0x54762, 2);
  },
  0x55bc7(m) {
    setEffect(m, 0x55be8);
    m.addByte(0x2d458, 1);
    m.addByte(0x2d460, 0xff);
    m.addByte(0x2d45c, 1);
  },
  0x54e78(m) {
    setEffect(m, 0x54ec3);
    advanceAnimation(m, 0xc8);
    advanceScroller(m, 0x1e, 0x10, 0x1b0);
    m.set8(0x1b7ff, 0);
  },
  0x54f41(m) {
    setEffect(m, 0x54f64);
    increaseGrain(m, 0xc8, true);
  },
  0x55032(m) {
    setEffect(m, 0x5506b);
    m.addByte(0x5224a, 0xff);
    m.addByte(0x5224b, 1);
    m.addByte(0x55119, 1);
    m.addByte(0x5511a, 0xff);
  },
  0x55202(m) {
    setEffect(m, 0x55232);
    m.addByte(0x5224a, 1);
    m.addByte(0x5224b, 1);
    m.addByte(0x55119, 2);
    m.addByte(0x5511a, 1);
  },
  0x552ae(m) {
    setEffect(m, 0x552f4);
    advanceAnimation(m, 0x50);
    if (m.addByte(0x54e77, 0x28)) {
      const position = m.u32(0x1bdd4) + 0x12;
      m.set32(0x1bdd4, position);
      if (position < 0x5a) {
        m.set8(0x1b7ff, 0);
      } else {
        m.set32(0x1bdd4, 0);
      }
    }
  },
  0x5537c(m) {
    setEffect(m, 0x5539b);
    advanceAnimation(m, 0x50);
  },
  0x5540a(m) {
    setEffect(m, 0x5543c);
    advanceScroller(m, 0x50, 0x10, 0x160);
  },
  0x55529(m) {
    setEffect(m, 0x5558a);
    // The timer enters scene functions with CF set: this adc adds 0x65.
    advanceVideo(m, 0x64, 1);
  },
  0x555fb: objectsScene(0x55621),
  0x556cf: objectsScene(0x556ee),
  0x5578d: objectsScene(0x557ac),
  0x55c35: objectsScene(0x55c6d),
  0x55d31: objectsScene(0x55d69),
  0x55e12: objectsScene(0x55e3d),
  0x5584b(m) {
    setEffect(m, 0x55b6c);
    m.addByte(0x2d458, 1);
    m.addByte(0x2d460, 0xfe);
    m.addByte(0x2d45c, 1);
  },
  0x55ef6(m) {
    setEffect(m, 0x55f1e);
    m.addByte(0x2d458, 2);
    m.addByte(0x2d460, 0xfd);
    m.addByte(0x2d45c, 0xfd);
    m.addByte(0x55ef2, 6);
  },
  0x55f77(m) {
    setEffect(m, 0x55fa4);
    m.set8(0x1b7ff, 0);
    advanceAnimation(m, 0x1c);
    m.set8(0x55f1d, 0);
  },
  0x56012(m) {
    setEffect(m, 0x56021);
  },
};
