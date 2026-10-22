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
function editorModel(nodes: Readonly<Record<string, Node>>, bonds: readonly (readonly [string, string, number?])[]): string {
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
  bonds.forEach(([source, target, count], index) => {
    // The editor writes a count other than 1 as an xsd:integer
    const bondCount = count === undefined ? '' : ` ; bgf:bondCount ${count}`
    lines.push(
      `:bond_${index} a celldl:Connection ; celldl:hasSource :${source} ; celldl:hasTarget :${target} ; bgf:hasSource :${source} ; bgf:hasTarget :${target}${bondCount} .`,
    )
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

//==============================================================================

/*
 * The CellDL editor's Reactions panel draws a reaction as a composite
 * `bgf:ChemicalReactionNode` bonded straight to each species, with the
 * species' coefficient as the bond's `bgf:bondCount`, and a chemostat as a
 * copy of its `bgf:ChemicalPotential` beside each reaction using it. Its
 * nodes have CellDL ids, such as `ID-00000004`.
 */

/** A store of amount `q` mol, with K = 1 mol-1. */
const amount = (type: string, species: string, q: string): Node => ({
  type,
  symbol: 'q',
  species,
  location: 'c',
  value: `${q} mol`,
  parameters: { K: '1 mol-1' },
})
const reactionNode = (species: string, kappa: string): Node => ({
  type: 'ChemicalReactionNode',
  symbol: 'Rx',
  species,
  location: 'c',
  parameters: { kappa: `${kappa} mol/s` },
})
const chemostat = (species: string, mu: string): Node => ({ type: 'ChemicalPotential', symbol: 'Se', species, location: 'c', value: `${mu} J/mol` })

/** A + 2 B <=> C, as the Reactions panel draws it, with stores of type `storeType`. */
const panelReaction = (storeType: string): string =>
  editorModel(
    {
      'ID-00000001': amount(storeType, 'A', '1'),
      'ID-00000002': amount(storeType, 'B', '1'),
      'ID-00000003': amount(storeType, 'C', '0.01'),
      'ID-00000004': reactionNode('r1', '1'),
    },
    [
      ['ID-00000001', 'ID-00000004'],
      ['ID-00000002', 'ID-00000004', 2],
      ['ID-00000004', 'ID-00000003'],
    ],
  )

/** A + 2 B <=> C with zero nodes, one nodes and a plain reaction: BG-RDF's usual form. */
const canonicalPanelReaction = editorModel(
  {
    A: amount('ChemicalConcentration', 'A', '1'),
    B: amount('ChemicalConcentration', 'B', '1'),
    C: amount('ChemicalConcentration', 'C', '0.01'),
    u_A: zero('A'),
    u_B: zero('B'),
    u_C: zero('C'),
    j1f: one('r1', 'f'),
    r1: { ...reactionNode('r1', '1'), type: 'ChemicalReaction' },
  },
  [
    ['u_A', 'A'],
    ['u_B', 'B'],
    ['u_C', 'C'],
    ['u_A', 'j1f'],
    ['u_B', 'j1f', 2],
    ['j1f', 'r1'],
    ['r1', 'u_C'],
  ],
)

/** q_B + 2 q_C and q_A + q_C stay as they start. */
function expectConserved(actual: Trajectories, digits = 7): void {
  const at = (name: string, i: number): number => decodeValue(actual[name]![i])
  for (let i = 0; i < actual['q_A_c']!.length; i += 1) {
    expect(at('q_A_c', i) + at('q_C_c', i)).toBeCloseTo(1.01, digits)
    expect(at('q_B_c', i) + 2 * at('q_C_c', i)).toBeCloseTo(1.02, digits)
  }
  // It has moved towards C
  expect(at('q_C_c', actual['q_C_c']!.length - 1)).toBeGreaterThan(0.1)
}

describe('a composite reaction bonded straight to stores, as the Reactions panel draws it', () => {
  it('converts A + 2 B <=> C with composite stores, and simulates as the usual form does', async () => {
    const [composite, canonical] = await Promise.all([convert(panelReaction('ChemicalStorageNode')), convert(canonicalPanelReaction)])
    expect(composite.modelType).toBe('ode')
    // The reaction's forward potential counts B twice
    expect(composite.cellml).toMatch(/<ci>u_f_Rx_r1_c<\/ci>\s*<apply>\s*<plus\/>/)
    const [actual, expected] = await Promise.all([trajectories(composite.cellml!), trajectories(canonical.cellml!)])
    expect(differences(actual, expected, 8)).toEqual([])
    expectConserved(actual)
  })

  it('converts it with plain stores, each store’s flow the reaction’s times its count, signed by the bond', async () => {
    const [plain, canonical] = await Promise.all([convert(panelReaction('ChemicalConcentration')), convert(canonicalPanelReaction)])
    expect(plain.modelType).toBe('ode')
    // B, bonded twice from the store to the reaction, loses twice the reaction's flow
    expect(plain.cellml).toMatch(/<ci>v_q_B_c<\/ci>\s*<apply>\s*<minus\/>\s*<apply>\s*<times\/>\s*<cn[^>]*>2<\/cn>\s*<ci>v_Rx_r1_c<\/ci>/)
    const [actual, expected] = await Promise.all([trajectories(plain.cellml!), trajectories(canonical.cellml!)])
    expect(differences(actual, expected, 8)).toEqual([])
    expectConserved(actual)
  })

  it('gives a plain store bonded to a one node twice the one node’s flow, as the composite form does', async () => {
    // As the usual form, but B is bonded straight to the one node, twice, from the store
    const viaOneNode = editorModel(
      {
        A: amount('ChemicalConcentration', 'A', '1'),
        B: amount('ChemicalConcentration', 'B', '1'),
        C: amount('ChemicalConcentration', 'C', '0.01'),
        u_A: zero('A'),
        u_C: zero('C'),
        j1f: one('r1', 'f'),
        r1: { ...reactionNode('r1', '1'), type: 'ChemicalReaction' },
      },
      [
        ['u_A', 'A'],
        ['u_C', 'C'],
        ['u_A', 'j1f'],
        ['B', 'j1f', 2],
        ['j1f', 'r1'],
        ['r1', 'u_C'],
      ],
    )
    const [direct, canonical] = await Promise.all([convert(viaOneNode), convert(canonicalPanelReaction)])
    expect(direct.cellml).toMatch(/<ci>v_q_B_c<\/ci>\s*<apply>\s*<minus\/>\s*<apply>\s*<times\/>\s*<cn[^>]*>2<\/cn>/)
    const [actual, expected] = await Promise.all([trajectories(direct.cellml!), trajectories(canonical.cellml!)])
    expect(differences(actual, expected, 8)).toEqual([])
    // Both are DAEs (a plain reaction's ports), so the solver keeps the sums less closely
    expectConserved(actual, 5)
  })
})

describe('drawn copies of an element', () => {
  /** ATP + X <=> Y and ATP + Y <=> Z, each reaction with its own copy of the ATP chemostat. */
  const chemostatCopies = editorModel(
    {
      'ID-00000001': chemostat('ATP', '1000'),
      'ID-00000002': amount('ChemicalStorageNode', 'X', '1'),
      'ID-00000003': amount('ChemicalStorageNode', 'Y', '0.1'),
      'ID-00000004': amount('ChemicalStorageNode', 'Z', '0.1'),
      'ID-00000005': reactionNode('r1', '1'),
      'ID-00000006': reactionNode('r2', '0.5'),
      'ID-00000007': chemostat('ATP', '1000'),
    },
    [
      ['ID-00000001', 'ID-00000005'],
      ['ID-00000002', 'ID-00000005'],
      ['ID-00000005', 'ID-00000003'],
      ['ID-00000007', 'ID-00000006'],
      ['ID-00000003', 'ID-00000006'],
      ['ID-00000006', 'ID-00000004'],
    ],
  )

  it('gives each chemostat copy its own variables, the later copy named from its id', async () => {
    const result = await convert(chemostatCopies)
    expect(result.modelType).toBe('ode')
    for (const name of ['u_Se_ATP_c', 'v_Se_ATP_c', 'u_ID_00000007', 'v_ID_00000007']) {
      expect(result.cellml).toContain(`<variable name="${name}"`)
    }
    // Each copy takes up its own reaction's flow
    expect(result.cellml).toMatch(/<ci>u_f_Rx_r2_c<\/ci>\s*<apply>\s*<plus\/>\s*<ci>u_ID_00000007<\/ci>/)
    const actual = await trajectories(result.cellml!)
    const at = (name: string, i: number): number => decodeValue(actual[name]![i])
    // ATP is held, so X + Y + Z is conserved
    for (let i = 0; i < actual['q_X_c']!.length; i += 1) expect(at('q_X_c', i) + at('q_Y_c', i) + at('q_Z_c', i)).toBeCloseTo(1.2, 9)
  })

  it('names a third copy, whose id names an element already, with a number', async () => {
    const result = await converter.convert(
      editorModel(
        {
          Se: chemostat('A', '1'),
          'ID-1': chemostat('A', '1'),
          Se_A_c: chemostat('A', '1'),
          q: amount('ChemicalStorageNode', 'B', '1'),
        },
        [
          ['Se', 'q'],
          ['ID-1', 'q'],
          ['Se_A_c', 'q'],
        ],
      ),
      { rdfSource: true },
    )
    // In IRI order: #ID-1 is Se_A_c, #Se is named Se, and #Se_A_c, whose fragment is taken, Se_A_c_2
    for (const name of ['u_Se_A_c', 'u_Se', 'u_Se_A_c_2']) expect(result.cellml).toContain(`<variable name="${name}"`)
  })

  it('makes drawn copies of a store separate pools, with a warning', async () => {
    const result = await converter.convert(
      editorModel(
        {
          'ID-00000001': amount('ChemicalStorageNode', 'A', '1'),
          'ID-00000002': amount('ChemicalStorageNode', 'A', '1'),
          'ID-00000003': amount('ChemicalStorageNode', 'B', '0.1'),
          'ID-00000004': reactionNode('r1', '1'),
          'ID-00000005': reactionNode('r2', '1'),
        },
        [
          ['ID-00000001', 'ID-00000004'],
          ['ID-00000004', 'ID-00000003'],
          ['ID-00000002', 'ID-00000005'],
          ['ID-00000005', 'ID-00000003'],
        ],
      ),
      { rdfSource: true, checks: 'full' },
    )
    expect(result).toMatchObject({ ok: true, runnable: true, modelType: 'ode', errors: [] })
    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: 'warning',
        elementId: 'ID-00000002',
        message: expect.stringContaining('is a separate pool'),
      }),
    ])
    expect(result.cellml).toContain('<variable name="q_A_c"')
    expect(result.cellml).toContain('<variable name="q_ID_00000002"')
  })
})
