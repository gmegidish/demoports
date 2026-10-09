// The demo's files from disk, as the browser fetches them.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

export function readDemoFiles() {
  const files = { 'OUTSIDE.EXE': readFileSync(`${ROOT}OUTSIDE.EXE`) }
  for (const name of readdirSync(`${ROOT}DATA`)) {
    files[name.toUpperCase()] = readFileSync(`${ROOT}DATA/${name}`)
  }
  return files
}
