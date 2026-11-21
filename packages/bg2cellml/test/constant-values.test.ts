/**
 * A model's own value of a domain constant (`bgf:constantValue`), such as the
 * chemical domain's `RT` at the model's temperature, replaces the template's
 * in the CellML. A model without one gives the CellML it always has.
 */

import { readFileSync } from 'node:fs'

import type { LibCellML } from '@physiomelinks/cellml-units'
import { DOMParser } from '@xmldom/xmldom'
import createLibCellML from 'libcellml.js'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import { Converter, type ConversionResult, type ConvertOptions, type Runtime } from '../src/index.js'
import { REPO_ROOT, frameworkSource } from './reference.js'
import { loadLibOpenCOR, simulate, type LibOpenCOR } from './simulate.js'

let converter: Converter
let loc: LibOpenCOR

beforeAll(async () => {
  const libcellml = (await createLibCellML()) as unknown as LibCellML
  const runtime: Runtime = { libcellml, oxigraph, domParser: new DOMParser() as never }
  converter = new Converter(runtime)
  expect(converter.loadFramework(frameworkSource())).toEqual([])
  loc = await loadLibOpenCOR()
})

const SOURCE_URI = 'https://example.org/models/constants.ttl'
/** S1 -> Rx R1 -> S2 through a voltage source, whose rates depend on RT: exp(500 J/mol / RT) times the reaction's own. */
const MODEL = readFileSync(`${REPO_ROOT}packages/bg2cellml/test/models/flows/voltage_source_forward.ttl`, 'utf8')
const TEMPLATE_RT = 2578.73058
const MODEL_RT = 2560.712

const withConstant = (value: string): string => `${MODEL}\n:model bgf:constantValue [ ${value} ] .\n`
const convert = (source: string, options: ConvertOptions = {}): Promise<ConversionResult> =>
  converter.convert(source, { sourceUri: SOURCE_URI, rdfSource: true, ...options })

/** A CellML variable's initial value. */
const initial = (cellml: string, name: string): number =>
  Number(new RegExp(`<variable name="${name}" units="\\w+" initial_value="([^"]+)"`).exec(cellml)![1])

/** The rate of change of q_S2 at the start. */
const firstRate = (cellml: string): number =>
  Number(simulate(loc, cellml, { start: 0, end: 1, steps: 100, recordedEvery: 100, relativeTolerance: 1e-10, absoluteTolerance: 1e-12 }).rates['q_S2_c']![0])

describe("a model's value of a domain constant", () => {
  it("leaves the template's RT in a model that gives none", async () => {
    const result = await convert(MODEL)
    expect(result.issues).toEqual([])
    expect(initial(result.cellml!, 'RT')).toBe(TEMPLATE_RT)
    expect(firstRate(result.cellml!)).toBeCloseTo(0.5 * (2 * Math.exp(500 / TEMPLATE_RT) - 0.2), 9)
  })

  it("writes the model's RT, and the model runs at it", async () => {
    const result = await convert(withConstant(`bgf:varName "RT" ; bgf:hasValue "${MODEL_RT} J/mol"^^cdt:ucum`))
    expect(result.issues).toEqual([])
    expect(initial(result.cellml!, 'RT')).toBe(MODEL_RT)
    // the transformer adds 500 J/mol to the forward affinity, a larger factor at the lower temperature
    expect(firstRate(result.cellml!)).toBeCloseTo(0.5 * (2 * Math.exp(500 / MODEL_RT) - 0.2), 9)
    // the other constant of the domain keeps the template's value
    expect(initial(result.cellml!, 'F')).toBe(96485)
  })

  it('takes a value in other units, and names the domain when asked', async () => {
    const result = await convert(withConstant(`bgf:varName "RT" ; bgf:forDomain bgf:Chemical ; bgf:hasValue "2.560712 kJ/mol"^^cdt:ucum`))
    expect(result.issues).toEqual([])
    expect(initial(result.cellml!, 'RT')).toBeCloseTo(MODEL_RT, 9)
  })

  it('rescales it with the unit system', async () => {
    const result = await convert(withConstant(`bgf:varName "RT" ; bgf:hasValue "${MODEL_RT} J/mol"^^cdt:ucum`), { unitSystem: 'cellular' })
    expect(result.errors).toEqual([])
    // fJ/fmol is J/mol
    expect(initial(result.cellml!, 'RT')).toBeCloseTo(MODEL_RT, 9)
  })

  it.each([
    ['a constant no domain of the model has', `bgf:varName "kT" ; bgf:hasValue "1 J/mol"^^cdt:ucum`, "constant kT, which isn't a constant of a domain of the model's elements"],
    ['a constant of another domain than the one named', `bgf:varName "RT" ; bgf:forDomain bgf:Electrical ; bgf:hasValue "1 J/mol"^^cdt:ucum`, "constant RT, which isn't a constant of"],
    ['units that are not the constant\'s', `bgf:varName "RT" ; bgf:hasValue "300 K"^^cdt:ucum`, "can't be converted to J/mol"],
    ['a value that is not a number with units', `bgf:varName "RT" ; bgf:hasValue "warm"^^cdt:ucum`, 'for constant RT of model'],
  ])('reports %s', async (_what, value, message) => {
    const result = await convert(withConstant(value))
    expect(result.ok).toBe(false)
    expect(result.errors.map((issue) => issue.message).join('\n')).toContain(message)
  })

  it('reports two values of one constant', async () => {
    const twice = `${withConstant(`bgf:varName "RT" ; bgf:hasValue "2500 J/mol"^^cdt:ucum`)}:model bgf:constantValue [ bgf:varName "RT" ; bgf:hasValue "2600 J/mol"^^cdt:ucum ] .\n`
    const result = await convert(twice)
    expect(result.ok).toBe(false)
    expect(result.errors.map((issue) => issue.message).join('\n')).toContain('gives constant RT more than one value')
  })
})
