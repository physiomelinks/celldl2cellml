/**
 * physiomelinks/BG-RDF's additions, in models: the saturating reaction and
 * store, the Bernoulli resistor, and transformer and gyrator nodes. The
 * models and the values checked are Finbar Argus's (BG-Tools
 * feat/constitutive-laws, tests/test_constitutive_laws.py), evaluated here
 * at the start of a libOpenCOR simulation.
 */

import { readFileSync } from 'node:fs'

import { DOMParser } from '@xmldom/xmldom'
import createLibCellML from 'libcellml.js'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import type { LibCellML, UnitSystemId } from '@physiomelinks/cellml-units'

import { BondgraphModel, Converter, type ConversionResult, type Runtime } from '../src/index.js'
import { REPO_ROOT, frameworkSource } from './reference.js'
import { loadLibOpenCOR, simulate, type LibOpenCOR } from './simulate.js'

let runtime: Runtime
let converter: Converter
let loc: LibOpenCOR

beforeAll(async () => {
  const libcellml = (await createLibCellML()) as unknown as LibCellML
  runtime = { libcellml, oxigraph, domParser: new DOMParser() as never }
  converter = new Converter(runtime)
  expect(converter.loadFramework(frameworkSource())).toEqual([])
  loc = await loadLibOpenCOR()
})

const MODELS = `${REPO_ROOT}packages/bg2cellml/test/models/`
const model = (name: string): string => readFileSync(`${MODELS}fork/${name}.ttl`, 'utf8')
const SOURCE_URI = 'https://example.org/models/fork.ttl'
/** The Chemical domain's RT. */
const RT = 2578.73058

const run = (turtle: string, unitSystem?: UnitSystemId): Promise<ConversionResult> =>
  converter.convert(turtle, { sourceUri: SOURCE_URI, rdfSource: true, ...(unitSystem === undefined ? {} : { unitSystem }) })

/** Every variable's value, and each state's rate, at the start. */
function initial(cellml: string): { values: Record<string, number>; rates: Record<string, number> } {
  const result = simulate(loc, cellml, { start: 0, end: 1e-6, steps: 1, recordedEvery: 1 })
  const first = (trajectories: Record<string, unknown[]>): Record<string, number> =>
    Object.fromEntries(Object.entries(trajectories).map(([name, values]) => [name, Number(values[0])]))
  return { values: { ...first(result.states), ...first(result.algebraics) }, rates: first(result.rates) }
}

/** The names equations define, more than once. */
function definedTwice(cellml: string): string[] {
  const left = [...cellml.matchAll(/<apply>\s*<eq\/>\s*(<ci>\s*([^<\s]+)\s*<\/ci>|<apply>\s*<diff\/>[\s\S]*?<ci>\s*([^<\s]+)\s*<\/ci>\s*<\/apply>)/g)]
  const names = left.map((match) => match[2] ?? `d/dt ${match[3]}`)
  return [...new Set(names.filter((name, i) => names.indexOf(name) !== i))]
}

describe("the fork's templates", () => {
  it('runs a saturating reaction from a chemostat, bond count 2, into a saturating store', async () => {
    const result = await run(model('saturating_reaction'))
    expect(result.ok).toBe(true)
    expect(result.modelType).toBe('ode')
    const { values, rates } = initial(result.cellml!)
    const [uA, kappa, sigma, q, K, kSat] = [1000, 0.5, 3, 0.2, 2, 0.5]
    const uB = RT * Math.log((K * q * kSat) / (kSat + q))
    const [pf, pr] = [Math.exp((2 * uA) / RT), Math.exp(uB / RT)]
    const v = (kappa * (pf - pr)) / (1 + (pf + pr) / sigma)
    // u_f_Re, 2 uA, is a computed constant, which libOpenCOR doesn't give
    expect(values['u_q_B']).toBeCloseTo(uB, 9)
    expect(values['v_Re']! / v).toBeCloseTo(1, 12)
    expect(rates['q_B']! / v).toBeCloseTo(1, 12)
    expect(Math.abs(values['v_Se_A']!) / (2 * v)).toBeCloseTo(1, 12)
    // The saturating relations' parameters are in the manifest
    expect(result.elements['Re']!.variables.find((variable) => variable.name === 'sigma_Re')?.role).toBe('parameter')
    expect(result.elements['q_B']!.variables.find((variable) => variable.name === 'k_sat_q_B')?.role).toBe('parameter')
  })

  it.each(['si', 'cellular'] as const)('runs a Bernoulli resistor between two hydraulic stores, in %s', async (system) => {
    const result = await run(model('bernoulli_resistor'), system)
    expect(result.issues).toEqual([])
    const { values, rates } = initial(result.cellml!)
    const [R, B] = [4, 1.5]
    // In Cellular, pressures are fJ/pL (Pa) and flows pL/s, so R and B are rescaled with them
    const [pressure, flow] = system === 'si' ? [1, 1] : [1e3, 1e12]
    const drop = (values['u_q_1']! - values['u_q_2']!) / pressure
    const v = values['v_R']! / flow
    expect(R * v + B * v * Math.abs(v)).toBeCloseTo(drop, 9)
    expect(rates['q_1']).toBeCloseTo(-values['v_R']!, 6)
    expect(rates['q_2']).toBeCloseTo(values['v_R']!, 6)
  })

  it('runs an electrogenic reaction through two transformer nodes, defining each variable once', async () => {
    const result = await run(model('electrogenic_reaction'))
    expect(result.ok).toBe(true)
    // Solving the transformers for their own variables keeps it an ODE
    expect(result.modelType).toBe('ode')
    expect(definedTwice(result.cellml!)).toEqual([])
    const { values, rates } = initial(result.cellml!)
    // The F of the transformers' ratios, -F/2 and 2/F, given to 9 figures
    const F = 96485.332
    const [uA, kappa, q, K, Q, C] = [1000, 0.5, 0.2, 2, -0.015, 0.1]
    const phi = Q / C
    const v = kappa * (Math.exp((uA - (F * phi) / 2) / RT) - Math.exp((RT * Math.log(K * q) + (F * phi) / 2) / RT))
    // Within 1e-6, as the ratios are given to 9 figures
    expect(Math.abs(values['v_Re']! / v - 1)).toBeLessThan(1e-6)
    expect(Math.abs(rates['q_B']! / v - 1)).toBeLessThan(1e-6)
    expect(Math.abs(rates['q_C_m']! / (F * v) - 1)).toBeLessThan(1e-6)
    expect(result.elements['TF_f']).toMatchObject({ kind: 'transform', primary: 'TF_f' })
  })

  it("leaves celldl2cellml()'s transform equations as Python writes them", async () => {
    const legacy = await converter.celldl2cellml(model('electrogenic_reaction'), { sourceUri: SOURCE_URI, rdfSource: true })
    expect(legacy.issues).toBeUndefined()
    expect(definedTwice(legacy.cellml!)).toEqual(['u_C_m', 'v_Re'])
  })

  describe('transform nodes that say what they are', () => {
    const transforms = (turtle: string): (string | undefined)[] => {
      const built = BondgraphModel.fromTurtle(converter.framework!, runtime, turtle, SOURCE_URI, { until: 'domains' })
      expect(built.log.issues).toEqual([])
      return [...built.junctions.values()].map((junction) => junction.transform)
    }
    const electrogenic = model('electrogenic_reaction')
    // example_A3's motor: a transform node between the electrical and mechanical domains
    const motor = readFileSync(`${MODELS}A3_reduced_numbers_with_units.ttl`, 'utf8')

    it('is a transformer for a TransformerNode, even between domains', () => {
      expect(transforms(electrogenic)).toEqual(['transformer', 'transformer'])
      expect(transforms(motor.replace('a bgf:TransformNode', 'a bgf:TransformerNode'))).toEqual(['transformer'])
    })

    it('is a gyrator for a GyratorNode', () => {
      expect(transforms(electrogenic.replaceAll('a bgf:TransformerNode', 'a bgf:GyratorNode'))).toEqual(['gyrator', 'gyrator'])
    })

    it('is, for a plain TransformNode, a gyrator between domains and a transformer within one', () => {
      expect(transforms(electrogenic.replaceAll('a bgf:TransformerNode', 'a bgf:TransformNode'))).toEqual(['gyrator', 'gyrator'])
      expect(transforms(motor)).toEqual(['gyrator'])
    })

    it('gives the CellML a plain TransformNode does, where it says what that is', async () => {
      const plain = await run(motor)
      const declared = await run(motor.replace('a bgf:TransformNode', 'a bgf:GyratorNode'))
      expect(plain.ok).toBe(true)
      expect(declared.cellml).toBe(plain.cellml)
    })
  })
})
