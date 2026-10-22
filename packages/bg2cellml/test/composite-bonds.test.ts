/**
 * An element that isn't acting as a junction, such as a `bgf:ChemicalReaction`,
 * bonded straight to a composite element, such as a `bgf:ChemicalStorageNode`,
 * converts as if the junction the composite acts as were drawn between them:
 * the reaction's port takes the store's potential. Python leaves that port's
 * potential without an equation, so the model is underconstrained.
 *
 * Each model is written as the CellDL editor saves it, and checked against
 * the same model drawn with separate junctions: every variable both have by
 * name must simulate the same.
 */

import { DOMParser } from '@xmldom/xmldom'
import createLibCellML from 'libcellml.js'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import type { LibCellML } from '@physiomelinks/cellml-units'

import { Converter, type ConvertResult } from '../src/index.js'
import { decodeValue, frameworkSource, loadManifest, type Trajectories } from './reference.js'
import { loadLibOpenCOR, simulate } from './simulate.js'

const manifest = loadManifest()
const TOLERANCE = manifest.tolerance

let converter: Converter

beforeAll(async () => {
  const libcellml = (await createLibCellML()) as unknown as LibCellML
  converter = new Converter({ libcellml, oxigraph, domParser: new DOMParser() as never })
  expect(converter.loadFramework(frameworkSource(manifest))).toEqual([])
})

//==============================================================================

interface Node {
  readonly type: string
  readonly symbol: string
  readonly species?: string
  readonly location?: string
  readonly value?: string
  readonly parameters?: Readonly<Record<string, string>>
}

/** BG-RDF Turtle as the CellDL editor writes it: composite elements are listed as both elements and junctions. */
function editorModel(nodes: Readonly<Record<string, Node>>, bonds: readonly (readonly [string, string])[]): string {
  const JUNCTIONS = new Set(['ZeroNode', 'OneNode'])
  const COMPOSITES = new Set(['ChemicalStorageNode', 'ChemicalReactionNode', 'ElectricalCapacitiveNode', 'ElectricalResistiveNode'])
  const elements = Object.keys(nodes).filter((key) => !JUNCTIONS.has(nodes[key]!.type))
  const junctions = Object.keys(nodes).filter((key) => JUNCTIONS.has(nodes[key]!.type) || COMPOSITES.has(nodes[key]!.type))
  const list = (keys: string[]): string => keys.map((key) => `:${key}`).join(', ')
  const lines = [
    '@prefix : <#> .',
    '@prefix bgf: <https://bg-rdf.org/ontologies/bondgraph-framework#> .',
    '@prefix cdt: <https://w3id.org/cdt/> .',
    '@prefix celldl: <http://celldl.org/ontologies/celldl#> .',
    '',
    `<> a celldl:Document, bgf:BondgraphModel ;`,
    `  bgf:hasBondElement ${list(elements)} ;`,
    `  bgf:hasJunctionStructure ${list(junctions)} .`,
    '',
  ]
  for (const [key, node] of Object.entries(nodes)) {
    const properties = [`a celldl:Component, bgf:${node.type}`, `bgf:hasSymbol "${node.symbol}"`]
    if (node.species !== undefined) properties.push(`bgf:hasSpecies "${node.species}"`)
    if (node.location !== undefined) properties.push(`bgf:hasLocation "${node.location}"`)
    if (node.value !== undefined) properties.push(`bgf:hasValue "${node.value}"^^cdt:ucum`)
    for (const [name, value] of Object.entries(node.parameters ?? {})) {
      properties.push(`bgf:parameterValue [ bgf:hasValue "${value}"^^cdt:ucum ; bgf:varName "${name}" ]`)
    }
    lines.push(`:${key} ${properties.join(' ;\n  ')} .`, '')
  }
  bonds.forEach(([source, target], index) => {
    lines.push(`:bond_${index} a celldl:Connection ; celldl:hasSource :${source} ; celldl:hasTarget :${target} ; bgf:hasSource :${source} ; bgf:hasTarget :${target} .`)
  })
  return lines.join('\n')
}

// The enzyme S + E <=> C <=> P + E. Values: amounts in mol, K in mol-1, kappa in mol/s
const SPECIES = { S: ['1', '1'], E: ['0.1', '1'], C: ['0', '1'], P: ['0', '0.01'] } as const
const store = (type: string, species: keyof typeof SPECIES): Node => ({
  type,
  symbol: 'q',
  species,
  location: 'c',
  value: `${SPECIES[species][0]} mol`,
  parameters: { K: `${SPECIES[species][1]} mol-1` },
})
const reaction = (species: string, kappa: string): Node => ({ type: 'ChemicalReaction', symbol: 'Rx', species, location: 'c', parameters: { kappa: `${kappa} mol/s` } })
const zero = (species: string): Node => ({ type: 'ZeroNode', symbol: 'u', species, location: 'c' })
const one = (species: string, side: string): Node => ({ type: 'OneNode', symbol: 'v', species, location: side })

/** A zero node for each species, a one node for each side of each reaction: BG-RDF's usual form. */
const canonicalEnzyme = editorModel(
  {
    S: store('ChemicalConcentration', 'S'),
    E: store('ChemicalConcentration', 'E'),
    C: store('ChemicalConcentration', 'C'),
    P: store('ChemicalConcentration', 'P'),
    u_S: zero('S'),
    u_E: zero('E'),
    u_C: zero('C'),
    u_P: zero('P'),
    j1f: one('r1', 'f'),
    r1: reaction('r1', '10'),
    j1r: one('r1', 'r'),
    j2f: one('r2', 'f'),
    r2: reaction('r2', '1'),
    j2r: one('r2', 'r'),
  },
  [
    ['u_S', 'S'],
    ['u_E', 'E'],
    ['u_C', 'C'],
    ['u_P', 'P'],
    ['u_S', 'j1f'],
    ['u_E', 'j1f'],
    ['j1f', 'r1'],
    ['r1', 'j1r'],
    ['j1r', 'u_C'],
    ['u_C', 'j2f'],
    ['j2f', 'r2'],
    ['r2', 'j2r'],
    ['j2r', 'u_P'],
    ['j2r', 'u_E'],
  ],
)

/** Composite stores, with one nodes only where a reaction side has two species: C is bonded straight to both reactions. */
const compositeEnzyme = editorModel(
  {
    S: store('ChemicalStorageNode', 'S'),
    E: store('ChemicalStorageNode', 'E'),
    C: store('ChemicalStorageNode', 'C'),
    P: store('ChemicalStorageNode', 'P'),
    j1f: one('r1', 'f'),
    r1: reaction('r1', '10'),
    r2: reaction('r2', '1'),
    j2r: one('r2', 'r'),
  },
  [
    ['S', 'j1f'],
    ['E', 'j1f'],
    ['j1f', 'r1'],
    ['r1', 'C'],
    ['C', 'r2'],
    ['r2', 'j2r'],
    ['j2r', 'P'],
    ['j2r', 'E'],
  ],
)

/** S <=> P, with zero nodes. */
const canonicalChain = editorModel(
  { S: store('ChemicalConcentration', 'S'), P: store('ChemicalConcentration', 'P'), u_S: zero('S'), u_P: zero('P'), r1: reaction('r1', '10') },
  [
    ['u_S', 'S'],
    ['u_P', 'P'],
    ['u_S', 'r1'],
    ['r1', 'u_P'],
  ],
)

/** S <=> P, composite stores bonded straight to the reaction. */
const compositeChain = editorModel({ S: store('ChemicalStorageNode', 'S'), P: store('ChemicalStorageNode', 'P'), r1: reaction('r1', '10') }, [
  ['S', 'r1'],
  ['r1', 'P'],
])

const capacitor = (type: string): Node => ({ type, symbol: 'q', species: 'C', value: '1 C', parameters: { C: '1 F' } })
const resistor = (type: string): Node => ({ type, symbol: 'R', species: 'R', parameters: { R: '2 Ohm' } })

/** A capacitor discharging through a resistor, joined by a one node. */
const canonicalRC = editorModel({ C: capacitor('ElectricalCapacitor'), j: one('RC', 'j'), R: resistor('ElectricalResistor') }, [
  ['j', 'C'],
  ['j', 'R'],
])

/** The same, with a plain capacitor bonded straight to a composite resistance. */
const compositeRC = editorModel({ C: capacitor('ElectricalCapacitor'), R: resistor('ElectricalResistiveNode') }, [['R', 'C']])

//==============================================================================

async function convert(source: string): Promise<ConvertResult> {
  const result = await converter.convert(source, { rdfSource: true, checks: 'full' })
  expect(result.errors.map((issue) => issue.message)).toEqual([])
  expect(result).toMatchObject({ ok: true, runnable: true, checks: 'full', issues: [] })
  return result
}

// Tight tolerances, so the solver's error doesn't hide a difference in the models
const SETTINGS = { start: 0, end: 20, steps: 200, recordedEvery: 10, relativeTolerance: 1e-10, absoluteTolerance: 1e-12 }

/** Every variable's trajectory, whether it's a state, rate or algebraic. */
async function trajectories(cellml: string): Promise<Trajectories> {
  const result = simulate(await loadLibOpenCOR(), cellml, SETTINGS)
  const rates = Object.fromEntries(Object.entries(result.rates).map(([name, values]) => [`d${name}/dt`, values]))
  return { ...result.states, ...rates, ...result.algebraics }
}

/** Names whose trajectories differ, of those both have; fails if they share fewer than `atLeast`. */
function differences(actual: Trajectories, expected: Trajectories, atLeast: number): string[] {
  const shared = Object.keys(expected).filter((name) => name in actual)
  expect(shared.length).toBeGreaterThanOrEqual(atLeast)
  // A store that starts empty has a potential of -Infinity
  const close = (a: number, e: number): boolean =>
    Number.isFinite(e) ? Math.abs(a - e) <= TOLERANCE.absolute + TOLERANCE.relative * Math.abs(e) : Object.is(a, e)
  return shared.filter((name) => expected[name]!.some((value, i) => !close(decodeValue(actual[name]![i]), decodeValue(value))))
}

describe('a reaction bonded straight to a composite store', () => {
  it('converts S <=> P with full checks, and simulates as it does with zero nodes', async () => {
    const [composite, canonical] = await Promise.all([convert(compositeChain), convert(canonicalChain)])
    expect(composite.modelType).toBe('ode')
    // The reaction's ports take the stores' potentials
    expect(composite.cellml).toMatch(/<ci>u_f_Rx_r1_c<\/ci>\s*<ci>u_q_S_c<\/ci>/)
    expect(composite.cellml).toMatch(/<ci>u_r_Rx_r1_c<\/ci>\s*<ci>u_q_P_c<\/ci>/)
    const [actual, expected] = await Promise.all([trajectories(composite.cellml!), trajectories(canonical.cellml!)])
    expect(differences(actual, expected, 8)).toEqual([])
  })

  it('converts the enzyme with full checks, and simulates as the canonical enzyme does', async () => {
    const [composite, canonical] = await Promise.all([convert(compositeEnzyme), convert(canonicalEnzyme)])
    const [actual, expected] = await Promise.all([trajectories(composite.cellml!), trajectories(canonical.cellml!)])
    // The amounts, their rates and potentials, and the reactions' flows and port potentials
    for (const name of ['q_S_c', 'q_E_c', 'q_C_c', 'q_P_c', 'u_f_Rx_r1_c', 'u_r_Rx_r1_c', 'u_f_Rx_r2_c', 'u_r_Rx_r2_c', 'v_Rx_r1_c', 'v_Rx_r2_c']) {
      expect(actual, name).toHaveProperty(name)
    }
    expect(differences(actual, expected, 20)).toEqual([])

    // The enzyme is conserved, as is S + C + P
    const at = (name: string, i: number): number => decodeValue(actual[name]![i])
    for (let i = 0; i < actual['q_E_c']!.length; i += 1) {
      expect(at('q_E_c', i) + at('q_C_c', i)).toBeCloseTo(0.1, 9)
      expect(at('q_S_c', i) + at('q_C_c', i) + at('q_P_c', i)).toBeCloseTo(1, 9)
    }
    expect(at('q_P_c', actual['q_P_c']!.length - 1)).toBeGreaterThan(0.5)
  })
})

describe('an element bonded straight to a composite resistance', () => {
  it('gives the element the resistance’s flow, as a one node would', async () => {
    const [composite, canonical] = await Promise.all([convert(compositeRC), convert(canonicalRC)])
    const [actual, expected] = await Promise.all([trajectories(composite.cellml!), trajectories(canonical.cellml!)])
    expect(differences(actual, expected, 4)).toEqual([])
    // q = exp(-t/RC), with R = 2 and C = 1
    const q = actual['q_C']!.map(decodeValue)
    expect(q.at(-1)).toBeCloseTo(Math.exp(-SETTINGS.end / 2), 6)
  })
})
