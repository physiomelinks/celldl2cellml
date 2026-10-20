/**
 * Plan chunk 5.1: a model's elements, their templates, symbols, ports,
 * variables and values, checked against the Python bg2cellml's intermediate
 * fixtures (test/reference/models) and on hand-written models.
 */

import { equals } from '@physiomelinks/math-ast'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  BGF,
  BondgraphModel,
  CDT,
  NAMESPACES,
  cleanLatex,
  elementVariableName,
  fragment,
  makeSymbolicName,
  prettyName,
  prettyUri,
  type BondgraphElement,
  type BondgraphFramework,
  type ModelRuntime,
  type ModelVariable,
  type ValueAssignment,
} from '../src/index.js'
import { bgRdfFramework, expectSameUnits, frameworkRuntime } from './framework-fixtures.js'
import { forPython, pythonEquation } from './python-math.js'
import {
  loadManifest,
  loadPythonModel,
  readSource,
  type PythonModelElement,
  type PythonTerm,
  type PythonVariable,
  type ReferenceCase,
} from './reference.js'

const manifest = loadManifest()
let framework: BondgraphFramework
let runtime: ModelRuntime

beforeAll(async () => {
  runtime = { ...(await frameworkRuntime()), oxigraph }
  framework = bgRdfFramework()
})

/** As loaded, before the network is built and values are assigned (5.4). */
const loadCase = (c: ReferenceCase): BondgraphModel =>
  BondgraphModel.fromTurtle(framework, runtime, readSource(c), c.baseIri, { until: 'elements' })
const messages = (model: BondgraphModel): string[] => model.log.issues.map((issue) => issue.message)
const caseNamed = (name: string): ReferenceCase => manifest.cases.find((c) => c.name === name)!
const bgf = (name: string): string => `${NAMESPACES.bgf}${name}`

function expectVariable(ours: ModelVariable | undefined, theirs: PythonVariable | null, context: string): void {
  expect(ours, context).toBeDefined()
  expect(theirs, context).not.toBeNull()
  expect(ours!.name, context).toBe(theirs!.name)
  expect(ours!.symbol, context).toBe(theirs!.symbol)
  expect(ours!.type ?? null, context).toBe(theirs!.type)
  expectSameUnits(ours!.units, theirs!.units)
  if (theirs!.value === null) {
    expect(ours!.value, context).toBeUndefined()
  } else {
    expect(ours!.value?.magnitude, context).toBe(theirs!.value.magnitude)
    expectSameUnits(ours!.value!.units!, theirs!.value.units)
  }
}

/** A value as Python read it, which it keeps as the RDF term. */
function expectAssignment(ours: ValueAssignment | undefined, theirs: { value: PythonTerm; symbol: string | null }, context: string): void {
  expect(ours, context).toBeDefined()
  expect(ours!.symbol ?? null, context).toBe(theirs.symbol)
  const term = theirs.value
  if ('iri' in term) {
    expect(ours!.element, context).toBe(term.iri)
  } else if (term.datatype === CDT.ucum) {
    const [magnitude, units] = term.literal.trim().split(/\s+/)
    expect(ours!.value, context).toEqual({ magnitude: Number(magnitude), units })
  } else {
    expect(ours!.value, context).toEqual({ magnitude: Number(term.literal) })
  }
}

function expectElement(ours: BondgraphElement | undefined, theirs: PythonModelElement): void {
  const context = theirs.iri
  expect(ours, context).toBeDefined()
  expect(ours!.symbol, context).toBe(theirs.symbol)
  expect(ours!.label ?? null, context).toBe(theirs.label)
  expect(ours!.elementTemplate.iri, context).toBe(theirs.template)
  expect(ours!.elementClass, context).toBe(theirs.elementClass)
  expect(ours!.domain.iri, context).toBe(theirs.domain)
  expect(ours!.impliedJunction ?? null, context).toBe(theirs.impliedJunction)

  expect([...ours!.ports.keys()], context).toEqual(Object.keys(theirs.ports))
  for (const [iri, port] of Object.entries(theirs.ports)) {
    const ourPort = ours!.ports.get(iri)!
    expect(ourPort.iri).toBe(iri)
    expect(ourPort.template.iri, iri).toBe(port.iri)
    expect(ourPort.template.direction ?? null, iri).toBe(port.direction)
    expect(ourPort.template.bondCount, iri).toBe(port.bondCount)
    expect(ourPort.template.flow.name, iri).toBe(port.flow.name)
    expect(ourPort.template.potential.name, iri).toBe(port.potential.name)
    expectVariable(ourPort.flow, port.flow.variable, `${iri} flow`)
    expectVariable(ourPort.potential, port.potential.variable, `${iri} potential`)
  }

  expect([...ours!.variables.keys()].sort(), context).toEqual(Object.keys(theirs.variables).sort())
  for (const [name, variable] of Object.entries(theirs.variables)) expectVariable(ours!.variables.get(name), variable, `${context} ${name}`)
  expect([...ours!.portVariableNames].sort(), context).toEqual(theirs.portVariableNames)
  if (theirs.intrinsicVariable === null) expect(ours!.intrinsicVariable, context).toBeUndefined()
  else expectVariable(ours!.intrinsicVariable, theirs.intrinsicVariable, `${context} intrinsic`)
  expect(ours!.flow?.symbol ?? null, context).toBe(theirs.flow)
  expect(ours!.potential?.symbol ?? null, context).toBe(theirs.potential)

  expect([...ours!.values.keys()].sort(), context).toEqual(Object.keys(theirs.values).sort())
  for (const [name, value] of Object.entries(theirs.values)) expectAssignment(ours!.values.get(name), value, `${context} ${name}`)

  if (theirs.constitutiveRelation === null) {
    expect(ours!.constitutiveRelation, context).toBeUndefined()
  } else {
    expect(ours!.constitutiveRelation, context).toHaveLength(theirs.constitutiveRelation.length)
    theirs.constitutiveRelation.forEach((equation, index) => {
      const ourEquation = forPython(ours!.constitutiveRelation![index]!)
      expect(equals(ourEquation, pythonEquation(equation.mathml)), `${context}: ${equation.text}`).toBe(true)
    })
  }
}

//==============================================================================

describe('elements of the reference models', () => {
  describe.each(manifest.cases.filter((c) => c.intermediate !== undefined))('$name', (c) => {
    let model: BondgraphModel
    let python: ReturnType<typeof loadPythonModel>

    beforeAll(() => {
      model = loadCase(c)
      python = loadPythonModel(c)
    })

    it('loads with no issues', () => {
      expect(messages(model)).toEqual([])
    })

    it('is the model Python finds', () => {
      expect(model.iri).toBe(python.model.iri)
      expect(model.label ?? null).toBe(python.model.label)
    })

    it('has the elements Python has, in the same order', () => {
      expect([...model.elements.keys()]).toEqual(python.elements.map((element) => element.iri))
    })

    it('gives each element the template, symbol, ports, variables, values and relation Python does', () => {
      for (const element of python.elements) expectElement(model.elements.get(element.iri), element)
    })
  })
})

describe("variants Python can't load", () => {
  /** An element as a case-independent summary, keyed by the IRI's fragment. */
  const summary = (model: BondgraphModel): Record<string, unknown> =>
    Object.fromEntries(
      [...model.elements.values()].map((element) => [
        fragment(element.iri),
        {
          symbol: element.symbol,
          template: element.template.iri,
          variables: Object.fromEntries([...element.variables].map(([name, v]) => [name, [v.symbol, v.units, v.value]])),
          values: Object.fromEntries(element.values),
        },
      ]),
    )

  it('RC_plain_number loads, with R as a plain number that will take its units', () => {
    const model = loadCase(caseNamed('RC_plain_number'))
    expect(messages(model)).toEqual([])
    const expected = summary(loadCase(caseNamed('example_RC')))
    ;(expected['R_0'] as { values: Record<string, unknown> }).values = { R: { value: { magnitude: 10 } } }
    expect(summary(model)).toEqual(expected)
  })

  it('RC_labelled_bonds has the elements of example_RC', () => {
    const model = loadCase(caseNamed('RC_labelled_bonds'))
    expect(messages(model)).toEqual([])
    expect(summary(model)).toEqual(summary(loadCase(caseNamed('example_RC'))))
  })
})

//==============================================================================

describe('names', () => {
  it.each([
    ['Na^+', 'Na_'],
    ['\\mathrm{Na^+}', 'Na_'],
    [' \\text{in} ', 'in'],
    ['Ca^{2+}', 'Ca_2'],
    ['\\alpha', 'alpha'],
    ['K_{out}', 'K_out'],
    ['x y', 'xy'],
    ['__a', 'a'],
    ['\\mathrm{Ca}^{2+}', 'Ca_2'],
    ['\\text{cyto}\\,\\text{sol}', 'cyto_sol'],
  ])('cleanLatex(%j) is %j, as in Python', (latex, name) => {
    expect(cleanLatex(latex)).toBe(name)
  })

  it('makes symbols from bgf:hasSymbol or the IRI, with species and location', () => {
    const iri = 'https://example.org/model#q_1'
    expect(makeSymbolicName({ iri })).toBe('q_1')
    expect(makeSymbolicName({ iri, symbol: 'q' })).toBe('q')
    expect(makeSymbolicName({ iri, species: 'Na^+', location: '\\text{in}' })).toBe('q_1_Na__in')
    expect(makeSymbolicName({ iri: 'https://example.org/models/q_2' })).toBe('q_2')
  })

  it("names an element's variables as Python does", () => {
    const electrical = framework.domains.get(bgf('Electrical'))!
    expect(elementVariableName('q', 'q_1', electrical)).toBe('q_1')
    expect(elementVariableName('R', 'R_0', electrical)).toBe('R_R_0')
    expect(elementVariableName('u', 'V_in', electrical)).toBe('u_V_in')
    expect(elementVariableName('u', 'u_in', electrical)).toBe('u_in')
    expect(elementVariableName('u_f', 'Re', electrical)).toBe('u_f_Re')
    expect(elementVariableName('v', 'v-1.a', electrical)).toBe('v_1_a')
  })

  it('prints names as Python does', () => {
    expect(prettyUri('https://example.org/model.ttl#R_0')).toBe('#R_0')
    expect(prettyUri('https://bg-rdf.org/models/local/abc#R_0')).toBe('abc#R_0')
    expect(prettyUri('https://example.org/R_0')).toBe('https://example.org/R_0')
    expect(prettyName('R_0', 'https://example.org/model.ttl#R_0')).toBe('R_0 (#R_0)')
  })
})

//==============================================================================

const BASE = 'https://example.org/model.ttl'

/** A model from hand-written Turtle: `elements` are its bond elements. */
function modelFrom(elements: string, body: string): BondgraphModel {
  const turtle = `
@prefix bgf: <https://bg-rdf.org/ontologies/bondgraph-framework#> .
@prefix cdt: <https://w3id.org/cdt/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix : <#> .
:model a bgf:BondgraphModel ; bgf:hasBondElement ${elements} .
${body}`
  return BondgraphModel.fromTurtle(framework, runtime, turtle, BASE, { until: 'elements' })
}

const resistor = (name: string, extra = ''): string =>
  `:${name} a bgf:ElectricalResistor ; bgf:parameterValue [ bgf:varName "R" ; bgf:hasValue "10 Ohm"^^cdt:ucum ] ${extra}.`

const SINE = `"""<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>u</ci>
  <apply><times/><cn>5</cn><apply><sin/><ci>t</ci></apply></apply></apply></math>"""^^bgf:mathml`

describe('loading elements', () => {
  it('needs exactly one bgf:BondgraphModel', () => {
    const none = BondgraphModel.fromTurtle(framework, runtime, '', BASE, { until: 'elements' })
    expect(messages(none)).toEqual(['No BondgraphModels defined in RDF source'])
    const two = BondgraphModel.fromTurtle(
      framework,
      runtime,
      '@prefix bgf: <https://bg-rdf.org/ontologies/bondgraph-framework#> . <#a> a bgf:BondgraphModel . <#b> a bgf:BondgraphModel .',
      BASE,
    )
    expect(messages(two)).toEqual(["Multiple BondgraphModels defined in RDF source -- a model's URI must be given"])
  })

  it('reports Turtle that will not parse', () => {
    const model = BondgraphModel.fromTurtle(framework, runtime, '<#a> a ', BASE)
    expect(messages(model)).toHaveLength(1)
    expect(model.log.issues[0]).toMatchObject({ severity: 'error', stage: 'input' })
    expect(model.iri).toBe('')
  })

  it('reports a model with no valid elements', () => {
    const model = modelFrom(':x', ':x a bgf:NoSuchThing .')
    expect(messages(model)).toEqual([
      'bgf:NoSuchThing element x (#x) is not instantiated: there is no template for it',
      'Model #model has no valid elements',
    ])
  })

  it('finds a template from an element class and domain', () => {
    const model = modelFrom(':R_0', ':R_0 a bgf:Resistance ; bgf:hasDomain bgf:Electrical ; bgf:parameterValue [ bgf:varName "R" ; bgf:hasValue "10 Ohm"^^cdt:ucum ] .')
    expect(messages(model)).toEqual([])
    expect(model.elements.get(`${BASE}#R_0`)!.elementTemplate.iri).toBe(bgf('ElectricalResistor'))
  })

  it('reports a class with more than one template in the domain', () => {
    const model = modelFrom(':Re, :R_0', `:Re a bgf:Reaction ; bgf:hasDomain bgf:Chemical . ${resistor('R_0')}`)
    expect(messages(model)).toEqual([
      'Element Re (#Re): bgf:Reaction in bgf:Chemical is ambiguous: it could be bgf:ChemicalReaction, bgf:NKETransporter. Give the template instead.',
    ])
    expect([...model.elements.keys()]).toEqual([`${BASE}#R_0`])
  })

  it('reports an element with two templates, or two symbols', () => {
    const model = modelFrom(
      ':R_0, :R_1, :R_2',
      `${resistor('R_0', '; a bgf:ElectricalCapacitor')} ${resistor('R_1', '; bgf:hasSymbol "a", "b"')} ${resistor('R_2')}`,
    )
    expect(messages(model)).toEqual([
      'Element R_0 (#R_0) has more than one template: bgf:ElectricalCapacitor, bgf:ElectricalResistor',
      `Element <${BASE}#R_1> has more than one bgf:hasSymbol`,
    ])
    expect([...model.elements.keys()]).toEqual([`${BASE}#R_2`])
    expect(model.log.issues.map(({ severity, stage, elementId }) => ({ severity, stage, elementId }))).toEqual([
      { severity: 'error', stage: 'model', elementId: 'R_0' },
      { severity: 'error', stage: 'model', elementId: 'R_1' },
    ])
  })

  it('names elements from bgf:hasSymbol, bgf:hasSpecies and bgf:hasLocation', () => {
    const model = modelFrom(
      ':q_1',
      `:q_1 a bgf:ChemicalConcentration ; bgf:hasSymbol "q" ; bgf:hasSpecies "Na^+" ; bgf:hasLocation "\\\\text{in}" ; rdfs:label "Sodium" ;
         bgf:hasValue "1 mol"^^cdt:ucum ; bgf:parameterValue [ bgf:varName "K" ; bgf:hasValue "2 mol-1"^^cdt:ucum ] .`,
    )
    expect(messages(model)).toEqual([])
    const element = model.elements.get(`${BASE}#q_1`)!
    expect(element.symbol).toBe('q_Na__in')
    expect(element.label).toBe('Sodium')
    expect(element.variables.get('K')!.name).toBe('K_q_Na__in')
    expect(element.intrinsicVariable!.name).toBe('q_Na__in')
    expect(element.intrinsicVariable!.value).toEqual({ magnitude: 1, units: 'mol' })
  })

  it('reads parameter and variable values: numbers, plain numbers, symbols and other elements', () => {
    const model = modelFrom(
      ':R_0, :R_1',
      `:R_0 a bgf:ElectricalResistor ; bgf:parameterValue [ bgf:varName "R" ; bgf:hasValue 10.0 ; bgf:hasSymbol "R_a" ] .
       :R_1 a bgf:ElectricalResistor ; bgf:parameterValue [ bgf:varName "R" ; bgf:hasValue :R_0 ] .`,
    )
    expect(messages(model)).toEqual([])
    expect(model.elements.get(`${BASE}#R_0`)!.values.get('R')).toEqual({ value: { magnitude: 10 }, symbol: 'R_a' })
    expect(model.elements.get(`${BASE}#R_1`)!.values.get('R')).toEqual({ element: `${BASE}#R_0` })
  })

  it('reports missing, unknown and unreadable values', () => {
    const model = modelFrom(
      ':R_0, :R_1, :R_2',
      `:R_0 a bgf:ElectricalResistor .
       ${resistor('R_1', '; bgf:variableValue [ bgf:varName "X" ; bgf:hasValue "1 V"^^cdt:ucum ] ; bgf:parameterValue [ bgf:varName "Y" ; bgf:hasValue 1 ]')}
       :R_2 a bgf:ElectricalResistor ; bgf:parameterValue [ bgf:varName "R" ; bgf:hasValue "ten" ] .`,
    )
    expect(messages(model)).toEqual([
      'Missing value for parameter R of element R_0 (#R_0)',
      'Unknown variable X for element R_1 (#R_1)',
      `Element R_1 (#R_1) has unknown name Y for ${bgf('ElectricalResistor')}`,
      'Literal value has unexpected datatype: <http://www.w3.org/2001/XMLSchema#string>, for R of element R_2 (#R_2)',
      'Missing value for parameter R of element R_2 (#R_2)',
    ])
  })

  it("gives a store's or source's value to its intrinsic variable, in the variable's units if it has none", () => {
    const model = modelFrom(
      ':q_1, :V_in',
      `:q_1 a bgf:ElectricalCapacitor ; bgf:hasValue 0.5 ; bgf:parameterValue [ bgf:varName "C" ; bgf:hasValue "1 F"^^cdt:ucum ] .
       :V_in a bgf:VoltageSource ; bgf:hasValue "10000 mV"^^cdt:ucum .`,
    )
    expect(messages(model)).toEqual([])
    const capacitor = model.elements.get(`${BASE}#q_1`)!
    expect(capacitor.intrinsicVariable!.value).toEqual({ magnitude: 0.5, units: capacitor.intrinsicVariable!.units })
    const source = model.elements.get(`${BASE}#V_in`)!
    expect(source.intrinsicVariable!.value).toEqual({ magnitude: 10000, units: 'mV' })
    // A potential source's port potential is its intrinsic variable
    expect(source.ports.get(`${BASE}#V_in`)!.potential).toBe(source.intrinsicVariable)
    expect(source.potential).toBe(source.intrinsicVariable)
  })

  it("reports a value an element can't use, or in incompatible units", () => {
    const model = modelFrom(
      ':R_0, :q_1, :V_in',
      `${resistor('R_0', '; bgf:hasValue "1 Ohm"^^cdt:ucum')}
       :q_1 a bgf:ElectricalCapacitor ; bgf:hasValue "1 V"^^cdt:ucum ; bgf:parameterValue [ bgf:varName "C" ; bgf:hasValue "1 F"^^cdt:ucum ] .
       :V_in a bgf:VoltageSource ; bgf:hasValue "1 V"^^cdt:ucum, "2 V"^^cdt:ucum .`,
    )
    expect(messages(model)).toEqual([
      'Element R_0 (#R_0) has a value, but bgf:ElectricalResistor has no intrinsic variable to give it to',
      'Element V_in (#V_in) has more than one bgf:hasValue',
      'Value for variable q_1 has incompatible units (C != V)',
    ])
  })

  it("takes a source's constitutive relation from MathML it is given as its value", () => {
    const model = modelFrom(':V_in, :R_0', `:V_in a bgf:VoltageSource ; bgf:hasValue ${SINE} . ${resistor('R_0', `; bgf:hasValue ${SINE}`)}`)
    expect(messages(model)).toEqual(['Element R_0 (#R_0) has MathML as its value, but only a source can'])
    const source = model.elements.get(`${BASE}#V_in`)!
    expect(source.constitutiveRelation).toHaveLength(1)
    expect(source.constitutiveRelation![0]!.left).toEqual({ type: 'Identifier', name: 'u' })
    expect(source.intrinsicVariable!.value).toBeUndefined()
  })
})
