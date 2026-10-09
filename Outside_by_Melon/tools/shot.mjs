// node tools/shot.mjs OUTDIR TICK...: renders the frame shown after each timer tick to OUTDIR/tick-N.png
import { mkdirSync } from 'node:fs'
import { createDemo } from '../src/demo.js'
import { renderFrame } from '../src/screen.js'
import { writeFramePng } from './png.mjs'
import { readDemoFiles } from './files.mjs'

const [outDir, ...ticks] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const demo = createDemo(readDemoFiles())
for (const tick of ticks.map(Number).sort((a, b) => a - b)) {
  while (demo.tick < tick) {
    demo.step()
  }
  writeFramePng(`${outDir}/tick-${tick}.png`, renderFrame(demo.machine))
}
