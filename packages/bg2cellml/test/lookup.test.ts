import { beforeAll, describe, expect, it } from 'vitest'

import { elementTemplateOf, fragment, isCompositeTemplate, type BondgraphFramework } from '../src/index.js'
import { bgf } from '../src/rdf/namespaces.js'
import {
  TEST_IRI,
  bgRdfFramework,
  domainTurtle,
  frameworkFrom,
  frameworkRuntime,
  mathml,
  messages,
} from './framework-fixtures.js'
import { FORK_ADDITIONS, loadPythonFramework } from './reference.js'

const python = loadPythonFramework()
let framework: BondgraphFramework

beforeAll(async () => {
  await frameworkRuntime()
  framework = bgRdfFramework()
})

const short = (iri: string | null | undefined): string => (iri == null ? 'nothing' : fragment(iri))
/** Python's IRIs and the fork's additions, sorted. */
const withFork = (python: readonly string[], added: readonly string[]): string[] => [...python, ...added.map(bgf)].sort()

describe('BG-RDF junctions and composites', () => {
  it('load with no issues', () => {
    expect(messages(framework)).toEqual([])
  })

  it('have the junction structures Python has, including the composites and bgf:JunctionStructure', () => {
    expect([...framework.junctions.keys()].sort()).toEqual(withFork(Object.keys(python.junctions), FORK_ADDITIONS.junctions))
    for (const theirs of Object.values(python.junctions)) {
      const ours = framework.junction(theirs.iri)!
      // Python holds the label as the symbol, falling back to the IRI's fragment
      expect(ours.label ?? fragment(ours.iri)).toBe(theirs.symbol)
    }
    expect(framework.junction(bgf('JunctionStructure'))).toBeDefined()
    expect(framework.junction(bgf('ChemicalStorageNode'))).toBeDefined()
  })

  it('have the composites Python has, each with its element template', () => {
    expect([...framework.compositeTemplates.keys()].sort()).toEqual(withFork(Object.keys(python.compositeTemplates), FORK_ADDITIONS.compositeTemplates))
    for (const theirs of Object.values(python.compositeTemplates)) {
      const ours = framework.compositeTemplates.get(theirs.iri)!
      expect(ours.template.iri).toBe(theirs.template)
      expect(ours.label ?? fragment(ours.iri)).toBe(theirs.symbol)
    }
  })
})

describe('elementTemplate()', () => {
  it.each(Object.entries(python.lookups.byType).map(([type, template]) => [short(type), type, template]))(
    'finds %s as Python does',
    (_name, type, template) => {
      expect(framework.elementTemplate(type!)?.iri ?? null).toBe(template)
    },
  )

  // Where a domain has two templates of a class, Python uses the last by IRI; we find nothing, so it can be reported
  const AMBIGUOUS: Record<string, string[]> = {
    'Reaction Chemical': ['ChemicalReaction', 'NKETransporter'],
    'QuantityStore Hydraulic': ['ElasticVessel', 'HydraulicStorage'],
    'Reaction Hydraulic': ['OldOsmosis', 'OsmoticTransporter'],
  }

  // The fork's templates make more choices, where Python's framework had one or two
  const FORK_CHOICES: Record<string, string[]> = {
    'Reaction Chemical': ['SaturatingChemicalReaction'],
    'QuantityStore Chemical': ['SaturatingChemicalConcentration'],
    'Resistance Hydraulic': ['BernoulliHydraulicResistor'],
  }

  it.each(
    python.lookups.byClassAndDomain
      .filter((l) => !(`${short(l.elementClass)} ${short(l.domain)}` in AMBIGUOUS || `${short(l.elementClass)} ${short(l.domain)}` in FORK_CHOICES))
      .map((l) => [short(l.elementClass), short(l.domain), short(l.template), l]),
  )('finds a %s in %s as Python does: %s', (_class, _domain, _template, lookup) => {
    expect(framework.elementTemplate(lookup.elementClass, lookup.domain)?.iri ?? null).toBe(lookup.template)
  })

  it.each(Object.entries(AMBIGUOUS))('finds nothing for a %s, which could be %s', (key, choices) => {
    const [elementClass, domain] = key.split(' ').map(bgf) as [string, string]
    const pythonChoice = python.lookups.byClassAndDomain.find((l) => l.elementClass === elementClass && l.domain === domain)!.template
    expect(pythonChoice).toBe(bgf(choices.at(-1)!))
    expect(framework.elementTemplate(elementClass, domain)).toBeUndefined()
    expect(framework.templatesOfClass(elementClass, domain).map((t) => t.iri)).toEqual(withFork(choices.map(bgf), FORK_CHOICES[key] ?? []))
  })

  it.each(Object.entries(FORK_CHOICES).filter(([key]) => !(key in AMBIGUOUS)))(
    "finds nothing for a %s, which the fork's %s makes ambiguous",
    (key, added) => {
      const [elementClass, domain] = key.split(' ').map(bgf) as [string, string]
      const pythonChoice = python.lookups.byClassAndDomain.find((l) => l.elementClass === elementClass && l.domain === domain)!.template!
      expect(framework.elementTemplate(elementClass, domain)).toBeUndefined()
      expect(framework.templatesOfClass(elementClass, domain).map((t) => t.iri)).toEqual(withFork([pythonChoice], added))
    },
  )

  it('says why a class and domain finds nothing', () => {
    expect(framework.templateIssue(bgf('Reaction'), bgf('Chemical'))).toBe(
      'bgf:Reaction in bgf:Chemical is ambiguous: it could be bgf:ChemicalReaction, bgf:NKETransporter, bgf:SaturatingChemicalReaction. Give the template instead.',
    )
    expect(framework.templateIssue(bgf('Resistance'), bgf('Chemical'))).toBe('bgf:Resistance has no template in bgf:Chemical')
    expect(framework.templatesOfClass(bgf('Resistance'), bgf('Chemical'))).toEqual([])
    expect(framework.templateIssue(bgf('Resistance'), bgf('Electrical'))).toBeUndefined()
  })

  it('resolves every element type in the 14 examples to the template Python does', () => {
    const elements = python.lookups.examples.filter((l) => 'element' in l)
    expect(new Set(elements.map((l) => l.example)).size).toBe(14)
    for (const lookup of elements) {
      const found = framework.elementTemplate(lookup.type, lookup.domain ?? undefined)
      expect(found?.iri ?? null, `${lookup.example}: ${short(lookup.element)} a ${short(lookup.type)}`).toBe(lookup.template)
    }
  })

  it('knows every junction type in the 14 examples, as Python does', () => {
    const junctions = python.lookups.examples.filter((l) => 'junction' in l)
    expect(junctions.length).toBeGreaterThan(0)
    for (const lookup of junctions) {
      expect(framework.junction(lookup.type) !== undefined, `${lookup.example}: ${short(lookup.junction)}`).toBe(lookup.known)
    }
  })

  it('checks composites first, and tells them apart', () => {
    const composite = framework.elementTemplate(bgf('ChemicalStorageNode'))!
    expect(isCompositeTemplate(composite)).toBe(true)
    expect(elementTemplateOf(composite).iri).toBe(bgf('ChemicalConcentration'))
    const template = framework.elementTemplate(bgf('ChemicalConcentration'))!
    expect(isCompositeTemplate(template)).toBe(false)
    expect(elementTemplateOf(template)).toBe(template)
  })

  it('finds nothing for an unknown type, or a template or composite given with a domain', () => {
    expect(framework.elementTemplate(bgf('Unknown'))).toBeUndefined()
    expect(framework.elementTemplate(bgf('ElectricalResistor'), bgf('Electrical'))).toBeUndefined()
    expect(framework.elementTemplate(bgf('ElectricalResistiveNode'), bgf('Electrical'))).toBeUndefined()
    expect(framework.elementTemplate(bgf('Resistance'), bgf('Chemical'))).toBeUndefined()
  })

})

//==============================================================================

const iri = (name: string): string => `${TEST_IRI}${name}`

const RESISTOR = `:Resistor a bgf:ElementTemplate ; rdfs:subClassOf bgf:Resistance ; bgf:hasDomain :Test ;
    bgf:hasParameter [ bgf:varName "R" ; bgf:hasUnits "J.s.m-2"^^cdt:ucumunit ] ;
    bgf:constitutiveRelation ${mathml('<apply><eq/><ci>v</ci><apply><divide/><ci>u</ci><ci>R</ci></apply></apply>')} .`

describe('composite and junction declarations', () => {
  it('load a composite with a label, and a junction', () => {
    const framework = frameworkFrom(
      domainTurtle('Test'),
      RESISTOR,
      ':ResistorNode a bgf:CompositeTemplate ; rdfs:label "Resistor with a one node" ; rdfs:subClassOf :Resistor .',
      ':TestNode rdfs:subClassOf bgf:OneNode ; rdfs:label "Test node" .',
    )
    expect(messages(framework)).toEqual([])
    expect(framework.compositeTemplates.get(iri('ResistorNode'))).toMatchObject({ label: 'Resistor with a one node', template: { iri: iri('Resistor') } })
    expect(framework.junction(iri('TestNode'))).toEqual({ iri: iri('TestNode'), label: 'Test node' })
    expect(framework.junction(bgf('OneNode'))).toEqual({ iri: bgf('OneNode'), label: 'One node' })
  })

  it.each([
    [
      'a composite of a template that failed to load',
      [':Broken a bgf:ElementTemplate ; rdfs:subClassOf bgf:Resistance ; bgf:hasDomain :Test .', ':BrokenNode a bgf:CompositeTemplate ; rdfs:subClassOf :Broken .'],
      [`BondElement ${iri('Broken')} has no constitutive relation`, `Unknown BondElement <${iri('Broken')}> for composite <${iri('BrokenNode')}>`],
    ],
    [
      'a composite of two templates',
      [`${RESISTOR.replace(':Resistor a', ':Other a')}`, ':BothNode a bgf:CompositeTemplate ; rdfs:subClassOf :Resistor, :Other .'],
      [`Composite <${iri('BothNode')}> has more than one element template or label`],
    ],
    [
      'a junction with two labels',
      [':TwoNode rdfs:subClassOf bgf:ZeroNode ; rdfs:label "One", "Two" .'],
      [`Junction <${iri('TwoNode')}> has more than one label`],
    ],
  ])('report %s and leave it out', (_case, turtle, expected) => {
    const framework = frameworkFrom(domainTurtle('Test'), RESISTOR, ...turtle)
    expect(messages(framework)).toEqual(expected)
    expect([...framework.compositeTemplates.keys()]).toEqual([])
    expect(framework.junction(iri('TwoNode'))).toBeUndefined()
  })
})
