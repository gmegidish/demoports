import { readFileSync, writeFileSync } from 'node:fs'
import { loadPmw1 } from '../../src/pmw1.js'
const r = loadPmw1(readFileSync(process.argv[2]), 0x240000)
console.log(r.objects, r.eip.toString(16), r.esp.toString(16))
writeFileSync(process.argv[3], r.mem)
