#!/usr/bin/env node
// The download size of the production build (run `yarn build` first), raw and
// compressed as a server would send it, against the Pyodide bundle that
// @celldl/editor-python-tools ships (about 24 MB unpacked). Prints Markdown.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const DIST = new URL('../dist/', import.meta.url).pathname
const PYODIDE_MB = 24

/** What each built file is, from its name. */
function part(file) {
  if (file.startsWith('assets/libcellml')) return 'libcellml.js (.wasm)'
  if (file.startsWith('assets/web_bg')) return 'oxigraph (.wasm)'
  if (file.startsWith('assets/data-')) return 'Page data: BG-RDF framework and cases (.js)'
  if (file.startsWith('assets/index-') && file.endsWith('.js')) return 'Converter, its packages and both modules\' glue (.js)'
  return 'Page (HTML and small chunks)'
}

function files(dir, prefix = '') {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path, `${prefix}${name}/`) : [`${prefix}${name}`]
  })
}

const sizes = new Map()
for (const file of files(DIST)) {
  const bytes = readFileSync(join(DIST, file))
  const row = sizes.get(part(file)) ?? { raw: 0, gzip: 0, brotli: 0 }
  row.raw += bytes.length
  row.gzip += gzipSync(bytes, { level: 9 }).length
  row.brotli += brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length
  sizes.set(part(file), row)
}

const mb = (bytes) => (bytes / 1e6).toFixed(2)
const sum = (rows) => rows.reduce((total, r) => ({ raw: total.raw + r.raw, gzip: total.gzip + r.gzip, brotli: total.brotli + r.brotli }), { raw: 0, gzip: 0, brotli: 0 })
const line = (name, r) => `| ${name} | ${mb(r.raw)} | ${mb(r.gzip)} | ${mb(r.brotli)} |`

const all = sum([...sizes.values()])
const converter = sum([...sizes.entries()].filter(([name]) => !name.startsWith('Page')).map(([, r]) => r))

console.log('| Part | Raw (MB) | gzip (MB) | brotli (MB) |')
console.log('|---|---:|---:|---:|')
for (const [name, row] of [...sizes.entries()].sort(([, a], [, b]) => b.raw - a.raw)) console.log(line(name, row))
console.log(line('**Converter (all but the page)**', converter))
console.log(line('**Whole page**', all))
console.log()
// Pyodide's figure is unpacked, so compare raw with raw
console.log(`The converter is ${mb(converter.raw)} MB raw against Pyodide's ${PYODIDE_MB} MB unpacked: ${((converter.raw / (PYODIDE_MB * 1e6)) * 100).toFixed(0)}% of it.`)
