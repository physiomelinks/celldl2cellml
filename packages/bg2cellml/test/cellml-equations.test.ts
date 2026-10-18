/**
 * Plan chunk 6.2: the model's equations in the CellML, checked against the
 * Python bg2cellml's CellML (test/reference/python), and on hand-built
 * models.
 *
 * Python's CellML holds sympy's MathML, which is read and tidied as in the
 * 5.5 tests, and so is ours, so equations are compared as mathematics, in
 * the same groups and order. With bond counts (example_B2 and
 * example_B2_reduced), Python's CellML has its bug 3, so those are checked
 * against the equations Python gives with the bug fixed (`*.bug3-fixed.json`).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { LibCellML } from '@physiomelinks/cellml-units'
import { DOMParser } from '@xmldom/xmldom'
import {
  canonicalise,
  ci,
  cn,
  diff,
  divide,
  eq,
  equals,
  parseMathML,
  sortKey,
  times,
  toEquations,
  type DOMParserLike,
  type Equation,
} from '@physiomelinks/math-ast'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  BondgraphModel,
  EQUATION_GROUPS,
  IssueLog,
  ModelVariable,
  buildCellMLModel,
  freeBuild,
  generateCellML,
  leftSideKey,
  type BondgraphFramework,
  type ModelEquation,
  type ModelRuntime,
} from '../src/index.js'
import { bgRdfFramework, frameworkRuntime } from './framework-fixtures.js'
import { expectKnownIssues } from './known-issues.js'
import { pythonEquation } from './python-math.js'
import { loadFixedPythonModel, loadManifest, readSource, type ReferenceCase } from './reference.js'

const REFERENCE_DIR = fileURLToPath(new URL('./reference/', import.meta.url))
const manifest = loadManifest()
const domParser = new DOMParser() as unknown as DOMParserLike
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

/** Python's group comments, as it writes them, and ours. */
const GROUP_OF_COMMENT = new Map<string, string>(EQUATION_GROUPS.map(({ group, description }) => [description, group]))

/** A CellML file's equations by group, in order: each `<math>` read with `read`, after the comment naming its group. */
function equationsByGroup(cellml: string, read: (math: string) => Equation): Map<string, Equation[]> {
  const groups = new Map<string, Equation[]>()
  let current: Equation[] | undefined
  for (const match of cellml.matchAll(/<!--\s*([^-]+?)\s*-->|<math\b[\s\S]*?<\/math>/g)) {
    if (match[1] !== undefined) {
      const group = GROUP_OF_COMMENT.get(match[1])
      if (group === undefined) continue
      current = []
      groups.set(group, current)
    } else {
      expect(current, 'an equation comes after a group comment').toBeDefined()
      current!.push(read(match[0]))
    }
  }
  return groups
}

/** Ours, read back and tidied. Python's numbers have no units, so ours lose theirs to be tidied the same. */
const ours = (math: string): Equation =>
  canonicalise(toEquations(parseMathML(math.replaceAll(' cellml:units="dimensionless"', ''), { domParser }))[0]!) as Equation

/** An equation of Python's CellML, whose numbers are all in its `dim` units. */
const pythons = (math: string): Equation => pythonEquation(math.replaceAll(' cellml:units="dim"', ''))

/** Python's equation; with bond counts it can be `2*v_r_1 = ...`, which ours is as `v_r_1 = .../2`. */
function theirs(equation: Equation): Equation {
  const left = equation.left
  if (left.type === 'Multiply' && left.children.length === 2 && left.children[0]!.type === 'Number' && left.children[1]!.type === 'Identifier') {
    return canonicalise(eq(left.children[1]!, divide(equation.right, left.children[0]!))) as Equation
  }
  return equation
}

const text = (equations: readonly Equation[]): string[] => equations.map(sortKey)

function expectSameEquations(actual: readonly Equation[], expected: readonly Equation[], label: string): void {
  expect(text(actual), label).toEqual(text(expected))
  actual.forEach((equation, index) => expect(equals(equation, expected[index]!), `${label}: ${sortKey(equation)}`).toBe(true))
}

/** Our CellML for a case: no issues, and it re-parses with the strict Parser and validates. */
function ourCellML(c: ReferenceCase): string {
  const model = loadCase(c)
  expect(model.log.issues.map((issue) => issue.message)).toEqual([])
  const result = generateCellML(libcellml, model)
  expectKnownIssues(c.name, result.issues.map((issue) => issue.message))
  const cellml = result.cellml!
  const lib = libcellml as unknown as Record<string, new (...args: unknown[]) => any>
  const parser = new lib.Parser!(true)
  const validator = new lib.Validator!()
  try {
    const parsed = parser.parseModel(cellml)
    const messages = (logger: any): string[] => Array.from({ length: logger.issueCount() }, (_, i) => logger.issue(i).description())
    expect(messages(parser), 'parser').toEqual([])
    validator.validateModel(parsed)
    expect(messages(validator), 'validator').toEqual([])
    parsed.delete()
  } finally {
    parser.delete()
    validator.delete()
  }
  return cellml
}

describe('leftSideKey', () => {
  it('is the text sympy gives a left side', () => {
    expect(leftSideKey(ci('q_1'))).toBe('q_1')
    expect(leftSideKey(diff('q_1', 't'))).toBe('Derivative(q_1, t)')
  })

  it('sorts as Python sorts', () => {
    const keys = ['Derivative(q_10, t)', 'Derivative(q_1, t)', 'u_1', 'V_C', 'v_1'].sort()
    expect(keys).toEqual(['Derivative(q_1, t)', 'Derivative(q_10, t)', 'V_C', 'u_1', 'v_1'])
  })
})

describe('every reference case', () => {
  describe.each(manifest.cases)('$name', (c) => {
    it('gives a complete model, with every equation', () => {
      const model = loadCase(c)
      const log = new IssueLog()
      const build = buildCellMLModel(libcellml, model, log)
      try {
        expect(log.issues.map((issue) => issue.message)).toEqual([])
        expect(build.equations).toHaveLength(model.equations.length)
        expect(new Set(build.equations.map((e) => e.equation))).toEqual(new Set(model.equations.map((e) => e.equation)))
      } finally {
        freeBuild(build)
      }
      ourCellML(c)
    })
  })
})

describe('the reference examples', () => {
  const examples = manifest.cases.filter((c) => c.pythonCellml !== undefined)
  const withBondCounts = new Set(examples.filter((c) => c.intermediateBug3Fixed !== undefined).map((c) => c.name))

  it('include the two with bond counts', () => {
    expect([...withBondCounts].sort()).toEqual(['example_B2', 'example_B2_reduced'])
  })

  describe.each(examples.filter((c) => !withBondCounts.has(c.name)))('$name', (c) => {
    it("has Python's equations, in its groups and order", () => {
      const actual = equationsByGroup(ourCellML(c), ours)
      const expected = equationsByGroup(readFileSync(`${REFERENCE_DIR}${c.pythonCellml}`, 'utf8'), pythons)
      expect([...actual.keys()]).toEqual([...expected.keys()])
      for (const [group, equations] of expected) expectSameEquations(actual.get(group)!, equations, group)
    })
  })

  describe.each(examples.filter((c) => withBondCounts.has(c.name)))('$name', (c) => {
    it('has the equations of Python with bug 3 fixed, in its groups', () => {
      const actual = equationsByGroup(ourCellML(c), ours)
      const python = loadFixedPythonModel(c)
      const expected = new Map<string, Equation[]>()
      for (const { provenance, mathml, text: written } of python.equations) {
        const group = provenance === 'js' ? 'junctionAlgebraics' : provenance === 'be' || !written.startsWith('Derivative(') ? 'elementAlgebraics' : 'elementODEs'
        if (!expected.has(group)) expected.set(group, [])
        expected.get(group)!.push(theirs(pythonEquation(mathml)))
      }
      expect([...actual.keys()]).toEqual(EQUATION_GROUPS.map(({ group }) => group).filter((group) => expected.has(group)))
      // Python's left sides with bond counts (2*v_r_1) sort differently, so compare each group as a set
      const sorted = (equations: readonly Equation[]): Equation[] => [...equations].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0))
      for (const [group, equations] of expected) expectSameEquations(sorted(actual.get(group)!), sorted(equations), group)
    })
  })
})

/** Ours with every number's units removed, as Python ignores those a source gives (`bgf:units`). */
const oursWithoutUnits = (math: string): Equation => ours(math.replace(/ cellml:units="[^"]*"/g, ''))

describe('the variants', () => {
  describe.each(manifest.cases.filter((c) => c.kind === 'variant'))('$name', (c) => {
    it("has its example's equations", () => {
      const example = c.reference.replace(/\.json$/, '')
      const actual = equationsByGroup(ourCellML(c), oursWithoutUnits)
      const expected = equationsByGroup(readFileSync(`${REFERENCE_DIR}python/${example}.cellml`, 'utf8'), pythons)
      expect([...actual.keys()]).toEqual([...expected.keys()])
      for (const [group, equations] of expected) expectSameEquations(actual.get(group)!, equations, group)
    })
  })
})

describe('example_RC', () => {
  it('writes the groups and numbers as decided', () => {
    const cellml = ourCellML(caseNamed('example_RC'))
    expect([...cellml.matchAll(/<!--(.*?)-->/g)].map((m) => m[1])).toEqual([' Element ODEs ', ' Element algebraics ', ' Junction algebraics '])
    expect(cellml.match(/<math /g)).toHaveLength(8)
  })

  it('gives every number cellml:units', () => {
    const cellml = ourCellML(caseNamed('example_A3'))
    const numbers = [...cellml.matchAll(/<cn\b[^>]*>/g)].map((m) => m[0])
    expect(numbers.length).toBeGreaterThan(0)
    expect(numbers.every((n) => n.includes('cellml:units="dimensionless"'))).toBe(true)
  })
})

/** The Analyser's messages about a case's CellML. */
function analyse(c: ReferenceCase): string[] {
  const lib = libcellml as unknown as Record<string, new (...args: unknown[]) => any>
  const parser = new lib.Parser!(true)
  const analyser = new lib.Analyser!()
  try {
    const parsed = parser.parseModel(ourCellML(c))
    analyser.analyseModel(parsed)
    parsed.delete()
    return Array.from({ length: analyser.issueCount() }, (_, i) => analyser.issue(i).description() as string)
  } finally {
    parser.delete()
    analyser.delete()
  }
}

describe('numbers with units, for dimensionally consistent equations', () => {
  it.each(['A3_numbers_with_units', 'A3_reduced_numbers_with_units'])('%s writes its numbers in their units', (name) => {
    const cellml = ourCellML(caseNamed(name))
    expect(cellml).toContain('<units name="per_s">')
    const numbers = [...cellml.matchAll(/<cn cellml:units="([^"]+)">([^<]+)<\/cn>/g)].map((m) => `${m[2]} ${m[1]}`).sort()
    // The reduced model's junction equation repeats the source's expression
    const once = ['2 dimensionless', '50 per_s', '50 volt']
    expect(numbers).toEqual(name.includes('reduced') ? [...once, ...once].sort() : once)
  })

  it.each(['A3_numbers_with_units', 'A3_reduced_numbers_with_units'])('%s has consistent units throughout', (name) => {
    expect(analyse(caseNamed(name))).toEqual([])
  })

  // Until BG-RDF gives them units, the examples' dimensionless numbers aren't consistent
  it.each([
    ['example_A3', 1],
    ['example_A3_reduced', 2],
  ])("%s's dimensionless numbers aren't consistent", (name, count) => {
    const messages = analyse(caseNamed(name))
    expect(messages).toHaveLength(count)
    for (const message of messages) expect(message).toMatch(/^The unit of '.*' in 'sin\(.*\)' .* is not dimensionless\./)
  })
})

//==============================================================================
// Hand-built cases

const MODEL_IRI = 'https://example.org/test#model'
const ELEMENT = `${MODEL_IRI}_a`

/** Just what `buildCellMLModel` reads: one element with the given variables, and the given equations. */
function fakeModel(variables: ModelVariable[], equations: Omit<ModelEquation, 'source'>[]): BondgraphModel {
  const element = {
    iri: ELEMENT,
    symbol: 'a',
    prettyName: 'a (#model_a)',
    domain: { iri: 'https://example.org/test#Domain', constants: [] },
    variables: new Map(variables.map((variable) => [variable.name, variable])),
  }
  return {
    iri: MODEL_IRI,
    elements: new Map([[ELEMENT, element]]),
    junctions: new Map(),
    equations: equations.map((equation) => ({ ...equation, source: ELEMENT })),
  } as unknown as BondgraphModel
}

const variable = (name: string, units: string): ModelVariable => new ModelVariable({ name, units })

function build(model: BondgraphModel): { messages: string[]; cellml: string; written: number } {
  const log = new IssueLog()
  const result = buildCellMLModel(libcellml, model, log)
  try {
    const printer = new libcellml.Printer()
    const cellml = printer.printModel(result.model, false)
    printer.delete?.()
    return { messages: log.issues.map((issue) => issue.message), cellml, written: result.equations.length }
  } finally {
    freeBuild(result)
  }
}

describe('equations of hand-built models', () => {
  const q = variable('q', 'C')
  const v = variable('v', 'C/s')
  const u = variable('u', 'V')

  it('groups and sorts as Python does', () => {
    const { messages, cellml } = build(
      fakeModel(
        [q, v, u],
        [
          { equation: eq(ci('v'), times(cn(2), ci('q'))), provenance: 'js' },
          { equation: eq(ci('u'), ci('q')), provenance: 'be' },
          { equation: eq(diff('q', 't'), ci('v')), provenance: 'cr' },
          { equation: eq(ci('q'), ci('u')), provenance: 'cr' },
        ],
      ),
    )
    expect(messages).toEqual([])
    const groups = equationsByGroup(cellml, ours)
    expect([...groups].map(([group, equations]) => [group, text(equations)])).toEqual([
      ['elementODEs', [sortKey(eq(diff('q', 't'), ci('v')))]],
      ['elementAlgebraics', [sortKey(eq(ci('q'), ci('u'))), sortKey(eq(ci('u'), ci('q')))]],
      ['junctionAlgebraics', [sortKey(eq(ci('v'), times(cn(2), ci('q'))))]],
    ])
  })

  it('reports an equation using a name that is not a variable, as an unbonded port gives', () => {
    const { messages, written } = build(
      fakeModel(
        [v],
        [
          { equation: eq(ci('v'), divide(ci('u'), ci('R'))), provenance: 'cr' },
          { equation: eq(ci('v'), ci('v')), provenance: 'js' },
        ],
      ),
    )
    expect(messages).toEqual(["An equation of a (#model_a) uses u, R, which aren't variables of the model"])
    expect(written).toBe(1)
  })

  it("keeps a number's own units, as UCUM", () => {
    const { messages, cellml } = build(fakeModel([u], [{ equation: eq(ci('u'), cn(50, 'mV')), provenance: 'cr' }]))
    expect(messages).toEqual([])
    expect(cellml).toContain('<units name="mV">')
    expect(cellml).toMatch(/<cn cellml:units="mV">50<\/cn>/)
  })

  it('reports a number in units CellML cannot express', () => {
    const { messages, written } = build(fakeModel([u], [{ equation: eq(ci('u'), cn(50, 'Cel')), provenance: 'cr' }]))
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/^An equation of a \(#model_a\) has a number in units CellML can't use: .*affine temperature/)
    expect(written).toBe(0)
  })

  it("reports a constitutive relation that isn't for a variable or derivative", () => {
    const { messages, written } = build(fakeModel([q, v], [{ equation: eq(times(cn(2), ci('q')), ci('v')), provenance: 'cr' }]))
    expect(messages).toEqual(['An equation of a (#model_a) has neither a variable nor a derivative on its left side'])
    expect(written).toBe(0)
  })
})
