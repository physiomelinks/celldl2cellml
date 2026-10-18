/**
 * Plan chunk 5.2: a model's junctions and bonds, and the bond network they
 * make, checked against the Python bg2cellml's intermediate fixtures
 * (test/reference/models) and on hand-written models.
 *
 * Python swaps a bond's label and count (model.py:233), so it ignores
 * `bgf:bondCount` on bonds. We read it, and so differ from Python where a
 * model gives one: in BG-RDF's examples, two bonds in each of example_B2 and
 * example_B2_reduced. Python's fixtures hold the count it ignored as the
 * bond's label, which is what we compare our counts with.
 */

import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  BondgraphModel,
  CDT,
  NAMESPACES,
  curie,
  fragment,
  type BondgraphFramework,
  type ModelRuntime,
} from '../src/index.js'
import { bgRdfFramework, frameworkRuntime } from './framework-fixtures.js'
import { loadManifest, loadPythonModel, readSource, type PythonBond, type PythonModel, type ReferenceCase } from './reference.js'

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
const bgf = (name: string): string => `${NAMESPACES.bgf}${name}`
const withIntermediate = manifest.cases.filter((c) => c.intermediate !== undefined)

/** A bond's label and count as BG-RDF means them: Python holds any `bgf:bondCount` as the label. */
function corrected(bond: PythonBond): { label: string | null; bondCount: number } {
  return typeof bond.label === 'number' ? { label: null, bondCount: bond.label } : { label: bond.label, bondCount: bond.bondCount }
}

/** The bond count Python's network has for an edge, and the one it should have. */
function edgeCounts(python: PythonModel): { source: string; target: string; python: number; bgRdf: number }[] {
  return python.network.edges.map((edge) => {
    const bond = python.bonds.find((b) => b.source === edge.source && b.target === edge.target)!
    return { source: edge.source, target: edge.target, python: edge.bondCount, bgRdf: corrected(bond).bondCount }
  })
}

//==============================================================================

describe('junctions, bonds and networks of the reference models', () => {
  it('differ from Python only in the bond counts of example_B2 and example_B2_reduced', () => {
    const differences = withIntermediate.flatMap((c) =>
      edgeCounts(loadPythonModel(c))
        .filter((edge) => edge.python !== edge.bgRdf)
        .map((edge) => `${c.name}: ${fragment(edge.source)} -> ${fragment(edge.target)} has ${edge.bgRdf}, Python ${edge.python}`),
    )
    expect(differences.sort()).toEqual([
      'example_B2: u_2 -> v_r_1 has 2, Python 1',
      'example_B2: v_r_2 -> u_4 has 2, Python 1',
      'example_B2_reduced: Re_c_r -> q_4 has 2, Python 1',
      'example_B2_reduced: q_2 -> Re_c_f has 2, Python 1',
    ])
  })

  describe.each(withIntermediate)('$name', (c) => {
    let model: BondgraphModel
    let python: PythonModel

    beforeAll(() => {
      model = loadCase(c)
      python = loadPythonModel(c)
    })

    it('loads with no issues', () => {
      expect(messages(model)).toEqual([])
    })

    it('has the junctions Python has, in the same order', () => {
      expect([...model.junctions.keys()]).toEqual(python.junctions.map((junction) => junction.iri))
      for (const theirs of python.junctions) {
        const ours = model.junctions.get(theirs.iri)!
        expect(ours.type, theirs.iri).toBe(theirs.type)
        expect(ours.symbol, theirs.iri).toBe(theirs.symbol)
        expect(ours.label ?? null, theirs.iri).toBe(theirs.label)
        if (theirs.value === null) {
          expect(ours.value, theirs.iri).toBeUndefined()
        } else {
          expect('literal' in theirs.value && theirs.value.datatype).toBe(CDT.ucum)
          const [magnitude, units] = (theirs.value as { literal: string }).literal.split(/\s+/)
          expect(ours.value, theirs.iri).toEqual({ magnitude: Number(magnitude), units })
        }
      }
    })

    it('has the bonds Python has, in the same order, with their labels and counts as BG-RDF gives them', () => {
      expect(model.bonds.map((bond) => bond.iri)).toEqual(python.bonds.map((bond) => bond.iri))
      python.bonds.forEach((theirs, index) => {
        const ours = model.bonds[index]!
        const { label, bondCount } = corrected(theirs)
        expect({ source: ours.source, target: ours.target, label: ours.label ?? null, bondCount: ours.bondCount }, theirs.iri).toEqual({
          source: theirs.source,
          target: theirs.target,
          label,
          bondCount,
        })
      })
    })

    it('has the network nodes Python has, in the same order', () => {
      const nodes = [...model.network.nodes()]
      expect(nodes.map(([id]) => id)).toEqual(Object.keys(python.network.nodes))
      for (const [id, ours] of nodes) {
        const theirs = python.network.nodes[id]!
        expect(curie(ours.type), id).toBe(theirs.type)
        expect(ours.label, id).toBe(theirs.label)
        expect(ours.element?.iri ?? null, id).toBe(theirs.element)
        expect(ours.junction?.iri ?? null, id).toBe(theirs.junction)
        // A transform node's ports get their port type with their variables (5.3)
        if (ours.element !== undefined) expect(ours.portType, id).toBe(theirs.portType)
        if (ours.element !== undefined) expect(ours.port, id).toBe(ours.element.ports.get(id))
      }
    })

    it('has the edges Python has, in the same order, with the bond counts BG-RDF gives', () => {
      expect(model.network.edges()).toEqual(edgeCounts(python).map((edge) => [edge.source, edge.target, edge.bgRdf]))
    })
  })
})

describe("variants Python can't load", () => {
  /** Nodes and edges, by IRI fragment, so models with different base IRIs compare. */
  const summary = (model: BondgraphModel): unknown => ({
    nodes: [...model.network.nodes()].map(([id, node]) => [fragment(id), node.type, node.label]),
    edges: model.network.edges().map(([source, target, count]) => [fragment(source), fragment(target), count]),
  })

  it('RC_labelled_bonds loads, with its bonds labelled, and the network of example_RC', () => {
    const model = loadCase(caseNamed('RC_labelled_bonds'))
    expect(messages(model)).toEqual([])
    expect(model.bonds.map((bond) => bond.label)).toEqual([
      'source to current',
      'current to resistor',
      'current to capacitor voltage',
      'voltage to capacitor',
    ])
    expect(model.bonds.every((bond) => bond.bondCount === 1)).toBe(true)
    expect(summary(model)).toEqual(summary(loadCase(caseNamed('example_RC'))))
  })

  it('RC_plain_number has the network of example_RC', () => {
    const model = loadCase(caseNamed('RC_plain_number'))
    expect(messages(model)).toEqual([])
    expect(summary(model)).toEqual(summary(loadCase(caseNamed('example_RC'))))
  })
})

//==============================================================================

const BASE = 'https://example.org/model.ttl'
const id = (name: string): string => `${BASE}#${name}`

/** A model from hand-written Turtle, with prefixes. */
function modelFrom(turtle: string): BondgraphModel {
  return BondgraphModel.fromTurtle(
    framework,
    runtime,
    `@prefix bgf: <https://bg-rdf.org/ontologies/bondgraph-framework#> .
     @prefix cdt: <https://w3id.org/cdt/> .
     @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
     @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
     @prefix : <#> .
     ${turtle}`,
    BASE,
  )
}

const RC_ELEMENTS = `
  :R_0 a bgf:ElectricalResistor ; bgf:parameterValue [ bgf:varName "R" ; bgf:hasValue "10 Ohm"^^cdt:ucum ] .
  :q_1 a bgf:ElectricalCapacitor ; bgf:hasValue "0 C"^^cdt:ucum ; bgf:parameterValue [ bgf:varName "C" ; bgf:hasValue "1 F"^^cdt:ucum ] .
  :V_in a bgf:VoltageSource ; bgf:hasValue "10 V"^^cdt:ucum .
  :I_R a bgf:OneNode .
  :V_C a bgf:ZeroNode .`

/** example_RC's model, with `bonds` as its bonds. */
const rc = (bonds: string, extra = ''): BondgraphModel =>
  modelFrom(`:m a bgf:BondgraphModel ; bgf:hasBondElement :V_in, :R_0, :q_1 ; bgf:hasJunctionStructure :I_R, :V_C ${extra}.
             ${RC_ELEMENTS}
             ${bonds}`)

const RC_BONDS = `
  :b1 bgf:hasSource :V_in ; bgf:hasTarget :I_R .
  :b2 bgf:hasSource :I_R ; bgf:hasTarget :R_0 .
  :b3 bgf:hasSource :I_R ; bgf:hasTarget :V_C .
  :b4 bgf:hasSource :V_C ; bgf:hasTarget :q_1 .`

describe('loading bonds', () => {
  it('finds bonds between the model’s nodes, listed with bgf:hasPowerBond or not', () => {
    const model = rc(
      `:b1 bgf:hasSource :V_in ; bgf:hasTarget :I_R .
       :b3 bgf:hasSource :I_R ; bgf:hasTarget :V_C .`,
      `; bgf:hasPowerBond [ bgf:hasSource :I_R ; bgf:hasTarget :R_0 ], [ bgf:hasSource :V_C ; bgf:hasTarget :q_1 ]`,
    )
    expect(messages(model)).toEqual([])
    expect(model.network.edges().map(([s, t]) => `${fragment(s)} -> ${fragment(t)}`).sort()).toEqual([
      'I_R -> R_0',
      'I_R -> V_C',
      'V_C -> q_1',
      'V_in -> I_R',
    ])
  })

  it('reads bond labels and counts', () => {
    const model = rc(RC_BONDS.replace(':b4 bgf:hasSource', ':b4 rdfs:label "to the capacitor" ; bgf:bondCount 3 ; bgf:hasSource'))
    expect(messages(model)).toEqual([])
    const bond = model.bonds.find((b) => b.iri === id('b4'))!
    expect(bond).toMatchObject({ label: 'to the capacitor', bondCount: 3 })
    expect(model.network.bondCount(id('V_C'), id('q_1'))).toBe(3)
    expect(model.network.bondCount(id('I_R'), id('V_C'))).toBe(1)
  })

  it('reports bond counts that are not positive integers', () => {
    const model = rc(
      RC_BONDS.replace(':b4 bgf:hasSource', ':b4 bgf:bondCount 0 ; bgf:hasSource').replace(':b3 bgf:hasSource', ':b3 bgf:bondCount 1.5 ; bgf:hasSource'),
    )
    expect(messages(model).sort()).toEqual([
      "Bond #b3 has a bgf:bondCount that isn't a positive integer: 1.5",
      "Bond #b4 has a bgf:bondCount that isn't a positive integer: 0",
    ])
  })

  it('reports bonds with a missing end, or an end outside the model', () => {
    const model = rc(`${RC_BONDS}
      :b5 bgf:hasSource :R_0 ; bgf:hasTarget :nowhere .
      :b6 bgf:hasSource :q_1 .`, '; bgf:hasPowerBond :b6')
    expect(messages(model)).toEqual([
      "Bond #b5 joins #nowhere, which isn't an element or junction of the model",
      'Bond #b6 is missing source and/or target node',
    ])
    expect(model.network.edges()).toHaveLength(4)
  })

  it('reports a bond to an element that failed to load', () => {
    const model = rc(`${RC_BONDS} :X a bgf:Nothing . :b5 bgf:hasSource :I_R ; bgf:hasTarget :X .`, '; bgf:hasBondElement :X')
    expect(messages(model)).toEqual([
      'bgf:Nothing element X (#X) is not instantiated: there is no template for it',
      'No element or junction for target #X of bond #b5',
    ])
  })

  it('reports two bonds between the same nodes', () => {
    const model = rc(`${RC_BONDS} :b5 bgf:hasSource :V_C ; bgf:hasTarget :q_1 .`)
    expect(messages(model)).toEqual(['Bonds #b4 and #b5 both join #V_C to #q_1'])
  })

  it("joins bonds to a reaction's ports and a transform node's", () => {
    const model = modelFrom(`
      :m a bgf:BondgraphModel ; bgf:hasBondElement :q_1, :q_2, :Re ; bgf:hasJunctionStructure :u_1, :u_2, :TF .
      :q_1 a bgf:ChemicalConcentration ; bgf:hasValue "1 mol"^^cdt:ucum ; bgf:parameterValue [ bgf:varName "K" ; bgf:hasValue "1 mol-1"^^cdt:ucum ] .
      :q_2 a bgf:ChemicalConcentration ; bgf:hasValue "0 mol"^^cdt:ucum ; bgf:parameterValue [ bgf:varName "K" ; bgf:hasValue "1 mol-1"^^cdt:ucum ] .
      :Re a bgf:ChemicalReaction ; bgf:parameterValue [ bgf:varName "kappa" ; bgf:hasValue "1 mol/s"^^cdt:ucum ] .
      :u_1 a bgf:ZeroNode . :u_2 a bgf:ZeroNode .
      :TF a bgf:TransformNode ; bgf:hasValue 2 .
      :b1 bgf:hasSource :u_1 ; bgf:hasTarget :q_1 .
      :b2 bgf:hasSource :u_1 ; bgf:hasTarget :Re .
      :b3 bgf:hasSource :Re ; bgf:hasTarget :TF .
      :b4 bgf:hasSource :TF ; bgf:hasTarget :u_2 .
      :b5 bgf:hasSource :u_2 ; bgf:hasTarget :q_2 .`)
    expect(messages(model)).toEqual([])
    expect(model.bonds.map((bond) => `${fragment(bond.source)} -> ${fragment(bond.target)}`)).toEqual([
      'u_1 -> q_1',
      'u_1 -> Re_f',
      'Re_r -> TF_0',
      'TF_1 -> u_2',
      'u_2 -> q_2',
    ])
    // Element ports first, in IRI order, then junctions in query order
    const nodes = [...model.network.nodes()].map(([node]) => fragment(node))
    expect(nodes.slice(0, 4)).toEqual(['Re_f', 'Re_r', 'q_1', 'q_2'])
    expect(nodes.slice(4).sort()).toEqual(['TF_0', 'TF_1', 'u_1', 'u_2'])
    expect(model.junctions.get(id('TF'))!.value).toEqual({ magnitude: 2 })
  })
})

describe('loading junctions', () => {
  it('reads symbols, labels and values', () => {
    const plain = rc(RC_BONDS).junctions.get(id('I_R'))!
    expect(plain).toMatchObject({ iri: id('I_R'), type: bgf('OneNode'), symbol: 'I_R' })
    expect(plain.label).toBeUndefined()
    expect(plain.value).toBeUndefined()
    const valued = modelFrom(`
      :m a bgf:BondgraphModel ; bgf:hasBondElement :R_0 ; bgf:hasJunctionStructure :v .
      :R_0 a bgf:ElectricalResistor ; bgf:parameterValue [ bgf:varName "R" ; bgf:hasValue "10 Ohm"^^cdt:ucum ] .
      :v a bgf:OneNode ; bgf:hasSymbol "v" ; bgf:hasSpecies "e^-" ; rdfs:label "Current" ; bgf:hasValue "1 A"^^cdt:ucum .
      :b bgf:hasSource :v ; bgf:hasTarget :R_0 .`)
    expect(messages(valued)).toEqual([])
    expect(valued.junctions.get(id('v'))).toMatchObject({ symbol: 'v_e_', label: 'Current', value: { magnitude: 1, units: 'A' } })
  })

  it('reports junctions of an unknown or unsupported type, or with two types', () => {
    const model = modelFrom(`
      :m a bgf:BondgraphModel ; bgf:hasBondElement :R_0 ; bgf:hasJunctionStructure :a, :b, :c, :d .
      :R_0 a bgf:ElectricalResistor ; bgf:parameterValue [ bgf:varName "R" ; bgf:hasValue "10 Ohm"^^cdt:ucum ] .
      :a a bgf:NoSuchNode . :b a bgf:ZeroStorageNode . :c a bgf:OneNode, bgf:ZeroNode . :d a bgf:OneNode .`)
    expect(messages(model).sort()).toEqual([
      "Junction b (#b) is a bgf:ZeroStorageNode: a model's junctions must be one, zero or transform nodes",
      'Junction c (#c) has more than one type: bgf:OneNode, bgf:ZeroNode',
      `Unknown Junction ${bgf('NoSuchNode')} for node ${id('a')}`,
    ])
    expect([...model.junctions.keys()]).toEqual([id('d')])
  })
})
