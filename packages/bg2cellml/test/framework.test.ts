import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  BGF,
  BondgraphFramework,
  DeclarationError,
  RdfGraph,
  cleanName,
  makeVariable,
  readUnits,
  readValue,
  type Domain,
} from '../src/index.js'
import { BGF_ONTOLOGY_IRI, BGF_TEMPLATE_IRI_PREFIX, CDT, bgf, xsd } from '../src/rdf/namespaces.js'
import { frameworkSource } from './reference.js'

/** The framework from the BG-RDF ontology and templates in the bg-rdf submodule. */
function bgRdfFramework(): BondgraphFramework {
  const { ontology, templates } = frameworkSource()
  const graph = new RdfGraph(oxigraph)
  graph.load(ontology, BGF_ONTOLOGY_IRI)
  for (const [name, turtle] of Object.entries(templates)) graph.load(turtle, `${BGF_TEMPLATE_IRI_PREFIX}${name}`)
  return BondgraphFramework.fromGraph(graph)
}

const PREFIXES = `
@prefix bgf: <https://bg-rdf.org/ontologies/bondgraph-framework#> .
@prefix cdt: <https://w3id.org/cdt/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix : <https://example.org/test#> .
`

/** A domain declaration, with any of its parts replaced. */
function domainTurtle(
  name: string,
  parts: { flow?: string; potential?: string; quantity?: string; extra?: string } = {},
): string {
  const flow = parts.flow ?? `bgf:hasFlow [ bgf:varName "v" ; bgf:hasUnits "m/s"^^cdt:ucumunit ]`
  const potential = parts.potential ?? `bgf:hasPotential [ bgf:varName "u" ; bgf:hasUnits "J/m"^^cdt:ucumunit ]`
  const quantity = parts.quantity ?? `bgf:hasQuantity [ bgf:varName "q" ; bgf:hasUnits "m"^^cdt:ucumunit ]`
  return `:${name} a bgf:PhysicalDomain ; ${[flow, potential, quantity, parts.extra].filter(Boolean).join(' ; ')} .\n`
}

/** The framework from Turtle holding domain declarations. */
function frameworkFrom(...domains: string[]): BondgraphFramework {
  const graph = new RdfGraph(oxigraph)
  graph.load(PREFIXES + domains.join('\n'), 'https://example.org/test')
  return BondgraphFramework.fromGraph(graph)
}

const messages = (framework: BondgraphFramework): string[] => framework.log.issues.map((issue) => issue.message)

//==============================================================================

describe('BG-RDF domains', () => {
  let framework: BondgraphFramework
  let domain: (name: string) => Domain

  beforeAll(() => {
    framework = bgRdfFramework()
    domain = (name) => framework.domains.get(bgf(name))!
  })

  it('load the four domains with no issues', () => {
    expect(messages(framework)).toEqual([])
    expect([...framework.domains.keys()]).toEqual(['Chemical', 'Electrical', 'Hydraulic', 'Mechanical'].map(bgf))
  })

  it('give Chemical RT = 2578.73058 J/mol and F = 0.96485e5 C/mol', () => {
    // Sorted by name; Python's order depends on its oxigraph build
    expect(domain('Chemical').constants).toEqual([
      { name: 'F', units: 'C/mol', value: { magnitude: 96485, units: 'C/mol' } },
      { name: 'RT', units: 'J/mol', value: { magnitude: 2578.73058, units: 'J/mol' } },
    ])
  })

  // As the Python bg2cellml 0.11.2 loads them, with its pint units written as UCUM
  it.each([
    ['Chemical', 'mol/s', 'J/mol', 'mol', ['F', 'RT']],
    ['Electrical', 'C/s', 'J/C', 'C', []],
    ['Hydraulic', 'L/s', 'J/L', 'L', ['RT']],
    ['Mechanical', 'm/s', 'J/m', 'm', []],
  ])('give %s its flow, potential and quantity as Python does', (name, flowUnits, potentialUnits, quantityUnits, constants) => {
    const loaded = domain(name)
    expect(loaded).toMatchObject({
      iri: bgf(name),
      name,
      flow: { name: 'v', units: flowUnits, type: BGF.FlowVariable },
      potential: { name: 'u', units: potentialUnits, type: BGF.PotentialVariable },
      quantity: { name: 'q', units: quantityUnits, type: BGF.QuantityVariable },
      intrinsicSymbols: ['v', 'u', 'q'],
    })
    expect(loaded.label).toBeUndefined()
    expect(loaded.constants.map((constant) => constant.name)).toEqual(constants)
  })

  it('give Hydraulic the same RT as Chemical', () => {
    expect(domain('Hydraulic').constants[0]).toEqual(domain('Chemical').constants[1])
  })
})

//==============================================================================

describe('domain declarations', () => {
  it('load a domain with a label, constants and cleaned names', () => {
    const framework = frameworkFrom(
      domainTurtle('Test', {
        flow: `bgf:hasFlow [ bgf:varName "v-x" ; bgf:hasUnits "m/s"^^cdt:ucumunit ]`,
        extra: `rdfs:label "Test domain" ; bgf:hasConstant [ bgf:varName "k.1" ; bgf:hasValue "1e-3 mol"^^cdt:ucum ]`,
      }),
    )
    expect(messages(framework)).toEqual([])
    expect(framework.domains.get('https://example.org/test#Test')).toMatchObject({
      name: 'Test',
      label: 'Test domain',
      flow: { name: 'v_x' },
      constants: [{ name: 'k_1', units: 'mol', value: { magnitude: 0.001, units: 'mol' } }],
      intrinsicSymbols: ['v_x', 'u', 'q'],
    })
  })

  it.each([
    [
      'units that are a plain string',
      { quantity: `bgf:hasQuantity [ bgf:varName "q" ; bgf:hasUnits "m" ]` },
      `Units value has unexpected datatype: <${xsd('string')}>`,
    ],
    [
      'units that are not UCUM',
      { quantity: `bgf:hasQuantity [ bgf:varName "q" ; bgf:hasUnits "m^2"^^cdt:ucumunit ]` },
      `Variable q for <https://example.org/test#Bad> has no valid units: Can't read units "m^2": Write the exponent straight after the units, e.g. m2 or s-1`,
    ],
    [
      'arbitrary units',
      { flow: `bgf:hasFlow [ bgf:varName "v" ; bgf:hasUnits "[iU]/s"^^cdt:ucumunit ]` },
      `Variable v for <https://example.org/test#Bad> has no valid units: "[iU]" in "[iU]/s" is an arbitrary units, which can't be related to CellML units`,
    ],
    [
      'a constant that is a plain number',
      { extra: `bgf:hasConstant [ bgf:varName "K" ; bgf:hasValue 10.0 ]` },
      'Variable K for <https://example.org/test#Bad> has no Units specified',
    ],
    [
      'a constant that is not a number',
      { extra: `bgf:hasConstant [ bgf:varName "K" ; bgf:hasValue "ten J"^^cdt:ucum ]` },
      `Can't read a number from "ten J"`,
    ],
    [
      'a constant with no units in its cdt:ucum literal',
      { extra: `bgf:hasConstant [ bgf:varName "K" ; bgf:hasValue "10"^^cdt:ucum ]` },
      `Can't read "10" as a number and its units`,
    ],
    [
      'a constant that is a string',
      { extra: `bgf:hasConstant [ bgf:varName "K" ; bgf:hasValue "10 J" ]` },
      `Literal value has unexpected datatype: <${xsd('string')}>`,
    ],
    [
      'two constants with one name',
      { extra: `bgf:hasConstant [ bgf:varName "K" ; bgf:hasValue "1 J"^^cdt:ucum ], [ bgf:varName "K" ; bgf:hasValue "2 J"^^cdt:ucum ]` },
      'Domain <https://example.org/test#Bad> has more than one constant named K',
    ],
    [
      'no quantity',
      { quantity: `bgf:hasQuantity [ bgf:varName "q" ]` },
      'Domain <https://example.org/test#Bad> needs a flow, a potential and a quantity, each with a bgf:varName and bgf:hasUnits',
    ],
    [
      'two flows',
      { extra: `bgf:hasFlow [ bgf:varName "w" ; bgf:hasUnits "m/s"^^cdt:ucumunit ]` },
      'Domain <https://example.org/test#Bad> has more than one flow, potential, quantity or label',
    ],
  ])('report a domain with %s and leave it out', (_case, parts, message) => {
    const framework = frameworkFrom(domainTurtle('Good'), domainTurtle('Bad', parts))
    expect(messages(framework)).toEqual([message])
    expect(framework.log.issues[0]!.subject).toBe('https://example.org/test#Bad')
    expect([...framework.domains.keys()]).toEqual(['https://example.org/test#Good'])
  })
})

//==============================================================================

describe('literals', () => {
  const { literal, namedNode } = oxigraph
  const ucum = (text: string) => literal(text, namedNode(CDT.ucum))
  const error = (read: () => unknown): string => {
    try {
      read()
    } catch (thrown) {
      if (thrown instanceof DeclarationError) return thrown.message
      throw thrown
    }
    return ''
  }

  it('reads cdt:ucum values', () => {
    expect(readValue(ucum('0.96485e5 C/mol'))).toEqual({ magnitude: 96485, units: 'C/mol' })
    expect(readValue(ucum(' -2.5  mV '))).toEqual({ magnitude: -2.5, units: 'mV' })
    expect(readValue(ucum('.5 s'))).toEqual({ magnitude: 0.5, units: 's' })
  })

  it('reads plain numbers, which Python rejects', () => {
    expect(readValue(literal('10.0', namedNode(xsd('decimal'))))).toEqual({ magnitude: 10 })
    expect(readValue(literal('3', namedNode(xsd('integer'))))).toEqual({ magnitude: 3 })
    expect(readValue(literal('1.5E2', namedNode(xsd('double'))))).toEqual({ magnitude: 150 })
  })

  it('rejects what it can’t read', () => {
    expect(error(() => readValue(ucum('1,5 m')))).toBe(`Can't read a number from "1,5 m"`)
    expect(error(() => readValue(ucum('Infinity m')))).toBe(`Can't read a number from "Infinity m"`)
    expect(error(() => readValue(ucum('1 m s')))).toBe(`Can't read "1 m s" as a number and its units`)
    expect(error(() => readValue(namedNode('https://example.org/x')))).toBe('Literal value has unexpected datatype: NamedNode')
    expect(error(() => readValue(ucum('1 furlong')))).toBe('Value has no valid units: Unknown units "furlong" in "furlong"')
  })

  it('reads cdt:ucumunit units', () => {
    expect(readUnits(literal('mol/s', namedNode(CDT.ucumunit)))).toBe('mol/s')
    expect(error(() => readUnits(literal('mol/s', namedNode(CDT.ucum))))).toBe(`Units value has unexpected datatype: <${CDT.ucum}>`)
  })

  it('gives a variable the units of its value, or a value the units of its variable', () => {
    const units = literal('J', namedNode(CDT.ucumunit))
    expect(makeVariable('https://example.org/x', 'k', { value: ucum('2 mJ') })).toEqual({
      name: 'k',
      units: 'mJ',
      value: { magnitude: 2, units: 'mJ' },
    })
    expect(makeVariable('https://example.org/x', 'k', { units, value: literal('10', namedNode(xsd('integer'))) })).toEqual({
      name: 'k',
      units: 'J',
      value: { magnitude: 10, units: 'J' },
    })
    expect(makeVariable('https://example.org/x', 'k', { units, type: BGF.FlowVariable })).toEqual({
      name: 'k',
      units: 'J',
      type: BGF.FlowVariable,
    })
  })

  it('cleans names as Python does', () => {
    expect(cleanName('a:b-c.d e')).toBe('a_b_c_d_e')
    expect(cleanName('v_1')).toBe('v_1')
  })
})
