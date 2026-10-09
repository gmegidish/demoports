import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPmw1, CODE_BASE, DATA_BASE } from '../src/pmw1.js'
import { originalFiles } from './helpers.js'

const MEMORY_SIZE = 0x240000

function readString(mem, address) {
  let text = ''
  for (let a = address; mem[a] !== 0; a++) {
    text += String.fromCharCode(mem[a])
  }
  return text
}

test('both objects of OUTSIDE.EXE unpack to the sizes in the PMW1 header', () => {
  const { objects } = loadPmw1(originalFiles['OUTSIDE.EXE'], MEMORY_SIZE)
  assert.deepEqual(objects.map((o) => o.size), [0x2390d, 0x1b6733])
})

test('the entry point is the Watcom start-up code and the data holds the module name', () => {
  const { mem, eip } = loadPmw1(originalFiles['OUTSIDE.EXE'], MEMORY_SIZE)
  assert.equal(eip, CODE_BASE + 0x48e4)
  assert.equal(readString(mem, DATA_BASE + 0x40), 'data/beast_4.xm')
})

test('fixups point code at the data object', () => {
  const { mem } = loadPmw1(originalFiles['OUTSIDE.EXE'], MEMORY_SIZE)
  // 0x101ce: mov eax, offset "data/beast_4.xm"
  const operand = mem[0x101cf] | mem[0x101d0] << 8 | mem[0x101d1] << 16 | mem[0x101d2] << 24
  assert.equal(operand, DATA_BASE + 0x40)
})
