// The text screens: what main prints before mode 13h (setup and loading messages) and after the demo.
// Text goes out by BIOS teletype through DOS: characters only (the cells keep mode 3's attribute 07h), "\n" is a new
// line, and the hardware cursor follows (CRTC 0eh/0fh).
const COLUMNS = 80;
const ROWS = 25;
const CRTC_INDEX = 0x3d4;
const CRTC_CURSOR_HIGH = 0x0e;
const CRTC_CURSOR_LOW = 0x0f;

/**
 * 0x100346, 0x100394..0x1003a8: MIDAS' sound device (here the Sound Blaster 16 of the reference recording) and the
 * hint about -24, printed after the mode 3 that follows measuring the refresh rate (0x1002e7).
 */
const SETUP_TEXT = 'Using Sound Blaster series Sound Device v2.21\n'
  + 'Sound Blaster 16 (DSP v4.00+), using port 220, IRQ 7 and DMA 5\n'
  + '\nIf you want to use the VESA 2.0 320x200 TrueColor Mode instead of\n'
  + 'the slippy FakeMode, start the demo using the -24 switch!\n'
  + '\n';

/**
 * The loading messages (puts, 0x1003a8..0x1006f4) and the retrace, counted from the setup text, at which each one
 * appears in the recording: loading takes that long.
 */
const LOADING_MESSAGES = [
  [0, '\xfe Digging out music'],
  [8, '\xfe Measuring fluctuent temperature'],
  [30, '\xfe Throwing out 3d-engine'],
  [40, '\xfe Loading precalculated effects'],
  [71, '\xfe Negligating all possible optimisations'],
  [83, '\xfe Initialising CGA Head-up Display'],
  [104, '\xfe Waisting a fair bit of time'],
  [120, '\xfe Checking light wizard'],
  [132, '\xfe Fucking up animation'],
];
/** Retraces from the setup text to mode 13h. */
export const LOADING_SCREEN_RETRACES = 134;

/** 0x1009c6: the farewell, then DOS' prompt. 0x82 is é in code page 437. */
const EXIT_TEXT = 'kachk\x82is, bouneschlupp, quetschekraut an kolor\n\nC:\\>';

function cursorOf(vga) {
  return (vga.crtc[CRTC_CURSOR_HIGH] << 8) | vga.crtc[CRTC_CURSOR_LOW];
}

function setCursor(vga, cell) {
  vga.out8(CRTC_INDEX, CRTC_CURSOR_HIGH);
  vga.out8(CRTC_INDEX + 1, cell >> 8);
  vga.out8(CRTC_INDEX, CRTC_CURSOR_LOW);
  vga.out8(CRTC_INDEX + 1, cell & 0xff);
}

function scrollUp(vga) {
  const cells = vga.textScreen;
  cells.copyWithin(0, COLUMNS * 2);
  for (let i = (ROWS - 1) * COLUMNS; i < ROWS * COLUMNS; i++) {
    cells[i * 2] = 0x20;
    cells[i * 2 + 1] = 0x07;
  }
}

/** BIOS teletype output of `text` from the hardware cursor. */
export function print(vga, text) {
  let cell = cursorOf(vga);
  for (const ch of text) {
    if (ch === '\n') {
      cell = (Math.floor(cell / COLUMNS) + 1) * COLUMNS;
    } else {
      vga.textScreen[cell * 2] = ch.charCodeAt(0);
      cell++;
    }
    if (cell >= ROWS * COLUMNS) {
      scrollUp(vga);
      cell -= COLUMNS;
    }
  }
  setCursor(vga, cell);
}

/** The loading screen, from a cleared mode 3 to the moment main sets mode 13h. */
export function* printLoadingScreen(m) {
  m.vga.setMode3();
  setCursor(m.vga, 0);
  print(m.vga, SETUP_TEXT);
  let retrace = 0;
  for (const [at, message] of LOADING_MESSAGES) {
    for (; retrace < at; retrace++) {
      yield; // no retrace callbacks yet: one retrace
    }
    print(m.vga, `${message}\n`);
  }
  for (; retrace < LOADING_SCREEN_RETRACES; retrace++) {
    yield; // no retrace callbacks yet: one retrace
  }
}

/** After mode 3 (0x100985): the farewell and the DOS prompt. */
export function printExitMessage(m) {
  setCursor(m.vga, 0);
  print(m.vga, EXIT_TEXT);
}
