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

/**
 * Cases whose references are wrong because of a bug in the Python version,
 * which this version doesn't copy. They're expected to differ until the
 * references are regenerated from a fixed BG-Tools. Their equations match
 * the patched Python's (test/equations.test.ts).
 */
const DIFFERS_FROM_PYTHON: Readonly<Record<string, string>> = {
  example_B2: 'Python ignores bgf:bondCount on bonds (model.py:233); two bonds have a count of 2',
  example_B2_reduced: 'Python ignores bgf:bondCount on bonds (model.py:233); two bonds have a count of 2',
}

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
    for (const name of Object.keys(DIFFERS_FROM_PYTHON)) expect(manifest.cases.map((c) => c.name)).toContain(name)
  })

  describe.each([
    ['examples', manifest.cases.filter((c) => c.kind === 'example')],
    ['variants, which should match their example', manifest.cases.filter((c) => c.kind === 'variant')],
  ] as const)('%s', (_group, cases) => {
    for (const c of cases) {
      const differs = DIFFERS_FROM_PYTHON[c.name]
      const label =
        c.kind === 'variant'
          ? `${c.name} (as ${c.reference.replace(/\.json$/, '')})`
          : differs === undefined
            ? c.name
            : `${c.name} (differs from Python: ${differs})`
      it.skipIf(!(RUN_ALL || ENABLED.has(c.name)))(label, async () => {
        expect(await parityProblems(c)).toEqual([])
      }, 60_000)
    }
  })
})
