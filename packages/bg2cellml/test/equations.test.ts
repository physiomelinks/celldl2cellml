/**
 * Plan chunk 5.5: a model's equations, checked against the Python bg2cellml's
 * intermediate fixtures (test/reference/models) and on hand-written models.
 *
 * We read bond counts, which Python doesn't (its bug 3), so models with bond
 * counts are checked against the fixtures Python gives with that bug fixed
 * (`*.bug3-fixed.json`). That also checks RC_labelled_bonds, which Python
 * can only build with the bug fixed.
 */

import { canonicalise, divide, eq, equals, type Equation } from '@physiomelinks/math-ast'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import { BondgraphModel, type BondgraphFramework, type ModelRuntime } from '../src/index.js'
import { bgRdfFramework, frameworkRuntime } from './framework-fixtures.js'
import { pythonEquation } from './python-math.js'
import { loadFixedPythonModel, loadManifest, loadPythonModel, readSource, type PythonModel, type ReferenceCase } from './reference.js'

const manifest = loadManifest()
let framework: BondgraphFramework
let runtime: ModelRuntime

beforeAll(async () => {
  runtime = { ...(await frameworkRuntime()), oxigraph }
  framework = bgRdfFramework()
})

const loadCase = (c: ReferenceCase): BondgraphModel => BondgraphModel.fromTurtle(framework, runtime, readSource(c), c.baseIri)
const messages = (model: BondgraphModel): string[] => model.log.issues.map((issue) => issue.message)
const caseNamed = (name: string): ReferenceCase => manifest.cases.find((c) => c.name === name)!

/**
 * Python's equation, read and tidied as ours is. With bond counts, Python can
 * give an equation such as `2*v_r_1 = -v_q_2`; ours is `v_r_1 = -v_q_2/2`.
 */
function theirEquation(mathml: string): Equation {
  const equation = pythonEquation(mathml)
  const left = equation.left
  if (left.type === 'Multiply' && left.children.length === 2 && left.children[0]!.type === 'Number' && left.children[1]!.type === 'Identifier') {
    return canonicalise(eq(left.children[1]!, divide(equation.right, left.children[0]!))) as Equation
  }
  return equation
}

const checked = manifest.cases.filter((c) => c.intermediate !== undefined || c.intermediateBug3Fixed !== undefined)

describe('equations of the reference models', () => {
  describe.each(checked)('$name', (c) => {
    let model: BondgraphModel
    let python: PythonModel

    beforeAll(() => {
      model = loadCase(c)
      python = loadFixedPythonModel(c)
    })

    it('loads with no issues', () => {
      expect(messages(model)).toEqual([])
    })

    it('has the equations Python has, in the same order and from the same places', () => {
      expect(model.equations.map((e) => e.provenance)).toEqual(python.equations.map((e) => e.provenance))
      python.equations.forEach((theirs, index) => {
        const ours = canonicalise(model.equations[index]!.equation)
        expect(equals(ours, theirEquation(theirs.mathml)), `${index}: ${theirs.text}`).toBe(true)
      })
    })

    it('keeps each element’s and junction’s own equations', () => {
      const own = [...model.elements.values()].flatMap((e) => [...(e.constitutiveRelation ?? []), ...e.equations])
      own.push(...[...model.junctions.values()].flatMap((j) => j.equations))
      expect(own).toEqual(model.equations.map((e) => e.equation))
      for (const { provenance, source } of model.equations) {
        expect(provenance === 'js' ? model.junctions.has(source) : model.elements.has(source), source).toBe(true)
      }
    })
  })

  it('differ from unfixed Python only where bond counts are given', () => {
    const differing = checked.flatMap((c) => {
      if (c.intermediate === undefined) return [c.name]
      const unfixed = loadPythonModel(c).equations
      const model = loadCase(c)
      const same =
        unfixed.length === model.equations.length &&
        unfixed.every((theirs, i) => equals(canonicalise(model.equations[i]!.equation), theirEquation(theirs.mathml)))
      return same ? [] : [c.name]
    })
    // RC_labelled_bonds has no unfixed fixture, as Python fails on it
    expect(differing).toEqual(['example_B2', 'example_B2_reduced', 'RC_labelled_bonds'])
  })

  it('RC_plain_number has the equations of example_RC', () => {
    const model = loadCase(caseNamed('RC_plain_number'))
    expect(messages(model)).toEqual([])
    const theirs = loadCase(caseNamed('example_RC')).equations
    expect(model.equations.map((e) => e.equation)).toEqual(theirs.map((e) => e.equation))
  })
})

//==============================================================================

const BASE = 'https://example.org/model.ttl'
const id = (name: string): string => `${BASE}#${name}`

function modelFrom(turtle: string): BondgraphModel {
  return BondgraphModel.fromTurtle(
    framework,
    runtime,
    `@prefix bgf: <https://bg-rdf.org/ontologies/bondgraph-framework#> .
     @prefix cdt: <https://w3id.org/cdt/> .
     @prefix : <#> .
     ${turtle}`,
    BASE,
  )
}

/** The name an equation is solved for. */
const solvedFor = (equation: Equation): string => (equation.left.type === 'Identifier' ? equation.left.name : '?')

describe('building equations', () => {
  const CAPACITOR = (name: string): string =>
    `:${name} a bgf:ElectricalCapacitor ; bgf:hasValue "0 C"^^cdt:ucum ; bgf:parameterValue [ bgf:varName "C" ; bgf:hasValue "1 F"^^cdt:ucum ] .`
  const RESISTOR = (name: string): string =>
    `:${name} a bgf:ElectricalResistor ; bgf:parameterValue [ bgf:varName "R" ; bgf:hasValue "1 Ohm"^^cdt:ucum ] .`

  it('scales terms by bond counts, solving for a variable rather than a multiple of one', () => {
    // A zero node with two outputs: to q_1, and twice to the one node v
    const model = modelFrom(`
      :m a bgf:BondgraphModel ; bgf:hasBondElement :q_1, :R_0 ; bgf:hasJunctionStructure :u, :v .
      ${CAPACITOR('q_1')} ${RESISTOR('R_0')}
      :u a bgf:ZeroNode . :v a bgf:OneNode .
      :b1 bgf:hasSource :u ; bgf:hasTarget :q_1 .
      :b2 bgf:hasSource :u ; bgf:hasTarget :v ; bgf:bondCount 2 .
      :b3 bgf:hasSource :v ; bgf:hasTarget :R_0 .`)
    expect(messages(model)).toEqual([])
    const zero = model.junctions.get(id('u'))!.equations
    // Python, with bond counts read, would give 2*v = -v_q_1
    const expected = canonicalise(eq({ type: 'Identifier', name: 'v' }, divide({ type: 'Negate', value: { type: 'Identifier', name: 'v_q_1' } }, { type: 'Number', value: 2 })))
    expect(equals(zero[0]!, expected)).toBe(true)
    // The one node solves for the resistor's potential: u_R_0 = 2*u
    const one = model.junctions.get(id('v'))!.equations
    expect(solvedFor(one[0]!)).toBe('u_R_0')
    expect(JSON.stringify(one[0]!.right)).toContain('"value":2')
  })

  it("solves a one node's balance for a resistor's potential, whichever way its bond runs", () => {
    // R_0 bonds into v, so its potential is an input: u_V_in + u_R_0 = V_C
    const model = modelFrom(`
      :m a bgf:BondgraphModel ; bgf:hasBondElement :V_in, :R_0, :q_1 ; bgf:hasJunctionStructure :v, :V_C .
      :V_in a bgf:VoltageSource ; bgf:hasValue "1 V"^^cdt:ucum .
      ${RESISTOR('R_0')} ${CAPACITOR('q_1')}
      :v a bgf:OneNode . :V_C a bgf:ZeroNode .
      :b1 bgf:hasSource :V_in ; bgf:hasTarget :v .
      :b2 bgf:hasSource :R_0 ; bgf:hasTarget :v .
      :b3 bgf:hasSource :v ; bgf:hasTarget :V_C .
      :b4 bgf:hasSource :V_C ; bgf:hasTarget :q_1 .`)
    expect(messages(model)).toEqual([])
    const balance = model.junctions.get(id('v'))!.equations[0]!
    const ci = (name: string) => ({ type: 'Identifier', name }) as const
    const expected = canonicalise(eq(ci('u_R_0'), { type: 'Subtract', minuend: ci('V_C'), subtrahend: ci('u_V_in') }))
    expect(equals(balance, expected), JSON.stringify(balance)).toBe(true)
  })

  it('reports adjacent zero nodes, which must be merged', () => {
    const model = modelFrom(`
      :m a bgf:BondgraphModel ; bgf:hasBondElement :q_1, :q_2 ; bgf:hasJunctionStructure :u_1, :u_2 .
      ${CAPACITOR('q_1')} ${CAPACITOR('q_2')}
      :u_1 a bgf:ZeroNode . :u_2 a bgf:ZeroNode .
      :b1 bgf:hasSource :u_1 ; bgf:hasTarget :q_1 .
      :b2 bgf:hasSource :u_1 ; bgf:hasTarget :u_2 .
      :b3 bgf:hasSource :u_2 ; bgf:hasTarget :q_2 .`)
    expect(messages(model).sort()).toEqual([
      'Adjacent Zero Nodes to junction u_1 (#u_1) must be merged',
      'Adjacent Zero Nodes to junction u_2 (#u_2) must be merged',
    ])
  })

  it("gives a transform node's relation in its variables' symbols", () => {
    const model = modelFrom(`
      :m a bgf:BondgraphModel ; bgf:hasBondElement :R_a, :R_b ; bgf:hasJunctionStructure :v_a, :v_b, :TF .
      ${RESISTOR('R_a')} ${RESISTOR('R_b')}
      :v_a a bgf:OneNode . :v_b a bgf:OneNode .
      :TF a bgf:TransformNode ; bgf:hasValue 2 .
      :b1 bgf:hasSource :v_a ; bgf:hasTarget :R_a .
      :b2 bgf:hasSource :v_a ; bgf:hasTarget :TF .
      :b3 bgf:hasSource :TF ; bgf:hasTarget :v_b .
      :b4 bgf:hasSource :v_b ; bgf:hasTarget :R_b .`)
    expect(messages(model)).toEqual([])
    const tf = model.junctions.get(id('TF'))!.equations
    // A transformer: u_1 = RATIO u_0, v_1 = v_0 / RATIO
    expect(tf.map(solvedFor)).toEqual(['u_TF_1', 'v_b'])
    expect(JSON.stringify(tf)).toContain('"name":"TF"')
    expect(JSON.stringify(tf)).toContain('"name":"v_a"')
  })
})
