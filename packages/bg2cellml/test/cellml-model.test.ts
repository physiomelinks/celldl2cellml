/**
 * Plan chunk 6.1: the CellML model's units and `main` component variables,
 * checked against the Python bg2cellml's CellML (test/reference/python) read
 * back through libCellML's Parser, and on hand-built models.
 *
 * Python writes CellML 1.1, which libCellML's non-strict Parser reads as 2.0.
 * Units are compared by what they are (`Units.equivalent`), as their names
 * differ on purpose (`C_per_s` here, `coulomb_per_second` in Python).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { LibCellML, Model, Units } from '@physiomelinks/cellml-units'
import * as oxigraph from 'oxigraph'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  BondgraphModel,
  IssueLog,
  ModelVariable,
  UnitsDefinitions,
  buildCellMLModel,
  cellmlModelName,
  freeBuild,
  generateCellML,
  symbolSortKey,
  type BondgraphFramework,
  type ModelRuntime,
} from '../src/index.js'
import { bgRdfFramework, frameworkRuntime } from './framework-fixtures.js'
import { expectKnownIssues } from './known-issues.js'
import { loadManifest, readSource, type ReferenceCase } from './reference.js'

const REFERENCE_DIR = fileURLToPath(new URL('./reference/', import.meta.url))
const manifest = loadManifest()
let framework: BondgraphFramework
let runtime: ModelRuntime
let libcellml: LibCellML

beforeAll(async () => {
  runtime = { ...(await frameworkRuntime()), oxigraph }
  libcellml = runtime.libcellml
  framework = bgRdfFramework()
})

const caseNamed = (name: string): ReferenceCase => manifest.cases.find((c) => c.name === name)!
const loadCase = (c: ReferenceCase): BondgraphModel => BondgraphModel.fromTurtle(framework, runtime, readSource(c), c.baseIri)

/** Every model to free once the tests are done. */
const parsed: Model[] = []
afterAll(() => {
  for (const model of parsed) model.delete?.()
})

/** Parse CellML; `strict` false reads Python's CellML 1.1. Returns the model and the Parser's messages. */
function parse(cellml: string, strict: boolean): { model: Model; issues: string[] } {
  const parser = new libcellml.Parser(strict)
  try {
    const model = parser.parseModel(cellml)
    parsed.push(model)
    const issues = Array.from({ length: parser.issueCount() }, (_, i) => parser.issue(i).description())
    return { model, issues }
  } finally {
    parser.delete?.()
  }
}

interface VariableRow {
  name: string
  units: Units
  initialValue?: number
}

/** The variables of a model's one component, in order. */
function variablesOf(model: Model): VariableRow[] {
  expect(model.componentCount()).toBe(1)
  const component = model.componentByIndex(0)!
  expect(component.name()).toBe('main')
  return Array.from({ length: component.variableCount() }, (_, i) => {
    const variable = component.variableByIndex(i)!
    const value = variable.initialValue()
    return { name: variable.name(), units: variable.units()!, ...(value === '' ? {} : { initialValue: Number(value) }) }
  })
}

/** Python's domain constants come in query order (`RT`, `F`); ours by name, as the framework holds them. */
function constantsByName(rows: VariableRow[], constants: ReadonlySet<string>): VariableRow[] {
  const first = rows.findIndex((row) => constants.has(row.name))
  if (first < 0) return rows
  const count = rows.filter((row) => constants.has(row.name)).length
  const block = rows.slice(first, first + count)
  expect(block.every((row) => constants.has(row.name)), 'constants come together').toBe(true)
  block.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return [...rows.slice(0, first), ...block, ...rows.slice(first + count)]
}

/** Our CellML for a case, read back with the strict Parser. */
function ourModel(c: ReferenceCase): Model {
  const model = loadCase(c)
  expect(model.log.issues.map((issue) => issue.message)).toEqual([])
  const result = generateCellML(libcellml, model)
  expectKnownIssues(c.name, result.issues.map((issue) => issue.message))
  const { model: cellml, issues } = parse(result.cellml!, true)
  expect(issues).toEqual([])
  return cellml
}

function pythonModel(file: string): Model {
  const { model, issues } = parse(readFileSync(`${REFERENCE_DIR}${file}`, 'utf8'), false)
  // Only the notes about reading CellML 1.1 and its cmeta:ids
  expect(issues.filter((issue) => !/CellML 1\.1 model|ignoring attribute 'id'/.test(issue))).toEqual([])
  return model
}

function expectSameVariables(ours: Model, python: Model): void {
  const constants = new Set([...framework.domains.values()].flatMap((domain) => domain.constants.map((constant) => constant.name)))
  const ourRows = variablesOf(ours)
  const theirRows = constantsByName(variablesOf(python), constants)
  expect(ourRows.map((row) => row.name)).toEqual(theirRows.map((row) => row.name))
  ourRows.forEach((row, index) => {
    const theirs = theirRows[index]!
    const message = `${row.name}: ${row.units.name()} and ${theirs.units.name()}`
    expect(libcellml.Units.equivalent(row.units, theirs.units), message).toBe(true)
    expect(row.initialValue, `${row.name}'s initial value`).toBe(theirs.initialValue)
  })
}

describe('symbolSortKey', () => {
  it.each([
    ['u_R_0', 'R_0u_'],
    ['v_R_0', 'R_0v_'],
    ['R_R_0', 'R_R_0'],
    ['q_1', 'q_1'],
    ['u_', 'u_'],
    ['v', 'v'],
  ])('%s sorts as %s', (symbol, key) => {
    expect(symbolSortKey(symbol)).toBe(key)
  })
})

describe('cellmlModelName', () => {
  it.each([
    ['https://example.org/models/example_RC.ttl#RC_circuit', 'BG_RC_circuit'],
    ['https://example.org/models/example_RC.ttl', 'BG_example_RC'],
    ['https://example.org/m#a-b c:d', 'BG_a_b_c_d'],
    ['https://example.org/m#model.v2', 'BG_model'],
    ['https://example.org/m#café', 'BG_caf'],
  ])('%s is %s', (iri, name) => {
    expect(cellmlModelName(iri)).toBe(name)
  })
})

describe('example_RC', () => {
  let ours: Model
  let python: Model

  beforeAll(() => {
    ours = ourModel(caseNamed('example_RC'))
    python = pythonModel('python/example_RC.cellml')
  })

  it('has the same name as in Python', () => {
    expect(ours.name()).toBe('BG_RC_circuit')
    expect(ours.name()).toBe(python.name())
  })

  it('has the variables, units and initial values of the Python CellML', () => {
    expectSameVariables(ours, python)
  })

  it('names variables, ids and units as decided', () => {
    const component = ours.componentByIndex(0)!
    expect(component.id()).toBe('main')
    const rows = variablesOf(ours)
    expect(rows.map((row) => [row.name, row.units.name(), row.initialValue])).toEqual([
      ['t', 'second', undefined],
      ['C_q_1', 'C2_per_J', 0.001],
      ['I_R', 'C_per_s', undefined],
      ['u_R_0', 'J_per_C', undefined],
      ['v_R_0', 'C_per_s', undefined],
      ['R_R_0', 'J_s_per_C2', 10],
      ['V_C', 'J_per_C', undefined],
      ['u_V_in', 'J_per_C', 10],
      ['v_V_in', 'C_per_s', undefined],
      ['q_1', 'coulomb', 0],
      ['u_q_1', 'J_per_C', undefined],
      ['v_q_1', 'C_per_s', undefined],
    ])
    expect(component.variableByName('C_q_1')!.id()).toBe('main-C_q_1')
  })

  it('defines each units once, and no dim units', () => {
    const names = Array.from({ length: ours.unitsCount() }, (_, i) => ours.unitsByIndex(i)!.name())
    expect(names).toEqual(['C2_per_J', 'C_per_s', 'J_per_C', 'J_s_per_C2'])
  })
})

describe('the reference examples', () => {
  const examples = manifest.cases.filter((c) => c.pythonCellml !== undefined)

  it('are all here', () => {
    expect(examples).toHaveLength(14)
  })

  describe.each(examples)('$name', (c) => {
    it('has the variables, units and initial values of the Python CellML', () => {
      const ours = ourModel(c)
      const python = pythonModel(c.pythonCellml!)
      expect(ours.name()).toBe(python.name())
      expectSameVariables(ours, python)
    })
  })
})

/** The example a variant should match, from its reference: `example_A3.json` is `example_A3`. */
const exampleOf = (c: ReferenceCase): string => c.reference.replace(/\.json$/, '')

describe('the variants', () => {
  const variants = manifest.cases.filter((c) => c.kind === 'variant')

  it('are all here', () => {
    expect(variants.map((c) => [c.name, exampleOf(c)]).sort()).toEqual([
      ['A3_numbers_with_units', 'example_A3'],
      ['A3_reduced_numbers_with_units', 'example_A3_reduced'],
      ['RC_labelled_bonds', 'example_RC'],
      ['RC_plain_number', 'example_RC'],
      ['RC_prefixed_values', 'example_RC'],
    ])
  })

  // Python fails on two and writes RC_prefixed_values' values unconverted
  describe.each(variants)('$name', (c) => {
    it("has its example's variables, units and initial values", () => {
      expectSameVariables(ourModel(c), pythonModel(`python/${exampleOf(c)}.cellml`))
    })
  })
})

//==============================================================================
// Hand-built cases

const MODEL_IRI = 'https://example.org/test#model'

interface FakeSource {
  iri: string
  symbol: string
  domain?: { iri: string; constants: { name: string; units: string; value?: { magnitude: number; units?: string } }[] }
  variables: Map<string, ModelVariable>
}

/** Just what `buildCellMLModel` reads of a model. */
function fakeModel(elements: FakeSource[], junctions: FakeSource[] = []): BondgraphModel {
  const domain = { iri: 'https://example.org/test#Domain', constants: [] }
  return {
    iri: MODEL_IRI,
    elements: new Map(elements.map((element) => [element.iri, { domain, ...element }])),
    junctions: new Map(junctions.map((junction) => [junction.iri, junction])),
    equations: [],
  } as unknown as BondgraphModel
}

function variable(name: string, units: string, value?: number, valueUnits?: string): ModelVariable {
  const result = new ModelVariable({ name, units })
  if (value !== undefined) result.value = { magnitude: value, ...(valueUnits === undefined ? {} : { units: valueUnits }) }
  return result
}

function build(model: BondgraphModel): { log: IssueLog; rows: [string, string, number | undefined][]; units: string[] } {
  const log = new IssueLog()
  const result = buildCellMLModel(libcellml, model, log)
  try {
    const rows = result.variables.map((v): [string, string, number | undefined] => [v.name, v.units, v.initialValue])
    const units = Array.from({ length: result.model.unitsCount() }, (_, i) => result.model.unitsByIndex(i)!.name())
    return { log, rows, units }
  } finally {
    freeBuild(result)
  }
}

const messages = (log: IssueLog): string[] => log.issues.map((issue) => issue.message)

describe('variables of hand-built models', () => {
  it('writes each shared variable once, for the first element with it', () => {
    const shared = variable('q', 'mol', 2)
    const log = new IssueLog()
    const result = buildCellMLModel(
      libcellml,
      fakeModel([
        { iri: `${MODEL_IRI}_b`, symbol: 'b', variables: new Map([['q', shared]]) },
        { iri: `${MODEL_IRI}_a`, symbol: 'a', variables: new Map([['q', shared]]) },
      ]),
      log,
    )
    try {
      expect(messages(log)).toEqual([])
      expect(result.variables.map((v) => [v.name, v.kind, v.source?.symbol])).toEqual([
        ['t', 'voi', undefined],
        ['q', 'variable', 'b'],
      ])
    } finally {
      freeBuild(result)
    }
  })

  it('merges two variables with one symbol that agree, as Python does', () => {
    const { log, rows } = build(
      fakeModel([
        { iri: `${MODEL_IRI}_a`, symbol: 'a', variables: new Map([['k', variable('k', 'mol/s', 1)]]) },
        { iri: `${MODEL_IRI}_b`, symbol: 'b', variables: new Map([['k', variable('k', 'mol/s', 1)]]) },
      ]),
    )
    expect(messages(log)).toEqual([])
    expect(rows).toEqual([
      ['t', 'second', undefined],
      ['k', 'mol_per_s', 1],
    ])
  })

  it('reports two variables with one symbol that differ', () => {
    const { log, rows } = build(
      fakeModel([
        { iri: `${MODEL_IRI}_a`, symbol: 'a', variables: new Map([['k', variable('k', 'mol/s', 1)]]) },
        { iri: `${MODEL_IRI}_b`, symbol: 'b', variables: new Map([['k', variable('k', 'mol/s', 2)]]) },
        { iri: `${MODEL_IRI}_c`, symbol: 'c', variables: new Map([['k', variable('k', '/s', 1)]]) },
      ]),
    )
    expect(messages(log)).toEqual([
      'Variable k of b (#model_b) differs from variable k of a (#model_a): units mol/s, value 2 mol/s != units mol/s, value 1 mol/s',
      'Variable k of c (#model_c) differs from variable k of a (#model_a): units /s, value 1 /s != units mol/s, value 1 mol/s',
    ])
    expect(rows.map((row) => row[0])).toEqual(['t', 'k'])
  })

  it('reports a variable named as the variable of integration or a constant', () => {
    const domain = { iri: 'https://example.org/test#Chemical', constants: [{ name: 'RT', units: 'J/mol', value: { magnitude: 2.5, units: 'kJ/mol' } }] }
    const { log, rows } = build(
      fakeModel([
        { iri: `${MODEL_IRI}_a`, symbol: 'a', domain, variables: new Map([['x', variable('t', 's')], ['y', variable('RT', 'J/mol')]]) },
      ]),
    )
    expect(messages(log)).toEqual([
      'Variable t of a (#model_a) has the same name as the variable of integration t',
      'Variable RT of a (#model_a) has the same name as constant RT of #Chemical',
    ])
    // The constant's value is converted into its units
    expect(rows).toEqual([
      ['t', 'second', undefined],
      ['RT', 'J_per_mol', 2500],
    ])
  })

  it('reports constants with one name that differ between domains', () => {
    const chemical = { iri: 'https://example.org/test#Chemical', constants: [{ name: 'RT', units: 'J/mol', value: { magnitude: 2500 } }] }
    const hydraulic = { iri: 'https://example.org/test#Hydraulic', constants: [{ name: 'RT', units: 'J/mol', value: { magnitude: 2600 } }] }
    // The same value in other units is the same
    const same = { iri: 'https://example.org/test#Other', constants: [{ name: 'RT', units: 'J/mol', value: { magnitude: 2.5, units: 'kJ/mol' } }] }
    const { log } = build(
      fakeModel([
        { iri: `${MODEL_IRI}_a`, symbol: 'a', domain: chemical, variables: new Map() },
        { iri: `${MODEL_IRI}_b`, symbol: 'b', domain: same, variables: new Map() },
        { iri: `${MODEL_IRI}_c`, symbol: 'c', domain: hydraulic, variables: new Map() },
      ]),
    )
    expect(messages(log)).toEqual([
      'Constant RT of #Hydraulic differs from constant RT of #Chemical: units J/mol, value 2600 J/mol != units J/mol, value 2500 J/mol',
    ])
  })

  it('sorts as Python does, junction variables among element ones', () => {
    // Keys: I, R_R, Ru_, Rv_ ('_' sorts before lowercase letters)
    const { rows } = build(
      fakeModel(
        [{ iri: `${MODEL_IRI}_R`, symbol: 'R', variables: new Map([['v', variable('v_R', 'C/s')], ['u', variable('u_R', 'J/C')], ['R', variable('R_R', 'Ohm', 5)]]) }],
        [{ iri: `${MODEL_IRI}_I`, symbol: 'I', variables: new Map([['', variable('I', 'C/s')]]) }],
      ),
    )
    expect(rows.map((row) => row[0])).toEqual(['t', 'I', 'R_R', 'u_R', 'v_R'])
  })

  it('reports units CellML 2.0 cannot express, leaving the variable out', () => {
    const { log, rows } = build(fakeModel([{ iri: `${MODEL_IRI}_a`, symbol: 'a', variables: new Map([['T', variable('T_a', 'Cel', 37)]]) }]))
    expect(messages(log)).toHaveLength(1)
    expect(messages(log)[0]).toMatch(/^Variable T_a of a \(#model_a\): .*affine temperature/)
    expect(rows.map((row) => row[0])).toEqual(['t'])
  })
})

describe('UnitsDefinitions', () => {
  function definitions(): { units: UnitsDefinitions; model: Model; names: () => string[] } {
    const model = new libcellml.Model()
    parsed.push(model)
    return {
      model,
      units: new UnitsDefinitions(libcellml, model),
      names: () => Array.from({ length: model.unitsCount() }, (_, i) => model.unitsByIndex(i)!.name()),
    }
  }

  it('uses built-in units without a definition', () => {
    const { units, names } = definitions()
    expect(['F', 'mol', 'kg', 's', '1', 'm/m'].map((code) => units.unitsFor(code))).toEqual([
      'farad',
      'mole',
      'kilogram',
      'second',
      'dimensionless',
      'dimensionless',
    ])
    expect(names()).toEqual([])
  })

  it('defines prefixed and scaled units, which send Python into recursion', () => {
    const { units, names } = definitions()
    expect(['mmol/s', 'mL', 'uF', 'min'].map((code) => units.unitsFor(code))).toEqual(['mmol_per_s', 'mL', 'uF', 'min'])
    expect(names()).toEqual(['mmol_per_s', 'mL', 'uF', 'min'])
  })

  it('shares a definition between codes with the same name and units', () => {
    const { units, names } = definitions()
    expect(units.unitsFor('mol/s')).toBe('mol_per_s')
    expect(units.unitsFor('s-1.mol')).toBe('mol_per_s')
    expect(units.unitsFor('mol/s')).toBe('mol_per_s')
    expect(names()).toEqual(['mol_per_s'])
  })

  it('numbers a name already taken by different units', () => {
    const { units, model, names } = definitions()
    const perSecond = new libcellml.Units()
    perSecond.setName('mol_per_s')
    perSecond.addUnitByReferenceExponent('second', -1, '')
    model.addUnits(perSecond)
    perSecond.delete?.()
    expect(units.unitsFor('mol/s')).toBe('mol_per_s_1')
    expect(units.unitsFor('s-1.mol')).toBe('mol_per_s_1')
    expect(names()).toEqual(['mol_per_s', 'mol_per_s_1'])
  })
})
