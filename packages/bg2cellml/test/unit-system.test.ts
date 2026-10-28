/**
 * Unit systems: a model built in Cellular units (fmol, pL, fJ, fC) has its
 * CellML variables in those units, stays consistent for libCellML's Analyser,
 * and simulates as the same model in SI. A model in SI, or with no unit
 * system, gives the CellML it always has.
 */

import { readFileSync } from 'node:fs'

import { UNIT_SYSTEMS, type LibCellML, type UnitSystemId } from '@physiomelinks/cellml-units'
import { toMathML, variables, type NumberNode } from '@physiomelinks/math-ast'
import { DOMParser } from '@xmldom/xmldom'
import createLibCellML from 'libcellml.js'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  BondgraphFramework,
  Converter,
  IssueLog,
  UNIT_SYSTEM_IRIS,
  UNIT_SYSTEM_PREDICATE,
  UnitsDefinitions,
  VOI_NAME,
  VOI_UNITS,
  checkCellMLModel,
  type ConversionResult,
  type ConvertOptions,
  type ElementTemplate,
  type Runtime,
} from '../src/index.js'
import { CONVERT_UNITS_INCONSISTENT, expectKnownIssues } from './known-issues.js'
import { frameworkSource, loadManifest, readSource, type ReferenceCase } from './reference.js'
import { loadLibOpenCOR, simulate, type LibOpenCOR } from './simulate.js'

const manifest = loadManifest()
const examples = manifest.cases.filter((c) => c.kind === 'example')
const caseNamed = (name: string): ReferenceCase => manifest.cases.find((c) => c.name === name)!
const PHLYNX_UNITS = readFileSync(new URL('./models/phlynx_user_units.cellml', import.meta.url), 'utf8')
const PRESETS = [...UNIT_SYSTEMS.keys()]

let libcellml: LibCellML
let converter: Converter
let loc: LibOpenCOR

beforeAll(async () => {
  libcellml = (await createLibCellML()) as unknown as LibCellML
  const runtime: Runtime = { libcellml, oxigraph, domParser: new DOMParser() as never }
  converter = new Converter(runtime)
  expect(converter.loadFramework(frameworkSource(manifest))).toEqual([])
  loc = await loadLibOpenCOR()
})

const convert = (c: ReferenceCase, options: ConvertOptions = {}, source = readSource(c)): Promise<ConversionResult> =>
  converter.convert(source, { sourceUri: c.baseIri, rdfSource: true, ...options })

/** A case's source with `pml:unitSystem` on its model. */
function withTriple(c: ReferenceCase, object: string, source = readSource(c)): string {
  const model = /^(:\w+)\s+a bgf:BondgraphModel/m.exec(source)![1]!
  return `${source}\n${model} <${UNIT_SYSTEM_PREDICATE}> ${object} .\n`
}

/** Each CellML variable's units and initial value, by name. */
function cellmlVariables(cellml: string): Record<string, { units: string; value?: number }> {
  const found: Record<string, { units: string; value?: number }> = {}
  for (const [, name, units, value] of cellml.matchAll(/<variable name="(\w+)" units="(\w+)"(?: initial_value="([^"]+)")?/g)) {
    found[name!] = { units: units!, ...(value === undefined ? {} : { value: Number(value) }) }
  }
  return found
}

const messages = (result: ConversionResult): string[] => result.issues.map((issue) => issue.message)

//==============================================================================

describe('SI', () => {
  it.each(examples.map((c) => [c.name, c] as const))('%s converts the same with no system, SI, or pml:SI', async (_name, c) => {
    const stock = await convert(c)
    expect(stock.unitSystem).toBe('si')
    const si = await convert(c, { unitSystem: 'si' })
    const triple = await convert(c, {}, withTriple(c, `<${UNIT_SYSTEM_IRIS.si}>`))
    for (const result of [si, triple]) {
      expect(result.cellml).toBe(stock.cellml)
      expect(messages(result)).toEqual(messages(stock))
    }
  })
})

describe('reading the unit system', () => {
  const b1 = caseNamed('example_B1')

  it("builds in the model's pml:unitSystem", async () => {
    const result = await convert(b1, {}, withTriple(b1, `<${UNIT_SYSTEM_IRIS.cellular}>`))
    expect(result.ok).toBe(true)
    expect(result.unitSystem).toBe('cellular')
    expect(cellmlVariables(result.cellml!)['q_1']).toEqual({ units: 'fmol', value: 1e15 })
  })

  it('lets the option override the triple', async () => {
    const result = await convert(b1, { unitSystem: 'si' }, withTriple(b1, `<${UNIT_SYSTEM_IRIS.cellular}>`))
    expect(result.unitSystem).toBe('si')
    expect(result.cellml).toBe((await convert(b1)).cellml)
  })

  it('reports an unknown option, IRI or literal, and more than one system', async () => {
    const option = await convert(b1, { unitSystem: 'metric' as UnitSystemId })
    expect(option.ok).toBe(false)
    expect(option.unitSystem).toBeUndefined()
    expect(option.errors).toMatchObject([{ stage: 'input', message: 'Unknown unit system "metric": use "si" or "cellular"' }])

    const iri = await convert(b1, {}, withTriple(b1, '<https://example.org/Metric>'))
    expect(iri.errors).toMatchObject([{ stage: 'units', message: expect.stringMatching(/unknown unit system <https:\/\/example.org\/Metric>: use </) }])

    const literal = await convert(b1, {}, withTriple(b1, '"cellular"'))
    expect(literal.errors).toMatchObject([{ stage: 'units', message: expect.stringMatching(/unknown unit system "cellular"/) }])

    const both = await convert(b1, {}, withTriple(b1, `<${UNIT_SYSTEM_IRIS.si}>, <${UNIT_SYSTEM_IRIS.cellular}>`))
    expect(both.errors).toMatchObject([{ message: expect.stringMatching(/has more than one <https:\/\/physiomelinks/) }])
  })
})

describe('Cellular', () => {
  const b1 = caseNamed('example_B1')
  /** example_B1 with its values in fmol. */
  const b1Fmol = readSource(b1).replaceAll(' mol"', ' fmol"').replaceAll(' mol-1"', ' fmol-1"').replaceAll(' mol/s"', ' fmol/s"')

  it('writes example_B1 in fmol, with RT and F as they are and names from the PhLynx units', async () => {
    const result = await convert(b1, { unitSystem: 'cellular', knownUnits: PHLYNX_UNITS }, b1Fmol)
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.units.renamed).toEqual({})
    const found = cellmlVariables(result.cellml!)
    expect(found).toMatchObject({
      RT: { units: 'J_per_mol', value: 2578.73058 },
      F: { units: 'C_per_mol', value: 96485 },
      q_1: { units: 'fmol', value: 1 },
      K_q_1: { units: 'per_fmol', value: 1 },
      kappa_r: { units: 'fmol_per_s', value: 0.1 },
      v_Re_r: { units: 'fmol_per_s' },
      u_1: { units: 'J_per_mol' },
    })
    // The scaled units are PhLynx's own, and equivalent to them, as nothing was renamed
    for (const name of ['fmol', 'per_fmol', 'fmol_per_s']) expect(PHLYNX_UNITS, name).toContain(`<units name="${name}">`)
  })

  it('simulates example_B1 in fmol as SI does in mol', async () => {
    const settings = { start: 0, end: 10, steps: 1000, recordedEvery: 100, relativeTolerance: 1e-7, absoluteTolerance: 1e-7 }
    const si = simulate(loc, (await convert(b1)).cellml!, settings)
    const cellular = simulate(loc, (await convert(b1, { unitSystem: 'cellular' }, b1Fmol)).cellml!, settings)
    const expected = 0.5 + 0.5 * Math.exp(-2)
    expect(cellular.states['q_1']!.at(-1)).toBeCloseTo(expected, 5)
    expect(si.states['q_1']!.at(-1)).toBeCloseTo(expected, 5)
    for (const [index, value] of si.states['q_2']!.entries()) expect(cellular.states['q_2']![index]).toBeCloseTo(value as number, 9)
  })

  it('converts values given in mol, and plain numbers are in fmol', async () => {
    const molar = cellmlVariables((await convert(b1, { unitSystem: 'cellular' })).cellml!)
    expect(molar['q_1']).toEqual({ units: 'fmol', value: 1e15 })
    expect(molar['K_q_1']).toEqual({ units: 'per_fmol', value: 1e-15 })
    expect(molar['kappa_r']).toEqual({ units: 'fmol_per_s', value: 1e14 })

    const plain = readSource(b1).replace('"1 mol"^^cdt:ucum', '5').replace('"0.1 mol/s"^^cdt:ucum', '0.25')
    expect(cellmlVariables((await convert(b1, { unitSystem: 'cellular' }, plain)).cellml!)).toMatchObject({
      q_1: { units: 'fmol', value: 5 },
      kappa_r: { units: 'fmol_per_s', value: 0.25 },
    })
  })

  it.each(examples.map((c) => [c.name, c] as const))('%s has no new issues', async (name, c) => {
    const result = await convert(c, { unitSystem: 'cellular', knownUnits: PHLYNX_UNITS })
    expect(result.unitSystem).toBe('cellular')
    expect(result.cellml).toBeDefined()
    expectKnownIssues(name, messages(result).filter((message) => !message.startsWith('Units ')), CONVERT_UNITS_INCONSISTENT)
  })
})

describe("a source's MathML", () => {
  /** A chemical store filled by a flow source whose MathML is `relation`. */
  const filled = (relation: string, source = 'ChemicalFlow', store = 'ChemicalConcentration', parameter = '"K" ; bgf:hasValue "1 fmol-1"^^cdt:ucum') => `
@prefix bgf: <https://bg-rdf.org/ontologies/bondgraph-framework#> .
@prefix cdt: <https://w3id.org/cdt/> .
@prefix : <#> .
:m a bgf:BondgraphModel ; bgf:hasBondElement :q, :f ; bgf:hasJunctionStructure :u .
:q a bgf:${store} ; bgf:hasValue "0 fmol"^^cdt:ucum ; bgf:parameterValue [ bgf:varName ${parameter} ] .
:f a bgf:${source} ; bgf:hasValue """<math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:bgf="https://bg-rdf.org/ontologies/bondgraph-framework#">
  <apply><eq/><ci>v</ci>${relation}</apply></math>"""^^bgf:mathml .
:u a bgf:ZeroNode .
:f.u bgf:hasSource :f ; bgf:hasTarget :u .
:u.q bgf:hasSource :u ; bgf:hasTarget :q .
`
  const run = (source: string): Promise<ConversionResult> =>
    converter.convert(source, { sourceUri: 'https://example.org/filled.ttl', rdfSource: true, unitSystem: 'cellular' })

  it('has its numbers with units rescaled, keeping their values', async () => {
    const result = await run(filled('<cn bgf:units="mol/s">2</cn>'))
    expect(result.issues).toEqual([])
    expect(result.cellml).toMatch(/<cn cellml:units="fmol_per_s">2000000000000000<\/cn>/)
    const unchanged = await run(filled('<apply><times/><cn bgf:units="mmol/L">2</cn><cn bgf:units="pL/s">3</cn></apply>'))
    expect(unchanged.issues).toEqual([])
    expect(unchanged.cellml).toMatch(/<cn cellml:units="mmol_per_L">2<\/cn>/)
  })

  it("reports numbers in units Cellular can't rescale", async () => {
    const source = filled('<cn bgf:units="A">2</cn>', 'CurrentSource', 'ElectricalCapacitor', '"C" ; bgf:hasValue "1 fC2/fJ"^^cdt:ucum').replace('"0 fmol"', '"0 fC"')
    const result = await run(source)
    expect(result.ok).toBe(false)
    expect(result.errors).toMatchObject([{ stage: 'units', elementId: 'f', message: expect.stringMatching(/"A" in "A" can't be rescaled/) }])
  })
})

//==============================================================================

/**
 * The framework's self-test: each template's constitutive relation, on its
 * own in a CellML model with its variables in the template's units, gives no
 * Validator or Analyser issues in each preset. Variables not on a left side
 * get an initial value, as do states.
 */
describe('every template, in every preset', () => {
  const cases = (): [string, UnitSystemId, ElementTemplate][] => {
    const stock = converter.framework!
    return PRESETS.flatMap((id) => {
      const framework: BondgraphFramework = stock.withUnitSystem(id)
      expect(framework.log.issues).toEqual([])
      expect(framework.elementTemplates.size).toBe(stock.elementTemplates.size)
      return [...framework.elementTemplates.values()]
        .filter((template) => template.constitutiveRelation !== undefined)
        .map((template): [string, UnitSystemId, ElementTemplate] => [`${template.iri.split('#')[1]} in ${id}`, id, template])
    })
  }

  it('covers every template with a relation, in both presets', () => {
    expect(cases().length).toBe(2 * [...converter.framework!.elementTemplates.values()].filter((t) => t.constitutiveRelation).length)
  })

  it('is clean for every template', () => {
    const failures: string[] = []
    for (const [label, , template] of cases()) {
      const issues = relationIssues(template)
      if (issues.length > 0) failures.push(`${label}: ${issues.join('; ')}`)
    }
    expect(failures).toEqual([])
  })

  it('catches a template rescaled other than uniformly', () => {
    const store = converter.framework!.withUnitSystem('cellular').elementTemplates.get('https://bg-rdf.org/ontologies/bondgraph-framework#ChemicalConcentration')!
    // Only the quantity in fmol, as in the proposal's convert-mixed.mjs
    const flow = { ...store.domain.flow, units: 'mol/s' }
    const ports = new Map([...store.ports].map(([id, port]) => [id, { ...port, flow }]))
    const mixed = { ...store, ports, domain: { ...store.domain, flow } }
    expect(relationIssues(store)).toEqual([])
    expect(relationIssues(mixed)).toEqual([expect.stringMatching(/are not equivalent/)])
  })

  it('rescales the Cellular templates uniformly', () => {
    const cellular = converter.framework!.withUnitSystem('cellular')
    const reaction = cellular.elementTemplates.get('https://bg-rdf.org/ontologies/bondgraph-framework#NKETransporter')!
    expect(Object.fromEntries([...reaction.parameters].map(([name, v]) => [name, v.units]))).toEqual({
      k_NKE: 'fmol/s',
      K_K: 'pL/fmol',
      K_Na: 'pL/fmol',
      u_e: 'J/C',
    })
    const domain = reaction.domain
    expect([domain.flow.units, domain.potential.units, domain.quantity.units]).toEqual(['fmol/s', 'J/mol', 'fmol'])
    expect(domain.constants.map((c) => [c.name, c.units, c.value!.magnitude])).toEqual([
      ['F', 'C/mol', 96485],
      ['RT', 'J/mol', 2578.73058],
    ])
    expect(converter.framework!.withUnitSystem('cellular')).toBe(cellular)
    expect(converter.framework!.withUnitSystem('si')).toBe(converter.framework)
  })
})

/** The Validator's and Analyser's issues for a template's relation, alone in a model. */
function relationIssues(template: ElementTemplate): string[] {
  const relation = template.constitutiveRelation!
  const units = new Map<string, string>([[VOI_NAME, VOI_UNITS]])
  const domain = template.domain
  for (const v of [domain.flow, domain.potential, domain.quantity, ...domain.constants]) units.set(v.name, v.units)
  for (const port of template.ports.values()) {
    units.set(port.flow.name, port.flow.units)
    units.set(port.potential.name, port.potential.units)
  }
  for (const v of [...template.parameters.values(), ...template.variables.values()]) units.set(v.name, v.units)

  const computed = new Set(relation.flatMap((equation) => (equation.left.type === 'Identifier' ? [equation.left.name] : [])))
  const model = new libcellml.Model()
  model.setName('relation')
  const component = new libcellml.Component()
  component.setName('main')
  model.addComponent(component)
  const definitions = new UnitsDefinitions(libcellml, model)
  try {
    for (const name of variables(...relation)) {
      const variable = new libcellml.Variable()
      variable.setName(name)
      variable.setUnitsByName(definitions.unitsFor(units.get(name)!))
      if (name !== VOI_NAME && !computed.has(name)) variable.setInitialValueByDouble(1)
      component.addVariable(variable)
      variable.delete?.()
    }
    const cnUnits = (cn: NumberNode): string => (cn.units === undefined ? 'dimensionless' : definitions.unitsFor(cn.units))
    component.appendMath(toMathML(relation, { cnUnits }))
    model.linkUnits()
    const log = new IssueLog('build')
    const check = checkCellMLModel(libcellml, model, log)
    return [...log.issues.map((issue) => issue.message), ...(check.analysed ? [] : ['not analysed'])]
  } finally {
    component.delete?.()
    model.delete?.()
  }
}
