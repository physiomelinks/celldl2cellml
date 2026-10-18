/**
 * Loading the converter in a browser: oxigraph's web build, libcellml.js and
 * the BG-RDF framework.
 */

import { Converter, type Runtime } from '@physiomelinks/bg2cellml'
import type { LibCellML } from '@physiomelinks/cellml-units'
import createLibCellML from 'libcellml.js'
import initOxigraph, * as oxigraph from 'oxigraph/web.js'

import { ONTOLOGY, TEMPLATES, templateName } from './cases.js'

export interface LoadTimes {
  /** Milliseconds to fetch, compile and start each module. */
  oxigraph: number
  libcellml: number
  /** Milliseconds for `loadFramework`. */
  framework: number
}

export interface Loaded {
  converter: Converter
  frameworkIssues: string[]
  times: LoadTimes
  /** A bundled file's text, by path from the repository root. */
  bundled: (path: string) => string
}

async function timed<T>(work: () => Promise<T> | T): Promise<[T, number]> {
  const start = performance.now()
  const result = await work()
  return [result, performance.now() - start]
}

/** Load both WebAssembly modules and the bundled files (in parallel), then the BG-RDF framework. */
export async function loadConverter(): Promise<Loaded> {
  const [[, oxigraphMs], [libcellml, libcellmlMs], data] = await Promise.all([
    timed(() => initOxigraph()),
    timed(async () => (await createLibCellML()) as unknown as LibCellML),
    import('./data.js'),
  ])
  const missing = data.missingSources()
  if (missing.length > 0) throw new Error(`Not bundled: ${missing.join(', ')}`)
  const runtime: Runtime = { libcellml, oxigraph }
  const converter = new Converter(runtime)
  const templates = Object.fromEntries(TEMPLATES.map((path) => [templateName(path), data.bundled(path)]))
  const [frameworkIssues, frameworkMs] = await timed(() =>
    converter.loadFramework({ ontology: data.bundled(ONTOLOGY), templates }),
  )
  return {
    converter,
    frameworkIssues,
    times: { oxigraph: oxigraphMs, libcellml: libcellmlMs, framework: frameworkMs },
    bundled: data.bundled,
  }
}
