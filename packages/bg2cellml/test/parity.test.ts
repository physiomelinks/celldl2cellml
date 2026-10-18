/**
 * Parity with the Python bg2cellml: every case in the reference manifest goes
 * through `Converter.celldl2cellml`, the CellML is simulated with libOpenCOR,
 * and the result is compared with the reference by variable name.
 *
 * example_A3 and example_A3_reduced aren't dimensionally consistent, so the
 * Converter gives only their units warnings (test/known-issues.ts). They must
 * give exactly those, and the CellML `generateCellML` returns with them must
 * still match Python's. Their variants with units, A3_numbers_with_units and
 * A3_reduced_numbers_with_units, are checked in the usual way (decided with
 * Hugh in 6.3).
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

import { BondgraphModel, Converter, generateCellML, type Runtime } from '../src/index.js'
import { mixedReaction } from './hand-worked.js'
import { UNITS_INCONSISTENT, expectKnownIssues } from './known-issues.js'
import { compareResults, frameworkSource, loadManifest, loadReference, readSource, type ReferenceCase, type SimulationResult } from './reference.js'
import { loadLibOpenCOR, simulate } from './simulate.js'

/** Cases that must pass. Add each one when it does. */
const ENABLED = new Set<string>([
  // 7.1: the examples
  'RCR',
  'RCR_reduced',
  'example_A1',
  'example_A1_reduced',
  'example_A2',
  'example_A2_reduced',
  'example_A3',
  'example_A3_reduced',
  'example_B1',
  'example_B1_reduced',
  'example_B2',
  'example_B2_reduced',
  'example_RC',
  'example_RC_reduced',
])

const BOND_COUNT = 'Python ignores bgf:bondCount on bonds (model.py:233); two bonds have a count of 2'

/**
 * Cases whose references are wrong because of a bug in the Python version,
 * which this version doesn't copy, and the hand-worked reference each is
 * checked against instead (test/hand-worked.ts). Their equations match the
 * patched Python's (test/equations.test.ts).
 */
const DIFFERS_FROM_PYTHON: Readonly<Record<string, { reason: string; reference: (python: SimulationResult) => SimulationResult }>> = {
  example_B2: { reason: BOND_COUNT, reference: mixedReaction },
  example_B2_reduced: { reason: BOND_COUNT, reference: mixedReaction },
}

const RUN_ALL = process.env['BG2CELLML_PARITY'] === 'all'

const manifest = loadManifest()

let converter: Promise<{ converter: Converter; runtime: Runtime }> | undefined

/** One converter for the whole file, made on first use so skipped cases cost nothing. */
function getConverter(): Promise<{ converter: Converter; runtime: Runtime }> {
  converter ??= (async () => {
    const libcellml = (await createLibCellML()) as unknown as LibCellML
    const runtime: Runtime = { libcellml, oxigraph, domParser: new DOMParser() as never }
    const instance = new Converter(runtime)
    const issues = instance.loadFramework(frameworkSource(manifest))
    if (issues.length > 0) throw new Error(`Issues loading the BG-RDF framework: ${issues.join('; ')}`)
    return { converter: instance, runtime }
  })()
  return converter
}

/**
 * The CellML for an example the Converter only gives its known units warnings
 * for, which `generateCellML` returns along with them.
 */
async function cellmlDespiteKnownIssues(c: ReferenceCase): Promise<string | undefined> {
  const { converter, runtime } = await getConverter()
  const model = BondgraphModel.fromTurtle(converter.framework!, runtime, readSource(c), c.baseIri)
  return generateCellML(runtime.libcellml, model).cellml
}

/** Convert, simulate and compare one case. An empty list means it matches. */
async function parityProblems(c: ReferenceCase): Promise<string[]> {
  const output = await (await getConverter()).converter.celldl2cellml(readSource(c), {
    sourceUri: c.baseIri,
    rdfSource: true,
    debug: true,
  })
  if (output.exception !== undefined) return [`exception: ${output.exception}`]
  let cellml = output.cellml
  if (c.name in UNITS_INCONSISTENT) {
    expectKnownIssues(c.name, output.issues ?? [])
    cellml = await cellmlDespiteKnownIssues(c)
  } else if (output.issues !== undefined && output.issues.length > 0) {
    return output.issues.map((issue) => `issue: ${issue}`)
  }
  if (cellml === undefined) return ['no CellML was generated']
  const python = loadReference(c)
  const reference = DIFFERS_FROM_PYTHON[c.name]?.reference(python) ?? python
  const result = simulate(await loadLibOpenCOR(), cellml, reference.simulation)
  return compareResults(result, reference, manifest.tolerance)
}

describe('parity with the Python bg2cellml', () => {
  it('covers every case in the manifest: 14 examples and 5 variants', () => {
    expect(manifest.cases.filter((c) => c.kind === 'example')).toHaveLength(14)
    expect(manifest.cases.filter((c) => c.kind === 'variant')).toHaveLength(5)
    for (const name of ENABLED) expect(manifest.cases.map((c) => c.name), `ENABLED has unknown case ${name}`).toContain(name)
    for (const name of Object.keys(DIFFERS_FROM_PYTHON)) expect(manifest.cases.map((c) => c.name)).toContain(name)
  })

  it.each(Object.keys(DIFFERS_FROM_PYTHON))('%s: the hand-worked reference has stoichiometry 2 where Python has 1', (name) => {
    const python = loadReference(manifest.cases.find((c) => c.name === name)!)
    const reference = DIFFERS_FROM_PYTHON[name]!.reference(python)
    // At t = 0, v = κ K q_1 (K q_2)² = 0.1 × 2 × 4 = 0.8 mol/s, where Python's is 0.1 × 2 × 2
    expect(reference.rates['q_1']![0]).toBeCloseTo(-0.8, 12)
    expect(reference.rates['q_2']![0]).toBeCloseTo(-1.6, 12)
    expect(python.rates['q_2']![0]).toBeCloseTo(-0.4, 6)
    // So the states, rates and flux all differ from Python's
    const problems = compareResults(python, reference, manifest.tolerance)
    for (const variable of ['states.q_1', 'states.q_4', 'rates.q_2', 'rates.q_3', 'algebraics.v_Re_c']) {
      expect(problems.some((p) => p.startsWith(`${variable} `)), variable).toBe(true)
    }
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
            : `${c.name} (against a hand-worked reference, as ${differs.reason})`
      it.skipIf(!(RUN_ALL || ENABLED.has(c.name)))(label, async () => {
        expect(await parityProblems(c)).toEqual([])
      }, 60_000)
    }
  })
})
