#!/usr/bin/env node
// What each package is made of: bundle each one from its source, as an
// application's bundler would (its workspace dependencies included, libcellml.js
// and oxigraph left out as the peer dependencies they are), and write a
// rollup-plugin-visualizer treemap per package to stats/<package>.html.
// Nothing else is written. Run with `yarn stats`.

import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { visualizer } from 'rollup-plugin-visualizer'
import { build } from 'vite'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const OUT = `${ROOT}stats/`
const PACKAGES = ['math-ast', 'cellml-units', 'bg2cellml']
const PEERS = ['libcellml.js', 'oxigraph']

// Bundle every package from its TypeScript source, so the treemap shows src/ files
const alias = Object.fromEntries(PACKAGES.map((name) => [`@physiomelinks/${name}`, `${ROOT}packages/${name}/src/index.ts`]))

mkdirSync(OUT, { recursive: true })
const rows = []
for (const name of PACKAGES) {
  const output = await build({
    configFile: false,
    root: ROOT,
    logLevel: 'warn',
    resolve: { alias },
    build: {
      write: false,
      minify: true,
      lib: { entry: `${ROOT}packages/${name}/src/index.ts`, formats: ['es'], fileName: name },
      rollupOptions: { external: (id) => PEERS.some((peer) => id === peer || id.startsWith(`${peer}/`)) },
    },
    plugins: [
      visualizer({
        filename: `${OUT}${name}.html`,
        title: `@physiomelinks/${name}: bundle`,
        template: 'treemap',
        gzipSize: true,
        brotliSize: true,
        projectRoot: ROOT,
      }),
    ],
  })
  const chunks = (Array.isArray(output) ? output : [output]).flatMap((o) => o.output).filter((o) => o.type === 'chunk')
  const code = chunks.map((c) => c.code).join('')
  rows.push([name, code.length, gzipSync(code, { level: 9 }).length])
}

console.log('| Package (with its workspace dependencies, minified) | Size (kB) | gzip (kB) | Report |')
console.log('|---|---:|---:|---|')
for (const [name, raw, gzip] of rows) {
  console.log(`| @physiomelinks/${name} | ${(raw / 1000).toFixed(1)} | ${(gzip / 1000).toFixed(1)} | stats/${name}.html |`)
}
