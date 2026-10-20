/**
 * Write bg2cellml's `package.json` name and version into `src/version.ts`, as
 * `GENERATOR`. Run after `yarn changeset version`; `test/version.test.ts`
 * fails until it has been.
 */

import { readFileSync, writeFileSync } from 'node:fs'

const packageDir = new URL('../../packages/bg2cellml/', import.meta.url)
const { name, version } = JSON.parse(readFileSync(new URL('package.json', packageDir), 'utf8'))
const file = new URL('src/version.ts', packageDir)
const source = readFileSync(file, 'utf8')
if (!/export const GENERATOR = /.test(source)) throw new Error('src/version.ts has no GENERATOR')
const updated = source.replace(/export const GENERATOR = .*/, `export const GENERATOR = { name: '${name}', version: '${version}' } as const`)
if (updated === source) {
  console.log(`src/version.ts already has ${name}@${version}`)
} else {
  writeFileSync(file, updated)
  console.log(`src/version.ts now has ${name}@${version}`)
}
