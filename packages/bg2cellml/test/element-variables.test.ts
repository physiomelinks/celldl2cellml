/**
 * Plan chunk 5.4: element variables once the bond network exists: values in
 * each variable's units, symbols the model gives, other elements' intrinsic
 * variables, and constitutive relations in the variables' symbols. Checked
 * against the Python bg2cellml's intermediate fixtures (test/reference/models)
 * and on hand-written models.
 *
 * Python never converts values (bug 2), so its fixtures hold values in the
 * units they were given. We compare ours with those values converted.
 */

import { convertValue } from '@physiomelinks/cellml-units'
import { equals, type Equation } from '@physiomelinks/math-ast'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  BondgraphModel,
  fragment,
  type BondgraphFramework,
  type ModelRuntime,
  type ModelVariable,
} from '../src/index.js'
import { bgRdfFramework, expectSameUnits, frameworkRuntime } from './framework-fixtures.js'
import { forPython, pythonEquation } from './python-math.js'
import { loadManifest, loadPythonModel, readSource, type PythonModel, type PythonVariable, type ReferenceCase } from './reference.js'

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

/** Python's value, which it never converts, in our variable's units. */
function pythonValueIn(theirs: NonNullable<PythonVariable['value']>, units: string): number {
  return convertValue(runtime.libcellml, theirs.magnitude * theirs.units!.scale, theirs.units!.base, units)
}

function expectVariable(ours: ModelVariable | undefined, theirs: PythonVariable, context: string): void {
  expect(ours, context).toBeDefined()
  expect(ours!.name, context).toBe(theirs.name)
  expect(ours!.symbol, context).toBe(theirs.symbol)
  expect(ours!.type ?? null, context).toBe(theirs.type)
  expectSameUnits(ours!.units, theirs.units)
  if (theirs.value === null) {
    expect(ours!.value, context).toBeUndefined()
  } else {
    expect(ours!.value?.units, context).toBe(ours!.units)
    const expected = pythonValueIn(theirs.value, ours!.units)
    expect(Math.abs(ours!.value!.magnitude - expected), `${context}: ${ours!.value!.magnitude} != ${expected}`).toBeLessThanOrEqual(1e-12 * Math.abs(expected))
  }
}

//==============================================================================

describe('element variables of the reference models', () => {
  describe.each(manifest.cases.filter((c) => c.intermediate !== undefined))('$name', (c) => {
    let model: BondgraphModel
    let python: PythonModel

    beforeAll(() => {
      model = loadCase(c)
      python = loadPythonModel(c)
    })

    it('loads with no issues', () => {
      expect(messages(model)).toEqual([])
    })

    it('gives every element the variables Python does, with values in their units', () => {
      expect([...model.elements.keys()]).toEqual(Object.keys(python.variables.elements))
      for (const [iri, theirs] of Object.entries(python.variables.elements)) {
        const ours = model.elements.get(iri)!
        expect([...ours.variables.keys()].sort(), iri).toEqual(Object.keys(theirs).sort())
        for (const [name, variable] of Object.entries(theirs)) expectVariable(ours.variables.get(name), variable, `${fragment(iri)} ${name}`)
      }
    })

    it('has the constitutive relations Python has, in the elements’ symbols', () => {
      const ours = [...model.elements.values()].flatMap((element) => element.constitutiveRelation ?? [])
      const theirs = python.equations.filter((equation) => equation.provenance === 'cr')
      expect(ours).toHaveLength(theirs.length)
      theirs.forEach((equation, index) => {
        expect(equals(forPython(ours[index]!), pythonEquation(equation.mathml)), equation.text).toBe(true)
      })
    })

    it("finds each element's flow or potential expression in its relation", () => {
      for (const element of model.elements.values()) {
        for (const equation of element.constitutiveRelation ?? []) {
          if (equation.left.type !== 'Identifier') continue
          if (equation.left.name === element.flow?.symbol) expect(element.flowExpression, element.iri).toBe(equation.right)
          if (equation.left.name === element.potential?.symbol) expect(element.potentialExpression, element.iri).toBe(equation.right)
        }
      }
    })
  })
})

describe('variants', () => {
  /** Every element variable's symbol, units and value, by IRI fragment. */
  const summary = (model: BondgraphModel): unknown =>
    Object.fromEntries(
      [...model.elements.values()].map((element) => [
        fragment(element.iri),
        Object.fromEntries([...element.variables].map(([name, v]) => [name, [v.symbol, v.units, v.value]])),
      ]),
    )

  it('RC_prefixed_values gives the same values as example_RC, once converted', () => {
    const model = loadCase(caseNamed('RC_prefixed_values'))
    expect(messages(model)).toEqual([])
    expect(summary(model)).toEqual(summary(loadCase(caseNamed('example_RC'))))
    const values = Object.fromEntries([...model.elements.values()].flatMap((e) => [...e.values].map(([n, a]) => [`${fragment(e.iri)} ${n}`, a])))
    // As given, before conversion
    expect(values).toMatchObject({ 'R_0 R': { value: { magnitude: 0.01, units: 'kOhm' } }, 'q_1 C': { value: { magnitude: 1000, units: 'uF' } } })
  })

  it('RC_plain_number gives the same values as example_RC, R taking its units', () => {
    const model = loadCase(caseNamed('RC_plain_number'))
    expect(messages(model)).toEqual([])
    expect(summary(model)).toEqual(summary(loadCase(caseNamed('example_RC'))))
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

/** A capacitor q_1 on a zero node u, with `extra` in its description and `more` after it. */
const capacitor = (extra: string, more = '', elements = ':q_1'): BondgraphModel =>
  modelFrom(`
    :m a bgf:BondgraphModel ; bgf:hasBondElement ${elements} ; bgf:hasJunctionStructure :u .
    :u a bgf:ZeroNode .
    :b1 bgf:hasSource :u ; bgf:hasTarget :q_1 .
    :q_1 a bgf:ElectricalCapacitor ; bgf:hasValue "2 mC"^^cdt:ucum ${extra} .
    ${more}`)

const text = (equation: Equation): string => JSON.stringify(equation)

describe('assigning values', () => {
  it("converts values into each variable's units", () => {
    const model = capacitor('; bgf:parameterValue [ bgf:varName "C" ; bgf:hasValue "1000 uF"^^cdt:ucum ]')
    expect(messages(model)).toEqual([])
    const q = model.elements.get(id('q_1'))!
    expect(q.variables.get('C')!.value).toEqual({ magnitude: 0.001, units: q.variables.get('C')!.units })
    expect(q.intrinsicVariable!.value).toEqual({ magnitude: 0.002, units: q.intrinsicVariable!.units })
  })

  it('gives a plain number its variable’s units', () => {
    const model = capacitor('; bgf:parameterValue [ bgf:varName "C" ; bgf:hasValue 0.5 ]')
    const C = model.elements.get(id('q_1'))!.variables.get('C')!
    expect(C.value).toEqual({ magnitude: 0.5, units: C.units })
  })

  it('reports a value in incompatible units', () => {
    const model = capacitor('; bgf:parameterValue [ bgf:varName "C" ; bgf:hasValue "1 Ohm"^^cdt:ucum ]')
    const C = model.elements.get(id('q_1'))!.variables.get('C')!
    expect(messages(model)).toEqual([`Value for variable C_q_1 has incompatible units (${C.units} != Ohm)`])
    expect(C.value).toBeUndefined()
  })

  it('gives variables the symbols the model gives, in the relation too', () => {
    const model = capacitor('; bgf:parameterValue [ bgf:varName "C" ; bgf:hasValue "1 F"^^cdt:ucum ; bgf:hasSymbol "C_big" ]')
    expect(messages(model)).toEqual([])
    const q = model.elements.get(id('q_1'))!
    expect(q.variables.get('C')).toMatchObject({ name: 'C_q_1', symbol: 'C_big' })
    expect(text(q.constitutiveRelation![1]!)).toContain('"C_big"')
    expect(text(q.constitutiveRelation![1]!)).not.toContain('"C"')
    // u_q_1 = q_1 / C_big, so that is the potential expression
    expect(q.potentialExpression).toEqual({ type: 'Divide', numerator: { type: 'Identifier', name: 'q_1' }, denominator: { type: 'Identifier', name: 'C_big' } })
  })

  it('reports a symbol that would give two variables one name', () => {
    const model = capacitor('; bgf:parameterValue [ bgf:varName "C" ; bgf:hasValue "1 F"^^cdt:ucum ; bgf:hasSymbol "q_1" ]')
    expect(messages(model)).toEqual(['Element q_1 (#q_1) has more than one name for the symbol q_1'])
  })

  it("can make a variable another element's intrinsic variable", () => {
    const model = capacitor(
      '; bgf:parameterValue [ bgf:varName "C" ; bgf:hasValue "1 F"^^cdt:ucum ]',
      `:q_2 a bgf:ElectricalCapacitor ; bgf:parameterValue [ bgf:varName "C" ; bgf:hasValue "1 F"^^cdt:ucum ] ;
                                        bgf:variableValue [ bgf:varName "q" ; bgf:hasValue :q_1 ] .
       :b2 bgf:hasSource :u ; bgf:hasTarget :q_2 .`,
      ':q_1, :q_2',
    )
    expect(messages(model)).toEqual([])
    const [q1, q2] = [model.elements.get(id('q_1'))!, model.elements.get(id('q_2'))!]
    expect(q2.variables.get('q')).toBe(q1.intrinsicVariable)
    expect(text(q2.constitutiveRelation![0]!)).toContain('"q_1"')
  })

  it("reports a reference to something that isn't an element with an intrinsic variable of the same units", () => {
    const model = capacitor(
      `; bgf:parameterValue [ bgf:varName "C" ; bgf:hasValue :u ]`,
      `:R_0 a bgf:ElectricalResistor ; bgf:parameterValue [ bgf:varName "R" ; bgf:hasValue :q_1 ] .
       :R_1 a bgf:ElectricalResistor ; bgf:parameterValue [ bgf:varName "R" ; bgf:hasValue :R_0 ] .
       :R_2 a bgf:ElectricalResistor ; bgf:parameterValue [ bgf:varName "R" ; bgf:hasValue :nowhere ] .
       :b2 bgf:hasSource :u ; bgf:hasTarget :R_0 . :b3 bgf:hasSource :u ; bgf:hasTarget :R_1 . :b4 bgf:hasSource :u ; bgf:hasTarget :R_2 .`,
      ':q_1, :R_0, :R_1, :R_2',
    )
    expect(messages(model)).toEqual([
      `Units incompatible for R_0 (#R_0) value: <${id('q_1')}>`,
      `Value for R_1 (#R_1) is an element with no intrinsic variable: <${id('R_0')}>`,
      `Value for R_2 (#R_2) refers to unknown element: <${id('nowhere')}>`,
      `Value for q_1 (#q_1) is not a bond element: <${id('u')}>`,
    ])
  })

  it("drops a port with no bonds, and a dissipator's potential there", () => {
    const model = modelFrom(`
      :m a bgf:BondgraphModel ; bgf:hasBondElement :R_0, :R_1 ; bgf:hasJunctionStructure :v .
      :v a bgf:OneNode .
      :b1 bgf:hasSource :v ; bgf:hasTarget :R_0 .
      :R_0 a bgf:ElectricalResistor ; bgf:parameterValue [ bgf:varName "R" ; bgf:hasValue "1 Ohm"^^cdt:ucum ] .
      :R_1 a bgf:ElectricalResistor ; bgf:parameterValue [ bgf:varName "R" ; bgf:hasValue "1 Ohm"^^cdt:ucum ] .`)
    expect(messages(model)).toEqual([])
    expect(model.elements.get(id('R_0'))!.ports.size).toBe(1)
    const unused = model.elements.get(id('R_1'))!
    expect(unused.ports.size).toBe(0)
    expect([...unused.variables.keys()].sort()).toEqual(['R', 'v'])
    expect(unused.portVariableNames.has('u')).toBe(false)
  })
})

describe("a source's MathML", () => {
  const source = (mathml: string): BondgraphModel =>
    modelFrom(`
      :m a bgf:BondgraphModel ; bgf:hasBondElement :V_in, :R_0 ; bgf:hasJunctionStructure :v .
      :v a bgf:OneNode .
      :b1 bgf:hasSource :V_in ; bgf:hasTarget :v . :b2 bgf:hasSource :v ; bgf:hasTarget :R_0 .
      :R_0 a bgf:ElectricalResistor ; bgf:parameterValue [ bgf:varName "R" ; bgf:hasValue "1 Ohm"^^cdt:ucum ] .
      :V_in a bgf:VoltageSource ; bgf:hasValue """<math xmlns="http://www.w3.org/1998/Math/MathML">${mathml}</math>"""^^bgf:mathml .`)

  it("is rewritten in the source's symbols", () => {
    const model = source('<apply><eq/><ci>u</ci><apply><times/><cn>5</cn><apply><sin/><ci>t</ci></apply></apply></apply>')
    expect(messages(model)).toEqual([])
    const V = model.elements.get(id('V_in'))!
    expect(V.constitutiveRelation![0]!.left).toEqual({ type: 'Identifier', name: 'u_V_in' })
    expect(V.potentialExpression).toBe(V.constitutiveRelation![0]!.right)
  })

  it('may only use its own variables, constants and t', () => {
    const model = source('<apply><eq/><ci>u</ci><apply><times/><ci>k</ci><ci>t</ci></apply></apply>')
    expect(messages(model)).toEqual(['Constitutive relation of element V_in (#V_in) has undeclared name k'])
  })
})
