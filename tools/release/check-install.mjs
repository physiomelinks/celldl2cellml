#!/usr/bin/env node
// Install the three packages into an empty npm project, as a user would, and
// use them: convert BG-RDF's example_RC in Node, and typecheck a TypeScript
// file against their declarations (work plan chunk 8.2's "done when").
//
//   node tools/release/check-install.mjs --packed          # `yarn pack` each package first (before publishing)
//   node tools/release/check-install.mjs --version 0.1.0   # from the npm registry (after publishing)
//
// Run `yarn build` first for --packed. The project is made in a temporary
// directory, removed afterwards unless --keep is given.

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PACKAGES = ['math-ast', 'cellml-units', 'bg2cellml']

const { values } = parseArgs({
  options: { packed: { type: 'boolean' }, version: { type: 'string' }, keep: { type: 'boolean' } },
})
if (values.packed === (values.version !== undefined)) {
  console.error('Give either --packed or --version <version>')
  process.exit(2)
}

const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' })
const manifest = (name) => JSON.parse(readFileSync(join(ROOT, 'packages', name, 'package.json'), 'utf8'))

const dir = mkdtempSync(join(tmpdir(), 'bg2cellml-install-'))
console.log(`Empty project in ${dir}`)
try {
  // What to install: the packages, and bg2cellml's peer dependencies at the ranges it asks for
  let specs
  if (values.packed) {
    specs = PACKAGES.map((name) => {
      const tarball = join(dir, `${name}.tgz`)
      run('yarn', ['pack', '--out', tarball], join(ROOT, 'packages', name))
      return tarball
    })
  } else {
    specs = PACKAGES.map((name) => `@physiomelinks/${name}@${values.version}`)
  }
  const peers = Object.entries(manifest('bg2cellml').peerDependencies).map(([name, range]) => `${name}@${range}`)

  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'empty', private: true, type: 'module' }, null, 2)}\n`)
  run('npm', ['install', '--no-audit', '--no-fund', ...specs, ...peers, '@xmldom/xmldom'], dir)
  run('npm', ['install', '--no-audit', '--no-fund', '--save-dev', 'typescript@^5.9.3'], dir)

  // No workspace: ranges may survive into the installed packages
  for (const name of PACKAGES) {
    const installed = readFileSync(join(dir, 'node_modules', '@physiomelinks', name, 'package.json'), 'utf8')
    if (installed.includes('workspace:')) throw new Error(`@physiomelinks/${name} was published with a workspace: range`)
  }

  // Use them from JavaScript, in Node
  writeFileSync(
    join(dir, 'check.mjs'),
    `import { readFileSync } from 'node:fs'
import { Converter } from '@physiomelinks/bg2cellml'
import { unitsName } from '@physiomelinks/cellml-units'
import { parseMathML, toEquations } from '@physiomelinks/math-ast'
import { DOMParser } from '@xmldom/xmldom'
import createLibCellML from 'libcellml.js'
import * as oxigraph from 'oxigraph'

const bgRdf = ${JSON.stringify(join(ROOT, 'bg-rdf'))}
const read = (path) => readFileSync(\`\${bgRdf}/\${path}\`, 'utf8')

if (unitsName('mol/s') !== 'mol_per_s') throw new Error('cellml-units: unitsName')
const relation = '<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>v</ci><apply><divide/><ci>u</ci><ci>R</ci></apply></apply></math>'
if (toEquations(parseMathML(relation, { domParser: new DOMParser() })).length !== 1) throw new Error('math-ast: parseMathML')

const converter = new Converter({ libcellml: await createLibCellML(), oxigraph, domParser: new DOMParser() })
const templates = Object.fromEntries(['chemical', 'electrical', 'hydraulic', 'mechanical'].map((t) => [\`\${t}.ttl\`, read(\`templates/\${t}.ttl\`)]))
const frameworkIssues = converter.loadFramework({ ontology: read('schema/ontology.ttl'), templates })
if (frameworkIssues.length > 0) throw new Error(frameworkIssues.join('\\n'))
const output = await converter.celldl2cellml(read('examples/example_RC.ttl'), {
  sourceUri: 'https://example.org/example_RC.ttl',
  rdfSource: true,
  metadata: true,
})
if (output.cellml === undefined || !output.cellml.includes('<model') || output.metadata === undefined) {
  throw new Error(\`bg2cellml: \${JSON.stringify(output, null, 2)}\`)
}
console.log(\`Converted example_RC: \${output.cellml.length} characters of CellML\`)
`,
  )
  run('node', ['check.mjs'], dir)

  // Use them from TypeScript: their declarations must resolve and agree
  writeFileSync(
    join(dir, 'check.ts'),
    `import { Converter, type CellMLOutput, type Runtime } from '@physiomelinks/bg2cellml'
import { unitsName, type LibCellML } from '@physiomelinks/cellml-units'
import { parseMathML, toMathML } from '@physiomelinks/math-ast'
import * as oxigraph from 'oxigraph'

export async function convert(libcellml: LibCellML, source: string): Promise<CellMLOutput> {
  const runtime: Runtime = { libcellml, oxigraph }
  const converter = new Converter(runtime)
  return converter.celldl2cellml(source, { sourceUri: 'https://example.org/model.celldl' })
}

export const name: string = unitsName('mol/s')
export const written: string = toMathML(parseMathML('<math xmlns="http://www.w3.org/1998/Math/MathML"><ci>x</ci></math>'))
`,
  )
  writeFileSync(
    join(dir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          lib: ['ES2022', 'DOM'],
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
        },
        files: ['check.ts'],
      },
      null,
      2,
    )}\n`,
  )
  // Our declarations are checked too (no skipLibCheck). oxigraph 0.5's own node.d.ts doesn't pass that check
  // (UInt8Array for Uint8Array, a declaration without `declare`), so its errors alone are let through.
  const tsc = spawnSync('npx', ['tsc', '-p', 'tsconfig.json'], { cwd: dir, encoding: 'utf8' })
  const errors = `${tsc.stdout}${tsc.stderr}`.split('\n').filter((line) => /error TS\d+/.test(line))
  const ours = errors.filter((line) => !line.startsWith('node_modules/oxigraph/'))
  if (errors.length > ours.length) console.log(`Ignoring ${errors.length - ours.length} errors in oxigraph's own declarations`)
  if (ours.length > 0 || (tsc.status !== 0 && errors.length === 0)) {
    throw new Error(`TypeScript check failed:\n${ours.join('\n') || tsc.stdout + tsc.stderr}`)
  }
  console.log('check.ts typechecks against the packages\' declarations')

  console.log(`The packages install into an empty project and work, from ${values.packed ? 'packed tarballs' : `npm (${values.version})`}.`)
} finally {
  if (values.keep) console.log(`Kept ${dir}`)
  else rmSync(dir, { recursive: true, force: true })
}
