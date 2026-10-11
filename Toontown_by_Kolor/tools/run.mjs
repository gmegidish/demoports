// Steps a demo to a recording frame: frame g is the state after g + 1 retraces from the switch to mode 13h.
export function runToRecordingFrame(demo, frame) {
  const m = demo.state.machine;
  while (m.mode13Retrace === undefined && !demo.state.isOver) {
    demo.step();
  }
  while (demo.state.vga.frameCount < m.mode13Retrace + frame + 1 && !demo.state.isOver) {
    demo.step();
  }
}
