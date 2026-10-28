/**
 * `convert()` writes the component's equations in sections by role, the ODEs
 * last, with no comments, and returns the sections; `celldl2cellml()` keeps
 * BG-Tools' groups, ODEs first, each after a comment. Only the order differs,
 * so the two orders must simulate identically.
 */

import { readFileSync } from 'node:fs'

import type { LibCellML } from '@physiomelinks/cellml-units'
import { DOMParser } from '@xmldom/xmldom'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import { BondgraphModel, Converter, generateCellML, type BondgraphFramework, type ModelRuntime } from '../src/index.js'
import { bgRdfFramework, frameworkRuntime } from './framework-fixtures.js'
import { BG_RDF, REPO_ROOT, frameworkSource } from './reference.js'
import { loadLibOpenCOR, simulate, type LibOpenCOR, type SimulationSettings } from './simulate.js'

let converter: Converter
let framework: BondgraphFramework
let runtime: ModelRuntime
let libcellml: LibCellML
let loc: LibOpenCOR

beforeAll(async () => {
  runtime = { ...(await frameworkRuntime()), oxigraph }
  libcellml = runtime.libcellml
  framework = bgRdfFramework()
  converter = new Converter({ libcellml, oxigraph, domParser: new DOMParser() as never })
  expect(converter.loadFramework(frameworkSource())).toEqual([])
  loc = await loadLibOpenCOR()
})

const MODELS = `${REPO_ROOT}packages/bg2cellml/test/models/`
const source = (path: string): string => readFileSync(path, 'utf8')
const SOURCE_URI = 'https://example.org/models/odes.ttl'

/** Whether each `<math>` of the CellML, in order, is an ODE (`<eq/>` of a `<diff/>`). */
const odeFlags = (cellml: string): boolean[] =>
  (cellml.match(/<math[\s\S]*?<\/math>/g) ?? []).map((math) => /<apply>\s*<eq\/>\s*<apply>\s*<diff\/>/.test(math))

/** Each `<math>`'s left-side variable, in order: the first `<ci>` after `<eq/>`, past a derivative's `<bvar>`. */
const leftSides = (cellml: string): string[] =>
  (cellml.match(/<math[\s\S]*?<\/math>/g) ?? []).map((math) => /<eq\/>\s*(?:<apply>\s*<diff\/>\s*<bvar>[\s\S]*?<\/bvar>\s*)?<ci>\s*(\w+)\s*<\/ci>/.exec(math)![1]!)

/** The CellML's comments. */
const comments = (cellml: string): string[] => [...cellml.matchAll(/<!--\s*(.*?)\s*-->/g)].map((match) => match[1]!)

const convert = async (path: string) => {
  const result = await converter.convert(source(path), { sourceUri: SOURCE_URI, rdfSource: true })
  expect(result.errors).toEqual([])
  expect(result.ok).toBe(true)
  return result
}

describe('sections', () => {
  it.each([
    [
      'S1 -> Rx R1 -> S2',
      'flows/one_reaction.ttl',
      [
        { title: 'Chemical potentials', variables: ['u_q_S1_c', 'u_q_S2_c'] },
        { title: 'Reaction affinities', variables: ['u_f_Rx_R1_c', 'u_r_Rx_R1_c'] },
        { title: 'Reaction flux', variables: ['v_Rx_R1_c'] },
        { title: 'Species flux', variables: ['v_q_S1_c', 'v_q_S2_c'] },
        { title: 'Mass conservation', variables: ['q_S1_c', 'q_S2_c'] },
      ],
    ],
    [
      'enzyme (composite reactions, a store on two reactions)',
      'flows/enzyme.ttl',
      [
        { title: 'Chemical potentials', variables: ['u_C_C', 'u_E_E', 'u_P_P', 'u_S_S'] },
        { title: 'Reaction affinities', variables: ['u_f_R1', 'u_f_R2', 'u_f_R3', 'u_r_R1', 'u_r_R2', 'u_r_R3'] },
        { title: 'Reaction flux', variables: ['v_R1', 'v_R2', 'v_R3'] },
        { title: 'Species flux', variables: ['v_C_C', 'v_E_E', 'v_P_P', 'v_S_S'] },
        { title: 'Mass conservation', variables: ['q_C_C', 'q_E_E', 'q_P_P', 'q_S_S'] },
      ],
    ],
    [
      'RC (electrical)',
      'RC_labelled_bonds.ttl',
      [
        { title: 'Potentials', variables: ['u_q_1'] },
        { title: 'Port potentials', variables: ['V_C', 'u_R_0'] },
        { title: 'Element flows', variables: ['v_R_0'] },
        { title: 'Junction flows', variables: ['I_R', 'v_V_in', 'v_q_1'] },
        { title: 'Conservation', variables: ['q_1'] },
      ],
    ],
    [
      'elastic vessels (hydraulic)',
      'editor/elastic-vessels.ttl',
      [
        { title: 'Potentials', variables: ['u_q_S1_c', 'u_q_S2_c'] },
        { title: 'Port potentials', variables: ['u_J1_c', 'u_J1_c', 'u_R_R2_c'] },
        { title: 'Element flows', variables: ['v_R_R1_c', 'v_R_R2_c'] },
        { title: 'Junction flows', variables: ['v_R_R1_c', 'v_q_S2_c'] },
        { title: 'Conservation', variables: ['q_S1_c', 'q_S2_c'] },
      ],
    ],
    [
      'an inductor and resistor on a source (no Potentials section)',
      'editor/electrical-inductive-node.ttl',
      [
        { title: 'Port potentials', variables: ['u_R_R1_c'] },
        { title: 'Element flows', variables: ['v_R_R1_c'] },
        { title: 'Junction flows', variables: ['v_L_S2_c', 'v_S_S1_c'] },
        { title: 'Conservation', variables: ['v_L_S2_c'] },
      ],
    ],
  ])('convert() writes %s in sections, with no comments', async (_name, path, sections) => {
    const result = await convert(`${MODELS}${path}`)
    expect(result.sections).toEqual(sections)
    // The CellML's equations are the sections', in order
    expect(leftSides(result.cellml!)).toEqual(sections.flatMap((section) => section.variables))
    expect(comments(result.cellml!)).toEqual([])
    // Every ODE after every algebraic equation
    const flags = odeFlags(result.cellml!)
    expect(flags.slice(flags.indexOf(true)).every(Boolean)).toBe(true)
  })

  it('leaves empty sections out', async () => {
    const result = await convert(`${MODELS}editor/electrical-inductive-node.ttl`)
    expect(result.sections.map((section) => section.title)).not.toContain('Potentials')
    expect(result.sections.every((section) => section.variables.length > 0)).toBe(true)
    expect(result.sections.map((section) => section.title)).not.toContain('Other relations')
  })

  it('celldl2cellml() still writes the ODEs first, after a comment, as BG-Tools does', async () => {
    const result = await converter.celldl2cellml(source(`${MODELS}flows/one_reaction.ttl`), { sourceUri: SOURCE_URI, rdfSource: true })
    const flags = odeFlags(result.cellml!)
    const lastOde = flags.lastIndexOf(true)
    expect(flags.slice(0, lastOde + 1).every(Boolean)).toBe(true)
    expect(comments(result.cellml!)[0]).toBe('Element ODEs')
  })

  const CASES: [string, string, SimulationSettings][] = [
    ['one_reaction', `${MODELS}flows/one_reaction.ttl`, { start: 0, end: 20, steps: 2000, recordedEvery: 20 }],
    ['enzyme', `${MODELS}flows/enzyme.ttl`, { start: 0, end: 20, steps: 2000, recordedEvery: 20 }],
    ['RC', `${MODELS}RC_labelled_bonds.ttl`, { start: 0, end: 10, steps: 1000, recordedEvery: 10 }],
    ['elastic vessels', `${MODELS}editor/elastic-vessels.ttl`, { start: 0, end: 10, steps: 1000, recordedEvery: 10 }],
    ['example_B2_reduced', `${BG_RDF}examples/example_B2_reduced.ttl`, { start: 0, end: 40, steps: 4000, recordedEvery: 40 }],
  ]

  it.each(CASES)('simulates %s the same in sections as in groups', (_name, path, settings) => {
    // convert()'s model, written in both orders
    const model = BondgraphModel.fromTurtle(framework, runtime, source(path), SOURCE_URI, { flowVariables: true, solveTransforms: true, naming: true })
    expect(model.log.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    const first = generateCellML(libcellml, model, { publicInterfaces: true })
    const last = generateCellML(libcellml, model, { publicInterfaces: true, sections: true })
    expect(first.sections).toBeUndefined()
    expect(last.sections!.length).toBeGreaterThan(0)
    expect(last.cellml).not.toBe(first.cellml)
    expect([...last.cellml!.match(/<math[\s\S]*?<\/math>/g)!].sort()).toEqual([...first.cellml!.match(/<math[\s\S]*?<\/math>/g)!].sort())

    const tight = { relativeTolerance: 1e-10, absoluteTolerance: 1e-12, ...settings }
    const before = simulate(loc, first.cellml!, tight)
    const after = simulate(loc, last.cellml!, tight)
    for (const group of ['states', 'rates', 'algebraics'] as const) {
      expect(Object.keys(after[group]).sort(), group).toEqual(Object.keys(before[group]).sort())
      for (const [name, values] of Object.entries(before[group])) {
        const scale = Math.max(1, ...values.map((value) => Math.abs(Number(value))).filter(Number.isFinite))
        values.forEach((value, i) => {
          const [a, b] = [Number(after[group][name]![i]), Number(value)]
          if (!Number.isFinite(b)) expect(a, `${group}.${name}[${i}]`).toBe(b)
          else expect(Math.abs(a - b), `${group}.${name}[${i}]: ${a} != ${b}`).toBeLessThanOrEqual(1e-12 * scale)
        })
      }
    }
  })
})
