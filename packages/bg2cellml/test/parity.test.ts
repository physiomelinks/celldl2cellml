/**
 * Parity with the Python bg2cellml: every case in the reference manifest goes
 * through `Converter.celldl2cellml`, the CellML is simulated with libOpenCOR,
 * and the result is compared with the reference by variable name.
 *
 * Cases only run once they're listed in ENABLED, so the suite stays green while
 * the converter is being built. Stage 7 adds them as they start to pass.
 *
 * To see where every case stands, whatever ENABLED says:
 *
 *     BG2CELLML_PARITY=all yarn workspace @physiomelinks/bg2cellml test parity
 */

import { DOMParser } from '@xmldom/xmldom'
import createLibCellML from 'libcellml.js'
import * as oxigraph from 'oxigraph'
import { describe, expect, it } from 'vitest'

import type { LibCellML } from '@physiomelinks/cellml-units'

import { Converter } from '../src/index.js'
import { compareResults, frameworkSource, loadManifest, loadReference, readSource, type ReferenceCase } from './reference.js'
import { loadLibOpenCOR, simulate } from './simulate.js'

/** Cases that must pass. Add each one when it does. */
const ENABLED = new Set<string>([])

const RUN_ALL = process.env['BG2CELLML_PARITY'] === 'all'

const manifest = loadManifest()

let converter: Promise<Converter> | undefined

/** One converter for the whole file, made on first use so skipped cases cost nothing. */
function getConverter(): Promise<Converter> {
  converter ??= (async () => {
    const libcellml = (await createLibCellML()) as unknown as LibCellML
    const instance = new Converter({ libcellml, oxigraph, domParser: new DOMParser() as never })
    const issues = instance.loadFramework(frameworkSource(manifest))
    if (issues.length > 0) throw new Error(`Issues loading the BG-RDF framework: ${issues.join('; ')}`)
    return instance
  })()
  return converter
}

/** Convert, simulate and compare one case. An empty list means it matches. */
async function parityProblems(c: ReferenceCase): Promise<string[]> {
  const output = await (await getConverter()).celldl2cellml(readSource(c), {
    sourceUri: c.baseIri,
    rdfSource: true,
    debug: true,
  })
  if (output.exception !== undefined) return [`exception: ${output.exception}`]
  if (output.issues !== undefined && output.issues.length > 0) return output.issues.map((issue) => `issue: ${issue}`)
  if (output.cellml === undefined) return ['no CellML was generated']
  const reference = loadReference(c)
  const result = simulate(await loadLibOpenCOR(), output.cellml, reference.simulation)
  return compareResults(result, reference, manifest.tolerance)
}

describe('parity with the Python bg2cellml', () => {
  it('covers every case in the manifest: 14 examples and 3 variants', () => {
    expect(manifest.cases.filter((c) => c.kind === 'example')).toHaveLength(14)
    expect(manifest.cases.filter((c) => c.kind === 'variant')).toHaveLength(3)
    for (const name of ENABLED) expect(manifest.cases.map((c) => c.name), `ENABLED has unknown case ${name}`).toContain(name)
  })

  describe.each([
    ['examples', manifest.cases.filter((c) => c.kind === 'example')],
    ['variants, which should match their example', manifest.cases.filter((c) => c.kind === 'variant')],
  ] as const)('%s', (_group, cases) => {
    for (const c of cases) {
      const label = c.kind === 'variant' ? `${c.name} (as ${c.reference.replace(/\.json$/, '')})` : c.name
      it.skipIf(!(RUN_ALL || ENABLED.has(c.name)))(label, async () => {
        expect(await parityProblems(c)).toEqual([])
      }, 60_000)
    }
  })
})
