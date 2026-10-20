/**
 * Plan chunk 6.3: libCellML's Validator and Analyser on the CellML, their
 * messages as issues.
 *
 * Done when all 14 examples validate and analyse with no issues. BG-RDF's
 * example_A3 and example_A3_reduced aren't dimensionally consistent (their
 * voltage source's numbers have no units), so they're checked through
 * A3_numbers_with_units and A3_reduced_numbers_with_units, which are them
 * with units (decided with Hugh), and the originals must give exactly their
 * units warnings.
 *
 * Most models are DAEs rather than ODEs, as Python's are: some junction
 * equations form linear systems libCellML leaves to be solved numerically.
 * So each case must be the same type of model as Python's CellML.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { LibCellML, Model } from '@physiomelinks/cellml-units'
import { ci, eq } from '@physiomelinks/math-ast'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  BondgraphModel,
  Converter,
  IssueLog,
  ModelVariable,
  checkCellMLModel,
  generateCellML,
  type BondgraphFramework,
  type CellMLIssueCause,
  type ModelRuntime,
  type Runtime,
} from '../src/index.js'
import { bgRdfFramework, frameworkRuntime } from './framework-fixtures.js'
import { SIN_UNITS_MESSAGE, UNITS_INCONSISTENT } from './known-issues.js'
import { frameworkSource, loadManifest, readSource, type ReferenceCase } from './reference.js'

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
const generate = (c: ReferenceCase) => generateCellML(libcellml, BondgraphModel.fromTurtle(framework, runtime, readSource(c), c.baseIri))
const exampleOf = (c: ReferenceCase): string => (c.kind === 'example' ? c.name : c.reference.replace(/\.json$/, ''))

/** The Analyser's type for an example's Python CellML (CellML 1.1, read by the non-strict Parser). */
function pythonModelType(example: string): string {
  const parser = new libcellml.Parser(false)
  const analyser = new libcellml.Analyser()
  try {
    const model = parser.parseModel(readFileSync(`${REFERENCE_DIR}python/${example}.cellml`, 'utf8'))
    analyser.analyseModel(model)
    const analysed = analyser.analyserModel()
    const type = libcellml.AnalyserModel.typeAsString(analysed.type())
    analysed.delete?.()
    model.delete?.()
    return type
  } finally {
    parser.delete?.()
    analyser.delete?.()
  }
}

describe('the reference cases', () => {
  const consistent = manifest.cases.filter((c) => !(c.name in UNITS_INCONSISTENT))

  it('check A3 through its variants with units', () => {
    expect(consistent.filter((c) => c.kind === 'example')).toHaveLength(12)
    const checked = new Set(consistent.map(exampleOf))
    for (const example of Object.keys(UNITS_INCONSISTENT)) expect(checked).toContain(example)
  })

  describe.each(consistent)('$name', (c) => {
    it("validates and analyses with no issues, as the same type of model as Python's", () => {
      const result = generate(c)
      expect(result.issues.map((issue) => issue.message)).toEqual([])
      expect(result.cellml).toBeDefined()
      expect(result.modelType).toBe(pythonModelType(exampleOf(c)))
      expect(['ode', 'dae']).toContain(result.modelType)
    })
  })

  describe.each(Object.entries(UNITS_INCONSISTENT))('%s', (name, count) => {
    it("gives the Analyser's units warnings, with its CellML", () => {
      const result = generate(caseNamed(name))
      expect(result.issues).toHaveLength(count)
      for (const issue of result.issues) {
        expect(issue.message).toMatch(SIN_UNITS_MESSAGE)
        expect(issue.cause).toEqual({ checker: 'analyser', level: 'warning' } satisfies CellMLIssueCause)
        expect(issue).toMatchObject({ severity: 'warning', stage: 'analyser' })
      }
      expect(result.cellml).toContain('<model ')
      expect(result.modelType).toBe('dae')
    })
  })

  // Generates every consistent case: about 10 s on a 2-core machine, past Vitest's default 5 s
  it('include ODE and DAE models', () => {
    const types = new Map(consistent.map((c) => [c.name, generate(c).modelType]))
    expect(types.get('example_RC')).toBe('ode')
    expect(types.get('example_B1_reduced')).toBe('ode')
    expect(types.get('example_A1')).toBe('dae')
    expect(types.get('A3_numbers_with_units')).toBe('dae')
  }, 60_000)
})

describe('Converter', () => {
  it('returns the issues, without CellML, for a model the Analyser warns about', async () => {
    const converter = new Converter(runtime as Runtime)
    expect(converter.loadFramework(frameworkSource())).toEqual([])
    const original = caseNamed('example_A3')
    const output = await converter.celldl2cellml(readSource(original), { sourceUri: original.baseIri, rdfSource: true })
    expect(output.cellml).toBeUndefined()
    expect(output.issues).toHaveLength(1)
    expect(output.issues![0]).toMatch(SIN_UNITS_MESSAGE)

    const variant = caseNamed('A3_numbers_with_units')
    const fixed = await converter.celldl2cellml(readSource(variant), { sourceUri: variant.baseIri, rdfSource: true })
    expect(fixed.issues).toBeUndefined()
    expect(fixed.cellml).toContain('<cn cellml:units="volt">50</cn>')
  })
})

//==============================================================================
// Hand-built cases

describe('checkCellMLModel', () => {
  it('reports what the Validator finds, and skips analysis', () => {
    const model = new libcellml.Model()
    model.setName('m')
    const component = new libcellml.Component()
    component.setName('main')
    model.addComponent(component)
    const variable = new libcellml.Variable()
    variable.setName('x')
    component.addVariable(variable)
    const log = new IssueLog()
    try {
      expect(checkCellMLModel(libcellml, model, log)).toEqual({ type: 'invalid', stateCount: 0 })
    } finally {
      variable.delete?.()
      component.delete?.()
      model.delete?.()
    }
    expect(log.issues.length).toBeGreaterThan(0)
    for (const issue of log.issues) {
      expect(issue.message).toMatch(/^CellML validation: /)
      expect((issue.cause as CellMLIssueCause).checker).toBe('validator')
      expect(issue).toMatchObject({ severity: 'error', stage: 'validator' })
    }
    expect(log.issues.map((issue) => issue.message).join('\n')).toMatch(/'x'.*units/)
  })

  it("reports a model the Analyser can't make runnable", () => {
    // v = k, with k given no value: underconstrained
    const element = {
      iri: 'https://example.org/test#model_a',
      symbol: 'a',
      prettyName: 'a (#model_a)',
      domain: { iri: 'https://example.org/test#Domain', constants: [], flow: { name: 'v' }, potential: { name: 'u' }, quantity: { name: 'q' } },
      template: { iri: 'https://example.org/test#Template' },
      elementTemplate: { parameters: new Map() },
      ports: new Map(),
      variables: new Map([
        ['v', new ModelVariable({ name: 'v', units: 'C/s' })],
        ['k', new ModelVariable({ name: 'k', units: 'C/s' })],
      ]),
    }
    const model = {
      iri: 'https://example.org/test#model',
      elements: new Map([[element.iri, element]]),
      junctions: new Map(),
      equations: [{ equation: eq(ci('v'), ci('k')), provenance: 'cr', source: element.iri }],
    } as unknown as BondgraphModel
    const result = generateCellML(libcellml, model)
    expect(result.modelType).toBe('underconstrained')
    expect(result.issues.length).toBeGreaterThan(0)
    for (const issue of result.issues) {
      expect(issue.message).toMatch(/^CellML analysis: /)
      expect((issue.cause as CellMLIssueCause).checker).toBe('analyser')
    }
    expect(result.issues.map((issue) => issue.message).join('\n')).toMatch(/'k'/)
    expect(result.issues.every((issue) => issue.stage === 'analyser')).toBe(true)
    expect(result.issues.some((issue) => issue.severity === 'error')).toBe(true)
  })

  it('reports a model type that cannot run as an error, even with only warnings', () => {
    const analysed = { type: () => 'nonRunnable', stateCount: () => 0, delete: () => {} }
    const stub = Object.create(libcellml) as LibCellML
    Object.assign(stub, {
      Analyser: warningLogger({ analyserModel: () => analysed }),
      AnalyserModel: { typeAsString: (type: string) => type },
    })
    const log = new IssueLog()
    const model = simpleModel()
    try {
      expect(checkCellMLModel(stub, model, log).type).toBe('nonRunnable')
    } finally {
      model.delete?.()
    }
    expect(log.issues.map(({ message, severity, stage }) => ({ message, severity, stage }))).toEqual([
      { message: 'CellML analysis: a stub warning', severity: 'warning', stage: 'analyser' },
      { message: 'CellML analysis: the model is nonRunnable', severity: 'error', stage: 'analyser' },
    ])
  })

  it('analyses a model the Validator only warns about', () => {
    const stub = Object.create(libcellml) as LibCellML
    Object.assign(stub, { Validator: warningLogger({ validateModel: () => {} }) })
    const log = new IssueLog()
    const model = simpleModel()
    try {
      expect(checkCellMLModel(stub, model, log)).toEqual({ type: 'ode', stateCount: 1 })
    } finally {
      model.delete?.()
    }
    expect(log.issues).toEqual([
      {
        message: 'CellML validation: a stub warning',
        severity: 'warning',
        stage: 'validator',
        cause: { checker: 'validator', level: 'warning' } satisfies CellMLIssueCause,
      },
    ])
  })
})

/** A Validator or Analyser class with `methods`, whose one issue is a warning. */
function warningLogger(methods: Record<string, unknown>): unknown {
  const warning = libcellml.Issue.Level.WARNING
  return class {
    constructor() {
      Object.assign(this, methods)
    }
    analyseModel(): void {}
    issueCount(): number {
      return 1
    }
    issue(): unknown {
      return { level: () => warning, description: () => 'a stub warning', delete: () => {} }
    }
  }
}

/** dx/dt = 1, which validates and analyses as an ODE. */
function simpleModel(): Model {
  const parser = new libcellml.Parser(false)
  try {
    return parser.parseModel(`<?xml version="1.0"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" xmlns:cellml="http://www.cellml.org/cellml/2.0#" name="m">
  <component name="main">
    <variable name="t" units="second"/>
    <variable name="x" units="dimensionless" initial_value="1"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><cn cellml:units="per_second">1</cn></apply>
    </math>
  </component>
  <units name="per_second"><unit units="second" exponent="-1"/></units>
</model>`)
  } finally {
    parser.delete?.()
  }
}
