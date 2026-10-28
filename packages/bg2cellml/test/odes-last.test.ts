/**
 * `convert()` writes the component's algebraic equations first and its ODEs
 * last (`odesLast`); `celldl2cellml()` keeps BG-Tools' order, ODEs first.
 * Only the order differs, so the two orders must simulate identically.
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

/** The equations' group comments, in order. */
const comments = (cellml: string): string[] => [...cellml.matchAll(/<!--\s*(.*?)\s*-->/g)].map((match) => match[1]!)

describe('ODEs last', () => {
  it.each([
    ['one_reaction', `${MODELS}flows/one_reaction.ttl`],
    ['enzyme', `${MODELS}flows/enzyme.ttl`],
  ])('convert() writes every ODE of %s after every algebraic equation', async (_name, path) => {
    const result = await converter.convert(source(path), { sourceUri: SOURCE_URI, rdfSource: true })
    expect(result.ok).toBe(true)
    const flags = odeFlags(result.cellml!)
    const firstOde = flags.indexOf(true)
    expect(firstOde).toBeGreaterThan(0)
    expect(flags.slice(firstOde).every(Boolean)).toBe(true)
    expect(comments(result.cellml!).at(-1)).toBe('Element ODEs')
  })

  it('puts ode(q_S1_c) and ode(q_S2_c) at the bottom for S1 -> Rx R1 -> S2', async () => {
    const result = await converter.convert(source(`${MODELS}flows/one_reaction.ttl`), { sourceUri: SOURCE_URI, rdfSource: true })
    const maths = result.cellml!.match(/<math[\s\S]*?<\/math>/g)!
    const lastTwo = maths.slice(-2).join('')
    expect(lastTwo).toMatch(/<diff\/>\s*<bvar>\s*<ci>t<\/ci>\s*<\/bvar>\s*<ci>q_S1_c<\/ci>/)
    expect(lastTwo).toMatch(/<diff\/>\s*<bvar>\s*<ci>t<\/ci>\s*<\/bvar>\s*<ci>q_S2_c<\/ci>/)
  })

  it('celldl2cellml() still writes the ODEs first, as BG-Tools does', async () => {
    const result = await converter.celldl2cellml(source(`${MODELS}flows/one_reaction.ttl`), { sourceUri: SOURCE_URI, rdfSource: true })
    const flags = odeFlags(result.cellml!)
    const lastOde = flags.lastIndexOf(true)
    expect(flags.slice(0, lastOde + 1).every(Boolean)).toBe(true)
    expect(comments(result.cellml!)[0]).toBe('Element ODEs')
  })

  const CASES: [string, string, SimulationSettings][] = [
    ['one_reaction', `${MODELS}flows/one_reaction.ttl`, { start: 0, end: 20, steps: 2000, recordedEvery: 20 }],
    ['enzyme', `${MODELS}flows/enzyme.ttl`, { start: 0, end: 20, steps: 2000, recordedEvery: 20 }],
    ['example_B2_reduced', `${BG_RDF}examples/example_B2_reduced.ttl`, { start: 0, end: 40, steps: 4000, recordedEvery: 40 }],
  ]

  it.each(CASES)('simulates %s the same with the ODEs first or last', (_name, path, settings) => {
    // convert()'s model, written in both orders
    const model = BondgraphModel.fromTurtle(framework, runtime, source(path), SOURCE_URI, { flowVariables: true, solveTransforms: true, naming: true })
    expect(model.log.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    const first = generateCellML(libcellml, model, { publicInterfaces: true })
    const last = generateCellML(libcellml, model, { publicInterfaces: true, odesLast: true })
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
