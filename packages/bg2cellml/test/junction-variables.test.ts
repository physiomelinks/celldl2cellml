/**
 * Plan chunk 5.3: domains spread through the bond network, and the variables
 * of one, zero and transform nodes, checked against the Python bg2cellml's
 * intermediate fixtures (test/reference/models) and on hand-written models.
 */

import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  BondgraphModel,
  GYRATOR_EQUATIONS,
  NAMESPACES,
  TRANSFORMER_EQUATIONS,
  fragment,
  type BondgraphFramework,
  type ModelRuntime,
  type ModelVariable,
} from '../src/index.js'
import { bgRdfFramework, expectSameUnits, frameworkRuntime } from './framework-fixtures.js'
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
const bgf = (name: string): string => `${NAMESPACES.bgf}${name}`

function expectVariable(ours: ModelVariable | undefined, theirs: PythonVariable, context: string): void {
  expect(ours, context).toBeDefined()
  expect(ours!.name, context).toBe(theirs.name)
  expect(ours!.symbol, context).toBe(theirs.symbol)
  expect(ours!.type ?? null, context).toBe(theirs.type)
  expectSameUnits(ours!.units, theirs.units)
  if (theirs.value === null) {
    expect(ours!.value, context).toBeUndefined()
  } else {
    expect(ours!.value?.magnitude, context).toBe(theirs.value.magnitude)
    expectSameUnits(ours!.value!.units!, theirs.value.units)
  }
}

//==============================================================================

describe('domains and junction variables of the reference models', () => {
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

    it('gives every network node the domain Python does', () => {
      for (const [id, node] of model.network.nodes()) expect(node.domain?.iri ?? null, id).toBe(python.network.nodes[id]!.domain)
    })

    it("gives every node the port Python does, including a transform node's", () => {
      for (const [id, node] of model.network.nodes()) {
        const theirs = python.network.nodes[id]!
        expect(node.portType ?? null, id).toBe(theirs.portType)
        if (theirs.powerPort === null) expect(node.port, id).toBeUndefined()
        else expect({ flow: node.port?.flow.symbol, potential: node.port?.potential.symbol }, id).toEqual(theirs.powerPort)
      }
    })

    it('gives every junction the variables Python does', () => {
      expect([...model.junctions.keys()].sort()).toEqual(Object.keys(python.variables.junctions).sort())
      for (const [iri, theirs] of Object.entries(python.variables.junctions)) {
        const ours = model.junctions.get(iri)!
        expect([...ours.variables.keys()].sort(), iri).toEqual(Object.keys(theirs).sort())
        for (const [name, variable] of Object.entries(theirs)) expectVariable(ours.variables.get(name), variable, `${fragment(iri)} ${name}`)
      }
    })

    it("shares a transform node's flow or potential with the node beside it", () => {
      for (const junction of model.junctions.values()) {
        if (junction.type !== bgf('TransformNode')) continue
        for (const port of ['0', '1']) {
          const node = model.network.node(`${junction.iri}_${port}`)!
          expect(node.port!.flow).toBe(junction.variables.get(`v_${port}`))
          expect(node.port!.potential).toBe(junction.variables.get(`u_${port}`))
        }
      }
    })
  })

  it('make the transform node in example_A3 and example_A3_reduced a gyrator, between electrical and mechanical', () => {
    for (const name of ['example_A3', 'example_A3_reduced']) {
      const model = loadCase(manifest.cases.find((c) => c.name === name)!)
      const transforms = [...model.junctions.values()].filter((j) => j.type === bgf('TransformNode'))
      expect(transforms, name).toHaveLength(1)
      expect(transforms[0]!.transform).toBe('gyrator')
      expect(transforms[0]!.relation).toBe(GYRATOR_EQUATIONS)
      expect(model.network.node(`${transforms[0]!.iri}_0`)!.domain!.iri).toBe(bgf('Electrical'))
      expect(model.network.node(`${transforms[0]!.iri}_1`)!.domain!.iri).toBe(bgf('Mechanical'))
    }
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

const ELECTRICAL_R = (name: string): string =>
  `:${name} a bgf:ElectricalResistor ; bgf:parameterValue [ bgf:varName "R" ; bgf:hasValue "10 Ohm"^^cdt:ucum ] .`
const MECHANICAL_R = (name: string): string =>
  `:${name} a bgf:MechanicalResistor ; bgf:parameterValue [ bgf:varName "R" ; bgf:hasValue "10 N.s/m"^^cdt:ucum ] .`

describe('spreading domains', () => {
  it('reports elements of different domains joined by bonds, which Python cannot', () => {
    const model = modelFrom(`
      :m a bgf:BondgraphModel ; bgf:hasBondElement :R_e, :R_m, :R_f ; bgf:hasJunctionStructure :v .
      ${ELECTRICAL_R('R_e')} ${MECHANICAL_R('R_m')} ${MECHANICAL_R('R_f')}
      :v a bgf:OneNode .
      :b1 bgf:hasSource :v ; bgf:hasTarget :R_e .
      :b2 bgf:hasSource :v ; bgf:hasTarget :R_m .
      :b3 bgf:hasSource :v ; bgf:hasTarget :R_f .`)
    // One report for the mechanical domain, at the first of its elements reached from R_e, though R_f is joined too
    expect(messages(model)).toEqual(['Node #R_m with domain bgf:Mechanical incompatible with bgf:Electrical'])
    // The junction takes the domain of the first element, as Python's would
    expect(model.network.node(id('v'))!.domain!.iri).toBe(bgf('Electrical'))
    expect(model.network.node(id('R_m'))!.domain!.iri).toBe(bgf('Mechanical'))
  })

  it('spreads through chains of junctions, but not across a transform node', () => {
    const model = modelFrom(`
      :m a bgf:BondgraphModel ; bgf:hasBondElement :R_e, :R_m ; bgf:hasJunctionStructure :u, :v_e, :v_m, :TF .
      ${ELECTRICAL_R('R_e')} ${MECHANICAL_R('R_m')}
      :u a bgf:ZeroNode . :v_e a bgf:OneNode . :v_m a bgf:OneNode .
      :TF a bgf:TransformNode ; bgf:hasValue "2 V.s/m"^^cdt:ucum .
      :b1 bgf:hasSource :u ; bgf:hasTarget :v_e .
      :b2 bgf:hasSource :v_e ; bgf:hasTarget :R_e .
      :b3 bgf:hasSource :v_e ; bgf:hasTarget :TF .
      :b4 bgf:hasSource :TF ; bgf:hasTarget :v_m .
      :b5 bgf:hasSource :v_m ; bgf:hasTarget :R_m .`)
    expect(messages(model)).toEqual([])
    const domain = (name: string): string => fragment(model.network.node(id(name))!.domain!.iri)
    expect(['u', 'v_e', 'TF_0', 'TF_1', 'v_m'].map(domain)).toEqual(['Electrical', 'Electrical', 'Electrical', 'Mechanical', 'Mechanical'])
  })
})

describe('junction variables', () => {
  it("gives one and zero nodes their domain's flow and potential, with any value", () => {
    const model = modelFrom(`
      :m a bgf:BondgraphModel ; bgf:hasBondElement :R_0 ; bgf:hasJunctionStructure :v, :u, :w .
      ${ELECTRICAL_R('R_0')}
      :v a bgf:OneNode ; bgf:hasValue "2 mA"^^cdt:ucum .
      :u a bgf:ZeroNode ; bgf:hasValue 3 .
      :w a bgf:OneNode ; bgf:hasValue "1 V"^^cdt:ucum .
      :b1 bgf:hasSource :u ; bgf:hasTarget :v .
      :b2 bgf:hasSource :v ; bgf:hasTarget :R_0 .
      :b3 bgf:hasSource :u ; bgf:hasTarget :w .`)
    expect(messages(model)).toEqual(['Value for variable w has incompatible units (V != C/s)'])
    const v = model.junctions.get(id('v'))!.variables.get('')!
    // In the variable's units, which Python doesn't convert to
    expect(v).toMatchObject({ name: 'v', units: 'C/s', type: bgf('FlowVariable'), value: { magnitude: 0.002, units: 'C/s' } })
    const u = model.junctions.get(id('u'))!.variables.get('')!
    expect(u).toMatchObject({ name: 'u', units: 'J/C', type: bgf('PotentialVariable'), value: { magnitude: 3, units: 'J/C' } })
  })

  it('reports a junction with no bonds', () => {
    const model = modelFrom(`
      :m a bgf:BondgraphModel ; bgf:hasBondElement :R_0 ; bgf:hasJunctionStructure :v .
      ${ELECTRICAL_R('R_0')} :v a bgf:OneNode .`)
    expect(messages(model)).toEqual(['Cannot find domain for junction v (#v). Are there bonds to it?'])
  })

  /** R_a and R_b on either side of a transform node TF, through one nodes, or `between` instead. */
  const transform = (value: string, between = ':b2 bgf:hasSource :v_a ; bgf:hasTarget :TF . :b3 bgf:hasSource :TF ; bgf:hasTarget :v_b .'): BondgraphModel =>
    modelFrom(`
      :m a bgf:BondgraphModel ; bgf:hasBondElement :R_a, :R_b ; bgf:hasJunctionStructure :v_a, :v_b, :TF .
      ${ELECTRICAL_R('R_a')} ${ELECTRICAL_R('R_b')}
      :v_a a bgf:OneNode . :v_b a bgf:OneNode .
      :TF a bgf:TransformNode ${value} .
      :b1 bgf:hasSource :v_a ; bgf:hasTarget :R_a .
      :b4 bgf:hasSource :v_b ; bgf:hasTarget :R_b .
      ${between}`)

  it("makes a transformer within a domain, sharing each one node's flow", () => {
    const model = transform('; bgf:hasValue 2')
    expect(messages(model)).toEqual([])
    const tf = model.junctions.get(id('TF'))!
    expect(tf.transform).toBe('transformer')
    expect(tf.relation).toBe(TRANSFORMER_EQUATIONS)
    // A plain number is a dimensionless ratio
    expect(tf.variables.get('RATIO')).toMatchObject({ name: 'TF', units: '1', value: { magnitude: 2, units: '1' } })
    expect(tf.variables.get('v_0')).toBe(model.junctions.get(id('v_a'))!.variables.get(''))
    expect(tf.variables.get('v_1')).toBe(model.junctions.get(id('v_b'))!.variables.get(''))
    expect(tf.variables.get('u_0')).toMatchObject({ name: 'u_TF_0', units: 'J/C' })
    expect(tf.variables.get('u_1')).toMatchObject({ name: 'u_TF_1', units: 'J/C' })
    expect(tf.variables.get('u_0')!.type).toBeUndefined()
  })

  it("shares a zero node's potential, or a composite element's", () => {
    const model = modelFrom(`
      :m a bgf:BondgraphModel ; bgf:hasBondElement :R_a, :R_b ; bgf:hasJunctionStructure :u, :TF .
      ${ELECTRICAL_R('R_a')}
      :R_b a bgf:ElectricalResistiveNode ; bgf:parameterValue [ bgf:varName "R" ; bgf:hasValue "10 Ohm"^^cdt:ucum ] .
      :u a bgf:ZeroNode .
      :TF a bgf:TransformNode ; bgf:hasSymbol "n" ; bgf:hasValue 2 .
      :b1 bgf:hasSource :u ; bgf:hasTarget :R_a .
      :b2 bgf:hasSource :u ; bgf:hasTarget :TF .
      :b3 bgf:hasSource :TF ; bgf:hasTarget :R_b .`)
    expect(messages(model)).toEqual([])
    const tf = model.junctions.get(id('TF'))!
    expect(tf.variables.get('u_0')).toBe(model.junctions.get(id('u'))!.variables.get(''))
    expect(tf.variables.get('v_0')).toMatchObject({ name: 'v_n_0', units: 'C/s' })
    expect(tf.variables.get('v_1')).toBe(model.elements.get(id('R_b'))!.flow)
    expect(tf.variables.get('u_1')).toMatchObject({ name: 'u_n_1' })
  })

  it("reports a transform node with no ratio, or a port it can't use", () => {
    expect(messages(transform(''))).toEqual(['Transform node TF (#TF) has no bgf:hasValue for its ratio'])
    expect(messages(transform('; bgf:hasValue 2', ':b2 bgf:hasSource :v_a ; bgf:hasTarget :TF . :b3 bgf:hasSource :TF ; bgf:hasTarget :R_b . :b5 bgf:hasSource :v_b ; bgf:hasTarget :TF .'))).toEqual([
      'Port 0 of transform node TF (#TF) must be bonded to one node, not 2',
      'Port 1 of transform node TF (#TF) is bonded to #R_b: it must be a one or zero node, or an element that acts as one',
    ])
  })
})
