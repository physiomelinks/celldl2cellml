/**
 * `convert()` writes sources and composite elements in terms of their
 * neighbours' flow and potential variables (`flowVariables`), so a store fed
 * by a reaction has `v_q_S1_c = -v_Rx_R1_c`, not the reaction's rate again.
 * `celldl2cellml()` writes them as Python does. The two must simulate alike.
 */

import { readFileSync } from 'node:fs'

import { DOMParser } from '@xmldom/xmldom'
import createLibCellML from 'libcellml.js'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import type { LibCellML } from '@physiomelinks/cellml-units'
import { parseMathML, type AstNode } from '@physiomelinks/math-ast'

import { Converter, type Runtime } from '../src/index.js'
import { BG_RDF, REPO_ROOT, frameworkSource } from './reference.js'
import { loadLibOpenCOR, simulate, type LibOpenCOR, type SimulationSettings } from './simulate.js'

let converter: Converter
let loc: LibOpenCOR

beforeAll(async () => {
  const libcellml = (await createLibCellML()) as unknown as LibCellML
  const runtime: Runtime = { libcellml, oxigraph, domParser: new DOMParser() as never }
  converter = new Converter(runtime)
  expect(converter.loadFramework(frameworkSource())).toEqual([])
  loc = await loadLibOpenCOR()
})

const MODELS = `${REPO_ROOT}packages/bg2cellml/test/models/`
const source = (path: string): string => readFileSync(path, 'utf8')
const SOURCE_URI = 'https://example.org/models/flows.ttl'

/** Each equation of the CellML as text, such as `v_q_S1_c = -(v_Rx_R1_c)`. */
function equations(cellml: string): string[] {
  const text = (node: AstNode): string => {
    switch (node.type) {
      case 'Identifier':
        return node.name
      case 'Number':
        return String(node.value)
      case 'Negate':
        return `-(${text(node.value)})`
      case 'Add':
        return node.children.map(text).join(' + ')
      case 'Subtract':
        return `${text(node.minuend)} - ${text(node.subtrahend)}`
      case 'Multiply':
        return node.children.map(text).join(' * ')
      case 'Equal':
        return `${text(node.left)} = ${text(node.right)}`
      default:
        return `<${node.type}>`
    }
  }
  return (cellml.match(/<math[\s\S]*?<\/math>/g) ?? []).flatMap((math) => parseMathML(math, { domParser: new DOMParser() as never }).map(text))
}

describe('flow variables', () => {
  it("writes the user's S1 -> Rx R1 -> S2 with the reaction's flow", async () => {
    const result = await converter.convert(source(`${MODELS}flows/one_reaction.ttl`), { sourceUri: SOURCE_URI, rdfSource: true })
    expect(result.ok).toBe(true)
    const written = equations(result.cellml!)
    expect(written).toContain('v_q_S1_c = -(v_Rx_R1_c)')
    expect(written).toContain('v_q_S2_c = v_Rx_R1_c')
    // The rate is computed once, by the reaction's relation
    expect(written.filter((equation) => equation.includes('kappa_Rx_R1_c')).map((equation) => equation.split(' = ')[0])).toEqual(['v_Rx_R1_c'])
    // The ports' potentials stay: the manifest lists them
    expect(written).toContain('u_f_Rx_R1_c = u_q_S1_c')
    expect(result.elements['R1']!.variables.map((v) => v.name)).toEqual(expect.arrayContaining(['u_f_Rx_R1_c', 'u_r_Rx_R1_c', 'v_Rx_R1_c']))
  })

  it("gives a store on several reactions the signed sum of their flows", async () => {
    const result = await converter.convert(source(`${MODELS}flows/enzyme.ttl`), { sourceUri: SOURCE_URI, rdfSource: true })
    expect(result.issues).toEqual([])
    const written = equations(result.cellml!)
    expect(written).toEqual(expect.arrayContaining(['v_E_E = v_R2 - v_R1', 'v_C_C = v_R1 - v_R2', 'v_P_P = v_R2 + v_R3', 'v_S_S = -(v_R1 + v_R3)']))
    // A composite reaction's ports take the stores' potentials, not their relations
    expect(written).toEqual(expect.arrayContaining(['u_f_R1 = u_E_E + u_S_S', 'u_r_R2 = u_E_E + u_P_P']))
  })

  const CASES: [string, string, SimulationSettings][] = [
    ['one_reaction', `${MODELS}flows/one_reaction.ttl`, { start: 0, end: 20, steps: 2000, recordedEvery: 20 }],
    ['enzyme', `${MODELS}flows/enzyme.ttl`, { start: 0, end: 20, steps: 2000, recordedEvery: 20 }],
    ['example_RC_reduced', `${BG_RDF}examples/example_RC_reduced.ttl`, { start: 0, end: 0.1, steps: 1000, recordedEvery: 10 }],
    ['RCR_reduced', `${BG_RDF}examples/RCR_reduced.ttl`, { start: 0, end: 0.1, steps: 1000, recordedEvery: 10 }],
    ['example_B1_reduced', `${BG_RDF}examples/example_B1_reduced.ttl`, { start: 0, end: 40, steps: 4000, recordedEvery: 40 }],
    ['example_B2_reduced', `${BG_RDF}examples/example_B2_reduced.ttl`, { start: 0, end: 40, steps: 4000, recordedEvery: 40 }],
    ['A3_reduced_numbers_with_units', `${MODELS}A3_reduced_numbers_with_units.ttl`, { start: 0, end: 0.1, steps: 20000, recordedEvery: 200, relativeTolerance: 1e-11, absoluteTolerance: 1e-13 }],
  ]

  it.each(CASES)('simulates %s as celldl2cellml() does, within 1e-9', async (_name, path, settings) => {
    const turtle = source(path)
    const legacy = await converter.celldl2cellml(turtle, { sourceUri: SOURCE_URI, rdfSource: true })
    const converted = await converter.convert(turtle, { sourceUri: SOURCE_URI, rdfSource: true })
    expect(legacy.issues).toBeUndefined()
    expect(converted.errors).toEqual([])
    // Only where an element acts as a junction do they differ
    expect(converted.cellml).not.toBe(legacy.cellml)

    // Tight, so that the solver's error doesn't hide a difference, with more steps for A3's fast sine source
    const tight = { relativeTolerance: 1e-10, absoluteTolerance: 1e-12, ...settings }
    const before = simulate(loc, legacy.cellml!, tight)
    const after = simulate(loc, converted.cellml!, tight)
    for (const group of ['states', 'rates', 'algebraics'] as const) {
      expect(Object.keys(after[group]).sort(), group).toEqual(Object.keys(before[group]).sort())
      for (const [name, values] of Object.entries(before[group])) {
        const got = after[group][name]!
        // Relative to the variable's size over the run, as an oscillating one passes near 0
        const scale = Math.max(1, ...values.map((value) => Math.abs(Number(value))).filter(Number.isFinite))
        values.forEach((value, i) => {
          const [a, b] = [Number(got[i]), Number(value)]
          if (!Number.isFinite(b)) expect(a, `${group}.${name}[${i}]`).toBe(b)
          else expect(Math.abs(a - b), `${group}.${name}[${i}]: ${a} != ${b}`).toBeLessThanOrEqual(1e-9 * scale)
        })
      }
    }
  })
})
